#pragma once
#include <QCryptographicHash>
#include <QDate>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMap>
#include <QSet>
#include <stdexcept>
#include "quant_parquet_aliases.hpp"

namespace quantParquet {
inline void need(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toUtf8().constData());}
inline QString sha(const QByteArray& bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
inline QJsonObject object(const QByteArray& bytes){QJsonParseError error;auto doc=QJsonDocument::fromJson(bytes,&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"Parquet 来源凭据不是完整JSON对象");return doc.object();}
inline QString latinWidth(QString text){for(auto& c:text){auto u=c.unicode();if((u>=0xff21&&u<=0xff3a)||(u>=0xff41&&u<=0xff5a))c=QChar(u-0xfee0);}return text;}
inline void verifyIdentityName(const QJsonObject& binding,const QJsonObject& original){
 auto sourceName=binding.value("name").toString(),directoryName=binding.value("directoryName").toString(sourceName),kind=binding.value("bindingKind").toString("exact");
 need(!sourceName.isEmpty()&&original.value("name")==directoryName&&!binding.value("evidence").toObject().value("conflict").toBool(),"证券名称或冲突凭据无效");
 if(kind=="audited-source-alias"){
  auto raw=binding.value("aliasUtf8").toString().toUtf8();need(approvedAlias(sha(raw)),"名称关联不是已审核的固定原件凭据");auto proof=object(raw);
  need(proof.value("schema")=="audited-parquet-alias/v1"&&proof.value("sourceName")==sourceName&&proof.value("directoryName")==directoryName&&proof.value("code")==binding.value("code")&&proof.value("nativeId")==binding.value("id")&&proof.value("market")==binding.value("market")&&proof.value("type")==binding.value("type")&&proof.value("contentSha256")==binding.value("contentSha256")&&proof.value("legacyKey")==binding.value("legacyKey"),"固定名称凭据与原目录不一致");return;
 }
 need((kind=="exact"&&sourceName==directoryName)||(kind=="fullwidth-latin"&&sourceName!=directoryName&&latinWidth(sourceName)==latinWidth(directoryName)),"证券名称变化没有获准的精确依据");
}
inline void verifySelection(const QJsonObject& dataset){
 if(!dataset.contains("parquetSelectionEvidence"))return;
 auto e=dataset.value("parquetSelectionEvidence").toObject();
 need(e.value("schema")=="quant-parquet-selection-evidence/v1"&&e.value("conversion")=="explicit-offline-parquet-selection-to-bars","未知Parquet选择凭据");
 auto raw=e.value("manifestUtf8").toString().toUtf8();need(sha(raw)==e.value("manifestFileSha256").toString(),"Parquet清单原文摘要不一致");auto m=object(raw);
 need(m.value("schema")=="webstock.quant.dataset.v1"&&m.value("datasetId")==dataset.value("sourceDatasetId")&&m.value("asOf")==dataset.value("asOf")&&m.value("adjustmentMode")==dataset.value("adjustmentMode")&&m.value("universe").toObject().value("membershipMode")==dataset.value("membershipMode")&&object(dataset.value("source").toString().toUtf8())==m.value("source").toObject(),"Parquet来源口径不一致");
 need(dataset.value("period")=="day"&&dataset.value("volumeUnit")=="original-unit-unverified"&&!e.value("nativeLimitation").toString().isEmpty(),"日频/原始量纲限制丢失");
 auto scope=e.value("selection").toObject();auto start=scope.value("start").toString(),end=scope.value("end").toString();need(QDate::fromString(start,Qt::ISODate).isValid()&&QDate::fromString(end,Qt::ISODate).isValid()&&start<=end,"选择日期无效");
 QSet<QString> codes;for(auto v:scope.value("codes").toArray()){need(v.isString()&&!codes.contains(v.toString()),"选择证券重复");codes.insert(v.toString());}need(!codes.isEmpty()&&codes.size()<=1200,"必须明确选择证券范围");
 QMap<QString,QJsonObject> specs,bindings;for(auto v:m.value("files").toArray()){auto f=v.toObject();auto path=f.value("path").toString();if(path.startsWith("raw/")&&path.endsWith(".parquet")){need(!specs.contains(path),"清单附件重复");specs[path]=f;}}
 for(auto v:e.value("identities").toArray()){auto b=v.toObject();auto code=b.value("code").toString();auto identityRaw=b.value("contentUtf8").toString().toUtf8();need(sha(identityRaw)==b.value("contentSha256").toString(),"证券目录原文摘要不一致");auto original=object(identityRaw);auto market=b.value("market").toString(),type=b.value("type").toString();need(codes.contains(code)&&!bindings.contains(code)&&QStringList{"SH","SZ","BJ"}.contains(market)&&QStringList{"stock","etf"}.contains(type)&&b.value("id").toString()==market+":"+type+":"+code&&original.value("id")==b.value("id")&&original.value("market")==b.value("market")&&original.value("type")==type&&original.value("canOpen").toBool()&&original.value("code")==code,"证券市场/类型无明确目录凭据");verifyIdentityName(b,original);bindings[code]=b;}
 need(bindings.size()==codes.size()&&e.value("identityDbSha256").toString().size()==64,"证券目录凭据不完整");
 for(auto b:bindings)if(b.value("bindingKind")=="audited-source-alias"){
  auto proof=object(b.value("aliasUtf8").toString().toUtf8());need(proof.value("group")==scope.value("group")&&proof.value("manifestSha256")==e.value("manifestFileSha256"),"名称凭据不能跨文件组或清单复用");
  bool matched=false;for(auto v:e.value("artifacts").toArray()){auto f=v.toObject();if(f.value("code")!=b.value("code"))continue;need(proof.value("path").toString()==scope.value("group").toString()+"/"+f.value("path").toString()&&proof.value("artifactSha256")==f.value("sha256"),"名称凭据对应的原Parquet已变化");matched=true;}need(matched,"名称凭据缺少原Parquet");
 }
 QSet<QString> artifactCodes;int originalRows=0;for(auto v:e.value("artifacts").toArray()){auto f=v.toObject();auto path=f.value("path").toString();auto s=specs.value(path);auto code=f.value("code").toString();auto decoded=QByteArray::fromBase64Encoding(f.value("bytesBase64").toString().toLatin1(),QByteArray::AbortOnBase64DecodingErrors);need(codes.contains(code)&&!artifactCodes.contains(code)&&s.value("code")==code&&s.value("name")==bindings.value(code).value("name")&&s.value("sha256")==f.value("sha256")&&s.value("rows")==f.value("rows")&&bool(decoded)&&sha(decoded.decoded)==f.value("sha256").toString(),"Parquet附件、证券或清单摘要不一致");artifactCodes.insert(code);originalRows+=s.value("rows").toInt();}
 need(artifactCodes==codes,"选择的原始附件不完整");auto barsRaw=e.value("barsUtf8").toString().toUtf8();QJsonParseError error;auto barsDoc=QJsonDocument::fromJson(barsRaw,&error);auto bars=dataset.value("bars").toArray();need(sha(barsRaw)==e.value("barsSha256").toString()&&error.error==QJsonParseError::NoError&&barsDoc.isArray()&&barsDoc.array()==bars&&!bars.isEmpty()&&bars.size()<=originalRows,"选择后的日线凭据不一致");QSet<QString> used;
 for(auto v:bars){auto b=v.toObject();auto code=b.value("code").toString(),date=b.value("date").toString();need(codes.contains(code)&&b.value("name")==bindings.value(code).value("name")&&date>=start&&date<=end,"日线超出明确选择范围/身份");used.insert(code);}need(used==codes,"选定证券没有完整对应日线");
}
}
