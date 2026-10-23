#include "window.hpp"
#include "global_market_page.hpp"
#include "../step05/fixtures.hpp"
#include "../step05/font_preflight.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QtNetwork>
#include <cstring>
namespace {
QString output(){return qEnvironmentVariable("STEP06_OUTPUT");}
bool until(std::function<bool()> p){QElapsedTimer t;t.start();while(!p()&&t.elapsed()<10000){QCoreApplication::processEvents(QEventLoop::AllEvents,2);QTest::qWait(1);}return p();}
struct Trace{int calls=0,aborts=0,lateDelivered=0;};
class Reply:public QNetworkReply{
 QByteArray body=R"({"chart":{"result":[{"meta":{"symbol":"^IXIC","regularMarketPrice":160,"regularMarketTime":1792157460},"timestamp":[1792157400],"indicators":{"quote":[{"close":[160],"volume":[1001]}]}}]}})";qint64 pos=0;bool released=false;Trace& trace;
public:
 Reply(QNetworkRequest request,QObject* parent,Trace& t):QNetworkReply(parent),trace(t){setRequest(request);setUrl(request.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);setHeader(QNetworkRequest::ContentTypeHeader,"application/json");open(QIODevice::ReadOnly);}
 void abort()override{++trace.aborts;setFinished(true);}
 void late(){++trace.lateDelivered;released=true;emit readyRead();setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return (released?body.size()-pos:0)+QNetworkReply::bytesAvailable();}
 qint64 readData(char* out,qint64 max)override{if(!released)return 0;auto n=qMin(max,body.size()-pos);if(n<=0)return -1;std::memcpy(out,body.constData()+pos,size_t(n));pos+=n;return n;}
};
class Network:public QNetworkAccessManager{public:Trace trace;QPointer<Reply> reply;
 QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{++trace.calls;reply=new Reply(r,this,trace);return reply;}
};
}
class NetworkHostChecks:public QObject{
 Q_OBJECT
 QJsonArray results;
private slots:
 void lifecycle_data(){QTest::addColumn<QString>("mode");for(auto m:{"hideLate","cancelHideLate","closeBusy","automaticHidden"})QTest::newRow(m)<<QString(m);}
 void lifecycle(){QFETCH(QString,mode);QTemporaryDir dir;QVERIFY(dir.isValid());auto seed=fixture::make("daily64");fixture::write(dir.filePath("global-market-native-v1.json"),seed.bytes);Network net;
  Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1280,900);w.show();QTest::qWait(30);auto* tabs=w.findChild<QTabWidget*>("workspaceTabs");QVERIFY(tabs);auto* home=tabs->currentWidget();
  // Only the external transport is substituted. Use the real Window tab host
  // and real page hide/show/close behavior without modifying production hooks.
  auto* p=new GlobalMarketPage(dir.path(),true,tabs,&net);p->setProperty("workspace","主页");p->setProperty("pageTitle","全球行情 / VIX");tabs->addTab(p,"全球行情");
  p->restoreState({{"schema","native-global-market-ui/v1"},{"key",seed.key},{"period","daily"},{"automatic",false},{"visibleCount",64},{"endIndex",64}});tabs->setCurrentWidget(p);
  auto* refresh=p->findChild<QPushButton*>("globalRefresh");auto* cancel=p->findChild<QPushButton*>("globalCancel");auto* automatic=p->findChild<QCheckBox*>("globalAutomatic");auto* timer=p->findChild<QTimer*>("globalAutomaticTimer");auto* status=p->findChild<QPlainTextEdit*>("globalStatus");
  QVERIFY(until([&]{return refresh->isEnabled();}));const QJsonValue before=p->sourceEvidence()["series"];auto view=p->saveState();
  if(mode=="automaticHidden")automatic->setChecked(true);
  QTest::mouseClick(refresh,Qt::LeftButton);QCOMPARE(net.trace.calls,1);QVERIFY(cancel->isEnabled());QVERIFY(net.reply);QVERIFY(w.grab().save(output()+"/"+mode+"-before.png"));
  // Deliver a queued stale response immediately after cancel/hide, before
  // DeferredDelete can retire the reply. The transport must ignore it.
  if(mode=="cancelHideLate")QTest::mouseClick(cancel,Qt::LeftButton);
  if(mode=="closeBusy"){w.close();QVERIFY(until([&]{return !w.isVisible();}));}
  else tabs->setCurrentWidget(home);
  QVERIFY(!p->isVisible());QVERIFY(!timer->isActive());QVERIFY(net.trace.aborts>=1);
  if(net.reply)net.reply->late();
  QVERIFY(until([&]{auto a=p->sourceEvidence()["requests"].toArray();return a.size()==1&&a[0].toObject()["receiptState"]=="ready";}));QTest::qWait(160);
  QCOMPARE(net.trace.calls,1);QCOMPARE(p->sourceEvidence()["series"],before);QCOMPARE(fixture::read(dir.filePath("global-market-native-v1.json")),seed.bytes);
  if(mode!="closeBusy"){tabs->setCurrentWidget(p);if(mode=="automaticHidden"){QVERIFY(timer->isActive());automatic->setChecked(false);}QTest::qWait(30);QVERIFY(refresh->isEnabled());QVERIFY(!cancel->isEnabled());QVERIFY(!status->toPlainText().contains("正在刷新"));QCOMPARE(p->saveState(),view);QVERIFY(w.grab().save(output()+"/"+mode+"-after.png"));w.close();QVERIFY(until([&]{return !w.isVisible();}));}
  results.append(QJsonObject{{"mode",mode},{"requests",net.trace.calls},{"aborts",net.trace.aborts},{"lateDelivered",net.trace.lateDelivered},{"cacheUnchanged",true},{"seriesUnchanged",true},{"status",status->toPlainText()}});
 }
 void cleanupTestCase(){fixture::write(output()+"/network-report.json",QJsonDocument(QJsonObject{{"results",results},{"boundary","Real Window tab host; online page constructed with controlled network instead of default offline test-mode page. Default navigation and persisted restart are covered separately."}}).toJson());}
};
int main(int argc,char** argv){QApplication app(argc,argv);app.setQuitOnLastWindowClosed(false);QApplication::setStyle("Fusion");QJsonObject proof;try{fontCheck::prepare(app,fontCheck::load(),proof);NetworkHostChecks tests;return QTest::qExec(&tests,argc,argv);}catch(const std::exception&e){qCritical()<<e.what();return 20;}}
#include "network_host_checks.moc"
