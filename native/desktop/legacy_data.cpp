#include "legacy_data.hpp"

#include <QSqlRecord>

#include "business_store.hpp"
#include "source_history.hpp"
#include "research_runs_model.hpp"
namespace {
struct LegacyConnection {
  QString name = QUuid::createUuid().toString();
  QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE", name);
  ~LegacyConnection() {
    db.close();
    db = {};
    QSqlDatabase::removeDatabase(name);
  }
};
QJsonArray rows(QSqlDatabase& db, const QString& table, const QString& order,int maximum=10000) {
  if (!db.tables().contains(table)) return {};
  QSqlQuery q(db);
  business::require(
      q.exec("SELECT * FROM " + table + " ORDER BY " + order + " LIMIT "+QString::number(maximum+1)),
      "旧表字段不兼容：" + table);
  QJsonArray out;
  while (q.next()) {
    business::require(out.size() < maximum,
                      "旧表超过支持条数，请分批导出：" + table);
    QJsonObject r;
    auto rec = q.record();
    for (int i = 0; i < rec.count(); ++i)
      r[rec.fieldName(i)] = QJsonValue::fromVariant(q.value(i));
    out.append(r);
  }
  return out;
}
QString identity(QString code) {
  code = code.trimmed().toLower();
  QString market;
  if (code.startsWith("sh") || code.startsWith("sz") || code.startsWith("bj")) {
    market = code.left(2);
    code = code.mid(2);
  } else
    market =
        code.startsWith("92") || code.startsWith('4') || code.startsWith('8')
            ? "bj"
        : code.startsWith('5') || code.startsWith('6') || code.startsWith('9')
            ? "sh"
            : "sz";
  business::require(QRegularExpression("^[0-9]{6}$").match(code).hasMatch(),
                    "旧流水代码无效");
  QString type = code.startsWith("51") || code.startsWith("50") ||
                         code.startsWith("15") || code.startsWith("16") ||
                         code.startsWith("58") || code.startsWith("56")
                     ? "etf"
                     : "stock";
  business::require(!(market == "sh" && code.startsWith("000")) &&
                        !(market == "sz" && code.startsWith("399")),
                    "指数流水不能按股票持仓导入");
  return market.toUpper() + ":" + type + ":" + code;
}
QString key(const QString& kind, const QJsonObject& r) {
  business::require(r["id"].isDouble(), "旧记录缺少整数身份");
  return "legacy-webstock:" + kind + ":" + QString::number(r["id"].toInteger());
}
}  // namespace
QJsonObject legacydata::readSourceHistory(const QString& path) {
  business::require(QFileInfo::exists(path),"旧数据库不存在");LegacyConnection c;
  c.db.setDatabaseName(path);c.db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=5000");
  business::require(c.db.open(),"旧数据库只读打开失败");
  business::require(c.db.tables().contains("expert_sync_runs")&&c.db.tables().contains("expert_sync_run_items"),"不是受支持的旧来源历史库");
  business::require(c.db.transaction(),"历史读取快照失败");
  QMap<qint64,QString> authors;for(auto v:rows(c.db,"expert_channels","id")) authors[v.toObject()["id"].toInteger()]=v.toObject()["display_name"].toString();
  QMap<qint64,QJsonArray> detail;
  for(auto v:rows(c.db,"expert_sync_run_items","run_id,id",50000)) {
    auto r=v.toObject();QJsonObject item{{"contentId",r["content_id"]}};
    for(auto k:{"title","source_url","detail_status","transcription_status","message","media_bytes","elapsed_seconds"}) if(r.contains(k))item[QString(k)=="source_url"?"sourceUrl":k]=r[k];
    detail[r["run_id"].toInteger()].append(item);
  }
  QJsonArray out;
  for(auto v:rows(c.db,"expert_sync_runs","id")) {
    auto r=v.toObject();QJsonObject counts;
    for(auto k:sourceHistory::countKeys)if(r.contains(k))counts[k]=r[k];
    QJsonObject run{{"id","legacy-webstock:sync-run:"+QString::number(r["id"].toInteger())},{"channelId",QString::number(r["channel_id"].toInteger())},
      {"author",authors.value(r["channel_id"].toInteger(),"未知旧作者")},{"status",r["status"]},{"startedAt",r["started_at"]},{"counts",counts},{"items",detail.take(r["id"].toInteger())}};
    for(auto k:{"trigger","completed_at","message","error"})if(r.contains(k))run[QString(k)=="completed_at"?"finishedAt":k]=r[k];
    out.append(sourceHistory::validateRun(run));
  }
  business::require(detail.isEmpty(),"旧明细存在找不到轮次的孤立记录，未导出");
  auto file=sourceHistory::bundle(out);sourceHistory::validate(file);
  business::require(QJsonDocument(file).toJson(QJsonDocument::Compact).size()<=32*1024*1024,"历史档案超过32MiB，请分批");
  c.db.rollback();return file;
}
QJsonObject legacydata::readResearchRuns(const QString& path) {
  LegacyConnection c;c.db.setDatabaseName(path);c.db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=5000");
  business::require(c.db.open(),"旧数据库只读打开失败");business::require(c.db.tables().contains("ai_research_runs"),"旧库没有ai_research_runs表");business::require(c.db.transaction(),"旧研究读取快照失败");
  QJsonArray reports;for(auto v:rows(c.db,"ai_research_runs","id"))reports.append(researchRuns::normalize(v.toObject()));business::require(c.db.commit(),"旧研究快照读取失败");return researchRuns::backup(reports);
}
QJsonObject legacydata::readBusiness(const QString& path) {
  business::require(QFileInfo::exists(path), "旧数据库不存在");
  LegacyConnection c;
  c.db.setDatabaseName(path);
  c.db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=5000");
  business::require(c.db.open(), "旧数据库只读打开失败");
  business::require(c.db.tables().contains("trades") &&
                        c.db.tables().contains("portfolio_accounts"),
                    "不是受支持的旧业务数据库");
  business::require(c.db.transaction(), "旧数据库读取快照失败");
  QJsonArray accounts, trades, docs, reports, topics, collections, omitted;
  for (auto v : rows(c.db, "portfolio_accounts", "id")) {
    auto r = v.toObject();
    accounts.append(QJsonObject{{"id", key("account", r)},
                                {"name", r["name"]},
                                {"type", "ledger"},
                                {"legacyId", r["id"]},
                                {"cashBalance", r["cash_balance"]},
                                {"legacyOriginal", r},
                                {"legacySource", "portfolio_accounts"}});
  }
  for (auto v : rows(c.db, "trades", "trade_date,id")) {
    auto r = v.toObject();
    QJsonObject t{
        {"id", key("trade", r)},
        {"accountId", "legacy-webstock:account:" +
                          QString::number(r["account_id"].toInteger())},
        {"instrumentId", identity(r["code"].toString())},
        {"name", r["name"]},
        {"date", r["trade_date"]},
        {"legacyOriginal", r},
        {"legacySource", "trades"}};
    for (auto f : {"side", "price", "quantity", "fee", "tax", "amount", "note"})
      if (r.contains(f)) t[f] = r[f];
    trades.append(t);
  }
  for (auto v : rows(c.db, "knowledge_sources", "id")) {
    auto r = v.toObject();
    QString url = r["source_url"].toString();
    docs.append(QJsonObject{
        {"id", key("knowledge", r)},
        {"title", r["title"]},
        {"text", r["original_content"]},
        {"sourceUrl",
         QRegularExpression("^https?://[^\\s]+$").match(url).hasMatch()
             ? url
             : QString()},
        {"verification", "unverified"},
        {"legacyOriginal", r},
        {"legacySource", "knowledge_sources"}});
  }
  for (auto v : rows(c.db, "portfolio_snapshots", "snapshot_date,id")) {
    auto r = v.toObject();
    reports.append(QJsonObject{
        {"id", key("snapshot", r)},
        {"title", "旧账本快照 " + r["snapshot_date"].toString()},
        {"text", QString::fromUtf8(QJsonDocument(r).toJson())},
        {"verification", "unverified"},
        {"accountId", "legacy-webstock:account:" +
                          QString::number(r["account_id"].toInteger())},
        {"legacyOriginal", r},
        {"legacySource", "portfolio_snapshots"}});
  }
  for (auto v : rows(c.db,"industry_research_topics","id")) {
    auto r=v.toObject();
    topics.append(QJsonObject{{"id","legacy-topic:"+r["id"].toString()},{"name",r["name"]},
      {"aliases",QJsonDocument::fromJson(r["aliases_json"].toString().toUtf8()).array()},
      {"sourceUrls",QJsonDocument::fromJson(r["source_urls_json"].toString().toUtf8()).array()},
      {"legacySource","industry_research_topics"}});
  }
  QHash<qint64,QString> channelNames;
  for (auto v : rows(c.db,"expert_channels","id")) {
    auto r=v.toObject();channelNames[r["id"].toInteger()]=r["display_name"].toString();
  }
  for (auto v : rows(c.db,"expert_observations","id")) {
    auto r=v.toObject(); QJsonObject original;
    // Do not export signed media URLs, login/session/configuration or automatic jobs.
    for (auto key : {"id","channel_id","external_content_id","source_url","title","author",
      "published_at","published_time_precision","first_seen_at","last_seen_at","evidence_level",
      "availability_status","content_role","content_text","description_text","transcript_text",
      "media_type","archive_status","rights_basis","local_asset_path","knowledge_source_id"})
      if(r.contains(key)) original[key]=r[key];
    auto text=r["transcript_text"].toString();
    if(text.isEmpty()) text=r["content_text"].toString();
    collections.append(QJsonObject{{"id",key("observation",r)},{"title",r["title"]},
      {"channel",channelNames.value(r["channel_id"].toInteger())},{"sourceUrl",r["source_url"]},
      {"publishedAt",r["published_at"]},{"rightsBasis",r["rights_basis"]},
      {"assetPath",r["local_asset_path"]},{"originalText",text},{"text",text},{"status","imported"},
      {"qualitySource",collectionQuality::safeSource(r["media_type"].toString(),text,QJsonDocument::fromJson(r["media_metadata_json"].toString().toUtf8()).object())},
      {"legacyOriginal",original},{"legacySource","expert_observations"}});
  }
  // Versions are preserved as read-only source documents, not promoted to verified native relations.
  for(auto v:rows(c.db,"industry_research_evidence","id")) {
    auto r=v.toObject();docs.append(QJsonObject{{"id","legacy-evidence:"+r["id"].toString()},
      {"title","旧研究证据 "+r["id"].toString()},{"text",r["payload_json"]},
      {"sourceUrl",r["canonical_url"]},{"verification","unverified"},{"legacySource","industry_research_evidence"}});
  }
  for(auto v:rows(c.db,"industry_research_versions","sequence")) {
    auto r=v.toObject();reports.append(QJsonObject{{"id","legacy-version:"+r["id"].toString()},
      {"title","旧研究版本 "+r["topic_id"].toString()+" #"+QString::number(r["sequence"].toInt())},
      {"text",r["payload_json"]},{"verification","unverified"},{"legacySource","industry_research_versions"}});
  }
  for(auto v:rows(c.db,"ai_research_runs","id"))reports.append(researchRuns::normalize(v.toObject()));
  for (const auto& name : c.db.tables())
    if (!QStringList{"portfolio_accounts", "trades", "knowledge_sources",
                     "portfolio_snapshots", "industry_research_topics", "industry_research_evidence", "industry_research_versions", "expert_observations", "ai_research_runs"}
             .contains(name))
      omitted.append(name);
  QJsonObject out{
      {"schema", "native-business-v1"},
      {"mergePolicy", "keep-existing"},
      {"origin", "webstock-legacy-readonly"},
      {"accounts", accounts},
      {"trades", trades},
      {"docs", docs},
      {"reports", reports},
      {"topics", topics},
      {"relations", QJsonArray()},
      {"collections", collections},
      {"notMigratedTables", omitted},
      {"createdAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODate)}};
  for (auto a : accounts)
    business::portfolio(trades, {}, a.toObject()["id"].toString());
  business::require(QJsonDocument(out).toJson(QJsonDocument::Compact).size() <=
                        business::backupByteLimit,
                    "导入超过32MiB，需分批处理");
  c.db.rollback();  // End the read snapshot; the source was never writable.
  return out;
}
