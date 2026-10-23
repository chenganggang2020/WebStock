#include <QtTest>
#include <QtWidgets>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include "global_market_cache.hpp"
#include "global_market_model.hpp"
#include "global_market_page.hpp"
namespace {
class HeldReply:public QNetworkReply{
public:
 int* cancelled;
 HeldReply(const QNetworkRequest& r,QObject* parent,int* count):QNetworkReply(parent),cancelled(count){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}
 void abort()override{if(isFinished())return;++*cancelled;setError(OperationCanceledError,"controlled cancellation");setFinished(true);emit finished();}
 void late(){emit readyRead();emit finished();}
 qint64 readData(char*,qint64)override{return -1;}
};
class Network:public QNetworkAccessManager{
public:int calls=0,cancelled=0;QList<QPointer<HeldReply>> replies;
 QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{++calls;auto* reply=new HeldReply(r,this,&cancelled);replies<<reply;return reply;}
};
void seed(const QString& dir){
 globalMarket::Cache cache(dir);
 for(auto key:{QString("nasdaq-composite"),QString("sp500")}){
  QJsonArray points;for(int i=0;i<60;++i)points.append(QJsonObject{{"time",double(1792157400000LL+i*60000)},{"close",(key=="sp500"?500.:100.)+i},{"volume",1000}});
  QJsonObject series{{"key",key},{"symbol",globalMarket::definition(key)["symbol"]},{"period","intraday"},{"points",points},{"sessionDate","2026-10-16"},{"zone","America/New_York"},{"source","隔离验证样本"},{"interval","1m"}};
  cache.apply(key,"intraday",series,{},{},"2026-10-16T15:10:00Z");
 }
}
void setup(GlobalMarketPage& p){p.restoreState({{"schema","native-global-market-ui/v1"},{"key","nasdaq-composite"},{"period","intraday"},{"automatic",false}});p.resize(1280,820);p.show();}
QPushButton* button(GlobalMarketPage& p,const char* name){return p.findChild<QPushButton*>(name);}
QString status(GlobalMarketPage& p){return p.findChild<QPlainTextEdit*>("globalStatus")->toPlainText();}
QByteArray disk(const QString& dir){QFile f(dir+"/global-market-native-v1.json");if(!f.open(QIODevice::ReadOnly))return {};return f.readAll();}
void shot(GlobalMarketPage& p,const QString& name){auto dir=qEnvironmentVariable("STEP03_SHOTS");if(dir.isEmpty())return;QDir().mkpath(dir);QCoreApplication::processEvents();p.grab().save(dir+"/"+name+".png");}
}
class Step03RefreshControlTests:public QObject{
 Q_OBJECT
private slots:
 void firstVisibleLoadImmediatelyRefreshesWhenAutomatic(){
  QTemporaryDir dir;seed(dir.path());Network net;GlobalMarketPage p(dir.path(),true,nullptr,&net);
  p.restoreState({{"schema","native-global-market-ui/v1"},{"key","nasdaq-composite"},{"period","intraday"},{"automatic",true}});p.show();
  QTRY_VERIFY_WITH_TIMEOUT(net.calls>0,1500);p.hide();
 }
 void pauseBeforeDispatch(){
  QTemporaryDir dir;seed(dir.path());Network net;GlobalMarketPage p(dir.path(),true,nullptr,&net);setup(p);
  QTRY_VERIFY(button(p,"globalRefresh")->isEnabled());
  auto automatic=p.findChild<QCheckBox*>("globalAutomatic");automatic->setChecked(true);
  p.findChild<QComboBox*>("globalInstrument")->setCurrentIndex(3);
  automatic->setChecked(false);QTest::qWait(200);shot(p,"paused-before-dispatch");
  QCOMPARE(net.calls,0);QVERIFY(!p.findChild<QTimer*>("globalAutomaticTimer")->isActive());
  QVERIFY2(status(p).contains("暂停"),qPrintable(status(p)));
 }
 void slowRefreshCanCancelWithoutWriting(){
  QTemporaryDir dir;seed(dir.path());Network net;GlobalMarketPage p(dir.path(),true,nullptr,&net);setup(p);
  QTRY_VERIFY(button(p,"globalRefresh")->isEnabled());auto before=disk(dir.path());
  button(p,"globalRefresh")->click();QTRY_VERIFY(net.calls>0);
  int ticks=0;QTimer tick;connect(&tick,&QTimer::timeout,[&]{++ticks;});tick.start(10);QTest::qWait(100);
  QVERIFY(ticks>=3);QVERIFY(!button(p,"globalRefresh")->isEnabled());QVERIFY(button(p,"globalCancel")->isEnabled());
  QVERIFY(p.findChild<QComboBox*>("globalInstrument")->isEnabled());shot(p,"waiting-can-cancel");
  button(p,"globalCancel")->click();for(auto r:net.replies)if(r)r->late();
  QTRY_VERIFY(button(p,"globalRefresh")->isEnabled());QTest::qWait(100);shot(p,"cancelled");
  QCOMPARE(net.cancelled,net.calls);QCOMPARE(disk(dir.path()),before);QVERIFY(status(p).contains("已取消"));
  QVERIFY(!button(p,"globalCancel")->isEnabled());
  qInfo()<<"GUI timer ticks during 100ms held request:"<<ticks;
 }
 void switchRejectsOldReply(){
  QTemporaryDir dir;seed(dir.path());Network net;GlobalMarketPage p(dir.path(),true,nullptr,&net);setup(p);
  QTRY_VERIFY(button(p,"globalRefresh")->isEnabled());auto before=disk(dir.path());button(p,"globalRefresh")->click();QTRY_VERIFY(net.calls>0);
  auto select=p.findChild<QComboBox*>("globalInstrument");select->setCurrentIndex(select->findData("sp500"));
  for(auto r:net.replies)if(r)r->late();QTest::qWait(150);shot(p,"switched-during-request");
  QCOMPARE(net.cancelled,net.calls);QCOMPARE(disk(dir.path()),before);
  QCOMPARE(p.sourceEvidence()["series"].toObject()["key"].toString(),QString("sp500"));
  QVERIFY(button(p,"globalRefresh")->isEnabled());
 }
 void hideRejectsOldReplyAndCanReturn(){
  QTemporaryDir dir;seed(dir.path());Network net;GlobalMarketPage p(dir.path(),true,nullptr,&net);setup(p);
  QTRY_VERIFY(button(p,"globalRefresh")->isEnabled());auto before=disk(dir.path());button(p,"globalRefresh")->click();QTRY_VERIFY(net.calls>0);
  p.hide();for(auto r:net.replies)if(r)r->late();QTest::qWait(100);
  QCOMPARE(net.cancelled,net.calls);QCOMPARE(disk(dir.path()),before);
  p.show();QTRY_VERIFY(button(p,"globalRefresh")->isEnabled());shot(p,"returned-after-cancel");
  QVERIFY2(!status(p).contains("正在刷新"),qPrintable(status(p)));
 }
 void pauseDoesNotAbortManualRequest(){
  QTemporaryDir dir;seed(dir.path());Network net;GlobalMarketPage p(dir.path(),true,nullptr,&net);setup(p);
  QTRY_VERIFY(button(p,"globalRefresh")->isEnabled());button(p,"globalRefresh")->click();QTRY_VERIFY(net.calls>0);
  auto automatic=p.findChild<QCheckBox*>("globalAutomatic");automatic->setChecked(true);automatic->setChecked(false);
  QCOMPARE(net.cancelled,0);QVERIFY(button(p,"globalCancel")->isEnabled());
  QVERIFY(!p.findChild<QTimer*>("globalAutomaticTimer")->isActive());
  button(p,"globalCancel")->click();QTRY_VERIFY(button(p,"globalRefresh")->isEnabled());
 }
};
QTEST_MAIN(Step03RefreshControlTests)
#include "step03_refresh_control_tests.moc"
