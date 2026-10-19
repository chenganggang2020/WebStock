#include "source_handoff_store.hpp"
#include "source_analysis_packet.hpp"
#include "business_store.hpp"
#include <QtSql>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QUuid>
#include <QDateTime>
namespace {
constexpr int ApplicationId = 0x53484431;
struct Connection {
  QString name = QUuid::createUuid().toString(); QSqlDatabase db;
  explicit Connection(const QString& file) {
    db = QSqlDatabase::addDatabase("QSQLITE", name); db.setDatabaseName(file);
    if (!db.open()) { auto e = db.lastError().text(); db = {}; QSqlDatabase::removeDatabase(name); throw std::runtime_error(e.toStdString()); }
  }
  ~Connection() { db.close(); db = {}; QSqlDatabase::removeDatabase(name); }
};
QSqlQuery query(QSqlDatabase& db, const QString& sql, const QVariantList& args = {}) {
  QSqlQuery q(db); business::require(q.prepare(sql), q.lastError().text());
  for (auto a : args) q.addBindValue(a); business::require(q.exec(), q.lastError().text()); return q;
}
QJsonObject parse(const QByteArray& bytes) {
  QJsonParseError e; const auto d = QJsonDocument::fromJson(bytes, &e);
  business::require(e.error == QJsonParseError::NoError && d.isObject(), "记录损坏，未覆盖"); return d.object();
}
void size(const QJsonObject& row) { business::require(QJsonDocument(row).toJson(QJsonDocument::Compact).size() <= sourceAnalysis::ByteLimit, "记录超过25MiB，未保存"); }
QJsonObject validated(QJsonObject row) {
  for (const auto& key : {"id", "title", "prompt", "result", "kind", "savedAt"})
    business::require(row[key].isString(), QString("交接字段无效：") + key);
  business::require(!row["id"].toString().isEmpty() && row["id"].toString().size() <= 300 && !row["result"].toString().trimmed().isEmpty(), "交接身份或结果为空");
  business::require(row["sourceReferences"].isArray(), "交接来源列表无效"); size(row); return row;
}
QJsonObject lookup(QSqlDatabase& db, const QString& id) {
  auto q = query(db, "SELECT payload FROM handoffs WHERE id=?", {id}); return q.next() ? parse(q.value(0).toByteArray()) : QJsonObject{};
}
}
SourceHandoffStore::SourceHandoffStore(const QString& path) : file(path) {
  business::require(QDir::isAbsolutePath(path), "交接库须为独立绝对路径");
  business::require(QDir().mkpath(QFileInfo(file).absolutePath()), "无法创建交接库目录");
  Connection c(file); business::require(c.db.transaction(), "交接库不可开始事务");
  auto version = query(c.db, "PRAGMA user_version"); version.next(); const int v = version.value(0).toInt(); version.finish();
  auto app = query(c.db, "PRAGMA application_id"); app.next(); const int a = app.value(0).toInt(); app.finish();
  if (v == 0 && a == 0) {
    auto tables = query(c.db, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"); tables.next();
    business::require(tables.value(0).toInt() == 0, "目标不是空交接库，未修改原表"); tables.finish();
    query(c.db, "CREATE TABLE handoffs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,saved_at TEXT NOT NULL,payload TEXT NOT NULL)");
    query(c.db, "CREATE TABLE drafts(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
    query(c.db, "PRAGMA application_id=" + QString::number(ApplicationId)); query(c.db, "PRAGMA user_version=1");
  } else business::require(v == 1 && a == ApplicationId, "交接库版本或身份不支持，未重建");
  query(c.db, "SELECT id,kind,saved_at,payload FROM handoffs LIMIT 0"); query(c.db, "SELECT id,payload FROM drafts LIMIT 0");
  business::require(c.db.commit(), "交接库初始化失败");
}
QJsonObject SourceHandoffStore::saveResult(const QJsonObject& packet, const QString& title, const QString& answer) {
  business::require(packet["schema"] == "source-analysis-packet-v1" && !packet["markdown"].toString().isEmpty() &&
      !packet["sourceReferences"].toArray().isEmpty(), "请先生成完整来源材料");
  const auto result = sourceAnalysis::extractResult(answer);
  QJsonObject row{{"id", QUuid::createUuid().toString(QUuid::WithoutBraces)}, {"title", title.trimmed().isEmpty() ? packet["title"] : QJsonValue(title)},
      {"summary", "用户手动回填，待核验；仅保存本机交接记录"}, {"prompt", packet["markdown"]}, {"result", result["text"]},
      {"rawResult", answer}, {"kind", "source-analysis"}, {"context", packet["subject"]},
      {"savedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}, {"provenance", "manual-unverified"},
      {"sourceReferences", packet["sourceReferences"]}, {"packet", packet}, {"bodyHash", sourceAnalysis::hash(result["text"].toString())}};
  validated(row); Connection c(file); query(c.db, "INSERT INTO handoffs VALUES(?,?,?,?)", {row["id"].toString(), row["kind"].toString(), row["savedAt"].toString(), QJsonDocument(row).toJson(QJsonDocument::Compact)}); return row;
}
QJsonObject SourceHandoffStore::saveDraft(const QJsonObject& input, const QString& expectedRevision) {
  size(input); Connection c(file); business::require(c.db.transaction(), "草稿库无法开始事务");
  try {
    auto q = query(c.db, "SELECT payload FROM drafts WHERE id='analysis'"); const auto old = q.next() ? parse(q.value(0).toByteArray()) : QJsonObject{}; q.finish();
    business::require(old["draftRevision"].toString() == expectedRevision, "其他入口已更新共享草稿；旧页未覆盖，请重读共享草稿");
    auto row = input, content = old; row.remove("draftRevision"); content.remove("draftRevision");
    if (row == content && !old.isEmpty()) { business::require(c.db.commit(), "草稿事务失败"); return old; }
    row["draftRevision"] = QUuid::createUuid().toString(QUuid::WithoutBraces); size(row);
    query(c.db, "INSERT INTO drafts VALUES('analysis',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", {QJsonDocument(row).toJson(QJsonDocument::Compact)});
    business::require(c.db.commit(), "草稿保存失败"); return row;
  } catch(...) { c.db.rollback();throw; }
}
QJsonObject SourceHandoffStore::draft() const {
  Connection c(file); auto q = query(c.db, "SELECT payload FROM drafts WHERE id='analysis'"); return q.next() ? parse(q.value(0).toByteArray()) : QJsonObject{};
}
QJsonArray SourceHandoffStore::page(int offset, const QString& kind) const {
  business::require(offset >= 0, "分页位置无效"); Connection c(file);
  const auto filter = kind.isNull() ? QStringLiteral("") : kind;
  auto q = query(c.db, "SELECT payload FROM handoffs WHERE (?='' OR kind=?) ORDER BY saved_at DESC,id DESC LIMIT 50 OFFSET ?", {filter,filter,offset});
  QJsonArray out; while(q.next()) { const auto row=parse(q.value(0).toByteArray()); QJsonObject summary;
    for(const auto& key:{"id","title","kind","savedAt","summary"})summary[key]=row[key].toString();out.append(summary); } return out;
}
QJsonObject SourceHandoffStore::detail(const QString& id) const { Connection c(file); auto r = lookup(c.db,id); business::require(!r.isEmpty(), "交接记录已不存在"); return r; }
QJsonObject SourceHandoffStore::previewImport(const QByteArray& bytes, const QString& sourceKey) const {
  business::require(bytes.size() <= sourceAnalysis::ByteLimit && !sourceKey.isEmpty(), "导入文件超过25MiB或来源身份为空");
  QJsonParseError e; auto d = QJsonDocument::fromJson(bytes, &e); business::require(e.error == QJsonParseError::NoError, "导入JSON无效");
  QJsonArray input; bool native = false;
  if (d.isArray()) input = d.array();
  else if (d.isObject() && d.object()["schema"] == "source-handoff-v1") { native=true; input=d.object()["records"].toArray(); business::require(d.object()["records"].isArray(), "备份列表无效"); }
  else if(d.isObject() && d.object()["webstock_ai_handoff_results"].isArray()) input=d.object()["webstock_ai_handoff_results"].toArray();
  else if(d.isObject() && d.object()["webstock_ai_handoff_results"].isString()) {
    const auto nested=QJsonDocument::fromJson(d.object()["webstock_ai_handoff_results"].toString().toUtf8(),&e);
    business::require(e.error==QJsonParseError::NoError&&nested.isArray(),"旧localStorage字段不是交接数组");input=nested.array();
  }
  else throw std::runtime_error("只接受旧交接数组或source-handoff-v1备份");
  business::require(input.size() <= 10000, "导入记录超过10000条");
  Connection c(file); QJsonArray rows, errors; int added=0, duplicate=0, conflict=0; QSet<QString> ids;
  for(int i=0;i<input.size();++i) {
    try {
      business::require(input[i].isObject(), "记录不是对象"); auto row=input[i].toObject();
      if(!native) {
        const auto identity = row["id"].isString() ? row["id"].toString() : QString::number(i);
        row["id"]="legacy:"+sourceAnalysis::hash(sourceKey+QChar(0)+identity);
        for(const auto& key:{"title","summary","prompt","kind","savedAt"}) if(!row.contains(key)) row[key]="";
        if(row["kind"].toString().isEmpty()) row["kind"]="general";
        row["sourceReferences"]=QJsonArray{}; row["provenance"]="legacy-manual-unverified";
        row["importSourceHash"]=sourceAnalysis::hash(sourceKey); row["importIndex"]=i;
      }
      row=validated(row); business::require(!ids.contains(row["id"].toString()), "文件内身份重复"); ids.insert(row["id"].toString());
      const auto existing=lookup(c.db,row["id"].toString()); QString state;
      if(existing.isEmpty()) {state="new";++added;} else if(existing==row) {state="duplicate";++duplicate;} else {state="conflict";++conflict;}
      rows.append(QJsonObject{{"record",row},{"state",state}});
    } catch(const std::exception& ex) {errors.append(QJsonObject{{"index",i},{"reason",QString::fromUtf8(ex.what())}});}
  }
  return {{"schema","source-handoff-preview-v1"},{"rows",rows},{"errors",errors},{"newCount",added},{"duplicateCount",duplicate},{"conflictCount",conflict}};
}
QJsonObject SourceHandoffStore::merge(const QJsonObject& preview) {
  business::require(preview["schema"]=="source-handoff-preview-v1" && preview["errors"].isArray() && preview["errors"].toArray().isEmpty(), "预览有错误，未合并");
  Connection c(file); business::require(c.db.transaction(), "交接库无法开始合并"); int added=0, duplicate=0, conflict=0;
  try {
    for(auto value:preview["rows"].toArray()) {
      const auto row=validated(value.toObject()["record"].toObject()), old=lookup(c.db,row["id"].toString());
      if(!old.isEmpty()) { if(old==row) ++duplicate; else ++conflict; continue; }
      query(c.db,"INSERT INTO handoffs VALUES(?,?,?,?)",{row["id"].toString(),row["kind"].toString(),row["savedAt"].toString(),QJsonDocument(row).toJson(QJsonDocument::Compact)}); ++added;
    }
    business::require(c.db.commit(), "合并提交失败");
  } catch(...) {c.db.rollback();throw;}
  return {{"added",added},{"duplicate",duplicate},{"conflict",conflict},{"policy","keep-existing"}};
}
QByteArray SourceHandoffStore::backup() const {
  Connection c(file); auto q=query(c.db,"SELECT payload FROM handoffs ORDER BY saved_at,id"); QJsonArray rows;
  qint64 total=0;while(q.next()) { const auto payload=q.value(0).toByteArray();total+=payload.size();business::require(total<=sourceAnalysis::ByteLimit,"备份超过25MiB；未截断全文");rows.append(parse(payload)); }
  const auto bytes=QJsonDocument(QJsonObject{{"schema","source-handoff-v1"},{"records",rows},{"mergePolicy","keep-existing"}}).toJson();
  business::require(bytes.size()<=sourceAnalysis::ByteLimit,"备份超过25MiB；未截断全文"); return bytes;
}
