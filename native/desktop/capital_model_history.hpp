#pragma once
#include "capital_workbench_model.hpp"
#include "dark_stock.hpp"
#include "dark_observation_legacy.hpp"
#include "dark_history_backfill.hpp"

namespace capitalWorkbench {
// Read original files only, off the UI thread. Never migrate or rewrite them.
inline QJsonArray savedModelHistory(const QString& directory,const QString& key,const QString& through,
                                   const darkObservation::Cancel& cancelled,QStringList& errors){
 QJsonArray out;
 auto append=[&](const QJsonObject& record,bool backfilled=false){const auto day=record["tradingDay"].toString();if(day>through)return;
  for(auto v:record["rows"].toArray()){darkLegacy::active(cancelled);auto row=v.toObject();if(row["key"]!=key)continue;
   auto at=QDateTime::fromString(row["receivedAt"].toString(),Qt::ISODateWithMs);if(!at.isValid())continue;
   out.append(QJsonObject{{"tradingDay",day},{"receivedAt",row["receivedAt"]},{"time",double(at.toMSecsSinceEpoch())},
    {"label",at.toOffsetFromUtc(28800).toString("MM-dd HH:mm:ss")},{"timeMeaning",backfilled?"source-day-history-response":"received-observation"},{"darkNet",yuan(row["darkNetCents"])},{"visibleNet",yuan(row["visibleNetCents"])}});
  }
 };
 for(const auto& path:QStringList{directory,darkHistory::directory(directory)})for(auto name:QDir(path).entryList({"????-??-??.json"},QDir::Files,QDir::Name)){
  darkLegacy::active(cancelled);if(name.left(10)>through)continue;
  try{append(darkStock::Store(path).read(name.left(10)),path!=directory);}catch(const std::exception& e){errors.append(name+"："+QString::fromUtf8(e.what()));}
 }
 const auto legacy=QFileInfo(directory).absoluteDir().filePath("legacy-archive/files/dark-stock-observations");
 for(auto name:QDir(legacy).entryList({"????-??-??.jsonl"},QDir::Files,QDir::Name)){
  darkLegacy::active(cancelled);if(name.left(10)>through)continue;
  try{auto bytes=darkLegacy::readFile(QDir(legacy).filePath(name),darkLegacy::Limit,cancelled);
   darkLegacy::need(bytes.endsWith('\n'),"原观察末尾不完整");QJsonArray fileRows;
   for(auto line:bytes.split('\n'))if(!line.trimmed().isEmpty())fileRows.append(darkLegacy::record(darkLegacy::parse(line),name));
   for(auto record:fileRows)append(record.toObject());
  }catch(const std::exception& e){errors.append(name+"："+QString::fromUtf8(e.what()));}
 }
 return out;
}
}
