#pragma once
#include "dark_stock.hpp"
#include "trading_day_selection.hpp"
#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QLockFile>
#include <QSaveFile>
#include <QThread>
#include <stdexcept>

namespace darkHistory {
using Cancel=std::function<bool()>;
using Fetch=std::function<QJsonObject(const QString&,const Cancel&)>;
inline QString directory(const QString& current){return QFileInfo(current).absoluteDir().filePath("dark-stocks-history-v1");}
// One complete date is the commit unit. Current snapshots and imported observations
// are never overwritten. A receipt is not a successful market-data snapshot.
inline QJsonObject backfill(const QString& current,QDate first,QDate last,const Cancel& cancelled={},
 const std::function<void(QString)>& progress={},Fetch get={},int pauseMs=1500){
 auto need=[](bool ok,const char* message){if(!ok)throw std::runtime_error(message);};
 need(first.isValid()&&last.isValid()&&first<=last&&first.daysTo(last)<=366,"历史范围须为有效日期，最多366天");
 need(last<=QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date(),"不请求未来日期");
 QJsonObject receipt{{"schema","native-dark-history-backfill/v1"},{"from",first.toString(Qt::ISODate)},{"through",last.toString(Qt::ISODate)},
  {"startedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"classification","provider-model-estimate"},{"saved",0},{"preserved",0},{"failed",0},{"skippedClosed",0},{"cancelled",false}};
 if(cancelled&&cancelled()){receipt["cancelled"]=true;return receipt;}
 need(QDir().mkpath(current)&&QDir().mkpath(directory(current)),"无法建立隔离历史目录");
 QLockFile lock(current+"/scan.lock");lock.setStaleLockTime(0);need(lock.tryLock(0),"明暗榜已有扫描任务；请等待或取消后重试");
 darkStock::Store originals(current),history(directory(current));
 if(!get)get=[](const QString& date,const Cancel& cancel){return darkStock::fetch(date,cancel);};
 QJsonArray dates;int failures=0;
 for(auto day=last;day>=first;day=day.addDays(-1)){
  if(cancelled&&cancelled()){receipt["cancelled"]=true;break;}
  const auto open=tradingDaySelection::open(day);
  if(day.dayOfWeek()>5||(open.has_value()&&!*open)){
   dates.append(QJsonObject{{"date",day.toString(Qt::ISODate)},{"state","skipped-closed"}});
   receipt["skippedClosed"]=receipt["skippedClosed"].toInt()+1;
   continue; // Known closures do not consume source failure budget. Unknown years are not guessed.
  }
  const auto date=day.toString(Qt::ISODate);QJsonObject item{{"date",date}};bool fetched=false;
  try{
   if(!history.read(date).isEmpty()||!originals.read(date).isEmpty()){
    item["state"]="preserved-existing";receipt["preserved"]=receipt["preserved"].toInt()+1;failures=0;
   }else{
    if(progress)progress("正在回补 "+date+" · 逐页核验；不保存半榜");
    auto snapshot=get(date,cancelled);fetched=true;darkStock::validate(snapshot);
    need(snapshot["tradingDay"]==date,"来源返回日期不匹配；不保存");
    for(auto v:snapshot["rows"].toArray())need(v.toObject()["reconciled"]==true,"历史金额缺失或对账失败；不保存该日");
    history.save(snapshot,cancelled);item["state"]="fetched-validated-saved";item["coverage"]=snapshot["coverage"];item["receivedAt"]=snapshot["receivedAt"];
    receipt["saved"]=receipt["saved"].toInt()+1;failures=0;
   }
  }catch(const std::exception& e){
   const auto error=QString::fromUtf8(e.what());const bool unavailable=error.startsWith(QStringLiteral("来源未提供该交易日明暗盘记录"));
   item["state"]=(cancelled&&cancelled())?"cancelled":unavailable?"unavailable":"failed";item["error"]=error;
   if(cancelled&&cancelled())receipt["cancelled"]=true;else {receipt["failed"]=receipt["failed"].toInt()+1;failures=unavailable?0:failures+1;}
  }
  dates.append(item);receipt["dates"]=dates;receipt["lastCheckedAt"]=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
  QSaveFile file(directory(current)+"/backfill-receipt.json");need(file.open(QIODevice::WriteOnly),"无法写入回补回执");const auto bytes=QJsonDocument(receipt).toJson();need(file.write(bytes)==bytes.size()&&file.commit(),"回补回执提交失败");
  if(progress)progress(QString("历史回补：新增 %1 天，保留 %2 天，未取得 %3 天 · %4").arg(receipt["saved"].toInt()).arg(receipt["preserved"].toInt()).arg(receipt["failed"].toInt()).arg(date));
  if(receipt["cancelled"].toBool())break;
  if(failures>=3){receipt["stoppedReason"]="连续三天未取得，暂停请求；可缩小范围重试，未判定更早日期均不可用";break;}
  if(fetched||failures)for(int elapsed=0;elapsed<pauseMs;elapsed+=25){if(cancelled&&cancelled())break;QThread::msleep(25);}
 }
 receipt["dates"]=dates;receipt["finishedAt"]=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
 QSaveFile finalFile(directory(current)+"/backfill-receipt.json");need(finalFile.open(QIODevice::WriteOnly),"无法写入最终回补回执");const auto finalBytes=QJsonDocument(receipt).toJson();need(finalFile.write(finalBytes)==finalBytes.size()&&finalFile.commit(),"最终回补回执提交失败");
 return receipt;
}
}
