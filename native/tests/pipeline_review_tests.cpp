#include <QPushButton>
#include <QSettings>
#include <QSignalSpy>
#include <QSqlQuery>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTextStream>
#include <QtTest>

#include "collection_page.hpp"
#include "collection_pipeline.hpp"

class PipelineReviewTests : public QObject {
  Q_OBJECT
  QJsonObject job(const std::shared_ptr<BusinessStore>& store) {
    return store->read("collections")[0].toObject();
  }
  void setupMedia(const QTemporaryDir& d) {
    QDir().mkpath(d.filePath("model"));
    for (auto name : {"model/model.bin", "hold.media"}) {
      QFile f(d.filePath(name));
      if (!f.open(QIODevice::WriteOnly))
        qFatal("Cannot create isolated media fixture");
      f.write("fixture");
    }
  }
  void addMediaJob(const std::shared_ptr<BusinessStore>& store,
                   const QTemporaryDir& d) {
    store->save("collections", {{"id", "j"},
                                {"title", "隔离自动任务"},
                                {"assetPath", d.filePath("hold.media")},
                                {"rightsBasis", "isolated test"},
                                {"status", "imported"}});
  }
 private slots:
  void cancelledApprovalCannotAuthorizeReplacementFromBackup() {
    QTemporaryDir d;
    QVERIFY(d.isValid());
    setupMedia(d);
    auto store = std::make_shared<BusinessStore>(d.filePath("db.sqlite"));
    addMediaJob(store, d);
    {
      CollectionPipeline pipeline(store, d.filePath("archive"));
      pipeline.enqueue("j", QCoreApplication::applicationFilePath(),
                       d.filePath("model"));
      QTRY_VERIFY_WITH_TIMEOUT(QFile::exists(d.filePath("hold.media.started")),
                               4000);
      pipeline.cancel("j");
      QTRY_VERIFY_WITH_TIMEOUT(pipeline.runner()->activeId().isEmpty(), 4000);
      QCOMPARE(store->read("docs").size(), 0);
    }
    auto incoming = store->backup();
    auto replacement = job(store);
    replacement["title"] = "同ID外来备份的替换记录";
    replacement["text"] = "未批准的新内容不能借用旧任务权限";
    replacement["autoPipeline"] = true;
    replacement["pipelineState"] = "queued";
    incoming["collections"] = QJsonArray{replacement};
    store->restore(incoming);

    CollectionPipeline reopened(store, d.filePath("archive"));
    reopened.tick();
    QTest::qWait(100);
    QCOMPARE(store->read("docs").size(), 0);
  }
  void stopSelectedButtonStopsAutomaticJobInsteadOfSchedulingRetry() {
    QTemporaryDir d;
    QVERIFY(d.isValid());
    setupMedia(d);
    auto store = std::make_shared<BusinessStore>(d.filePath("db.sqlite"));
    addMediaJob(store, d);
    CollectionPipeline pipeline(store, d.filePath("archive"));
    std::unique_ptr<QWidget> page(collectionPage(store, nullptr, &pipeline));
    auto stop = page->findChild<QPushButton*>("cancelTranscription");
    QVERIFY(stop);
    pipeline.enqueue("j", QCoreApplication::applicationFilePath(),
                     d.filePath("model"));
    QTRY_VERIFY_WITH_TIMEOUT(QFile::exists(d.filePath("hold.media.started")),
                             4000);
    stop->click();
    QTRY_VERIFY_WITH_TIMEOUT(pipeline.runner()->activeId().isEmpty(), 4000);
    QVERIFY2(!job(store)["autoPipeline"].toBool(),
             "Stop selected task must not leave an automatic retry enabled");
    QCOMPARE(job(store)["pipelineState"].toString(), QString("paused"));
  }
  void failedStatusPersistenceDoesNotCreateZeroDelayRetryLoop() {
    QTemporaryDir d;
    QVERIFY(d.isValid());
    auto store = std::make_shared<BusinessStore>(d.filePath("db.sqlite"));
    store->save("collections", {{"id", "j"},
                                {"title", "写盘失败"},
                                {"rightsBasis", "isolated test"},
                                {"status", "imported"},
                                {"text", "文稿"},
                                {"autoPipeline", true},
                                {"pipelineState", "queued"}});
    // Simulate an already-authorized local task, then a persistent write error.
    QSettings permissions(d.filePath("archive/queue-settings.ini"),
                          QSettings::IniFormat);
    const auto key =
        "approved/" +
        QString::fromLatin1(
            QCryptographicHash::hash("j", QCryptographicHash::Sha256).toHex()) +
        "/";
    permissions.setValue(key + "id", "j");
    permissions.sync();
    QCOMPARE(permissions.status(), QSettings::NoError);
    const auto connection =
        "fault-" + QUuid::createUuid().toString(QUuid::Id128);
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(d.filePath("db.sqlite"));
      QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(q.exec(
          "CREATE TRIGGER reject_collection_writes BEFORE INSERT ON records "
          "WHEN NEW.kind='collections' BEGIN SELECT RAISE(ABORT,'simulated "
          "persistent write failure'); END"));
      db.close();
    }
    QSqlDatabase::removeDatabase(connection);
    CollectionPipeline pipeline(store, d.filePath("archive"));
    QSignalSpy changed(&pipeline, &CollectionPipeline::changed);
    pipeline.tick();
    QTest::qWait(100);
    QVERIFY2(
        changed.size() <= 3,
        qPrintable(
            QString("Persistent storage failure re-entered %1 times in 100ms")
                .arg(changed.size())));
    QCOMPARE(store->read("docs").size(), 0);
  }
  void cancelTerminatesWorkerEvenWhenStatusCannotBeSaved_data() {
    QTest::addColumn<bool>("boundRevision");
    QTest::newRow("manual-stop") << false;
    QTest::newRow("source-owned-stop") << true;
  }
  void cancelTerminatesWorkerEvenWhenStatusCannotBeSaved() {
    QFETCH(bool, boundRevision);
    QTemporaryDir d;
    QVERIFY(d.isValid());
    setupMedia(d);
    auto store = std::make_shared<BusinessStore>(d.filePath("db.sqlite"));
    addMediaJob(store, d);
    CollectionPipeline pipeline(store, d.filePath("archive"));
    pipeline.enqueue("j", QCoreApplication::applicationFilePath(),
                     d.filePath("model"));
    QTRY_VERIFY_WITH_TIMEOUT(QFile::exists(d.filePath("hold.media.started")),
                             4000);
    const auto connection =
        "cancel-fault-" + QUuid::createUuid().toString(QUuid::Id128);
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(d.filePath("db.sqlite"));
      QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(q.exec(
          "CREATE TRIGGER reject_collection_writes BEFORE INSERT ON records "
          "WHEN NEW.kind='collections' BEGIN SELECT RAISE(ABORT,'simulated "
          "persistent write failure'); END"));
      db.close();
    }
    QSqlDatabase::removeDatabase(connection);
    try {
      pipeline.cancel(
          "j", boundRevision ? std::optional<QString>("") : std::nullopt);
    } catch (const std::exception&) {
    }
    QTRY_VERIFY_WITH_TIMEOUT(pipeline.runner()->activeId().isEmpty(), 1000);
  }
  void runningWorkerCannotCommitIntoRestoredReplacementWithSameId() {
    QTemporaryDir d;
    QVERIFY(d.isValid());
    setupMedia(d);
    const auto media = d.filePath("replacement.media");
    QFile fixture(media);
    QVERIFY(fixture.open(QIODevice::WriteOnly));
    fixture.write("isolated worker fixture");
    fixture.close();
    auto store = std::make_shared<BusinessStore>(d.filePath("db.sqlite"));
    store->save("collections", {{"id", "j"},
                                {"title", "开始时的已授权任务"},
                                {"assetPath", media},
                                {"rightsBasis", "isolated test"},
                                {"status", "imported"}});
    CollectionPipeline pipeline(store, d.filePath("archive"));
    pipeline.enqueue("j", QCoreApplication::applicationFilePath(),
                     d.filePath("model"));
    QTRY_VERIFY_WITH_TIMEOUT(QFile::exists(media + ".started"), 4000);

    auto incoming = store->backup();
    auto replacement = job(store);
    replacement["title"] = "运行中恢复的同ID外来记录";
    replacement["text"] = "外来记录的正文，不是识别任务的结果";
    replacement["originalText"] = "外来原稿";
    // A copied backup can reproduce the old execution fields; it is still a
    // different record revision and cannot inherit the in-flight operation.
    incoming["collections"] = QJsonArray{replacement};
    store->restore(incoming);
    QFile release(media + ".release");
    QVERIFY(release.open(QIODevice::WriteOnly));
    release.write("release controlled worker");
    release.close();
    QTRY_VERIFY_WITH_TIMEOUT(pipeline.runner()->activeId().isEmpty(), 4000);

    const auto actual = job(store);
    QVERIFY2(!actual.contains("asrResult"),
             "Old worker committed recognition output into an imported "
             "replacement record");
    QCOMPARE(actual["text"].toString(),
             QString("外来记录的正文，不是识别任务的结果"));
    QCOMPARE(actual["originalText"].toString(), QString("外来原稿"));
    QCOMPARE(store->read("docs").size(), 0);
  }
};

int main(int argc, char** argv) {
  if (argc > 1 && QString::fromLocal8Bit(argv[1]) == "-X") {
    QCoreApplication app(argc, argv);
    const auto args = app.arguments();
    const auto media = args.value(args.indexOf("--media") + 1);
    if (!media.endsWith("hold.media") && !media.endsWith("replacement.media"))
      return 2;
    QFile marker(media + ".started");
    if (!marker.open(QIODevice::WriteOnly)) return 3;
    marker.write("harmless isolated worker started");
    marker.close();
    if (media.endsWith("replacement.media")) {
      for (int i = 0; i < 800 && !QFile::exists(media + ".release"); ++i)
        QThread::msleep(10);
      if (!QFile::exists(media + ".release")) return 4;
      QTextStream(stdout)
          << R"({"transcript":"old worker output","durationSeconds":2,"segments":[{"start":0,"end":1,"text":"old worker output"}]})";
      return 0;
    }
    QThread::sleep(10);
    return 0;
  }
  qputenv("QT_QPA_PLATFORM", "offscreen");
  QApplication app(argc, argv);
  QStandardPaths::setTestModeEnabled(true);
  QCoreApplication::setOrganizationName("PipelineReviewTests");
  QCoreApplication::setApplicationName(
      "Isolated-" + QUuid::createUuid().toString(QUuid::Id128));
  PipelineReviewTests test;
  return QTest::qExec(&test, argc, argv);
}

#include "pipeline_review_tests.moc"
