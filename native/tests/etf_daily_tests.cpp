#include "etf_daily.hpp"
#include <QFile>
#include <QTemporaryDir>
#include <QtTest>
class EtfDailyTests : public QObject {
  Q_OBJECT
  QString html;
  QJsonObject item{{"code", "202609103869906865"},
                   {"title", "ETF追踪丨9月9日股票型ETF净赎回20亿元"},
                   {"stime", "2026-09-10 08:00:59"},
                   {"source", "东方财富Choice数据"}};
  QDateTime now = QDateTime::fromString("2026-09-10T01:30:00Z", Qt::ISODate);
private slots:
  void initTestCase() {
    QFile f(
        QFINDTESTDATA("../../test/fixtures/eastmoney-etf-daily-20260910.html"));
    QVERIFY(f.open(QIODevice::ReadOnly));
    html = QString::fromUtf8(f.readAll());
  }
  void fixedCatalogAndLinkIdentity() {
    QVERIFY(etfDaily::catalogUrl(123).contains("code=etfzz2026"));
    QVERIFY(etfDaily::allowedUrl(etfDaily::catalogUrl(123)));
    QVERIFY(
        etfDaily::allowedUrl(etfDaily::articleUrl(item["code"].toString())));
    for (auto s : {"https://evil.test/a/202609103869906865.html",
                   "http://wap.eastmoney.com/a/202609103869906865.html",
                   "https://user@wap.eastmoney.com/a/202609103869906865.html",
                   "https://wap.eastmoney.com/a/202609103869906865.html?x=1"})
      QVERIFY(!etfDaily::allowedUrl(s));
    QJsonObject unrelated = item;
    unrelated["title"] = "其他ETF公告";
    auto items = etfDaily::catalog(
        {{"success", 1},
         {"data", QJsonObject{{"elements",
                               QJsonArray{QJsonObject{
                                   {"type", "NewsList"},
                                   {"data", QJsonArray{unrelated, item}}}}}}}});
    QCOMPARE(items.size(), 1);
    QCOMPARE(items[0].toObject(), item);
    auto early = item, late = item;
    early["stime"] = "2026-09-10T08:00:59";
    late["stime"] = "2026-09-10 09:00:59";
    items = etfDaily::catalog(
        {{"success", 1},
         {"data",
          QJsonObject{{"elements", QJsonArray{QJsonObject{
                                       {"type", "NewsList"},
                                       {"data", QJsonArray{early, late}}}}}}}});
    QCOMPARE(items[0].toObject(), late);
  }
  void publicContentIdentityAndNoRestrictionBypass() {
    const QString url = etfDaily::contentUrl(item["code"].toString());
    QVERIFY(etfDaily::allowedUrl(url));
    QVERIFY(!etfDaily::allowedUrl(url + "&source=other"));
    QJsonObject news{{"newsid", item["code"]},
                     {"title", item["title"]},
                     {"source", item["source"]},
                     {"showtime", item["stime"]},
                     {"body", html},
                     {"blockClients", ""},
                     {"images", QJsonArray{}}};
    QJsonObject payload{{"rc", 1}, {"news", news}};
    auto r = etfDaily::content(payload, item, now);
    QCOMPARE(r["stockEtfNetFlow"].toDouble(), -19.87);
    QCOMPARE(r["sourceVerification"].toString(),
             QString("catalog+official-content-api"));
    for (auto pair : QList<QPair<QString, QJsonValue>>{
             {"newsid", "202609103869906866"},
             {"source", "其他来源"},
             {"title", "ETF追踪丨9月9日不同正文"},
             {"showtime", "2026-09-10 09:00:59"},
             {"blockClients", "em"},
             {"aiContUrl", "https://elsewhere.test"},
             {"aiCont", QJsonObject{{"content", "other"}}},
             {"body", ""}}) {
      auto bad = news;
      bad[pair.first] = pair.second;
      QVERIFY_EXCEPTION_THROWN(
          etfDaily::content({{"rc", 1}, {"news", bad}}, item, now),
          std::exception);
    }
    payload["rc"] = 0;
    QVERIFY_EXCEPTION_THROWN(etfDaily::content(payload, item, now),
                             std::exception);
    auto malformed = news;
    malformed["aiContUrl"] = QJsonObject{{"url", "https://elsewhere.test"}};
    QVERIFY_EXCEPTION_THROWN(
        etfDaily::content({{"rc", 1}, {"news", malformed}}, item, now),
        std::exception);
    auto illustrated = news;
    auto body = html;
    body.remove(QRegularExpression("<img\\b[^>]*>"));
    body = "<p><!--IMG#0--></p>" + body +
           "<p>免责声明：本文基于AI生产，仅供参考。</p>";
    illustrated["body"] = body;
    const QString original =
        "https://np-newspic.dfcfw.com/download/"
        "D247AF8C30F17D1293AFF55C6DEEC60B4C_w1000h3362.jpg";
    illustrated["images"] = QJsonArray{QJsonObject{{"src", original}}};
    r = etfDaily::content({{"rc", 1}, {"news", illustrated}}, item, now);
    QCOMPARE(r["originalImageUrl"].toString(), original);
    QVERIFY(r["sourceNotice"].toString().contains("AI"));
    illustrated["body"] =
        body.replace("<!--IMG#0-->", "<!--IMG#999999999999999999999-->");
    r = etfDaily::content({{"rc", 1}, {"news", illustrated}}, item, now);
    QVERIFY(r["originalImageUrl"].isNull());
  }
  void realExcerptAndBothMarkets() {
    auto r = etfDaily::article(html, item, now);
    QCOMPARE(r["asOf"].toString(), QString("2026-09-09"));
    QCOMPARE(r["totalNetFlow"].toDouble(), 33.83);
    QCOMPARE(r["stockEtfNetFlow"].toDouble(), -19.87);
    auto a = r["subscriptions"].toArray();
    QCOMPARE(a.size(), 3);
    QCOMPARE(a[0].toObject()["code"].toString(), QString("588000"));
    QCOMPARE(a[0].toObject()["market"].toString(), QString("SH"));
    QCOMPARE(a[2].toObject()["market"].toString(), QString("SZ"));
    QCOMPARE(r["redemptions"].toArray()[0].toObject()["value"].toDouble(),
             -13.14);
    QCOMPARE(etfDaily::validate(r), r);
  }
  void missingConflictingOrManipulatedSourceRejected() {
    for (auto pair : QList<QPair<QString, QString>>{
             {"整体净流入33.83亿元", "整体暂无数据"},
             {"净申购3.02亿元", "净申购未披露"},
             {"文章来源：东方财富Choice数据", "文章来源：其他来源"},
             {"id=\"articleContent\"", "id=\"other\""},
             {"0.159259.html", "1.588000.html"},
             {"9月9日", "9月12日"},
             {"整体净流入33.83亿元", "整体净流入3..83亿元"}}) {
      auto bad = html;
      bad.replace(pair.first, pair.second);
      QVERIFY_EXCEPTION_THROWN(etfDaily::article(bad, item, now),
                               std::exception);
    }
    auto bad = item;
    bad["source"] = "证券之星";
    QVERIFY_EXCEPTION_THROWN(etfDaily::article(html, bad, now), std::exception);
    QVERIFY_EXCEPTION_THROWN(etfDaily::article(html, item, now.addDays(-1)),
                             std::exception);
  }
  void signedDirectionAndKnownCalendar() {
    auto changed = html;
    changed.replace("整体净流入33.83", "整体净流出33.83")
        .replace("股票型净流出19.87", "股票型净流入19.87");
    auto r = etfDaily::article(changed, item, now);
    QCOMPARE(r["totalNetFlow"].toDouble(), -33.83);
    QCOMPARE(r["stockEtfNetFlow"].toDouble(), 19.87);
    QCOMPARE(etfDaily::previousDay(QDate(2026, 10, 8)), QDate(2026, 9, 30));
    QCOMPARE(etfDaily::previousDay(QDate(2026, 10, 12)), QDate(2026, 10, 9));
    QVERIFY(!etfDaily::previousDay(QDate(2027, 1, 2)).isValid());
    QVERIFY(!etfDaily::knownOpen(QDate(2026, 10, 10)));
  }
  void persistedReportCannotInventCurrentOrAmounts() {
    auto r = etfDaily::article(html, item, now), bad = r;
    bad["stockEtfNetFlow"] = QJsonValue();
    QVERIFY_EXCEPTION_THROWN(etfDaily::validate(bad), std::exception);
    bad = r;
    bad["sourceUrl"] = "https://evil.test";
    QVERIFY_EXCEPTION_THROWN(etfDaily::validate(bad), std::exception);
    bad = r;
    auto a = bad["subscriptions"].toArray();
    auto x = a[0].toObject();
    x["value"] = -1;
    a[0] = x;
    bad["subscriptions"] = a;
    QVERIFY_EXCEPTION_THROWN(etfDaily::validate(bad), std::exception);
    bad = r;
    bad["asOf"] = "2026-09-08";
    QVERIFY_EXCEPTION_THROWN(etfDaily::validate(bad), std::exception);
    auto legacy = r;
    for (auto key : {"subscriptions", "redemptions"}) {
      auto rows = legacy[key].toArray();
      for (int i = 0; i < rows.size(); i++) {
        auto row = rows[i].toObject();
        row.remove("market");
        rows[i] = row;
      }
      legacy[key] = rows;
    }
    QCOMPARE(etfDaily::validate(legacy), legacy);
    bad = r;
    bad["publishedAt"] = "2026-09-10T08:00:59untrusted+08:00";
    QVERIFY_EXCEPTION_THROWN(etfDaily::validate(bad), std::exception);
  }
  void cachePersistsAttemptsAndNeverErasesLastGood() {
    QTemporaryDir dir;
    etfDaily::Store s(dir.filePath("etf.sqlite"));
    auto r = etfDaily::article(html, item, now);
    QVERIFY(s.history().isEmpty());
    QVERIFY(s.state().isEmpty());
    auto token = s.begin(now);
    QVERIFY(!token.isEmpty());
    QVERIFY_EXCEPTION_THROWN(s.begin(now.addSecs(1)), std::exception);
    QCOMPARE(s.state()["lastAttemptAt"].toString(),
             now.toUTC().toString(Qt::ISODateWithMs));
    QVERIFY(!s.finish("obsolete", r, now.addSecs(2)));
    QVERIFY(s.history().isEmpty());
    QVERIFY(s.finish(token, r, now.addSecs(2)));
    auto saved = s.read(r["articleId"].toString());
    QCOMPARE(saved["report"].toObject(), r);
    QCOMPARE(saved["origin"].toString(), QString("public-source"));
    auto success = saved["succeededAt"];
    auto second = s.begin(now.addSecs(65));
    QVERIFY(s.finish(second, r, now.addSecs(66)));
    QCOMPARE(s.read(r["articleId"].toString())["succeededAt"], success);
    auto third = s.begin(now.addSecs(130));
    QVERIFY(s.fail(third, "网络超时", now.addSecs(132)));
    QVERIFY(!s.fail(third, "迟到", now.addSecs(133)));
    QCOMPARE(s.history().size(), 1);
    QCOMPARE(s.state()["lastError"].toString(), QString("网络超时"));
    QCOMPARE(s.read(r["articleId"].toString())["report"].toObject(), r);
    etfDaily::Store reopened(dir.filePath("etf.sqlite"));
    QCOMPARE(reopened.history().size(), 1);
    QVERIFY_EXCEPTION_THROWN(reopened.begin(now.addSecs(134)), std::exception);
  }
  void cancelledExpiredFutureAndImportRollback() {
    QTemporaryDir dir;
    etfDaily::Store s(dir.filePath("etf.sqlite"));
    auto r = etfDaily::article(html, item, now);
    auto id = r["articleId"].toString();
    auto token = s.begin(now);
    QVERIFY(s.fail(token, "用户取消", now.addSecs(1)));
    QVERIFY(!s.finish(token, r, now.addSecs(2)));
    QVERIFY(s.history().isEmpty());
    token = s.begin(now.addSecs(61));
    auto newer = s.begin(now.addSecs(122));
    QVERIFY(!s.finish(token, r, now.addSecs(123)));
    QVERIFY(s.finish(newer, r, now.addSecs(123)));
    auto changed = r;
    changed["articleId"] = "202609113869906866";
    changed["sourceUrl"] =
        etfDaily::articleUrl(changed["articleId"].toString());
    auto bad = changed;
    bad["stockEtfNetFlow"] = QJsonValue();
    QVERIFY_EXCEPTION_THROWN(s.importReports({changed, bad}, now),
                             std::exception);
    QCOMPARE(s.history().size(), 1);
    QCOMPARE(s.importReports({r, changed}, now), 1);
    QCOMPARE(s.read(changed["articleId"].toString())["origin"].toString(),
             QString("imported-cache"));
    QVERIFY(s.read(changed["articleId"].toString())["succeededAt"].isNull());
    auto altered = r;
    altered["totalNetFlow"] = 99;
    QVERIFY_EXCEPTION_THROWN(s.importReports({altered}, now), std::exception);
    QCOMPARE(s.read(id)["report"].toObject(), r);
    token = s.begin(now.addSecs(190));
    QVERIFY_EXCEPTION_THROWN(s.finish(token, changed, now.addDays(-1)),
                             std::exception);
    QCOMPARE(s.history().size(), 2);
  }
};
QTEST_GUILESS_MAIN(EtfDailyTests)
#include "etf_daily_tests.moc"
