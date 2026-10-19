#include "market_store.hpp"

#include <QDateTime>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMap>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QUuid>
#include <cmath>
#include <stdexcept>
namespace {
void require(bool ok) {
  if (!ok) throw std::runtime_error("原生数据库读写失败；原记录未覆盖");
}
QString json(const QJsonObject &o) {
  return QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact));
}
QJsonObject object(const QString &s) {
  return QJsonDocument::fromJson(s.toUtf8()).object();
}
struct Connection {
  QString name = QUuid::createUuid().toString();
  QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE", name);
  explicit Connection(const QString &file, bool readOnly = false, int busyMs = 100) {
    db.setDatabaseName(file);
    if (readOnly) db.setConnectOptions(QString("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=%1").arg(busyMs));
    if (!db.open()) {
      db = {};
      QSqlDatabase::removeDatabase(name);
      require(false);
    }
  }
  ~Connection() {
    db.close();
    db = {};
    QSqlDatabase::removeDatabase(name);
  }
};
void schema(QSqlDatabase &db) {
  QSqlQuery q(db);
  require(q.exec("PRAGMA user_version"));
  require(q.next() && q.value(0).toInt() <= 1);
  require(q.exec("PRAGMA busy_timeout=5000"));
  // Conservative rollback journal: no dependency on platform WAL versions.
  require(q.exec("PRAGMA journal_mode=DELETE"));
  require(q.exec("PRAGMA synchronous=FULL"));
  require(
      q.exec("CREATE TABLE IF NOT EXISTS snapshots (cache_key TEXT PRIMARY "
             "KEY, data TEXT NOT NULL)"));
  require(q.exec(
      "CREATE TABLE IF NOT EXISTS bars (series_key TEXT NOT NULL, time INTEGER "
      "NOT NULL, data TEXT NOT NULL, PRIMARY KEY(series_key,time))"));
  require(
      q.exec("CREATE TABLE IF NOT EXISTS series (series_key TEXT PRIMARY "
             "KEY, metadata TEXT NOT NULL)"));
  require(q.exec("PRAGMA user_version=1"));
}
QJsonObject read(QSqlDatabase &db, const QString &key,
                 MarketStore::SaveInfo *info = nullptr) {
  QSqlQuery q(db);
  q.prepare("SELECT data FROM snapshots WHERE cache_key=?");
  q.addBindValue(key);
  require(q.exec());
  if (!q.next()) return {};
  auto result = object(q.value(0).toString());
  auto series = result.value("seriesKey").toString();
  if (!series.isEmpty()) {
    if (info) ++info->historyReads;
    QSqlQuery b(db);
    b.prepare("SELECT data FROM bars WHERE series_key=? ORDER BY time");
    b.addBindValue(series);
    require(b.exec());
    QJsonArray rows;
    while (b.next()) rows.append(object(b.value(0).toString()));
    if (info) info->historyRows += rows.size();
    result["rows"] = rows;
  }
  return result;
}
QString sourceTime(const QJsonObject &d) {
  if (d.contains("asOf")) {
    auto time = QDateTime::fromString(d["asOf"].toString(), Qt::ISODate);
    return time.isValid() ? time.toUTC().toString(Qt::ISODateWithMs)
                          : QString();
  }
  return d.contains("dataDate")
             ? d["dataDate"].toString()
             : d["tradeDate"].toString() + " " + d["tradeTime"].toString();
}
}  // namespace
bool MarketStore::contains(const QString &key) const {
  if (!QFileInfo::exists(file)) return false;
  Connection c(file, true, 5000);
  QSqlQuery q(c.db);
  q.prepare("SELECT 1 FROM snapshots WHERE cache_key=?");
  q.addBindValue(key);
  require(q.exec());
  return q.next();
}
QJsonObject MarketStore::read(const QString &key) const {
  if (!QFileInfo::exists(file)) return {};
  Connection c(file);
  return ::read(c.db, key);
}
QStringList MarketStore::keys(const QString &prefix) const {
  if (!QFileInfo::exists(file)) return {};
  Connection c(file);
  QSqlQuery q(c.db);
  q.prepare(
      "SELECT cache_key FROM snapshots WHERE substr(cache_key,1,?)=? ORDER BY "
      "cache_key DESC");
  q.addBindValue(prefix.size());
  q.addBindValue(prefix);
  require(q.exec());
  QStringList result;
  while (q.next()) result << q.value(0).toString();
  return result;
}
QJsonObject MarketStore::capitalArchive(const QString &id, const QString &date) const {
  QJsonArray ids, dates;
  QJsonObject record;
  if (!QFileInfo::exists(file)) return {{"ids", ids}, {"dates", dates}, {"record", record}};
  Connection c(file, true);
  require(c.db.transaction());
  {
    QSqlQuery q(c.db);
    require(q.exec("SELECT cache_key FROM snapshots WHERE instr(cache_key,'-capital@')>0 ORDER BY cache_key DESC"));
    QStringList seen;
    const auto prefix = id + "-capital@";
    while (q.next()) {
      const auto key = q.value(0).toString();
      const auto owner = key.section("-capital@", 0, 0);
      if (!seen.contains(owner)) { seen << owner; ids.append(owner); }
      if (key.startsWith(prefix)) dates.append(key.mid(prefix.size()));
    }
  }
  if (!date.isEmpty()) record = ::read(c.db, id + "-capital@" + date);
  require(c.db.commit());
  return {{"ids", ids}, {"dates", dates}, {"record", record}};
}
QJsonObject MarketStore::save(const QString &key,
                              const QJsonObject &incoming, SaveInfo *info) const {
  if (info) *info = {};
  Connection c(file);
  schema(c.db);
  require(c.db.transaction());
  try {
    auto old = ::read(c.db, key, info);
    auto checked =
        QDateTime::fromString(incoming["checkedAt"].toString(), Qt::ISODate);
    auto previous =
        QDateTime::fromString(old["checkedAt"].toString(), Qt::ISODate);
    if (!old.isEmpty() &&
        ((checked.isValid() && previous.isValid() && checked < previous) ||
         sourceTime(incoming) < sourceTime(old))) {
      require(c.db.commit());
      if (info) info->superseded = true;
      return old;
    }
    QJsonObject result = incoming;
    result.remove("error");
    result.remove("persistenceError");
    bool fundingSnapshot = incoming["mode"] == "snapshot";
    if (fundingSnapshot) {
      auto s=incoming["snapshot"].toObject();
      if(!s["mainNet"].isDouble() || !std::isfinite(s["mainNet"].toDouble()) || !incoming["rows"].isArray() || !incoming["rows"].toArray().isEmpty())
        throw std::runtime_error("无效资金快照");
      result.remove("seriesKey");result.remove("seriesBasis");
    }
    if (incoming.contains("rows") && !fundingSnapshot) {
      QMap<qint64, QJsonObject> merged;
      auto rows = incoming["rows"].toArray();
      if (rows.isEmpty() || incoming["timeUnit"] != "milliseconds")
        throw std::runtime_error("拒绝保存空序列或错误时间单位");
      QJsonObject basisFields{
          {"key", key},
          {"source", incoming["source"]},
          {"adjustment", incoming["adjustment"]},
          {"date", key.endsWith("-minute") || incoming["intraday"].toBool()
                       ? incoming["dataDate"]
                       : QJsonValue("")}};
      if (!incoming["periodKeyVersion"].toString().isEmpty())
        basisFields["periodKeyVersion"] = incoming["periodKeyVersion"];
      const QString basis = json(basisFields);
      bool same = old["seriesBasis"].toString() == basis;
      if (same)
        for (auto v : old["rows"].toArray()) {
          auto b = v.toObject();
          merged[qint64(b["time"].toDouble())] = b;
        }
      bool rebase = false;
      for (auto v : rows) {
        auto b = v.toObject();
        if (!b["time"].isDouble() || !std::isfinite(b["time"].toDouble()))
          throw std::runtime_error("拒绝保存无效时间；整批回滚");
        auto before = merged.value(qint64(b["time"].toDouble()));
        if (same && incoming["adjustment"] == "qfq" &&
            before["closed"].toBool() && before["valid"].toBool() &&
            b["valid"].toBool()) {
          for (auto field : {"open", "high", "low", "close"})
            if (std::abs(before[field].toDouble() - b[field].toDouble()) > 1e-7)
              rebase = true;
        }
      }
      QString series = same && !rebase ? old["seriesKey"].toString()
                                       : QUuid::createUuid().toString();
      if (!same || rebase) merged.clear();
      if (rebase)
        result["historyBoundary"] =
            "前复权历史发生修订：旧版本已归档，不拼接旧基准";
      else if (same && old.contains("historyBoundary"))
        result["historyBoundary"] = old["historyBoundary"];
      QSqlQuery insert(c.db);
      insert.prepare(
          "INSERT OR REPLACE INTO bars(series_key,time,data) VALUES(?,?,?)");
      for (auto v : rows) {
        auto b = v.toObject();
        auto t = qint64(b["time"].toDouble());
        // Missing responses cannot erase a previously observed valid point.
        if (merged.value(t)["valid"].toBool() && !b["valid"].toBool()) continue;
        const auto beforeAt = QDateTime::fromString(
            merged.value(t)["availableAt"].toString(), Qt::ISODate);
        const auto afterAt =
            QDateTime::fromString(b["availableAt"].toString(), Qt::ISODate);
        if (beforeAt.isValid() && (!afterAt.isValid() || afterAt < beforeAt))
          continue;
        merged[t] = b;
        insert.bindValue(0, series);
        insert.bindValue(1, t);
        insert.bindValue(2, json(b));
        require(insert.exec());
      }
      QJsonArray combined;
      for (auto b : merged) combined.append(b);
      result["rows"] = combined;
      result["seriesKey"] = series;
      result["seriesBasis"] = basis;
    }
    result["persistedAt"] =
        QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
    result["persistenceState"] = "saved";
    auto meta = result;
    if (!fundingSnapshot) meta.remove("rows");
    if (meta.contains("seriesKey")) {
      auto archive = meta;
      archive["cacheKey"] = key;
      QSqlQuery history(c.db);
      history.prepare(
          "INSERT OR REPLACE INTO series(series_key,metadata) VALUES(?,?)");
      history.addBindValue(meta["seriesKey"].toString());
      history.addBindValue(json(archive));
      require(history.exec());
    }
    QSqlQuery q(c.db);
    q.prepare("INSERT OR REPLACE INTO snapshots(cache_key,data) VALUES(?,?)");
    q.addBindValue(key);
    q.addBindValue(json(meta));
    require(q.exec());
    require(c.db.commit());
    return result;
  } catch (...) {
    c.db.rollback();
    throw;
  }
}
