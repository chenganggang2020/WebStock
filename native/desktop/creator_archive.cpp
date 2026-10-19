#include "creator_archive.hpp"
#include <QDir>
namespace creatorArchive {
using creatorAnalysis::require;
static QString hash(const QJsonValue& value){return researchRuns::fingerprint(value);}
QJsonObject empty(){return {{"schema","native-creator-archive/v1"},{"revision",0},{"batches",QJsonArray()}};}
QJsonObject parse(const QByteArray& raw){require(!raw.isEmpty()&&raw.size()<=fileLimit,"旧档案须为 2 MiB 内完整 JSON");auto file=creatorAi::parseObject(raw);auto rows=file["records"].toArray();require(file["schema"]=="webstock.creator-industry/v1","不是旧作者关系档案");require(file["records"].isArray()&&!rows.isEmpty()&&rows.size()<=1000,"旧记录数量须为 1 至 1000");for(auto r:rows)require(r.isObject(),"旧记录须为对象");return file;}
static QString number(const QJsonValue& v){if(v.isString()&&QRegularExpression("^[1-9][0-9]{0,15}$").match(v.toString()).hasMatch())return v.toString();double n=v.toDouble();if(v.isDouble()&&n>0&&n<=9007199254740991.0&&n==std::floor(n))return QString::number(n,'f',0);return {};}
void validateStore(const QJsonObject& store){
 require(store["schema"]=="native-creator-archive/v1"&&store["revision"].toDouble(-1)>=0&&store["batches"].isArray(),"作者档案库格式无效");auto all=store["batches"].toArray();require(all.size()<=100,"作者档案最多保留100批；未删除旧版");QSet<QString> ids;
 for(auto v:all){auto b=v.toObject();auto raw=b["sourceUtf8"].toString(),sha=collectionQuality::bodyHash(raw);auto records=parse(raw.toUtf8())["records"].toArray();QString id=b["id"].toString();require(sha==b["sourceHash"]&&id==collectionQuality::bodyHash(sha+"\n"+b["authorKey"].toString())&&!ids.contains(id),"旧档案身份或内容损坏");ids.insert(id);require(b["documents"].isObject()&&b["rows"].isArray(),"旧档案绑定缺失");
  auto bindings=b["rows"].toArray();require(bindings.size()==records.size(),"旧档案绑定数量不符");for(int n=0;n<records.size();++n){auto binding=bindings[n].toObject(),r=records[n].toObject();require(binding["index"].toInt(-1)==n,"旧记录索引不符");if(!binding.contains("documentId")){require(binding["status"]!="ready","准入记录没有原文");continue;}auto source=b["documents"].toObject()[binding["documentId"].toString()].toObject();require(source["id"]==binding["documentId"]&&hash(source)==binding["recordHash"]&&source["legacySource"]=="expert_observations"&&number(source["legacyOriginal"].toObject()["id"])==number(r["observationId"])&&creatorAnalysis::identity(source)["authorKey"]==b["authorKey"]&&collectionQuality::bodyHash(source["text"].toString())==r["bodyHash"],"旧档案来源绑定损坏");
   if(binding["status"]=="ready"){require(creatorAnalysis::eligible(source)&&r["specVersion"]==creatorAnalysis::spec&&r["relations"].isArray()&&r["relations"].toArray().size()<=500,"旧档案准入状态无效");for(auto e:r["relations"].toArray()){require(e.isObject(),"关系须为对象");creatorAnalysis::relation(e.toObject(),source["text"].toString());require(e.toObject()["status"]=="author_claim","旧观点不可升级为事实");}}
  }
 }
 require(QJsonDocument(store).toJson(QJsonDocument::Compact).size()<=storeLimit,"作者档案超过 8 MiB；未截断或删除");
}
static QMap<QString,QString> admission(const QJsonArray& input){QMap<QString,QString> out;for(auto d:creatorIndex::build(input)["documents"].toArray()){auto r=d.toObject();out[r["id"].toString()]=r["status"].toString();}return out;}
static bool admitted(const QString& s){return s=="pending"||s=="analyzed";}
static QString key(const QJsonObject& r){return number(r["observationId"])+"|"+r["bodyHash"].toString()+"|"+r["specVersion"].toString();}
QJsonObject preview(const QByteArray& raw,const QString& author,const QJsonArray& input,const QJsonObject& archive){
 validateStore(archive);auto file=parse(raw);require(!author.isEmpty()&&!author.startsWith("document:"),"先明确选择有稳定身份的作者，不能按显示名绑定");bool exists=false;for(auto v:input)if(creatorAnalysis::identity(v.toObject())["authorKey"]==author)exists=true;require(exists,"所选作者身份不在当前文稿中");
 auto utf8=QString::fromUtf8(raw),sha=collectionQuality::bodyHash(utf8),id=collectionQuality::bodyHash(sha+"\n"+author);bool duplicate=false;QMap<QString,QSet<QString>> previous;
 for(auto v:archive["batches"].toArray()){auto b=v.toObject();if(b["id"]==id)duplicate=true;if(b["authorKey"]!=author)continue;for(auto x:parse(b["sourceUtf8"].toString().toUtf8())["records"].toArray()){auto r=x.toObject();previous[key(r)].insert(hash(r));}}
 auto gates=admission(input);QJsonArray rows,records=file["records"].toArray();QJsonObject documents;int conflicts=0;
 for(int i=0;i<records.size();++i){auto r=records[i].toObject();QJsonObject bound;QList<QJsonObject> matches;auto observation=number(r["observationId"]);
  for(auto v:input){auto source=v.toObject();if(!observation.isEmpty()&&source["legacySource"]=="expert_observations"&&number(source["legacyOriginal"].toObject()["id"])==observation&&creatorAnalysis::identity(source)["authorKey"]==author)matches.append(source);}
  QString status=matches.isEmpty()?"unmatched":matches.size()>1?"ambiguous":"ready",reason=status;
  if(matches.size()==1){bound=matches[0];if(r["bodyHash"]!=collectionQuality::bodyHash(bound["text"].toString())){status="body-mismatch";bound={};}
   else{documents[bound["id"].toString()]=bound;if(!admitted(gates.value(bound["id"].toString())))status="quality-blocked";else if(r["specVersion"]!=creatorAnalysis::spec)status="legacy-rule";else try{require(r["relations"].isArray()&&r["relations"].toArray().size()<=500,"旧关系超限");for(auto x:r["relations"].toArray()){require(x.isObject(),"关系须为对象");auto e=x.toObject();creatorAnalysis::relation(e,bound["text"].toString());require(e["status"]=="author_claim","旧关系不是作者观点状态");}}catch(const std::exception& e){status="invalid-relations";reason=QString::fromUtf8(e.what());}}
  }
  QString recordHash=hash(r);auto prior=previous.value(key(r));bool conflict=std::any_of(prior.begin(),prior.end(),[&](const QString& h){return h!=recordHash;});if(conflict)++conflicts;previous[key(r)].insert(recordHash);QJsonObject item{{"index",i},{"status",status},{"reason",reason=="ready"?status:reason},{"conflict",conflict}};if(!bound.isEmpty()){item["documentId"]=bound["id"];item["recordHash"]=hash(bound);}rows.append(item);
 }
 return {{"id",id},{"authorKey",author},{"sourceHash",sha},{"sourceUtf8",utf8},{"basisHash",hash(input)},{"archiveHash",hash(archive)},{"rows",rows},{"documents",documents},{"duplicate",duplicate},{"conflicts",conflicts}};
}
QJsonObject commit(const QJsonObject& p,const QJsonArray& input,const QJsonObject& current,const QString& at){
 validateStore(current);require(hash(input)==p["basisHash"]&&hash(current)==p["archiveHash"],"来源或旧档案已变化，请重新预览");auto exact=preview(p["sourceUtf8"].toString().toUtf8(),p["authorKey"].toString(),input,current);require(hash(exact)==hash(p),"预览内容已变化");require(!exact["duplicate"].toBool(),"同一作者已导入该完整文件");require(QDateTime::fromString(at,Qt::ISODateWithMs).isValid(),"导入时间无效");
 auto batch=exact;for(auto k:QStringList{"basisHash","archiveHash","duplicate"})batch.remove(k);batch["importedAt"]=at;auto next=current;auto all=next["batches"].toArray();all.append(batch);next["batches"]=all;next["revision"]=current["revision"].toDouble()+1;validateStore(next);return next;
}
QJsonObject project(const QJsonObject& archive,const QJsonArray& input,const QString& author,const QString& topic){
 validateStore(archive);QMap<QString,QJsonObject> current;for(auto v:input)current[v.toObject()["id"].toString()]=v.toObject();auto gates=admission(input);QJsonArray all,relations;int blocked=0;
 for(auto v:archive["batches"].toArray()){auto b=v.toObject();if(!author.isEmpty()&&b["authorKey"]!=author)continue;auto records=parse(b["sourceUtf8"].toString().toUtf8())["records"].toArray(),bindings=b["rows"].toArray();require(records.size()==bindings.size(),"档案绑定数量不符");
  for(int n=0;n<records.size();++n){auto original=records[n].toObject(),binding=bindings[n].toObject(),source=b["documents"].toObject()[binding["documentId"].toString()].toObject();QString status=binding["status"].toString();
   if(status=="ready"){auto now=current.value(binding["documentId"].toString());if(source.isEmpty()||now.isEmpty()||hash(source)!=hash(now))status="source-changed";else if(!admitted(gates.value(now["id"].toString())))status="quality-blocked";}
   QJsonObject entry{{"archiveId",b["id"]},{"recordIndex",n},{"authorKey",b["authorKey"]},{"original",original},{"status",status},{"conflict",binding["conflict"]},{"source",source},{"sourceHash",b["sourceHash"]}};all.append(entry);if(status!="ready"){++blocked;continue;}
   auto edges=original["relations"].toArray();for(int e=0;e<edges.size();++e){auto edge=edges[e].toObject();if(!topic.isEmpty()&&edge["topic"]!=topic)continue;auto link=entry;link["documentId"]=source["id"];link["analysisId"]=b["id"].toString()+":"+QString::number(n);link["bodyHash"]=original["bodyHash"];link["sourceSnapshot"]=creatorAnalysis::sourceSnapshot(source);link["edgeIndex"]=e;link["edge"]=edge;relations.append(link);}
  }
 }
 return {{"records",all},{"relations",relations},{"blocked",blocked}};
}
QJsonObject graph(const QJsonArray& relations,const QString& focus,int page){
 QJsonArray filtered,nodes,edges;for(auto v:relations){auto e=v.toObject()["edge"].toObject();if(focus.isEmpty()||e["from"]==focus||e["to"]==focus)filtered.append(v);}
 page=std::clamp(page,0,std::max(0,(int(filtered.size())-1)/pageSize));for(int i=page*pageSize;i<std::min(int(filtered.size()),page*pageSize+pageSize);++i){auto r=filtered[i].toObject(),e=r["edge"].toObject();auto id=hash(r)+":"+QString::number(i);int y=(i-page*pageSize)*130;for(int side=0;side<2;++side)nodes.append(QJsonObject{{"id",id+":"+QString::number(side)},{"label",e[side==0?"from":"to"]},{"x",side*520},{"y",y},{"evidence",r}});edges.append(QJsonObject{{"from",id+":0"},{"to",id+":1"},{"y",y},{"evidence",r}});}
 return {{"total",relations.size()},{"filtered",filtered.size()},{"shown",edges.size()},{"page",page},{"nodes",nodes},{"edges",edges}};
}
QJsonObject Store::read()const{QFile f(path);if(!f.exists())return empty();require(f.open(QIODevice::ReadOnly)&&f.size()<=storeLimit,"作者档案不可读取或超限");auto state=creatorAi::parseObject(f.readAll());validateStore(state);return state;}
QJsonObject Store::save(const QJsonObject& p,const std::function<QJsonArray()>& source,const std::function<bool()>& cancelled){
 require(QDir().mkpath(QFileInfo(path).absolutePath()),"档案目录不可写");QLockFile lock(path+".lock");lock.setStaleLockTime(0);require(lock.tryLock(0),"作者档案正在提交，请重试");require(!cancelled(),"导入已取消");auto next=commit(p,source(),read(),QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));QSaveFile file(path);require(file.open(QIODevice::WriteOnly),"档案不可写");auto bytes=QJsonDocument(next).toJson(QJsonDocument::Compact);require(file.write(bytes)==bytes.size(),"档案写入失败");require(!cancelled(),"导入已取消");require(file.commit(),"档案原子提交失败");return next;
}
}

