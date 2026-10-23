#pragma once
#include "quant_model_job.hpp"

namespace quantModel {
// Original daily policy: Beijing 09:05, known trading calendar, >=1000 names, <=7 calendar days old.
inline QJsonObject dailyDecision(const QJsonObject& calendar,const QJsonObject& manifest,const QDateTime& now,bool busy,bool attempted){
 auto clock=now.toOffsetFromUtc(8*3600);auto day=clock.date();auto date=day.toString(Qt::ISODate);
 auto decision=[&](QString action,QString reason){return QJsonObject{{"action",action},{"date",date},{"reason",reason}};};
 if(!now.isValid()||calendar.value("schema")!="native-paper-session-catalog/v1"||date<calendar.value("calendarFrom").toString()||date>calendar.value("calendarThrough").toString())return decision("blocked","交易日历未覆盖，未自动判断");
 bool closed=day.dayOfWeek()>=6;for(auto value:calendar.value("holidays").toArray()){auto pair=value.toArray();need(pair.size()==2,"交易日历区间损坏");if(date>=pair[0].toString()&&date<=pair[1].toString())closed=true;}
 if(closed)return decision("wait","交易所休市日");if(clock.time()<QTime(9,5))return decision("wait","北京时间09:05后运行");
 if(busy)return decision("skip","已有量化任务运行");if(attempted)return decision("skip","今日已尝试；失败或取消需显式允许重试");
 if(manifest.value("schema")!="webstock.quant.dataset.v1"||manifest.value("coverage").toObject().value("requested").toInt()<1000)return decision("blocked","需要已存在的本地全市场数据，至少1000只证券");
 auto asOf=QDate::fromString(manifest.value("asOf").toString(),Qt::ISODate);if(!asOf.isValid()||asOf>day||asOf.daysTo(day)>7)return decision("blocked","数据日期无效、超前或超过7天");
 auto out=decision("run","本地数据满足每日研究条件");out["datasetId"]=manifest.value("datasetId");out["asOf"]=manifest.value("asOf");return out;
}

class DailySchedule {
 QString root;
 QString slot(QString date)const{need(QDate::fromString(date,Qt::ISODate).isValid(),"计划日期无效");return root+"/.daily/"+date+".json";}
public:
 explicit DailySchedule(QString directory):root(directory){}
 QJsonObject inspect(const QString& calendarPath,const QString& selectedManifest,const QDateTime& now,bool busy)const{
  auto calendarBytes=read(calendarPath,1024*1024);auto calendar=object(calendarBytes);auto parent=QFileInfo(selectedManifest).absolutePath();auto datasets=QDir(parent);datasets.cdUp();QJsonObject latest;QString selected;
  auto consider=[&](QString path){try{auto manifest=object(read(path,1024*1024));if(manifest.value("schema")=="webstock.quant.dataset.v1"&&manifest.value("coverage").toObject().value("requested").toInt()>=1000&&(latest.isEmpty()||manifest.value("asOf").toString()>latest.value("asOf").toString())){latest=manifest;selected=path;}}catch(const std::exception&){} };
  consider(selectedManifest);auto folders=datasets.entryInfoList(QDir::Dirs|QDir::NoDotAndDotDot|QDir::NoSymLinks,QDir::Name);need(folders.size()<=200,"每日数据目录超过200项，请选择独立研究目录");for(auto info:folders)consider(info.absoluteFilePath()+"/manifest.json");
  auto date=now.toOffsetFromUtc(8*3600).date().toString(Qt::ISODate);auto result=dailyDecision(calendar,latest,now,busy,QFileInfo::exists(slot(date)));result["manifestPath"]=selected;result["calendarSha256"]=hash(calendarBytes);return result;
 }
 void run(const QJsonObject& decision,std::function<QString()> start){
  need(decision.value("action")=="run","每日计划当前不能运行");QLockFile lock(root+"/.daily.lock");need(lock.tryLock(0),"每日计划正在更新");auto path=slot(decision.value("date").toString());need(!QFileInfo::exists(path),"今日已尝试");need(QDir().mkpath(root+"/.daily"),"无法保存每日计划");
  auto claimed=decision;claimed["status"]="claimed";write(path,claimed);
  try{claimed["jobId"]=start();claimed["status"]="running";write(path,claimed);}catch(const std::exception& error){claimed["status"]="failed";claimed["error"]=QString::fromUtf8(error.what());write(path,claimed);throw;}
 }
 void finished(const QJsonObject& record){auto date=record.value("scheduleDate").toString();if(date.isEmpty())return;QLockFile lock(root+"/.daily.lock");need(lock.tryLock(1000),"每日状态正在更新");auto path=slot(date);auto previous=object(read(path,1024*1024));need(previous.value("jobId")==record.value("id"),"每日计划任务身份改变");previous["status"]=record.value("status");previous["error"]=record.value("error");previous["finishedAt"]=record.value("finishedAt");write(path,previous);}
 void allowRetry(const QDateTime& now,bool busy){need(!busy,"先结束当前任务");QLockFile running(root+"/.running.lock");need(running.tryLock(0),"另一窗口仍有任务，未重试");QLockFile lock(root+"/.daily.lock");need(lock.tryLock(1000),"每日状态正在更新");auto path=slot(now.toOffsetFromUtc(8*3600).date().toString(Qt::ISODate));if(!QFileInfo::exists(path))return;auto old=object(read(path,1024*1024));need(old.value("status")!="completed","今日已完成，未重复执行");auto backup=path+".attempt-"+QUuid::createUuid().toString(QUuid::WithoutBraces);need(QFile::rename(path,backup),"原失败记录未能保留，未重试");}
};
}
