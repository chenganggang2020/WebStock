#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "sector_watch_model.hpp"
#include "sector_watch_page.hpp"
#include "industry_discovery_store.hpp"
#include "sector_research_store.hpp"

namespace {
QByteArray discoveryCatalog() {
  QJsonArray rows{QJsonArray{"测试概念",QJsonArray{},"gn_test"}};
  return QJsonDocument(sectorWatch::sinaCatalog(QJsonArray{QJsonArray{"热门概念",rows}},
      "concept","2026-10-13T00:00:00.000Z","2026-10-13T00:00:00.000Z")).toJson();
}
}
class MigrationV32DiscoveryTests:public QObject {
  Q_OBJECT
private slots:
  void host() {
    try {
    for(QString layout:{QString("quotes"),QString("classic"),QString("focus")}) {
      QTemporaryDir dir;QSettings prefs(dir.filePath("settings.ini"),QSettings::IniFormat);
      prefs.sync();Window w(true,prefs.fileName(),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
      w.findChild<QPushButton*>("workspace研究")->click();
      auto* entry=w.findChild<QPushButton*>("researchOpenDiscovery");
      QVERIFY2(entry,"Industry discovery must be reachable through the real research workspace");
      entry->click();auto* page=w.findChild<QWidget*>("industryDiscoveryPage");QVERIFY(page&&page->isVisible());
      auto* stop=page->findChild<QPushButton*>("discoveryCancel");QVERIFY(stop);
      QTRY_VERIFY_WITH_TIMEOUT(!stop->isEnabled(),5000);
      QVERIFY(!page->findChild<QPushButton*>("discoveryFetch")->isEnabled());
      auto* tabs=page->findChild<QTabWidget*>("discoveryTabs");tabs->setCurrentIndex(4);
      auto* text=page->findChild<QPlainTextEdit*>("discoveryImportText");text->setPlainText(QString::fromUtf8(discoveryCatalog()));
      page->findChild<QPushButton*>("discoveryPreview")->click();
      auto* confirm=page->findChild<QPushButton*>("discoveryConfirmImport");
      QTRY_VERIFY_WITH_TIMEOUT(confirm->isEnabled(),5000);
      QCOMPARE(page->findChild<QTableWidget*>("discoveryDirectory")->rowCount(),0);
      confirm->click();QTRY_VERIFY_WITH_TIMEOUT(!stop->isEnabled(),5000);
      tabs->setCurrentIndex(0);auto* table=page->findChild<QTableWidget*>("discoveryDirectory");
      QCOMPARE(table->rowCount(),1);table->selectRow(0);
      QTRY_VERIFY_WITH_TIMEOUT(!stop->isEnabled(),5000);
      page->findChild<QCheckBox*>("discoveryAcknowledgement")->setChecked(true);
      page->findChild<QPushButton*>("discoveryTrack")->click();
      QTRY_VERIFY_WITH_TIMEOUT(!stop->isEnabled(),5000);
      QCOMPARE(page->findChild<QTableWidget*>("discoveryTopics")->rowCount(),1);
      auto topic=industryDiscovery::Store(dir.filePath("industry-discovery-v1.sqlite")).read()["topics"].toArray()[0].toObject();
      page->findChild<QPushButton*>("discoveryMaterials")->click();
      auto* research=w.findChild<QWidget*>("sectorResearchPage");QVERIFY(research&&research->isVisible());
      bool exact=false;for(auto* text:research->findChildren<QPlainTextEdit*>())if(text->isReadOnly()&&text->toPlainText().contains("discovery:"+topic["id"].toString()))exact=true;QVERIFY(exact);
      SectorResearchStore researchStore(dir.filePath("business-v1.sqlite.sector-research.sqlite"));QCOMPARE(researchStore.list("packets").size(),0);
      w.findChild<QPushButton*>("workspace研究")->click();entry->click();
      QTRY_VERIFY_WITH_TIMEOUT(!stop->isEnabled(),5000);
      page->findChild<QPushButton*>("discoveryOpenBoard")->click();
      auto* target=w.findChild<SectorWatchPage*>("sectorWatchPage");QVERIFY(target&&target->isVisible());
      QCOMPARE(target->saveState()["provider"].toString(),QString("sina"));
      QCOMPARE(target->saveState()["taxonomy"].toString(),QString("concept"));
      QCOMPARE(target->saveState()["boardFilter"].toString(),QString("gn_test"));
      w.findChild<QPushButton*>("workspace研究")->click();entry->click();
      QTRY_VERIFY_WITH_TIMEOUT(!stop->isEnabled(),5000);
      QCOMPARE(page->findChild<QTableWidget*>("discoveryTopics")->rowCount(),1);
      tabs->setCurrentIndex(0);w.findChild<QPushButton*>("theme")->click();
      if(layout=="classic"&&!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())
        QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v32-discovery.png"));
      QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!page->isVisible());QCOMPARE(w.layoutMode(),layout);
    }
    } catch(const std::exception& e) { QFAIL(e.what()); }
  }
};
QTEST_MAIN(MigrationV32DiscoveryTests)
#include "migration_v32_discovery_tests.moc"
