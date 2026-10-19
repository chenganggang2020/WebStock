#include <QtTest>
#include <QTemporaryDir>
#include <QComboBox>
#include <QDateEdit>
#include <QTableWidget>
#include <QLabel>
#include <QPushButton>
#include <QSqlDatabase>
#include <QSqlQuery>
#include "dark_rotation.hpp"
#include "rotation_page.hpp"
#include "window.hpp"
class RotationUiTests:public QObject {
 Q_OBJECT
 private slots:
 void lockedDatabaseDoesNotBlockOpenOrClose(){
   QTemporaryDir d;auto file=d.filePath("locked.sqlite");auto lock=QSqlDatabase::addDatabase("QSQLITE","rotation-ui-lock");lock.setDatabaseName(file);QVERIFY(lock.open());
   {QSqlQuery q(lock);QVERIFY(q.exec("CREATE TABLE marker(x)"));QVERIFY(q.exec("BEGIN EXCLUSIVE"));QElapsedTimer elapsed;elapsed.start();auto* page=new RotationPage(file,false);QVERIFY(elapsed.elapsed()<500);page->show();QTest::qWait(100);elapsed.restart();delete page;QVERIFY(elapsed.elapsed()<500);QVERIFY(q.exec("ROLLBACK"));}
   lock.close();lock={};QSqlDatabase::removeDatabase("rotation-ui-lock");QThreadPool::globalInstance()->waitForDone();QApplication::processEvents();
 }
 void firstNavigationActivatesNewTab(){
   Window window(true);window.resize(1400,850);window.show();
   auto* funds=window.findChild<QPushButton*>("funds");QVERIFY(funds);funds->click();
   auto* open=window.findChild<QPushButton*>("openRotation");QVERIFY(open);open->click();
   auto* page=window.findChild<RotationPage*>();QVERIFY(page);QVERIFY(page->isVisible());
   QVERIFY(page->findChild<QPushButton*>("rotationSamplingStart"));
   QVERIFY(!page->findChild<QPushButton*>("rotationSamplingStop")->isEnabled());
   QVERIFY(page->findChild<QLabel*>("rotationSamplingState")->text().contains("已停止"));
 }
 void cachedPageScopeAndSelection(){
   QTemporaryDir d;auto file=d.filePath("rotation.sqlite");
   QJsonObject raw{{"errid",0},{"1","20261009"},{"2",1},{"data",QJsonArray{QJsonObject{{"3",90},{"4","BK0001"},{"16","测试板块"},{"6",20},{"7",30},{"8",50}}}}};
   auto s=darkRotation::normalize(raw,"2026-10-09","industry",1,"2026-10-09T01:35:00Z");s["schema"]="webstock.rotation-snapshot/v1";s["date"]="2026-10-09";s["sourceKey"]=darkRotation::sourceKey(s);darkRotation::Store(file).save(s);
   RotationPage page(file,false);page.resize(1000,680);page.show();
   auto* table=page.findChild<QTableWidget*>("rotationTable");QVERIFY(table);
   QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(),1,5000);
   auto* rank=page.findChild<QComboBox*>("rotationRank");QVERIFY(rank);
   QVERIFY(page.findChild<QWidget*>("rotationCurve"));
   rank->setCurrentIndex(1);QTRY_COMPARE(table->rowCount(),0);
   rank->setCurrentIndex(0);QTRY_COMPARE(table->rowCount(),1);
   table->selectRow(0);QTRY_VERIFY(page.findChild<QLabel*>("rotationDetail")->text().contains("测试板块"));
   QVERIFY(page.findChild<QLabel*>("rotationDetail")->text().contains("不足"));
   page.findChild<QComboBox*>("rotationScope")->setCurrentIndex(1);QTRY_COMPARE(table->rowCount(),0);
   page.findChild<QComboBox*>("rotationScope")->setCurrentIndex(0);QTRY_COMPARE(table->rowCount(),1);
   page.findChild<QComboBox*>("rotationKind")->setCurrentIndex(1);QTRY_COMPARE(table->rowCount(),0);
   QVERIFY(!page.findChild<QPushButton*>("rotationRefresh")->isEnabled());
   page.findChild<QComboBox*>("rotationKind")->setCurrentIndex(0);QTRY_COMPARE(table->rowCount(),1);
   QFile db(file);QVERIFY(db.open(QIODevice::ReadOnly));auto original=db.readAll();db.close();
   page.exportArchive(file);
   QTRY_VERIFY(page.findChild<QLabel*>("rotationState")->text().contains("未导出"));
   QVERIFY(db.open(QIODevice::ReadOnly));QCOMPARE(db.readAll(),original);
 }
};
QTEST_MAIN(RotationUiTests)
#include "rotation_ui_tests.moc"
