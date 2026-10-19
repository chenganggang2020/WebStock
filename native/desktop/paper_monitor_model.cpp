#include "paper_monitor_model.hpp"
#include "business_store.hpp"
#include "portfolio_mirror_model.hpp"
#include <cmath>
namespace paperMonitor {
namespace {
void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
QString text(const QJsonObject& o,const QString& key,int max=200){auto v=o.value(key);need(v.isString()&&!v.toString().trimmed().isEmpty()&&v.toString().size()<=max,"缺少有效文本："+key);return v.toString();}
double number(const QJsonObject&o,const QString& key,double lo=0,double hi=1e12){auto v=o.value(key);double n=v.toDouble(std::nan(""));need(v.isDouble()&&std::isfinite(n)&&n>=lo&&n<=hi,"缺少有效数值："+key);return n;}
QDateTime time(const QString& s){auto t=QDateTime::fromString(s,Qt::ISODateWithMs);need(t.isValid()&&QRegularExpression("(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch(),"时点必须有效且含时区");return t.toUTC();}
QString stamp(QDateTime t){return t.toUTC().toString("yyyy-MM-dd'T'HH:mm:ss.zzz'Z'");}
void fresh(const QString& s,QDateTime now){auto t=time(s);need(t<=now.addMSecs(5000)&&t>=now.addMSecs(-300000),"数据时点缺失、超过5分钟或位于未来");}
void exact(const QJsonObject&o,QStringList keys){auto actual=o.keys();keys.sort();need(actual==keys,"决策字段不完整或含额外字段");}
QJsonObject scope(QJsonObject input){input.remove("capturedAt");auto session=input.value("session").toObject();session.remove("checkedAt");input["session"]=session;auto ledger=input.value("ledger").toObject();ledger.remove("asOf");input["ledger"]=ledger;return input;}
QJsonObject checked(const QJsonObject& input,QDateTime now,bool acknowledged){
 need(QJsonDocument(input).toJson(QJsonDocument::Compact).size()<=4*1024*1024,"输入超过4MiB，未截断");
 need(input.value("schema")=="native-paper-monitor-input/v1","需完整纸面监控输入");text(input,"source");fresh(text(input,"capturedAt"),now);
 auto account=input.value("account").toObject();QString accountId=text(account,"id");need(account.value("type")=="paper"&&account.value("status")=="active","需明确处于观察中的纸面账户");
 number(account,"cashBalance");QString source=text(account,"cashSource"),verification=text(account,"cashVerification");
 if(source=="manual")need(verification=="unverified"&&(!account.contains("cashAsOf")||account.value("cashAsOf").isNull()),"手工现金不可带券商核验或现金行情时点");
 else {need(source=="paper-ledger"&&verification=="ledger-reconciled","未知现金来源/核验口径");need(time(text(account,"cashAsOf"))<=now,"现金时点在未来");}
 need(acknowledged,"请明确确认该现金仅用于本次纸面范围；不代表券商确认余额");
 auto session=input.value("session").toObject();QString day=now.toOffsetFromUtc(28800).date().toString(Qt::ISODate);auto clock=now.toOffsetFromUtc(28800).time();
 need(session.value("verified")==true&&session.value("open")==true&&session.value("date")==day,"缺少当前已验证交易日证据");text(session,"source");fresh(text(session,"checkedAt"),now);
 need(session.value("continuous")==true&&((clock>=QTime(9,30)&&clock<QTime(11,30))||(clock>=QTime(13,0)&&clock<QTime(15,0))),"不在连续交易时段，不能准备");
 auto ledger=input.value("ledger").toObject();need(ledger.value("accountId")==accountId&&ledger.value("complete")==true&&ledger.value("transactions").isArray(),"需本账户完整流水；不能把缺失当空账本");text(ledger,"revision");text(ledger,"source");fresh(text(ledger,"asOf"),now);
 auto trades=ledger.value("transactions").toArray();need(trades.size()<=10000,"流水超过10000条，未截断");QSet<QString> tradeIds;
 for(auto v:trades){need(v.isObject(),"流水不是对象");auto t=v.toObject();auto id=text(t,"id");need(!tradeIds.contains(id)&&t.value("accountId")==accountId,"流水重复或串账户");tradeIds.insert(id);auto date=text(t,"date");need(date.size()==10&&QDate::fromString(date,Qt::ISODate).isValid()&&date<=day,"流水日期无效或在未来");for(auto key:{"quantity","price","fee","tax"})number(t,key);if(t.value("side")=="dividend"||t.value("side")=="fee")number(t,"amount");}
 need(input.value("quotes").isObject(),"缺少已持有证券报价");auto quotes=input.value("quotes").toObject();
 auto positions=business::portfolio(trades,quotes,accountId).value("positions").toArray();QJsonArray held,universe;QSet<QString> codes;
 QDateTime expiry=now.addSecs(300);expiry=std::min(expiry,time(input.value("capturedAt").toString()).addSecs(300));
 for(auto v:positions){auto p=v.toObject();if(p.value("quantity").toDouble()<=0)continue;QString id=p.value("instrumentId").toString(),code=id.section(':',2,2);need(!codes.contains(code),"六位代码对应多个完整身份，旧回复格式无法唯一绑定");codes.insert(code);auto q=quotes.value(id).toObject();need(q.value("instrumentId")==id&&q.value("availability")=="available","报价身份错误或不可用："+id);number(q,"price",.000001);text(q,"source");fresh(text(q,"observedAt"),now);expiry=std::min(expiry,time(q.value("observedAt").toString()).addSecs(300));
  held.append(QJsonObject{{"instrumentId",id},{"quantity",p.value("quantity")},{"price",q.value("price")},{"quoteSource",q.value("source")},{"observedAt",q.value("observedAt")}});universe.append(QJsonObject{{"instrumentId",id},{"code",code}});
 }
 need(!held.isEmpty()&&held.size()<=50,"本轮需1–50个已持有证券，空仓或超限不能准备");number(input.value("constraints").toObject(),"maxSingleWeight",.000001,1);
 auto sessionEnd=QDateTime(now.toOffsetFromUtc(28800).date(),clock<QTime(12,0)?QTime(11,30):QTime(15,0),QTimeZone::fromSecondsAheadOfUtc(28800));expiry=std::min(expiry,sessionEnd.toUTC());
 return {{"canPrepare",true},{"issues",QJsonArray{}},{"accountId",accountId},{"heldPositions",held},{"allowedUniverse",universe},{"expiresAt",stamp(expiry)},{"automaticTrading",false},{"cashBasis",source=="manual"?"manual-unverified-paper-only":"paper-ledger-only"}};
}
QJsonObject checkPrepared(const QJsonObject&p){auto expected=prepare(p.value("input").toObject(),p.value("preparedAt").toString(),p.value("paperScopeConfirmed")==true);need(expected==p,"准备内容或指纹已改变");return p;}
}
QString hash(const QJsonValue& v){return portfolioMirror::hash(v);}
QJsonObject readiness(const QJsonObject&i,const QString& now,bool ack){try{return checked(i,time(now),ack);}catch(const std::exception&e){return {{"canPrepare",false},{"issues",QJsonArray{QString::fromUtf8(e.what())}},{"heldPositions",QJsonValue::Null},{"automaticTrading",false}};}}
QJsonObject prepare(const QJsonObject&i,const QString& now,bool ack){auto t=time(now);auto gates=checked(i,t,ack);QJsonObject p{{"schema","native-paper-monitor-preparation/v1"},{"input",i},{"preparedAt",stamp(t)},{"paperScopeConfirmed",ack},{"readiness",gates},{"scopeHash",hash(scope(i))},{"automaticTrading",false}};p["preparationId"]=hash(p);return p;}
QJsonObject preview(const QJsonObject& prepared,const QString& raw){checkPrepared(prepared);need(raw.toUtf8().size()<=250000,"回复超过250000字节，未截断");QJsonArray errors;QJsonObject decision;try{
 QJsonParseError error;auto doc=QJsonDocument::fromJson(raw.toUtf8(),&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"回复不是完整JSON对象");decision=doc.object();exact(decision,{"asOf","marketView","cashTargetPercent","orders","portfolioRisk","nextReviewAt"});
 need(time(text(decision,"asOf"))==time(prepared.value("preparedAt").toString()),"回复截止时间不匹配准备时点");need(QStringList{"bullish","neutral","bearish"}.contains(text(decision,"marketView")),"市场判断无效");double total=number(decision,"cashTargetPercent",0,100);
 need(time(text(decision,"nextReviewAt"))>time(prepared.value("preparedAt").toString()),"下次审阅时间须晚于准备时点");need(decision.value("orders").isArray()&&decision.value("orders").toArray().size()<=50,"建议列表缺失或超限");QSet<QString> allowed,seen;for(auto v:prepared.value("readiness").toObject().value("allowedUniverse").toArray())allowed.insert(v.toObject().value("code").toString());
 for(auto v:decision.value("orders").toArray()){need(v.isObject(),"建议不是对象");auto o=v.toObject();exact(o,{"code","action","targetPositionPercent","confidence","reason","invalidation"});auto code=text(o,"code");need(allowed.contains(code)&&!seen.contains(code),"代码不在已持有范围或重复");seen.insert(code);need(QStringList{"buy","sell","hold"}.contains(text(o,"action")),"建议动作无效");double target=number(o,"targetPositionPercent",0,100);need(target<=prepared.value("input").toObject().value("constraints").toObject().value("maxSingleWeight").toDouble()*100+1e-9,"目标仓位超过明确单股上限");total+=target;number(o,"confidence",0,100);text(o,"reason",4000);text(o,"invalidation",4000);}
 need(total<=100.000001,"仓位目标与现金目标合计超过100%");need(decision.value("portfolioRisk").isArray()&&decision.value("portfolioRisk").toArray().size()<=20,"风险说明缺失或超限");for(auto v:decision.value("portfolioRisk").toArray())need(v.isString()&&!v.toString().trimmed().isEmpty()&&v.toString().size()<=1000,"风险说明无效");
 }catch(const std::exception&e){errors.append(QString::fromUtf8(e.what()));}
 return {{"schema","native-paper-monitor-preview/v1"},{"preparationId",prepared.value("preparationId")},{"rawResponse",raw},{"decision",decision},{"valid",errors.isEmpty()},{"errors",errors},{"automaticTrading",false}};
}
QJsonObject decide(const QJsonObject&p,const QJsonObject&v,const QJsonObject&current,const QString& now,const QString& choice,bool explicitConfirmation){
 checkPrepared(p);need(explicitConfirmation&&QStringList{"confirmed","rejected"}.contains(choice),"需明确确认或拒绝");need(preview(p,v.value("rawResponse").toString())==v,"预览内容已改变");auto at=time(now);need(at>=time(p.value("preparedAt").toString()),"记录时间早于准备时间");
 if(choice=="confirmed"){need(v.value("valid")==true,"无效建议不能确认");need(at<=time(p.value("readiness").toObject().value("expiresAt").toString()),"准备已过期");checked(current,at,true);need(hash(scope(current))==p.value("scopeHash").toString(),"账户、流水、现金、报价或范围已改变，请重新准备");}
 QJsonObject r{{"schema","native-paper-monitor-decision/v1"},{"prepared",p},{"preview",v},{"currentInput",choice=="confirmed"?current:QJsonObject{}},{"recordedAt",stamp(at)},{"choice",choice},{"automaticTrading",false},{"execution","none"}};r["id"]=hash(r);return r;
}
QJsonObject validateRecord(const QJsonObject&r){auto expected=decide(r.value("prepared").toObject(),r.value("preview").toObject(),r.value("currentInput").toObject(),r.value("recordedAt").toString(),r.value("choice").toString(),true);need(expected==r,"历史决策内容/指纹不符");return r;}
}
