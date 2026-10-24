#include "market_feed.hpp"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QSaveFile>
#include <QTimeZone>
#include <QTimer>
#include <QRegularExpression>
#include <QPointer>
#include <QElapsedTimer>
#include <QMutex>
#include <QQueue>
#include <chrono>
#include <cmath>

#include "market_store.hpp"
#include "market_history.hpp"
#include <QUuid>
#include <QCryptographicHash>
#include "tencent_detail.hpp"
namespace {
// Daily flow only: recover a response-less connection close, never an HTTP
// refusal, TLS/auth error, malformed payload, or failed database write.
class CapitalDayRequest final : public QObject {
 public:
  using Done = std::function<void(QByteArray, QString, QJsonArray)>;
  CapitalDayRequest(QNetworkAccessManager* network, QString url, QString fallback, Done done, QObject* parent)
      : QObject(parent), network(network), url(std::move(url)), fallback(std::move(fallback)), done(std::move(done)) {
    deadline.setSingleShot(true);
    connect(&deadline, &QTimer::timeout, this, [this] { finish({}, "资金日线刷新达到15秒上限；原数据保留"); });
  }
  ~CapitalDayRequest() override { stopReply(); }
  void start() { clock.start(); deadline.start(15000); attempt(); }
 private:
  QNetworkAccessManager* network;
  QString url, fallback;
  Done done;
  QPointer<QNetworkReply> reply;
  QTimer deadline;
  QElapsedTimer clock;
  QJsonArray attempts;
  QByteArray bytes;
  int count=0;
  bool ended=false, oversized=false;
  void stopReply() {
    if (!reply) return;
    QPointer<QNetworkReply> r=reply; reply.clear(); r->disconnect(this);
    if (!r->isFinished()) r->abort();
    if(r) r->deleteLater();
  }
  void finish(QByteArray data, QString error) {
    if (ended) return;
    ended=true; deadline.stop();
    auto completed=std::move(done);
    const auto trace=attempts;
    QPointer<CapitalDayRequest> alive(this);
    stopReply(); // abort can synchronously cancel/delete this job via another listener.
    if(alive) completed(std::move(data),std::move(error),trace);
  }
  void attempt() {
    if (ended) return;
    if (clock.elapsed()>=15000) { finish({},"资金日线刷新达到15秒上限；原数据保留"); return; }
    ++count; bytes.clear(); oversized=false;
    const auto currentUrl=count==1?url:fallback;
    QNetworkRequest request{QUrl(currentUrl)};
    request.setRawHeader("User-Agent","Mozilla/5.0 WebStock");
    request.setRawHeader("Referer",count==1?"https://data.eastmoney.com/":"https://emdatah5.eastmoney.com/");
    request.setAttribute(QNetworkRequest::Http2AllowedAttribute,false);
    request.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);
    request.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);
    request.setAttribute(QNetworkRequest::AuthenticationReuseAttribute,QNetworkRequest::Manual);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(int(qMin<qint64>(12000,15000-clock.elapsed())));
    reply=network->get(request);
    auto* r=reply.data(); const auto started=clock.elapsed();
    connect(r,&QIODevice::readyRead,this,[this,r] {
      if (reply!=r||ended) return;
      const auto chunk=r->readAll();
      if (bytes.size()+chunk.size()>2*1024*1024) { oversized=true; r->abort(); }
      else bytes+=chunk;
    });
    connect(r,&QNetworkReply::finished,this,[this,r,started] {
      if (reply!=r||ended) return;
      const int status=r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
      const auto error=r->error(); const auto rest=r->readAll();
      if(bytes.size()+rest.size()>2*1024*1024) oversized=true; else bytes+=rest;
      attempts.append(QJsonObject{{"attempt",count},{"http",status},{"networkError",int(error)},
                                  {"url",r->url().toString()},
                                  {"elapsedMs",clock.elapsed()-started},{"bytes",bytes.size()}});
      stopReply();
      if(!oversized&&status==0&&error==QNetworkReply::RemoteHostClosedError&&count<3&&clock.elapsed()+count*750<15000) {
        QTimer::singleShot(count*750,this,[this]{attempt();}); return;
      }
      QString failure;
      if(oversized) failure="资金日线响应超过2MiB限制；原数据保留";
      else if(status) {
        if(status<200||status>=300||error!=QNetworkReply::NoError) failure=QString("资金日线HTTP %1；本次停止，原数据保留").arg(status);
      } else if(error==QNetworkReply::RemoteHostClosedError)
        failure=QString("资金日线连接在HTTP响应前关闭（已尝试%1/3次）；原数据保留，可稍后手动更新").arg(count);
      else failure=QString("资金日线传输未完成（错误%1）；本次停止，原数据保留").arg(int(error));
      finish(bytes,failure);
    });
  }
};
QJsonObject document(const QByteArray &bytes) {
  QJsonParseError e;
  auto d = QJsonDocument::fromJson(bytes, &e);
  if (e.error != QJsonParseError::NoError || !d.isObject())
    throw std::runtime_error("数据格式无效");
  return d.object();
}
void saveFile(const QString &path, const QJsonObject &data) {
  QSaveFile f(path);
  if (!f.open(QIODevice::WriteOnly) ||
      f.write(QJsonDocument(data).toJson()) < 0 || !f.commit())
    throw std::runtime_error("本机数据保存失败");
}
QJsonArray watchRows(const QJsonArray &items) {
  QJsonArray rows;
  for (const auto &value : items)
    if (!value.toObject()["transient"].toBool()) rows.append(value);
  return rows;
}
QJsonArray withObservations(QJsonArray rows, const QJsonArray &current) {
  QSet<QString> ids;
  for (const auto &row : rows) ids.insert(row.toObject()["id"].toString());
  for (const auto &row : current) {
    const auto item = row.toObject();
    if (item["transient"].toBool() && !ids.contains(item["id"].toString())) {
      rows.append(item);
      ids.insert(item["id"].toString());
    }
  }
  if (rows.size() > 3000)
    throw std::runtime_error("自选与临时观察合计不能超过3000只");
  return rows;
}
bool cacheIsNewer(const QJsonObject &saved, const QJsonObject &current,
                  bool isQuote, bool hasSeries) {
  if (isQuote) {
    if (!saved["price"].isDouble() || !std::isfinite(saved["price"].toDouble()) ||
        saved["price"].toDouble() <= 0) return false;
    if (!current["price"].isDouble() || current["price"].toDouble() <= 0) return true;
    const auto oldTime=current["tradeDate"].toString()+current["tradeTime"].toString();
    const auto newTime=saved["tradeDate"].toString()+saved["tradeTime"].toString();
    if (!oldTime.isEmpty() && newTime != oldTime) return newTime > oldTime;
  } else if (!hasSeries) return true;
  const auto before=QDateTime::fromString(current["checkedAt"].toString(),Qt::ISODate);
  const auto after=QDateTime::fromString(saved["checkedAt"].toString(),Qt::ISODate);
  return after.isValid() && (!before.isValid() || after > before);
}
}  // namespace
// The pool and its bounded accepted work outlive the feed when a page closes.
// Only the pool's GUI-thread mailbox reads owner; the worker never touches UI.
struct MarketFeed::WriteQueue {
  struct Job {
    QString id, period, key;
    QJsonObject input;
    QList<quint64> sequences;
    qint64 queuedAt = 0;
  };
  mutable QMutex mutex;
  QQueue<Job> queue;
  QThreadPool *pool = new QThreadPool;
  QPointer<MarketFeed> owner;
  QString directory;
  bool running = false, closed = false, dispose = false, drainedNotified = false;
  bool backpressure = false;
  int outstanding = 0, peakRequests = 0;
  int retained = 0;
  qint64 retainedBytes = 0;
  qint64 bytes = 0, peakBytes = 0, accepted = 0, rejected = 0, coalesced = 0;
  qint64 jobs = 0, committed = 0, failed = 0, historyReads = 0, historyRows = 0;
  qint64 maxQueueMs = 0, maxCommitMs = 0, totalCommitMs = 0;
  static qint64 now() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
  }
  static void drain(const std::shared_ptr<WriteQueue> &state) {
    for (;;) {
      Job job;
      {
        QMutexLocker lock(&state->mutex);
        if (state->queue.isEmpty()) {
          state->running = false;
          if (state->dispose) state->pool->deleteLater();
          else QMetaObject::invokeMethod(state->pool, [state] {
            if(state->owner) state->owner->notifyPersistenceDrained();
          }, Qt::QueuedConnection);
          return;
        }
        job = state->queue.dequeue();
      }
      const auto started = now(), queueMs = started - job.queuedAt;
      auto result = job.input;
      QString error;
      MarketStore::SaveInfo info, archiveInfo;
      bool primaryCommitted = false, archiveCommitted = false;
      try {
        MarketStore store(state->directory + "/market-v1.sqlite");
        // Presence does not decode historical bars; save reads history once.
        if (!store.contains(job.key)) {
          QFile legacy(state->directory + "/" + job.key + ".json");
          if (legacy.open(QIODevice::ReadOnly) && legacy.size() <= 8 * 1024 * 1024) {
            try { store.save(job.key, document(legacy.readAll())); } catch (...) {}
          }
        }
        result = store.save(job.key, result, &info);
        primaryCommitted = !info.superseded;
        if (job.period == "capitalMinute" && !result["dataDate"].toString().isEmpty()) {
          store.save(job.id + "-capital@" + result["dataDate"].toString(), result, &archiveInfo);
          archiveCommitted = !archiveInfo.superseded;
        }
      } catch (const std::exception &e) {
        error = primaryCommitted ? QString("行情主记录已提交；日归档失败，请重试归档")
                                 : QString::fromUtf8(e.what());
        result["persistenceState"] = "failed";
        result["persistenceError"] = error;
      } catch (...) {
        error = "行情写入异常；请核对本次保存状态";
        result["persistenceState"] = "failed";
        result["persistenceError"] = error;
      }
      const auto commitMs = now() - started;
      QJsonObject receipt{{"accepted",true},{"committed",error.isEmpty() && primaryCommitted},
          {"primaryCommitted",primaryCommitted},{"archiveCommitted",archiveCommitted},
          {"status",!error.isEmpty() ? "failed" : info.superseded ? "stale" : "committed"},
          {"queueMs",double(queueMs)},{"commitMs",double(commitMs)},
          {"historyReads",info.historyReads + archiveInfo.historyReads}};
      {
        QMutexLocker lock(&state->mutex);
        ++state->jobs;
        if (!error.isEmpty()) ++state->failed;
        else if (primaryCommitted) ++state->committed;
        state->maxQueueMs = qMax(state->maxQueueMs, queueMs);
        state->maxCommitMs = qMax(state->maxCommitMs, commitMs);
        state->totalCommitMs += commitMs;
        state->historyReads += info.historyReads + archiveInfo.historyReads;
        state->historyRows += info.historyRows + archiveInfo.historyRows;
      }
      QMetaObject::invokeMethod(state->pool, [state, job, result, error, receipt] {
        for (auto sequence : job.sequences) {
          auto *feed = state->owner.data();
          if (!feed) break;
          feed->finishWrite(sequence, result, error, receipt);
        }
      }, Qt::QueuedConnection);
    }
  }
};
MarketFeed::MarketFeed(QString dir, QObject *parent, QNetworkAccessManager *injected,bool loadRoster)
    : QObject(parent), directory(dir), transport(injected ? injected : &network) {
  QDir().mkpath(directory);
  writes = std::make_shared<WriteQueue>();
  writes->pool->setMaxThreadCount(1);
  writes->directory = directory;
  writes->owner = this;
  if(!loadRoster)return;
  try {
    auto root = read("watchlist");
    if (!root.isEmpty()) apply(marketdata::roster(root));
  } catch (const std::exception &e) {
    lastError = QString::fromUtf8(e.what());
  }
}
MarketFeed::~MarketFeed() {
  cancelSamples();
  {
    QMutexLocker lock(&writes->mutex);
    writes->closed = true;
    writes->dispose = true;
    writes->owner.clear();
    if (!writes->running) writes->pool->deleteLater();
  }
  cancelCapitalDay();
  etfClosed = true;
  for (auto seq : etfJobs.keys()) finishEtf(seq, "closed", "行情源已关闭");
  // Finish each callback while its captured host still exists. Accepted work
  // drains on the independent writer; "closed" never claims it was committed.
  for (auto sequence : pendingWrites.keys())
    finishWrite(sequence, {}, "行情源已关闭；已接纳数据继续后台保存",
                {{"status","closed"},{"accepted",true},{"committed",false}});
}
void MarketFeed::cancelCapitalDay() {
  auto* cancelled=capitalDayJob.data();
  capitalDayJob.clear(); capitalDayId.clear();
  delete cancelled;
}
QJsonObject MarketFeed::read(const QString &key) const {
  if (key != "watchlist") {
    try {
      auto stored = MarketStore(directory + "/market-v1.sqlite").read(key);
      if (!stored.isEmpty()) return stored;
    } catch (...) {
      // Fall back only to an actual old file; never replace corrupt data with
      // zeros.
      if (!QFile::exists(directory + "/" + key + ".json")) throw;
    }
  }
  QFile f(directory + "/" + key + ".json");
  if (!f.exists()) return {};
  if (!f.open(QIODevice::ReadOnly) || f.size() > 8 * 1024 * 1024)
    throw std::runtime_error("本机缓存无法读取");
  return document(f.readAll());
}
void MarketFeed::write(const QString &key, const QJsonObject &data) const {
  saveFile(directory + "/" + key + ".json", data);
}
QJsonObject MarketFeed::persistenceStats() const {
  QMutexLocker lock(&writes->mutex);
  return {{"outstanding",writes->outstanding},{"queuedJobs",writes->queue.size()},
          {"requestLimit",WriteRequestLimit},{"byteLimit",double(WriteByteLimit)},
          {"pendingBytes",double(writes->bytes)},{"peakRequests",writes->peakRequests},
          {"retainedFailures",writes->retained},{"retainedBytes",double(writes->retainedBytes)},
          {"peakBytes",double(writes->peakBytes)},{"accepted",double(writes->accepted)},
          {"rejected",double(writes->rejected)},{"coalesced",double(writes->coalesced)},
          {"writeJobs",double(writes->jobs)},{"committedJobs",double(writes->committed)},
          {"failedJobs",double(writes->failed)},{"historyReads",double(writes->historyReads)},
          {"historyRows",double(writes->historyRows)},{"maxQueueMs",double(writes->maxQueueMs)},
          {"maxCommitMs",double(writes->maxCommitMs)},{"totalCommitMs",double(writes->totalCommitMs)},
          {"closed",writes->closed},{"idle",!writes->running && writes->outstanding==0},
          {"canAccept",!writes->closed && !writes->backpressure && !writes->retained &&
             writes->outstanding < WriteRequestLimit && writes->bytes < WriteByteLimit}};
}
bool MarketFeed::acceptingWrites() const {
  return persistenceStats()["canAccept"].toBool();
}
void MarketFeed::stopPersistence() {
  cancelSamples();
  {
    QMutexLocker lock(&writes->mutex);
    writes->closed=true;
  }
  notifyPersistenceDrained();
}
QJsonArray MarketFeed::failedPersistence() const {
  QJsonArray rows;
  for(auto it=failedWrites.cbegin();it!=failedWrites.cend();++it) {
    const auto& failed=it.value();
    rows.append(QJsonObject{{"sequence",double(it.key())},{"originalSequence",double(failed.recoveryOf)},
      {"id",failed.id},{"period",failed.period},{"key",failed.key},{"input",failed.input},
      {"error",failed.error},{"receipt",failed.receipt},{"bytes",double(failed.bytes)}});
  }
  return rows;
}
bool MarketFeed::retryFailedPersistence() {
  {
    QMutexLocker lock(&writes->mutex);
    if(!writes->closed || writes->running || writes->outstanding) {
      lastError="须先停止接纳并完成当前写入，再明确重试失败数据";return false;
    }
    writes->retained=0;writes->retainedBytes=0;
  }
  const auto retry=std::move(failedWrites);failedWrites.clear();
  QPointer<MarketFeed> alive(this);
  for(auto it=retry.cbegin();it!=retry.cend();++it) {
    const auto& failed=it.value();
    persist(failed.id,failed.period,failed.key,failed.input,{},failed.recoveryOf);
    if(!alive)return false;
  }
  return true;
}
void MarketFeed::discardFailedPersistence() {
  failedWrites.clear();
  QMutexLocker lock(&writes->mutex);
  writes->retained=0;writes->retainedBytes=0;writes->backpressure=false;
}
void MarketFeed::notifyPersistenceDrained() {
  {
    QMutexLocker lock(&writes->mutex);
    if(!writes->closed || writes->running || writes->outstanding || writes->drainedNotified)return;
    writes->drainedNotified=true;
  }
  emit persistenceDrained();
}
void MarketFeed::persist(const QString &id, const QString &p,
                         const QString &key, QJsonObject result,
                         std::function<void(QJsonObject, QString)> completed,
                         quint64 recoveryOf) {
  const auto sequence = ++writeSerial;
  const qint64 bytes = QJsonDocument(result).toJson(QJsonDocument::Compact).size();
  bool accepted = false, start = false;
  {
    QMutexLocker lock(&writes->mutex);
    accepted = (recoveryOf || (!writes->closed && !writes->retained)) &&
               writes->outstanding + writes->retained < WriteRequestLimit &&
               bytes <= WriteByteLimit - writes->bytes - writes->retainedBytes;
    if (accepted) {
      ++writes->accepted; ++writes->outstanding; writes->bytes += bytes;
      writes->peakRequests = qMax(writes->peakRequests, writes->outstanding + writes->retained);
      writes->peakBytes = qMax(writes->peakBytes, writes->bytes + writes->retainedBytes);
      if(recoveryOf)writes->drainedNotified=false;
      bool duplicate = false;
      // Only identical pending latest quotes may share a physical write.
      // History, sampled bars and revisions always retain their own job.
      if (p == "quote")
        for (auto &job : writes->queue)
          if (job.id == id && job.period == p && job.key == key && job.input == result) {
            job.sequences.append(sequence); duplicate = true; ++writes->coalesced; break;
          }
      if (!duplicate) writes->queue.enqueue({id,p,key,result,{sequence},WriteQueue::now()});
      start = !writes->running;
      writes->running = true;
    } else {++writes->rejected;writes->backpressure=true;}
  }
  QJsonObject receipt{{"sequence",double(sequence)},{"id",id},{"period",p},{"key",key},
                      {"accepted",accepted},{"committed",false},{"status",accepted ? "queued" : "rejected"}};
  if (!accepted) {
    const QString error = "行情保存队列已满、暂停或已关闭；本次未接纳，请稍后重试";
    lastError = error;
    result["persistenceState"] = "rejected"; result["persistenceError"] = error;
    result["writeReceipt"] = receipt;
    for (int i=0;i<instruments.size();++i) {
      auto s=instruments[i].toObject(); if(s["id"]!=id)continue;
      const auto field=p=="quote"?p:p+"Meta"; auto current=s[field].toObject();
      current["persistenceState"]="failed";
      current["lastWriteAttempt"]=receipt;current["persistenceError"]=error;
      s[field]=current;instruments[i]=s;
    }
    QPointer<MarketFeed> alive(this);
    if (completed) try { completed(result,error); } catch (...) {
      if(alive) alive->lastError="行情完成回调未处理";
    }
    if(alive) emit persistenceChanged(receipt);
    if(alive) emit updated(id);
    return;
  }
  const auto generation = ++generations[key];
  pendingWrites.insert(sequence, {id,p,key,generation,bytes,result,recoveryOf,std::move(completed)});
  result["persistenceState"] = "pending";
  result["writeReceipt"] = receipt;
  for (int i=0;i<instruments.size();++i) {
    auto s=instruments[i].toObject(); if(s["id"]!=id)continue;
    if(p=="quote") s[p]=result;
    else {
      auto pending=s[p+"Meta"].toObject();
      if(s[p].toArray().isEmpty()){s[p]=result["rows"];pending=result;}
      pending["persistenceState"]="pending";pending["writeReceipt"]=receipt;
      pending.remove("error");pending.remove("persistenceError");
      pending["lastAttemptAt"]=result["checkedAt"];s[p+"Meta"]=pending;
    }
    instruments[i]=s;
  }
  if(start) {
    const auto state=writes;
    state->pool->start([state]{WriteQueue::drain(state);});
  }
  emit persistenceChanged(receipt);
}
void MarketFeed::finishWrite(quint64 sequence, QJsonObject result, QString error,
                              QJsonObject receipt) {
  auto found=pendingWrites.find(sequence);
  if(found==pendingWrites.end())return;
  auto pending=std::move(found.value());pendingWrites.erase(found);
  // Retry-stale remains recoverable: changing merge rules or dropping that
  // historical input would falsely turn an uncommitted recovery into success.
  const bool retain=receipt["status"]=="failed" ||
      (pending.recoveryOf && receipt["status"]=="stale");
  bool disposing;
  {
    QMutexLocker lock(&writes->mutex);
    --writes->outstanding;writes->bytes-=pending.bytes;disposing=writes->dispose;
    if(retain&&!disposing){++writes->retained;writes->retainedBytes+=pending.bytes;}
    writes->backpressure=false;
  }
  receipt["sequence"]=double(sequence);receipt["id"]=pending.id;
  receipt["period"]=pending.period;receipt["key"]=pending.key;
  if(pending.recoveryOf)receipt["recoveryOf"]=double(pending.recoveryOf);
  const bool latest=generations.value(pending.key)==pending.generation;
  receipt["latest"]=latest;
  if(error.isEmpty() && receipt["status"]=="stale")
    error="源版本较旧，保留已保存数据";
  else if(error.isEmpty() && !latest) {
    receipt["status"]="superseded";error="保存被较新数据替代";
  }
  if(retain&&!disposing)
    failedWrites.insert(sequence,{pending.id,pending.period,pending.key,error,pending.input,
      receipt,pending.bytes,pending.recoveryOf?pending.recoveryOf:sequence});
  result["writeReceipt"]=receipt;
  if(latest && !disposing) for(int i=0;i<instruments.size();++i) {
    auto s=instruments[i].toObject();if(s["id"]!=pending.id)continue;
    const auto p=pending.period, field=p=="quote"?p:p+"Meta";
    auto current=s[field].toObject(), saved=result;
    // A disk completion belongs to its write, not to a newer network attempt.
    if((p=="minute5s"||p=="minute30s")&&current.contains("requestState"))
      saved["requestState"]=current["requestState"];
    if(result["persistenceState"]=="failed" && !current.isEmpty()) {
      saved=current;saved["persistenceState"]="failed";
      saved["persistenceError"]=result["persistenceError"];
      saved["writeReceipt"]=receipt;
    }
    if(!current["error"].toString().isEmpty()) {
      saved["error"]=current["error"];saved["cached"]=current["cached"];
    }
    if(p=="quote")s[p]=saved;
    else {s[p]=saved["rows"];s[p+"Meta"]=saved;}
    instruments[i]=s;
  }
  // Only outstanding completions need this key's latest-generation marker.
  // Prune before user code can synchronously submit this key again.
  bool pendingForKey = false;
  for (auto it=pendingWrites.cbegin();it!=pendingWrites.cend();++it)
    if (it->key==pending.key) { pendingForKey=true; break; }
  if (!pendingForKey) generations.remove(pending.key);
  QPointer<MarketFeed> alive(this);
  if (pending.completed) try { pending.completed(result,error); } catch (...) {
    if(alive) alive->lastError="行情完成回调未处理";
  }
  if(alive) emit persistenceChanged(receipt);
  if(alive && !disposing)emit updated(pending.id);
  if(alive && !disposing && pending.period=="capitalMinute")
    emit capitalArchiveChanged(pending.id);
  if(alive) notifyPersistenceDrained();
}
QStringList MarketFeed::capitalDates(const QString &id) const {
  QString prefix = id + "-capital@";
  QStringList dates;
  for (const auto &key :
       MarketStore(directory + "/market-v1.sqlite").keys(prefix))
    dates << key.mid(prefix.size());
  return dates;
}
QStringList MarketFeed::capitalIds() const {
  QStringList ids;
  for (const auto &key :
       MarketStore(directory + "/market-v1.sqlite").keys("")) {
    if (!key.contains("-capital@")) continue;
    auto id = key.section("-capital@", 0, 0);
    if (!ids.contains(id)) ids << id;
  }
  return ids;
}
QJsonObject MarketFeed::capitalHistory(const QString &id,
                                       const QString &date) const {
  return MarketStore(directory + "/market-v1.sqlite")
      .read(id + "-capital@" + date);
}
void MarketFeed::importCapital(const QString &id, const QJsonObject &input) {
  auto result =
      marketdata::legacyCapital(input, id, QDateTime::currentDateTimeUtc());
  MarketStore(directory + "/market-v1.sqlite")
      .save(id + "-capital@" + result["dataDate"].toString(), result);
  QPointer<MarketFeed> alive(this);
  emit updated(id);
  if (alive) emit capitalArchiveChanged(id);
}
QJsonObject MarketFeed::hydrate(QJsonObject s) const {
    auto symbol = s["symbol"].toString();
    QStringList keys;
    try {keys=MarketStore(directory+"/market-v1.sqlite").keys(symbol+"-");}
    catch (...) { /* Existing legacy files remain eligible for fallback. */ }
    for (auto kind :
         {QString("quote"), QString("day"), QString("week"), QString("month"),
          QString("year"), QString("minute"), QString("minute5s"),
           QString("minute30s"), QString("capitalDay"), QString("capitalMinute"), QString("capitalSnapshot"),
          QString("auctionOpening"), QString("auctionClosing"),
          QString("auctionQuoteOpening"), QString("auctionQuoteClosing")}) {
      try {
        QJsonObject saved;
        if(QStringList{"day","week","month"}.contains(kind)){
          QJsonObject identity{{"securityId",s["id"]},{"period",kind},{"adjustment","forward"},{"sourceId","tencent-kline"}};
          saved=MarketStore(directory+"/market-v1.sqlite").read(marketHistory::key(identity));
          if(saved.isEmpty()){identity["adjustment"]="unadjusted";saved=MarketStore(directory+"/market-v1.sqlite").read(marketHistory::key(identity));}
          if(!saved.isEmpty()){
            auto rows=saved["rows"].toArray();identity["startDate"]=rows.first().toObject()["label"];identity["endDate"]=QDateTime::currentDateTimeUtc().toTimeZone(QTimeZone("Asia/Shanghai")).date().addDays(-1).toString(Qt::ISODate);
            marketHistory::validate(saved,identity);
          }
        }
        if(saved.isEmpty()){
          if (!keys.contains(symbol+"-"+kind) && !QFile::exists(directory+"/"+symbol+"-"+kind+".json")) continue;
          saved = read(symbol + "-" + kind);
        }
        if (saved.isEmpty()) continue;
        if (kind != "quote" && saved["timeUnit"] != "milliseconds") continue;
        if (!cacheIsNewer(saved,s[kind=="quote"?kind:kind+"Meta"].toObject(),
                          kind=="quote",!s[kind].toArray().isEmpty())) continue;
        saved["cached"] = true;
        if (kind == "quote")
          s[kind] = saved;
        else {
          s[kind] = saved["rows"];
          s[kind + "Meta"] = saved;
        }
      } catch (...) { /* A damaged cache never becomes a made-up quote. */
      }
    }
    return s;
}
void MarketFeed::apply(const QJsonArray &data) {
  cancelSamples();
  cancelCapitalDay();
  QHash<QString,QJsonObject> previous;
  for (const auto &row : instruments) previous.insert(row.toObject()["id"].toString(),row.toObject());
  instruments = data;
  for (int i = 0; i < instruments.size(); ++i) {
    const auto incoming=instruments[i].toObject();
    const auto id=incoming["id"].toString();
    auto s = previous.contains(id)?previous.value(id):hydrate(incoming);
    for (auto key : {"id","symbol","name","group","order","market"})
      if (incoming.contains(key)) s[key]=incoming[key];
    if (incoming["transient"].toBool()) s["transient"]=true;
    else s.remove("transient");
    instruments[i] = s;
  }
  emit rosterChanged();
}
void MarketFeed::loadSeed(const QString &path) {
  if (instruments.isEmpty() && QFile::exists(path)) importFile(path);
}
void MarketFeed::importFile(const QString &path) {
  QJsonArray rows;
  if (path.endsWith(".db", Qt::CaseInsensitive) ||
      path.endsWith(".sqlite", Qt::CaseInsensitive))
    rows = marketdata::readDatabase(path);
  else {
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly) || f.size() > 2 * 1024 * 1024)
      throw std::runtime_error("自选导入文件无法读取或过大");
    rows = marketdata::roster(document(f.readAll()));
  }
  const auto visible=withObservations(rows,instruments);
  write("watchlist",
        QJsonObject{{"schema", "native-watchlist/v1"}, {"instruments", rows}});
  apply(visible);
}
void MarketFeed::exportFile(const QString &file) const {
  QJsonArray rows;
  for (auto item : instruments) {
    auto s = item.toObject();
    if (s["transient"].toBool()) continue;
    QJsonObject row;
    for (auto key : {"id", "symbol", "name", "group", "order"})
      row[key] = s[key];
    rows.append(row);
  }
  saveFile(file, {{"schema", "native-watchlist/v1"}, {"instruments", rows}});
}
void MarketFeed::add(const QJsonObject &item) {
  for (auto s : instruments)
    if (s.toObject()["id"] == item["id"] && !s.toObject()["transient"].toBool())
      throw std::runtime_error("此标的已在自选，可在管理中恢复显示");
  auto rows = watchRows(instruments);
  rows.append(item);
  rows = marketdata::roster(
      {{"schema", "native-watchlist/v1"}, {"instruments", rows}});
  const auto visible=withObservations(rows,instruments);
  write("watchlist",
        {{"schema", "native-watchlist/v1"}, {"instruments", rows}});
  apply(visible);
}
void MarketFeed::observe(const QJsonObject &item) {
  const auto rows=marketdata::roster(
      {{"schema","native-watchlist/v1"},{"instruments",QJsonArray{item}}});
  const QString id=rows[0].toObject().value("id").toString();
  for(const auto &existing:instruments)if(existing.toObject()["id"]==id)return;
  if(instruments.size()>=3000)throw std::runtime_error("自选与临时观察合计不能超过3000只");
  auto observed=rows[0].toObject();observed["transient"]=true;
  instruments.append(hydrate(observed));emit rosterChanged();
}
QNetworkReply* MarketFeed::get(const QString &key, const QString &url,
                     const QByteArray &referer,
                     std::function<void(QByteArray, QString)> done) {
  if (!acceptingWrites()) {
    done({}, "行情保存积压，暂停后续请求；请稍后重试");
    return nullptr;
  }
  if (inFlight.contains(key)) return nullptr;
  inFlight.insert(key);
  QNetworkRequest request{QUrl(url)};
  request.setAttribute(QNetworkRequest::CacheLoadControlAttribute,
                       QNetworkRequest::AlwaysNetwork);
  request.setRawHeader("Referer", referer);
  request.setRawHeader("User-Agent", "NativeMarketReview/0.6");
  request.setTransferTimeout(12000);
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                       QNetworkRequest::ManualRedirectPolicy);
  auto *reply = transport->get(request);
  QTimer::singleShot(15000, reply, [reply] {
    if (!reply->isFinished()) reply->abort();
  });
  connect(reply, &QIODevice::readyRead, this, [reply] {
    if (reply->bytesAvailable() > 8 * 1024 * 1024) reply->abort();
  });
  connect(reply, &QNetworkReply::finished, this, [this, reply, key, done] {
    inFlight.remove(key);
    int status =
        reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    QString error;
    if (reply->error() != QNetworkReply::NoError || status < 200 ||
        status >= 300)
      error = status ? QString("行情服务HTTP %1").arg(status)
                     : "网络不可用或请求超时";
    if (!error.isEmpty())
      qWarning() << "Native provider transport" << reply->url().host()
                 << reply->error() << reply->errorString();
    auto bytes = reply->readAll();
    reply->deleteLater();
    if (bytes.size() > 8 * 1024 * 1024) error = "行情响应超过限制";
    done(bytes, error);
  });
  return reply;
}
void MarketFeed::finishEtf(quint64 seq, const QString& status,
                           const QString& error, const QJsonObject& data) {
  auto completed = etfJobs.take(seq);
  if (!completed) return;
  QPointer<MarketFeed> alive(this);
  try { completed({{"status", status}, {"error", error}, {"data", data}}); }
  catch (...) { if (alive) alive->lastError = "ETF完成回调未处理"; }
}
void MarketFeed::refreshEtf(const QString& id, const QString& p,
                            const QString& token,
                            std::function<void(QJsonObject)> completed) {
  if (!completed) throw std::invalid_argument("ETF刷新须提供完成回调");
  const auto seq = ++etfSerial;
  etfJobs[seq] = [completed, id, p, token](QJsonObject receipt) {
    receipt["token"] = token; receipt["id"] = id; receipt["period"] = p;
    completed(receipt);
  };
  if (etfClosed) { finishEtf(seq, "closed", "行情源已关闭"); return; }
  auto selected = [this, id]() {
    QJsonObject out; int ids = 0, symbols = 0;
    for (auto v : instruments) if (v.toObject()["id"] == id) {
      ++ids; out = v.toObject();
    }
    const QString symbol = id.section(':',0,0).toLower() + id.section(':',2);
    for (auto v : instruments) if (v.toObject()["symbol"] == symbol) ++symbols;
    if (ids != 1 || symbols != 1 || out["transient"].toBool() ||
        out["symbol"] != symbol || !out["name"].isString() ||
        out["name"].toString().trimmed().isEmpty() ||
        (out["quote"].toObject().contains("symbol") && out["quote"].toObject()["symbol"] != symbol)) return QJsonObject{};
    return out;
  };
  if (!QRegularExpression("^(SH|SZ|BJ):etf:[0-9]{6}$").match(id).hasMatch() ||
      (p != "quote" && p != "minute") || token.isNull()) {
    finishEtf(seq, "failed", "ETF身份或产品无效"); return;
  }
  auto row = selected();
  if (row.isEmpty()) { finishEtf(seq, "failed", "ETF身份不唯一或实际符号不符"); return; }
  const QString pair = id + "/" + p, symbol = row["symbol"].toString();
  auto previous = etfLatest.value(pair);
  etfLatest[pair] = seq;
  QPointer<MarketFeed> alive(this);
  finishEtf(previous, "superseded", "请求已被同证券较新请求替代");
  if (!alive || !etfJobs.contains(seq)) return;
  const QString url = p == "quote"
      ? "https://hq.sinajs.cn/list=" + symbol
      : "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=" + symbol;
  try {
    get("etf:" + QString::number(seq), url,
        p == "quote" ? QByteArray("https://finance.sina.com.cn/") : QByteArray("https://gu.qq.com/"),
        [this, seq, id, p, symbol, row, selected](QByteArray bytes, QString error) {
      if (!etfJobs.contains(seq) || etfClosed) return;
      if (selected()["name"] != row["name"] || selected()["symbol"] != row["symbol"]) {
        finishEtf(seq, "failed", "ETF身份已变化"); return;
      }
      QJsonObject result;
      if (error.isEmpty()) try {
        auto now = QDateTime::currentDateTimeUtc();
        result = p == "quote" ? marketdata::quotes(marketdata::decodeQuote(bytes), now.toUTC().toString(Qt::ISODate))[symbol].toObject()
                               : marketdata::minute(document(bytes), symbol, now);
        if (result.isEmpty()) error = "源未返回有效ETF数据";
      } catch (...) { error = "ETF源数据解析失败"; }
      if (!error.isEmpty()) {
        for (int i=0;i<instruments.size();++i) {
          auto s=instruments[i].toObject(); if(s["id"]!=id)continue;
          auto field=p=="quote"?p:p+"Meta";auto old=s[field].toObject();
          old["cached"]=true;old["error"]=error;s[field]=old;instruments[i]=s;
        }
        QPointer<MarketFeed> alive(this);
        finishEtf(seq, "failed", error); if (alive) emit updated(id); return;
      }
      persist(id, p, symbol+"-"+p, result,
          [this, seq, selected, row](QJsonObject saved, QString failure) {
        if (!etfJobs.contains(seq) || etfClosed) return;
        auto current=selected();
        if (current["name"]!=row["name"]||current["symbol"]!=row["symbol"]) {
          finishEtf(seq, "failed", "ETF身份已变化"); return;
        }
        finishEtf(seq, failure.isEmpty() ? "success" : "failed", failure,
                  failure.isEmpty() ? saved : QJsonObject{});
      });
    });
  } catch (...) { finishEtf(seq, "failed", "ETF请求未启动"); }
}
void MarketFeed::refreshQuotes() {
  QStringList symbols;
  for (auto item : instruments) symbols << item.toObject()["symbol"].toString();
  for (int start = 0; start < symbols.size(); start += 50) {
    auto batch = symbols.mid(start, 50);
    get("quote:" + batch.join(','),
        "https://hq.sinajs.cn/list=" + batch.join(','),
        "https://finance.sina.com.cn/",
        [this, batch](QByteArray bytes, QString error) {
          auto quotes =
              error.isEmpty()
                  ? marketdata::quotes(
                        marketdata::decodeQuote(bytes),
                        QDateTime::currentDateTimeUtc().toString(Qt::ISODate))
                  : QJsonObject{};
          for (int i = 0; i < instruments.size(); ++i) {
            auto s = instruments[i].toObject();
            auto symbol = s["symbol"].toString();
            if (!batch.contains(symbol)) continue;
            auto q = quotes[symbol].toObject();
            if (q.isEmpty()) {
              q = s["quote"].toObject();
              q["cached"] = true;
              q["error"] = error.isEmpty() ? "源未返回有效报价" : error;
            } else {
              QPointer<MarketFeed> alive(this);
              persist(s["id"].toString(), "quote", symbol + "-quote", q);
              if(!alive)return;
              continue;
            }
            s["quote"] = q;
            instruments[i] = s;
          }
          emit updated(QString());
        });
  }
}
QJsonObject MarketFeed::inspectHistory(const QJsonObject& query) const {
  return marketHistory::inspect(MarketStore(historyStorePath()),query);
}
void MarketFeed::saveHistory(const QJsonObject& raw,QJsonObject snapshot,bool replace,std::function<void(QJsonObject,QString)> done){
  const auto q=marketHistory::query(raw);marketHistory::validate(snapshot,q);
  snapshot["replaceHistory"]=replace||q["adjustment"]!="unadjusted";
  persist(q["securityId"].toString(),q["period"].toString(),marketHistory::key(q),snapshot,std::move(done));
}
MarketHistoryRequest* MarketFeed::fetchHistory(const QJsonObject& raw,bool replace,std::function<void(QJsonObject,QString)> done){
  const auto q=marketHistory::query(raw);
  if(q["sourceId"]!="tencent-kline")throw std::runtime_error("AKShare 请求必须由已安装并启用的数据源插件执行");
  const auto id=q["securityId"].toString(),symbol=id.section(':',0,0).toLower()+id.section(':',2);
  auto* request=new MarketHistoryRequest(this);
  struct Batch {QDate start,end;QJsonObject latest;QJsonArray coverage,requests;QMap<qint64,QJsonObject> rows;};
  auto batch=std::make_shared<Batch>();batch->start=QDate::fromString(q["startDate"].toString(),Qt::ISODate);
  batch->end=std::min(batch->start.addDays(499),QDate::fromString(q["endDate"].toString(),Qt::ISODate));
  auto finish=[request=QPointer<MarketHistoryRequest>(request),done](QJsonObject data,QString error){
    if(!request)return;
    if(request->cancelled)error="已取消；公共缓存保留，本次更新未完成";
    request->deleteLater();done(data,error);
  };
  auto step=std::make_shared<std::function<void()>>();std::weak_ptr<std::function<void()>> next=step;
  *step=[this,q,replace,symbol,batch,request=QPointer<MarketHistoryRequest>(request),finish,next]{
    if(!request)return;
    if(request->cancelled){finish({},"已取消");return;}
    auto page=q;page["startDate"]=batch->start.toString(Qt::ISODate);page["endDate"]=batch->end.toString(Qt::ISODate);
    const auto url="https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param="+symbol+","+q["period"].toString()+","+page["startDate"].toString()+","+page["endDate"].toString()+",640,"+(q["adjustment"]=="forward"?"qfq":"");
    auto keep=next.lock();
    request->reply=get("research-history:"+QUuid::createUuid().toString(),url,"https://gu.qq.com/",[this,q,page,replace,symbol,url,batch,request,finish,keep](QByteArray bytes,QString error){
      if(!request)return;request->reply=nullptr;
      if(request->cancelled||!error.isEmpty()){finish({},error+"；公共缓存保留，本次更新未成功");return;}
      try{
        auto data=marketdata::kline(document(bytes),symbol,q["period"].toString(),QDateTime::currentDateTimeUtc());
        auto rows=data["rows"].toArray();bool overlap=false;
        if(rows.size()>=640)throw std::runtime_error("来源达到返回上限，不能确认分段完整；旧版本保留");
        for(auto v:rows){auto row=v.toObject();
          if(row["label"].toString()<page["startDate"].toString()||row["label"].toString()>page["endDate"].toString())throw std::runtime_error("数据源返回请求区间外的行情，未保存");
          auto time=qint64(row["time"].toDouble());
          if(batch->rows.contains(time)){overlap=true;auto previous=batch->rows[time];
            for(auto f:{"open","high","low","close","volume"})if(std::abs(previous[f].toDouble()-row[f].toDouble())>1e-7)throw std::runtime_error("分段重叠行情发生修订；未混合不同版本，请重新刷新");
          }
          batch->rows[time]=row;
        }
        if(!batch->latest.isEmpty()&&q["adjustment"]!="unadjusted"&&!overlap)throw std::runtime_error("复权分段缺少重叠校验，未保存不确定版本");
        data=marketHistory::annotate(data,page,true,640);batch->latest=data;
        for(auto c:data["queryCoverage"].toArray())batch->coverage.append(c);
        batch->requests.append(QJsonObject{{"url",url},{"startDate",page["startDate"]},{"endDate",page["endDate"]},{"acquiredAt",data["checkedAt"]},{"rawResponseSha256",QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex())}});
        auto end=QDate::fromString(q["endDate"].toString(),Qt::ISODate);
        if(batch->end<end){
          batch->start=q["adjustment"]=="unadjusted"?batch->end.addDays(1):QDate::fromString(rows.last().toObject()["label"].toString(),Qt::ISODate);
          batch->end=std::min(batch->end.addDays(499),end);
          QTimer::singleShot(0,request,[keep]{(*keep)();});return;
        }
        QJsonArray combined;for(auto row:batch->rows)combined.append(row);
        data["rows"]=combined;data["queryCoverage"]=batch->coverage;data["sourceRequests"]=batch->requests;
        data["sourceTruncated"]=false;saveHistory(q,data,replace,finish);
      }catch(const std::exception& e){finish({},QString::fromUtf8(e.what()));}
    });
  };
  QTimer::singleShot(0,request,[step]{(*step)();});return request;
}
void MarketFeed::chart(const QString &id, const QString &p, bool force) {
  QJsonObject selected;
  for (auto item : instruments)
    if (item.toObject()["id"].toString() == id) selected = item.toObject();
  if (selected.isEmpty() || (p != "day" && p != "week" && p != "month" &&
                             p != "year" && p != "minute"))
    return;
  const auto meta = selected[p + "Meta"].toObject();
  const auto checked =
      QDateTime::fromString(meta["checkedAt"].toString(), Qt::ISODate);
  if (!force && !meta["cached"].toBool(true) && checked.isValid() &&
      checked.secsTo(QDateTime::currentDateTimeUtc()) < 60)
    return;
  auto symbol = selected["symbol"].toString();
  const auto url =
      p == "minute"
          ? "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=" + symbol
          : "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" +
                symbol + "," + (p == "year" ? "month" : p) + ",,,640,qfq";
  get(symbol + ":" + p, url, "https://gu.qq.com/",
      [this, id, symbol, p](QByteArray bytes, QString error) {
        QJsonObject result;
        if (error.isEmpty()) try {
            auto raw = document(bytes);
            auto now = QDateTime::currentDateTimeUtc();
            result = p == "minute"
                         ? marketdata::minute(raw, symbol, now)
                         : marketdata::kline(raw, symbol,
                                             p == "year" ? "month" : p, now);
            if (p == "year")
              result = marketdata::aggregateCalendar(result, "year", now);
          } catch (const std::exception &e) {
            error = QString::fromUtf8(e.what());
          }
        for (int i = 0; i < instruments.size(); ++i) {
          auto s = instruments[i].toObject();
          if (s["id"].toString() != id) continue;
          if (!error.isEmpty()) {
            result = s[p + "Meta"].toObject();
            result["cached"] = true;
            result["error"] = error;
          } else {
            QPointer<MarketFeed> alive(this);
            if(QStringList{"day","week","month"}.contains(p)&&!result["rows"].toArray().isEmpty()){
              auto rows=result["rows"].toArray();QJsonObject q{{"securityId",id},{"period",p},{"sourceId","tencent-kline"},{"adjustment",result["adjustment"]=="qfq"?"forward":"unadjusted"},
                {"startDate",rows.first().toObject()["label"]},{"endDate",QDateTime::currentDateTimeUtc().toTimeZone(QTimeZone("Asia/Shanghai")).date().addDays(-1).toString(Qt::ISODate)}};
              try{result=marketHistory::annotate(result,q,false,640);saveHistory(q,result,false,{});}
              catch(const std::exception&){persist(id,p,symbol+"-"+p,result);}
            }else persist(id, p, symbol + "-" + p, result);
            if(!alive)return;
            break;
          }
          s[p + "Meta"] = result;
          instruments[i] = s;
        }
        emit updated(id);
      });
}
void MarketFeed::capitalFlow(const QString &id, const QString &mode, bool force,
                             int retry) {
  if(mode=="day"&&capitalDayJob&&capitalDayId==id) return;
  if(retry==0&&capitalDayJob&&(mode!="day"||capitalDayId!=id)) cancelCapitalDay();
  QJsonObject selected;
  for (auto item : instruments)
    if (item.toObject()["id"] == id) selected = item.toObject();
  if (selected.isEmpty() || (mode != "day" && mode != "minute" && mode != "snapshot")) return;
  QString p = mode == "snapshot" ? "capitalSnapshot" : mode == "day" ? "capitalDay" : "capitalMinute",
          symbol = selected["symbol"].toString();
  auto meta = selected[p + "Meta"].toObject();
  auto checked =
      QDateTime::fromString(meta["checkedAt"].toString(), Qt::ISODate);
  if (!force && !meta["cached"].toBool(true) && checked.isValid() &&
      checked.secsTo(QDateTime::currentDateTimeUtc()) < 60)
    return;
  auto secid = (symbol.startsWith("sh") ? "1." : "0.") + symbol.mid(2);
  auto url = mode == "day" ? "https://push2his.eastmoney.com/api/qt/stock/"
                             "fflow/daykline/get?cb=NativeCapitalDay&lmt=0&klt=101&"
                           : "https://push2.eastmoney.com/api/qt/stock/fflow/"
                             "kline/get?lmt=0&klt=1&";
  QString requestUrl = QString(url) + "secid=" + secid +
          "&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,"
          "f60,f61,f62,f63" + QString(mode == "day" ? ",f64,f65" : "") +
          "&ut=b2884a393a59ad64002292a3e90d46a5";
  if (mode == "day") requestUrl += "&_=" + QString::number(QDateTime::currentMSecsSinceEpoch());
  if(mode=="snapshot") requestUrl="https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids="+secid+"&fields=f2,f3,f12,f14,f62,f66,f69,f72,f75,f78,f81,f84,f87,f184";
  auto complete = [this, id, symbol, p, mode, retry, requestUrl,expectedName=selected["name"].toString()](QByteArray bytes, QString error, QJsonArray attempts) {
        const QPointer<QObject> job=mode=="day"?capitalDayJob:QPointer<QObject>{};
        QJsonObject result;
        if (error.isEmpty()) try {
            const auto raw=mode == "day" ? marketdata::capitalDayResponse(bytes) : document(bytes);
            if(id.contains(":index:")&&mode!="snapshot"&&raw["data"].toObject()["name"].toString()!=expectedName)
              throw std::runtime_error("指数资金名称与请求身份不匹配，未采用响应");
            result = marketdata::capital(raw, symbol, mode,
                                         QDateTime::currentDateTimeUtc());
            result["securityId"]=id;result["scope"]=id.contains(":index:")?"index-provider-classified":"stock-provider-classified";
            if (mode == "day") {
              result["rawResponseText"] = QString::fromUtf8(bytes);
              result["sourceUrl"] = attempts.last().toObject()["url"];
              result["requestProtocol"] = result["sourceUrl"].toString().startsWith("https://emdatah5.eastmoney.com/")
                  ? "first-party-mobile-public-json/v1" : "first-party-public-jsonp/v1";
              result["transportAttempts"] = attempts;
              result["coverageNote"] = "来源默认历史窗口，未证明上市以来完整；每日分类净额不是机构账户真实流向。";
            }
          } catch (const std::exception &e) {
            error = QString::fromUtf8(e.what());
          }
        for (int i = 0; i < instruments.size(); i++) {
          auto s = instruments[i].toObject();
          if (s["id"] != id) continue;
          if (error.isEmpty()) {
            QPointer<MarketFeed> alive(this);
            persist(id, p, symbol + "-" + p, result, [this,job](QJsonObject,QString){
              if(job&&capitalDayJob==job) cancelCapitalDay();
            });
            if(!alive)return;
            break;
          }
          auto old = s[p + "Meta"].toObject();
          old["cached"] = true;
          old["error"] = error;
          if(mode=="day") old["lastTransportAttempts"]=attempts;
          s[p + "Meta"] = old;
          instruments[i] = s;
        }
        if(mode=="day"&&!error.isEmpty()) {
          auto* ended=capitalDayJob.data(); capitalDayJob.clear(); capitalDayId.clear();
          if(ended) ended->deleteLater();
        }
        emit updated(id);
        if (mode != "day" && error == "网络不可用或请求超时" && retry < 2)
          QTimer::singleShot(2000 * (retry + 1), this, [this, id, mode, retry] {
            capitalFlow(id, mode, true, retry + 1);
          });
      };
  if(mode=="day") {
    if (!acceptingWrites()) {
      complete({}, "行情保存积压，暂停后续请求；请稍后重试", {});
      return;
    }
    capitalDayId=id;
    // The official mobile stock page uses this anonymous same-provider history
    // route. f51..f56 are exactly the original date and five net-amount fields.
    const auto fallback="https://emdatah5.eastmoney.com/dc/ZJLX/getDBHistoryData?secid="+secid+
        "&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f62,f63";
    auto* job=new CapitalDayRequest(transport,requestUrl,fallback,complete,this);
    capitalDayJob=job; job->start();
  } else get(symbol+":"+p,requestUrl,"https://quote.eastmoney.com/",
             [complete](QByteArray bytes,QString error){complete(bytes,error,{});});
}
void MarketFeed::cancelSamples() {
  auto* job=detailJob.data();detailJob.clear();delete job;
  detailAttemptAt={};
  for(int i=0;i<instruments.size();++i){
    auto item=instruments[i].toObject();if(item["id"]!=detailId)continue;
    auto meta=item[detailPeriod+"Meta"].toObject();
    if(meta["requestState"]!="loading")continue;
    meta["requestState"]=item[detailPeriod].toArray().isEmpty()?"idle":"ready";
    item[detailPeriod+"Meta"]=meta;instruments[i]=item;
  }
}
void MarketFeed::sample(const QString &id, int seconds, bool force) {
  if (seconds != 5 && seconds != 30) return;
  QJsonObject selected;
  for (auto v : instruments)
    if (v.toObject()["id"] == id) selected = v.toObject();
  if (selected.isEmpty()) return;
  const auto now = QDateTime::currentDateTimeUtc(),
       local = now.toOffsetFromUtc(8 * 3600);
  auto clock = local.time();
  bool session = local.date().dayOfWeek() <= 5 &&
                 ((clock >= QTime(9, 30) && clock <= QTime(11, 30)) ||
                  (clock >= QTime(13, 0) && clock <= QTime(15, 0)));
  const auto p=QString("minute%1s").arg(seconds);
  auto status = [this, id, p](QString text,QString state) {
    for (int i = 0; i < instruments.size(); i++) {
      auto s = instruments[i].toObject();
      if (s["id"] != id) continue;
      s["samplingStatus"] = text;
      auto meta=s[p+"Meta"].toObject();meta["requestState"]=state;
      s[p+"Meta"]=meta;
      instruments[i] = s;
    }
    emit updated(id);
  };
  if(detailId!=id||detailPeriod!=p){cancelSamples();detailId=id;detailPeriod=p;detailFailures=0;}
  if(detailJob||!acceptingWrites())return;
  const int interval=detailFailures?60000:session?seconds*1000:300000;
  if(!force&&detailAttemptAt.isValid()&&detailAttemptAt.msecsTo(now)<interval)return;
  QString symbol;
  try{symbol=tencentDetail::symbol(selected);}catch(const std::exception& e){status(QString::fromUtf8(e.what()),"failed");return;}
  detailAttemptAt=now;
  auto previous=selected[p+"Meta"].toObject()["detailSnapshot"].toObject();
  // Reuse the other precision's captured pages when switching 5s <-> 30s.
  if(previous.isEmpty())previous=selected[(seconds==5?QString("minute30sMeta"):QString("minute5sMeta"))].toObject()["detailSnapshot"].toObject();
  QPointer<MarketFeed> alive(this);status("正在载入腾讯当日分时…","loading");if(!alive)return;
  detailJob=tencentDetail::fetch(transport,this,symbol,seconds,previous,QJsonValue(),
      [this,id,p,symbol,status](QJsonObject result,QString error){
    auto* job=detailJob.data();detailJob.clear();if(job)job->deleteLater();
    QJsonObject selected;for(auto value:instruments)if(value.toObject()["id"]==id)selected=value.toObject();
    if(selected.isEmpty()||selected["symbol"]!=symbol)return;
    if(!error.isEmpty()){
      ++detailFailures;
      for(int i=0;i<instruments.size();++i){auto item=instruments[i].toObject();if(item["id"]!=id)continue;auto meta=item[p+"Meta"].toObject();meta["error"]=error;meta["cached"]=true;meta["lastAttemptAt"]=detailAttemptAt.toUTC().toString(Qt::ISODateWithMs);item[p+"Meta"]=meta;instruments[i]=item;}
      status(error,"failed");return;
    }
    detailFailures=0;const auto meta=selected[p+"Meta"].toObject();result["requestState"]="ready";
    for(int i=0;i<instruments.size();++i){auto item=instruments[i].toObject();if(item["id"]!=id)continue;item["detailAttempt"]=QJsonObject{{"checkedAt",result["checkedAt"]},{"networkRequests",result["networkRequests"]},{"reusedPages",result["reusedPages"]},{"providerLastAt",result["providerLastAt"]},{"rawRecordCount",result["rawRecordCount"]},{"paginationComplete",result["paginationComplete"]}};instruments[i]=item;}
    const auto quote=selected["quote"].toObject();if(quote["tradeDate"]==result["dataDate"]&&quote["previousClose"].isDouble()&&quote["previousClose"].toDouble()>0)result["previousClose"]=quote["previousClose"];
    const auto message=QString("腾讯分笔 · %1 · %2条 · %3").arg(result["providerLastAt"].toString()).arg(result["rawRecordCount"].toInt()).arg(result["paginationComplete"].toBool()?"已读至当前末页":"末页更新中");
    QPointer<MarketFeed> alive(this);
    if(meta["detailSnapshot"]!=result["detailSnapshot"]||meta["provider"]!="tencent-public-detail"||meta["previousClose"]!=result["previousClose"]||!meta["error"].toString().isEmpty())persist(id,p,symbol+"-"+p,result);
    if(alive)status(message,"ready");
  });
}
void MarketFeed::sampleAuction(const QString &id, const QString &phase) {
  if (phase != "opening" && phase != "closing") return;
  auto now = QDateTime::currentDateTimeUtc(),
       local = now.toOffsetFromUtc(8 * 3600);
  QTime start = phase == "opening" ? QTime(9, 15) : QTime(14, 57),
        end = phase == "opening" ? QTime(9, 25) : QTime(15, 0);
  if (local.date().dayOfWeek() > 5 || local.time() < start ||
      local.time() > end)
    return;
  QJsonObject chosen;
  for (auto v : instruments)
    if (v.toObject()["id"] == id) chosen = v.toObject();
  if (chosen.isEmpty()) return;
  const QString symbol = chosen["symbol"].toString(),
                p = phase == "opening" ? "auctionQuoteOpening"
                                       : "auctionQuoteClosing";
  get(symbol + ":auction-quote", "https://hq.sinajs.cn/list=" + symbol,
      "https://finance.sina.com.cn/",
      [this, id, symbol, p, phase](QByteArray bytes, QString error) {
        auto now = QDateTime::currentDateTimeUtc();
        auto q = marketdata::quotes(marketdata::decodeQuote(bytes),
                                    now.toString(Qt::ISODateWithMs))[symbol]
                     .toObject();
        QJsonObject selected;
        for (auto v : instruments)
          if (v.toObject()["id"] == id) selected = v.toObject();
        auto old = selected[p + "Meta"].toObject();
        auto observations = old["observations"].toArray();
        if (!observations.isEmpty() &&
            observations.last().toObject()["tradeDate"] != q["tradeDate"])
          observations = {};
        if (error.isEmpty() && !q.isEmpty() &&
            (observations.isEmpty() ||
             observations.last().toObject()["tradeTime"].toString() <
                 q["tradeTime"].toString())) {
          observations.append(q);
          try {
            persist(id, p, symbol + "-" + p,
                    marketdata::auctionQuotes(observations, phase, now));
            return;
          } catch (const std::exception &e) {
            error = QString::fromUtf8(e.what());
          }
        }
        if (error.isEmpty()) error = "源时间未前进或未返回有效报价，不重复记录";
        for (int i = 0; i < instruments.size(); ++i)
          if (instruments[i].toObject()["id"] == id) {
            auto s = instruments[i].toObject();
            old["error"] = error;
            s[p + "Meta"] = old;
            instruments[i] = s;
          }
        emit updated(id);
      });
}
void MarketFeed::importAuction(const QString &id, const QJsonObject &input) {
  QJsonObject chosen;
  for (auto v : instruments)
    if (v.toObject()["id"] == id) chosen = v.toObject();
  if (chosen.isEmpty()) throw std::runtime_error("证券不在当前清单");
  auto result = marketdata::auction(input, id, QDateTime::currentDateTimeUtc());
  QString p =
      result["phase"] == "opening" ? "auctionOpening" : "auctionClosing";
  QPointer<MarketFeed> alive(this);
  persist(id, p, chosen["symbol"].toString() + "-" + p, result);
  if(alive)emit updated(id);
}
