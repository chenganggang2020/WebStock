#pragma once
#include <QLockFile>
#include <QThread>

#include "source_capture.hpp"
#include "source_history.hpp"

// Native-local planning ledger. Execution permission is never part of business
// backups; the UI must explicitly resume scheduling after every process start.
class SourceSchedule {
  QString file;
  std::unique_ptr<QLockFile> lock;
  struct Connection {
    QString name = QUuid::createUuid().toString();
    QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE", name);
    explicit Connection(const QString& path) {
      db.setDatabaseName(path);
      if (!db.open()) {
        auto error = db.lastError().text();
        db = {};
        QSqlDatabase::removeDatabase(name);
        throw std::runtime_error(error.toStdString());
      }
      QSqlQuery q(db);
      q.exec("PRAGMA busy_timeout=3000");
      q.exec("PRAGMA synchronous=FULL");
    }
    ~Connection() {
      db.close();
      db = {};
      QSqlDatabase::removeDatabase(name);
    }
  };
  struct Transaction {
    QSqlDatabase& db;
    bool committed = false;
    explicit Transaction(QSqlDatabase& value) : db(value) {
      QSqlQuery q(db);
      business::require(q.exec("BEGIN IMMEDIATE"), q.lastError().text());
    }
    ~Transaction() {
      if (!committed) db.rollback();
    }
    void commit() {
      business::require(db.commit(), db.lastError().text());
      committed = true;
    }
  };
  static QJsonArray select(QSqlDatabase& db, const QString& sql,
                           const QVariantList& values = {}) {
    QSqlQuery q(db);
    q.prepare(sql);
    for (const auto& value : values) q.addBindValue(value);
    business::require(q.exec(), q.lastError().text());
    QJsonArray out;
    while (q.next()) {
      QJsonParseError error;
      auto json = QJsonDocument::fromJson(q.value(0).toByteArray(), &error);
      business::require(
          error.error == QJsonParseError::NoError && json.isObject(),
          "作者计划/运行记录损坏，已停止执行");
      out.append(json.object());
    }
    return out;
  }
  static void execute(QSqlDatabase& db, const QString& sql,
                      const QVariantList& values = {}) {
    QSqlQuery q(db);
    q.prepare(sql);
    for (const auto& value : values) q.addBindValue(value);
    business::require(q.exec(), q.lastError().text());
  }
  static QJsonObject get(QSqlDatabase& db, const QString& id) {
    auto rows = select(db, "SELECT payload FROM source_plans WHERE id=?", {id});
    business::require(rows.size() == 1, "作者计划不存在");
    return rows[0].toObject();
  }
  static QByteArray json(const QJsonObject& value) {
    return QJsonDocument(value).toJson(QJsonDocument::Compact);
  }
  static void writePlan(QSqlDatabase& db, const QJsonObject& value) {
    execute(
        db,
        "INSERT INTO source_plans(id,profile,payload) VALUES(?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
        {value["id"].toString(), value["profileUrl"].toString(), json(value)});
  }

 public:
  explicit SourceSchedule(const QString& path) {
    business::require(QDir::isAbsolutePath(path), "计划库路径必须是绝对路径");
    business::require(QDir().mkpath(QFileInfo(path).absolutePath()),
                      "无法创建计划目录");
    file = QDir(QFileInfo(path).absolutePath()).canonicalPath() + "/" +
           QFileInfo(path).fileName();
    lock = std::make_unique<QLockFile>(file + ".lock");
    lock->setStaleLockTime(0);
    business::require(
        lock->tryLock(0),
        "作者计划已由另一个原生窗口使用，或目录不可写；不会强制夺取");
    Connection c(file);
    Transaction t(c.db);
    execute(c.db,
            "CREATE TABLE IF NOT EXISTS source_plans(id TEXT PRIMARY "
            "KEY,profile TEXT UNIQUE NOT NULL,payload TEXT NOT NULL)");
    execute(c.db,
            "CREATE TABLE IF NOT EXISTS source_runs(id TEXT PRIMARY "
            "KEY,plan_id TEXT NOT NULL,state TEXT NOT NULL,started INTEGER NOT "
            "NULL,payload TEXT NOT NULL)");
    execute(c.db,
            "CREATE UNIQUE INDEX IF NOT EXISTS one_source_run ON "
            "source_runs((1)) WHERE state='running'");
    execute(c.db,"CREATE TABLE IF NOT EXISTS legacy_source_runs(id TEXT PRIMARY KEY,started TEXT NOT NULL,payload TEXT NOT NULL)");
    auto runs =
        select(c.db, "SELECT payload FROM source_runs WHERE state='running'");
    auto now = QDateTime::currentMSecsSinceEpoch();
    for (const auto& v : runs) {
      auto run = v.toObject(), plan = get(c.db, run["planId"].toString());
      run["state"] = "interrupted";
      run["finishedAt"] = now;
      run["message"] = "上次运行被中断；启动后调度暂停，需主动恢复";
      execute(c.db, "UPDATE source_runs SET state=?,payload=? WHERE id=?",
              {"interrupted", json(run), run["id"].toString()});
      plan["lastState"] = "interrupted";
      plan["nextAt"] = now + qint64(plan["intervalMinutes"].toInt()) * 60000;
      writePlan(c.db, plan);
    }
    t.commit();
  }
  QJsonArray plans() const {
    Connection c(file);
    return select(c.db, "SELECT payload FROM source_plans ORDER BY rowid");
  }
  QJsonArray history() const {
    Connection c(file);
    return select(c.db,
                  "SELECT payload FROM source_runs ORDER BY started DESC,rowid "
                  "DESC LIMIT 200");
  }
  void recordItem(const QString& runId, const QJsonObject& item) {
    business::require(!item["collectionId"].toString().isEmpty() &&
                          item["collectionId"].toString().size() <= 256 &&
                          item["executionRevision"].isString() &&
                          item["executionRevision"].toString().size() <= 128 &&
                          item["sourceAttemptId"].isString() &&
                          item["sourceAttemptId"].toString().size() <= 128 &&
                          sourceCapture::contentId(item["sourceUrl"].toString()) ==
                              item["contentId"].toString() &&
                          !item["contentId"].toString().isEmpty() &&
                          QJsonDocument(item).toJson().size() <= 8192,
                      "本轮任务绑定无效，未提交下游");
    Connection c(file);
    Transaction t(c.db);
    auto runs = select(c.db,
                       "SELECT payload FROM source_runs WHERE id=? AND state='running'",
                       {runId});
    business::require(runs.size() == 1, "来源轮次已结束，未提交下游");
    auto run = runs[0].toObject();
    auto items = run["items"].toArray();
    for (auto value : items)
      if (value.toObject()["collectionId"] == item["collectionId"]) {
        business::require(value.toObject() == item, "本轮任务绑定冲突，未提交下游");
        return;
      }
    business::require(items.size() < run["plan"].toObject()["limit"].toInt(),
                      "本轮明细超过计划条数，未提交下游");
    items.append(item);
    run["items"] = items;
    execute(c.db, "UPDATE source_runs SET payload=? WHERE id=? AND state='running'",
            {json(run), runId});
    t.commit();
  }
  qint64 historyAnchor(bool legacy) const {
    Connection c(file);QSqlQuery q(c.db);
    business::require(q.exec("SELECT coalesce(max(rowid),0) FROM "+QString(legacy?"legacy_source_runs":"source_runs")),q.lastError().text());
    business::require(q.next(),"历史边界读取失败");return q.value(0).toLongLong();
  }
  int historyCount(bool legacy,qint64 anchor) const {
    business::require(anchor>=0,"历史边界无效");Connection c(file);QSqlQuery q(c.db);
    q.prepare("SELECT count(*) FROM "+QString(legacy?"legacy_source_runs":"source_runs")+" WHERE rowid<=?");q.addBindValue(anchor);
    business::require(q.exec()&&q.next(),"历史计数读取失败");return q.value(0).toInt();
  }
  QJsonArray historyPage(bool legacy,qint64 anchor,int offset) const {
    business::require(anchor>=0&&offset>=0,"历史分页无效");Connection c(file);
    return select(c.db,"SELECT payload FROM "+QString(legacy?"legacy_source_runs":"source_runs")+" WHERE rowid<=? ORDER BY started DESC,rowid DESC LIMIT 50 OFFSET ?",{anchor,offset});
  }
  int importHistory(const QJsonObject& fileData) {
    auto rows=sourceHistory::validate(fileData);Connection c(file);Transaction t(c.db);int added=0;
    for(auto v:rows) {business::require(!QThread::currentThread()->isInterruptionRequested(),"历史导入已取消，整批回滚");auto r=v.toObject();auto existing=select(c.db,"SELECT payload FROM legacy_source_runs WHERE id=?",{r["id"].toString()});
      if(!existing.isEmpty()) {business::require(existing[0].toObject()==r,"旧轮次档案内容冲突，整批未导入："+r["id"].toString());continue;}
      execute(c.db,"INSERT INTO legacy_source_runs(id,started,payload) VALUES(?,?,?)",{r["id"].toString(),r["startedAt"].toString(),json(r)});++added;
    }business::require(!QThread::currentThread()->isInterruptionRequested(),"历史导入已取消，整批回滚");t.commit();return added;
  }
  QJsonObject exportHistory(bool legacy,qint64 anchor) const {
    business::require(anchor>=0,"历史边界无效");Connection c(file);
    auto rows=select(c.db,"SELECT payload FROM "+QString(legacy?"legacy_source_runs":"source_runs")+" WHERE rowid<=? ORDER BY started DESC,rowid DESC",{anchor});
    auto out=legacy?sourceHistory::bundle(rows):QJsonObject{{"schema","native-qt-source-runs-v1"},{"runs",rows}};
    business::require(QJsonDocument(out).toJson(QJsonDocument::Compact).size()<=32*1024*1024,"历史文件超过32MiB");return out;
  }
  QJsonObject save(QJsonObject value) {
    const auto profile = sourceCapture::profile(value["profileUrl"].toString());
    const auto name = value["name"].toString().trimmed(),
               rights = value["rightsBasis"].toString().trimmed();
    const auto count = value["limit"].toInt(),
               interval = value["intervalMinutes"].toInt();
    business::require(!name.isEmpty() && name.size() <= 120,
                      "请填写120字以内的作者名称");
    business::require(!rights.isEmpty() && rights.size() <= 4000,
                      "请填写4000字以内的处理授权依据");
    business::require(
        count >= 1 && count <= 50 && value["limit"].toDouble() == count,
        "单轮条数必须为1至50的整数");
    business::require(interval >= 10 && interval <= 1440 &&
                          value["intervalMinutes"].toDouble() == interval,
                      "采集间隔必须为10至1440分钟整数");
    const auto id = QString::fromLatin1(
        QCryptographicHash::hash(profile.toUtf8(), QCryptographicHash::Sha256)
            .toHex());
    Connection c(file);
    Transaction t(c.db);
    business::require(select(c.db,
                             "SELECT payload FROM source_runs WHERE plan_id=? "
                             "AND state='running'",
                             {id})
                          .isEmpty(),
                      "该作者正在读取，请先停止再修改计划");
    auto old =
        select(c.db, "SELECT payload FROM source_plans WHERE id=?", {id});
    auto previous = old.isEmpty() ? QJsonObject{} : old[0].toObject();
    const auto type=sourceCapture::contentType(value.contains("contentType")
        ?value.value("contentType"):previous.value("contentType"));
    business::require(
        !old.isEmpty() ||
            select(c.db, "SELECT payload FROM source_plans").size() < 50,
        "最多保存50个作者计划");
    QJsonObject result{{"id", id},
                       {"name", name},
                       {"profileUrl", profile},
                       {"rightsBasis", rights},
                       {"limit", count},
                       {"intervalMinutes", interval},
                       {"contentType", type},
                       {"enabled", previous["enabled"].toBool()},
                       {"nextAt", previous["nextAt"].toDouble()},
                       {"lastState", previous["lastState"].toString("never")}};
    writePlan(c.db, result);
    t.commit();
    return result;
  }
  void enable(const QString& id, bool enabled) {
    Connection c(file);
    Transaction t(c.db);
    auto plan = get(c.db, id);
    plan["enabled"] = enabled;
    writePlan(c.db, plan);
    t.commit();
  }
  QJsonObject due(qint64 now) const {
    Connection c(file);
    if (!select(c.db, "SELECT payload FROM source_runs WHERE state='running'")
             .isEmpty())
      return {};
    QJsonObject result;
    for (const auto& value :
         select(c.db, "SELECT payload FROM source_plans ORDER BY rowid")) {
      auto plan = value.toObject();
      auto at = qint64(plan["nextAt"].toDouble());
      if (plan["enabled"].toBool() && at <= now &&
          (result.isEmpty() || at < qint64(result["nextAt"].toDouble())))
        result = plan;
    }
    return result;
  }
  QJsonObject begin(const QString& id, qint64 now, bool manual) {
    business::require(now >= 0, "无效运行时间");
    Connection c(file);
    Transaction t(c.db);
    business::require(
        select(c.db, "SELECT payload FROM source_runs WHERE state='running'")
            .isEmpty(),
        "已有作者来源正在读取");
    auto plan = get(c.db, id);
    business::require(manual || (plan["enabled"].toBool() &&
                                 plan["nextAt"].toDouble() <= now),
                      "计划未启用或未到期");
    plan["contentType"]=sourceCapture::contentType(plan.value("contentType"));
    QJsonObject run{{"id", QUuid::createUuid().toString(QUuid::WithoutBraces)},
                    {"planId", id},
                    {"plan", plan},
                    {"startedAt", now},
                    {"state", "running"},
                    {"trigger", manual ? "manual" : "scheduled"},
                    {"counts", QJsonObject{}}};
    execute(c.db,
            "INSERT INTO source_runs(id,plan_id,state,started,payload) "
            "VALUES(?,?,?,?,?)",
            {run["id"].toString(), id, "running", now, json(run)});
    plan["lastState"] = "running";
    writePlan(c.db, plan);
    t.commit();
    return run;
  }
  bool finish(const QString& id, const QString& state, qint64 now,
              QJsonObject counts, QString message) {
    business::require(
        QStringList{"complete", "failed", "cancelled", "interrupted"}.contains(
            state),
        "无效运行状态");
    QJsonObject safeCounts;
    for (const auto& key : {"discovered", "processed", "queued", "resumed"}) {
      const int value = counts.value(key).toInt();
      business::require(value >= 0 && value <= 1000 &&
                            (counts.value(key).isUndefined() ||
                             counts.value(key).toDouble(-1) == value),
                        "运行计数无效");
      safeCounts[key] = value;
    }
    business::require(
        safeCounts["queued"].toInt() <= safeCounts["processed"].toInt() &&
            safeCounts["resumed"].toInt() <= 50 &&
            safeCounts["processed"].toInt() <= safeCounts["discovered"].toInt() + safeCounts["resumed"].toInt(),
        "运行计数不一致");
    Connection c(file);
    Transaction t(c.db);
    auto runs = select(
        c.db, "SELECT payload FROM source_runs WHERE id=? AND state='running'",
        {id});
    if (runs.isEmpty()) return false;
    auto run = runs[0].toObject();
    const auto roundLimit = run["plan"].toObject()["limit"].toInt();
    business::require(safeCounts["processed"].toInt() <= roundLimit &&
                          safeCounts["resumed"].toInt() <= roundLimit, "运行计数超过本轮上限");
    business::require(now >= run["startedAt"].toDouble(),
                      "完成时间不能早于开始时间");
    run["state"] = state;
    run["finishedAt"] = now;
    run["counts"] = safeCounts;
    run["message"] = message.left(4000);
    execute(c.db, "UPDATE source_runs SET state=?,payload=? WHERE id=?",
            {state, json(run), id});
    auto plan = get(c.db, run["planId"].toString());
    plan["nextAt"] = now + qint64(plan["intervalMinutes"].toInt()) * 60000;
    plan["lastState"] = state;
    writePlan(c.db, plan);
    t.commit();
    return true;
  }
};
