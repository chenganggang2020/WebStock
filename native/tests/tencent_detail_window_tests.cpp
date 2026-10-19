#include "window.hpp"
#include "market_overview_page.hpp"
#include "appearance.hpp"
#include <QtWidgets>
#include <QtTest>
#include <QNetworkReply>
#include <QUrlQuery>

namespace {
class Reply final:public QNetworkReply {
 QByteArray bytes;qint64 pos=0;
 public:Reply(QNetworkRequest req,QByteArray bytes,QObject* parent):QNetworkReply(parent),bytes(bytes){setRequest(req);setUrl(req.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);open(QIODevice::ReadOnly);QTimer::singleShot(0,this,[this]{if(isFinished())return;setFinished(true);emit readyRead();emit finished();});}
 void abort()override{if(isFinished())return;setError(OperationCanceledError,"cancelled test request");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return bytes.size()-pos+QNetworkReply::bytesAvailable();}
 qint64 readData(char* target,qint64 n)override{n=qMin(n,bytes.size()-pos);if(n<=0)return -1;memcpy(target,bytes.constData()+pos,size_t(n));pos+=n;return n;}
};
class Network final:public QNetworkAccessManager {
 public:int detailRequests=0;
 protected:QNetworkReply* createRequest(Operation,const QNetworkRequest& req,QIODevice*)override{
  QUrlQuery query(req.url());QByteArray bytes="{}";
  if(query.queryItemValue("appn")=="detail"){
   ++detailRequests;auto symbol=query.queryItemValue("c").toUtf8();
   if(query.queryItemValue("action")=="info")bytes="v_detail_time_"+symbol+"=[20261019,\"09:30:00~09:30:03\"];";
   else bytes="v_detail_data_"+symbol+"=[0,\"0/09:30:00/10/0/1/1000/B|1/09:30:03/11/1/1/1100/B\"];";
  }
  return new Reply(req,bytes,this);
 }
};
}
class TencentDetailWindowTests:public QObject {
 Q_OBJECT
 private slots:
 void mainWindowFiveThirtyAndCancelOnLeaving(){
  QTemporaryDir dir;Network net;Window w(true,dir.filePath("review.ini"),dir.path());
  w.feed=new MarketFeed(dir.filePath("live"),&w,&net,false);
  const QJsonObject row{{"id","SZ:stock:000977"},{"symbol","sz000977"},{"name","浪潮信息"},{"market","SZ"},{"group","默认分组"},{"order",0}};
  w.feed->instruments=QJsonArray{row};w.instruments=w.feed->instruments;
  connect(w.feed,&MarketFeed::updated,&w,[&]{w.syncLive(false);});
  w.resize(1400,900);w.show();w.loadInstrument("SZ:stock:000977",false);
  auto* precision=w.findChild<QComboBox*>("minutePrecision");QVERIFY(precision);precision->setCurrentIndex(precision->findData(5));
  QTRY_VERIFY_WITH_TIMEOUT(w.feed->instruments[0].toObject()["minute5sMeta"].toObject()["writeReceipt"].toObject()["committed"].toBool(),4000);
  QTRY_COMPARE_WITH_TIMEOUT(w.chart->bars.size(),size_t(2882),4000);QCOMPARE(w.chart->bars[0].open,10.);QCOMPARE(w.chart->bars[0].close,11.);
  w.chart->visibleCount=100;w.chart->endIndex=100;w.feed->sample("SZ:stock:000977",5,true);QTest::qWait(350);QCOMPARE(w.chart->visibleCount,100);QCOMPARE(w.chart->endIndex,100);
  precision->setCurrentIndex(precision->findData(30));QTRY_COMPARE_WITH_TIMEOUT(w.chart->bars.size(),size_t(482),4000);
  QVERIFY(precision->currentText().contains("腾讯"));QVERIFY(w.chart->volumeLabel.contains("暂不可用"));
  w.grab().save(QString(TENCENT_OUTPUT)+"/controlled-main-30s.png");
  w.feed->sample("SZ:stock:000977",30,true);QVERIFY(w.feed->detailJob);auto* other=new QWidget(&w);other->setProperty("workspace","研究");w.activatePage(other);QVERIFY(w.feed->detailJob.isNull());
  const auto requests=net.detailRequests;QTest::qWait(150);QCOMPARE(net.detailRequests,requests);w.hide();
 }
 void overviewSecondsUsesSameFeedAndStopsWhenHidden(){
  QTemporaryDir dir;Network net;MarketOverviewPage page(dir.filePath("overview.sqlite"),true,nullptr,&net);page.resize(1400,900);page.show();
  auto* period=page.findChild<QComboBox*>("overviewChartPeriod");QVERIFY(period);period->setCurrentIndex(period->findData("minute5s"));
  auto* chart=page.findChild<Chart*>("overviewIndexChart");QTRY_COMPARE_WITH_TIMEOUT(chart->bars.size(),size_t(2882),5000);
  QCOMPARE(chart->bars[0].open,10.);page.grab().save(QString(TENCENT_OUTPUT)+"/controlled-overview-5s.png");
  auto* feed=page.findChild<MarketFeed*>();QVERIFY(feed);period->setCurrentIndex(period->findData("minute30s"));page.hide();QVERIFY(feed->detailJob.isNull());
  const auto requests=net.detailRequests;QTest::qWait(200);QCOMPARE(net.detailRequests,requests);
 }
};
QTEST_MAIN(TencentDetailWindowTests)
#include "tencent_detail_window_tests.moc"
