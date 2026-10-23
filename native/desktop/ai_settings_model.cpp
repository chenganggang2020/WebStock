#include "ai_settings_model.hpp"
#include "ai_settings_capabilities.hpp"
#include <QJsonDocument>
#include <QRegularExpression>
#include <QUrl>
#include <QCryptographicHash>
#include <stdexcept>
namespace aiSettings {
void require(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
QString hash(const QByteArray& b){return QString::fromLatin1(QCryptographicHash::hash(b,QCryptographicHash::Sha256).toHex());}
static bool sensitive(const QString& s){return QRegularExpression("(?i)(sk-[a-z0-9_-]+|bearer\\s|api[_-]?key|password|token=|authorization)").match(s).hasMatch();}
QJsonObject preferences(const QJsonObject& i){
 for(auto key:{"provider","model","endpoint","apiUrl","baseUrl"})require(!i.contains(key)||i.value(key).isString(),"文本字段无效");
 QString provider=i.value("provider").toString("manual-handoff"),model=i.value("model").toString(),endpoint=i.value("endpoint").toString(i.value("apiUrl").toString());
 require(provider=="manual-handoff"||provider=="openai"||provider=="openai-compatible","供应商选项无效");
 require(model.isEmpty()||(!sensitive(model)&&QRegularExpression("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$").match(model).hasMatch()),"模型标识无效或含敏感内容");
 if(endpoint.isEmpty()&&!i.value("baseUrl").toString().isEmpty()){endpoint=i.value("baseUrl").toString();while(endpoint.endsWith('/'))endpoint.chop(1);endpoint+="/chat/completions";}
 if(!endpoint.isEmpty()){
  QUrl u(endpoint,QUrl::StrictMode);QString host=u.host().toLower();
  require(endpoint.size()<=512&&!sensitive(endpoint)&&u.isValid()&&u.scheme()=="https"&&u.userInfo().isEmpty()&&!u.hasQuery()&&!u.hasFragment()&&u.port(-1)==-1,"接口须为无凭据、查询参数和片段的 HTTPS 地址");
  require(QRegularExpression("^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$").match(host).hasMatch()&&!host.endsWith(".local")&&!host.endsWith(".lan")&&!host.endsWith(".internal")&&!host.endsWith(".localhost")&&!host.endsWith(".invalid")&&!u.path().contains('%')&&!endpoint.contains('%'),"接口须使用公开域名");
  require(provider!="openai"||(host=="api.openai.com"&&u.path()=="/v1/chat/completions"),"OpenAI 接口地址不匹配");
  endpoint=u.toString(QUrl::FullyEncoded);
 }
 auto integer=[&](const char* key,const char* alias,int fallback,int lo,int hi){auto v=i.contains(key)?i.value(key):i.value(alias);if(v.isUndefined())return fallback;require(v.isDouble()&&v.toDouble()==v.toInt()&&v.toInt()>=lo&&v.toInt()<=hi,"数值范围无效");return v.toInt();};
 int timeout=integer("timeoutMs","timeout",120000,1000,300000),tokens=integer("maxCompletionTokens","maxTokens",4096,128,65536);
 auto boolean=[&](const char* key){auto v=i.value(key);require(v.isUndefined()||v.isBool(),"开关类型无效");return v.toBool();};
 auto temperature=i.value("temperature");require(temperature.isUndefined()||temperature.isNull()||(temperature.isDouble()&&temperature.toDouble()>=0&&temperature.toDouble()<=2),"温度范围无效");bool send=boolean("sendTemperature");require(!send||temperature.isDouble(),"发送温度时须填写温度");
 return {{"provider",provider},{"model",model},{"endpoint",endpoint},{"timeoutMs",timeout},{"maxCompletionTokens",tokens},{"temperature",temperature.isDouble()?temperature:QJsonValue(QJsonValue::Null)},{"sendTemperature",send},{"enabledPreference",boolean("enabledPreference")}};
}
QJsonObject empty(){return {{"schema","native-ai-settings/v1"},{"revision",0},{"preferences",preferences({})},{"capabilities",QJsonArray{}},{"savedAt",QJsonValue::Null}};}
QJsonObject sanitize(const QJsonObject& i){require(!i.contains("preferences")||i.value("preferences").isObject(),"配置对象无效");for(auto key:{"capabilities","models"})require(!i.contains(key)||i.value(key).isArray(),"能力数组无效");return {{"schema","native-ai-settings/v1"},{"revision",0},{"preferences",preferences(i.contains("preferences")?i.value("preferences").toObject():i)},{"capabilities",reported(i.contains("capabilities")?i.value("capabilities").toArray():i.value("models").toArray(),"import")},{"savedAt",QJsonValue::Null}};}
QJsonObject parse(const QByteArray& bytes){require(!bytes.isEmpty()&&bytes.size()<=1024*1024,"导入须为 1MiB 内 JSON");QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);require(e.error==QJsonParseError::NoError&&d.isObject(),"导入 JSON 无效");return sanitize(d.object());}
QJsonObject status(const QJsonObject& input){auto p=preferences(input);return {{"configuration",p.value("provider")=="manual-handoff"?"manual-handoff":(!p.value("model").toString().isEmpty()&&!p.value("endpoint").toString().isEmpty()?"configured":"incomplete")},{"credentialConfigured",false},{"credentialStore","not-connected"},{"networkAuthorized",false},{"connectivity","not-tested"},{"executionConsumer","not-connected"}};}
}
