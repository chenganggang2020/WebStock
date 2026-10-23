#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "data_safety_store.hpp"
class MigrationV31SafetyTests:public QObject {
 Q_OBJECT
 QPushButton* action(QWidget* p,QString text){for(auto* b:p->findChildren<QPushButton*>())if(b->text()==text)return b;return nullptr;}
private slots:
 void actualInventoryPreviewAndStaleGuard(){
  for(QString layout:{QString("quotes"),QString("classic"),QString("focus")}){
   QTemporaryDir dir;QSettings prefs(dir.filePath("settings.ini"),QSettings::IniFormat);prefs.sync();
   BusinessStore store(dir.filePath("business-v1.sqlite"));auto before=store.backup();
   Window w(true,prefs.fileName(),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   w.findChild<QPushButton*>("workspace设置")->click();w.findChild<QPushButton*>("settingsOpenSafety")->click();
   auto* p=w.findChild<QWidget*>("dataSafetyPage");QVERIFY(p&&p->isVisible());
   action(p,"读取宿主明确提供的位置（不扫描目录）")->click();
   auto* locations=p->findChild<QListWidget*>();QTRY_COMPARE_WITH_TIMEOUT(locations->count(),5,5000);
   QCOMPARE(dataSafety::baselineHash(store.backup()),dataSafety::baselineHash(before));
   locations->setCurrentRow(0);action(p,"对所选库执行只读完整性/安全表计数")->click();
   auto* views=p->findChild<QStackedWidget*>("dataSafetyViews");QTRY_COMPARE_WITH_TIMEOUT(views->currentIndex(),1,5000);
   w.findChild<QPushButton*>("workspace主页")->click();QVERIFY(p->isVisible());QCOMPARE(views->currentIndex(),0);
   auto incoming=before;auto accounts=incoming["accounts"].toArray();accounts.append(QJsonObject{{"id","safety-new"},{"name","待迁账本"},{"type","ledger"}});incoming["accounts"]=accounts;
   p->findChild<QTabWidget*>()->setCurrentIndex(1);p->findChild<QPlainTextEdit*>("dataSafetyInput")->setPlainText(QString::fromUtf8(QJsonDocument(incoming).toJson()));
   action(p,"按已保存设置核验粘贴材料")->click();
   DataSafetyStore staging(store.filePath()+".data-safety.sqlite");
   QTRY_VERIFY_WITH_TIMEOUT(staging.get("stages")["data"].toObject()["plan"].toObject()["eligible"].toBool(),10000);
   QCOMPARE(dataSafety::baselineHash(store.backup()),dataSafety::baselineHash(before));
   action(p,"明确转入既有恢复入口（仍须先备份并确认）")->click();
   auto* restore=w.findChild<QWidget*>("businessSettingsPage");QTRY_VERIFY_WITH_TIMEOUT(restore->isVisible(),10000);
   QVERIFY(restore->findChild<QPlainTextEdit*>("businessRestorePreview")->toPlainText().contains("safety-new"));
   QCOMPARE(dataSafety::baselineHash(store.backup()),dataSafety::baselineHash(before));
   store.save("accounts",{{"id","later-change"},{"name","稍后修改"},{"type","ledger"}});auto changed=dataSafety::baselineHash(store.backup());
   restore->findChild<QPushButton*>("applyBusiness")->click(); // Guard refuses before any dialog or database write.
   bool refused=false;for(auto* label:restore->findChildren<QLabel*>())if(label->text().contains("重新核验"))refused=true;QVERIFY(refused);
   QCOMPARE(dataSafety::baselineHash(store.backup()),changed);QCOMPARE(w.layoutMode(),layout);
   w.findChild<QPushButton*>("settingsOpenSafety")->click();w.findChild<QPushButton*>("theme")->click();
   if(layout=="classic"&&!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v31-safety.png"));
   QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!p->isVisible());
  }
 }
};
QTEST_MAIN(MigrationV31SafetyTests)
#include "migration_v31_safety_tests.moc"
