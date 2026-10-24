#include "etf_monitor_model.hpp"
#include "etf_monitor_store.hpp"
#include "etf_monitor_page.hpp"
#include <QtTest>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QFile>
#include <QListWidget>
#include <QPushButton>
#include <QSplitter>
#include <QFontDatabase>
#include <QApplication>
#include <QDir>
#include <QDateEdit>
#include <QImage>
QJsonObject fixture(){QJsonArray minutes;for(int n=0;n<10;n++)minutes.append(QJsonObject{{"time",QString("2026-10-12 14:%1:00").arg(51+n,2,10,QChar('0')).replace("14:60","15:00")},{"price",4.6},{"amount",n<5?100:150}});return {{"schema","native-etf-monitor/v1"},{"provider","host-held-etf"},{"receivedAt","2026-10-12T07:01:00Z"},{"items",QJsonArray{QJsonObject{{"id","SH:etf:510300"},{"name","沪深300ETF"},{"symbol","sh510300"},{"quote",QJsonObject{{"symbol","sh510300"},{"source","新浪公开报价"},{"price",4.6},{"changePercent",1.2},{"amount",100000},{"tradeDate","2026-10-12"},{"tradeTime","15:00:00"},{"checkedAt","2026-10-12T07:01:00Z"},{"cached",true}}},{"minuteInput",QJsonObject{{"source","tencent-1m"},{"intervalMinutes",1},{"amountUnit","CNY"},{"checkedAt","2026-10-12T07:01:00Z"},{"rows",minutes}}}}}}};}
class EtfMonitorChecks:public QObject{
 Q_OBJECT
private slots:
 void initTestCase(){QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");QApplication::setFont(QFont("Microsoft YaHei",10));}
 void adjacentRowsHaveVisibleSeparators(){
  QTemporaryDir dir;EtfMonitorPage page(dir.filePath("etf-monitor.json"));
  auto input=fixture();auto rows=input["items"].toArray();
  rows.append(QJsonObject{{"id","SZ:etf:159915"},{"name","创业板ETF"}});
  input["items"]=rows;page.setSnapshot(input);page.resize(1100,700);page.show();
  QVERIFY(QTest::qWaitForWindowExposed(&page));
  auto *list=page.findChild<QListWidget*>("etfMonitorRows");QVERIFY(list);QCOMPARE(list->count(),2);
  list->setCurrentRow(-1);list->clearSelection();QCoreApplication::processEvents();
  const auto first=list->visualItemRect(list->item(0));
  const auto pixels=list->viewport()->grab().toImage();
  const int from=4,to=pixels.width()-5,reference=first.bottom()-8;
  QVERIFY(to>from&&reference>=0);
  int strongestLine=0;
  for(int y=qMax(0,first.bottom()-2);y<=qMin(pixels.height()-1,first.bottom()+2);++y){
   int contrasted=0;
   for(int x=from;x<to;++x){
    const auto a=pixels.pixelColor(x,y),b=pixels.pixelColor(x,reference);
    if(qAbs(a.red()-b.red())+qAbs(a.green()-b.green())+qAbs(a.blue()-b.blue())>=60)++contrasted;
   }
   strongestLine=qMax(strongestLine,contrasted);
  }
  QVERIFY2(strongestLine>=(to-from)*7/10,
           "Unselected adjacent ETF entries need a visible full-width separator");
 }
 void historyCalendarUsesSourceDateNotSaveDate(){
  QTemporaryDir dir;const auto path=dir.filePath("etf-monitor.json");etfMonitor::Store store(path);
  // Controlled dates test selection only; no fixture result is a live quote.
  auto fridayBytes=QJsonDocument(fixture()).toJson(QJsonDocument::Compact);
  fridayBytes.replace("2026-10-12","2026-10-23");
  const auto friday=QJsonDocument::fromJson(fridayBytes).object();
  auto mondayBytes=fridayBytes;mondayBytes.replace("2026-10-23","2026-10-26");
  const auto monday=QJsonDocument::fromJson(mondayBytes).object();
  auto archive=etfMonitor::append(store.read(),friday,"2026-10-26T08:00:00Z");store.save(archive,0);
  archive=etfMonitor::append(archive,monday,"2026-10-27T08:00:00Z");store.save(archive,1);
  EtfMonitorPage page(path);auto *calendar=page.findChild<QDateEdit*>("etfMonitorHistoryDate");
  QVERIFY2(calendar&&calendar->calendarPopup(),"ETF observation history needs a calendar date picker");
  calendar->setDate(QDate(2026,10,24));QCoreApplication::processEvents();
  const auto exported=QJsonDocument::fromJson(page.exportEvidence()).object();
  QCOMPARE(exported["items"],etfMonitor::snapshot(friday)["items"]);
  QVERIFY(!exported["historicalFrame"].toString().isEmpty());
  QCOMPARE(exported["items"].toArray()[0].toObject()["quote"].toObject()["tradeDate"].toString(),QString("2026-10-23"));
  QCOMPARE(store.read(),archive);
 }
 void historicalCalendarRejectsFutureMinuteInOlderQuoteFrame(){
  QTemporaryDir dir;const auto path=dir.filePath("etf-monitor.json");etfMonitor::Store store(path);
  auto fridayBytes=QJsonDocument(fixture()).toJson(QJsonDocument::Compact);fridayBytes.replace("2026-10-12","2026-10-23");
  const auto friday=QJsonDocument::fromJson(fridayBytes).object();
  auto archive=etfMonitor::append(store.read(),friday,"2026-10-23T08:00:00Z");store.save(archive,0);
  auto mondayBytes=fridayBytes;mondayBytes.replace("2026-10-23","2026-10-26");
  auto mixed=QJsonDocument::fromJson(mondayBytes).object();auto item=mixed["items"].toArray()[0].toObject();
  item["quote"]=friday["items"].toArray()[0].toObject()["quote"];mixed["items"]=QJsonArray{item};
  archive=etfMonitor::append(archive,mixed,"2026-10-26T08:00:00Z");store.save(archive,1);
  EtfMonitorPage page(path);auto* calendar=page.findChild<QDateEdit*>("etfMonitorHistoryDate");QVERIFY(calendar);
  calendar->setDate(QDate(2026,10,24));
  QCOMPARE(QJsonDocument::fromJson(page.exportEvidence()).object()["items"],etfMonitor::snapshot(friday)["items"]);
  QCOMPARE(store.read(),archive);
 }
 void currentObservationAdvancesCalendarWithSourceDay(){
  QTemporaryDir dir;const auto path=dir.filePath("etf-monitor.json");etfMonitor::Store store(path);
  auto fridayBytes=QJsonDocument(fixture()).toJson(QJsonDocument::Compact);
  fridayBytes.replace("2026-10-12","2026-10-23");
  const auto friday=QJsonDocument::fromJson(fridayBytes).object();
  const auto archive=etfMonitor::append(store.read(),friday,"2026-10-23T08:00:00Z");store.save(archive,0);
  EtfMonitorPage page(path);auto *calendar=page.findChild<QDateEdit*>("etfMonitorHistoryDate");
  QVERIFY(calendar);QCOMPARE(calendar->date(),QDate(2026,10,23));
  auto mondayBytes=fridayBytes;mondayBytes.replace("2026-10-23","2026-10-26");
  page.setSnapshot(QJsonDocument::fromJson(mondayBytes).object());
  const auto exported=QJsonDocument::fromJson(page.exportEvidence()).object();
  QCOMPARE(exported["items"].toArray()[0].toObject()["quote"].toObject()["tradeDate"].toString(),QString("2026-10-26"));
  QCOMPARE(calendar->date(),QDate(2026,10,26));
 }
 void restoredHistoricalObservationSynchronizesCalendar(){
  QTemporaryDir dir;const auto path=dir.filePath("etf-monitor.json");etfMonitor::Store store(path);
  auto fridayBytes=QJsonDocument(fixture()).toJson(QJsonDocument::Compact);
  fridayBytes.replace("2026-10-12","2026-10-23");
  const auto friday=QJsonDocument::fromJson(fridayBytes).object();
  auto archive=etfMonitor::append(store.read(),friday,"2026-10-23T08:00:00Z");store.save(archive,0);
  const auto fridayId=archive["frames"].toArray()[0].toObject()["id"].toString();
  auto mondayBytes=fridayBytes;mondayBytes.replace("2026-10-23","2026-10-26");
  archive=etfMonitor::append(archive,QJsonDocument::fromJson(mondayBytes).object(),"2026-10-26T08:00:00Z");store.save(archive,1);
  EtfMonitorPage page(path);auto *calendar=page.findChild<QDateEdit*>("etfMonitorHistoryDate");
  QVERIFY(calendar);QCOMPARE(calendar->date(),QDate(2026,10,26));
  auto state=page.saveState();state["history"]=fridayId;page.restoreState(state);
  QCOMPARE(QJsonDocument::fromJson(page.exportEvidence()).object()["items"],etfMonitor::snapshot(friday)["items"]);
  QCOMPARE(calendar->date(),QDate(2026,10,23));
  QCOMPARE(store.read(),archive);
 }
 void cancelledAndFailedRefresh(){QTemporaryDir dir;auto file=dir.filePath("etf-monitor.json");EtfMonitorPage page(file);page.setSnapshot(fixture());page.setRefreshAvailable(true);auto update=page.findChild<QPushButton*>("etfMonitorRefreshQuotes"),stop=page.findChild<QPushButton*>("etfMonitorCancel");QSignalSpy requested(&page,&EtfMonitorPage::refreshRequested);QSignalSpy opened(&page,&EtfMonitorPage::openChart);page.findChild<QPushButton*>("etfMonitorOpen")->click();QCOMPARE(opened[0][0].toString(),QString("SH:etf:510300"));update->click();QCOMPARE(requested.count(),1);QString ticket=requested[0][0].toString();QCOMPARE(requested[0][1].value<QJsonObject>()["ids"].toArray().size(),1);stop->click();auto before=etfMonitor::Store(file).read();auto other=fixture();auto row=other["items"].toArray()[0].toObject();row["name"]="不会被迟到写入";other["items"]=QJsonArray{row};page.acceptSnapshot(ticket,other);QCOMPARE(etfMonitor::Store(file).read(),before);update->click();ticket=requested[1][0].toString();page.failRefresh(ticket,"EOF");auto after=etfMonitor::Store(file).read();QCOMPARE(after["frames"],before["frames"]);QCOMPARE(after["attempt"].toObject()["status"].toString(),QString("failed"));EtfMonitorPage reopened(file);QCOMPARE(QJsonDocument::fromJson(reopened.exportEvidence()).object()["items"],etfMonitor::snapshot(fixture())["items"]);}
 void geometry(){QTemporaryDir dir;EtfMonitorPage page(dir.filePath("etf-monitor.json"));page.setSnapshot(fixture());QDir().mkpath("output/native-ui-design-20261010/parallel-20261012/continuation-v35/market/visual");for(auto size:{QSize(900,640),QSize(840,190)}){page.resize(size);page.show();QTest::qWait(30);QCOMPARE(page.height(),size.height());QCOMPARE(page.width(),size.width());QVERIFY(page.findChild<QSplitter*>()->height()>55);auto toggle=page.findChild<QPushButton*>("etfMonitorFilters");toggle->click();QTest::qWait(20);QCOMPARE(page.height(),size.height());QVERIFY(page.findChild<QSplitter*>()->height()>24);toggle->click();QTest::qWait(20);QVERIFY(page.grab().save(QString("output/native-ui-design-20261010/parallel-20261012/continuation-v35/market/visual/qt-%1x%2.png").arg(size.width()).arg(size.height())));}}
 void semantics(){auto s=etfMonitor::snapshot(fixture());auto r=s["items"].toArray()[0].toObject(),m=r["momentum"].toObject();QCOMPARE(m["rolling5AmountYuan"].toDouble(),750.);QCOMPARE(m["previous5AmountYuan"].toDouble(),500.);QCOMPARE(m["rolling5ChangePct"].toDouble(),50.);QVERIFY(!m["realtimeGuaranteed"].toBool());QCOMPARE(r["quote"].toObject()["sourceTime"].toString(),QString("2026-10-12T15:00:00+08:00"));QCOMPARE(etfMonitor::snapshot(s),s);}
 void identity(){auto input=fixture();for(auto id:{"SH:stock:510300","IF0","510300","SZ:index:159915"}){auto row=input["items"].toArray()[0].toObject();row["id"]=id;input["items"]=QJsonArray{row};QVERIFY_EXCEPTION_THROWN(etfMonitor::snapshot(input),std::runtime_error);}input=fixture();auto row=input["items"].toArray()[0].toObject();row["quote"]=QJsonObject{{"symbol","sz159915"},{"price",4.6}};input["items"]=QJsonArray{row};QVERIFY_EXCEPTION_THROWN(etfMonitor::snapshot(input),std::runtime_error);}
 void missingAndSorting(){auto s=fixture();auto first=s["items"].toArray()[0].toObject(),missing=QJsonObject{{"id","SZ:etf:159915"},{"name","创业板ETF"}};s["items"]=QJsonArray{missing,first};auto n=etfMonitor::snapshot(s);QVERIFY(n["items"].toArray()[0].toObject()["quote"].toObject()["amount"].isNull());for(bool asc:{false,true})QCOMPARE(etfMonitor::rows(n,{{"sort","amount"},{"ascending",asc}})[0].toObject()["id"].toString(),QString("SH:etf:510300"));QCOMPARE(etfMonitor::rows(n,{{"search","创业板"}}).size(),1);auto minute=first["minuteInput"].toObject();auto rows=minute["rows"].toArray();for(int i=0;i<rows.size();i++){auto r=rows[i].toObject();r.remove("amount");r["volume"]=1000;rows[i]=r;}minute["rows"]=rows;first["minuteInput"]=minute;s["items"]=QJsonArray{first};auto m=etfMonitor::snapshot(s)["items"].toArray()[0].toObject()["momentum"].toObject();QVERIFY(m["rolling5AmountYuan"].isNull());QVERIFY(m["latestMinuteAmountYuan"].isNull());}
 void windowProtection(){auto input=fixture(),row=input["items"].toArray()[0].toObject(),minute=row["minuteInput"].toObject();auto bars=minute["rows"].toArray();bars.append(bars.last());minute["rows"]=bars;row["minuteInput"]=minute;input["items"]=QJsonArray{row};QVERIFY(etfMonitor::snapshot(input)["items"].toArray()[0].toObject()["momentum"].toObject()["rolling5AmountYuan"].isNull());bars=fixture()["items"].toArray()[0].toObject()["minuteInput"].toObject()["rows"].toArray();for(int i=0;i<5;i++){auto r=bars[i].toObject();r["amount"]=0;bars[i]=r;}minute["rows"]=bars;row["minuteInput"]=minute;input["items"]=QJsonArray{row};auto m=etfMonitor::snapshot(input)["items"].toArray()[0].toObject()["momentum"].toObject();QCOMPARE(m["previous5AmountYuan"].toDouble(),0.);QVERIFY(m["rolling5ChangePct"].isNull());}
 void rawFormat(){QJsonObject raw{{"code",0},{"data",QJsonObject{{"sh510300",QJsonObject{{"data",QJsonObject{{"date","20261012"},{"data",QJsonArray{"0930 4.6 100 1000","0931 4.6 200 1200","0932 4.6 250 1100","0934 4.6 300 1400","0935 4.6 400"}}}}}}}}};auto m=etfMonitor::tencentMinute(raw,"SH:etf:510300","2026-10-12T01:40:00Z");auto rows=m["rows"].toArray();QVERIFY(rows[0].toObject()["amount"].isNull());QCOMPARE(rows[1].toObject()["amount"].toDouble(),200.);QVERIFY(rows[2].toObject()["amount"].isNull());QVERIFY(rows[3].toObject()["amount"].isNull());QVERIFY(rows[4].toObject()["amount"].isNull());QVERIFY_EXCEPTION_THROWN(etfMonitor::tencentMinute(raw,"SZ:etf:159915","2026-10-12T01:40:00Z"),std::runtime_error);}
 void archiveProtection(){QTemporaryDir dir;auto path=dir.filePath("etf-monitor.json");etfMonitor::Store store(path);auto first=etfMonitor::append(store.read(),fixture(),"2026-10-12T07:02:00Z");store.save(first,0);QCOMPARE(store.read(),first);auto next=etfMonitor::failed(first,"failed","2026-10-13T01:00:00Z","EOF");store.save(next,1);QCOMPARE(etfMonitor::frame(store.read()),etfMonitor::snapshot(fixture()));QVERIFY_EXCEPTION_THROWN(store.save(etfMonitor::failed(first,"cancelled","2026-10-13T01:00:00Z"),1),std::runtime_error);QCOMPARE(store.read(),next);auto foreign=dir.filePath("foreign.json");QFile file(foreign);QVERIFY(file.open(QIODevice::WriteOnly));file.write("{\"schema\":\"other\",\"preserve\":true}");file.close();etfMonitor::Store other(foreign);QVERIFY_EXCEPTION_THROWN(other.save(first,0),std::runtime_error);QVERIFY(file.open(QIODevice::ReadOnly));QCOMPARE(file.readAll(),QByteArray("{\"schema\":\"other\",\"preserve\":true}"));}
};
QTEST_MAIN(EtfMonitorChecks)
#include "etf_monitor_checks.moc"
