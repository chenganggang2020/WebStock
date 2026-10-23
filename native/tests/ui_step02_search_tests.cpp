#include "window.hpp"
#include "securities_directory_page.hpp"
#include "business_search_page.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QNetworkAccessManager>
#include <QNetworkReply>

class HeldSearchReply : public QNetworkReply {
public:
 HeldSearchReply(const QNetworkRequest& r,QObject* p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}
 void abort()override{} qint64 readData(char*,qint64)override{return -1;}
};
class SearchTransport : public QNetworkAccessManager {
public: int requests=0;
 QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{++requests;return new HeldSearchReply(r,this);}
};

class UnifiedSearchChecks : public QObject {
 Q_OBJECT
private slots:
 void onlineIntentAndCancellation() {
  QTemporaryDir data;SearchTransport transport;
  SecuritiesDirectoryPage page(data.filePath("missing.sqlite"),data.filePath("cache"),true,nullptr,&transport);
  page.show();page.setSharedQuery("600000");
  QTRY_COMPARE_WITH_TIMEOUT(page.sourceEvidence()["completedQuery"].toString(),QString("600000"),10000);
  QCOMPARE(transport.requests,0);
  page.setSharedQuery("600000",true);
  QTRY_COMPARE(transport.requests,1);
  page.findChild<QPushButton*>("securitiesDirectoryCancel")->click();
  QTest::qWait(200);QCOMPARE(transport.requests,1);
  page.setSharedQuery("银行",true);page.setSharedQuery("600001");
  QTRY_COMPARE_WITH_TIMEOUT(page.sourceEvidence()["completedQuery"].toString(),QString("600001"),10000);
  QCOMPARE(transport.requests,1);
  page.setSharedQuery("600002",true);page.hide();QTest::qWait(250);QCOMPARE(transport.requests,1);
 }
 void singleEntryAndRouting() {
  QTemporaryDir data;
  auto copy=qEnvironmentVariable("SEARCH_TEST_DIRECTORY");
  auto digest=[](QString path){QFile f(path);if(!f.open(QIODevice::ReadOnly))return QByteArray();return QCryptographicHash::hash(f.readAll(),QCryptographicHash::Sha256);};
  const auto originalHash=digest(copy);
  if(!copy.isEmpty())QVERIFY(QFile::copy(copy,data.filePath("securities-legacy-v1.sqlite")));
  Window w(true,data.filePath("settings.ini"),data.path());
  w.resize(1560,980);w.show();QTest::qWait(100);
  auto* input=w.findChild<QLineEdit*>("search");
  auto* groups=w.findChild<QWidget*>("groupPanel");
  auto out=qEnvironmentVariable("SEARCH_TEST_OUTPUT");QDir().mkpath(out);
  QVERIFY(w.grab().save(out+"/initial.png"));
  QVERIFY(groups->isAncestorOf(input));
  QVERIFY(input->mapToGlobal(QPoint()).y()<w.groups->mapToGlobal(QPoint()).y());
  QVERIFY(!w.findChild<QPushButton*>("openBusinessSearch"));
  QVERIFY(!w.findChild<QPushButton*>("openSecuritiesDirectory"));
  input->setText("银行");QTest::qWait(500);
  auto* results=w.findChild<QTabWidget*>("unifiedSearchResults");QVERIFY(results);QVERIFY(results->isVisible());
  auto* directory=w.findChild<SecuritiesDirectoryPage*>("securitiesDirectoryPage");QVERIFY(directory);
  QTRY_COMPARE_WITH_TIMEOUT(directory->sourceEvidence()["completedQuery"].toString(),QString("银行"),10000);
  if(!copy.isEmpty()){QCOMPARE(directory->sourceEvidence()["legacyRows"].toInt(),6997);QVERIFY(directory->sourceEvidence()["matchedRows"].toInt()>0);}
  qInfo()<<"Directory evidence"<<QJsonDocument(directory->sourceEvidence()).toJson(QJsonDocument::Compact);
  QVERIFY(!directory->findChild<QLineEdit*>("securitiesDirectoryQuery")->isVisible());
  QVERIFY(w.grab().save(out+"/securities.png"));
  results->setCurrentIndex(1);
  auto* business=dynamic_cast<BusinessSearchPage*>(results->widget(1));QVERIFY(business);
  QTRY_VERIFY_WITH_TIMEOUT(!business->isLoading(),10000);
  QCOMPARE(business->saveState()["query"].toString(),QString("银行"));
  if(!copy.isEmpty())QVERIFY(business->findChild<QTableWidget*>("businessSearchResults")->rowCount()>0);
  QVERIFY(!business->findChild<QLineEdit*>("businessSearchQuery")->isVisible());
  QVERIFY(w.grab().save(out+"/business.png"));
  input->setText("不存在XYZ");input->setText("600000");QTest::qWait(400);
  QTRY_VERIFY_WITH_TIMEOUT(!business->isLoading(),10000);
  QCOMPARE(business->saveState()["query"].toString(),QString("600000"));
  results->setCurrentIndex(0);
  QTRY_COMPARE_WITH_TIMEOUT(directory->sourceEvidence()["completedQuery"].toString(),QString("600000"),10000);
  if(!copy.isEmpty()){
   auto* table=directory->findChild<QTableWidget*>("securitiesDirectoryResults");QVERIFY(table->rowCount()>0);table->selectRow(0);
   QSignalSpy opened(directory,&SecuritiesDirectoryPage::actionRequested);
   directory->findChild<QPushButton*>("securitiesDirectoryOpen")->click();
   QCOMPARE(opened.size(),1);QCOMPARE(opened[0][0].toJsonObject()["id"].toString(),QString("SH:stock:600000"));
  }
  input->clear();QTest::qWait(400);QVERIFY(!results->isVisible());QVERIFY(w.chart->isVisible());
  w.resize(1100,800);QTest::qWait(80);QVERIFY(input->isVisible());
  QVERIFY(w.grab().save(out+"/narrow.png"));
  w.close();QTRY_VERIFY(!w.isVisible());
  QCOMPARE(digest(copy),originalHash);
 }
};
int main(int argc,char** argv){QApplication app(argc,argv);app.setQuitOnLastWindowClosed(false);QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");app.setFont(QFont("Microsoft YaHei UI",10));QApplication::setStyle("Fusion");UnifiedSearchChecks checks;return QTest::qExec(&checks,argc,argv);}
#include "ui_step02_search_tests.moc"
