#pragma once
#include "industry_topic_sources.hpp"
#include <QObject>
#include <QTimer>
#include <QThread>
#include <atomic>
#include <memory>
namespace industryTopicUpdate {
class Runtime final:public QObject {
 QString file;std::function<QJsonArray()>rows;std::function<QString()>clock;QTimer timer;QThread*thread=nullptr;bool active=false,manual=false,closing=false;std::shared_ptr<std::atomic_bool>cancel=std::make_shared<std::atomic_bool>(false);
 QString now()const{return clock?clock():QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);}
 void launch(QString topic,bool manualRun,std::function<void(QJsonObject,QString)>done){
  manual=manualRun;cancel->store(false);auto path=file;auto readRows=rows;auto time=clock;auto stopped=cancel;auto result=std::make_shared<QJsonObject>();auto error=std::make_shared<QString>();thread=QThread::create([path,readRows,time,stopped,topic,manualRun,result,error]{auto current=[time]{return time?time():QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);};try{Store store(path);if(manualRun)*result=store.run(topic,current(),true,[readRows,current](QJsonObject task){return sourceAcquire(readRows(),task,current());},[readRows](QJsonObject task){return sourceVersion(readRows(),task.value("sourceIds").toArray());},[stopped]{return stopped->load();},current);else{store.recover(current());auto initial=industryArchive::validate(store.snapshot().value("archive").toString());for(auto row:initial.data.value("topics").toArray()){if(stopped->load()||QThread::currentThread()->isInterruptionRequested())break;auto id=row.toObject().value("id").toString();auto state=store.snapshot();auto latest=industryArchive::validate(state.value("archive").toString());for(auto v:latest.data.value("topics").toArray()){auto t=v.toObject();if(t.value("id")!=id)continue;bool configured=false;for(auto a:state.value("tasks").toArray())if(a.toObject().value("topicId")==id)configured=true;auto due=t.value("nextDueAt").toString();if(configured&&t.value("enabled").toBool()&&!due.isEmpty()&&industryArchive::noLater(due,current()))*result=store.run(id,current(),false,[readRows,current](QJsonObject task){return sourceAcquire(readRows(),task,current());},[readRows](QJsonObject task){return sourceVersion(readRows(),task.value("sourceIds").toArray());},[stopped]{return stopped->load();},current);}}}}catch(const std::exception&e){*error=QString::fromUtf8(e.what());}});
  auto owned=thread;connect(owned,&QThread::finished,this,[this,owned,result,error,done]{thread=nullptr;manual=false;owned->deleteLater();if(!closing&&done)done(*result,*error);});owned->start();
 }
public:
 Runtime(QString path,std::function<QJsonArray()>readRows,QObject*parent=nullptr,std::function<QString()>time={}):QObject(parent),file(std::move(path)),rows(std::move(readRows)),clock(std::move(time)){timer.setInterval(30000);connect(&timer,&QTimer::timeout,this,[this]{tick();});}
 ~Runtime()override{closing=true;stop();if(thread){thread->requestInterruption();thread->wait();delete thread;thread=nullptr;}}
 void start(){if(active||closing)return;active=true;timer.start();tick();}
 void stop(){active=false;timer.stop();cancel->store(true);if(thread)thread->requestInterruption();}
 void cancelManual(){if(manual){cancel->store(true);if(thread)thread->requestInterruption();}}
 bool isBusy()const{return thread!=nullptr;}
 bool runManual(QString topic,std::function<void(QJsonObject,QString)>done){if(!active||closing||thread)return false;launch(std::move(topic),true,std::move(done));return true;}
 bool tick(){if(!active||closing||thread)return false;try{if(Store(file).snapshot().isEmpty())return true;launch({},false,{});return true;}catch(...){return false;}}
};
}
