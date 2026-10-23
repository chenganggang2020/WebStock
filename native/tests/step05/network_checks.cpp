#include <QtTest>
#include <QtWidgets>
#include <QtNetwork>
#include <cstring>
#include "global_market_page.hpp"
#include "global_market_cache.hpp"
#include "fixtures.hpp"
#include "font_preflight.hpp"
#include "appearance.hpp"
namespace {
struct Trace{QElapsedTimer clock;QJsonArray callbacks,gaps; qint64 last=0;int reads=0;bool aborted=false;double cancelMs=0;Trace(){clock.start();}};
class Reply final:public QNetworkReply{
 QByteArray body; qint64 pos=0,available=0; bool stopped=false;int part;Trace& trace;std::function<void()> cancel;bool cancelQueued=false;
public:
 Reply(QNetworkRequest r,QObject* parent,QByteArray bytes,int chunk,Trace& t,std::function<void()> action):QNetworkReply(parent),body(std::move(bytes)),part(chunk),trace(t),cancel(std::move(action)){
  setRequest(r);setUrl(r.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);setHeader(QNetworkRequest::ContentTypeHeader,"application/json; charset=utf-8");
  open(QIODevice::ReadOnly);QTimer::singleShot(0,this,[this]{feed();});
 }
 void feed(){if(stopped)return;available=qMin(qint64(body.size()),available+part);QElapsedTimer elapsed;elapsed.start();emit readyRead();trace.callbacks.append(elapsed.nsecsElapsed()/1e6);
  if(cancel&&!cancelQueued&&pos>=262144){cancelQueued=true;QTimer::singleShot(0,this,[this]{QElapsedTimer e;e.start();cancel();trace.cancelMs=e.nsecsElapsed()/1e6;});return;}
  if(stopped)return;if(available==body.size()){setFinished(true);emit finished();}else QTimer::singleShot(1,this,[this]{feed();});
 }
 void abort()override{trace.aborted=true;stopped=true;setFinished(true);}
 qint64 bytesAvailable()const override{return available-pos+QNetworkReply::bytesAvailable();}
 qint64 readData(char* out,qint64 max)override{auto n=qMin(max,available-pos);if(n<=0)return 0;std::memcpy(out,body.constData()+pos,size_t(n));pos+=n;++trace.reads;return n;}
};
class Network final:public QNetworkAccessManager{
public:QByteArray body;int chunk=65536,calls=0;Trace trace;std::function<void()> cancel;
 QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{++calls;return new Reply(r,this,body,chunk,trace,cancel);}
};
bool until(std::function<bool()> test){QElapsedTimer timer;timer.start();while(!test()&&timer.elapsed()<10000){QCoreApplication::processEvents(QEventLoop::AllEvents,2);QTest::qWait(1);}return test();}
}
class NetworkChecks:public QObject{
 Q_OBJECT
 QJsonArray records;
private slots:
 void receive_data(){QTest::addColumn<QString>("mode");for(auto name:{"burst16","stream16","cancelStream","oversize"})QTest::newRow(name)<<QString(name);}
 void receive(){QFETCH(QString,mode);QTemporaryDir temp;QVERIFY(temp.isValid());auto seed=fixture::make("daily64");fixture::write(temp.filePath("global-market-native-v1.json"),seed.bytes);
  Network net;net.body=R"({"chart":{"result":[{"meta":{"symbol":"^IXIC","regularMarketPrice":160,"previousClose":160,"regularMarketTime":1792157460},"timestamp":[1792157400,1792157460],"indicators":{"quote":[{"close":[159,160],"volume":[1000,1001]}]}}]}})";
  net.body.append(QByteArray(16*1024*1024-net.body.size(),' '));if(mode=="oversize")net.body.append(' ');if(mode=="burst16"||mode=="oversize")net.chunk=net.body.size();
  GlobalMarketPage page(temp.path(),true,nullptr,&net);page.setProperty("stockTheme","graphite");page.setPalette(appearance::palette(appearance::theme("graphite")));page.resize(1100,760);
  page.restoreState({{"schema","native-global-market-ui/v1"},{"key","nasdaq-composite"},{"period","daily"},{"automatic",false}});page.show();
  auto* refresh=page.findChild<QPushButton*>("globalRefresh");auto* cancel=page.findChild<QPushButton*>("globalCancel");auto* status=page.findChild<QPlainTextEdit*>("globalStatus");
  QVERIFY(until([&]{return refresh->isEnabled();}));const QJsonValue old=page.sourceEvidence()["series"];
  if(mode=="cancelStream")net.cancel=[&]{cancel->click();};
  QTimer heartbeat;heartbeat.setInterval(5);heartbeat.setTimerType(Qt::PreciseTimer);net.trace.last=net.trace.clock.nsecsElapsed();
  connect(&heartbeat,&QTimer::timeout,[&]{const auto now=net.trace.clock.nsecsElapsed();net.trace.gaps.append((now-net.trace.last)/1e6);net.trace.last=now;});
  heartbeat.start();QElapsedTimer elapsed;elapsed.start();refresh->click();
  QVERIFY(until([&]{return refresh->isEnabled()&&(!net.trace.callbacks.isEmpty());}));double endToEnd=elapsed.nsecsElapsed()/1e6;
  // Cancellation receipts finish on the worker after controls have been released.
  QVERIFY(until([&]{auto a=page.sourceEvidence()["requests"].toArray();return a.size()==1&&a[0].toObject()["receiptState"]=="ready";}));
  QTest::qWait(20);heartbeat.stop();const auto receipt=page.sourceEvidence()["requests"].toArray()[0].toObject();
  const auto output=qEnvironmentVariable("STEP05_NETWORK_OUTPUT");QVERIFY(QDir().mkpath(output));QVERIFY(page.grab().save(output+"/"+mode+".png"));
  QJsonObject record{{"mode",mode},{"callbacksMs",net.trace.callbacks},{"heartbeatGapsMs",net.trace.gaps},{"endToEndMs",endToEnd},{"cancelHandlerMs",net.trace.cancelMs},{"inputBytes",net.body.size()},{"readCalls",net.trace.reads},{"receivedBytes",receipt["bytes"]},{"status",status->toPlainText()},{"requests",net.calls},{"aborted",net.trace.aborted}};
  records.append(record);QCOMPARE(net.calls,1);
  if(mode=="cancelStream"){QVERIFY(net.trace.aborted);QCOMPARE(page.sourceEvidence()["series"],old);QCOMPARE(receipt["bytes"].toInt(),262144);QVERIFY(status->toPlainText().contains("取消"));}
  else if(mode=="oversize"){QCOMPARE(page.sourceEvidence()["series"],old);QVERIFY(status->toPlainText().contains("超过16MiB"));QVERIFY(receipt["bytes"].toInt()<=16*1024*1024);}
  else{QVERIFY(status->toPlainText().startsWith("已更新"));QCOMPARE(receipt["bytes"].toInt(),net.body.size());QCOMPARE(receipt["bodySha256"].toString(),fixture::hash(net.body));QCOMPARE(QByteArray::fromBase64(receipt["payloadBase64"].toString().toLatin1()),net.body);QCOMPARE(page.sourceEvidence()["series"].toObject()["candles"].toArray().size(),1);}
 }
 void cleanupTestCase(){fixture::write(qEnvironmentVariable("STEP05_NETWORK_OUTPUT")+"/report.json",QJsonDocument(QJsonObject{{"records",records},{"note","Controlled reply; padded valid JSON at 16MiB. No artificial sleep inside readData. Streaming feeds 64KiB per timer turn. No public network."}}).toJson());}
};
int main(int argc,char** argv){QApplication app(argc,argv);QApplication::setStyle("Fusion");QJsonObject proof;try{fontCheck::prepare(app,fontCheck::load(),proof);}catch(const std::exception& e){qCritical()<<e.what();return 2;}NetworkChecks checks;return QTest::qExec(&checks,argc,argv);}
#include "network_checks.moc"
