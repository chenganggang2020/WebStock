#include <QtTest>
#include <QtWidgets>
#include <QTimeZone>
#include "stock_extension_host.hpp"
#include "compact_actions.hpp"
#include "chart.hpp"
#include "window.hpp"
using namespace quantPlugin;
namespace {
QByteArray package(QString id="org.test.first",QByteArray code="print('test')\n"){
  QJsonObject operation{{"id","test"},{"title","测试策略"},{"formulaVersion","test-v1"},{"inputKind","ohlcv-single-csv"},{"outputKind","indicator"},{"parameters",QJsonArray{}}};
  QJsonObject manifest{{"schema","webstock.plugin.manifest.v1"},{"protocolVersion",1},{"runtime","python"},{"id",id},{"version","1.0.0"},{"name","测试插件"},{"license","MIT"},{"entrypoint","worker.py"},{"files",QJsonObject{{"worker.py",hash(code)}}},{"operations",QJsonArray{operation}},{"ui",QJsonObject{{"apiVersion",1},{"placement","chart"},{"title","测试策略"},{"summary","生命周期测试"},{"toolbarLabel","测试策略"}}}};
  return QJsonDocument(QJsonObject{{"schema","webstock.plugin.package.v1"},{"manifest",manifest},{"files",QJsonObject{{"worker.py",QString::fromLatin1(code.toBase64())}}}}).toJson();
}
QJsonObject stock(Chart& chart){
  QFile file(QFileInfo(QString::fromUtf8(__FILE__)).absolutePath()+"/fixtures/extension-stock-000001.csv");if(!file.open(QIODevice::ReadOnly))throw std::runtime_error("fixture missing");auto lines=file.readAll().split('\n');QJsonArray rows;std::vector<market::Bar> bars;QStringList dates;
  for(int i=1;i<lines.size();++i){auto parts=QString::fromUtf8(lines[i]).trimmed().split(',');if(parts.size()<7)continue;auto date=QDate::fromString(parts[0],Qt::ISODate);auto time=QDateTime(date,QTime(0,0),QTimeZone("Asia/Shanghai")).toMSecsSinceEpoch();double o=parts[2].toDouble(),h=parts[3].toDouble(),l=parts[4].toDouble(),c=parts[5].toDouble(),v=parts[6].toDouble()/100;
    rows.append(QJsonObject{{"label",parts[0]},{"time",double(time)},{"open",o},{"high",h},{"low",l},{"close",c},{"volume",v},{"valid",true},{"closed",true}});
    bars.push_back({double(time),o,h,l,c,v,true,true,true});dates<<parts[0];
  }
  chart.setSeries(bars,dates,false);return {{"id","SZ:stock:000001"},{"name","平安银行"},{"period","day"},{"testing",false},{"rows",rows},{"meta",QJsonObject{{"source","腾讯公开K线"},{"adjustment","qfq"},{"checkedAt","2026-10-24T06:23:49Z"},{"timeUnit","milliseconds"},{"volumeUnit","手"}}}};
}
struct Harness {
  QTemporaryDir directory;QWidget window;QVBoxLayout* layout;CompactActions* tools;Chart* chart;StockExtensionHost* host;
  Harness(){layout=new QVBoxLayout(&window);tools=new CompactActions;layout->addLayout(tools);chart=new Chart;layout->addWidget(chart);host=new StockExtensionHost(directory.path()+"/extensions-v1",chart,tools,layout,&window);window.resize(1000,850);host->setContext(stock(*chart));}
  ~Harness(){delete host;}
};
}
class StockExtensionTests:public QObject {
  Q_OBJECT
private slots:
  void floatingControlsKeepTheChartSizeAndCanReopen(){
    Harness h;h.host->install(package());h.window.show();QCoreApplication::processEvents();const auto chartSize=h.chart->size();
    auto button=h.window.findChild<QPushButton*>("extensionAction_org.test.first");QVERIFY(button);button->click();
    auto panel=h.window.findChild<StockExtensionPanel*>();QVERIFY(panel);QVERIFY(panel->isWindow());QVERIFY(!panel->isModal());QVERIFY(panel->isVisible());QVERIFY(button->isChecked());
    QCoreApplication::processEvents();QCOMPARE(h.chart->size(),chartSize);QCOMPARE(h.layout->indexOf(panel),-1);
    panel->findChild<QPushButton*>("collapseExtensionPanel")->click();QVERIFY(panel->isHidden());QVERIFY(!button->isChecked());QCOMPARE(h.chart->size(),chartSize);
    button->click();QCOMPARE(h.window.findChildren<StockExtensionPanel*>().size(),1);QVERIFY(panel->isVisible());
    panel->close();QVERIFY(panel->isHidden());QVERIFY(!button->isChecked());button->click();QVERIFY(panel->isVisible());
    QTest::keyClick(panel,Qt::Key_Escape);QVERIFY(panel->isHidden());QVERIFY(!button->isChecked());
    h.host->uninstall("org.test.first");QVERIFY(!h.window.findChild<StockExtensionPanel*>());QCOMPARE(h.chart->size(),chartSize);
  }
  void chartHitTestingFollowsViewportAndIgnoresDrag(){
    Chart chart;stock(chart);chart.resize(900,480);chart.visibleCount=80;chart.endIndex=640;
    chartExtension::Layer layer;layer.segments.append({{570,10.5},{625,11.2},QColor("#ef717a"),"one"});
    layer.markers.append({570,10.5,"up","entry","fill",Qt::blue,"one","买"});chart.setExtensionLayer("plugin",layer);
    auto midpoint=[&]{return (chart.extensionPoint(570,10.5)+chart.extensionPoint(625,11.2))/2;};
    QCOMPARE(chart.extensionItemAt(midpoint()).id,QString("one"));QVERIFY(chart.extensionItemAt({0,0}).id.isEmpty());
    QCOMPARE(chart.extensionItemAt(chart.extensionPoint(570,10.5)).owner,QString("plugin"));
    chart.resize(1200,620);chart.visibleCount=50;chart.endIndex=630;
    QCOMPARE(chart.extensionItemAt(midpoint()).id,QString("one"));
    chart.show();QCoreApplication::processEvents();QSignalSpy click(&chart,&Chart::extensionItemSelected);
    auto point=midpoint().toPoint();QTest::mouseClick(&chart,Qt::LeftButton,Qt::NoModifier,point);
    QCOMPARE(click.size(),1);QCOMPARE(click.last()[1].toString(),QString("one"));
    click.clear();QTest::mousePress(&chart,Qt::LeftButton,Qt::NoModifier,point);QTest::mouseMove(&chart,point+QPoint(30,0));QTest::mouseRelease(&chart,Qt::LeftButton,Qt::NoModifier,point+QPoint(30,0));QCOMPARE(click.size(),0);
    chart.removeExtensionLayer("plugin");QVERIFY(chart.extensionItemAt(midpoint()).id.isEmpty());
  }
  void installDisableUninstallAreOwned(){
    Harness h;QCOMPARE(h.window.findChildren<QPushButton*>(QRegularExpression("^extensionAction_")).size(),0);h.host->install(package());h.host->install(package("org.test.second"));h.host->open("org.test.first");QCOMPARE(h.window.findChildren<StockExtensionPanel*>().size(),1);
    chartExtension::Layer layer;layer.markers.append({639,11.2,"up","test","fill",Qt::red});h.chart->setExtensionLayer("org.test.first",layer);h.chart->setExtensionLayer("org.test.second",layer);
    h.host->setEnabled("org.test.first",false);QVERIFY(!h.window.findChild<QPushButton*>("extensionAction_org.test.first"));QVERIFY(!h.chart->extensionLayers.contains("org.test.first"));QVERIFY(h.chart->extensionLayers.contains("org.test.second"));QCOMPARE(h.chart->bars.size(),size_t(640));
    h.host->setEnabled("org.test.first",true);QVERIFY(h.window.findChild<QPushButton*>("extensionAction_org.test.first"));
    Repository repo(h.host->root());auto installed=repo.plugin("org.test.first");QVERIFY(QFileInfo::exists(repo.directory(installed)));h.host->uninstall("org.test.first");QVERIFY(!QFileInfo::exists(h.host->root()+"/packages/org.test.first"));QVERIFY(h.window.findChild<QPushButton*>("extensionAction_org.test.second"));QCOMPARE(h.chart->bars.size(),size_t(640));
    h.host->install(package());QVERIFY(h.window.findChild<QPushButton*>("extensionAction_org.test.first"));
  }
  void invalidPackageAndUnsupportedApiLeaveHostUsable(){
    Harness h;h.host->install(package());auto corrupt=object(package());auto files=corrupt["files"].toObject();files["worker.py"]="YmFk";corrupt["files"]=files;
    QVERIFY_EXCEPTION_THROWN(h.host->install(QJsonDocument(corrupt).toJson()),std::exception);
    Repository repo(h.host->root());QVERIFY(repo.plugin("org.test.first")["enabled"].toBool());QVERIFY(h.window.findChild<QPushButton*>("extensionAction_org.test.first"));
    auto bad=object(package("org.test.third"));auto m=bad["manifest"].toObject();auto ui=m["ui"].toObject();ui["apiVersion"]=99;m["ui"]=ui;bad["manifest"]=m;
    QVERIFY_EXCEPTION_THROWN(h.host->install(QJsonDocument(bad).toJson()),std::exception);QCOMPARE(repo.plugins().size(),1);
  }
  void historyAndSharedCacheRetention(){
    Harness h;h.host->install(package());auto root=h.host->root();QDir().mkpath(root+"/jobs/plugin-retained");write(root+"/jobs/plugin-retained/record.json",QJsonObject{{"pluginId","org.test.first"},{"status","completed"}});QDir().mkpath(h.directory.path()+"/live");write(h.directory.path()+"/live/keep",QByteArray("shared"));
    h.host->uninstall("org.test.first",true);QVERIFY(QFileInfo::exists(root+"/jobs/plugin-retained/record.json"));QVERIFY(QFileInfo::exists(h.directory.path()+"/live/keep"));
    h.host->install(package());h.host->uninstall("org.test.first",false);QVERIFY(!QFileInfo::exists(root+"/jobs/plugin-retained"));QVERIFY(QFileInfo::exists(h.directory.path()+"/live/keep"));
  }
  void offeredUpdateReplacesOnlyItsContribution(){
    Harness h;h.host->install(package());h.host->install(package("org.test.second"));h.host->open("org.test.first");
    auto newer=object(package());auto manifest=newer["manifest"].toObject();manifest["version"]="1.1.0";newer["manifest"]=manifest;
    QDir().mkpath(h.host->root()+"/offers");write(h.host->root()+"/offers/update.wspkg",QJsonDocument(newer).toJson());
    h.host->showManager();auto update=h.window.findChild<QPushButton*>("pluginUpdate_org.test.first");QVERIFY(update);update->click();
    Repository repo(h.host->root());QCOMPARE(repo.plugin("org.test.first")["manifest"].toObject()["version"].toString(),QString("1.1.0"));
    QVERIFY(!h.window.findChild<StockExtensionPanel*>());QVERIFY(h.window.findChild<QPushButton*>("extensionAction_org.test.first"));
    QVERIFY(h.window.findChild<QPushButton*>("extensionAction_org.test.second"));QCOMPARE(h.chart->bars.size(),size_t(640));
  }
  void concurrentJobBlocksRemoval(){
    Harness h;h.host->install(package());const auto root=h.host->root();QDir().mkpath(root+"/jobs/plugin-active");write(root+"/jobs/plugin-active/record.json",QJsonObject{{"pluginId","org.test.first"},{"status","running"}});
    QLockFile running(root+"/jobs/plugin-active/run.lock");QVERIFY(running.tryLock());QVERIFY_EXCEPTION_THROWN(h.host->uninstall("org.test.first"),std::exception);QVERIFY(QFileInfo::exists(root+"/packages/org.test.first"));running.unlock();h.host->uninstall("org.test.first");
  }
  void settingsMenuUsesCurrentBase(){
    QTemporaryDir d;Window window(true,d.path()+"/review.ini",d.path());QVERIFY(window.findChild<QAction*>("openPluginManager"));QVERIFY(window.findChild<QPushButton*>("workbenchSettings"));QVERIFY(window.extensions);QCOMPARE(window.extensions->root(),d.path()+"/extensions-v1");
    window.findChild<QAction*>("openPluginManager")->trigger();QVERIFY(window.findChild<QDialog*>("stockPluginManager"));QVERIFY(window.chart);
  }
  void uninstallStopsOwnedProcess(){
    const auto runtime=qEnvironmentVariable("WEBSTOCK_EXTENSION_PYTHON");if(runtime.isEmpty())QSKIP("Set test Python runtime");
    Harness h;write(h.host->root()+"/runtime-defaults.json",QJsonObject{{"org.test.first",runtime}});h.host->install(package("org.test.first","import time\ntime.sleep(60)\n"));h.host->open("org.test.first");auto panel=h.window.findChild<StockExtensionPanel*>();QVERIFY(panel);panel->findChild<QPushButton*>("extensionRun")->click();QVERIFY(panel->isRunning());h.host->uninstall("org.test.first");QVERIFY(!h.window.findChild<StockExtensionPanel*>());QVERIFY(h.chart->extensionLayers.isEmpty());Job audit(h.host->root());for(auto v:audit.records())QVERIFY(v.toObject()["status"]!="running");QCOMPARE(h.chart->bars.size(),size_t(640));
  }
  void realStockRoundTrip(){
    const auto runtime=qEnvironmentVariable("WEBSTOCK_EXTENSION_PYTHON"),bundle=qEnvironmentVariable("WEBSTOCK_EXTENSION_PACKAGE");if(runtime.isEmpty()||bundle.isEmpty())QSKIP("Set real-engine runtime and generated package paths");
    Harness h;write(h.host->root()+"/runtime-defaults.json",QJsonObject{{"org.webstock.backtesting-py",runtime}});h.host->install(read(bundle));h.host->open("org.webstock.backtesting-py");h.window.show();QCoreApplication::processEvents();auto panel=h.window.findChild<StockExtensionPanel*>();QVERIFY(panel);auto run=panel->findChild<QPushButton*>("extensionRun");QVERIFY2(run->isEnabled(),qPrintable(panel->findChild<QLabel*>("extensionStatus")->text()));run->click();
    QTRY_VERIFY_WITH_TIMEOUT(!panel->isRunning(),90000);const auto runId=panel->property("runId").toString();QVERIFY2(!runId.isEmpty(),qPrintable(panel->findChild<QLabel*>("extensionStatus")->text()));Job audit(h.host->root());auto result=audit.reopen(runId)["result"].toObject();QCOMPARE(result["bars"].toInt(),640);auto view=result["view"].toObject();QCOMPARE(view["metrics"].toArray()[2].toObject()["value"].toString(),QString("12"));QCOMPARE(view["metrics"].toArray()[3].toObject()["value"].toString(),QString("99,610.10"));
    const QString plugin="org.webstock.backtesting-py";
    QVERIFY(h.chart->extensionLayers.contains(plugin));QCOMPARE(h.chart->extensionLayers[plugin].markers.size(),25);QCOMPARE(h.chart->extensionLayers[plugin].segments.size(),12);QCOMPARE(h.chart->bars.size(),size_t(640));
    panel->findChild<QCheckBox*>("extensionSignals")->setChecked(true);QCOMPARE(h.chart->extensionLayers[plugin].markers.size(),51);
    auto segment=h.chart->extensionLayers[plugin].segments.last();h.chart->visibleCount=qMax(40,int(segment.to.x()-segment.from.x())+24);h.chart->endIndex=qMin(640,int(segment.to.x())+12);h.chart->repaint();
    h.window.setProperty("stockTheme","navy");
    auto point=(h.chart->extensionPoint(int(segment.from.x()),segment.from.y())+h.chart->extensionPoint(int(segment.to.x()),segment.to.y()))/2;
    QTest::mouseClick(h.chart,Qt::LeftButton,Qt::NoModifier,point.toPoint());auto card=h.chart->findChild<QFrame*>("extensionInspectionCard");QVERIFY(card);QCOMPARE(card->property("itemId").toString(),segment.id);QVERIFY(card->isVisible());QCOMPARE(h.chart->extensionLayers[plugin].selectedId,segment.id);
    QStringList words;for(auto label:card->findChildren<QLabel*>())words<<label->text();QVERIFY(words.join(" ").contains("扣费净盈亏"));QVERIFY(words.join(" ").contains("交易费用"));
    QCOMPARE(card->palette().color(QPalette::WindowText),QColor("#e6edf5"));QVERIFY(card->styleSheet().contains("#1c2838"));
    card->findChild<QToolButton*>("closeExtensionInspection")->click();QVERIFY(!h.chart->findChild<QFrame*>("extensionInspectionCard"));QVERIFY(h.chart->extensionLayers[plugin].selectedId.isEmpty());
    panel->findChild<QCheckBox*>("extensionConnections")->setChecked(false);QVERIFY(h.chart->extensionLayers[plugin].segments.isEmpty());panel->findChild<QCheckBox*>("extensionConnections")->setChecked(true);
    // Table selection shows the same inspection, including an unclosed entry.
    auto table=panel->findChild<QTableWidget*>("extensionTable_fills");QVERIFY(table);table->cellClicked(table->rowCount()-1,0);card=h.chart->findChild<QFrame*>("extensionInspectionCard");QVERIFY(card);QCOMPARE(card->findChild<QLabel*>("inspectionValue")->text(),QString("持仓中"));QVERIFY(card->property("itemId").toString()!=segment.id);
    const auto chartSize=h.chart->size();panel->hide();QCOMPARE(h.chart->extensionLayers[plugin].segments.size(),12);
    // Collapsing controls leaves results and chart inspection usable, without a rerun.
    card=h.chart->findChild<QFrame*>("extensionInspectionCard");QVERIFY(card);card->findChild<QToolButton*>("closeExtensionInspection")->click();
    h.chart->visibleCount=qMax(40,int(segment.to.x()-segment.from.x())+24);h.chart->endIndex=qMin(640,int(segment.to.x())+12);
    point=(h.chart->extensionPoint(int(segment.from.x()),segment.from.y())+h.chart->extensionPoint(int(segment.to.x()),segment.to.y()))/2;
    QTest::mouseClick(h.chart,Qt::LeftButton,Qt::NoModifier,point.toPoint());QVERIFY(h.chart->findChild<QFrame*>("extensionInspectionCard"));
    h.host->open(plugin);QCOMPARE(h.chart->extensionLayers[plugin].segments.size(),12);QCOMPARE(panel->property("runId").toString(),runId);QCOMPARE(h.chart->size(),chartSize);
    table=panel->findChild<QTableWidget*>("extensionTable_closed-trades");table->cellClicked(0,0);QVERIFY(h.chart->findChild<QFrame*>("extensionInspectionCard"));
    auto changed=stock(*h.chart);changed["id"]="SH:stock:600000";h.host->setContext(changed);QVERIFY(h.chart->extensionLayers.isEmpty());QVERIFY(panel->property("runId").toString().isEmpty());
    QVERIFY(!h.chart->findChild<QFrame*>("extensionInspectionCard"));
    h.host->uninstall("org.webstock.backtesting-py");QVERIFY(!h.window.findChild<StockExtensionPanel*>());QCOMPARE(audit.reopen(runId)["status"].toString(),QString("completed"));QVERIFY(!QFileInfo::exists(h.host->root()+"/packages/org.webstock.backtesting-py"));
  }
};
QTEST_MAIN(StockExtensionTests)
#include "stock_extension_tests.moc"
