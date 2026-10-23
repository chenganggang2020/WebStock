#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
class MigrationV33SettingsTests:public QObject {
 Q_OBJECT
private slots:
 void host(){for(QString layout:{QString("quotes"),QString("classic"),QString("focus")}){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
  w.findChild<QPushButton*>("workspace设置")->click();
  auto* status=w.findChild<QPushButton*>("settingsOpenMigration");QVERIFY2(status,"Migration overview must be connected to actual Settings page");status->click();
  auto* page=w.findChild<QWidget*>("migrationStatusPage");QVERIFY(page&&page->isVisible());
  auto* search=page->findChild<QLineEdit*>("migrationStatusSearch");auto* rows=page->findChild<QListWidget*>("migrationStatusRows");QVERIFY(search&&rows);QCOMPARE(rows->count(),20);
  search->setText("A28");QCOMPARE(rows->count(),1);rows->setCurrentRow(0);
  for(auto* b:page->findChildren<QPushButton*>())if(b->text()=="查看完整缺口和证据")b->click();
  auto* reader=page->findChild<QPlainTextEdit*>("migrationStatusDetail");QVERIFY(reader&&reader->isVisible()&&reader->toPlainText().contains("A28"));
  for(auto* b:page->findChildren<QPushButton*>())if(b->text()=="打开已接入原生功能")b->click();
  auto* ai=w.findChild<QWidget*>("aiSettingsPage");QVERIFY(ai&&ai->isVisible());
  bool boundary=false;for(auto* r:ai->findChildren<QPlainTextEdit*>())if(r->toPlainText().contains("未验证")||r->toPlainText().contains("未连接"))boundary=true;QVERIFY(boundary);
  w.findChild<QPushButton*>("theme")->click();QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!ai->isVisible());QCOMPARE(w.layoutMode(),layout);
  w.findChild<QPushButton*>("workspace设置")->click();status->click();QVERIFY(reader->isVisible());
  QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(page->isVisible());QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!page->isVisible());
 }}
};
QTEST_MAIN(MigrationV33SettingsTests)
#include "migration_v33_settings_tests.moc"
