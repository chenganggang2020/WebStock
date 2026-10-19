#include "market_feed.hpp"
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QEvent>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QPointer>
#include <QTemporaryDir>
#include <QTextStream>
#include <QThread>
#include <QTimeZone>
#include <cstring>
#include <functional>
#include <stdexcept>

namespace {
void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
class HeldReply final : public QNetworkReply {
 public:
  HeldReply(const QNetworkRequest& request, QObject* parent) : QNetworkReply(parent) {
    setRequest(request); setUrl(request.url()); open(QIODevice::ReadOnly);
  }
  void abort() override { if (!isFinished()) { setFinished(true); setError(OperationCanceledError, "cancelled"); emit finished(); } }
  void fail() {
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute, 503);
    setError(ServiceUnavailableError, "controlled newer-source failure");
    setFinished(true); emit finished();
  }
 protected:
  qint64 readData(char*, qint64) override { return -1; }
};
class Network final : public QNetworkAccessManager {
 public:
  QPointer<HeldReply> held; int requests = 0;
 protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& request, QIODevice*) override {
    ++requests; held = new HeldReply(request, this); return held;
  }
};
QJsonObject savedResult() {
  const auto local = QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800);
  const auto at = QDateTime(local.date(), QTime(9, 30), QTimeZone::fromSecondsAheadOfUtc(28800));
  return {{"timeUnit", "milliseconds"}, {"source", "Tencent detail fixture"},
          {"provider", "tencent-public-detail"}, {"adjustment", "none"},
          {"checkedAt", local.addSecs(-10).toUTC().toString(Qt::ISODateWithMs)},
          {"dataDate", local.date().toString(Qt::ISODate)}, {"intraday", true},
          {"requestState", "ready"}, {"rows", QJsonArray{QJsonObject{
              {"time", double(at.toMSecsSinceEpoch())}, {"label", at.toString("yyyy-MM-dd HH:mm:ss")},
              {"open", 10.}, {"high", 11.}, {"low", 9.}, {"close", 10.},
              {"volume", 100.}, {"valid", true}, {"closed", true}}}}};
}
void delayedPriorWriteCannotOwnNewRequestState(bool failNewRequest) {
  QTemporaryDir dir; Network net; MarketFeed feed(dir.path(), nullptr, &net, false);
  const QString id = "SZ:stock:000977", period = "minute5s";
  feed.instruments = QJsonArray{QJsonObject{{"id", id}, {"symbol", "sz000977"}, {"name", "fixture"}}};
  const auto input = savedResult();
  // A real private SQLite write is queued. Its completion is intentionally not
  // delivered on the GUI thread yet, reproducing a slow write-completion lane.
  feed.persist(id, period, "sz000977-minute5s", input);
  check(feed.pendingWrites.size() == 1, "prior persistence did not queue");
  feed.sample(id, 5, true);
  check(feed.detailJob && feed.instruments[0].toObject()[period + "Meta"].toObject()["requestState"] == "loading",
        "newer real sample request did not enter loading");
  // Deliver only the new network job's start, not the writer's queued callback.
  QCoreApplication::sendPostedEvents(feed.detailJob.data(), QEvent::MetaCall);
  check(net.requests == 1 && net.held, "controlled newer network request did not start");
  if (failNewRequest) {
    net.held->fail();
    check(feed.instruments[0].toObject()[period + "Meta"].toObject()["requestState"] == "failed",
          "newer actual source failure did not enter failed");
    check(feed.pendingWrites.size() == 1, "prior write callback was delivered prematurely");
  }
  QElapsedTimer deadline; deadline.start();
  // Do not process GUI events until the actual private SQLite write completes.
  while (feed.persistenceStats()["committedJobs"].toDouble() < 1 && deadline.elapsed() < 2000) QThread::msleep(1);
  check(feed.persistenceStats()["committedJobs"].toDouble() == 1, "private write did not commit");
  while (!feed.pendingWrites.isEmpty() && deadline.elapsed() < 2500) {
    QCoreApplication::sendPostedEvents(nullptr, QEvent::MetaCall);
    QThread::msleep(1);
  }
  check(feed.pendingWrites.isEmpty(), "committed old write callback was not delivered");
  const auto item = feed.instruments[0].toObject();
  const auto meta = item[period + "Meta"].toObject();
  check(meta["writeReceipt"].toObject()["committed"].toBool(), "old persistence receipt was lost");
  const auto rows = item[period].toArray();
  check(rows.size() == 1, "prior write completion lost its captured source row");
  for (const auto* field : {"time", "open", "high", "low", "close", "volume"})
    check(rows.first().toObject()[field] == input["rows"].toArray().first().toObject()[field],
          "preserving request state changed captured source prices");
  if (failNewRequest) {
    check(!meta["error"].toString().isEmpty(), "new source error was discarded");
    check(meta["requestState"] == "failed", "old completed write overwrote newer failed network state with ready");
  } else {
    check(feed.detailJob && net.requests == 1, "old write completion canceled or duplicated newer network job");
    check(meta["requestState"] == "loading", "old completed write overwrote active newer loading state with ready");
  }
  feed.cancelSamples();
}
}  // namespace

int main(int argc, char** argv) {
  QCoreApplication app(argc, argv);
  int passed = 0, failed = 0;
  const auto test = [&](const char* name, const std::function<void()>& body) {
    try { body(); ++passed; QTextStream(stdout) << "PASS " << name << '\n'; }
    catch (const std::exception& e) { ++failed; QTextStream(stdout) << "FAIL " << name << ": " << e.what() << '\n'; }
    QCoreApplication::sendPostedEvents(nullptr, QEvent::DeferredDelete);
  };
  test("Q03 completed old SQLite write preserves newer active loading state", [] { delayedPriorWriteCannotOwnNewRequestState(false); });
  test("Q03 completed old SQLite write preserves newer actual source failure state", [] { delayedPriorWriteCannotOwnNewRequestState(true); });
  QTextStream(stdout) << "TOTAL " << passed << " passed, " << failed << " failed\n";
  return failed ? 1 : 0;
}
