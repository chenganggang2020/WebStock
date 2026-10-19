#include "dark_stock.hpp"
#include <QDateTime>
#include <QDir>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QFile>
#include <QJsonDocument>
#include <QLockFile>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QSaveFile>
#include <QThread>
#include <QTimeZone>
#include <QTimer>
#include <cmath>
#include <stdexcept>
namespace darkStock {
namespace {
void require(bool ok, const char *message) {
  if (!ok)
    throw std::runtime_error(message);
}
void dateOK(const QString &s) {
  require(QDate::fromString(s, Qt::ISODate).isValid() &&
              QDate::fromString(s, Qt::ISODate).toString(Qt::ISODate) == s,
          "日期无效");
}
qint64 stamp(const QString &s) {
  auto d = QDateTime::fromString(s, Qt::ISODateWithMs);
  require(
      d.isValid() &&
          QRegularExpression("(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch(),
      "抓取时刻无效");
  return d.toMSecsSinceEpoch();
}
QJsonObject source() {
  return {
      {"id", "eastmoney-darktrade-rank"},
      {"provider", "Eastmoney"},
      {"url", "https://emrnweb.eastmoney.com/graymarket/"},
      {"endpoint", "https://quotederivates.eastmoney.com/datacenter/darktrade"},
      {"classification", "provider-model-estimate"},
      {"documentedPublicApi", false},
      {"licenseVerified", false},
      {"methodologyVersion", QJsonValue::Null},
      {"fieldMapping",
       "GrayMarketRank web build main.79b98a58; observed 2026-09-17"}};
}
double integer(QJsonValue v, double max) {
  auto n = v.toDouble();
  require(v.isDouble() && std::isfinite(n) && std::floor(n) == n &&
              std::abs(n) <= max,
          "来源整数超限或无效");
  return n;
}
QJsonValue cents(QJsonValue v) {
  if (v.isNull() || v.isUndefined())
    return QJsonValue::Null;
  return QString::number(qint64(integer(v, 9007199254740991.)) * 100);
}
QJsonValue numeric(QJsonValue v) {
  if (v.isNull() || v.isUndefined())
    return QJsonValue::Null;
  require(v.isDouble() && std::isfinite(v.toDouble()), "来源数值无效");
  return v;
}
QString key(int market, const QString &code) {
  return (market == 1   ? "sh"
          : market == 0 ? "sz"
                        : QString("unknown:%1:").arg(market)) +
         code;
}
qint64 exact(QJsonValue value) {
  require(value.isString() && QRegularExpression("^-?(0|[1-9][0-9]{0,17})$")
                                  .match(value.toString())
                                  .hasMatch(),
          "金额不是精确整数分");
  bool ok = false;
  auto n = value.toString().toLongLong(&ok);
  require(ok && std::abs(n) <= 900719925474099100LL, "金额超出旧来源边界");
  return n;
}
QJsonValue reconciliation(const QJsonObject &row) {
  for (auto k : {"darkNetCents", "visibleNetCents", "combinedNetCents"})
    if (row[k].isNull())
      return QJsonValue::Null;
  return exact(row["darkNetCents"]) + exact(row["visibleNetCents"]) ==
         exact(row["combinedNetCents"]);
}
QJsonObject readJson(const QString &file) {
  QFile f(file);
  if (!f.exists())
    return {};
  require(f.open(QIODevice::ReadOnly) && f.size() <= 16 * 1024 * 1024,
          "个股缓存无法读取或超过16MiB");
  QJsonParseError e;
  auto d = QJsonDocument::fromJson(f.readAll(), &e);
  require(e.error == QJsonParseError::NoError && d.isObject(),
          "个股缓存格式无效");
  return d.object();
}
void writeJson(const QString &file, const QJsonObject &data,
               const std::function<bool()> &cancelled = {}) {
  require(!cancelled || !cancelled(), "请求已取消");
  require(QDir().mkpath(QFileInfo(file).absolutePath()), "无法建立个股专属缓存目录");
  QSaveFile f(file);
  require(f.open(QIODevice::WriteOnly), "无法写专属缓存");
  auto bytes = QJsonDocument(data).toJson(QJsonDocument::Compact);
  require(bytes.size() <= 16 * 1024 * 1024 && f.write(bytes) == bytes.size(),
          "专属缓存写入失败");
  require(!cancelled || !cancelled(), "请求已取消");
  require(f.commit(), "专属缓存提交失败");
}
} // namespace
QString url(const QString &date, int page) {
  dateOK(date);
  require(page >= 1 && page <= 60, "分页超出旧来源边界");
  auto d = date;
  d.remove('-');
  return QString("https://quotederivates.eastmoney.com/datacenter/"
                 "darktrade?version=101&cver=100&date=%1&StartPage=%2&"
                 "NumPerPage=100&sortflag=6&desc=1&market=&datetype=")
      .arg(d)
      .arg(page);
}
QJsonObject normalize(const QJsonObject &raw, const QString &date, int page,
                      const QString &at) {
  url(date, page);
  stamp(at);
  auto d = date;
  d.remove('-');
  require(raw["errid"].isDouble() && raw["errid"].toDouble() == 0 &&
              raw["1"].toVariant().toString() == d && raw["data"].isArray(),
          "旧源拒绝请求或返回不同交易日");
  auto input = raw["data"].toArray();
  int total = int(integer(raw["2"], 6000));
  require(input.size() <= 100 && total >= input.size(), "来源总数或行数无效");
  QJsonArray rows;
  QSet<QString> seen;
  int missing = 0, failed = 0;
  for (auto v : input) {
    require(v.isObject(), "来源股票行无效");
    auto r = v.toObject();
    auto code = r["4"].toString(), name = r["16"].toString();
    int market = int(integer(r["3"], 2147483647));
    require(market != 90 &&
                QRegularExpression("^[0-9]{6}$").match(code).hasMatch() &&
                !name.trimmed().isEmpty() && name.size() <= 120 &&
                !seen.contains(key(market, code)),
            "来源股票身份重复或无效");
    seen.insert(key(market, code));
    auto price = numeric(r["13"]);
    QJsonObject row{{"key", key(market, code)},
                    {"code", code},
                    {"name", name.trimmed()},
                    {"providerMarket", market},
                    {"venue", market == 1   ? QJsonValue("SH")
                              : market == 0 ? QJsonValue("SZ")
                                            : QJsonValue(QJsonValue::Null)},
                    {"price", price.isDouble()
                                  ? QJsonValue(price.toDouble() / 1000)
                                  : QJsonValue(QJsonValue::Null)},
                    {"darkNetCents", cents(r["6"])},
                    {"visibleNetCents", cents(r["7"])},
                    {"combinedNetCents", cents(r["8"])},
                    {"changeRatio", numeric(r["14"])},
                    {"darkActivityRatio", numeric(r["11"])},
                    {"sourceTimeRaw",
                     r.contains("5") ? r["5"] : QJsonValue(QJsonValue::Null)},
                    {"sourceObservedAt", QJsonValue::Null},
                    {"receivedAt", at}};
    auto ok = reconciliation(row);
    row["reconciled"] = ok;
    if (ok.isNull())
      missing++;
    else if (!ok.toBool())
      failed++;
    rows.append(row);
  }
  return {{"version", "webstock.eastmoney-dark-rank/v1"},
          {"automaticTrading", false},
          {"scope", "stock"},
          {"tradingDay", date},
          {"source", source()},
          {"receivedAt", at},
          {"rows", rows},
          {"coverage", QJsonObject{{"page", page},
                                   {"pageSize", 100},
                                   {"totalReported", total},
                                   {"receivedRows", rows.size()},
                                   {"paginationSnapshotConsistent", false}}},
          {"quality", QJsonObject{{"missingCoreRows", missing},
                                  {"reconciliationFailures", failed},
                                  {"freshness", "unknown-source-clock"}}}};
}
Assembly::Assembly(QString d, QString s)
    : date(std::move(d)), start(std::move(s)) {
  dateOK(date);
  stamp(start);
}
bool Assembly::append(const QJsonObject &part, qint64 elapsed) {
  require(elapsed >= 0 && elapsed <= 45000, "扫描超过45秒；不保存半榜");
  auto c = part["coverage"].toObject();
  auto next = part["rows"].toArray();
  int count = c["totalReported"].toInt(-1);
  require(part["scope"] == "stock" && part["tradingDay"] == date &&
              part["source"].toObject() == darkStock::source() &&
              c["page"] == page + 1 && c["pageSize"] == 100 && count > 0 &&
              count <= 6000 && (total == -1 || total == count) &&
              next.size() == std::min(100, count - page * 100),
          "分页范围、来源或覆盖变化；不保存半榜");
  auto now = part["receivedAt"].toString();
  require(stamp(now) >= stamp(start) && stamp(now) - stamp(start) <= 45000 &&
              (at.isEmpty() || stamp(now) >= stamp(at)),
          "分页抓取时刻越界");
  for (auto v : next) {
    auto k = v.toObject()["key"].toString();
    require(!k.isEmpty(), "分页股票身份无效；非完整榜单");
    if (seen.contains(k))
      throw std::runtime_error(
          QString("分页股票重复（第%1页，%2）；非完整榜单，保留旧缓存")
              .arg(page + 1)
              .arg(k)
              .toUtf8()
              .constData());
    seen.insert(k);
  }
  for (auto r : next)
    rows.append(r);
  source = part["source"].toObject();
  total = count;
  page++;
  at = now;
  return rows.size() == total;
}
QJsonObject Assembly::finish() const {
  require(total > 0 && rows.size() == total && page == (total + 99) / 100,
          "尚未取得完整分页榜单");
  QJsonObject s{
      {"version", "webstock.eastmoney-dark-stocks/v1"},
      {"automaticTrading", false},
      {"scope", "stock"},
      {"tradingDay", date},
      {"source", source},
      {"receivedAt", at},
      {"scanStartedAt", start},
      {"refreshIntervalSeconds", 300},
      {"rows", rows},
      {"coverage", QJsonObject{{"receivedRows", rows.size()},
                               {"totalReported", total},
                               {"pages", page},
                               {"duplicateRows", 0},
                               {"complete", true},
                               {"paginationSnapshotConsistent", false}}}};
  validate(s);
  return s;
}
void validate(const QJsonObject &s) {
  dateOK(s["tradingDay"].toString());
  require(s["version"] == "webstock.eastmoney-dark-stocks/v1" &&
              s["scope"] == "stock" && s["automaticTrading"] == false &&
              s["source"].toObject() == source(),
          "个股缓存来源或类型不匹配");
  auto start = stamp(s["scanStartedAt"].toString()),
       end = stamp(s["receivedAt"].toString());
  require(end >= start && end - start <= 45000, "扫描时间越界");
  auto rows = s["rows"].toArray();
  auto c = s["coverage"].toObject();
  require(!rows.isEmpty() && rows.size() <= 6000 &&
              c["receivedRows"] == rows.size() &&
              c["totalReported"] == rows.size() && c["complete"] == true &&
              c["paginationSnapshotConsistent"] == false &&
              c["duplicateRows"] == 0 && c["pages"] == (rows.size() + 99) / 100,
          "个股缓存覆盖不完整");
  QSet<QString> keys;
  for (auto v : rows) {
    require(v.isObject(), "个股缓存行无效");
    auto r = v.toObject();
    int m = int(integer(r["providerMarket"], 2147483647));
    auto code = r["code"].toString(), k = key(m, code);
    auto rt = stamp(r["receivedAt"].toString());
    require(m != 90 &&
                QRegularExpression("^[0-9]{6}$").match(code).hasMatch() &&
                r["key"] == k && !keys.contains(k) &&
                !r["name"].toString().trimmed().isEmpty() &&
                r["name"].toString().size() <= 120 &&
                r["sourceObservedAt"].isNull() && rt >= start && rt <= end,
            "个股缓存身份或源时间无效");
    keys.insert(k);
    require(r["venue"] == (m == 1   ? QJsonValue("SH")
                           : m == 0 ? QJsonValue("SZ")
                                    : QJsonValue(QJsonValue::Null)),
            "个股缓存市场不匹配");
    for (auto f : {"darkNetCents", "visibleNetCents", "combinedNetCents"}) {
      require(r.contains(f), "个股缓存缺少金额字段");
      if (!r[f].isNull())
        exact(r[f]);
    }
    require(r["reconciled"] == reconciliation(r), "金额对账状态不符");
    for (auto f : {"price", "changeRatio", "darkActivityRatio"})
      numeric(r[f]);
  }
}
QJsonObject select(const QJsonObject &s, const QStringList &requested) {
  validate(s);
  require(requested.size() <= 200, "最多选择200只股票");
  QJsonArray out, missing;
  QMap<QString, QJsonObject> by;
  for (auto v : s["rows"].toArray())
    by.insert(v.toObject()["key"].toString(), v.toObject());
  QSet<QString> seen;
  for (auto k : requested) {
    require(QRegularExpression("^(sh6[0-9]{5}|sz[03][0-9]{5}|bj[489][0-9]{5})$")
                .match(k)
                .hasMatch(),
            "仅支持明确市场的沪深北股票，不以指数或ETF充当个股");
    if (seen.contains(k))
      continue;
    seen.insert(k);
    if (by.contains(k))
      out.append(by[k]);
    else
      missing.append(k);
  }
  auto view = s;
  view["rows"] = out;
  view["missing"] = missing;
  view["selectedCount"] = seen.size();
  return view;
}
Store::Store(QString dir) : directory(std::move(dir)) {}
QJsonObject Store::read(const QString &date) const {
  dateOK(date);
  auto s = readJson(directory + "/" + date + ".json");
  if (!s.isEmpty()) {
    validate(s);
    require(s["tradingDay"] == date, "不得借用另一日期缓存");
  }
  return s;
}
void Store::save(const QJsonObject &s,
                 const std::function<bool()> &cancelled) const {
  validate(s);
  writeJson(directory + "/" + s["tradingDay"].toString() + ".json", s,
            cancelled);
}
qint64 Store::retryAfter(qint64 now) const {
  auto s = readJson(directory + "/attempt.json");
  if (s.isEmpty())
    return 0;
  auto last = stamp(s["at"].toString());
  return std::max<qint64>(
      0,
      std::min<qint64>(s["failed"] == true ? 60000 : 300000,
                       (s["failed"] == true ? 60000 : 300000) - (now - last)));
}
void Store::attempt(qint64 now) const {
  writeJson(directory + "/attempt.json",
            {{"at", QDateTime::fromMSecsSinceEpoch(now, QTimeZone::UTC)
                        .toString(Qt::ISODateWithMs)},
             {"failed", false}});
}
void Store::failure(qint64 now) const {
  writeJson(directory + "/attempt.json",
            {{"at", QDateTime::fromMSecsSinceEpoch(now, QTimeZone::UTC)
                        .toString(Qt::ISODateWithMs)},
             {"failed", true}});
}
QJsonObject
Store::refresh(const QString &date, const std::function<bool()> &cancelled,
               const std::function<void(int, int)> &progress) const {
  dateOK(date);
  require(!cancelled || !cancelled(), "请求已取消");
  require(QDir().mkpath(directory), "无法建立个股专属缓存目录");
  QLockFile lock(directory + "/scan.lock");
  lock.setStaleLockTime(0);
  require(lock.tryLock(0), "共享扫描正在进行；请读缓存等待");
  auto now = QDateTime::currentMSecsSinceEpoch();
  auto wait = retryAfter(now);
  require(wait == 0, "共享扫描冷却中，成功后300秒/失败后60秒再试");
  attempt(now);
  try {
    auto result = fetch(date, cancelled, progress);
    save(result, cancelled);
    return result;
  } catch (...) {
    failure(QDateTime::currentMSecsSinceEpoch());
    throw;
  }
}
QJsonObject fetch(const QString &date, const std::function<bool()> &cancelled,
                  const std::function<void(int, int)> &progress) {
  auto check = [&] { require(!cancelled || !cancelled(), "请求已取消"); };
  check();
  QElapsedTimer elapsed;
  elapsed.start();
  Assembly scan(date,
                QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
  QNetworkAccessManager manager;
  for (int p = 1; p <= 60; p++) {
    check();
    require(elapsed.elapsed() < 45000, "扫描超过45秒；保留旧缓存");
    QNetworkRequest req{QUrl(url(date, p))};
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::ManualRedirectPolicy);
    req.setTransferTimeout(
        int(std::min<qint64>(10000, 45000 - elapsed.elapsed())));
    req.setRawHeader("Referer", "https://emrnweb.eastmoney.com/graymarket/");
    req.setRawHeader("rnProjectId", "emrn.GrayMarketRank");
    auto *reply = manager.get(req);
    QEventLoop loop;
    QTimer timer;
    timer.setInterval(25);
    QByteArray bytes;
    bool overflow = false;
    QObject::connect(reply, &QNetworkReply::readyRead, &loop, [&] {
      bytes += reply->readAll();
      if (bytes.size() > 2 * 1024 * 1024) {
        overflow = true;
        reply->abort();
      }
    });
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timer, &QTimer::timeout, &loop, [&] {
      if ((cancelled && cancelled()) || elapsed.elapsed() > 45000)
        reply->abort();
    });
    timer.start();
    loop.exec();
    timer.stop();
    bytes += reply->readAll();
    int status =
        reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    auto err = reply->error();
    delete reply;
    check();
    require(!overflow && bytes.size() <= 2 * 1024 * 1024 &&
                err == QNetworkReply::NoError && status == 200,
            "旧公开来源未返回有效结果，未改变TLS或代理，保留缓存");
    QJsonParseError error;
    auto doc = QJsonDocument::fromJson(bytes, &error);
    require(error.error == QJsonParseError::NoError && doc.isObject(),
            "旧来源不是有效JSON");
    auto part =
        normalize(doc.object(), date, p,
                  QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
    bool done = scan.append(part, elapsed.elapsed());
    if (progress)
      progress(p, part["coverage"].toObject()["totalReported"].toInt());
    if (done)
      return scan.finish();
    for (int i = 0; i < 10; i++) {
      check();
      QThread::msleep(25);
    }
  }
  throw std::runtime_error("超过60页，不保存半榜");
}
} // namespace darkStock
