#pragma once
#include "knowledge_retrieval.hpp"
#include "knowledge_legacy.hpp"
#include "knowledge_ai_host.hpp"
#include "research_runs_model.hpp"
#include "ai_settings_model.hpp"
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>
#include <QUuid>
#include <cmath>

// A derived index exists only in this call's independent :memory: connection.
// Source databases, persisted indexes, credentials and network APIs are not used.
namespace knowledgeSearchIndex {
inline void need(bool b,const QString&m){if(!b)throw std::runtime_error(m.toUtf8().constData());}
inline QString field(QJsonObject r,QString name,QString old={}){auto v=r[name];if(v.isString()&&!v.toString().isEmpty())return v.toString();return r["legacyOriginal"].toObject()[old.isEmpty()?name:old].toString();}
inline QString tags(QJsonObject r,QString name,QString old){auto legacy=r["legacyOriginal"].toObject();QJsonValue v=r.contains(name)?r[name]:legacy.contains(old)?legacy[old]:QJsonValue(QJsonArray{});if(v.isString())return v.toString();auto b=QJsonDocument(QJsonArray{v}).toJson(QJsonDocument::Compact);return QString::fromUtf8(b.mid(1,b.size()-2));}
struct Memory {
 QString name;QSqlDatabase db;
 Memory(){name="knowledge-index-"+QUuid::createUuid().toString();db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(":memory:");if(!db.open()){auto error=db.lastError().text();db={};QSqlDatabase::removeDatabase(name);need(false,"本次独立内存SQLite不可用："+error);}}
 ~Memory(){db.close();db={};QSqlDatabase::removeDatabase(name);}
};
inline void sql(QSqlDatabase&db,const QString&s){QSqlQuery q(db);need(q.exec(s),"本机派生索引SQL失败："+q.lastError().text());}
inline QJsonObject capabilities(QSqlDatabase&db){
 QJsonObject c{{"platform","qt"},{"sqliteVersion",""},{"supportedApi",true},{"fts5",false},{"trigram",false},{"bm25",false},{"readOnlyQueryTransaction",false},{"reason",""}};QSqlQuery q(db);
 need(q.exec("SELECT sqlite_version()")&&q.next(),"SQLite版本不可核对");c["sqliteVersion"]=q.value(0).toString();q.finish();
 bool fts=q.exec("CREATE VIRTUAL TABLE capability_fts USING fts5(text)");c["fts5"]=fts;q.finish();
 bool tri=fts&&q.exec("CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(evidence_id UNINDEXED,chunk_id UNINDEXED,source_id UNINDEXED,title,author,content,tags,tokenize='trigram')");c["trigram"]=tri;q.finish();
 bool bm=false;if(tri){need(q.exec("INSERT INTO knowledge_chunks_fts VALUES('probe',1,'probe','光模块','','光模块','')"),"平台能力探针插入失败");bm=q.exec("SELECT bm25(knowledge_chunks_fts,0.0,0.0,0.0,2.5,1.5,1.0,1.5) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH '\"光模块\"'")&&q.next()&&std::isfinite(q.value(0).toDouble());q.finish();need(q.exec("DELETE FROM knowledge_chunks_fts"),"平台能力探针清理失败");}c["bm25"]=bm;
 if(!fts)c["reason"]="本机SQLite没有FTS5";else if(!tri)c["reason"]="本机SQLite没有trigram分词器";else if(!bm)c["reason"]="本机SQLite没有可核BM25";return c;
}
inline QJsonObject info(QJsonObject result,QJsonObject caps,const QJsonArray&fts,const QJsonArray&shorts,QString outcome,QString reason){
 auto manifest=result["selection"].toObject()["manifest"].toArray();return {{"schema","native-knowledge-derived-index/v1"},{"lifetime","isolated-memory-per-call;destroyed-before-return"},{"sourceManifest",manifest},{"sourceManifestSha256",researchRuns::fingerprint(manifest)},{"capabilities",caps},{"tokenizer","trigram"},{"columns",QJsonArray{"evidence_id","chunk_id","source_id","title","author","content","tags"}},{"weights",QJsonArray{0,0,0,2.5,1.5,1,1.5}},{"ftsTokens",fts},{"ignoredShortTokens",shorts},{"outcome",outcome},{"fallbackReason",reason},{"corpus","explicit selected native materials only; not the old global knowledge corpus"},{"sourceFilter","exact kind:id selection; no mapping of old integer sourceIds"},{"invalidatedBy","return destroys index; query/source version changes/cancel/hide clear result; context replays native query"}};
}
inline QJsonObject fallback(QJsonObject base,QJsonObject caps,QJsonArray fts,QJsonArray shorts,QString outcome,QString reason){base["engineLabel"]="字面匹配回退（无BM25）："+reason;base["index"]=info(base,caps,fts,shorts,outcome,reason);return base;}
inline QJsonObject search(const QJsonArray&materials,const QString&query,int topK){
 auto base=knowledgeRetrieval::search(materials,query,topK);QJsonArray terms,shorts;QStringList match;
 for(auto v:base["tokens"].toArray()){auto t=v.toString();if(t.size()>=3){terms.append(t);t.replace('"',"\"\"");match.append('"'+t+'"');}else shorts.append(t);}
 QJsonObject caps{{"platform","qt"},{"sqliteVersion",""},{"supportedApi",true},{"fts5",false},{"trigram",false},{"bm25",false},{"readOnlyQueryTransaction",false},{"reason","内存SQLite尚未建立"}};
 try{
  Memory memory;sql(memory.db,"PRAGMA temp_store=MEMORY");caps=capabilities(memory.db);
  if(!caps["bm25"].toBool())return fallback(base,caps,terms,shorts,"capability-unavailable",caps["reason"].toString());
  if(terms.isEmpty())return fallback(base,caps,terms,shorts,"no-fts-terms","没有长度至少3的FTS词，沿用字面回退");
  sql(memory.db,"CREATE TABLE blocks(chunk_id INTEGER PRIMARY KEY,source_key TEXT NOT NULL,chunk_index INTEGER NOT NULL,published_at TEXT NOT NULL)");
  need(memory.db.transaction(),"本机派生索引构建事务不可用");QHash<int,QJsonObject> hits;int next=0;
  for(auto v:materials){auto d=v.toObject(),r=d["row"].toObject(),ref=knowledgeAiHost::reference(d);auto key=knowledgeAiHost::identity(d),title=field(r,"title"),author=field(r,"author"),published=field(r,"publishedAt","published_at"),url=field(r,"sourceUrl","source_url");auto meta=tags(r,"tags","tags_json")+" "+tags(r,"stockCodes","stock_codes_json")+" "+tags(r,"sectors","sectors_json");
   for(auto part:knowledgeLegacy::chunks(d)){auto h=part.toObject();int number=++next;QString evidence="K"+QString::fromLatin1(key.toUtf8().toHex())+"-"+ref["rowSha256"].toString()+"-"+QString::number(h["index"].toInt()+1);
    h["evidenceId"]=evidence;h["sourceKey"]=key;h["reference"]=ref;h["title"]=title;h["author"]=author;h["sourceUrl"]=url;h["publishedAt"]=published;h["textField"]="row.text";h["offsetUnit"]="UTF-16/raw-text";h["contentSha256"]=aiSettings::hash(h["content"].toString().toUtf8());knowledgeLegacy::evidence(h);hits[number]=h;
    QSqlQuery q(memory.db);q.prepare("INSERT INTO blocks VALUES(?,?,?,?)");q.addBindValue(number);q.addBindValue(key);q.addBindValue(h["index"].toInt());q.addBindValue(published.isNull()?QStringLiteral(""):published);need(q.exec(),"本机派生块插入失败");q.finish();
    q.prepare("INSERT INTO knowledge_chunks_fts(rowid,evidence_id,chunk_id,source_id,title,author,content,tags) VALUES(?,?,?,?,?,?,?,?)");for(auto value:QVariantList{number,evidence,number,key,title,author,h["content"].toString(),meta})q.addBindValue(value);need(q.exec(),"本机FTS原片段插入失败");
   }
  }
  need(memory.db.commit(),"本机派生索引事务失败");sql(memory.db,"PRAGMA query_only=ON");need(memory.db.transaction(),"本机派生索引只读事务不可用");caps["readOnlyQueryTransaction"]=true;
  QJsonArray items;QHash<QString,int> counts;QHash<QString,bool> knownDates;int matched=0;
  {QSqlQuery q(memory.db);q.prepare("SELECT block.chunk_id,bm25(knowledge_chunks_fts,0.0,0.0,0.0,2.5,1.5,1.0,1.5) AS rank,datetime(block.published_at) AS published FROM knowledge_chunks_fts JOIN blocks AS block ON block.chunk_id=CAST(knowledge_chunks_fts.chunk_id AS INTEGER) WHERE knowledge_chunks_fts MATCH ? ORDER BY rank ASC,published DESC,block.source_key COLLATE BINARY DESC,block.chunk_index ASC");q.addBindValue(match.join(" OR "));need(q.exec(),"本机FTS查询失败："+q.lastError().text());while(q.next()){int number=q.value(0).toInt();need(hits.contains(number),"派生索引命中不属于原资料块");auto h=hits[number];double rank=q.value(1).toDouble();need(std::isfinite(rank),"BM25返回非有限值");h["bm25Rank"]=rank;h["relevance"]=std::round(-rank*1000000.0)/1000000.0;h["publishedTimeKnown"]=!q.value(2).isNull();++counts[h["sourceKey"].toString()];++matched;if(items.size()<topK)items.append(h);}}
  for(auto v:base["scopes"].toArray()){auto s=v.toObject();QSqlQuery q(memory.db);q.prepare("SELECT datetime(?) IS NOT NULL");q.addBindValue(s["publishedAt"].toString());need(q.exec()&&q.next(),"发布时间解析能力不可核对");knownDates[s["sourceKey"].toString()]=q.value(0).toBool();}
  need(memory.db.commit(),"本机派生索引只读事务结束失败");
  if(!matched)return fallback(base,caps,terms,shorts,"no-fts-hits","FTS没有命中，沿用字面回退");
  auto out=base;QJsonArray scopes;for(auto v:base["scopes"].toArray()){auto s=v.toObject();s["matchedChunks"]=counts[s["sourceKey"].toString()];s["publishedTimeKnown"]=knownDates[s["sourceKey"].toString()];scopes.append(s);}out["scopes"]=scopes;out["items"]=items;out["matchedChunks"]=matched;out["omittedByTopK"]=matched-items.size();out["usedTokens"]=terms;
  out["engine"]="fts5-trigram-bm25-selected-corpus";out["engineLabel"]="FTS5 trigram · BM25（仅本次所选资料）";out["ranking"]="bm25(0,0,0,2.5,1.5,1,1.5)-asc;sqlite-datetime-desc;kind:id-binary-desc;chunk-index-asc;selected-corpus";out["searchBoundary"]="FTS5 trigram on raw row.text chunks and title/author/tags+stockCodes+sectors; originalText not indexed; SQLite tokenizer case rules; selected corpus only; scores are not evidence confidence";out["index"]=info(out,caps,terms,shorts,"fts-hits",{});return out;
 }catch(const std::exception&e){return fallback(base,caps,terms,shorts,"index-query-failed",QString::fromUtf8(e.what()));}
}
}
