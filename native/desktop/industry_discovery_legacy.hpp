#pragma once
#include "industry_discovery_model.hpp"
#include <QDateTime>
#include <QJsonDocument>
#include <QMap>
#include <QRegularExpression>
#include <cmath>
namespace industryDiscoveryLegacy {
inline void instant(QJsonValue value) {
  industryDiscovery::require(value.isString()&&QRegularExpression("(Z|[+-]\\d{2}:\\d{2})$").match(value.toString()).hasMatch()&&QDateTime::fromString(value.toString(),Qt::ISODateWithMs).isValid(),"旧发现时间无效或缺时区；未改写原时刻");
}
inline QJsonObject validateRaw(const QJsonObject& raw) {
  using industryDiscovery::require;
  QStringList fields{"provider","provider_id","name","classification","first_seen_at","last_seen_at","source_fetched_at","catalog_rank","baseline","active","payload_json"};fields.sort();
  require(raw.keys()==fields,"旧发现须完整保留11个原始字段");
  const auto provider=raw["provider"].toString(),id=raw["provider_id"].toString();
  require(raw["provider"].isString()&&raw["provider_id"].isString()&&(provider=="eastmoney-public-board"||provider=="sina-public-concept"),"旧发现供应商或身份无效");
  require(provider!="eastmoney-public-board"||id.startsWith("90."),"旧东财身份缺少原90.前缀");
  industryDiscovery::boardKey(provider,"concept",provider=="eastmoney-public-board"?id.mid(3):id);
  require(raw["name"].isString()&&!raw["name"].toString().trimmed().isEmpty()&&raw["name"].toString().size()<=160,"旧发现名称无效");
  require(raw["classification"].isNull()||(raw["classification"].isString()&&raw["classification"].toString().size()<=160),"旧分类须保留文字或SQL null");
  instant(raw["first_seen_at"]);instant(raw["last_seen_at"]);
  require(QDateTime::fromString(raw["first_seen_at"].toString(),Qt::ISODateWithMs)<=QDateTime::fromString(raw["last_seen_at"].toString(),Qt::ISODateWithMs),"旧首次/末次时间倒置");
  if(!raw["source_fetched_at"].isNull())instant(raw["source_fetched_at"]);
  for(auto flag:{"baseline","active"})require(raw[flag].isDouble()&&(raw[flag].toDouble()==0||raw[flag].toDouble()==1),"旧baseline/active必须保留原0/1");
  const auto rank=raw["catalog_rank"].toDouble(-1);require(raw["catalog_rank"].isDouble()&&rank>=0&&rank<=10000&&std::floor(rank)==rank,"旧rank无效");
  require(raw["payload_json"].isString()&&raw["payload_json"].toString().toUtf8().size()<=1024*1024,"旧payload须为有界原始文字，不重新编码");
  return raw;
}
inline QString rowReceipt(const QJsonObject& raw) {
  return industryDiscovery::hash(("M07-A|industry_concept_discovery|"+raw["provider"].toString()+"|"+raw["provider_id"].toString()).toUtf8());
}
inline QJsonObject project(const QJsonObject& value) {
  const auto raw=validateRaw(value);const auto p=raw["provider"].toString(),id=raw["provider_id"].toString(),code=p=="eastmoney-public-board"?id.mid(3):id;
  return {{"key",industryDiscovery::boardKey(p,"concept",code)},{"provider",p},{"providerId",id},{"taxonomy","concept"},{"code",code},{"name",raw["name"]},
          {"firstSeenAt",raw["first_seen_at"]},{"lastSeenAt",raw["last_seen_at"]},{"sourceFetchedAt",raw["source_fetched_at"]},{"sourceObservedAt",QJsonValue::Null},
          {"rank",raw["catalog_rank"]},{"baseline",bool(raw["baseline"].toInt())},{"active",bool(raw["active"].toInt())},{"classification",raw["classification"]},
          {"provenance","imported-unverified"},{"legacyDiscoverySource","industry_concept_discovery"},{"legacyDiscoveryOriginal",raw}};
}
inline void validateStored(const QJsonObject& item) {
  if(!item.contains("legacyDiscoveryOriginal")&&!item.contains("legacyDiscoverySource"))return;
  using industryDiscovery::require;
  require(item["legacyDiscoverySource"]=="industry_concept_discovery"&&item["legacyDiscoveryOriginal"].isObject(),"旧发现原始记录标记不完整");
  const auto projected=project(item["legacyDiscoveryOriginal"].toObject());
  for(auto key:{"provider","providerId","taxonomy","code","key"})require(item[key]==projected[key],"旧发现原始身份与当前条目不符");
}
inline QJsonObject normalize(const QJsonObject& input) {
  using industryDiscovery::require;
  require(input.keys()==QStringList({"rows","schema"})&&input["schema"]=="native-legacy-industry-discovery/v1"&&input["rows"].isArray(),"不是完整旧发现原始行包");
  const auto rows=input["rows"].toArray();require(!rows.isEmpty()&&rows.size()<=8192,"旧发现原始行数量无效");QMap<QString,QJsonObject> sorted;
  for(auto value:rows){require(value.isObject(),"旧发现行须为对象");auto raw=validateRaw(value.toObject());auto key=raw["provider"].toString()+"|"+raw["provider_id"].toString();require(!sorted.contains(key),"旧发现复合身份重复");sorted.insert(key,raw);}
  QJsonArray all;for(const auto& raw:sorted)all.append(raw);return {{"schema","native-legacy-industry-discovery/v1"},{"rows",all}};
}
}
