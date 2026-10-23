#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "unified_backup_host_page.hpp"
class UnifiedBackupHostTests:public QObject {
 Q_OBJECT
 void waitIdle(Window&w){QTRY_VERIFY_WITH_TIMEOUT(!w.unifiedBackupLane->busy(),15000);QCoreApplication::processEvents();}
 void shot(Window&w,QString n){auto dir=qEnvironmentVariable("NATIVE_QA_OUTPUT");if(!dir.isEmpty())QVERIFY(w.grab().save(dir+"/"+n+".png"));}
private slots:
 void nativeThreeLayoutsAndFiles(){
  QTemporaryDir d;Window w(true,d.filePath("settings.ini"),d.path());w.resize(1600,1000);w.show();
  w.watchlistBridgeStore(true)->initialize(w.watchlistBridgeCapture()["inputs"].toObject());w.unifiedBackupView();auto*setup=w.pages.value("unifiedBackupSetup");QVERIFY(setup);auto*begin=setup->findChild<QPushButton*>();QVERIFY(begin);
  w.home();begin->click();QVERIFY(!w.pages.value("unifiedBackup"));w.unifiedBackupView();begin->click();
  auto*host=dynamic_cast<unifiedBackup::HostPage*>(w.pages.value("unifiedBackup"));QVERIFY(host);QVERIFY(host->isVisible());
  auto*group=host->findChild<QCheckBox*>("watchlist-config");QVERIFY(group);group->setChecked(true);
  host->findChild<QPushButton*>("exportBackup")->click();waitIdle(w);
  QVERIFY(host->findChild<QPushButton*>("saveBackupNew")->isEnabled());auto file=d.filePath("export.json");host->acceptExport(file);waitIdle(w);QVERIFY(QFileInfo::exists(file));
  auto original=unifiedBackup::boundedRead(file,unifiedBackup::BUNDLE_LIMIT);auto bundle=unifiedBackup::decode(original);QCOMPARE(bundle["entries"].toArray().size(),1);
  host->findChild<QPushButton*>("exportBackup")->click();waitIdle(w);host->acceptExport(file);waitIdle(w);QCOMPARE(unifiedBackup::boundedRead(file,unifiedBackup::BUNDLE_LIMIT),original);QVERIFY(host->findChild<QTextEdit*>("hostBackupDetails")->toPlainText().contains("不能")||host->findChild<QTextEdit*>("hostBackupDetails")->toPlainText().contains("新文件"));
  host->acceptImport(file);waitIdle(w);host->findChild<QPushButton*>("previewBackup")->click();waitIdle(w);
  auto*ack=host->findChild<QCheckBox*>("ackBackup");QVERIFY(ack->isEnabled());QVERIFY(!host->findChild<QPushButton*>("beginBackup")->isEnabled());
  for(QString mode:{"quotes","classic","focus"}){w.setLayoutMode(mode);w.activatePage(host);QVERIFY(host->isVisible());QTest::qWait(30);shot(w,"qt-backup-"+mode);}
  ack->setChecked(true);host->findChild<QPushButton*>("beginBackup")->click();waitIdle(w);QVERIFY(host->findChild<QPushButton*>("nextBackup")->isEnabled());host->findChild<QPushButton*>("nextBackup")->click();waitIdle(w);QVERIFY(host->findChild<QTextEdit*>("backupDetails")->toPlainText().contains("本次所选域已完成"));
  auto receipts=QDir(QFileInfo(w.businessStore->filePath()).absolutePath()+"/unified-backup-receipts").entryList({"restore-*.json"},QDir::Files);QCOMPARE(receipts.size(),1);auto receiptPath=QFileInfo(w.businessStore->filePath()).absolutePath()+"/unified-backup-receipts/"+receipts[0];auto before=unifiedBackup::boundedRead(receiptPath,unifiedBackup::JOURNAL_LIMIT);host->acceptReceipt(receiptPath);waitIdle(w);QCOMPARE(unifiedBackup::boundedRead(receiptPath,unifiedBackup::JOURNAL_LIMIT),before);
  w.home();QVERIFY(!host->isVisible());host->acceptExport(d.filePath("hidden.json"));QVERIFY(!QFileInfo::exists(d.filePath("hidden.json")));QVERIFY(!QApplication::activeModalWidget());
 }
};
QTEST_MAIN(UnifiedBackupHostTests)
#include "unified_backup_host_tests.moc"
