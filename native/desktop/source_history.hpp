#pragma once
#include "business_store.hpp"

namespace sourceHistory {
inline void requireNewJson(const QString& path) {
  business::require(!path.isEmpty() && QFileInfo(path).suffix().compare("json",Qt::CaseInsensitive)==0,
                    "历史导出请选择新的.json文件，不允许覆盖数据库");
  business::require(!QFileInfo::exists(path)&&!QFileInfo(path).isSymLink(),"目标已存在，请另选文件名；历史导出不覆盖任何已有文件");
}
inline void saveNewJson(const QString& path,const QJsonObject& data) {
  requireNewJson(path);auto bytes=QJsonDocument(data).toJson(QJsonDocument::Compact);
  QFile f(path);business::require(f.open(QIODevice::WriteOnly|QIODevice::NewOnly),"无法新建历史文件");
  if(f.write(bytes)!=bytes.size()||!f.flush()){f.close();f.remove();throw std::runtime_error("历史导出失败，已清理本次未完成文件");}
  f.close();
}
inline QString clean(QString value) {
  static const QRegularExpression urls("https?://[^\\s<>\"'，。；！？、（）【】]+");
  auto matches=urls.globalMatch(value); QList<QPair<int,int>> cuts;
  while(matches.hasNext()) { auto m=matches.next(); auto text=m.captured();
    auto n=text.indexOf(QRegularExpression("[?#]"));
    if(n>=0) cuts.append({int(m.capturedStart()+n),int(text.size()-n)}); }
  for(auto i=cuts.crbegin();i!=cuts.crend();++i) value.remove(i->first,i->second);
  return value;
}
inline const QStringList countKeys={"work_count","discovered_count","candidate_count","detailed_count","detail_error_count","transcription_attempted_count","transcribed_count","media_missing_count","transcript_error_count","added_count","updated_count","unchanged_count"};
inline QJsonObject validateRun(const QJsonObject& in) {
  QJsonObject out;
  auto text=[&](const char* key,int max) {
    auto v=in.value(key); business::require(v.isUndefined()||v.isString(),QString("历史文本字段无效：")+key);
    auto s=v.toString(); business::require(s.size()<=max,QString("历史文本过长：")+key);out[key]=clean(s);
  };
  text("id",100);text("channelId",60);text("author",300);text("status",80);text("trigger",80);
  text("startedAt",64);text("finishedAt",64);text("message",4000);text("error",4000);
  business::require(QRegularExpression("^legacy-webstock:sync-run:[1-9][0-9]*$").match(out["id"].toString()).hasMatch(),"旧轮次身份无效");
  business::require(!out["startedAt"].toString().isEmpty()&&!out["status"].toString().isEmpty(),"历史缺时间或状态");
  business::require(in.value("counts").isObject()&&in.value("items").isArray(),"历史缺计数或明细");
  QJsonObject counts;
  for(auto key:countKeys) if(in["counts"].toObject().contains(key)) {
    auto v=in["counts"].toObject()[key];
    business::require(v.isNull()||(v.isDouble()&&v.toDouble()>=0&&v.toDouble()<=1e9&&std::floor(v.toDouble())==v.toDouble()),"旧计数无效");counts[key]=v;
  }
  out["counts"]=counts;QJsonArray items;QSet<QString> seen;
  business::require(in["items"].toArray().size()<=2000,"单轮明细超过2000条");
  for(auto value:in["items"].toArray()) {
    business::require(value.isObject(),"历史明细不是对象");auto row=value.toObject();QJsonObject item;
    for(auto key:{"contentId","title","sourceUrl","detail_status","transcription_status","message"}) {
      auto v=row.value(key); business::require(v.isUndefined()||v.isString(),"明细文本字段无效");
      business::require(v.toString().size()<=4000,"明细文本过长");item[key]=clean(v.toString());
    }
    auto id=item["contentId"].toString();business::require(!id.isEmpty()&&id.size()<=100&&!seen.contains(id),"明细身份缺失或重复");seen.insert(id);
    for(auto key:{"media_bytes","elapsed_seconds"}) if(row.contains(key)) {
      auto v=row[key];business::require(v.isNull()||(v.isDouble()&&std::isfinite(v.toDouble())&&v.toDouble()>=0&&v.toDouble()<=9e15),"明细数值无效");item[key]=v;
    }
    items.append(item);
  }
  out["items"]=items;return out;
}
inline QJsonArray validate(const QJsonObject& file) {
  business::require(file["schema"].toString()=="native-source-history-v1"&&file["runs"].isArray(),"不是旧来源历史档案");
  auto rows=file["runs"].toArray();business::require(rows.size()<=10000,"档案超过一万轮，请分批");
  QSet<QString> ids;QJsonArray out;int items=0;
  for(auto v:rows) {business::require(v.isObject(),"历史记录不是对象");auto r=validateRun(v.toObject());
    auto id=r["id"].toString();business::require(!ids.contains(id),"重复旧轮次身份");ids.insert(id);items+=r["items"].toArray().size();
    business::require(items<=50000,"档案明细超过五万条");out.append(r);}
  return out;
}
inline QJsonObject bundle(const QJsonArray& rows) { return {{"schema","native-source-history-v1"},{"runs",rows}}; }
}
