#pragma once
#include "unified_backup.hpp"
#include <algorithm>
#include <cmath>

namespace recentRestore {
using namespace unifiedBackup;
inline const QString archive="native-recent-entries-archive/v1", previewSchema="native-recent-restore-preview/v1", receiptSchema="native-recent-restore-receipt/v1";
inline const QString scope="全部原生最近查看条目；保留原ID、来源与时刻，仅合并新增，不恢复旧导入标记";
inline const QString legacyScope="全部原生最近查看条目；不含导入标记；仅归档不可恢复";
inline void digest(QString s){need(QRegularExpression("^[0-9a-f]{64}$").match(s).hasMatch(),"最近查看摘要无效");}
inline void stamp(QString s){
 need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch(),"原记录需完整带时区时刻；未推导或改写");
 need(s.left(4).toInt()>0&&s.mid(11,2).toInt()<24&&s.mid(14,2).toInt()<60&&s.mid(17,2).toInt()<60,"原记录日期/时刻无效");
 auto check=s;auto m=QRegularExpression("\\.([0-9]{1,9})(Z|[+-])").match(s);if(m.hasMatch())check.replace(m.capturedStart(1),m.capturedLength(1),m.captured(1).left(3));
 time(check);if(!s.endsWith('Z')){auto z=s.right(6);int h=z.mid(1,2).toInt(),min=z.right(2).toInt();need(h<=18&&min<60&&(h<18||min==0),"原时区无效");}
}
inline void row(QJsonObject r){
 static const QStringList allowed{"id","guessedId","code","name","symbol","lastViewedAt","createdAt","viewCount","quote","origin","canOpen","identityNote"};
 for(auto k:r.keys())need(allowed.contains(k),"最近记录未知字段，整批未恢复");
 auto id=text(r,"id"),code=text(r,"code"),symbol=text(r,"symbol"),name=text(r,"name");
 need(!name.trimmed().isEmpty()&&name.size()<=128&&QRegularExpression("^[0-9]{6}$").match(code).hasMatch(),"原名称/代码无效");
 auto full=[](QString v){return QRegularExpression("^(SH|SZ|BJ):(stock|index|etf):[0-9]{6}$").match(v).hasMatch();};
 need(r["canOpen"].isBool(),"原身份状态缺失");
 if(id.startsWith("legacy:ambiguous:")){auto guessed=text(r,"guessedId");need(id=="legacy:ambiguous:"+code&&full(guessed)&&guessed.section(':',2)==code&&!r["canOpen"].toBool()&&symbol.isEmpty(),"旧歧义身份必须保持隔离，未绑定证券");}
 else{need(full(id)&&id.section(':',2)==code&&symbol==id.section(':',0,0).toLower()+code,"原市场/类型/代码/报价身份不一致");if(r.contains("guessedId")&&!r["guessedId"].isNull())need(text(r,"guessedId")==id,"原推导身份与明确ID冲突");}
 text(r,"origin");stamp(text(r,"createdAt"));stamp(text(r,"lastViewedAt"));
 auto count=r["viewCount"];need(count.isDouble()&&std::isfinite(count.toDouble())&&count.toDouble()>=1&&count.toDouble()<=2147483647&&std::floor(count.toDouble())==count.toDouble(),"原查看次数无效");
 if(r.contains("identityNote"))need(r["identityNote"].isString()||r["identityNote"].isNull(),"原身份说明无效");
 need(r["quote"].isObject(),"原报价结构缺失");auto q=r["quote"].toObject();
 static const QStringList qkeys{"price","changePercent","tradeDate","tradeTime","checkedAt","source","cached","error"};
 for(auto k:q.keys()){need(qkeys.contains(k),"原报价未知字段，未静默删除");auto v=q[k];if(v.isNull())continue;
  if(k=="price"||k=="changePercent")need(v.isDouble()&&std::isfinite(v.toDouble())&&(k!="price"||v.toDouble()>0),"原报价数值无效");
  else if(k=="cached")need(v.isBool(),"原报价状态无效");else{need(v.isString(),"原报价来源/时点字段无效");if(k=="checkedAt"&&!v.toString().isEmpty())stamp(v.toString());}}
 sensitive(r);
}
inline QJsonArray rows(QJsonArray input){
 need(input.size()<=10000,"最近记录超过10000条，未截断");QSet<QString>seen;QVector<QJsonObject>sorted;
 for(auto v:input){need(v.isObject(),"最近记录必须为对象");auto r=v.toObject();row(r);need(!seen.contains(text(r,"id")),"原ID重复，整批未恢复");seen.insert(text(r,"id"));sorted.append(r);}
 std::sort(sorted.begin(),sorted.end(),[](const auto&a,const auto&b){return text(a,"id")<text(b,"id");});QJsonArray out;for(auto r:sorted)out.append(r);return out;
}
inline QJsonObject payload(QJsonArray input){QJsonObject p{{"schema",archive},{"entries",rows(input)}};need(QJsonDocument(p).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"最近域超过8 MiB，未截断");return p;}
inline QJsonObject validatePayload(QJsonObject p){watchlistBackup::keys(p,{"schema","entries"});need(p["schema"]==archive&&p["entries"].isArray(),"最近档案格式无效");return payload(p["entries"].toArray());}
inline void summary(QJsonObject s){watchlistBackup::keys(s,{"count","sha256"});digest(text(s,"sha256"));auto n=s["count"];need(n.isDouble()&&n.toDouble()>=0&&std::floor(n.toDouble())==n.toDouble()&&n.toDouble()<=2147483647,"最近库标记数量无效");}
inline QJsonObject snapshot(QJsonArray values,QJsonObject imports,QJsonObject receipts,bool hasReceipts){
 summary(imports);summary(receipts);auto p=payload(values);QJsonObject meta{{"schema","native-recent-restore-state/v1"},{"rowsHash",hash(p)},{"legacyImports",imports},{"restoreReceipts",receipts},{"hasReceiptsTable",hasReceipts}};
 return {{"payload",p},{"restoreState",meta},{"baseline",hash(meta)}};
}
inline void snapshotValid(QJsonObject s){
 watchlistBackup::keys(s,{"payload","restoreState","baseline"});auto p=validatePayload(s["payload"].toObject()),m=s["restoreState"].toObject();
 watchlistBackup::keys(m,{"schema","rowsHash","legacyImports","restoreReceipts","hasReceiptsTable"});need(m["schema"]=="native-recent-restore-state/v1"&&m["hasReceiptsTable"].isBool(),"最近库完整快照缺失");summary(m["legacyImports"].toObject());summary(m["restoreReceipts"].toObject());need(m["rowsHash"]==hash(p)&&s["baseline"]==hash(m),"最近库快照校验不符");
}
inline void idList(QJsonArray ids,QSet<QString>&seen){for(auto v:ids){need(v.isString()&&(QRegularExpression("^(SH|SZ|BJ):(stock|index|etf):[0-9]{6}$").match(v.toString()).hasMatch()||QRegularExpression("^legacy:ambiguous:[0-9]{6}$").match(v.toString()).hasMatch())&&!seen.contains(v.toString()),"恢复回执ID无效或重复");seen.insert(v.toString());}need(seen.size()<=10000,"恢复回执身份过多");}
inline void receiptValid(QJsonObject r){
 watchlistBackup::keys(r,{"schema","sourceKey","committedAt","beforeBaseline","expectedRowsHash","legacyImports","insertedIds","equalIds","conflictIds","atomicWithinRecent","sha256"});sealed(r);
 need(r["schema"]==receiptSchema&&r["atomicWithinRecent"]==true,"最近恢复回执格式无效");for(auto k:{"sourceKey","beforeBaseline","expectedRowsHash"})digest(text(r,k));stamp(text(r,"committedAt"));summary(r["legacyImports"].toObject());QSet<QString>seen;
 for(auto k:{"insertedIds","equalIds","conflictIds"}){need(r[k].isArray(),"回执身份列表缺失");idList(r[k].toArray(),seen);}need(QJsonDocument(r).toJson(QJsonDocument::Compact).size()<=1024*1024,"单次恢复回执超过1 MiB，未截断");
}
inline QJsonObject preview(QJsonObject input,QJsonObject before,QJsonObject previous={}){
 snapshotValid(before);auto incoming=validatePayload(input),current=before["payload"].toObject(),meta=before["restoreState"].toObject();QString key=hash(incoming);QMap<QString,QJsonObject>existing,merged;
 for(auto v:current["entries"].toArray())existing[text(v.toObject(),"id")]=v.toObject();merged=existing;QJsonArray actions;
 if(!previous.isEmpty()){receiptValid(previous);need(previous["sourceKey"]==key,"恢复回执不属于所选档案");}
 for(auto v:incoming["entries"].toArray()){auto r=v.toObject();auto id=text(r,"id");QString status;
  if(!previous.isEmpty())status="duplicate-import";else if(!existing.contains(id)){status="insert";merged[id]=r;}else status=equal(existing[id],r)?"equal":"conflict";
  actions.append(QJsonObject{{"id",id},{"status",status}});}
 need(merged.size()<=10000,"恢复后超过10000条，整批未恢复");if(previous.isEmpty())need(meta["restoreReceipts"].toObject()["count"].toDouble()<10000,"恢复回执已达10000次上限，未写入");QJsonArray target;for(auto r:merged)target.append(r);
 return seal({{"schema",previewSchema},{"incoming",incoming},{"expected",before["baseline"]},{"beforeRowsHash",meta["rowsHash"]},{"expectedRowsHash",hash(payload(target))},{"legacyImports",meta["legacyImports"]},{"restoreReceipts",meta["restoreReceipts"]},{"actions",actions},{"previousReceipt",previous.isEmpty()?QJsonValue(QJsonValue::Null):QJsonValue(previous)},{"noChange",!previous.isEmpty()}});
}
inline void previewValid(QJsonObject p){
 watchlistBackup::keys(p,{"schema","incoming","expected","beforeRowsHash","expectedRowsHash","legacyImports","restoreReceipts","actions","previousReceipt","noChange","sha256"});sealed(p);need(p["schema"]==previewSchema&&p["noChange"].isBool()&&p["actions"].isArray(),"恢复预览无效");validatePayload(p["incoming"].toObject());for(auto k:{"expected","beforeRowsHash","expectedRowsHash"})digest(text(p,k));summary(p["legacyImports"].toObject());summary(p["restoreReceipts"].toObject());if(!p["previousReceipt"].isNull())receiptValid(p["previousReceipt"].toObject());
}
inline QJsonObject receipt(QJsonObject p,QString when){
 previewValid(p);need(!p["noChange"].toBool(),"重复导入只重读原回执，未写入");stamp(when);QJsonArray added,same,conflicts;
 for(auto v:p["actions"].toArray()){auto a=v.toObject();if(a["status"]=="insert")added.append(a["id"]);else if(a["status"]=="equal")same.append(a["id"]);else if(a["status"]=="conflict")conflicts.append(a["id"]);else need(false,"恢复预览动作无效");}
 auto r=seal({{"schema",receiptSchema},{"sourceKey",hash(p["incoming"])},{"committedAt",when},{"beforeBaseline",p["expected"]},{"expectedRowsHash",p["expectedRowsHash"]},{"legacyImports",p["legacyImports"]},{"insertedIds",added},{"equalIds",same},{"conflictIds",conflicts},{"atomicWithinRecent",true}});receiptValid(r);return r;
}
inline bool matches(QJsonObject p,QJsonObject after){
 previewValid(p);snapshotValid(after);auto m=after["restoreState"].toObject();return m["rowsHash"]==p["expectedRowsHash"]&&equal(m["legacyImports"],p["legacyImports"])&&m["restoreReceipts"].toObject()["count"].toDouble()==p["restoreReceipts"].toObject()["count"].toDouble()+(p["noChange"].toBool()?0:1);
}
inline bool verify(QJsonObject p,QJsonObject r,QJsonObject after,QJsonObject saved){receiptValid(r);receiptValid(saved);return matches(p,after)&&equal(r,saved)&&r["beforeBaseline"]==p["expected"]&&r["sourceKey"]==hash(p["incoming"])&&r["expectedRowsHash"]==p["expectedRowsHash"]&&equal(r["legacyImports"],p["legacyImports"]);}
inline QString value(QJsonObject o,QString k){if(!o.contains(k))return "未保存";auto v=o[k];if(v.isNull())return "未知";if(v.isString())return v.toString().isEmpty()?"原值为空":v.toString();if(v.isBool())return v.toBool()?"是":"否";return QString::fromUtf8(QJsonDocument(QJsonArray{v}).toJson(QJsonDocument::Compact)).mid(1).chopped(1);}
inline QString describeRow(QJsonObject r){
 auto q=r["quote"].toObject();QString out="名称："+value(r,"name")+"\n原ID："+value(r,"id")+"\n代码 / 原报价身份："+value(r,"code")+" / "+value(r,"symbol")+"\n原推导身份："+value(r,"guessedId")+"\n允许打开："+value(r,"canOpen")+"\n身份说明："+value(r,"identityNote")+"\n原来源："+value(r,"origin")+"\n首次查看原时刻："+value(r,"createdAt")+"\n最近查看原时刻："+value(r,"lastViewedAt")+"\n原查看次数："+value(r,"viewCount")+"\n原保存报价："+value(q,"price")+"\n原涨跌幅："+value(q,"changePercent")+"\n原报价日期 / 时刻："+value(q,"tradeDate")+" / "+value(q,"tradeTime")+"\n原取得时刻："+value(q,"checkedAt")+"\n原报价来源："+value(q,"source")+"\n原缓存状态："+value(q,"cached")+"\n原错误："+value(q,"error")+"\n留存字段只读回看；没有生成行情或新的查看时刻。\n";return out;
}
inline QString describePreview(QJsonObject p,QJsonObject current){
 previewValid(p);QMap<QString,QJsonObject>old;for(auto v:current["entries"].toArray())old[text(v.toObject(),"id")]=v.toObject();QMap<QString,QString>states;for(auto v:p["actions"].toArray())states[text(v.toObject(),"id")]=text(v.toObject(),"status");
 QString out="\n最近查看恢复：保留原身份、来源、时刻和报价；只插入缺失ID。\n";if(p["noChange"].toBool())out+="该档案已有恢复回执；只重读原结果，不复活其后删除的条目。\n原恢复时刻："+p["previousReceipt"].toObject()["committedAt"].toString()+"\n";else out+="首次确认将同事务保存恢复回执；无新增或仅冲突也保存一次回执。\n";
 const QMap<QString,QString>labels{{"insert","新增原记录"},{"equal","同值，保留当前"},{"conflict","同ID冲突，保留当前"},{"duplicate-import","已处理档案，重读原回执"}};
 for(auto v:p["incoming"].toObject()["entries"].toArray()){auto r=v.toObject();out+="\n处理："+labels.value(states[text(r,"id")])+"\n备份原记录：\n"+describeRow(r);if(states[text(r,"id")]=="conflict")out+="当前保留记录：\n"+describeRow(old[text(r,"id")]);}return out;
}
inline QString describeReceipt(QJsonObject r){receiptValid(r);return "\n最近恢复回执："+text(r,"sourceKey")+"\n真实提交时刻："+text(r,"committedAt")+QString("\n新增 %1 / 同值保留 %2 / 冲突保留 %3\n").arg(r["insertedIds"].toArray().size()).arg(r["equalIds"].toArray().size()).arg(r["conflictIds"].toArray().size())+"原记录字段未改写，旧导入标记保留；本最近库内事务提交。\n";}
inline QString describeOperationRow(QJsonObject r){if(r["id"]!="recent-entries"||r["preview"].toObject()["schema"]!=previewSchema)return {};auto p=r["preview"].toObject();auto out=describePreview(p,r["before"].toObject()["payload"].toObject());auto rec=r["receipt"].toObject();if(rec.isEmpty())rec=p["previousReceipt"].toObject();if(!rec.isEmpty())out+=describeReceipt(rec);return out;}
}
