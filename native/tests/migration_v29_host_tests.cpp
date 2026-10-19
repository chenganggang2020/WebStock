#include <QtTest>
#include <QTemporaryDir>
#include <QPlainTextEdit>
#include "window.hpp"
#include "stock_research_page.hpp"
class MigrationV29HostTests:public QObject {
 Q_OBJECT
 private slots:
 void stockResearchUsesCurrentIdentityAndPreservesDraft() {
  QTemporaryDir dir;Window window(true,dir.filePath("settings.ini"),dir.path());
  window.resize(1600,1000);window.show();QTest::qWait(40);
  const QString id=window.instrumentId();const int before=window.stocks->rowCount();
  for(const QString mode:{QString("quotes"),QString("classic"),QString("focus")}) {
   window.setLayoutMode(mode);
   window.findChild<QPushButton*>("workspace研究")->click();
   window.findChild<QPushButton*>("researchOpenStock")->click();
   auto* page=dynamic_cast<StockResearchPage*>(window.findChild<QWidget*>("stockResearchPage"));
   QVERIFY(page);QVERIFY(page->isVisible());
   auto* reader=page->findChild<QPlainTextEdit*>("stockResearchOriginal");
   QVERIFY(reader->toPlainText().contains(id));
   auto* note=page->findChild<QPlainTextEdit*>("stockResearchNote");
   note->setPlainText("主机未保存草稿 "+mode);
   page->findChild<QPushButton*>("stockResearchReload")->click();
   QCOMPARE(note->toPlainText(),"主机未保存草稿 "+mode);
   page->findChild<QPushButton*>("stockResearchChart")->click();
   QCOMPARE(window.instrumentId(),id);QCOMPARE(window.layoutMode(),mode);
   QCOMPARE(window.stocks->rowCount(),before);
   window.findChild<QPushButton*>("workspace研究")->click();
   window.findChild<QPushButton*>("researchOpenStock")->click();
   QCOMPARE(note->toPlainText(),"主机未保存草稿 "+mode);
   page->findChild<QPushButton*>("stockResearchSaveNote")->click();
   QVERIFY2(page->findChild<QLabel*>("stockResearchState")->text().startsWith("手动笔记已保存"),
       qPrintable(page->findChild<QLabel*>("stockResearchState")->text()));
   page->findChild<QPushButton*>("stockResearchSaveSnapshot")->click();
   QVERIFY(!page->findChild<QLabel*>("stockResearchState")->text().contains("失败"));
   window.findChild<QPushButton*>("workspace主页")->click();
  }
  StockResearchStore saved(dir.filePath("stock-research-v1.sqlite"));
  qInfo().noquote()<< "identity" << id << "database" << saved.filePath() << QJsonDocument(saved.backup()).toJson(QJsonDocument::Compact).left(500);
  QCOMPARE(saved.note(id)["text"].toString(),QString("主机未保存草稿 focus"));
  QCOMPARE(saved.backup()["snapshots"].toArray().size(),3);
 }
};
QTEST_MAIN(MigrationV29HostTests)
#include "migration_v29_host_tests.moc"
