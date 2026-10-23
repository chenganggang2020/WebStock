#include <QTemporaryDir>
#include <QtTest>
#include <QtWidgets>

#include "collection_page.hpp"
#include "collection_runner.hpp"
#include "collection_pipeline.hpp"
class CollectionLiveV9Tests : public QObject {
  Q_OBJECT
 private slots:
  void initTestCase() {
    QStandardPaths::setTestModeEnabled(true);
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("CollectionLive-" + QUuid::createUuid().toString(QUuid::WithoutBraces));
  }
  void cleanupTestCase() { QSettings settings; settings.clear(); settings.sync(); }
  void localMediaThroughNativePage() {
    auto media = qEnvironmentVariable("ASR_MEDIA"),
         python = qEnvironmentVariable("ASR_PYTHON"),
         model = qEnvironmentVariable("ASR_MODEL"),
         shots = qEnvironmentVariable("ASR_SHOTS");
    QVERIFY2(!media.isEmpty() && !python.isEmpty() && !model.isEmpty(),
             "Explicit local media/model/engine paths required");
    QTemporaryDir dir;
    auto s = std::make_shared<BusinessStore>(dir.filePath("db"));
    s->save("collections", {{"id", "real-media"},
                            {"title", "本机现有视频转写核验"},
                            {"assetPath", media},
                            {"rightsBasis", "用户授权核验本机既有采集媒体"},
                            {"status", "imported"}});
    CollectionPipeline pipeline(s,dir.filePath("media"));
    std::unique_ptr<QWidget> p(collectionPage(s, nullptr,&pipeline));
    p->resize(1450, 920);
    p->show();
    QTest::qWait(200);
    p->findChild<QLineEdit*>("collectionPython")->setText(python);
    p->findChild<QLineEdit*>("collectionModel")->setText(model);
    bool automatic=qEnvironmentVariableIsSet("ASR_PIPELINE");
    QTest::mouseClick(p->findChild<QPushButton*>(automatic?"startCollectionPipeline":"startTranscription"),
                      Qt::LeftButton);
    QVERIFY2(s->read("collections")[0].toObject()["status"] != "imported",
             qPrintable(p->findChild<QLabel*>("collectionState")->text()));
    QTRY_VERIFY_WITH_TIMEOUT(
        s->read("collections")[0].toObject()["status"] != "running" &&
            s->read("collections")[0].toObject()["status"] != "queued",
        180000);
    auto result = s->read("collections")[0].toObject();
    QVERIFY2(result["status"] == "completed",
             qPrintable(result["error"].toString()));
    QVERIFY(result["asrResult"].toObject()["segments"].toArray().size() > 0);
    if(automatic){
      QTRY_COMPARE(s->read("docs").size(),1);
      QCOMPARE(s->read("collections")[0].toObject()["pipelineState"].toString(),QString("complete"));
      auto doc=s->read("docs")[0].toObject();doc["text"]=doc["text"].toString()+"\n[研究页人工修订保留验证]";s->save("docs",doc);
      QTest::mouseClick(p->findChild<QPushButton*>("startCollectionPipeline"),Qt::LeftButton);
      QCOMPARE(s->read("docs").size(),1);QVERIFY(s->read("docs")[0].toObject()["text"].toString().contains("人工修订"));
    }
    auto edit = p->findChild<QPlainTextEdit*>("collectionText");
    QVERIFY(!edit->toPlainText().isEmpty());
    edit->appendPlainText("\n[校对记录：本机实际转写流程核验]");
    QTest::mouseClick(p->findChild<QPushButton*>("saveCollection"),
                      Qt::LeftButton);
    if(!automatic) QTest::mouseClick(p->findChild<QPushButton*>("publishCollection"),
                      Qt::LeftButton);
    QCOMPARE(s->read("docs").size(), 1);
    QVERIFY(
        s->read("docs")[0].toObject()["text"].toString().contains(automatic?"人工修订":"校对记录"));
    QCOMPARE(s->read("collections")[0].toObject()["originalText"],
             result["asrText"]);
    if (!shots.isEmpty()) {
      QDir().mkpath(shots);
      QVERIFY(p->grab().save(shots + "/desktop-local-transcription.png"));
    }
    p.reset();
    p.reset(collectionPage(s, nullptr,&pipeline));
    p->resize(1450, 920);
    p->show();
    QTest::qWait(100);
    QVERIFY(p->findChild<QPlainTextEdit*>("collectionText")
                ->toPlainText()
                .contains("校对记录"));
    qInfo() << "Actual local ASR, correction, publication, reopen verified. "
               "Segments:"
            << result["asrResult"].toObject()["segments"].toArray().size();
  }
};
QTEST_MAIN(CollectionLiveV9Tests)
#include "collection_live_v9_tests.moc"
