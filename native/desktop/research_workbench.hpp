#pragma once
#include "external_research_store.hpp"
#include "decision_packet.hpp"
#include "knowledge_search_index.hpp"
#include <QSaveFile>
#include <QLockFile>

namespace researchWorkbench {
using externalResearchBatch::need;
inline QJsonArray materials(QJsonObject snapshot){QJsonArray out;for(auto v:snapshot["payload"].toObject()["records"].toArray()){auto w=v.toObject();if(w["kind"]!="docs"&&w["kind"]!="collections")continue;auto row=businessRestore::row(w);if(!row["text"].isString()||row["text"].toString().isEmpty())continue;out.append(QJsonObject{{"kind",w["kind"]},{"id",w["id"]},{"row",row}});}return out;}
inline QJsonObject packetPreview(QString file,QJsonObject input,QJsonArray ids,QJsonObject context,QString query,QString at){
 businessRestore::Store store(file);auto before=store.capture();auto catalogue=materials(before);QSet<QString>keys;for(auto v:ids){need(v.isString()&&!keys.contains(v.toString()),"所选资料身份重复或无效");keys.insert(v.toString());}QJsonArray selected;for(auto d:catalogue)if(keys.contains(knowledgeAiHost::identity(d.toObject())))selected.append(d);need(selected.size()==keys.size(),"所选原资料已缺失，请重新选择");
 auto selection=knowledgeAiHost::selection(selected);QJsonObject knowledge{{"engine","none"},{"items",QJsonArray{}}};if(!selected.isEmpty())knowledge=knowledgeSearchIndex::search(selected,query,12);
 auto packet=decisionPacket::build(input,context,knowledge,at);auto gaps=packet["dataGaps"].toArray();for(auto v:context.value("nativeGaps").toArray())gaps.append(v);packet["dataGaps"]=gaps;packet["prompt"]=decisionPacket::prompt(packet);
 QJsonObject request{{"riskProfile",packet["riskProfile"]},{"datasetId",packet["datasetId"]},{"maxCandidates",input["maxCandidates"].toInt(12)},{"sourceManifest",selection["manifest"]},{"retrievalOriginal",researchRuns::pretty(knowledge)},{"sourceSnapshotOriginal",researchRuns::pretty(context)},{"nativeBoundary","仅消费本机明确来源；所选资料F04能力探测或字面回退；未发送AI；排名不是证据可信度"}};
 auto id="f07-packet-"+externalResearchBatch::shortDigest(researchRuns::fingerprint(QJsonObject{{"packet",packet},{"request",request}}));
 auto run=researchRuns::normalize({{"id",id},{"runType","decision-packet"},{"modelId","evidence-orchestrator-v1"},{"status","completed"},{"title",packet["question"].toString().left(200)},{"question",packet["question"]},{"prompt",packet["prompt"]},{"result",researchRuns::pretty(QJsonObject{{"candidates",packet["candidates"]},{"dataGaps",packet["dataGaps"]},{"dataSources",packet["dataSources"]}})},{"evidence",packet["evidence"]},{"request",request},{"createdAt",at}});
 auto incoming=businessRestore::payload(QJsonArray{QJsonObject{{"kind","reports"},{"id",run["id"]},{"raw",QString::fromUtf8(QJsonDocument(run).toJson(QJsonDocument::Compact))}}});auto operation=store.preview(incoming,before);for(auto a:operation["actions"].toArray())need(a.toObject()["status"]!="conflict","研究运行ID冲突，未覆盖");
 return unifiedBackup::seal({{"schema","native-f07-packet-preview/v1"},{"packet",packet},{"input",input},{"selectedIds",ids},{"sourceSnapshot",context},{"query",query},{"preparedAt",at},{"run",run},{"operation",operation}});
}
inline QJsonObject savePacket(QString file,QJsonObject p,bool confirmed,QJsonObject currentContext){
 need(confirmed,"请明确确认保存这次本机决策包");unifiedBackup::sealed(p);need(p["schema"]=="native-f07-packet-preview/v1","决策包预览格式无效");need(researchRuns::canonical(currentContext)==researchRuns::canonical(p["sourceSnapshot"]),"本机候选/模型/账户/资讯版本已变化，未保存旧预览");
 auto fresh=packetPreview(file,p["input"].toObject(),p["selectedIds"].toArray(),currentContext,p["query"].toString(),p["preparedAt"].toString());need(researchRuns::canonical(fresh)==researchRuns::canonical(p),"原资料或完整库基线已变化，请重新预览");return businessRestore::Store(file).commit(p["operation"].toObject());
}
inline QString packetReading(QJsonObject p){unifiedBackup::sealed(p);return "本机决策包已编排，未调用AI。来源、缺口和完整提示词如下。\n\n"+researchRuns::read(p["run"].toObject())+"\n\n完整决策包\n"+researchRuns::pretty(p["packet"]);}
class Draft final {
 QString file;
 static void validate(QJsonObject o){watchlistBackup::keys(o,{"schema","raw","question","query","risk","maximum","sourceIds","tab","segment","fullText","exportText"});need(o["schema"]=="native-f07-draft/v1","F07草稿格式无效");for(auto k:{"raw","question","query","risk","fullText","exportText"})need(o[k].isString(),"F07草稿文字字段损坏");need(o["raw"].toString().toUtf8().size()<=8*1024*1024&&o["question"].toString().size()<=1000&&o["query"].toString().size()<=500&&QStringList{"balanced","conservative","aggressive"}.contains(o["risk"].toString()),"F07草稿输入超限或无效");for(auto k:{"maximum","tab","segment"})need(o[k].isDouble()&&o[k].toDouble()==o[k].toInt(-1),"F07草稿位置字段损坏");need(o["maximum"].toInt()>=3&&o["maximum"].toInt()<=20&&o["tab"].toInt()>=0&&o["tab"].toInt()<=3&&o["segment"].toInt()>=0,"F07草稿选项损坏");need(o["sourceIds"].isArray()&&o["sourceIds"].toArray().size()<=20,"F07草稿来源清单损坏");QSet<QString>ids;for(auto v:o["sourceIds"].toArray()){auto id=v.toString();need(v.isString()&&QRegularExpression("^(docs|collections):.{1,200}$").match(id).hasMatch()&&!ids.contains(id),"F07草稿来源身份损坏");ids.insert(id);}unifiedBackup::sensitive(o);QJsonParseError error;auto input=QJsonDocument::fromJson(o["raw"].toString().toUtf8(),&error);if(error.error==QJsonParseError::NoError&&input.isObject())unifiedBackup::sensitive(input.object());}
 QByteArray bytes()const{QFile f(file);if(!f.exists())return {};need(f.open(QIODevice::ReadOnly)&&f.size()<=16*1024*1024,"F07草稿不可读或超限，原件保留");auto b=f.readAll();need(QString::fromUtf8(b).toUtf8()==b,"F07草稿UTF8损坏");watchlistBackup::JsonGate{QString::fromUtf8(b)}.run();validate(QJsonDocument::fromJson(b).object());return b;}
public:
 explicit Draft(QString path):file(std::move(path)){}
 QString marker()const{auto b=bytes();return b.isEmpty()?QString():externalResearchBatch::sha(QString::fromUtf8(b));}
 QJsonObject read(QString expected)const{auto b=bytes();need(!b.isEmpty()&&externalResearchBatch::sha(QString::fromUtf8(b))==expected,"F07草稿摘要已变化，未载入替代版本");return QJsonDocument::fromJson(b).object();}
 QString save(QJsonObject value,QString expected)const{validate(value);auto b=QJsonDocument(value).toJson(QJsonDocument::Compact);need(b.size()<=16*1024*1024,"F07完整草稿超限，未截断");QLockFile lock(file+".lock");lock.setStaleLockTime(0);need(lock.tryLock(0),"F07草稿正被另一窗口保存");need(marker()==expected,"F07草稿已变化，保留另一窗口原件");QSaveFile out(file);out.setDirectWriteFallback(false);need(out.open(QIODevice::WriteOnly)&&out.write(b)==b.size()&&out.commit(),"F07草稿保存失败");return marker();}
};
}
