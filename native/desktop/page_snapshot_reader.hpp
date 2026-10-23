#pragma once
#include "native_read_pool.hpp"
#include <QCoreApplication>
#include <QEvent>
#include <QJsonObject>
#include <QPointer>
#include <QTimer>
#include <QWidget>
#include <functional>
#include <atomic>
#include <memory>
// A page owns one active read and one replaceable pending request. Readers must
// capture immutable paths/values only; SQL connections are owned by the worker.
class PageSnapshotReader final:public QObject {
public:
 using Cancel=std::function<bool()>;
 using Read=std::function<QJsonObject(const Cancel&)>;
private:
 QWidget* page;Read read;
 std::function<void(QJsonObject,QString)> complete;
 quint64 serial=0;bool active=false,pending=false,enabled=true;
 std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);
 void dispatch(){
  if(active||!pending||!page->isVisible())return;
  active=true;pending=false;const auto token=serial;auto work=read;auto flag=cancelled=std::make_shared<std::atomic_bool>(false);
  QPointer<PageSnapshotReader> owner(this);auto* app=QCoreApplication::instance();
  nativeReadPool()->start([owner,app,work,token,flag]{
   QJsonObject data;QString error;try{if(!flag->load())data=work([flag]{return flag->load();});}catch(const std::exception&e){error=QString::fromUtf8(e.what());}
   if(flag->load()){data={};error={};}
   QMetaObject::invokeMethod(app,[owner,token,data,error,flag]{if(!owner)return;owner->active=false;
    if(!flag->load()&&owner->serial==token&&owner->page->isVisible())owner->complete(data,error);
    if(owner)owner->dispatch();},Qt::QueuedConnection);
  });
 }
protected:
 bool eventFilter(QObject*,QEvent* e)override{
  if(e->type()==QEvent::Hide){cancelled->store(true);++serial;if(enabled)pending=pending||active;}
  if(e->type()==QEvent::Show)QTimer::singleShot(0,this,[this]{dispatch();});
  return false;
 }
public:
 PageSnapshotReader(QWidget* p,std::function<QJsonObject()> r,std::function<void(QJsonObject,QString)> c):QObject(p),page(p),read([r=std::move(r)](const Cancel&){return r();}),complete(std::move(c)){p->installEventFilter(this);}
 ~PageSnapshotReader()override{cancelled->store(true);}
 void request(){enabled=true;cancelled->store(true);++serial;pending=true;dispatch();}
 void cancel(){enabled=false;cancelled->store(true);++serial;pending=false;}
 void requestCancellable(Read next){read=std::move(next);request();}
 void request(std::function<QJsonObject()> next){requestCancellable([next=std::move(next)](const Cancel&){return next();});}
 bool busy()const{return active||pending;}
};
