#include "dark_rotation.hpp"
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QRegularExpression>
#include <QSet>
#include <QMap>
#include <algorithm>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTimeZone>
#include <QUrlQuery>
#include <QUuid>
#include <cmath>
#include <stdexcept>

namespace darkRotation {
namespace {
void require(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toStdString());}
bool dateOK(const QString& s){return QDate::fromString(s,Qt::ISODate).isValid()&&QDate::fromString(s,Qt::ISODate).toString(Qt::ISODate)==s;}
qint64 timestamp(const QString& s){
  require(QRegularExpression("(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch(),"抓取时间缺少时区");
  auto d=QDateTime::fromString(s,Qt::ISODateWithMs);require(d.isValid(),"抓取时间无效");return d.toMSecsSinceEpoch();
}
QString canonical(QString s){
  require(QRegularExpression("^-?[0-9]{1,24}$").match(s).hasMatch(),"金额须为有限长度整数分字符串");
  bool neg=s.startsWith('-');if(neg)s.remove(0,1);while(s.size()>1&&s[0]=='0')s.remove(0,1);return neg&&s!="0"?"-"+s:s;
}
QJsonValue cents(const QJsonValue& v){
  if(v.isUndefined()||v.isNull())return QJsonValue::Null;
  double n=v.toDouble(NAN);require(v.isDouble()&&std::isfinite(n)&&std::floor(n)==n&&std::abs(n)<=9007199254740991.,"来源金额不是精确整数元");
  return n==0?QString("0"):QString::number(qint64(n))+"00";
}
QJsonValue numeric(const QJsonValue& v){if(v.isUndefined()||v.isNull())return QJsonValue::Null;require(v.isDouble()&&std::isfinite(v.toDouble()),"来源数值无效");return v;}
QJsonObject source(){return {{"id","eastmoney-darktrade-rank"},{"provider","Eastmoney"},{"url","https://emrnweb.eastmoney.com/graymarket/"},{"endpoint","https://quotederivates.eastmoney.com/datacenter/darktrade"},{"classification","provider-model-estimate"},{"documentedPublicApi",false},{"licenseVerified",false},{"methodologyVersion",QJsonValue::Null},{"fieldMapping","GrayMarketRank web build main.79b98a58; observed 2026-09-17"}};}
bool knownOpen(QDate d){
  if(d.year()!=2026||d.dayOfWeek()>5)return false;
  auto s=d.toString(Qt::ISODate);
  for(auto range:QStringList{"01-01/01-03","02-15/02-23","04-04/04-06","05-01/05-05","06-19/06-21","09-25/09-27","10-01/10-07"})
    if(s>="2026-"+range.section('/',0,0)&&s<="2026-"+range.section('/',1,1))return false;
  return true;
}
struct Clock {qint64 wall=0,trading=-1;QString date;bool recess=false;};
Clock clock(const QString& s){
  Clock c;c.wall=timestamp(s);auto d=QDateTime::fromMSecsSinceEpoch(c.wall,QTimeZone::fromSecondsAheadOfUtc(8*3600));c.date=d.date().toString(Qt::ISODate);
  if(!knownOpen(d.date()))return c;int ms=QTime(0,0).msecsTo(d.time());
  constexpr int minute=60000; c.recess=ms>690*minute&&ms<780*minute;
  if(ms>=570*minute&&ms<=690*minute)c.trading=ms-570*minute;
  else if(ms>=780*minute&&ms<897*minute)c.trading=ms-660*minute;
  return c;
}
QJsonObject rowAt(const QJsonObject& s,const QString& code){for(auto v:s["rows"].toArray())if(v.toObject()["code"]==code)return v.toObject();return {};}
QByteArray encoded(const QJsonObject& o){return QJsonDocument(o).toJson(QJsonDocument::Compact);}
QJsonObject parsed(const QByteArray& b){QJsonParseError e;auto d=QJsonDocument::fromJson(b,&e);require(e.error==QJsonParseError::NoError&&d.isObject(),"档案JSON格式无效；未导入任何本文件记录");return d.object();}
struct Db {
  QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
  explicit Db(const QString& path,bool readOnly=false){
    if(!readOnly)QDir().mkpath(QFileInfo(path).absolutePath());db.setDatabaseName(path);
    if(readOnly)db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=5000");
    if(!db.open()){db={};QSqlDatabase::removeDatabase(name);require(false,"轮动库打不开");}
  }
  ~Db(){db.close();db={};QSqlDatabase::removeDatabase(name);}
};
bool readSchema(QSqlDatabase& db){
  QSqlQuery q(db);require(q.exec("PRAGMA user_version")&&q.next(),"轮动库版本读取失败");int version=q.value(0).toInt();require(version>=0&&version<=1,"轮动库版本不支持");
  require(q.exec("PRAGMA application_id")&&q.next()&&q.value(0).toInt()==0,"不是已知轮动库");
  require(q.exec("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name"),"轮动库结构读取失败");QList<QVariantList> objects;bool receipts=false;while(q.next()){objects.append({q.value(0),q.value(1),q.value(2),q.value(3)});receipts|=q.value(0)=="table"&&q.value(1)=="legacy_rotation_imports";}
  if(objects.isEmpty()&&version==0)return false;
  QMap<QString,QString> expected{{"index:sqlite_autoindex_rotation_1:rotation",QString()},{"table:rotation:rotation","CREATE TABLE rotation(date TEXT NOT NULL,scope TEXT NOT NULL,daily INTEGER NOT NULL,at TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(date,scope,daily,at))"}};
  if(receipts){expected.insert("index:sqlite_autoindex_legacy_rotation_imports_1:legacy_rotation_imports",QString());expected.insert("table:legacy_rotation_imports:legacy_rotation_imports","CREATE TABLE legacy_rotation_imports(date TEXT NOT NULL,scope TEXT NOT NULL,daily INTEGER NOT NULL,at TEXT NOT NULL,content_sha256 TEXT NOT NULL,source_file TEXT NOT NULL,source_sha256 TEXT NOT NULL,raw_line_sha256 TEXT NOT NULL,line_number INTEGER NOT NULL,PRIMARY KEY(date,scope,daily,at))");}
  require(objects.size()==expected.size(),"轮动库存在未知表、视图、索引或触发器");for(const auto& row:objects){auto key=row[0].toString()+":"+row[1].toString()+":"+row[2].toString();require(expected.contains(key),"轮动库结构对象未知");auto sql=expected.value(key);require(sql.isNull()?row[3].isNull():row[3].toString().simplified().toLower()==sql.toLower(),"轮动库表定义不匹配");}return true;
}
void init(QSqlDatabase& db){
  QSqlQuery q(db);require(q.exec("PRAGMA busy_timeout=5000"),"轮动库初始化失败");
  require(q.exec("PRAGMA user_version")&&q.next()&&q.value(0).toInt()<=1,"轮动库版本不支持");
  require(q.exec("CREATE TABLE IF NOT EXISTS rotation(date TEXT NOT NULL,scope TEXT NOT NULL,daily INTEGER NOT NULL,at TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(date,scope,daily,at))"),"轮动库建表失败");
  require(q.exec("PRAGMA user_version=1"),"轮动库版本写入失败");
}
int insert(QSqlDatabase& db,const QJsonObject& s){
  validate(s);auto time=QDateTime::fromMSecsSinceEpoch(timestamp(s["receivedAt"].toString()),QTimeZone::UTC).toString(Qt::ISODateWithMs);
  QVariantList keys{s["date"].toString(),s["scope"].toString(),s["schema"]=="webstock.rotation-daily/v1"?1:0,time};
  QSqlQuery q(db);q.prepare("SELECT data FROM rotation WHERE date=? AND scope=? AND daily=? AND at=?");for(auto k:keys)q.addBindValue(k);require(q.exec(),"轮动库读取失败");
  auto data=encoded(s);if(q.next()){require(q.value(0).toString().toUtf8()==data,"同一次采样内容冲突；保留原档案");return 0;}
  q.prepare("INSERT INTO rotation(date,scope,daily,at,data) VALUES(?,?,?,?,?)");for(auto k:keys)q.addBindValue(k);q.addBindValue(QString::fromUtf8(data));require(q.exec(),"轮动保存失败");return 1;
}
}
QString add(QString a,QString b){
  a=canonical(a);b=canonical(b);bool an=a.startsWith('-'),bn=b.startsWith('-');if(an)a.remove(0,1);if(bn)b.remove(0,1);
  bool neg=an;QString out;int carry=0;
  if(an==bn){for(int i=a.size()-1,j=b.size()-1;i>=0||j>=0||carry;--i,--j){int n=carry+(i>=0?a[i].digitValue():0)+(j>=0?b[j].digitValue():0);out.prepend(QChar('0'+n%10));carry=n/10;}}
  else{
    if(a.size()<b.size()||(a.size()==b.size()&&a<b)){a.swap(b);neg=bn;}
    for(int i=a.size()-1,j=b.size()-1;i>=0;--i,--j){int n=a[i].digitValue()-carry-(j>=0?b[j].digitValue():0);carry=n<0;if(n<0)n+=10;out.prepend(QChar('0'+n));}
  }
  return canonical((neg?"-":"")+out);
}
QString subtract(const QString& a,const QString& b){return add(a,b.startsWith('-')?b.mid(1):"-"+b);}
QString money(const QJsonValue& v){if(!v.isString())return "—";auto s=canonical(v.toString());bool neg=s.startsWith('-');if(neg)s.remove(0,1);s=s.rightJustified(7,'0');return (neg?"-":"")+s.left(s.size()-6)+"."+s.mid(s.size()-6,2);}
QString sourceKey(const QJsonObject& s){auto x=s["source"].toObject();return x["id"].toString()+":"+x["fieldMapping"].toString();}
bool captureAllowed(const QString& date,const QString& start,const QString& end){
  try{auto a=clock(start),b=clock(end);return a.date==date&&b.date==date&&a.trading>=0&&b.trading>=0&&b.wall>=a.wall&&b.wall-a.wall<=40000&&((a.trading<=120*60000&&b.trading<=120*60000)||(a.trading>=120*60000&&b.trading>=120*60000))&&b.wall-a.wall==b.trading-a.trading;}catch(...){return false;}
}
QString url(const QString& date,const QString& scope,int page){
  require(dateOK(date)&&(scope=="industry"||scope=="concept")&&page>=1&&page<=10,"日期、范围或分页无效");QUrlQuery q;
  for(auto pair:QList<QPair<QString,QString>>{{"version","101"},{"cver","100"},{"date",QString(date).remove('-')},{"StartPage",QString::number(page)},{"NumPerPage","100"},{"sortflag","6"},{"desc","1"},{"market","90"},{"datetype",scope=="industry"?"2":"3"}})q.addQueryItem(pair.first,pair.second);
  return "https://quotederivates.eastmoney.com/datacenter/darktrade?"+q.toString(QUrl::FullyEncoded);
}
QJsonObject normalize(const QJsonObject& raw,const QString& date,const QString& scope,int page,const QString& at){
  url(date,scope,page);timestamp(at);require(raw["errid"].toInt()!=-2,"所选日期尚无来源数据，请选择已发布的日期；原数据保留");require(raw["errid"]==0&&raw["1"].toVariant().toString()==QString(date).remove('-'),"来源拒绝请求或返回了其他日期");
  require(raw["data"].isArray()&&raw["data"].toArray().size()<=100,"来源行数超限");
  auto input=raw["data"].toArray();double total=raw["2"].toDouble(-1);require(raw["2"].isDouble()&&std::floor(total)==total&&total>=input.size()&&total<=1000,"板块总数无效或超过1000");
  QJsonArray rows;QSet<QString> codes;int missing=0,failed=0;
  for(auto value:input){require(value.isObject(),"来源记录无效");auto r=value.toObject();QString code=r["4"].toString(),name=r["16"].toString();
    require(QRegularExpression("^BK[0-9]{4}$").match(code).hasMatch()&&r["3"]==90&&!name.trimmed().isEmpty()&&name.size()<=120&&!codes.contains(code),"来源板块身份无效或重复");codes.insert(code);
    auto dark=cents(r["6"]),visible=cents(r["7"]),combined=cents(r["8"]);QJsonValue ok=QJsonValue::Null;
    if(dark.isString()&&visible.isString()&&combined.isString())ok=add(dark.toString(),visible.toString())==combined.toString();
    if(ok.isNull())++missing;else if(!ok.toBool())++failed;
    rows.append(QJsonObject{{"code",code},{"name",name},{"providerMarket",90},{"venue",QJsonValue::Null},{"price",QJsonValue::Null},{"darkNetCents",dark},{"visibleNetCents",visible},{"combinedNetCents",combined},{"reconciled",ok},{"changeRatio",numeric(r["14"])},{"darkActivityRatio",numeric(r["11"])},{"darkInflowStockRatio",numeric(r["12"])},{"sourceTimeRaw",r.value("5").isUndefined()?QJsonValue(QJsonValue::Null):r.value("5")},{"sourceObservedAt",QJsonValue::Null},{"leaderName",r["15"].toString()},{"leaderCode",r["20"].toString()},{"receivedAt",at}});
  }
  return {{"version","webstock.eastmoney-dark-rank/v1"},{"automaticTrading",false},{"source",source()},{"requestedDate",date},{"tradingDay",date},{"scope",scope},{"receivedAt",at},{"rows",rows},{"coverage",QJsonObject{{"page",page},{"pageSize",100},{"receivedRows",rows.size()},{"totalReported",total},{"complete",page==1&&rows.size()==total},{"paginationSnapshotConsistent",false}}},{"quality",QJsonObject{{"missingCoreRows",missing},{"reconciliationFailures",failed},{"freshness","unknown-source-clock"}}}};
}
void validate(const QJsonObject& s){
  auto schema=s["schema"].toString(),scope=s["scope"].toString(),date=s["date"].toString();
  require((schema=="webstock.rotation-snapshot/v1"||schema=="webstock.rotation-daily/v1")&&(scope=="industry"||scope=="concept")&&dateOK(date),"轮动档案身份无效");
  auto src=s["source"].toObject();require(src["id"]=="eastmoney-darktrade-rank"&&src["provider"]=="Eastmoney"&&src["classification"]=="provider-model-estimate"&&!src["fieldMapping"].toString().isEmpty(),"轮动来源契约不匹配");
  require(s["sourceKey"]==sourceKey(s),"来源版本身份不匹配");auto at=timestamp(s["receivedAt"].toString());
  auto rows=s["rows"].toArray();auto cov=s["coverage"].toObject();require(s["rows"].isArray()&&!rows.isEmpty()&&rows.size()<=1000&&cov["complete"]==true&&cov["totalReported"]==rows.size()&&cov["receivedRows"]==rows.size()&&cov["paginationSnapshotConsistent"]==false,"轮动覆盖不完整");
  QSet<QString> codes;
  for(auto v:rows){auto r=v.toObject();auto code=r["code"].toString();require(v.isObject()&&QRegularExpression("^BK[0-9]{4}$").match(code).hasMatch()&&!codes.contains(code)&&!r["name"].toString().trimmed().isEmpty()&&r["name"].toString().size()<=120&&r["reconciled"]==true,"轮动板块或金额对账无效");codes.insert(code);
    for(auto key:QStringList{"darkNetCents","visibleNetCents","combinedNetCents"})require(r[key].isString()&&QRegularExpression("^-?[0-9]{1,22}$").match(r[key].toString()).hasMatch(),"轮动金额缺失或格式无效");
    require(add(r["darkNetCents"].toString(),r["visibleNetCents"].toString())==canonical(r["combinedNetCents"].toString()),"轮动金额对账不符");
    if(r.contains("receivedAt"))require(timestamp(r["receivedAt"].toString())<=at&&at-timestamp(r["receivedAt"].toString())<=60000,"行采样时刻超出扫描窗口");
    require(r["sourceObservedAt"].isNull()||r["sourceObservedAt"].isUndefined(),"不能将未知来源钟升级为真实行情时刻");
  }
}
QJsonObject window(const QJsonArray& all,const QString& code,const QString& field,int minutes){
  require(QStringList{"darkNetCents","visibleNetCents","combinedNetCents"}.contains(field)&&QList<int>{5,15,30}.contains(minutes),"轮动窗口参数无效");
  QJsonObject unknown{{"deltaCents",QJsonValue::Null},{"reason","数据不足、非盘中采样或采样不连续"}};if(all.isEmpty())return unknown;
  const auto last=all.last().toObject(),row=rowAt(last,code);if(last["schema"]!="webstock.rotation-snapshot/v1"||row.isEmpty())return unknown;
  auto end=clock(row.contains("receivedAt")?row["receivedAt"].toString():last["receivedAt"].toString());if(end.trading<0||end.date!=last["date"].toString())return unknown;
  qint64 distance=75001,target=end.trading-minutes*60000;int start=-1;
  for(int i=0;i<all.size()-1;i++){auto s=all[i].toObject(),r=rowAt(s,code);if(r.isEmpty())continue;auto c=clock(r.contains("receivedAt")?r["receivedAt"].toString():s["receivedAt"].toString());auto diff=qAbs(c.trading-target);if(c.trading>=0&&c.date==end.date&&diff<=75000&&diff<=distance){start=i;distance=diff;}}
  if(start<0)return unknown;Clock previous;bool have=false;QString first;QString from;
  for(int i=start;i<all.size();i++){auto s=all[i].toObject(),r=rowAt(s,code);
    if(s["schema"]!="webstock.rotation-snapshot/v1"||s["date"]!=last["date"]||s["scope"]!=last["scope"]||s["source"]!=last["source"]||s["coverage"].toObject()["totalReported"]!=last["coverage"].toObject()["totalReported"]||s["coverage"].toObject()["complete"]!=true)return unknown;
    auto global=clock(s["receivedAt"].toString());
    if(global.recess&&!r.isEmpty()&&clock(r.contains("receivedAt")?r["receivedAt"].toString():s["receivedAt"].toString()).recess)continue;
    if(r.isEmpty()||r["reconciled"]!=true||!r[field].isString())return unknown;
    auto time=r.contains("receivedAt")?r["receivedAt"].toString():s["receivedAt"].toString();auto c=clock(time);
    if(c.trading<0||c.date!=end.date||(have&&(c.wall<=previous.wall||c.trading<previous.trading||c.trading-previous.trading>150000)))return unknown;
    if(!have){first=r[field].toString();from=time;}have=true;previous=c;
  }
  if(!have)return unknown;auto begin=clock(from);if(end.trading<=begin.trading)return unknown;
  auto delta=subtract(row[field].toString(),first);return {{"deltaCents",delta},{"from",from},{"to",row.contains("receivedAt")?row["receivedAt"]:last["receivedAt"]},{"tradingMinutes",double(end.trading-begin.trading)/60000.},{"reason","实际抓取采样的累计净额变化，不是逐笔流入"}};
}
namespace {
struct Point {Clock c,batch;QString at,date,key,scope;int total=0;bool complete=false,daily=false;QJsonObject row;};
using Points=QVector<Point>;
bool valueOK(const QJsonValue& v){return v.isString()&&QRegularExpression("^-?[0-9]{1,22}$").match(v.toString()).hasMatch();}
QVector<QJsonObject> ordered(const QJsonArray& all){QMap<qint64,QJsonObject> unique;require(all.size()<=10000,"单日采样超过分析上限");for(auto v:all){auto s=v.toObject();unique[timestamp(s["receivedAt"].toString())]=s;}return unique.values().toVector();}
Point point(const QJsonObject& s,const QJsonObject& row){
 Point p;p.batch=clock(s["receivedAt"].toString());p.at=row.contains("receivedAt")?row["receivedAt"].toString():s["receivedAt"].toString();p.c=clock(p.at);p.c.recess=p.c.recess&&p.batch.recess;
 if(p.c.wall>p.batch.wall||p.batch.wall-p.c.wall>60000){p.c.trading=-1;p.c.recess=false;}
 p.date=s["date"].toString();p.key=QString::fromUtf8(encoded(s["source"].toObject()));p.scope=s["scope"].toString();p.total=s["coverage"].toObject()["totalReported"].toInt();p.complete=s["coverage"].toObject()["complete"]==true;p.daily=s["schema"]!="webstock.rotation-snapshot/v1";p.row=row;return p;
}
bool same(const Point& a,const Point& b){return !a.daily&&!b.daily&&a.complete&&b.complete&&a.date==b.date&&a.scope==b.scope&&a.key==b.key&&a.total==b.total&&a.c.date==a.date&&b.c.date==b.date;}
Point withRow(Point p,const QJsonObject& row,QMap<QString,Clock>& clocks){p.row=row;p.at=row.contains("receivedAt")?row["receivedAt"].toString():p.at;if(!clocks.contains(p.at))clocks[p.at]=clock(p.at);p.c=clocks[p.at];p.c.recess=p.c.recess&&p.batch.recess;if(p.c.wall>p.batch.wall||p.batch.wall-p.c.wall>60000){p.c.trading=-1;p.c.recess=false;}return p;}
bool pair(const Point& a,const Point& b){return same(a,b)&&a.c.trading>=0&&b.c.trading>=a.c.trading&&b.c.wall>=a.c.wall&&b.c.trading-a.c.trading<=150000;}
QJsonObject calculate(const Points& p,int end,int minutes,const QString& field,const std::function<bool()>& cancelled={}){
 QJsonObject unknown{{"deltaCents",QJsonValue::Null}};if(end<0)return unknown;const auto& e=p[end];if(e.daily||e.c.trading<0||e.c.date!=e.date||e.row["reconciled"]!=true||!valueOK(e.row[field]))return unknown;
 qint64 distance=75001,target=e.c.trading-minutes*60000;int start=-1;
 for(int i=end-1;i>=0;i--){if(i%64==0)require(!cancelled||!cancelled(),"轮动分析取消");const auto& a=p[i];if(a.batch.date<e.date||(a.batch.date==e.date&&a.batch.trading>=0&&a.batch.trading<target-75000))break;auto d=qAbs(a.c.trading-target);if(a.c.trading<0||a.date!=e.date||d>75000)continue;
   if(d<distance||(d==distance&&start>=0&&(a.c.trading!=p[start].c.trading||a.c.wall>=p[start].c.wall))){start=i;distance=d;}}
 if(start<0)return unknown;int previous=-1;
 for(int i=start;i<=end;i++){if(i%64==0)require(!cancelled||!cancelled(),"轮动分析取消");const auto& a=p[i];if(!same(a,e))return unknown;if(a.c.recess)continue;
   if(a.c.trading<0||a.row["reconciled"]!=true||!valueOK(a.row[field])||(previous>=0&&!pair(p[previous],a)))return unknown;previous=i;}
 double elapsed=(e.c.trading-p[start].c.trading)/60000.;if(elapsed<=0)return unknown;
 auto delta=subtract(e.row[field].toString(),p[start].row[field].toString());return {{"deltaCents",delta},{"speedYuanPerMinute",delta.toDouble()/100./elapsed},{"startIndex",start},{"startAt",p[start].at},{"endAt",e.at},{"elapsedMinutes",elapsed}};
}
void parameters(const QString& field,int minutes){require(QStringList{"combinedNetCents","darkNetCents","visibleNetCents"}.contains(field)&&QList<int>{5,15,30}.contains(minutes),"轮动分析参数无效");}
}
QJsonObject analyze(const QJsonArray& input,const QString& field,int minutes,const QString& now,const std::function<bool()>& cancelled){
 parameters(field,minutes);auto check=[&]{require(!cancelled||!cancelled(),"轮动分析取消");};check();auto all=ordered(input);
 QJsonObject result{{"rows",QJsonArray{}},{"inflow",QJsonArray{}},{"outflow",QJsonArray{}},{"accelerating",QJsonArray{}},{"decelerating",QJsonArray{}},{"eligible",0},{"windowEndAt",QJsonValue::Null},{"sampleCount",all.size()},{"historical",true}};if(all.isEmpty())return result;
 auto last=all.last();result["receivedAt"]=last["receivedAt"];bool future=timestamp(last["receivedAt"].toString())>timestamp(now)+5000;result["future"]=future;
 Points batches;QMap<QString,Points> indexed;for(auto v:last["rows"].toArray())indexed[v.toObject()["code"].toString()]={};
 for(const auto& s:all){check();auto base=point(s,{{"reconciled",true},{field,"0"}});batches.append(base);QMap<QString,Clock> clocks{{base.at,base.c}};QMap<QString,QJsonObject> rows;for(auto v:s["rows"].toArray())rows[v.toObject()["code"].toString()]=v.toObject();for(auto it=indexed.begin();it!=indexed.end();++it)it.value().append(withRow(base,rows.value(it.key()),clocks));}
 int anchor=future||last["schema"]!="webstock.rotation-snapshot/v1"?-1:all.size()-1;
 while(anchor>=0){check();bool found=false;if(!calculate(batches,anchor,minutes,field,cancelled)["deltaCents"].isNull())for(auto it=indexed.cbegin();it!=indexed.cend();++it){check();if(!calculate(it.value(),anchor,minutes,field,cancelled)["deltaCents"].isNull()){found=true;break;}}if(found)break;--anchor;}
 QJsonArray rows;int eligible=0;
 for(auto value:last["rows"].toArray()){
   check();auto r=value.toObject();const auto& points=indexed[r["code"].toString()];auto current=calculate(points,anchor,minutes,field,cancelled);bool valid=current["deltaCents"].isString();auto prior=valid?calculate(points,current["startIndex"].toInt(),minutes,field,cancelled):QJsonObject{};
   for(auto key:QStringList{"deltaCents","speedYuanPerMinute","startAt","endAt","elapsedMinutes"})r[key]=valid?current[key]:QJsonValue(QJsonValue::Null);
   r["speedChange"]=valid&&prior["deltaCents"].isString()?QJsonValue(current["speedYuanPerMinute"].toDouble()-prior["speedYuanPerMinute"].toDouble()):QJsonValue(QJsonValue::Null);
   auto dark=calculate(points,anchor,minutes,"darkNetCents",cancelled),visible=calculate(points,anchor,minutes,"visibleNetCents",cancelled);
   r["divergence"]=dark["deltaCents"].isString()&&visible["deltaCents"].isString()?QJsonValue(dark["deltaCents"].toString().toDouble()*visible["deltaCents"].toString().toDouble()<0):QJsonValue(QJsonValue::Null);
   auto d=current["deltaCents"].toString().toDouble(),p=prior["deltaCents"].toString().toDouble();r["state"]=!valid?"数据不足":!prior["deltaCents"].isString()?"前窗不足":d>0&&p<0?"区间净额变化由负转正":d<0&&p>0?"区间净额变化由正转负":d>0?"净额增加":d<0?"净额减少":"净额未变";if(valid)++eligible;rows.append(r);
 }
 result["rows"]=rows;result["eligible"]=eligible;if(eligible)result["windowEndAt"]=all[anchor]["receivedAt"];
 for(auto entry:QList<QPair<QString,int>>{{"inflow",1},{"outflow",-1},{"accelerating",1},{"decelerating",-1}}){QString key=entry.first=="inflow"||entry.first=="outflow"?"speedYuanPerMinute":"speedChange";QVector<QJsonObject> ranked;for(auto v:rows){auto r=v.toObject();if(r[key].isDouble()&&r[key].toDouble()*entry.second>0)ranked.append(r);}std::sort(ranked.begin(),ranked.end(),[&](const auto& a,const auto& b){double diff=a[key].toDouble()-b[key].toDouble();return diff==0?a["code"].toString()<b["code"].toString():diff*entry.second>0;});QJsonArray out;for(const auto& r:ranked)out.append(r);result[entry.first]=out;}
 return result;
}
QJsonArray series(const QJsonArray& input,const QString& code,const QString& field){
 parameters(field,5);auto all=ordered(input);QJsonArray out;Point previous;bool have=false,interrupted=false;
 for(const auto& s:all){auto p=point(s,rowAt(s,code));if(p.daily)return {};if(p.c.recess&&p.c.date==p.date){if(have&&!same(previous,p))interrupted=true;continue;}if(p.c.trading<0||p.c.date!=p.date){interrupted=true;continue;}
   out.append(QJsonObject{{"at",p.at},{"tradingTimeMs",double(p.c.trading)},{"gapBefore",interrupted||(have&&!pair(previous,p))},{"cumulativeCents",p.row["reconciled"]==true&&valueOK(p.row[field])?p.row[field]:QJsonValue(QJsonValue::Null)},{"changeRatio",p.row["changeRatio"].isDouble()?p.row["changeRatio"]:QJsonValue(QJsonValue::Null)}});previous=p;have=true;interrupted=false;
 }return out;
}
int Store::save(const QJsonObject& s,const std::function<bool()>& cancelled){auto check=[&]{require(!cancelled||!cancelled(),"保存已取消");};check();Db c(file);init(c.db);require(c.db.transaction(),"轮动事务不可用");try{check();int n=insert(c.db,s);check();require(c.db.commit(),"轮动提交失败");return n;}catch(...){c.db.rollback();throw;}}
int Store::saveRound(const QJsonArray& snapshots,const std::function<bool()>& cancelled){
  auto check=[&]{require(!cancelled||!cancelled(),"采样已取消；整轮未提交");};check();
  require(snapshots.size()==2,"一轮须同时包含完整行业和概念榜");
  auto first=snapshots[0].toObject();auto start=first["roundStartedAt"].toString(),end=first["roundCompletedAt"].toString(),date=first["date"].toString();
  require(captureAllowed(date,start,end),"整轮采样超时、跨时段或交易日未知");
  QSet<QString> scopes;
  for(auto v:snapshots){auto s=v.toObject();validate(s);scopes.insert(s["scope"].toString());
    require(s["schema"]=="webstock.rotation-snapshot/v1"&&s["date"]==date&&s["source"]==first["source"]&&s["source"].toObject()==source()&&s["roundStartedAt"]==start&&s["roundCompletedAt"]==end,"双范围轮次或来源身份不一致");
    require(timestamp(s["startedAt"].toString())>=timestamp(start)&&timestamp(s["receivedAt"].toString())>=timestamp(s["startedAt"].toString())&&timestamp(s["receivedAt"].toString())<=timestamp(end),"采样时刻不在本轮窗口");
    for(auto row:s["rows"].toArray())require(timestamp(row.toObject()["receivedAt"].toString())>=timestamp(start),"页面行采样早于本轮");
  }
  require(scopes==QSet<QString>{"industry","concept"},"采样范围重复或缺失");
  check();Db c(file);init(c.db);require(c.db.transaction(),"轮动事务不可用");int total=0;
  try{for(auto v:snapshots){check();total+=insert(c.db,v.toObject());}check();require(c.db.commit(),"整轮采样提交失败");return total;}
  catch(...){c.db.rollback();throw;}
}
int Store::importFile(const QString& path,const std::function<bool()>& cancelled){
  auto check=[&]{require(!cancelled||!cancelled(),"导入已取消；本文件未提交");};check();
  require(QFileInfo(path).absoluteFilePath()!=QFileInfo(file).absoluteFilePath(),"不能导入目标数据库");QFile f(path);require(f.open(QIODevice::ReadOnly)&&f.size()>0&&f.size()<=128LL*1024*1024,"轮动档案须为1字节至128MiB");
  Db c(file);init(c.db);require(c.db.transaction(),"轮动事务不可用");int total=0,lines=0;
  try{
    if(path.endsWith(".json",Qt::CaseInsensitive)){require(f.size()<=2*1024*1024,"单个日榜不得超过2MiB");total+=insert(c.db,parsed(f.readAll()));}
    else while(!f.atEnd()){check();auto line=f.readLine(2*1024*1024+2);require(++lines<=10000&&line.size()<=2*1024*1024&&line.endsWith('\n'),"档案过长或尾行不完整，整个文件未导入");require(!line.trimmed().isEmpty(),"档案含空记录");total+=insert(c.db,parsed(line));}
    check();
    require(c.db.commit(),"轮动导入提交失败");return total;
  }catch(...){c.db.rollback();throw;}
}
QStringList Store::dates() const {if(!QFileInfo::exists(file))return {};Db c(file,true);if(!readSchema(c.db))return {};QSqlQuery q(c.db);require(q.exec("SELECT DISTINCT date FROM rotation ORDER BY date DESC"),"日期读取失败");QStringList out;while(q.next())out<<q.value(0).toString();return out;}
QJsonArray Store::read(const QString& date,const QString& scope,bool daily) const {
  require(dateOK(date)&&(scope=="industry"||scope=="concept"),"查询日期/范围无效");if(!QFileInfo::exists(file))return {};Db c(file,true);if(!readSchema(c.db))return {};QSqlQuery q(c.db);q.prepare("SELECT data FROM rotation WHERE date=? AND scope=? AND daily=? ORDER BY at");q.addBindValue(date);q.addBindValue(scope);q.addBindValue(daily?1:0);require(q.exec(),"轮动读取失败");QJsonArray out;while(q.next()){require(out.size()<10000,"单日档案超过10000次，请分范围导出");auto s=parsed(q.value(0).toString().toUtf8());validate(s);out.append(s);}return out;
}
}
