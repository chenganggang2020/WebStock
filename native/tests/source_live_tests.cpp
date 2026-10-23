#include <QSaveFile>
#include <QScreen>
#include <QtTest>

#include "source_browser.hpp"
#include "source_page.hpp"

// Explicit opt-in observation, not part of deterministic CTest or proof of
// collection success.
class SourceLiveTests : public QObject {
  Q_OBJECT
 private slots:
  void publicProfileInSeparateSession() {
    const auto out = qEnvironmentVariable("NATIVE_SOURCE_EVIDENCE");
    QVERIFY(QDir::isAbsolutePath(out));
    QVERIFY(QDir().mkpath(out));
    SourceBrowser browser;
    browser.setWindowTitle("原生来源验证 · 不读取旧登录");
    browser.resize(1300, 900);
    browser.show();
    QSignalSpy ready(&browser, &SourceBrowser::ready),
        failure(&browser, &SourceBrowser::failure),
        loaded(&browser, &SourceBrowser::loaded),
        snapshot(&browser, &SourceBrowser::snapshot);
    browser.initialize(out + "/isolated-session");
    QTRY_VERIFY_WITH_TIMEOUT(!ready.isEmpty() || !failure.isEmpty(), 20000);
    QVERIFY2(!ready.isEmpty(), "Independent browser runtime did not start");
    const QUrl profile(
        "https://www.douyin.com/user/"
        "MS4wLjABAAAAK713M9d8PGNb_WiMYf7yKhOI5y60H4uELJK2guDjJT0");
    browser.navigate(profile);
    QTRY_VERIFY_WITH_TIMEOUT(!loaded.isEmpty() || !failure.isEmpty(), 35000);
    QTest::qWait(6000);
    browser.capture();
    QTRY_VERIFY_WITH_TIMEOUT(!snapshot.isEmpty() || !failure.isEmpty(), 16000);
    QJsonObject observation{
        {"checkedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODate)},
        {"profileUrl", profile.toString()},
        {"independentSession", true},
        {"collectionOrDownloadStarted", false},
        {"navigationCompleted", !loaded.isEmpty()},
        {"loadSucceeded", !loaded.isEmpty() && loaded.last()[1].toBool()}};
    QJsonArray errors;
    for (auto row : failure) errors.append(row.first().toString());
    observation["errors"] = errors;
    if (!snapshot.isEmpty()) {
      const auto page = snapshot.last().first().toJsonObject();
      observation["pageType"] = page["pageType"];
      observation["loginHeuristic"] = page["loggedIn"];
      observation["loadError"] = page["loadError"];
      observation["visibleItems"] = page["items"].toArray().size();
      observation["authorName"] = page["profile"].toObject()["displayName"];
      observation["authorProfile"] = page["profile"].toObject()["profileUrl"];
      // Never persist cookies, HTML, media query strings or platform session
      // identifiers.
    }
    QSaveFile file(out + "/source-live-observation.json");
    QVERIFY(file.open(QIODevice::WriteOnly));
    file.write(QJsonDocument(observation).toJson());
    QVERIFY(file.commit());
    QVERIFY(browser.screen()
                ->grabWindow(browser.winId())
                .save(out + "/source-live.png"));
  }
};
int main(int argc, char** argv) {
  QApplication app(argc, argv);
  app.setOrganizationName("NativeMarketReviewTests");
  app.setApplicationName("SourceLiveInspection");
  if (qEnvironmentVariable("NATIVE_SOURCE_INSPECT") == "1") {
    const auto out = qEnvironmentVariable("NATIVE_SOURCE_EVIDENCE");
    if (!QDir::isAbsolutePath(out)) return 2;
    auto store = std::make_shared<BusinessStore>(out + "/inspection.sqlite");
    CollectionPipeline pipeline(store, out + "/inspection-media");
    SourcePage page(store, &pipeline);
    page.setWindowTitle("原生来源子页 v12 · 隔离验证 · 不写旧数据库");
    page.resize(1500, 950);
    page.findChild<QLineEdit*>("sourceProfileUrl")
        ->setText(
            "https://www.douyin.com/user/"
            "MS4wLjABAAAAK713M9d8PGNb_WiMYf7yKhOI5y60H4uELJK2guDjJT0");
    page.findChild<QLineEdit*>("sourceRights")->clear();
    page.show();
    return app.exec();
  }
  SourceLiveTests tests;
  return QTest::qExec(&tests, argc, argv);
}
#include "source_live_tests.moc"
