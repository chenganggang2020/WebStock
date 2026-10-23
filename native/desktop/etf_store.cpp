#include "etf_daily.hpp"
#include "etf_schedule.hpp"
#include <QCryptographicHash>
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QUuid>
#include <stdexcept>

namespace etfDaily {
namespace {
void require(bool ok, const char *message) {
  if (!ok)
    throw std::runtime_error(message);
}
QString stamp(const QDateTime &now) {
  require(now.isValid(), "本机时间无效");
  return now.toUTC().toString(Qt::ISODateWithMs);
}
QString encode(const QJsonObject &o) {
  return QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact));
}
QJsonObject parse(const QString &s) {
  QJsonParseError e;
  auto d = QJsonDocument::fromJson(s.toUtf8(), &e);
  require(e.error == QJsonParseError::NoError && d.isObject(), "ETF库记录损坏");
  return d.object();
}
struct Db {
  QString name = QUuid::createUuid().toString();
  QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE", name);
  explicit Db(const QString &path) {
    try {
      require(QDir().mkpath(QFileInfo(path).absolutePath()), "ETF目录不可写");
      db.setDatabaseName(path);
      db.setConnectOptions("QSQLITE_BUSY_TIMEOUT=1500");
      require(db.open(), "ETF库打不开");
      QSqlQuery q(db);
      require(q.exec("PRAGMA user_version") && q.next() &&
                  q.value(0).toInt() <= 1,
              "ETF库版本不支持");
      require(q.exec("CREATE TABLE IF NOT EXISTS etf_reports(id TEXT PRIMARY "
                     "KEY,as_of TEXT NOT NULL,published TEXT NOT NULL,payload "
                     "TEXT NOT NULL,hash TEXT NOT NULL,checked TEXT,success "
                     "TEXT,origin TEXT NOT NULL,imported TEXT)"),
              "ETF建表失败");
      require(q.exec("CREATE TABLE IF NOT EXISTS etf_state(id INTEGER PRIMARY "
                     "KEY CHECK(id=1),payload TEXT NOT NULL)"),
              "ETF状态建表失败");
      require(q.exec("PRAGMA user_version=1"), "ETF版本写入失败");
    } catch (...) {
      db.close();
      db = {};
      QSqlDatabase::removeDatabase(name);
      throw;
    }
  }
  ~Db() {
    db.close();
    db = {};
    QSqlDatabase::removeDatabase(name);
  }
};
struct Tx {
  QSqlDatabase &db;
  bool committed = false;
  explicit Tx(QSqlDatabase &d) : db(d) {
    QSqlQuery q(db);
    require(q.exec("BEGIN IMMEDIATE"), "ETF库忙，请稍后重试");
  }
  ~Tx() {
    if (!committed)
      db.rollback();
  }
  void commit() {
    require(db.commit(), "ETF提交失败");
    committed = true;
  }
};
QJsonObject getState(QSqlDatabase &db) {
  QSqlQuery q(db);
  require(q.exec("SELECT payload FROM etf_state WHERE id=1"),
          "ETF状态读取失败");
  return q.next() ? parse(q.value(0).toString()) : QJsonObject();
}
void putState(QSqlDatabase &db, const QJsonObject &s) {
  QSqlQuery q(db);
  q.prepare("INSERT OR REPLACE INTO etf_state(id,payload) VALUES(1,?)");
  q.addBindValue(encode(s));
  require(q.exec(), "ETF状态保存失败");
}
QJsonObject recordRow(QSqlQuery &q) {
  auto r = validate(parse(q.value(0).toString()));
  auto nullable = [&](int n) {
    return q.value(n).isNull() ? QJsonValue()
                               : QJsonValue(q.value(n).toString());
  };
  return {{"report", r},
          {"checkedAt", nullable(1)},
          {"succeededAt", nullable(2)},
          {"origin", q.value(3).toString()},
          {"importedAt", nullable(4)},
          {"contentSha256", q.value(5).toString()}};
}
QJsonObject record(QSqlDatabase &db, const QString &id) {
  QSqlQuery q(db);
  q.prepare("SELECT payload,checked,success,origin,imported,hash FROM "
            "etf_reports WHERE id=?");
  q.addBindValue(id);
  require(q.exec(), "ETF记录读取失败");
  return q.next() ? recordRow(q) : QJsonObject();
}
QString digest(const QJsonObject &r) {
  return QString::fromLatin1(
      QCryptographicHash::hash(encode(r).toUtf8(), QCryptographicHash::Sha256)
          .toHex());
}
bool active(const QJsonObject &s, const QString &token, const QDateTime &now) {
  if (token.isEmpty() || s["activeToken"].toString() != token)
    return false;
  auto start =
      QDateTime::fromString(s["lastAttemptAt"].toString(), Qt::ISODateWithMs);
  require(start.isValid() && now >= start, "本机时间回退，未保存");
  return start.msecsTo(now) <= 45000;
}
void insert(QSqlDatabase &db, const QJsonObject &r, const QString &hash,
            const QJsonValue &checked, const QJsonValue &success,
            const QString &origin, const QJsonValue &imported) {
  QSqlQuery q(db);
  q.prepare("INSERT OR REPLACE INTO "
            "etf_reports(id,as_of,published,payload,hash,checked,success,"
            "origin,imported) VALUES(?,?,?,?,?,?,?,?,?)");
  for (auto v : QVariantList{r["articleId"].toString(), r["asOf"].toString(),
                             r["publishedAt"].toString(), encode(r), hash,
                             checked.toVariant(), success.toVariant(), origin,
                             imported.toVariant()})
    q.addBindValue(v);
  require(q.exec(), "ETF报告保存失败");
}
} // namespace
QJsonObject Store::state() const {
  if (!QFileInfo::exists(file))
    return {};
  Db c(file);
  return getState(c.db);
}
QJsonArray Store::history() const {
  if (!QFileInfo::exists(file))
    return {};
  Db c(file);
  QSqlQuery q(c.db);
  require(q.exec("SELECT payload,checked,success,origin,imported,hash FROM "
                 "etf_reports ORDER BY as_of DESC,published DESC,id DESC"),
          "ETF历史读取失败");
  QJsonArray out;
  while (q.next())
    out.append(recordRow(q));
  return out;
}
QJsonObject Store::read(const QString &id) const {
  if (!QFileInfo::exists(file))
    return {};
  Db c(file);
  return record(c.db, id);
}
QString Store::begin(const QDateTime &now) {
  return beginRequest(now, nullptr);
}
bool Store::saveVerifiedHistory(const QJsonObject &input, const QDateTime &now) {
  const auto at=stamp(now);auto r=validate(input);
  const auto verification=r["sourceVerification"].toString();
  require(verification=="catalog+article-footer" || verification=="catalog+official-content-api", "历史补齐必须逐篇核验公开来源");
  require(QDateTime::fromString(r["publishedAt"].toString(),Qt::ISODate)<=now,"历史发布时间在未来");
  Db c(file);Tx tx(c.db);auto old=record(c.db,r["articleId"].toString());
  require(old.isEmpty()||old["report"].toObject()["asOf"]==r["asOf"],"历史文章日期冲突，原档案保留");
  const auto hash=digest(r);const bool same=old["contentSha256"]==hash&&old["origin"]=="public-source";
  insert(c.db,r,hash,at,same?old["succeededAt"]:QJsonValue(at),"public-source",old["importedAt"]);
  // Historical verification deliberately leaves the latest-update state untouched.
  tx.commit();return true;
}
QString Store::beginScheduled(ScheduleClock &clock, const QDateTime &now) {
  return beginRequest(now, &clock);
}
void Store::setScheduleEnabled(bool enabled) {
  Db c(file);
  Tx tx(c.db);
  auto s=getState(c.db);
  s["scheduleEnabled"]=enabled;
  putState(c.db,s);
  tx.commit();
}
QString Store::beginRequest(const QDateTime &now, ScheduleClock *clock) {
  auto at = stamp(now);
  Db c(file);
  Tx tx(c.db);
  auto s = getState(c.db);
  QString scheduledKey;
  if (clock) {
    scheduledKey=clock->due(s,now);
    if (scheduledKey.isEmpty()) return {};
  }
  auto last =
      QDateTime::fromString(s["lastAttemptAt"].toString(), Qt::ISODateWithMs);
  if (clock && last.isValid() && last.msecsTo(now) < 60000) return {};
  require(!last.isValid() || last.msecsTo(now) >= 60000,
          "距上次尝试不足60秒或本机时间回退，请先查看缓存");
  auto token = QUuid::createUuid().toString(QUuid::WithoutBraces);
  s["activeToken"] = token;
  s["lastAttemptAt"] = at;
  s["attemptStatus"] = "running";
  if (clock) {
    s["lastScheduledKey"]=scheduledKey;
    s["lastScheduledAt"]=at;
  }
  putState(c.db, s);
  tx.commit();
  return token;
}
bool Store::finish(const QString &token, const QJsonObject &input,
                   const QDateTime &now) {
  auto at = stamp(now);
  Db c(file);
  Tx tx(c.db);
  auto s = getState(c.db);
  if (!active(s, token, now))
    return false;
  auto r = validate(input);
  require(QDateTime::fromString(r["publishedAt"].toString(), Qt::ISODate) <=
              now,
          "缓存发布时间在未来");
  auto old = record(c.db, r["articleId"].toString());
  require(old.isEmpty() || old["report"].toObject()["asOf"] == r["asOf"],
          "同文章数据日期改变，保留原档案");
  auto hash = digest(r);
  bool same = old["contentSha256"] == hash && old["origin"] == "public-source";
  QJsonValue succeeded = same ? old["succeededAt"] : QJsonValue(at);
  insert(c.db, r, hash, at, succeeded, "public-source", old["importedAt"]);
  s["activeToken"] = "";
  s["attemptStatus"] = "checked";
  s["checkedAt"] = at;
  s["lastError"] = "";
  if (!same)
    s["lastSuccessAt"] = at;
  s["lastArticleId"] = r["articleId"];
  const auto today=now.toOffsetFromUtc(28800).date();
  const auto expected=previousDay(today);
  const auto verification = r["sourceVerification"].toString();
  const bool verified = verification == "catalog+article-footer" ||
                        verification == "catalog+official-content-api";
  if (verified && expected.isValid() && r["asOf"].toString()==expected.toString(Qt::ISODate))
    s["lastSuccessTargetDate"]=today.toString(Qt::ISODate);
  putState(c.db, s);
  tx.commit();
  return true;
}
bool Store::fail(const QString &token, const QString &reason,
                 const QDateTime &now) {
  auto at = stamp(now);
  Db c(file);
  Tx tx(c.db);
  auto s = getState(c.db);
  if (token.isEmpty() || s["activeToken"].toString() != token)
    return false;
  s["activeToken"] = "";
  s["attemptStatus"] = "failed";
  s["lastError"] = reason.left(1000);
  s["failureAt"] = at;
  putState(c.db, s);
  tx.commit();
  return true;
}
int Store::importReports(const QJsonArray &reports, const QDateTime &now) {
  auto at = stamp(now);
  require(!reports.isEmpty() && reports.size() <= 500 &&
              QJsonDocument(reports).toJson(QJsonDocument::Compact).size() <=
                  2 * 1024 * 1024,
          "导入需1至500份，且不超过2MiB");
  Db c(file);
  Tx tx(c.db);
  int count = 0;
  for (auto v : reports) {
    auto r = validate(v.toObject());
    require(QDateTime::fromString(r["publishedAt"].toString(), Qt::ISODate) <=
                now,
            "导入发布时间在未来");
    auto old = record(c.db, r["articleId"].toString());
    auto hash = digest(r);
    if (!old.isEmpty()) {
      require(old["contentSha256"] == hash,
              "导入同文章内容冲突，整批取消且保留原记录");
      continue;
    }
    insert(c.db, r, hash, QJsonValue(), QJsonValue(), "imported-cache", at);
    ++count;
  }
  tx.commit();
  return count;
}
} // namespace etfDaily
