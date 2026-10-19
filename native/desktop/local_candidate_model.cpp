#include "local_candidate_model.hpp"
#include "local_candidate_background.hpp"
#include "../domain-cpp/engine.hpp"
#include <QJsonDocument>
#include <QCryptographicHash>
#include <QRegularExpression>
#include <QSet>
#include <QTimeZone>
#include <QVariant>
#include <charconv>
#include <stdexcept>
namespace localCandidate {
namespace {
const QString background="主营、主题、人工板块、持仓、最近查看、估值、AI：本版未参与；非投资建议";
const QStringList factors{"ma5","ma20","ma60","trend5","trend20","trend60","volatility","volumeRatio5","macdDif","macdDea","macdHist","change","amount"};
void require(bool ok,const QString& message){if(!ok)throw std::invalid_argument(message.toStdString());}
void active(const Cancel& cancelled){if(cancelled&&cancelled())throw std::runtime_error("候选操作已取消");}
bool finite(const QJsonValue& v){return v.isDouble()&&std::isfinite(v.toDouble());}
QJsonObject pick(const QJsonObject& in,const QStringList& keys){QJsonObject out;for(const auto& key:keys)if(in.contains(key)){auto v=in[key];require(!v.isString()||v.toString().size()<=512,"来源字段过长");out[key]=v;}return out;}
QByteArray quoted(const QString& text){
 // Match Android framework JSONObject.quote, not the Maven org.json implementation.
 QString out="\"";for(auto ch:text){ushort c=ch.unicode();switch(c){case '\\':out+="\\\\";break;case '"':out+="\\\"";break;case '/':out+="\\/";break;case '\b':out+="\\b";break;case '\t':out+="\\t";break;case '\n':out+="\\n";break;case '\f':out+="\\f";break;case '\r':out+="\\r";break;default:if(c<0x20)out+="\\u"+QString::number(c,16).rightJustified(4,'0');else out+=ch;}}out+='"';return out.toUtf8();
}
QString instant(const QDateTime& at){auto s=at.toUTC().toString(Qt::ISODateWithMs);if(s.endsWith(".000Z"))s.chop(5),s+='Z';return s;}
QByteArray decimal(double n){
 require(std::isfinite(n),"非有限JSON数值");if(n==0)return "0";char buffer[64];auto result=std::to_chars(buffer,buffer+64,n);require(result.ec==std::errc{},"数值编码失败");QByteArray s(buffer,result.ptr-buffer);int exponent=s.indexOf('e');
 if(exponent<0)return s;int shift=s.mid(exponent+1).toInt();s=s.left(exponent);bool neg=s.startsWith('-');if(neg)s.remove(0,1);int dot=s.indexOf('.');if(dot<0)dot=s.size();else s.remove(dot,1);dot+=shift;
 if(dot<=0)s="0."+QByteArray(-dot,'0')+s;else if(dot>=s.size())s+=QByteArray(dot-s.size(),'0');else s.insert(dot,'.');return neg?'-'+s:s;
}
QDateTime parseInstant(const QString& s){if(!QRegularExpression("(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch())return {};return QDateTime::fromString(s,Qt::ISODateWithMs);}
bool checked(const QJsonObject& meta,const QDateTime& captured){auto at=parseInstant(meta["checkedAt"].toString());return meta["source"].isString()&&!meta["source"].toString().trimmed().isEmpty()&&at.isValid()&&at<=captured;}
void number(QJsonObject& f,const QString& key,double n){f[key]=std::isfinite(n)?QJsonValue(n):QJsonValue(QJsonValue::Null);}
double value(const QJsonObject& f,const QString& key){return finite(f[key])?f[key].toDouble():NAN;}
double mean(const std::vector<market::Bar>& bars,int from,int to,bool volume){double sum=0;for(int i=from;i<to;i++)sum+=(volume?bars[i].volume:bars[i].close)/(to-from);return sum;}
QJsonObject calculate(const QJsonObject& s,const QString& strategy,const QDateTime& captured,const Cancel& cancelled){
 auto meta=s["dayMeta"].toObject(),quote=s["quote"].toObject();QJsonObject f;for(auto key:factors)f[key]=QJsonValue::Null;
 QJsonArray missing,risks,contributions;std::vector<market::Bar> bars;QStringList dates;QString error,end;bool forming=false;
 try{auto input=s["day"].toArray();double last=-INFINITY;for(int i=0;i<input.size();i++){
  active(cancelled);auto row=input[i].toObject();for(auto key:QStringList{"time","open","high","low","close","volume"})require(finite(row[key]),"日K缺少有效"+key+"，未跨缺口计算");
  require(row["valid"].isBool()&&row["valid"].toBool()&&row["closed"].isBool(),"日K有效/闭合标记缺失");
  market::Bar b{row["time"].toDouble(),row["open"].toDouble(),row["high"].toDouble(),row["low"].toDouble(),row["close"].toDouble(),row["volume"].toDouble(),true,row["closed"].toBool()};
  require(market::valid(b)&&b.volume>=0&&b.time>last,"日K价格、量或时间顺序无效");auto day=QDate::fromString(row["label"].toString(),Qt::ISODate);auto close=QDateTime(day,QTime(15,0),QTimeZone::fromSecondsAheadOfUtc(28800));
  require(day.isValid()&&day.toString(Qt::ISODate)==row["label"].toString()&&day<=captured.toOffsetFromUtc(28800).date()&&b.time==double(close.toMSecsSinceEpoch()),"日K日期与毫秒时间不一致");last=b.time;
  if(!b.closed){require(i==input.size()-1,"历史中混入未闭合日K");forming=true;continue;}require(close<captured,"尚未结束的日K不能标已闭合");bars.push_back(b);dates.append(day.toString(Qt::ISODate));
 }if(bars.size()>80){bars.erase(bars.begin(),bars.end()-80);dates=dates.mid(dates.size()-80);}}
 catch(const std::invalid_argument& e){error=QString::fromUtf8(e.what());bars.clear();dates.clear();}
 int n=int(bars.size());if(n>0)end=dates.last();if(!error.isEmpty())missing.append(error);
 bool provenance=checked(meta,captured)&&meta["timeUnit"].toString()=="milliseconds"&&QStringList{"qfq","none"}.contains(meta["adjustment"].toString())&&meta["volumeUnit"].toString()=="手";
 auto original=s["day"].toArray();QString sourceEnd=original.isEmpty()?QString():original.last().toObject()["label"].toString();provenance=provenance&&!sourceEnd.isEmpty()&&sourceEnd==meta["dataDate"].toString();
 if(n>0&&(!parseInstant(meta["checkedAt"].toString()).isValid()||bars.back().time>parseInstant(meta["checkedAt"].toString()).toMSecsSinceEpoch()))provenance=false;
 if(!provenance)missing.append("日K来源/检查时间/复权/单位不完整，或检查早于闭合日K，不评分");if(forming)risks.append("末根仍形成中，未参与确认因子");
 for(int period:{5,20,60}){if(n>=period){number(f,"ma"+QString::number(period),mean(bars,n-period,n,false));number(f,"trend"+QString::number(period),(bars.back().close/bars[n-period].close-1)*100);}else missing.append(QString("MA/首末变化%1需%1根闭合日K，现有%2").arg(period).arg(n));}
 if(n>=20){double avg=0;for(int i=1;i<n;i++)avg+=(bars[i].close/bars[i-1].close-1)*100/(n-1);double variance=0;for(int i=1;i<n;i++){double diff=(bars[i].close/bars[i-1].close-1)*100-avg;variance+=diff*diff/(n-1);}number(f,"volatility",std::sqrt(variance));}else missing.append("波动率至少需20根闭合日K");
 if(n>=10){double prior=mean(bars,n-10,n-5,true);if(prior>0)number(f,"volumeRatio5",mean(bars,n-5,n,true)/prior);}if(f["volumeRatio5"].isNull())missing.append("5/5均量比缺数或前5根均量为零");
 if(n>0){auto macd=market::macd(bars,12,26,9);number(f,"macdDif",macd.dif.back());number(f,"macdDea",macd.dea.back());number(f,"macdHist",macd.hist.back());}if(f["macdDea"].isNull())missing.append("MACD DEA需34根闭合日K完成原生预热");
 bool quoteOk=checked(quote,captured)&&finite(quote["price"])&&quote["price"].toDouble()>0&&!end.isEmpty()&&end==quote["tradeDate"].toString();auto qd=QDate::fromString(quote["tradeDate"].toString(),Qt::ISODate);auto qt=QTime::fromString(quote["tradeTime"].toString(),Qt::ISODateWithMs);auto qat=QDateTime(qd,qt,QTimeZone::fromSecondsAheadOfUtc(28800));if(!qat.isValid()||!parseInstant(quote["checkedAt"].toString()).isValid()||qat>parseInstant(quote["checkedAt"].toString()))quoteOk=false;
 if(quoteOk){if(finite(quote["changePercent"]))number(f,"change",quote["changePercent"].toDouble());if(finite(quote["amount"])&&quote["amount"].toDouble()>=0)number(f,"amount",quote["amount"].toDouble());}
 if(!quoteOk)missing.append("报价源时间缺失、检查早于行情时间或与闭合日K日期不同；涨跌幅/成交额未计分");if(f["change"].isNull())missing.append("涨跌幅缺失，不能当作0%");if(f["amount"].isNull())missing.append("成交额缺失，不能当作0元");
 for(auto key:factors)if(f[key].isNull())missing.append("因子 "+key+" 不可用（缺数或数值超出有限范围），未参与计分");
 risks.append("交易日覆盖未核验；本机留存数据不保证实时或历史时点可得性");risks.append("MACD采用同原生公式，但候选最多末80根闭合日K窗口；与更长图表历史的初始段不同，不保证逐值相同");
 bool ready=n>=20&&provenance&&error.isEmpty()&&std::isfinite(value(f,"ma20"));if(QRegularExpression("^\\*?ST.*$").match(s["name"].toString().toUpper()).hasMatch()){ready=false;missing.append("ST名称规则排除，不代表完整交易所风险核验");}
 int total=0;auto add=[&](QString rule,QString label,int points){contributions.append(QJsonObject{{"rule",rule},{"label",label},{"points",points}});total+=points;};
 if(ready){add("base","基础观察分",45);double change=value(f,"change"),ma5=value(f,"ma5"),ma20=value(f,"ma20"),ma60=value(f,"ma60"),t5=value(f,"trend5"),t20=value(f,"trend20"),t60=value(f,"trend60");bool strong=strategy=="breakout"||strategy=="short-strong";
  if(strategy=="short-strong"&&change>=3)add("change","当日涨幅≥3%",18);else if(strategy=="breakout"&&change>=1.5)add("change","当日涨幅≥1.5%",12);else if(strategy=="pullback"&&change>=-5&&change<=-1)add("change","当日回调-5%..-1%",10);
  if(std::abs(change)>=6)risks.append("当日波动较大，需人工复核");if(value(f,"amount")>=500000000)add("amount","成交额≥5亿元",6);
  if(ma5>=ma20)add("ma20","MA5≥MA20",strong?10:5);else if(strategy=="pullback")add("ma20","MA5<MA20回调观察",5);else risks.append("MA5低于MA20");
  if(strategy=="stable"&&std::abs(t20)<=8)add("trend20","20根首末变化绝对值≤8%",6);if(strategy=="short-strong"&&t20>=8)add("trend20","20根首末变化≥8%",8);
  if(ma5>=ma60)add("ma60","MA5≥MA60",strong?7:4);else if(std::isfinite(ma60))risks.append("MA5低于MA60");
  if(strategy=="short-strong"&&t5>=2)add("trend5","5根首末变化≥2%",6);if(strategy=="pullback"&&t5>=-8&&t5<=-2)add("trend5","5根首末变化-8%..-2%",5);if(std::abs(t5)>=10)risks.append("5根日K变化较快");
  if(strong&&t60>=10)add("trend60","60根首末变化≥10%",5);if(strategy=="stable"&&std::abs(t60)<=15)add("trend60","60根首末变化绝对值≤15%",4);if(t60<=-12)risks.append("60根首末变化≤-12%");
  if(value(f,"volumeRatio5")>=1.2)add("volume","末5/前5均量≥1.2",5);if(value(f,"volumeRatio5")<=.7)risks.append("5/5均量比≤0.7，量能收缩");
  if(strategy=="stable"&&value(f,"volatility")<=4)add("volatility","实际窗口波动率≤4%",5);if(value(f,"volatility")>4)risks.append("窗口波动率>4%");
  if(strong&&value(f,"macdDif")>=value(f,"macdDea"))add("macd","原生MACD DIF≥DEA（不是交叉事件判定）",8);if(value(f,"macdDif")<value(f,"macdDea")&&value(f,"macdDif")<0)risks.append("原生MACD空头关系");
  add("watchlist","明确属于当前自选",strategy=="stable"?14:8);add("template","规则模板常量；非外部证据",strategy=="pullback"?12:strategy=="short-strong"?5:4);
  if(f["change"].isNull()&&f["amount"].isNull()&&strategy!="stable")add("missingQuote","同日有效报价因子缺失",-12);
 }
 return {{"id",s["id"]},{"name",s["name"]},{"group",s["group"]},{"status",!ready?"excluded":!missing.isEmpty()?"partial":"ready"},{"score",ready?QJsonValue(std::clamp(total,0,100)):QJsonValue(QJsonValue::Null)},{"rawScore",ready?QJsonValue(total):QJsonValue(QJsonValue::Null)},{"barCount",n},{"dataDate",end},{"factors",f},{"source",QJsonObject{{"quote",quote},{"dayMeta",meta}}},{"missing",missing},{"risks",risks},{"contributions",contributions},{"background",background}};
}
}
QJsonObject snapshot(const QJsonArray& selected,const QString& strategy,const QDateTime& capturedAt,const Cancel& cancelled){
 require(strategies.contains(strategy),"本版不支持该模板");require(capturedAt.isValid()&&!selected.isEmpty()&&selected.size()<=50,"请明确选择1至50只股票，不会静默截取");bool withBackground=false,business=false;for(auto v:selected){if(v.toObject().contains("backgroundInput"))withBackground=true;if(v.toObject()["backgroundInput"].toObject()["schema"]==localCandidateBackground::businessVersion)business=true;}QSet<QString> ids;QJsonArray inputs;
 for(auto v:selected){active(cancelled);require(v.isObject(),"证券输入须为对象");auto s=v.toObject();auto id=s["id"].toString();require(QRegularExpression("^(SH|SZ|BJ):stock:[0-9]{6}$").match(id).hasMatch()&&!ids.contains(id),"需唯一且明确的股票市场身份");ids.insert(id);require(!s["transient"].toBool(),"此版仅计算实际自选，不将临时观察当自选");auto symbol=id.left(2).toLower()+id.right(6);require(symbol==s["symbol"].toString(),"证券市场与来源代码不一致");auto name=s["name"].toString();require(!name.trimmed().isEmpty()&&name.size()<=128,"证券名称无效");
  QJsonObject input{{"id",id},{"symbol",symbol},{"name",name},{"group",s["group"].toString()},{"inWatchlist",true}};
  input["quote"]=pick(s["quote"].toObject(),{"price","previousClose","changePercent","amount","volume","source","tradeDate","tradeTime","checkedAt","cached","error","persistenceState"});
  input["dayMeta"]=pick(s["dayMeta"].toObject(),{"source","timeUnit","adjustment","volumeUnit","dataDate","checkedAt","cached","error","persistenceState"});
  auto day=s["day"].toArray();require(day.size()<=2000,"日K输入过大");QJsonArray kept;for(int i=std::max(0,int(day.size())-81);i<day.size();i++){require(day[i].isObject(),"日K输入须为对象");kept.append(pick(day[i].toObject(),{"time","label","open","high","low","close","volume","valid","closed"}));}input["day"]=kept;if(withBackground){require(!s.contains("backgroundInput")||s["backgroundInput"].isObject(),"背景输入须为对象");auto bg=s["backgroundInput"].toObject();require(!business||bg["schema"]==localCandidateBackground::businessVersion,"主营版本须覆盖同一批明确证券");require(QJsonDocument(bg).toJson(QJsonDocument::Compact).size()<=16384,"单证券背景输入超过16KiB");input["backgroundInput"]=bg;}inputs.append(input);
 }
 QJsonObject out{{"model",business?localCandidateBackground::businessCandidateVersion:withBackground?localCandidateBackground::candidateVersion:version},{"strategy",strategy},{"capturedAt",instant(capturedAt)},{"inputs",inputs}};require(QJsonDocument(out).toJson(QJsonDocument::Compact).size()<=1024*1024,"冻结输入超过1MiB，未执行");return out;
}
QJsonObject evaluate(const QJsonObject& input,const Cancel& cancelled){require(input["model"]==version||input["model"]==localCandidateBackground::candidateVersion||input["model"]==localCandidateBackground::businessCandidateVersion,"候选模型版本不支持");auto at=parseInstant(input["capturedAt"].toString());auto frozen=snapshot(input["inputs"].toArray(),input["strategy"].toString(),at,cancelled);require(frozen["model"]==input["model"],"冻结背景字段与模型版本不一致");QList<QJsonObject> rows;for(auto s:frozen["inputs"].toArray()){active(cancelled);auto row=calculate(s.toObject(),frozen["strategy"].toString(),at,cancelled);if(frozen["model"]==localCandidateBackground::candidateVersion||frozen["model"]==localCandidateBackground::businessCandidateVersion)row=localCandidateBackground::apply(row,s.toObject()["backgroundInput"].toObject(),frozen["strategy"].toString(),at,cancelled);rows.append(row);}std::sort(rows.begin(),rows.end(),[](const auto& a,const auto& b){int av=a["score"].isDouble()?a["score"].toInt():-1,bv=b["score"].isDouble()?b["score"].toInt():-1;return av==bv?a["id"].toString()<b["id"].toString():av>bv;});QJsonArray array;for(auto r:rows)array.append(r);return {{"model",frozen["model"]},{"input",frozen},{"inputHash",digest(frozen)},{"rows",array}};}
void verify(const QJsonObject& result,const Cancel& cancelled){require((result["model"]==version||result["model"]==localCandidateBackground::candidateVersion||result["model"]==localCandidateBackground::businessCandidateVersion)&&QJsonDocument(result).toJson(QJsonDocument::Compact).size()<=1536*1024,"候选版本或大小无效");auto expected=evaluate(result["input"].toObject(),cancelled);require(canonical(expected)==canonical(result),"候选输入摘要或计算结果不匹配");}
QByteArray canonical(const QJsonValue& value){
 if(value.isNull()||value.isUndefined())return "null";if(value.isString())return quoted(value.toString());if(value.isDouble()){auto raw=value.toVariant();if(raw.metaType().id()==QMetaType::LongLong)return QByteArray::number(raw.toLongLong());return decimal(value.toDouble());}if(value.isBool())return value.toBool()?"true":"false";QByteArray out;
 if(value.isArray()){out="[";for(auto v:value.toArray()){if(out.size()>1)out+=',';out+=canonical(v);}return out+']';}
 out="{";auto obj=value.toObject();for(const auto& key:obj.keys()){if(out.size()>1)out+=',';out+=quoted(key)+':'+canonical(obj[key]);}return out+'}';
}
QString digest(const QJsonObject& value){return QString::fromLatin1(QCryptographicHash::hash(canonical(value),QCryptographicHash::Sha256).toHex());}
QByteArray csv(const QJsonObject& result,const Cancel& cancelled){verify(result,cancelled);QByteArray out="\xEF\xBB\xBF" "id,name,score,status,model,captured_at,day_date,quote_date,quote_time,day_source,quote_source,adjustment,day_cached,missing,contributions\r\n";auto text=[](QJsonValue v){return v.isString()?v.toString():v.isUndefined()?QString():QString::fromUtf8(canonical(v));};for(auto v:result["rows"].toArray()){active(cancelled);auto r=v.toObject(),source=r["source"].toObject(),meta=source["dayMeta"].toObject(),q=source["quote"].toObject();QStringList values{r["id"].toString(),r["name"].toString(),r["score"].isNull()?QString():text(r["score"]),r["status"].toString(),result["model"].toString(),result["input"].toObject()["capturedAt"].toString(),r["dataDate"].toString(),text(q["tradeDate"]),text(q["tradeTime"]),text(meta["source"]),text(q["source"]),text(meta["adjustment"]),text(meta["cached"]),QString::fromUtf8(canonical(r["missing"])),QString::fromUtf8(canonical(r["contributions"]))};for(int i=0;i<values.size();i++){if(i)out+=',';auto cell=values[i];if(QRegularExpression("^\\s*[=+@-]",QRegularExpression::DotMatchesEverythingOption).match(cell).hasMatch())cell.prepend('\'');cell.replace('"',"\"\"");out+='"'+cell.toUtf8()+'"';}out+="\r\n";}return out;}
}

