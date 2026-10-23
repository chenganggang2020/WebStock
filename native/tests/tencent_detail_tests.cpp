#include "tencent_detail.hpp"
#include "market_feed.hpp"
#include <QtTest>
#include <QJsonArray>
#include <QNetworkReply>
#include <QTimer>
#include <QTemporaryDir>

class DetailReply : public QNetworkReply {
 QByteArray data; qint64 pos=0;
 public:
 DetailReply(const QNetworkRequest& request,QByteArray body,int status,QObject* parent):QNetworkReply(parent),data(std::move(body)){
  setRequest(request);setUrl(request.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,status);open(QIODevice::ReadOnly);
  QTimer::singleShot(0,this,[this]{setFinished(true);emit readyRead();emit finished();});
 }
 void abort()override{if(isFinished())return;setError(OperationCanceledError,"cancelled");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return data.size()-pos+QNetworkReply::bytesAvailable();}
 protected:qint64 readData(char* target,qint64 max)override{auto n=qMin(max,data.size()-pos);if(n<=0)return -1;memcpy(target,data.constData()+pos,size_t(n));pos+=n;return n;}
};
class DetailNetwork : public QNetworkAccessManager {
 public:QList<QPair<QByteArray,int>> responses;QList<QUrl> urls;
 protected:QNetworkReply* createRequest(Operation,const QNetworkRequest& request,QIODevice*)override{
  urls.append(request.url());auto response=responses.isEmpty()?qMakePair(QByteArray(),500):responses.takeFirst();return new DetailReply(request,response.first,response.second,this);
 }
};

class TencentDetailTests : public QObject {
 Q_OBJECT
 const QDateTime now=QDateTime::fromString("2026-10-19T15:30:00+08:00",Qt::ISODate);
 const QByteArray data="v_detail_data_sz000977=[0,\"0/09:25:00/10/0/100/100000/B|1/09:30:00/10/0/1/1000/B|2/09:30:03/12/2/1/1200/S|3/09:30:03/9/-3/1/900/B|4/09:30:12/11/2/1/1100/B|5/13:00:03/13/2/1/1300/B\"];";
 QJsonObject snapshot()const{return {{"symbol","sz000977"},{"dataDate","2026-10-19"},{"pages",QJsonArray{QJsonObject{{"text",QString::fromLatin1(data)}}}},{"paginationComplete",true}};}
 QByteArray fullPage()const{QStringList rows;for(int i=0;i<70;++i)rows<<QString("%1/%2/10/0/1/1000/B").arg(i).arg(QTime(9,30).addSecs(i*3).toString("HH:mm:ss"));return "v_detail_data_sz000977=[0,\""+rows.join('|').toUtf8()+"\"];";}
 QByteArray directory(bool grown)const{return "v_detail_time_sz000977=[20261019,\"09:30:00~09:33:27|09:33:30~"+QByteArray(grown?"09:33:33":"09:33:30")+"\"];";}
 private slots:
 void exactMarketAndTypeIdentity(){
  QCOMPARE(tencentDetail::symbol({{"id","SZ:stock:000977"},{"symbol","sz000977"}}),QString("sz000977"));
  QCOMPARE(tencentDetail::symbol({{"id","SH:index:000001"},{"symbol","sh000001"}}),QString("sh000001"));
  QVERIFY_EXCEPTION_THROWN(tencentDetail::symbol({{"id","SH:index:000001"},{"symbol","sz000001"}}),std::exception);
  QVERIFY_EXCEPTION_THROWN(tencentDetail::symbol({{"id","SZ:stock:000977"},{"symbol","sz000977&x=1"}}),std::exception);
 }
 void sourceIdentityAndDateAreStrict(){
  auto parsed=tencentDetail::info("v_detail_time_sz000977=[20261019,\"09:25:00~09:30:00\"];","sz000977",now);
  QCOMPARE(parsed["dataDate"].toString(),QString("2026-10-19"));
  QVERIFY_EXCEPTION_THROWN(tencentDetail::info({},"sz000977",now),std::exception);
  QVERIFY_EXCEPTION_THROWN(tencentDetail::info("v_detail_time_sh000001=[20261019,\"09:25:00~09:30:00\"];","sz000001",now),std::exception);
  QVERIFY_EXCEPTION_THROWN(tencentDetail::info("v_detail_time_sz000977=[20261020,\"09:25:00~09:30:00\"];","sz000977",now),std::exception);
 }
 void pagesRejectInvalidNumbersAndPageNumbers(){
  QCOMPARE(tencentDetail::page(data,"sz000977",0,"2026-10-19",now).size(),6);
  QVERIFY_EXCEPTION_THROWN(tencentDetail::page(data,"sz000977",1,"2026-10-19",now),std::exception);
  auto invalid=data;invalid.replace("/12/2/","/NaN/2/");
  QVERIFY_EXCEPTION_THROWN(tencentDetail::page(invalid,"sz000977",0,"2026-10-19",now),std::exception);
 }
 void fullDayAxisRealPriceRangeNoInventedVolume(){
  auto five=tencentDetail::series(snapshot(),5,now);auto rows=five["rows"].toArray();
  QCOMPARE(rows.size(),2882);auto first=rows[0].toObject();
  QCOMPARE(first["open"].toDouble(),10.);QCOMPARE(first["high"].toDouble(),12.);QCOMPARE(first["low"].toDouble(),9.);QCOMPARE(first["close"].toDouble(),9.);
  QVERIFY(first["volume"].isNull());QVERIFY(!rows[1].toObject()["valid"].toBool());
  QVERIFY(rows[1].toObject()["close"].isNull());QCOMPARE(rows[2].toObject()["close"].toDouble(),11.);
  QCOMPARE(rows[1441].toObject()["label"].toString(),QString("2026-10-19 13:00:00"));
  auto thirty=tencentDetail::series(snapshot(),30,now)["rows"].toArray();QCOMPARE(thirty.size(),482);QCOMPARE(thirty[0].toObject()["close"].toDouble(),11.);
  QCOMPARE(five["dataDate"].toString(),QString("2026-10-19"));QVERIFY(!five["definition"].toString().isEmpty());
 }
 void gapsDuplicatesAndFutureRecordsRejectWholeBatch(){
  for(auto pair:{qMakePair(QByteArray("2/09:30:03"),QByteArray("1/09:30:03")),qMakePair(QByteArray("2/09:30:03"),QByteArray("8/09:30:03"))}){
   auto broken=data;broken.replace(pair.first,pair.second);auto s=snapshot();s["pages"]=QJsonArray{QJsonObject{{"text",QString::fromLatin1(broken)}}};
   QVERIFY_EXCEPTION_THROWN(tencentDetail::series(s,5,now),std::exception);
  }
  QVERIFY_EXCEPTION_THROWN(tencentDetail::page(data,"sz000977",0,"2026-10-19",QDateTime::fromString("2026-10-19T09:30:10+08:00",Qt::ISODate)),std::exception);
 }
 void growingTailAcceptedAsPrefixThenOnlyTailReloaded(){
  DetailNetwork net;const QByteArray tail="v_detail_data_sz000977=[1,\"70/09:33:30/11/1/1/1100/B\"];";
  net.responses={{directory(false),200},{fullPage(),200},{tail,200},{directory(true),200}};
  QJsonObject first;QString failure;QObject* job=tencentDetail::fetch(&net,this,"sz000977",5,{},QJsonValue(),[&](QJsonObject r,QString e){first=r;failure=e;},[this]{return now;});
  QTRY_VERIFY_WITH_TIMEOUT(!first.isEmpty()||!failure.isEmpty(),2000);QVERIFY2(failure.isEmpty(),qPrintable(failure));
  QCOMPARE(first["rawRecordCount"].toInt(),71);QVERIFY(!first["paginationComplete"].toBool());QCOMPARE(net.urls.size(),4);delete job;
  const QByteArray grown="v_detail_data_sz000977=[1,\"70/09:33:30/11/1/1/1100/B|71/09:33:33/12/1/1/1200/B\"];";
  net.urls.clear();net.responses={{directory(true),200},{grown,200},{directory(true),200}};QJsonObject second;
  job=tencentDetail::fetch(&net,this,"sz000977",30,first["detailSnapshot"].toObject(),QJsonValue(),[&](QJsonObject r,QString e){second=r;failure=e;},[this]{return now;});
  QTRY_VERIFY_WITH_TIMEOUT(!second.isEmpty()||!failure.isEmpty(),2000);QVERIFY2(failure.isEmpty(),qPrintable(failure));
  QCOMPARE(second["rawRecordCount"].toInt(),72);QVERIFY(second["paginationComplete"].toBool());QCOMPARE(net.urls.size(),3);delete job;
 }
 void refusalDoesNotRetryAndCancellationDoesNotComplete(){
  DetailNetwork net;net.responses={{"forbidden",403}};QString failure;bool done=false;
  QObject* job=tencentDetail::fetch(&net,this,"sz000977",5,{},QJsonValue(),[&](QJsonObject r,QString e){done=true;QVERIFY(r.isEmpty());failure=e;},[this]{return now;});
  QTRY_VERIFY_WITH_TIMEOUT(done,1000);QVERIFY(failure.contains("403"));QCOMPARE(net.urls.size(),1);delete job;
  done=false;net.responses={{directory(true),200}};job=tencentDetail::fetch(&net,this,"sz000977",5,{},QJsonValue(),[&](QJsonObject,QString){done=true;},[this]{return now;});delete job;QTest::qWait(100);QVERIFY(!done);
 }
 void actualFeedBackfillsAndPersistsWithoutDuplicateRequests(){
  QTemporaryDir dir;DetailNetwork net;const QByteArray info="v_detail_time_sz000977=[20261019,\"09:30:00~09:30:03\"];";
  const QByteArray prices="v_detail_data_sz000977=[0,\"0/09:30:00/10/0/1/1000/B|1/09:30:03/11/1/1/1100/B\"];";
  net.responses={{info,200},{prices,200},{info,200}};
  MarketFeed feed(dir.path(),this,&net,false);feed.instruments=QJsonArray{QJsonObject{{"id","SZ:stock:000977"},{"symbol","sz000977"},{"name","浪潮信息"}}};
  feed.sample("SZ:stock:000977",5);feed.sample("SZ:stock:000977",5);
  QTRY_COMPARE_WITH_TIMEOUT(feed.instruments[0].toObject()["minute5sMeta"].toObject()["provider"].toString(),QString("tencent-public-detail"),2000);
  QTRY_VERIFY_WITH_TIMEOUT(feed.persistenceStats()["idle"].toBool(),3000);
  QCOMPARE(net.urls.size(),3);auto result=feed.instruments[0].toObject()["minute5sMeta"].toObject();
  QVERIFY(result["writeReceipt"].toObject()["committed"].toBool());QCOMPARE(result["rows"].toArray()[0].toObject()["open"].toDouble(),10.);
  MarketFeed restored(dir.path(),this,&net,false);restored.observe({{"id","SZ:stock:000977"},{"symbol","sz000977"},{"name","浪潮信息"}});
  QCOMPARE(restored.instruments[0].toObject()["minute5sMeta"].toObject()["provider"].toString(),QString("tencent-public-detail"));
 }
 void emptyIndexKeepsSavedRowsAndBacksOff(){
  QTemporaryDir dir;DetailNetwork net;net.responses={{QByteArray(),200}};MarketFeed feed(dir.path(),this,&net,false);
  const QJsonArray old{QJsonObject{{"valid",true},{"close",3700.}}};
  feed.instruments=QJsonArray{QJsonObject{{"id","SH:index:000001"},{"symbol","sh000001"},{"minute5s",old},{"minute5sMeta",QJsonObject{{"source","prior observation"},{"dataDate","2026-10-16"}}}}};
  feed.sample("SH:index:000001",5);QTRY_VERIFY_WITH_TIMEOUT(!feed.instruments[0].toObject()["minute5sMeta"].toObject()["error"].toString().isEmpty(),1500);
  QCOMPARE(feed.instruments[0].toObject()["minute5s"].toArray(),old);QCOMPARE(feed.instruments[0].toObject()["minute5sMeta"].toObject()["dataDate"].toString(),QString("2026-10-16"));
  feed.sample("SH:index:000001",5);QTest::qWait(100);QCOMPARE(net.urls.size(),1);QCOMPARE(feed.persistenceStats()["accepted"].toInt(),0);
 }
 void cancellingOrSwitchingIdentityDiscardsLatePage(){
  QTemporaryDir dir;DetailNetwork net;const QByteArray info="v_detail_time_sz000977=[20261019,\"09:30:00~09:30:03\"];";net.responses={{info,200}};
  MarketFeed feed(dir.path(),this,&net,false);feed.instruments=QJsonArray{QJsonObject{{"id","SZ:stock:000977"},{"symbol","sz000977"}}};
  feed.sample("SZ:stock:000977",5);QTRY_COMPARE_WITH_TIMEOUT(net.urls.size(),1,500);feed.cancelSamples();QTest::qWait(150);QCOMPARE(net.urls.size(),1);QCOMPARE(feed.persistenceStats()["accepted"].toInt(),0);
  feed.sample("SZ:stock:000977",5);feed.stopPersistence();QTest::qWait(100);QCOMPARE(net.urls.size(),1);
 }
};
QTEST_GUILESS_MAIN(TencentDetailTests)
#include "tencent_detail_tests.moc"
