#pragma once
#include <QDate>
#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMap>
#include <QRegularExpression>
#include <QSet>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QUuid>
#include <QUrl>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <functional>
#include <QCryptographicHash>
#include "collection_quality.hpp"
#include "account_edit_model.hpp"
#include "creator_analysis.hpp"
#include "creator_ai_model.hpp"
#include "creator_ai_execution.hpp"
#include "research_companies.hpp"
namespace business {
inline constexpr qint64 backupByteLimit = 32 * 1024 * 1024;
inline QStringList kinds() { return {"accounts", "trades", "docs", "reports", "topics", "relations", "collections"}; }
inline void require(bool ok, const QString& reason) {
  if (!ok) throw std::runtime_error(reason.toStdString());
}
inline double number(const QJsonObject& o, const QString& key,
                     double fallback = 0) {
  require(!o.contains(key) || o[key].isDouble(), key + "必须是数值");
  double n = o[key].toDouble(fallback);
  require(std::isfinite(n) && n >= 0 && n <= 1e12, key + "超出有效范围");
  return n;
}
inline double rounded(long double n) {
  return double(std::round(n * 100.0L) / 100.0L);
}
// Same moving-average-cost ledger as services/portfolioService.js; no order
// execution.
inline QJsonObject portfolio(const QJsonArray& input, const QJsonObject& quotes,
                             const QString& account) {
  QList<QJsonObject> trades;
  for (auto v : input)
    if (v.toObject()["accountId"].toString() == account) trades << v.toObject();
  std::stable_sort(trades.begin(), trades.end(),
                   [](const auto& a, const auto& b) {
                     return a["date"].toString() < b["date"].toString();
                   });
  struct Position {
    QString name;
    qint64 quantity = 0;
    long double cost = 0, realized = 0, fees = 0;
  };
  QMap<QString, Position> holdings;
  long double totalCost = 0, totalRealized = 0, totalValue = 0, totalFees = 0;
  bool missing = false;
  QJsonArray rows;
  for (auto t : trades) {
    QString id = t["instrumentId"].toString(), side = t["side"].toString(),
            date = t["date"].toString();
    require(QRegularExpression("^(SH|SZ|BJ):(stock|etf):[0-9]{6}$")
                .match(id)
                .hasMatch(),
            "账本需明确股票/ETF市场身份");
    require(QDate::fromString(date, Qt::ISODate).isValid() && date.size() == 10,
            "交易日期无效");
    require(QStringList{"buy", "sell", "dividend", "fee"}.contains(side),
            "交易类型无效");
    long double qty = number(t, "quantity"), price = number(t, "price"),
                fee = number(t, "fee"), tax = number(t, "tax");
    require(qty == std::floor(qty) && qty <= 1e9, "股数需为整数且不超过十亿");
    if (side == "buy" || side == "sell")
      require(qty > 0 && price > 0, "买卖价格和股数必须大于零");
    auto& p = holdings[id];
    p.name = t["name"].toString(id);
    if (side == "buy") {
      p.quantity += qint64(qty);
      p.cost += qty * price + fee;
    } else if (side == "sell") {
      require(qty <= p.quantity, "卖出股数超过该账户已有持仓");
      long double removed = p.cost * qty / p.quantity;
      p.realized += qty * price - fee - tax - removed;
      p.cost -= removed;
      p.quantity -= qint64(qty);
      if (p.quantity == 0) p.cost = 0;
    } else if (side == "dividend")
      p.realized += number(t, "amount", double(qty * price));
    else
      p.realized -= number(t, "amount", double(fee));
    p.fees += side == "fee" ? number(t, "amount", double(fee)) : fee + tax;
  }
  for (auto it = holdings.cbegin(); it != holdings.cend(); ++it) {
    auto p = it.value();
    totalRealized += p.realized;
    totalFees += p.fees;
    totalCost += p.cost;
    auto quote = quotes[it.key()].toObject();
    double price = quote["price"].toDouble(0);
    bool valid = std::isfinite(price) && price > 0;
    if (p.quantity > 0 && !valid) missing = true;
    long double value = valid ? price * p.quantity : 0;
    totalValue += value;
    rows.append(QJsonObject{
        {"instrumentId", it.key()},
        {"name", p.name},
        {"quantity", double(p.quantity)},
        {"cost", rounded(p.cost)},
        {"averageCost", p.quantity > 0 ? double(p.cost / p.quantity) : 0},
        {"realized", rounded(p.realized)},
        {"price", valid ? QJsonValue(price) : QJsonValue(QJsonValue::Null)},
        {"marketValue", valid || p.quantity == 0
                            ? QJsonValue(rounded(value))
                            : QJsonValue(QJsonValue::Null)},
        {"unrealized", valid || p.quantity == 0
                           ? QJsonValue(rounded(value - p.cost))
                           : QJsonValue(QJsonValue::Null)},
        {"quoteDate", quote["tradeDate"]},
        {"quoteTime", quote["tradeTime"]}});
  }
  return {
      {"positions", rows},
      {"cost", rounded(totalCost)},
      {"realized", rounded(totalRealized)},
      {"fees", rounded(totalFees)},
      {"tradeCount", trades.size()},
      {"marketValue", missing ? QJsonValue(QJsonValue::Null)
                              : QJsonValue(rounded(totalValue))},
      {"unrealized", missing ? QJsonValue(QJsonValue::Null)
                             : QJsonValue(rounded(totalValue - totalCost))}};
}
}  // namespace business
class BusinessStore {
  QString file;
  struct Connection {
    QString name = QUuid::createUuid().toString();
    QSqlDatabase db;
    explicit Connection(const QString& file) {
      QDir().mkpath(QFileInfo(file).absolutePath());
      db = QSqlDatabase::addDatabase("QSQLITE", name);
      db.setDatabaseName(file);
      business::require(db.open(), "无法打开原生业务库");
      QSqlQuery q(db);
      q.exec("PRAGMA busy_timeout=3000");
      q.exec("PRAGMA synchronous=FULL");
      business::require(
          q.exec("CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id "
                 "TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))"),
          q.lastError().text());
    }
    ~Connection() {
      db.close();
      db = QSqlDatabase();
      QSqlDatabase::removeDatabase(name);
    }
  };
  static QJsonArray read(QSqlDatabase& db, const QString& kind) {
    QSqlQuery q(db);
    q.prepare("SELECT payload FROM records WHERE kind=? ORDER BY rowid");
    q.addBindValue(kind);
    business::require(q.exec(), q.lastError().text());
    QJsonArray result;
    while (q.next()) {
      QJsonParseError e;
      auto d = QJsonDocument::fromJson(q.value(0).toByteArray(), &e);
      business::require(e.error == QJsonParseError::NoError && d.isObject(),
                        "业务记录损坏，请从备份恢复");
      result.append(d.object());
    }
    return result;
  }
  static void write(QSqlDatabase& db, const QString& kind,
                    const QJsonObject& item) {
    QSqlQuery q(db);
    q.prepare(
        "INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON "
        "CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload");
    q.addBindValue(kind);
    q.addBindValue(item["id"].toString());
    q.addBindValue(
        QString::fromUtf8(QJsonDocument(item).toJson(QJsonDocument::Compact)));
    const bool written = q.exec();
    business::require(written, q.lastError().text());
  }
  static QJsonObject validate(const QString& kind, QJsonObject item) {
    business::require(
        business::kinds().contains(kind),
        "未知业务类型");
    if (item["id"].toString().isEmpty())
      item["id"] = QUuid::createUuid().toString(QUuid::WithoutBraces);
    business::require(item["id"].toString().size() <= 100, "记录ID过长");
    if (kind == "accounts") {
      business::require(!item["name"].toString().trimmed().isEmpty(),
                        "账户名不能为空");
      business::require(
          QStringList{"ledger", "paper"}.contains(item["type"].toString()),
          "账户类型无效");
    }
    if (kind == "docs" || kind == "reports") {
      business::require(!item["title"].toString().trimmed().isEmpty(),
                        "资料标题不能为空");
      business::require(item["text"].toString().size() <= 600000,
                        "请将资料拆分至60万字以内");
      QString url = item["sourceUrl"].toString();
      business::require(
          url.isEmpty() ||
              QRegularExpression("^https?://[^\\s]+$").match(url).hasMatch(),
          "来源链接必须为HTTP或HTTPS");
      business::require(QStringList{"unverified", "manuallyVerified"}.contains(
                            item["verification"].toString("unverified")),
                        "核验状态无效");
    }
    if (kind == "topics")
      business::require(!item["name"].toString().trimmed().isEmpty() && item["name"].toString().size() <= 120, "主题名需为1至120字");
    if (kind == "relations") {
      researchCompanies::validateMetadata(item);
      business::require(!item["claim"].toString().trimmed().isEmpty() && item["claim"].toString().size() <= 1000, "关系说明需为1至1000字");
      business::require(!item["quote"].toString().trimmed().isEmpty() && item["quote"].toString().size() <= 2000, "请填写1至2000字原文引用");
      business::require(QStringList{"materials","equipment","components","manufacturing","applications"}.contains(item["stage"].toString()), "产业阶段无效");
      business::require(QStringList{"supports","contradicts"}.contains(item["polarity"].toString()), "证据方向无效");
      business::require(QStringList{"unverified","manuallyVerified"}.contains(item["verification"].toString("unverified")), "仅支持待核验或人工核验");
    }
    if (kind == "collections") {
      creatorAnalysis::validateHistory(item);
      if(item.contains("qualityReviews")) {
        business::require(item["qualityReviews"].isArray()&&item["qualityReviews"].toArray().size()<=1000,"文稿复核历史格式无效");
        for(auto v:item["qualityReviews"].toArray())business::require(v.isObject()&&collectionQuality::validReview(v.toObject()),"文稿复核记录缺少正文身份、说明或时间");
      }
      business::require(!item["title"].toString().trimmed().isEmpty(), "采集任务需有标题");
      business::require(item["text"].toString().size() <= 600000 && item["originalText"].toString().size() <= 600000, "文稿超过60万字");
      business::require(QStringList{"imported","queued","running","completed","failed","cancelled","interrupted"}.contains(item["status"].toString()), "任务状态无效");
    }
    item["updatedAt"] =
        QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
    return item;
  }
  static void validateLedgers(QSqlDatabase& db) {
    auto accounts = read(db, "accounts"), trades = read(db, "trades");
    QStringList ids;
    for (auto a : accounts) {
      auto id = a.toObject()["id"].toString();
      ids << id;
      business::portfolio(trades, {}, id);
    }
    for (auto t : trades)
      business::require(ids.contains(t.toObject()["accountId"].toString()),
                        "交易引用的账户不存在");
    QSet<QString> topics;
    QHash<QString, QString> docs;
    for (auto t : read(db,"topics")) topics.insert(t.toObject()["id"].toString());
    for (auto d : read(db,"docs")) docs[d.toObject()["id"].toString()] = d.toObject()["text"].toString();
    for (auto v : read(db,"relations")) {
      auto r = v.toObject();
      business::require(topics.contains(r["topicId"].toString()), "关系引用的主题不存在");
      business::require(docs.contains(r["documentId"].toString()) && docs[r["documentId"].toString()].contains(r["quote"].toString()), "引用必须匹配已有资料原文；请先处理引用关系");
      researchCompanies::validateReferences(r,docs);
    }
  }

 public:
  static QJsonObject validateSectorRelation(QJsonObject item){return validate("relations",item);}
  // Read-only connection; both kinds share one SQLite snapshot. Missing paths never initialize a Store.
  static QJsonObject readLedgerSnapshot(const QString& path,const std::function<bool()>& cancelled={}) {
    auto active=[&]{business::require(!cancelled||!cancelled(),"账本背景读取已取消");};active();
    business::require(QFileInfo(path).isFile(),"本机账本来源不存在，未创建");
    const auto name=QUuid::createUuid().toString();auto db=QSqlDatabase::addDatabase("QSQLITE",name);
    auto close=[&]{db.close();db={};QSqlDatabase::removeDatabase(name);};
    try {db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");business::require(db.open(),"只读账本连接失败");
      business::require(db.transaction(),"只读账本事务不可用");QJsonObject out;qint64 total=0;
      for(const auto& kind:QStringList{"accounts","trades"}) {active();QJsonArray rows;QSqlQuery q(db);
        q.prepare("SELECT id,length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=8388608 THEN payload ELSE NULL END FROM records WHERE kind=? ORDER BY rowid");q.addBindValue(kind);business::require(q.exec(),"原生账本结构不可读");
        while(q.next()){active();auto length=q.value(1).toLongLong();total+=length;business::require(length>0&&total<=8388608,"账本背景原文超过8MiB，未截断");QJsonParseError error;auto doc=QJsonDocument::fromJson(q.value(2).toString().toUtf8(),&error);
          business::require(error.error==QJsonParseError::NoError&&doc.isObject()&&doc.object()["id"]==q.value(0).toString(),"账本记录身份或正文损坏");rows.append(doc.object());}
        out[kind]=rows;active();
      }
      active();business::require(db.commit(),"只读账本事务结束失败");close();return out;
    }catch(...){db.rollback();close();throw;}
  }
  static QJsonObject readCandidateThemeSnapshot(const QString& path,const std::function<bool()>& cancelled={}) {
    auto active=[&]{business::require(!cancelled||!cancelled(),"候选主题资料背景读取已取消");};active();
    business::require(QFileInfo(path).isFile(),"本机候选主题资料来源不存在，未创建");
    const auto name=QUuid::createUuid().toString();auto db=QSqlDatabase::addDatabase("QSQLITE",name);
    auto close=[&]{db.close();db={};QSqlDatabase::removeDatabase(name);};
    try {db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");business::require(db.open(),"只读候选主题资料连接失败");
      business::require(db.transaction(),"只读候选主题资料事务不可用");QJsonObject out;qint64 total=0;
      for(const auto& kind:QStringList{"topics","relations","docs"}) {active();QJsonArray rows;QSqlQuery q(db);
        q.prepare("SELECT id,length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=8388608 THEN payload ELSE NULL END FROM records WHERE kind=? ORDER BY rowid");q.addBindValue(kind);business::require(q.exec(),"原生候选主题资料结构不可读");
        while(q.next()){active();auto length=q.value(1).toLongLong();total+=length;business::require(length>0&&total<=8388608,"候选主题资料背景原文超过8MiB，未截断");QJsonParseError error;auto doc=QJsonDocument::fromJson(q.value(2).toString().toUtf8(),&error);
          business::require(error.error==QJsonParseError::NoError&&doc.isObject()&&doc.object()["id"]==q.value(0).toString(),"候选主题资料记录身份或正文损坏");rows.append(doc.object());}
        out[kind]=rows;active();
      }
      active();business::require(db.commit(),"只读候选主题资料事务结束失败");close();return out;
    }catch(...){db.rollback();close();throw;}
  }
  // P06 reads never initialize a Store, change schema or share a SQL connection across threads.
  static QJsonObject readRecord(const QString& path,const QString& kind,const QString& id,
                               const QString& expectedPayloadSha256={},const std::function<bool()>& cancelled={}) {
    auto active=[&]{business::require(!cancelled||!cancelled(),"资料读取已取消");};active();
    business::require(business::kinds().contains(kind)&&!id.isEmpty()&&id.size()<=100,"资料类型或原ID无效");
    business::require(expectedPayloadSha256.isEmpty()||QRegularExpression("^[a-f0-9]{64}$").match(expectedPayloadSha256).hasMatch(),"资料版本摘要无效");
    business::require(QFileInfo(path).isFile(),"资料库不存在，未创建");
    const auto name=QUuid::createUuid().toString();auto db=QSqlDatabase::addDatabase("QSQLITE",name);
    auto close=[&]{db.close();db={};QSqlDatabase::removeDatabase(name);};
    try {db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");business::require(db.open(),"资料只读连接失败");QJsonObject row;
      {QSqlQuery q(db);q.prepare("SELECT length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=33554432 THEN CAST(payload AS BLOB) ELSE NULL END FROM records WHERE kind=? AND id=?");q.addBindValue(kind);q.addBindValue(id);business::require(q.exec(),"资料读取暂不可用，请重试");active();
       if(q.next()){business::require(q.value(0).toLongLong()>0&&q.value(0).toLongLong()<=business::backupByteLimit,"资料原文超过32MiB或损坏，未截断");const auto raw=q.value(1).toByteArray();
        const auto hash=QString::fromLatin1(QCryptographicHash::hash(raw,QCryptographicHash::Sha256).toHex());business::require(expectedPayloadSha256.isEmpty()||hash==expectedPayloadSha256,"资料原版本已变化，请重新选择；草稿保留");
        QJsonParseError error;auto doc=QJsonDocument::fromJson(raw,&error);business::require(error.error==QJsonParseError::NoError&&doc.isObject()&&doc.object()["id"]==id,"资料原ID或正文损坏");row=doc.object();}}
      active();close();return row;
    }catch(...){close();throw;}
  }
  static QJsonArray readListSummaries(const QString& path,const QString& kind,const QString& search={},
                                     const std::function<bool()>& cancelled={}) {
    auto active=[&]{business::require(!cancelled||!cancelled(),"资料列表读取已取消");};active();
    business::require(QStringList{"docs","collections","reports"}.contains(kind),"此轻量列表不支持该业务类型");
    business::require(QFileInfo(path).isFile(),"资料库不存在，未创建");
    const auto name=QUuid::createUuid().toString();auto db=QSqlDatabase::addDatabase("QSQLITE",name);
    auto close=[&]{db.close();db={};QSqlDatabase::removeDatabase(name);};
    try {db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");business::require(db.open(),"资料列表只读连接失败");business::require(db.transaction(),"资料列表只读快照失败");QJsonArray result;
      {QStringList fields{"id","title","topic","author","channel","sourceProfile","sourceUrl","sourceType","type","publishedAt","updatedAt","status","pipelineState","assetPath","archive","legacySource","sourceRootId","collectionId"};QStringList members;
       for(auto field:fields)members<<"'"+field+"',json_extract(payload,'$."+field+"')";
       members<<"'sourceMetadata',json_object('title',json_extract(payload,'$.sourceMetadata.title'))";
       members<<"'legacyOriginal',json_object('channel_id',json_extract(payload,'$.legacyOriginal.channel_id'),'external_content_id',json_extract(payload,'$.legacyOriginal.external_content_id'))";
       const QString valid="CASE WHEN json_valid(payload) THEN json_type(payload)='object' ELSE 0 END";
       QSqlQuery q(db);q.prepare("SELECT id,length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=33554432 THEN CAST(payload AS BLOB) ELSE NULL END,"+valid+",CASE WHEN "+valid+" THEN json_object("+members.join(',')+") ELSE '{}' END,CASE WHEN "+valid+" AND ?<>'' THEN json_extract(payload,'$.text') ELSE NULL END FROM records WHERE kind=? ORDER BY rowid");q.addBindValue(search);q.addBindValue(kind);business::require(q.exec(),"资料列表暂不可用，请重试");
       while(q.next()){active();business::require(q.value(1).toLongLong()>0&&q.value(1).toLongLong()<=business::backupByteLimit&&q.value(3).toBool(),"资料原文损坏或超过32MiB，未忽略/截断");QJsonParseError error;auto metadata=QJsonDocument::fromJson(q.value(4).toString().toUtf8(),&error);business::require(error.error==QJsonParseError::NoError&&metadata.isObject(),"资料列表投影不可读");auto row=metadata.object();business::require(!q.value(0).toString().isEmpty()&&row["id"]==q.value(0).toString(),"资料列表原ID不符");
        const auto text=row["title"].toString()+(kind=="collections"?row["channel"].toString():row["topic"].toString())+q.value(5).toString();const bool matches=search.isEmpty()||text.contains(search,Qt::CaseInsensitive);if(kind!="collections"&&!matches)continue;if(kind=="collections")row["_queryMatch"]=matches;
        row["_recordSha256"]=QString::fromLatin1(QCryptographicHash::hash(q.value(2).toByteArray(),QCryptographicHash::Sha256).toHex());result.append(row);
       }}
      active();business::require(db.commit(),"资料列表快照结束失败");close();return result;
    }catch(...){db.rollback();close();throw;}
  }
  static QJsonObject readPortfolioSnapshot(const QString& path,const std::function<bool()>& cancelled={},bool allReports=false) {
    auto active=[&]{business::require(!cancelled||!cancelled(),"账本读取已取消");};active();business::require(QFileInfo(path).isFile(),"本机账本不存在，未创建");
    auto name=QUuid::createUuid().toString();auto db=QSqlDatabase::addDatabase("QSQLITE",name);auto close=[&]{db.close();db={};QSqlDatabase::removeDatabase(name);};
    try{db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");business::require(db.open(),"只读账本连接失败");business::require(db.transaction(),"账本一致读取事务失败");QJsonObject out;
      for(auto kind:QStringList{"accounts","trades","reports"}){active();QJsonArray rows;
        {QSqlQuery q(db);QString predicate=kind=="reports"&&!allReports?" AND CASE WHEN json_valid(payload) THEN json_type(payload)!='object' OR json_extract(payload,'$.accountId') IS NOT NULL ELSE 1 END":"";
         q.prepare("SELECT id,length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=33554432 THEN CAST(payload AS BLOB) ELSE NULL END FROM records WHERE kind=?"+predicate+" ORDER BY rowid");q.addBindValue(kind);business::require(q.exec(),"账本读取暂不可用，请重试");
         while(q.next()){active();business::require(q.value(1).toLongLong()>0&&q.value(1).toLongLong()<=business::backupByteLimit,"账本原记录过大或损坏，未截断");QJsonParseError error;auto doc=QJsonDocument::fromJson(q.value(2).toByteArray(),&error);business::require(error.error==QJsonParseError::NoError&&doc.isObject()&&doc.object()["id"]==q.value(0).toString(),"账本原记录或ID损坏");rows.append(doc.object());}}
        out[kind]=rows;
      }
      active();business::require(db.commit(),"账本一致读取结束失败");close();return out;
    }catch(...){db.rollback();close();throw;}
  }
  static QJsonObject readIndustrySummaries(const QString& path,const std::function<bool()>& cancelled={}) {
    auto active=[&]{business::require(!cancelled||!cancelled(),"产业资料读取已取消");};active();business::require(QFileInfo(path).isFile(),"本机资料库不存在，未创建");
    auto name=QUuid::createUuid().toString();auto db=QSqlDatabase::addDatabase("QSQLITE",name);auto close=[&]{db.close();db={};QSqlDatabase::removeDatabase(name);};
    try{db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");business::require(db.open(),"产业资料只读连接失败");business::require(db.transaction(),"产业资料一致读取失败");QJsonObject out;
      for(auto kind:QStringList{"topics","relations","docs"}){active();QJsonArray rows;
        const QStringList fields=kind=="topics"?QStringList{"id","name"}:kind=="relations"?QStringList{"id","topicId","documentId","stage","claim","quote","polarity","verification"}:QStringList{"id","title","sourceUrl"};QStringList members;
        for(auto field:fields)members<<"'"+field+"',json_extract(payload,'$."+field+"')";
        const QString valid="CASE WHEN json_valid(payload) THEN json_type(payload)='object' ELSE 0 END";
        {QSqlQuery q(db);q.prepare("SELECT id,length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=33554432 THEN CAST(payload AS BLOB) ELSE NULL END,"+valid+",CASE WHEN "+valid+" THEN json_object("+members.join(',')+") ELSE '{}' END FROM records WHERE kind=? ORDER BY rowid");q.addBindValue(kind);business::require(q.exec(),"产业资料暂不可读，请重试");
          while(q.next()){active();business::require(q.value(1).toLongLong()>0&&q.value(1).toLongLong()<=business::backupByteLimit&&q.value(3).toBool(),"产业原记录损坏或超过32MiB，未截断");QJsonParseError error;auto row=QJsonDocument::fromJson(q.value(4).toString().toUtf8(),&error).object();business::require(error.error==QJsonParseError::NoError&&!q.value(0).toString().isEmpty()&&row["id"]==q.value(0).toString(),"产业原记录或ID损坏");row["_recordSha256"]=QString::fromLatin1(QCryptographicHash::hash(q.value(2).toByteArray(),QCryptographicHash::Sha256).toHex());rows.append(row);}}
        out[kind]=rows;
      }
      active();business::require(db.commit(),"产业资料读取结束失败");close();return out;
    }catch(...){db.rollback();close();throw;}
  }
  QString filePath() const { return QFileInfo(file).absoluteFilePath(); }
  explicit BusinessStore(QString path) : file(std::move(path)) {
    Connection c(file);
    if (read(c.db, "accounts").isEmpty()) {
      business::require(c.db.transaction(), "无法开始事务");
      write(c.db, "accounts",
            {{"id", "local"}, {"name", "我的账本"}, {"type", "ledger"}});
      write(c.db, "accounts",
            {{"id", "paper"}, {"name", "纸面模拟"}, {"type", "paper"}});
      business::require(c.db.commit(), "初始化账户保存失败");
    }
  }
  QJsonArray read(const QString& kind) const {
    Connection c(file);
    return read(c.db, kind);
  }
  // Poll snapshots must never pass an old full object to save(). Only this
  // narrow transition is allowed, guarded by the original persisted bytes.
  bool pauseUnapprovedCollectionPoll(const QString& id, const QByteArray& expected) {
    business::require(!id.isEmpty() && id.size() <= 100 && !expected.isEmpty() &&
                          expected.size() <= business::backupByteLimit,
                      "采集原ID或快照无效");
    QJsonParseError error;
    const auto original = QJsonDocument::fromJson(expected, &error);
    business::require(error.error == QJsonParseError::NoError && original.isObject() &&
                          original.object()["id"] == id,
                      "采集原记录损坏");
    auto item = original.object();
    if (!item["autoPipeline"].toBool() ||
        !QStringList{"queued", "retry"}.contains(item["pipelineState"].toString())) return false;
    item["autoPipeline"] = false;
    item["pipelineState"] = "paused";
    item["pipelineMessage"] = "导入的任务没有本机执行批准；请在采集页主动启动";
    item = validate("collections", item);
    // No Store initializer/schema operation, no create-on-missing, and no GUI
    // busy wait behind a writer. This is the only poll-side write transition.
    business::require(QFileInfo(file).isFile(), "采集库不存在，未创建");
    const auto connection = QUuid::createUuid().toString();
    auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
    auto close = [&] { db.close(); db = {}; QSqlDatabase::removeDatabase(connection); };
    try {
      db.setDatabaseName(QUrl::fromLocalFile(QFileInfo(file).absoluteFilePath()).toString(QUrl::FullyEncoded) + "?mode=rw");
      db.setConnectOptions("QSQLITE_OPEN_URI;QSQLITE_BUSY_TIMEOUT=0");
      business::require(db.open(), "采集暂停连接失败，原任务保留");
      { QSqlQuery mode(db); business::require(mode.exec("PRAGMA synchronous=FULL"), "采集暂停持久设置失败"); }
      business::require(db.transaction(), "无法开始采集暂停事务");
      bool changed = false;
      {
        QSqlQuery q(db);
        q.prepare("UPDATE records SET payload=? WHERE kind='collections' AND id=? "
                  "AND CAST(payload AS BLOB)=?");
        q.addBindValue(QString::fromUtf8(QJsonDocument(item).toJson(QJsonDocument::Compact)));
        q.addBindValue(id); q.addBindValue(expected);
        business::require(q.exec(), "采集暂停暂不可用，原任务保留");
        changed = q.numRowsAffected() == 1;
      }
      if (!changed) { db.rollback(); close(); return false; }
      validateLedgers(db);
      business::require(db.commit(), "采集暂停保存失败");
      close(); return true;
    } catch (...) { db.rollback(); close(); throw; }
  }
  QJsonObject reviewCollection(const QString& id, const QString& expectedHash, const QString& note) {
    business::require(!note.trimmed().isEmpty()&&note.size()<=2000,"请填写1至2000字复核说明");
    Connection c(file);business::require(c.db.transaction(),"无法开始复核事务");
    try {
      QJsonObject row;for(auto v:read(c.db,"collections"))if(v.toObject()["id"]==id)row=v.toObject();
      business::require(!row.isEmpty()&&!row["text"].toString().trimmed().isEmpty(),"请选择有正文的文稿");
      business::require(collectionQuality::bodyHash(row["text"].toString())==expectedHash,"正文已变化，请重新查看后复核");
      auto reviews=row["qualityReviews"].toArray();business::require(reviews.size()<1000,"复核历史已达1000条，请先导出归档");
      reviews.append(QJsonObject{{"bodyHash",expectedHash},{"note",note.trimmed()},{"reviewedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"scope","transcript_only"}});
      row["qualityReviews"]=reviews;row=validate("collections",row);write(c.db,"collections",row);
      business::require(c.db.commit(),"复核记录保存失败");return row;
    }catch(...){c.db.rollback();throw;}
  }
  QJsonObject editAccount(const QJsonObject& expected, QJsonObject candidate) {
    Connection c(file);business::require(c.db.transaction(),"无法开始账户编辑事务");
    try {
      QJsonObject current;for(auto v:read(c.db,"accounts"))if(v.toObject()["id"]==expected.value("id"))current=v.toObject();
      accountEdit::check(expected,current);
      auto beforeProtected=expected,afterProtected=candidate;
      for(auto key:{"name","broker","maskedNumber","note","cashBalance"}){beforeProtected.remove(key);afterProtected.remove(key);}
      business::require(beforeProtected==afterProtected,"账户身份或受保护历史被修改，未保存");
      for(auto key:{"name","broker","maskedNumber","note"})if(candidate.value(key)!=expected.value(key))business::require(candidate.value(key).isString(),"账户编辑字段必须是文本");
      const bool cashChanged=candidate.value("cashBalance")!=expected.value("cashBalance");
      if(cashChanged){
        business::require(candidate.value("cashBalance").isDouble()&&std::isfinite(candidate["cashBalance"].toDouble())&&candidate["cashBalance"].toDouble()>=0,"手工现金必须为有限非负数");
        business::require(!current.contains("cashEditHistory")||current.value("cashEditHistory").isArray(),"现金修改依据格式损坏，未覆盖");
        auto history=current.value("cashEditHistory").toArray();business::require(history.size()<1000,"现金修改依据已满，请先归档");
        QJsonObject prior;for(auto key:{"cashBalance","cashAsOf","cashSource","cashVerification"})if(current.contains(key))prior[key]=current.value(key);
        const auto savedAt=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
        history.append(QJsonObject{{"previous",prior},{"cashBalance",candidate["cashBalance"]},{"recordedAt",savedAt},{"scope","manual-balance-not-cashflow"}});
        candidate["cashEditHistory"]=history;candidate.remove("cashAsOf");candidate["cashSource"]="manual";candidate["cashVerification"]="unverified";candidate["cashEditedAt"]=savedAt;
      }
      if(candidate==current){c.db.rollback();return current;}
      candidate=validate("accounts",candidate);write(c.db,"accounts",candidate);validateLedgers(c.db);
      business::require(c.db.commit(),"账户编辑保存失败");return candidate;
    }catch(...){c.db.rollback();throw;}
  }
  QJsonObject save(const QString& kind, QJsonObject item) {
    item = validate(kind, item);
    Connection c(file);
    business::require(c.db.transaction(), "无法开始事务");
    try {
      if(kind=="collections")for(auto v:read(c.db,kind)){const auto old=v.toObject();if(old["id"]==item["id"]&&old.contains("qualityReviews"))item["qualityReviews"]=old["qualityReviews"];}
      if(kind=="collections")for(auto v:read(c.db,kind)){const auto old=v.toObject();if(old["id"]==item["id"]&&old.contains("creatorAnalyses"))item["creatorAnalyses"]=old["creatorAnalyses"];}
      write(c.db, kind, item);
      validateLedgers(c.db);
      business::require(c.db.commit(), "记录保存失败");
    } catch (...) {
      c.db.rollback();
      throw;
    }
    return item;
  }
  QJsonObject commitCollectionPublication(const QJsonObject& expected, QJsonObject document) {
    business::require(!expected["id"].toString().isEmpty() &&
                          document.value("collectionId") == expected["id"] &&
                          document.value("text") == expected["text"] &&
                          document.value("originalText") == expected["originalText"],
                      "研究资料与待入库文稿不一致，未写入");
    document = validate("docs", document);
    Connection c(file);
    business::require(c.db.transaction(), "无法开始文稿入库事务");
    try {
      QJsonObject current;
      for (auto value : read(c.db, "collections"))
        if (value.toObject()["id"] == expected["id"]) current = value.toObject();
      business::require(current == expected,
                        "文稿已变化或删除，请重新核对后入库；未发布旧版本");
      // Keep the source check and insert in one transaction. Never upsert a
      // document created or manually edited after the publisher's preflight.
      QSqlQuery insert(c.db);
      insert.prepare("INSERT INTO records(kind,id,payload) VALUES('docs',?,?)");
      insert.addBindValue(document["id"].toString());
      insert.addBindValue(QString::fromUtf8(QJsonDocument(document).toJson(QJsonDocument::Compact)));
      business::require(insert.exec(), "研究资料已存在或写入失败；原稿未覆盖");
      validateLedgers(c.db);
      business::require(c.db.commit(), "研究资料入库提交失败");
      return document;
    } catch (...) { c.db.rollback(); throw; }
  }
  QJsonObject saveCreatorAiAnalysis(const QJsonObject& expectedRow,const QJsonObject& candidate,const std::function<bool()>& cancelled){return saveCreatorAiChecked(expectedRow,candidate,cancelled,nullptr);}
  QJsonObject saveCreatorAiExecution(const QJsonObject& expectedRow,const QJsonObject& candidate,const creatorExecution::Receipt& receipt,const std::function<bool()>& cancelled){auto saved=saveCreatorAiChecked(expectedRow,candidate,cancelled,&receipt);receipt.committed();return saved;}
 private:
  QJsonObject saveCreatorAiChecked(const QJsonObject& expectedRow,const QJsonObject& candidate,const std::function<bool()>& cancelled,const creatorExecution::Receipt* receipt) {
    auto aborted=[&]{return !cancelled||cancelled()||(receipt&&!receipt->valid());};
    business::require(!aborted(),"保存已取消，未写入");
    const auto expected=expectedRow,held=candidate;const auto id=expected["id"].toString();business::require(!id.isEmpty(),"完整来源缺少身份");
    Connection c(file);QSqlQuery begin(c.db);business::require(begin.exec("BEGIN IMMEDIATE"),"无法取得关系保存事务");
    try {
      QSqlQuery query(c.db);query.prepare("SELECT length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=8388608 THEN CAST(payload AS BLOB) ELSE NULL END FROM records WHERE kind='collections' AND id=?");query.addBindValue(id);
      business::require(query.exec()&&query.next(),"原文稿已删除或读取失败，未写入");
      business::require(query.value(0).toLongLong()>0&&query.value(0).toLongLong()<=8*1024*1024&&!query.value(1).isNull(),"原文稿记录超过8MiB或损坏，未截断");
      const auto raw=query.value(1).toByteArray();query.finish();auto row=creatorAi::parseObject(raw);const auto original=QString::fromUtf8(raw);
      business::require(!aborted(),"保存已取消，未写入");business::require(row["id"]==id&&row==expected,"完整来源记录已变化，未覆盖原件");
      creatorAnalysis::validateHistory(row);business::require(creatorAnalysis::eligible(row),"原文稿质检或原始证据条件不满足");
      business::require(creatorAnalysis::identity(row)==creatorAnalysis::identity(expected)&&collectionQuality::bodyHash(row["text"].toString())==collectionQuality::bodyHash(expected["text"].toString())&&creatorAnalysis::lastId(row)==creatorAnalysis::lastId(expected),"来源身份、正文或上一分析版本已变化");
      auto history=row.value("creatorAnalyses").toArray();business::require(history.size()<100,"单篇分析历史已满100版，原件保留");
      auto analysis=creatorAi::validateCandidate(row,held);
      if(receipt)analysis["creatorAiExecutionAttempts"]=receipt->validate(row,held);
      else business::require(QStringList{"manual-import","local-fixture"}.contains(held["provenance"].toString()),"没有可信在线执行来源，不能保存为在线结果");
      business::require(QRegularExpression("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$").match(analysis["id"].toString()).hasMatch(),"新分析身份必须为UUID");
      analysis["provenance"]=held["provenance"];analysis["creatorAiResponses"]=held["responses"];
      creatorAnalysis::validate(analysis);business::require(!aborted(),"保存已取消，未写入");history.append(analysis);row["creatorAnalyses"]=history;row=validate("collections",row);
      const auto payload=QJsonDocument(row).toJson(QJsonDocument::Compact);business::require(payload.size()<=business::backupByteLimit,"追加后文稿记录过大，原件保留");
      QSqlQuery update(c.db);update.prepare("UPDATE records SET payload=? WHERE kind='collections' AND id=? AND payload=?");update.addBindValue(QString::fromUtf8(payload));update.addBindValue(id);update.addBindValue(original);business::require(update.exec()&&update.numRowsAffected()==1,"记录竞争或保存失败，未覆盖原件");
      business::require(!aborted(),"保存已取消，事务已回滚");business::require(c.db.commit(),"关系版本保存失败");return analysis;
    }catch(...){c.db.rollback();throw;}
  }
 public:
  QJsonObject saveCreatorAnalysis(const QString& id,const QString& expectedHash,const QString& previous,
                                 const QString& summary,const QJsonArray& edges) {
    Connection c(file);business::require(c.db.transaction(),"无法开始关系保存事务");
    try {
      QJsonObject row;for(auto v:read(c.db,"collections"))if(v.toObject()["id"]==id)row=v.toObject();
      business::require(!row.isEmpty()&&collectionQuality::bodyHash(row["text"].toString())==expectedHash,"正文已变化，请重新读取后编辑关系");
      business::require(creatorAnalysis::lastId(row)==previous,"分析版本已变化，请重新读取，未覆盖其他修改");
      business::require(creatorAnalysis::eligible(row),"当前文稿质检或原始证据条件不满足；不可作为当前关系保存");
      QJsonArray normalized;for(auto v:edges){business::require(v.isObject(),"关系格式无效");normalized.append(creatorAnalysis::relation(v.toObject(),row["text"].toString()));}
      QJsonObject a{{"id",QUuid::createUuid().toString(QUuid::WithoutBraces)},{"bodyText",row["text"]},{"bodyHash",expectedHash},{"sourceSnapshot",creatorAnalysis::sourceSnapshot(row)},{"sourceIdentity",creatorAnalysis::identity(row)},
        {"summary",summary},{"model","人工编辑"},{"specVersion",creatorAnalysis::spec},{"analyzedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"relations",normalized}};
      auto history=row["creatorAnalyses"].toArray();history.append(a);row["creatorAnalyses"]=history;validate("collections",row);write(c.db,"collections",row);
      business::require(c.db.commit(),"关系版本保存失败");return a;
    }catch(...){c.db.rollback();throw;}
  }
  void remove(const QString& kind, const QString& id) {
    business::require(QStringList{"trades", "docs", "reports", "relations", "topics"}.contains(kind),
                      "此记录不能直接删除");
    Connection c(file);
    business::require(c.db.transaction(), "无法开始事务");
    try {
      QSqlQuery q(c.db);
      q.prepare("DELETE FROM records WHERE kind=? AND id=?");
      q.addBindValue(kind);
      q.addBindValue(id);
      business::require(q.exec(), q.lastError().text());
      validateLedgers(c.db);
      business::require(c.db.commit(), "删除保存失败");
    } catch (...) {
      c.db.rollback();
      throw;
    }
  }
  void mergeResearchReports(const QJsonArray& rows, const QJsonArray& expectedReports) {
    Connection c(file);
    business::require(c.db.transaction(), "无法开始研究导入事务");
    try {
      business::require(QJsonDocument(read(c.db,"reports")).toJson(QJsonDocument::Compact)==QJsonDocument(expectedReports).toJson(QJsonDocument::Compact),"报告库已变化，请重新预览，未写入");
      QSet<QString> seen;
      for(auto v:expectedReports)seen.insert(v.toObject()["id"].toString());
      for(auto v:rows){auto r=validate("reports",v.toObject());if(!v.toObject().contains("sourceUrl"))r.remove("sourceUrl");business::require(r["legacySource"]=="ai_research_runs"&&r["legacyOriginal"].isObject()&&r["researchRun"].isObject(),"不是研究运行记录");business::require(!seen.contains(r["id"].toString()),"研究ID冲突，未覆盖");seen.insert(r["id"].toString());if(v.toObject().contains("updatedAt")){business::require(v.toObject()["updatedAt"].isString()&&QDateTime::fromString(v.toObject()["updatedAt"].toString(),Qt::ISODate).isValid(),"研究本机保存时间无效");r["updatedAt"]=v.toObject()["updatedAt"];}write(c.db,"reports",r);}
      business::require(c.db.commit(),"研究导入提交失败");
    } catch(...){c.db.rollback();throw;}
  }
  QJsonObject backup() const {
    Connection c(file);
    QJsonObject result{
        {"schema", "native-business-v1"},
        {"createdAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODate)}};
    for (const auto& kind : business::kinds())
      result[kind] = read(c.db, kind);
    return result;
  }
  void restore(const QJsonObject& input) {
    business::require(input["schema"] == "native-business-v1",
                      "不支持的备份格式");
    Connection c(file);
    business::require(c.db.transaction(), "无法开始恢复事务");
    try {
      for (const auto& kind : business::kinds()) {
        if (!input.contains(kind) && QStringList{"topics","relations","collections"}.contains(kind)) continue;
        QSet<QString> existing;
        if (input["mergePolicy"] == "keep-existing")
          for (auto v : read(c.db, kind))
            existing.insert(v.toObject()["id"].toString());
        business::require(
            input[kind].isArray() && input[kind].toArray().size() <= 10000,
            "备份记录缺失或过多");
        QSet<QString> seen;
        for (auto v : input[kind].toArray()) {
          business::require(
              v.isObject() && !v.toObject()["id"].toString().isEmpty(),
              "备份缺少记录身份");
          auto id = v.toObject()["id"].toString();
          business::require(!seen.contains(id), "同一备份内存在重复记录ID");
          seen.insert(id);
          auto item = validate(kind, v.toObject());
          if (kind == "collections") {
            // Imported data must not inherit this device's running/queued work.
            item["executionRevision"] = QUuid::createUuid().toString(QUuid::WithoutBraces);
            item["autoPipeline"] = false;
            item["pipelineState"] = "paused";
            item["pipelineMessage"] = "恢复的任务仅作为数据；请主动启动本机处理";
            item["downloadRun"] = "";
            if (item["downloadState"] == "running") item["downloadState"] = "interrupted";
            if (QStringList{"running", "queued"}.contains(item["status"].toString()))
              item["status"] = "interrupted";
          }
          if (!existing.contains(id)) write(c.db, kind, item);
        }
      }
      validateLedgers(c.db);
      business::require(c.db.commit(), "恢复保存失败");
    } catch (...) {
      c.db.rollback();
      throw;
    }
  }
};
