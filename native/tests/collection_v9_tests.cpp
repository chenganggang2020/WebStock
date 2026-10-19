#include <QTemporaryDir>
#include <QFile>
#include <QTextStream>
#include <QStandardPaths>
#include <QtTest>

#include "collection_runner.hpp"
class CollectionV9Tests : public QObject {
  Q_OBJECT
 private slots:
  void strictResult() {
    auto o = CollectionRunner::decode(
        R"({"transcript":"真实测试原文","durationSeconds":3,"segments":[{"start":0,"end":2,"text":"真实测试原文"}]})");
    QCOMPARE(o["transcript"].toString(), QString("真实测试原文"));
    QVERIFY_EXCEPTION_THROWN(CollectionRunner::decode("{}"), std::exception);
    QVERIFY_EXCEPTION_THROWN(
        CollectionRunner::decode(
            R"({"transcript":"x","durationSeconds":1,"segments":[{"start":2,"end":1,"text":"x"}]})"),
        std::exception);
  }
  void recoverAndPublish() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "j"},
                            {"title", "授权文稿"},
                            {"status", "running"},
                            {"text", "校对后的内容"},
                            {"originalText", "识别原稿"},
                            {"sourceUrl", "https://example.org/evidence"}});
    {
      CollectionRunner r(s);
      QCOMPARE(s->read("collections")[0].toObject()["status"].toString(),
               QString("interrupted"));
    }
    auto doc = publishCollection(s, "j");
    QCOMPARE(doc["text"].toString(), QString("校对后的内容"));
    QCOMPARE(doc["verification"].toString(),QString("unverified"));
    QCOMPARE(doc["qualitySnapshot"].toObject()["bodyHash"].toString(),collectionQuality::bodyHash("校对后的内容"));
    QVERIFY(!doc["qualitySnapshot"].toObject()["eligibleForAnalysis"].toBool());
    QCOMPARE(s->read("collections")[0].toObject()["originalText"].toString(),
             QString("识别原稿"));
    doc["text"] = "人工修改";
    s->save("docs", doc);
    QVERIFY_EXCEPTION_THROWN(publishCollection(s, "j"), std::exception);
    QCOMPARE(s->read("docs")[0].toObject()["text"].toString(),
             QString("人工修改"));
  }
  void rejectBeforeStartingProcess() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "j"},
                            {"title", "未授权"},
                            {"status", "imported"},
                            {"assetPath", "missing.mp4"}});
    CollectionRunner r(s);
    QVERIFY_EXCEPTION_THROWN(r.enqueue("j", "missing.exe", "missing-model"),
                             std::exception);
    QVERIFY(r.activeId().isEmpty());
  }
  void cancelRetryAndRestartPreserveOriginal() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    QDir().mkpath(d.filePath("model"));
    for (const auto& name : {"model/model.bin", "wait.media", "success.media", "failure.media"}) {
      QFile f(d.filePath(name));
      QVERIFY(f.open(QIODevice::WriteOnly));
    }
    auto create = [&](const QString& id, const QString& media) {
      s->save("collections", {{"id",id},{"title",id},{"rightsBasis","isolated test"},
        {"assetPath",d.filePath(media)}, {"text","已校对稿"},{"originalText","保留原稿"},{"status","imported"}});
    };
    auto job = [&](const QString& id) {
      for (auto v : s->read("collections")) if (v.toObject()["id"] == id) return v.toObject();
      return QJsonObject();
    };
    create("active", "wait.media"); create("queued", "wait.media"); create("retry", "failure.media");
    {
      CollectionRunner r(s);
      auto enqueue = [&](const QString& id) {r.enqueue(id, QCoreApplication::applicationFilePath(),d.filePath("model"));};
      enqueue("active"); enqueue("queued");
      QVERIFY_EXCEPTION_THROWN(enqueue("active"),std::exception);
      QVERIFY_EXCEPTION_THROWN(enqueue("queued"),std::exception);
      r.cancel("queued"); QCOMPARE(job("queued")["status"].toString(),QString("cancelled"));
      QTest::qWait(100);
      r.cancel("active");
      QTRY_COMPARE_WITH_TIMEOUT(job("active")["status"].toString(),QString("cancelled"),5000);
      enqueue("retry");
      QTRY_COMPARE_WITH_TIMEOUT(job("retry")["status"].toString(),QString("failed"),5000);
      auto j = job("retry"); j["assetPath"]=d.filePath("success.media"); s->save("collections",j);
      enqueue("retry");
      QTRY_COMPARE_WITH_TIMEOUT(job("retry")["status"].toString(),QString("completed"),5000);
      QCOMPARE(job("retry")["asrText"].toString(),QString("新的识别稿"));
      QCOMPARE(job("retry")["text"].toString(),QString("已校对稿"));
      QCOMPARE(job("retry")["originalText"].toString(),QString("保留原稿"));
      enqueue("active"); enqueue("queued");
    }
    QCOMPARE(job("active")["status"].toString(),QString("interrupted"));
    QCOMPARE(job("queued")["status"].toString(),QString("interrupted"));
  }
};
int main(int argc,char** argv) {
  QCoreApplication app(argc,argv);
  if (app.arguments().contains("--media")) {
    const auto args=app.arguments(); auto media=args.value(args.indexOf("--media")+1);
    if (media.endsWith("wait.media")) {QThread::sleep(30);return 2;}
    if (media.endsWith("failure.media")) {QTextStream(stderr)<<"controlled worker failure";return 1;}
    QTextStream(stdout)<<QString::fromUtf8(R"({"transcript":"新的识别稿","durationSeconds":2,"segments":[{"start":0,"end":1,"text":"新的识别稿"}]})");
    return 0;
  }
  QStandardPaths::setTestModeEnabled(true);
  CollectionV9Tests test;return QTest::qExec(&test,argc,argv);
}
#include "collection_v9_tests.moc"
