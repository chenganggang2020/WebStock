#include "global_market_transport.hpp"
#include "market_feed.hpp"
#include "market_overview_model.hpp"
#include "market_overview_page.hpp"
#include "global_market_page.hpp"
#include "global_market_cache.hpp"
#include "appearance.hpp"
#include <QtWidgets>
#include <QTemporaryDir>
#include <QFile>
int main(int argc,char** argv){
 QApplication app(argc,argv);app.setPalette(appearance::palette(appearance::theme("graphite")));QTemporaryDir dir;GlobalMarketTransport transport;QJsonArray receipts;QJsonObject firstOverview;QStringList jobs{"nasdaq-composite:daily","nasdaq100-future:intraday","nikkei225:daily"};int i=0;std::function<void()> next;std::unique_ptr<GlobalMarketPage> global;std::unique_ptr<MarketOverviewPage> overview;
 auto pages=[&]{
  global=std::make_unique<GlobalMarketPage>(dir.path(),true);global->resize(1500,950);global->setProperty("stockTheme","graphite");auto state=global->saveState();state["key"]="nasdaq-composite";global->restoreState(state);global->show();
  QTimer::singleShot(3500,&app,[&]{global->grab().save(QString(REFRESH_OUTPUT)+"/live-global-daily.png");global->hide();overview=std::make_unique<MarketOverviewPage>(dir.filePath("overview.sqlite"),true);overview->setProperty("stockTheme","graphite");overview->resize(1600,1000);overview->show();
   QTimer::singleShot(20000,&app,[&]{firstOverview=overview->sourceEvidence()["attempt"].toObject();});
   QTimer::singleShot(55000,&app,[&]{overview->grab().save(QString(REFRESH_OUTPUT)+"/live-overview.png");QJsonArray charts;for(auto feed:overview->findChildren<MarketFeed*>())for(auto value:feed->instruments){auto item=value.toObject();charts.append(QJsonObject{{"id",item["id"]},{"minuteRows",item["minute"].toArray().size()},{"meta",item["minuteMeta"]}});}QFile file(QString(REFRESH_OUTPUT)+"/live-overview-evidence.json");if(file.open(QIODevice::WriteOnly))file.write(QJsonDocument(QJsonObject{{"firstAutomaticAttempt",firstOverview},{"page",overview->sourceEvidence()},{"charts",charts}}).toJson());overview->hide();app.quit();});
  });
 };
 next=[&]{if(i>=jobs.size()){QFile file(QString(REFRESH_OUTPUT)+"/live-global-probe.json");if(file.open(QIODevice::WriteOnly))file.write(QJsonDocument(receipts).toJson());pages();return;}auto parts=jobs[i++].split(':');transport.start(parts[0],parts[1],[&,parts](QJsonObject series,QJsonObject quote,QStringList errors){const auto rows=series[parts[1]=="daily"?"candles":"points"].toArray();globalMarket::Cache(dir.path()).apply(parts[0],parts[1],series,quote,errors,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));receipts.append(QJsonObject{{"key",parts[0]},{"period",parts[1]},{"at",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"count",rows.size()},{"first",rows.isEmpty()?QJsonValue():rows.first()},{"last",rows.isEmpty()?QJsonValue():rows.last()},{"series",series},{"quote",quote},{"errors",QJsonArray::fromStringList(errors)},{"responses",transport.responses()}});QTimer::singleShot(0,&app,next);});};QTimer::singleShot(0,&app,next);QTimer::singleShot(95000,&app,&QApplication::quit);return app.exec();
}
