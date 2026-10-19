#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "risk_settings_page.hpp"
class MigrationV31RiskTests:public QObject {
 Q_OBJECT
 bool labelContains(QWidget* p,const QString& text){for(auto* l:p->findChildren<QLabel*>())if(l->text().contains(text))return true;return false;}
private slots:
 void hostedSettingsAndUnknownQuotes(){
  for(const QString layout:{QString("quotes"),QString("classic"),QString("focus")}){
   QTemporaryDir dir;QSettings settings(dir.filePath("settings.ini"),QSettings::IniFormat);settings.setValue("watch/SZ:stock:000001",false);settings.sync();
   BusinessStore business(dir.filePath("business-v1.sqlite"));business.save("accounts",{{"id","risk-host"},{"name","宿主只读账户"},{"type","ledger"}});
   auto before=business.backup();before.remove("createdAt"); // Compare business records, not the export timestamp.
   Window w(true,settings.fileName(),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   w.findChild<QPushButton*>("workspace设置")->click();auto* entry=w.findChild<QPushButton*>("settingsOpenRisk");QVERIFY(entry&&entry->isVisible());entry->click();
   auto* p=dynamic_cast<RiskSettingsPage*>(w.findChild<QWidget*>("riskSettingsPage"));QVERIFY(p&&p->isVisible());
   auto* accounts=p->findChild<QComboBox*>("riskAccount");QVERIFY(accounts->findData("risk-host")>0);accounts->setCurrentIndex(accounts->findData("risk-host"));
   QVERIFY(labelContains(p,"宿主只读账户"));QVERIFY(labelContains(p,"缺失指标 7 项"));
   QCOMPARE(p->findChild<QListWidget*>("riskAlerts")->count(),0); // Missing source quotes never become fake signals.
   RiskSettingsStore preferences(dir.filePath("risk-settings-v1.json"));QCOMPARE(preferences.read().value("revision").toInt(),0);
   p->findChild<QLineEdit*>("risk_dailyDrop")->setText("4.5");QCOMPARE(preferences.read().value("thresholds").toObject().value("dailyDrop").toDouble(),3.);
   p->findChild<QPushButton*>("riskSave")->click();QCOMPARE(preferences.read().value("thresholds").toObject().value("dailyDrop").toDouble(),4.5);
   p->findChild<QLineEdit*>("risk_drawdown")->setText("11.25");
   p->previewImport("{\"drawdown\":12,\"dailyDrop\":5,\"leaderDrop\":4}");QCOMPARE(preferences.read().value("revision").toInt(),1);
   w.findChild<QPushButton*>("workspace主页")->click();QVERIFY(p->isVisible());QVERIFY(!p->findChild<QPlainTextEdit*>("riskOriginal")->isVisible());
   QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!p->isVisible());w.findChild<QPushButton*>("workspace设置")->click();entry->click();
   QCOMPARE(p->findChild<QLineEdit*>("risk_drawdown")->text(),QString("11.25"));p->confirmImport();QCOMPARE(preferences.read().value("thresholds").toObject().value("drawdown").toInt(),12);
   p->findChild<QPushButton*>("riskSave")->click();QCOMPARE(preferences.read().value("thresholds").toObject().value("drawdown").toInt(),12); // Old draft baseline refuses overwrite.
   w.findChild<QPushButton*>("theme")->click();QVERIFY(p->isVisible());auto after=business.backup();after.remove("createdAt");QCOMPARE(after,before);QCOMPARE(w.layoutMode(),layout);
  }
 }
};
QTEST_MAIN(MigrationV31RiskTests)
#include "migration_v31_risk_tests.moc"
