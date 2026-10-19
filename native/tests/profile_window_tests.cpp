#include "window.hpp"
#include "stock_research_page.hpp"
#include "stock_profile_service.hpp"
#include "profile_fixture_network.hpp"
#include <QtTest>
#include <QApplication>
#include <QTabWidget>
#include <QTabBar>
#include <QPushButton>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QTextBrowser>
#include <QComboBox>
#include <QListWidget>
#include <QTemporaryDir>
#include <QTextCursor>
#include <QLabel>
namespace {
void need(bool b,QString message){if(!b){std::fprintf(stderr,"B07_CHECK_FAILED %s\n",message.toUtf8().constData());throw std::runtime_error(message.toStdString());}}
QByteArray bytes(QString path){QFile f(path);need(f.open(QIODevice::ReadOnly),"Private file unreadable");return f.readAll();}
template<class T>T* ui(QWidget*w,QString name){auto p=w->findChild<T*>(name);need(p!=nullptr,name);return p;}
void foreground(QWidget&w){w.showNormal();w.raise();w.activateWindow();need(QTest::qWaitForWindowActive(&w),"Actual Window foreground absent");}
void click(QWidget*w,QString tag){auto b=ui<QPushButton>(w,tag);need(b->isVisible()&&b->isEnabled(),"Real visible control missing: "+tag);QTest::mouseClick(b,Qt::LeftButton);QCoreApplication::processEvents();}
template<class F>void wait(F ready){QElapsedTimer t;t.start();while(!ready()&&t.elapsed()<15000){QCoreApplication::processEvents();QTest::qWait(5);}need(ready(),"B07 focused Window timeout");}
QString complete(QWidget*w){auto text=ui<QPlainTextEdit>(w,"stockResearchProfileOriginal");QString out;while(ui<QPushButton>(w,"stockResearchProfilePrevious")->isEnabled())click(w,"stockResearchProfilePrevious");while(true){out+=text->toPlainText();if(!ui<QPushButton>(w,"stockResearchProfileNext")->isEnabled())break;click(w,"stockResearchProfileNext");}text->moveCursor(QTextCursor::End);return out;}
}
class UnifiedBackupHostTests:public QObject {
 Q_OBJECT
 QString output,fixture;
private slots:
 void initTestCase(){output=qEnvironmentVariable("NATIVE_PROFILE_WINDOW_ROOT");fixture=qEnvironmentVariable("NATIVE_PROFILE_FIXTURE");QVERIFY(QDir().mkpath(output));QVERIFY(QFile::exists(fixture));QCOMPARE(QGuiApplication::platformName(),QString("windows"));}
 void actualWindowCompanyProfile_data(){QTest::addColumn<QString>("layout");for(QString mode:{"quotes","classic","focus"})QTest::newRow(mode.toUtf8().constData())<<mode;}
 void actualWindowCompanyProfile(){try{
  QFETCH(QString,layout);auto f=QJsonDocument::fromJson(bytes(fixture)).object();auto id=f["id"].toString(),at=f["at"].toString();QTemporaryDir dir(output+"/win-"+layout+"-XXXXXX");QVERIFY(dir.isValid());dir.setAutoRemove(false);Window w(true,dir.filePath("settings.ini"),dir.path());QVERIFY(w.testing&&!w.feed);w.resize(1600,1000);w.setLayoutMode(layout);foreground(w);w.home();click(&w,"workspace研究");click(&w,"researchOpenStock");auto page=dynamic_cast<StockResearchPage*>(w.pages.value("stockResearch"));QVERIFY(page&&w.workspaceTabs->currentWidget()==page);
  auto db=QFileInfo(w.businessStore->filePath()).absolutePath()+"/stock-research-v1.sqlite";StockProfileCache cache(db+".profiles");auto source=stockProfile::merge(id,f["responses"].toObject(),{},at);cache.save(id,source,"",[]{return true;});auto beforeCache=bytes(cache.filePath(id)),businessBefore=bytes(w.businessStore->filePath());ProfileFixtureNetwork network(f["responses"].toObject(),&w);page->setProfileAccess(false,&network);auto identity=ui<QLineEdit>(page,"stockResearchIdentity");identity->setText(id);click(page,"stockResearchSelect");auto tabs=ui<QTabWidget>(page,"stockResearchTabs");tabs->setCurrentIndex(4);QVERIFY(ui<QTextBrowser>(page,"stockResearchProfileSummary")->toPlainText().contains("合同构造示例公司"));QVERIFY(network.urls.isEmpty());QCOMPARE(bytes(cache.filePath(id)),beforeCache);
  tabs->setCurrentIndex(1);ui<QPlainTextEdit>(page,"stockResearchNote")->setPlainText("B07 actual Window未保存稿");auto draft=page->saveState()["drafts"].toObject();tabs->setCurrentIndex(4);click(page,"stockResearchProfileOriginalMode");ui<QComboBox>(page,"stockResearchProfileSource")->setCurrentText("BusinessAnalysis");auto all=complete(page);QVERIFY(all.contains("完整回顾尾部")&&all.contains(".123456789+08:00")&&all.contains("null"));QCOMPARE(page->saveState()["drafts"].toObject(),draft);auto originalReader=ui<QPlainTextEdit>(page,"stockResearchProfileOriginal");QVERIFY(originalReader->viewport()->height()>=320);QVERIFY(w.grab().save(dir.filePath("original-fields-tail.png")));
  auto frozen=page->saveState()["reading"].toObject()["companyProfile"].toObject();page->saveSnapshot();StockResearchStore store(db);auto history=store.backup()["snapshots"].toArray();QCOMPARE(history.size(),1);QCOMPARE(history[0].toObject()["bundle"].toObject()["companyProfile"],QJsonValue(frozen));network.denied="BusinessAnalysis";click(page,"stockResearchProfileUpdate");wait([&]{return !ui<QPushButton>(page,"stockResearchProfileCancel")->isEnabled();});auto updated=page->saveState()["current"].toObject()["companyProfile"].toObject();auto business=updated["sources"].toObject()["BusinessAnalysis"].toObject();QCOMPARE(business["status"].toString(),QString("cached-after-failure"));QCOMPARE(business["fetchedAt"],frozen["sources"].toObject()["BusinessAnalysis"].toObject()["fetchedAt"]);QCOMPARE(page->saveState()["drafts"].toObject(),draft);QCOMPARE(store.backup()["snapshots"],QJsonValue(history));click(page,"stockResearchProfileSummaryMode");ui<QTextBrowser>(page,"stockResearchProfileSummary")->moveCursor(QTextCursor::End);QVERIFY(w.grab().save(dir.filePath("failed-source-cache.png")));
  network.denied.clear();network.blocked="CompanySurvey";auto durable=bytes(cache.filePath(id));click(page,"stockResearchProfileUpdate");w.showMinimized();wait([&]{return !ui<QPushButton>(page,"stockResearchProfileCancel")->isEnabled();});network.releaseAll();QCoreApplication::processEvents();QCOMPARE(bytes(cache.filePath(id)),durable);QVERIFY(ui<QLabel>(page,"stockResearchState")->text().contains("读取已取消"));foreground(w);click(page,"stockResearchProfileUpdate");click(&w,"workspace主页");QCOMPARE(w.workspaceTabs->currentIndex(),0);network.releaseAll();QCoreApplication::processEvents();QCOMPARE(bytes(cache.filePath(id)),durable);QCOMPARE(page->saveState()["drafts"].toObject(),draft);auto index=w.workspaceTabs->indexOf(page);QTest::mouseClick(w.workspaceTabs->tabBar(),Qt::LeftButton,Qt::NoModifier,w.workspaceTabs->tabBar()->tabRect(index).center());QCOMPARE(w.workspaceTabs->currentWidget(),page);tabs->setCurrentIndex(2);auto list=ui<QListWidget>(page,"stockResearchHistory");QCOMPARE(list->count(),1);QTest::mouseClick(list->viewport(),Qt::LeftButton,Qt::NoModifier,list->visualItemRect(list->item(0)).center());QCoreApplication::processEvents();tabs->setCurrentIndex(4);QVERIFY(!ui<QPushButton>(page,"stockResearchProfileUpdate")->isEnabled());QCOMPARE(page->saveState()["reading"].toObject()["companyProfile"],QJsonValue(frozen));QVERIFY(w.grab().save(dir.filePath("frozen-company-history.png")));QCOMPARE(bytes(w.businessStore->filePath()),businessBefore);QCOMPARE(w.layoutMode(),layout);
  QJsonObject report{{"passed",true},{"actualWindow",true},{"layout",layout},{"entryCacheReadonly",true},{"failedSourceCacheRetained",true},{"draftsRetained",true},{"snapshotImmutable",true},{"hiddenLateCallbacksDropped",true},{"minimizedLateCallbacksDropped",true},{"cancelStatusCleared",true},{"globalHomeUnchanged",true},{"readerHeight",originalReader->viewport()->height()},{"actualProviderFetch",false},{"deviceUsed",false}};QFile out(dir.filePath("host-check.json"));QVERIFY(out.open(QIODevice::WriteOnly));out.write(QJsonDocument(report).toJson());
 }catch(const std::exception&e){QFAIL(e.what());}
 }
};
QTEST_MAIN(UnifiedBackupHostTests)
#include "profile_window_tests.moc"
