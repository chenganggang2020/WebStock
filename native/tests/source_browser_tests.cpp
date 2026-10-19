#include <QTemporaryDir>
#include <QtTest>

#include "source_browser.hpp"
class SourceBrowserTests : public QObject {
  Q_OBJECT
 private slots:
  void strictNavigation() {
    QVERIFY(SourceBrowser::allowed(QUrl("https://www.douyin.com/user/abcdef")));
    QVERIFY(SourceBrowser::allowed(
        QUrl("https://www.douyin.com/video/7259684447530929443")));
    for (auto url :
         {"http://www.douyin.com/", "https://www.douyin.com.evil.test/",
          "file:///C:/secret", "https://user@www.douyin.com/",
          "https://www.douyin.com:444/"})
      QVERIFY(!SourceBrowser::allowed(QUrl(url)));
  }
  void isolatedEngineStartsAndRejectsExternalNavigation() {
    QTemporaryDir profile;
    SourceBrowser browser;
    browser.resize(900, 700);
    browser.show();
    QSignalSpy ready(&browser, &SourceBrowser::ready),
        fail(&browser, &SourceBrowser::failure);
    browser.initialize(profile.path());
    QTRY_VERIFY_WITH_TIMEOUT(ready.count() || fail.count(), 20000);
    QVERIFY2(ready.count(),
             qPrintable(fail.isEmpty() ? QString("not ready")
                                       : fail.first().first().toString()));
    browser.navigate(QUrl("file:///C:/Windows/win.ini"));
    QCOMPARE(fail.count(), 1);
  }
};
QTEST_MAIN(SourceBrowserTests)
#include "source_browser_tests.moc"
