#include <QtTest>
#include <QTemporaryDir>
#include <QTabWidget>
#include "window.hpp"

class MigrationV28HostTests : public QObject {
  Q_OBJECT
 private slots:
  void researchAndSettingsShareInternalPages() {
    QTemporaryDir dir;
    Window window(true, dir.path() + "/settings.ini", dir.path());
    window.resize(1600, 1000); window.show();
    window.findChild<QPushButton*>("workspace研究")->click();
    auto* tabs = window.findChild<QTabWidget*>("researchWorkspace");
    QVERIFY(tabs);
    for (const QString title : {QString("本机分析材料"), QString("交接历史"), QString("历史研究报告")}) {
      int found = -1;
      for (int i = 0; i < tabs->count(); ++i) if (tabs->tabText(i) == title) found = i;
      QVERIFY2(found >= 0, qPrintable("缺少可操作原生页：" + title));
      tabs->setCurrentIndex(found);
      QVERIFY(tabs->currentWidget()->isVisible());
    }
    window.findChild<QPushButton*>("workspace设置")->click();
    auto* history = window.findChild<QPushButton*>("settingsOpenHandoff");
    QVERIFY(history); history->click();
    QCOMPARE(tabs->tabText(tabs->currentIndex()), QString("交接历史"));
    QCOMPARE(window.findChildren<QTabWidget*>("researchWorkspace").size(), 1);
    window.findChild<QPushButton*>("workspace主页")->click();
    QVERIFY(window.chart->isVisible());
  }
  void manualLeadersAreSeparateAndReturnHome() {
    QTemporaryDir dir;
    Window window(true, dir.path() + "/settings.ini", dir.path());
    window.resize(1600, 1000); window.show();
    const int before = window.stocks->rowCount();
    auto* entry = window.findChild<QPushButton*>("openSectorLeaders");
    QVERIFY(entry);
    for (const auto& mode : {QString("quotes"), QString("classic"), QString("focus")}) {
      window.setLayoutMode(mode); entry->click();
      auto* page = window.findChild<QWidget*>("sectorLeaderPage");
      QVERIFY(page); QVERIFY(page->isVisible());
      QCOMPARE(window.stocks->rowCount(), before);
      window.findChild<QPushButton*>("workspace主页")->click();
      QCOMPARE(window.layoutMode(), mode);
      QVERIFY(window.chart->isVisible());
    }
  }
};
QTEST_MAIN(MigrationV28HostTests)
#include "migration_v28_host_tests.moc"
