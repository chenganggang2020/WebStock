#include <QtTest>
#include <QTemporaryDir>
#include <QFile>
#include <QDir>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QPointer>
#include "market_feed.hpp"
#include "market_store.hpp"

class HeldQuoteReply : public QNetworkReply {
 public:
  HeldQuoteReply(const QNetworkRequest& request,QObject* parent):QNetworkReply(parent){setRequest(request);setUrl(request.url());open(QIODevice::ReadOnly);}
  void abort() override {setError(OperationCanceledError,"controlled cancellation");setFinished(true);emit finished();}
  void deliver(){QStringList fields;for(int i=0;i<32;++i)fields<<"0";
    fields[0]="Fixture";fields[1]="10";fields[2]="10";fields[3]="12";fields[4]="12";fields[5]="10";fields[30]="2026-10-09";fields[31]="15:00:00";
    bytes=("var hq_str_sh600000=\""+fields.join(',')+"\";").toUtf8();setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);setFinished(true);emit readyRead();emit finished();}
  qint64 bytesAvailable() const override{return bytes.size()-offset+QNetworkReply::bytesAvailable();}
 protected:
  qint64 readData(char* destination,qint64 length) override {const auto n=qMin(length,qint64(bytes.size()-offset));if(n<=0)return -1;memcpy(destination,bytes.constData()+offset,size_t(n));offset+=n;return n;}
 private: QByteArray bytes;qint64 offset=0;
};
class HeldQuoteNetwork : public QNetworkAccessManager {
 public: QList<QPointer<HeldQuoteReply>> replies;
 protected:
  QNetworkReply* createRequest(Operation,const QNetworkRequest& request,QIODevice*) override {auto reply=new HeldQuoteReply(request,this);replies.append(reply);return reply;}
};

class RecentFeedTests : public QObject {
  Q_OBJECT
  QJsonObject stock(QString code="600000") {
    return {{"id","SH:stock:"+code},{"symbol","sh"+code},{"name","测试证券"+code},{"group","默认分组"}};
  }
  QJsonObject find(const MarketFeed& feed,const QString& code) {
    for(auto value:feed.instruments)if(value.toObject()["id"]==QJsonValue("SH:stock:"+code))return value.toObject();
    return {};
  }
  QJsonObject quote(double price,QString time="15:00:00") {
    return {{"price",price},{"tradeDate","2026-10-09"},{"tradeTime",time},{"checkedAt","2026-10-09T07:00:00Z"},{"source","测试缓存"}};
  }
  QJsonArray exported(const QString& path) {
    QFile f(path);if(!f.open(QIODevice::ReadOnly))return {};
    return QJsonDocument::fromJson(f.readAll()).object()["instruments"].toArray();
  }
 private slots:
  void observingNewRowsDoesNotReloadEveryExistingCache() {
    QTemporaryDir dir;MarketStore(dir.filePath("market-v1.sqlite")).save("sh600000-quote",quote(12));
    MarketFeed feed(dir.path());for(int n=0;n<123;++n)feed.instruments.append(stock(QString::number(600000+n)));
    QElapsedTimer timer;timer.start();for(int n=0;n<20;++n)feed.observe(stock(QString::number(601000+n)));
    QVERIFY2(timer.elapsed()<2500,qPrintable(QString("20 new observations blocked for %1 ms").arg(timer.elapsed())));QCOMPARE(feed.instruments.size(),143);
  }
  void actualRefreshAndLateCompletionNeverPersistObservationAsWatchlist() {
    QTemporaryDir dir;HeldQuoteNetwork network;MarketFeed feed(dir.path(),nullptr,&network);feed.observe(stock());feed.refreshQuotes();
    QCOMPARE(network.replies.size(),1);QVERIFY(network.replies[0]->url().toString().contains("sh600000"));network.replies[0]->deliver();
    QTRY_COMPARE(find(feed,"600000")["quote"].toObject()["price"].toDouble(),12.0);
    QTRY_COMPARE(find(feed,"600000")["quote"].toObject()["persistenceState"].toString(),QString("saved"));
    QVERIFY(find(feed,"600000")["transient"].toBool());QVERIFY(!QFile::exists(dir.filePath("watchlist.json")));
    feed.refreshQuotes();QCOMPARE(network.replies.size(),2);feed.instruments={};network.replies[1]->deliver();
    QTest::qWait(50);QVERIFY(feed.instruments.isEmpty());QVERIFY(!QFile::exists(dir.filePath("watchlist.json")));
    MarketFeed reopened(dir.path());QVERIFY(reopened.instruments.isEmpty());
  }
  void observeNeverAddsExportsOrRestoresWatchlist() {
    QTemporaryDir dir;MarketFeed feed(dir.path());feed.observe(stock());
    QCOMPARE(feed.instruments.size(),1);QVERIFY(find(feed,"600000")["transient"].toBool());
    QVERIFY(!QFile::exists(dir.filePath("watchlist.json")));
    const auto path=dir.filePath("export.json");feed.exportFile(path);QVERIFY(QFile::exists(path));QVERIFY(exported(path).isEmpty());
    MarketFeed reopened(dir.path());QVERIFY(reopened.instruments.isEmpty());
    feed.observe(stock());QCOMPARE(feed.instruments.size(),1);
  }
  void addPromotesOnlyChosenObservationAndKeepsOthers() {
    QTemporaryDir dir;MarketFeed feed(dir.path());feed.add(stock());feed.observe(stock("600001"));feed.observe(stock("600002"));
    feed.add(stock("600001"));QCOMPARE(feed.instruments.size(),3);
    QVERIFY(!find(feed,"600001")["transient"].toBool());QVERIFY(find(feed,"600002")["transient"].toBool());
    const auto path=dir.filePath("export.json");feed.exportFile(path);QCOMPARE(exported(path).size(),2);
    for(auto row:exported(path))QVERIFY(row.toObject()["id"]!=QJsonValue("SH:stock:600002"));
    MarketFeed reopened(dir.path());QCOMPARE(reopened.instruments.size(),2);QVERIFY(find(reopened,"600002").isEmpty());
    QVERIFY_EXCEPTION_THROWN(feed.add(stock("600001")),std::exception);
  }
  void addingOrImportingRosterCannotRollbackNewerMemoryQuotes() {
    QTemporaryDir dir;MarketFeed feed(dir.path());feed.add(stock());
    MarketStore cache(dir.filePath("market-v1.sqlite"));cache.save("sh600000-quote",quote(10,"14:00:00"));
    auto current=feed.instruments[0].toObject();current["quote"]=quote(30);
    current["day"]=QJsonArray{QJsonObject{{"t",123},{"c",30}}};current["dayMeta"]=QJsonObject{{"checkedAt","2026-10-12T01:00:00Z"},{"cached",false}};
    feed.instruments[0]=current;feed.add(stock("600001"));
    QCOMPARE(find(feed,"600000")["quote"].toObject()["price"].toDouble(),30.0);
    QCOMPARE(find(feed,"600000")["day"].toArray().size(),1);
    const auto file=dir.filePath("export.json");feed.exportFile(file);feed.observe(stock("600002"));feed.importFile(file);
    QCOMPARE(find(feed,"600000")["quote"].toObject()["price"].toDouble(),30.0);
    QVERIFY(find(feed,"600002")["transient"].toBool());
  }
  void observeReusesCacheWithoutWritingWatchlistAndRejectsAmbiguousIdentity() {
    QTemporaryDir dir;MarketStore cache(dir.filePath("market-v1.sqlite"));cache.save("sh600000-quote",quote(12));
    MarketFeed feed(dir.path());feed.observe(stock());
    QCOMPARE(find(feed,"600000")["quote"].toObject()["price"].toDouble(),12.0);QVERIFY(find(feed,"600000")["quote"].toObject()["cached"].toBool());
    auto ambiguous=stock();ambiguous["id"]="legacy:ambiguous:000001";
    QVERIFY_EXCEPTION_THROWN(feed.observe(ambiguous),std::exception);QCOMPARE(feed.instruments.size(),1);
    QVERIFY(!QFile::exists(dir.filePath("watchlist.json")));
  }
  void failedPromotionLeavesTransientAndPersistedRosterUnchanged() {
    QTemporaryDir dir;MarketFeed feed(dir.path());feed.observe(stock());
    QVERIFY(QDir().mkdir(dir.filePath("watchlist.json")));const auto before=feed.instruments;
    QVERIFY_EXCEPTION_THROWN(feed.add(stock()),std::exception);QCOMPARE(feed.instruments,before);QVERIFY(find(feed,"600000")["transient"].toBool());
  }
  void observeAndAddRespectExistingThreeThousandLimit() {
    QTemporaryDir dir;MarketFeed feed(dir.path());
    for(int n=0;n<3000;++n)feed.instruments.append(stock(QString::number(600000+n)));
    const auto before=feed.instruments;
    QVERIFY_EXCEPTION_THROWN(feed.observe(stock("688888")),std::exception);
    QVERIFY_EXCEPTION_THROWN(feed.add(stock("688888")),std::exception);QCOMPARE(feed.instruments,before);
    QVERIFY(!QFile::exists(dir.filePath("watchlist.json")));
  }
  void overCapacityImportDoesNotReplacePersistedWatchlist() {
    QTemporaryDir dir;MarketFeed feed(dir.path());feed.observe(stock());
    QJsonArray rows;for(int n=0;n<3000;++n)rows.append(stock(QString::number(601000+n)));
    const auto path=dir.filePath("input.json");QFile file(path);QVERIFY(file.open(QIODevice::WriteOnly));
    const auto bytes=QJsonDocument(QJsonObject{{"schema","native-watchlist/v1"},{"instruments",rows}}).toJson();QCOMPARE(file.write(bytes),bytes.size());file.close();
    const auto before=feed.instruments;QVERIFY_EXCEPTION_THROWN(feed.importFile(path),std::exception);
    QCOMPARE(feed.instruments,before);QVERIFY(!QFile::exists(dir.filePath("watchlist.json")));
  }
};
QTEST_GUILESS_MAIN(RecentFeedTests)
#include "recent_feed_tests.moc"
