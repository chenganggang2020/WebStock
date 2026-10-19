#include "paper_monitor_host_adapter.hpp"
#include "portfolio_mirror_model.hpp"
#include <QDateTime>
#include <QTimeZone>
namespace paperMonitorHost {
namespace {
struct Problem {QString code,detail;};
void need(bool ok,QString code,QString detail){if(!ok)throw Problem{code,detail};}
QString text(const QJsonObject&o,QString key,QString code){auto v=o.value(key);need(v.isString()&&!v.toString().trimmed().isEmpty()&&v.toString().size()<=200,code,"缺少明确文本："+key);return v.toString();}
double number(const QJsonObject&o,QString key,double low,double high,QString code){auto v=o.value(key);double n=v.toDouble(std::nan(""));need(v.isDouble()&&std::isfinite(n)&&n>=low&&n<=high,code,"缺少有效数值："+key);return n;}
QDateTime time(QString s,QString code){auto t=QDateTime::fromString(s,Qt::ISODateWithMs);need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch()&&t.isValid(),code,"需要有效且含时区的完整时点");return t.toUTC();}
QString stamp(QDateTime t){return t.toUTC().toString("yyyy-MM-dd'T'HH:mm:ss.zzz'Z'");}
void recent(QDateTime value,QDateTime cut,QString code){need(value<=cut&&value>=cut.addSecs(-300),code,"读取或证据时点在截止之后或已超过5分钟");}
bool fullId(QString s){return QRegularExpression("^(SH|SZ|BJ):(stock|etf):[0-9]{6}$").match(s).hasMatch();}
QJsonObject projectQuote(QString id,const QJsonArray& roster,QDateTime cut){
 QJsonObject original,identity;QString symbol=id.left(2).toLower()+id.section(':',2,2);int matches=0,aliases=0;QJsonObject row;
 for(auto v:roster){auto r=v.toObject();if(r.value("id")==id){row=r;++matches;}if(r.value("symbol")==symbol)++aliases;}
 QJsonObject result{{"instrumentId",id},{"price",QJsonValue::Null},{"observedAt",QJsonValue::Null},{"source",QJsonValue::Null},{"availability","unavailable"}};
 try{
  need(matches==1&&aliases==1&&row.value("symbol")==symbol&&row.value("transient")!=true,"QUOTE_IDENTITY","载入证券身份缺失、歧义或临时");
  need(row.value("quote").isObject(),"QUOTE_MISSING","缺少已载入报价");original=row.value("quote").toObject();identity={{"id",id},{"symbol",symbol}};
  for(auto key:{"instrumentId","symbol"})if(original.contains(key))need(original.value(key)==(QString(key)=="symbol"?symbol:id),"QUOTE_IDENTITY","报价内嵌身份不匹配");
  auto source=text(original,"source","QUOTE_SOURCE");result["source"]=source;need(source=="新浪公开报价","QUOTE_SOURCE","尚未核实此报价来源契约");
  need(original.value("stale")!=true&&(!original.contains("availability")||original.value("availability")=="available")&&original.value("error").toString().isEmpty(),"QUOTE_UNAVAILABLE","来源已声明报价不可用");
  double price=number(original,"price",.000001,1e12,"QUOTE_PRICE");auto d=text(original,"tradeDate","QUOTE_OBSERVATION"),t=text(original,"tradeTime","QUOTE_OBSERVATION");need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}$").match(d).hasMatch()&&QRegularExpression("^[0-9]{2}:[0-9]{2}:[0-9]{2}$").match(t).hasMatch(),"QUOTE_OBSERVATION","交易日期/时间格式无效");auto observed=time(d+"T"+t+"+08:00","QUOTE_OBSERVATION");
  need(observed>=cut.addSecs(-300)&&observed<=cut.addSecs(5),"QUOTE_STALE","报价观察时点已过期或在未来");auto received=time(text(original,"checkedAt","QUOTE_RECEIPT"),"QUOTE_RECEIPT");need(received<=cut,"QUOTE_AFTER_CUT","报价检查时间晚于本次截止");
  result["price"]=price;result["observedAt"]=stamp(observed);result["availability"]="available";result["timeBasis"]="native-sina-tradeDate-tradeTime-AsiaShanghai";
 }catch(const Problem&p){result["gapCode"]=p.code;result["gapDetail"]=p.detail;}
 result["originalQuote"]=original;result["identityEvidence"]=identity;return result;
}
}
QJsonObject adapt(const QJsonObject&host,const QString&accountId,const QString&cutText,const QJsonObject&session,const QJsonObject&policy,bool requireContinuous){
 QJsonObject result{{"schema","native-paper-monitor-host-result/v1"},{"status","blocked"},{"input",QJsonValue::Null},{"issues",QJsonArray{}},{"quoteGaps",QJsonArray{}},{"automaticTrading",false},{"readinessRequired",true}};
 try{
  auto cut=time(cutText,"CUT_INVALID");need(QJsonDocument(host).toJson(QJsonDocument::Compact).size()+QJsonDocument(session).toJson(QJsonDocument::Compact).size()+QJsonDocument(policy).toJson(QJsonDocument::Compact).size()<=4*1024*1024,"SNAPSHOT_LIMIT","快照超过4MiB，未截断");portfolioMirror::depth(host);portfolioMirror::depth(session);portfolioMirror::depth(policy);
  need(session.value("schema")=="native-paper-session-evidence/v1"&&session.value("known")==true,"SESSION_EVIDENCE_MISSING","缺少可核交易日/会话证据，不能用工作日代替");text(session,"source","SESSION_SOURCE");text(session,"evidenceId","SESSION_SOURCE");recent(time(text(session,"checkedAt","SESSION_TIME"),"SESSION_TIME"),cut,"SESSION_TIME");auto local=cut.toOffsetFromUtc(28800);need(session.value("date")==local.date().toString(Qt::ISODate),"SESSION_DATE","会话证据不属于截止日期");need(session.value("open").isBool()&&session.value("continuous").isBool(),"SESSION_INVALID","交易日状态不完整");if(requireContinuous){need(session.value("open")==true&&session.value("continuous")==true,"SESSION_CLOSED","来源未确认连续交易时段");auto clock=local.time();need((clock>=QTime(9,30)&&clock<QTime(11,30))||(clock>=QTime(13,0)&&clock<QTime(15,0)),"SESSION_CLOCK","截止不在连续交易时间范围");}
  need(host.value("schema")=="native-paper-monitor-host-snapshot/v1"&&host.value("accounts").isArray()&&host.value("trades").isArray()&&host.value("instruments").isArray(),"SNAPSHOT_SHAPE","需要原生账户、完整流水和已载入证券快照");auto read=host.value("readEvidence").toObject();need(read.value("accountsComplete")==true&&read.value("tradesComplete")==true&&read.value("coherent")==true,"READ_INCOMPLETE","缺少完整一致读取声明");QString source=text(read,"source","READ_SOURCE");auto capture=time(text(read,"capturedAt","READ_TIME"),"READ_TIME");recent(capture,cut,"READ_TIME");
  auto accounts=host.value("accounts").toArray(),trades=host.value("trades").toArray(),roster=host.value("instruments").toArray();need(accounts.size()<=1000&&trades.size()<=10000&&roster.size()<=10000,"SNAPSHOT_LIMIT","快照条数超限，未截断");QJsonObject account;QSet<QString> accountIds;
  for(auto v:accounts){need(v.isObject(),"ACCOUNT_IDENTITY","账户记录不是对象");auto a=v.toObject();auto id=text(a,"id","ACCOUNT_IDENTITY");need(!accountIds.contains(id),"ACCOUNT_IDENTITY","账户ID重复");accountIds.insert(id);if(id==accountId)account=a;}
  need(!account.isEmpty()&&account.value("type")=="paper","ACCOUNT_IDENTITY","需明确选择已有纸面账户");need(account.value("status")=="active","ACCOUNT_STATUS","账户未明确处于观察中，不补active");number(account,"cashBalance",0,1e12,"CASH_MISSING");auto cashSource=text(account,"cashSource","CASH_SOURCE"),verification=text(account,"cashVerification","CASH_SOURCE");
  if(cashSource=="manual")need(verification=="unverified"&&(!account.contains("cashAsOf")||account.value("cashAsOf").isNull()),"CASH_PROVENANCE","手工现金须保留未核验且无cashAsOf");else{need(cashSource=="paper-ledger"&&verification=="ledger-reconciled","CASH_PROVENANCE","现金来源口径未核实");need(time(text(account,"cashAsOf","CASH_PROVENANCE"),"CASH_PROVENANCE")<=cut,"CASH_PROVENANCE","现金时点晚于截止");}
  need(policy.value("schema")=="native-paper-monitor-policy/v1"&&policy.value("accountId")==accountId,"POLICY_MISSING","缺少本账户纸面监控策略，RiskSettings不能代替");text(policy,"source","POLICY_SOURCE");text(policy,"revision","POLICY_SOURCE");double limit=number(policy,"maxSingleWeight",.000001,1,"POLICY_LIMIT");
  QJsonArray selected;QSet<QString> tradeIds,securityIds;for(auto v:trades){need(v.isObject(),"TRADE_IDENTITY","流水不是对象");auto t=v.toObject();auto owner=text(t,"accountId","TRADE_IDENTITY");need(accountIds.contains(owner),"TRADE_IDENTITY","流水账户身份未知，未忽略");if(owner!=accountId)continue;auto id=text(t,"id","TRADE_IDENTITY"),security=text(t,"instrumentId","TRADE_IDENTITY");need(!tradeIds.contains(id)&&fullId(security),"TRADE_IDENTITY","流水ID重复或证券缺少完整身份");tradeIds.insert(id);securityIds.insert(security);selected.append(t);}
  QJsonObject quotes;QJsonArray gaps;auto ids=securityIds.values();ids.sort();for(auto id:ids){auto quote=projectQuote(id,roster,cut);quotes[id]=quote;if(quote.value("availability")!="available")gaps.append(QJsonObject{{"instrumentId",id},{"code",quote.value("gapCode")}});}
  QString revision="content-sha256:"+portfolioMirror::hash(QJsonObject{{"accountId",accountId},{"transactions",selected}});
  auto readProof=read,sessionProof=session;readProof.remove("capturedAt");sessionProof.remove("checkedAt");
  QJsonObject input{{"schema","native-paper-monitor-input/v1"},{"source",source},{"capturedAt",stamp(capture)},{"account",account},{"ledger",QJsonObject{{"accountId",accountId},{"complete",true},{"revision",revision},{"source",source},{"asOf",stamp(capture)},{"transactions",selected}}},{"quotes",quotes},{"constraints",QJsonObject{{"maxSingleWeight",limit}}},{"session",QJsonObject{{"verified",true},{"open",session.value("open")},{"continuous",session.value("continuous")},{"date",session.value("date")},{"source",session.value("source")},{"checkedAt",session.value("checkedAt")}}},{"hostEvidence",QJsonObject{{"read",readProof},{"session",sessionProof},{"policy",policy},{"revisionBasis","selected-original-transactions-content-not-database-transaction-version"}}}};
  need(QJsonDocument(input).toJson(QJsonDocument::Compact).size()<=4*1024*1024,"SNAPSHOT_LIMIT","适配结果超过4MiB，未截断");result["status"]="adapted";result["input"]=input;result["quoteGaps"]=gaps;
 }catch(const Problem&p){result["issues"]=QJsonArray{QJsonObject{{"code",p.code},{"detail",p.detail}}};}catch(const std::exception&){result["issues"]=QJsonArray{QJsonObject{{"code","SNAPSHOT_INVALID"},{"detail","快照结构或可移植数值无效"}}};}
 return result;
}
}
