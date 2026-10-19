#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>
#include "window.hpp"
#include "etf_monitor_page.hpp"
#include "etf_monitor_store.hpp"
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
}
class EtfMonitorHostTests:public QObject{
 Q_OBJECT
private slots:
 void nativeHost(){
  QTemporaryDir root;Transport transport;Window w(true,root.filePath("settings.ini"),root.path());w.resize(1600,1000);w.show();
  w.feed=new MarketFeed(root.filePath("live"),&w,&transport);
  QJsonObject instrument{{"id","SH:etf:510300"},{"symbol","sh510300"},{"name","沪深300ETF"},{"group","ETF"}};
  w.feed->instruments=w.instruments=QJsonArray{instrument};
  QString path=QFileInfo(w.businessStore->filePath()).absolutePath()+"/etf-monitor-v35.json";
  for(QString layout:{"quotes","classic","focus"}){
   w.setLayoutMode(layout);w.etfMonitorView();QVERIFY(w.pages.value("etfMonitor")->isVisible());QCOMPARE(w.layoutMode(),layout);
  }
  auto*p=qobject_cast<EtfMonitorPage*>(w.pages.value("etfMonitor"));QVERIFY(p);QCOMPARE(p->findChild<QListWidget*>("etfMonitorRows")->count(),1);QCOMPARE(transport.urls.size(),0);
  auto read=[&]{return etfMonitor::Store(path).read();};
  int initial=read()["frames"].toArray().size();
  p->findChild<QPushButton*>("etfMonitorRefreshQuotes")->click();QCOMPARE(transport.urls.size(),1);QVERIFY(transport.urls.last().contains("sh510300"));transport.replies.last()->deliver(quote(4.6));
  QTRY_VERIFY_WITH_TIMEOUT(w.etfRefreshToken.isEmpty(),5000);
  QCOMPARE(read()["frames"].toArray().size(),initial+1);
  MarketStore stored(root.filePath("live/market-v1.sqlite"));QCOMPARE(stored.read("sh510300-quote")["price"].toDouble(),4.6);
  p->findChild<QPushButton*>("etfMonitorRefreshMinute")->click();QCOMPARE(transport.urls.size(),2);transport.replies.last()->deliver(minute());
  QTRY_VERIFY_WITH_TIMEOUT(w.etfRefreshToken.isEmpty(),5000);
  auto data=stored.read("sh510300-minute");QCOMPARE(data["rows"].toArray().size(),242);int valid=0;for(auto v:data["rows"].toArray())if(v.toObject()["valid"].toBool())++valid;QCOMPARE(valid,6);
  QVERIFY(data["rows"].toArray()[0].toObject()["amount"].isNull());QCOMPARE(data["rows"].toArray()[1].toObject()["amount"].toDouble(),45200.);
  QCOMPARE(read()["frames"].toArray().size(),initial+2);
  QJsonArray frames=read().value("frames").toArray();p->findChild<QPushButton*>("etfMonitorRefreshQuotes")->click();auto*late=transport.replies.last();w.home();QVERIFY(w.etfRefreshToken.isEmpty());late->deliver(quote(4.7));
  QTRY_COMPARE_WITH_TIMEOUT(w.feed->instruments[0].toObject()["quote"].toObject()["persistenceState"].toString(),QString("saved"),5000);
  QCOMPARE(read().value("frames").toArray(),frames);QCOMPARE(read()["attempt"].toObject()["status"].toString(),QString("cancelled"));
  w.etfMonitorView();p->findChild<QPushButton*>("etfMonitorRefreshQuotes")->click();transport.replies.last()->deliver({},503);QTRY_VERIFY(w.etfRefreshToken.isEmpty());QCOMPARE(read().value("frames").toArray(),frames);QCOMPARE(read()["attempt"].toObject()["status"].toString(),QString("failed"));
  w.instruments=w.feed->instruments;auto state=p->saveState();state["period"]="minute";p->restoreState(state);QCOMPARE(p->saveState().value("period").toString(),QString("minute"));QSignalSpy opened(p,&EtfMonitorPage::openChart);int requests=transport.urls.size();p->findChild<QPushButton*>("etfMonitorOpen")->click();
  QCOMPARE(opened.size(),1);QCOMPARE(opened[0][1].toString(),QString("minute"));QCOMPARE(w.instrument["id"].toString(),QString("SH:etf:510300"));QCOMPARE(w.period,QString("minute"));QCOMPARE(transport.urls.size(),requests);
  w.etfMonitorView();for(QString layout:{"quotes","classic","focus"}){w.setLayoutMode(layout);if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v35-etf-"+layout+".png"));}
 }
};
QTEST_MAIN(EtfMonitorHostTests)
#include "etf_monitor_host_tests.moc"

