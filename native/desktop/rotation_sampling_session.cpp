#include "rotation_sampling_session.hpp"
#include <QTimeZone>
#include <cmath>
namespace rotationSampling {
namespace {
const QString pin="ce23935fd36d65a39a38296de97e9c6c5cbf87dd01254b95d937752fcfe29f52";
struct Problem {QString code;};
void need(bool ok,QString code){if(!ok)throw Problem{code};}
QByteArray read(QString dir,QString name){
 need(QRegularExpression("^[a-z0-9-]+\\.(json|html|docx|pdf)$").match(name).hasMatch(),"EVIDENCE_PATH");
 QFile file(QDir(dir).filePath(name));need(file.open(QIODevice::ReadOnly)&&file.size()<=2*1024*1024,"EVIDENCE_MISSING");return file.readAll();
}
QString sha(const QByteArray& data){return QCryptographicHash::hash(data,QCryptographicHash::Sha256).toHex();}
QDateTime time(QString s){
 need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch(),"CUT_INVALID");
 auto t=QDateTime::fromString(s,Qt::ISODateWithMs);need(t.isValid()&&t.date().toString("yyyy-MM-dd")==s.left(10)&&t.time().toString("HH:mm:ss")==s.mid(11,8)&&std::abs(t.offsetFromUtc())<=14*3600,"CUT_INVALID");return t.toUTC();
}
}
QJsonObject session(const QString& dir,const QString& start,const QString& end){
 QJsonObject out{{"schema","native-rotation-session/v1"},{"allowed",false},{"known",false},{"source","official-exchange-regular-schedule"},{"evidenceId","sha256:"+pin},{"liveExchangeStatusVerified",false},{"automaticTrading",false},{"sourceTime",QJsonValue::Null},{"attemptedAt",start},{"checkedAt",end}};
 try{
  auto a=time(start),b=time(end);need(a<=b&&a.msecsTo(b)<=40000,"ROUND_DEADLINE");
  auto raw=read(dir,"catalog.json");need(sha(raw)==pin,"EVIDENCE_CHANGED");auto c=QJsonDocument::fromJson(raw).object();
  for(auto src:c.value("sources").toArray())for(auto v:src.toObject().value("files").toArray()){
   auto f=v.toObject();need(sha(read(dir,f.value("file").toString()))==f.value("sha256").toString(),"EVIDENCE_CHANGED");
  }
  out["auditedAt"]=c.value("auditedAt");out["calendarFrom"]=c.value("calendarFrom");out["calendarThrough"]=c.value("calendarThrough");out["sessionFrom"]=c.value("sessionFrom");out["sessionThrough"]=c.value("sessionThrough");
  auto x=a.toOffsetFromUtc(28800),y=b.toOffsetFromUtc(28800);QString day=x.date().toString(Qt::ISODate);out["date"]=day;
  need(x.date()==y.date(),"DATE_BOUNDARY");need(day>=c.value("calendarFrom").toString()&&day<=c.value("calendarThrough").toString(),"YEAR_NOT_COVERED");
  need(day>=c.value("sessionFrom").toString()&&day<=c.value("sessionThrough").toString(),"RULE_PERIOD_NOT_COVERED");out["known"]=true;
  for(auto v:c.value("holidays").toArray()){auto r=v.toArray();need(day<r[0].toString()||day>r[1].toString(),"HOLIDAY");}
  need(x.date().dayOfWeek()<=5,"WEEKEND");QString from=x.time().toString("HH:mm:ss.zzz"),to=y.time().toString("HH:mm:ss.zzz");
  bool allowed=false;for(auto v:c.value("continuous").toArray()){auto r=v.toArray();if(from>=r[0].toString()+".000"&&to<r[1].toString()+".000"){allowed=true;out["validBefore"]=day+"T"+r[1].toString()+"+08:00";}}
  need(allowed,"NOT_CONTINUOUS");out["allowed"]=true;out["reason"]="CONTINUOUS";
 }catch(const Problem& p){out["reason"]=p.code;}catch(...){out["reason"]="EVIDENCE_INVALID";}
 return out;
}
}
