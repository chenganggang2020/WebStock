#pragma once
#include "source_capture.hpp"
#include <limits>

// Visible-source inventory only. No credentials, media URLs, engine settings or
// execution permission belong here. Business tasks remain independently bound.
class SourceDiscovery {
  QString file;
  struct Connection {
    QString name = QUuid::createUuid().toString();
    QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE", name);
    explicit Connection(const QString& path) {
      db.setDatabaseName(path);
      // This inventory is queried by the source UI. Fail closed on a busy
      // database instead of multiplying SQLite waits across prepare/execute.
      db.setConnectOptions("QSQLITE_BUSY_TIMEOUT=0");
      if (!db.open()) {
        auto error = db.lastError().text();
        db = {}; QSqlDatabase::removeDatabase(name);
        throw std::runtime_error(error.toStdString());
      }
    }
    ~Connection() { db.close(); db = {}; QSqlDatabase::removeDatabase(name); }
  };
  static QSqlQuery execute(QSqlDatabase& db, const QString& sql,
                           const QVariantList& values = {}) {
    QSqlQuery query(db);
    const bool prepared = query.prepare(sql);
    business::require(prepared, query.lastError().text());
    for (const auto& value : values) query.addBindValue(value);
    const bool ok = query.exec();
    business::require(ok, query.lastError().text());
    return query;
  }
  struct Transaction {
    QSqlDatabase& db;
    bool committed = false;
    explicit Transaction(QSqlDatabase& value) : db(value) { execute(db, "BEGIN IMMEDIATE"); }
    ~Transaction() { if (!committed) db.rollback(); }
    void commit() {
      const bool ok = db.commit();
      business::require(ok, db.lastError().text());
      committed = true;
    }
  };
  static QString clean(QString text) {
    return text.replace(QRegularExpression("\\s+", QRegularExpression::UseUnicodePropertiesOption), " ").trimmed();
  }
  static QJsonArray select(QSqlDatabase& db, const QString& suffix,
                           const QVariantList& values) {
    auto q = execute(db, "SELECT profile,id,url,title,first_seen,last_seen,observation_revision,"
                         "state,collection_id,execution_revision,detail_saved_at FROM discoveries " + suffix, values);
    QJsonArray rows;
    while (q.next()) rows.append(QJsonObject{
        {"profileUrl", q.value(0).toString()}, {"contentId", q.value(1).toString()},
        {"sourceUrl", q.value(2).toString()}, {"title", q.value(3).toString()},
        {"firstSeenAt", q.value(4).toDouble()}, {"lastSeenAt", q.value(5).toDouble()},
        {"observationRevision", q.value(6).toInt()}, {"state", q.value(7).toString()},
        {"collectionId", q.value(8).toString()}, {"executionRevision", q.value(9).toString()},
        {"detailSavedAt", q.value(10).isNull() ? QJsonValue() : QJsonValue(q.value(10).toDouble())}});
    return rows;
  }
  static void timeValid(qint64 now) {
    business::require(now > 0 && now <= 9007199254740991LL, "发现时间无效");
  }
 public:
  explicit SourceDiscovery(const QString& path) : file(path) {
    business::require(QDir::isAbsolutePath(file), "发现目录路径必须是绝对路径");
    business::require(QDir().mkpath(QFileInfo(file).absolutePath()), "无法创建发现目录");
    Connection c(file);
    Transaction transaction(c.db);
    auto q = execute(c.db, "PRAGMA user_version");
    business::require(q.next(), "无法读取发现目录版本");
    const int version = q.value(0).toInt(); q.finish();
    business::require(version == 0 || version == 1, "发现目录版本不支持，未覆盖原文件");
    if (version == 0) {
      q = execute(c.db, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      business::require(q.next() && q.value(0).toInt() == 0, "目标不是空发现目录，未修改原表"); q.finish();
      execute(c.db, "CREATE TABLE discoveries(profile TEXT NOT NULL,id TEXT NOT NULL,url TEXT NOT NULL,"
                   "title TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,"
                   "observation_revision INTEGER NOT NULL CHECK(observation_revision>0),"
                   "state TEXT NOT NULL CHECK(state IN ('pending_detail','detail_saved')),"
                   "collection_id TEXT NOT NULL DEFAULT '',execution_revision TEXT NOT NULL DEFAULT '',"
                   "detail_saved_at INTEGER,PRIMARY KEY(profile,id))");
      execute(c.db, "CREATE INDEX discovery_pending ON discoveries(profile,state,first_seen,id)");
      execute(c.db, "PRAGMA user_version=1");
    }
    // A same-version incompatible or damaged schema must fail, not be rebuilt.
    select(c.db, "LIMIT 0", {});
    transaction.commit();
  }
  QString filePath() const { return file; }
  void observe(const QString& author, const QJsonArray& items, qint64 now) {
    const auto canonical = sourceCapture::profile(author);
    timeValid(now);
    business::require(!items.isEmpty() && items.size() <= 1000, "发现批次必须为1–1000条");
    QMap<QString, QJsonObject> batch;
    for (auto value : items) {
      auto item = value.toObject();
      const auto id = sourceCapture::contentId(item["sourceUrl"].toString());
      business::require(!id.isEmpty() && item["contentId"].toString() == id &&
                            item["title"].isString() && item["title"].toString().size() <= 300,
                        "发现作品身份或标题无效");
      QUrl url(item["sourceUrl"].toString());
      const QString publicUrl = "https://www.douyin.com" + url.path().remove(QRegularExpression("/$"));
      QJsonObject safe{{"contentId", id}, {"sourceUrl", publicUrl}, {"title", clean(item["title"].toString())}};
      business::require(!batch.contains(id) || batch[id] == safe, "同批作品身份冲突，整批未保存");
      batch[id] = safe;
    }
    Connection c(file);
    Transaction transaction(c.db);
    QMap<QString, QJsonObject> existing;
    for (auto value : select(c.db, "WHERE profile=?", {canonical})) {
      auto row = value.toObject(); existing[row["contentId"].toString()] = row;
    }
    int added = 0;
    for (auto id : batch.keys()) if (!existing.contains(id)) ++added;
    business::require(existing.size() + added <= 10000, "该作者发现目录超过10000条，整批未保存；未淘汰旧项");
    for (auto it = batch.cbegin(); it != batch.cend(); ++it) {
      const auto old = existing.value(it.key());
      business::require(old.isEmpty() || old["sourceUrl"] == it.value()["sourceUrl"], "作品公开链接类型冲突，整批未保存");
      if (!old.isEmpty() && now < qint64(old["lastSeenAt"].toDouble())) continue;
      const auto title = it.value()["title"].toString().isEmpty() ? old["title"].toString() : it.value()["title"].toString();
      const bool changed = !old.isEmpty() && title != old["title"].toString();
      business::require(old.isEmpty() || (old["observationRevision"].toInt() > 0 &&
                          old["observationRevision"].toInt() < std::numeric_limits<int>::max() - 1), "发现修订超出范围");
      const int revision = old.isEmpty() ? 1 : old["observationRevision"].toInt() + int(changed);
      business::require(revision > 0 && revision < std::numeric_limits<int>::max(), "发现修订超出范围");
      execute(c.db, "INSERT INTO discoveries(profile,id,url,title,first_seen,last_seen,observation_revision,state) "
                   "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile,id) DO UPDATE SET "
                   "title=excluded.title,last_seen=excluded.last_seen,observation_revision=excluded.observation_revision,state=excluded.state",
              {canonical, it.key(), it.value()["sourceUrl"].toString(), title.isNull() ? QStringLiteral("") : title,
               old.isEmpty() ? now : qint64(old["firstSeenAt"].toDouble()),
               qMax(now, qint64(old["lastSeenAt"].toDouble())), revision,
               old.isEmpty() || changed ? QString("pending_detail") : old["state"].toString()});
    }
    transaction.commit();
  }
  QJsonObject counts(const QString& author) const {
    Connection c(file);
    auto q = execute(c.db, "SELECT count(*),coalesce(sum(state='pending_detail'),0) FROM discoveries WHERE profile=?",
                     {sourceCapture::profile(author)});
    business::require(q.next(), "无法读取发现目录计数");
    return {{"total", q.value(0).toInt()}, {"pending", q.value(1).toInt()}};
  }
  QJsonArray pending(const QString& author) const {
    Connection c(file);
    return select(c.db, "WHERE profile=? AND state='pending_detail' ORDER BY first_seen,id", {sourceCapture::profile(author)});
  }
  QJsonArray page(const QString& author, int offset = 0) const {
    business::require(offset >= 0 && offset <= 10000, "发现目录分页超出范围");
    Connection c(file);
    return select(c.db, "WHERE profile=? ORDER BY first_seen,id LIMIT 50 OFFSET ?", {sourceCapture::profile(author), offset});
  }
  QJsonArray entries(const QString& author, const QStringList& ids) const {
    business::require(ids.size() <= 50, "详情绑定超出单轮50条");
    if (ids.isEmpty()) return {};
    QStringList marks; QVariantList values{sourceCapture::profile(author)};
    for (const auto& id : ids) { marks << "?"; values << id; }
    Connection c(file);
    return select(c.db, "WHERE profile=? AND id IN (" + marks.join(',') + ")", values);
  }
  bool acknowledge(const QString& author, const QString& id, int observationRevision,
                   const QString& collectionId, const QString& executionRevision, qint64 now) {
    const auto canonical = sourceCapture::profile(author);
    timeValid(now);
    business::require(observationRevision > 0 && !collectionId.isEmpty() && collectionId.size() <= 256 &&
                          executionRevision.size() <= 128, "详情确认身份无效");
    Connection c(file);
    auto q = execute(c.db, "UPDATE discoveries SET state='detail_saved',collection_id=?,execution_revision=?,detail_saved_at=? "
                          "WHERE profile=? AND id=? AND observation_revision=? AND last_seen<=? AND (detail_saved_at IS NULL OR detail_saved_at<=?)",
                     {collectionId, executionRevision.isNull() ? QStringLiteral("") : executionRevision,
                      now, canonical, id, observationRevision, now, now});
    return q.numRowsAffected() == 1;
  }
};
