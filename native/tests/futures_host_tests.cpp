#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>
#include "window.hpp"
#include "futures_monitor_page.hpp"
namespace {
const QByteArray Payload=R"(var _IF0=([{"d":"2026-10-12 10:01:00","o":"4000","c":"4001","v":"0","p":"100"},{"d":"2026-10-12 10:02:00","c":"4003","v":"5","p":"103"}]);)";
class Reply:public QNetworkReply{
 QByteArray bytes;qint64 at=0;
public:
 Reply(QNetworkRequest r,QObject*p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(ReadOnly);}
 void deliver(QByteArray b,int code=200){bytes=b;setAttribute(QNetworkRequest::HttpStatusCodeAttribute,code);setHeader(QNetworkRequest::ContentTypeHeader,"text/javascript; charset=utf-8");if(code!=200)setError(ContentAccessDenied,"fixture failure");setFinished(true);emit readyRead();emit finished();}
 void abort()override{setError(OperationCanceledError,"fixture cancel");}
 qint64 bytesAvailable()const override{return bytes.size()-at+QNetworkReply::bytesAvailable();}
 qint64 readData(char*d,qint64 n)override{n=qMin(n,bytes.size()-at);if(n<=0)return -1;memcpy(d,bytes.constData()+at,n);at+=n;return n;}
};
class Network:public QNetworkAccessManager{
public:QList<Reply*> replies;QStringList urls;
protected:QNetworkReply*createRequest(Operation,const QNetworkRequest&r,QIODevice*)override{auto*p=new Reply(r,this);replies<<p;urls<<r.url().toString();return p;}
};
}
class FuturesHostTests:public QObject{
 Q_OBJECT
private slots:
 void completeOverviewHeight(){QTemporaryDir dir;FuturesMonitorPage p(dir.filePath("f.sqlite"),{},{});p.resize(1500,900);p.show();QTest::qWait(50);auto* t=p.findChild<QTableWidget*>("futuresOverview");QVERIFY(t);QCOMPARE(t->rowCount(),7);QVERIFY(t->verticalScrollBar()->maximum()==0);}
 void nativeHost(){
  QTemporaryDir dir;Network transport;Window w(true,dir.filePath("settings.ini"),dir.path());w.futuresTestNetwork=&transport;w.resize(1600,1000);w.show();
  QString path=QFileInfo(w.businessStore->filePath()).absolutePath()+"/futures-monitor-v1.sqlite";futuresMonitor::Store store(path);
  for(QString mode:{"quotes","classic","focus"}){w.setLayoutMode(mode);w.futuresMonitorView();QVERIFY(w.pages["futuresMonitor"]->isVisible());QCOMPARE(w.layoutMode(),mode);}
  auto*p=dynamic_cast<FuturesMonitorPage*>(w.pages["futuresMonitor"]);QVERIFY(p);QVERIFY(!QFile::exists(path));QCOMPARE(transport.urls.size(),0);
  auto*refresh=p->findChild<QPushButton*>("futuresRefresh");refresh->click();QCOMPARE(transport.urls.size(),1);QVERIFY(transport.urls[0].contains("symbol=IF0"));transport.replies.last()->deliver(Payload);QTRY_COMPARE(store.history("IF0").size(),1);
  QString id=store.history("IF0")[0].toObject()["id"].toString();auto snapshot=store.read(id);QCOMPARE(snapshot["instrumentId"].toString(),QString("CFFEX:continuous:IF0"));QVERIFY(snapshot["expiry"].isNull());QCOMPARE(snapshot["summary"].toObject()["minutePriceChange"].toDouble(),2.);
  refresh->click();auto*late=transport.replies.last();w.home();late->deliver(Payload);QTest::qWait(30);QCOMPARE(store.history("IF0").size(),1);
  w.futuresMonitorView();refresh->click();transport.replies.last()->deliver({},503);QTest::qWait(30);QCOMPARE(store.history("IF0").size(),1);QVERIFY(p->findChild<QLabel*>("futuresStatus")->text().contains("失败"));
  QVERIFY(p->openSnapshot(id));p->findChild<QPushButton*>("futuresFullDetail")->click();auto state=p->saveState();QVERIFY(QJsonDocument(state).toJson().size()<4096);w.save();w.home();w.futuresMonitorView();p->restoreState(state);QCOMPARE(p->saveState()["view"].toInt(),2);QVERIFY(w.closeInternalReader());QVERIFY(w.closeInternalReader());QVERIFY(!w.closeInternalReader());
  p->openSnapshot(id);for(QString mode:{"quotes","classic","focus"}){w.setLayoutMode(mode);if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v36-futures-"+mode+".png"));}
  w.home();QCOMPARE(transport.urls.size(),3);
 }
 void readProtection(){
  QTemporaryDir dir;auto path=dir.filePath("absent/db.sqlite");futuresMonitor::Store s(path);QCOMPARE(s.history("IF0").size(),0);QVERIFY(!QFileInfo::exists(dir.filePath("absent")));
  auto foreign=dir.filePath("foreign.sqlite");QFile f(foreign);QVERIFY(f.open(QIODevice::WriteOnly));QByteArray raw="invalid foreign sqlite, keep";f.write(raw);f.close();futuresMonitor::Store other(foreign);QVERIFY_EXCEPTION_THROWN(other.history("IF0"),std::runtime_error);QVERIFY(f.open(QIODevice::ReadOnly));QCOMPARE(f.readAll(),raw);
 }
};
QTEST_MAIN(FuturesHostTests)
#include "futures_host_tests.moc"

