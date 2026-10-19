#include "collection_runner.hpp"

#include <QCryptographicHash>
#include <QFile>
#include <QSaveFile>
#include <QStandardPaths>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

// The recognition process joins this job atomically at CreateProcess time.
// Its non-inherited handle closes even if the owning application crashes.
struct CollectionWorkerJob {
#ifdef Q_OS_WIN
  HANDLE handle = nullptr;
  STARTUPINFOEXW startup{};
  bool initialized = false;
  void prepare() {
    handle = CreateJobObjectW(nullptr, nullptr);
    business::require(handle, "无法建立本机识别进程保护，未启动识别");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    business::require(SetInformationJobObject(handle, JobObjectExtendedLimitInformation,
                                             &limits, sizeof(limits)),
                      "无法设置识别退出保护，未启动识别");
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
    business::require(bytes > 0, "无法准备识别启动保护");
    startup.lpAttributeList = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
        HeapAlloc(GetProcessHeap(), 0, bytes));
    business::require(startup.lpAttributeList, "识别启动保护内存不足");
    business::require(InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &bytes),
                      "无法初始化识别启动保护");
    initialized = true;
    business::require(UpdateProcThreadAttribute(startup.lpAttributeList, 0,
                        PROC_THREAD_ATTRIBUTE_JOB_LIST, &handle, sizeof(handle), nullptr, nullptr),
                      "当前系统不支持识别进程保护，未启动识别");
  }
  void modify(QProcess::CreateProcessArguments* args) {
    startup.StartupInfo = *args->startupInfo; // Preserve Qt's standard IO pipes.
    startup.StartupInfo.cb = sizeof(startup);
    args->startupInfo = &startup.StartupInfo;
    args->flags |= EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW;
  }
  ~CollectionWorkerJob() {
    if (initialized) DeleteProcThreadAttributeList(startup.lpAttributeList);
    if (startup.lpAttributeList) HeapFree(GetProcessHeap(), 0, startup.lpAttributeList);
    if (handle) CloseHandle(handle);
  }
#endif
};
namespace {
QJsonObject findJob(const std::shared_ptr<BusinessStore>& store,
                    const QString& id) {
  for (auto v : store->read("collections"))
    if (v.toObject()["id"] == id) return v.toObject();
  throw std::runtime_error("采集记录不存在");
}
}  // namespace
CollectionRunner::CollectionRunner(std::shared_ptr<BusinessStore> s, QObject* p)
    : QObject(p), store(std::move(s)) {
  Q_INIT_RESOURCE(asr);
  const QFileInfo db(store->filePath());
  const auto path = db.canonicalFilePath();
  queueLock = std::make_unique<QLockFile>(
      (path.isEmpty() ? db.absoluteFilePath() : path) + ".collection.lock");
  queueLock->setStaleLockTime(0);
  tryAcquireQueue();
  timeout.setSingleShot(true);
  timeout.setInterval(30 * 60 * 1000);
  connect(&timeout, &QTimer::timeout, this, [this] {
    failure = "转写超过30分钟，已停止；可拆分媒体后重试";
    process.kill();
  });
  connect(&process, &QProcess::readyReadStandardOutput, this, [this] {
    output += process.readAllStandardOutput();
    if (output.size() > 8 * 1024 * 1024) {
      failure = "识别输出超过8MiB限制";
      process.kill();
    }
  });
  connect(&process, &QProcess::readyReadStandardError, this, [this] {
    auto chunk = process.readAllStandardError();
    errors = (errors + chunk).right(8192);
    progressBuffer += chunk;
    while (progressBuffer.contains('\n')) {
      int n = progressBuffer.indexOf('\n');
      auto line = progressBuffer.left(n);
      progressBuffer.remove(0, n + 1);
      if (line.startsWith("ASR_PROGRESS ")) {
        auto m = QJsonDocument::fromJson(line.mid(13))
                     .object()["message"]
                     .toString();
        if (!m.isEmpty()) emit progress(active, m.left(300));
      }
    }
    progressBuffer = progressBuffer.right(8192);
  });
  connect(&process, &QProcess::finished, this, &CollectionRunner::finish);
  connect(&process, &QProcess::errorOccurred, this,
          [this](QProcess::ProcessError e) {
            if (e == QProcess::FailedToStart) {
              failure = "无法启动本机识别引擎：" + process.errorString();
              finish(-1, QProcess::CrashExit);
            }
          });
}
QString CollectionRunner::ownershipMessage() const {
  if (ownsQueue()) return {};
  return queueLock->error() == QLockFile::LockFailedError
      ? "此数据目录的采集队列由另一原生窗口管理；当前只读。关闭该窗口后，可点击重试接管。旧版程序不参与此保护。"
      : "无法取得采集队列锁，当前只读；请检查数据目录写入权限后重试接管。";
}
void CollectionRunner::requireOwnership() const {
  business::require(ownsQueue(), ownershipMessage());
}
bool CollectionRunner::tryAcquireQueue() {
  if (ownsQueue()) return true;
  if (!queueLock->tryLock(0)) return false;
  try {
    // Only the owner may classify abandoned work as interrupted.
    for (auto v : store->read("collections")) {
      auto j = v.toObject();
      const auto state = j["status"].toString();
      if (state == "running" || state == "queued")
        setStatus(j["id"].toString(), "interrupted",
                  "上次退出时任务未完成；请手动重试");
    }
  } catch (...) {
    queueLock->unlock();
    throw;
  }
  return true;
}
CollectionRunner::~CollectionRunner() {
  shuttingDown = true;
  timeout.stop();
  disconnect(&process, nullptr, this, nullptr);
  if (process.state() != QProcess::NotRunning) {
    process.kill();
    process.waitForFinished(1500);
  }
  try {
    if (!active.isEmpty() &&
        findJob(store, active)["executionRevision"].toString() ==
            activeRevision)
      setStatus(active, "interrupted", "程序退出；结果未提交，可手动重试");
    for (const auto& j : queue)
      if (findJob(store, j.id)["executionRevision"].toString() == j.revision)
        setStatus(j.id, "interrupted", "程序退出；排队任务未启动");
  } catch (...) {
  }
}
void CollectionRunner::setStatus(const QString& id, const QString& state,
                                 const QString& error) {
  auto j = findJob(store, id);
  j["status"] = state;
  j["error"] = error;
  store->save("collections", j);
}
void CollectionRunner::enqueue(const QString& id, const QString& python,
                               const QString& model,
                               const std::optional<QString>& expectedPipelineAttempt) {
  requireOwnership();
  auto j = findJob(store, id);
  business::require(!j["rightsBasis"].toString().trimmed().isEmpty(),
                    "请先填写本机媒体的授权依据");
  business::require(
      QFileInfo(python).isFile() && QFileInfo(python).isAbsolute(),
      "请指定已有的Python识别引擎文件");
  business::require(
      QFileInfo(model + "/model.bin").isFile() && QFileInfo(model).isAbsolute(),
      "请指定已下载的faster-whisper模型目录");
  business::require(QFileInfo(j["assetPath"].toString()).isFile(),
                    "本机媒体不存在；请重新选择，不自动下载");
  business::require(id != active, "该任务正在执行");
  for (const auto& entry : queue)
    business::require(entry.id != id, "该任务已在队列中");
  if (expectedPipelineAttempt) {
    business::require(j["autoPipeline"].toBool() &&
                          j["pipelineAttemptId"].toString() == *expectedPipelineAttempt,
                      "自动转写尝试已失配，未执行");
  } else {
    business::require(!j["autoPipeline"].toBool(),
                      "该任务自动流程仍已启用，请先停止，再主动仅转写");
    auto receipt = j["sourceTaskReceipt"].toObject();
    if (receipt["state"] == "running") {
      receipt["state"] = "interrupted";
      receipt["message"] = "后续主动转写已与原来源轮次分开";
      receipt["finishedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
      j["sourceTaskReceipt"] = receipt;
    }
    j["pipelineAttemptId"] = QUuid::createUuid().toString(QUuid::WithoutBraces);
    j["pipelineState"] = "manual";
    j["pipelineMessage"] = "仅转写：不会计入原来源轮次自动入库";
  }
  j["status"] = "queued";
  j["error"] = "";
  store->save("collections", j);
  queue.append({id, python, model, j["executionRevision"].toString()});
  emit changed();
  if (active.isEmpty()) startNext();
}
void CollectionRunner::cancel(const QString& id,
                              const std::optional<QString>& expectedRevision) {
  requireOwnership();
  if (id == active) {
    if (expectedRevision && *expectedRevision != activeRevision) return;
    cancelling = true;
    process.kill();
    return;
  }
  for (int i = queue.size() - 1; i >= 0; i--)
    if (queue[i].id == id &&
        (!expectedRevision || queue[i].revision == *expectedRevision)) {
      auto revision = queue[i].revision;
      queue.removeAt(i);
      if (findJob(store, id)["executionRevision"].toString() == revision)
        setStatus(id, "cancelled", "用户取消排队");
      emit changed();
    }
}
void CollectionRunner::startNext() {
  if (queue.isEmpty() || !active.isEmpty() || shuttingDown) return;
  auto job = queue.takeFirst();
  active = job.id;
  activeRevision = job.revision;
  output.clear();
  errors.clear();
  progressBuffer.clear();
  failure.clear();
  cancelling = false;
  try {
    auto j = findJob(store, job.id);
    if (j["executionRevision"].toString() != activeRevision) {
      active.clear();
      emit changed();
      QTimer::singleShot(0, this, [this] { startNext(); });
      return;
    }
    QString root =
        QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) +
        "/asr-worker";
    business::require(QDir().mkpath(root), "无法创建本机识别工作目录");
    QFile source(":/transcribe.py");
    business::require(source.open(QIODevice::ReadOnly), "包内识别脚本缺失");
    QSaveFile script(root + "/transcribe.py");
    business::require(script.open(QIODevice::WriteOnly), "无法保存识别脚本");
    auto content = source.readAll();
    business::require(
        script.write(content) == content.size() && script.commit(),
        "识别脚本保存失败");
    auto env = QProcessEnvironment::systemEnvironment();
    env.insert("PYTHONUTF8", "1");
    env.insert("HF_HUB_OFFLINE", "1");
    env.insert("TRANSFORMERS_OFFLINE", "1");
    process.setProcessEnvironment(env);
    process.setWorkingDirectory(root);
#ifdef Q_OS_WIN
    if (!workerJob) {
      auto guard = std::make_unique<CollectionWorkerJob>();
      guard->prepare();
      workerJob = std::move(guard);
      process.setCreateProcessArgumentsModifier(
          [this](QProcess::CreateProcessArguments* args) { workerJob->modify(args); });
    }
#endif
    setStatus(job.id, "running");
    emit changed();
    timeout.start();
    process.start(job.python, {"-X", "utf8", root + "/transcribe.py", "--media",
                               j["assetPath"].toString(), "--model-root", root,
                               "--model-source", job.model, "--model",
                               QFileInfo(job.model).fileName()});
  } catch (const std::exception& e) {
    failure = e.what();
    finish(-1, QProcess::CrashExit);
  }
}
QJsonObject CollectionRunner::decode(const QByteArray& bytes) {
  business::require(bytes.size() <= 8 * 1024 * 1024, "识别输出过大");
  QJsonParseError e;
  auto d = QJsonDocument::fromJson(bytes, &e);
  business::require(e.error == QJsonParseError::NoError && d.isObject(),
                    "识别引擎未返回有效JSON");
  auto o = d.object();
  auto text = o["transcript"].toString();
  business::require(!text.trimmed().isEmpty() && text.size() <= 600000,
                    "没有识别到有效语音或文稿超长；需人工检查");
  double duration = o["durationSeconds"].toDouble(-1);
  business::require(std::isfinite(duration) && duration > 0 &&
                        o["segments"].isArray() &&
                        !o["segments"].toArray().isEmpty(),
                    "识别结果缺少时长或分段");
  double last = 0;
  QString joined;
  for (auto v : o["segments"].toArray()) {
    auto segment = v.toObject();
    double a = segment["start"].toDouble(-1), b = segment["end"].toDouble(-1);
    business::require(std::isfinite(a) && std::isfinite(b) && a >= last &&
                          b >= a && b <= duration + 1 &&
                          !segment["text"].toString().isEmpty(),
                      "识别分段时间或正文无效");
    last = b;
    joined += segment["text"].toString();
  }
  business::require(joined == text, "分段与全文不一致");
  return o;
}
void CollectionRunner::finish(int code, QProcess::ExitStatus status) {
  if (active.isEmpty()) return;
  timeout.stop();
  auto id = active;
  output += process.readAllStandardOutput();
  errors = (errors + process.readAllStandardError()).right(8192);
#ifdef Q_OS_WIN
  process.setCreateProcessArgumentsModifier({});
  workerJob.reset(); // Also stop any descendants of this completed/cancelled run.
#endif
  try {
    if (findJob(store, id)["executionRevision"].toString() != activeRevision) {
      active.clear();
      emit changed();
      QTimer::singleShot(0, this, [this] { startNext(); });
      return;
    }
    if (cancelling)
      setStatus(id, "cancelled", "用户停止；原文和旧结果未覆盖");
    else if (code != 0 || status != QProcess::NormalExit || !failure.isEmpty())
      setStatus(
          id, "failed",
          failure.isEmpty() ? QString::fromUtf8(errors).right(1500) : failure);
    else {
      auto result = decode(output), j = findJob(store, id);
      j["asrResult"] = result;
      j["asrText"] = result["transcript"];
      j["status"] = "completed";
      j["error"] = "";
      if (j["originalText"].toString().isEmpty())
        j["originalText"] = result["transcript"];
      if (j["text"].toString().isEmpty()) j["text"] = result["transcript"];
      j["verification"] = "unverified";
      store->save("collections", j);
    }
  } catch (const std::exception& e) {
    try {
      setStatus(id, "failed", QString::fromUtf8(e.what()));
    } catch (...) {
    }
  }
  active.clear();
  emit changed();
  QTimer::singleShot(0, this, [this] { startNext(); });
}
QJsonObject publishCollection(std::shared_ptr<BusinessStore> store,
                              const QString& id, const QJsonObject& sourceReceipt) {
  const auto job = findJob(store, id);
  business::require(!job["text"].toString().trimmed().isEmpty(),
                    "没有可入库的校对文稿");
  if (!sourceReceipt.isEmpty()) {
    business::require(sourceReceipt == job["sourceTaskReceipt"].toObject() &&
                          sourceReceipt["state"] == "running" &&
                          sourceReceipt["jobId"] == id &&
                          !sourceReceipt["attemptId"].toString().isEmpty() &&
                          sourceReceipt["attemptId"] == job["pipelineAttemptId"] &&
                          sourceReceipt["executionRevision"].isString() &&
                          sourceReceipt["executionRevision"].toString() ==
                              job["executionRevision"].toString() &&
                          job["autoPipeline"].toBool(),
                      "来源入库回执已失配，不发布替换任务");
  }
  QString docId =
      "collection:" +
      QString::fromLatin1(
          QCryptographicHash::hash(id.toUtf8(), QCryptographicHash::Sha256)
              .toHex())
          .left(40);
  for (auto d : store->read("docs"))
    business::require(d.toObject()["id"] != docId,
                      "已入研究资料；后续请到研究页编辑，避免覆盖人工修改");
  QJsonObject doc{{"id", docId},
                  {"title", job["title"]},
                  {"text", job["text"]},
                  {"sourceUrl", job["sourceUrl"].toString()},
                  {"verification", "unverified"},
                  {"qualitySnapshot",collectionQuality::evaluate(job)},
                  {"collectionId", id},
                  {"sourceRootId", job["sourceRootId"].toString()},
                  {"sourceFingerprint", job["sourceFingerprint"].toString()},
                  {"sourceRevisionKind", job["sourceRevisionKind"].toString()},
                  {"sourceRevisionAt", job["sourceRevisionAt"].toString()},
                  {"publishedAt", job["publishedAt"]},
                  {"originalText", job["originalText"]}};
  if (!sourceReceipt.isEmpty()) {
    doc["sourceAttemptId"] = sourceReceipt["attemptId"];
    doc["collectionExecutionRevision"] = sourceReceipt["executionRevision"];
  }
  return store->commitCollectionPublication(job, doc);
}
