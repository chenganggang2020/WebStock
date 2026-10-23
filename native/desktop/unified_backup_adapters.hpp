#pragma once
#include "business_restore.hpp"
#include "unified_backup.hpp"
#include "sector_leader_model.hpp"
#include "local_candidate_model.hpp"
#include "recent_restore.hpp"
#include "sector_observation_restore.hpp"
namespace unifiedBackup {
using ReadObject=std::function<QJsonObject()>;
using Confirm=std::function<QJsonObject(QJsonObject)>;
using ReadRows=std::function<QJsonArray()>;
using ReadId=std::function<QJsonObject(QString)>;
inline void allowed(QJsonObject o,QStringList names){for(auto k:o.keys())need(names.contains(k),"未知字段需先明确非敏感归档契约；整域未导出");}
inline QJsonObject state(QJsonObject p,QString baseline={}){return {{"payload",p},{"baseline",baseline.isEmpty()?hash(p):baseline}};}
inline Adapter groups(ReadObject read={},Confirm save={}){
 Adapter a{"watchlist-config","自选分组配置","watchlist-workspace-backup/v1","完整分组配置；主自选身份仅核对，行情与目录不导入","需接入完整当前数据及保存时版本核对"};
 if(read)a.capture=[read]{auto s=read();return state(watchlistBackup::exportBackup(s),hash(management(s)));};
 if(read&&save){
  auto preview=[read](QJsonObject p,QJsonObject before){auto now=read();need(hash(management(now))==before["baseline"],"分组开始/当前基线变化");auto owner=watchlistBackup::previewImport(p,now,now);return QJsonObject{{"owner",owner},{"expected",before["baseline"]},{"noChange",owner["change"].toObject()["noChange"]}};};
  a.preview=preview;
  a.commit=[read,save,preview](QJsonObject p){auto now=read();auto before=state(watchlistBackup::exportBackup(now),hash(management(now)));need(equal(preview(p["owner"].toObject()["backup"].toObject(),before),p),"分组确认时基线/预览变化");auto draft=watchlistBackup::importDraft(now,p["owner"].toObject(),now);auto saved=receipt(now,draft,save(p["owner"].toObject()["change"].toObject()));return QJsonObject{{"revision",saved["revision"]},{"groupsHash",hash(saved["groups"])},{"mainIdsHash",hash(saved["mainIds"])}};};
  a.matches=[](QJsonObject p,QJsonObject s){auto c=s["payload"].toObject()["config"].toObject(),target=p["owner"].toObject()["change"].toObject();return equal(c["groups"],target["groups"])&&equal(c["mainIds"],target["mainIds"]);};
  a.verifyReceipt=[](QJsonObject,QJsonObject r,QJsonObject s){auto c=s["payload"].toObject()["config"].toObject();return r["revision"]==c["revision"]&&r["groupsHash"]==hash(c["groups"])&&r["mainIdsHash"]==hash(c["mainIds"]);};
  a.reason="条件恢复：主自选和只读来源必须相符；保留原生限制";
 }return a;
}
inline void leaderConfig(QJsonObject c){
 sectorLeader::validate(c);watchlistBackup::keys(c,{"schema","revision","updatedAt","sectors"});need(c["updatedAt"].isNull()||c["updatedAt"].isString(),"人工配置更新时间无效");if(c["updatedAt"].isString())time(c["updatedAt"].toString());
 for(auto v:c["sectors"].toArray()){auto b=v.toObject();allowed(b,{"id","name","description","sortOrder","leaders"});for(auto r:b["leaders"].toArray())allowed(r.toObject(),{"id","sectorId","code","name","fullId","identityState","role","reason","weight","note"});}
 sensitive(c);
}
inline Adapter leaders(ReadObject read={},Confirm confirm={}){
 Adapter a{"manual-leader-config","人工龙头配置（合并）",sectorLeader::schema,"人工板块/候选配置；合并新增，同项保留当前；不含观察历史","需接入配置读取及原有的确认合并入口",2*1024*1024};
 if(read)a.capture=[read]{auto c=read();leaderConfig(c);return state(c);};
 if(read&&confirm){
  auto preview=[read](QJsonObject payload,QJsonObject before){leaderConfig(payload);auto current=read();leaderConfig(current);need(hash(current)==before["baseline"],"人工配置基线变化");auto owner=sectorLeader::preview(QJsonDocument(payload).toJson(QJsonDocument::Compact),current);return QJsonObject{{"incoming",payload},{"owner",owner},{"expected",before["baseline"]},{"noChange",equal(owner["config"].toObject()["sectors"],current["sectors"])}};};
  a.preview=preview;
  a.commit=[read,confirm,preview](QJsonObject p){auto current=read();need(equal(preview(p["incoming"].toObject(),state(current)),p),"人工配置确认时基线/预览变化");auto owner=p["owner"].toObject(),saved=confirm(owner);leaderConfig(saved);need(saved["revision"].toDouble()==current["revision"].toDouble()+1&&equal(saved["sectors"],owner["config"].toObject()["sectors"]),"原生合并回执未确认；可能已导入或标记冲突，禁止重试");return QJsonObject{{"revision",saved["revision"]},{"sectorsHash",hash(saved["sectors"])},{"digest",owner["digest"]}};};
  a.matches=[](QJsonObject p,QJsonObject s){return equal(p["owner"].toObject()["config"].toObject()["sectors"],s["payload"].toObject()["sectors"]);};
  a.verifyReceipt=[](QJsonObject p,QJsonObject r,QJsonObject s){auto c=s["payload"].toObject();return r["revision"]==c["revision"]&&r["sectorsHash"]==hash(c["sectors"])&&r["digest"]==p["owner"].toObject()["digest"];};
  a.reason="只合并新增；冲突保留当前；既有导入标记可能阻止重新合并，失败明确报告";
 }return a;
}
inline Adapter recent(ReadRows read={}){
 Adapter a{"recent-entries","最近查看条目（仅归档）","native-recent-entries-archive/v1","全部原生最近查看条目；不含导入标记；仅归档不可恢复","缺保留原身份、时点和来源的恢复入口，以及保存时版本核对、预览和回执"};
 if(read)a.capture=[read]{auto rows=read();need(rows.size()<=10000,"最近查看超过10000，未截断");QSet<QString> seen;for(auto v:rows){need(v.isObject(),"最近查看行无效");auto r=v.toObject();allowed(r,{"id","guessedId","code","name","symbol","lastViewedAt","createdAt","viewCount","quote","origin","canOpen","identityNote"});auto id=text(r,"id");need(!id.isEmpty()&&!seen.contains(id),"最近查看身份缺失或重复");seen.insert(id);for(auto k:{"code","name","symbol","origin","lastViewedAt","createdAt"})text(r,k);time(text(r,"lastViewedAt"));time(text(r,"createdAt"));need(r["canOpen"].isBool()&&r["quote"].isObject()&&r["viewCount"].isDouble()&&r["viewCount"].toDouble()>=1&&r["viewCount"].toDouble()<=2147483647&&r["viewCount"].toDouble()==r["viewCount"].toInteger(),"最近查看字段无效");allowed(r["quote"].toObject(),{"price","changePercent","tradeDate","tradeTime","checkedAt","source","cached","error"});}
 return state({{"schema","native-recent-entries-archive/v1"},{"entries",rows}});};return a;
}
inline Adapter restorableRecent(ReadObject read,std::function<QJsonObject(QJsonObject,QJsonObject)> preview,Confirm commit,std::function<bool(QJsonObject,QJsonObject,QJsonObject)> verify){
 Adapter a{"recent-entries","最近查看条目（保留原字段合并）",::recentRestore::archive,::recentRestore::scope,"只插入缺失原ID，同项冲突保留当前；确认时核对完整基线并保存独立回执"};
 a.sourceScopeAliases={::recentRestore::legacyScope};a.capture=std::move(read);a.preview=std::move(preview);a.commit=std::move(commit);a.matches=[](QJsonObject p,QJsonObject s){return ::recentRestore::matches(p,s);};a.verifyReceipt=std::move(verify);return a;
}
inline Adapter candidates(QJsonArray selected={},ReadId read={}){
 Adapter a{"candidate-selection","已选冻结候选结果（仅归档）",localCandidate::version,"仅明确选择的冻结结果ID；不含草稿/导出槽；仅归档不可恢复","缺保留原结果身份的导入、预览、版本核对及可防止重复导入的回执"};
 if(read&&!selected.isEmpty())a.capture=[selected,read]{need(selected.size()<=100,"冻结结果最多100个明确ID");QSet<QString>seen;QJsonArray rows;for(auto v:selected){need(v.isString()&&!v.toString().isEmpty()&&!seen.contains(v.toString()),"冻结结果身份缺失/重复");seen.insert(v.toString());auto r=read(v.toString());watchlistBackup::keys(r,{"id","title","savedAt","result"});need(r["id"]==v&&!text(r,"title").trimmed().isEmpty()&&r["result"].isObject(),"冻结结果读取不完整");time(text(r,"savedAt"));localCandidate::verify(r["result"].toObject());rows.append(r);}return state({{"schema","native-candidate-selection-archive/v1"},{"selectedIds",selected},{"records",rows}});};
 return a;
}
inline Adapter business(){return {"business-seven","业务七类（未开放）","native-business-v1","账户、交易、资料、报告、主题、关系、采集","原始字段尚未确认可安全备份；关联记录预览、保存时版本核对和提交回执仍缺失；导出与恢复均禁用"};}
inline Adapter business(ReadObject read,std::function<QJsonObject(QJsonObject,QJsonObject)> preview,Confirm commit,std::function<bool(QJsonObject,QJsonObject,QJsonObject)> verify){
 Adapter a{"business-seven","本机业务七类（保留完整原记录）",::businessRestore::archive,::businessRestore::scope,"只插入缺失原ID；冲突/人工历史保留本机，显式关联须闭合；活动任务/媒体/凭据或未审阅字段整域拒绝"};
 a.capture=std::move(read);a.preview=std::move(preview);a.commit=std::move(commit);a.verifyReceipt=std::move(verify);a.matches=[](QJsonObject p,QJsonObject after){return ::businessRestore::matches(p,after);};return a;
}
inline Adapter observations(ReadObject read={},std::function<QJsonObject(QJsonObject,QJsonObject)> preview={},Confirm commit={},std::function<bool(QJsonObject,QJsonObject,QJsonObject)> verify={}){
 Adapter a{"manual-leader-observations","人工龙头观察历史（原版本合并）",::observationRestore::archive,::observationRestore::scope,"含原配置合并；仅新增原观察ID，确认时完整CAS，原版本与回执同库事务保留",8*1024*1024};
 a.capture=std::move(read);a.preview=std::move(preview);a.commit=std::move(commit);a.matches=[](QJsonObject p,QJsonObject s){return ::observationRestore::matches(p,s);};a.verifyReceipt=std::move(verify);return a;
}
}
