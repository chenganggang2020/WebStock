#include "collection_pipeline.hpp"
CollectionPipeline::CollectionPipeline(std::shared_ptr<BusinessStore> s,
                                       const QString& root, QObject* p,
                                       QNetworkAccessManager* transferNetwork)
    : QObject(p),
      store(s),
      archiveRoot(root),
      download(transferNetwork ? transferNetwork : &network),
      asr(s),
      permissions(root + "/queue-settings.ini", QSettings::IniFormat),
      poll(store->filePath()) {
  poll.completed = [this](CollectionPoll::Result result, quint64 token) {
    consumePoll(std::move(result), token);
  };
  if (asr.ownsQueue()) recoverQueue();
  connect(&download, &CollectionDownload::completed, this,
          [this](QJsonObject media) {
            if (active.isEmpty() || ending) return;
            try {
              auto j = record(active);
              if (!stillApproved(j)) return;
              j["assetPath"] = media["assetPath"];
              j["archive"] = media;
              store->save("collections", j);
              proceed();
            } catch (const std::exception& e) {
              failed(e.what());
            }
          });
  connect(&download, &CollectionDownload::failed, this,
          &CollectionPipeline::failed);
  connect(&asr, &CollectionRunner::progress, this,
          &CollectionPipeline::progress);
  connect(&asr, &CollectionRunner::changed, this, [this] {
    QPointer<CollectionPipeline> self(this);
    emit changed();
    if (!self) return;
    if (ending || !asr.activeId().isEmpty()) return;
    if (active.isEmpty()) {
      QTimer::singleShot(0, this, &CollectionPipeline::tick);
      return;
    }
    try {
      auto j = record(active);
      if (!stillApproved(j)) return;
      if (j["pipelineState"] != "transcribing") return;
      if (j["status"] == "completed")
        proceed();
      else if (j["status"] == "failed" || j["status"] == "cancelled")
        failed(j["error"].toString());
    } catch (const std::exception& e) {
      failed(e.what());
    }
  });
  connect(&timer, &QTimer::timeout, this, &CollectionPipeline::tick);
  timer.start(30000);
  QTimer::singleShot(0, this, &CollectionPipeline::tick);
}
void CollectionPipeline::recoverQueue() {
  asr.requireOwnership();
  for (auto v : store->read("collections")) {
    auto j = v.toObject();
    if (j["autoPipeline"].toBool() &&
        QStringList{"downloading", "transcribing", "publishing"}.contains(
            j["pipelineState"].toString())) {
      j["pipelineState"] = "queued";
      j["pipelineMessage"] = "上次中断，恢复已启用任务";
      store->save("collections", j);
    }
  }
  recoveryComplete = true;
}
void CollectionPipeline::requireOwnership() const {
  asr.requireOwnership();
  business::require(recoveryComplete, "队列恢复尚未完成，请重试接管");
}
bool CollectionPipeline::tryAcquireQueue() {
  if (ownsQueue()) return true;
  if (!asr.tryAcquireQueue()) { emit changed(); return false; }
  try {
    recoverQueue();
  } catch (const std::exception& e) {
    lastError = "队列恢复失败，请检查存储后重试接管：" + QString::fromUtf8(e.what());
    emit changed();
    throw;
  }
  lastError.clear();
  emit changed();
  QTimer::singleShot(0, this, &CollectionPipeline::tick);
  return true;
}
QString CollectionPipeline::key(const QString& id) const {
  return "approved/" +
         QString::fromLatin1(
             QCryptographicHash::hash(id.toUtf8(), QCryptographicHash::Sha256)
                 .toHex()) +
         "/";
}
CollectionPipeline::~CollectionPipeline() {
  ending = true;
  poll.cancel();
  timer.stop();
  disconnect(&download, nullptr, this, nullptr);
  disconnect(&asr, nullptr, this, nullptr);
  download.cancel();
  if (!active.isEmpty()) try {
      auto j = record(active);
      if (j["autoPipeline"].toBool() &&
          j.value("executionRevision").toString() == activeRevision) {
        j["pipelineState"] = "queued";
        j["pipelineMessage"] = "程序退出，保留阶段，下次恢复";
        store->save("collections", j);
      }
    } catch (...) {
    }
}
QJsonObject CollectionPipeline::record(const QString& id) const {
  for (auto v : store->read("collections"))
    if (v.toObject()["id"] == id) return v.toObject();
  throw std::runtime_error("采集记录不存在");
}
QString CollectionPipeline::enqueue(const QString& id, const QString& python,
                                 const QString& model, const QJsonObject& sourceReceipt) {
  requireOwnership();
  auto j = record(id);
  business::require(id != active, "任务已在执行，不重复启动");
  business::require(!j.contains("executionRevision") || j.value("executionRevision").isString(),
                    "任务执行身份格式无效，原任务保留");
  business::require(!j["rightsBasis"].toString().trimmed().isEmpty(),
                    "请填写下载/转写授权依据");
  if (j["text"].toString().trimmed().isEmpty()) {
    business::require(
        QFileInfo(python).isAbsolute() && QFileInfo(python).isFile(),
        "缺少本机Python识别引擎");
    business::require(QFileInfo(model).isAbsolute() &&
                          QFileInfo(model + "/model.bin").isFile(),
                      "缺少本机识别模型");
    business::require(
        QFileInfo(j["assetPath"].toString()).isFile() ||
            CollectionDownload::allowed(QUrl(j["mediaUrl"].toString())),
        "缺少本机媒体或允许的HTTPS媒体地址");
  }
  j.remove("pipelinePython");
  j.remove("pipelineModel");
  const auto attempt = sourceReceipt.isEmpty()
                           ? QUuid::createUuid().toString(QUuid::WithoutBraces)
                           : sourceReceipt["attemptId"].toString();
  if (!sourceReceipt.isEmpty()) {
    business::require(!attempt.isEmpty() && attempt.size() <= 128 &&
                          !sourceReceipt["sourceRunId"].toString().isEmpty() &&
                          sourceReceipt["jobId"].toString() == id &&
                          sourceReceipt["executionRevision"].isString() &&
                          sourceReceipt["executionRevision"].toString() ==
                              j.value("executionRevision").toString(),
                      "来源任务回执身份无效");
    business::require(j["sourceTaskReceipt"].toObject().isEmpty(),
                      "已有来源回执，不以新的轮次覆盖");
    auto receipt = sourceReceipt;
    receipt["state"] = "running";
    receipt["startedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
    j["sourceTaskReceipt"] = receipt;
  } else {
    auto receipt = j["sourceTaskReceipt"].toObject();
    if (receipt["state"] == "running") {
      receipt["state"] = "interrupted";
      receipt["message"] = "后续主动启动已与原来源轮次分开";
      receipt["finishedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
      j["sourceTaskReceipt"] = receipt;
    }
  }
  // Executable paths and permission are device-local, never taken from imported
  // records. Validate the receipt before changing device-local approval.
  permissions.setValue(key(id) + "id", id);
  permissions.setValue(key(id) + "python", python);
  permissions.setValue(key(id) + "model", model);
  permissions.sync();
  business::require(permissions.status() == QSettings::NoError,
                    "本机任务批准状态保存失败");
  j["pipelineAttemptId"] = attempt;
  j["autoPipeline"] = true;
  j["pipelineState"] = "queued";
  j["pipelineFailures"] = 0;
  j["nextAttemptAt"] = "";
  j["pipelineMessage"] = "排队：下载→转写→研究入库";
  store->save("collections", j);
  poll.cancel();
  suspended = false;
  lastError.clear();
  timer.start(30000);
  emit changed();
  tick();
  return attempt;
}
bool CollectionPipeline::pollIdle() const {
  return ownsQueue() && !ending && !suspended && active.isEmpty() &&
         asr.activeId().isEmpty() && !download.busy();
}
void CollectionPipeline::tick() {
  if (pollIdle()) poll.request();
}
void CollectionPipeline::consumePoll(CollectionPoll::Result result, quint64 token) {
  if (!poll.current(token) || !pollIdle()) return;
  QPointer<CollectionPipeline> self(this);
  auto readError = [self](const QString& error) {
    if (!self) return;
    // Reading has not executed a job. Preserve approval and the retry timer.
    self->lastError = "采集队列读取暂不可用，原任务保留：" + error;
    const auto message = self->lastError;
    emit self->changed(); if (self) emit self->progress({}, message);
  };
  if (!result.error.isEmpty()) { readError(result.error); return; }
  if (!lastError.isEmpty()) {
    lastError.clear(); emit changed(); if (!self) return;
  }
  try {
    for (const auto& row : result.rows) {
      if (!poll.current(token) || !pollIdle()) return;
      if (!CollectionPoll::matches(store->filePath(), row)) {
        // A newer complete version must get another ordered snapshot. Never
        // delete its grant or dispatch a later row past the changed candidate.
        tick(); return;
      }
      const auto& j = row.record;
      if (j["id"] != row.id || !CollectionPoll::eligible(j)) continue;
      permissions.sync();
      business::require(permissions.status() == QSettings::NoError, "本机任务批准状态读取失败");
      if (permissions.value(key(row.id) + "id").toString() != row.id) {
        const bool changedRow = store->pauseUnapprovedCollectionPoll(row.id, row.payload);
        if (!changedRow) { tick(); return; }
        emit changed();
        if (!self) return;
        continue;
      }
      // A path/preference entry alone is never an instruction to run. The full
      // unchanged persisted job must also remain explicitly enabled and due.
      business::require(!j["rightsBasis"].toString().trimmed().isEmpty(), "任务缺少下载/转写授权依据");
      for (const auto& field : {"executionRevision", "pipelineAttemptId"})
        business::require(!j.contains(field) || j[field].isString(), "任务执行身份格式无效，原任务保留");
      const auto receipt = j["sourceTaskReceipt"].toObject();
      if (receipt["state"] == "running")
        business::require(receipt["jobId"] == row.id &&
          !receipt["attemptId"].toString().isEmpty() &&
          receipt["attemptId"] == j["pipelineAttemptId"] &&
          receipt["executionRevision"].isString() &&
          receipt["executionRevision"].toString() == j["executionRevision"].toString(),
          "来源任务回执与当前执行身份不符，原任务保留");
      auto due = QDateTime::fromString(j["nextAttemptAt"].toString(),
                                       Qt::ISODateWithMs);
      if (due.isValid() && due > QDateTime::currentDateTimeUtc()) continue;
      active = row.id;
      activeRevision = j["executionRevision"].toString();
      activeAttempt = j["pipelineAttemptId"].toString();
      lastError.clear();
      proceed();
      return;
    }
  } catch (const std::exception& e) {
    if (!self) return;
    if (active.isEmpty()) readError(QString::fromUtf8(e.what()));
    else failed(e.what());
  }
}
void CollectionPipeline::proceed() {
  auto j = record(active);
  if (!stillApproved(j)) return;
  const auto receipt = j["sourceTaskReceipt"].toObject();
  const bool sourceAttempt = receipt["state"] == "running" &&
                             receipt["attemptId"].toString() == activeAttempt &&
                             receipt["jobId"].toString() == active &&
                             receipt["executionRevision"].toString() == activeRevision;
  // Publication may have committed just before an interruption. Never replay
  // over it, or claim an older document as this source attempt's publication.
  for (auto v : store->read("docs"))
    if (v.toObject()["collectionId"] == active) {
      business::require(!sourceAttempt ||
                            (v.toObject()["sourceAttemptId"].toString() == activeAttempt &&
                             v.toObject()["collectionExecutionRevision"].isString() &&
                             v.toObject()["collectionExecutionRevision"].toString() == activeRevision),
                        "存在旧研究资料，不视为本轮入库；请人工核对，原稿不会覆盖");
      finish();
      return;
    }
  if (!j["text"].toString().trimmed().isEmpty()) {
    j["pipelineState"] = "publishing";
    store->save("collections", j);
    publishCollection(store, active, sourceAttempt ? receipt : QJsonObject{});
    finish();
    return;
  }
  if (QFileInfo(j["assetPath"].toString()).isFile()) {
    j["pipelineState"] = "transcribing";
    j["pipelineMessage"] = "媒体已归档，正在本机识别";
    store->save("collections", j);
    asr.enqueue(active, permissions.value(key(active) + "python").toString(),
                permissions.value(key(active) + "model").toString(), activeAttempt);
  } else {
    j["pipelineState"] = "downloading";
    j["pipelineMessage"] = "下载并校验原生归档";
    store->save("collections", j);
    QPointer<CollectionPipeline> self(this);
    emit changed();
    if (!self) return;
    QList<QUrl> mirrors;
    const auto binding=j["mediaBinding"].toObject();
    const auto candidates=j["mediaCandidates"].toArray();
    if (binding["contentId"]==j["externalContentId"] && !binding["contentId"].toString().isEmpty() &&
        binding["profileUrl"]==j["sourceProfile"] && !binding["profileUrl"].toString().isEmpty() &&
        QStringList{"embedded_detail","detail_response"}.contains(binding["source"].toString()) &&
        !candidates.isEmpty() && candidates.first()==j["mediaUrl"])
      for (const auto& value : candidates) mirrors.append(QUrl(value.toString()));
    download.start(QUrl(j["mediaUrl"].toString()), archiveRoot,
                   j["expectedSha256"].toString(), mirrors);
  }
}
bool CollectionPipeline::stillApproved(const QJsonObject& j) {
  if (j["autoPipeline"].toBool() &&
      j["executionRevision"].toString() == activeRevision)
    return true;
  permissions.remove(key(active));
  permissions.sync();
  active.clear();
  QPointer<CollectionPipeline> self(this);
  emit changed();
  if (self) QTimer::singleShot(0, this, &CollectionPipeline::tick);
  return false;
}
void CollectionPipeline::finish() {
  auto j = record(active);
  if (!stillApproved(j)) return;
  const auto receipt = j["sourceTaskReceipt"].toObject();
  const bool sourceAttempt = receipt["state"] == "running" &&
                             receipt["attemptId"].toString() == activeAttempt &&
                             receipt["jobId"].toString() == active &&
                             receipt["executionRevision"].toString() == activeRevision;
  QString researchId;
  for (const auto& value : store->read("docs"))
    if (value.toObject()["collectionId"] == active &&
        (!sourceAttempt ||
         (value.toObject()["sourceAttemptId"].toString() == activeAttempt &&
          value.toObject()["collectionExecutionRevision"].isString() &&
          value.toObject()["collectionExecutionRevision"].toString() == activeRevision)))
      researchId = value.toObject()["id"].toString();
  business::require(!researchId.isEmpty(), "研究资料尚未保存，不能记录入库成功");
  j["pipelineState"] = "complete";
  j["pipelineMessage"] = "已入研究资料（待核验）；不会覆盖研究页人工编辑";
  j["pipelineCompletedAt"] =
      QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
  j["autoPipeline"] = false;
  finishReceipt(j, "published", j["pipelineMessage"].toString());
  store->save("collections", j);
  permissions.remove(key(active));
  permissions.sync();
  active.clear();
  QPointer<CollectionPipeline> self(this);
  emit changed();
  if (self) QTimer::singleShot(0, this, &CollectionPipeline::tick);
}
void CollectionPipeline::failed(const QString& reason) {
  if (ending) return;
  QPointer<CollectionPipeline> self(this);
  if (active.isEmpty()) {
    suspended = true;
    timer.stop();
    lastError = "任务保存失败，调度已暂停：" + reason;
    const auto message = lastError;
    emit changed();
    if (self) emit progress({}, message);
    return;
  }
  try {
    auto j = record(active);
    int n = j["pipelineFailures"].toInt() + 1;
    if (!stillApproved(j)) return;
    j["pipelineFailures"] = n;
    j["pipelineState"] = n >= 5 ? "held" : "retry";
    j["autoPipeline"] = n < 5;
    j["pipelineMessage"] = reason.left(1500);
    if (n >= 5) finishReceipt(j, "failed", reason.left(1500));
    j["nextAttemptAt"] = QDateTime::currentDateTimeUtc()
                             .addSecs(qMin(3600, 60 * (1 << qMin(n - 1, 6))))
                             .toString(Qt::ISODateWithMs);
    store->save("collections", j);
    if (n >= 5) {
      permissions.remove(key(active));
      permissions.sync();
    }
  } catch (...) {
    suspended = true;
    timer.stop();
    lastError = "任务状态保存失败，自动调度已暂停；请检查存储后主动重试";
  }
  active.clear();
  emit changed();
  if (self) QTimer::singleShot(0, this, &CollectionPipeline::tick);
}
void CollectionPipeline::cancel(
    const QString& id, const std::optional<QString>& expectedRevision,
    const std::optional<QString>& expectedAttempt) {
  requireOwnership();
  if (expectedAttempt) {
    if (id == active) {
      if (activeAttempt != *expectedAttempt) return;
    } else if (record(id)["pipelineAttemptId"].toString() != *expectedAttempt) {
      return;
    }
  }
  if (expectedRevision) {
    // A source run owns the version it queued, not a restored replacement.
    // Active ownership is available in memory even when storage is failing.
    if (id == active) {
      if (activeRevision != *expectedRevision) return;
    } else if (record(id)["executionRevision"].toString() !=
               *expectedRevision) {
      return;
    }
  }
  // Stop work before touching disk: a full/unwritable database must never
  // prevent cancellation.
  poll.cancel();
  ending = true;
  if (id == active) {
    download.cancel();
    active.clear();
  }
  try {
    asr.cancel(id, expectedRevision);
  } catch (...) {
    suspended = true;
    timer.stop();
  }
  ending = false;
  try {
    auto j = record(id);
    if ((expectedRevision && j.value("executionRevision").toString() != *expectedRevision) ||
        (expectedAttempt && j["pipelineAttemptId"].toString() != *expectedAttempt)) {
      emit changed();
      QTimer::singleShot(0, this, &CollectionPipeline::tick);
      return;
    }
    permissions.remove(key(id));
    permissions.sync();
    j["autoPipeline"] = false;
    j["pipelineState"] = "paused";
    j["pipelineMessage"] = "用户停止；原文与已完成媒体保留";
    // Queued tasks may not have entered active yet. Bind the receipt to their
    // saved attempt; a later manual retry cannot rewrite a previous receipt.
    finishReceipt(j, "cancelled", j["pipelineMessage"].toString());
    store->save("collections", j);
  } catch (...) {
    permissions.remove(key(id));
    permissions.sync();
    suspended = true;
    timer.stop();
    lastError = "任务已停止，但停止状态未保存；自动调度暂停，请检查存储";
    emit changed();
    throw;
  }
  emit changed();
  QTimer::singleShot(0, this, &CollectionPipeline::tick);
}
void CollectionPipeline::finishReceipt(QJsonObject& job, const QString& state,
                                        const QString& message) {
  auto receipt = job["sourceTaskReceipt"].toObject();
  if (receipt["state"] != "running" || receipt["attemptId"].toString().isEmpty() ||
      receipt["attemptId"] != job["pipelineAttemptId"] ||
      receipt["jobId"] != job["id"] || !receipt["executionRevision"].isString() ||
      receipt["executionRevision"].toString() != job.value("executionRevision").toString())
    return;
  // Publishing the document and saving queue metadata are separate commits.
  // A later stop/retry limit cannot erase an already committed publication;
  // an older document from the same job is not evidence for this attempt.
  QString researchId;
  for (const auto& value : store->read("docs")) {
    const auto doc = value.toObject();
    if (doc["collectionId"] == job["id"] &&
        doc["sourceAttemptId"] == receipt["attemptId"] &&
        doc["collectionExecutionRevision"].isString() &&
        doc["collectionExecutionRevision"] == receipt["executionRevision"])
      researchId = doc["id"].toString();
  }
  receipt["state"] = researchId.isEmpty() ? state : "published";
  receipt["message"] = !researchId.isEmpty() && state != "published"
                           ? "研究资料已入库；后续队列状态：" + message
                           : message;
  receipt["researchId"] = researchId;
  receipt["finishedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
  job["sourceTaskReceipt"] = receipt;
}
