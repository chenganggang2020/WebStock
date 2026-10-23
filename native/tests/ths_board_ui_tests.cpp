#include "board_series_widget.hpp"
#include "sector_watch_page.hpp"
#include "ths_board_public.hpp"
#include <QComboBox>
#include <QPushButton>
#include <QLabel>
#include <QFile>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QtTest>
class ThsBoardUiTests:public QObject {
 Q_OBJECT
private slots:
 void providerSwitchNeverReusesForeignHistory(){
  QTemporaryDir temp;QVERIFY(temp.isValid());BoardSeriesWidget w(temp.path(),false);w.resize(1100,750);w.show();QVERIFY(QTest::qWaitForWindowExposed(&w));
  QFile live(QStringLiteral(REPO_ROOT)+"/output/ths-board-integration-20261023/live-results.json");QVERIFY(live.open(QIODevice::ReadOnly));auto records=QJsonDocument::fromJson(live.readAll()).array();
  QJsonObject ths,shortSeries;for(auto v:records){auto s=v.toObject()["series"].toObject();if(s["query"].toObject()["code"]=="881279")ths=s;if(s["query"].toObject()["code"]=="309121")shortSeries=s;}QVERIFY(!ths.isEmpty()&&!shortSeries.isEmpty());boardSeries::Cache cache(temp.path());cache.save(ths);cache.save(shortSeries);
  w.setBoard({{"provider","eastmoney-public-board"},{"taxonomy","industry"},{"code","BK1031"},{"name","光伏设备"}});QVERIFY(w.evidence()["series"].toObject().isEmpty());
  w.setBoard({{"provider",thsBoard::provider},{"taxonomy","industry"},{"code","881279"},{"name","光伏设备"}});QCOMPARE(w.evidence()["series"].toObject(),ths);QCOMPARE(w.findChild<QComboBox*>("boardSeriesProvider")->currentData().toString(),thsBoard::provider);
  QFile f(QStringLiteral(REPO_ROOT)+"/output/sector-source-alternatives-20261023/ths-industry.raw");QVERIFY(f.open(QIODevice::ReadOnly));auto directory=thsBoard::directory(f.readAll(),sectorWatch::query(thsBoard::provider,"industry"),"2026-10-23T01:00:00Z","2026-10-23T01:00:00Z");w.setDirectory(directory);QCOMPARE(w.evidence()["query"].toObject()["provider"].toString(),thsBoard::provider);
  w.setProvider("eastmoney-public-board");QCOMPARE(w.findChild<QComboBox*>("boardSeriesBoard")->count(),1);QCOMPARE(w.evidence()["query"].toObject()["code"].toString(),QString("BK1031"));QVERIFY(w.evidence()["series"].toObject().isEmpty());
  w.setBoard({{"provider",thsBoard::provider},{"taxonomy","concept"},{"code","309121"},{"name","AI PC"}});QCOMPARE(w.evidence()["series"].toObject()["rawCount"].toInt(),638);auto details=w.findChild<QLabel*>("boardSeriesDetails")->text();QVERIFY(details.contains("638/640"));QVERIFY(details.contains("886071"));QVERIFY(details.contains("同花顺"));
 }
 void independentProviderExposedAndNoMembersFallback(){
  QTemporaryDir temp;SectorWatchPage page(temp.path()+"/sector.sqlite",false);auto provider=page.findChild<QComboBox*>("sectorProvider");QVERIFY(provider->findData("eastmoney-public-board")>=0);QVERIFY(provider->findData(thsBoard::provider)>=0);provider->setCurrentIndex(provider->findData(thsBoard::provider));QVERIFY(!page.findChild<QPushButton*>("sectorFetchMembers")->isEnabled());QCOMPARE(page.saveState()["provider"].toString(),thsBoard::provider);
 }
};
QTEST_MAIN(ThsBoardUiTests)
#include "ths_board_ui_tests.moc"
