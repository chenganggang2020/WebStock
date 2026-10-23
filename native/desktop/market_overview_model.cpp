#include "market_overview_model.hpp"
#include <QRegularExpression>
#include <QSet>
#include <QCryptographicHash>
#include <QJsonDocument>
#include <QDateTime>
#include <stdexcept>
#include <algorithm>
#include <cmath>
namespace marketOverview {
void require(bool condition,const QString& message){if(!condition)throw std::runtime_error(message.toUtf8().constData());}
void active(const Cancel& cancel){require(!cancel||!cancel(),"已取消；未提交");}
QString hash(const QByteArray& bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
QJsonObject emptyArchive(){return {{"schema","native-market-overview-archive/v1"},{"revision",0},{"frames",QJsonArray{}}};}
void validateSnapshot(const QJsonObject& s){
 require(s.value("schema")=="native-market-overview/v1","不是市场全景观测格式");
 require(QRegularExpression("^[a-f0-9]{64}$").match(s.value("id").toString()).hasMatch(),"观测身份缺失");
 require(QDateTime::fromString(s.value("fetchedAt").toString(),Qt::ISODateWithMs).isValid(),"观测抓取时间无效");
 require(s.value("sections").isObject()&&s.value("scope")=="bounded-public-observations"&&s.value("unifiedSourceTime").isNull(),"观测时点或样本范围无效");
 const auto sections=s.value("sections").toObject();require(sections.size()==4,"须明确指数、行业、概念、样本宽度四个分区");
 for(const auto& key:{"indices","industry","concept","breadth"}){auto r=sections.value(key).toObject();require(r.value("source").isString()&&r.value("fetchedAt").isString()&&r.value("sourceTime").isNull()&&r.value("sampleScope").isString(),"分区来源或时点缺失");require(r.value("availability")=="available"||r.value("availability")=="unavailable","分区状态无效");if(r.value("availability")=="available"){require(r.value("data").isObject(),"可用分区缺少数据");if(QString(key)=="industry"||QString(key)=="concept"){auto rows=r.value("data").toObject().value("rows").toArray();require(rows.size()<=100,"板块观测超过100条边界");QSet<QString> seen;for(const auto& v:rows){const auto b=v.toObject();auto code=b.value("code").toString();require(b.value("kind")==QString(key)&&QRegularExpression("^BK\\d{4}$").match(code).hasMatch()&&!seen.contains(code),"板块身份或分类无效");seen.insert(code);}}}}
 require(QJsonDocument(s).toJson(QJsonDocument::Compact).size()<=2*1024*1024,"单个观测超过2MiB");
}
void validateArchive(const QJsonObject& a){require(a.value("schema")=="native-market-overview-archive/v1"&&a.value("frames").isArray(),"不是市场全景档案");double rev=a.value("revision").toDouble(-1);require(rev>=0&&rev<=9007199254740991.0&&std::floor(rev)==rev,"档案版本无效");auto frames=a.value("frames").toArray();require(frames.size()<=90,"档案超过90次观测");QSet<QString> ids;for(const auto& v:frames){require(v.isObject(),"观测须为对象");auto s=v.toObject();validateSnapshot(s);auto id=s.value("id").toString();require(!ids.contains(id),"档案观测身份重复");ids.insert(id);}require(QJsonDocument(a).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"档案超过8MiB");}
QJsonObject preview(const QByteArray& bytes,const QJsonObject& archive){validateArchive(archive);require(!bytes.isEmpty()&&bytes.size()<=8*1024*1024,"导入仅接受不超过8MiB的完整JSON");QJsonParseError e;auto doc=QJsonDocument::fromJson(bytes,&e);require(e.error==QJsonParseError::NoError&&doc.isObject(),"导入JSON无效");auto incoming=doc.object();QJsonArray input;if(incoming.value("schema")=="native-market-overview/v1"){validateSnapshot(incoming);input.append(incoming);}else{validateArchive(incoming);input=incoming.value("frames").toArray();}QJsonObject merged=archive;auto rows=merged.value("frames").toArray();QSet<QString> ids;for(const auto& v:rows)ids.insert(v.toObject().value("id").toString());int added=0;for(const auto& v:input){auto r=v.toObject();QString id=r.value("id").toString();if(ids.contains(id))continue;r.insert("archiveProvenance","imported-unverified");rows.append(r);ids.insert(id);++added;}merged.insert("frames",rows);merged.insert("revision",archive.value("revision").toDouble()+1);validateArchive(merged);return {{"schema","native-market-overview-preview/v1"},{"digest",hash(bytes)},{"expectedRevision",archive.value("revision")},{"added",added},{"merged",merged}};}
static QJsonValue number(const QJsonValue& value){if(value.isNull()||value.isUndefined()||value.isBool()||value.isArray()||value.isObject())return QJsonValue::Null;bool ok=false;double n=value.isDouble()?value.toDouble():value.toString().trimmed().toDouble(&ok);if(value.isDouble())ok=true;return ok&&std::isfinite(n)?QJsonValue(n):QJsonValue(QJsonValue::Null);}
QJsonArray boardRows(const QJsonObject& payload,const QString& taxonomy){require(payload.value("rc").toInt(-1)==0,"公开板块源返回错误状态");auto data=payload.value("data").toObject();require(data.value("diff").isArray(),"公开板块源缺少数组");auto rows=data.value("diff").toArray();require(rows.size()<=100,"公开板块响应超过请求边界");QJsonArray out;QSet<QString> seen;for(const auto& v:rows){const auto r=v.toObject();auto code=r.value("f12").toString();auto name=r.value("f14").toString();if(!QRegularExpression("^BK\\d{4}$").match(code).hasMatch()||name.isEmpty()||seen.contains(code))continue;seen.insert(code);out.append(QJsonObject{{"code",code},{"name",name},{"kind",taxonomy},{"dailyChangePct",number(r.value("f3"))},{"amount",number(r.value("f6"))},{"mainNetInflow",number(r.value("f62"))},{"leaderName",r.value("f128").toString()},{"sourceTime",QJsonValue::Null}});}return out;}
QJsonArray sampleRows(const QJsonArray& sina){require(sina.size()<=300,"样本响应超过300条");QJsonArray out;QSet<QString> seen;for(const auto& v:sina){const auto r=v.toObject();auto id=r.value("symbol").toString().toLower();auto c=number(r.value("changepercent"));if(!QRegularExpression("^(sh|sz)\\d{6}$").match(id).hasMatch()||c.isNull()||seen.contains(id))continue;seen.insert(id);out.append(QJsonObject{{"fullId",id},{"name",r.value("name")},{"changePct",c},{"price",number(r.value("trade"))}});}return out;}
QJsonObject indices(const QString& sina,const QString& fetchedAt){
 const QStringList ids={"sh000001","sz399001","sz399006","sh000688","sh000300","sh000905","sh000852","sh000016"};
 QJsonArray rows;QJsonObject lookup;QRegularExpression rx("hq_str_s_((?:sh|sz)\\d{6})=\"([^\"]*)\"");auto matches=rx.globalMatch(sina);
 while(matches.hasNext()){auto m=matches.next();QString id=m.captured(1);auto fields=m.captured(2).split(',');if(!ids.contains(id)||lookup.contains(id)||fields.size()<6)continue;auto price=number(fields[1]);if(price.isNull()||price.toDouble()<=0)continue;auto amount=number(fields[5]);lookup.insert(id,QJsonObject{{"fullId",id},{"name",fields[0]},{"price",price},{"changeAmount",number(fields[2])},{"changePct",number(fields[3])},{"volume",number(fields[4])},{"amount",amount.isNull()?amount:QJsonValue(amount.toDouble()*10000)},{"publishedAt",QJsonValue::Null}});}
 for(const auto& id:ids){rows.append(lookup.contains(id)?lookup.value(id):QJsonValue(QJsonObject{{"fullId",id},{"availability","unavailable"},{"price",QJsonValue::Null},{"amount",QJsonValue::Null}}));}
 auto sh=lookup.value(ids[0]).toObject().value("amount"),sz=lookup.value(ids[1]).toObject().value("amount");
 return {{"schema","native-market-indices/v1"},{"source","sina-public-index"},{"fetchedAt",fetchedAt},{"publishedAt",QJsonValue::Null},{"indices",rows},{"receivedCount",lookup.size()},{"complete",lookup.size()==8},{"turnover",QJsonObject{{"shanghai",sh.isUndefined()?QJsonValue(QJsonValue::Null):sh},{"shenzhen",sz.isUndefined()?QJsonValue(QJsonValue::Null):sz},{"total",sh.isDouble()&&sz.isDouble()?QJsonValue(sh.toDouble()+sz.toDouble()):QJsonValue(QJsonValue::Null)}}}};
}
QJsonArray chartIndices(){
 const QStringList symbols{"sh000001","sz399001","sz399006","sh000688","sh000300","sh000905","sh000852","sh000016"};
 const QStringList names{"上证指数","深证成指","创业板指","科创50","沪深300","中证500","中证1000","上证50"};
 QJsonArray out;for(int i=0;i<symbols.size();++i){auto s=symbols[i];out.append(QJsonObject{{"id",s.left(2).toUpper()+":index:"+s.mid(2)},{"symbol",s},{"name",names[i]},{"group","大盘指数"},{"order",i}});}return out;
}
QJsonObject breadth(const QJsonArray& stocks,const QString& sampleScope){
 QSet<QString> seen;int n=0,up=0,down=0,strong=0,weak=0,sharp=0;double sum=0;
 for(const auto& value:stocks){const auto row=value.toObject();auto id=row.value("fullId").toString();auto c=number(row.value("changePct"));if(id.isEmpty()||seen.contains(id)||c.isNull())continue;seen.insert(id);++n;double x=c.toDouble();sum+=x;up+=x>0;down+=x<0;strong+=x>=3;weak+=x<=-3;sharp+=x<=-5;}
 if(!n)return {{"availability","unavailable"},{"sampleScope",sampleScope},{"total",0},{"score",QJsonValue::Null}};
 const double b=100.0*up/n,avg=sum/n;const auto clamp=[](double x,double a,double z){return std::clamp(x,a,z);};double score=b*.45+clamp(50+avg*9,0,100)*.30+clamp(50+220.0*(strong-weak)/n,0,100)*.25-clamp(140.0*sharp/n,0,25);
 return {{"availability","available"},{"sampleScope",sampleScope},{"total",n},{"advancing",up},{"declining",down},{"flat",n-up-down},{"breadthPct",b},{"avgChangePct",avg},{"strongCount",strong},{"weakCount",weak},{"sharpDown",sharp},{"score",std::floor(score+.5)},{"scoreProvenance","local-sentiment-formula-v1"},{"wholeMarketClaim",false}};
}
QJsonArray rankBoards(const QJsonArray& boards,const QString& taxonomy,const QString& metric,bool descending,int limit){
 if((taxonomy!="industry"&&taxonomy!="concept")||(metric!="dailyChangePct"&&metric!="amount"&&metric!="mainNetInflow"&&metric!="heatScore"))return {};
 QList<QJsonObject> rows;QSet<QString> seen;for(const auto& v:boards){auto r=v.toObject();auto code=r.value("code").toString();if(r.value("kind").toString()!=taxonomy||code.isEmpty()||seen.contains(code)||number(r.value(metric)).isNull())continue;r.insert(metric,number(r.value(metric)));seen.insert(code);rows.append(r);}
 std::stable_sort(rows.begin(),rows.end(),[&](const auto&a,const auto&b){double x=a.value(metric).toDouble(),y=b.value(metric).toDouble();return x==y?a.value("code").toString()<b.value("code").toString():(descending?x>y:x<y);});QJsonArray out;for(int i=0;i<std::min(int(rows.size()),std::clamp(limit,1,300));++i)out.append(rows[i]);return out;
}
QJsonObject heatmap(const QJsonArray& boards,const QString& taxonomy,const QString& mode){QJsonArray nodes;int excluded=0;for(const auto& v:boards){const auto r=v.toObject();if(r.value("kind").toString()!=taxonomy)continue;auto area=number(r.value(mode=="flow"?"mainNetInflow":"amount")),color=number(r.value(mode=="flow"?"mainNetInflow":"dailyChangePct"));if(area.isNull()||color.isNull()||std::abs(area.toDouble())<=0||(mode!="flow"&&area.toDouble()<0)){++excluded;continue;}nodes.append(QJsonObject{{"code",r.value("code")},{"name",r.value("name")},{"area",mode=="flow"?std::abs(area.toDouble()):area.toDouble()},{"color",color}});}return {{"nodes",nodes},{"excludedCount",excluded},{"taxonomy",taxonomy},{"mode",mode},{"availability",nodes.isEmpty()?"unavailable":"available"},{"overlappingBoards",true},{"sumIsMarketTotal",false}};}
}
