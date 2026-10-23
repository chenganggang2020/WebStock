#pragma once
#include "industry_report_archive.hpp"
#include "unified_backup.hpp"
namespace industryArchive {
inline const QString domain="industry-report-archive";
inline const QString scope="明确选择的完整旧产业主题档案；保留原身份、版本链、配置和运行原件；不启动历史任务";
inline QJsonObject archivePayload(QString source){
 auto p=validate(source);legacyResearchJson::Value normalized;normalized.kind=legacyResearchJson::Value::Object;
 for(auto key:{"topics","evidence","versions","runs"}){QMap<QString,legacyResearchJson::Value> sorted;for(auto row:p.ordered.get(key)->values){QMap<QString,legacyResearchJson::Value> fields;for(int i=0;i<row.keys.size();i++)fields[row.keys[i]]=row.values[i];legacyResearchJson::Value envelope;envelope.kind=legacyResearchJson::Value::Object;for(auto it=fields.begin();it!=fields.end();++it){envelope.keys.append(it.key());envelope.values.append(it.value());}sorted[json(row).toObject()["id"].toString()]=envelope;}legacyResearchJson::Value array;array.kind=legacyResearchJson::Value::Array;for(auto row:sorted)array.values.append(row);normalized.keys.append(key);normalized.values.append(array);}source=legacyResearchJson::encode(normalized);
 QJsonObject out{{"schema",schema},{"source",source}};
 watchlistWorkspace::need(QJsonDocument(out).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"完整产业域超过8 MiB，未截断");return out;
}
inline QJsonObject archivePayload(QJsonObject p){
 watchlistBackup::keys(p,{"schema","source"});watchlistWorkspace::need(p["schema"]==schema&&p["source"].isString(),"产业原件域格式无效");return archivePayload(p["source"].toString());
}
inline QJsonObject recordObject(QJsonObject row){watchlistWorkspace::need(row["payload"].isString(),"原业务JSON缺失");auto text=row["payload"].toString();watchlistBackup::JsonGate{text}.run();auto d=QJsonDocument::fromJson(text.toUtf8());watchlistWorkspace::need(d.isObject()&&d.object()["id"]==row["id"],"原业务行和完整JSON身份不一致");return d.object();}
inline bool compatible(QJsonObject now,QJsonObject incoming,QString kind){
 if(now["id"]!=incoming["id"]||now["legacySource"]!=incoming["legacySource"])return false;
 if(kind=="topics")return !now.contains("legacyOriginal")||now["legacyOriginal"].toObject()["id"]==incoming["legacyOriginal"].toObject()["id"];
 if(now.contains("legacyOriginal")&&!watchlistWorkspace::equal(now["legacyOriginal"],incoming["legacyOriginal"]))return false;
 if(now["sourceUrl"]!=incoming["sourceUrl"])return false;
 try{return legacyResearchJson::encode(legacyResearchJson::Parser(now["text"].toString()).run())==legacyResearchJson::encode(legacyResearchJson::Parser(incoming["text"].toString()).run());}catch(...){return false;}
}
inline QString rowKey(QJsonObject r){return r["kind"].toString()+QChar(0)+r["id"].toString();}
inline void archiveReceipt(QJsonObject r,QString key){
 watchlistBackup::keys(r,{"schema","sourceKey","beforeBaseline","recordsHash","committedAt","historicalExecutionRestored","sha256"});unifiedBackup::sealed(r);
 watchlistWorkspace::need(r["schema"]=="native-industry-restore-receipt/v1"&&r["sourceKey"]==key&&r["historicalExecutionRestored"]==false,"产业回执身份/执行边界错误");
 for(auto field:{"sourceKey","beforeBaseline","recordsHash"})watchlistWorkspace::need(QRegularExpression("^[0-9a-f]{64}$").match(r[field].toString()).hasMatch(),"产业回执摘要格式错误");time(r["committedAt"],true);
}
inline QJsonObject state(QJsonArray records,QJsonObject receipts,bool table){
 return QJsonObject{{"schema","native-industry-restore-state/v1"},{"recordsHash",watchlistWorkspace::hash(records)},{"receipts",receipts},{"hasReceiptsTable",table}};
}
inline QJsonObject previewArchive(QJsonObject input,QJsonObject before){
 using namespace watchlistWorkspace;using namespace unifiedBackup;input=archivePayload(input);
 auto meta=before["restoreState"].toObject();need(meta["schema"]=="native-industry-restore-state/v1"&&before["baseline"]==hash(meta),"完整业务恢复基线无效");
 auto incoming=nativeRecords(validate(input["source"].toString()));QMap<QString,QJsonObject> rows;need(before["records"].isArray()&&meta["recordsHash"]==hash(before["records"]),"内部完整业务快照与摘要不符");for(auto v:before["records"].toArray()){auto r=v.toObject();recordObject(r);need(!rows.contains(rowKey(r)),"业务原身份重复");rows[rowKey(r)]=r;}
 auto source=hash(input);auto receipts=meta["receipts"].toObject();QJsonArray actions;bool duplicate=receipts.contains(source);
 for(auto value:incoming){auto item=value.toObject(),record=item["record"].toObject();auto id=record["id"].toString(),kind=item["kind"].toString();QJsonObject row{{"kind",kind},{"id",id},{"payload",QString::fromUtf8(QJsonDocument(record).toJson(QJsonDocument::Compact))}};auto key=rowKey(row);QString action;
  if(duplicate)action="duplicate-import";else if(!rows.contains(key)){action="insert";rows[key]=row;}else{need(compatible(recordObject(rows[key]),record,kind),"旧产业原身份冲突；完整关联主题未写入，保留当前");action="keep-current";}
  actions.append(QJsonObject{{"kind",kind},{"id",id},{"status",action}});
 }
 QJsonArray target;for(auto r:rows)target.append(r);need(QJsonDocument(target).toJson(QJsonDocument::Compact).size()<=32*1024*1024,"恢复后完整业务快照超过32 MiB，未截断");need(duplicate||receipts.size()<10000,"产业回执超限");
 auto plan=QJsonObject{{"schema","native-industry-restore-preview/v1"},{"incoming",input},{"expected",before["baseline"]},{"expectedRecordsHash",hash(target)},{"actions",actions},{"sourceKey",source},{"noChange",duplicate||incoming.isEmpty()}};if(meta.contains("receiptBytes"))plan["protectedBusinessReceiptBytes"]=meta["receiptBytes"].toObject()["business_restore_receipts"];return seal(plan);
}
inline bool archiveMatches(QJsonObject p,QJsonObject after){return p["expectedRecordsHash"]==after["restoreState"].toObject()["recordsHash"]&&(!p.contains("protectedBusinessReceiptBytes")||watchlistWorkspace::equal(p["protectedBusinessReceiptBytes"],after["restoreState"].toObject()["receiptBytes"].toObject()["business_restore_receipts"]));}
inline QJsonObject captureArchives(QJsonArray records,QStringList selected){
 using namespace watchlistWorkspace;need(selected.size()<=1000,"所选完整产业档案超过1000份");QSet<QString>wanted;for(auto id:selected){need(!wanted.contains(id),"完整档案选择重复");wanted.insert(id);}
 legacyResearchJson::Value out;out.kind=legacyResearchJson::Value::Object;
 for(auto k:{"topics","evidence","versions","runs"}){legacyResearchJson::Value a;a.kind=legacyResearchJson::Value::Array;out.keys.append(k);out.values.append(a);}
 QMap<QString,QMap<QString,legacyResearchJson::Value>> merged;
 for(auto value:records){auto row=value.toObject();if(row["kind"]!="reports"||!wanted.contains(row["id"].toString()))continue;auto r=recordObject(row);need(r["legacySource"]=="industry_research_archive","所选记录不是完整旧产业档案");auto p=validate(r["text"].toString());
  for(int i=0;i<4;i++){auto key=out.keys[i];for(auto v:p.ordered.get(key)->values){auto j=QJsonDocument::fromJson(legacyResearchJson::encode(v).toUtf8()).object();auto id=text(j,"id");need(!merged[key].contains(id)||legacyResearchJson::encode(merged[key][id])==legacyResearchJson::encode(v),"所选完整原件的同编号内容冲突");merged[key][id]=v;}}wanted.remove(row["id"].toString());
 }
 need(wanted.isEmpty(),"所选完整档案已删除，未替换成别的版本");for(int i=0;i<4;i++)for(auto v:merged[out.keys[i]])out.values[i].values.append(v);return archivePayload(legacyResearchJson::encode(out));
}
}

