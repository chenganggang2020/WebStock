#include <QtTest>
#include "source_discovery.hpp"

class SourceDiscoveryTests : public QObject {
  Q_OBJECT
  const QString author = "https://www.douyin.com/user/abcdef";
  QJsonObject item(int n, QString title = "标题") const {
    auto id = QString::number(7259684447530929443ULL + n);
    return {{"contentId", id}, {"sourceUrl", "https://www.douyin.com/video/" + id},
            {"title", title}};
  }
  struct Sql {
    QString name = QUuid::createUuid().toString();
    QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE", name);
    explicit Sql(const QString& path) { db.setDatabaseName(path); if (!db.open()) qFatal("fixture DB open failed"); }
    ~Sql() { db.close(); db = {}; QSqlDatabase::removeDatabase(name); }
    bool exec(const QString& sql) { QSqlQuery q(db); return q.exec(sql); }
  };
 private slots:
  void allVisibleSurviveReopenAndOnlyAcknowledgedDetailsLeavePending() {
    QTemporaryDir temp;
    QString path = temp.filePath("discovery.sqlite");
    {
      SourceDiscovery store(path);
      QJsonArray visible;
      for (int i = 0; i < 20; ++i) visible.append(item(i));
      store.observe(author, visible, 1000);
      QCOMPARE(store.counts(author)["total"].toInt(), 20);
      for (int i = 0; i < 8; ++i)
        QVERIFY(store.acknowledge(author, item(i)["contentId"].toString(), 1,
                                 "job" + QString::number(i), "revision", 1100));
    }
    SourceDiscovery reopened(path);
    QCOMPARE(reopened.counts(author)["total"].toInt(), 20);
    QCOMPARE(reopened.counts(author)["pending"].toInt(), 12);
    QCOMPARE(reopened.pending(author).size(), 12);
    QCOMPARE(reopened.pending(author)[0].toObject()["contentId"], item(8)["contentId"]);
  }
  void repeatDoesNotResetButChangedTitleNeedsDetailAndOldAckCannotWin() {
    QTemporaryDir temp;
    SourceDiscovery store(temp.filePath("discovery.sqlite"));
    store.observe(author, {item(0, "甲   乙")}, 1000);
    QCOMPARE(store.pending(author).size(), 1);
    QVERIFY(store.acknowledge(author, item(0)["contentId"].toString(), 1, "job", "old", 1100));
    store.observe(author, {item(0, "甲 乙")}, 1200);
    QCOMPARE(store.pending(author).size(), 0);
    auto row = store.page(author)[0].toObject();
    QCOMPARE(row["firstSeenAt"].toDouble(), 1000.0);
    QCOMPARE(row["lastSeenAt"].toDouble(), 1200.0);
    store.observe(author, {item(0, "新内容")}, 1300);
    QCOMPARE(store.pending(author).size(), 1);
    QVERIFY(!store.acknowledge(author, item(0)["contentId"].toString(), 1, "job", "old", 1400));
    QVERIFY(store.acknowledge(author, item(0)["contentId"].toString(), 2, "new-job", "new", 1400));
    QCOMPARE(store.counts(author)["pending"].toInt(), 0);
    row = store.page(author)[0].toObject();
    QCOMPARE(row["collectionId"].toString(), QString("new-job"));
    QCOMPARE(row["executionRevision"].toString(), QString("new"));
  }
  void onlyPublicMetadataIsStoredAndAuthorDirectoriesAreSeparate() {
    QTemporaryDir temp;
    SourceDiscovery store(temp.filePath("discovery.sqlite"));
    auto value = item(0);
    value["autoPipeline"] = true;
    value["pipelinePython"] = "arbitrary.exe";
    value["mediaUrl"] = "https://example.invalid/signed";
    value["rightsBasis"] = "not permission";
    value["publishedAt"] = "made up";
    value["sourceUrl"] = value["sourceUrl"].toString() + "?token=secret#fragment";
    store.observe(author, {value}, 1000);
    QCOMPARE(store.page(author).size(), 1);
    auto row = store.page(author)[0].toObject();
    QCOMPARE(row["sourceUrl"], item(0)["sourceUrl"]);
    for (auto key : {"autoPipeline", "pipelinePython", "mediaUrl", "rightsBasis", "publishedAt"})
      QVERIFY(!row.contains(key));
    QCOMPARE(store.pending("https://www.douyin.com/user/ghijkl").size(), 0);
    store.observe("https://www.douyin.com/user/ghijkl", {item(1)}, 1100);
    QCOMPARE(store.counts(author)["total"].toInt(), 1);
  }
  void invalidOrConflictingBatchCannotPartiallyPersist() {
    QTemporaryDir temp;
    SourceDiscovery store(temp.filePath("discovery.sqlite"));
    store.observe(author, {item(0)}, 1000);
    auto invalid = item(2); invalid["contentId"] = "mismatch";
    QVERIFY_EXCEPTION_THROWN(store.observe(author, {item(1), invalid}, 1100), std::exception);
    QCOMPARE(store.counts(author)["total"].toInt(), 1);
    QVERIFY_EXCEPTION_THROWN(store.observe(author, {item(1), item(1, "conflicting")}, 1100), std::exception);
    auto wrongKind = item(0); wrongKind["sourceUrl"] = wrongKind["sourceUrl"].toString().replace("/video/", "/note/");
    QVERIFY_EXCEPTION_THROWN(store.observe(author, {item(1), wrongKind}, 1200), std::exception);
    QCOMPARE(store.counts(author)["total"].toInt(), 1);
    QVERIFY_EXCEPTION_THROWN(store.observe("https://attacker.invalid/user/abcdef", {item(1)}, 1200), std::exception);
    QVERIFY_EXCEPTION_THROWN(store.observe(author, {item(1, QString(301, 'x'))}, 1200), std::exception);
  }
  void triggerRejectsWholeTransactionAndPreservesReason() {
    QTemporaryDir temp;
    SourceDiscovery store(temp.filePath("discovery.sqlite"));
    Sql sql(store.filePath());
    QVERIFY(sql.exec("CREATE TRIGGER reject_second BEFORE INSERT ON discoveries WHEN NEW.title='拒写' BEGIN SELECT RAISE(ABORT,'controlled discovery refusal'); END"));
    QString error;
    try { store.observe(author, {item(0), item(1, "拒写")}, 1000); }
    catch (const std::exception& e) { error = QString::fromUtf8(e.what()); }
    QVERIFY2(error.contains("controlled discovery refusal"), qPrintable(error));
    QCOMPARE(store.counts(author)["total"].toInt(), 0);
    QVERIFY(sql.exec("DROP TRIGGER reject_second"));
    store.observe(author, {item(0)}, 1100);
    QVERIFY(sql.exec("CREATE TRIGGER reject_ack BEFORE UPDATE ON discoveries WHEN NEW.state='detail_saved' BEGIN SELECT RAISE(ABORT,'controlled ack refusal'); END"));
    QVERIFY_EXCEPTION_THROWN(store.acknowledge(author, item(0)["contentId"].toString(), 1, "job", "rev", 1200), std::exception);
    QCOMPARE(store.counts(author)["pending"].toInt(), 1);
  }
  void tenThousandCapacityAndPagingAreBoundedAndDoNotEvict() {
    QTemporaryDir temp;
    SourceDiscovery store(temp.filePath("discovery.sqlite"));
    for (int batch = 0; batch < 10; ++batch) {
      QJsonArray items;
      for (int i = 0; i < 1000; ++i) items.append(item(batch * 1000 + i));
      store.observe(author, items, 1000 + batch);
    }
    QCOMPARE(store.counts(author)["total"].toInt(), 10000);
    QElapsedTimer timer; timer.start();
    QCOMPARE(store.page(author, 9950).size(), 50);
    QCOMPARE(store.page(author, 10000).size(), 0);
    QCOMPARE(store.pending(author).size(), 10000);
    qInfo() << "10000 rows: two pages + pending ms" << timer.elapsed();
    QVERIFY(timer.elapsed() < 1000);
    QVERIFY_EXCEPTION_THROWN(store.observe(author, {item(0, "must rollback"), item(10000)}, 2000), std::exception);
    QCOMPARE(store.counts(author)["total"].toInt(), 10000);
    QCOMPARE(store.page(author)[0].toObject()["title"].toString(), QString("标题"));
    QVERIFY_EXCEPTION_THROWN(store.page(author, -1), std::exception);
  }
  void exclusiveLockFailsQuicklyWithoutReturningAnEmptySuccess() {
    QTemporaryDir temp;
    SourceDiscovery store(temp.filePath("discovery.sqlite"));
    store.observe(author, {item(0)}, 1000);
    Sql sql(store.filePath()); QVERIFY(sql.exec("BEGIN EXCLUSIVE"));
    QElapsedTimer timer; timer.start();
    QVERIFY_EXCEPTION_THROWN(store.counts(author), std::exception);
    QVERIFY_EXCEPTION_THROWN(store.observe(author, {item(1)}, 1100), std::exception);
    qInfo() << "two refused operations ms" << timer.elapsed();
    QVERIFY(timer.elapsed() < 600);
    QVERIFY(sql.exec("ROLLBACK"));
    QCOMPARE(store.counts(author)["total"].toInt(), 1);
  }
  void unknownSchemaAndForeignDatabaseAreNotReplaced() {
    QTemporaryDir temp;
    const auto path = temp.filePath("unknown.sqlite");
    {
      Sql sql(path);
      QVERIFY(sql.exec("CREATE TABLE sentinel(value TEXT)"));
      QVERIFY(sql.exec("INSERT INTO sentinel VALUES('preserve')"));
      QVERIFY(sql.exec("PRAGMA user_version=99"));
    }
    QVERIFY_EXCEPTION_THROWN((void)SourceDiscovery{path}, std::exception);
    Sql sql(path); QVERIFY(sql.exec("PRAGMA user_version=0"));
    QVERIFY_EXCEPTION_THROWN((void)SourceDiscovery{path}, std::exception);
    QSqlQuery q(sql.db); QVERIFY(q.exec("SELECT value FROM sentinel"));
    QVERIFY(q.next()); QCOMPARE(q.value(0).toString(), QString("preserve"));
  }
  void olderObservationOrAcknowledgementCannotEraseNewerState() {
    QTemporaryDir temp;
    SourceDiscovery store(temp.filePath("discovery.sqlite"));
    store.observe(author, {item(0)}, 1000);
    QVERIFY(!store.acknowledge(author, item(0)["contentId"].toString(), 1, "job", "rev", 900));
    QVERIFY(store.acknowledge(author, item(0)["contentId"].toString(), 1, "job", "rev", 1100));
    store.observe(author, {item(0, "older")}, 900);
    QCOMPARE(store.page(author)[0].toObject()["title"].toString(), QString("标题"));
    QCOMPARE(store.counts(author)["pending"].toInt(), 0);
    store.observe(author, {item(0, "")}, 1200);
    QCOMPARE(store.page(author)[0].toObject()["title"].toString(), QString("标题"));
    QVERIFY(!store.acknowledge(author, item(0)["contentId"].toString(), 1, "wrong-job", "old", 1050));
  }
  void blankLegacyRevisionAndUnavailableCardTitleRemainValidMetadata() {
    QTemporaryDir temp;
    SourceDiscovery store(temp.filePath("discovery.sqlite"));
    try {
      store.observe(author, {item(0)}, 1000);
      QVERIFY(store.acknowledge(author, item(0)["contentId"].toString(), 1, "job", QString(), 1100));
      store.observe(author, {item(1, QString())}, 1200);
      QCOMPARE(store.counts(author)["total"].toInt(), 2);
      QCOMPARE(store.counts(author)["pending"].toInt(), 1);
      QCOMPARE(store.entries(author, {item(0)["contentId"].toString()})[0].toObject()["executionRevision"].toString(), QString());
    } catch (const std::exception& e) { QFAIL(e.what()); }
  }
};
QTEST_GUILESS_MAIN(SourceDiscoveryTests)
#include "source_discovery_tests.moc"
