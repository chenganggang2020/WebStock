#include "board_series_widget.hpp"
#include "market_comparison_page.hpp"
#include "etf_monitor_page.hpp"
#include "futures_monitor_page.hpp"
#include <QApplication>
#include <QComboBox>
#include <QElapsedTimer>
#include <QJsonDocument>
#include <QListWidget>
#include <QNetworkReply>
#include <QPointer>
#include <QStackedWidget>
#include <QTabWidget>
#include <QTemporaryDir>
#include <QTextStream>
#include <QTimer>
#include <QPushButton>
#include <QUrlQuery>
#include <QtTest/QTest>
#include <cstring>
#include <functional>
#include <stdexcept>

namespace {
void check(bool ok, const char* why) { if (!ok) throw std::runtime_error(why); }
bool until(const std::function<bool()>& condition, int milliseconds = 1000) {
  QElapsedTimer deadline; deadline.start();
  while (!condition() && deadline.elapsed() < milliseconds) QTest::qWait(5);
  return condition();
}
QTimer* automatic(QWidget& page, const char* name, QTimer* legacy = nullptr) {
  auto* timer = page.findChild<QTimer*>(name);
  check(timer || legacy, "automatic timer missing");
  return timer ? timer : legacy;
}
QByteArray indexBody(const QUrl& url) {
  QJsonArray sinaRows, qqRows;
  const auto end = QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date();
  for (int i = 0; i < 61; ++i) {
    const auto date = end.addDays(i - 60).toString(Qt::ISODate);
    sinaRows.append(QJsonObject{{"day", date}, {"open", "100"}, {"close", "101"},
                                {"high", "102"}, {"low", "99"}, {"volume", "1000"}});
    qqRows.append(QJsonArray{date, "100", "101", "102", "99", "1000"});
  }
  if (url.host().endsWith("gtimg.cn")) {
    const auto symbol = QUrlQuery(url).queryItemValue("param").section(',', 0, 0);
    return QJsonDocument(QJsonObject{{"code", 0}, {"data", QJsonObject{
        {symbol, QJsonObject{{"day", qqRows}}}}}}).toJson(QJsonDocument::Compact);
  }
  return QJsonDocument(sinaRows).toJson(QJsonDocument::Compact);
}
QByteArray boardBody() {
  const auto date = QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date().toString(Qt::ISODate);
  return QJsonDocument(QJsonObject{{"rc", 0}, {"data", QJsonObject{{"code", "BK0475"},
      {"klines", QJsonArray{date + ",100,101,102,99,1000,10000"}}}}})
      .toJson(QJsonDocument::Compact);
}
class Reply final : public QNetworkReply {
  QByteArray body; qint64 offset = 0;
 public:
  Reply(const QNetworkRequest& request, QByteArray data, int status, int delay, QObject* parent)
      : QNetworkReply(parent), body(std::move(data)) {
    setRequest(request); setUrl(request.url());
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute, status);
    open(QIODevice::ReadOnly);
    QTimer::singleShot(delay, this, [this] { setFinished(true); emit readyRead(); emit finished(); });
  }
  void abort() override { if (!isFinished()) { setError(OperationCanceledError, "cancelled"); setFinished(true); emit finished(); } }
  qint64 bytesAvailable() const override { return body.size() - offset + QNetworkReply::bytesAvailable(); }
 protected:
  qint64 readData(char* target, qint64 maximum) override {
    const auto count = qMin(maximum, body.size() - offset);
    if (count <= 0) return -1;
    std::memcpy(target, body.constData() + offset, size_t(count)); offset += count; return count;
  }
};
class Network final : public QNetworkAccessManager {
 public:
  QList<QUrl> urls; int status = 200, delay = 0;
 protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& request, QIODevice*) override {
    urls.append(request.url());
    return new Reply(request, request.url().host().contains("eastmoney.com") ? boardBody() : indexBody(request.url()), status, delay, this);
  }
};
QJsonObject board() {
  return {{"provider", "eastmoney-public-board"}, {"taxonomy", "industry"},
          {"code", "BK0475"}, {"name", QString::fromUtf8("银行")}};
}
QJsonObject etf(double price = 4.6) {
  auto snapshot = etfMonitor::emptySnapshot();
  snapshot["receivedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
  snapshot["items"] = QJsonArray{QJsonObject{{"id", "SH:etf:510300"}, {"name", "ETF fixture"},
      {"quote", QJsonObject{{"price", price}, {"changePercent", 1.}, {"amount", 1000.}}}}};
  return snapshot;
}
QByteArray futuresBody(const QString& symbol) {
  const auto date = QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date().addDays(-1).toString(Qt::ISODate);
  return "var _" + symbol.toUtf8() + "=([" +
      QJsonDocument(QJsonObject{{"d", date + " 10:01:00"}, {"o", "4000"},
                               {"c", "4001"}, {"v", "1"}, {"p", "100"}}).toJson(QJsonDocument::Compact) + "," +
      QJsonDocument(QJsonObject{{"d", date + " 10:02:00"}, {"c", "4002"},
                               {"v", "2"}, {"p", "101"}}).toJson(QJsonDocument::Compact) + "]);";
}
QJsonArray futuresResponses(const QStringList& symbols) {
  QJsonArray rows;
  for (const auto& symbol : symbols) rows.append(QJsonObject{{"symbol", symbol},
      {"payload", QString::fromUtf8(futuresBody(symbol))},
      {"receivedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
      {"sourceUrl", futuresMonitor::sourceUrl(symbol)}});
  return rows;
}
void show(QWidget& page) { page.resize(900, 600); page.show(); QTest::qWait(15); }
QJsonObject etfEvidence(EtfMonitorPage& page) {
  auto evidence = QJsonDocument::fromJson(page.exportEvidence()).object();
  evidence.remove("exportedAt");
  return evidence;
}
}  // namespace

int main(int argc, char** argv) {
  QApplication app(argc, argv);
  int passed = 0, failed = 0;
  const auto test = [&](const char* name, const std::function<void()>& body) {
    try { body(); ++passed; QTextStream(stdout) << "PASS " << name << '\n'; }
    catch (const std::exception& e) { ++failed; QTextStream(stdout) << "FAIL " << name << ": " << e.what() << '\n'; }
    QCoreApplication::sendPostedEvents(nullptr, QEvent::DeferredDelete);
  };
  test("Q04 board enters visible page and automatically requests exact selected identity", [] {
    QTemporaryDir dir; Network net; BoardSeriesWidget page(dir.path(), true, nullptr, &net);
    page.setBoard(board()); show(page);
    check(until([&] { return !net.urls.isEmpty(); }), "visible board did not request automatically");
    check(QUrlQuery(net.urls.first()).queryItemValue("secid") == "90.BK0475", "wrong board identity");
    check(until([&] { return !page.busy; }), "board request did not finish");
    check(automatic(page, "boardAutomaticTimer")->isActive(), "board completion did not schedule next refresh");
  });
  test("Q04 board failure backs off and busy timer never overlaps a request", [] {
    QTemporaryDir dir; Network net; net.status = 503;
    BoardSeriesWidget page(dir.path(), true, nullptr, &net); page.setBoard(board()); show(page);
    page.refreshSource(); check(until([&] { return !page.busy && !net.urls.isEmpty(); }), "board failure did not complete");
    auto* timer = automatic(page, "boardAutomaticTimer");
    check(timer->isActive() && timer->interval() >= 60000, "board failure has no bounded retry delay");
    net.delay = 100; net.status = 200; page.refreshSource(); const auto count = net.urls.size();
    timer->start(1); QTest::qWait(30); check(net.urls.size() == count, "board automatic request overlapped busy request");
    page.hide(); check(!page.busy && !timer->isActive(), "hidden board did not cancel and stop timer");
  });
  test("Q04 comparison completion and fresh-cache tick both continue scheduling", [] {
    QTemporaryDir dir; Network net; MarketComparisonPage page(dir.path(), {}, true, nullptr, &net); show(page);
    check(until([&] { return net.urls.size() >= 2; }), "visible comparison did not automatically request");
    auto* timer = automatic(page, "comparisonAutomaticTimer", page.refreshTimer);
    check(until([&] { return page.shown["status"] == "available"; }), "comparison did not accept controlled data");
    check(timer->isActive(), "comparison stopped after first completed refresh");
    const auto count = net.urls.size(); timer->start(1); QTest::qWait(30);
    check(net.urls.size() == count && timer->isActive(), "fresh comparison tick stopped scheduling or redundantly fetched");
  });
  test("Q04 comparison failure retries with backoff rather than stopping forever", [] {
    QTemporaryDir dir; Network net; net.status = 503;
    MarketComparisonPage page(dir.path(), {}, true, nullptr, &net); show(page);
    check(until([&] { return page.shown["status"] == "unavailable" && !page.attempted.isEmpty(); }), "comparison failure did not finish");
    auto* timer = automatic(page, "comparisonAutomaticTimer", page.refreshTimer);
    check(timer->isActive() && timer->interval() >= 60000, "comparison failure has no retry/backoff");
  });
  test("Q04 comparison busy tick does not restart in-flight work and hidden page stays idle", [] {
    QTemporaryDir dir; Network net; net.delay = 120;
    MarketComparisonPage page(dir.path(), {}, true, nullptr, &net); show(page);
    check(until([&] { return !net.urls.isEmpty(); }), "comparison request not started");
    auto* timer = automatic(page, "comparisonAutomaticTimer", page.refreshTimer);
    const auto count = net.urls.size(); timer->start(1); QTest::qWait(30);
    check(net.urls.size() == count, "comparison busy tick canceled/restarted active request");
    page.hide(); const auto hiddenCount = net.urls.size(); timer->start(1); QTest::qWait(30);
    check(net.urls.size() == hiddenCount && !timer->isActive(), "hidden comparison continued requesting");
  });
  test("Q04 comparison source/history tab does not automatically fetch or change reading state", [] {
    QTemporaryDir dir; Network net; MarketComparisonPage page(dir.path(), {}, true, nullptr, &net);
    page.tabs->setCurrentIndex(3); show(page); const auto before = page.saveState();
    auto* timer = automatic(page, "comparisonAutomaticTimer", page.refreshTimer);
    timer->start(1); QTest::qWait(30);
    check(net.urls.isEmpty() && page.saveState() == before, "comparison reading tab was refreshed or navigation changed");
  });
  test("Q04 ETF automatically alternates current-page quotes and selected minute", [] {
    QTemporaryDir dir; EtfMonitorPage page(dir.filePath("etf.json")); page.setSnapshot(etf());
    page.setRefreshAvailable(true); QStringList modes;
    QObject::connect(&page, &EtfMonitorPage::refreshRequested, &page, [&](QString token, QJsonObject selection) {
      modes.append(selection["period"].toString());
      QTimer::singleShot(0, &page, [&, token] { page.acceptSnapshot(token, etf()); });
    });
    const auto originalFrames=page.archive["frames"];
    show(page); check(until([&] { return modes.size() >= 1 && page.token.isEmpty(); }), "ETF visible entry did not fetch automatically");
    auto* timer = automatic(page, "etfAutomaticTimer"); check(timer->isActive(), "ETF success did not continue scheduling");
    timer->start(1); check(until([&] { return modes.size() >= 2 && page.token.isEmpty(); }), "ETF timer did not request second phase");
    check(modes[0] == "quote" && modes[1] == "minute", "ETF timer did not alternate quotes and selected minute");
    check(page.archive["frames"]==originalFrames,"automatic refresh displaced previously saved ETF observations");
  });
  test("Q04 ETF failure backs off and automatic tick does not overlap token", [] {
    QTemporaryDir dir; EtfMonitorPage page(dir.filePath("etf.json")); page.setSnapshot(etf()); page.setRefreshAvailable(true);
    QString token; int requests = 0;
    QObject::connect(&page, &EtfMonitorPage::refreshRequested, &page, [&](QString ticket, QJsonObject) { token = ticket; ++requests; });
    show(page); page.request("quote"); check(!token.isEmpty(), "ETF manual seed request missing");
    page.failRefresh(token, "controlled failure"); auto* timer = automatic(page, "etfAutomaticTimer");
    check(timer->isActive() && timer->interval() >= 60000, "ETF failure has no retry/backoff");
    page.request("quote"); const auto before = requests; timer->start(1); QTest::qWait(30);
    check(requests == before, "ETF automatic request overlapped active token");
    page.cancel();
  });
  test("Q04 ETF historical selection revokes pending request and ignores late data", [] {
    QTemporaryDir dir; EtfMonitorPage page(dir.filePath("etf.json")); page.setSnapshot(etf()); page.setSnapshot(etf(4.7)); page.setRefreshAvailable(true);
    QString token; int requests = 0;
    QObject::connect(&page, &EtfMonitorPage::refreshRequested, &page, [&](QString ticket, QJsonObject) { token = ticket; ++requests; });
    show(page); page.request("quote"); check(!token.isEmpty(), "ETF seed request missing");
    page.history->setCurrentIndex(1); const auto before = page.saveState();
    check(!before["history"].toString().isEmpty() && page.token.isEmpty(), "ETF history did not revoke active refresh");
    const auto evidence = etfEvidence(page); const auto count = requests;
    if (auto* timer = page.findChild<QTimer*>("etfAutomaticTimer")) timer->start(1);
    QTest::qWait(30); page.acceptSnapshot(token, etf(99.));
    check(requests == count && page.saveState() == before && etfEvidence(page) == evidence,
          "ETF historical reader was refreshed or replaced by late data");
  });
  test("Q04 hidden ETF cancels current token without waiting for host completion", [] {
    QTemporaryDir dir; EtfMonitorPage page(dir.filePath("etf.json")); page.setSnapshot(etf()); page.setRefreshAvailable(true);
    QString token; int cancels = 0;
    QObject::connect(&page, &EtfMonitorPage::refreshRequested, &page, [&](QString ticket, QJsonObject) { token = ticket; });
    QObject::connect(&page, &EtfMonitorPage::cancelRefreshRequested, &page, [&](QString) { ++cancels; });
    show(page); page.request("quote"); check(!token.isEmpty(), "ETF seed request missing");
    page.hide(); check(page.token.isEmpty() && cancels == 1, "hiding ETF did not revoke token");
  });
  test("Q04 futures visible entry fetches selected symbols and continues after success", [] {
    QTemporaryDir dir; FuturesMonitorPage* target = nullptr; int requests = 0;
    FuturesMonitorPage page(dir.filePath("futures.sqlite"), [&](QString token, QStringList symbols) {
      ++requests; check(!symbols.isEmpty() && symbols.size() <= 4, "futures request selection invalid");
      QTimer::singleShot(0, target, [&, token, symbols] { target->deliver(token, futuresResponses(symbols)); });
    }, [](QString) {}); target = &page; show(page);
    check(until([&] { return requests > 0 && page.activeToken.isEmpty(); }), "futures visible entry did not fetch automatically");
    auto* timer = automatic(page, "futuresAutomaticTimer"); check(timer->isActive(), "futures success did not continue scheduling");
    timer->start(1); check(until([&] { return requests >= 2 && page.activeToken.isEmpty(); }), "futures timer did not refresh again");
  });
  test("Q04 futures failure retries with backoff and busy tick does not overlap", [] {
    QTemporaryDir dir; QString token; int requests = 0;
    FuturesMonitorPage page(dir.filePath("futures.sqlite"), [&](QString ticket, QStringList) { token = ticket; ++requests; }, [](QString) {});
    show(page); if (page.activeToken.isEmpty()) page.start(); page.deliver(token, {}, "controlled failure");
    auto* timer = automatic(page, "futuresAutomaticTimer");
    check(timer->isActive() && timer->interval() >= 60000, "futures failure has no retry/backoff");
    page.start(); const auto before = requests; timer->start(1); QTest::qWait(30);
    check(requests == before, "futures automatic request overlapped token"); page.cancel();
  });
  test("Q04 futures historical reader revokes active token and preserves exact reading state", [] {
    QTemporaryDir dir; const auto file = dir.filePath("futures.sqlite");
    const auto old = futuresMonitor::parse("IF0", futuresBody("IF0"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
    futuresMonitor::Store(file).save(old); QString token; int requests = 0;
    FuturesMonitorPage page(file, [&](QString ticket, QStringList) { token = ticket; ++requests; }, [](QString) {});
    show(page); if (page.activeToken.isEmpty()) page.start(); check(!token.isEmpty(), "futures seed request missing");
    check(page.openSnapshot(old["id"].toString()), "futures historical fixture not opened");
    const auto before = page.saveState();
    check(page.activeToken.isEmpty(), "futures historical entry did not revoke current refresh");
    const auto count = requests;
    if (auto* timer = page.findChild<QTimer*>("futuresAutomaticTimer")) timer->start(1);
    QTest::qWait(30); page.deliver(token, {}, "late failure");
    check(requests == count && page.saveState() == before, "futures historical reading state changed automatically");
  });
  test("Q04 hiding futures cancels current host work and keeps timer stopped", [] {
    QTemporaryDir dir; int cancels = 0;
    FuturesMonitorPage page(dir.filePath("futures.sqlite"), [](QString, QStringList) {}, [&](QString) { ++cancels; });
    show(page); if (page.activeToken.isEmpty()) page.start(); check(!page.activeToken.isEmpty(), "futures seed request missing");
    page.hide(); check(page.activeToken.isEmpty() && cancels == 1, "hiding futures did not revoke host token");
    if (auto* timer = page.findChild<QTimer*>("futuresAutomaticTimer")) check(!timer->isActive(), "hidden futures timer remains active");
  });
  test("Q04 explicit comparison cache reload does not disable future automatic updates", [] {
    QTemporaryDir dir;Network net;MarketComparisonPage page(dir.path(),{},true,nullptr,&net);show(page);
    check(until([&]{return page.shown["status"]=="available";}),"comparison seed unavailable");
    auto* reload=page.findChild<QPushButton*>("comparisonReadCache");check(reload,"reload action missing");reload->click();
    QTest::qWait(30);check(page.refreshTimer->isActive(),"cache reload permanently disabled automatic updates");
  });
  test("Q04 malformed futures reply also receives failure backoff", [] {
    QTemporaryDir dir;QString token;FuturesMonitorPage page(dir.filePath("futures.sqlite"),[&](QString t,QStringList){token=t;},[](QString){});
    show(page);page.start();page.deliver(token,QJsonArray{QJsonObject{{"symbol","WRONG"}}});
    auto* timer=automatic(page,"futuresAutomaticTimer");check(timer->isActive()&&timer->interval()>=60000,"invalid response bypassed failure backoff");
  });
  test("Q04 futures history pagination is not reset by an automatic tick", [] {
    QTemporaryDir dir;int requests=0;FuturesMonitorPage page(dir.filePath("futures.sqlite"),[&](QString,QStringList){++requests;},[](QString){});
    show(page);page.historyPage=1;automatic(page,"futuresAutomaticTimer")->start(1);QTest::qWait(40);
    check(requests==0&&page.historyPage==1,"automatic update interrupted history pagination");
  });
  test("Q04 unchanged automatic futures response does not duplicate saved history", [] {
    QTemporaryDir dir;FuturesMonitorPage* target=nullptr;int requests=0;
    FuturesMonitorPage page(dir.filePath("futures.sqlite"),[&](QString token,QStringList symbols){++requests;QTimer::singleShot(0,target,[&,token,symbols]{target->deliver(token,futuresResponses(symbols));});},[](QString){});target=&page;show(page);
    check(until([&]{return requests>=1&&page.activeToken.isEmpty();}),"automatic seed unavailable");
    const auto count=page.store.history("IF0",0).size();automatic(page,"futuresAutomaticTimer")->start(1);
    check(until([&]{return requests>=2&&page.activeToken.isEmpty();}),"second automatic round unavailable");
    check(page.store.history("IF0",0).size()==count,"unchanged automatic payload created duplicate historical snapshots");
  });
  QTextStream(stdout) << "TOTAL " << passed << " passed, " << failed << " failed\n";
  return failed ? 1 : 0;
}
