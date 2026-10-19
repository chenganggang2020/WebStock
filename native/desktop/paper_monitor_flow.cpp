#include "paper_monitor_flow.hpp"
#include "paper_monitor_legacy.hpp"
#include "paper_monitor_host_adapter.hpp"
#include "paper_session_provider.hpp"
#include "portfolio_mirror_model.hpp"
#include "business_store.hpp"
#include "paper_automation_source.hpp"
namespace paperHost {
namespace {
void need(bool ok,const char*msg){if(!ok)throw std::runtime_error(msg);}
QJsonObject emptyDraft(){return {{"schema","native-paper-monitor-draft/v1"},{"revision",0},{"state",QJsonObject{{"selectedAccount",""},{"drafts",QJsonObject{}}}}};}
QJsonObject validDraft(QJsonObject a){
 need(a.size()==3&&a.value("schema")=="native-paper-monitor-draft/v1"&&a.value("revision").isDouble()&&a.value("revision").toDouble()>=0&&a.value("revision").toDouble()<=1e9&&std::floor(a.value("revision").toDouble())==a.value("revision").toDouble()&&a.value("state").isObject(),"草稿格式无效");
 auto state=a.value("state").toObject();need(state.size()==2&&state.value("selectedAccount").isString()&&state.value("selectedAccount").toString().size()<=200&&state.value("drafts").isObject()&&state.value("drafts").toObject().size()<=20,"草稿账户范围无效");
 for(auto value:state.value("drafts").toObject()){
  need(value.isObject(),"草稿正文无效");auto r=value.toObject();need(r.size()==3&&r.value("response").isString()&&r.value("response").toString().toUtf8().size()<=250000&&r.value("evidence").isObject()&&r.value("result").isObject(),"草稿正文无效");
 }
 need(QJsonDocument(a).toJson(QJsonDocument::Compact).size()<=16*1024*1024,"完整草稿超过16MiB，未截断");return a;
}
QString prompt(QJsonObject p){return "人工纸面分析，未调用在线AI。只基于下面冻结证据，返回且仅返回六字段JSON：asOf、marketView、cashTargetPercent、orders、portfolioRisk、nextReviewAt。asOf必须为 "+p.value("preparedAt").toString()+"；marketView为bullish/bearish/neutral；orders仅可使用证据内已持有代码，每项字段为code、action(buy/sell/hold)、targetPositionPercent、confidence、reason、invalidation。遵守账户单股上限和总权重约束，缺证据应说明。此答复不执行交易。\n\n"+QString::fromUtf8(QJsonDocument(p).toJson(QJsonDocument::Indented));}
}
Flow::Flow(Host h,QString dir,QString ev):host(std::move(h)),directory(std::move(dir)),evidence(std::move(ev)),archive(directory+"/paper-monitor-history.json"),policy(settingsPath()){
 need(bool(host.read)&&bool(host.now),"缺少只读宿主接口");baseline=loadDraft();draft=baseline.value("state").toObject();
}
QString Flow::automationPath()const{return directory+"/paper-execution-v1.sqlite";}
QJsonObject Flow::automationSnapshot(){mustRun();auto e=host.read();auto i=input(e,false);auto roster=e["host"].toObject()["instruments"].toArray();auto quotes=i["quotes"].toObject();for(auto v:roster){auto r=v.toObject();auto id=r["id"].toString();if(quotes.contains(id)){auto q=quotes[id].toObject();q["name"]=r["name"];quotes[id]=q;}}i["quotes"]=quotes;return {{"input",i},{"markets",paperAutomation::minutes(roster,e["cut"].toString())}};}
QString Flow::settingsPath()const{return directory+"/paper-monitor-settings.json";}
QString Flow::now()const{return host.now();}
QJsonObject Flow::loadDraft()const{QFile f(directory+"/paper-monitor-draft.json");if(!f.exists())return emptyDraft();need(f.open(QIODevice::ReadOnly)&&f.size()<=16*1024*1024,"草稿不可读，原文件保留");return validDraft(portfolioMirror::parse(f.readAll()));}
void Flow::persist(bool verifyCurrent){
 need(writable,"草稿冲突或保存失败，内存文字保留；请先重开核对");
 if(!verifyCurrent&&baseline.value("state")==draft)return;
 try{
  need(QDir().mkpath(directory),"私有目录不可用");QLockFile lock(directory+"/paper-monitor-draft.json.lock");need(lock.tryLock(100),"草稿正在被另一入口保存");
  auto current=loadDraft();need(current==baseline,"草稿已在另一入口改变，未覆盖");
  if(current.value("state")==draft)return;
  auto next=current;next["state"]=draft;next["revision"]=current.value("revision").toDouble()+1;validDraft(next);
  auto bytes=QJsonDocument(next).toJson(QJsonDocument::Compact);QSaveFile file(directory+"/paper-monitor-draft.json");
  need(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"完整草稿保存失败");need(loadDraft()==next,"草稿重读不一致");baseline=next;
 }catch(...){writable=false;throw;}
}
void Flow::invalidate(){prepared={};previewed={};archiveRevision=-1;}
void Flow::mustRun()const{need(active&&writable,"页面不在前台或草稿不可写");need(!draft.value("selectedAccount").toString().isEmpty(),"请明确选择纸面账户");}
QJsonObject Flow::row()const{auto value=draft.value("drafts").toObject().value(draft.value("selectedAccount").toString());return value.isObject()?value.toObject():QJsonObject{{"response",""},{"evidence",QJsonObject{}},{"result",QJsonObject{}}};}
void Flow::setRow(QJsonObject r){auto rows=draft.value("drafts").toObject();rows[draft.value("selectedAccount").toString()]=r;draft["drafts"]=rows;}
QJsonArray Flow::accounts(){
 auto envelope=host.read(),h=envelope.value("host").toObject();need(h.value("accounts").isArray(),"账户读取失败");QJsonArray result;QSet<QString>seen;
 for(auto v:h.value("accounts").toArray()){auto a=v.toObject();QString id=a.value("id").toString();need(!id.isEmpty()&&!seen.contains(id),"账户身份缺失或重复");seen.insert(id);if(a.value("type")=="paper")result.append(a);}return result;
}
void Flow::selectAccount(QString id){need(active&&writable,"页面不在前台或草稿不可写");if(id.isEmpty()){invalidate();draft["selectedAccount"]="";persist();return;}bool found=false;for(auto v:accounts())if(v.toObject().value("id")==id)found=true;need(found,"非现有纸面账户不可选择");invalidate();draft["selectedAccount"]=id;if(!draft.value("drafts").toObject().contains(id))setRow(row());persist();}
QJsonObject Flow::currentAccount(){mustRun();QString id=draft.value("selectedAccount").toString();for(auto v:accounts())if(v.toObject().value("id")==id)return v.toObject();throw std::runtime_error("所选纸面账户已不存在");}
QJsonObject Flow::input(QJsonObject envelope,bool requireContinuous){
 need(envelope.value("host").isObject()&&envelope.value("cut").isString(),"宿主快照缺失");auto h=envelope.value("host").toObject();QString id=draft.value("selectedAccount").toString(),cut=envelope.value("cut").toString();
 auto configured=paperPolicy::project(h,id,policy.read(),cut);need(configured.value("status")=="configured",configured.value("reason").toString().toUtf8().constData());
 // Reuse the existing ledger replay; only positive held identities need session coverage.
 QJsonArray ids;auto positions=business::portfolio(h.value("trades").toArray(),{},id).value("positions").toArray();
 for(auto v:positions){auto r=v.toObject();if(r.value("quantity").toDouble()>0)ids.append(r.value("instrumentId"));}
 auto session=paperSession::evaluate(evidence,cut,ids);
 need(session.value("known")==true&&(!requireContinuous||(session.value("open")==true&&session.value("continuous")==true)),("交易会话阻断："+session.value("reason").toString()).toUtf8().constData());
 auto adapted=paperMonitorHost::adapt(configured.value("hostSnapshot").toObject(),id,cut,session,configured.value("monitorPolicy").toObject(),requireContinuous);
 need(adapted.value("status")=="adapted",QString::fromUtf8(QJsonDocument(adapted.value("issues").toArray()).toJson(QJsonDocument::Compact)).toUtf8().constData());return adapted.value("input").toObject();
}
QJsonObject Flow::prepare(bool acknowledged){
 mustRun();invalidate();need(acknowledged,"请明确授权本次纸面范围");auto envelope=host.read();auto candidate=paperMonitor::prepare(input(envelope),envelope.value("cut").toString(),true);auto history=archive.read();
 auto r=row();r["evidence"]=candidate;r["result"]=QJsonObject{};setRow(r);persist();prepared=candidate;archiveRevision=qint64(history.value("revision").toDouble());return candidate;
}
void Flow::setResponse(QString text){mustRun();need(text.toUtf8().size()<=250000,"答复超过250000字节，未截断");previewed={};auto r=row();r["response"]=text;r["result"]=QJsonObject{};setRow(r);persist();}
QJsonObject Flow::preview(){mustRun();need(!prepared.isEmpty(),"请重新准备；恢复或离开的旧证据不能确认");auto candidate=paperMonitor::preview(prepared,row().value("response").toString());auto r=row();r["result"]=candidate;setRow(r);persist();previewed=candidate;return candidate;}
QJsonObject Flow::decide(QString choice,bool confirmation){
 mustRun();need(confirmation,"需要明确人工确认或拒绝");need(!prepared.isEmpty()&&!previewed.isEmpty(),"请先准备并预览本次人工答复");QJsonObject current;QString cut;
 if(choice=="confirmed"){auto envelope=host.read();current=input(envelope);cut=envelope.value("cut").toString();}else cut=host.now();
 auto record=paperMonitor::decide(prepared,previewed,current,cut,choice,true);archive.append(record,archiveRevision);invalidate();auto r=row();r["result"]=record;setRow(r);persist();return record;
}
void Flow::cancel(){invalidate();persist(false);}
void Flow::setActive(bool value){if(!value&&!active)return;if(!value){active=false;cancel();}else active=true;}
QJsonArray Flow::history(){QString id=draft.value("selectedAccount").toString();QJsonArray out;for(auto v:archive.read().value("records").toArray())if(v.toObject().value("prepared").toObject().value("input").toObject().value("account").toObject().value("id")==id)out.append(v);for(auto value:paperLegacy::Store(directory+"/paper-monitor-legacy-history.json").read().value("rows").toArray())out.append(value);return out;}
void Flow::selectHistory(int index){auto rows=history();need(index>=0&&index<rows.size(),"历史条目不存在");auto selected=rows[index].toObject();if(selected.value("schema")=="native-paper-monitor-legacy-entry/v1"){need(active,"页面不在前台");invalidate();previewed=paperLegacy::Store(directory+"/paper-monitor-legacy-history.json").view(selected.value("id").toString());return;}mustRun();invalidate();auto r=row(),record=paperMonitor::validateRecord(selected);r["result"]=record;r["evidence"]=record.value("prepared");setRow(r);persist();}
QJsonObject Flow::state()const{auto r=row();return {{"accountId",draft.value("selectedAccount")},{"response",r.value("response")},{"evidence",r.value("evidence")},{"result",previewed.value("schema")=="native-paper-monitor-legacy-view/v1"?QJsonValue(previewed):r.value("result")},{"prompt",r.value("evidence").toObject().isEmpty()?QString():prompt(r.value("evidence").toObject())},{"preparedForCurrentSession",!prepared.isEmpty()},{"active",active},{"writable",writable},{"canConfirm",active&&writable&&!prepared.isEmpty()&&previewed.value("valid")==true},{"canReject",active&&writable&&!prepared.isEmpty()&&!previewed.isEmpty()},{"automaticTrading",false}};}
QJsonObject Flow::marker(){persist();return {{"id","paper-monitor-draft-v1"},{"hash",portfolioMirror::hash(baseline)}};}
void Flow::restore(const QJsonObject&m){invalidate();need(m.size()==2&&m.value("id")=="paper-monitor-draft-v1","草稿标识不匹配");auto latest=loadDraft();need(m.value("hash")==portfolioMirror::hash(latest),"草稿已改变，未替换当前全文");baseline=latest;draft=latest.value("state").toObject();writable=true;}
}
