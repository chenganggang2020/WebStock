#include "window.hpp"
#include "market_comparison_page.hpp"
#include <QtWidgets>
#include <QtTest>
#include <QNetworkReply>
#include <QUrlQuery>

namespace {
class RepairReply final : public QNetworkReply {
 QByteArray bytes;qint64 pos=0;
public:
 RepairReply(QNetworkRequest req,QByteArray value,int delay,QObject* parent):QNetworkReply(parent),bytes(value){
  setRequest(req);setUrl(req.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);open(QIODevice::ReadOnly);
  QTimer::singleShot(delay,this,[this]{if(isFinished())return;setFinished(true);emit readyRead();emit finished();});
 }
 void abort()override{if(isFinished())return;setError(OperationCanceledError,"cancelled");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return bytes.size()-pos+QNetworkReply::bytesAvailable();}
 qint64 readData(char* target,qint64 count)override{count=qMin(count,bytes.size()-pos);if(count<=0)return -1;memcpy(target,bytes.constData()+pos,size_t(count));pos+=count;return count;}
};
class RepairNetwork final : public QNetworkAccessManager {
public:int requests=0;
protected:
 QNetworkReply* createRequest(Operation,const QNetworkRequest& req,QIODevice*)override{
  ++requests;QUrlQuery q(req.url());auto symbol=q.queryItemValue("c").toUtf8();QByteArray body="{}";
  if(q.queryItemValue("appn")=="detail")body=q.queryItemValue("action")=="info"
   ?"v_detail_time_"+symbol+"=[20261019,\"09:30:00~09:30:03\"];"
   :"v_detail_data_"+symbol+"=[0,\"0/09:30:00/10/0/1/1000/B|1/09:30:03/11/1/1/1100/B\"];";
  return new RepairReply(req,body,150,this);
 }
};
}
class QRepairWindowTests : public QObject {
 Q_OBJECT
private slots:
 void comparisonDisplaysCurrentDayFromActualEightIndexReport(){
  QFile file(QString(Q_REPAIR_OUTPUT)+"/live-comparison.json");QVERIFY(file.open(QIODevice::ReadOnly));
  const auto report=QJsonDocument::fromJson(file.readAll()).object()["report"].toObject();
  QTemporaryDir dir;MarketComparisonPage page(dir.path(),{},false);page.resize(1600,900);page.show();QTest::qWait(80);
  page.render(report);const auto frame=page.sourceEvidence()["comparisonFrame"].toObject();
  QCOMPARE(frame["series"].toArray().size(),8);
  QCOMPARE(frame["dates"].toArray().last().toString(),QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date().toString(Qt::ISODate));
  for(auto line:frame["series"].toArray())QCOMPARE(line.toObject()["values"].toArray().size(),60);
  QVERIFY(page.grab().save(QString(Q_REPAIR_OUTPUT)+"/comparison-current-day.png"));
 }
 void calendarActualProviderHistoryRendersMonthAndYear(){
  QTemporaryDir dir;Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1440,900);w.show();
  for(const auto& symbol:QStringList{"sz002463","sz000977","sh600000","sh000001"}){
   QFile file(QString(Q_REPAIR_OUTPUT)+"/"+symbol+"-month.json");QVERIFY2(file.open(QIODevice::ReadOnly),qPrintable(file.fileName()));
   auto monthly=marketdata::kline(QJsonDocument::fromJson(file.readAll()).object(),symbol,"month",QDateTime::currentDateTimeUtc());
   const auto id=symbol.startsWith("sh")?(symbol=="sh000001"?"SH:index:000001":"SH:stock:600000"):(symbol=="sz002463"?"SZ:stock:002463":"SZ:stock:000977");
   auto year=marketdata::aggregateCalendar(monthly,"year",QDateTime::currentDateTimeUtc());
   QJsonObject item{{"id",id},{"symbol",symbol},{"name",symbol},{"month",monthly["rows"]},{"monthMeta",monthly},{"year",year["rows"]},{"yearMeta",year}};
   w.instruments={item};w.period="month";w.loadInstrument(id,true);QTest::qWait(40);
   QCOMPARE(w.chart->bars.size(),size_t(monthly["rows"].toArray().size()));
   for(const auto& bar:w.chart->bars)QVERIFY(market::valid(bar));
   QVERIFY(w.chart->selected>=0);w.chart->grab().save(QString(Q_REPAIR_OUTPUT)+"/"+symbol+"-monthly.png");
   w.setPeriod("year");QCOMPARE(w.chart->bars.size(),size_t(year["rows"].toArray().size()));
   for(const auto& bar:w.chart->bars)QVERIFY(market::valid(bar));
   QVERIFY(w.chart->selected>=0);w.chart->grab().save(QString(Q_REPAIR_OUTPUT)+"/"+symbol+"-yearly.png");
  }
 }
 void delayedSecondsLoadingCompletesWithoutAnotherClick(){
  QTemporaryDir dir;RepairNetwork net;Window w(true,dir.filePath("review.ini"),dir.path());
  w.feed=new MarketFeed(dir.filePath("live"),&w,&net,false);
  const QJsonObject item{{"id","SZ:stock:000977"},{"symbol","sz000977"},{"name","浪潮信息"},{"market","SZ"},{"group","默认分组"},{"order",0}};
  w.feed->instruments={item};w.instruments={item};connect(w.feed,&MarketFeed::updated,&w,[&]{w.syncLive(false);});
  w.resize(1440,900);w.show();w.loadInstrument("SZ:stock:000977",false);
  auto* precision=w.findChild<QComboBox*>("minutePrecision");QVERIFY(precision);precision->setCurrentIndex(precision->findData(5));
  auto* message=w.chart->findChild<QLabel*>("chartEmptyMessage");QVERIFY(message);
  QVERIFY(message->text().contains("载入")||message->text().contains("加载"));QVERIFY(!message->text().contains("暂无"));
  QTRY_COMPARE_WITH_TIMEOUT(w.chart->bars.size(),size_t(2882),5000);QVERIFY(market::valid(w.chart->bars[0]));
  w.grab().save(QString(Q_REPAIR_OUTPUT)+"/seconds-ready.png");
  precision->setCurrentIndex(precision->findData(30));QTRY_COMPARE_WITH_TIMEOUT(w.chart->bars.size(),size_t(482),5000);
  auto* other=new QWidget(&w);other->setProperty("workspace","研究");w.activatePage(other);QVERIFY(w.feed->detailJob.isNull());
 }
};
QTEST_MAIN(QRepairWindowTests)
#include "q_repair_window_tests.moc"
