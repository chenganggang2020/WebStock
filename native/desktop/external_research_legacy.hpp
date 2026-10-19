#pragma once
#include "external_research_batch.hpp"
namespace externalResearchBatch {
inline const QString legacyBundleSchema="webstock.legacy-external-research-batches/v1";
inline const QString legacyRecordSchema="native-external-research-legacy/v1";
inline bool legacyRecord(QJsonObject row){return row["legacyOriginal"].toObject()["schema"]==legacyRecordSchema;}
inline QJsonObject legacyValue(QJsonObject row){
 keys(row,{"id","batch_key","payload_hash","schema_version","source_system","task_id","run_id","revision","market_date","status","payload_json","webstock_run_id","webstock_status","tonghuashun_status","delivery_json","created_at","updated_at"});
 need(row.keys().size()==17,"旧批次17列不完整");
 integer(row["id"],"legacy id",1,1e12);integer(row["webstock_run_id"],"legacy run id",1,1e12);
 for(auto k:{"batch_key","payload_hash","schema_version","source_system","task_id","run_id","market_date","status","payload_json","webstock_status","tonghuashun_status","delivery_json","created_at","updated_at"})need(row[k].isString(),"旧批次字段类型改变："+QString(k));
 auto v=validate(row["payload_json"].toString()),n=v["normalized"].toObject(),s=n["source"].toObject();
 need(v["batchKey"]==row["batch_key"]&&v["payloadHash"]==row["payload_hash"]&&n["schema"]==row["schema_version"]&&
      s["system"]==row["source_system"]&&s["taskId"]==row["task_id"]&&s["runId"]==row["run_id"]&&
      n["revision"]==row["revision"]&&n["asOf"].toObject()["marketDate"]==row["market_date"],"旧SQL身份/摘要/日期与完整载荷不一致");
 need(QStringList{"completed","partial"}.contains(row["status"].toString())&&row["webstock_status"]=="succeeded"&&
      QStringList{"succeeded","failed","no-change","pending","not-requested"}.contains(row["tonghuashun_status"].toString()),"旧投递状态尚未审阅，未改写");
 for(auto k:{"created_at","updated_at"})need(!row[k].toString().isEmpty()&&row[k].toString().size()<=60,"旧创建/更新时间缺失");
 auto deliveryRaw=row["delivery_json"].toString();legacyResearchJson::Parser(deliveryRaw).run();auto delivery=QJsonDocument::fromJson(deliveryRaw.toUtf8());
 need(delivery.isObject(),"旧投递回执不是完整对象");
 need(delivery.object()["webstock"].toObject()["runId"]==row["webstock_run_id"],"旧投递回执运行ID不一致");
 v["legacySqlRow"]=row;v["historicalDelivery"]=delivery.object();
 v["linkedRunRecordId"]="legacy-research:"+legacyResearchJson::number(row["webstock_run_id"].toDouble());
 return v;
}
inline QJsonObject legacyBatchRow(QJsonObject v,QString runFingerprint,QString prepared){
 stamp(prepared);need(QRegularExpression("^[a-f0-9]{64}$").match(runFingerprint).hasMatch(),"旧关联运行指纹缺失");
 auto n=v["normalized"].toObject();
 QJsonObject meta{{"schema",legacyRecordSchema},{"sourceRow",v["legacySqlRow"]},{"preparedAt",prepared},
  {"linkedRunRecordId",v["linkedRunRecordId"]},{"linkedRunSourceFingerprint",runFingerprint},{"historicalExecutionRestored",false}};
 return {{"id",batchId(v)},{"title",n["asOf"].toObject()["marketDate"].toString()+" 旧外部研究批次 · 修订 "+legacyResearchJson::number(n["revision"].toDouble())},
  {"text",encode(n)},{"originalText",v["originalText"]},{"legacySource","external_research_batches"},
  {"legacyOriginal",meta},{"sourceFingerprint",researchRuns::fingerprint(meta)},{"verification","unverified"}};
}
inline QJsonObject legacyStored(QJsonObject row){
 auto meta=row["legacyOriginal"].toObject();keys(meta,{"schema","sourceRow","preparedAt","linkedRunRecordId","linkedRunSourceFingerprint","historicalExecutionRestored"});
 need(meta["schema"]==legacyRecordSchema&&meta["historicalExecutionRestored"].isBool()&&!meta["historicalExecutionRestored"].toBool(),"旧批次不能恢复执行或伪造新投递");
 auto v=legacyValue(meta["sourceRow"].toObject());need(v["linkedRunRecordId"]==meta["linkedRunRecordId"],"旧批次关联运行改变");
 auto expected=legacyBatchRow(v,meta["linkedRunSourceFingerprint"].toString(),meta["preparedAt"].toString());
 need(researchRuns::canonical(expected)==researchRuns::canonical(row),"旧批次原件或迁移元数据改变，未覆盖");return v;
}
inline void linkedLegacyRun(QJsonObject v,QJsonObject run){
 need(run["id"]==v["linkedRunRecordId"]&&run["legacySource"]=="ai_research_runs","原AI运行不在库，未新建替代运行");
 // Own the value: operator[] on a temporary QJsonObject would leave a dangling proxy.
 researchRuns::stored(run);const QJsonValue id=run.value("legacyOriginal").toObject().value("id");
 need(id==v["legacySqlRow"].toObject()["webstock_run_id"],"原AI运行SQL ID与旧批次不一致");
}
inline QString describeLegacy(QJsonObject v){
 auto row=v["legacySqlRow"].toObject();
 return "旧外部研究批次："+row["batch_key"].toString()+"\n关联已有运行："+v["linkedRunRecordId"].toString()+
  "\n原状态："+row["status"].toString()+" · 原本机投递："+row["webstock_status"].toString()+" · 原同花顺状态："+row["tonghuashun_status"].toString()+
  "\n旧投递回执只作历史记录；本次未执行请求/推送/交易，未复验云同步。\n创建/更新保留原字符串，不补时区："+row["created_at"].toString()+" / "+row["updated_at"].toString()+
  "\n\n完整旧SQL原行（含原payload_json及delivery_json）\n"+researchRuns::pretty(row)+"\n\n现有协议完整规范视图\n"+researchRuns::pretty(v["normalized"]);
}
inline QString describeLegacyPreview(QJsonObject p){
 return "旧外部研究批次完整预览："+QString::number(p["sourceRows"].toArray().size())+"份\n待新增 "+QString::number(p["insertCount"].toInt())+" · 冲突 "+QString::number(p["conflicts"].toInt())+
  "\n仅关联库中已有AI运行，不重复迁入运行。删除后已有迁移回执的原件不会复活。\n旧投递状态、日期及delivery_json原样保留；本次没有请求、推送、交易或云同步核验。\n\n逐份处理与完整原SQL字段\n"+
  researchRuns::pretty(p["actions"])+"\n\n本地来源匹配（未联网核实）\n"+researchRuns::pretty(p["sourceChecks"]);
}
}
