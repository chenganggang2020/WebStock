#pragma once
#include "business_store.hpp"
#include "native_read_pool.hpp"
#include <QPointer>
#include <QMutex>
#include <atomic>
#include <memory>

// Application-owned polling; it must not follow a page's show/hide lifetime.
class CollectionPoll final : public QObject {
 public:
  using Cancelled = std::function<bool()>;
  struct Row { QString id; QByteArray payload; QJsonObject record; };
  using Rows = QList<Row>;
  struct Result { Rows rows; QString error; };
  using Reader = std::function<Rows(const QString&, const Cancelled&)>;
  std::function<void(Result, quint64)> completed;

  static bool eligible(const QJsonObject& row) {
    return row["autoPipeline"].toBool() &&
      QStringList{"queued", "retry"}.contains(row["pipelineState"].toString());
  }
  static Rows read(const QString& path, const Cancelled& cancelled) {
    auto active = [&] { business::require(!cancelled || !cancelled(), "采集队列读取已取消"); };
    active(); business::require(QFileInfo(path).isFile(), "采集库不存在，未创建");
    const auto name = QUuid::createUuid().toString();
    auto db = QSqlDatabase::addDatabase("QSQLITE", name);
    auto close = [&] { db.close(); db = {}; QSqlDatabase::removeDatabase(name); };
    try {
      db.setDatabaseName(path);
      db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");
      business::require(db.open(), "采集队列只读连接失败");
      business::require(db.transaction(), "采集队列只读快照失败");
      Rows result;
      {
        QSqlQuery q(db);
        q.setForwardOnly(true);
        business::require(q.exec("SELECT id,length(CAST(payload AS BLOB)),"
          "CASE WHEN length(CAST(payload AS BLOB))<=33554432 THEN CAST(payload AS BLOB) ELSE NULL END "
          "FROM records WHERE kind='collections' ORDER BY rowid"), "采集队列读取暂不可用，请重试");
        while (q.next()) {
          active();
          business::require(q.value(1).toLongLong() > 0 &&
            q.value(1).toLongLong() <= business::backupByteLimit, "采集原记录过大或损坏，未截断");
          const auto raw = q.value(2).toByteArray();
          QJsonParseError error; const auto doc = QJsonDocument::fromJson(raw, &error);
          const auto id = q.value(0).toString();
          business::require(error.error == QJsonParseError::NoError && doc.isObject() &&
            !id.isEmpty() && id.size() <= 100 && doc.object()["id"] == id,
            "采集原ID或全文损坏");
          // Parse/validate all full rows, including a completely empty auto queue.
          // Keep unknown fields and the complete payload of every eligible row.
          if (eligible(doc.object())) result.append({id, raw, doc.object()});
        }
        business::require(!q.lastError().isValid(), "采集队列读取未完成，未采用部分结果");
      }
      active(); business::require(db.commit(), "采集队列读取结束失败");
      close(); return result;
    } catch (...) { db.rollback(); close(); throw; }
  }
  static bool matches(const QString& path, const Row& row) {
    // One exact ID, never another full-library parse on the GUI thread.
    business::require(QFileInfo(path).isFile(), "采集库不存在，未创建");
    const auto name = QUuid::createUuid().toString();
    auto db = QSqlDatabase::addDatabase("QSQLITE", name);
    auto close = [&] { db.close(); db = {}; QSqlDatabase::removeDatabase(name); };
    try {
      db.setDatabaseName(path);
      db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=0");
      business::require(db.open(), "采集原记录只读连接失败"); bool same = false;
      {
        QSqlQuery q(db);
        q.prepare("SELECT length(CAST(payload AS BLOB)),"
          "CASE WHEN length(CAST(payload AS BLOB))<=33554432 THEN CAST(payload AS BLOB) ELSE NULL END "
          "FROM records WHERE kind='collections' AND id=?");
        q.addBindValue(row.id);
        business::require(q.exec(), "采集原记录重核暂不可用，请重试");
        if (q.next()) same = q.value(0).toLongLong() == row.payload.size() &&
                            q.value(1).toByteArray() == row.payload;
        business::require(!q.lastError().isValid(), "采集原记录重核失败");
      }
      close(); return same;
    } catch (...) { close(); throw; }
  }

  explicit CollectionPoll(QString path) : file(std::move(path)), reader(read) {
    connect(QCoreApplication::instance(), &QCoreApplication::aboutToQuit,
            this, [this] { cancel(); });
  }
  ~CollectionPoll() override { cancel(); }
  void request() { cancel(); pending = true; start(); }
  void cancel() {
    ++generation; stopped->store(true); pending = false;
    if (inFlight) release(inFlight);
  }
  bool current(quint64 token) const { return token == generation && !stopped->load(); }

 private:
  friend class CollectionPollTests;
  QString file;
  Reader reader;
  quint64 generation = 0;
  bool running = false, pending = false;
  std::shared_ptr<std::atomic_bool> stopped = std::make_shared<std::atomic_bool>(false);
  struct Delivery {
    QMutex mutex;
    Result result;
    QPointer<CollectionPoll> owner;
    QPointer<QObject> app;
    bool published = false, entered = false, releasing = false, released = false;
  };
  std::shared_ptr<Delivery> inFlight;
  static void finished(const std::shared_ptr<Delivery>& delivery) {
    if (delivery->app) QMetaObject::invokeMethod(delivery->app, [delivery] {
      auto self = delivery->owner;
      if (!self || self->inFlight != delivery) return;
      self->inFlight.reset(); self->running = false;
      if (self->pending) self->start();
    }, Qt::QueuedConnection);
  }
  static void release(const std::shared_ptr<Delivery>& delivery, bool onWorker = false) {
    Result discard;
    {
      QMutexLocker lock(&delivery->mutex);
      if (!delivery->published || delivery->entered || delivery->releasing) return;
      delivery->releasing = true; discard = std::move(delivery->result);
    }
    auto cleanup = [delivery, discard = std::move(discard)]() mutable {
      discard = {}; // Last full-data reference is released only by a worker.
      { QMutexLocker lock(&delivery->mutex); delivery->released = true; }
      finished(delivery);
    };
    if (onWorker) cleanup();
    else nativeReadPool()->start(std::move(cleanup), 1);
  }
  struct GuiDone {
    std::shared_ptr<Delivery> delivery;
    ~GuiDone() {
      { QMutexLocker lock(&delivery->mutex); delivery->entered = false; }
      release(delivery);
    }
  };
  void start() {
    if (running || !pending) return;
    pending = false; running = true;
    const auto token = generation; auto flag = std::make_shared<std::atomic_bool>(false);
    stopped = flag; const auto path = file; const auto read = reader;
    auto delivery = std::make_shared<Delivery>(); inFlight = delivery;
    QPointer<CollectionPoll> self(this); QPointer<QObject> app(QCoreApplication::instance());
    delivery->owner = self; delivery->app = app;
    nativeReadPool()->start([self, app, path, read, token, flag, delivery] {
      Result result;
      try { result.rows = read(path, [flag] { return flag->load(); }); }
      catch (const std::exception& e) { result.error = QString::fromUtf8(e.what()); }
      {
        QMutexLocker lock(&delivery->mutex);
        if (!flag->load()) { delivery->result = std::move(result); delivery->published = true; }
      }
      // Cancelled reads discard complete payloads here, before posting even the
      // small completion notice needed to reset running/start the latest request.
      result = {};
      if (flag->load()) {
        // Cancellation can race the publication above. Either discard it here,
        // or let an already-scheduled cleanup finish; neither case waits for GUI.
        bool published;
        { QMutexLocker lock(&delivery->mutex); published = delivery->published; }
        if (published) release(delivery, true);
        else {
          { QMutexLocker lock(&delivery->mutex); delivery->released = true; }
          finished(delivery);
        }
        return;
      }
      const bool posted = app && QMetaObject::invokeMethod(app, [self, token, delivery] {
        // view dies before GuiDone schedules cleanup, so cleanup owns the last
        // full-data copy even if completion deletes this owner reentrantly.
        GuiDone done{delivery}; Result view;
        {
          QMutexLocker lock(&delivery->mutex);
          if (delivery->releasing || delivery->released) return;
          delivery->entered = true;
          if (self && !self->pending && self->current(token)) view = delivery->result;
        }
        if (!self) return;
        if (self->pending || !self->current(token)) return;
        // A changed/progress receiver may destroy the owner during this call.
        const auto completed = self->completed;
        if (completed) completed(std::move(view), token);
      }, Qt::QueuedConnection);
      if (!posted) release(delivery, true);
      // No worker waits for GUI. running remains set until bounded cleanup has
      // completed; the one latest pending request starts in finished().
    });
  }
};
