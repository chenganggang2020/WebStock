#include "window.hpp"
#include <QtWidgets>
#include <QtTest>

class WorkbenchChecks : public QObject {
 Q_OBJECT
private slots:
 void compactLayout() {
  QTemporaryDir data;
  Window w(true,data.filePath("settings.ini"),data.path());
  w.resize(1560,980); w.show(); QTest::qWait(150);
  const auto out=qEnvironmentVariable("UI_STEP01_OUTPUT");
  QDir().mkpath(out);
  QVERIFY(w.grab().save(out+"/expanded.png"));
  auto* gear=w.findChild<QPushButton*>("workbenchSettings");
  QVERIFY2(gear,"The shared settings gear must replace duplicate controls");
  QVERIFY(gear->isVisible()); QVERIFY(gear->menu());
  QVERIFY(!gear->icon().isNull());
  QVERIFY(!w.findChild<QLabel*>("marketStrip")->isVisible());
  QVERIFY(!w.findChild<QLabel*>("navigationGroupLabel")->isVisible());
  QVERIFY(!w.findChild<QPushButton*>("layoutclassic")->isVisible());
  auto* toggle=w.findChild<QAction*>("showQuoteDetails");
  QVERIFY(!w.findChild<QPushButton*>("toggleQuoteDetails"));
  auto* details=w.findChild<QWidget*>("quoteDetails");
  QVERIFY(toggle); QVERIFY(details); QVERIFY(details->isVisible());
  auto id=w.instrumentId(); auto count=w.chart->bars.size(); auto selected=w.chart->selected;
  QVERIFY(count>0);
  auto width=w.chart->width(); auto height=w.chart->height();
  toggle->trigger(); QTest::qWait(80);
  QVERIFY(!details->isVisible()); QVERIFY(w.chart->width()>width);
  QCOMPARE(w.instrumentId(),id); QCOMPARE(w.chart->bars.size(),count); QCOMPARE(w.chart->selected,selected);
  QVERIFY(w.grab().save(out+"/collapsed.png"));
  QFile metrics(out+"/geometry.json");QVERIFY(metrics.open(QIODevice::WriteOnly));
  metrics.write(QJsonDocument(QJsonObject{{"expandedChartWidth",width},{"collapsedChartWidth",w.chart->width()},{"expandedChartHeight",height},{"barCount",int(count)},{"selectedIndex",selected},{"instrument",id}}).toJson());metrics.close();
  w.setLayoutMode("focus"); QCOMPARE(w.layoutMode(),QString("classic"));
  QVERIFY(!details->isVisible());
  auto* overview=w.findChild<QAction*>("showQuoteOverview"); QVERIFY(overview);
  overview->trigger(); QCOMPARE(w.layoutMode(),QString("quotes"));
  w.findChild<QAction*>("showClassicWorkbench")->trigger(); QCOMPARE(w.layoutMode(),QString("classic"));
  w.findChild<QPushButton*>("workspace设置")->click();
  QVERIFY(gear->menu()->actions().contains(toggle));
  w.findChild<QAction*>("showClassicWorkbench")->trigger();
  QVERIFY(gear->isVisible());
  QVERIFY(!w.findChild<QLabel*>("marketStrip")->isVisible());
  gear->menu()->popup(gear->mapToGlobal(QPoint(0,gear->height()))); QTest::qWait(50);
  QVERIFY(gear->menu()->grab().save(out+"/settings-menu.png")); gear->menu()->close();
  w.close(); QTRY_VERIFY(!w.isVisible());
  Window reopened(true,data.filePath("settings.ini"),data.path());
  reopened.resize(1560,980); reopened.show(); QTest::qWait(80);
  QCOMPARE(reopened.layoutMode(),QString("classic"));
  QVERIFY(!reopened.findChild<QWidget*>("quoteDetails")->isVisible());
  reopened.findChild<QAction*>("showQuoteDetails")->trigger();
  QTRY_VERIFY(reopened.findChild<QWidget*>("quoteDetails")->isVisible());
  reopened.resize(1200,800);QTest::qWait(80);
  QVERIFY(!reopened.findChild<QWidget*>("quoteDetails")->isVisible());
  QVERIFY(!reopened.findChild<QAction*>("showQuoteDetails")->isEnabled());
  reopened.resize(1560,700);QTest::qWait(80);
  QVERIFY(!reopened.findChild<QWidget*>("quoteDetails")->isVisible());
  QVERIFY(!reopened.findChild<QAction*>("showQuoteDetails")->isEnabled());
  reopened.resize(1560,980);QTest::qWait(80);
  QVERIFY(reopened.findChild<QWidget*>("quoteDetails")->isVisible());
  reopened.close();
 }
};
int main(int argc,char** argv) {
 QApplication app(argc,argv); app.setQuitOnLastWindowClosed(false);
 if(QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc")<0)return 20;
 app.setFont(QFont("Microsoft YaHei UI",10)); QApplication::setStyle("Fusion");
 WorkbenchChecks checks; return QTest::qExec(&checks,argc,argv);
}
#include "ui_step01_workbench_tests.moc"
