#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "collection_page.hpp"
#include "collection_runner.hpp"
#include "dark_stock.hpp"
#include "dark_stock_page.hpp"
#include "dark_stock_rank.hpp"
class MigrationV40HostTests:public QObject {
 Q_OBJECT
 QJsonObject job(QString id="publication-v40"){return {{"id",id},{"title","隔离文稿"},{"text","完整人工校对稿"},{"originalText","识别初版保留"},{"status","completed"},{"executionRevision","revision-1"},{"unknownMetadata",QJsonObject{{"retain",true}}}};}
 QJsonObject row(std::shared_ptr<BusinessStore>s,QString kind,QString id){for(auto v:s->read(kind))if(v.toObject()["id"]==id)return v.toObject();return {};}
 QJsonObject snapshot(){QFile f(qEnvironmentVariable("NATIVE_RANK_FIXTURE"));if(!f.open(QIODevice::ReadOnly))throw std::runtime_error("fixture missing");return QJsonDocument::fromJson(f.readAll()).object();}
 void shot(Window&w,QString id){if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/"+id+".png"));}
private slots:
 void commitRejectsConcurrentChanges(){
  QTemporaryDir d;int serial=0;
  for(QString field:{"text","executionRevision","unknownMetadata","deleted","document"}){
   auto s=std::make_shared<BusinessStore>(d.filePath(QString::number(++serial)+".sqlite"));auto expected=s->save("collections",job());auto doc=QJsonObject{{"id","document-v40"},{"collectionId",expected["id"]},{"title","资料"},{"text",expected["text"]},{"originalText",expected["originalText"]}};BusinessStore peer(s->filePath());
   if(field=="document")peer.save("docs",QJsonObject{{"id","document-v40"},{"title","人工"},{"text","并行人工稿"},{"unknownField","keep"}});
   else if(field=="deleted"){const QString name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(s->filePath());QVERIFY(db.open());QSqlQuery q(db);QVERIFY(q.exec("DELETE FROM records WHERE kind='collections'"));db.close();}QSqlDatabase::removeDatabase(name);}
   else{auto next=expected;next[field]="peer change";peer.save("collections",next);}
   auto before=peer.read("collections"),beforeDocs=peer.read("docs"),beforeAccounts=peer.read("accounts");
   QVERIFY_EXCEPTION_THROWN(s->commitCollectionPublication(expected,doc),std::exception);
   QCOMPARE(s->read("collections"),before);QCOMPARE(s->read("docs"),beforeDocs);QCOMPARE(s->read("accounts"),beforeAccounts);
  }
 }
 void publicationActualWindow(){
  QTemporaryDir d;Window w(true,d.filePath("settings.ini"),d.path());w.resize(1600,1000);w.show();auto source=w.businessStore->save("collections",job());w.collectionView();auto*p=w.pages.value("collection");QVERIFY(p);
  openCollectionDocument(p,source);QCOMPARE(p->findChild<QPlainTextEdit*>("collectionText")->toPlainText(),source["text"].toString());p->findChild<QPushButton*>("publishCollection")->click();
  QTRY_COMPARE(w.businessStore->read("docs").size(),1);auto doc=w.businessStore->read("docs")[0].toObject();QCOMPARE(doc["text"],source["text"]);QCOMPARE(doc["originalText"],source["originalText"]);
  auto sourceAfter=row(w.businessStore,"collections",source["id"].toString());QCOMPARE(sourceAfter["text"],source["text"]);QCOMPARE(sourceAfter["originalText"],source["originalText"]);QCOMPARE(sourceAfter["unknownMetadata"],source["unknownMetadata"]);
  w.openResearchDocument(doc);QVERIFY(w.pages.value("research")->isVisible());QCOMPARE(w.pages.value("research")->findChild<QPlainTextEdit*>("evidenceText")->toPlainText(),doc["text"].toString());
  auto human=doc;human["text"]="研究页后续人工稿";human=w.businessStore->save("docs",human);w.collectionView();p->findChild<QPushButton*>("publishCollection")->click();QCOMPARE(row(w.businessStore,"docs",human["id"].toString()),human);QVERIFY(p->findChild<QLabel*>("collectionState")->text().contains("人工修改"));QVERIFY(!QApplication::activeModalWidget());shot(w,"qt-v40-publication");w.home();
 }
 void rankingActualThreeLayouts(){
  QTemporaryDir d;Window w(true,d.filePath("settings.ini"),d.path());w.resize(1600,1000);w.show();auto cache=snapshot();auto dir=QFileInfo(w.businessStore->filePath()).absolutePath()+"/dark-stocks-v1";darkStock::Store(dir).save(cache);QFile f(dir+"/2026-10-09.json");QVERIFY(f.open(QIODevice::ReadOnly));const auto original=f.readAll();f.close();
  w.darkStockView();auto*p=w.pages.value("darkStocks")->findChild<DarkStockPage*>();QVERIFY(p);p->findChild<QCheckBox*>("darkStockOwn")->setChecked(false);p->findChild<QDateEdit*>("darkStockDate")->setDate(QDate(2026,10,9));auto*t=p->findChild<QTableWidget*>("darkStockTable");QTRY_COMPARE_WITH_TIMEOUT(t->rowCount(),100,5000);
  auto*m=p->findChild<QComboBox*>("darkStockMetric");auto*direction=p->findChild<QComboBox*>("darkStockDirection");direction->setCurrentIndex(1);QVERIFY(t->item(0,0)->text().contains("sz000208"));QCOMPARE(t->item(0,5)->text(),QString("对账不符"));p->findChild<QPushButton*>("darkStockNext")->click();p->findChild<QPushButton*>("darkStockNext")->click();QCOMPARE(t->rowCount(),7);
  m->setCurrentIndex(1);QCOMPARE(t->rowCount(),100);QVERIFY(t->item(0,0)->text().contains("sz000000"));direction->setCurrentIndex(2);QCOMPARE(t->rowCount(),1);QVERIFY(t->item(0,0)->text().contains("sz000205"));m->setCurrentIndex(2);QCOMPARE(t->rowCount(),1);
  m->setCurrentIndex(0);direction->setCurrentIndex(1);p->findChild<QLineEdit*>("darkStockSearch")->setText("sz000204");QCOMPARE(t->rowCount(),1);p->findChild<QLineEdit*>("darkStockSearch")->clear();
  for(QString layout:{"quotes","classic","focus"}){w.setLayoutMode(layout);w.darkStockView();QVERIFY(p->isVisible());QVERIFY(t->item(0,0)->text().contains("sz000208"));QVERIFY(p->findChild<QLabel*>("darkStockState")->text().contains("多页非同步快照"));QTest::qWait(50);shot(w,"qt-v40-rank-"+layout);}
  p->findChild<QDateEdit*>("darkStockDate")->setDate(QDate(2026,10,8));QTRY_VERIFY_WITH_TIMEOUT(p->findChild<QLabel*>("darkStockState")->text().contains("当前日期没有本机个股榜"),5000);QCOMPARE(t->rowCount(),0);QVERIFY(!p->findChild<QPushButton*>("darkStockRefresh")->isEnabled());QVERIFY(f.open(QIODevice::ReadOnly));QCOMPARE(f.readAll(),original);w.home();
 }
};
QTEST_MAIN(MigrationV40HostTests)
#include "migration_v40_host_tests.moc"
