#include <QTemporaryDir>
#include <QtTest>
#include <QNetworkReply>
#include <QTextStream>

#include "source_page.hpp"
#include "source_discovery.hpp"
class SourceMediaReply : public QNetworkReply {
  QByteArray data = QByteArray::fromHex("000000186674797069736f6d") + QByteArray(128, 'x');
 public:
  SourceMediaReply(const QNetworkRequest& request, QObject* parent) : QNetworkReply(parent) {
    setRequest(request); setUrl(request.url()); open(ReadOnly | Unbuffered);
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute, 200);
    setHeader(QNetworkRequest::ContentTypeHeader, "video/mp4");
    QTimer::singleShot(0, this, [this] { emit metaDataChanged(); emit readyRead(); setFinished(true); emit finished(); });
  }
  void abort() override { setError(OperationCanceledError, "cancelled"); setFinished(true); emit finished(); }
  qint64 bytesAvailable() const override { return data.size() + QNetworkReply::bytesAvailable(); }
 protected:
  qint64 readData(char* target, qint64 length) override {
    if (data.isEmpty()) return -1;
    auto count = qMin(length, qint64(data.size())); memcpy(target, data.constData(), size_t(count)); data.remove(0, count); return count;
  }
};
class SourceMediaNetwork : public QNetworkAccessManager {
 public: int requests = 0;
 protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& request, QIODevice*) override {
    ++requests; return new SourceMediaReply(request, this);
  }
};
class SourceHoldingReply : public QNetworkReply {
  bool* aborted;
 public:
  SourceHoldingReply(const QNetworkRequest& request, bool* stopped, QObject* parent)
      : QNetworkReply(parent), aborted(stopped) {
    setRequest(request); setUrl(request.url()); open(ReadOnly | Unbuffered);
  }
  void abort() override {
    *aborted = true;
    setError(OperationCanceledError, "controlled cancellation");
    setFinished(true); emit finished();
  }
 protected:
  qint64 readData(char*, qint64) override { return -1; }
};
class SourceHoldingNetwork : public QNetworkAccessManager {
 public:
  bool aborted = false;
  int requests = 0;
 protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& request, QIODevice*) override {
    ++requests;
    return new SourceHoldingReply(request, &aborted, this);
  }
};
class FakeSource : public SourceBrowser {
 public:
  QUrl current;
  bool login = true, wrongAuthor = false, stopped = false, delayedReady = false;
  bool missingDetail = false, challenge = false;
  int captures = 0;
  int detailVisits = 0, navigations = 0;
  QStringList visibleIds{"7259684447530929443"}, detailIds;
  QString title = "测试作品";
  bool media = false;
  void stop() override { stopped = true; setCollectionActive(false); }
  void initialize(const QString&) override {
    if (!delayedReady) emit ready();
  }
  void navigate(const QUrl& url) override {
    ++navigations;
    current = url;
    if (url.path().startsWith("/video")) {
      ++detailVisits;
      detailIds << sourceCapture::contentId(url.toString());
    }
    QTimer::singleShot(0, this, [this] { emit loaded(current, true); });
  }
  QUrl source() const override { return current; }
  void capture() override {
    ++captures;
    const QString profile = "https://www.douyin.com/user/abcdef";
    QJsonArray items;
    const auto capturedIds = current.path().startsWith("/user")
                                 ? visibleIds
                                 : QStringList{sourceCapture::contentId(current.toString())};
    for (const auto& id : capturedIds)
      items.append(QJsonObject{{"title", title},
                               {"sourceUrl", "https://www.douyin.com/video/" + id},
                               {"contentId", id},
                               {"publishedAt", "2025-01-02T00:00:00Z"}});
    auto page = QJsonObject{
        {"pageUrl", current.toString()},
        {"pageType", current.path().startsWith("/user") ? "profile" : "video"},
        {"loggedIn", login},
        {"verificationRequired", challenge},
        {"profile",
         QJsonObject{
             {"profileUrl",
              wrongAuthor ? "https://www.douyin.com/user/other1" : profile},
             {"displayName", "测试作者"}}},
        {"items", items}};
    if (missingDetail && !current.path().startsWith("/user")) {
      auto item = items[0].toObject(); item["title"] = "";
      page["items"] = QJsonArray{item};
    }
    if (media) {
      auto item = page["items"].toArray()[0].toObject();
      item["mediaUrl"] = "https://v3.douyinvod.com/fixture.mp4";
      item["mediaCandidates"] = QJsonArray{"https://v3.douyinvod.com/fixture.mp4", "https://v11.douyinvod.com/fixture.mp4"};
      item["mediaBinding"] = QJsonObject{{"contentId", "7259684447530929443"}, {"profileUrl", profile}, {"source", "embedded_detail"}};
      page["items"] = QJsonArray{item};
    }
    emit snapshot(page);
  }
};
class SourcePageTests : public QObject {
  Q_OBJECT
 private slots:
  void initTestCase() {
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("SourcePageTests");
  }
  void explicitRetryRefreshesOnlyUnchangedEmptyJobAndPreservesReceipt() {
    QTemporaryDir dir; QFile model(dir.filePath("model.bin")); QVERIFY(model.open(QIODevice::WriteOnly)); model.close();
    QSettings settings; settings.setValue("asr/python", QCoreApplication::applicationFilePath()); settings.setValue("asr/model", dir.path());
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    SourceHoldingNetwork network; CollectionPipeline pipeline(store, dir.filePath("media"), nullptr, &network);
    auto browser = new FakeSource; browser->media = true;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "test"}, {"limit", 1}}, "seed");
    browser->media = false; browser->capture(); browser->capture();
    auto job = store->read("collections")[0].toObject(); job["pipelineState"] = "paused";
    job["sourceTaskReceipt"] = QJsonObject{{"state", "failed"}, {"attemptId", "original-receipt"}};
    job = store->save("collections", job); browser->media = true;
    const auto before = browser->navigations;
    page.retryJob(job);
    QVERIFY(page.busy()); QCOMPARE(browser->navigations, before + 1);
    QVERIFY(browser->source().path().startsWith("/video/")); browser->capture();
    QVERIFY2(page.findChild<QTableWidget*>("sourceRunRows")->item(0, 2)->text() == "下游队列",
        qPrintable(page.findChild<QLabel*>("sourceCollectionState")->text()+" / "+page.findChild<QTableWidget*>("sourceRunRows")->item(0, 3)->text()));
    QTRY_COMPARE(network.requests, 1);
    auto result = store->read("collections")[0].toObject();
    QCOMPARE(result["id"], job["id"]); QCOMPARE(result["sourceTaskReceipt"], job["sourceTaskReceipt"]);
    QCOMPARE(result["mediaCandidates"].toArray().size(), 2); QVERIFY(result["autoPipeline"].toBool());
    page.findChild<QPushButton*>("stopSourceCollection")->click(); QVERIFY(network.aborted);
    QCOMPARE(store->read("collections")[0].toObject()["pipelineState"].toString(), QString("paused"));
    settings.remove("asr/python"); settings.remove("asr/model");
  }
  void explicitRetryRejectsLateEditsChangedSourceWrongAuthorAndCancelledSnapshot() {
    for (const auto mode : {"edit", "source-change", "wrong-author", "cancel", "existing-text", "deleted"}) {
      QTemporaryDir dir; auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
      SourceHoldingNetwork network; CollectionPipeline pipeline(store, dir.filePath("media"), nullptr, &network);
      auto browser = new FakeSource; SourcePage page(store, &pipeline, nullptr, browser);
      page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "test"}, {"limit", 1}}, "seed");
      browser->capture(); browser->capture();
      auto job = store->read("collections")[0].toObject(); job["pipelineState"] = "paused";
      if (QString(mode) == "existing-text") job["text"] = "人工稿不可覆盖";
      job = store->save("collections", job); browser->media = true;
      if (QString(mode) == "existing-text") {
        QVERIFY_EXCEPTION_THROWN(page.retryJob(job), std::runtime_error);
      } else {
        page.retryJob(job); QVERIFY(page.busy());
        if (QString(mode) == "edit") { job["title"] = "晚到人工修改"; job = store->save("collections", job); }
        if (QString(mode) == "source-change") browser->title = "来源内容已变";
        if (QString(mode) == "wrong-author") browser->wrongAuthor = true;
        if (QString(mode) == "cancel") page.findChild<QPushButton*>("stopSourceCollection")->click();
        if (QString(mode) == "deleted") {
          const auto connection = QUuid::createUuid().toString();
          { auto db = QSqlDatabase::addDatabase("QSQLITE", connection); db.setDatabaseName(store->filePath()); QVERIFY(db.open());
            QSqlQuery q(db); QVERIFY(q.exec("DELETE FROM records WHERE kind='collections'")); db.close(); }
          QSqlDatabase::removeDatabase(connection);
        }
        browser->capture();
      }
      QCOMPARE(network.requests, 0); QVERIFY(!page.busy());
      if (QString(mode) == "deleted") QVERIFY(store->read("collections").isEmpty());
      else QCOMPARE(store->read("collections")[0].toObject(), job);
    }
  }
  void loadingTitleWaitsForAnotherSnapshotWithoutReloadOrEarlyWrite() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    QSignalSpy finished(&page, &SourcePage::planFinished);
    page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "isolated"}, {"limit", 1}}, "slow-detail");
    browser->capture(); browser->missingDetail = true; browser->capture();
    QVERIFY(page.busy()); QVERIFY(!browser->stopped);
    QCOMPARE(finished.size(), 0); QVERIFY(store->read("collections").isEmpty());
    const auto requests = browser->captures;
    browser->missingDetail = false;
    QTRY_COMPARE_WITH_TIMEOUT(finished.size(), 1, 5000);
    QVERIFY(browser->captures > requests);
    QCOMPARE(browser->navigations, 2);
    QCOMPARE(finished[0][1].toString(), QString("complete"));
    QCOMPARE(store->read("collections").size(), 1);
  }
  void hiddenSourcePageKeepsRenderingOnlyDuringAnExplicitRun() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    QVERIFY(!browser->collectionActive());
    const QJsonObject plan{{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "test"}, {"limit", 1}};
    page.runPlan(plan, "hidden-complete");
    QVERIFY(!page.isVisible()); QVERIFY(browser->collectionActive());
    browser->capture(); QVERIFY(browser->collectionActive()); browser->capture();
    QVERIFY(!page.busy()); QVERIFY(!browser->collectionActive());
    page.runPlan(plan, "hidden-cancel"); QVERIFY(browser->collectionActive());
    page.findChild<QPushButton*>("stopSourceCollection")->click();
    QVERIFY(!browser->collectionActive());
    page.runPlan(plan, "hidden-failure"); QVERIFY(browser->collectionActive());
    browser->wrongAuthor = true; browser->capture();
    QVERIFY(!page.busy()); QVERIFY(!browser->collectionActive());
  }
  void waitingDetailDoesNotHideWrongAuthorOrChallenge_data() {
    QTest::addColumn<bool>("wrongAuthor");
    QTest::newRow("author-mismatch") << true;
    QTest::newRow("verification") << false;
  }
  void waitingDetailDoesNotHideWrongAuthorOrChallenge() {
    QFETCH(bool, wrongAuthor);
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "isolated"}, {"limit", 1}}, "unsafe");
    browser->capture(); browser->missingDetail = true;
    browser->wrongAuthor = wrongAuthor; browser->challenge = !wrongAuthor;
    browser->capture();
    QVERIFY(!page.busy()); QVERIFY(browser->stopped);
    QVERIFY(store->read("collections").isEmpty());
  }
  void cancellingLoadingDetailStopsPollAndRejectsLateSnapshot() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "isolated"}, {"limit", 1}}, "cancel-wait");
    browser->capture(); browser->missingDetail = true; browser->capture();
    QVERIFY(page.busy());
    page.findChild<QPushButton*>("stopSourceCollection")->click();
    const auto requests = browser->captures;
    QTest::qWait(2800); QCOMPARE(browser->captures, requests);
    browser->missingDetail = false; browser->capture();
    QVERIFY(store->read("collections").isEmpty()); QVERIFY(!page.busy());
  }
  void loadingDetailCannotExtendItsOriginalDeadline() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    QSignalSpy finished(&page, &SourcePage::planFinished);
    page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "isolated"}, {"limit", 1}}, "deadline");
    browser->capture(); browser->missingDetail = true; browser->capture();
    QVERIFY(page.busy());
    QTRY_VERIFY_WITH_TIMEOUT(!page.busy(), 32000);
    QCOMPARE(finished.size(), 1); QCOMPARE(finished[0][1].toString(), QString("failed"));
    QVERIFY(browser->stopped); QCOMPARE(browser->navigations, 2);
    QVERIFY(store->read("collections").isEmpty());
  }
  void exactResearchReadoutRefusesLateReplacement() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    SourcePage page(store, &pipeline, nullptr, new FakeSource);
    auto job = store->save("collections", {{"title", "受控身份文稿"}, {"text", "当前人工校对"}, {"status", "imported"}});
    const auto id = job.value("id").toString(), revision = job.value("executionRevision").toString();
    const auto attempt = QUuid::createUuid().toString(QUuid::WithoutBraces);
    auto receipt = QJsonObject{{"jobId", id}, {"executionRevision", revision}, {"attemptId", attempt},
        {"state", "running"}};
    job["sourceTaskReceipt"] = receipt;
    job["pipelineAttemptId"] = attempt;
    job["autoPipeline"] = true;
    store->save("collections", job);
    auto doc = publishCollection(store, id, receipt);
    receipt["state"] = "published";
    receipt["researchId"] = doc.value("id");
    job["sourceTaskReceipt"] = receipt;
    store->save("collections", job);
    const QJsonObject link{{"collectionId", id}, {"executionRevision", revision}, {"sourceAttemptId", attempt}};
    QVERIFY(page.taskReadout(QJsonArray{link})[0].toObject()["canOpenResearch"].toBool());
    const auto before = store->read("docs");
    QCOMPARE(page.researchRecord(link)["text"].toString(), QString("当前人工校对"));
    QCOMPARE(store->read("docs"), before);
    job["executionRevision"] = QJsonValue::Null;
    store->save("collections", job);
    QVERIFY_EXCEPTION_THROWN(page.researchRecord(link), std::exception);
    job["executionRevision"] = "restored-version";
    store->save("collections", job);
    QVERIFY(!page.taskReadout(QJsonArray{link})[0].toObject()["canOpenResearch"].toBool());
    QVERIFY_EXCEPTION_THROWN(page.researchRecord(link), std::exception);
    job.remove("executionRevision");
    store->save("collections", job);
    doc["sourceAttemptId"] = "restored"; store->save("docs", doc);
    QVERIFY(!page.taskReadout(QJsonArray{link})[0].toObject()["canOpenResearch"].toBool());
    QVERIFY_EXCEPTION_THROWN(page.researchRecord(link), std::exception);
  }
  void readinessInspectionDoesNotCreateCollectionOrStartPipeline() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.findChild<QLineEdit*>("sourceProfileUrl")->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QPushButton*>("openSourceSession")->click();
    const auto before = store->read("collections");
    page.findChild<QPushButton*>("inspectSourceReadiness")->click();
    QCOMPARE(page.sourceDiagnostic()["state"].toString(), QString("metadata_observed"));
    QVERIFY(!page.sourceDiagnostic()["executionPermit"].toBool());
    QCOMPARE(store->read("collections"), before);
    QVERIFY(!page.busy());
  }
  void missingTestOrganizationExplainsInitialFailure() {
    QCoreApplication::setOrganizationName("");
    QSettings invalid;
    invalid.setValue("sources/profile", "https://www.douyin.com/user/abcdef");
    invalid.sync();
    auto error = invalid.status();
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCOMPARE(error, QSettings::AccessError);
  }
  void visibleInventoryPersistsBeforeBoundedDetailAndReopensWithoutRunning() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    const QString author = "https://www.douyin.com/user/abcdef";
    SourceDiscovery inventory(store->filePath() + ".source-discovery.sqlite");
    {
      auto browser = new FakeSource;
      for (int i = 1; i < 20; ++i) browser->visibleIds << QString::number(7259684447530929443ULL + i);
      SourcePage page(store, &pipeline, nullptr, browser);
      page.runPlan({{"profileUrl", author}, {"rightsBasis", "isolated"}, {"limit", 8}}, "first");
      browser->capture();
      QCOMPARE(inventory.counts(author)["total"].toInt(), 20);
      QCOMPARE(store->read("collections").size(), 0);
      for (int i = 0; i < 8; ++i) browser->capture();
      QCOMPARE(inventory.counts(author)["pending"].toInt(), 12);
    }
    auto browser = new FakeSource;
    SourcePage reopened(store, &pipeline, nullptr, browser);
    QCOMPARE(browser->navigations, 0);
    QVERIFY(!reopened.busy());
    auto view = reopened.findChild<QPushButton*>("showSourceDiscovery");
    QVERIFY(view); view->click();
    auto table = reopened.findChild<QTableWidget*>("sourceDiscoveryRows");
    QVERIFY(table); QCOMPARE(table->rowCount(), 20);
    QCOMPARE(browser->navigations, 0);
    QCOMPARE(store->read("collections").size(), 8);
    QSignalSpy finished(&reopened, &SourcePage::planFinished);
    reopened.runPlan({{"profileUrl", author}, {"rightsBasis", "isolated"}, {"limit", 12}}, "resumed");
    browser->capture();
    for (int i = 0; i < 12; ++i) browser->capture();
    QStringList expected;
    for (int i = 8; i < 20; ++i) expected << QString::number(7259684447530929443ULL + i);
    QCOMPARE(browser->detailIds, expected);
    QCOMPARE(inventory.counts(author)["pending"].toInt(), 0);
    QCOMPARE(finished.size(), 1);
    QCOMPARE(finished[0][2].toJsonObject()["discovered"].toInt(), 1);
    QCOMPARE(finished[0][2].toJsonObject()["resumed"].toInt(), 12);
    QCOMPARE(finished[0][2].toJsonObject()["processed"].toInt(), 12);
  }
  void directoryPagesAreLocalAndLostBindingIsVisibleWithoutRecreatingJobs() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    SourceDiscovery inventory(store->filePath() + ".source-discovery.sqlite");
    const QString author = "https://www.douyin.com/user/abcdef";
    QJsonArray items;
    for (int i = 0; i < 130; ++i) {
      auto id = QString::number(7259684447530929443ULL + i);
      items.append(QJsonObject{{"contentId", id}, {"sourceUrl", "https://www.douyin.com/video/" + id}, {"title", "本机发现目录测试"}});
    }
    const auto observedAt = QDateTime::fromString("2026-10-12T08:00:00Z", Qt::ISODate).toMSecsSinceEpoch();
    inventory.observe(author, items, observedAt);
    QVERIFY(inventory.acknowledge(author, items[0].toObject()["contentId"].toString(), 1, "deleted-job", "old", observedAt + 1000));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.findChild<QLineEdit*>("sourceProfileUrl")->setText(author);
    page.findChild<QPushButton*>("showSourceDiscovery")->click();
    auto rows = page.findChild<QTableWidget*>("sourceDiscoveryRows");
    QVERIFY(rows); QCOMPARE(rows->rowCount(), 50);
    QVERIFY2(rows->item(0, 3)->text().contains("不存在"), qPrintable(rows->item(0, 3)->text()));
    page.findChild<QPushButton*>("nextSourceDiscovery")->click(); QCOMPARE(rows->rowCount(), 50);
    page.findChild<QPushButton*>("nextSourceDiscovery")->click(); QCOMPARE(rows->rowCount(), 30);
    QVERIFY(!page.findChild<QPushButton*>("nextSourceDiscovery")->isEnabled());
    page.findChild<QPushButton*>("previousSourceDiscovery")->click(); QCOMPARE(rows->rowCount(), 50);
    QCOMPARE(browser->navigations, 0); QVERIFY(store->read("collections").isEmpty());
    const auto screen = qEnvironmentVariable("NATIVE_DISCOVERY_SCREENSHOT");
    if (!screen.isEmpty()) { page.resize(1500, 960); page.show(); QTest::qWait(80); QVERIFY(page.grab().save(screen)); }
  }
  void openingSourceAfterDirectoryRestoresTheBrowser() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.findChild<QLineEdit*>("sourceProfileUrl")->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QPushButton*>("showSourceDiscovery")->click();
    QVERIFY(browser->isHidden());
    QCOMPARE(browser->navigations, 0);
    page.findChild<QPushButton*>("openSourceSession")->click();
    QCOMPARE(browser->navigations, 1);
    QVERIFY(!browser->isHidden());
    QVERIFY(store->read("collections").isEmpty());
  }
  void stoppedRestoredTaskStaysProtectedWhenItsPendingCardIsNoLongerVisible() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    const QString author = "https://www.douyin.com/user/abcdef", id = "7259684447530929444";
    SourceDiscovery inventory(store->filePath() + ".source-discovery.sqlite");
    inventory.observe(author, {QJsonObject{{"contentId", id}, {"sourceUrl", "https://www.douyin.com/video/" + id}, {"title", "已有人工稿"}}}, 1000);
    store->save("collections", {{"id", "old"}, {"title", "已有人工稿"}, {"status", "imported"}, {"text", "人工正文"}, {"sourceUrl", "https://www.douyin.com/video/" + id}});
    auto backup = store->backup(); store->restore(backup);
    auto restored = store->read("collections")[0].toObject();
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.runPlan({{"profileUrl", author}, {"rightsBasis", "isolated"}, {"limit", 2}}, "protected");
    browser->capture(); browser->capture();
    QCOMPARE(browser->detailIds, QStringList{"7259684447530929443"});
    QCOMPARE(store->read("collections")[0].toObject(), restored);
    QCOMPARE(inventory.counts(author)["pending"].toInt(), 1);
    page.findChild<QPushButton*>("stopSourceCollection")->click();
    browser->visibleIds << "7259684447530929445"; browser->current = QUrl(author); browser->capture();
    QCOMPARE(inventory.counts(author)["total"].toInt(), 2);
  }
  void discoveryWriteRefusalStopsBeforeDetailNavigation() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    SourceDiscovery inventory(store->filePath() + ".source-discovery.sqlite");
    const auto name = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", name); db.setDatabaseName(inventory.filePath()); QVERIFY(db.open());
      QSqlQuery q(db); QVERIFY(q.exec("CREATE TRIGGER refusal BEFORE INSERT ON discoveries BEGIN SELECT RAISE(ABORT,'discovery refused'); END"));
      db.close();
    }
    QSqlDatabase::removeDatabase(name);
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "isolated"}, {"limit", 2}}, "refused");
    browser->capture();
    QCOMPARE(browser->detailVisits, 0);
    QVERIFY(!page.busy());
    QVERIFY(store->read("collections").isEmpty());
    QVERIFY(page.findChild<QLabel*>("sourceCollectionState")->text().contains("discovery refused"));
  }
  void acknowledgementRefusalDoesNotSubmitOrReauthorizeSavedTask() {
    QTemporaryDir dir;
    QFile model(dir.filePath("model.bin")); QVERIFY(model.open(QIODevice::WriteOnly)); model.close();
    QSettings settings; settings.setValue("asr/python", QCoreApplication::applicationFilePath()); settings.setValue("asr/model", dir.path());
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    SourceDiscovery inventory(store->filePath() + ".source-discovery.sqlite");
    auto setTrigger = [&](bool create) {
      auto name = QUuid::createUuid().toString(); bool result;
      {
        auto db = QSqlDatabase::addDatabase("QSQLITE", name); db.setDatabaseName(inventory.filePath());
        if (!db.open()) return false;
        QSqlQuery q(db); result = q.exec(create ? "CREATE TRIGGER no_ack BEFORE UPDATE ON discoveries WHEN NEW.state='detail_saved' BEGIN SELECT RAISE(ABORT,'ack refused'); END" : "DROP TRIGGER no_ack");
      }
      QSqlDatabase::removeDatabase(name); return result;
    };
    QVERIFY(setTrigger(true));
    SourceHoldingNetwork network;
    CollectionPipeline pipeline(store, dir.filePath("media"), nullptr, &network);
    auto browser = new FakeSource; browser->media = true;
    SourcePage page(store, &pipeline, nullptr, browser);
    const QJsonObject plan{{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "isolated"}, {"limit", 1}};
    page.runPlan(plan, "first"); browser->capture(); browser->capture();
    QCOMPARE(store->read("collections").size(), 1);
    QCOMPARE(network.requests, 0);
    QVERIFY(!page.busy());
    QVERIFY(page.findChild<QLabel*>("sourceCollectionState")->text().contains("ack refused"));
    QVERIFY(setTrigger(false));
    auto job = store->read("collections")[0].toObject(); job["text"] = "人工稿"; job = store->save("collections", job);
    page.runPlan(plan, "retry-discovery"); browser->capture(); browser->capture();
    QCOMPARE(network.requests, 0);
    QCOMPARE(store->read("collections").size(), 1);
    QCOMPARE(store->read("collections")[0].toObject()["text"].toString(), QString("人工稿"));
    settings.remove("asr/python"); settings.remove("asr/model");
  }
  void boundedRoundsReachLaterVisibleWorksAndPreserveEarlierText() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    browser->visibleIds << "7259684447530929444" << "7259684447530929445";
    SourcePage page(store, &pipeline, nullptr, browser);
    QSignalSpy finished(&page, &SourcePage::planFinished);
    const QJsonObject plan{{"profileUrl", "https://www.douyin.com/user/abcdef"},
                           {"rightsBasis", "隔离测试"}, {"limit", 1}};
    QJsonObject preserved;
    for (int round = 0; round < 3; ++round) {
      page.runPlan(plan, "bounded-" + QString::number(round));
      browser->capture(); browser->capture();
      QVERIFY(!page.busy());
      if (round == 0) {
        preserved = store->read("collections")[0].toObject();
        preserved["text"] = "已校对的第一条";
        preserved["pipelineState"] = "complete";
        preserved = store->save("collections", preserved);
      }
    }
    QCOMPARE(browser->detailIds, browser->visibleIds);
    QCOMPARE(store->read("collections").size(), 3);
    QCOMPARE(store->read("collections")[0].toObject(), preserved);
    QCOMPARE(store->read("docs").size(), 0);
    QCOMPARE(finished.size(), 3);
    for (const auto& call : finished) {
      QCOMPARE(call[1].toString(), QString("complete"));
      QCOMPARE(call[2].toJsonObject()["discovered"].toInt(), 3);
      QCOMPARE(call[2].toJsonObject()["processed"].toInt(), 1);
      QCOMPARE(call[2].toJsonObject()["queued"].toInt(), 0);
    }
    const auto state = page.findChild<QLabel*>("sourceCollectionState")->text();
    QVERIFY(state.contains("本机待核对目录"));
    QVERIFY(state.contains("发现总数不等于已保存详情"));
  }
  void failedCandidateSaveStopsBeforeAnyLaterWorkOrDownstreamSubmission() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    const auto connection = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(store->filePath());
      QVERIFY(db.open());
      QSqlQuery query(db);
      QVERIFY(query.exec("CREATE TRIGGER reject_collection BEFORE INSERT ON records "
                         "WHEN NEW.kind='collections' BEGIN SELECT RAISE(FAIL,'controlled rejection'); END"));
      db.close();
    }
    QSqlDatabase::removeDatabase(connection);
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    browser->visibleIds << "7259684447530929444";
    SourcePage page(store, &pipeline, nullptr, browser);
    QSignalSpy finished(&page, &SourcePage::planFinished);
    page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"},
                  {"rightsBasis", "隔离测试"}, {"limit", 2}}, "write-rejected");
    browser->capture(); browser->capture();
    QVERIFY(!page.busy());
    QVERIFY(browser->stopped);
    QCOMPARE(browser->detailVisits, 1);
    QVERIFY(store->read("collections").isEmpty());
    QVERIFY(store->read("docs").isEmpty());
    QCOMPARE(finished.size(), 1);
    QCOMPARE(finished[0][1].toString(), QString("failed"));
    QCOMPARE(finished[0][2].toJsonObject()["processed"].toInt(), 0);
    QCOMPARE(finished[0][2].toJsonObject()["queued"].toInt(), 0);
    const auto message = page.findChild<QLabel*>("sourceCollectionState")->text();
    QVERIFY2(message.contains("已暂停"), qPrintable(message));
    QVERIFY2(message.contains("controlled rejection"), qPrintable(message));
  }
  void nonOwnerCannotOpenSourceSessionOrStartCollection() {
    QTemporaryDir dir;
    auto store=std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline owner(store,dir.filePath("media"));
    CollectionPipeline second(store,dir.filePath("other-media"));
    auto browser=new FakeSource;
    SourcePage page(store,&second,nullptr,browser);
    page.findChild<QLineEdit*>("sourceProfileUrl")->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QLineEdit*>("sourceRights")->setText("isolated test");
    for(auto name:{"startSourceCollection","openSourceSession"}){
      page.findChild<QPushButton*>(name)->click();
      QCOMPARE(browser->navigations,0);
      QVERIFY(!page.busy());
      QVERIFY(page.findChild<QLabel*>("sourceCollectionState")->text().contains("只读"));
      QVERIFY(store->read("collections").isEmpty());
    }
  }
  void completedPlanCannotStopANewerManualRun() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    QSignalSpy finished(&page, &SourcePage::planFinished);
    page.runPlan({{"profileUrl", "https://www.douyin.com/user/abcdef"},
                  {"rightsBasis", "隔离测试"},
                  {"limit", 1}},
                 "old-ticket");
    browser->capture();  // Current profile, then its matching detail.
    browser->capture();
    QCOMPARE(finished.size(), 1);
    QVERIFY(!page.busy());
    page.findChild<QPushButton*>("startSourceCollection")->click();
    QVERIFY(page.busy());
    browser->stopped = false;
    page.stopPlan("old-ticket");
    QVERIFY(!browser->stopped);
    QVERIFY(page.busy());
    page.findChild<QPushButton*>("stopSourceCollection")->click();
    QVERIFY(!page.busy());
    QCOMPARE(finished.size(), 1);
  }
  void ordinarySourceCannotStopALaterManualPipelineAttempt() {
    QTemporaryDir dir;
    QFile model(dir.filePath("model.bin"));
    QVERIFY(model.open(QIODevice::WriteOnly)); model.close();
    QSettings settings;
    settings.setValue("asr/python", QCoreApplication::applicationFilePath());
    settings.setValue("asr/model", dir.path());
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    SourceHoldingNetwork network;
    CollectionPipeline pipeline(store, dir.filePath("media"), nullptr, &network);
    auto browser = new FakeSource;
    browser->media = true;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.findChild<QLineEdit*>("sourceProfileUrl")->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QLineEdit*>("sourceRights")->setText("isolated fixture");
    page.findChild<QPushButton*>("startSourceCollection")->click();
    browser->capture(); browser->capture();
    QVERIFY(!page.busy());
    QTRY_COMPARE_WITH_TIMEOUT(network.requests, 1, 5000);
    const auto original = store->read("collections")[0].toObject();
    const auto id = original["id"].toString();
    QVERIFY(!original["pipelineAttemptId"].toString().isEmpty());
    QVERIFY(original["sourceTaskReceipt"].toObject().isEmpty());
    pipeline.cancel(id);
    pipeline.enqueue(id, QCoreApplication::applicationFilePath(), dir.path());
    QTRY_COMPARE_WITH_TIMEOUT(network.requests, 2, 5000);
    const auto restarted = store->read("collections")[0].toObject();
    QVERIFY(original["pipelineAttemptId"] != restarted["pipelineAttemptId"]);
    QCOMPARE(restarted["executionRevision"], original["executionRevision"]);
    network.aborted = false;
    page.findChild<QPushButton*>("stopSourceCollection")->click();
    settings.remove("asr/python"); settings.remove("asr/model");
    QVERIFY2(!network.aborted, "Old ordinary source stop must not cancel a later manual attempt");
    QCOMPARE(store->read("collections")[0].toObject(), restarted);
    pipeline.cancel(id);
  }
  void invalidNewPlanDoesNotReusePreviousRunCounts() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    QSignalSpy finished(&page, &SourcePage::planFinished);
    QJsonObject plan{{"profileUrl", "https://www.douyin.com/user/abcdef"},
                     {"rightsBasis", "隔离测试"},
                     {"limit", 1}};
    page.runPlan(plan, "first");
    browser->capture();
    browser->capture();
    QCOMPARE(finished.size(), 1);
    QCOMPARE(finished[0][2].toJsonObject()["processed"].toInt(), 1);
    plan["rightsBasis"] = "";
    page.runPlan(plan, "second");
    QCOMPARE(finished.size(), 2);
    QCOMPARE(finished[1][1].toString(), QString("failed"));
    QCOMPARE(finished[1][2].toJsonObject()["processed"].toInt(), 0);
    QCOMPARE(finished[1][2].toJsonObject()["queued"].toInt(), 0);
  }
  void stoppedInitializationMustNotNavigate_data() {
    QTest::addColumn<QString>("button");
    QTest::newRow("open") << QString("openSourceSession");
    QTest::newRow("collect") << QString("startSourceCollection");
  }
  void stoppedInitializationMustNotNavigate() {
    QFETCH(QString, button);
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    browser->delayedReady = true;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.findChild<QLineEdit*>("sourceProfileUrl")
        ->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QLineEdit*>("sourceRights")->setText("隔离测试");
    page.findChild<QPushButton*>(button)->click();
    page.findChild<QPushButton*>("stopSourceCollection")->click();
    emit browser->ready();
    QCOMPARE(browser->navigations, 0);
    QVERIFY(store->read("collections").isEmpty());
    page.findChild<QPushButton*>("openSourceSession")->click();
    QCOMPARE(browser->navigations, 1);
    QVERIFY(store->read("collections").isEmpty());
  }
  void realWidgetsDiscoverStoreAndPreserveOldText() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.resize(1400, 900);
    page.show();
    page.findChild<QLineEdit*>("sourceProfileUrl")
        ->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QLineEdit*>("sourceRights")->setText("隔离测试授权");
    QTest::mouseClick(page.findChild<QPushButton*>("startSourceCollection"),
                      Qt::LeftButton);
    QTRY_VERIFY2_WITH_TIMEOUT(
        store->read("collections").size() == 1,
        qPrintable(page.findChild<QLabel*>("sourceCollectionState")->text()),
        10000);
    auto row = store->read("collections")[0].toObject();
    QCOMPARE(row["title"].toString(), QString("测试作品"));
    QCOMPARE(row["publishedAt"].toString(), QString("2025-01-02T00:00:00Z"));
    QVERIFY(!row["autoPipeline"].toBool());
    QCOMPARE(store->read("docs").size(), 0);
    QVERIFY(page.findChild<QTableWidget*>("sourceRunRows")
                ->item(0, 3)
                ->text()
                .contains("媒体未提供"));
    row["text"] = "原有人工稿";
    store->save("collections", row);
    QTest::mouseClick(page.findChild<QPushButton*>("startSourceCollection"),
                      Qt::LeftButton);
    QTest::qWait(2900);
    QCOMPARE(store->read("collections").size(), 1);
    QCOMPARE(store->read("collections")[0].toObject()["text"].toString(),
             QString("原有人工稿"));
  }
  void completedWorkIsRecheckedAndUpdateSavedSeparately() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    QJsonObject plan{{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "隔离测试"}, {"limit", 1}};
    page.runPlan(plan, "initial"); browser->capture(); browser->capture();
    auto root = store->read("collections")[0].toObject();
    root["text"] = "人工校对不覆盖"; root["pipelineState"] = "complete";
    root = store->save("collections", root);
    browser->title = "来源已更新";
    page.runPlan(plan, "update"); browser->capture(); browser->capture();
    QCOMPARE(store->read("collections").size(), 2);
    QCOMPARE(store->read("collections")[0].toObject(), root);
    QCOMPARE(store->read("collections")[1].toObject()["sourceRootId"], root["id"]);
    QVERIFY(page.findChild<QTableWidget*>("sourceRunRows")->item(0, 3)->text().contains("媒体未提供"));
    page.runPlan(plan, "repeat"); browser->capture(); browser->capture();
    QCOMPARE(store->read("collections").size(), 2);
  }
  void changedSourceDownloadsTranscribesAndPublishesWithoutChangingOldDoc() {
    QTemporaryDir dir;
    QDir().mkpath(dir.filePath("model")); QFile model(dir.filePath("model/model.bin"));
    QVERIFY(model.open(QIODevice::WriteOnly)); model.write("test-only-model"); model.close();
    QSettings settings;
    settings.setValue("asr/python", QCoreApplication::applicationFilePath()); settings.setValue("asr/model", dir.filePath("model"));
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    SourceMediaNetwork network;
    CollectionPipeline pipeline(store, dir.filePath("media"), nullptr, &network);
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    QJsonObject plan{{"profileUrl", "https://www.douyin.com/user/abcdef"}, {"rightsBasis", "隔离测试来源/下载/识别，不是真实平台"}, {"limit", 1}};
    page.runPlan(plan, "initial"); browser->capture(); browser->capture();
    auto root = store->read("collections")[0].toObject();
    root["text"] = "人工校对"; root["originalText"] = "旧原文"; root["pipelineState"] = "complete";
    root = store->save("collections", root);
    auto doc = publishCollection(store, root["id"].toString()); doc["text"] = "人工研究编辑"; doc = store->save("docs", doc);
    browser->title = "来源更新后的内容"; browser->media = true;
    page.runPlan(plan, "update"); browser->capture(); browser->capture();
    QVERIFY(!store->read("collections")[1].toObject().contains("executionRevision"));
    QTRY_COMPARE_WITH_TIMEOUT(store->read("docs").size(), 2, 8000);
    QCOMPARE(network.requests, 1);
    QCOMPARE(store->read("collections")[0].toObject(), root);
    QCOMPARE(store->read("docs")[0].toObject(), doc);
    auto version = store->read("collections")[1].toObject(), newDoc = store->read("docs")[1].toObject();
    QCOMPARE(version["pipelineState"].toString(), QString("complete"));
    QVERIFY(!version.contains("executionRevision"));
    QCOMPARE(newDoc["sourceRootId"], root["id"]);
    QCOMPARE(newDoc["text"].toString(), QString("受控的新版本识别文稿"));
    page.runPlan(plan, "repeat"); browser->capture(); browser->capture();
    QTest::qWait(100);
    QCOMPARE(network.requests, 1); QCOMPARE(store->read("docs").size(), 2);
    settings.remove("asr/python"); settings.remove("asr/model");
  }
  void invalidExecutionRevisionCannotAcquireQueueApproval() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    const auto job = store->save("collections", {{"id", "invalid-revision"},
        {"title", "受控身份反例"}, {"text", "隔离文本"}, {"rightsBasis", "test"},
        {"status", "imported"}, {"executionRevision", QJsonValue::Null}});
    CollectionPipeline pipeline(store, dir.filePath("media"));
    QVERIFY_EXCEPTION_THROWN(pipeline.enqueue("invalid-revision", {}, {},
        {{"attemptId", "attempt"}, {"sourceRunId", "run"},
         {"jobId", "invalid-revision"}, {"executionRevision", ""}}), std::exception);
    QCOMPARE(store->read("collections")[0].toObject(), job);
    QVERIFY(store->read("docs").isEmpty());
  }
  void loginStopsWithoutWritingAndCancelBlocksLateCallback() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    auto browser = new FakeSource;
    browser->login = false;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.show();
    page.findChild<QLineEdit*>("sourceProfileUrl")
        ->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QLineEdit*>("sourceRights")->setText("隔离测试授权");
    QTest::mouseClick(page.findChild<QPushButton*>("startSourceCollection"),
                      Qt::LeftButton);
    QTRY_VERIFY2_WITH_TIMEOUT(
        page.findChild<QLabel*>("sourceCollectionState")
            ->text()
            .contains("需要登录"),
        qPrintable(page.findChild<QLabel*>("sourceCollectionState")->text()),
        6000);
    QCOMPARE(store->read("collections").size(), 0);
    browser->login = true;
    QTest::mouseClick(page.findChild<QPushButton*>("startSourceCollection"),
                      Qt::LeftButton);
    QTest::mouseClick(page.findChild<QPushButton*>("stopSourceCollection"),
                      Qt::LeftButton);
    QVERIFY(browser->stopped);
    QTest::qWait(2900);
    QCOMPARE(store->read("collections").size(), 0);
  }
  void discoverMustNotRetryHeldOrUserStoppedJobs_data() {
    QTest::addColumn<QString>("pipelineState");
    QTest::newRow("held") << QString("held");
    QTest::newRow("paused") << QString("paused");
  }
  void discoverMustNotRetryHeldOrUserStoppedJobs() {
    QFETCH(QString, pipelineState);
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    const auto prior = store->save(
        "collections",
        {{"id", "j"},
         {"title", "已停止的任务"},
         {"status", "imported"},
         {"sourceUrl", "https://www.douyin.com/video/7259684447530929443"},
         {"pipelineState", pipelineState},
         {"pipelineFailures", 5},
         {"autoPipeline", false}});
    auto browser = new FakeSource;
    SourcePage page(store, &pipeline, nullptr, browser);
    page.show();
    page.findChild<QLineEdit*>("sourceProfileUrl")
        ->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QLineEdit*>("sourceRights")->setText("隔离测试");
    page.findChild<QPushButton*>("startSourceCollection")->click();
    QTest::qWait(3000);
    QCOMPARE(browser->detailVisits, 0);
    QCOMPARE(store->read("collections")[0].toObject(), prior);
  }
};
int main(int argc, char** argv) {
  QApplication app(argc, argv);
  if (app.arguments().contains("--media")) {
    QTextStream(stdout) << QString::fromUtf8(R"({"transcript":"受控的新版本识别文稿","durationSeconds":2,"segments":[{"start":0,"end":1,"text":"受控的新版本识别文稿"}]})");
    return 0;
  }
  SourcePageTests tests; return QTest::qExec(&tests, argc, argv);
}
#include "source_page_tests.moc"
