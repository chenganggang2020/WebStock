#pragma once
#include "unified_backup.hpp"
#include <QObject>
#include <QPointer>
#include <QThread>
#include <QThreadPool>
#include <QRunnable>
#include <QMetaObject>
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <memory>
#include <chrono>
namespace unifiedBackup {
struct Task {bool writing=false,needsInputs=false;};
using Work=std::function<QJsonObject()>;
using Done=std::function<void(QJsonObject,QString)>;
using Runner=std::function<void(Task,Work,Done)>;
class AsyncLane final:public std::enable_shared_from_this<AsyncLane> {
 inline static std::atomic_bool occupied{false};
 QPointer<QObject> ui;QThreadPool* pool;Work capture;
 std::atomic_bool closed{false},active{true},working{false},writing{false};
 std::atomic<quint64> generation{0};quint64 taskGeneration=0;
 QJsonObject snapshot;QThread* worker=nullptr;
 void requireUi()const{need(ui&&QThread::currentThread()==ui->thread(),"异步入口须由UI线程调用");}
public:
 AsyncLane(QObject* dispatcher,QThreadPool* executor,Work captureInputs):ui(dispatcher),pool(executor),capture(std::move(captureInputs)){need(ui&&pool&&pool->maxThreadCount()==1,"需根宿主提供单线程专用执行器与UI分发器");}
 bool busy()const{return working.load();}
 bool writeInFlight()const{return working&&writing;}
 void invalidate(){requireUi();++generation;}
 void setActive(bool value){requireUi();active=value;if(!value)++generation;}
 // Page disposal calls setActive(false), not closeOwner: in-flight writes retain ownership.
 void closeOwner(){requireUi();closed=true;active=false;++generation;}
 QJsonObject inputs()const{need(QThread::currentThread()==worker&&!snapshot.isEmpty(),"本任务未取得UI主自选快照");return snapshot;}
 void checkRead()const{need(QThread::currentThread()==worker,"读取取消检查须在任务线程");need(writing||(!closed&&active&&generation==taskGeneration),"预览已失效；未接受晚到结果");}
 Runner runner(){auto self=shared_from_this();return [self](Task task,Work work,Done done){self->submit(task,std::move(work),std::move(done));};}
 void submit(Task task,Work work,Done done){
  requireUi();need(!closed&&active&&!working,"页面已离开或任务仍在释放资源");
  bool free=false;need(occupied.compare_exchange_strong(free,true),"另一个统一备份任务尚未结束；未排队");
  try{snapshot=task.needsInputs?capture():QJsonObject{};taskGeneration=generation;working=true;writing=task.writing;}catch(...){occupied=false;throw;}
  auto self=shared_from_this();auto runnable=QRunnable::create([self,task,work=std::move(work),done=std::move(done)]{
   QJsonObject value;QString error;self->worker=QThread::currentThread();
   try{if(!task.writing)self->checkRead();value=work();if(!task.writing)self->checkRead();}catch(const std::exception&e){error=QString::fromUtf8(e.what());}catch(...){error="后台任务异常；请重读回执";}
   auto epoch=self->taskGeneration;self->snapshot={};self->worker=nullptr;occupied=false;
   bool posted=self->ui&&QMetaObject::invokeMethod(self->ui,[self,task,epoch,value=std::move(value),error=std::move(error),done]{
    self->working=false;self->writing=false;
    if(!task.writing&&(self->closed||!self->active||self->generation!=epoch)){done({},"预览已失效；未接受晚到结果");return;}
    done(value,error);
   },Qt::QueuedConnection);if(!posted){self->working=false;self->writing=false;}
  });
  if(!pool->tryStart(runnable)){delete runnable;snapshot={};working=false;writing=false;occupied=false;need(false,"执行器忙；未排队");}
 }
 QJsonObject commitOnUi(Work commit){
  need(QThread::currentThread()==worker&&writing,"写入只能来自当前不可中断任务");
  struct Gate {std::mutex mutex;std::condition_variable condition;int state=0;QJsonObject result;QString error;};
  auto gate=std::make_shared<Gate>();auto self=shared_from_this();need(!closed&&ui,"原UI提交宿主已关闭；未启动提交");
  need(QMetaObject::invokeMethod(ui,[self,gate,commit]{
   {std::lock_guard<std::mutex> lock(gate->mutex);if(gate->state!=0)return;if(self->closed){gate->state=3;gate->condition.notify_all();return;}gate->state=1;}
   QJsonObject result;QString error;try{result=commit();}catch(const std::exception&e){error=QString::fromUtf8(e.what());}catch(...){error="原生提交异常";}
   {std::lock_guard<std::mutex> lock(gate->mutex);gate->result=std::move(result);gate->error=error;gate->state=2;}gate->condition.notify_all();
  },Qt::QueuedConnection),"UI提交未入队");
  auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(10);std::unique_lock<std::mutex> lock(gate->mutex);
  while(gate->state<2){gate->condition.wait_for(lock,std::chrono::milliseconds(50));
   if(gate->state==0&&(closed||!ui||std::chrono::steady_clock::now()>=deadline)){gate->state=3;gate->condition.notify_all();}
  }
  need(gate->state==2,"排队提交已失效；不会晚到执行");need(gate->error.isEmpty(),gate->error);return gate->result;
 }
};
}
