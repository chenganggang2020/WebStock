#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "person_method_page.hpp"
class MigrationV30HostTests : public QObject {
 Q_OBJECT
private slots:
 void methodsHostedInThreeLayouts() {
  QTemporaryDir dir;
  Window window(true, dir.filePath("settings.ini"), dir.path());window.resize(1600,1000);window.show();
  for (const QString layout : {QString("quotes"),QString("classic"),QString("focus")}) {
   window.setLayoutMode(layout);
   window.findChild<QPushButton*>("workspace研究")->click();
   auto* entry=window.findChild<QPushButton*>("researchOpenMethods");QVERIFY(entry&&entry->isVisible());entry->click();
   auto* p=dynamic_cast<PersonMethodPage*>(window.findChild<QWidget*>("personMethodPage"));QVERIFY(p&&p->isVisible());
   auto* mode=p->findChild<QComboBox*>("pmMode");mode->setCurrentIndex(0);
   p->findChild<QPushButton*>("pmNew")->click();
   p->findChild<QPlainTextEdit*>("pm_displayName")->setPlainText("主机受控人物 "+layout);
   p->findChild<QPlainTextEdit*>("pm_platform")->setPlainText("本机手动记录");
   p->findChild<QPushButton*>("pmSave")->click();
   QVERIFY2(p->findChild<QLabel*>("pmStatus")->text().contains("已保存"),qPrintable(p->findChild<QLabel*>("pmStatus")->text()));
   PersonMethodStore store(dir.filePath("person-method-v1.sqlite"));
   QVERIFY(QString::fromUtf8(personMethod::json(store.backup())).contains("主机受控人物 "+layout));
   p->findChild<QPushButton*>("pmRead")->click();
   auto* reader=p->findChild<QPlainTextEdit*>("pmOriginal");QVERIFY(reader->isVisible());
   window.findChild<QPushButton*>("workspace主页")->click();
   QVERIFY(p->isVisible());QVERIFY(!reader->isVisible());
   QVERIFY(window.findChild<QPushButton*>("workspace研究")->isChecked());
   p->findChild<QPushButton*>("pmRead")->click();
   QTest::keyClick(&window,Qt::Key_Escape);QVERIFY(p->isVisible());QVERIFY(!reader->isVisible());
   auto* description=p->findChild<QPlainTextEdit*>("pm_description");description->setPlainText("未保存主机草稿 "+layout);
   window.findChild<QPushButton*>("theme")->click();QCOMPARE(description->toPlainText(),"未保存主机草稿 "+layout);
   window.findChild<QPushButton*>("workspace主页")->click();QVERIFY(!p->isVisible());
   window.findChild<QPushButton*>("workspace研究")->click();entry->click();QCOMPARE(description->toPlainText(),"未保存主机草稿 "+layout);
   p->findChild<QPushButton*>("pmSave")->click();QCOMPARE(window.layoutMode(),layout);
  }
 }
};
QTEST_MAIN(MigrationV30HostTests)
#include "migration_v30_host_tests.moc"
