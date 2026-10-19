#pragma once
#include "quant_model_job.hpp"
#include <QDirIterator>
#include <algorithm>
namespace researchModelSources {
using quantModel::need;
inline QByteArray bounded(QString path,qint64 limit=32*1024*1024){QFileInfo info(path);need(!info.isSymLink()&&info.isFile(),"量化来源不是普通原文件");QFile file(path);need(file.open(QIODevice::ReadOnly),"量化原件不可读");auto bytes=file.read(limit+1);need(bytes.size()<=limit,"量化原件超限，整份拒绝不裁剪");need(QString::fromUtf8(bytes).toUtf8()==bytes,"量化原件UTF8损坏");return bytes;}
inline QJsonObject read(QString quantStore){
 QString root=quantStore+".model-jobs";QList<QFileInfo> files;QFileInfo rootInfo(root);need(!rootInfo.isSymLink(),"量化来源目录不能是链接");
 if(rootInfo.exists()){need(rootInfo.isDir()&&rootInfo.isReadable(),"量化目录不可读");QDirIterator it(root,QDir::AllEntries|QDir::NoDotAndDotDot|QDir::Hidden);int count=0;while(it.hasNext()){it.next();need(++count<=4096,"量化目录超过4096项，请明确整理范围；未裁剪");auto info=it.fileInfo();if(QRegularExpression("^native-[0-9a-f-]{36}$").match(info.fileName()).hasMatch()){need(info.isDir()&&!info.isSymLink(),"量化任务来源目录无效");files.append(info);}}}
 std::sort(files.begin(),files.end(),[](const QFileInfo&a,const QFileInfo&b){return a.lastModified()==b.lastModified()?a.fileName()<b.fileName():a.lastModified()>b.lastModified();});
 QJsonArray quant,factors,sources,gaps;int selected=std::min<int>(50,files.size());
 for(int i=0;i<selected;++i){auto folder=files[i].absoluteFilePath(),id=files[i].fileName();auto stateBytes=bounded(folder+"/state.json",1024*1024);auto state=quantModel::object(stateBytes);need(state["schema"]=="webstock.quant.native-job.v1"&&state["id"]==id,"量化归档状态身份损坏");QJsonObject source{{"id",id},{"stateSha256",quantModel::hash(stateBytes)},{"status",state["status"]}};
  if(state["status"]=="completed"){
   need(QRegularExpression("^[0-9a-fA-F]{64}$").match(state["requestSha256"].toString()).hasMatch(),"完成任务缺少原请求摘要，不能降级核验");
   auto bytes=bounded(folder+"/verified-result.json");auto sha=quantModel::hash(bytes);need(sha==state["resultSha256"],"量化归档结果字节与状态不一致");auto receipt=quantModel::verifyBundle(bytes,state["requestSha256"].toString());need(receipt["id"]==id&&receipt["task"]==state["task"],"量化结果与状态身份不一致");
   auto summary=receipt;QJsonArray attachments;for(auto v:receipt["files"].toArray()){auto file=v.toObject();auto path=file["path"].toString();if(path=="request.json"||path.endsWith("/manifest.json"))summary[path=="request.json"?"originalRequest":"originalDatasetManifest"]=quantModel::object(QByteArray::fromBase64(file["base64"].toString().toLatin1()));file.remove("base64");attachments.append(file);}summary["files"]=attachments;source["bundleSha256"]=sha;source["verifiedSummary"]=summary;
   for(auto v:receipt["steps"].toArray()){auto step=v.toObject();auto kind=step["step"].toObject()["kind"].toString();QJsonObject entry{{"valid",true},{"result",step["result"]},{"nativeBundleId",id},{"nativeBundleSha256",sha}};if(kind=="lightgbm"||kind=="master")quant.append(entry);else if(kind=="factor")factors.append(entry);}
   need(quantModel::hash(bounded(folder+"/verified-result.json"))==sha,"量化原件在核验中变化，请重新预览");
  }else{need(QStringList{"queued","running","cancelling","cancelled","interrupted","failed"}.contains(state["status"].toString()),"量化任务状态未知");gaps.append(id+"：任务未完成，不计模型/因子分，也不恢复或启动任务");}
  need(bounded(folder+"/state.json",1024*1024)==stateBytes,"量化状态在核验中变化，请重新预览");sources.append(source);
  need(QJsonDocument(QJsonObject{{"quantEntries",quant},{"factorEntries",factors},{"nativeModelSources",sources}}).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"完整量化上下文超过8MiB，整份拒绝，未裁剪结果");
 }
 gaps.append("仅纳入逐份通过F06完整附件校验的模型/因子；策略/信号不冒充训练模型。历史原时点保留，不代表真实行情预测精度。");if(files.size()>50)gaps.append(QString("明确仅选最近50份原档；遗漏%1份，不代表全仓结果。").arg(files.size()-50));if(quant.isEmpty())gaps.append("所选原档没有已核验训练模型结果，不补零分。");
 QJsonObject out{{"quantEntries",quant},{"factorEntries",factors},{"nativeModelSources",sources},{"nativeModelGaps",gaps},{"nativeModelSelection",QJsonObject{{"archiveCount",files.size()},{"selectedCount",selected},{"omittedCount",std::max<int>(0,files.size()-50)},{"order","archive-directory-modified-desc; identity-asc-tie"},{"limit",50}}}};
 need(QJsonDocument(out).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"完整量化上下文超过8MiB，整份拒绝，未裁剪结果");return out;
}
}
