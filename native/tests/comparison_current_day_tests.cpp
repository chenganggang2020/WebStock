#include "market_comparison_feed.hpp"
#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QTemporaryDir>
#include <QTextStream>
#include <QTimer>
#include <QUrlQuery>
#include <cstring>
#include <functional>
#include <stdexcept>

namespace {
void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
QDate today() { return QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date(); }
QList<QDate> dates(QDate end) {
  QList<QDate> out;
  while (out.size() < 61) {
    if (end.dayOfWeek() <= 5) out.prepend(end);
    end = end.addDays(-1);
  }
  return out;
}
QByteArray tencent(const QString& symbol, bool wrongIdentity = false) {
  QJsonArray rows;
  int i = 0;
  for (const auto& date : dates(today())) {
    const double close = 2000 + i++;
    rows.append(QJsonArray{date.toString(Qt::ISODate), QString::number(close - 1),
                           QString::number(close), QString::number(close + 2),
                           QString::number(close - 2), "1234"});
  }
  return QJsonDocument(QJsonObject{{"code", 0}, {"data", QJsonObject{
      {wrongIdentity ? "sz000001" : symbol, QJsonObject{{"day", rows}}}}}})
      .toJson(QJsonDocument::Compact);
}
QByteArray sina() {
  QJsonArray rows;
  int i = 0;
  for (const auto& date : dates(today().addDays(-1))) {
    const double close = 1000 + i++;
    rows.append(QJsonObject{{"day", date.toString(Qt::ISODate)},
                            {"open", QString::number(close - 1)},
                            {"close", QString::number(close)},
                            {"high", QString::number(close + 2)},
                            {"low", QString::number(close - 2)}, {"volume", "4567"}});
  }
  return QJsonDocument(rows).toJson(QJsonDocument::Compact);
}
class Reply final : public QNetworkReply {
  QByteArray body;
  qint64 offset = 0;
 public:
  Reply(const QNetworkRequest& request, QByteArray data, int status, int delay,
        QObject* parent) : QNetworkReply(parent), body(std::move(data)) {
    setRequest(request); setUrl(request.url());
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute, status);
    open(QIODevice::ReadOnly);
    QTimer::singleShot(delay, this, [this] {
      setFinished(true); emit readyRead(); emit finished();
    });
  }
  // A late source can ignore abort. Feed epoch/disconnection must remain safe.
  void abort() override {}
  qint64 bytesAvailable() const override {
    return body.size() - offset + QNetworkReply::bytesAvailable();
  }
 protected:
  qint64 readData(char* target, qint64 maximum) override {
    const auto count = qMin(maximum, body.size() - offset);
    if (count <= 0) return -1;
    std::memcpy(target, body.constData() + offset, size_t(count));
    offset += count;
    return count;
  }
};
class Network final : public QNetworkAccessManager {
 public:
  QList<QUrl> urls;
  int tencentStatus = 200, sinaStatus = 200, delay = 0;
  bool wrongIdentity = false, malformedTencent = false;
 protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& request,
                               QIODevice*) override {
    urls.append(request.url());
    const bool qq = request.url().host().endsWith("gtimg.cn");
    const auto symbol = QUrlQuery(request.url()).queryItemValue("param").section(',', 0, 0);
    auto body = qq ? tencent(symbol, wrongIdentity) : sina();
    if (qq && malformedTencent) body = "{broken";
    return new Reply(request, body, qq ? tencentStatus : sinaStatus, delay, this);
  }
};
QJsonObject run(marketComparison::Feed& feed, const QJsonArray& definitions) {
  QJsonObject result;
  QEventLoop loop;
  const auto connection = QObject::connect(&feed, &marketComparison::Feed::finished,
      &loop, [&](const QJsonObject& value) { result = value; loop.quit(); });
  QTimer deadline;
  deadline.setSingleShot(true);
  QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
  deadline.start(3000);
  feed.start("daily", definitions, 60);
  if (result.isEmpty()) loop.exec();
  QObject::disconnect(connection);
  check(!result.isEmpty(), "Feed did not finish within controlled timeout");
  return result;
}
QJsonObject firstSeries(const QJsonObject& report) {
  check(report["series"].toArray().size() == 1, "wrong series count");
  return report["series"].toArray().first().toObject();
}
void pause(int milliseconds) {
  QEventLoop loop;
  QTimer::singleShot(milliseconds, &loop, &QEventLoop::quit);
  loop.exec();
}
QMap<QString, QByteArray> cacheBytes(const QString& directory) {
  QMap<QString, QByteArray> files;
  for (const auto& name : QDir(directory).entryList({"*.json"}, QDir::Files)) {
    QFile file(QDir(directory).filePath(name));
    check(file.open(QIODevice::ReadOnly), "private cache could not be read");
    files.insert(name, file.readAll());
  }
  return files;
}
}  // namespace

int main(int argc, char** argv) {
  QCoreApplication app(argc, argv);
  int passed = 0, failed = 0;
  const auto test = [&](const char* name, const std::function<void()>& body) {
    try { body(); ++passed; QTextStream(stdout) << "PASS " << name << '\n'; }
    catch (const std::exception& e) {
      ++failed; QTextStream(stdout) << "FAIL " << name << ": " << e.what() << '\n';
    }
  };
  const auto definition = marketComparison::indexDefinitions().first().toObject();
  const QJsonArray selected{definition};
  test("matrix completion yields to UI cancellation after final source", [&] {
    QTemporaryDir dir; Network net; marketComparison::Feed feed(dir.path(), true, nullptr, &net);
    int emitted=0;
    QObject::connect(&feed,&marketComparison::Feed::seriesUpdated,&feed,[&]{QTimer::singleShot(0,&feed,[&]{feed.cancel();});});
    QObject::connect(&feed,&marketComparison::Feed::finished,&feed,[&](const QJsonObject&){++emitted;});
    feed.start("daily",selected,60);pause(250);
    check(emitted==0,"final matrix computation blocked UI cancellation and emitted stale completion");
  });
  test("Q05 Tencent full same-identity history includes current trading day without source splice", [&] {
    QTemporaryDir dir; Network net; marketComparison::Feed feed(dir.path(), true, nullptr, &net);
    const auto report = run(feed, selected);
    const auto row = firstSeries(report);
    check(row["status"] == "available", "history is not available");
    check(row["points"].toArray().last().toObject()["date"] == dates(today()).last().toString(Qt::ISODate),
          "current trading-day data missing although Tencent returned it");
    check(net.urls.size() == 1 && net.urls.first().host() == "web.ifzq.gtimg.cn",
          "daily index did not use Tencent first");
    const auto parameter = QUrlQuery(net.urls.first()).queryItemValue("param").split(',');
    check(parameter.size() >= 5 && parameter[0] == definition["symbol"].toString() &&
              parameter[1] == "day" && parameter[4].toInt() >= 61,
          "Tencent request identity, period or full-history count wrong");
    check(row["source"] == "tencent-public-index-daily" && row["volumeUnit"] == QString::fromUtf8("手"),
          "Tencent provenance or volume unit missing");
    const auto points = row["points"].toArray();
    check(points.size() == 61 && points.first().toObject()["close"].toDouble() == 2000 &&
              points.last().toObject()["close"].toDouble() == 2060,
          "mixed or truncated provider history");
    check(points.first().toObject()["volume"].toDouble() == 1234,
          "provider volume was silently converted");
    check(firstSeries(feed.read("daily", selected, 60))["source"] == row["source"],
          "saved full history lost provider identity");
  });
  test("Q05 Tencent failure falls back to complete Sina history with truthful source and units", [&] {
    QTemporaryDir dir; Network net; net.tencentStatus = 503;
    marketComparison::Feed feed(dir.path(), true, nullptr, &net);
    const auto row = firstSeries(run(feed, selected));
    check(net.urls.size() == 2 && net.urls[0].host() == "web.ifzq.gtimg.cn" &&
              net.urls[1].host() == "money.finance.sina.com.cn", "fallback route/order wrong");
    check(row["status"] == "available" && row["source"] == "sina-public-index-daily",
          "Sina fallback not available or mislabeled");
    check(!row["volumeUnit"].toString().isEmpty() && row["volumeUnit"] != QString::fromUtf8("手"),
          "Sina volume unit missing or falsely copied from Tencent");
    check(row["points"].toArray().first().toObject()["close"].toDouble() == 1000 &&
              row["points"].toArray().last().toObject()["close"].toDouble() == 1060,
          "fallback history not from one provider");
    check(row["fallbackErrors"].toArray().size() == 1, "fallback failure evidence missing");
  });
  for (bool malformed : {false, true}) {
    test(malformed ? "Q05 malformed Tencent JSON cannot poison history" :
                     "Q05 mismatched Tencent identity cannot poison history", [&, malformed] {
      QTemporaryDir dir; Network net;
      net.malformedTencent = malformed; net.wrongIdentity = !malformed;
      marketComparison::Feed feed(dir.path(), true, nullptr, &net);
      const auto row = firstSeries(run(feed, selected));
      check(net.urls.size() == 2 && row["source"] == "sina-public-index-daily",
            "invalid Tencent response was accepted or never checked");
      check(row["points"].toArray().last().toObject()["close"].toDouble() == 1060,
            "wrong-identity or malformed data leaked into comparison");
    });
  }
  test("Q05 older successful fallback cannot replace a newer saved trading day", [&] {
    QTemporaryDir dir; Network net; marketComparison::Feed feed(dir.path(), true, nullptr, &net);
    const auto previous = firstSeries(run(feed, selected));
    net.tencentStatus = 503;
    const auto row = firstSeries(run(feed, selected));
    check(row["points"] == previous["points"] && row["source"] == previous["source"] &&
              row["dataDate"] == previous["dataDate"], "older fallback replaced newer saved history");
    check(row["lastAttempt"].toObject()["status"] == "failed", "older response falsely recorded as a successful refresh");
  });
  test("Q05 all providers failing preserves prior full series and failure receipt", [&] {
    QTemporaryDir dir; Network net; marketComparison::Feed feed(dir.path(), true, nullptr, &net);
    const auto previous = firstSeries(run(feed, selected));
    net.urls.clear(); net.tencentStatus = net.sinaStatus = 503;
    const auto row = firstSeries(run(feed, selected));
    check(net.urls.size() == 2, "both history providers were not attempted");
    check(row["points"] == previous["points"] && row["source"] == previous["source"] &&
              row["fetchedAt"] == previous["fetchedAt"], "failure overwrote prior complete series");
    check(row["stale"].toBool() && row["lastAttempt"].toObject()["status"] == "failed",
          "old data was presented as a successful refresh");
    const auto cached = firstSeries(feed.read("daily", selected, 60));
    check(cached["points"] == previous["points"] &&
              cached["lastAttempt"].toObject()["status"] == "failed", "failure receipt or old data not saved");
  });
  test("Q05 cancel ignores late response and writes neither series nor failure receipt", [&] {
    QTemporaryDir dir; Network net; marketComparison::Feed feed(dir.path(), true, nullptr, &net);
    (void)run(feed, selected);
    const auto before = cacheBytes(dir.path());
    check(before.size() == 1, "private seed cache missing");
    int emitted = 0;
    QObject::connect(&feed, &marketComparison::Feed::finished, &feed,
                     [&](const QJsonObject&) { ++emitted; });
    net.delay = 80;
    feed.start("daily", selected, 60);
    feed.cancel();
    pause(150);
    check(emitted == 0 && cacheBytes(dir.path()) == before,
          "late canceled response emitted completion or changed persisted data");
  });
  test("Q05 board history failure does not route through index Tencent fallback", [&] {
    QTemporaryDir dir; Network net; net.sinaStatus = 503;
    marketComparison::Feed feed(dir.path(), true, nullptr, &net);
    const QJsonObject board{{"key", "eastmoney-industry:BK0475"},
                           {"name", QString::fromUtf8("银行")},
                           {"kind", "board"}, {"taxonomy", "industry"}, {"code", "BK0475"}};
    (void)run(feed, QJsonArray{board});
    check(net.urls.size() == 1 && net.urls.first().host().contains("eastmoney.com"),
          "board history was rerouted as a fixed index");
  });
  QTextStream(stdout) << "TOTAL " << passed << " passed, " << failed << " failed\n";
  return failed ? 1 : 0;
}
