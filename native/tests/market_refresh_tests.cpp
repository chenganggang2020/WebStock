#include "global_market_page.hpp"
#include "market_overview_page.hpp"
#include "market_refresh_policy.hpp"
#include "global_market_model.hpp"
#include "chart.hpp"
#include "market_feed.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QTemporaryDir>
namespace {
class Reply:public QNetworkReply {
 QByteArray bytes; qint64 offset=0;
public:
 Reply(QNetworkRequest req,QByteArray data,QObject* parent):QNetworkReply(parent),bytes(data){setRequest(req);setUrl(req.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);open(QIODevice::ReadOnly|QIODevice::Unbuffered);QTimer::singleShot(0,this,[this]{if(isFinished())return;emit readyRead();if(isFinished())return;setFinished(true);emit finished();});}
 void abort()override{if(isFinished())return;setError(OperationCanceledError,"cancelled fixture");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return bytes.size()-offset+QNetworkReply::bytesAvailable();}
 qint64 readData(char* out,qint64 n)override{n=std::min(n,qint64(bytes.size())-offset);if(n<=0)return -1;memcpy(out,bytes.constData()+offset,size_t(n));offset+=n;return n;}
};
class Network:public QNetworkAccessManager {
public:QStringList urls;bool broken=false;bool networkOnly=true;
 QNetworkReply* createRequest(Operation,const QNetworkRequest& req,QIODevice*)override{
  urls<<req.url().toString();networkOnly&=req.attribute(QNetworkRequest::CacheLoadControlAttribute).toInt()==QNetworkRequest::AlwaysNetwork;QByteArray data;
  if(broken)return new Reply(req,"{broken",this);
  if(req.url().host().contains("yahoo")){
   QString symbol=QUrl::fromPercentEncoding(req.url().path().section('/',-1).toUtf8());
   QJsonObject result{{"meta",QJsonObject{{"symbol",symbol},{"regularMarketPrice",101},{"regularMarketTime",1792112400}}},{"timestamp",QJsonArray{1792026000,1792112400}},{"indicators",QJsonObject{{"quote",QJsonArray{QJsonObject{{"open",QJsonArray{100,100}},{"high",QJsonArray{102,102}},{"low",QJsonArray{99,99}},{"close",QJsonArray{100,101}},{"volume",QJsonArray{1000,1200}}}}}}}};
   data=QJsonDocument(QJsonObject{{"chart",QJsonObject{{"result",QJsonArray{result}},{"error",QJsonValue::Null}}}}).toJson(QJsonDocument::Compact);
  }else if(req.url().host()=="hq.sinajs.cn")data="var hq_str_s_sh000001=\"Index,3700,0,0,10,200\";";
  else if(req.url().host().contains("eastmoney"))data="{\"rc\":0,\"data\":{\"total\":1,\"diff\":[{\"f12\":\"BK1001\",\"f14\":\"Board\",\"f3\":1,\"f6\":100,\"f62\":null}]}}";
  else if(req.url().host().contains("gtimg")){auto symbol=QUrlQuery(req.url()).queryItemValue("code");if(symbol.isEmpty())symbol=QUrlQuery(req.url()).queryItemValue("param").section(',',0,0);data=QJsonDocument(QJsonObject{{"code",0},{"data",QJsonObject{{symbol,QJsonObject{{"data",QJsonObject{{"date","20261019"},{"data",QJsonArray{"0930 3700 100","0931 3701 200"}}}},{"qt",QJsonObject{}}}}}}}).toJson(QJsonDocument::Compact);}
  else data="[{\"symbol\":\"sh600000\",\"name\":\"Stock\",\"trade\":10,\"changepercent\":1}]";
  return new Reply(req,data,this);
 }
};
}
class MarketRefreshChecks:public QObject {
 Q_OBJECT
private slots:
 void regionalClocksAndBackoff(){
  auto at=[](QString text){return QDateTime::fromString(text,Qt::ISODate);};
  QVERIFY(marketRefresh::chinaSession(at("2026-10-19T01:45:00Z")));QVERIFY(!marketRefresh::chinaSession(at("2026-10-19T04:00:00Z")));QVERIFY(!marketRefresh::chinaSession(at("2026-10-18T01:45:00Z")));
  const auto nasdaq=globalMarket::definition("nasdaq-composite"),tokyo=globalMarket::definition("nikkei225");
  QVERIFY(!marketRefresh::session(nasdaq,at("2026-10-19T01:45:00Z")));QVERIFY(marketRefresh::session(tokyo,at("2026-10-19T01:45:00Z")));
  QCOMPARE(marketRefresh::globalInterval(nasdaq,"daily",at("2026-10-19T01:45:00Z")),900000);
  QVERIFY(marketRefresh::session(nasdaq,at("2026-10-19T14:00:00Z")));QVERIFY(marketRefresh::session(nasdaq,at("2026-12-21T15:00:00Z")));
  QCOMPARE(marketRefresh::globalInterval(nasdaq,"intraday",at("2026-10-19T14:00:00Z")),30000);QVERIFY(marketRefresh::globalInterval(nasdaq,"intraday",at("2026-10-19T14:00:00Z"),3)>=240000);
 }
 void globalEntryAndSelectionFetchWithoutClick(){QTemporaryDir dir;Network net;GlobalMarketPage page(dir.path(),true,nullptr,&net);page.resize(1100,760);page.show();page.activateWindow();QTRY_VERIFY_WITH_TIMEOUT(QApplication::activeWindow()==&page,2000);auto choice=page.findChild<QComboBox*>("globalInstrument");choice->setCurrentIndex(choice->findData("nasdaq-composite"));QTRY_VERIFY_WITH_TIMEOUT(!net.urls.isEmpty(),2500);QTRY_VERIFY_WITH_TIMEOUT(!page.sourceEvidence()["series"].toObject().isEmpty(),2500);QCOMPARE(page.sourceEvidence()["series"].toObject()["key"].toString(),QString("nasdaq-composite"));const int before=net.urls.size();choice->setCurrentIndex(choice->findData("dow-jones"));QTRY_VERIFY_WITH_TIMEOUT(net.urls.size()>before,2500);QTRY_COMPARE_WITH_TIMEOUT(page.sourceEvidence()["series"].toObject()["key"].toString(),QString("dow-jones"),2500);page.hide();const int hidden=net.urls.size();QTest::qWait(200);QCOMPARE(net.urls.size(),hidden);}
 void defaultAutomaticSurvivesOldStateRestore(){QTemporaryDir dir;Network net;GlobalMarketPage page(dir.path(),true,nullptr,&net);auto state=page.saveState();state.remove("automatic");page.restoreState(state);QVERIFY(page.findChild<QCheckBox*>("globalAutomatic")->isChecked());}
 void globalTimerRenewsAndExplicitPausePersists(){QTemporaryDir dir;Network net;GlobalMarketPage page(dir.path(),true,nullptr,&net);page.show();auto choice=page.findChild<QComboBox*>("globalInstrument");choice->setCurrentIndex(choice->findData("nasdaq-composite"));auto timer=page.findChild<QTimer*>("globalAutomaticTimer");QVERIFY(timer);QTRY_VERIFY_WITH_TIMEOUT(!page.sourceEvidence()["series"].toObject().isEmpty(),3000);QVERIFY(timer->isActive());const int count=net.urls.size();timer->start(1);QTRY_VERIFY_WITH_TIMEOUT(net.urls.size()>count,2500);QTRY_VERIFY_WITH_TIMEOUT(timer->isActive(),2500);page.findChild<QCheckBox*>("globalAutomatic")->setChecked(false);QVERIFY(!timer->isActive());auto state=page.saveState();page.restoreState(state);QVERIFY(!page.findChild<QCheckBox*>("globalAutomatic")->isChecked());}
 void globalFailureKeepsDatedHistoryAndForcedNetwork(){QTemporaryDir dir;Network net;GlobalMarketPage page(dir.path(),true,nullptr,&net);page.show();auto choice=page.findChild<QComboBox*>("globalInstrument");choice->setCurrentIndex(choice->findData("nasdaq-composite"));QTRY_VERIFY_WITH_TIMEOUT(!page.sourceEvidence()["series"].toObject().isEmpty(),3000);auto old=page.sourceEvidence()["series"].toObject();net.broken=true;page.findChild<QPushButton*>("globalRefresh")->click();QTRY_VERIFY_WITH_TIMEOUT(page.findChild<QPlainTextEdit*>("globalStatus")->toPlainText().contains("未成功"),3000);QCOMPARE(page.sourceEvidence()["series"].toObject(),old);QVERIFY(net.networkOnly);QVERIFY(page.findChild<QTimer*>("globalAutomaticTimer")->isActive());}
 void overviewTimerRenewsAndForceUpdatesChart(){QTemporaryDir dir;Network net;MarketOverviewPage page(dir.filePath("overview.sqlite"),true,nullptr,&net);page.resize(1200,800);page.show();auto timer=page.findChild<QTimer*>("overviewAutomaticTimer");QVERIFY(timer);QTRY_VERIFY_WITH_TIMEOUT(!page.sourceEvidence()["attempt"].toObject().isEmpty(),4000);QTRY_VERIFY_WITH_TIMEOUT(timer->isActive(),3000);const int count=net.urls.size();timer->start(1);QTest::qWait(80);QVERIFY(timer->isActive());QCOMPARE(net.urls.size(),count);auto refresh=page.findChild<QPushButton*>("overviewRefresh");QTRY_VERIFY(refresh->isEnabled());refresh->click();QTRY_VERIFY_WITH_TIMEOUT(net.urls.size()>count,3000);QTRY_VERIFY_WITH_TIMEOUT(refresh->isEnabled(),3000);QVERIFY(timer->isActive());page.hide();QVERIFY(!timer->isActive());}
 void sameIndexReloadKeepsDailyViewport(){QTemporaryDir dir;MarketOverviewPage page(dir.filePath("overview.sqlite"),false);page.show();QTRY_VERIFY(!page.findChild<QPushButton*>("overviewCancel")->isEnabled());auto feed=page.findChild<MarketFeed*>();QVERIFY(feed);auto instrument=feed->instruments[0].toObject();QJsonArray rows;for(int i=0;i<120;++i)rows.append(QJsonObject{{"time",double(1700000000000LL+i*86400000LL)},{"open",100.},{"high",102.},{"low",99.},{"close",101.},{"volume",1000.},{"valid",true},{"closed",true}});instrument["day"]=rows;feed->instruments[0]=instrument;auto period=page.findChild<QComboBox*>("overviewChartPeriod");period->setCurrentIndex(period->findData("day"));auto chart=page.findChild<Chart*>("overviewIndexChart");QCOMPARE(chart->bars.size(),size_t(120));chart->visibleCount=12;chart->endIndex=50;page.hide();page.show();QTRY_VERIFY(!page.findChild<QPushButton*>("overviewCancel")->isEnabled());QCOMPARE(chart->visibleCount,12);QCOMPARE(chart->endIndex,50);}
 void overviewHasTopThumbnailsAndNoBottomTables(){QTemporaryDir dir;MarketOverviewPage page(dir.filePath("overview.sqlite"),false);page.resize(1400,900);page.show();QTRY_VERIFY_WITH_TIMEOUT(!page.findChild<QPushButton*>("overviewCancel")->isEnabled(),2500);auto cards=page.findChildren<QAbstractButton*>(QRegularExpression("^overviewThumbnail_"));QCOMPARE(cards.size(),8);for(auto card:cards)QVERIFY(card->isVisible());QVERIFY(!page.findChild<QTableWidget*>("overviewIndices")->isVisible());QVERIFY(!page.findChild<QTableWidget*>("overviewSampleRisk")->isVisible());QVERIFY(!page.findChild<QWidget*>("overviewBoardTools")->isVisible());auto chart=page.findChild<QWidget*>("overviewIndexChart");QVERIFY(chart->height()>page.height()/2);auto choice=page.findChild<QComboBox*>("overviewIndexChoice");cards.last()->click();QVERIFY(choice->currentIndex()!=0);page.grab().save(QString(REFRESH_OUTPUT)+"/overview-layout.png");}
};
QTEST_MAIN(MarketRefreshChecks)
#include "market_refresh_tests.moc"
