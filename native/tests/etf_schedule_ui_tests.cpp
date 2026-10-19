#include "etf_page.hpp"
#include <QCheckBox>
#include <QLabel>
#include <QTemporaryDir>
#include <QTimer>
#include <QtTest>

class EtfScheduleUiTests : public QObject {
  Q_OBJECT
private slots:
  void explicitSettingPersistsWithoutRefreshing() {
    QTemporaryDir dir;
    const auto file = dir.filePath("etf.sqlite");
    EtfPage page(file, false);
    page.show();
    auto *enabled = page.findChild<QCheckBox *>("etfScheduleEnabled");
    QVERIFY(enabled);
    QVERIFY(!enabled->isChecked());
    QVERIFY(etfDaily::Store(file).state().isEmpty());
    enabled->click();
    auto s = etfDaily::Store(file).state();
    QVERIFY(s["scheduleEnabled"].toBool());
    QVERIFY(s["lastAttemptAt"].toString().isEmpty());
    auto *status = page.findChild<QLabel *>("etfScheduleState");
    QVERIFY(status && status->text().contains("应用运行"));
    page.hide();
    auto *timer = page.findChild<QTimer *>("etfScheduleTimer");
    QVERIFY(timer && timer->isActive());
    EtfPage reopened(file, false);
    auto *restored = reopened.findChild<QCheckBox *>("etfScheduleEnabled");
    QVERIFY(restored && restored->isChecked());
    restored->click();
    QVERIFY(!etfDaily::Store(file).state()["scheduleEnabled"].toBool());
    QVERIFY(etfDaily::Store(file).state()["lastAttemptAt"].toString().isEmpty());
    page.load();
    QVERIFY(!enabled->isChecked());
  }
};
QTEST_MAIN(EtfScheduleUiTests)
#include "etf_schedule_ui_tests.moc"
