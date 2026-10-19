#include "source_page.hpp"
#include "collection_engine_config.hpp"
SourcePage::SourcePage(std::shared_ptr<BusinessStore> s, CollectionPipeline* p,
                       QWidget* parent, SourceBrowser* b)
    : QWidget(parent),
      store(s),
      pipeline(p),
      browser(b ? b : new SourceBrowser(this)) {
  setObjectName("sourceCollectionPage");
  auto root = new QVBoxLayout(this);
  auto form = new QFormLayout;
  root->addLayout(form);
  profileUrl = new QLineEdit(settings.value("sources/profile").toString());
  profileUrl->setObjectName("sourceProfileUrl");
  profileUrl->setPlaceholderText("https://www.douyin.com/user/作者身份");
  rights = new QLineEdit(settings.value("sources/rights").toString());
  rights->setObjectName("sourceRights");
  form->addRow("作者主页", profileUrl);
  form->addRow("处理授权依据", rights);
  auto bar = new QHBoxLayout;
  root->addLayout(bar);
  auto open = new QPushButton("打开来源 / 自行登录"),
       inspect = new QPushButton("核对来源条件"),
       run = new QPushButton("发现→下载→转写→入库"),
       cancel = new QPushButton("停止本轮及后续计划");
  open->setObjectName("openSourceSession");
  inspect->setObjectName("inspectSourceReadiness");
  run->setObjectName("startSourceCollection");
  cancel->setObjectName("stopSourceCollection");
  for (auto button : {open, inspect, run, cancel}) bar->addWidget(button);
  connect(inspect, &QPushButton::clicked, this, [this] {
    try {
      business::require(phase.isEmpty() && planTicket.isEmpty() && isReady && SourceBrowser::allowed(browser->source()),
                        "请先打开官方页面；来源诊断不启动采集");
      expectedProfile = sourceCapture::profile(profileUrl->text().trimmed());
      phase = "diagnostic"; deadline.start(16000); browser->capture();
    } catch (const std::exception& e) { status->setText(e.what()); }
  });
  limit = new QSpinBox;
  limit->setRange(1, 50);
  limit->setValue(20);
  limit->setSuffix(" 条/轮");
  bar->addWidget(limit);
  minutes = new QSpinBox;
  minutes->setRange(10, 1440);
  minutes->setValue(30);
  minutes->setSuffix(" 分钟");
  bar->addWidget(minutes);
  scheduled = new QCheckBox("本次运行定时采集");
  bar->addWidget(scheduled);
  status = new QLabel(
      "请本人完成平台登录与验证码。采集范围为已加载作品；新任务需授权，定时计划默认关闭。");
  status->setWordWrap(true);
  status->setObjectName("sourceCollectionState");
  root->addWidget(status);
  auto inventoryBar = new QHBoxLayout;
  discoverySummary = new QLabel("尚未载入已发现作品；任务不会自动启动");
  discoverySummary->setObjectName("sourceDiscoverySummary");
  discoverySummary->setWordWrap(true);
  auto showDiscovery = new QPushButton("查看已发现目录"), showRun = new QPushButton("查看本轮");
  showDiscovery->setObjectName("showSourceDiscovery");
  inventoryBar->addWidget(discoverySummary, 1);
  inventoryBar->addWidget(showDiscovery); inventoryBar->addWidget(showRun);
  root->addLayout(inventoryBar);
  auto split = new QSplitter;
  root->addWidget(split, 1);
  split->addWidget(browser);
  rows = new QTableWidget(0, 4);
  rows->setObjectName("sourceRunRows");
  rows->setHorizontalHeaderLabels({"作品", "发布时间", "阶段", "结果"});
  rows->setEditTriggers(QAbstractItemView::NoEditTriggers);
  rows->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
  rows->horizontalHeader()->setSectionResizeMode(3, QHeaderView::Stretch);
  resultPages = new QStackedWidget;
  resultPages->addWidget(rows);
  auto inventoryPage = new QWidget;
  auto inventoryLayout = new QVBoxLayout(inventoryPage);
  discoveryRows = new QTableWidget(0, 4);
  discoveryRows->setObjectName("sourceDiscoveryRows");
  discoveryRows->setHorizontalHeaderLabels({"作品 / 公开地址", "首次发现", "最近发现", "本机目录状态"});
  discoveryRows->setEditTriggers(QAbstractItemView::NoEditTriggers);
  discoveryRows->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
  discoveryRows->horizontalHeader()->setSectionResizeMode(3, QHeaderView::Stretch);
  inventoryLayout->addWidget(discoveryRows);
  auto paging = new QHBoxLayout;
  discoveryPrevious = new QPushButton("上一页"); discoveryNext = new QPushButton("下一页");
  discoveryPrevious->setObjectName("previousSourceDiscovery"); discoveryNext->setObjectName("nextSourceDiscovery");
  paging->addWidget(discoveryPrevious); paging->addWidget(discoveryNext);
  inventoryLayout->addLayout(paging);
  resultPages->addWidget(inventoryPage);
  split->addWidget(resultPages);
  split->setSizes({800, 480});
  deadline.setSingleShot(true);
  repeat.setSingleShot(true);
  captureDelay.setSingleShot(true);
  connect(&captureDelay, &QTimer::timeout, this, [this] {
    if ((phase == "profile" || phase == "detail") && deadline.isActive()) browser->capture();
  });
  connect(open, &QPushButton::clicked, this, [this] {
    emit manualModeRequested();
    prepare(false);
  });
  connect(run, &QPushButton::clicked, this, [this] {
    emit manualModeRequested();
    prepare(true);
  });
  connect(cancel, &QPushButton::clicked, this, &SourcePage::stop);
  connect(showDiscovery, &QPushButton::clicked, this, [this] {
    discoveryOffset = 0; refreshDiscovery(); resultPages->setCurrentIndex(1); browser->hide();
  });
  connect(showRun, &QPushButton::clicked, this, [this] { resultPages->setCurrentIndex(0); browser->show(); });
  connect(discoveryPrevious, &QPushButton::clicked, this, [this] {
    discoveryOffset = qMax(0, discoveryOffset - 50); refreshDiscovery();
  });
  connect(discoveryNext, &QPushButton::clicked, this, [this] {
    discoveryOffset += 50; refreshDiscovery();
  });
  connect(profileUrl, &QLineEdit::editingFinished, this, [this] {
    discoveryOffset = 0; refreshDiscovery();
  });
  connect(scheduled, &QCheckBox::toggled, this, [this](bool enabled) {
    if (!enabled)
      repeat.stop();
    else if (phase.isEmpty())
      repeat.start(minutes->value() * 60000);
  });
  connect(&repeat, &QTimer::timeout, this, [this] { prepare(true); });
  connect(&deadline, &QTimer::timeout, this,
          [this] { fail("来源加载/读取超时；本轮未完成，旧资料保留"); });
  connect(browser, &SourceBrowser::ready, this, [this] {
    isReady = true;
    if (phase == "initializing")
      begin();
    else if (phase == "opening") {
      phase.clear();
      deadline.stop();
      browser->navigate(QUrl(expectedProfile));
    }
  });
  connect(browser, &SourceBrowser::failure, this, &SourcePage::fail);
  connect(browser, &SourceBrowser::loaded, this,
          [this](QUrl url, bool success) {
            if (phase != "profile" && phase != "detail") return;
            if (!success) {
              fail("平台页面未加载成功；未将空数据入库");
              return;
            }
            if (url.toString(QUrl::RemoveQuery | QUrl::RemoveFragment)
                    .remove(QRegularExpression("/$")) != expectedUrl) {
              fail("采集中页面切换到其他来源，已暂停");
              return;
            }
            captureDelay.start(2500);
          });
  connect(browser, &SourceBrowser::snapshot, this, &SourcePage::consume);
  refreshDiscovery();
}
SourcePage::~SourcePage() {
  // QWidget closes the focused editor after derived members are destroyed.
  // Disconnect first so editingFinished cannot read the released directory.
  for (auto* child : findChildren<QObject*>()) QObject::disconnect(child, nullptr, this, nullptr);
  deadline.stop(); repeat.stop(); captureDelay.stop(); browser->stop();
}
SourceDiscovery& SourcePage::discoveryStore() {
  if (!discovery) discovery = std::make_unique<SourceDiscovery>(store->filePath() + ".source-discovery.sqlite");
  return *discovery;
}
void SourcePage::refreshDiscovery() {
  try {
    const auto author = sourceCapture::profile(profileUrl->text().trimmed());
    QJsonObject counts{{"total", 0}, {"pending", 0}}; QJsonArray values;
    if (QFileInfo::exists(store->filePath() + ".source-discovery.sqlite")) {
      auto& inventory = discoveryStore(); counts = inventory.counts(author);
      discoveryOffset = qMin(discoveryOffset, qMax(0, ((counts["total"].toInt() - 1) / 50) * 50));
      values = inventory.page(author, discoveryOffset);
    }
    QJsonArray bindings;
    for (auto value : values) {
      auto row = value.toObject();
      if (row["state"] == "detail_saved") bindings.append(QJsonObject{
          {"collectionId", row["collectionId"]}, {"executionRevision", row["executionRevision"]}});
    }
    QMap<QString, QString> currentStates;
    for (auto value : taskReadout(bindings)) {
      auto row = value.toObject(); currentStates[row["collectionId"].toString()] = row["currentState"].toString();
    }
    discoveryRows->setRowCount(values.size());
    for (int row = 0; row < values.size(); ++row) {
      const auto value = values[row].toObject();
      auto time = [&](const QString& key) {
        return QDateTime::fromMSecsSinceEpoch(qint64(value[key].toDouble())).toString("yyyy-MM-dd HH:mm:ss");
      };
      const QString title = value["title"].toString().isEmpty() ? value["contentId"].toString() : value["title"].toString();
      QStringList cells{title + "\n" + value["sourceUrl"].toString(), time("firstSeenAt"), time("lastSeenAt"),
                        value["state"] == "pending_detail" ? QString("待详情核对；需明确运行") :
                            QString("详情已保存；") + currentStates.value(value["collectionId"].toString())};
      for (int col = 0; col < cells.size(); ++col) discoveryRows->setItem(row, col, new QTableWidgetItem(cells[col]));
      discoveryRows->item(row, 0)->setToolTip(cells[0]);
    }
    discoveryPrevious->setEnabled(discoveryOffset > 0);
    discoveryNext->setEnabled(discoveryOffset + values.size() < counts["total"].toInt());
    discoverySummary->setText(QString("本机已发现%1条，待核对%2条；第%3–%4条。发现时间不是发布时间；目录单独本机保存，不在业务备份中，不携带执行许可。")
        .arg(counts["total"].toInt()).arg(counts["pending"].toInt())
        .arg(values.isEmpty() ? 0 : discoveryOffset + 1).arg(discoveryOffset + values.size()));
  } catch (const std::exception& e) {
    discoverySummary->setText("目录未更新，保留此前显示；" + QString::fromUtf8(e.what()));
    discoveryPrevious->setEnabled(false); discoveryNext->setEnabled(false);
  }
}
void SourcePage::setPlanScheduling(bool enabled) {
  if (enabled) {
    scheduled->setChecked(false);
    repeat.stop();
  }
  scheduled->setEnabled(!enabled);
}
void SourcePage::runPlan(const QJsonObject& plan, const QString& ticket,
                         ItemRecorder recorder) {
  business::require(!busy() && !ticket.isEmpty(),
                    "来源正在使用，未启动作者计划");
  runContentType=sourceCapture::contentType(plan["contentType"]);
  scheduled->setChecked(false);
  repeat.stop();
  profileUrl->setText(plan["profileUrl"].toString());
  rights->setText(plan["rightsBasis"].toString());
  limit->setValue(plan["limit"].toInt());
  planTicket = ticket;
  itemRecorder = std::move(recorder);
  prepare(true);
}
void SourcePage::retryJob(const QJsonObject& expected) {
  pipeline->requireOwnership();
  business::require(!busy(), "来源正在使用，请先停止本轮再重试作品");
  business::require(!expected["id"].toString().isEmpty() &&
      BusinessStore::readRecord(store->filePath(), "collections", expected["id"].toString()) == expected,
      "作品已修改或删除，请重新选择，未开始重试");
  business::require(!expected["autoPipeline"].toBool() &&
      !QStringList{"queued","downloading","transcribing","publishing"}.contains(expected["pipelineState"].toString()) &&
      !QStringList{"running","queued"}.contains(expected["status"].toString()), "作品仍在执行，请先停止任务");
  for (auto key : {"assetPath", "text", "originalText", "asrText", "sourceRootId"})
    business::require(expected[key].toString().isEmpty(), "已有媒体、文稿或来源版本，未覆盖重试");
  const auto author = sourceCapture::profile(expected["sourceProfile"].toString());
  const auto id = sourceCapture::contentId(expected["sourceUrl"].toString());
  business::require(!id.isEmpty() && expected["externalContentId"] == id &&
      !expected["sourceFingerprint"].toString().isEmpty() &&
      expected["sourceFingerprint"] == sourceCapture::fingerprint(expected["sourceMetadata"].toObject()) &&
      !expected["rightsBasis"].toString().trimmed().isEmpty(), "作品来源身份或授权依据不完整，未重试");
  emit manualModeRequested();
  scheduled->setChecked(false); repeat.stop();
  profileUrl->setText(author); rights->setText(expected["rightsBasis"].toString());
  retryBaseline = expected;
  prepare(true);
}
void SourcePage::stopPlan(const QString& ticket) {
  if (!ticket.isEmpty() &&
      (planTicket == ticket || (planTicket.isEmpty() && phase.isEmpty() &&
                                completedPlanTicket == ticket)))
    stop();
}
void SourcePage::finishPlan(const QString& state, const QString& message) {
  if (planTicket.isEmpty()) return;
  auto ticket = planTicket;
  planTicket.clear();
  itemRecorder = {};
  // Source discovery can end before its download/ASR jobs. Keep the stop handle
  // until a new run replaces queuedIds; never rewrite the completed history.
  completedPlanTicket = state == "cancelled" ? QString() : ticket;
  emit planFinished(ticket, state,
                    {{"discovered", discoveredCount},
                     {"resumed", resumedCount},
                     {"processed", index},
                     {"queued", queuedIds.size()}},
                    message);
}
void SourcePage::prepare(bool run) {
  if (!phase.isEmpty()) {
    status->setText("已有来源读取进行中，请等待或停止本轮");
    return;
  }
  resultPages->setCurrentIndex(0);
  browser->show();
  if (run) {
    if(planTicket.isEmpty())runContentType="all";
    ++revision;
    completedPlanTicket.clear();
    queuedIds.clear();
    rows->setRowCount(0);
    pending = {};
    index = 0;
    discoveredCount = 0;
    resumedCount = 0;
  }
  try {
    // Source sessions share the same local profile and feed this queue. A
    // viewing window must not create another session or mutate queued work.
    pipeline->requireOwnership();
    expectedProfile = sourceCapture::profile(profileUrl->text().trimmed());
    if (run)
      business::require(!rights->text().trimmed().isEmpty(),
                        "请填写对该来源音视频的处理授权依据");
    runRights = rights->text().trimmed();
    settings.setValue("sources/profile", expectedProfile);
    settings.setValue("sources/rights", runRights);
    settings.sync();
    business::require(settings.status() == QSettings::NoError,
                      "来源设置保存失败");
    browser->setCollectionActive(run);
    if (!initialized) {
      initialized = true;
      phase = run ? "initializing" : "opening";
      deadline.start(30000);
      browser->initialize(QStandardPaths::writableLocation(
                              QStandardPaths::AppLocalDataLocation) +
                          "/platform-session/douyin");
      return;
    }
    business::require(isReady, "来源引擎尚未就绪；失败时可关闭并重新打开程序");
    if (run)
      begin();
    else
      browser->navigate(QUrl(expectedProfile));
  } catch (const std::exception& e) {
    fail(QString::fromUtf8(e.what()));
  }
}
void SourcePage::begin() {
  if (!retryBaseline.isEmpty()) {
    pending = QJsonArray{QJsonObject{{"contentId", retryBaseline["externalContentId"]}, {"sourceUrl", retryBaseline["sourceUrl"]}}};
    rows->setRowCount(1);
    for (int col = 0; col < 4; ++col) rows->setItem(0, col, new QTableWidgetItem());
    rows->item(0, 0)->setText(retryBaseline["title"].toString());
    status->setText("重新核对该作品的当前下载地址；仅重试这条空任务，不覆盖已有文稿");
    next(); return;
  }
  phase = "profile";
  expectedUrl = expectedProfile;
  deadline.start(30000);
  status->setText("读取作者主页已加载作品→逐项核对详情；不使用旧账号会话");
  browser->navigate(QUrl(expectedProfile));
}
void SourcePage::consume(QJsonObject page) {
  if (phase.isEmpty()) return;
  captureDelay.stop();
  try {
    auto inspectedWork = phase == "detail" && index < pending.size()
        ? pending[index].toObject()["contentId"].toString() : sourceCapture::contentId(page["pageUrl"].toString());
    diagnostic = sourceCapture::readiness(page, expectedProfile, inspectedWork);
    diagnostic["checkedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
    if (phase == "detail" && deadline.isActive() &&
        sourceCapture::detailStillLoading(page, expectedProfile, inspectedWork)) {
      status->setText("正在等待当前作品详情加载；不会重新登录或重载页面");
      captureDelay.start(1000);
      return; // Keep the original 30-second deadline; polling cannot extend it.
    }
    deadline.stop();
    if (phase == "diagnostic") {
      phase.clear();
      status->setText(diagnostic["nextStep"].toString() + "（只读诊断，未启动下载/转写）\n页面结构：" +
          QString::fromUtf8(QJsonDocument(page["structure"].toObject()).toJson(QJsonDocument::Compact)));
      return;
    }
    pipeline->requireOwnership();
    if (phase == "profile") {
      auto all = sourceCapture::profileItems(page, expectedProfile);
      discoveredCount = all.size();
      auto& inventory = discoveryStore();
      inventory.observe(expectedProfile, all, QDateTime::currentMSecsSinceEpoch());
      QSet<QString> visibleIds;
      QJsonArray candidates = all;
      for (auto value : all) visibleIds.insert(value.toObject()["contentId"].toString());
      for (auto value : inventory.pending(expectedProfile))
        if (!visibleIds.contains(value.toObject()["contentId"].toString())) candidates.append(value);
      const auto selection = sourceCapture::selectDetails(
          candidates, store->read("collections"), limit->value(),runContentType);
      pending = selection.items;
      QStringList ids;
      for (auto value : pending) ids << value.toObject()["contentId"].toString();
      QMap<QString, QJsonObject> entries;
      for (auto value : inventory.entries(expectedProfile, ids)) {
        auto row = value.toObject(); entries[row["contentId"].toString()] = row;
      }
      for (int n = 0; n < pending.size(); ++n) {
        auto item = pending[n].toObject(); auto id = item["contentId"].toString();
        business::require(entries.contains(id), "选定作品的发现目录绑定缺失；未开始详情");
        item["observationRevision"] = entries[id]["observationRevision"];
        item["sourceUrl"] = entries[id]["sourceUrl"];
        pending[n] = item;
        if (!visibleIds.contains(id)) ++resumedCount;
      }
      rows->setRowCount(pending.size());
      for (int n = 0; n < pending.size(); n++) {
        auto item = pending[n].toObject();
        for (int col = 0; col < 4; col++)
          rows->setItem(n, col, new QTableWidgetItem());
        rows->item(n, 0)->setText(item["title"].toString().isEmpty()
                                      ? item["contentId"].toString()
                                      : item["title"].toString());
        rows->item(n, 2)->setText("待详情");
      }
      status->setText(
          QString("本页发现%1条；本轮核对%2条（含本机续办%5条），暂停/失败/队列保护跳过%3条，"
                  "另%4条候选未选；未取得详情项已保留本机待核对目录。旧作品按最后成功检查轮转。"
                  "来源文字变化保存独立版本；发现总数不等于已保存详情，不代表全历史覆盖。")
              .arg(all.size())
              .arg(pending.size())
              .arg(selection.heldCount)
              .arg(selection.deferredCount).arg(resumedCount)+
          QString("\n本轮采集内容：%1；按类型排除%2条，未删除原记录。")
              .arg(sourceCapture::contentTypeName(runContentType)).arg(selection.filteredCount));
      refreshDiscovery();
      next();
      return;
    }
    if (phase != "detail" || index >= pending.size()) return;
    auto item = pending[index].toObject();
    sourceCapture::available(page);
    QJsonObject detail;int matches=0;
    for(auto value:page["items"].toArray())if(value.toObject()["contentId"]==item["contentId"]){detail=value.toObject();++matches;}
    business::require(matches==1,"当前作品详情身份缺失或重复，未保存");
    const auto detailType=sourceCapture::mediaKind(detail);
    business::require(runContentType=="all" || detailType==runContentType,
                      "当前作品详情类型与作者计划不符；未保存或排队，请核对来源类型");
    const bool explicitRetry = !retryBaseline.isEmpty();
    if (explicitRetry) {
      business::require(BusinessStore::readRecord(store->filePath(), "collections", retryBaseline["id"].toString()) == retryBaseline,
                        "读取期间作品已修改或删除，未更新或重启");
      business::require(diagnostic["state"] == "bound_media_observed",
                        diagnostic["nextStep"].toString() + "；未重试");
      QJsonObject metadata;
      for (auto value : page["items"].toArray())
        if (value.toObject()["contentId"] == item["contentId"]) metadata = value.toObject();
      business::require(sourceCapture::fingerprint(metadata) == retryBaseline["sourceFingerprint"].toString(),
                        "来源文字已变更，未用重试覆盖旧作品，请先核对内容");
    }
    QSet<QString> priorIds;
    for (auto value : store->read("collections"))
      priorIds.insert(value.toObject()["id"].toString());
    auto job = sourceCapture::mergeDetail(
        *store, page, expectedProfile, item["contentId"].toString(), runRights);
    business::require(explicitRetry || discoveryStore().acknowledge(expectedProfile, item["contentId"].toString(),
                          item["observationRevision"].toInt(), job["id"].toString(),
                          job["executionRevision"].toString(), QDateTime::currentMSecsSinceEpoch()),
                      "详情已保存但发现修订已改变；下游未确认，请到任务页核对");
    bool existed = priorIds.contains(job["id"].toString());
    const auto attempt = !existed && !planTicket.isEmpty()
                             ? QUuid::createUuid().toString(QUuid::WithoutBraces)
                             : QString();
    if (!planTicket.isEmpty() && itemRecorder)
      itemRecorder(planTicket,
                   {{"collectionId", job["id"]},
                    {"executionRevision", job["executionRevision"].toString()},
                    {"sourceAttemptId", attempt},
                    {"contentId", item["contentId"]},
                    {"sourceUrl", job["sourceUrl"]},
                    {"title", job["title"].toString().left(1000)},
                    {"disposition", existed ? "existing" : "new"}});
    rows->item(index, 1)->setText(job["publishedAt"].toString().isEmpty()
                                      ? "源时间待核"
                                      : job["publishedAt"].toString());
    rows->item(index, 2)->setText(job["sourceRootId"].toString().isEmpty() ? "已保存详情" : "来源更新版本");
    rows->item(index, 3)->setText("媒体未提供，不能开始下载/转写");
    if (existed)
      rows->item(index, 3)->setText(
          "相同来源文字已保留；未重跑或覆盖人工稿，重试请到任务页");
    if ((!existed || explicitRetry) &&
        CollectionDownload::allowed(QUrl(job["mediaUrl"].toString()))) {
      try {
        const auto queuedAttempt = pipeline->enqueue(job["id"].toString(),
                          collectionEngineConfig::python(settings),
                          collectionEngineConfig::model(settings),
                          attempt.isEmpty() ? QJsonObject{} : QJsonObject{
                              {"attemptId", attempt}, {"sourceRunId", planTicket},
                              {"jobId", job["id"]},
                              {"executionRevision", job["executionRevision"].toString()},
                              {"contentId", item["contentId"]}});
        queuedIds.insert(job["id"].toString(),
                         {job["executionRevision"].toString(),
                          std::optional<QString>(queuedAttempt)});
        rows->item(index, 2)->setText("下游队列");
        rows->item(index, 3)->setText("下载/转写/入库状态见任务页，非已完成");
      } catch (const std::exception& e) {
        rows->item(index, 3)->setText(QString::fromUtf8(e.what()));
      }
    }
    emit recordsChanged();
    refreshDiscovery();
    ++index;
    next();
  } catch (const std::exception& e) {
    fail(QString::fromUtf8(e.what()));
  }
}
void SourcePage::next() {
  captureDelay.stop();
  if (index >= pending.size()) {
    phase.clear();
    retryBaseline = {};
    deadline.stop();
    browser->setCollectionActive(false);
    status->setText(
        status->text() +
        QString("\n本轮详情处理结束；新增排队%1条，不等于下载或转写成功。")
            .arg(queuedIds.size()));
    if (scheduled->isChecked()) repeat.start(minutes->value() * 60000);
    finishPlan("complete", status->text());
    return;
  }
  phase = "detail";
  expectedUrl = pending[index].toObject()["sourceUrl"].toString();
  deadline.start(30000);
  browser->navigate(QUrl(expectedUrl));
}
void SourcePage::fail(const QString& reason) {
  ++revision;
  phase.clear();
  retryBaseline = {};
  deadline.stop();
  captureDelay.stop();
  repeat.stop();
  scheduled->setChecked(false);
  browser->stop();
  status->setText(reason + "；已暂停来源自动计划，已保存资料保留。");
  finishPlan("failed", status->text());
}
void SourcePage::stop() {
  ++revision;
  completedPlanTicket.clear();
  phase.clear();
  retryBaseline = {};
  deadline.stop();
  captureDelay.stop();
  repeat.stop();
  scheduled->setChecked(false);
  browser->stop();
  QStringList errors;
  for (auto id : queuedIds.keys()) try {
      const auto task = queuedIds.value(id);
      pipeline->cancel(id, task.revision, task.attempt);
    } catch (const std::exception& e) {
      errors << QString::fromUtf8(e.what());
    }
  status->setText(errors.isEmpty()
                      ? "已停止本轮读取及本轮下游任务；旧媒体/文稿保留"
                      : ("来源已停止，部分下游停止失败：" + errors.join("；")));
  emit recordsChanged();
  finishPlan("cancelled", status->text());
  emit sourceStopped();
}

QJsonArray SourcePage::taskReadout(const QJsonArray& items) const {
  business::require(items.size() <= 50, "本轮明细超过50条，拒绝错误历史");
  // Read only the records bound to this run, not the entire transcript library.
  struct ReadConnection {
    QString name = QUuid::createUuid().toString();
    QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE", name);
    ~ReadConnection() { db.close(); db = {}; QSqlDatabase::removeDatabase(name); }
  } connection;
  auto& db = connection.db;
  db.setDatabaseName(store->filePath());
  db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=0");
  business::require(db.open(), db.lastError().text());
  QMap<QString, QJsonObject> jobs, docs;
  QStringList ids, marks;
  for (auto value : items) {
    auto id = value.toObject()["collectionId"].toString();
    ids << id << ("collection:" + QString::fromLatin1(
        QCryptographicHash::hash(id.toUtf8(), QCryptographicHash::Sha256).toHex()).left(40));
    marks << "?" << "?";
  }
  if (!ids.isEmpty()) {
    QSqlQuery query(db);
    query.prepare("SELECT kind,payload FROM records WHERE kind IN ('collections','docs') AND id IN (" + marks.join(',') + ")");
    for (auto id : ids) query.addBindValue(id);
    const bool selected = query.exec();
    business::require(selected, query.lastError().text());
    while (query.next()) {
      QJsonParseError error;
      auto value = QJsonDocument::fromJson(query.value(1).toByteArray(), &error);
      business::require(error.error == QJsonParseError::NoError && value.isObject(),
                        "本轮任务资料损坏");
      auto job = value.object();
      (query.value(0).toString() == "docs" ? docs : jobs)[job["id"].toString()] = job;
    }
  }
  const QMap<QString, QString> stages{{"queued", "待执行"}, {"downloading", "下载中"},
      {"transcribing", "本机识别中"}, {"publishing", "研究入库中"},
      {"complete", "任务已完成"}, {"retry", "失败后等待重试"},
      {"held", "失败已停用"}, {"paused", "已暂停"}, {"manual", "后续仅转写（非原轮次）"}};
  const QMap<QString, QString> outcomes{{"running", "本次处理中"},
      {"published", "本次已入研究资料（待核验）"}, {"failed", "本次失败"},
      {"cancelled", "本次已取消"}, {"interrupted", "本次已中断"}};
  QJsonArray result;
  for (auto value : items) {
    auto item = value.toObject();
    auto job = jobs.value(item["collectionId"].toString());
    item["canOpen"] = false;
    item["canOpenResearch"] = false;
    if (job.isEmpty()) item["currentState"] = "本机任务不存在";
    else if (job["executionRevision"].toString() != item["executionRevision"].toString())
      item["currentState"] = "已被恢复替换；不关联新任务结果";
    else {
      item["canOpen"] = true;
      item["currentState"] = stages.value(job["pipelineState"].toString(),
          job["mediaUrl"].toString().isEmpty() && job["assetPath"].toString().isEmpty()
              ? "缺媒体，未提交下游" : "未提交自动处理");
      item["currentMessage"] = job["pipelineMessage"].toString();
      auto receipt = job["sourceTaskReceipt"].toObject();
      const auto attempt = item["sourceAttemptId"].toString();
      if (!attempt.isEmpty() && receipt["attemptId"].toString() == attempt &&
          receipt["jobId"] == item["collectionId"] &&
          receipt["executionRevision"] == item["executionRevision"]) {
        auto state = receipt["state"].toString();
        auto doc = docs.value(receipt["researchId"].toString());
        const bool publishedDocumentMatches = doc["collectionId"] == item["collectionId"] &&
            doc["sourceAttemptId"].toString() == attempt &&
            doc["collectionExecutionRevision"].isString() &&
            doc["collectionExecutionRevision"] == item["executionRevision"];
        item["receiptState"] = state == "published" && !publishedDocumentMatches
                                   ? "入库回执对应资料缺失或版本失配，需核对"
                                   : outcomes.value(state, "回执状态未知，需核对");
        item["receiptMessage"] = receipt["message"];
        item["finishedAt"] = receipt["finishedAt"];
        item["researchId"] = receipt["researchId"];
        item["canOpenResearch"] = state == "published" && publishedDocumentMatches;
      } else item["receiptState"] = attempt.isEmpty() ? "已有任务仅观察，未在本轮重新提交" : "没有本次下游回执；不推断为成功";
    }
    result.append(item);
  }
  return result;
}
QJsonObject SourcePage::researchRecord(const QJsonObject& item) const {
  QJsonObject job, doc;
  for (auto value : store->read("collections"))
    if (value.toObject()["id"] == item["collectionId"]) { job = value.toObject(); break; }
  for (auto value : store->read("docs"))
    if (value.toObject()["id"] == job["sourceTaskReceipt"].toObject()["researchId"]) { doc = value.toObject(); break; }
  return sourceCapture::researchRecord(item, job, doc);
}
