#include "dark_observation.hpp"
#include "dark_observation_legacy.hpp"
#include "dark_stock.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
namespace darkObservation {
namespace {
const QString schema = "native-dark-stock-observations/v1";
constexpr qint64 singleLimit = 16LL * 1024 * 1024,
                 dayLimit = 32LL * 1024 * 1024,
                 totalLimit = 128LL * 1024 * 1024;
void need(bool ok, const QString &message) {
  if (!ok)
    throw std::runtime_error(message.toStdString());
}
void check(const Cancel &cancel) {
  need(!cancel || !cancel(), "操作已取消；已提交历史保留");
}
QString sha(const QByteArray &b) {
  return QCryptographicHash::hash(b, QCryptographicHash::Sha256).toHex();
}
QByteArray canonical(const QJsonValue &v, int depth = 0) {
  need(depth <= 32, "观察数据嵌套超限");
  if (v.isObject()) {
    QByteArray b = "{";
    auto o = v.toObject();
    for (auto key : o.keys()) {
      if (b.size() > 1)
        b += ',';
      b += canonical(key, depth + 1) + ':' + canonical(o.value(key), depth + 1);
    }
    return b + '}';
  }
  if (v.isArray()) {
    QByteArray b = "[";
    for (auto x : v.toArray()) {
      if (b.size() > 1)
        b += ',';
      b += canonical(x, depth + 1);
    }
    return b + ']';
  }
  if (v.isString()) {
    QByteArray b = "\"";
    for (QChar ch : v.toString())
      b += "\\u" + QByteArray::number(ch.unicode(), 16).rightJustified(4, '0');
    return b + '\"';
  }
  if (v.isDouble()) {
    double n = v.toDouble(), z = n == 0 ? 0 : n;
    need(std::isfinite(n), "非有限数值");
    quint64 bits;
    std::memcpy(&bits, &z, 8);
    return '@' + QByteArray::number(bits, 16).rightJustified(16, '0');
  }
  return v.isBool() ? (v.toBool() ? "true" : "false") : "null";
}
QDateTime time(const QString &text) {
  need(QRegularExpression(
           "^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$")
           .match(text)
           .hasMatch(),
       "时刻需含日期与时区");
  auto t = QDateTime::fromString(text, Qt::ISODateWithMs);
  need(t.isValid(), "时刻无效");
  return t.toUTC();
}
void day(const QString &value) {
  need(QDate::fromString(value, Qt::ISODate).isValid() &&
           QDate::fromString(value, Qt::ISODate).toString(Qt::ISODate) == value,
       "需指定真实交易日");
}
QJsonObject parse(const QByteArray &b, qint64 limit) {
  need(b.size() <= limit && QString::fromUtf8(b).toUtf8() == b,
       "文件超限或不是完整UTF-8");
  QJsonParseError error;
  auto doc = QJsonDocument::fromJson(b, &error);
  need(error.error == QJsonParseError::NoError && doc.isObject(),
       "观察文件JSON损坏");
  return doc.object();
}
QByteArray readFile(const QString &name, qint64 limit, const Cancel &cancel) {
  check(cancel);
  QFileInfo info(name);
  need(info.isFile() && !info.isSymLink() && !info.isJunction() &&
           info.size() <= limit,
       "文件缺失、外来链接或超限");
  QFile f(name);
  need(f.open(QIODevice::ReadOnly), "观察文件不可读");
  QByteArray b;
  while (!f.atEnd()) {
    check(cancel);
    auto chunk = f.read(65536);
    need(!chunk.isEmpty() || f.atEnd(), "观察文件读取失败");
    b += chunk;
    need(b.size() <= limit, "观察文件超过限额");
  }
  return b;
}
QJsonObject verifyPrepared(const Prepared &p) {
  auto snapshot = parse(p.bytes, singleLimit);
  darkStock::validate(snapshot);
  need(hash(snapshot) == p.id, "预览内容发生变化");
  time(p.preparedAt);
  return snapshot;
}
QJsonObject envelope(const QJsonObject &value) {
  return {{"schema", schema}, {"checksum", hash(value)}, {"manifest", value}};
}
QJsonObject emptyManifest() {
  return {{"storeId", QUuid::createUuid().toString(QUuid::WithoutBraces)},
          {"revision", 0},
          {"entries", QJsonArray{}}};
}
struct Audit {
  bool exists = false;
  QJsonObject manifest;
  QString revision = "absent";
  qint64 bytes = 0;
  QMap<QString, qint64> days;
};
Audit audit(const QString &dir, const Cancel &cancel,
            const std::function<void(QJsonObject, QJsonObject)> &visit = {},
            const QByteArray &ownLock = {}) {
  check(cancel);
  QFileInfo root(dir);
  need(!root.isSymLink() && !root.isJunction(), "观察仓目录不能是外来链接");
  auto lockOK = [&] {
    return ownLock.isEmpty() ? !QFileInfo::exists(dir + ".lock")
                             : readFile(dir + ".lock", 128, cancel) == ownLock;
  };
  need(lockOK(), "观察仓正被使用或留有未确认锁；未自动删除");
  Audit a;
  if (!root.exists())
    return a;
  need(root.isDir(), "目标不是独立观察仓目录");
  auto raw =
      readFile(QDir(dir).filePath("manifest.json"), 2 * 1024 * 1024, cancel);
  auto outer = parse(raw, 2 * 1024 * 1024);
  need(outer.value("schema") == schema && outer.value("manifest").isObject(),
       "外来仓身份；原文件保留");
  a.manifest = outer.value("manifest").toObject();
  need(outer.value("checksum") == hash(a.manifest), "观察清单校验失败");
  need(!QUuid(a.manifest.value("storeId").toString()).isNull(),
       "观察仓身份无效");
  auto entries = a.manifest.value("entries").toArray();
  need(a.manifest.value("entries").isArray() && entries.size() <= 1000 &&
           a.manifest.value("revision") == entries.size(),
       "清单版本或数量无效");
  QSet<QString> names{"manifest.json"}, ids;
  for (auto v : entries) {
    check(cancel);
    need(v.isObject(), "清单记录无效");
    auto e = v.toObject();
    auto id = e.value("id").toString(), d = e.value("tradingDay").toString();
    day(d);
    time(e.value("savedAt").toString());
    need(QRegularExpression("^[a-f0-9]{64}$").match(id).hasMatch() &&
             !ids.contains(id),
         "观察身份重复或无效");
    ids.insert(id);
    QString file = id + ".json";
    names.insert(file);
    auto payload = readFile(QDir(dir).filePath(file), singleLimit, cancel);
    need(e.value("bytes") == payload.size() &&
             e.value("payloadSha256") == sha(payload),
         "观察内容字节校验失败");
    auto s = parse(payload, singleLimit);
    darkStock::validate(s);
    need(hash(s) == id && s.value("tradingDay") == d &&
             e.value("sourceKey") == hash(s.value("source")) &&
             e.value("rowCount") == s.value("rows").toArray().size() &&
             e.value("receivedAt") == s.value("receivedAt") &&
             e.value("scanStartedAt") == s.value("scanStartedAt"),
         "观察索引与内容不一致");
    a.bytes += payload.size();
    a.days[d] += payload.size();
    need(a.bytes <= totalLimit && a.days[d] <= dayLimit,
         "观察仓超限；未裁剪历史");
    if (visit)
      visit(e, s);
  }
  auto actual = QDir(dir).entryList(QDir::AllEntries | QDir::Hidden |
                                    QDir::System | QDir::NoDotAndDotDot);
  need(QSet<QString>(actual.begin(), actual.end()) == names,
       "仓内存在外来/未完成文件；原文件保留");
  need(raw == readFile(QDir(dir).filePath("manifest.json"), 2 * 1024 * 1024,
                       cancel) &&
           lockOK(),
       "读取期间观察仓变化，请重读");
  a.exists = true;
  a.revision = hash(a.manifest);
  return a;
}
void writeAtomic(const QString &path, const QByteArray &bytes) {
  QSaveFile file(path);
  file.setDirectWriteFallback(false);
  need(file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() &&
           file.commit(),
       "原子写入失败；原历史保留");
}
struct Lock {
  QString file;
  QByteArray token;
  explicit Lock(QString path)
      : file(path), token(QUuid::createUuid().toByteArray()) {
    QFile f(file);
    need(f.open(QIODevice::WriteOnly | QIODevice::NewOnly),
         "观察仓已锁定；未移除已有锁");
    need(f.write(token) == token.size() && f.flush(), "观察仓锁写入失败");
  }
  ~Lock() {
    QFileInfo info(file);
    QFile f(file);
    if (info.isFile() && !info.isSymLink() && !info.isJunction() &&
        f.open(QIODevice::ReadOnly) && f.readAll() == token) {
      f.close();
      QFile::remove(file);
    }
  }
};
qint64 money(const QJsonObject &row, const QString &key) {
  auto v = row.value(key);
  need(v.isString() && QRegularExpression("^-?(0|[1-9][0-9]{0,17})$")
                           .match(v.toString())
                           .hasMatch(),
       "MISSING_AMOUNT");
  bool ok;
  auto n = v.toString().toLongLong(&ok);
  need(ok && n >= -900719925474099100LL && n <= 900719925474099100LL,
       "AMOUNT_INVALID");
  return n;
}
} // namespace
QString hash(const QJsonValue &v) { return sha(canonical(v)); }
Prepared prepare(const QJsonObject &input, const QString &preparedAt,
                 const Cancel &cancel) {
  check(cancel);
  time(preparedAt);
  darkStock::validate(input);
  Prepared p;
  p.bytes = QJsonDocument(input).toJson(QJsonDocument::Compact);
  need(p.bytes.size() <= singleLimit, "完整快照超过16MiB");
  p.id = hash(input);
  p.preparedAt = preparedAt;
  int uncertain = 0;
  for (auto v : input.value("rows").toArray())
    if (v.toObject().value("reconciled") != true)
      ++uncertain;
  p.summary = {{"id", p.id},
               {"tradingDay", input.value("tradingDay")},
               {"scanStartedAt", input.value("scanStartedAt")},
               {"receivedAt", input.value("receivedAt")},
               {"rowCount", input.value("rows").toArray().size()},
               {"uncertainRows", uncertain},
               {"sourceTime", QJsonValue::Null},
               {"paginationSnapshotConsistent", false},
               {"preparedAt", preparedAt},
               {"bytes", p.bytes.size()}};
  check(cancel);
  return p;
}
QJsonObject Store::preview(const Prepared &p, const Cancel &cancel) const {
  auto s = verifyPrepared(p);
  auto a = audit(directory, cancel);
  bool duplicate = false;
  for (auto v : a.manifest.value("entries").toArray())
    duplicate |= v.toObject().value("id") == p.id;
  need(duplicate || a.manifest.value("entries").toArray().size() < 1000,
       "已达1000条上限，未裁剪");
  auto d = s.value("tradingDay").toString();
  need(duplicate || (a.bytes + p.bytes.size() <= totalLimit &&
                     a.days[d] + p.bytes.size() <= dayLimit),
       "观察仓容量不足；未裁剪旧历史");
  auto result = p.summary;
  result["expectedRevision"] = a.revision;
  result["duplicate"] = duplicate;
  result["storedSnapshots"] = a.manifest.value("entries").toArray().size();
  return result;
}
QJsonObject Store::append(const Prepared &p, const QString &expectedRevision,
                          const QString &savedAt, const Cancel &cancel) const {
  auto s = verifyPrepared(p);
  need(time(savedAt) >= time(p.preparedAt), "保存时钟早于预览");
  auto a = audit(directory, cancel);
  need(a.revision == expectedRevision, "观察仓已变化，请重新预览");
  for (auto v : a.manifest.value("entries").toArray())
    if (v.toObject().value("id") == p.id)
      return {{"status", "duplicate"},
              {"id", p.id},
              {"savedAt", v.toObject().value("savedAt")},
              {"revision", a.revision}};
  need(a.manifest.value("entries").toArray().size() < 1000 &&
           a.bytes + p.bytes.size() <= totalLimit &&
           a.days[s.value("tradingDay").toString()] + p.bytes.size() <=
               dayLimit,
       "容量不足；旧历史未裁剪");
  QFileInfo root(directory);
  need(root.absoluteDir().exists(), "观察仓父目录不存在");
  check(cancel);
  Lock lock(directory + ".lock");
  a = audit(directory, cancel, {}, lock.token);
  need(a.revision == expectedRevision, "确认期间观察仓变化，请重新预览");
  if (!a.exists) {
    need(QDir().mkdir(directory), "无法创建独立观察仓");
    a.manifest = emptyManifest();
    writeAtomic(
        QDir(directory).filePath("manifest.json"),
        QJsonDocument(envelope(a.manifest)).toJson(QJsonDocument::Compact));
  }
  QString file = QDir(directory).filePath(p.id + ".json");
  bool created = false, committed = false;
  qsizetype written = 0;
  try {
    check(cancel);
    QFile payload(file);
    need(payload.open(QIODevice::WriteOnly | QIODevice::NewOnly),
         "观察内容文件已存在，未覆盖");
    created = true;
    for (qsizetype at = 0; at < p.bytes.size(); at += 65536) {
      check(cancel);
      auto chunk = p.bytes.mid(at, 65536);
      auto count = payload.write(chunk);
      if (count > 0)
        written += count;
      need(count == chunk.size(), "观察内容写入失败");
    }
    need(payload.flush(), "观察内容刷新失败");
    payload.close();
    check(cancel);
    QJsonObject entry{{"id", p.id},
                      {"payloadSha256", sha(p.bytes)},
                      {"bytes", p.bytes.size()},
                      {"tradingDay", s.value("tradingDay")},
                      {"sourceKey", hash(s.value("source"))},
                      {"scanStartedAt", s.value("scanStartedAt")},
                      {"receivedAt", s.value("receivedAt")},
                      {"rowCount", s.value("rows").toArray().size()},
                      {"savedAt", savedAt}};
    auto entries = a.manifest.value("entries").toArray();
    entries.append(entry);
    a.manifest["entries"] = entries;
    a.manifest["revision"] = entries.size();
    check(cancel);
    writeAtomic(
        QDir(directory).filePath("manifest.json"),
        QJsonDocument(envelope(a.manifest)).toJson(QJsonDocument::Compact));
    committed = true;
    return {{"status", "saved"},
            {"id", p.id},
            {"savedAt", savedAt},
            {"revision", hash(a.manifest)}};
  } catch (...) {
    if (created && !committed) {
      try {
        if (readFile(file, singleLimit, {}) == p.bytes.left(written))
          QFile::remove(file);
      } catch (...) {
      }
    }
    throw;
  }
}
QJsonObject Store::read(const QString &key, const QString &tradingDay,
                        const Cancel &cancel) const {
  day(tradingDay);
  need(QRegularExpression("^(sh|sz|bj)[0-9]{6}$|^unknown:[0-9]+:[0-9]{6}$")
           .match(key)
           .hasMatch(),
       "需完整来源证券身份");
  QJsonArray points;
  QSet<QString> dates;
  auto a = audit(directory, cancel, [&](QJsonObject entry, QJsonObject s) {
    dates.insert(s.value("tradingDay").toString());
    if (s.value("tradingDay") != tradingDay)
      return;
    for (auto v : s.value("rows").toArray()) {
      check(cancel);
      auto row = v.toObject();
      if (row.value("key") != key)
        continue;
      points.append(QJsonObject{{"id", entry.value("id")},
                                {"tradingDay", tradingDay},
                                {"savedAt", entry.value("savedAt")},
                                {"source", s.value("source")},
                                {"sourceKey", entry.value("sourceKey")},
                                {"scanStartedAt", s.value("scanStartedAt")},
                                {"batchReceivedAt", s.value("receivedAt")},
                                {"paginationSnapshotConsistent", false},
                                {"row", row}});
    }
  });
  auto legacyState=darkLegacy::read(directory,cancel);
  auto legacy=darkLegacy::validate(legacyState,cancel);
  auto legacyPoints=legacyState.value("points").toObject();
  QSet<QString> nativeIdentities;int legacySkippedNative=0;
  for(auto value:points){auto p=value.toObject();nativeIdentities.insert(darkLegacy::pointId(QJsonObject{{"tradingDay",p.value("tradingDay")},{"source",p.value("source")}},p.value("row").toObject()));}
  for(auto id:legacyPoints.keys()){
    check(cancel);auto p=darkLegacy::point(id,legacyPoints.value(id).toObject(),legacy);
    dates.insert(p.value("tradingDay").toString());
    if(p.value("tradingDay")!=tradingDay||p.value("row").toObject().value("key")!=key)continue;
    if(nativeIdentities.contains(id)){++legacySkippedNative;continue;}
    points.append(p);
  }
  auto legacySummary=QJsonObject{{"rawBatches",legacy.batches},{"rawRows",legacy.rows},{"sourceUniquePoints",legacy.points.size()},{"identicalSourceDuplicates",legacy.duplicates},{"sourceConflicts",legacy.conflicts},{"activeUniquePoints",legacyPoints.size()},{"nativePointsKept",legacySkippedNative}};
  QVector<QJsonObject> sorted;
  for (auto v : points)
    sorted.append(v.toObject());
  std::stable_sort(sorted.begin(), sorted.end(), [](auto x, auto y) {
    auto a = time(x.value("row").toObject().value("receivedAt").toString()),
         b = time(y.value("row").toObject().value("receivedAt").toString());
    return a == b ? x.value("id").toString() < y.value("id").toString() : a < b;
  });
  points = {};
  for (auto v : sorted)
    points.append(v);
  auto names = dates.values();
  names.sort(Qt::CaseSensitive);
  std::reverse(names.begin(), names.end());
  QJsonArray days;
  for (auto d : names)
    days.append(d);
  return {{"schema", "native-dark-stock-observation-history/v1"},
          {"key", key},
          {"tradingDay", tradingDay},
          {"availableDates", days},
          {"points", points},
          {"legacySummary",legacySummary},
          {"revision", a.revision},
          {"automaticTrading", false},
          {"note", "原交易日榜单的本机接收观察；缺记录不是0，接收时刻不是行情事"
                   "件时刻；多页非同步快照。旧原件全部保留，按原身份去重显示，不重算模型估值"}};
}
namespace {
QJsonObject nativeLegacyContext(const QString& directory,const Cancel& cancel,const QByteArray& ownLock={}){
 QJsonObject points;auto native=audit(directory,cancel,[&](QJsonObject,QJsonObject record){
  for(auto value:record.value("rows").toArray()){check(cancel);auto raw=darkLegacy::originalRow(value.toObject());auto id=darkLegacy::pointId(record,raw);auto variants=points.value(id).toArray();variants.append(raw);points.insert(id,variants);}
 },ownLock);
 return {{"revision",native.revision},{"points",points}};
}
}
QJsonObject previewLegacy(const QString& directory,const QString& sourceDirectory,const QJsonArray& sourceFiles,const Cancel& cancel){
 check(cancel);return darkLegacy::preview(directory,sourceDirectory,sourceFiles,nativeLegacyContext(directory,cancel),cancel);
}
QJsonObject applyLegacy(const QString& directory,const QJsonObject& preview,const Cancel& cancel){
 check(cancel);need(preview.value("schema")=="native-dark-observation-legacy-preview/v1","不是完整旧观察预览");need(QFileInfo(directory).absoluteDir().exists(),"观察仓父目录不存在，未创建原库");
 Lock nativeLock(directory+".lock");Lock legacyLock(directory+".legacy.lock");
 auto source=preview.value("sourceDirectory").toString();auto files=preview.value("sourceFiles").toArray();auto context=nativeLegacyContext(directory,cancel,nativeLock.token);
 auto rebuilt=darkLegacy::preview(directory,source,files,context,cancel);need(rebuilt==preview,"旧源、原生观察仓或旁证目标已变化，请重新预览");
 auto next=preview.value("state").toObject();auto prior=darkLegacy::read(directory,cancel);
 if(next!=prior)darkLegacy::write(directory,next,cancel,[&]{
   darkLegacy::sourceFiles(source,files,cancel);
   need(nativeLegacyContext(directory,cancel,nativeLock.token).value("revision")==preview.value("expectedNativeRevision")&&darkLegacy::fingerprint(darkLegacy::read(directory,cancel))==preview.value("expectedLegacyRevision"),"提交前源或目标已变化，未覆盖");
 });
 return {{"status",next==prior?"unchanged":"imported"},{"revision",darkLegacy::fingerprint(next)},{"points",next.value("points").toObject().size()},{"rawFiles",next.value("files").toObject().size()}};
}
QJsonObject removeLegacy(const QString& directory,const QString& pointId,const QString& expectedRevision,const Cancel& cancel){
 check(cancel);need(QFileInfo::exists(darkLegacy::path(directory)),"旧观察旁证不存在");Lock lock(directory+".legacy.lock");auto before=darkLegacy::read(directory,cancel);need(darkLegacy::fingerprint(before)==expectedRevision,"旧观察旁证已变化，未删除其他版本");auto points=before.value("points").toObject();if(!points.contains(pointId))return before;points.remove(pointId);auto next=before;next.insert("points",points);next.insert("revision",before.value("revision").toDouble()+1);darkLegacy::write(directory,next,cancel,[&]{need(darkLegacy::fingerprint(darkLegacy::read(directory,cancel))==expectedRevision,"删除前旧观察旁证已变化");});return next;
}
QJsonObject legacyCatalog(const QString& directory,const Cancel& cancel){return darkLegacy::catalog(directory,cancel);}
QJsonObject compare(const QJsonObject &from, const QJsonObject &to) {
  QJsonObject out{{"status", "blocked"},
                  {"darkNetChangeCents", QJsonValue::Null},
                  {"visibleNetChangeCents", QJsonValue::Null},
                  {"combinedNetChangeCents", QJsonValue::Null},
                  {"paginationSnapshotConsistent", false},
                  {"sourceTime", QJsonValue::Null}};
  try {
    auto a = from.value("row").toObject(), b = to.value("row").toObject();
    need(!a.isEmpty() && !b.isEmpty(), "POINT_MISSING");
    for (auto k : {"key", "code", "providerMarket", "venue"})
      need(a.contains(k) && b.contains(k) && a.value(k) == b.value(k),
           "IDENTITY_MISMATCH");
    need((a.value("venue") == "SH" && a.value("providerMarket") == 1 &&
          a.value("key") == "sh" + a.value("code").toString()) ||
             (a.value("venue") == "SZ" && a.value("providerMarket") == 0 &&
              a.value("key") == "sz" + a.value("code").toString()),
         "IDENTITY_UNVERIFIED");
    auto d = from.value("tradingDay").toString();
    day(d);
    need(to.value("tradingDay") == d, "TRADING_DAY_MISMATCH");
    need(from.value("source").isObject() && to.value("source").isObject() &&
             hash(from.value("source")) == hash(to.value("source")) &&
             from.value("sourceKey") == hash(from.value("source")) &&
             to.value("sourceKey") == hash(to.value("source")),
         "SOURCE_MISMATCH");
    auto start = time(a.value("receivedAt").toString()),
         end = time(b.value("receivedAt").toString());
    need(start < end, "RECEIPT_ORDER");
    need(a.value("reconciled") == true && b.value("reconciled") == true,
         "QUALITY_UNVERIFIED");
    qint64 av[3], bv[3];
    QStringList keys{"darkNetCents", "visibleNetCents", "combinedNetCents"};
    for (int i = 0; i < 3; i++) {
      av[i] = money(a, keys[i]);
      bv[i] = money(b, keys[i]);
    }
    need(av[0] + av[1] == av[2] && bv[0] + bv[1] == bv[2],
         "RECONCILIATION_FAILED");
    out["darkNetChangeCents"] = QString::number(bv[0] - av[0]);
    out["visibleNetChangeCents"] = QString::number(bv[1] - av[1]);
    out["combinedNetChangeCents"] = QString::number(bv[2] - av[2]);
    out["status"] = "compared";
    out["reason"] = "两份已存同口径模型净额之差；不是逐笔资金";
    out["fromAt"] = a.value("receivedAt");
    out["toAt"] = b.value("receivedAt");
    out["gapOverTenMinutes"] = start.msecsTo(end) > 600000;
  } catch (const std::exception &e) {
    out["reason"] = QString::fromUtf8(e.what());
  }
  return out;
}
} // namespace darkObservation
