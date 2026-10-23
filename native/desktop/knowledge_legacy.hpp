#pragma once
#include "knowledge_retrieval.hpp"
#include "research_runs_model.hpp"
#include <QCryptographicHash>
#include <QFileInfo>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QUuid>
#include <algorithm>
#include <climits>
namespace knowledgeLegacy {
inline void need(bool ok,const char*message){if(!ok)throw std::runtime_error(message);}
inline QString hash(QByteArray bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
inline void keys(QJsonObject value,QStringList expected){expected.sort();need(value.keys()==expected,"旧知识档案字段不完整或含未知字段");}
inline int integer(QJsonValue value,int minimum=0){need(value.isDouble()&&value.toDouble()>=minimum&&value.toDouble()<=INT_MAX&&value.toDouble()==value.toInt(-1),"旧知识整数身份/位置无效");return value.toInt();}
inline void sourceValid(QJsonObject source){
 keys(source,{"id","source_key","source_type","title","author","source_url","published_at","tags_json","stock_codes_json","sectors_json","content_hash","original_content","created_at","updated_at"});integer(source["id"],1);
 for(auto name:source.keys())if(name!="id")need(source[name].isString(),"旧知识来源字段类型改变");
 need(!source["source_key"].toString().isEmpty()&&source["content_hash"]==hash(source["original_content"].toString().toUtf8()),"旧知识来源身份或正文摘要不符");
 need(source["original_content"].toString().size()<=800000,"旧知识正文超出原消费者上限，未截断");
}
inline void pieceValid(QJsonObject piece){
 keys(piece,{"schema","sourceRow","chunks"});need(piece["schema"]=="native-legacy-knowledge-source/v1"&&piece["sourceRow"].isObject()&&piece["chunks"].isArray(),"旧知识来源档案协议无效");
 auto source=piece["sourceRow"].toObject();sourceValid(source);auto text=source["original_content"].toString();QSet<QString>evidence;QSet<int>ids,indexes;int previous=-1;need(piece["chunks"].toArray().size()<=10000,"旧知识块数量超限，未截断");
 for(auto v:piece["chunks"].toArray()){need(v.isObject(),"旧知识块不是原行对象");auto c=v.toObject();keys(c,{"id","source_id","evidence_id","chunk_index","char_start","char_end","content","created_at"});int id=integer(c["id"],1),index=integer(c["chunk_index"]),a=integer(c["char_start"]),b=integer(c["char_end"]);
  need(c["source_id"]==source["id"]&&c["evidence_id"].isString()&&!c["evidence_id"].toString().isEmpty()&&c["content"].isString()&&c["created_at"].isString(),"旧知识块来源或字段类型不符");
  need(!ids.contains(id)&&!indexes.contains(index)&&!evidence.contains(c["evidence_id"].toString())&&index>previous,"旧知识块身份重复/顺序改变");ids.insert(id);indexes.insert(index);evidence.insert(c["evidence_id"].toString());previous=index;
  need(a<b&&b<=text.size()&&text.mid(a,b-a)==c["content"].toString()&&!(a>0&&text[a].isLowSurrogate()&&text[a-1].isHighSurrogate())&&!(b<text.size()&&text[b].isLowSurrogate()&&text[b-1].isHighSurrogate()),"旧知识块与原文UTF-16位置不符，未重切替代");
 }
}
inline void bound(QJsonObject descriptor){
 auto piece=descriptor["legacyKnowledge"].toObject();pieceValid(piece);auto s=piece["sourceRow"].toObject(),r=descriptor["row"].toObject(),old=r["legacyOriginal"].toObject();
 need(descriptor["kind"]=="docs"&&r["legacySource"]=="knowledge_sources"&&r["id"]==descriptor["id"]&&r["text"]==s["original_content"],"旧知识块不能绑定当前来源正文");
 for(auto field:{"id","source_key","source_type","content_hash","original_content"})need(old[field]==s[field],"旧知识来源身份/版本变化，未绑定旧块");
}
inline QJsonArray chunks(QJsonObject descriptor){
 if(!descriptor.contains("legacyKnowledge"))return knowledgeRetrieval::chunks(descriptor["row"].toObject()["text"].toString());
 bound(descriptor);auto p=descriptor["legacyKnowledge"].toObject(),s=p["sourceRow"].toObject();QJsonArray out;
 for(auto v:p["chunks"].toArray()){auto c=v.toObject();QJsonObject provenance{{"schema","native-legacy-knowledge-provenance/v1"},{"sourceId",s["id"]},{"sourceKey",s["source_key"]},{"sourceType",s["source_type"]},{"sourceContentHash",s["content_hash"]},{"sourceRowSha256",researchRuns::fingerprint(s)},{"sourceCreatedAt",s["created_at"]},{"sourceUpdatedAt",s["updated_at"]},{"sourceMetadataEqual",descriptor["row"].toObject()["legacyOriginal"]==s},{"binding","exact-identity-text-and-UTF16"},{"chunk",c}};
  out.append(QJsonObject{{"index",c["chunk_index"]},{"charStart",c["char_start"]},{"charEnd",c["char_end"]},{"content",c["content"]},{"legacyProvenance",provenance}});
 }return out;
}
inline void evidence(QJsonObject&hit){if(hit.contains("legacyProvenance"))hit["legacyEvidenceId"]=hit["legacyProvenance"].toObject()["chunk"].toObject()["evidence_id"];}
struct Connection {
 QString name="legacy-knowledge-"+QUuid::createUuid().toString();QSqlDatabase db;
 explicit Connection(QString file){db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");if(!db.open()){db={};QSqlDatabase::removeDatabase(name);need(false,"旧知识来源档案只读打开失败");}}
 ~Connection(){db.close();db={};QSqlDatabase::removeDatabase(name);}
};
inline QMap<int,QJsonObject> read(QString file){
 if(!QFileInfo::exists(file))return {};need(QFileInfo(file).isFile()&&QFileInfo(file).size()<=32*1024*1024,"旧知识来源档案超限或不是文件");Connection connection(file);auto&db=connection.db;need(db.transaction(),"旧知识档案快照失败");QSqlQuery q(db);need(q.exec("PRAGMA query_only=ON"),"旧知识档案无法锁定只读");
 need(q.exec("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"),"旧知识档案结构不可读");QMap<QString,QString>expected{{"legacy_chunks","createtablelegacy_chunks(idintegerprimarykey,source_idintegernotnull,payloadtextnotnull)"},{"legacy_receipts","createtablelegacy_receipts(source_keytextprimarykey,payloadtextnotnull)"},{"legacy_sources","createtablelegacy_sources(idintegerprimarykey,payloadtextnotnull)"}};
 while(q.next()){auto name=q.value(1).toString(),sql=q.value(2).toString().toLower();sql.remove(QRegularExpression("\\s+"));need(q.value(0)=="table"&&expected.contains(name)&&sql==expected.take(name),"旧知识档案含未知结构，未执行");}q.finish();need(expected.isEmpty(),"旧知识档案表缺失");
 need(q.exec("SELECT source_key,payload FROM legacy_receipts")&&q.next(),"旧知识迁移回执缺失");auto receipt=QJsonDocument::fromJson(q.value(1).toByteArray()).object();need(receipt["schema"]=="native-legacy-knowledge-receipt/v1"&&receipt["sourceSnapshotSha256"]==q.value(0).toString()&&receipt["sources"].isObject()&&receipt["chunks"].isObject()&&!q.next(),"旧知识回执身份/数量无效");q.finish();
 QMap<int,QJsonObject>pieces;QSet<QString>evidenceIds;int count=0;
 need(q.exec("SELECT id,payload FROM legacy_sources ORDER BY id"),"旧知识来源不可读");while(q.next()){need(++count<=10000,"旧知识来源数量超限");auto raw=q.value(1).toByteArray();auto s=QJsonDocument::fromJson(raw).object();sourceValid(s);need(s["id"].toInt()==q.value(0).toInt()&&receipt["sources"].toObject()[QString::number(s["id"].toInt())]==hash(raw),"旧知识来源与迁移回执不同，未覆盖");pieces[s["id"].toInt()]=QJsonObject{{"schema","native-legacy-knowledge-source/v1"},{"sourceRow",s},{"chunks",QJsonArray{}}};}q.finish();count=0;
 need(q.exec("SELECT id,source_id,payload FROM legacy_chunks ORDER BY source_id,id"),"旧知识原块不可读");while(q.next()){need(++count<=20000,"旧知识块数量超限");auto raw=q.value(2).toByteArray();auto c=QJsonDocument::fromJson(raw).object();need(c["id"].toInt()==q.value(0).toInt()&&c["source_id"].toInt()==q.value(1).toInt()&&receipt["chunks"].toObject()[QString::number(c["id"].toInt())]==hash(raw),"旧知识原块与回执不同");need(!evidenceIds.contains(c["evidence_id"].toString()),"旧证据身份重复");evidenceIds.insert(c["evidence_id"].toString());if(pieces.contains(c["source_id"].toInt())){auto&piece=pieces[c["source_id"].toInt()];auto blocks=piece["chunks"].toArray();blocks.append(c);piece["chunks"]=blocks;}}q.finish();
 for(auto it=pieces.begin();it!=pieces.end();++it){auto blocks=it.value()["chunks"].toArray();QList<QJsonObject>sorted;for(auto v:blocks)sorted.append(v.toObject());std::sort(sorted.begin(),sorted.end(),[](auto a,auto b){return a["chunk_index"].toInt()<b["chunk_index"].toInt();});blocks={};for(auto c:sorted)blocks.append(c);it.value()["chunks"]=blocks;pieceValid(it.value());}need(db.commit(),"旧知识档案只读快照结束失败");return pieces;
}
inline QJsonArray attach(QJsonArray materials,QString file){
 auto pieces=read(file);for(int i=0;i<materials.size();++i){auto d=materials[i].toObject(),r=d["row"].toObject();if(d["kind"]!="docs"||r["legacySource"]!="knowledge_sources")continue;auto id=r["legacyOriginal"].toObject()["id"].toInt();if(!pieces.contains(id))continue;d["legacyKnowledge"]=pieces[id];try{bound(d);}catch(const std::exception&){d.remove("legacyKnowledge");d["legacyKnowledgeWarning"]="旧知识块原件保留，但当前来源身份或正文已变化；本次未使用旧块。";}materials[i]=d;}return materials;
}
}
