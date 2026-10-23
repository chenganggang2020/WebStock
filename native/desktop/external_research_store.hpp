#pragma once
#include "external_research_batch.hpp"
#include "external_research_legacy.hpp"
#include "business_restore_store.hpp"

namespace externalResearchBatch {
inline QString joined(QJsonArray a){QStringList out;for(auto v:a)out<<v.toString();return out.join("；");}
// Legacy candidate display cleanup is a derived view. Full source remains in batch.originalText.
inline QString clean(QString s,int max){s.remove(QRegularExpression("<[^>]*>"));s.remove(QRegularExpression("[*_`~]"));s.remove(QRegularExpression("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]"));QString out;bool previous=false;for(auto c:s){bool ws=space(c.unicode());if(!ws||!previous)out+=ws?QChar(' '):c;previous=ws;}return trim(out).left(max);}
inline QString mappedText(QJsonArray rows){QStringList result;for(auto v:rows){auto o=v.toObject();QStringList fields;for(auto k:{"rank","priority","code","name","reason","risk","analysis"})fields<<"    "+watchlistWorkspace::quote(k)+": "+encode(o[k]);result<<"  {\n"+fields.join(",\n")+"\n  }";}return "[\n"+result.join(",\n")+"\n]";}
inline QJsonArray reportRows(QJsonObject v,QString prepared){
 stamp(prepared);auto n=v["normalized"].toObject(),source=n["source"].toObject(),artifact=n["artifacts"].toArray()[0].toObject()["payload"].toObject();QJsonArray mapped,candidates,refs;
 for(auto pv:v["picks"].toArray()){auto p=pv.toObject();auto risk=joined(p["risks"].toArray()),analysis="证据："+joined(p["evidenceRefs"].toArray());mapped.append(QJsonObject{{"rank",p["rank"]},{"priority",p["priority"]},{"code",p["code"]},{"name",p["name"]},{"reason",p["thesis"]},{"risk",risk},{"analysis",analysis}});QJsonObject c{{"code",p["code"]},{"name",clean(p["name"].toString(),80)},{"reason",clean(p["thesis"].toString(),2000)},{"risk",clean(risk,2000)},{"originalAnalysis",clean(analysis,8000)},{"rank",p["rank"]}};if(!p["priority"].toString().isEmpty())c["priority"]=p["priority"];candidates.append(c);for(auto ref:p["evidenceRefs"].toArray())refs.append(ref);}
 auto original=mappedText(mapped),title=n["asOf"].toObject()["marketDate"].toString()+" ChatGPT 每日研究候选";
 QJsonObject request{{"source","external-chatgpt-batch"},{"batchKey",v["batchKey"]},{"generatedAt",source["generatedAt"]},{"model",source["model"]},{"importedAt",prepared},{"candidates",candidates},{"analysis",clean(artifact["analysis"].toString(),20000)},{"originalText",original},{"format","structured-json"},{"duplicateCount",0},{"truncated",false},{"warnings",QJsonArray{"外部 ChatGPT 产物，WebStock 未独立验证"}},{"security",QJsonObject{{"trustedHtml",false},{"executable",false}}},{"automaticTrading",false}};
 auto rawRun=QJsonObject{{"id",runId(v)},{"runType","manual-chatgpt-stock-picks"},{"modelId","chatgpt-automation"},{"status","completed"},{"title",title},{"result",original},{"evidence",refs},{"request",request},{"metrics",QJsonObject{{"candidateCount",candidates.size()},{"duplicateCount",0}}},{"createdAt",prepared}};
 auto run=researchRuns::normalize(rawRun);researchRuns::stored(run);
 QJsonObject meta{{"schema","native-external-research-batch/v1"},{"batchKey",v["batchKey"]},{"payloadHash",v["payloadHash"]},{"nativePayloadHash",v["nativePayloadHash"]},{"originalSha256",v["originalSha256"]},{"normalized",n},{"preparedAt",prepared},{"webstockRunId",runId(v)},{"webstockStatus","succeeded"},{"tonghuashunStatus",v["wantsTonghuashun"].toBool()?"pending":"not-requested"},{"status",v["wantsTonghuashun"].toBool()?"partial":"completed"}};
 QJsonObject batch{{"id",batchId(v)},{"title",n["asOf"].toObject()["marketDate"].toString()+" 外部研究批次 · 修订 "+legacyResearchJson::number(n["revision"].toDouble())},{"text",encode(n)},{"originalText",v["originalText"]},{"legacySource","external_research_batches"},{"legacyOriginal",meta},{"sourceFingerprint",researchRuns::fingerprint(meta)},{"verification","unverified"}};
 return {batch,run};
}
inline QJsonObject incoming(QJsonObject v,QString at){QJsonArray rows;for(auto rv:reportRows(v,at)){auto r=rv.toObject();rows.append(QJsonObject{{"kind","reports"},{"id",r["id"]},{"raw",QString::fromUtf8(QJsonDocument(r).toJson(QJsonDocument::Compact))}});}return businessRestore::payload(rows);}
inline QJsonObject stored(QJsonObject row){if(legacyRecord(row))return legacyStored(row);need(row["legacySource"]=="external_research_batches","不是研究批次原件");auto v=validate(row["originalText"].toString());auto expected=reportRows(v,row["legacyOriginal"].toObject()["preparedAt"].toString())[0].toObject();need(researchRuns::canonical(expected)==researchRuns::canonical(row),"批次原件、内容或元数据已变化；保留当前，不覆盖");return v;}
inline bool completeReceipt(QJsonObject r,QJsonObject v){QSet<QString>ids;for(auto w:r["inserted"].toArray()){auto o=w.toObject();if(o["kind"]!="reports")return false;ids.insert(o["id"].toString());}return r["inserted"].toArray().size()==2&&r["equal"].toArray().isEmpty()&&r["conflicts"].toArray().isEmpty()&&ids==QSet<QString>{batchId(v),"legacy-research:"+runId(v)};}
// Receipt source identity uses the captured row bytes, never a platform's regenerated JSON.
inline bool hasReceiptRow(QJsonObject receipt,QString id){for(auto field:{"inserted","equal"})for(auto value:receipt[field].toArray()){auto w=value.toObject();if(w["kind"]=="reports"&&w["id"]==id)return true;}return false;}
inline bool receiptRowsAligned(QJsonObject snapshot,QJsonObject receipt){
 QJsonArray rows;QSet<QString>wanted;for(auto field:{"inserted","equal"})for(auto value:receipt[field].toArray()){auto w=value.toObject();if(w["kind"]!="reports")return false;wanted.insert(w["id"].toString());}
 for(auto value:snapshot["payload"].toObject()["records"].toArray()){auto w=value.toObject();if(w["kind"]=="reports"&&wanted.remove(w["id"].toString()))rows.append(w);}
 return !receipt.isEmpty()&&wanted.isEmpty()&&!rows.isEmpty()&&receipt["sourceKey"]==businessRestore::sourceKey(businessRestore::payload(rows));
}
inline QJsonObject currentRows(QJsonObject v,QJsonObject snapshot,QJsonObject receipt,QJsonValue receiptAlignment=QJsonValue(QJsonValue::Undefined)){
 const bool legacy=v.contains("legacySqlRow");const QString runKey=legacy?v["linkedRunRecordId"].toString():"legacy-research:"+runId(v);
 QJsonObject batch,run;for(auto wv:snapshot["payload"].toObject()["records"].toArray()){auto w=wv.toObject();if(w["kind"]!="reports")continue;if(w["id"]==batchId(v))batch=w;if(w["id"]==runKey)run=w;}
 bool intact=false;if(!batch.isEmpty()&&!run.isEmpty()){
  auto saved=businessRestore::row(batch),held=stored(saved);
  if(legacy){try{auto linked=businessRestore::row(run);linkedLegacyRun(held,linked);intact=linked["sourceFingerprint"]==saved["legacyOriginal"].toObject()["linkedRunSourceFingerprint"];}catch(const std::exception&){intact=false;}}
  else{auto expected=reportRows(held,saved["legacyOriginal"].toObject()["preparedAt"].toString());intact=researchRuns::canonical(saved)==researchRuns::canonical(expected[0])&&researchRuns::canonical(businessRestore::row(run))==researchRuns::canonical(expected[1]);}
 }
 return {{"savedOriginalPresent",!batch.isEmpty()},{"savedRunPresent",!run.isEmpty()},{"savedRowsIntact",intact},{"receiptRowsMatch",receiptAlignment.isUndefined()?receiptRowsAligned(snapshot,receipt):receiptAlignment.toBool()}};
}
inline QJsonArray sourceChecks(QJsonObject v,QJsonObject snapshot){
 QJsonArray descriptors=snapshot["restoreState"].toObject()["rawStorageGuard"].toObject()["documents"].toArray();
 if(!snapshot["restoreState"].toObject().contains("researchScope"))for(auto wv:snapshot["payload"].toObject()["records"].toArray()){auto w=wv.toObject();if(w["kind"]!="docs")continue;auto r=businessRestore::row(w);descriptors.append(QJsonObject{{"id",r["id"]},{"title",r["title"]},{"sourceUrl",r["sourceUrl"]},{"sourceFingerprint",researchRuns::fingerprint(r)},{"hasBody",!r["text"].toString().isEmpty()},{"verification",r["verification"].toString("unverified")},{"publishedAt",r["publishedAt"]}});}
 QJsonArray out;QSet<QString>seen;for(auto av:v["normalized"].toObject()["artifacts"].toArray()){auto a=av.toObject(),p=a["payload"].toObject();auto kind=a["kind"].toString();auto rows=p[kind=="research-picks"?"picks":kind=="market-hotspots"?"items":"chains"].toArray();for(auto rv:rows)for(auto uv:rv.toObject()["evidenceRefs"].toArray()){auto url=uv.toString();if(seen.contains(url))continue;seen.insert(url);QJsonArray matches;for(auto dv:descriptors){auto d=dv.toObject();if(d["sourceUrl"]!=url)continue;d.remove("sourceUrl");matches.append(d);}out.append(QJsonObject{{"url",url},{"format","http-https"},{"localMatches",matches},{"factStatus","unverified"},{"onlineChecked",false}});}}
 return out;
}
class Store final {
 QString path;businessRestore::Store core;
 QJsonArray receipts(QJsonObject before)const{
  const auto name="f07-read-"+QUuid::createUuid().toString();QJsonArray result;
  {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setConnectOptions("QSQLITE_OPEN_URI;QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");db.setDatabaseName(QUrl::fromLocalFile(QFileInfo(path).absoluteFilePath()).toString(QUrl::FullyEncoded)+"?mode=ro");
   try{need(db.open(),"研究回执只读连接失败");QSqlQuery q(db);need(q.exec("PRAGMA query_only=ON")&&db.transaction(),"研究回执只读事务失败");auto summary=knownBusinessReceipts::scan(db,[&](QString table,QJsonObject r,QString key){if(table==knownBusinessReceipts::business){businessRestore::receiptValid(r);need(r["sourceKey"]==key,"研究引用回执键错误");result.append(r);}else industryArchive::archiveReceipt(r,key);});need(researchRuns::canonical(summary)==researchRuns::canonical(before["restoreState"].toObject()["receiptBytes"]),"研究预览回执基线已变，未写");need(db.commit(),"研究回执只读事务结束失败");db.close();}
   catch(...){db.rollback();db.close();db={};QSqlDatabase::removeDatabase(name);throw;}
  }QSqlDatabase::removeDatabase(name);return result;
 }
public:
 explicit Store(QString file):path(file),core(std::move(file)){}
 QJsonObject preview(QString raw,QString prepared)const{
  auto v=validate(raw),before=core.captureResearch();auto all=receipts(before);auto id=batchId(v),prefix=batchPrefix(v["batchKey"].toString());QJsonObject previous,saved,displayed=v;bool conflict=false;
  for(auto rv:all){auto r=rv.toObject();for(auto field:{"inserted","equal"})for(auto wv:r[field].toArray()){auto w=wv.toObject();if(w["kind"]!="reports"||!w["id"].toString().startsWith(prefix))continue;if(w["id"]!=id)conflict=true;else if(previous.isEmpty()||completeReceipt(r,v))previous=r;}}
  for(auto wv:before["payload"].toObject()["records"].toArray()){auto w=wv.toObject();if(w["kind"]!="reports"||!w["id"].toString().startsWith(prefix))continue;if(w["id"]!=id)conflict=true;else{saved=businessRestore::row(w);auto held=stored(saved);displayed=held;need(held["batchKey"]==v["batchKey"]&&held["payloadHash"]==v["payloadHash"],"当前批次身份不一致");}}
  need(!conflict,"同一来源/任务/运行/revision 的内容已变化；请增加 revision，整批未覆盖");
  bool replay=!previous.isEmpty();QJsonObject operation;if(!replay){need(saved.isEmpty(),"已有批次原件但缺持久交付回执，拒绝推定成功或重写");operation=core.previewResearch(incoming(v,prepared),before);for(auto av:operation["actions"].toArray())need(av.toObject()["status"]=="insert","批次或研究运行ID已有不同/无回执记录，整批未覆盖");need(operation["issues"].toArray().isEmpty(),"研究批次关联未闭合，整批未写");}
  auto state=currentRows(displayed,before,previous);return unifiedBackup::seal({{"savedRunPresent",state["savedRunPresent"]},{"savedRowsIntact",state["savedRowsIntact"]},{"receiptRowsMatch",state["receiptRowsMatch"]},{"schema","native-external-research-preview/v1"},{"batch",v},{"displayBatch",displayed},{"preparedAt",prepared},{"baseline",before["baseline"]},{"sourceChecks",sourceChecks(v,before)},{"replayed",replay},{"savedOriginalPresent",!saved.isEmpty()},{"savedBatch",saved},{"previousReceipt",previous},{"operation",operation}});
 }
 QJsonObject commit(QJsonObject p,bool confirmed,std::function<void()>beforeCommit={})const{
  need(confirmed,"尚未明确确认，未写入");unifiedBackup::sealed(p);need(p["schema"]=="native-external-research-preview/v1"&&!p["replayed"].toBool(),"不是可提交的新批次");auto fresh=preview(p["batch"].toObject()["originalText"].toString(),p["preparedAt"].toString());need(researchRuns::canonical(fresh)==researchRuns::canonical(p),"内容/来源/原库/回执已变化，请重读预览");return core.commitResearch(p["operation"].toObject(),std::move(beforeCommit));
 }
 QJsonObject previewLegacy(QString raw,QString prepared)const{
  stamp(prepared);need(raw.toUtf8().size()<=8*1024*1024,"Legacy source bundle exceeds 8MiB");legacyResearchJson::Parser(raw).run();auto doc=QJsonDocument::fromJson(raw.toUtf8());need(doc.isObject(),"Legacy source bundle is not an object");auto bundle=doc.object();keys(bundle,{"schema","rows"});need(bundle["schema"]==legacyBundleSchema&&bundle["rows"].isArray(),"Legacy source schema mismatch");auto source=bundle["rows"].toArray();need(!source.isEmpty()&&source.size()<=500,"Legacy source count outside 1..500");
  auto before=core.captureResearch();auto all=receipts(before);QMap<QString,QJsonObject>current;for(auto value:before["payload"].toObject()["records"].toArray()){auto w=value.toObject();if(w["kind"]=="reports")current[w["id"].toString()]=businessRestore::row(w);}
  QJsonArray incoming,actions,checks;QSet<QString>keysSeen;int conflicts=0;
  for(auto value:source){need(!QThread::currentThread()->isInterruptionRequested(),"Legacy preview cancelled");auto v=legacyValue(value.toObject());auto id=batchId(v),prefix=batchPrefix(v["batchKey"].toString());need(!keysSeen.contains(v["batchKey"].toString()),"Duplicate legacy batch key");keysSeen.insert(v["batchKey"].toString());bool changed=false,barrier=false;
   for(auto key:current.keys())if(key.startsWith(prefix)&&key!=id)changed=true;
   for(auto av:all){auto receipt=av.toObject();for(auto field:{"inserted","equal"})for(auto wv:receipt[field].toArray()){auto w=wv.toObject();if(w["kind"]=="reports"&&w["id"].toString().startsWith(prefix)){if(w["id"]==id)barrier=true;else changed=true;}}}
   QJsonArray currentRows,blockingReceipts;for(auto key:current.keys())if(key.startsWith(prefix))currentRows.append(current[key]);for(auto av:all){auto r=av.toObject();bool relevant=false;for(auto f:{"inserted","equal"})for(auto w:r[f].toArray())relevant|=w.toObject()["kind"]=="reports"&&w.toObject()["id"].toString().startsWith(prefix);if(relevant)blockingReceipts.append(r);}QJsonObject action{{"id",id},{"batchKey",v["batchKey"]},{"sourceRow",value},{"currentRows",currentRows},{"historicalLocalReceipts",blockingReceipts},{"linkedRunRecordId",v["linkedRunRecordId"]},{"linkedRunPresent",current.contains(v["linkedRunRecordId"].toString())}};
   if(changed){action["status"]="conflict";++conflicts;}
   else if(current.contains(id)){auto saved=current[id];if(!legacyRecord(saved)||researchRuns::canonical(saved["legacyOriginal"].toObject()["sourceRow"])!=researchRuns::canonical(value)){action["status"]="conflict";++conflicts;}else{stored(saved);action["status"]="equal";}}
   else if(barrier)action["status"]="deleted-not-restored";
   else{auto linked=current.value(v["linkedRunRecordId"].toString());linkedLegacyRun(v,linked);auto row=legacyBatchRow(v,linked["sourceFingerprint"].toString(),prepared);incoming.append(QJsonObject{{"kind","reports"},{"id",id},{"raw",QString::fromUtf8(QJsonDocument(row).toJson(QJsonDocument::Compact))}});action["status"]="insert";}
   actions.append(action);checks.append(QJsonObject{{"batchKey",v["batchKey"]},{"checks",sourceChecks(v,before)}});
  }
  QJsonObject operation;if(!conflicts&&!incoming.isEmpty()){operation=core.previewResearch(businessRestore::payload(incoming),before);for(auto value:operation["actions"].toArray())need(value.toObject()["status"]=="insert","Legacy target IDs changed");need(operation["issues"].toArray().isEmpty(),"Legacy references do not close");}
  return unifiedBackup::seal({{"schema","native-legacy-external-research-preview/v1"},{"originalText",raw},{"preparedAt",prepared},{"baseline",before["baseline"]},{"sourceRows",source},{"actions",actions},{"sourceChecks",checks},{"conflicts",conflicts},{"canConfirm",!conflicts&&!incoming.isEmpty()},{"replayed",!conflicts&&incoming.isEmpty()},{"insertCount",incoming.size()},{"operation",operation},{"externalDeliveryPerformed",false}});
 }
 QJsonObject commitLegacy(QJsonObject p,bool confirmed,std::function<void()>beforeCommit={})const{
  need(confirmed,"Legacy import needs explicit confirmation");unifiedBackup::sealed(p);need(p["schema"]=="native-legacy-external-research-preview/v1"&&p["canConfirm"].toBool(),"Legacy preview is conflicted or replayed");
  auto fresh=previewLegacy(p["originalText"].toString(),p["preparedAt"].toString());need(researchRuns::canonical(fresh)==researchRuns::canonical(p),"Legacy source or full database changed; preview again");auto receipt=core.commitResearch(p["operation"].toObject(),std::move(beforeCommit));
  return {{"status","legacy-archive-saved"},{"localMigrationReceipt",receipt},{"externalDeliveryPerformed",false},{"cloudSyncVerified",false},{"existingAiRunsReimported",false}};
 }
 QJsonArray history()const{
  auto before=core.captureResearch();auto all=receipts(before);QJsonArray rows;QHash<QString,bool>receiptMatches;
  for(auto wv:before["payload"].toObject()["records"].toArray()){auto w=wv.toObject();if(w["kind"]!="reports")continue;auto r=businessRestore::row(w);if(r["legacySource"]!="external_research_batches")continue;auto v=stored(r);bool legacy=legacyRecord(r);QJsonObject receipt;
   for(auto av:all){auto a=av.toObject();if(legacy?hasReceiptRow(a,batchId(v)):completeReceipt(a,v))receipt=a;}
   auto receiptKey=receipt["sourceKey"].toString();if(!receiptMatches.contains(receiptKey))receiptMatches[receiptKey]=receiptRowsAligned(before,receipt);auto state=currentRows(v,before,receipt,receiptMatches.value(receiptKey));rows.append(QJsonObject{{"batch",v},{"row",r},{"receipt",receipt},{"rowState",state},{"legacyMigration",legacy},{"migrationReceiptVerified",legacy&&!receipt.isEmpty()&&state["savedRowsIntact"].toBool()&&state["receiptRowsMatch"].toBool()},{"historicalDeliveryRecorded",legacy?!v["historicalDelivery"].toObject().isEmpty():!receipt.isEmpty()},{"deliveryVerified",!legacy&&!receipt.isEmpty()&&state["savedRowsIntact"].toBool()&&state["receiptRowsMatch"].toBool()}});
  }return rows;
 }
};
}
