#include <QNetworkReply>
#include <QTemporaryDir>
#include <QtTest>

#include "source_plans_page.hpp"

class PlanBrowser : public SourceBrowser {
 public:
  QUrl current;
  bool login = true, delayedReady = false, stopped = false, withMedia = false;
  int visits = 0;
  void initialize(const QString&) override {
    if (!delayedReady) emit ready();
  }
  void navigate(const QUrl& url) override {
    current = url;
    ++visits;
    QTimer::singleShot(0, this, [this] { emit loaded(current, true); });
  }
  void stop() override { stopped = true; }
  void capture() override {
    auto page = QJsonObject{
        {"pageUrl", current.toString()},
        {"pageType", current.path().startsWith("/user") ? "profile" : "video"},
        {"loggedIn", login},
        {"profile",
         QJsonObject{{"profileUrl", "https://www.douyin.com/user/abcdef"}}},
        {"items", QJsonArray{QJsonObject{
                      {"contentId", "7259684447530929443"},
                      {"title", "真实控件假来源"},
                      {"sourceUrl",
                       "https://www.douyin.com/video/7259684447530929443"}}}}};
    if (withMedia) {
      auto item = page["items"].toArray()[0].toObject();
      item["mediaUrl"] = "https://v3.douyinvod.com/owned-test.mp4";
      item["mediaBinding"] =
          QJsonObject{{"contentId", "7259684447530929443"},
                      {"profileUrl", "https://www.douyin.com/user/abcdef"},
                      {"source", "embedded_detail"}};
      page["items"] = QJsonArray{item};
    }
    emit snapshot(page);
  }
};
class HoldingReply : public QNetworkReply {
 public:
  HoldingReply(const QNetworkRequest& req, bool* stopped, QObject* parent)
      : QNetworkReply(parent), aborted(stopped) {
    setRequest(req);
    setUrl(req.url());
    open(QIODevice::ReadOnly | QIODevice::Unbuffered);
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute, 200);
    setHeader(QNetworkRequest::ContentTypeHeader, "video/mp4");
  }
  void abort() override {
    *aborted = true;
    setError(OperationCanceledError, "cancelled");
    setFinished(true);
    emit finished();
  }

 protected:
  qint64 readData(char*, qint64) override { return -1; }

 private:
  bool* aborted;
};
class HoldingNetwork : public QNetworkAccessManager {
 public:
  int requests = 0;
  bool aborted = false;

 protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& req,
                               QIODevice*) override {
    ++requests;
    return new HoldingReply(req, &aborted, this);
  }
};
class SourcePlansPageTests : public QObject {
  Q_OBJECT
  void fill(SourcePlansPage& page) {
    page.findChild<QLineEdit*>("planName")->setText("测试作者");
    page.findChild<QLineEdit*>("planProfile")
        ->setText("https://www.douyin.com/user/abcdef");
    page.findChild<QLineEdit*>("planRights")->setText("测试合法依据");
    page.findChild<QPushButton*>("saveSourcePlan")->click();
  }
 private slots:
  void historyExplainsCurrentDiscoveryAndResumedCandidatesSeparately() {
    QTemporaryDir dir;
    auto business = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger = std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    CollectionPipeline pipeline(business, dir.filePath("media"));
    auto browser = new PlanBrowser;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source); fill(page);
    auto plan = ledger->plans()[0].toObject();
    auto run = ledger->begin(plan["id"].toString(), 1000, true);
    QVERIFY(ledger->finish(run["id"].toString(), "complete", 2000,
                          {{"discovered", 2}, {"resumed", 1}, {"processed", 1}, {"queued", 0}}, "来源结束非入库成功"));
    page.findChild<QPushButton*>("reloadSourceHistory")->click();
    auto history = page.findChild<QTableWidget*>("sourcePlanHistory");
    QCOMPARE(history->rowCount(), 1);
    QVERIFY2(history->item(0, 3)->text().contains("续办1"), qPrintable(history->item(0, 3)->text()));
    auto text = page.findChild<QTextBrowser*>("sourceHistoryDetail")->toPlainText();
    QVERIFY(text.contains("本页发现")); QVERIFY(text.contains("本机续办"));
    QVERIFY(!text.contains("resumed")); QCOMPARE(browser->visits, 0);
  }
  void publishedReceiptRequiresExactDocumentIdentity() {
    QTemporaryDir dir;
    auto business=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger=std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    CollectionPipeline pipeline(business,dir.filePath("media"));
    auto browser=new PlanBrowser;
    SourcePage source(business,&pipeline,nullptr,browser);
    SourcePlansPage page(ledger,&source);
    fill(page);
    const auto plan=ledger->plans()[0].toObject();
    const auto now=QDateTime::currentMSecsSinceEpoch();
    const auto run=ledger->begin(plan["id"].toString(),now,true);
    const auto runId=run["id"].toString();
    business->save("collections",{{"id","completed-job"},{"title","本轮授权文稿（隔离示例）"},
      {"text","用于验证真实原生历史与回执的隔离正文"},{"status","imported"},{"rightsBasis","isolated test"},
      {"executionRevision","revision-1"}});
    const QJsonObject item{{"collectionId","completed-job"},{"executionRevision","revision-1"},
      {"sourceAttemptId","attempt-1"},{"contentId","7259684447530929443"},
      {"sourceUrl","https://www.douyin.com/video/7259684447530929443"},
      {"title","本轮授权文稿（隔离示例）"},{"disposition","new"}};
    ledger->recordItem(runId,item);
    pipeline.enqueue("completed-job",{},{},{{"attemptId","attempt-1"},{"sourceRunId",runId},
      {"jobId","completed-job"},{"executionRevision","revision-1"},{"contentId","7259684447530929443"}});
    QVERIFY(ledger->finish(runId,"complete",now+1000,{{"discovered",1},{"processed",1},{"queued",1}},
                           "隔离操作验证：来源阶段结束，下游回执独立核对"));
    const auto frozen=ledger->history()[0].toObject();
    page.findChild<QPushButton*>("reloadSourceHistory")->click();
    auto detail=page.findChild<QTextBrowser*>("sourceHistoryDetail");
    QVERIFY(detail->toPlainText().contains("本次已入研究资料"));
    QSignalSpy opened(&page,&SourcePlansPage::openRunCollection);
    detail->anchorClicked(QUrl("run-collection:0"));
    QCOMPARE(opened.size(),1);
    QCOMPARE(opened[0][0].toString(),QString("completed-job"));
    QCOMPARE(opened[0][1].toString(),QString("revision-1"));
    const auto screen=qEnvironmentVariable("NATIVE_PIPELINE_RECEIPT_SCREENSHOT");
    if(!screen.isEmpty()) {
      page.resize(1600,1000);page.show();QTest::qWait(100);
      QVERIFY(page.grab().save(screen));
    }
    auto doc=business->read("docs")[0].toObject();
    doc["sourceAttemptId"]="another-attempt";business->save("docs",doc);
    page.findChild<QPushButton*>("reloadSourceHistory")->click();
    QVERIFY(detail->toPlainText().contains("资料缺失或版本失配"));
    QVERIFY(!detail->toPlainText().contains("本次已入研究资料"));
    QCOMPARE(ledger->history()[0].toObject(),frozen);
  }
  void nativeHistoryKeepsExactTaskAndCurrentDownstreamState() {
    QTemporaryDir dir;
    auto business = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger = std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    HoldingNetwork network;
    CollectionPipeline pipeline(business, dir.filePath("media"), nullptr, &network);
    QFile model(dir.filePath("model.bin"));
    QVERIFY(model.open(QIODevice::WriteOnly));
    model.close();
    QSettings settings;
    settings.setValue("asr/python", QCoreApplication::applicationFilePath());
    settings.setValue("asr/model", dir.path());
    auto browser = new PlanBrowser;
    browser->withMedia = true;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source);
    fill(page);
    page.findChild<QPushButton*>("runSourcePlan")->click();
    QTRY_VERIFY_WITH_TIMEOUT(!ledger->history().isEmpty() &&
        ledger->history()[0].toObject()["state"] == "complete", 10000);
    const auto snapshot = ledger->history()[0].toObject();
    const auto items = snapshot["items"].toArray();
    QCOMPARE(items.size(), 1);
    const auto job = business->read("collections")[0].toObject();
    QCOMPARE(items[0].toObject()["collectionId"], job["id"]);
    QCOMPARE(items[0].toObject()["executionRevision"].toString(),
             job["executionRevision"].toString());
    const auto attempt = items[0].toObject()["sourceAttemptId"].toString();
    QVERIFY(!attempt.isEmpty());
    QCOMPARE(job["sourceTaskReceipt"].toObject()["attemptId"].toString(), attempt);
    auto detail = page.findChild<QTextBrowser*>("sourceHistoryDetail");
    QVERIFY(detail->toPlainText().contains("下载中"));
    pipeline.cancel(job["id"].toString());
    page.findChild<QPushButton*>("reloadSourceHistory")->click();
    QVERIFY(detail->toPlainText().contains("已暂停"));
    QCOMPARE(ledger->history()[0].toObject(), snapshot);
    pipeline.enqueue(job["id"].toString(), QCoreApplication::applicationFilePath(), dir.path());
    network.aborted = false;
    page.findChild<QPushButton*>("pauseSourcePlans")->click();
    QVERIFY2(!network.aborted, "A completed source run must not stop a later manual attempt");
    page.findChild<QPushButton*>("reloadSourceHistory")->click();
    QVERIFY(detail->toPlainText().contains("本次已取消"));
    QCOMPARE(business->read("collections")[0].toObject()["sourceTaskReceipt"]
                 .toObject()["state"].toString(), QString("cancelled"));
    pipeline.cancel(job["id"].toString());
    business->restore(business->backup());
    page.findChild<QPushButton*>("reloadSourceHistory")->click();
    QVERIFY(detail->toPlainText().contains("已被恢复替换"));
    QVERIFY(!detail->toHtml().contains("run-collection:"));
    QCOMPARE(ledger->history()[0].toObject(), snapshot);
  }
  void itemPersistenceFailureCannotSubmitDownload() {
    QTemporaryDir dir;
    auto business = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger = std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    HoldingNetwork network;
    CollectionPipeline pipeline(business, dir.filePath("media"), nullptr, &network);
    auto browser = new PlanBrowser;
    browser->withMedia = true;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source);
    fill(page);
    const auto connection = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(dir.filePath("plans.sqlite"));
      QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TRIGGER deny_run_items BEFORE UPDATE ON source_runs "
                     "WHEN NEW.payload LIKE '%\"items\"%' BEGIN SELECT RAISE(ABORT,'item write failure'); END"));
      db.close();
    }
    QSqlDatabase::removeDatabase(connection);
    page.findChild<QPushButton*>("runSourcePlan")->click();
    QTRY_VERIFY_WITH_TIMEOUT(!ledger->history().isEmpty() &&
        ledger->history()[0].toObject()["state"] == "failed", 10000);
    QCOMPARE(network.requests, 0);
    QVERIFY(!page.scheduling());
    for(auto value : business->read("collections"))
      QVERIFY(!value.toObject()["autoPipeline"].toBool());
    QVERIFY(business->read("docs").isEmpty());
  }
  void initTestCase() {
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("SourcePlansPageTests-" +
                                         QUuid::createUuid().toString());
  }
  void cleanupTestCase() { QSettings().clear(); }
  void historyExportCannotReplaceDatabase() {
    QTemporaryDir dir;auto ledger=std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    SourcePlansPage page(ledger,nullptr);
    QFile before(dir.filePath("plans.sqlite"));QVERIFY(before.open(QIODevice::ReadOnly));auto original=before.readAll();before.close();
    bool rejected=false;try{page.exportHistoryFile(before.fileName());}catch(const std::exception&){rejected=true;}
    QVERIFY(rejected);QVERIFY(before.open(QIODevice::ReadOnly));QCOMPARE(before.readAll(),original);
    QFile existing(dir.filePath("keep.json"));QVERIFY(existing.open(QIODevice::WriteOnly));existing.write("keep");existing.close();
    rejected=false;try{page.exportHistoryFile(existing.fileName());}catch(const std::exception&){rejected=true;}
    QVERIFY(rejected);QVERIFY(existing.open(QIODevice::ReadOnly));QCOMPARE(existing.readAll(),QByteArray("keep"));
  }
  void historyPreviewPagingAndExportControls() {
    QTemporaryDir dir;auto business=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger=std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));CollectionPipeline pipeline(business,dir.filePath("media"));
    auto browser=new PlanBrowser;browser->delayedReady=true;SourcePage source(business,&pipeline,nullptr,browser);SourcePlansPage page(ledger,&source);page.resize(1600,1000);page.show();
    QJsonArray rows;for(int i=1;i<=205;++i)rows.append(QJsonObject{{"id","legacy-webstock:sync-run:"+QString::number(i)},{"author","旧作者"},{"startedAt","2026-10-10T08:00:00Z"},{"status","completed"},{"counts",QJsonObject{{"transcribed_count",0}}},{"items",QJsonArray{QJsonObject{{"contentId","12345"},{"transcription_status","runtime_missing"}}}}});
    QFile f(dir.filePath("history.json"));QVERIFY(f.open(QIODevice::WriteOnly));f.write(QJsonDocument(sourceHistory::bundle(rows)).toJson());f.close();
    page.previewHistoryFile(f.fileName());QTRY_VERIFY_WITH_TIMEOUT(!page.historyFileBusy(),30000);QCOMPARE(ledger->historyCount(true,ledger->historyAnchor(true)),0);
    page.findChild<QPushButton*>("confirmSourceHistory")->click();QTRY_VERIFY_WITH_TIMEOUT(!page.historyFileBusy(),30000);QVERIFY(page.findChild<QLabel*>("sourcePlansState")->text().contains("205"));
    auto table=page.findChild<QTableWidget*>("sourcePlanHistory");QCOMPARE(table->rowCount(),50);
    QTest::mouseClick(table->viewport(),Qt::LeftButton,Qt::NoModifier,table->visualItemRect(table->item(0,0)).center());
    QVERIFY(page.findChild<QTextBrowser*>("sourceHistoryDetail")->toPlainText().contains("runtime_missing"));
    QSignalSpy opened(&page,&SourcePlansPage::openHistoryManuscript);
    QTest::keyClick(table,Qt::Key_Down);QCOMPARE(table->currentRow(),1);
    auto detail=page.findChild<QTextBrowser*>("sourceHistoryDetail");QVERIFY(detail->toPlainText().contains("sync-run:204"));
    detail->anchorClicked(QUrl("manuscript:0"));QCOMPARE(opened.size(),1);QCOMPARE(opened[0][0].toString(),QString("12345"));
    for(int i=0;i<4;++i)page.findChild<QPushButton*>("nextSourceHistory")->click();QCOMPARE(table->rowCount(),5);
    page.exportHistoryFile(dir.filePath("export.json"));QTRY_VERIFY_WITH_TIMEOUT(!page.historyFileBusy(),30000);QFile exported(dir.filePath("export.json"));QVERIFY(exported.open(QIODevice::ReadOnly));QCOMPARE(QJsonDocument::fromJson(exported.readAll()).object()["runs"].toArray().size(),205);
    QVERIFY(!page.scheduling());QCOMPARE(browser->visits,0);
    auto actual=qEnvironmentVariable("NATIVE_HISTORY_FILE");
    if(!actual.isEmpty()){
      // Another isolated ledger is used so fixture IDs never collide with real records.
      auto realLedger=std::make_shared<SourceSchedule>(dir.filePath("real.sqlite"));SourcePlansPage real(realLedger,&source);real.resize(1600,1000);real.show();
      real.previewHistoryFile(actual);QTRY_VERIFY_WITH_TIMEOUT(!real.historyFileBusy(),30000);real.findChild<QPushButton*>("confirmSourceHistory")->click();QTRY_VERIFY_WITH_TIMEOUT(!real.historyFileBusy(),30000);QCOMPARE(realLedger->historyCount(true,realLedger->historyAnchor(true)),5515);
      real.exportHistoryFile(dir.filePath("real-export.json"));QTRY_VERIFY_WITH_TIMEOUT(!real.historyFileBusy(),30000);QFile input(actual),output(dir.filePath("real-export.json"));QVERIFY(input.open(QIODevice::ReadOnly));QVERIFY(output.open(QIODevice::ReadOnly));
      QCOMPARE(QJsonDocument::fromJson(output.readAll()).object()["runs"].toArray().size(),5515);
      auto shots=qEnvironmentVariable("NATIVE_REVIEW_SHOTS");if(!shots.isEmpty()){QVERIFY(QDir().mkpath(shots));QVERIFY(real.grab().save(shots+"/windows-old-source-history.png"));}
    }
  }
  void lockedLegacyReadLeavesGuiResponsive() {
    QTemporaryDir dir;auto ledger=std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));SourcePlansPage page(ledger,nullptr);
    auto name=QUuid::createUuid().toString();{
      auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(dir.filePath("legacy.db"));QVERIFY(db.open());
      QSqlQuery q(db);QVERIFY(q.exec("CREATE TABLE expert_sync_runs(id INTEGER)"));QVERIFY(q.exec("CREATE TABLE expert_sync_run_items(id INTEGER,run_id INTEGER)"));QVERIFY(q.exec("BEGIN EXCLUSIVE"));
      QElapsedTimer elapsed;elapsed.start();page.previewHistoryFile(dir.filePath("legacy.db"));QVERIFY(elapsed.elapsed()<500);
      bool heartbeat=false;QTimer::singleShot(30,&page,[&]{heartbeat=true;});QTRY_VERIFY_WITH_TIMEOUT(heartbeat,500);QVERIFY(page.historyFileBusy());
      QVERIFY(q.exec("ROLLBACK"));QTRY_VERIFY_WITH_TIMEOUT(!page.historyFileBusy(),10000);QVERIFY(page.findChild<QLabel*>("sourcePlansState")->text().contains("预览0"));db.close();
    }QSqlDatabase::removeDatabase(name);
  }
  void destroyedPageDoesNotReceiveLateFileResult() {
    QTemporaryDir dir;auto ledger=std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));auto page=new SourcePlansPage(ledger,nullptr);
    auto name=QUuid::createUuid().toString();QPointer<QThread> worker;
    {
      auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(dir.filePath("legacy.db"));QVERIFY(db.open());
      QSqlQuery q(db);QVERIFY(q.exec("CREATE TABLE expert_sync_runs(id INTEGER)"));QVERIFY(q.exec("CREATE TABLE expert_sync_run_items(id INTEGER,run_id INTEGER)"));QVERIFY(q.exec("BEGIN EXCLUSIVE"));
      page->previewHistoryFile(dir.filePath("legacy.db"));QTest::qWait(100);QVERIFY(page->historyFileBusy());delete page;QVERIFY(q.exec("ROLLBACK"));
      // Exercise queued completion after destruction; no page context may receive it.
      QTest::qWait(1000);QCOMPARE(ledger->historyCount(true,ledger->historyAnchor(true)),0);db.close();
    }QSqlDatabase::removeDatabase(name);
  }
  void disableStillStopsWhenPlanWriteFails() {
    QTemporaryDir dir;
    auto business =
        std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger =
        std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    CollectionPipeline pipeline(business, dir.filePath("media"));
    auto browser = new PlanBrowser;
    browser->delayedReady = true;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source);
    fill(page);
    page.findChild<QPushButton*>("toggleSourcePlan")->click();
    page.findChild<QPushButton*>("runSourcePlan")->click();
    const QString conn = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", conn);
      db.setDatabaseName(dir.filePath("plans.sqlite"));
      QVERIFY(db.open());
      QSqlQuery query(db);
      QVERIFY(query.exec(
          "CREATE TRIGGER reject_plan_write BEFORE INSERT ON source_plans "
          "BEGIN SELECT RAISE(ABORT, 'test disk failure'); END"));
      page.findChild<QPushButton*>("toggleSourcePlan")->click();
      // Drop before assertions so failed tests still leave a recoverable run.
      QVERIFY(query.exec("DROP TRIGGER reject_plan_write"));
      db.close();
    }
    QSqlDatabase::removeDatabase(conn);
    QVERIFY(browser->stopped);
    emit browser->ready();
    QCOMPARE(browser->visits, 0);
    QVERIFY(!source.busy());
    QVERIFY(!page.scheduling());
    QVERIFY(business->read("collections").isEmpty());
  }
  void stopCompletedSourceCancelsItsPendingDownload_data() {
    QTest::addColumn<bool>("replacement");
    QTest::newRow("original") << false;
    QTest::newRow("replaced-and-manually-restarted") << true;
  }
  void stopCompletedSourceCancelsItsPendingDownload() {
    QFETCH(bool, replacement);
    QTemporaryDir dir;
    auto business =
        std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger =
        std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    HoldingNetwork network;
    CollectionPipeline pipeline(business, dir.filePath("media"), nullptr,
                                &network);
    QFile model(dir.filePath("model.bin"));
    QVERIFY(model.open(QIODevice::WriteOnly));
    model.close();
    QSettings settings;
    settings.setValue("asr/python", QCoreApplication::applicationFilePath());
    settings.setValue("asr/model", dir.path());
    settings.sync();
    auto browser = new PlanBrowser;
    browser->withMedia = true;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source);
    fill(page);
    page.findChild<QPushButton*>("runSourcePlan")->click();
    QTRY_VERIFY_WITH_TIMEOUT(
        !ledger->history().isEmpty() &&
            ledger->history()[0].toObject()["state"] == "complete",
        10000);
    QCOMPARE(network.requests, 1);
    QCOMPARE(
        business->read("collections")[0].toObject()["pipelineState"].toString(),
        QString("downloading"));
    auto sourceHistory = ledger->history();
    if (replacement) {
      auto id = business->read("collections")[0].toObject()["id"].toString();
      pipeline.cancel(id);
      auto imported = business->backup();
      business->restore(imported);
      network.aborted = false;
      pipeline.enqueue(id, QCoreApplication::applicationFilePath(), dir.path());
      QCOMPARE(network.requests, 2);
      auto beforeStop = business->read("collections");
      page.findChild<QPushButton*>("pauseSourcePlans")->click();
      QVERIFY(!network.aborted);
      QCOMPARE(business->read("collections"), beforeStop);
      pipeline.cancel(id);
      return;
    }
    page.findChild<QPushButton*>("pauseSourcePlans")->click();
    QVERIFY(network.aborted);
    auto job = business->read("collections")[0].toObject();
    QVERIFY(!job["autoPipeline"].toBool());
    QCOMPARE(job["pipelineState"].toString(), QString("paused"));
    QVERIFY(business->read("docs").isEmpty());
    QCOMPARE(ledger->history(), sourceHistory);
    QCoreApplication::processEvents();
    pipeline.tick();
    QCOMPARE(network.requests, 1);
    QVERIFY(business->read("docs").isEmpty());
  }
  void savedPlanRequiresResumeAndFeedsExistingSource() {
    QTemporaryDir dir;
    auto business =
        std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger =
        std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    CollectionPipeline pipeline(business, dir.filePath("media"));
    auto browser = new PlanBrowser;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source);
    page.show();
    fill(page);
    QCOMPARE(ledger->plans().size(), 1);
    page.findChild<QPushButton*>("toggleSourcePlan")->click();
    page.tick();
    QCOMPARE(browser->visits, 0);
    QVERIFY(ledger->history().isEmpty());
    page.findChild<QPushButton*>("resumeSourcePlans")->click();
    QTRY_VERIFY_WITH_TIMEOUT(
        !ledger->history().isEmpty() &&
            ledger->history()[0].toObject()["state"].toString() == "complete",
        10000);
    QCOMPARE(business->read("collections").size(), 1);
    auto counts = ledger->history()[0].toObject()["counts"].toObject();
    QCOMPARE(counts["discovered"].toInt(), 1);
    QCOMPARE(counts["processed"].toInt(), 1);
    QCOMPARE(counts["queued"].toInt(), 0);
    auto history = page.findChild<QTableWidget*>("sourcePlanHistory");
    QCOMPARE(history->rowCount(), 1);
    QVERIFY(history->item(0, 2)->text().contains("来源完成"));
    page.findChild<QPushButton*>("pauseSourcePlans")->click();
    QVERIFY(!page.scheduling());
    SourcePlansPage reopened(ledger, &source);
    QVERIFY(!reopened.scheduling());
    reopened.tick();
    QCOMPARE(ledger->history().size(), 1);
  }
  void loginFailurePausesAndDoesNotWriteBusiness() {
    QTemporaryDir dir;
    auto business =
        std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger =
        std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    CollectionPipeline pipeline(business, dir.filePath("media"));
    auto browser = new PlanBrowser;
    browser->login = false;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source);
    fill(page);
    page.findChild<QPushButton*>("toggleSourcePlan")->click();
    page.findChild<QPushButton*>("resumeSourcePlans")->click();
    QTRY_VERIFY_WITH_TIMEOUT(
        !ledger->history().isEmpty() &&
            ledger->history()[0].toObject()["state"].toString() == "failed",
        6000);
    QVERIFY(!page.scheduling());
    QVERIFY(business->read("collections").isEmpty());
    page.tick();
    QCOMPARE(ledger->history().size(), 1);
  }
  void stopBeforeReadyRecordsCancellation() {
    QTemporaryDir dir;
    auto business =
        std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger =
        std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    CollectionPipeline pipeline(business, dir.filePath("media"));
    auto browser = new PlanBrowser;
    browser->delayedReady = true;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source);
    fill(page);
    page.findChild<QPushButton*>("runSourcePlan")->click();
    page.findChild<QPushButton*>("pauseSourcePlans")->click();
    emit browser->ready();
    QCOMPARE(browser->visits, 0);
    QCOMPARE(ledger->history()[0].toObject()["state"].toString(),
             QString("cancelled"));
    QVERIFY(!page.scheduling());
    QVERIFY(business->read("collections").isEmpty());
  }
};
QTEST_MAIN(SourcePlansPageTests)
#include "source_plans_page_tests.moc"
