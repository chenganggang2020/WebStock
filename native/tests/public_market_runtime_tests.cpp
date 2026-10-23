#include "public_market_runtime.hpp"
#include "global_market_session.hpp"
#include <QtTest>
#include <QTemporaryDir>
#include <QNetworkReply>

class FailedReply final:public QNetworkReply {
public:
 FailedReply(QNetworkRequest request,QObject* parent):QNetworkReply(parent){setRequest(request);setUrl(request.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,503);open(QIODevice::ReadOnly);QTimer::singleShot(0,this,[this]{if(isFinished())return;setError(ServiceUnavailableError,"source unavailable");setFinished(true);emit finished();});}
 void abort()override{if(isFinished())return;setFinished(true);setError(OperationCanceledError,"cancelled");emit finished();}
protected:qint64 readData(char*,qint64)override{return -1;}
};
class FailedNetwork final:public QNetworkAccessManager {
public:int calls=0;
protected:QNetworkReply* createRequest(Operation,const QNetworkRequest& request,QIODevice*)override{++calls;return new FailedReply(request,this);}
};
class RuntimeTests:public QObject {
 Q_OBJECT
private slots:
 void liveSourceEvidence(){
  const auto output=qEnvironmentVariable("NEW_MARKET_EVIDENCE");QVERIFY(!output.isEmpty());GlobalMarketTransport transport;bool done=false;QJsonObject received;
  transport.start("china-a50-future","intraday",[&](QJsonObject series,QJsonObject quote,QStringList errors){received={{"series",series},{"quote",quote},{"errors",QJsonArray::fromStringList(errors)}};done=true;});
  QTRY_VERIFY_WITH_TIMEOUT(done,15000);received["requests"]=transport.responses();received["actualSourceRequest"]=true;
  const auto series=received["series"].toObject();received["axis"]=globalMarket::intradaySession(series);received["dataAsOf"]=globalMarket::lastDataTime(series);
  globalMarket::Cache cache(output+"/qa-profile");QStringList errors;for(auto v:received["errors"].toArray())errors<<v.toString();cache.apply("china-a50-future","intraday",series,received["quote"].toObject(),errors,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
  QFile file(output+"/global-live-receipt.json");QVERIFY(file.open(QIODevice::WriteOnly));file.write(QJsonDocument(received).toJson());
  QVERIFY2(!series.isEmpty(),qPrintable(errors.join("; ")));QVERIFY(!received["axis"].toObject().isEmpty());
 }
 void collectsWithoutOpeningPageAndPreservesFailures(){
  QTemporaryDir dir;FailedNetwork network;PublicMarketRuntime runtime(dir.path(),true,nullptr,&network);
  int overview=0,global=0;runtime.updated=[&](QString source){if(source=="overview")++overview;else ++global;};
  QTRY_COMPARE_WITH_TIMEOUT(overview,1,15000);QVERIFY(network.calls>=4);
  const auto saved=marketOverview::Store(dir.filePath("market-overview-v1.sqlite")).read();
  QVERIFY(!saved["snapshot"].toObject().isEmpty());for(auto v:saved["snapshot"].toObject()["sections"].toObject())QCOMPARE(v.toObject()["availability"].toString(),QString("unavailable"));
  QTRY_VERIFY_WITH_TIMEOUT(global>=1,15000);const auto evidence=runtime.evidence()["lastAttempt"].toObject();QVERIFY(!evidence["available"].toBool());
  const auto snapshot=globalMarket::Cache(dir.path()).snapshot();QVERIFY(snapshot["series"].toObject().isEmpty());QVERIFY(!snapshot["attempts"].toObject().isEmpty());
  runtime.stop();const auto count=network.calls;QTest::qWait(1200);QCOMPARE(network.calls,count);
 }
};
QTEST_GUILESS_MAIN(RuntimeTests)
#include "public_market_runtime_tests.moc"
