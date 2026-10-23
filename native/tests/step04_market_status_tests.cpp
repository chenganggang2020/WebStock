#include <QtTest>
#include <QtWidgets>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <cstring>
#include "global_market_cache.hpp"
#include "global_market_model.hpp"
#include "global_market_page.hpp"
namespace {
const QString key="nasdaq-composite";
QJsonObject series(){QJsonArray rows;for(int i=0;i<60;++i)rows.append(QJsonObject{{"time",double(1792157400000LL+i*60000)},{"close",100.+i},{"volume",1000}});return {{"key",key},{"symbol",globalMarket::definition(key)["symbol"]},{"period","intraday"},{"points",rows},{"sessionDate","2026-10-16"},{"zone","America/New_York"},{"source","隔离图表样本"},{"observedAt","2026-10-16T14:29:00Z"},{"fetchedAt","2026-10-16T14:30:00Z"}};}
QJsonObject quote(QJsonValue pct=1.25){return {{"key",key},{"id",globalMarket::definition(key)["id"]},{"value",159.},{"changePct",pct},{"observedAt","2026-10-16T14:29:00Z"},{"fetchedAt","2026-10-16T14:30:00Z"},{"source","隔离报价样本"},{"cacheState","fresh"}};}
void seed(QString dir,QJsonObject q){globalMarket::Cache c(dir);c.apply(key,"intraday",series(),q,{},"2026-10-16T14:30:00Z");}
void setup(GlobalMarketPage& p){p.restoreState({{"schema","native-global-market-ui/v1"},{"key",key},{"period","intraday"},{"automatic",false},{"visibleCount",60},{"endIndex",59}});p.resize(1280,820);p.show();}
QPushButton* refresh(GlobalMarketPage& p){return p.findChild<QPushButton*>("globalRefresh");}
QString summary(GlobalMarketPage& p){return p.findChild<QLabel*>("globalQuote")->text();}
QString status(GlobalMarketPage& p){return p.findChild<QPlainTextEdit*>("globalStatus")->toPlainText();}
void shot(GlobalMarketPage& p,QString name){auto dir=qEnvironmentVariable("STEP04_SHOTS");if(dir.isEmpty())return;QDir().mkpath(dir);QCoreApplication::processEvents();p.grab().save(dir+"/"+name+".png");}
class Reply:public QNetworkReply{
 QByteArray body; qint64 pos=0;
public:
 Reply(const QNetworkRequest& req,QObject* parent,bool fail):QNetworkReply(parent){setRequest(req);setUrl(req.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,fail?503:200);setHeader(QNetworkRequest::ContentTypeHeader,"application/json; charset=utf-8");
 body=R"({"chart":{"result":[{"meta":{"symbol":"^IXIC","regularMarketPrice":160,"previousClose":160,"regularMarketTime":1792157460},"timestamp":[1792157400,1792157460],"indicators":{"quote":[{"close":[159,160],"volume":[1000,1001]}]}}]}})";
 open(QIODevice::ReadOnly);QTimer::singleShot(0,this,[this,fail]{if(fail)setError(ServiceUnavailableError,"controlled 503");setFinished(true);emit finished();});}
 void abort()override{setFinished(true);}
 qint64 bytesAvailable()const override{return body.size()-pos+QNetworkReply::bytesAvailable();}
 qint64 readData(char* out,qint64 max)override{auto n=qMin(max,qint64(body.size())-pos);if(n<=0)return -1;std::memcpy(out,body.constData()+pos,size_t(n));pos+=n;return n;}
};
class Network:public QNetworkAccessManager{public:bool fail=false;int calls=0;QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{++calls;return new Reply(r,this,fail);}};
}
class Step04MarketStatusTests:public QObject{
 Q_OBJECT
private slots:
 void cachedQuote(){QTemporaryDir dir;seed(dir.path(),quote());Network n;GlobalMarketPage p(dir.path(),true,nullptr,&n);setup(p);QTRY_VERIFY(refresh(p)->isEnabled());shot(p,"cached-quote");
  QVERIFY(summary(p).contains("非实时"));QVERIFY(summary(p).contains("隔离报价样本"));QVERIFY(summary(p).contains("2026-10-16T14:29:00Z"));QCOMPARE(n.calls,0);}
 void emptyData(){QTemporaryDir dir;Network n;GlobalMarketPage p(dir.path(),true,nullptr,&n);setup(p);QTRY_VERIFY(refresh(p)->isEnabled());shot(p,"empty");QVERIFY(summary(p).contains("暂无"));QVERIFY(!summary(p).contains("0.00"));}
 void chartOnly(){QTemporaryDir dir;seed(dir.path(),{});Network n;GlobalMarketPage p(dir.path(),true,nullptr,&n);setup(p);QTRY_VERIFY(refresh(p)->isEnabled());shot(p,"chart-only");QVERIFY(summary(p).contains("非实时"));QVERIFY(summary(p).contains("隔离图表样本"));}
 void missingChange(){QTemporaryDir dir;seed(dir.path(),quote(QJsonValue::Null));Network n;GlobalMarketPage p(dir.path(),true,nullptr,&n);setup(p);QTRY_VERIFY(refresh(p)->isEnabled());shot(p,"missing");QVERIFY(summary(p).contains("未取得"));QVERIFY(!summary(p).contains("0.00%"));}
 void zeroChange(){QTemporaryDir dir;seed(dir.path(),quote(0.));Network n;GlobalMarketPage p(dir.path(),true,nullptr,&n);setup(p);QTRY_VERIFY(refresh(p)->isEnabled());shot(p,"zero");QVERIFY(summary(p).contains("0.00%"));}
 void freshResponse(){QTemporaryDir dir;Network n;GlobalMarketPage p(dir.path(),true,nullptr,&n);setup(p);QTRY_VERIFY(refresh(p)->isEnabled());refresh(p)->click();QTRY_VERIFY(status(p).startsWith("已更新"));shot(p,"fresh");
  QCOMPARE(n.calls,1);QCOMPARE(p.sourceEvidence()["quote"].toObject()["value"].toDouble(),160.);QVERIFY(summary(p).contains("本次来源响应"));QVERIFY(summary(p).contains("延迟未保证"));QVERIFY(summary(p).contains("Yahoo"));}
 void failedReload(){QTemporaryDir dir;seed(dir.path(),quote());Network n;n.fail=true;GlobalMarketPage p(dir.path(),true,nullptr,&n);setup(p);QTRY_VERIFY(refresh(p)->isEnabled());const QJsonValue old=p.sourceEvidence()["series"];
  refresh(p)->click();QTRY_VERIFY(status(p).startsWith("更新未成功"));QCOMPARE(p.sourceEvidence()["series"],old);QCOMPARE(p.sourceEvidence()["quote"].toObject()["value"].toDouble(),159.);
  p.findChild<QPushButton*>("globalReload")->click();QTRY_VERIFY(refresh(p)->isEnabled());shot(p,"failed-reload");QVERIFY(status(p).contains("上次刷新未成功"));QVERIFY(status(p).contains("503"));QCOMPARE(n.calls,1);}
};
QTEST_MAIN(Step04MarketStatusTests)
#include "step04_market_status_tests.moc"
