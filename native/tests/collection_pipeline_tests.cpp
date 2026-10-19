#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTextStream>
#include <QtTest>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

#include "collection_pipeline.hpp"
class PipelineTests : public QObject {
  Q_OBJECT
  void approve(const QString& root, const QString& id) {
    QSettings settings(root + "/queue-settings.ini", QSettings::IniFormat);
    auto key = "approved/" +
               QString::fromLatin1(QCryptographicHash::hash(
                                       id.toUtf8(), QCryptographicHash::Sha256)
                                       .toHex()) +
               "/";
    settings.setValue(key + "id", id);
    settings.sync();
  }
 private slots:
  void committedResearchSurvivesTerminalWriteFailure_data() {
    QTest::addColumn<bool>("cancel");
    QTest::newRow("cancel") << true;
    QTest::newRow("five-failures") << false;
  }
  void committedResearchSurvivesTerminalWriteFailure() {
    QFETCH(bool, cancel);
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("db"));
    CollectionPipeline pipeline(store, dir.filePath("media"));
    store->save("collections", {{"id", "receipt-job"}, {"title", "隔离入库测试"},
      {"text", "已完成的授权正文"}, {"status", "imported"}, {"rightsBasis", "isolated fixture"}});
    const auto connection = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(store->filePath()); QVERIFY(db.open());
      QSqlQuery query(db);
      QVERIFY2(query.exec("CREATE TRIGGER reject_terminal BEFORE INSERT ON records "
          "WHEN NEW.kind='collections' AND NEW.payload LIKE '%\"pipelineState\":\"complete\"%' "
          "BEGIN SELECT RAISE(ABORT,'controlled terminal write failure'); END"),
          qPrintable(query.lastError().text()));
    }
    QSqlDatabase::removeDatabase(connection);
    const QString attempt = "committed-source-attempt";
    pipeline.enqueue("receipt-job", {}, {}, {{"attemptId", attempt}, {"sourceRunId", "run-1"},
      {"jobId", "receipt-job"}, {"executionRevision", ""}});
    QTRY_COMPARE_WITH_TIMEOUT(store->read("docs").size(), 1, 4000);
    const auto doc = store->read("docs")[0].toObject();
    QCOMPARE(doc["sourceAttemptId"].toString(), attempt);
    QVERIFY(doc["collectionExecutionRevision"].isString());
    QCOMPARE(store->read("collections")[0].toObject()["pipelineState"].toString(), QString("retry"));
    if (!cancel) {
      for (int n = 1; n < 5; ++n) {
        auto job = store->read("collections")[0].toObject();
        job["nextAttemptAt"] = "";
        store->save("collections", job);
        pipeline.tick();
        QTRY_COMPARE_WITH_TIMEOUT(store->read("collections")[0].toObject()["pipelineFailures"].toInt(), n + 1, 4000);
      }
      QCOMPARE(store->read("collections")[0].toObject()["pipelineState"].toString(), QString("held"));
    }
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(store->filePath()); QVERIFY(db.open());
      QSqlQuery query(db); QVERIFY(query.exec("DROP TRIGGER reject_terminal"));
    }
    QSqlDatabase::removeDatabase(connection);
    if (cancel) pipeline.cancel("receipt-job", QString{}, attempt);
    QCOMPARE(store->read("docs"), QJsonArray{doc});
    const auto receipt = store->read("collections")[0].toObject()["sourceTaskReceipt"].toObject();
    QCOMPARE(receipt["state"].toString(), QString("published"));
    QCOMPARE(receipt["researchId"], doc["id"]);
  }
  void sourceStopCannotCancelLaterManualRecognition() {
    QTemporaryDir dir;
    QDir().mkpath(dir.filePath("model"));
    for(auto name:{"model/model.bin","hold.media"}) {
      QFile f(dir.filePath(name));QVERIFY(f.open(QIODevice::WriteOnly));f.write("fixture");
    }
    auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    store->save("collections",{{"id","j"},{"title","隔离手动转写"},{"status","imported"},
      {"assetPath",dir.filePath("hold.media")},{"rightsBasis","test"}});
    CollectionPipeline pipeline(store,dir.filePath("media"));
    pipeline.enqueue("j",QCoreApplication::applicationFilePath(),dir.filePath("model"),
      {{"attemptId","source-attempt"},{"sourceRunId","run"},{"jobId","j"},{"executionRevision",""}});
    QTRY_VERIFY_WITH_TIMEOUT(QFile::exists(dir.filePath("hold.media.pid")),4000);
    pipeline.cancel("j");
    QTRY_VERIFY_WITH_TIMEOUT(pipeline.runner()->activeId().isEmpty(),4000);
    const auto receipt=store->read("collections")[0].toObject()["sourceTaskReceipt"].toObject();
    pipeline.runner()->enqueue("j",QCoreApplication::applicationFilePath(),dir.filePath("model"));
    QTRY_COMPARE_WITH_TIMEOUT(pipeline.runner()->activeId(),QString("j"),4000);
    pipeline.cancel("j",QString{},QString("source-attempt"));
    QTest::qWait(250);
    QCOMPARE(pipeline.runner()->activeId(),QString("j"));
    QCOMPARE(store->read("collections")[0].toObject()["sourceTaskReceipt"].toObject(),receipt);
    pipeline.cancel("j");
    QTRY_VERIFY_WITH_TIMEOUT(pipeline.runner()->activeId().isEmpty(),4000);
  }
  void sourceReceiptPublishesOnlyThisAttemptAndSurvivesManualRetry() {
    QTemporaryDir dir;
    auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    store->save("collections",{{"id","receipt-job"},{"title","本轮文本处理"},
      {"text","已获授权的隔离测试正文"},{"status","imported"},{"rightsBasis","test"}});
    CollectionPipeline pipeline(store,dir.filePath("media"));
    QJsonObject receipt{{"attemptId","attempt-1"},{"sourceRunId","run-1"},
      {"jobId","receipt-job"},{"executionRevision",""},{"contentId","7259684447530929443"}};
    pipeline.enqueue("receipt-job",{},{},receipt);
    QTRY_COMPARE_WITH_TIMEOUT(store->read("collections")[0].toObject()["sourceTaskReceipt"].toObject()["state"].toString(), QString("published"), 4000);
    auto job=store->read("collections")[0].toObject();
    const auto saved=job["sourceTaskReceipt"].toObject();
    QCOMPARE(saved["state"].toString(),QString("published"));
    QVERIFY(!saved["finishedAt"].toString().isEmpty());
    QCOMPARE(store->read("docs").size(),1);
    QCOMPARE(saved["researchId"],store->read("docs")[0].toObject()["id"]);
    QCOMPARE(store->read("docs")[0].toObject()["sourceAttemptId"].toString(),QString("attempt-1"));
    QVERIFY(store->read("docs")[0].toObject().contains("collectionExecutionRevision"));
    auto doc=store->read("docs")[0].toObject();doc["text"]="研究页人工修改";store->save("docs",doc);
    pipeline.enqueue("receipt-job",{},{});
    QCOMPARE(store->read("collections")[0].toObject()["sourceTaskReceipt"].toObject(),saved);
    QCOMPARE(store->read("docs")[0].toObject()["text"].toString(),QString("研究页人工修改"));
    QVERIFY(store->read("collections")[0].toObject()["pipelineAttemptId"].toString()!="attempt-1");
  }
  void oldResearchDocumentCannotSatisfyNewSourceAttempt_data() {
    QTest::addColumn<QString>("wrongIdentity");
    QTest::newRow("legacy-document") << QString("legacy");
    QTest::newRow("different-attempt") << QString("attempt");
    QTest::newRow("different-revision") << QString("revision");
  }
  void oldResearchDocumentCannotSatisfyNewSourceAttempt() {
    QFETCH(QString, wrongIdentity);
    QTemporaryDir dir;
    auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    store->save("collections",{{"id","j"},{"title","新任务"},{"text","新正文"},
                               {"status","imported"},{"rightsBasis","test"}});
    QJsonObject document{{"id","old-doc"},{"title","历史人工资料"},
                         {"text","不能被本轮冒认"},{"collectionId","j"}};
    if (wrongIdentity != "legacy") {
      document["sourceAttemptId"] = wrongIdentity == "attempt" ? "old-attempt" : "new-attempt";
      document["collectionExecutionRevision"] = wrongIdentity == "revision" ? "old-revision" : "";
    }
    const auto old=store->save("docs",document);
    CollectionPipeline pipeline(store,dir.filePath("media"));
    pipeline.enqueue("j",{},{},{{"attemptId","new-attempt"},{"sourceRunId","run"},
                               {"jobId","j"},{"executionRevision",""}});
    const auto job=store->read("collections")[0].toObject();
    QVERIFY(job["sourceTaskReceipt"].toObject()["state"]!="published");
    QVERIFY(job["pipelineState"]!="complete");
    QCOMPARE(store->read("docs"),QJsonArray{old});
    pipeline.cancel("j", QString{}, QString("new-attempt"));
    QCOMPARE(store->read("collections")[0].toObject()["sourceTaskReceipt"].toObject()["state"].toString(),
             QString("cancelled"));
    QCOMPARE(store->read("docs"),QJsonArray{old});
  }
#ifdef Q_OS_WIN
  void crashingOwnerTerminatesItsActualRecognitionChild() {
    QTemporaryDir d;
    QDir().mkpath(d.filePath("model"));
    for(auto name:{"model/model.bin","hold.media"}) {
      QFile f(d.filePath(name));QVERIFY(f.open(QIODevice::WriteOnly));f.write("fixture");
    }
    auto s=std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections",{{"id","j"},{"title","真正启动子进程的崩溃测试"},
      {"status","imported"},{"assetPath",d.filePath("hold.media")},{"rightsBasis","isolated fixture"}});
    QProcess owner;
    owner.setCreateProcessArgumentsModifier([](QProcess::CreateProcessArguments* a){a->flags |= CREATE_NO_WINDOW;});
    owner.start(QCoreApplication::applicationFilePath(),{"--run-queue",d.path()});
    QVERIFY(owner.waitForStarted(5000));
    QFile pidFile(d.filePath("hold.media.pid"));
    QTRY_VERIFY_WITH_TIMEOUT(pidFile.exists(),5000);
    QVERIFY(pidFile.open(QIODevice::ReadOnly));
    const auto pid=pidFile.readAll().toUInt();
    QVERIFY(pid>0);
    HANDLE worker=OpenProcess(SYNCHRONIZE|PROCESS_TERMINATE,FALSE,pid);
    QVERIFY(worker!=nullptr);
    // Hold the exact test child handle (not a later process that reused a PID).
    owner.kill();
    const bool ownerExited=owner.waitForFinished(5000);
    const DWORD ended=WaitForSingleObject(worker,3000);
    if(ended!=WAIT_OBJECT_0){TerminateProcess(worker,99);WaitForSingleObject(worker,2000);}
    CloseHandle(worker);
    QVERIFY(ownerExited);
    QCOMPARE(ended,DWORD(WAIT_OBJECT_0));
    CollectionPipeline next(s,d.filePath("media"));
    QVERIFY(next.ownsQueue());
    QCOMPARE(s->read("docs").size(),0);
    next.cancel("j");
  }
#endif
  void secondRunnerDoesNotInterruptOwner() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    CollectionRunner first(s);
    auto row = s->save("collections", {{"id","j"},{"title","另一个窗口正在处理"},
      {"status","running"},{"text","原文保留"},{"rightsBasis","test"}});
    CollectionRunner second(s);
    QCOMPARE(s->read("collections")[0].toObject(),row);
    QVERIFY(first.ownsQueue());
    QVERIFY(!second.ownsQueue());
    QVERIFY(!second.tryAcquireQueue());
    QVERIFY_EXCEPTION_THROWN(second.enqueue("j",{},{}),std::exception);
    QVERIFY_EXCEPTION_THROWN(second.cancel("j"),std::exception);
    QCOMPARE(s->read("collections")[0].toObject(),row);
  }
  void otherProcessCannotRecoverOrCancelActiveQueue_data() {
    QTest::addColumn<bool>("crash");
    QTest::newRow("normal-exit") << false;
    QTest::newRow("crash") << true;
  }
  void otherProcessCannotRecoverOrCancelActiveQueue() {
    QFETCH(bool,crash);
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id","j"},{"title","跨进程任务"},{"status","imported"},
      {"text","原始正文"},{"rightsBasis","isolated fixture"}});
    QProcess owner;
#ifdef Q_OS_WIN
    owner.setCreateProcessArgumentsModifier([](QProcess::CreateProcessArguments* a){a->flags |= 0x08000000;});
#endif
    owner.start(QCoreApplication::applicationFilePath(), {"--hold-queue",d.path()});
    QVERIFY(owner.waitForStarted(5000));
    QByteArray output;
    QTRY_VERIFY_WITH_TIMEOUT((output+=owner.readAllStandardOutput()).contains("READY"),5000);
    const auto before = s->read("collections");
    QCOMPARE(before[0].toObject()["status"].toString(),QString("running"));
    // A different media path must not create another owner for the same DB.
    CollectionPipeline second(s,d.filePath("other-media"));
    QVERIFY(!second.ownsQueue());
    QVERIFY(!second.tryAcquireQueue());
    QCOMPARE(s->read("collections"),before);
    second.tick();
    QCOMPARE(s->read("collections"),before);
    QCOMPARE(s->read("docs").size(),0);
    QVERIFY_EXCEPTION_THROWN(second.enqueue("j",{},{}),std::exception);
    QVERIFY_EXCEPTION_THROWN(second.cancel("j"),std::exception);
    QCOMPARE(s->read("collections"),before);
    if(crash) owner.kill(); else owner.write("exit\n");
    QVERIFY(owner.waitForFinished(5000));
    if(!crash) QCOMPARE(owner.exitCode(),0);
    second.tick(); // No implicit takeover just because the old process exited.
    QCOMPARE(s->read("collections"),before);
    QVERIFY(second.tryAcquireQueue());
    QVERIFY(second.ownsQueue());
    QCOMPARE(s->read("collections")[0].toObject()["status"].toString(),QString("interrupted"));
    second.tick();
    QCOMPARE(s->read("docs").size(),0); // Local approval is not in other-media.
    QTRY_COMPARE_WITH_TIMEOUT(s->read("collections")[0].toObject()["pipelineState"].toString(),QString("paused"),4000);
    QCOMPARE(s->read("collections")[0].toObject()["text"].toString(),QString("原始正文"));
  }
  void equivalentPathCannotCreateSecondOwnerAndOwnerRetryIsIdempotent() {
    QTemporaryDir d;
    auto s=std::make_shared<BusinessStore>(d.filePath("db"));
    CollectionPipeline first(s,d.filePath("media"));
    auto row=s->save("collections",{{"id","j"},{"title","任务"},{"status","running"},
      {"text","保留"},{"pipelineState","transcribing"},{"autoPipeline",true}});
    auto alias=std::make_shared<BusinessStore>(d.filePath("./db"));
    CollectionPipeline second(alias,d.filePath("media"));
    QVERIFY(!second.ownsQueue());
    QVERIFY(first.tryAcquireQueue());
    QCOMPARE(s->read("collections")[0].toObject(),row);
  }
  void oneActionTranscribesAndPublishesWithoutOverwriting() {
    QTemporaryDir d;
    QDir().mkpath(d.filePath("model"));
    for (auto name : {"model/model.bin", "test.mp4"}) {
      QFile f(d.filePath(name));
      QVERIFY(f.open(QIODevice::WriteOnly));
      f.write("fixture");
    }
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "j"},
                            {"title", "流水线测试"},
                            {"assetPath", d.filePath("test.mp4")},
                            {"rightsBasis", "isolated fixture"},
                            {"status", "imported"}});
    CollectionPipeline pipeline(s, d.filePath("media"));
    pipeline.enqueue("j", QCoreApplication::applicationFilePath(),
                     d.filePath("model"));
    QTRY_COMPARE_WITH_TIMEOUT(s->read("docs").size(), 1, 4000);
    QCOMPARE(s->read("collections")[0].toObject()["pipelineState"].toString(),
             QString("complete"));
    QCOMPARE(s->read("docs")[0].toObject()["text"].toString(),
             QString("原生队列识别稿"));
    auto doc = s->read("docs")[0].toObject();
    doc["text"] = "人工修订的研究稿";
    s->save("docs", doc);
    pipeline.enqueue("j", QCoreApplication::applicationFilePath(),
                     d.filePath("model"));
    pipeline.tick();
    QTest::qWait(100);
    QCOMPARE(s->read("docs").size(), 1);
    QCOMPARE(s->read("docs")[0].toObject()["text"].toString(),
             QString("人工修订的研究稿"));
  }
  void interruptionResumesOnlyEnabledJobsAndKeepsCorrection() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "j"},
                            {"title", "校对稿"},
                            {"status", "interrupted"},
                            {"rightsBasis", "test"},
                            {"text", "人工校对"},
                            {"originalText", "原文"},
                            {"autoPipeline", true},
                            {"pipelineState", "transcribing"}});
    s->save("collections", {{"id", "paused"},
                            {"title", "停止任务"},
                            {"status", "imported"},
                            {"text", "不应入库"},
                            {"autoPipeline", false},
                            {"pipelineState", "paused"}});
    approve(d.filePath("media"), "j");
    CollectionPipeline p(s, d.filePath("media"));
    p.tick();
    QTRY_COMPARE_WITH_TIMEOUT(s->read("docs").size(), 1, 3000);
    QCOMPARE(s->read("docs")[0].toObject()["text"].toString(),
             QString("人工校对"));
    QCOMPARE(s->read("collections")[0].toObject()["originalText"].toString(),
             QString("原文"));
  }
  void failedDownloadBackoffAndManualCancel() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "j"},
                            {"title", "拒绝不安全来源"},
                            {"status", "imported"},
                            {"rightsBasis", "test"},
                            {"mediaUrl", "http://127.0.0.1/no"},
                            {"autoPipeline", true},
                            {"pipelineState", "queued"}});
    approve(d.filePath("media"), "j");
    CollectionPipeline p(s, d.filePath("media"));
    p.tick();
    QTRY_COMPARE_WITH_TIMEOUT(
        s->read("collections")[0].toObject()["pipelineState"].toString(),
        QString("retry"), 3000);
    for (int i = 0; i < 5; i++) p.tick();
    QCOMPARE(s->read("collections")[0].toObject()["pipelineFailures"].toInt(),
             1);
    QVERIFY(!s->read("collections")[0]
                 .toObject()["nextAttemptAt"]
                 .toString()
                 .isEmpty());
    p.cancel("j");
    p.tick();
    QCOMPARE(s->read("collections")[0].toObject()["pipelineState"].toString(),
             QString("paused"));
    QCOMPARE(s->read("docs").size(), 0);
  }
};
int main(int argc, char** argv) {
  QCoreApplication app(argc, argv);
  QStandardPaths::setTestModeEnabled(true);
  if (app.arguments().contains("--run-queue")) {
    const auto root=app.arguments().value(app.arguments().indexOf("--run-queue")+1);
    auto s=std::make_shared<BusinessStore>(root+"/db");
    CollectionPipeline owner(s,root+"/media");
    owner.enqueue("j",QCoreApplication::applicationFilePath(),root+"/model");
    QTimer::singleShot(20000,&app,&QCoreApplication::quit);
    return app.exec();
  }
  if (app.arguments().contains("--hold-queue")) {
    const auto root=app.arguments().value(app.arguments().indexOf("--hold-queue")+1);
    auto s=std::make_shared<BusinessStore>(root+"/db");
    CollectionPipeline owner(s,root+"/media");
    auto row=s->read("collections")[0].toObject();
    row["status"]="running";row["autoPipeline"]=true;row["pipelineState"]="transcribing";
    s->save("collections",row);
    QTextStream(stdout)<<"READY\n"<<Qt::flush;
    QTextStream input(stdin);input.readLine();
    return 0;
  }
  if (app.arguments().contains("--media")) {
    const auto media=app.arguments().value(app.arguments().indexOf("--media")+1);
    if(media.endsWith("hold.media")) {
      QSaveFile pid(media+".pid");
      if(!pid.open(QIODevice::WriteOnly))return 7;
      pid.write(QByteArray::number(app.applicationPid()));
      if(!pid.commit())return 8;
      QTimer::singleShot(15000,&app,&QCoreApplication::quit);
      return app.exec();
    }
    QTextStream(stdout) << QString::fromUtf8(
        R"({"transcript":"原生队列识别稿","durationSeconds":2,"segments":[{"start":0,"end":1,"text":"原生队列识别稿"}]})");
    return 0;
  }
  PipelineTests t;
  return QTest::qExec(&t, argc, argv);
}
#include "collection_pipeline_tests.moc"
