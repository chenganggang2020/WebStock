#include <QFile>
#include <QSettings>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTextStream>
#include <QtTest>

#include "collection_pipeline.hpp"

class PipelineRestoreTests : public QObject {
  Q_OBJECT
 private slots:
  void importedAutoFlagDoesNotAuthorizePublication_data() {
    QTest::addColumn<QString>("pipelineState");
    for (const auto& state : {"queued", "retry", "transcribing", "publishing"})
      QTest::newRow(state) << QString(state);
  }
  void importedAutoFlagDoesNotAuthorizePublication() {
    QFETCH(QString, pipelineState);
    QTemporaryDir d;
    QVERIFY(d.isValid());
    auto source = std::make_shared<BusinessStore>(d.filePath("source.sqlite"));
    source->save("collections",
                 {{"id", "imported-unapproved"},
                  {"title", "外来备份文稿"},
                  {"status", "interrupted"},
                  {"rightsBasis", "imported claim, not device approval"},
                  {"text", "保留此文稿但不能自动入研究库"},
                  {"originalText", "原始文稿"},
                  {"autoPipeline", true},
                  {"pipelineState", pipelineState}});
    auto restored =
        std::make_shared<BusinessStore>(d.filePath("restored.sqlite"));
    restored->restore(source->backup());

    // Opening the page and ticking its scheduler are not approval to execute
    // imported jobs. The destination device has never called enqueue().
    CollectionPipeline pipeline(restored, d.filePath("archive"));
    pipeline.tick();
    QTest::qWait(100);

    QCOMPARE(restored->read("docs").size(), 0);
    const auto job = restored->read("collections")[0].toObject();
    QCOMPARE(job["text"].toString(), QString("保留此文稿但不能自动入研究库"));
    QCOMPARE(job["originalText"].toString(), QString("原始文稿"));
    QVERIFY(pipeline.runner()->activeId().isEmpty());
  }
  void importedExecutablePathCannotStartProcess() {
    QTemporaryDir d;
    QVERIFY(d.isValid());
    QVERIFY(QDir().mkpath(d.filePath("model")));
    for (const auto& name : {"model/model.bin", "probe.media"}) {
      QFile file(d.filePath(name));
      QVERIFY(file.open(QIODevice::WriteOnly));
      QCOMPARE(file.write("isolated fixture"), qint64(16));
    }
    auto source = std::make_shared<BusinessStore>(d.filePath("source.sqlite"));
    source->save("collections",
                 {{"id", "imported-process"},
                  {"title", "导入的引擎路径不可信"},
                  {"status", "imported"},
                  {"rightsBasis", "imported claim, not device approval"},
                  {"assetPath", d.filePath("probe.media")},
                  {"pipelinePython", QCoreApplication::applicationFilePath()},
                  {"pipelineModel", d.filePath("model")},
                  {"autoPipeline", true},
                  {"pipelineState", "queued"}});
    auto restored =
        std::make_shared<BusinessStore>(d.filePath("restored.sqlite"));
    restored->restore(source->backup());

    CollectionPipeline pipeline(restored, d.filePath("archive"));
    pipeline.tick();
    const bool startedWithoutDeviceApproval =
        !pipeline.runner()->activeId().isEmpty();
    QTest::qWait(1000);

    QVERIFY2(!QFile::exists(d.filePath("probe.media.started")),
             "Opening imported business records executed an unapproved "
             "executable path");
    QVERIFY2(!startedWithoutDeviceApproval,
             "Import must not authorize the ASR queue on this device");
    QCOMPARE(restored->read("docs").size(), 0);
  }
};

int main(int argc, char** argv) {
  QCoreApplication app(argc, argv);
  if (app.arguments().contains("--media")) {
    // The only subprocess in this test is this executable itself. It writes
    // one harmless marker beside the test-owned media, never calls a shell,
    // never downloads anything, and never touches a production database.
    const auto args = app.arguments();
    const auto media = args.value(args.indexOf("--media") + 1);
    if (!media.endsWith("/probe.media") && !media.endsWith("\\probe.media"))
      return 2;
    QFile marker(media + ".started");
    if (!marker.open(QIODevice::WriteOnly)) return 3;
    marker.write("unapproved self-process started");
    marker.close();
    QTextStream(stdout)
        << R"({"transcript":"probe","durationSeconds":2,"segments":[{"start":0,"end":1,"text":"probe"}]})";
    return 0;
  }
  QTemporaryDir localSettings;
  if (!localSettings.isValid()) return 4;
  QStandardPaths::setTestModeEnabled(true);
  QCoreApplication::setOrganizationName("NativePipelineRestoreTests");
  QCoreApplication::setApplicationName(
      "UnapprovedImport-" + QUuid::createUuid().toString(QUuid::Id128));
  QSettings::setDefaultFormat(QSettings::IniFormat);
  QSettings::setPath(QSettings::IniFormat, QSettings::UserScope,
                     localSettings.path());
  QSettings::setPath(QSettings::IniFormat, QSettings::SystemScope,
                     localSettings.path());
  PipelineRestoreTests test;
  return QTest::qExec(&test, argc, argv);
}

#include "pipeline_restore_tests.moc"
