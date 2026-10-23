#include "sector_watch_model.hpp"
#include "sector_watch_feed.hpp"
#include "ths_board_public.hpp"
#include "board_series.hpp"
#include "board_series_feed.hpp"
#include <QFile>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QNetworkReply>
#include <cstring>
#include <QtTest>
static QString root=QStringLiteral(REPO_ROOT);
static QString at="2026-10-23T01:00:00+08:00";
static QByteArray fixture(QString name){QFile f(root+"/output/sector-source-alternatives-20261023/"+name+".raw");if(!f.open(QIODevice::ReadOnly))throw std::runtime_error("fixture missing");return f.readAll();}
class ThsReply:public QNetworkReply {
 QByteArray bytes;qint64 offset=0;
public:
 ThsReply(const QNetworkRequest& request,QByteArray body,int status,QObject* parent):QNetworkReply(parent),bytes(body){setRequest(request);setUrl(request.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,status);open(QIODevice::ReadOnly);QTimer::singleShot(10,this,[this]{setFinished(true);emit readyRead();emit finished();});}
 void abort()override{setFinished(true);setError(OperationCanceledError,"cancelled");emit finished();}
 qint64 bytesAvailable()const override{return bytes.size()-offset+QNetworkReply::bytesAvailable();}
 qint64 readData(char* data,qint64 maximum)override{auto n=qMin(maximum,bytes.size()-offset);if(n<=0)return -1;std::memcpy(data,bytes.constData()+offset,size_t(n));offset+=n;return n;}
};
class ThsNetwork:public QNetworkAccessManager {
public:
 QList<QNetworkRequest> requests;bool failOldest=false;
 QNetworkReply* createRequest(Operation,const QNetworkRequest& req,QIODevice*)override{requests.append(req);auto url=req.url();QByteArray body;int status=200;if(url.host()=="q.10jqka.com.cn")body=fixture("ths-photovoltaic");else if(url.path().endsWith("last.js"))body=fixture("ths-pv-last");else if(url.host()=="d.10jqka.com.cn"){auto year=url.fileName().left(4);if(failOldest&&year=="2024")status=403;else body=fixture("ths-pv-day"+year);}else status=599;return new ThsReply(req,body,status,this);}
};
static QJsonObject series(QString period="day"){
 QJsonArray daily,receipts;for(int year=2026;year>=2024;--year){auto bytes=fixture("ths-pv-day"+QString::number(year));auto rows=thsBoard::annual(bytes,"881279",year,at);receipts.append(QJsonObject{{"year",year},{"count",rows.size()},{"url",thsBoard::yearUrl("881279",year).toString()},{"sha256",thsBoard::sha(bytes)}});for(auto v:daily)rows.append(v);daily=rows;}
 return boardSeries::fromThs(daily,receipts,"881279",thsBoard::sha(fixture("ths-photovoltaic")),boardSeries::query("industry","881279",period,640,thsBoard::provider),at,thsBoard::inventory(fixture("ths-pv-last"),"881279",at));
}
class ThsBoardTests:public QObject {
 Q_OBJECT
private slots:
 void independentIdentity(){
  QJsonObject q;QString error;
  try{q=sectorWatch::query("ths-public-board","concept","309121");}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
  QVERIFY2(error.isEmpty(),qPrintable(error));
  QCOMPARE(sectorWatch::queryKey(q),QString("ths-public-board|concept|309121"));
  QVERIFY_EXCEPTION_THROWN(sectorWatch::query("ths-public-board","concept","BK1234"),std::exception);
 }
 void officialCatalogues(){
  try{
  for(auto kind:{QString("industry"),QString("concept")}){auto q=sectorWatch::query(thsBoard::provider,kind);auto bytes=fixture("ths-"+kind);auto s=thsBoard::directory(bytes,q,at,at);QCOMPARE(s["items"].toArray().size(),kind=="industry"?90:361);QVERIFY(s["coverageComplete"].toBool());QVERIFY(!s["quoteComplete"].toBool());for(auto v:s["items"].toArray()){auto row=v.toObject();QCOMPARE(row["provider"].toString(),thsBoard::provider);QVERIFY(row["price"].isNull());QVERIFY(!row["name"].toString().contains(QChar(0xfffd)));}QVERIFY_EXCEPTION_THROWN(thsBoard::directory(bytes.left(bytes.size()/2),q,at,at),std::exception);bytes.replace("target=\"_blank\"", "target=\"broken\"");QVERIFY_EXCEPTION_THROWN(thsBoard::directory(bytes,q,at,at),std::exception);}
  }catch(const std::exception& e){QFAIL(e.what());}
 }
 void directoryIdentityIsNotChartIdentity(){
  QCOMPARE(thsBoard::chartCode(fixture("ths-concept-detail"),"concept","309121"),QString("886071"));
  QCOMPARE(thsBoard::chartCode(fixture("ths-photovoltaic"),"industry","881279"),QString("881279"));
  QVERIFY_EXCEPTION_THROWN(thsBoard::chartCode(fixture("ths-concept-detail"),"concept","309120"),std::exception);
  QVERIFY_EXCEPTION_THROWN(thsBoard::annual(fixture("ths-ai-pc-day2026"),"309121",2026,at),std::exception);
 }
 void exactHistoryAndWindow(){
  auto s=series();QCOMPARE(s["rawCount"].toInt(),640);QCOMPARE(s["fetchedRawCount"].toInt(),677);QCOMPARE(s["rows"].toArray().size(),640);QCOMPARE(s["dataDate"].toString(),QString("2026-10-22"));auto last=s["rows"].toArray().last().toObject();QCOMPARE(last["close"].toDouble(),6209.692);QCOMPARE(s["availability"].toString(),QString("available"));for(auto period:{QString("week"),QString("month")}){auto agg=series(period);QVERIFY(agg["rows"].toArray().size()<640);QCOMPARE(agg["rows"].toArray().last().toObject()["close"],last["close"]);}
 }
 void rejectsCorruptOrForeignHistory(){
  auto bytes=fixture("ths-pv-day2026");QVERIFY_EXCEPTION_THROWN(thsBoard::annual(bytes,"881121",2026,at),std::exception);QVERIFY_EXCEPTION_THROWN(thsBoard::annual(bytes,"881279",2025,at),std::exception);QVERIFY_EXCEPTION_THROWN(thsBoard::annual(bytes,"881279",2026,"2026-01-01T00:00:00Z"),std::exception);QVERIFY_EXCEPTION_THROWN(thsBoard::annual(bytes+"evil()","881279",2026,at),std::exception);bytes.replace("20260106,","20260105,");QVERIFY_EXCEPTION_THROWN(thsBoard::annual(bytes,"881279",2026,at),std::exception);
  auto s=series();auto q=s["query"].toObject();q["provider"]="eastmoney-public-board";s["query"]=q;QVERIFY_EXCEPTION_THROWN(boardSeries::validate(s),std::exception);
 }
 void isolatedCacheAndFailure(){
  QTemporaryDir dir;boardSeries::Cache cache(dir.path());auto s=series(),q=s["query"].toObject();cache.save(s);cache.failure(q,"HTTP 403; no update",at);QCOMPARE(cache.read(q)["series"].toObject(),s);QVERIFY(!cache.read(q)["lastAttempt"].toObject()["error"].toString().isEmpty());QVERIFY(cache.read(boardSeries::query("industry","BK1031")).isEmpty());auto bad=s;bad["sourceReceipts"]=QJsonArray{};QVERIFY_EXCEPTION_THROWN(cache.save(bad),std::exception);QCOMPARE(cache.read(q)["series"].toObject(),s);
 }
 void shortSourceHistoryIsPartial(){
  QJsonArray daily,receipts;for(int year=2026;year>=2024;--year){auto bytes=fixture("ths-ai-pc-day"+QString::number(year));auto rows=thsBoard::annual(bytes,"886071",year,at);receipts.append(QJsonObject{{"year",year},{"count",rows.size()},{"url",thsBoard::yearUrl("886071",year).toString()},{"sha256",thsBoard::sha(bytes)}});for(auto v:daily)rows.append(v);daily=rows;}
  auto q=boardSeries::query("concept","309121","day",640,thsBoard::provider),inventory=thsBoard::inventory(fixture("ths-ai-pc-last"),"886071",at);auto s=boardSeries::fromThs(daily,receipts,"886071",thsBoard::sha(fixture("ths-concept-detail")),q,at,inventory);QCOMPARE(s["rawCount"].toInt(),638);QVERIFY(!s["windowComplete"].toBool());QCOMPARE(s["availability"].toString(),QString("partial"));QCOMPARE(s["sourceInventory"].toObject()["startDate"].toString(),QString("2024-03-05"));daily.removeFirst();QVERIFY_EXCEPTION_THROWN(boardSeries::fromThs(daily,receipts,"886071",thsBoard::sha(fixture("ths-concept-detail")),q,at,inventory),std::exception);
 }
 void unsupportedMembersNeverUseSina(){
  sectorWatch::Feed feed;QVERIFY_EXCEPTION_THROWN(feed.start(sectorWatch::query(thsBoard::provider,"industry","881279")),std::exception);QVERIFY(!feed.busy());
 }
 void transportFailureCancellationAndNoCache(){
  ThsNetwork net;net.failOldest=true;boardSeries::Feed feed(nullptr,&net);QSignalSpy done(&feed,&boardSeries::Feed::finished);auto q=boardSeries::query("industry","881279","day",640,thsBoard::provider);QVERIFY(feed.start(q));QVERIFY(done.wait(1000));auto result=done.takeFirst();QVERIFY(result[1].toJsonObject().isEmpty());QVERIFY(result[2].toString().contains("403"));QCOMPARE(net.requests.size(),5);
  for(auto request:net.requests){QVERIFY(request.url().host().endsWith("10jqka.com.cn"));QCOMPARE(request.attribute(QNetworkRequest::CacheLoadControlAttribute).toInt(),int(QNetworkRequest::AlwaysNetwork));QVERIFY(request.rawHeader("Cookie").isEmpty());}
  net.requests.clear();net.failOldest=false;QVERIFY(feed.start(q));QTRY_VERIFY(net.requests.size()>=3);feed.cancel();QTest::qWait(35);QCOMPARE(done.size(),0);net.requests.clear();QVERIFY(feed.start(q));QVERIFY(done.wait(1000));result=done.takeFirst();QVERIFY2(result[2].toString().isEmpty(),qPrintable(result[2].toString()));QCOMPARE(result[1].toJsonObject()["rawCount"].toInt(),640);
 }
 void missingCategoryGroupRejected(){
  auto bytes=fixture("ths-industry");auto start=bytes.indexOf("<div class=\"cate_items\">");auto end=bytes.indexOf("</div>",start)+6;QVERIFY(start>0&&end>start);bytes.remove(start,end-start);QVERIFY_EXCEPTION_THROWN(thsBoard::directory(bytes,sectorWatch::query(thsBoard::provider,"industry"),at,at),std::exception);
 }
 void cachedDailyIntegrity(){
  auto s=series(),missing=s;auto rows=missing["rows"].toArray();rows.removeFirst();missing["rows"]=rows;QVERIFY_EXCEPTION_THROWN(boardSeries::validate(missing),std::exception);
  auto changed=s;auto inventory=changed["sourceInventory"].toObject(),latest=inventory["latestRow"].toObject();latest["close"]=latest["open"];inventory["latestRow"]=latest;changed["sourceInventory"]=inventory;QVERIFY_EXCEPTION_THROWN(boardSeries::validate(changed),std::exception);
 }
 void newerReceiptCannotRollBackData(){
  auto current=series();QTemporaryDir dir;boardSeries::Cache cache(dir.path());cache.save(current);QJsonArray daily,receipts;auto inventory=thsBoard::inventory(fixture("ths-pv-last"),"881279",at);auto years=inventory["yearCounts"].toObject();years["2026"]=years["2026"].toInt()-1;inventory["yearCounts"]=years;inventory["total"]=inventory["total"].toInt()-1;
  for(int year=2026;year>=2024;--year){auto bytes=fixture("ths-pv-day"+QString::number(year));auto rows=thsBoard::annual(bytes,"881279",year,at);if(year==2026)rows.removeLast();receipts.append(QJsonObject{{"year",year},{"count",rows.size()},{"url",thsBoard::yearUrl("881279",year).toString()},{"sha256",thsBoard::sha(bytes)}});for(auto v:daily)rows.append(v);daily=rows;}
  inventory["latestRow"]=daily.last();inventory["dataDate"]=daily.last().toObject()["date"];auto older=boardSeries::fromThs(daily,receipts,"881279",current["detailSHA256"].toString(),current["query"].toObject(),"2026-10-23T01:01:00+08:00",inventory);QVERIFY_EXCEPTION_THROWN(cache.save(older),std::exception);QCOMPARE(cache.read(current["query"].toObject())["series"].toObject(),current);
 }
 void liveData(){
  if(qEnvironmentVariable("THS_LIVE")!="1")QSKIP("Explicit bounded live run only");QJsonArray results;
  auto output=root+"/output/ths-board-integration-20261023/live-results.json";auto save=[&]{QFile f(output);QVERIFY(f.open(QIODevice::WriteOnly));f.write(QJsonDocument(results).toJson());};
  sectorWatch::Feed catalogFeed;QSignalSpy catalogSpy(&catalogFeed,&sectorWatch::Feed::finished);
  if(qEnvironmentVariable("THS_HISTORY_ONLY")!="1")for(auto kind:{QString("industry"),QString("concept")}){catalogSpy.clear();QVERIFY(catalogFeed.start(sectorWatch::query(thsBoard::provider,kind)));QVERIFY(catalogSpy.wait(10000));auto args=catalogSpy.takeFirst();results.append(QJsonObject{{"kind","catalog"},{"query",args[0].toJsonObject()},{"snapshot",args[1].toJsonObject()},{"error",args[2].toString()}});save();QVERIFY2(args[2].toString().isEmpty(),qPrintable(args[2].toString()));QVERIFY(args[1].toJsonObject()["coverageComplete"].toBool());}
  boardSeries::Feed history;QSignalSpy historySpy(&history,&boardSeries::Feed::finished);
  for(auto sample:{qMakePair(QString("industry"),QString("881279")),qMakePair(QString("industry"),QString("881121")),qMakePair(QString("concept"),QString("309121"))}){historySpy.clear();QVERIFY(history.start(boardSeries::query(sample.first,sample.second,"day",640,thsBoard::provider)));QVERIFY(historySpy.wait(14000));auto args=historySpy.takeFirst();results.append(QJsonObject{{"kind","history"},{"query",args[0].toJsonObject()},{"series",args[1].toJsonObject()},{"error",args[2].toString()}});save();QVERIFY2(args[2].toString().isEmpty(),qPrintable(args[2].toString()));QCOMPARE(args[1].toJsonObject()["rawCount"].toInt(),sample.second=="309121"?638:640);QCOMPARE(args[1].toJsonObject()["dataDate"].toString(),QString("2026-10-22"));}
 }
};
QTEST_GUILESS_MAIN(ThsBoardTests)
#include "ths_board_tests.moc"
