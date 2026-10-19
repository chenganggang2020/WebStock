#include "market_feed.hpp"
#include <QtTest>
#include <QNetworkReply>
#include <QUrlQuery>

namespace {
class Reply final : public QNetworkReply {
 QByteArray body; qint64 position=0;
public:
 Reply(const QNetworkRequest& req,QByteArray bytes,int delay,bool fail,QObject* parent)
  :QNetworkReply(parent),body(bytes){
  setRequest(req);setUrl(req.url());open(QIODevice::ReadOnly);
  QTimer::singleShot(delay,this,[this,fail]{if(isFinished())return;
   setAttribute(QNetworkRequest::HttpStatusCodeAttribute,fail?503:200);
   if(fail)setError(ServiceUnavailableError,"source unavailable");
   setFinished(true);emit readyRead();emit finished();});
 }
 void abort()override{if(isFinished())return;setError(OperationCanceledError,"cancelled");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return body.size()-position+QNetworkReply::bytesAvailable();}
 qint64 readData(char* out,qint64 count)override{count=qMin(count,body.size()-position);if(count<=0)return -1;memcpy(out,body.constData()+position,size_t(count));position+=count;return count;}
};
class Network final : public QNetworkAccessManager {
public:int delay=100,requests=0;bool fail=false;
protected:
 QNetworkReply* createRequest(Operation,const QNetworkRequest& req,QIODevice*)override{
  ++requests;auto q=QUrlQuery(req.url());auto symbol=q.queryItemValue("c").toUtf8();
  auto body=q.queryItemValue("action")=="info"
    ?"v_detail_time_"+symbol+"=[20261019,\"09:30:00~09:30:03\"];"
    :"v_detail_data_"+symbol+"=[0,\"0/09:30:00/10/0/1/1000/B|1/09:30:03/11/1/1/1100/B\"];";
  return new Reply(req,body,delay,fail,this);
 }
};
const QJsonObject identity{{"id","SZ:stock:000977"},{"symbol","sz000977"},{"name","浪潮信息"}};
QJsonObject meta(MarketFeed& f){return f.instruments[0].toObject()["minute5sMeta"].toObject();}
}
class QRepairFeedTests : public QObject {
 Q_OBJECT
private slots:
 void loadingIsNotReportedAsMissingAndFinishesReady(){
  QTemporaryDir dir;Network net;MarketFeed f(dir.path(),nullptr,&net,false);f.instruments={identity};
  f.sample(identity["id"].toString(),5,true);
  QCOMPARE(meta(f)["requestState"].toString(),QString("loading"));
  QTRY_COMPARE_WITH_TIMEOUT(meta(f)["requestState"].toString(),QString("ready"),5000);
  QTRY_VERIFY_WITH_TIMEOUT(meta(f)["writeReceipt"].toObject()["committed"].toBool(),5000);
  QCOMPARE(f.instruments[0].toObject()["minute5s"].toArray().size(),2882);
  QVERIFY(meta(f)["error"].toString().isEmpty());
 }
 void failureRetainsPreviouslyLoadedSeries(){
  QTemporaryDir dir;Network net;MarketFeed f(dir.path(),nullptr,&net,false);f.instruments={identity};
  f.sample(identity["id"].toString(),5,true);
  QTRY_VERIFY_WITH_TIMEOUT(meta(f)["writeReceipt"].toObject()["committed"].toBool(),5000);
  const auto old=f.instruments[0].toObject()["minute5s"];
  net.fail=true;f.sample(identity["id"].toString(),5,true);
  QCOMPARE(meta(f)["requestState"].toString(),QString("loading"));
  QTRY_COMPARE_WITH_TIMEOUT(meta(f)["requestState"].toString(),QString("failed"),3000);
  QCOMPARE(f.instruments[0].toObject()["minute5s"],old);
  QVERIFY(!meta(f)["error"].toString().isEmpty());
 }
 void cancellationClearsLoadingAndRejectsLateCompletion(){
  QTemporaryDir dir;Network net;net.delay=350;MarketFeed f(dir.path(),nullptr,&net,false);f.instruments={identity};
  f.sample(identity["id"].toString(),5,true);
  QCOMPARE(meta(f)["requestState"].toString(),QString("loading"));
  QTest::qWait(20);f.cancelSamples();
  QVERIFY(meta(f)["requestState"]!="loading");const auto requests=net.requests;
  QTest::qWait(450);QCOMPARE(net.requests,requests);
  QVERIFY(f.instruments[0].toObject()["minute5s"].toArray().isEmpty());
 }
};
QTEST_GUILESS_MAIN(QRepairFeedTests)
#include "q_repair_feed_tests.moc"
