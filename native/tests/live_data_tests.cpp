#include <QComboBox>
#include <QDialog>
#include <QJsonDocument>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QNetworkProxy>
#include <QNetworkProxyFactory>
#include <QtTest>

#include "market_feed.hpp"
#include "market_store.hpp"
#include "window.hpp"
#include "sector_watch_page.hpp"
#include "sector_watch_store.hpp"
class LiveTests : public QObject {
  Q_OBJECT
 private slots:
  void sectorHostPublicObservation() {
    const auto source=qEnvironmentVariable("SECTOR_WATCH_REPLAY_INPUT");
    const auto out=qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
    QVERIFY(!source.isEmpty() && !out.isEmpty());
    // A fresh application identity isolates all native settings/databases for this bounded probe.
    QCoreApplication::setApplicationName("SectorIntegrationQA-"+QUuid::createUuid().toString(QUuid::Id128));
    const auto data=QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    sectorWatch::Store store(data+"/sector-watch-v1.sqlite");
    for(const auto& name:{QString("catalog"),QString("constituents")}) {
      QFile f(source+"/"+name+".json"); QVERIFY(f.open(QIODevice::ReadOnly));
      store.save(QJsonDocument::fromJson(f.readAll()).object());
    }
    {
      MarketFeed seed(data+"/live");
      seed.add({{"id","SH:stock:601288"},{"symbol","sh601288"},{"name","农业银行"},{"group","核验"},{"order",0}});
    }
    Window w(false); w.resize(1600,1000); w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    auto* feed=w.findChild<MarketFeed*>(); QVERIFY(feed);
    QCOMPARE(w.stocks->rowCount(),1);
    w.findChild<QPushButton*>("openSectorWatch")->click();
    auto* page=w.findChild<SectorWatchPage*>(); QVERIFY(page);
    page->restoreState({{"provider","sina"},{"taxonomy","industry"},{"boardKey","sina-public-industry|industry|sw2_480200"},{"boardFilter","国有大型银行"}});
    auto* members=page->findChild<QTableWidget*>("sectorMembers");
    QTRY_COMPARE_WITH_TIMEOUT(members->rowCount(),6,4000);
    QTRY_VERIFY(page->findChild<QPushButton*>("sectorExport")->isEnabled());
    int selected=-1; QString id;
    for(int i=0;i<members->rowCount();++i) {
      auto row=members->item(i,0)->data(Qt::UserRole).toJsonObject();
      if(row["id"]!="SH:stock:601288") {selected=i;id=row["id"].toString();break;}
    }
    QVERIFY(selected>=0); members->selectRow(selected);
    auto observed=[&]{for(auto v:feed->instruments)if(v.toObject()["id"]==id)return v.toObject();return QJsonObject{};};
    auto ended=[&]{auto row=observed();auto m=row["minuteMeta"].toObject(),q=row["quote"].toObject();return (!row["minute"].toArray().isEmpty()||!m["error"].toString().isEmpty())&&(q["price"].isDouble()||!q["error"].toString().isEmpty());};
    QTRY_VERIFY_WITH_TIMEOUT(ended(),20000);
    QCOMPARE(w.stocks->rowCount(),1);
    QVERIFY(observed()["transient"].toBool());
    QDir().mkpath(out);
    QFile f(out+"/sector-observation.json"); QVERIFY(f.open(QIODevice::WriteOnly));
    f.write(QJsonDocument(observed()).toJson()); f.close();
    for(const QString& mode:{QString("quotes"),QString("classic"),QString("focus")}) {
      w.setLayoutMode(mode); w.findChild<QPushButton*>("openSectorWatch")->click();
      QTRY_VERIFY(page->findChild<QPushButton*>("sectorOpen")->isEnabled());
      QVERIFY(w.grab().save(out+"/windows-sector-real-"+mode+".png"));
      page->findChild<QPushButton*>("sectorOpen")->click();
      QCOMPARE(w.instrumentId(),id); QCOMPARE(w.stocks->rowCount(),1);
    }
    qInfo()<<"bounded observed instrument"<<id<<"minute rows"<<observed()["minute"].toArray().size()<<"quote"<<observed()["quote"]<<"metadata"<<observed()["minuteMeta"];
    QVERIFY2(!observed()["minute"].toArray().isEmpty(),"Public minute provider unavailable; preserved outcome, not a fake curve");
    QVERIFY(observed()["quote"].toObject()["price"].isDouble());
  }
  void providerRouteOnly() {
    qInfo()<<"system proxy enabled"<<QNetworkProxyFactory::usesSystemConfiguration();
    for(const auto& p:QNetworkProxyFactory::proxyForQuery(QNetworkProxyQuery(QUrl("https://push2.eastmoney.com/"))))qInfo()<<"effective Qt route"<<p.type()<<p.hostName()<<p.port();
  }
  void publicFundsMinuteWidgets() {
    const auto out=qEnvironmentVariable("NATIVE_REVIEW_SHOTS");QVERIFY(!out.isEmpty());
    Window w(false);w.resize(1600,1000);w.show();
    w.findChild<QPushButton*>("funds")->click();auto* d=w.findChild<QWidget*>("fundsPage");QVERIFY(d&&!d->isWindow());
    auto* symbols=d->findChild<QComboBox*>("fundSymbols");int pos=symbols->findData("SZ:stock:000977");QVERIFY(pos>=0);symbols->setCurrentIndex(pos);
    auto start=QDateTime::currentDateTimeUtc().addSecs(-2);d->findChild<QComboBox*>("fundMode")->setCurrentIndex(1);
    auto* feed=w.findChild<MarketFeed*>();QVERIFY(feed);auto meta=[&]{for(auto v:feed->instruments)if(v.toObject()["id"]=="SZ:stock:000977")return v.toObject()["capitalMinuteMeta"].toObject();return QJsonObject{};};
    QTRY_VERIFY_WITH_TIMEOUT(meta()["persistenceState"]=="saved"&&QDateTime::fromString(meta()["checkedAt"].toString(),Qt::ISODate)>=start,25000);
    auto data=meta();auto now=QDateTime::currentDateTimeUtc(),asOf=QDateTime::fromString(data["asOf"].toString(),Qt::ISODate);
    QVERIFY(asOf.isValid()&&asOf<=now&&asOf.secsTo(now)<=180);QCOMPARE(data["dataDate"].toString(),now.toOffsetFromUtc(28800).date().toString(Qt::ISODate));QVERIFY(!data["cached"].toBool());
    auto* table=d->findChild<QTableWidget*>("fundTable");QVERIFY(table->rowCount()>0);
    auto archived=feed->capitalHistory("SZ:stock:000977",data["dataDate"].toString());QVERIFY(!archived["rows"].toArray().isEmpty());QCOMPARE(archived["rows"].toArray().last(),data["rows"].toArray().last());
    QFile f(out+"/qt-live-minute.json");QVERIFY(f.open(QIODevice::WriteOnly));f.write(QJsonDocument(data).toJson());f.close();QVERIFY(w.grab().save(out+"/windows-live-minute.png"));
    qInfo()<<"fresh minute funds"<<data["dataDate"]<<data["asOf"]<<data["checkedAt"]<<table->rowCount()<<"rows persisted and rendered";
  }
  void publicFundsSnapshotOnly() {
    QTemporaryDir cache;MarketFeed feed(cache.path());
    feed.add({{"id","SZ:stock:000977"},{"symbol","sz000977"},{"name","浪潮信息"},{"group","接口核验"},{"order",0}});
    feed.capitalFlow("SZ:stock:000977","snapshot",true,2);
    auto meta=[&]{return feed.instruments[0].toObject()["capitalSnapshotMeta"].toObject();};
    QTRY_VERIFY_WITH_TIMEOUT(!meta()["error"].toString().isEmpty() || meta()["persistenceState"]=="saved",18000);
    qInfo()<<"snapshot native HTTP outcome"<<meta()["error"]<<meta()["persistenceState"]<<meta()["checkedAt"];
    QVERIFY2(meta()["persistenceState"]=="saved",qPrintable(meta()["error"].toString()));
    QVERIFY(meta()["sourceObservedAt"].isNull());QVERIFY(meta()["rows"].toArray().isEmpty());QVERIFY(meta()["snapshot"].toObject()["mainNet"].isDouble());
    MarketStore saved(cache.filePath("market-v1.sqlite"));QVERIFY(saved.read("sz000977-capitalSnapshot")["snapshot"].isObject());
  }
  void fundsWidgetOnly() {
    if (qEnvironmentVariableIsSet("NATIVE_LIVE_CORE")) QSKIP("Core suite excludes separately failed funding provider");
    Window w(false);
    w.resize(1600, 1000);
    w.show();
    QTest::qWait(50);
    w.findChild<QPushButton *>("funds")->click();
    auto *d = w.findChild<QWidget *>("fundsPage");
    QVERIFY(d);
    auto *table = d->findChild<QTableWidget *>("fundTable");
    QTest::qWait(16000);
    qInfo() << "funds widget" << w.instrumentId()
            << d->findChild<QComboBox *>("fundSymbols")->currentData()
            << d->findChild<QComboBox *>("fundMode")->currentData()
            << d->findChild<QLabel *>("fundState")->text();
    auto *f = w.findChild<MarketFeed *>();
    for (auto v : f->instruments)
      if (v.toObject()["id"].toString() == w.instrumentId())
        qInfo() << "feed funds"
                << v.toObject()["capitalDayMeta"].toObject()["persistenceState"]
                << v.toObject()["capitalDayMeta"].toObject()["error"]
                << v.toObject()["capitalDay"].toArray().size();
    QVERIFY(table->rowCount() > 0);
    auto out = qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
    QVERIFY(QDir().mkpath(out));
    QVERIFY(w.grab().save(out + "/windows-live-funds.png"));
    w.findChild<QPushButton *>("workspace主页")->click();
  }
  void publicReadOnlyFlow() {
    const QString out = qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
    QVERIFY2(!out.isEmpty(), "An explicit QA screenshot directory is required");
    QTemporaryDir cache;
    QVERIFY(cache.isValid());
    MarketFeed feed(cache.path());
    auto seed = qEnvironmentVariable("NATIVE_LIVE_SEED");
    QVERIFY(!seed.isEmpty());
    feed.importFile(seed);
    QCOMPARE(feed.instruments.size(), 123);
    feed.refreshQuotes();
    auto count = [&] {
      int n = 0;
      for (auto s : feed.instruments)
        if (std::isfinite(
                marketdata::value(s.toObject()["quote"].toObject(), "price")))
          ++n;
      return n;
    };
    QTRY_VERIFY_WITH_TIMEOUT(count() > 0, 25000);
    QTest::qWait(1800);
    qInfo() << "real quote coverage" << count() << "/"
            << feed.instruments.size();
    const auto id = feed.instruments[0].toObject()["id"].toString();
    for (const QString p : {"day", "week", "month", "year", "minute"}) {
      feed.chart(id, p, true);
      QTRY_VERIFY_WITH_TIMEOUT(
          !feed.instruments[0].toObject()[p].toArray().isEmpty(), 25000);
      auto meta = feed.instruments[0].toObject()[p + "Meta"].toObject();
      qInfo() << id << p << feed.instruments[0].toObject()[p].toArray().size()
              << meta["dataDate"] << meta["source"];
      QVERIFY(!meta["cached"].toBool());
      QTRY_COMPARE_WITH_TIMEOUT(feed.instruments[0]
                                    .toObject()[p + "Meta"]
                                    .toObject()["persistenceState"]
                                    .toString(),
                                QString("saved"), 10000);
    }
    if (!qEnvironmentVariableIsSet("NATIVE_LIVE_CORE")) {
    feed.capitalFlow(id, "day", true);
    QTRY_VERIFY_WITH_TIMEOUT(
        !feed.instruments[0].toObject()["capitalDay"].toArray().isEmpty(),
        25000);
    QTRY_COMPARE_WITH_TIMEOUT(feed.instruments[0]
                                  .toObject()["capitalDayMeta"]
                                  .toObject()["persistenceState"]
                                  .toString(),
                              QString("saved"), 10000);
    qInfo() << "funds daily"
            << feed.instruments[0].toObject()["capitalDay"].toArray().size()
            << feed.instruments[0]
                   .toObject()["capitalDayMeta"]
                   .toObject()["dataDate"];
    }
    MarketFeed reloaded(cache.path());
    QCOMPARE(reloaded.instruments.size(), 123);
    QVERIFY(reloaded.instruments[0]
                .toObject()["dayMeta"]
                .toObject()["cached"]
                .toBool());
    QVERIFY(std::isfinite(marketdata::value(
        reloaded.instruments[0].toObject()["quote"].toObject(), "price")));
    for (const QJsonObject extra : {QJsonObject{{"id", "SH:index:000001"},
                                                {"symbol", "sh000001"},
                                                {"name", "上证指数"}},
                                    QJsonObject{{"id", "SH:etf:510300"},
                                                {"symbol", "sh510300"},
                                                {"name", "沪深300ETF"}}}) {
      feed.add(extra);
      feed.refreshQuotes();
      feed.chart(extra["id"].toString(), "day", true);
      QTRY_VERIFY_WITH_TIMEOUT(
          std::isfinite(marketdata::value(
              feed.instruments.last().toObject()["quote"].toObject(),
              "price")) &&
              !feed.instruments.last().toObject()["day"].toArray().isEmpty(),
          25000);
      qInfo() << extra["id"]
              << feed.instruments.last()
                     .toObject()["quote"]
                     .toObject()["tradeDate"];
    }
    MarketFeed uiSeed(
        QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) +
        "/live");
    uiSeed.importFile(seed);
    Window w(false);
    w.resize(1600, 1000);
    w.show();
    QTRY_VERIFY_WITH_TIMEOUT(!w.chart->bars.empty(), 25000);
    QDir().mkpath(out);
    auto *initialDual = w.findChild<QPushButton *>("dualCharts");
    if (initialDual->isChecked()) initialDual->click();
    for (const QString mode : {"quotes", "classic", "focus"}) {
      w.setLayoutMode(mode);
      QTest::qWait(250);
      qInfo() << mode << "price grid" << w.chart->priceRect().size() << "window"
              << w.size();
      QVERIFY(w.grab().save(out + "/windows-live-" + mode + ".png"));
    }
    w.setPeriod("minute");
    QTRY_VERIFY_WITH_TIMEOUT(w.chart->bars.size() == 242, 25000);
    QVERIFY(w.chart->visibleCount > 0);
    QVERIFY(w.grab().save(out + "/windows-live-minute.png"));
    w.setPeriod("day");
    QTRY_VERIFY_WITH_TIMEOUT(w.chart->bars.size() > 300, 25000);
    for (const QString p : {"month", "year"}) {
      w.setPeriod(p);
      QTRY_VERIFY_WITH_TIMEOUT(!w.chart->bars.empty(), 25000);
      QTest::qWait(100);
      QVERIFY(w.grab().save(out + "/windows-live-" + p + ".png"));
    }
    w.setPeriod("day");
    QTRY_VERIFY_WITH_TIMEOUT(w.chart->bars.size() > 300, 25000);
    if (!qEnvironmentVariableIsSet("NATIVE_LIVE_CORE")) {
    w.findChild<QPushButton *>("funds")->click();
    auto *fundDialog = w.findChild<QWidget *>("fundsPage");
    QVERIFY(fundDialog);
    auto *fundTable = fundDialog->findChild<QTableWidget *>("fundTable");
    QTest::qWait(16000);
    qInfo() << "fund UI identity" << w.instrumentId()
            << fundDialog->findChild<QLabel *>("fundState")->text();
    if (fundTable->rowCount() == 0)
      fundDialog->findChild<QPushButton *>("refreshFunds")->click();
    QTRY_VERIFY_WITH_TIMEOUT(fundTable->rowCount() > 0, 25000);
    QVERIFY(w.grab().save(out + "/windows-live-funds.png"));
    w.findChild<QPushButton *>("workspace主页")->click();
    }
    w.findChild<QPushButton *>("auction")->click();
    auto *auctionDialog = w.findChild<QWidget *>("auctionPage");
    QVERIFY(auctionDialog);
    QVERIFY(w.grab().save(out + "/windows-auction-source-boundary.png"));
    w.findChild<QPushButton *>("workspace主页")->click();
    auto *dual = w.findChild<QPushButton *>("dualCharts");
    if (!dual->isChecked()) dual->click();
    QTRY_VERIFY_WITH_TIMEOUT(!w.referenceChart->bars.empty(), 25000);
    QTest::qWait(80);
    QVERIFY(w.referenceChart->isVisible());
    QTest::mouseClick(w.referenceChart, Qt::LeftButton, Qt::NoModifier,
                      QPoint(250, 200));
    QVERIFY(w.explanation->toPlainText().contains("周K"));
    auto *live = w.findChild<MarketFeed *>();
    QVERIFY(live);
    live->updated(w.instrumentId());
    QVERIFY2(w.explanation->toPlainText().contains("周K"),
             "Live refresh must retain inspected reference period");
    QVERIFY(w.grab().save(out + "/windows-live-dual.png"));
    for (const QString mode : {"quotes", "classic", "focus"}) {
      w.resize(1100, 720);
      w.setLayoutMode(mode);
      QTest::qWait(100);
      QVERIFY(w.width() <= 1100);
      QVERIFY(w.grab().save(out + "/windows-live-narrow-" + mode + ".png"));
    }
  }
};
int main(int argc, char **argv) {
  QApplication app(argc, argv);
  app.setOrganizationName("NativeMarketReview");
  app.setApplicationName("LiveConnectionQA");
  QStandardPaths::setTestModeEnabled(true);
  LiveTests tests;
  return QTest::qExec(&tests, argc, argv);
}
#include "live_data_tests.moc"
