#include "window.hpp"
#include "market_store.hpp"
#include "legacy_highfreq_page.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>

class UnavailableReply : public QNetworkReply {
 public:
  UnavailableReply(const QNetworkRequest& request,QObject* parent):QNetworkReply(parent){
    setRequest(request);setUrl(request.url());open(QIODevice::ReadOnly);
    setError(ContentAccessDenied,"Private test denies all real network");
    QTimer::singleShot(0,this,[this]{setFinished(true);emit finished();});
  }
  void abort()override{setFinished(true);}
  qint64 readData(char*,qint64)override{return -1;}
};
class UnavailableNetwork : public QNetworkAccessManager {
 protected:
  QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{
    return new UnavailableReply(r,this);
  }
};

class SecondsChartStateTests : public QObject {
  Q_OBJECT
  QJsonObject savedInstrument() {
    MarketStore store("G:/Stock/data/live/market-v1.sqlite");
    QJsonObject row{{"id","SZ:stock:000977"},{"symbol","sz000977"},
                    {"name","浪潮信息"},{"market","SZ"},{"group","默认分组"},{"order",0}};
    row["quote"]=store.read("sz000977-quote");
    for(const auto& p:{QString("minute"),QString("day"),QString("week")}) {
      auto packet=store.read("sz000977-"+p);
      row[p]=packet["rows"]; row[p+"Meta"]=packet;
    }
    return row;
  }
private slots:
  void emptySeriesHidesIndicatorAndRestoresItWithData() {
    Chart chart;chart.resize(1000,700);chart.show();
    chart.setSeries({{1,10,11,9,10,100,true,true}}, {"09:30"}, true);
    auto* indicator=chart.findChild<QComboBox*>("chartIndicatorSelector");
    QVERIFY(indicator);QVERIFY(indicator->isVisible());
    chart.setSeries({}, {}, true);
    QVERIFY2(indicator->isHidden(),"The indicator must not float on an empty chart");
    chart.setSeries({{1,NAN,NAN,NAN,NAN,NAN,false,false}}, {"09:30"}, true);
    QVERIFY(indicator->isHidden());
    chart.setSeries({{1,10,11,9,10,100,true,true}}, {"09:30"}, true);
    QVERIFY(indicator->isVisible());
  }
  void selectedSecondsExplainsMissingDataAndCanReturnToMinute() {
    QTemporaryDir dir;QDir().mkpath(dir.filePath("legacy-archive"));
    QVERIFY(QFile::copy(QString(SECONDS_OUTPUT)+"/history-subset.sqlite",dir.filePath("legacy-archive/webstock-snapshot.sqlite")));
    QVERIFY(QFile::copy("G:/Stock/data/securities-legacy-v1.sqlite",dir.filePath("securities-legacy-v1.sqlite")));
    Window w(true,dir.filePath("settings.ini"),dir.path());
    auto row=savedInstrument();QVERIFY(row["minute"].toArray().size()>200);
    w.instruments=QJsonArray{row};w.loadInstrument(row["id"].toString());
    w.resize(1440,960);w.show();w.setPeriod("minute");
    auto minute=w.chart->bars;QVERIFY(!minute.empty());
    auto* precision=w.findChild<QComboBox*>("minutePrecision");QVERIFY(precision);
    precision->setCurrentIndex(2);
    QCOMPARE(w.period,QString("minute30s"));QVERIFY(w.chart->bars.empty());
    auto* message=w.chart->findChild<QLabel*>("chartEmptyMessage");
    QVERIFY2(message,"The selected stock needs a contextual empty state");
    QVERIFY(message->isVisible());QVERIFY(message->text().contains("浪潮信息"));
    QVERIFY(message->text().contains("30秒"));
    const auto expectedDate=row["quote"].toObject()["tradeDate"].toString();
    QVERIFY(!expectedDate.isEmpty());QVERIFY(message->text().contains(expectedDate));
    QVERIFY(!message->text().contains("请选择自选"));
    QVERIFY(w.chartReadout->text().contains("30秒"));
    QVERIFY(w.chart->findChild<QComboBox*>("chartIndicatorSelector")->isHidden());
    auto* back=w.chart->findChild<QPushButton*>("chartEmptyMinute");
    auto* history=w.chart->findChild<QPushButton*>("chartEmptySecondsHistory");
    QVERIFY(back&&back->isVisible());QVERIFY(history&&history->isVisible());
    w.grab().save(QString(SECONDS_OUTPUT)+"/missing-30s.png");
    back->click();QCOMPARE(w.period,QString("minute"));QCOMPARE(precision->currentData().toInt(),0);
    QCOMPARE(w.chart->bars.size(),minute.size());
    QCOMPARE(w.chart->bars.back().time,minute.back().time);
    QVERIFY(w.chart->findChild<QComboBox*>("chartIndicatorSelector")->isVisible());
    QVERIFY(!message->isVisible());
    w.grab().save(QString(SECONDS_OUTPUT)+"/restored-minute.png");
    precision->setCurrentIndex(2);history->click();
    auto* page=qobject_cast<LegacyHighFrequencyPage*>(w.pages.value("legacyHighFrequency"));
    QVERIFY(page);
    QTRY_COMPARE_WITH_TIMEOUT(page->sourceEvidence()["packet"].toObject()["id"].toString(),QString("SZ:stock:000977"),10000);
    QCOMPARE(page->sourceEvidence()["packet"].toObject()["tradingDate"].toString(),QString("2026-10-14"));
    page->findChild<QPushButton*>("legacyHighFrequencyOpenMain")->click();
    QCOMPARE(w.legacyHighFrequencyFrame["intervalSeconds"].toInt(),30);
    QVERIFY(w.chart->bars.size()>=500);QVERIFY(!message->isVisible());
    w.grab().save(QString(SECONDS_OUTPUT)+"/real-history-on-main.png");
    w.findChild<QPushButton*>("legacyHighFrequencyReturnCurrent")->click();
    QVERIFY(w.legacyHighFrequencyFrame.isEmpty());QCOMPARE(w.period,QString("minute30s"));
    QVERIFY(message->isVisible());back->click();QCOMPARE(w.chart->bars.size(),minute.size());
    precision->setCurrentIndex(1);QVERIFY(message->text().contains("5秒"));
    w.instruments[0]=QJsonObject{{"id","SH:index:000001"},{"symbol","sh000001"},{"name","上证指数"}};
    w.loadInstrument("SH:index:000001");
    QVERIFY(message->text().contains("上证指数"));QVERIFY(!message->text().contains("浪潮信息"));
  }
  void explicitHistoryKeepsStockIdentityDateAndInterval() {
    LegacyHighFrequencyPage page(QString(SECONDS_OUTPUT)+"/history-subset.sqlite",
                                "G:/Stock/data/securities-legacy-v1.sqlite");
    page.resize(1300,900);page.show();
    page.restoreState({{"schema","native-legacy-highfreq-ui/v1"},{"id","SZ:stock:000977"},
                       {"code","000977"},{"date","2026-10-14"},{"seconds",30}});
    QTRY_COMPARE_WITH_TIMEOUT(page.sourceEvidence()["packet"].toObject()["id"].toString(),QString("SZ:stock:000977"),30000);
    auto packet=page.sourceEvidence()["packet"].toObject();
    QCOMPARE(packet["tradingDate"].toString(),QString("2026-10-14"));
    QCOMPARE(packet["intervalSeconds"].toInt(),30);QCOMPARE(packet["rows"].toArray().size(),500);
    page.grab().save(QString(SECONDS_OUTPUT)+"/real-history-30s.png");
    page.restoreState({{"schema","native-legacy-highfreq-ui/v1"},{"id","SH:index:000001"},
                       {"code","000001"},{"seconds",30}});
    QTRY_VERIFY_WITH_TIMEOUT(!page.sourceEvidence()["busy"].toBool(),30000);
    QVERIFY2(page.sourceEvidence()["packet"].toObject().isEmpty(),"An index must not silently show same-code SZ stock history");
    QVERIFY(!page.findChild<QPushButton*>("legacyHighFrequencyOpenMain")->isEnabled());
  }
  void refreshActuallyAttemptsSelectedSecondsMode() {
    QTemporaryDir dir;UnavailableNetwork unavailable;
    Window w(true,dir.filePath("settings.ini"),dir.path());
    auto row=savedInstrument();w.instruments=QJsonArray{row};w.loadInstrument(row["id"].toString());
    w.feed=new MarketFeed(dir.filePath("private-feed"),&w,&unavailable,false);
    w.feed->instruments=w.instruments;
    for(int seconds:{5,30}){
      row.remove("samplingStatus");w.feed->instruments=QJsonArray{row};
      w.period=QString("minute%1s").arg(seconds);w.refreshLive();
      QTRY_VERIFY_WITH_TIMEOUT(!w.feed->instruments[0].toObject()["samplingStatus"].toString().isEmpty(),3000);
    }
  }
};
QTEST_MAIN(SecondsChartStateTests)
#include "seconds_chart_state_tests.moc"
