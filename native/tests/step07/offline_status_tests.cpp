#include "global_market_page.hpp"
#include "../step05/fixtures.hpp"
#include <QtTest>
#include <QtWidgets>
class OfflineStatusTests:public QObject{
 Q_OBJECT
private slots:
 void selection_data(){QTest::addColumn<bool>("automatic");QTest::newRow("offlineAutoOn")<<true;QTest::newRow("offlineAutoOff")<<false;}
 void selection(){QFETCH(bool,automatic);QTemporaryDir dir;QVERIFY(dir.isValid());auto seed=fixture::make("daily64");fixture::write(dir.filePath("global-market-native-v1.json"),QJsonDocument(seed.state).toJson());GlobalMarketPage page(dir.path(),false);page.show();auto* autoBox=page.findChild<QCheckBox*>("globalAutomatic");autoBox->setChecked(automatic);auto* reload=page.findChild<QPushButton*>("globalReload");QTRY_VERIFY_WITH_TIMEOUT(reload->isEnabled(),10000);QTest::qWait(100);auto* instrument=page.findChild<QComboBox*>("globalInstrument");instrument->setCurrentIndex(instrument->findData("nasdaq-composite"));QTRY_VERIFY_WITH_TIMEOUT(!page.sourceEvidence()["series"].toObject().isEmpty(),10000);QCOMPARE(autoBox->isChecked(),automatic);QVERIFY(!autoBox->isEnabled());QVERIFY(!page.findChild<QTimer*>("globalAutomaticTimer")->isActive());QVERIFY(!page.findChild<QPushButton*>("globalRefresh")->isEnabled());const auto text=page.findChild<QPlainTextEdit*>("globalStatus")->toPlainText();QVERIFY2(text.contains("离线")&&!text.contains("正在自动更新"),qPrintable(text));}
};
QTEST_MAIN(OfflineStatusTests)
#include "offline_status_tests.moc"
