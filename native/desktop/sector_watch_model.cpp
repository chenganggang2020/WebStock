#include "sector_watch_model.hpp"
#include <QDateTime>
#include <QJsonDocument>
#include <QRegularExpression>
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace sectorWatch {
namespace {
void require(bool ok,const char* message="板块数据格式或身份不符"){if(!ok)throw std::runtime_error(message);}
bool matches(const QString& s,const QString& p){return QRegularExpression(p).match(s).hasMatch();}
QDateTime instant(const QString& s){require(matches(s,"(Z|[+-][0-9]{2}:[0-9]{2})$"),"抓取时间必须带时区");auto t=QDateTime::fromString(s,Qt::ISODateWithMs);require(t.isValid());return t;}
QString text(const QJsonValue& v,int max=160){auto s=v.toString().trimmed();require(!s.isEmpty()&&s.size()<=max,"来源名称或代码为空/过长");return s;}
QJsonValue number(const QJsonValue& v,bool nonnegative=false,bool positive=false){bool ok=v.isDouble();double d=v.toDouble();if(v.isString()){auto s=v.toString().trimmed();d=s.toDouble(&ok);if(s.isEmpty())ok=false;}if(!ok||!std::isfinite(d)||(nonnegative&&d<0)||(positive&&d<=0))return QJsonValue::Null;return d;}
bool stock(const QString& market,const QString& code){if(!matches(code,"^[0-9]{6}$"))return false;return (market=="SH"&&matches(code,"^(60|68|90)[0-9]{4}$"))||(market=="SZ"&&matches(code,"^(00|20|30)[0-9]{4}$"))||(market=="BJ"&&matches(code,"^(4[0-9]|8[0-9]|92)[0-9]{4}$"));}
QString marketOf(const QString& provider,const QString& sourceMarket){if(provider=="eastmoney-public-board")return sourceMarket=="1"?"SH":sourceMarket=="0"?"SZ":"";return sourceMarket=="sh"?"SH":sourceMarket=="sz"?"SZ":sourceMarket=="bj"?"BJ":"";}
QJsonObject identity(const QJsonObject& q,const QString& code,const QString& sourceMarket={}){
 QString provider=q["provider"].toString(),taxonomy=q["taxonomy"].toString();QJsonObject row{{"provider",provider},{"taxonomy",taxonomy},{"code",code},{"boardCode",q["code"]}};
 if(q["kind"]=="catalog"){auto b=query(provider,taxonomy,code);require(!code.isEmpty());row["key"]=queryKey(b);row["kind"]="board";}
 else{require(matches(code,"^[0-9]{6}$"),"成分证券代码无效");require(sourceMarket.size()<=20&&!sourceMarket.contains('|'),"来源市场值无效");auto market=marketOf(provider,sourceMarket);bool valid=stock(market,code);row["kind"]="stock";row["sourceMarket"]=sourceMarket;row["key"]=queryKey(q)+"|"+sourceMarket+"|"+code;row["market"]=valid?QJsonValue(market):QJsonValue(QJsonValue::Null);row["type"]=valid?QJsonValue("stock"):QJsonValue(QJsonValue::Null);row["id"]=valid?QJsonValue(market+":stock:"+code):QJsonValue(QJsonValue::Null);row["canOpen"]=valid;row["identityReason"]=valid?QString():QString("来源市场/证券类型未确认，不联动、不加入自选");}
 return row;
}
QJsonObject eastRow(const QJsonObject& raw,const QJsonObject& q){auto code=text(raw["f12"],24);QString sourceMarket;if(raw["f13"].isDouble()&&std::floor(raw["f13"].toDouble())==raw["f13"].toDouble())sourceMarket=QString::number(raw["f13"].toInt(-1));auto r=identity(q,code,sourceMarket);r["name"]=text(raw["f14"]);r["price"]=number(raw["f2"],true,true);r["changePct"]=number(raw["f3"]);r["amount"]=number(raw["f6"],true);r["mainNetInflow"]=number(raw["f62"]);return r;}
QJsonObject sinaRow(const QJsonObject& raw,const QJsonObject& q){QString symbol=raw["symbol"].toString().toLower();require(matches(symbol,"^(sh|sz|bj)[0-9]{6}$"),"新浪未提供完整市场证券身份");QString code=symbol.mid(2);require(!raw.contains("code")||raw["code"].toString()==code,"新浪代码与完整证券身份不一致");auto r=identity(q,code,symbol.left(2));r["name"]=text(raw["name"]);r["price"]=number(raw["trade"],true,true);r["changePct"]=number(raw["changepercent"]);r["amount"]=number(raw["amount"],true);r["mainNetInflow"]=QJsonValue::Null;return r;}
bool quotes(const QJsonArray& rows){if(rows.isEmpty())return false;for(auto value:rows){auto r=value.toObject();if(!r["price"].isDouble()||!r["changePct"].isDouble()||!r["amount"].isDouble())return false;}return true;}
QJsonObject snapshot(const QJsonObject& q,const QString& start,const QString& end,int total,const QJsonArray& rows,bool complete,const QString& error){return {{"schema",schema},{"query",q},{"key",queryKey(q)},{"startedAt",start},{"fetchedAt",end},{"observedAt",QJsonValue::Null},{"declaredTotal",total},{"coverageComplete",complete},{"quoteComplete",complete&&quotes(rows)},{"items",rows},{"failure",error},{"sourceTiming","来源未提供统一行情时点；仅记录本轮有界抓取窗口，不宣称同时快照"}};}
QString csvCell(QString s){if(!s.isEmpty()&&QString("=+-@\t\r").contains(s[0]))s.prepend('\'');s.replace('"',"\"\"");return '"'+s+'"';}
}
QJsonObject query(const QString& provider,const QString& taxonomy,const QString& code){require(taxonomy=="industry"||taxonomy=="concept","仅支持行业/概念");require(provider=="eastmoney-public-board"||provider=="ths-public-board"||(provider=="sina-public-industry"&&taxonomy=="industry")||(provider=="sina-public-concept"&&taxonomy=="concept"),"来源与分类不符");if(!code.isEmpty())require(provider=="eastmoney-public-board"?matches(code,"^BK[0-9]{4}$"):provider=="ths-public-board"?matches(code,taxonomy=="industry"?"^88[0-9]{4}$":"^[0-9]{6}$"):taxonomy=="industry"?matches(code,"^(sw2_[0-9]+|new_[a-z0-9_]+)$"):matches(code,"^(chgn_[0-9]+|gn_[a-z0-9_]+)$"),"来源板块代码无效");return {{"provider",provider},{"taxonomy",taxonomy},{"code",code},{"kind",code.isEmpty()?"catalog":"constituents"}};}
QString queryKey(const QJsonObject& q){require(query(q["provider"].toString(),q["taxonomy"].toString(),q["code"].toString())==q);return q["provider"].toString()+"|"+q["taxonomy"].toString()+"|"+q["code"].toString();}
Assembly::Assembly(QJsonObject q,QString at):input(std::move(q)),start(std::move(at)){queryKey(input);instant(start);}
bool Assembly::appendEastmoney(const QJsonObject& raw,int page,qint64 elapsed){require(input["provider"]=="eastmoney-public-board");require(elapsed>=0&&elapsed<=8000,"板块读取超过8秒总截止");require(page==next&&page<=100,"分页顺序错误");require(raw["rc"].isDouble()&&raw["rc"].toDouble()==0&&raw["data"].isObject(),"来源返回错误");auto data=raw["data"].toObject();double count=data["total"].toDouble(-1);require(count>=0&&count<=10000&&std::floor(count)==count&&data["diff"].isArray(),"来源总数或分页无效");int reported=int(count);require(total<0||total==reported,"分页总数变化，未保存完整缓存");auto pageRows=data["diff"].toArray();require(pageRows.size()<=500&&(reported==0||!pageRows.isEmpty())&&items.size()+pageRows.size()<=reported,"分页数量不完整/越界");QJsonArray added;QSet<QString> ids=seen;for(auto v:pageRows){require(v.isObject());auto row=eastRow(v.toObject(),input);QString key=row["key"].toString();require(!ids.contains(key),"分页重复，未保存完整缓存");ids.insert(key);added.append(row);}for(auto v:added)items.append(v);seen=ids;total=reported;++next;return items.size()==total;}
bool Assembly::appendSina(const QJsonArray& raw,int reported,int page,qint64 elapsed){require(input["provider"].toString().startsWith("sina-public-")&&input["kind"]=="constituents");require(elapsed>=0&&elapsed<=8000,"板块读取超过8秒总截止");require(page==next&&page<=100&&reported>=0&&reported<=10000,"分页顺序/总数无效");require(total<0||total==reported,"分页总数变化");require(raw.size()<=100&&(reported==0||!raw.isEmpty())&&items.size()+raw.size()<=reported,"分页数量不完整/越界");QJsonArray added;auto ids=seen;for(auto v:raw){require(v.isObject());auto row=sinaRow(v.toObject(),input);QString key=row["key"].toString();require(!ids.contains(key),"分页重复，未保存完整缓存");ids.insert(key);added.append(row);}for(auto v:added)items.append(v);seen=ids;total=reported;++next;return items.size()==total;}
QJsonObject Assembly::finish(const QString& end,qint64 elapsed,const QString& error)const{auto duration=instant(start).msecsTo(instant(end));require(duration>=0);bool complete=total>=0&&items.size()==total&&error.isEmpty()&&elapsed>=0&&elapsed<=8000&&duration<=8000;QString reason=complete?QString():error.isEmpty()?QString("本轮未取得完整集合或超过总截止"):error.left(1000);auto s=snapshot(input,start,end,total,items,complete,reason);validate(s);return s;}
QJsonObject sinaCatalog(const QJsonValue& root,const QString& taxonomy,const QString& start,const QString& end){
 auto q=query(taxonomy=="industry"?"sina-public-industry":"sina-public-concept",taxonomy);
 require(root.isArray(),"新浪目录格式无效");
 QString preferred=taxonomy=="industry"?"申万二级":"热门概念",fallback=taxonomy=="industry"?"新浪行业":"概念板块";
 QJsonValue selected(QJsonValue::Undefined);int visited=0;
 std::function<void(QJsonValue,int,QString)> find=[&](QJsonValue v,int depth,QString label){
  require(depth<=30&&++visited<=100000,"目录层级/数量过大");
  if(!v.isArray())return;auto a=v.toArray();
  if(!a.isEmpty()&&a[0].toString()==label){require(selected.isUndefined()&&a.size()>1&&a[1].isArray(),"目录分类重复或结构无效");selected=a[1];return;}
  for(auto child:a)if(child.isArray())find(child,depth+1,label);
 };
 find(root,0,preferred);if(selected.isUndefined()){visited=0;find(root,0,fallback);}
 require(!selected.isUndefined(),"目录没有完整目标分类");
 auto declared=selected.toArray();require(!declared.isEmpty()&&declared.size()<=2048,"来源目录为空或过大");
 QJsonArray rows;QSet<QString> ids;
 for(auto value:declared){
  require(value.isArray(),"目录含无效行，未声明完整");auto a=value.toArray();
  require(a.size()>2,"目录含无效行，未声明完整");QString code=a[2].toString();
  auto row=identity(q,code);require(!ids.contains(code),"目录重复，未声明完整");ids.insert(code);
  row["name"]=text(a[0]);for(auto field:{"price","changePct","amount","mainNetInflow"})row[field]=QJsonValue::Null;rows.append(row);
 }
 auto s=snapshot(q,start,end,declared.size(),rows,true,{});validate(s);return s;
}
void validate(const QJsonObject& s){require(s["schema"]==schema&&s["query"].isObject());auto q=s["query"].toObject();require(s["key"]==queryKey(q)&&s["observedAt"].isNull(),"查询身份或来源时点不符");auto duration=instant(s["startedAt"].toString()).msecsTo(instant(s["fetchedAt"].toString()));require(duration>=0&&s["items"].isArray()&&s["coverageComplete"].isBool()&&s["quoteComplete"].isBool());auto rows=s["items"].toArray();double declared=s["declaredTotal"].toDouble(-2);require(declared>=-1&&declared<=10000&&std::floor(declared)==declared&&rows.size()<=10000&&(declared<0||rows.size()<=declared));bool complete=s["coverageComplete"].toBool();require(!complete||(duration<=8000&&declared==rows.size()&&s["failure"].toString().isEmpty()),"不完整结果不得标为完整");require(complete||!s["failure"].toString().isEmpty(),"失败原因缺失");QSet<QString> keys;for(auto value:rows){require(value.isObject());auto row=value.toObject();auto expected=identity(q,row["code"].toString(),row["sourceMarket"].toString());for(auto i=expected.begin();i!=expected.end();++i)require(row[i.key()]==i.value(),"行身份与查询不一致");text(row["name"]);QString key=row["key"].toString();require(!keys.contains(key),"结果行重复");keys.insert(key);for(auto field:{"price","changePct","amount","mainNetInflow"}){auto v=row[field];require(v.isNull()||(v.isDouble()&&std::isfinite(v.toDouble())));if((QString(field)=="price"||QString(field)=="amount")&&v.isDouble())require(QString(field)=="price"?v.toDouble()>0:v.toDouble()>=0);}if(q["provider"]!="eastmoney-public-board")require(row["mainNetInflow"].isNull());}require(s["quoteComplete"].toBool()==(complete&&quotes(rows)),"行情完整性标记不符");require(QJsonDocument(s).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"板块快照超过8MiB");}
QJsonArray sorted(const QJsonArray& items,const QString& field){QList<QJsonObject> rows;for(auto row:items)rows<<row.toObject();std::stable_sort(rows.begin(),rows.end(),[&](auto a,auto b){auto x=a[field],y=b[field];if(x.isDouble()!=y.isDouble())return x.isDouble();if(x.isDouble()&&x.toDouble()!=y.toDouble())return x.toDouble()>y.toDouble();return a["key"].toString()<b["key"].toString();});QJsonArray out;for(auto row:rows)out.append(row);return out;}
QByteArray csv(const QJsonObject& s){validate(s);QStringList fields{"provider","taxonomy","boardCode","key","id","name","code","price","changePct","amount","mainNetInflow"};QString out=fields.join(',')+",fetchedAt,observedAt,coverageComplete,quoteComplete\r\n";for(auto v:s["items"].toArray()){auto row=v.toObject();QStringList cells;for(auto field:fields){auto x=row[field];cells<<csvCell(x.isDouble()?QString::number(x.toDouble(),'g',17):x.toString());}cells<<csvCell(s["fetchedAt"].toString())<<"\"\""<<(s["coverageComplete"].toBool()?"true":"false")<<(s["quoteComplete"].toBool()?"true":"false");out+=cells.join(',')+"\r\n";}return QByteArray("\xEF\xBB\xBF")+out.toUtf8();}
}
