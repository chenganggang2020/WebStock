#include <QCryptographicHash>
#include <QFile>
#include <QTemporaryDir>
#include <QtTest>

#include "business_store.hpp"
#include "legacy_data.hpp"
class LegacyTests : public QObject {
  Q_OBJECT
  QString fixture(const QString& path) {
    auto name = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", name);
      db.setDatabaseName(path);
      if (!db.open()) throw std::runtime_error("fixture");
      QSqlQuery q(db);
      for (auto sql :
           {"CREATE TABLE portfolio_accounts(id INTEGER,account_key TEXT,name "
            "TEXT,cash_balance REAL)",
            "INSERT INTO portfolio_accounts VALUES(1,'default','旧账户',123)",
            "CREATE TABLE trades(id INTEGER,account_id INTEGER,code TEXT,name "
            "TEXT,side TEXT,trade_date TEXT,price REAL,quantity INTEGER,fee "
            "REAL,tax REAL,amount REAL)",
            "INSERT INTO trades "
            "VALUES(1,1,'000001','平安银行','buy','2026-10-08',10,100,5,0,"
            "1005)",
            "INSERT INTO trades "
            "VALUES(2,1,'000001','平安银行','sell','2026-10-09',12,40,1,1,478)",
            "CREATE TABLE knowledge_sources(id INTEGER,title TEXT,source_url "
            "TEXT,original_content TEXT,source_key TEXT)",
            "INSERT INTO knowledge_sources "
            "VALUES(7,'原始资料','https://example.com/"
            "source','原文保留','stable-7')",
            "CREATE TABLE portfolio_snapshots(id INTEGER,account_id "
            "INTEGER,snapshot_date TEXT,total_assets REAL)",
            "INSERT INTO portfolio_snapshots VALUES(8,1,'2026-10-09',2000)",
            "CREATE TABLE untouched_private_settings(secret TEXT)",
            "INSERT INTO untouched_private_settings VALUES('DO-NOT-IMPORT')"})
        if (!q.exec(sql)) throw std::runtime_error("fixture SQL");
      db.close();
    }
    QSqlDatabase::removeDatabase(name);
    QFile f(path);
    f.open(QIODevice::ReadOnly);
    return QString(
        QCryptographicHash::hash(f.readAll(), QCryptographicHash::Sha256)
            .toHex());
  }
 private slots:
  void sourceHistoryReadonlyArchive() {
    QTemporaryDir d; auto path=d.filePath("legacy.db"); fixture(path);
    const auto name=QUuid::createUuid().toString();
    { auto db=QSqlDatabase::addDatabase("QSQLITE",name); db.setDatabaseName(path); QVERIFY(db.open()); QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE expert_channels(id INTEGER,display_name TEXT)"));
      QVERIFY(q.exec("INSERT INTO expert_channels VALUES(1,'旧作者')"));
      QVERIFY(q.exec("CREATE TABLE expert_sync_runs(id INTEGER,channel_id INTEGER,status TEXT,started_at TEXT,transcribed_count INTEGER,result_json TEXT,message TEXT)"));
      QVERIFY(q.exec("INSERT INTO expert_sync_runs VALUES(1,1,'completed','2026-10-10T08:00:00Z',0,'SECRET','https://example.com/a?sig=SECRET')"));
      QVERIFY(q.exec("CREATE TABLE expert_sync_run_items(id INTEGER,run_id INTEGER,content_id TEXT,title TEXT,transcription_status TEXT)"));
      QVERIFY(q.exec("INSERT INTO expert_sync_run_items VALUES(1,1,'12345','旧作品','runtime_missing')"));
      db.close(); }
    QSqlDatabase::removeDatabase(name);
    QFile before(path); QVERIFY(before.open(QIODevice::ReadOnly)); auto bytes=before.readAll(); before.close();
    auto archive=legacydata::readSourceHistory(path);
    QCOMPARE(archive["schema"].toString(),QString("native-source-history-v1"));
    auto run=archive["runs"].toArray()[0].toObject();
    QCOMPARE(run["id"].toString(),QString("legacy-webstock:sync-run:1"));
    QCOMPARE(run["status"].toString(),QString("completed"));
    QCOMPARE(run["counts"].toObject()["transcribed_count"].toInt(),0);
    QVERIFY(!run["counts"].toObject().contains("discovered_count"));
    QCOMPARE(run["items"].toArray()[0].toObject()["transcription_status"].toString(),QString("runtime_missing"));
    QVERIFY(!QJsonDocument(archive).toJson().contains("SECRET"));
    QVERIFY(before.open(QIODevice::ReadOnly)); QCOMPARE(before.readAll(),bytes);
  }
  void researchAndCollectionWhitelistedImport() {
    QTemporaryDir d; auto path=d.filePath("legacy.db");fixture(path);
    auto name=QUuid::createUuid().toString();
    { auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);QVERIFY(db.open());QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE industry_research_topics(id TEXT,name TEXT,aliases_json TEXT,source_urls_json TEXT,config_json TEXT)"));
      QVERIFY(q.exec("INSERT INTO industry_research_topics VALUES('semi','半导体','[]','[]','SECRET-NOT-IMPORT')"));
      QVERIFY(q.exec("CREATE TABLE expert_channels(id INTEGER,display_name TEXT)"));
      QVERIFY(q.exec("INSERT INTO expert_channels VALUES(1,'原渠道')"));
      QVERIFY(q.exec("CREATE TABLE expert_observations(id INTEGER,channel_id INTEGER,title TEXT,source_url TEXT,transcript_text TEXT,content_text TEXT,local_asset_path TEXT,published_at TEXT,rights_basis TEXT,media_metadata_json TEXT)"));
      QVERIFY(q.exec("INSERT INTO expert_observations VALUES(2,1,'视频原稿','https://example.com/2','语音原文','图文原文','D:/media.mp4','2026-10-09','personal-use','SIGNED-URL-NOT-IMPORT')"));
      db.close(); }
    QSqlDatabase::removeDatabase(name);
    auto b=legacydata::readBusiness(path);
    QCOMPARE(b["topics"].toArray().size(),1);QCOMPARE(b["collections"].toArray().size(),1);
    QCOMPARE(b["collections"].toArray()[0].toObject()["originalText"].toString(),QString("语音原文"));
    QVERIFY(!QJsonDocument(b).toJson().contains("SECRET-NOT-IMPORT"));
    QVERIFY(!QJsonDocument(b).toJson().contains("SIGNED-URL-NOT-IMPORT"));
    BusinessStore s(d.filePath("native.db"));s.restore(b);s.restore(b);
    QCOMPARE(s.read("collections").size(),1);
  }
  void qualityMetadataWhitelistPreservesReasonsWithoutPrivateUrls() {
    QTemporaryDir d;auto path=d.filePath("legacy.db");fixture(path);auto name=QUuid::createUuid().toString();
    {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);QVERIFY(db.open());QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE expert_observations(id INTEGER,title TEXT,transcript_text TEXT,media_type TEXT,media_metadata_json TEXT)"));
      q.prepare("INSERT INTO expert_observations VALUES(1,'质检','设备需求仍需核对原始文稿与时间信息，作者观点不等于事实，保留原文证据。','video',?)");
      q.addBindValue(QString(R"({"signedUrl":"SECRET","asr":{"status":"needs_review","model":"local-model","durationSeconds":10,"quality":{"needsReview":true,"reasons":["timestamp_out_of_range"]},"segments":[{"start":0,"end":12,"text":"原文","mediaUrl":"SECRET"}]}})"));QVERIFY(q.exec());db.close();}
    QSqlDatabase::removeDatabase(name);auto bundle=legacydata::readBusiness(path);auto row=bundle["collections"].toArray()[0].toObject();
    QCOMPARE(row["qualitySource"].toObject()["asr"].toObject()["status"].toString(),QString("needs_review"));
    QVERIFY(collectionQuality::evaluate(row)["qualityReasons"].toArray().contains("timestamp_out_of_range"));
    QVERIFY(!QJsonDocument(bundle).toJson().contains("SECRET"));
  }
  void repeatMigrationDoesNotOverwriteNativeEdits() {
    QTemporaryDir d;
    auto path = d.path() + "/legacy.db";
    fixture(path);
    auto incoming = legacydata::readBusiness(path);
    BusinessStore store(d.path() + "/native.sqlite");
    store.restore(incoming);
    auto edited = store.read("docs")[0].toObject();
    edited["text"] = "本机补充核验";
    store.save("docs", edited);
    store.restore(incoming);
    QCOMPARE(store.read("docs").size(), 1);
    QCOMPARE(store.read("trades").size(), 2);
    QCOMPARE(store.read("docs")[0].toObject()["text"].toString(),
             QString("本机补充核验"));
  }
  void readOnlyLegacyImportPreservesIdentityAmountsAndProvenance() {
    QTemporaryDir d;
    auto path = d.path() + "/legacy.db";
    auto before = fixture(path);
    auto imported = legacydata::readBusiness(path);
    QCOMPARE(imported["schema"].toString(), QString("native-business-v1"));
    QCOMPARE(imported["accounts"].toArray().size(), 1);
    QCOMPARE(imported["trades"].toArray().size(), 2);
    QCOMPARE(imported["docs"].toArray().size(), 1);
    QCOMPARE(imported["reports"].toArray().size(), 1);
    QVERIFY(!QJsonDocument(imported).toJson().contains("DO-NOT-IMPORT"));
    BusinessStore store(d.path() + "/new.sqlite");
    store.restore(imported);
    auto account =
        imported["accounts"].toArray()[0].toObject()["id"].toString();
    auto result = business::portfolio(store.read("trades"), {}, account);
    QCOMPARE(result["cost"].toDouble(), 603.);
    QCOMPARE(result["realized"].toDouble(), 76.);
    QCOMPARE(store.read("docs")[0].toObject()["text"].toString(),
             QString("原文保留"));
    QCOMPARE(store.read("docs")[0].toObject()["verification"].toString(),
             QString("unverified"));
    auto second = legacydata::readBusiness(path);
    QCOMPARE(second["trades"].toArray()[0].toObject()["id"],
             imported["trades"].toArray()[0].toObject()["id"]);
    QFile f(path);
    QVERIFY(f.open(QIODevice::ReadOnly));
    QCOMPARE(QString(QCryptographicHash::hash(f.readAll(),
                                              QCryptographicHash::Sha256)
                         .toHex()),
             before);
  }
};
QTEST_GUILESS_MAIN(LegacyTests)
#include "legacy_data_tests.moc"
