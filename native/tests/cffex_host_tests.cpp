#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>
#include "window.hpp"
#include "cffex_disclosure_page.hpp"
#include "cffex_disclosure_transport.hpp"
#include "cffex_disclosure_model.hpp"
#include "cffex_position_summary.hpp"
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
 void liveAllProductsDailyTotals(){
  if(qEnvironmentVariable("NATIVE_CFFEX_LIVE")!="1")QSKIP("Explicit bounded live check only");
  QTemporaryDir dir;CffexDisclosureTransport transport;QString failure;bool finished=false;int notifications=0;QPointer<cffexDisclosure::Page> target;
  cffexDisclosure::Page page({[&](QString token,QJsonObject query){transport.start(token,query,[&](QString completed,QJsonObject report,QString error){if(!target)return;if(error.isEmpty()){if(!target->accept(completed,report))failure="Page rejected source";}else{failure=error;target->fail(completed,error);}finished=target->activeToken().isEmpty();});},[&](QString token){transport.cancel(token);},[&](QString,QString){++notifications;}},dir.filePath("archive.json"));target=&page;
  page.begin("2026-10-24","ALL");QTRY_VERIFY_WITH_TIMEOUT(finished,65000);QVERIFY2(failure.isEmpty(),qPrintable(failure));const auto reports=page.saveState()["reports"].toArray();QCOMPARE(reports.size(),4);QCOMPARE(notifications,1);
  for(auto value:reports){auto r=value.toObject();QCOMPARE(r["origin"].toString(),QString("host-fetch-response"));QCOMPARE(r["request"].toObject()["date"].toString(),QString("2026-10-23"));QVERIFY(!r["contracts"].toArray().isEmpty());}
  const auto output=qEnvironmentVariable("NATIVE_QA_OUTPUT");QVERIFY(!output.isEmpty());auto write=[&](QString name,QJsonDocument doc){QFile f(output+"/"+name);return f.open(QIODevice::WriteOnly)&&f.write(doc.toJson())>0;};
  QVERIFY(write("cffex-all-live.json",QJsonDocument(reports)));QVERIFY(write("actual-live-reading.json",QJsonDocument(page.saveState())));QVERIFY(write("actual-totals.json",QJsonDocument(cffexDisclosure::dailyPositionTotals(reports))));
 }
 void freshBatchNotificationRequiresNewRawContent(){
  const auto output=qEnvironmentVariable("NATIVE_QA_OUTPUT");QFile file(output+"/cffex-all-live.json");QVERIFY(file.open(QIODevice::ReadOnly));const auto reports=QJsonDocument::fromJson(file.readAll()).array();QCOMPARE(reports.size(),4);QTemporaryDir dir;QString token;int notifications=0;
  cffexDisclosure::Page page({[&](QString t,QJsonObject){token=t;},[](QString){},[&](QString,QString){++notifications;}},dir.filePath("archive.json"));
  page.begin("2026-10-24","ALL");for(auto r:reports)QVERIFY(page.accept(token,r.toObject()));QCOMPARE(notifications,1);
  page.begin("2026-10-24","IF");QVERIFY(page.accept(token,reports[0].toObject()));QCOMPARE(notifications,1);
  page.begin("2026-10-24","ALL");for(auto r:reports)QVERIFY(page.accept(token,r.toObject()));QCOMPARE(notifications,1);
  auto state=page.saveState();state["notified"]=QJsonArray{};page.restoreState(state);page.begin("2026-10-24","IF");QVERIFY(page.accept(token,reports[0].toObject()));QCOMPARE(notifications,1);
 }
 void batchArchiveRejectsCapacityWithoutPartialWrite(){
  QFile source(qEnvironmentVariable("NATIVE_CFFEX_CAPTURED_FIXTURE"));QVERIFY(source.open(QIODevice::ReadOnly));const auto raw=source.readAll();QTemporaryDir dir;cffexDisclosure::Store store(dir.filePath("archive.json"));
  auto make=[&](QString p,int minute){auto bytes=raw;bytes.replace("IF",p.toUtf8());auto q=cffexDisclosure::request("2026-10-23",p);return cffexDisclosure::parse(bytes,q,q["url"].toString(),QString("2026-10-24T12:%1:00Z").arg(minute,2,10,QChar('0')),"fixture-constructed");};
  for(int i=0;i<19;++i)store.save(make("IF",i),i);const auto before=store.read();QJsonArray batch;for(auto p:QStringList{"IF","IH","IC","IM"})batch.append(make(p,30));
  QVERIFY_EXCEPTION_THROWN(store.saveBatch(batch,19),std::runtime_error);QCOMPARE(store.read(),before);QVERIFY_EXCEPTION_THROWN(store.saveBatch({make("IF",31)},18),std::runtime_error);QCOMPARE(store.read(),before);
 }
 void fourProductBatchIsAtomicAndContractSelectionDoesNotChangeTotals(){
  QFile source(qEnvironmentVariable("NATIVE_CFFEX_CAPTURED_FIXTURE"));QVERIFY(source.open(QIODevice::ReadOnly));const auto raw=source.readAll();QTemporaryDir dir;QList<QJsonObject> queries;QString token;int notifications=0;
  cffexDisclosure::Page page({[&](QString t,QJsonObject q){token=t;queries.append(q);},[](QString){},[&](QString,QString){++notifications;}},dir.filePath("archive.json"));
  auto make=[&](QString p){auto bytes=raw;bytes.replace("IF",p.toUtf8());auto q=cffexDisclosure::request("2026-10-23",p);return cffexDisclosure::parse(bytes,q,q["url"].toString(),"2026-10-24T12:00:00Z","fixture-constructed");};
  page.begin("2026-10-24","ALL");QCOMPARE(queries.size(),1);QCOMPARE(queries.last()["product"].toString(),QString("IF"));
  for(const auto& product:QStringList{"IF","IH","IC","IM"}){QCOMPARE(queries.last()["product"].toString(),product);QVERIFY(page.accept(token,make(product)));if(product!="IM")QVERIFY(page.saveState()["report"].toObject().isEmpty());}
  QCOMPARE(queries.size(),4);QVERIFY(page.activeToken().isEmpty());QCOMPARE(notifications,0);auto state=page.saveState();QCOMPARE(state["reports"].toArray().size(),4);
  const auto top=page.findChild<QLabel*>("cffexCiticCard")->text();QVERIFY(top.contains("净增多 5108 手"));auto*contracts=page.findChild<QComboBox*>("cffexContract");QCOMPARE(contracts->count(),16);contracts->setCurrentIndex(5);QCOMPARE(page.findChild<QLabel*>("cffexCiticCard")->text(),top);
  QVERIFY(page.save());cffexDisclosure::Store store(dir.filePath("archive.json"));QCOMPARE(store.read()["frames"].toArray().size(),4);page.restoreState(state);QCOMPARE(page.saveState()["reports"],state["reports"]);
  page.begin("2026-10-24","ALL");QVERIFY(page.accept(token,make("IF")));page.fail(token,"IH failed");QCOMPARE(page.saveState()["reports"],state["reports"]);QVERIFY(page.activeToken().isEmpty());
  page.begin("2026-10-24","ALL");QString late=token;page.cancel();QVERIFY(!page.accept(late,make("IF")));QCOMPARE(page.saveState()["reports"],state["reports"]);
  QVERIFY(page.selectHistory(1));QCOMPARE(page.saveState()["reports"].toArray().size(),1);QVERIFY(page.findChild<QLabel*>("cffexChangeHeading")->text().contains("仅"));
 }
 void initTestCase(){QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");QApplication::setFont(QFont("Microsoft YaHei UI",10));}
 void capturedCurrentPageAppearance(){
  const auto output=qEnvironmentVariable("NATIVE_QA_OUTPUT");QFile file(output+"/cffex-all-live.json");QVERIFY(file.open(QIODevice::ReadOnly));const auto reports=QJsonDocument::fromJson(file.readAll()).array();QCOMPARE(reports.size(),4);const auto report=reports[0].toObject();QCOMPARE(report["origin"].toString(),QString("host-fetch-response"));QTemporaryDir dir;Window window(true,dir.filePath("settings.ini"),dir.path());window.resize(1700,1050);window.show();window.cffexDisclosureView();auto*page=dynamic_cast<cffexDisclosure::Page*>(window.pages.value("cffexDisclosure"));QVERIFY(page);page->restoreState({{"schema","cffex-reading/v1"},{"date","2026-10-24"},{"product","ALL"},{"report",report},{"reports",reports},{"status","已保存官方原文 · 披露日2026-10-23 · 本次仅验收显示布局"}});for(auto*label:window.findChildren<QLabel*>())if(label->text().startsWith("设计模拟"))label->setText("已保存官方原文 · 原生页面离屏核验");QTest::qWait(80);QVERIFY(window.grab().save(output+"/actual-cffex-window.png"));window.resize(1120,800);page->findChild<QComboBox*>("cffexContract")->setCurrentIndex(5);QTest::qWait(80);QVERIFY(window.grab().save(output+"/actual-cffex-narrow.png"));window.close();
 }
 void netSummaryAndFreshNotificationOnly(){
  QFile source(qEnvironmentVariable("NATIVE_CFFEX_CAPTURED_FIXTURE"));QVERIFY(source.open(QIODevice::ReadOnly));const auto raw=source.readAll();const auto query=cffexDisclosure::request("2026-10-23","IF");
  auto report=cffexDisclosure::parse(raw,query,cffexDisclosure::publicUrl(query),"2026-10-24T12:00:00Z","host-fetch-response");QTemporaryDir dir;int notifications=0;QString message;
  cffexDisclosure::Page page({[](QString,QJsonObject){},[](QString){},[&](QString,QString body){++notifications;message=body;}},dir.filePath("archive.json"));
  auto token=page.begin("2026-10-23","IF");QVERIFY(page.accept(token,report));QCOMPARE(notifications,1);QVERIFY(message.contains("中信期货"));QVERIFY(message.contains("披露机构合计"));QVERIFY(message.contains("1277"));
  QVERIFY(page.findChild<QLabel*>("cffexCiticCard")->text().contains("净增多 1277 手"));QVERIFY(page.findChild<QLabel*>("cffexCiticCard")->text().contains("多单增加 1676 手"));QVERIFY(page.findChild<QLabel*>("cffexCiticCard")->text().contains("空单增加 399 手"));QVERIFY(page.findChild<QLabel*>("cffexCiticCard")->text().contains("4 / 4"));QVERIFY(page.findChild<QTableWidget*>("cffexNetRows")->rowCount()>=20);
  token=page.begin("2026-10-23","IF");report=cffexDisclosure::parse(raw,query,cffexDisclosure::publicUrl(query),"2026-10-24T12:01:00Z","host-fetch-response");QVERIFY(page.accept(token,report));QCOMPARE(notifications,1);
  QVERIFY(page.save());QVERIFY(page.selectHistory(1));QCOMPARE(notifications,1);auto state=page.saveState();page.restoreState(state);token=page.begin("2026-10-23","IF");QVERIFY(page.accept(token,report));QCOMPARE(notifications,1);
  token=page.begin("2026-10-23","IF");page.fail(token,"test failure");QCOMPARE(notifications,1);
  page.findChild<QCheckBox*>("cffexNotify")->setChecked(false);auto changed=raw;changed.replace("8738","8739");report=cffexDisclosure::parse(changed,query,cffexDisclosure::publicUrl(query),"2026-10-24T12:02:00Z","host-fetch-response");token=page.begin("2026-10-23","IF");QVERIFY(page.accept(token,report));QCOMPARE(notifications,1);
  page.findChild<QCheckBox*>("cffexNotify")->setChecked(true);token=page.begin("2026-10-23","IF");QVERIFY(page.accept(token,report));QCOMPARE(notifications,1);
  changed.replace("8739","8740");report=cffexDisclosure::parse(changed,query,cffexDisclosure::publicUrl(query),"2026-10-24T12:03:00Z","fixture-constructed");token=page.begin("2026-10-23","IF");QVERIFY(page.accept(token,report));QCOMPARE(notifications,1);
  changed.replace("8740","8741");report=cffexDisclosure::parse(changed,query,cffexDisclosure::publicUrl(query),"2026-10-24T12:04:00Z","host-fetch-response");token=page.begin("2026-10-23","IF");QVERIFY(page.accept(token,report));QCOMPARE(notifications,2);
 }
 void liveOfficialDisclosure(){
  if(qEnvironmentVariable("NATIVE_CFFEX_LIVE")!="1")QSKIP("Explicit bounded live check only");
  QTemporaryDir dir;CffexDisclosureTransport transport;QJsonObject actual;QString failure;bool finished=false;
  QPointer<cffexDisclosure::Page> target;
  cffexDisclosure::Page page({[&](QString token,QJsonObject query){transport.start(token,query,[&](QString completed,QJsonObject report,QString error){actual=report;failure=error;finished=true;if(target){if(error.isEmpty())target->accept(completed,report);else target->fail(completed,error);}});},[&](QString token){transport.cancel(token);}},dir.filePath("archive.json"));target=&page;
  page.resize(1450,950);page.QWidget::show();page.findChild<QComboBox*>("cffexProduct")->setCurrentIndex(1);page.findChild<QDateEdit*>("cffexDate")->setDate(QDate(2026,10,24));page.findChild<QPushButton*>("cffexFetch")->click();
  QTRY_VERIFY_WITH_TIMEOUT(finished,20000);QVERIFY2(failure.isEmpty(),qPrintable(failure));QCOMPARE(actual["origin"].toString(),QString("host-fetch-response"));QCOMPARE(actual["contracts"].toArray().size(),4);
  int rows=0;for(auto value:actual["contracts"].toArray())rows+=value.toObject()["rows"].toArray().size();QCOMPARE(rows,240);
  const auto output=qEnvironmentVariable("NATIVE_QA_OUTPUT");if(!output.isEmpty()){
   QFile receipt(output+"/cffex-live.json");QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write(QJsonDocument(actual).toJson());receipt.close();QTest::qWait(50);QVERIFY(page.grab().save(output+"/actual-cffex.png"));
  }
 }
 void officialEndpointAndClosedDay(){
  QTemporaryDir dir;Network network;CffexDisclosureTransport transport(nullptr,&network);
  cffexDisclosure::Page page({[&](QString token,QJsonObject query){transport.start(token,query,[](QString,QJsonObject,QString){});},[&](QString token){transport.cancel(token);}},dir.filePath("archive.json"));
  auto* date=page.findChild<QDateEdit*>("cffexDate");QVERIFY2(date&&date->calendarPopup(),"Disclosure date needs a calendar");
  date->setDate(QDate(2026,10,24));page.findChild<QPushButton*>("cffexFetch")->click();
  QCOMPARE(network.replies.size(),1);QCOMPARE(network.replies[0]->request().url().toString(),QString("http://www.cffex.com.cn/sj/ccpm/202610/23/IF.xml"));
  QVERIFY(page.findChild<QLabel*>("cffexStatus")->text().contains("休市"));page.cancel();
 }
 void internalEntry(){
  QTemporaryDir dir;Network network;Window w(true,dir.filePath("settings.ini"),dir.path());w.cffexTestNetwork=&network;w.resize(1600,1000);w.show();w.etfDailyView();
  auto*entry=w.findChild<QPushButton*>("openCffexDisclosure");QVERIFY(entry);entry->click();auto*p=dynamic_cast<cffexDisclosure::Page*>(w.pages.value("cffexDisclosure"));QVERIFY(p);QVERIFY(p->isVisible());QCOMPARE(network.replies.size(),0);
  QString path=QFileInfo(w.businessStore->filePath()).absolutePath()+"/cffex-disclosure-v1.json";cffexDisclosure::Store store(path);QVERIFY(!QFile::exists(path));
  p->findChild<QComboBox*>("cffexProduct")->setCurrentIndex(1);p->findChild<QDateEdit*>("cffexDate")->setDate(QDate(2026,8,28));p->findChild<QPushButton*>("cffexFetch")->click();QCOMPARE(network.replies.size(),1);auto*r=network.replies.last();QCOMPARE(r->request().url().toString(),QString("http://www.cffex.com.cn/sj/ccpm/202608/28/IF.xml"));r->deliver(fixture());
  QCOMPARE(p->findChild<QTableWidget*>("cffexRows")->rowCount(),3);QVERIFY(!QFile::exists(path));p->findChild<QPushButton*>("cffexSave")->click();QCOMPARE(store.read()["frames"].toArray().size(),1);
  auto record=QJsonDocument::fromJson(store.read()["frames"].toArray()[0].toObject()["json"].toString().toUtf8()).object();QCOMPARE(record["origin"].toString(),QString("fixture-constructed"));
  for(QString mode:{"quotes","classic","focus"}){w.setLayoutMode(mode);w.cffexDisclosureView();QVERIFY(p->isVisible());QCOMPARE(w.layoutMode(),mode=="quotes"?QString("quotes"):QString("classic"));QTest::qWait(50);bool scopeVisible=false;for(auto*label:p->findChildren<QLabel*>())if(label->text().contains("不是全市场净流入"))scopeVisible=label->height()>=label->fontMetrics().lineSpacing()*2;QVERIFY(scopeVisible);if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v38-cffex-"+mode+".png"));}
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
