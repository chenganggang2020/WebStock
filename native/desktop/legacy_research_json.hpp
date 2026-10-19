#pragma once
#include "watchlist_workspace_model.hpp"
#include "watchlist_backup_model.hpp"
#include <QJsonDocument>
#include <QVector>
#include <QCryptographicHash>
#include <charconv>
#include <cmath>

namespace legacyResearchJson {
using watchlistWorkspace::need;
struct Value {
 enum Kind {Null,Boolean,Number,String,Array,Object} kind=Null;
 QString string;double number=0;bool boolean=false;
 QVector<Value> values;QVector<QString> keys;
 const Value* get(QString key)const{for(int i=0;i<keys.size();++i)if(keys[i]==key)return &values[i];return nullptr;}
};
inline QString number(double n){
 need(std::isfinite(n),"旧JSON数值不是有限值");if(n==0)return "0";
 char buffer[64];auto out=std::to_chars(buffer,buffer+64,n,std::chars_format::general);need(out.ec==std::errc{},"旧JSON数值编码失败");
 QString raw=QString::fromLatin1(buffer,int(out.ptr-buffer));bool negative=raw.startsWith('-');if(negative)raw.remove(0,1);
 int e=raw.indexOf('e'),exponent=e<0?0:raw.mid(e+1).toInt();if(e>=0)raw=raw.left(e);int dot=raw.indexOf('.');if(dot<0)dot=raw.size();else raw.remove(dot,1);dot+=exponent;
 QString value;if(std::abs(n)>=1e21||std::abs(n)<1e-6){int power=dot-1;value=raw.left(1);if(raw.size()>1)value+="."+raw.mid(1);value+="e"+(power>=0?QString("+"):QString())+QString::number(power);}
 else if(dot<=0)value="0."+QString(-dot,'0')+raw;else if(dot>=raw.size())value=raw+QString(dot-raw.size(),'0');else value=raw.left(dot)+"."+raw.mid(dot);
 return (negative?"-":"")+value;
}
inline bool index(QString key,quint64* n){bool ok=false;auto value=key.toULongLong(&ok);if(!ok||value>=4294967295ULL||QString::number(value)!=key)return false;*n=value;return true;}
inline QString encode(const Value& v){
 using watchlistWorkspace::quote;
 switch(v.kind){case Value::Null:return "null";case Value::Boolean:return v.boolean?"true":"false";case Value::Number:return number(v.number);case Value::String:return quote(v.string);case Value::Array:{QStringList values;for(const auto&x:v.values)values<<encode(x);return "["+values.join(',')+"]";}
 case Value::Object:{QVector<QPair<quint64,int>> indexed;QVector<int> plain;for(int i=0;i<v.keys.size();++i){quint64 n;if(index(v.keys[i],&n))indexed.append({n,i});else plain.append(i);}std::sort(indexed.begin(),indexed.end());QStringList parts;for(auto pair:indexed)parts<<quote(v.keys[pair.second])+":"+encode(v.values[pair.second]);for(int i:plain)parts<<quote(v.keys[i])+":"+encode(v.values[i]);return "{"+parts.join(',')+"}";}}
 return {};
}
class Parser {
 QString source;int at=0;
 void ws(){while(at<source.size()&&QString(" \r\n\t").contains(source[at]))++at;}
 QString text(){ws();need(at<source.size()&&source[at]=='"',"旧JSON文本缺失");int begin=at++;while(at<source.size()){auto c=source[at++];if(c=='\\'){need(at<source.size(),"旧JSON转义缺失");++at;}else if(c=='"'){auto raw=source.mid(begin,at-begin);auto doc=QJsonDocument::fromJson(("["+raw+"]").toUtf8());need(doc.isArray()&&doc.array().size()==1,"旧JSON转义错误");return doc.array()[0].toString();}}need(false,"旧JSON文本未闭合");return {};}
 Value value(int depth){need(depth<=64,"旧JSON过深");ws();need(at<source.size(),"旧JSON值缺失");Value out;auto c=source[at];
  if(c=='"'){out.kind=Value::String;out.string=text();return out;}
  if(c=='{'||c=='['){out.kind=c=='{'?Value::Object:Value::Array;auto end=c=='{'?'}':']';++at;ws();if(at<source.size()&&source[at]==end){++at;return out;}QSet<QString> seen;
   for(;;){ws();if(out.kind==Value::Object){auto key=text();need(!seen.contains(key),"旧JSON重复键");seen.insert(key);out.keys.append(key);ws();need(at<source.size()&&source[at++]==':',"旧JSON冒号缺失");}out.values.append(value(depth+1));ws();need(at<source.size(),"旧JSON容器未闭合");if(source[at]==end){++at;return out;}need(source[at++]==',',"旧JSON逗号缺失");}
  }
  int begin=at;while(at<source.size()&&!QString(" \r\n\t,]}").contains(source[at]))++at;auto token=source.mid(begin,at-begin);
  if(token=="null")out.kind=Value::Null;else if(token=="true"||token=="false"){out.kind=Value::Boolean;out.boolean=token=="true";}else{bool ok;out.kind=Value::Number;out.number=token.toDouble(&ok);need(ok&&std::isfinite(out.number),"旧JSON数字无效");}return out;
 }
public:
 explicit Parser(QString input):source(std::move(input)){}
 Value run(){need(!source.isEmpty()&&source.toUtf8().size()<=32*1024*1024,"旧JSON完整上限32MiB");watchlistBackup::JsonGate{source}.run();auto out=value(0);ws();need(at==source.size(),"旧JSON尾部多余内容");return out;}
};
inline QString digest(const Value& v){return QString::fromLatin1(QCryptographicHash::hash(encode(v).toUtf8(),QCryptographicHash::Sha256).toHex());}
inline QString contentHash(const Value& payload){
 need(payload.kind==Value::Object,"旧版本payload缺失");Value selected;selected.kind=Value::Object;
 for(const auto&key:QStringList{"evidenceIds","relations","gaps","analysis"})if(auto item=payload.get(key)){selected.keys.append(key);selected.values.append(*item);}return digest(selected);
}
}

