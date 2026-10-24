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
 QJsonArray stocks,visibleStocks;int stockCursor=0,minuteCursor=0,capitalCursor=0;MarketFeed* stockFeed=nullptr;QHash<QString,qint64> stockDue,minuteDue,capitalDue;
 void collectStock(){
  if(!stockFeed||stocks.isEmpty())return;
  const auto now=QDateTime::currentMSecsSinceEpoch();
  // A slow capital request must not hold the whole quote/chart queue. At most
  // one item per lane per tick; visible rows get minute data without selection.
  const auto& minuteRows=visibleStocks.isEmpty()?stocks:visibleStocks;
  for(int n=0;n<minuteRows.size();++n){const int i=(minuteCursor+n)%minuteRows.size();const auto row=minuteRows[i].toObject();const auto id=row["id"].toString();if(minuteDue.value(id)>now)continue;
   minuteCursor=(i+1)%minuteRows.size();minuteDue[id]=now+60000;
   try{stockFeed->observe(row,false);stockFeed->chart(id,"minute");}catch(const std::exception& e){last={{"source","stock-background"},{"id",id},{"error",QString::fromUtf8(e.what())}};}break;
  }
  for(int n=0;n<stocks.size();++n){const int i=(stockCursor+n)%stocks.size();const auto row=stocks[i].toObject();const auto id=row["id"].toString();if(stockDue.value(id)>now)continue;
   stockCursor=(i+1)%stocks.size();stockDue[id]=now+300000;
   try{stockFeed->observe(row,false);stockFeed->chart(id,"day");}catch(const std::exception& e){last={{"source","stock-background"},{"id",id},{"error",QString::fromUtf8(e.what())}};}break;
  }
  if(stockFeed->capitalDayBusy())return;
  for(int n=0;n<stocks.size();++n){const int i=(capitalCursor+n)%stocks.size();const auto row=stocks[i].toObject();const auto id=row["id"].toString();if(capitalDue.value(id)>now||id.contains(":etf:"))continue;
   capitalCursor=(i+1)%stocks.size();capitalDue[id]=now+300000;
   try{stockFeed->observe(row,false);stockFeed->capitalFlow(id,"day");}catch(const std::exception& e){last={{"source","stock-background"},{"id",id},{"error",QString::fromUtf8(e.what())}};}break;
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
 QJsonArray stockView(const QJsonArray& observed)const{
  QJsonArray rows=observed;QSet<QString> ids;for(auto value:observed)ids.insert(value.toObject()["id"].toString());
  if(stockFeed)for(auto value:stockFeed->instruments){const auto id=value.toObject()["id"].toString();if(!ids.contains(id)){ids.insert(id);rows.append(value);}}
  return rows;
 }
 static QJsonObject mergeStockHistory(QJsonObject existing,const QJsonObject& incoming){
  if(existing["id"].toString().isEmpty()||existing["id"]!=incoming["id"])return existing;
  for(const auto& period:QStringList{"day","minute","capitalDay"}){
   const auto metaKey=period+"Meta";const auto meta=incoming[metaKey].toObject();
   const auto previous=existing[metaKey].toObject();
   auto sourceTime=[](const QJsonArray& rows){qint64 latest=0;for(auto value:rows){const auto row=value.toObject();if(row.contains("valid")&&!row["valid"].toBool())continue;latest=qMax(latest,qint64(row["time"].toDouble()));}return latest;};
   const auto incomingTime=sourceTime(incoming[period].toArray()),previousTime=sourceTime(existing[period].toArray());
   const auto incomingDate=meta["dataDate"].toString(),previousDate=previous["dataDate"].toString();
   // Each period has its own source clock. A minute completion can carry an
   // older day/capital snapshot from the collector's independent memory.
   bool older=!incomingDate.isEmpty()&&!previousDate.isEmpty()&&incomingDate<previousDate;
   if(incomingTime&&previousTime)older|=incomingTime<previousTime;
   if(!older&&incomingTime==previousTime&&incomingDate==previousDate){
    const auto checked=QDateTime::fromString(meta["checkedAt"].toString(),Qt::ISODateWithMs);
    const auto previousChecked=QDateTime::fromString(previous["checkedAt"].toString(),Qt::ISODateWithMs);
    older=checked.isValid()&&previousChecked.isValid()&&checked<previousChecked;
   }
   // An unloaded/failed collector is not an empty successful history. Preserve
   // the host's rows and their original provenance, carrying only diagnostics.
   if(!older&&!incoming[period].toArray().isEmpty()&&(meta["error"].toString().isEmpty()||existing[period].toArray().isEmpty())){
    existing[period]=incoming[period];existing[metaKey]=meta;
   }else if(!meta["error"].toString().isEmpty()){
    auto retained=existing[metaKey].toObject();retained["cached"]=true;retained["error"]=meta["error"];
    for(auto key:{"lastAttemptAt","lastTransportAttempts"})if(meta.contains(key))retained[key]=meta[key];
    existing[metaKey]=retained;
   }
  }
  return existing;
 }
 std::function<void(QString)> updated;
 std::function<void(QJsonObject)> stockUpdated;
 void setVisibleStocks(const QJsonArray& rows){
  QJsonArray next;QStringList ids,previous;for(auto v:visibleStocks)previous.append(v.toObject()["id"].toString());
  for(auto v:rows){const auto id=v.toObject()["id"].toString();if(id.contains(":stock:")||id.contains(":index:")||id.contains(":etf:")){next.append(v);ids.append(id);}}
  visibleStocks=next;if(ids!=previous)minuteCursor=0;
 }
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
 QJsonObject evidence()const{return {{"enabled",enabled&&!stopped},{"lastAttempt",last},{"jobs",jobs.size()},{"stocks",stocks.size()},{"visibleStocks",visibleStocks.size()},{"busy",saving||overview.busy()||global.busy()},{"scope","global-overview-visible-minute-watchlist-day-and-capital"}};}
};
