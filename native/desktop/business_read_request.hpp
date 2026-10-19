#pragma once
#include "business_store.hpp"
#include "native_read_pool.hpp"
#include "portfolio_mirror_initial.hpp"
#include <QPointer>
#include <QWidget>
#include <QEvent>
#include <atomic>
#include <memory>

// One running read and one replaceable latest request per page. Only the current visible owner receives data.
class BusinessReadRequest final:public QObject {
  QPointer<QWidget> page;
  QString file;
  quint64 generation=0;
  bool running=false;
  QJsonObject pending;
  std::shared_ptr<std::atomic_bool> stopped=std::make_shared<std::atomic_bool>(false);
  void start(){
    if(running||pending.isEmpty()||!page||!page->isVisible())return;
    auto request=pending;pending={};auto token=generation;auto flag=std::make_shared<std::atomic_bool>(false);stopped=flag;running=true;
    QPointer<BusinessReadRequest> self(this);QPointer<QObject> app(QCoreApplication::instance());auto path=file;
    nativeReadPool()->start([self,app,path,request,token,flag]{QJsonObject result=request;try{
      auto cancel=[flag]{return flag->load();};auto kind=request["kind"].toString();
      if(request["operation"]=="list")result["rows"]=BusinessStore::readListSummaries(path,kind,request["query"].toString(),cancel);
      else if(request["operation"]=="industry")result["snapshot"]=BusinessStore::readIndustrySummaries(path,cancel);
      else if(request["operation"]=="mirrorInitial"){
        result["input"]=portfolioMirrorInitial::read(path,request["instruments"].toArray(),request["isolated"].toBool(),cancel);
        auto state=PortfolioMirrorStore::readInitialState(request["mirrorFile"].toString(),cancel,request.contains("restore")?request["restore"]:QJsonValue(QJsonValue::Undefined));
        for(auto value:QJsonArray{state["view"],state["effectiveView"]}){auto id=value.toObject()["accountId"].toString();bool found=id.isEmpty();for(auto account:result["input"].toObject()["accounts"].toArray())found|=account.toObject()["id"]==id;business::require(found,"保存的账户已不在只读快照中，未改绑");}
        result["mirror"]=state;
      }
      else if(request["operation"]=="ledger"){
        auto raw=BusinessStore::readPortfolioSnapshot(path,cancel);const bool paper=request["paper"].toBool();auto account=request["account"].toString();auto accounts=raw["accounts"].toArray(),trades=raw["trades"].toArray();
        if(request["initial"].toBool()&&!paper&&account=="local"&&!trades.isEmpty()){bool local=false;for(auto t:trades)local|=t.toObject()["accountId"]=="local";if(!local)account=trades[0].toObject()["accountId"].toString();}
        QJsonArray available;bool found=false;for(auto value:accounts){auto row=value.toObject();if((row["type"]=="paper")==paper){available.append(row);found|=row["id"]==account;}}if(!found)account=available.isEmpty()?QString():available[0].toObject()["id"].toString();
        if(cancel())throw std::runtime_error("账本读取已取消");result["accounts"]=available;result["account"]=account;result["portfolio"]=business::portfolio(trades,request["quotes"].toObject(),account);
        QJsonArray selectedTrades,oldReports;for(auto t:trades)if(t.toObject()["accountId"]==account)selectedTrades.append(t);for(auto value:raw["reports"].toArray()){auto r=value.toObject();if(r["accountId"]==account)oldReports.append(r["legacyOriginal"]);}result["trades"]=selectedTrades;result["snapshots"]=oldReports;
      }else result["row"]=BusinessStore::readRecord(path,kind,request["id"].toString(),request["sha256"].toString(),cancel);
    }catch(const std::exception&e){result["error"]=QString::fromUtf8(e.what());}
    if(app)QMetaObject::invokeMethod(app,[self,result,token]{if(!self)return;self->running=false;if(!self->pending.isEmpty()){self->start();return;}if(token!=self->generation||!self->page||!self->page->isVisible())return;if(self->completed)self->completed(result);},Qt::QueuedConnection);
    });
  }
protected:
  bool eventFilter(QObject* object,QEvent* event)override{
    if(object==page){if(event->type()==QEvent::Hide)cancel();else if(event->type()==QEvent::Show){if(shown)shown();start();}}
    return QObject::eventFilter(object,event);
  }
public:
  std::function<void(QJsonObject)> completed;
  std::function<void()> shown;
  BusinessReadRequest(QString path,QWidget* owner):QObject(owner),page(owner),file(std::move(path)){owner->installEventFilter(this);}
  ~BusinessReadRequest()override{cancel();}
  void submit(QJsonObject request){++generation;stopped->store(true);pending=std::move(request);start();}
  void list(QString kind,QString query={}){submit({{"operation","list"},{"kind",kind},{"query",query}});}
  void record(QString kind,QString id,QString hash={}){submit({{"operation","record"},{"kind",kind},{"id",id},{"sha256",hash}});}
  void cancel(){++generation;stopped->store(true);pending={};}
};
