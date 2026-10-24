#include "window.hpp"
#include "capital_workbench_roster.hpp"
#include "capital_timeline.hpp"
#include "market_data.hpp"
#include "etf_page.hpp"
#include "futures_monitor_page.hpp"
#include "global_market_page.hpp"
#include <QtTest>
class CapitalUiTests:public QObject {
 Q_OBJECT
private slots:
 void requestedDateShowsOnlyApplicableTradingDay_data(){
  QTest::addColumn<QDate>("requested");QTest::addColumn<bool>("showsFriday");
  QTest::newRow("closed-saturday-shows-friday")<<QDate(2026,10,24)<<true;
  QTest::newRow("missing-open-monday-does-not-borrow-friday")<<QDate(2026,10,26)<<false;
 }
 void requestedDateShowsOnlyApplicableTradingDay(){
  QFETCH(QDate,requested);QFETCH(bool,showsFriday);
  QTemporaryDir data;QVERIFY(data.isValid());const auto directory=data.filePath("dark-stocks-v1");
  // Synthetic, independently dated fixture: this checks page behavior, not a live-source update.
  QJsonObject raw{{"errid",0},{"1","20261023"},{"2",1},{"data",QJsonArray{
   QJsonObject{{"3",1},{"4","600487"},{"16","测试股票"},{"6",-230000},{"7",250000},{"8",20000},{"14",0.0425},{"13",10230}}
  }}};
  darkStock::Assembly assembled("2026-10-23","2026-10-23T07:00:00Z");
  assembled.append(darkStock::normalize(raw,"2026-10-23",1,"2026-10-23T07:00:01Z"),1000);
  const auto saved=assembled.finish();darkStock::Store store(directory);store.save(saved);
  QJsonObject security{{"id","SH:stock:600487"},{"symbol","sh600487"},{"name","测试股票"},
   {"quote",QJsonObject{{"tradeDate","2026-10-23"},{"changePercent",4.25}}},
   {"capitalDay",QJsonArray{QJsonObject{{"label","2026-10-23"},{"mainNet",1234500},{"superNet",2000000},{"largeNet",-765500},{"mediumNet",-100000},{"smallNet",-1134500}}}},
   {"capitalDayMeta",QJsonObject{{"cached",true},{"dataDate","2026-10-23"}}}};
  CapitalWorkbenchRoster roster(directory,QJsonArray{security},false);roster.resize(1600,700);roster.show();
  auto* date=roster.findChild<QDateEdit*>("capitalModelDate");auto* table=roster.findChild<QTableWidget*>("capitalRosterTable");auto* state=roster.findChild<QLabel*>("capitalModelState");
  QVERIFY(date);QVERIFY(table);QVERIFY(state);QVERIFY(date->calendarPopup());date->setDate(requested);roster.load(false);
  QTRY_VERIFY_WITH_TIMEOUT(state->text().contains(requested.toString(Qt::ISODate))&&!state->text().contains("正在"),5000);
  QCOMPARE(date->date(),requested);QCOMPARE(table->rowCount(),1);
  if(showsFriday){
   QCOMPARE(table->item(0,1)->text(),QString("4.25"));
   const QStringList amounts{"123.45","-23.00","25.00","200.00","-76.55","-10.00","-113.45"};
   for(int column=2;column<=8;++column)QCOMPARE(table->item(0,column)->text(),amounts[column-2]);
   QVERIFY(table->item(0,9)->text().startsWith("2026-10-23"));QVERIFY(table->item(0,10)->text().startsWith("2026-10-23"));
   QVERIFY(state->text().contains("2026-10-23"));
  }else{
   for(int column=1;column<=8;++column)QCOMPARE(table->item(0,column)->text(),QString("—"));
   QCOMPARE(table->item(0,9)->text(),QString("该日未取得"));QCOMPARE(table->item(0,10)->text(),QString("该日未取得"));
  }
  QVERIFY(!state->text().contains("本次完整获取"));QVERIFY(!state->text().contains("今天更新成功"));
  QCOMPARE(store.read("2026-10-23"),saved);QVERIFY(store.read(requested.toString(Qt::ISODate)).isEmpty());
  roster.close();
 }
 void actualNewPagesEvidence(){
  const auto output=qEnvironmentVariable("NEW_MARKET_EVIDENCE");QVERIFY(!output.isEmpty());QFile f(output+"/actual-instruments.json");QVERIFY(f.open(QIODevice::ReadOnly));const auto actual=QJsonDocument::fromJson(f.readAll()).array();QVERIFY(!actual.isEmpty());
  QTemporaryDir settings;Window w(true,settings.filePath("settings.ini"),output+"/qa-profile");w.testing=false;w.instruments=actual;w.resize(1900,1200);w.show();w.funds();
  auto* roster=dynamic_cast<CapitalWorkbenchRoster*>(w.findChild<QWidget*>("capitalRoster"));QVERIFY(roster);auto* scope=w.findChild<QComboBox*>("capitalScope");scope->setCurrentIndex(1);auto* search=w.findChild<QLineEdit*>("capitalSearch");search->setText("002565");w.findChild<QDateEdit*>("capitalModelDate")->setDate(QDate(2026,10,22));w.statusBar()->showMessage("2026-10-22真实已保存记录 · 原生离屏页面验收");
  auto* table=w.findChild<QTableWidget*>("capitalRosterTable");QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(),1,20000);QTRY_VERIFY_WITH_TIMEOUT(table->item(0,10)->text().startsWith("2026-10-22"),20000);QVERIFY(w.grab().save(output+"/after-funds-list.png"));table->setCurrentCell(0,0);QMetaObject::invokeMethod(table,"cellClicked",Q_ARG(int,0),Q_ARG(int,0));
  auto* chart=dynamic_cast<CapitalTimeline*>(w.findChild<QWidget*>("fundTimeline"));QVERIFY(chart);
  QTRY_VERIFY_WITH_TIMEOUT(roster->historicalModelRows().size()>=3,30000);QVERIFY(chart->isVisible());QVERIFY(!table->isVisible());QVERIFY(w.grab().save(output+"/after-funds-history.png"));
  QFile receipt(output+"/actual-ui-receipt.json");QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write(QJsonDocument(QJsonObject{{"nativeWidgetRender",true},{"foregroundDesktopInteraction",false},{"capitalUsedSavedRecords",true},{"stockKlineRequestedSeparately",true},{"rows",chart->sourceRows()},{"modelPoints",roster->historicalModelRows().size()}}).toJson());
  w.findChild<QPushButton*>("capitalBackToList")->click();QVERIFY(table->isVisible());w.home();w.instruments=actual;QJsonObject observed{{"id","SZ:stock:300450"},{"symbol","sz300450"},{"name","先导智能"},{"transient",true}};
  QTemporaryDir stockData;QVERIFY(stockData.isValid());MarketFeed stockSource(stockData.path(),&w,nullptr,false);stockSource.observe(observed);
  QObject::connect(&stockSource,&MarketFeed::updated,&w,[&]{QFile sourceReceipt(output+"/stock-live-receipt.json");if(sourceReceipt.open(QIODevice::WriteOnly))sourceReceipt.write(QJsonDocument(stockSource.instruments[0].toObject()).toJson());});
  stockSource.chart(observed["id"].toString(),"day",true);stockSource.refreshQuotes();
  QTRY_VERIFY_WITH_TIMEOUT(stockSource.instruments[0].toObject()["quote"].toObject()["price"].isDouble(),20000);
  QTRY_VERIFY_WITH_TIMEOUT(!stockSource.instruments[0].toObject()["day"].toArray().isEmpty()||!stockSource.instruments[0].toObject()["dayMeta"].toObject()["error"].toString().isEmpty()||!stockSource.instruments[0].toObject()["dayMeta"].toObject()["persistenceError"].toString().isEmpty(),20000);
  observed=stockSource.instruments[0].toObject();QVERIFY2(!observed["day"].toArray().isEmpty(),qPrintable(QString::fromUtf8(QJsonDocument(observed["dayMeta"].toObject()).toJson(QJsonDocument::Compact))));QVERIFY(observed["id"]=="SZ:stock:300450");bool found=false;for(auto v:w.instruments)found|=v.toObject()["id"]==observed["id"];if(!found)w.instruments.append(observed);w.loadInstrument(observed["id"].toString());w.statusBar()->showMessage("先导智能独立来源K线已核验 · 临时观察未加入自选");
  QVERIFY(w.grab().save(output+"/after-stock-list.png"));w.close();
  GlobalMarketPage global(output+"/qa-profile",false);global.setPalette(w.palette());global.setStyleSheet(w.styleSheet());global.resize(1900,1100);global.show();global.restoreState({{"schema","native-global-market-ui/v1"},{"key","china-a50-future"},{"period","intraday"},{"automatic",false}});
  QTRY_VERIFY_WITH_TIMEOUT(!global.sourceEvidence()["series"].toObject().isEmpty(),20000);QCOMPARE(global.sourceEvidence()["range"].toObject()["visibleCount"].toInt(),global.sourceEvidence()["series"].toObject()["points"].toArray().size());QVERIFY(global.grab().save(output+"/after-global-axis.png"));global.close();
 }
 void stockSearchLivesAboveListWithCollapsibleGroups(){
  QTemporaryDir data;Window w(true,data.filePath("settings.ini"),data.path());w.resize(1500,950);w.show();QTest::qWait(50);
  auto* query=w.findChild<QLineEdit*>("search");auto* groups=w.findChild<QWidget*>("groupPanel");QVERIFY(query);QVERIFY(!groups->isVisible());QVERIFY(!groups->isAncestorOf(query));
  w.findChild<QPushButton*>("toggleWatchlistGroups")->click();QVERIFY(groups->isVisible());w.findChild<QPushButton*>("toggleWatchlistGroups")->click();QVERIFY(!groups->isVisible());
  QJsonObject observed{{"id","SZ:stock:300450"},{"name","先导智能"},{"symbol","sz300450"},{"transient",true}};w.instruments.append(observed);w.loadInstrument("SZ:stock:300450");
  bool found=false;for(int r=0;r<w.stocks->rowCount();++r)found|=w.stocks->item(r,0)->data(Qt::UserRole).toString()=="SZ:stock:300450";QVERIFY(found);
  query->setText("先导");w.updateUnifiedSearch(false);QVERIFY(w.chart->isVisible());QVERIFY(query->parentWidget()->isAncestorOf(w.findChild<QTabWidget*>("unifiedSearchResults")));w.close();
 }
 void fullPageCapitalNavigation(){
  QTemporaryDir data;Window w(true,data.filePath("settings.ini"),data.path());w.instruments=QJsonArray{QJsonObject{{"id","SZ:stock:002565"},{"symbol","sz002565"},{"name","顺灏股份"}}};w.resize(1500,950);w.show();w.funds();QTest::qWait(80);
  auto* pages=w.findChild<QStackedWidget*>("capitalWorkbenchPages");QVERIFY(pages);QCOMPARE(pages->currentIndex(),0);
  auto* table=w.findChild<QTableWidget*>("capitalRosterTable");QVERIFY(table);QVERIFY(table->isVisible());
  auto* search=w.findChild<QLineEdit*>("capitalSearch");search->setText("002565");QVERIFY(table->rowCount()>0);
  QMetaObject::invokeMethod(table,"cellClicked",Q_ARG(int,0),Q_ARG(int,0));QCOMPARE(pages->currentIndex(),1);QVERIFY(!table->isVisible());
  auto* timeline=w.findChild<QWidget*>("fundTimeline");QVERIFY(timeline->isVisible());QVERIFY(timeline->height()>400);
  w.findChild<QPushButton*>("capitalBackToList")->click();QCOMPARE(pages->currentIndex(),0);QCOMPARE(search->text(),QString("002565"));
  // Reactivating the same selected row must reopen the history page as well.
  QMetaObject::invokeMethod(table,"cellClicked",Q_ARG(int,0),Q_ARG(int,0));QCOMPARE(pages->currentIndex(),1);
  w.close();
 }
 void actualSavedDataBackgroundEvidence(){
  const auto output=qEnvironmentVariable("CAPITAL_HISTORY_EVIDENCE");QVERIFY(!output.isEmpty());
  QFile f(output+"/actual-instruments.json");QVERIFY(f.open(QIODevice::ReadOnly));auto instruments=QJsonDocument::fromJson(f.readAll()).array();QVERIFY(!instruments.isEmpty());
  QTemporaryDir data;Window w(true,data.filePath("settings.ini"),output+"/qa-profile");w.testing=false;w.instruments=instruments;
  w.resize(1900,1200);w.show();w.funds();QTest::qWait(250);
  auto* roster=dynamic_cast<CapitalWorkbenchRoster*>(w.findChild<QWidget*>("capitalRoster"));QVERIFY(roster);
  auto* scope=w.findChild<QComboBox*>("capitalScope");scope->setCurrentIndex(1);
  auto* search=w.findChild<QLineEdit*>("capitalSearch");search->setText("002565");
  auto* table=w.findChild<QTableWidget*>("capitalRosterTable");QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(),1,10000);table->setCurrentCell(0,0);
  auto* chart=dynamic_cast<CapitalTimeline*>(w.findChild<QWidget*>("fundTimeline"));QVERIFY(chart);
  auto modelDays=[chart]{int n=0;for(auto v:chart->sourceRows())n+=v.toObject().value("darkNet").isDouble();return n;};
  QTRY_VERIFY_WITH_TIMEOUT(modelDays()>=2,30000);
  auto joined=chart->sourceRows();int main=0,dark=0,candles=0;for(auto v:joined){auto r=v.toObject();main+=r["mainNet"].isDouble();dark+=r["darkNet"].isDouble();candles+=r["candle"].isObject();}
  QVERIFY(dark>=2);QVERIFY(candles>0);QCOMPARE(table->columnCount(),11);
  QCOMPARE(table->item(0,9)->text(),QString("该日未取得"));
  w.statusBar()->showMessage("后台原生页面离屏验收 · 真实已保存数据 · 非桌面交互或本次行情更新");
  QVERIFY(w.grab().save(output+"/after-capital-background.png"));
  QFile receipt(output+"/background-capital-receipt.json");QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write(QJsonDocument(QJsonObject{{"savedDataOnly",true},{"mainDays",main},{"modelDays",dark},{"candleDays",candles},{"rows",joined},{"note","实际原生页面离屏渲染，数据为已保存真实记录；非桌面交互验收，非本次行情刷新"}}).toJson());
  auto* date=w.findChild<QDateEdit*>("capitalModelDate");date->setDate(QDate(2026,10,22));
  QTRY_VERIFY_WITH_TIMEOUT(table->item(0,9)->text().startsWith("2026-10-22"),10000);
  QVERIFY(table->item(0,2)->text()!="—");QTRY_VERIFY_WITH_TIMEOUT(table->item(0,10)->text().startsWith("2026-10-22"),10000);
  QVERIFY(w.grab().save(output+"/after-selected-day-background.png"));
  date->setDate(QDate(2026,10,23));QTRY_VERIFY_WITH_TIMEOUT(table->item(0,10)->text().startsWith("2026-10-23"),10000);
  // Failed main-source data must leave genuine model history independently visible.
  w.instruments={QJsonObject{{"id","SZ:stock:002185"},{"symbol","sz002185"},{"name","华天科技"}}};roster->updateSources(w.instruments);search->setText("002185");QTRY_COMPARE(table->rowCount(),1);table->setCurrentCell(0,0);
  QTRY_VERIFY_WITH_TIMEOUT(!roster->historicalModelRows().isEmpty(),10000);QVERIFY(!chart->sourceRows().isEmpty());
  QVERIFY(w.grab().save(output+"/after-main-unavailable-background.png"));
  w.close();
  FuturesMonitorPage future(output+"/qa-profile/futures-monitor-v1.sqlite",{},{});future.resize(1800,1000);future.show();QTest::qWait(80);
  auto* overview=future.findChild<QTableWidget*>("futuresOverview");QCOMPARE(overview->rowCount(),7);QCOMPARE(overview->verticalScrollBar()->maximum(),0);QVERIFY(future.grab().save(output+"/after-futures-background.png"));future.close();
 }
 void actualEtfBackfillBackground(){
  const auto output=qEnvironmentVariable("CAPITAL_HISTORY_EVIDENCE");QVERIFY(!output.isEmpty());
  const auto file=output+"/qa-profile/etf-daily-v1.sqlite";etfDaily::Store store(file);const int before=store.history().size();store.setScheduleEnabled(false);
  EtfPage page(file,true);page.resize(1800,1100);page.show();page.refreshSource();
  auto* refresh=page.findChild<QPushButton*>("etfRefresh");QTRY_VERIFY_WITH_TIMEOUT(refresh->isEnabled(),180000);
  auto after=store.history();QVERIFY2(after.size()>before,qPrintable(page.findChild<QLabel*>("etfState")->text()));
  QVERIFY(page.grab().save(output+"/after-etf-background.png"));
  QFile receipt(output+"/etf-backfill-receipt.json");QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write(QJsonDocument(QJsonObject{{"before",before},{"after",after.size()},{"state",page.findChild<QLabel*>("etfState")->text()},{"reports",after},{"note","真实公开请求，经原生解析和逐篇来源校验；仅写隔离验收副本"}}).toJson());page.close();
 }
 void mergedSelectionAndSettings(){
  QTemporaryDir data;Window w(true,data.filePath("settings.ini"),data.path());w.resize(1560,1000);w.show();QTest::qWait(80);
  w.findChild<QPushButton*>("workspace资金")->click();
  auto* nav=w.findChild<QAction*>("nav_funds");QVERIFY(nav);nav->trigger();QTest::qWait(80);
  QVERIFY(!w.findChild<QAction*>("nav_darkStocks"));
  auto* table=w.findChild<QTableWidget*>("capitalRosterTable");QVERIFY(table);QVERIFY(table->rowCount()>0);
  table->setCurrentCell(0,0);auto selected=table->item(0,0)->data(Qt::UserRole).toJsonObject();
  QCOMPARE(w.findChild<QComboBox*>("fundSymbols")->currentData().toString(),selected["id"].toString());
  QVERIFY(w.findChild<QLabel*>("capitalSelectedTitle")->text().contains(selected["name"].toString()));
  auto* scope=w.findChild<QComboBox*>("capitalScope");scope->setCurrentIndex(2);QCOMPARE(table->rowCount(),4);table->setCurrentCell(0,0);
  QCOMPARE(w.findChild<QComboBox*>("fundSymbols")->currentData().toString(),QString("SH:index:000001"));
  auto* mode=w.findChild<QComboBox*>("fundMode");mode->setCurrentIndex(mode->findData("dark"));QCOMPARE(static_cast<CapitalTimeline*>(w.findChild<QWidget*>("fundTimeline"))->sourceRows().size(),0);
  QVERIFY(!w.findChild<QToolButton*>("fundRecordsDetails")->isVisible());
  auto* settings=w.findChild<QMenu*>("pageSourceSettings");QVERIFY(settings);
  // Populate before hovering the submenu: Qt will not open an empty submenu.
  auto* rootMenu=w.findChild<QMenu*>("workbenchSettingsMenu");QVERIFY(rootMenu);
  QMetaObject::invokeMethod(rootMenu,"aboutToShow");QVERIFY(!settings->actions().isEmpty());
  w.resize(1000,760);QTest::qWait(50);QVERIFY(w.findChild<QStackedWidget*>("capitalWorkbenchPages")->isVisible());
  w.close();QTRY_VERIFY(!w.isVisible());
 }
 void capturedMarketResponses(){
  auto dir=qEnvironmentVariable("CAPITAL_EVIDENCE");QVERIFY(!dir.isEmpty());
  for(auto item:capitalWorkbench::markets()){
   auto s=item.toObject();auto symbol=s["symbol"].toString();auto secid=(symbol.startsWith("sh")?QString("1."):QString("0."))+symbol.mid(2);
   QFile f(dir+"/market-"+secid+".json");QVERIFY(f.open(QIODevice::ReadOnly));auto bytes=f.readAll();if(bytes.startsWith("\xef\xbb\xbf"))bytes.remove(0,3);
   auto raw=QJsonDocument::fromJson(bytes).object();QCOMPARE(raw["data"].toObject()["name"],s["name"]);
   auto result=marketdata::capital(raw,symbol,"day",QDateTime::currentDateTimeUtc());auto rows=result["rows"].toArray();QCOMPARE(rows.size(),120);
   const auto original=raw["data"].toObject()["klines"].toArray();
   for(int i=0;i<rows.size();++i){auto fields=original[i].toString().split(',');QCOMPARE(rows[i].toObject()["mainNet"].toDouble(),fields[1].toDouble());QCOMPARE(rows[i].toObject()["label"].toString(),fields[0]);}
   QVERIFY_EXCEPTION_THROWN(marketdata::capital(raw,symbol.startsWith("sh")?"sz"+symbol.mid(2):"sh"+symbol.mid(2),"day",QDateTime::currentDateTimeUtc()),std::runtime_error);
  }
 }
};
int main(int argc,char** argv){QApplication app(argc,argv);app.setQuitOnLastWindowClosed(false);QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");app.setFont(QFont("Microsoft YaHei UI",10));CapitalUiTests t;return QTest::qExec(&t,argc,argv);}
#include "capital_workbench_ui_tests.moc"
