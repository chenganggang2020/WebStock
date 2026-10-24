#include "market_data.hpp"

#include <QMap>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QSet>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QTimeZone>
#include <QUuid>
#include <cmath>
#include <stdexcept>
#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif
namespace marketdata {
namespace {
void require(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}
QJsonValue numeric(const QString& s, bool positive = false) {
  bool ok = false;
  double n = s.toDouble(&ok);
  return ok && std::isfinite(n) && (!positive || n > 0)
             ? QJsonValue(n)
             : QJsonValue(QJsonValue::Null);
}
QDateTime beijing(const QDateTime& now) {
  return now.toOffsetFromUtc(8 * 3600);
}
double epoch(const QDate& date, const QTime& time) {
  return QDateTime(date, time, QTimeZone::fromSecondsAheadOfUtc(8 * 3600))
      .toMSecsSinceEpoch();
}
}  // namespace
double value(const QJsonObject& o, const QString& key) {
  return o[key].isDouble() ? o[key].toDouble() : NAN;
}
QJsonArray capitalKinematics(const QJsonArray& rows) {
  QJsonArray out;
  QJsonObject previous;
  double previousSpeed = NAN;
  for (auto item : rows) {
    auto row = item.toObject();
    const double amount = value(row, "mainNet"),
                 before = value(previous, "mainNet");
    double speed = NAN, acceleration = NAN;
    auto now =
        QDateTime::fromMSecsSinceEpoch(qint64(row["time"].toDouble()), Qt::UTC)
            .toOffsetFromUtc(28800);
    auto prev = QDateTime::fromMSecsSinceEpoch(
                    qint64(previous["time"].toDouble()), Qt::UTC)
                    .toOffsetFromUtc(28800);
    if (row["time"].isDouble() && previous["time"].isDouble() && now > prev &&
        now.date() == prev.date() &&
        row["sourceKey"] == previous["sourceKey"] && std::isfinite(amount) &&
        std::isfinite(before)) {
      double minutes = prev.msecsTo(now) / 60000.;
      auto start = epoch(now.date(), QTime(11, 30)),
           end = epoch(now.date(), QTime(13, 0));
      minutes -=
          std::max(0., std::min(double(now.toMSecsSinceEpoch()), end) -
                           std::max(double(prev.toMSecsSinceEpoch()), start)) /
          60000.;
      if (minutes > 0) {
        speed = (amount - before) / minutes;
        if (std::isfinite(previousSpeed))
          acceleration = (speed - previousSpeed) / minutes;
      }
    }
    row["netFlowSpeed"] =
        std::isfinite(speed) ? QJsonValue(speed) : QJsonValue(QJsonValue::Null);
    row["netFlowAcceleration"] = std::isfinite(acceleration)
                                     ? QJsonValue(acceleration)
                                     : QJsonValue(QJsonValue::Null);
    QString code = "unknown", label = "变化未知";
    if (amount > 0 && speed > 0) {
      code = "sustained-inflow";
      label = "净流入扩大";
    }
    if (amount > 0 && speed < 0) {
      code = "inflow-giveback";
      label = "净流入回吐";
    }
    if (amount < 0 && speed > 0) {
      code = "outflow-narrowing";
      label = "净流出收窄";
    }
    if (amount < 0 && speed < 0) {
      code = "outflow-accelerating";
      label = "净流出扩大";
    }
    row["flowState"] = QJsonObject{{"code", code}, {"label", label}};
    out.append(row);
    previous = row;
    previousSpeed = speed;
  }
  return out;
}
QJsonObject legacyCapital(const QJsonObject& input, const QString& id,
                          const QDateTime& now) {
  auto source = input["source"].toObject();
  require(input["schema"] == "webstock.capital-flow.v1" &&
              input["availability"] == "available" &&
              input["scope"] == "stock" &&
              source["sourceClass"] == "vendor-classified" &&
              source["provider"] == "Eastmoney" &&
              input["metricContract"].toObject()["currency"] == "CNY",
          "旧资金文件契约不匹配：需要东方财富分类资金、股票、人民币");
  auto code = input["code"].toString();
  require(QRegularExpression("^[036][0-9]{5}$").match(code).hasMatch(),
          "旧资金仅支持已核验的沪深股票代码，未知市场不能猜测");
  auto exchange = code.startsWith('6') ? QString("SH") : QString("SZ");
  require(id == exchange + ":stock:" + code,
          "旧资金与所选市场、类型或代码不一致");
  auto points = input["points"].toArray();
  require(!points.isEmpty() && points.size() <= 10000, "旧资金点数无效");
  QJsonArray rows;
  QDateTime previous;
  QDate date;
  for (auto p : points) {
    auto point = p.toObject();
    auto t = QDateTime::fromString(point["timestamp"].toString(), Qt::ISODate);
    auto d = beijing(t).date();
    require(t.isValid() && t <= now && (!previous.isValid() || t > previous) &&
                (!date.isValid() || date == d) &&
                std::isfinite(value(point, "netAmount")),
            "旧资金时间顺序、交易日或金额无效");
    require(point["sourceKey"] == "vendor-classified:Eastmoney",
            "旧资金点来源不一致");
    QJsonObject row{{"time", double(t.toMSecsSinceEpoch())},
                    {"label", beijing(t).toString("yyyy-MM-dd HH:mm:ss")},
                    {"mainNet", point["netAmount"]},
                    {"valid", true},
                    {"sourceKey", point["sourceKey"]}};
    auto buckets = point["buckets"].toObject();
    const QStringList oldKeys{"smallNetAmount", "mediumNetAmount",
                              "largeNetAmount", "superLargeNetAmount"};
    const QStringList newKeys{"smallNet", "mediumNet", "largeNet", "superNet"};
    for (int i = 0; i < oldKeys.size(); ++i) {
      auto n = value(buckets, oldKeys[i]);
      row[newKeys[i]] =
          std::isfinite(n) ? QJsonValue(n) : QJsonValue(QJsonValue::Null);
    }
    rows.append(row);
    previous = t;
    date = d;
  }
  auto observed = QDateTime::fromString(
      input["observation"].toObject()["observedAt"].toString(), Qt::ISODate);
  require(observed.isValid() && observed == previous,
          "旧资金观察时间与最后记录不一致");
  return {{"rows", capitalKinematics(rows)},
          {"rawLegacy", input},
          {"source", "东方财富公开分类资金 · 旧程序档案"},
          {"timeUnit", "milliseconds"},
          {"amountUnit", "CNY"},
          {"intraday", true},
          {"adjustment", "none"},
          {"dataDate", date.toString(Qt::ISODate)},
          {"asOf", previous.toUTC().toString(Qt::ISODateWithMs)},
          {"checkedAt", now.toUTC().toString(Qt::ISODateWithMs)},
          {"cached", true},
          {"imported", true},
          {"coverageNote",
           "供应商分类累计净额，非机构账户真实流向；缺口不补造。变化率按交易分"
           "钟计算。"}};
}
QString decodeQuote(const QByteArray& bytes) {
#ifdef Q_OS_WIN
  int size =
      MultiByteToWideChar(936, 0, bytes.constData(), bytes.size(), nullptr, 0);
  std::wstring wide(size, 0);
  MultiByteToWideChar(936, 0, bytes.constData(), bytes.size(), wide.data(),
                      size);
  return QString::fromStdWString(wide);
#else
  return QString::fromLocal8Bit(bytes);
#endif
}
QJsonArray roster(const QJsonObject& root) {
  require(root["schema"].toString() == "native-watchlist/v1",
          "自选文件格式无效");
  auto rows = root["instruments"].toArray();
  require(!rows.isEmpty() && rows.size() <= 3000, "自选清单为空或超过3000只");
  QJsonArray out;
  QSet<QString> seen;
  QRegularExpression idPattern("^(SH|SZ|BJ):(stock|index|etf):[0-9]{6}$");
  for (auto row : rows) {
    auto input = row.toObject();
    auto id = input["id"].toString();
    QJsonObject s;
    for (auto key : {"id", "symbol", "name", "group", "order"})
      s[key] = input[key];
    require(idPattern.match(id).hasMatch(), "证券身份必须包含市场、类型和代码");
    QString symbol = id.section(':', 0, 0).toLower() + id.section(':', 2);
    require(s["symbol"].toString() == symbol && !seen.contains(id),
            "自选代码冲突或重复");
    require(!s["name"].toString().trimmed().isEmpty() &&
                s["name"].toString().size() <= 128,
            "自选名称无效");
    seen.insert(id);
    if (s["group"].toString().isEmpty()) s["group"] = "默认分组";
    s["market"] = id.section(':', 0, 0) + " · " +
                  (id.contains(":index:") ? "指数"
                   : id.contains(":etf:") ? "ETF"
                                          : "股票");
    for (auto p : {"day", "week", "minute"}) s[p] = QJsonArray{};
    s["quote"] = QJsonObject{};
    out.append(s);
  }
  return out;
}
QJsonArray readDatabase(const QString& path) {
  QString connection = QUuid::createUuid().toString();
  QJsonArray out;
  QString error;
  {
    auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
    db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=5000");
    db.setDatabaseName(path);
    if (!db.open())
      error = "原数据库无法只读打开";
    else {
      QSqlQuery q(db);
      if (!q.exec("SELECT code,name,group_name,sort_order FROM watchlist ORDER "
                  "BY sort_order,id"))
        error = "原数据库缺少自选表";
      while (error.isEmpty() && q.next()) {
        QString code = q.value(0).toString().trimmed().toLower(),
                name = q.value(1).toString();
        QString exchange;
        if (code.startsWith("sh") || code.startsWith("sz") ||
            code.startsWith("bj")) {
          exchange = code.left(2);
          code = code.mid(2);
        } else
          exchange = code.startsWith("92") || code.startsWith('4') ||
                             code.startsWith('8')
                         ? "bj"
                     : code.startsWith('5') || code.startsWith('6') ||
                             code.startsWith('9')
                         ? "sh"
                         : "sz";
        // Bare 000001 is the bank, never the Shanghai index. Explicit SH
        // remains distinct.
        QString type = exchange == "sh" && code.startsWith("000") ||
                               exchange == "sz" && code.startsWith("399")
                           ? "index"
                       : code.startsWith("51") || code.startsWith("50") ||
                               code.startsWith("15") || code.startsWith("16") ||
                               code.startsWith("58") || code.startsWith("56")
                           ? "etf"
                           : "stock";
        out.append(
            QJsonObject{{"id", exchange.toUpper() + ":" + type + ":" + code},
                        {"symbol", exchange + code},
                        {"name", name},
                        {"group", q.value(2).toString()},
                        {"order", q.value(3).toInt()}});
      }
      db.close();
    }
  }
  QSqlDatabase::removeDatabase(connection);
  require(error.isEmpty(), error.toUtf8().constData());
  return roster(
      QJsonObject{{"schema", "native-watchlist/v1"}, {"instruments", out}});
}
QJsonObject quotes(const QString& text, const QString& checkedAt) {
  QJsonObject out;
  auto matches =
      QRegularExpression("hq_str_((?:sh|sz|bj)[0-9]{6})=\"([^\"]*)\"")
          .globalMatch(text);
  while (matches.hasNext()) {
    auto m = matches.next();
    auto f = m.captured(2).split(',');
    if (f.size() < 32 || numeric(f[3], true).isNull()) continue;
    const auto date = QDate::fromString(f[30], Qt::ISODate);
    const auto time = QTime::fromString(f[31], "HH:mm:ss");
    if (!date.isValid() || !time.isValid()) continue;
    QJsonObject q{{"name", f[0]},
                  {"price", numeric(f[3], true)},
                  {"previousClose", numeric(f[2], true)},
                  {"open", numeric(f[1], true)},
                  {"high", numeric(f[4], true)},
                  {"low", numeric(f[5], true)},
                  {"volume", numeric(f[8])},
                  {"amount", numeric(f[9])},
                  {"tradeDate", f[30]},
                  {"tradeTime", f[31]},
                  {"source", "新浪公开报价"},
                  {"checkedAt", checkedAt},
                  {"cached", false}};
    double prev = value(q, "previousClose");
    q["changePercent"] = std::isfinite(prev)
                             ? QJsonValue((value(q, "price") / prev - 1) * 100)
                             : QJsonValue(QJsonValue::Null);
    QJsonArray bids, asks;
    for (int i = 0; i < 5; ++i) {
      bids.append(QJsonObject{{"price", numeric(f[11 + i * 2], true)},
                              {"volume", numeric(f[10 + i * 2])}});
      asks.append(QJsonObject{{"price", numeric(f[21 + i * 2], true)},
                              {"volume", numeric(f[20 + i * 2])}});
    }
    q["bids"] = bids;
    q["asks"] = asks;
    out[m.captured(1)] = q;
  }
  return out;
}
QJsonObject kline(const QJsonObject& raw, const QString& symbol,
                  const QString& p, const QDateTime& now) {
  require(
      raw["code"].toInt(-1) == 0 && (p == "day" || p == "week" || p == "month"),
      "K线服务返回错误");
  auto data = raw["data"].toObject()[symbol].toObject();
  QString key = data.contains("qfq" + p) ? "qfq" + p : p;
  auto input = data[key].toArray();
  require(!input.isEmpty() && input.size() <= 2000, "未返回有效K线");
  QJsonArray rows;
  QDate previous;
  auto local = beijing(now);
  for (auto item : input) {
    auto a = item.toArray();
    require(a.size() >= 6, "K线字段不完整");
    QDate date = QDate::fromString(a[0].toString(), Qt::ISODate);
    require(date.isValid() && (!previous.isValid() || date > previous) &&
                date <= local.date(),
            "K线日期异常");
    bool parsed[4]{};
    double o = a[1].toString().toDouble(&parsed[0]),
           c = a[2].toString().toDouble(&parsed[1]),
           h = a[3].toString().toDouble(&parsed[2]),
           l = a[4].toString().toDouble(&parsed[3]);
    auto volume = numeric(a[5].toString());
    // Forward-adjusted historical prices are not raw transaction prices.
    // Keep the provider's values; authorization comes only from the qfq key.
    require(parsed[0] && parsed[1] && parsed[2] && parsed[3] &&
                std::isfinite(l) && std::isfinite(h) && std::isfinite(o) &&
                std::isfinite(c) && (key.startsWith("qfq") || l > 0) &&
                h >= l && o >= l && o <= h &&
                c >= l && c <= h && !volume.isNull() && volume.toDouble() >= 0,
            "K线价格或成交量无效");
    bool closed = date < local.date() || local.time() >= QTime(15, 1);
    if (p == "week") {
      auto monday = local.date().addDays(1 - local.date().dayOfWeek());
      closed = date < monday || local.date().dayOfWeek() > 5 ||
               (local.date().dayOfWeek() == 5 && local.time() >= QTime(15, 1));
    }
    if (p == "month")
      closed = date.year() < local.date().year() ||
               date.year() == local.date().year() &&
                   date.month() < local.date().month();
    const QDate bucket = p == "month"  ? QDate(date.year(), date.month(), 1)
                         : p == "week" ? date.addDays(1 - date.dayOfWeek())
                                       : date;
    rows.append(QJsonObject{
        {"time", epoch(bucket, p == "day" ? QTime(15, 0) : QTime(0, 0))},
        {"sourceEndTime", epoch(date, QTime(15, 0))},
        {"label", date.toString(Qt::ISODate)},
        {"open", o},
        {"close", c},
        {"high", h},
        {"low", l},
        {"volume", volume},
        {"valid", true},
        {"closed", closed}});
    previous = date;
  }
  return {{"rows", rows},
          {"timeUnit", "milliseconds"},
          {"periodKeyVersion", p == "day" ? "" : "calendar-v1"},
          {"source", "腾讯公开K线"},
          {"adjustment", key.startsWith("qfq") ? "qfq" : "none"},
          {"volumeUnit", "手"},
          {"dataDate", previous.toString(Qt::ISODate)},
          {"checkedAt", now.toUTC().toString(Qt::ISODate)},
          {"cached", false}};
}
QJsonObject aggregateCalendar(const QJsonObject& input, const QString& p,
                              const QDateTime& now) {
  require(p == "month" || p == "year", "不支持的汇总周期");
  const auto today = beijing(now).date();
  QJsonArray out;
  QString lastKey;
  QDate previous;
  for (auto item : input["rows"].toArray()) {
    auto b = item.toObject();
    QDate date = QDate::fromString(b["label"].toString().left(10), Qt::ISODate);
    require(date.isValid() && (!previous.isValid() || date > previous) &&
                date <= today,
            "周期汇总日期无效");
    require(b["valid"].toBool() && std::isfinite(value(b, "open")) &&
                std::isfinite(value(b, "high")) &&
                std::isfinite(value(b, "low")) &&
                std::isfinite(value(b, "close")) &&
                std::isfinite(value(b, "volume")),
            "缺失数据不能汇总成完整K线");
    QString key = date.toString(p == "year" ? "yyyy" : "yyyy-MM");
    bool done = p == "year" ? date.year() < today.year()
                            : date.year() < today.year() ||
                                  date.year() == today.year() &&
                                      date.month() < today.month();
    b["closed"] = done;
    b["bucket"] = key;
    b["sourceEndTime"] =
        b.contains("sourceEndTime") ? b["sourceEndTime"] : b["time"];
    b["time"] = epoch(QDate(date.year(), p == "year" ? 1 : date.month(), 1),
                      QTime(0, 0));
    if (key != lastKey) {
      out.append(b);
    } else {
      auto merged = out.last().toObject();
      merged["high"] = std::max(value(merged, "high"), value(b, "high"));
      merged["low"] = std::min(value(merged, "low"), value(b, "low"));
      merged["close"] = b["close"];
      merged["volume"] = value(merged, "volume") + value(b, "volume");
      merged["sourceEndTime"] = b["sourceEndTime"];
      merged["label"] = b["label"];
      merged["closed"] = done;
      out[out.size() - 1] = merged;
    }
    lastKey = key;
    previous = date;
  }
  require(!out.isEmpty(), "没有可汇总数据");
  auto result = input;
  result["rows"] = out;
  result["periodKeyVersion"] = "calendar-v1";
  result["aggregatedFrom"] = p == "year" ? "month" : "day";
  result["source"] = input["source"].toString() +
                     (p == "year" ? " · 月线汇总年K" : " · 日线汇总月K");
  result["coverageNote"] = "首个周期仅含来源提供的历史，不补造上市前或缺失数据";
  return result;
}
QJsonObject capitalDayResponse(const QByteArray& bytes) {
  require(!bytes.isEmpty() && bytes.size() <= 2 * 1024 * 1024 &&
              QString::fromUtf8(bytes).toUtf8() == bytes,
          "资金日线响应为空、超限或非UTF-8");
  auto payload = bytes.trimmed();
  if (!payload.startsWith('{')) {
    const QByteArray prefix("NativeCapitalDay(");
    require(payload.startsWith(prefix) &&
                (payload.endsWith(");") || payload.endsWith(')')),
            "资金日线不是约定的公开JSONP响应");
    const int suffix = payload.endsWith(");") ? 2 : 1;
    payload = payload.mid(prefix.size(), payload.size() - prefix.size() - suffix);
  }
  QJsonParseError error;
  const auto document = QJsonDocument::fromJson(payload, &error);
  require(error.error == QJsonParseError::NoError && document.isObject(),
          "资金日线JSON无效，未执行脚本");
  return document.object();
}
QJsonObject capital(const QJsonObject& raw, const QString& symbol,
                    const QString& mode, const QDateTime& now) {
  if (mode == "snapshot") {
    auto diff=raw["data"].toObject()["diff"].toArray();
    require(raw["rc"].toInt(-1)==0 && diff.size()==1 && QRegularExpression("^(sh|sz)[0-9]{6}$").match(symbol).hasMatch(), "资金快照响应或请求身份无效");
    auto r=diff[0].toObject();
    require(r["f12"].toString()==symbol.mid(2) && (!r.contains("f13") || r["f13"].toInt(-1)==(symbol.startsWith("sh")?1:0)),"资金快照证券身份不匹配");
    QJsonObject snap;
    QStringList fields{"f62","f66","f72","f78","f84"},names{"mainNet","superNet","largeNet","mediumNet","smallNet"};
    for(int i=0;i<5;++i) snap[names[i]]=std::isfinite(value(r,fields[i]))?QJsonValue(value(r,fields[i])):QJsonValue(QJsonValue::Null);
    require(snap["mainNet"].isDouble(),"资金快照主力净额缺失");
    return {{"snapshot",snap},{"rows",QJsonArray()},{"source","东方财富公开分类资金快照"},
      {"metric","vendor-classified-net"},{"mode",mode},{"amountUnit","CNY"},{"timeUnit","milliseconds"},
      {"sourceObservedAt",QJsonValue(QJsonValue::Null)},{"timeMeaning","unknown-source-clock"},
      {"checkedAt",now.toUTC().toString(Qt::ISODate)},{"identityMarketVerified",r.contains("f13")},
      {"rawResponse",raw},{"cached",false},{"adjustment","none"},
      {"definition","单标的分类净额快照；源资金时刻未知，抓取时刻不等于数据时刻；不作为分时序列"}};
  }
  require(raw["rc"].toInt(-1) == 0 && (mode == "day" || mode == "minute"),
          "资金服务返回错误");
  auto data = raw["data"].toObject();
  require(QRegularExpression("^(sh|sz)[0-9]{6}$").match(symbol).hasMatch() &&
              data["code"].toString() == symbol.mid(2) &&
              data["market"].toInt(-1) == (symbol.startsWith("sh") ? 1 : 0) &&
              !symbol.startsWith("bj"),
          "资金证券身份不匹配");
  QJsonArray out, pending;
  qint64 previous = 0;
  const auto lines = data["klines"].toArray();
  for (int at = 0; at < lines.size(); ++at) {
    auto v = lines[at];
    auto fields = v.toString().split(',');
    require(fields.size() >= 6, "资金字段不完整");
    QDateTime t = mode == "day"
                      ? QDateTime(QDate::fromString(fields[0], Qt::ISODate),
                                  QTime(0, 0), QTimeZone("Asia/Shanghai"))
                      : QDateTime::fromString(fields[0], "yyyy-MM-dd HH:mm");
    if (mode == "minute") t.setTimeZone(QTimeZone("Asia/Shanghai"));
    require(t.isValid() && t.toMSecsSinceEpoch() > previous,
            "资金日期异常");
    QJsonObject row{
        {"time", double(t.toMSecsSinceEpoch())},
        {"label", fields[0]},
        {"valid", true},
        {"closed", mode == "minute" || t.date() < beijing(now).date() ||
                       beijing(now).time() >= QTime(15, 1)}};
    const QStringList names{"mainNet", "smallNet", "mediumNet", "largeNet",
                            "superNet"};
    for (int i = 0; i < 5; ++i) {
      auto value = numeric(fields[i + 1]);
      require(i != 0 || !value.isNull(), "资金主净额缺失");
      row[names[i]] = value;
    }
    if (t > now) {
      const auto local = beijing(now);
      const auto nextMinute = QDateTime(local.date(),
          QTime(local.time().hour(), local.time().minute()),
          QTimeZone::fromSecondsAheadOfUtc(8 * 3600)).addSecs(60);
      bool activePeriod = false;
      for (auto interval : data["tradePeriods"].toObject()["periods"].toArray()) {
        const auto period = interval.toObject();
        auto point = [](QJsonValue value) {
          if (!value.isDouble() || value.toDouble() != double(value.toVariant().toLongLong()))
            return QDateTime{};
          auto parsed = QDateTime::fromString(QString::number(value.toVariant().toLongLong()),
                                              "yyyyMMddHHmm");
          parsed.setTimeZone(QTimeZone::fromSecondsAheadOfUtc(8 * 3600));
          return parsed;
        };
        auto begin = point(period["b"]), end = point(period["e"]);
        activePeriod |= begin.isValid() && end.isValid() && begin.date() == local.date() &&
            end.date() == local.date() && begin <= local && local < end && begin < t && t <= end;
      }
      require(mode == "minute" && at == lines.size() - 1 && !out.isEmpty() &&
                  pending.isEmpty() && t == nextMinute && activePeriod,
              "资金日期异常");
      row["valid"] = false;
      row["closed"] = false;
      row["rawRow"] = v;
      row["pendingReason"] = "source-time-after-check";
      pending.append(row);
    } else {
      out.append(row);
    }
    previous = t.toMSecsSinceEpoch();
  }
  require(!out.isEmpty() && out.size() <= 5000, "没有有效资金数据");
  return {{"rows", out},
          {"pendingRows", pending},
          {"warning", pending.isEmpty() ? QString{} :
              "来源末行时点晚于本次检查；原行保留待核，未用于资金序列或变化计算。"},
          {"availability", pending.isEmpty() ? "available" : "partial"},
          {"source", "东方财富公开分类净额"},
          {"timeUnit", "milliseconds"},
          {"amountUnit", "CNY"},
          {"metric", "vendor-classified-net"},
          {"mode", mode},
          {"intraday", mode == "minute"},
          {"periodKeyVersion", mode == "day" ? "capital-day-v1" : ""},
          {"timeMeaning", mode == "day" ? "date-key" : "source-minute"},
          {"rawResponse", raw},
          {"adjustment", "none"},
          {"checkedAt", now.toUTC().toString(Qt::ISODate)},
          {"asOf", mode == "minute" ? QJsonValue(QDateTime::fromMSecsSinceEpoch(
                                                     qint64(out.last().toObject()["time"].toDouble()),
                                                     QTimeZone::UTC)
                                                     .toString(Qt::ISODate))
                                    : QJsonValue(QJsonValue::Undefined)},
          {"dataDate", out.last().toObject()["label"].toString().left(10)},
          {"cached", false},
          {"definition",
           mode == "day"
               ? "每日分类净额；非总买入/总卖出，不作机构账户认定"
               : "盘中来源分类净额序列；非总买入/总卖出，不作机构账户认定"}};
}
QJsonObject auction(const QJsonObject& input, const QString& id,
                    const QDateTime& now) {
  auto meta = input["meta"].toObject();
  require(meta["instrumentId"].toString() == id &&
              meta["code"].toString() == id.section(':', 2) &&
              meta["auctionFieldContractVerified"].toBool() &&
              meta["auctionTimestampMeaning"] == "source-event" &&
              meta["volumeUnit"] == "shares" && meta["priceUnit"] == "CNY" &&
              !meta["sourceId"].toString().isEmpty(),
          "竞价字段契约或证券身份未核验；普通价格和盘口不能代替虚拟竞价数据");
  QString phase = input["phase"].toString();
  require(phase == "opening" || phase == "closing", "竞价阶段无效");
  QTime start = phase == "opening" ? QTime(9, 15) : QTime(14, 57),
        end = phase == "opening" ? QTime(9, 25) : QTime(15, 0);
  auto date = QDate::fromString(input["date"].toString(), Qt::ISODate);
  auto asOf = QDateTime::fromString(input["asOf"].toString(), Qt::ISODate);
  require(date.isValid() && asOf.isValid() && asOf <= now,
          "竞价观察时点无效或位于未来");
  auto inputRows = input["rows"].toArray();
  require(!inputRows.isEmpty() && inputRows.size() <= 2000,
          "竞价过程为空或过大");
  QMap<qint64, QJsonObject> ordered;
  double baseline = value(input, "baseline");
  auto baselineAt = QDateTime::fromString(
      input["baselineAvailableAt"].toString(), Qt::ISODate);
  bool baselineReady = std::isfinite(baseline) && baseline > 0 &&
                       baselineAt.isValid() && baselineAt <= asOf;
  if (phase == "closing") {
    auto event = QDateTime::fromString(input["baselineEventTime"].toString(),
                                       Qt::ISODate);
    auto localEvent = beijing(event);
    baselineReady = baselineReady && event.isValid() && event <= baselineAt &&
                    localEvent.date() == date &&
                    localEvent.time() >= QTime(14, 56) &&
                    localEvent.time() < QTime(14, 57);
  }
  for (auto v : inputRows) {
    auto r = v.toObject();
    auto t = QDateTime::fromString(r["time"].toString(), Qt::ISODate),
         available =
             QDateTime::fromString(r["availableAt"].toString(), Qt::ISODate);
    auto local = beijing(t);
    require(t.isValid() && available.isValid() && available >= t && t <= asOf &&
                available <= asOf && local.date() == date &&
                local.time() >= start && local.time() <= end &&
                !r["formalMatch"].toBool(),
            "竞价行时间、实际可用时间或阶段无效");
    double price = value(r, "auctionReferencePrice"),
           q = value(r, "auctionMatchedVolume"),
           buy = value(r, "auctionUnmatchedBuyVolume"),
           sell = value(r, "auctionUnmatchedSellVolume");
    require(std::isfinite(price) && price > 0 && std::isfinite(q) && q >= 0 &&
                std::floor(q) == q && q <= 9007199254740991. &&
                std::isfinite(buy) && buy >= 0 && std::floor(buy) == buy &&
                buy <= 9007199254740991. && std::isfinite(sell) && sell >= 0 &&
                std::floor(sell) == sell && sell <= 9007199254740991. &&
                std::isfinite(price * q),
            "竞价虚拟参考价或股数量字段不完整");
    double denominator = 2 * q + buy + sell;
    if (ordered.contains(t.toMSecsSinceEpoch())) {
      const auto previous = ordered.value(t.toMSecsSinceEpoch());
      const auto revisionAt = QDateTime::fromString(
          previous["availableAt"].toString(), Qt::ISODate);
      if (available < revisionAt) continue;
      if (available == revisionAt)
        require(previous["price"].toDouble() == price &&
                    previous["matchedVolume"].toDouble() == q &&
                    previous["unmatchedBuy"].toDouble() == buy &&
                    previous["unmatchedSell"].toDouble() == sell,
                "同一竞价事件同一可用时间存在冲突修订，拒绝按文件顺序猜测");
    }
    ordered[t.toMSecsSinceEpoch()] = QJsonObject{
        {"time", double(t.toMSecsSinceEpoch())},
        {"label", local.toString("yyyy-MM-dd HH:mm:ss")},
        {"availableAt", available.toUTC().toString(Qt::ISODateWithMs)},
        {"price", price},
        {"matchedVolume", q},
        {"matchedAmount", price * q},
        {"unmatchedBuy", buy},
        {"unmatchedSell", sell},
        {"imbalance", denominator > 0 ? QJsonValue((buy - sell) / denominator)
                                      : QJsonValue(QJsonValue::Null)},
        {"changePercent", baselineReady && baselineAt <= available
                              ? QJsonValue((price / baseline - 1) * 100)
                              : QJsonValue(QJsonValue::Null)},
        {"valid", true},
        {"closed", true}};
  }
  QJsonArray rows;
  for (auto r : ordered) rows.append(r);
  return {
      {"rows", rows},
      {"phase", phase},
      {"source", meta["sourceId"]},
      {"dataDate", date.toString(Qt::ISODate)},
      {"timeUnit", "milliseconds"},
      {"adjustment", "none"},
      {"intraday", true},
      {"checkedAt", now.toUTC().toString(Qt::ISODateWithMs)},
      {"asOf", input["asOf"]},
      {"baselineStatus",
       baselineReady ? "available" : "missing-or-unavailable-at-observation"},
      {"patternStatus", "insufficient-data"},
      {"reason",
       "已展示核验过程字段与原始派生指标。旧版八形态的覆盖/"
       "历史检验尚待原生迁移，当前不输出形态或买卖结论。"},
      {"rawInput", input},
      {"cached", false}};
}
QJsonObject auctionQuotes(const QJsonArray& input, const QString& phase,
                          const QDateTime& now) {
  require((phase == "opening" || phase == "closing") && !input.isEmpty() &&
              input.size() <= 2000,
          "竞价报价观察阶段或数量无效");
  const auto date = input.first().toObject()["tradeDate"].toString();
  const QTime start = phase == "opening" ? QTime(9, 15) : QTime(14, 57),
              end = phase == "opening" ? QTime(9, 25) : QTime(15, 0);
  QMap<qint64, QJsonObject> points;
  for (auto v : input) {
    auto q = v.toObject();
    const auto clock = QTime::fromString(q["tradeTime"].toString(), "HH:mm:ss");
    const QDateTime t(QDate::fromString(date, Qt::ISODate), clock,
                      QTimeZone::fromSecondsAheadOfUtc(8 * 3600));
    auto available =
        QDateTime::fromString(q["checkedAt"].toString(), Qt::ISODate);
    require(
        t.isValid() && clock >= start && clock <= end &&
            q["tradeDate"] == date && available.isValid() && available >= t &&
            available <= now &&
            available.toMSecsSinceEpoch() - t.toMSecsSinceEpoch() <= 30000 &&
            q["source"] == "新浪公开报价" && std::isfinite(value(q, "price")) &&
            value(q, "price") > 0,
        "源日期、时间、时段或实际报价无效；不把盘前旧收盘价当新竞价观察");
    points[t.toMSecsSinceEpoch()] = {
        {"time", double(t.toMSecsSinceEpoch())},
        {"availableAt", available.toUTC().toString(Qt::ISODateWithMs)},
        {"label", date + " " + clock.toString("HH:mm:ss")},
        {"price", q["price"]},
        {"changePercent", q["changePercent"]},
        {"matchedAmount", QJsonValue::Null},
        {"unmatchedBuy", QJsonValue::Null},
        {"unmatchedSell", QJsonValue::Null},
        {"imbalance", QJsonValue::Null},
        {"valid", true},
        {"closed", true}};
  }
  QJsonArray rows;
  for (auto r : points) rows.append(r);
  return {{"rows", rows},
          {"observations", input},
          {"phase", phase},
          {"dataDate", date},
          {"source", "新浪公开报价 · 竞价时段本机观察"},
          {"timeUnit", "milliseconds"},
          {"intraday", true},
          {"adjustment", "none"},
          {"asOf", now.toUTC().toString(Qt::ISODateWithMs)},
          {"checkedAt", now.toUTC().toString(Qt::ISODateWithMs)},
          {"auctionFieldContractVerified", false},
          {"reason",
           "仅记录实际返回的普通报价；不是虚拟参考价、匹配或未匹配量，不判定八"
           "形态。"},
          {"cached", false}};
}
QJsonObject sampleBars(const QJsonArray& input, int seconds,
                       const QDateTime& now) {
  require((seconds == 5 || seconds == 30) && !input.isEmpty() &&
              input.size() <= 12000,
          "秒级样本或周期无效");
  auto date = QDate::fromString(
      input.first().toObject()["tradeDate"].toString(), Qt::ISODate);
  require(date.isValid(), "样本日期无效");
  QMap<qint64, QJsonObject> observations, buckets;
  for (auto item : input) {
    auto q = item.toObject();
    auto time = QTime::fromString(q["tradeTime"].toString(), "HH:mm:ss");
    require(q["tradeDate"].toString() == date.toString(Qt::ISODate) &&
                time.isValid(),
            "秒级样本不能跨交易日或使用接收时间代替源时间");
    qint64 t = epoch(date, time);
    double price = value(q, "price");
    require(t <= now.toMSecsSinceEpoch() && std::isfinite(price) && price > 0,
            "秒级样本价格或时间无效");
    if ((time < QTime(9, 30) || time > QTime(15, 0)) ||
        (time > QTime(11, 30) && time < QTime(13, 0)))
      continue;
    observations[t] = q;
  }
  QJsonObject prior;
  qint64 previous = 0;
  for (auto i = observations.cbegin(); i != observations.cend(); ++i) {
    auto q = i.value();
    qint64 t = i.key(), at = t - t % (seconds * 1000);
    auto b = buckets.value(at);
    double price = value(q, "price");
    if (b.isEmpty())
      b = QJsonObject{
          {"time", double(at)},
          {"label", beijing(QDateTime::fromMSecsSinceEpoch(at, Qt::UTC))
                        .toString("yyyy-MM-dd HH:mm:ss")},
          {"open", price},
          {"high", price},
          {"low", price},
          {"close", price},
          {"volume", QJsonValue::Null},
          {"valid", true},
          {"closed", at + seconds * 1000 <= now.toMSecsSinceEpoch()},
          {"sampleCount", 0}};
    b["high"] = std::max(value(b, "high"), price);
    b["low"] = std::min(value(b, "low"), price);
    b["close"] = price;
    b["sampleCount"] = b["sampleCount"].toInt() + 1;
    // Counter differences across gaps or lunch do not belong to one short bar.
    double delta = value(q, "volume") - value(prior, "volume");
    if (previous && t - previous <= seconds * 1000 && std::isfinite(delta) &&
        delta >= 0 && value(q, "volume") >= 0 && value(prior, "volume") >= 0)
      b["volume"] =
          (std::isfinite(value(b, "volume")) ? value(b, "volume") : 0) + delta;
    buckets[at] = b;
    prior = q;
    previous = t;
  }
  require(!buckets.isEmpty(), "没有常规交易时段的真实秒级样本");
  QJsonArray rows, ordered;
  for (auto q : observations) ordered.append(q);
  for (auto start : {QTime(9, 30), QTime(13, 0)})
    for (int n = 0; n <= 7200; n += seconds) {
      auto at = qint64(epoch(date, start)) + n * 1000;
      auto b = buckets.value(at);
      if (b.isEmpty())
        b = QJsonObject{
            {"time", double(at)},
            {"label", beijing(QDateTime::fromMSecsSinceEpoch(at, Qt::UTC))
                          .toString("yyyy-MM-dd HH:mm:ss")},
            {"open", QJsonValue::Null},
            {"high", QJsonValue::Null},
            {"low", QJsonValue::Null},
            {"close", QJsonValue::Null},
            {"volume", QJsonValue::Null},
            {"valid", false},
            {"closed", at + seconds * 1000 <= now.toMSecsSinceEpoch()}};
      rows.append(b);
    }
  return {{"rows", rows},
          {"observations", ordered},
          {"source", "新浪公开报价 · 本机5秒轮询快照"},
          {"resolutionSeconds", seconds},
          {"previousClose", prior["previousClose"]},
          {"dataDate", date.toString(Qt::ISODate)},
          {"checkedAt", now.toUTC().toString(Qt::ISODateWithMs)},
          {"timeUnit", "milliseconds"},
          {"adjustment", "none"},
          {"intraday", true},
          {"volumeUnit", "shares"},
          {"cached", false},
          {"definition",
           "源时间快照采样，非交易所逐笔；OHLC是已观测报价范围，不是全成交范围"
           "；空档不补价。"}};
}
QJsonObject minute(const QJsonObject& raw, const QString& symbol,
                   const QDateTime& now) {
  require(raw["code"].toInt(-1) == 0, "分时服务返回错误");
  auto container = raw["data"].toObject()[symbol].toObject();
  auto data = container["data"].toObject();
  QDate date = QDate::fromString(data["date"].toString(), "yyyyMMdd");
  require(date.isValid() && date <= beijing(now).date(), "分时日期无效");
  QMap<int, QJsonObject> points;
  int previous = -1, offSession = 0;
  double previousVolume = NAN, previousAmount = NAN;
  for (auto item : data["data"].toArray()) {
    auto f =
        item.toString().split(QRegularExpression("\\s+"), Qt::SkipEmptyParts);
    if (f.size() < 3 || f[0].size() != 4) continue;
    QTime time = QTime::fromString(f[0], "HHmm");
    int m = time.hour() * 60 + time.minute();
    require(time.isValid(), "分时时间无效");
    if (!((m >= 570 && m <= 690) || (m >= 780 && m <= 900))) {
      ++offSession;
      continue;
    }
    auto price = numeric(f[1], true), cumulative = numeric(f[2]);
    require(m > previous && !price.isNull() && !cumulative.isNull() &&
                cumulative.toDouble() >= 0,
            "分时序列无效");
    bool contiguous = m == previous + 1 || previous == 690 && m == 780;
    QJsonValue volume(QJsonValue::Null);
    if (previous == -1 && m == 570)
      volume = cumulative;
    else if (contiguous && cumulative.toDouble() >= previousVolume)
      volume = cumulative.toDouble() - previousVolume;
    // Fourth column is cumulative CNY under the existing publicMinuteService contract.
    auto cumulativeAmount = f.size() > 3 ? numeric(f[3]) : QJsonValue(QJsonValue::Null);
    if (!cumulativeAmount.isNull() && cumulativeAmount.toDouble() < 0)
      cumulativeAmount = QJsonValue(QJsonValue::Null);
    bool future = epoch(date, time) > now.toMSecsSinceEpoch();
    QJsonValue amount(QJsonValue::Null);
    QString amountStatus;
    if (future) amountStatus = "future-coordinate";
    else if (cumulativeAmount.isNull()) amountStatus = "missing-or-invalid-amount";
    else if (previous == -1) amountStatus = "no-observed-baseline";
    else if (!std::isfinite(previousAmount)) amountStatus = "missing-previous-amount";
    else if (previous == 690 && m == 780) amountStatus = "session-boundary";
    else if (m != previous + 1) amountStatus = "gap";
    else if (cumulativeAmount.toDouble() < previousAmount) amountStatus = "cumulative-rollback";
    else {
      amount = cumulativeAmount.toDouble() - previousAmount;
      amountStatus = "known";
    }
    points[m] = QJsonObject{
        {"time", epoch(date, time)},
        {"label", date.toString(Qt::ISODate) + " " + time.toString("HH:mm")},
        {"open", price},
        {"high", price},
        {"low", price},
        {"close", price},
        {"volume", volume},
        {"cumulativeVolume", future ? QJsonValue(QJsonValue::Null) : cumulative},
        {"cumulativeAmount", future ? QJsonValue(QJsonValue::Null) : cumulativeAmount},
        {"amount", amount},
        {"amountStatus", amountStatus},
        {"valid", true},
        {"closed", epoch(date, time) + 60000 <= now.toMSecsSinceEpoch()}};
    previous = m;
    previousVolume = cumulative.toDouble();
    previousAmount = cumulativeAmount.isNull() ? NAN : cumulativeAmount.toDouble();
  }
  require(!points.isEmpty(), "分时未返回有效点");
  QJsonArray rows;
  for (int m = 570; m <= 900; ++m) {
    if (m > 690 && m < 780) continue;
    auto time = QTime(m / 60, m % 60);
    rows.append(points.contains(m)
                    ? points[m]
                    : QJsonObject{{"time", epoch(date, time)},
                                  {"label", date.toString(Qt::ISODate) + " " +
                                                time.toString("HH:mm")},
                                  {"cumulativeVolume", QJsonValue(QJsonValue::Null)},
                                  {"cumulativeAmount", QJsonValue(QJsonValue::Null)},
                                  {"amount", QJsonValue(QJsonValue::Null)},
                                  {"amountStatus", "missing-coordinate"},
                                  {"valid", false},
                                  {"closed", false}});
  }
  auto qt = container["qt"].toObject()[symbol].toArray();
  return {{"rows", rows},
          {"timeUnit", "milliseconds"},
          {"offSessionCount", offSession},
          {"source", "腾讯公开分时"},
          {"adjustment", "none"},
          {"volumeUnit", "手"},
          {"intervalMinutes", 1},
          {"amountUnit", "CNY"},
          {"cumulativeAmountUnit", "CNY"},
          {"cumulativeVolumeUnit", "手"},
          {"quantitySemantics", "incremental"},
          {"volumeToShares", 100},
          {"amountToCny", 1},
          {"unitEvidence", "repository-contract:services/publicMinuteService.js#normalizeTencentMinute"},
          {"amountSourceField", "data[symbol].data.data[*].column4"},
          {"amountDerivation", "adjacent-same-session-nonnegative-difference;no-inferred-first-baseline"},
          {"cumulativeTotalCompleteness", "not-verified"},
          {"dataDate", date.toString(Qt::ISODate)},
          {"previousClose", qt.size() > 4 ? numeric(qt[4].toString(), true)
                                          : QJsonValue(QJsonValue::Null)},
          {"checkedAt", now.toUTC().toString(Qt::ISODate)},
          {"cached", false}};
}
}  // namespace marketdata
