#include "paper_session_provider.hpp"
#include "portfolio_mirror_model.hpp"
#include <QTimeZone>
namespace paperSession {
namespace {
const QString pin="ce23935fd36d65a39a38296de97e9c6c5cbf87dd01254b95d937752fcfe29f52";
struct Problem{QString code;};
void need(bool ok,QString code){if(!ok)throw Problem{code};}
QByteArray read(QString dir,QString file){
 need(QRegularExpression("^[a-z0-9-]+\\.(json|html|docx|pdf)$").match(file).hasMatch(),"EVIDENCE_PATH");
 QFile f(QDir(dir).filePath(file));need(f.open(QIODevice::ReadOnly)&&f.size()<=2*1024*1024,"EVIDENCE_MISSING");
 return f.readAll();
}
QDateTime time(QString s){
 need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch(),"CUT_INVALID");
 auto t=QDateTime::fromString(s,Qt::ISODateWithMs);
 need(t.isValid()&&t.date().toString("yyyy-MM-dd")==s.left(10)&&t.time().toString("HH:mm:ss")==s.mid(11,8)&&std::abs(t.offsetFromUtc())<=14*3600,"CUT_INVALID");return t.toUTC();
}
}
QJsonObject evaluate(const QString& dir,const QString& cut,const QJsonArray& ids){
 QJsonObject out{{"schema","native-paper-session-evidence/v1"},{"known",false},{"open",false},{"continuous",false},{"calendarKnown",false},{"scheduledOpen",false},{"date",QJsonValue::Null},{"checkedAt",QJsonValue::Null},{"source","official-exchange-regular-schedule"},{"evidenceId","sha256:"+pin},{"basis","official-published-regular-schedule"},{"liveExchangeStatusVerified",false},{"automaticTrading",false},{"reason","EVIDENCE_MISSING"}};
 try{
  auto utc=time(cut),local=utc.toTimeZone(QTimeZone::fromSecondsAheadOfUtc(8*3600));
  QString date=local.date().toString("yyyy-MM-dd");out["date"]=date;out["checkedAt"]=utc.toString("yyyy-MM-dd'T'HH:mm:ss.zzz'Z'");
  auto raw=read(dir,"catalog.json");need(portfolioMirror::sha(raw)==pin,"EVIDENCE_CHANGED");auto c=portfolioMirror::parse(raw);
  for(auto source:c.value("sources").toArray())for(auto item:source.toObject().value("files").toArray()){
   auto f=item.toObject();need(portfolioMirror::sha(read(dir,f.value("file").toString()))==f.value("sha256").toString(),"EVIDENCE_CHANGED");
  }
  out["auditedAt"]=c.value("auditedAt");out["calendarFrom"]=c.value("calendarFrom");out["calendarThrough"]=c.value("calendarThrough");out["sessionFrom"]=c.value("sessionFrom");out["sessionThrough"]=c.value("sessionThrough");
  need(!ids.isEmpty()&&ids.size()<=10000,"IDENTITY_MISSING");QSet<QString> markets,identities;QJsonArray covered;
  for(auto value:ids){
   need(value.isString()&&portfolioMirror::fullId(value.toString()),"IDENTITY_INVALID");auto parts=value.toString().split(':');bool found=false;
   for(auto entry:c.value("markets").toArray()){auto m=entry.toObject();if(m.value("exchange")==parts[0]&&m.value("types").toArray().contains(parts[1]))found=true;}
   need(found,"MARKET_NOT_COVERED");markets.insert(parts[0]);identities.insert(value.toString());
  }
  auto names=markets.values();names.sort();for(auto name:names)covered.append(name);out["coveredExchanges"]=covered;
  auto securities=identities.values();securities.sort();QJsonArray bound;for(auto id:securities)bound.append(id);out["instrumentIds"]=bound;
  need(date>=c.value("calendarFrom").toString()&&date<=c.value("calendarThrough").toString(),"YEAR_NOT_COVERED");
  bool holiday=false;for(auto v:c.value("holidays").toArray()){auto range=v.toArray();holiday=holiday||(date>=range[0].toString()&&date<=range[1].toString());}
  // This weekday rule is used only after checking the pinned official rules AND annual notices.
  bool scheduled=local.date().dayOfWeek()<=5&&!holiday;out["calendarKnown"]=true;out["scheduledOpen"]=scheduled;
  need(date>=c.value("sessionFrom").toString()&&date<=c.value("sessionThrough").toString(),"RULE_PERIOD_NOT_COVERED");
  out["known"]=true;out["open"]=scheduled;
  if(!scheduled){out["reason"]=holiday?"HOLIDAY":"WEEKEND";return out;}
  QString clock=local.time().toString("HH:mm:ss.zzz");bool continuous=false;QString end;
  for(auto v:c.value("continuous").toArray()){auto range=v.toArray();if(clock>=range[0].toString()+".000"&&clock<range[1].toString()+".000"){continuous=true;end=range[1].toString();}}
  out["continuous"]=continuous;
  QString phase=clock<"09:15:00.000"?"before-open":clock<"09:25:00.000"?"opening-auction":clock<"09:30:00.000"?"pre-continuous":clock<"11:30:00.000"?"continuous":clock<"13:00:00.000"?"lunch":clock<"14:57:00.000"?"continuous":clock<"15:00:00.000"?"closing-auction":"after-close";
  out["phase"]=phase;out["reason"]=continuous?"CONTINUOUS":"NOT_CONTINUOUS";out["validBefore"]=continuous?QJsonValue(date+"T"+end+"+08:00"):QJsonValue(QJsonValue::Null);
 }catch(const Problem&p){out["reason"]=p.code;}catch(const std::exception&){out["reason"]="EVIDENCE_INVALID";}
 return out;
}
}
