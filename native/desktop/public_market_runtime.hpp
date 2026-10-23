#pragma once
#include "global_market_model.hpp"
#include "global_market_cache.hpp"
#include "global_market_transport.hpp"
#include "market_overview_feed.hpp"
#include "market_overview_store.hpp"
#include "market_refresh_policy.hpp"
#include "market_feed.hpp"
#include "capital_workbench_model.hpp"
#include <QCoreApplication>
#include <QPointer>
#include <QThreadPool>
#include <atomic>

// Application-owned source collection. No widget, focus or visibility dependency.
// Parsing, validation and persistence retain the same source contracts as pages.
class PublicMarketRuntime final:public QObject {
 struct Job{QString key,period; qint64 due=0;int failures=0;};
 QString root;bool enabled=false,stopped=false,saving=false;int cursor=0; qint64 overviewDue=0;int overviewFailures=0;
 QList<Job> jobs;QTimer timer;GlobalMarketTransport global;marketOverview::Feed overview;QThreadPool workers;
 std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);
 QJsonObject last;
 QJsonArray stocks;int stockCursor=0;MarketFeed* stockFeed=nullptr;QHash<QString,qint64> stockDue;
 void collectStock(){
  if(!stockFeed||stockFeed->capitalDayBusy()||stocks.isEmpty())return;
  const auto now=QDateTime::currentMSecsSinceEpoch();
  for(int n=0;n<stocks.size();++n){const int i=(stockCursor+n)%stocks.size();const auto row=stocks[i].toObject();const auto id=row["id"].toString();if(stockDue.value(id)>now)continue;
   stockCursor=(i+1)%stocks.size();stockDue[id]=now+300000;
   try{stockFeed->observe(row);stockFeed->chart(id,"day");stockFeed->capitalFlow(id,"day");}catch(const std::exception& e){last={{"source","stock-background"},{"id",id},{"error",QString::fromUtf8(e.what())}};}return;
  }
 }
 void later(int ms=1000){if(enabled&&!stopped)timer.start(ms);}
 void finishOverview(QJsonObject snapshot){
  if(stopped)return;saving=true;bool available=false;for(auto v:snapshot["sections"].toObject())available|=v.toObject()["availability"]=="available";
  overviewFailures=available?0:std::min(overviewFailures+1,3);overviewDue=QDateTime::currentMSecsSinceEpoch()+marketRefresh::chinaInterval(QDateTime::currentDateTimeUtc(),overviewFailures);
  const auto path=root+"/market-overview-v1.sqlite";auto token=cancelled;QPointer<PublicMarketRuntime> self(this);
  workers.start([self,path,snapshot,token,available]{QString error;try{marketOverview::Store(path).record(snapshot,[token]{return token->load();});}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
   QMetaObject::invokeMethod(qApp,[self,error,available,snapshot]{if(!self||self->stopped)return;self->saving=false;self->last={{"source","market-overview"},{"at",snapshot["fetchedAt"]},{"available",available},{"saved",error.isEmpty()},{"error",error}};if(self->updated)self->updated("overview");self->later();},Qt::QueuedConnection);
  });
 }
 void collectGlobal(int index){
  const auto job=jobs[index];QPointer<PublicMarketRuntime> self(this);
  try{global.start(job.key,job.period,[self,index,job](QJsonObject series,QJsonObject quote,QStringList errors){
   if(!self||self->stopped)return;self->saving=true;auto& state=self->jobs[index];state.failures=series.isEmpty()?std::min(state.failures+1,3):0;
   state.due=QDateTime::currentMSecsSinceEpoch()+marketRefresh::globalInterval(globalMarket::definition(job.key),job.period,QDateTime::currentDateTimeUtc(),state.failures);
   const auto directory=self->root;auto token=self->cancelled;const auto attempted=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);const bool available=!series.isEmpty();
   self->workers.start([self,directory,job,series,quote,errors,attempted,token,available]{QString error;try{globalMarket::Cache cache(directory,[token]{return token->load();});cache.apply(job.key,job.period,series,quote,errors,attempted,[token]{return token->load();});}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
    QMetaObject::invokeMethod(qApp,[self,job,error,errors,attempted,available]{if(!self||self->stopped)return;self->saving=false;self->last={{"source","global"},{"key",job.key},{"period",job.period},{"at",attempted},{"available",available},{"saved",error.isEmpty()},{"error",error},{"sourceErrors",QJsonArray::fromStringList(errors)}};if(self->updated)self->updated(job.key+":"+job.period);self->later();},Qt::QueuedConnection);
   });
  });}catch(const std::exception& e){jobs[index].due=QDateTime::currentMSecsSinceEpoch()+60000;last={{"error",QString::fromUtf8(e.what())}};later();}
 }
 void tick(){
  if(!enabled||stopped)return;collectStock();if(saving||overview.busy()||global.busy()){later();return;}
  const auto now=QDateTime::currentMSecsSinceEpoch();
  if(now>=overviewDue){if(overview.start())return;overviewDue=now+60000;}
  for(int n=0;n<jobs.size();++n){const int index=(cursor+n)%jobs.size();if(jobs[index].due<=now){cursor=(index+1)%jobs.size();collectGlobal(index);return;}}
  later();
 }
public:
 std::function<void(QString)> updated;
 std::function<void(QJsonObject)> stockUpdated;
 explicit PublicMarketRuntime(QString directory,bool allow,QObject* parent=nullptr,QNetworkAccessManager* transport=nullptr):QObject(parent),root(std::move(directory)),enabled(allow),global(this,transport),overview(this,transport){
  setObjectName("publicMarketRuntime");workers.setMaxThreadCount(1);timer.setSingleShot(true);connect(&timer,&QTimer::timeout,this,[this]{tick();});connect(&overview,&marketOverview::Feed::finished,this,[this](QJsonObject snapshot){finishOverview(snapshot);});
  for(const auto& v:globalMarket::catalog())for(const auto& period:QStringList{"intraday","daily"})jobs.append({v.toObject()["key"].toString(),period});
  if(allow)later(100);
 }
 void setStocks(QJsonArray roster){
  stocks={};for(auto v:roster){auto r=v.toObject();if(!r["transient"].toBool()&&(r["id"].toString().contains(":stock:")||r["id"].toString().contains(":index:")))stocks.append(r);}for(auto v:capitalWorkbench::markets())stocks.append(v);
  if(!stockFeed&&enabled){stockFeed=new MarketFeed(root+"/live",this,nullptr,false);stockFeed->setObjectName("backgroundPublicStockFeed");connect(stockFeed,&MarketFeed::updated,this,[this](QString id){if(stopped)return;for(auto v:stockFeed->instruments)if(v.toObject()["id"]==id){if(stockUpdated)stockUpdated(v.toObject());break;}});}
 }
 ~PublicMarketRuntime()override{stop();delete stockFeed;stockFeed=nullptr;workers.clear();workers.waitForDone();}
 void stop(){stopped=true;cancelled->store(true);timer.stop();global.cancel();overview.cancel();if(stockFeed){stockFeed->cancelCapitalDay();stockFeed->cancelSamples();}}
 QJsonObject evidence()const{return {{"enabled",enabled&&!stopped},{"lastAttempt",last},{"jobs",jobs.size()},{"stocks",stocks.size()},{"busy",saving||overview.busy()||global.busy()},{"scope","global-overview-watchlist-day-and-capital"}};}
};
