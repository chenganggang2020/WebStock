#include "paper_policy_settings.hpp"
#include "portfolio_mirror_model.hpp"
namespace paperPolicy {
namespace {
void need(bool ok,const char* code){if(!ok)throw std::runtime_error(code);}
QString string(const QJsonObject& o,QString k){auto v=o.value(k);need(v.isString()&&!v.toString().trimmed().isEmpty()&&v.toString().size()<=200,"TEXT_REQUIRED");return v.toString();}
QString time(QString s){
 need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch(),"TIME_INVALID");
 auto t=QDateTime::fromString(s,Qt::ISODateWithMs);need(t.isValid()&&t.date().toString("yyyy-MM-dd")==s.left(10)&&t.time().toString("HH:mm:ss")==s.mid(11,8)&&std::abs(t.offsetFromUtc())<=14*3600,"TIME_INVALID");
 return t.toUTC().toString("yyyy-MM-dd'T'HH:mm:ss.zzz'Z'");
}
QJsonObject binding(QJsonObject account){need(account.value("type")=="paper","PAPER_ACCOUNT_REQUIRED");return {{"id",string(account,"id")},{"name",string(account,"name")},{"type","paper"}};}
void fields(const QJsonObject&o,QStringList names){auto keys=o.keys();keys.sort();names.sort();need(keys==names,"UNKNOWN_OR_MISSING_FIELD");}
void status(QString s){need(s=="active"||s=="paused","EXPLICIT_STATUS_REQUIRED");}
double weight(QJsonValue v){double n=v.toDouble(std::nan(""));need(v.isDouble()&&std::isfinite(n)&&n>=.000001&&n<=1,"EXPLICIT_WEIGHT_REQUIRED");return n;}
}
QJsonObject empty(){return {{"schema","native-paper-policy-settings/v1"},{"revision",0},{"records",QJsonArray{}}};}
QJsonObject validate(const QJsonObject& a){
 need(QJsonDocument(a).toJson(QJsonDocument::Compact).size()<=4*1024*1024,"SETTINGS_TOO_LARGE");portfolioMirror::depth(a);
 fields(a,{"schema","revision","records"});need(a.value("schema")=="native-paper-policy-settings/v1"&&a.value("records").isArray(),"SETTINGS_SCHEMA");
 auto rows=a.value("records").toArray();need(rows.size()<=500&&a.value("revision").isDouble()&&a.value("revision").toDouble()==rows.size(),"SETTINGS_REVISION");
 QString previous="genesis",stamp;int version=0;
 for(auto value:rows){
  need(value.isObject(),"RECORD_INVALID");auto r=value.toObject();fields(r,{"schema","version","accountBinding","status","maxSingleWeight","source","savedAt","previousRevision","revision"});
  need(r.value("schema")=="native-paper-policy-record/v1"&&r.value("version").isDouble()&&r.value("version").toDouble()==++version&&r.value("previousRevision")==previous,"RECORD_CHAIN");
  need(r.value("accountBinding").isObject()&&binding(r.value("accountBinding").toObject())==r.value("accountBinding").toObject(),"ACCOUNT_BINDING");
  status(string(r,"status"));weight(r.value("maxSingleWeight"));need(r.value("source")=="explicit-user-paper-settings","POLICY_SOURCE");
  auto saved=time(string(r,"savedAt"));need(saved==r.value("savedAt")&&(stamp.isEmpty()||saved>=stamp),"TIME_INVALID");stamp=saved;
  previous=string(r,"revision");r.remove("revision");need(previous=="sha256:"+portfolioMirror::hash(r),"RECORD_HASH");
 }
 return a;
}
QJsonObject latest(const QJsonObject&a,const QString&id){validate(a);QJsonObject result;for(auto v:a.value("records").toArray()){auto r=v.toObject();if(r.value("accountBinding").toObject().value("id")==id)result=r;}return result;}
Store::Store(QString file):path(std::move(file)){need(QFileInfo(path).fileName()=="paper-monitor-settings.json","DEDICATED_SETTINGS_PATH_REQUIRED");}
QJsonObject Store::read()const{
 QFile file(path);if(!file.exists())return empty();need(file.open(QIODevice::ReadOnly)&&file.size()<=4*1024*1024,"SETTINGS_READ_FAILED");
 return validate(portfolioMirror::parse(file.readAll()));
}
QJsonObject Store::save(const QJsonObject&account,const QString&state,const QJsonValue&limit,qint64 expected,const QString&savedAt,bool explicitConfirmation)const{
 need(explicitConfirmation,"USER_CONFIRMATION_REQUIRED");auto identity=binding(account);status(state);double max=weight(limit);QString saved=time(savedAt);
 need(QDir().mkpath(QFileInfo(path).absolutePath()),"SETTINGS_DIRECTORY");QLockFile lock(path+".lock");need(lock.tryLock(100),"SETTINGS_BUSY");
 auto a=read();need(a.value("revision").toDouble()==expected,"SETTINGS_CAS_CONFLICT");auto rows=a.value("records").toArray();need(rows.size()<500,"SETTINGS_FULL");
 QString previous=rows.isEmpty()?"genesis":rows.last().toObject().value("revision").toString();
 QJsonObject r{{"schema","native-paper-policy-record/v1"},{"version",double(expected+1)},{"accountBinding",identity},{"status",state},{"maxSingleWeight",max},{"source","explicit-user-paper-settings"},{"savedAt",saved},{"previousRevision",previous}};
 r["revision"]="sha256:"+portfolioMirror::hash(r);rows.append(r);a["records"]=rows;a["revision"]=double(expected+1);validate(a);
 auto bytes=QJsonDocument(a).toJson(QJsonDocument::Compact);QSaveFile file(path);need(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"SETTINGS_WRITE_FAILED");need(read()==a,"SETTINGS_READBACK_FAILED");return a;
}
QJsonObject project(const QJsonObject&host,const QString&id,const QJsonObject&archive,const QString&cut){
 QJsonObject out{{"status","blocked"},{"reason","POLICY_MISSING"},{"hostSnapshot",QJsonValue::Null},{"monitorPolicy",QJsonValue::Null},{"automaticTrading",false}};
 try{
  need(host.value("schema")=="native-paper-monitor-host-snapshot/v1"&&host.value("accounts").isArray(),"HOST_SCHEMA");need(QJsonDocument(host).toJson(QJsonDocument::Compact).size()<=4*1024*1024,"HOST_TOO_LARGE");portfolioMirror::depth(host);
  auto r=latest(archive,id);need(!r.isEmpty(),"POLICY_MISSING");need(r.value("savedAt").toString()<=time(cut),"POLICY_AFTER_CUT");
  auto rows=host.value("accounts").toArray();int match=-1;QSet<QString>seen;
  for(int i=0;i<rows.size();++i){need(rows[i].isObject(),"ACCOUNT_IDENTITY");auto a=rows[i].toObject();QString key=string(a,"id");need(!seen.contains(key),"ACCOUNT_IDENTITY");seen.insert(key);if(key==id)match=i;}
  need(match>=0,"ACCOUNT_MISSING");auto account=rows[match].toObject();need(binding(account)==r.value("accountBinding").toObject(),"ACCOUNT_BINDING_CHANGED");
  need(r.value("status")=="active","POLICY_PAUSED");need(!account.contains("paperMonitorStateEvidence"),"RESERVED_STATE_FIELD");
  account["paperMonitorStateEvidence"]=QJsonObject{{"originalStatus",account.contains("status")?account.value("status"):QJsonValue(QJsonValue::Null)},{"source",r.value("source")},{"revision",r.value("revision")}};
  account["status"]=r.value("status");rows[match]=account;auto copy=host;copy["accounts"]=rows;
  QJsonObject policy{{"schema","native-paper-monitor-policy/v1"},{"accountId",id},{"maxSingleWeight",r.value("maxSingleWeight")},{"source",r.value("source")},{"revision",r.value("revision")},{"version",r.value("version")},{"accountBinding",r.value("accountBinding")},{"savedAt",r.value("savedAt")}};
  out["status"]="configured";out["reason"]="EXPLICIT_USER_SETTINGS";out["hostSnapshot"]=copy;out["monitorPolicy"]=policy;
 }catch(const std::exception&e){out["reason"]=QString::fromUtf8(e.what());}return out;
}
}
