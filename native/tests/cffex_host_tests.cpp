#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>
#include "window.hpp"
#include "cffex_disclosure_page.hpp"
#include "cffex_disclosure_transport.hpp"
#include "cffex_disclosure_model.hpp"
namespace {
QByteArray fixture(){QFile file(qEnvironmentVariable("NATIVE_CFFEX_FIXTURE"));if(!file.open(QIODevice::ReadOnly))throw std::runtime_error("fixture unavailable");return file.readAll();}
class Reply:public QNetworkReply {
 QByteArray bytes;qint64 at=0;
public:
 bool aborted=false;
 Reply(QNetworkRequest r,QObject*p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(ReadOnly);}
 void deliver(QByteArray b,int code=200){bytes=b;setAttribute(QNetworkRequest::HttpStatusCodeAttribute,code);setFinished(true);emit readyRead();emit finished();}
 void header(QNetworkRequest::KnownHeaders k,QVariant v){setHeader(k,v);}
 void encoding(QByteArray e){setRawHeader("Content-Encoding",e);}
 void finalUrl(QUrl u){setUrl(u);}
 void abort()override{aborted=true;setError(OperationCanceledError,"fixture cancellation");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return bytes.size()-at+QNetworkReply::bytesAvailable();}
 qint64 readData(char*out,qint64 n)override{n=qMin(n,bytes.size()-at);if(n<=0)return -1;memcpy(out,bytes.constData()+at,n);at+=n;return n;}
};
class Network:public QNetworkAccessManager {
protected:QNetworkReply*createRequest(Operation,const QNetworkRequest&r,QIODevice*)override{auto*p=new Reply(r,this);replies<<p;return p;}
public:QList<Reply*> replies;
};
}
class CffexHostTests:public QObject {
 Q_OBJECT
private slots:
 void internalEntry(){
  QTemporaryDir dir;Network network;Window w(true,dir.filePath("settings.ini"),dir.path());w.cffexTestNetwork=&network;w.resize(1600,1000);w.show();w.etfDailyView();
  auto*entry=w.findChild<QPushButton*>("openCffexDisclosure");QVERIFY(entry);entry->click();auto*p=dynamic_cast<cffexDisclosure::Page*>(w.pages.value("cffexDisclosure"));QVERIFY(p);QVERIFY(p->isVisible());QCOMPARE(network.replies.size(),0);
  QString path=QFileInfo(w.businessStore->filePath()).absolutePath()+"/cffex-disclosure-v1.json";cffexDisclosure::Store store(path);QVERIFY(!QFile::exists(path));
  p->findChild<QLineEdit*>("cffexDate")->setText("2026-08-28");p->findChild<QPushButton*>("cffexFetch")->click();QCOMPARE(network.replies.size(),1);auto*r=network.replies.last();QCOMPARE(r->request().url().toString(),QString("https://www.cffex.com.cn/sj/ccpm/202608/28/IF.xml"));r->deliver(fixture());
  QCOMPARE(p->findChild<QTableWidget*>("cffexRows")->rowCount(),3);QVERIFY(!QFile::exists(path));p->findChild<QPushButton*>("cffexSave")->click();QCOMPARE(store.read()["frames"].toArray().size(),1);
  auto record=QJsonDocument::fromJson(store.read()["frames"].toArray()[0].toObject()["json"].toString().toUtf8()).object();QCOMPARE(record["origin"].toString(),QString("fixture-constructed"));
  for(QString mode:{"quotes","classic","focus"}){w.setLayoutMode(mode);w.cffexDisclosureView();QVERIFY(p->isVisible());QCOMPARE(w.layoutMode(),mode);QTest::qWait(50);bool scopeVisible=false;for(auto*label:p->findChildren<QLabel*>())if(label->text().contains("不是全市场净流入"))scopeVisible=label->height()>=label->fontMetrics().lineSpacing()*2;QVERIFY(scopeVisible);if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v38-cffex-"+mode+".png"));}
  p->findChild<QPushButton*>("cffexFetch")->click();auto*late=network.replies.last();w.home();QVERIFY(late->aborted);late->deliver(fixture());QCOMPARE(store.read()["frames"].toArray().size(),1);
  w.cffexDisclosureView();p->findChild<QPushButton*>("cffexFetch")->click();network.replies.last()->deliver({},503);QVERIFY(p->findChild<QLabel*>("cffexStatus")->text().contains("失败"));QCOMPARE(store.read()["frames"].toArray().size(),1);
  QVERIFY(p->selectHistory(1));p->openOriginal();QVERIFY(w.closeInternalReader());QVERIFY(!w.closeInternalReader());p->openOriginal();auto state=p->saveState();w.save();QFile reading(path+".reading.json");QVERIFY(reading.open(QIODevice::ReadOnly));auto saved=QJsonDocument::fromJson(reading.readAll()).object();QCOMPARE(saved["report"],record);p->back();p->restoreState(saved);QVERIFY(p->back());QCOMPARE(network.replies.size(),3);w.home();
 }
 void transportGuards(){
  Network network;CffexDisclosureTransport client(nullptr,&network);int calls=0;QString error;QJsonObject result;
  auto q=cffexDisclosure::request("2026-08-28","IF");auto start=[&]{client.start(QString::number(calls)+"-"+QString::number(network.replies.size()),q,[&](QString,QJsonObject r,QString e){calls++;result=r;error=e;});return network.replies.last();};
  auto*r=start();QCOMPARE(r->request().rawHeader("Accept-Encoding"),QByteArray("identity"));QCOMPARE(r->request().attribute(QNetworkRequest::RedirectPolicyAttribute).toInt(),int(QNetworkRequest::ManualRedirectPolicy));r->deliver(fixture());QCOMPARE(calls,1);QVERIFY(error.isEmpty());QCOMPARE(result["rawSha256"].toString(),cffexDisclosure::hash(fixture()));
  for(int code:{301,302,403,404,503}){int before=calls;r=start();r->deliver({},code);QCOMPARE(calls,before+1);QVERIFY(!error.isEmpty()&&result.isEmpty());}
  r=start();r->encoding("gzip");r->deliver(fixture());QVERIFY(!error.isEmpty());
  r=start();r->header(QNetworkRequest::ContentLengthHeader,Limit());r->deliver(fixture());QVERIFY(!error.isEmpty());
  r=start();r->deliver(QByteArray(Limit(),'x'));QVERIFY(!error.isEmpty());
  r=start();r->finalUrl(QUrl("https://www.cffex.com.cn/other.xml"));r->deliver(fixture());QVERIFY(!error.isEmpty());
  r=start();r->deliver(fixture().replace("20260828","20260827"));QVERIFY(!error.isEmpty());
  r=start();r->deliver(fixture()+QByteArray::fromHex("ff"));QVERIFY(!error.isEmpty());
  int before=calls;r=start();client.close();QVERIFY(r->aborted);r->deliver(fixture());QCOMPARE(calls,before);
 }
 static int Limit(){return 2*1024*1024+1;}
};
QTEST_MAIN(CffexHostTests)
#include "cffex_host_tests.moc"
