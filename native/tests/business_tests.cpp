#include <QtTest>
#include <QTemporaryDir>
#include "business_store.hpp"
class BusinessTests : public QObject {
  Q_OBJECT
 private slots:
  void duplicateIdsWithinOneBackupRejectWithoutSilentlyLosingRecords() {
    QTemporaryDir dir;
    BusinessStore store(dir.path()+"/business.sqlite");
    auto saved=store.save("docs",{{"title","应保留资料"},{"text","原文"}});
    auto backup=store.backup();
    auto first=saved, second=saved;
    first["title"]="重复ID第一份"; second["title"]="重复ID第二份";
    backup["docs"]=QJsonArray{first,second};
    QVERIFY_EXCEPTION_THROWN(store.restore(backup),std::runtime_error);
    QCOMPARE(store.read("docs"),QJsonArray{saved});
  }
  void ledgerPersistsAndRejectsOversellAtomically() {
    QTemporaryDir dir;
    BusinessStore store(dir.path() + "/business.sqlite");
    QJsonObject buy{{"accountId","local"},{"instrumentId","SZ:stock:000001"},{"name","测试"},{"date","2026-10-09"},{"side","buy"},{"quantity",100},{"price",10.0},{"fee",5.0},{"tax",0.0}};
    store.save("trades",buy);
    auto sell=buy; sell["side"]="sell"; sell["quantity"]=40; sell["price"]=12; sell["fee"]=1; sell["tax"]=1;
    store.save("trades",sell);
    auto p=business::portfolio(store.read("trades"), {}, "local");
    QCOMPARE(p["positions"].toArray()[0].toObject()["quantity"].toInt(),60);
    QCOMPARE(p["realized"].toDouble(),76.0);
    QVERIFY(p["marketValue"].isNull());
    QCOMPARE(p["cost"].toDouble(),603.0);
    sell["quantity"]=61;
    QVERIFY_EXCEPTION_THROWN(store.save("trades",sell),std::runtime_error);
    QCOMPARE(store.read("trades").size(),2);
    BusinessStore reopened(dir.path()+"/business.sqlite");
    QCOMPARE(reopened.read("trades").size(),2);
  }
  void backupValidationAndPaperAccountIsolation() {
    QTemporaryDir dir;
    BusinessStore store(dir.path()+"/business.sqlite");
    store.save("docs",{{"title","来源材料"},{"text","原文"},{"sourceUrl","https://example.com/article"},{"verification","unverified"}});
    auto backup=store.backup();
    BusinessStore other(dir.path()+"/restored.sqlite"); other.restore(backup);
    QCOMPARE(other.read("docs").size(),1);
    backup["schema"]="unknown";
    QVERIFY_EXCEPTION_THROWN(other.restore(backup),std::runtime_error);
    QCOMPARE(other.read("docs").size(),1);
    auto p=business::portfolio(store.read("trades"),{},"paper");
    QCOMPARE(p["cost"].toDouble(),0.0);
  }
  void mixedAccountTradesDoNotChangeEachOthersHoldings() {
    QTemporaryDir dir;
    BusinessStore store(dir.path()+"/business.sqlite");
    QJsonObject trade{{"accountId","local"},{"instrumentId","SZ:stock:000001"},
      {"date","2026-10-09"},{"side","buy"},{"quantity",100},{"price",10.0},{"fee",5.0}};
    store.save("trades",trade);
    trade["accountId"]="paper"; trade["quantity"]=40; trade["price"]=20; trade["fee"]=0;
    store.save("trades",trade);
    auto all=store.read("trades");
    QCOMPARE(business::portfolio(all,{},"local")["cost"].toDouble(),1005.0);
    QCOMPARE(business::portfolio(all,{},"paper")["cost"].toDouble(),800.0);
    QJsonObject quotes{{"SZ:stock:000001",QJsonObject{{"price",12.0},{"tradeDate","2026-10-09"}}}};
    auto p=business::portfolio(all,quotes,"local");
    QCOMPARE(p["marketValue"].toDouble(),1200.0);
    QCOMPARE(p["unrealized"].toDouble(),195.0);
    QCOMPARE(p["positions"].toArray()[0].toObject()["quoteDate"].toString(),QString("2026-10-09"));
  }
  void deletingSupportingBuyRejectsAndPreservesBothTrades() {
    QTemporaryDir dir;
    BusinessStore store(dir.path()+"/business.sqlite");
    QJsonObject trade{{"accountId","local"},{"instrumentId","SZ:stock:000001"},
      {"date","2026-10-09"},{"side","buy"},{"quantity",100},{"price",10.0}};
    auto buy=store.save("trades",trade);
    trade["side"]="sell"; trade["quantity"]=40; trade["price"]=12;
    store.save("trades",trade);
    auto before=store.backup();
    QVERIFY_EXCEPTION_THROWN(store.remove("trades",buy["id"].toString()),std::runtime_error);
    QCOMPARE(store.read("trades"),before["trades"].toArray());
    buy["quantity"]=20;
    QVERIFY_EXCEPTION_THROWN(store.save("trades",buy),std::runtime_error);
    QCOMPARE(store.read("trades"),before["trades"].toArray());
  }
  void failedRestoreRollsBackEarlierWritesAndReopensOriginalDatabase() {
    QTemporaryDir dir;
    const QString path=dir.path()+"/business.sqlite";
    BusinessStore store(path);
    auto doc=store.save("docs",{{"title","保留资料"},{"text","原文"},{"verification","unverified"}});
    const auto oldAccounts=store.read("accounts"), oldDocs=store.read("docs");
    auto backup=store.backup();
    auto accounts=backup["accounts"].toArray();
    auto account=accounts[0].toObject(); account["name"]="不应写入的账户名"; accounts[0]=account;
    backup["accounts"]=accounts;
    doc["text"]="不应写入的正文"; backup["docs"]=QJsonArray{doc};
    backup["trades"]=QJsonArray{QJsonObject{{"id","bad-sell"},{"accountId","local"},
      {"instrumentId","SZ:stock:000001"},{"date","2026-10-09"},{"side","sell"},
      {"quantity",1},{"price",12.0}}};
    QVERIFY_EXCEPTION_THROWN(store.restore(backup),std::runtime_error);
    BusinessStore reopened(path);
    QCOMPARE(reopened.read("accounts"),oldAccounts);
    QCOMPARE(reopened.read("docs"),oldDocs);
    QVERIFY(reopened.read("trades").isEmpty());
  }
  void documentReopenPreservesOriginalTextSourceAndVerification() {
    QTemporaryDir dir;
    const QString path=dir.path()+"/business.sqlite";
    BusinessStore store(path);
    auto saved=store.save("docs",{{"title","半导体原始证据"},{"topic","半导体"},
      {"text","第12页\n原文‘样本’"},{"sourceUrl","https://example.com/original"},
      {"verification","manuallyVerified"}});
    BusinessStore reopened(path);
    QCOMPARE(reopened.read("docs"),QJsonArray{saved});
    auto invalid=saved; invalid["sourceUrl"]="javascript:alert(1)";
    QVERIFY_EXCEPTION_THROWN(store.save("docs",invalid),std::runtime_error);
    QCOMPARE(reopened.read("docs"),QJsonArray{saved});
  }
};
QTEST_GUILESS_MAIN(BusinessTests)
#include "business_tests.moc"
