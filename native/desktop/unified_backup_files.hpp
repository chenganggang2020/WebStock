#pragma once
#include "unified_backup.hpp"
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QSaveFile>
#include <QUuid>
#include <memory>
#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <io.h>
#else
#include <unistd.h>
#endif

namespace unifiedBackup {
inline QByteArray boundedRead(QString path,qint64 limit) {
 need(!QFileInfo(path).isSymLink(),"不读取符号链接文件");
 QFile f(path);need(f.open(QIODevice::ReadOnly),"文件无法只读打开");
 auto bytes=f.read(limit+1);need(f.error()==QFileDevice::NoError&&bytes.size()<=limit&&f.atEnd(),"文件读取失败或超过完整上限；未截断");
 return bytes;
}
inline void syncFile(QFileDevice& f) {
 need(f.flush(),"文件刷新失败");
#ifdef Q_OS_WIN
 auto handle=reinterpret_cast<HANDLE>(_get_osfhandle(f.handle()));
 need(handle!=INVALID_HANDLE_VALUE&&FlushFileBuffers(handle),"文件同步失败");
#else
 need(::fsync(f.handle())==0,"文件同步失败");
#endif
}
inline QJsonObject exportSummary(QByteArray bytes) {
 auto b=decode(bytes);QJsonArray rows;
 for(auto v:b["entries"].toArray()){auto e=v.toObject(),p=e["payload"].toObject();QJsonObject r{{"id",e["id"]},{"scope",e["scope"]},{"sha256",e["sha256"]},{"bytes",QJsonDocument(p).toJson(QJsonDocument::Compact).size()}};
  auto id=e["id"].toString();if(id=="watchlist-config")r["count"]=p["config"].toObject()["groups"].toArray().size();
  else if(id=="manual-leader-config")r["count"]=p["sectors"].toArray().size();
  else if(id=="recent-entries")r["count"]=p["entries"].toArray().size();
  else if(id=="candidate-selection"||id=="candidate-background")r["count"]=p["records"].toArray().size();
  rows.append(r);
 }
 return {{"selectedDomainIds",b["selectedDomainIds"]},{"createdAt",b["createdAt"]},{"producerVersion",b["producerVersion"]},{"bytes",bytes.size()},{"sha256",b["sha256"]},{"domains",rows}};
}
inline QString hostDomain(QString id){static const QMap<QString,QString> names{{"watchlist-config","自选分组配置"},{"manual-leader-config","人工龙头配置"},{"recent-entries","最近查看条目"},{"candidate-selection","已选冻结候选"},{"candidate-background","已选命名背景方案"},{"industry-report-archive","完整旧产业原件"},{"business-seven","业务七类"},{"manual-leader-observations","人工观察历史"}};return names.value(id,id);}
inline QString hostState(QString state){static const QMap<QString,QString> names{{"ready","等待执行"},{"running","部分已完成"},{"applying","提交待核实"},{"uncertain","结果未确认"},{"failed","失败，已停止"},{"complete","所选项已完成"},{"completed","已完成"},{"unchanged","无变更"},{"stopped","已停止"},{"pending","尚未执行"}};return names.value(state,state);}
inline QString exportPreviewText(QJsonObject summary){
 QString text="备份预览；尚未写入文件。\n生成时点："+summary["createdAt"].toString()+"\n来源版本："+summary["producerVersion"].toString()+"\n";
 for(auto value:summary["domains"].toArray()){auto row=value.toObject();text+="\n"+hostDomain(row["id"].toString())+" · "+QString::number(row["count"].toInt())+" 条 · "+QString::number(row["bytes"].toInteger())+" 字节\n"+row["scope"].toString()+"\n完整性校验："+row["sha256"].toString()+"\n";}
 return text+"\n合计："+QString::number(summary["bytes"].toInteger())+" 字节\n完整文件校验："+summary["sha256"].toString();
}
inline QString historicalReceiptText(QJsonObject result){
 auto receipt=result["receipt"].toObject();QString text="历史回执只读核验；不会恢复执行。\n操作："+receipt["operationId"].toString()+"\n状态："+hostState(receipt["state"].toString())+"\n各模块分别提交；原恢复前备份与逐项回执保留在文件内。\n";
 for(auto value:receipt["domains"].toArray()){auto row=value.toObject();text+="\n"+hostDomain(row["id"].toString())+"："+hostState(row["state"].toString())+" "+row["reason"].toString();}
 for(auto value:result["observations"].toArray()){auto row=value.toObject();auto observed=row["observation"].toString();text+="\n"+hostDomain(row["id"].toString())+"：结果未确认；"+(observed=="target-observed-unattributed"?"当前与目标相符，但缺可归属的提交回执":observed=="baseline-observed"?"当前仍与开始时一致，提交归属未确认":observed=="different-current-state"?"当前另有变化，未覆盖或回滚":observed);}
 return text+"\n\n回执完整性校验："+receipt["sha256"].toString();
}
inline void exportNewVerified(QString path,QByteArray bytes) {
 decode(bytes);QFile out(path);need(out.open(QIODevice::WriteOnly|QIODevice::NewOnly),"只能写入尚不存在的新文件；原文件未覆盖");
 need(out.write(bytes)==bytes.size(),"新文件写入失败；可能留下不完整文件，请核对");syncFile(out);out.close();
 need(boundedRead(path,BUNDLE_LIMIT)==bytes,"新文件独立回读不符；导出未确认");
}
class FileJournal final {
 QString file;QByteArray expected;
public:
 explicit FileJournal(QString path):file(QFileInfo(path).absoluteFilePath()){}
 QString path()const{return file;}
 QJsonObject load()const {
  if(!QFileInfo::exists(file)){need(expected.isEmpty(),"已保存回执丢失；不得重建");return {};}
  return decodeReceipt(boundedRead(file,JOURNAL_LIMIT));
 }
 void save(QJsonObject value) {
  auto bytes=encodeReceipt(value);auto exists=QFileInfo::exists(file);
  need(exists?!expected.isEmpty()&&boundedRead(file,JOURNAL_LIMIT)==expected:expected.isEmpty(),"回执已存在/变化/丢失；禁止覆盖或重建");
  need(QDir().mkpath(QFileInfo(file).absolutePath()),"回执目录无法创建");
  QSaveFile out(file);out.setDirectWriteFallback(false);need(out.open(QIODevice::WriteOnly),"回执临时文件无法创建");
  need(out.write(bytes)==bytes.size(),"回执写入失败");syncFile(out);need(out.commit(),"回执原子替换失败");
  expected=bytes;need(boundedRead(file,JOURNAL_LIMIT)==bytes,"回执独立回读不符；禁止继续");decodeReceipt(bytes);
 }
 Journal callbacks(){return {[this](QJsonObject v){save(v);},[this]{return load();}};}
 static QString newPath(QString directory){need(!directory.trimmed().isEmpty(),"需明确私有回执目录");return QDir(directory).absoluteFilePath("restore-"+QUuid::createUuid().toString(QUuid::WithoutBraces)+".json");}
 static QString inspectedPath(QString directory,QString path){
  QFileInfo f(path);need(f.isFile()&&!f.isSymLink()&&f.fileName().startsWith("restore-")&&f.suffix()=="json","请选择原有恢复回执");
  need(QDir(f.absolutePath()).canonicalPath()==QDir(directory).canonicalPath()&&!QDir(directory).canonicalPath().isEmpty(),"只读取宿主指定目录中的回执");
  return f.absoluteFilePath();
 }
};
}
