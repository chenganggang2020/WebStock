#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>
#include <QUrlQuery>
#include "window.hpp"
#include "etf_monitor_page.hpp"
#include "etf_monitor_store.hpp"
#include "etf_host_snapshot.hpp"
#include "market_store.hpp"
namespace {
class Reply:public QNetworkReply{
 QByteArray bytes;qint64 at=0;
public:
 Reply(const QNetworkRequest&r,QObject*p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(ReadOnly);}
 void deliver(QByteArray b,int status=200){bytes=b;setAttribute(QNetworkRequest::HttpStatusCodeAttribute,status);if(status!=200)setError(ContentAccessDenied,"fixture failure");setFinished(true);emit readyRead();emit finished();}
 void abort()override{setError(OperationCanceledError,"fixture cancelled");}
 qint64 bytesAvailable()const override{return bytes.size()-at+QNetworkReply::bytesAvailable();}
 qint64 readData(char*d,qint64 n)override{n=qMin(n,bytes.size()-at);if(n<=0)return -1;memcpy(d,bytes.constData()+at,n);at+=n;return n;}
};
class Transport:public QNetworkAccessManager{
public:QList<Reply*> replies;QStringList urls;
protected:QNetworkReply*createRequest(Operation,const QNetworkRequest&r,QIODevice*)override{auto*p=new Reply(r,this);replies<<p;urls<<r.url().toString();return p;}
};
QByteArray quote(double price){QStringList a;for(int i=0;i<33;i++)a<<"";a[0]="ETF";a[1]=a[2]="4.5";a[3]=QString::number(price);a[4]="4.8";a[5]="4.4";a[8]="10000";a[9]="46000";a[30]="2026-10-12";a[31]="09:41:00";return ("var hq_str_sh510300=\""+a.join(',')+"\";").toUtf8();}
QByteArray minute(){return R"({"code":0,"data":{"sh510300":{"data":{"date":"20261012","data":["0930 4.50 100 45000","0931 4.52 200 90200","0932 4.53 300 135500","0933 4.55 400 181000","0934 4.54 500 226400","0935 4.56 600 272000"]}}}})";}
QJsonObject etfRow(QString code="510300",QString market="SH"){
 return {{"id",market+":etf:"+code},{"symbol",market.toLower()+code},{"name","ETF "+code},{"group","ETF"}};
}
}
class EtfMonitorHostTests:public QObject{
 Q_OBJECT
private slots:
 void displayedEtfsPrefetchBeforeSelection(){
  QTemporaryDir root;Transport transport;Window w(true,root.filePath("settings.ini"),root.path());w.resize(1600,1000);w.show();
  w.feed=new MarketFeed(root.filePath("live"),&w,&transport);w.etfTestNetwork=&transport;
  const QJsonArray roster{etfRow(),etfRow("159915","SZ")};w.feed->instruments=w.instruments=roster;w.etfMonitorView();
  auto*page=qobject_cast<EtfMonitorPage*>(w.pages.value("etfMonitor"));QVERIFY(page);
  const auto archivePath=QFileInfo(w.businessStore->filePath()).absolutePath()+"/etf-monitor-v35.json";
  const auto before=etfMonitor::Store(archivePath).read();
  const auto now=QDateTime::fromString("2026-10-24T02:00:00Z",Qt::ISODate);
  w.prefetchEtfMonitor(now);QCOMPARE(transport.urls.size(),1);
  for(int n=0;n<20;++n)w.prefetchEtfMonitor(now.addSecs(n));
  QCOMPARE(transport.urls.size(),1); // One network/persistence job at a time.
  const QString firstSymbol=transport.urls.last().section("list=",1);
  auto firstBody=quote(4.6);firstBody.replace("sh510300",firstSymbol.toUtf8());transport.replies.last()->deliver(firstBody);
  MarketStore stored(QFileInfo(w.businessStore->filePath()).absolutePath()+"/etf-observation-v1/market-v1.sqlite");
  QTRY_COMPARE_WITH_TIMEOUT(stored.read(firstSymbol+"-quote")["price"].toDouble(),4.6,5000);
  QTRY_VERIFY_WITH_TIMEOUT(w.etfObservationFeed->persistenceStats()["outstanding"].toInt()==0,5000);
  w.prefetchEtfMonitor(now.addSecs(21));QCOMPARE(transport.urls.size(),2);
  const QString secondSymbol=transport.urls.last().section("list=",1);QVERIFY(secondSymbol!=firstSymbol);
  auto secondBody=quote(4.7);secondBody.replace("sh510300",secondSymbol.toUtf8());transport.replies.last()->deliver(secondBody);
  QTRY_COMPARE_WITH_TIMEOUT(stored.read(secondSymbol+"-quote")["price"].toDouble(),4.7,5000);
  QTRY_VERIFY_WITH_TIMEOUT(w.etfObservationFeed->persistenceStats()["outstanding"].toInt()==0,5000);
  for(int n=0;n<2;++n){
   w.prefetchEtfMonitor(now.addSecs(22+n));QCOMPARE(transport.urls.size(),3+n);
   const auto symbol=QUrlQuery(QUrl(transport.urls.last())).queryItemValue("code");
   auto body=minute();body.replace("sh510300",symbol.toUtf8());transport.replies.last()->deliver(body);
   QTRY_VERIFY_WITH_TIMEOUT(!stored.read(symbol+"-minute")["rows"].toArray().isEmpty(),5000);
   QTRY_VERIFY_WITH_TIMEOUT(w.etfObservationFeed->persistenceStats()["outstanding"].toInt()==0,5000);
  }
  w.prefetchEtfMonitor(now.addSecs(25));
  auto shown=QJsonDocument::fromJson(page->exportEvidence()).object()["items"].toArray();QCOMPARE(shown.size(),2);
  for(auto value:shown){auto row=value.toObject();QVERIFY(row["quote"].toObject()["price"].isDouble());QVERIFY(!row["minuteInput"].toObject()["rows"].toArray().isEmpty());}
  QCOMPARE(etfMonitor::Store(archivePath).read(),before); // Prefetch does not rewrite observation history.
  QCOMPARE(w.feed->instruments,roster);QCOMPARE(w.instruments,roster);
 }
 void offPageCompletionIsSavedAndReopened(){
  QTemporaryDir root;const auto now=QDateTime::fromString("2026-10-24T02:00:00Z",Qt::ISODate);QString dataRoot;
  {
   Transport transport;Window w(true,root.filePath("settings.ini"),root.path());w.show();w.feed=new MarketFeed(root.filePath("live"),&w,&transport);w.etfTestNetwork=&transport;
   w.feed->instruments=w.instruments=QJsonArray{etfRow()};w.etfMonitorView();dataRoot=QFileInfo(w.businessStore->filePath()).absolutePath();
   w.prefetchEtfMonitor(now);QCOMPARE(transport.urls.size(),1);w.home();transport.replies.last()->deliver(quote(4.6));
   MarketStore stored(dataRoot+"/etf-observation-v1/market-v1.sqlite");QTRY_COMPARE_WITH_TIMEOUT(stored.read("sh510300-quote")["price"].toDouble(),4.6,5000);
   QTRY_VERIFY_WITH_TIMEOUT(w.etfObservationFeed->persistenceStats()["outstanding"].toInt()==0,5000);
   w.prefetchEtfMonitor(now.addSecs(1));QCOMPARE(transport.urls.size(),2);transport.replies.last()->deliver(minute());
   QTRY_VERIFY_WITH_TIMEOUT(!stored.read("sh510300-minute")["rows"].toArray().isEmpty(),5000);
   QTRY_VERIFY_WITH_TIMEOUT(w.etfObservationFeed->persistenceStats()["outstanding"].toInt()==0,5000);
  }
  Transport transport;Window reopened(true,root.filePath("settings.ini"),root.path());reopened.show();reopened.feed=new MarketFeed(root.filePath("live"),&reopened,&transport);reopened.etfTestNetwork=&transport;
  reopened.feed->instruments=reopened.instruments=QJsonArray{etfRow()};reopened.etfMonitorView();
  auto*page=qobject_cast<EtfMonitorPage*>(reopened.pages.value("etfMonitor"));QVERIFY(page);
  auto shown=[page]{return QJsonDocument::fromJson(page->exportEvidence()).object()["items"].toArray()[0].toObject();};
  QTRY_COMPARE_WITH_TIMEOUT(shown()["quote"].toObject()["price"].toDouble(),4.6,5000);
  QCOMPARE(shown()["quote"].toObject()["tradeDate"].toString(),QString("2026-10-12"));
  QVERIFY(shown()["quote"].toObject()["cached"].toBool());QVERIFY(!shown()["minuteInput"].toObject()["rows"].toArray().isEmpty());
  QCOMPARE(transport.urls.size(),0); // Reopening uses the persisted source data first.
 }
 void historicalReadingSurvivesPartialBackgroundFailure(){
  QTemporaryDir root;Transport transport;Window w(true,root.filePath("settings.ini"),root.path());w.show();w.feed=new MarketFeed(root.filePath("live"),&w,&transport);w.etfTestNetwork=&transport;
  auto instrument=etfRow();instrument["quote"]=QJsonObject{{"source","fixture"},{"tradeDate","2026-10-09"},{"tradeTime","15:00:00"},{"price",4.4}};
  auto priorMinute=minute();priorMinute.replace("20261012","20261009");
  const auto savedMinute=marketdata::minute(QJsonDocument::fromJson(priorMinute).object(),"sh510300",QDateTime::fromString("2026-10-09T07:00:00Z",Qt::ISODate));
  instrument["minute"]=savedMinute["rows"];instrument["minuteMeta"]=savedMinute;
  w.feed->instruments=w.instruments=QJsonArray{instrument};w.etfMonitorView();auto*page=qobject_cast<EtfMonitorPage*>(w.pages.value("etfMonitor"));
  const auto persistedMinute=MarketStore(QFileInfo(w.businessStore->filePath()).absolutePath()+"/etf-observation-v1/market-v1.sqlite").save("sh510300-minute",savedMinute);
  const auto now=QDateTime::fromString("2026-10-24T02:00:00Z",Qt::ISODate);w.prefetchEtfMonitor(now);QCOMPARE(transport.urls.size(),1);
  auto*history=page->findChild<QComboBox*>("etfMonitorHistory");QVERIFY(history->count()>1);history->setCurrentIndex(1);
  const auto before=QJsonDocument::fromJson(page->exportEvidence()).object();transport.replies.last()->deliver(quote(4.6));
  MarketStore stored(QFileInfo(w.businessStore->filePath()).absolutePath()+"/etf-observation-v1/market-v1.sqlite");QTRY_COMPARE_WITH_TIMEOUT(stored.read("sh510300-quote")["price"].toDouble(),4.6,5000);
  QTRY_VERIFY_WITH_TIMEOUT(w.etfObservationFeed->persistenceStats()["outstanding"].toInt()==0,5000);
  w.prefetchEtfMonitor(now.addSecs(1));QCOMPARE(transport.urls.size(),2);transport.replies.last()->deliver({},503);w.prefetchEtfMonitor(now.addSecs(2));
  const auto after=QJsonDocument::fromJson(page->exportEvidence()).object();QCOMPARE(after["items"],before["items"]);QCOMPARE(after["historicalFrame"],before["historicalFrame"]);
  QCOMPARE(stored.read("sh510300-quote")["price"].toDouble(),4.6);QCOMPARE(stored.read("sh510300-minute"),persistedMinute);
  history->setCurrentIndex(0);w.prefetchEtfMonitor(now.addSecs(4));
  const auto current=QJsonDocument::fromJson(page->exportEvidence()).object();QVERIFY(current["historicalFrame"].toString().isEmpty());QCOMPARE(current["items"].toArray()[0].toObject()["quote"].toObject()["price"].toDouble(),4.6);
  QCOMPARE(w.etfObservationFeed->instruments[0].toObject()["minute"],savedMinute["rows"]);
  QVERIFY(w.etfObservationFeed->instruments[0].toObject()["minuteMeta"].toObject()["error"].toString().contains("HTTP 503"));
 }
 void displayedPrefetchQueueIsBounded(){
  QTemporaryDir root;Transport transport;Window w(true,root.filePath("settings.ini"),root.path());w.show();w.feed=new MarketFeed(root.filePath("live"),&w,&transport);w.etfTestNetwork=&transport;
  QJsonArray roster;for(int n=0;n<30;++n)roster.append(etfRow(QString::number(510300+n)));w.feed->instruments=w.instruments=roster;w.etfMonitorView();
  const auto now=QDateTime::fromString("2026-10-24T02:00:00Z",Qt::ISODate);
  for(int n=0;n<48;++n){w.prefetchEtfMonitor(now.addSecs(n));QCOMPARE(transport.urls.size(),n+1);transport.replies.last()->deliver({},503);}
  w.prefetchEtfMonitor(now.addSecs(49));QCOMPARE(transport.urls.size(),48);
  QSet<QString> symbols;for(auto url:transport.urls){const auto query=QUrlQuery(QUrl(url));symbols.insert(query.hasQueryItem("code")?query.queryItemValue("code"):url.section("list=",1));}
  QCOMPARE(symbols.size(),24);QCOMPARE(w.feed->instruments,roster);
 }
 void supersededPrefetchCannotReplaceManualResult(){
  QTemporaryDir root;Transport transport;Window w(true,root.filePath("settings.ini"),root.path());w.show();w.feed=new MarketFeed(root.filePath("live"),&w,&transport);w.etfTestNetwork=&transport;
  w.feed->instruments=w.instruments=QJsonArray{etfRow()};w.etfMonitorView();const auto now=QDateTime::fromString("2026-10-24T02:00:00Z",Qt::ISODate);
  w.prefetchEtfMonitor(now);QCOMPARE(transport.urls.size(),1);auto*late=transport.replies.last();auto*page=qobject_cast<EtfMonitorPage*>(w.pages.value("etfMonitor"));
  page->findChild<QPushButton*>("etfMonitorRefreshQuotes")->click();QCOMPARE(transport.urls.size(),2);transport.replies.last()->deliver(quote(4.8));
  QTRY_VERIFY_WITH_TIMEOUT(w.etfRefreshToken.isEmpty(),5000);late->deliver(quote(4.2));QCoreApplication::processEvents();
  MarketStore stored(QFileInfo(w.businessStore->filePath()).absolutePath()+"/etf-observation-v1/market-v1.sqlite");QCOMPARE(stored.read("sh510300-quote")["price"].toDouble(),4.8);
  QCOMPARE(QJsonDocument::fromJson(page->exportEvidence()).object()["items"].toArray()[0].toObject()["quote"].toObject()["price"].toDouble(),4.8);
 }
 void nativeHost(){
  QTemporaryDir root;Transport transport;Window w(true,root.filePath("settings.ini"),root.path());w.resize(1600,1000);w.show();
  w.feed=new MarketFeed(root.filePath("live"),&w,&transport);
  w.etfTestNetwork=&transport;
  QJsonObject instrument{{"id","SH:etf:510300"},{"symbol","sh510300"},{"name","沪深300ETF"},{"group","ETF"}};
  w.feed->instruments=w.instruments=QJsonArray{instrument};
  QString path=QFileInfo(w.businessStore->filePath()).absolutePath()+"/etf-monitor-v35.json";
  for(QString layout:{"quotes","classic","focus"}){
   w.setLayoutMode(layout);w.etfMonitorView();QVERIFY(w.pages.value("etfMonitor")->isVisible());QCOMPARE(w.layoutMode(),layout=="focus"?QString("classic"):layout);
  }
  auto*p=qobject_cast<EtfMonitorPage*>(w.pages.value("etfMonitor"));QVERIFY(p);QCOMPARE(p->findChild<QListWidget*>("etfMonitorRows")->count(),1);QCOMPARE(transport.urls.size(),0);
  auto read=[&]{return etfMonitor::Store(path).read();};
  int initial=read()["frames"].toArray().size();
  p->findChild<QPushButton*>("etfMonitorRefreshQuotes")->click();QCOMPARE(transport.urls.size(),1);QVERIFY(transport.urls.last().contains("sh510300"));transport.replies.last()->deliver(quote(4.6));
  QTRY_VERIFY_WITH_TIMEOUT(w.etfRefreshToken.isEmpty(),5000);
  QCOMPARE(read()["frames"].toArray().size(),initial+1);
  MarketStore stored(QFileInfo(w.businessStore->filePath()).absolutePath()+"/etf-observation-v1/market-v1.sqlite");QCOMPARE(stored.read("sh510300-quote")["price"].toDouble(),4.6);
  QCOMPARE(w.feed->instruments,QJsonArray{instrument});
  p->findChild<QPushButton*>("etfMonitorRefreshMinute")->click();QCOMPARE(transport.urls.size(),2);transport.replies.last()->deliver(minute());
  QTRY_VERIFY_WITH_TIMEOUT(w.etfRefreshToken.isEmpty(),5000);
  auto data=stored.read("sh510300-minute");QCOMPARE(data["rows"].toArray().size(),242);int valid=0;for(auto v:data["rows"].toArray())if(v.toObject()["valid"].toBool())++valid;QCOMPARE(valid,6);
  QVERIFY(data["rows"].toArray()[0].toObject()["amount"].isNull());QCOMPARE(data["rows"].toArray()[1].toObject()["amount"].toDouble(),45200.);
  QCOMPARE(read()["frames"].toArray().size(),initial+2);
  auto* history=p->findChild<QComboBox*>("etfMonitorHistory");
  QVERIFY(history->count()>1);history->setCurrentIndex(1);
  QVERIFY(!p->saveState()["history"].toString().isEmpty());
  auto* openCurrent=p->findChild<QPushButton*>("etfMonitorOpen");
  QCOMPARE(openCurrent->text(),QString("打开当前K线"));
  QVERIFY(openCurrent->toolTip().contains("非所选历史观测"));
  history->setCurrentIndex(0);
  QJsonArray frames=read().value("frames").toArray();p->findChild<QPushButton*>("etfMonitorRefreshQuotes")->click();auto*late=transport.replies.last();w.home();QVERIFY(w.etfRefreshToken.isEmpty());late->deliver(quote(4.7));
  QTRY_COMPARE_WITH_TIMEOUT(w.etfObservationFeed->instruments[0].toObject()["quote"].toObject()["persistenceState"].toString(),QString("saved"),5000);
  QCOMPARE(read().value("frames").toArray(),frames);QCOMPARE(read()["attempt"].toObject()["status"].toString(),QString("cancelled"));
  w.etfMonitorView();p->findChild<QPushButton*>("etfMonitorRefreshQuotes")->click();transport.replies.last()->deliver({},503);QTRY_VERIFY(w.etfRefreshToken.isEmpty());QCOMPARE(read().value("frames").toArray(),frames);QCOMPARE(read()["attempt"].toObject()["status"].toString(),QString("failed"));
  w.instruments=w.feed->instruments;auto state=p->saveState();state["period"]="minute";p->restoreState(state);QCOMPARE(p->saveState().value("period").toString(),QString("minute"));QSignalSpy opened(p,&EtfMonitorPage::openChart);int requests=transport.urls.size();p->findChild<QPushButton*>("etfMonitorOpen")->click();
  QCOMPARE(opened.size(),1);QCOMPARE(opened[0][1].toString(),QString("minute"));QCOMPARE(w.instrument["id"].toString(),QString("SH:etf:510300"));QCOMPARE(w.period,QString("minute"));QCOMPARE(transport.urls.size(),requests);
  w.etfMonitorView();for(QString layout:{"quotes","classic","focus"}){w.setLayoutMode(layout);if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v35-etf-"+layout+".png"));}
 }
};
QTEST_MAIN(EtfMonitorHostTests)
#include "etf_monitor_host_tests.moc"

