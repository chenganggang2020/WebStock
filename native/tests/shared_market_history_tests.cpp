#include "market_feed.hpp"
#include "market_history.hpp"
#include "quant_plugin_widget.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QUrlQuery>
#include <cmath>
using namespace quantPlugin;

namespace {
QJsonObject query(QString start="2020-01-02",QString end="2020-01-03",QString adjustment="unadjusted"){
    return {{"securityId","SZ:stock:000001"},{"period","day"},{"sourceId","tencent-kline"},{"adjustment",adjustment},{"startDate",start},{"endDate",end}};
}
QJsonArray bars(QDate start,QDate end,double shift=0){
    QJsonArray result;for(auto d=start;d<=end;d=d.addDays(1))if(d.dayOfWeek()<=5){
        double close=20+std::sin(QDate(2020,1,1).daysTo(d)/4.)+shift;
        result.append(QJsonArray{d.toString(Qt::ISODate),QString::number(close-.1),QString::number(close),QString::number(close+1),QString::number(close-1),"100"});
    }return result;
}
QJsonObject raw(QJsonArray rows,QString key="day",QString symbol="sz000001"){
    return {{"code",0},{"data",QJsonObject{{symbol,QJsonObject{{key,rows}}}}}};
}
QJsonObject snapshot(QJsonObject q,QDateTime now=QDateTime::currentDateTimeUtc()){
    auto rows=bars(QDate::fromString(q["startDate"].toString(),Qt::ISODate),QDate::fromString(q["endDate"].toString(),Qt::ISODate));
    auto data=marketdata::kline(raw(rows,q["adjustment"]=="forward"?"qfqday":"day"),"sz000001","day",now);
    return marketHistory::annotate(data,q,true);
}
class Reply final:public QNetworkReply{
    QByteArray body_;qint64 position_=0;
public:
    Reply(const QNetworkRequest& request,QByteArray body,bool fail,int delay,QObject* parent):QNetworkReply(parent),body_(body){
        setRequest(request);setUrl(request.url());open(QIODevice::ReadOnly);
        QTimer::singleShot(delay,this,[this,fail]{if(isFinished())return;setAttribute(QNetworkRequest::HttpStatusCodeAttribute,fail?503:200);if(fail)setError(ServiceUnavailableError,"controlled source failure");setFinished(true);emit readyRead();emit finished();});
    }
    void abort()override{if(isFinished())return;setError(OperationCanceledError,"cancelled");setFinished(true);emit finished();}
    qint64 bytesAvailable()const override{return body_.size()-position_+QNetworkReply::bytesAvailable();}
    qint64 readData(char* out,qint64 count)override{count=qMin(count,body_.size()-position_);if(count<=0)return -1;memcpy(out,body_.constData()+position_,size_t(count));position_+=count;return count;}
};
class Network final:public QNetworkAccessManager{
public:
    QList<QStringList> requests;bool fail=false,wrongAdjustment=false,reviseSecondPage=false;int delay=1;
    QJsonArray chartRows=bars(QDate(2020,1,2),QDate(2020,4,30));
protected:
    QNetworkReply* createRequest(Operation,const QNetworkRequest& request,QIODevice*)override{
        auto p=QUrlQuery(request.url()).queryItemValue("param").split(',');requests.append(p);
        auto rows=p.value(2).isEmpty()?chartRows:bars(QDate::fromString(p.value(2),Qt::ISODate),QDate::fromString(p.value(3),Qt::ISODate),reviseSecondPage&&requests.size()>1?1.:0.);
        auto key=p.value(2).isEmpty()||wrongAdjustment?"day":p.value(5)=="qfq"?"qfqday":"day";
        return new Reply(request,QJsonDocument(raw(rows,key,p.value(0))).toJson(QJsonDocument::Compact),fail,delay,this);
    }
};
}
class SharedHistoryTests:public QObject{
    Q_OBJECT
    QString packages_,source_,output_;QJsonObject runtimes_,evidence_;
    void install(const QString& root,const QStringList& ids){
        QDir().mkpath(root);write(root+"/runtime-defaults.json",runtimes_);Repository repo(root);
        for(auto id:ids)repo.install(read(packages_+"/"+id+"-0.26.0.wspkg"));
    }
    void selectQuery(QuantPluginWidget& widget,const QJsonObject& q){
        widget.findChild<QComboBox*>("pluginDataSource")->setCurrentIndex(1);
        widget.findChild<QDateEdit*>("pluginParam_startDate")->setDate(QDate::fromString(q["startDate"].toString(),Qt::ISODate));
        widget.findChild<QDateEdit*>("pluginParam_endDate")->setDate(QDate::fromString(q["endDate"].toString(),Qt::ISODate));
        auto adjustment=widget.findChild<QComboBox*>("pluginParam_adjustment");adjustment->setCurrentIndex(adjustment->findData(q["adjustment"].toString()));
    }
    void shot(QWidget& widget,QString name){if(!output_.isEmpty()){QCoreApplication::processEvents();QVERIFY(widget.grab().save(output_+"/"+name+".png"));}}
private slots:
    void initTestCase(){
        packages_=qEnvironmentVariable("WEBSTOCK_CENTER_PACKAGES");source_=qEnvironmentVariable("WEBSTOCK_CENTER_SOURCE_ROOT");output_=qEnvironmentVariable("WEBSTOCK_SHARED_OUTPUT");
        if(!source_.isEmpty())for(auto v:object(read(source_+"/catalog.json"))["plugins"].toArray()){auto p=v.toObject();runtimes_[p["id"].toString()]=p["runtimePath"];}
        if(!output_.isEmpty())QDir().mkpath(output_);
        evidence_["fixture"]="Controlled Tencent transport responses; isolated temporary data roots; not real market acquisition";
        qApp->setFont(QFont("Microsoft YaHei",10));
    }
    void fullCacheZeroNetworkPartialOnlyMissingAndFailureKeepsOld(){
        QVERIFY(!packages_.isEmpty());QTemporaryDir dir;auto root=dir.filePath("quant-plugins");install(root,{"org.webstock.akshare"});
        Network net;MarketFeed feed(dir.filePath("live"),nullptr,&net,false);MarketStore store(feed.historyStorePath());auto q=query();
        bool done=false;QString error;feed.fetchHistory(q,false,[&](QJsonObject,QString e){error=e;done=true;});QTRY_VERIFY(done);QVERIFY2(error.isEmpty(),qPrintable(error));
        auto plan=feed.inspectHistory(q);QVERIFY(plan["complete"].toBool());QCOMPARE(plan["availableRows"].toInt(),2);net.requests.clear();
        QuantPluginWidget widget(root,nullptr,"org.webstock.akshare",false,&feed);widget.resize(1350,960);widget.show();selectQuery(widget,q);
        auto use=widget.findChild<QPushButton*>("pluginUseCache"),fill=widget.findChild<QPushButton*>("pluginRun"),refresh=widget.findChild<QPushButton*>("pluginRefreshMarket");
        QVERIFY(use->isEnabled());QVERIFY(!fill->isEnabled());use->click();QCOMPARE(net.requests.size(),0);QVERIFY(widget.findChild<QLabel*>("pluginMarketSummary"));shot(widget,"01-reuse-native-cache-zero-network");
        q["endDate"]="2020-01-06";selectQuery(widget,q);plan=feed.inspectHistory(q);
        QCOMPARE(plan["missingRanges"].toArray(),QJsonArray({QJsonObject{{"start","2020-01-04"},{"end","2020-01-06"}}}));
        QVERIFY(fill->isEnabled());fill->click();QTRY_VERIFY_WITH_TIMEOUT(!widget.isRunning(),5000);QCOMPARE(net.requests.size(),1);QCOMPARE(net.requests[0][2],QString("2020-01-04"));QCOMPARE(net.requests[0][3],QString("2020-01-06"));
        plan=feed.inspectHistory(q);QCOMPARE(plan["availableRows"].toInt(),3);QCOMPARE(plan["unknownDates"].toInt(),2);QVERIFY(!plan["complete"].toBool());QVERIFY(plan["missingRanges"].toArray().isEmpty());QVERIFY(!fill->isEnabled());shot(widget,"02-missing-range-only-with-unknown-dates");
        auto old=store.read(marketHistory::key(q));net.fail=true;refresh->click();QTRY_VERIFY_WITH_TIMEOUT(!widget.isRunning(),5000);QCOMPARE(store.read(marketHistory::key(q)),old);QVERIFY(widget.findChild<QLabel*>("pluginFailureReason")->text().contains("失败"));shot(widget,"03-refresh-failure-preserves-cache");
        auto count=net.requests.size();use->click();QCOMPARE(net.requests.size(),count);QVERIFY(widget.findChild<QLabel*>("pluginMarketSummary")->text().contains("非本次联网获取"));
        net.fail=false;net.delay=1000;refresh->click();QTRY_VERIFY(net.requests.size()>count);widget.findChild<QPushButton*>("pluginCancel")->click();QTRY_VERIFY_WITH_TIMEOUT(!widget.isRunning(),3000);QCOMPARE(store.read(marketHistory::key(q)),old);
        evidence_["cacheReuseAndGapFill"]=QJsonObject{{"fullCacheNetworkRequests",0},{"partialRequestStart","2020-01-04"},{"partialRequestEnd","2020-01-06"},{"actualBars",3},{"unexplainedDates",2},{"falseCompletenessClaim",false},{"refreshFailurePreservesOld",true},{"cancelPreservesOld",true}};
    }
    void identityLegacyAndIntegrity(){
        QTemporaryDir dir;MarketStore store(dir.filePath("market-v1.sqlite"));auto q=query();auto data=snapshot(q);auto saved=store.save(marketHistory::key(q),data);
        auto mismatch=q;mismatch["sourceId"]="akshare-eastmoney";QVERIFY(!marketHistory::inspect(store,mismatch)["compatible"].toBool());
        mismatch=q;mismatch["adjustment"]="forward";QVERIFY(!marketHistory::inspect(store,mismatch)["compatible"].toBool());
        mismatch=q;mismatch["period"]="week";QVERIFY(!marketHistory::inspect(store,mismatch)["compatible"].toBool());
        mismatch=q;mismatch["securityId"]="SH:index:000001";QVERIFY(!marketHistory::inspect(store,mismatch)["compatible"].toBool());
        mismatch["securityId"]="SH:stock:000001";QVERIFY_EXCEPTION_THROWN(marketHistory::query(mismatch),std::runtime_error);
        auto damaged=saved;auto rows=damaged["rows"].toArray();auto row=rows[0].toObject();row["volume"]=123.;rows[0]=row;damaged["rows"]=rows;QVERIFY_EXCEPTION_THROWN(marketHistory::validate(damaged,q),std::runtime_error);
        QTemporaryDir oldDir;MarketStore old(oldDir.filePath("market-v1.sqlite"));auto legacy=marketdata::kline(raw(bars(QDate(2020,1,2),QDate(2020,1,3))),"sz000001","day",QDateTime::currentDateTimeUtc());old.save("sz000001-day",legacy);
        auto plan=marketHistory::inspect(old,q);QVERIFY(plan["compatible"].toBool());QVERIFY(!plan["complete"].toBool());QVERIFY(plan["legacyWarning"].toString().contains("覆盖证据缺失"));QCOMPARE(plan["availableRows"].toInt(),2);
        auto tail=query("2020-01-06","2020-01-06");old.save(marketHistory::key(q),snapshot(tail));q["endDate"]="2020-01-06";plan=marketHistory::inspect(old,q);QCOMPARE(plan["availableRows"].toInt(),3);QCOMPARE(old.read("sz000001-day")["rows"].toArray().size(),2);
        legacy.remove("volumeUnit");QTemporaryDir badDir;MarketStore bad(badDir.filePath("market-v1.sqlite"));bad.save("sz000001-day",legacy);QVERIFY(!marketHistory::inspect(bad,q)["compatible"].toBool());
        evidence_["identityAndLegacy"]=QJsonObject{{"stockIndexCollisionRejected",true},{"sourceAdjustmentPeriodSeparated",true},{"verifiedLegacyBarsReused",true},{"legacyMissingMetadataNotPromoted",true},{"legacyNotClaimedComplete",true},{"checksumTamperingRejected",true}};
    }
    void sessionEvidenceAndTruncation(){
        QTemporaryDir dir;MarketStore store(dir.filePath("market-v1.sqlite"));auto q=query("2020-01-02","2020-01-06");auto data=snapshot(q);store.save(marketHistory::key(q),data);
        QCOMPARE(marketHistory::inspect(store,q)["unknownDates"].toInt(),2);
        data["sessionEvidence"]=QJsonObject{{"2020-01-04",QJsonObject{{"status","market-closed"},{"source","controlled-test-calendar"},{"version","fixture-1"}}},{"2020-01-05",QJsonObject{{"status","suspended"},{"source","controlled-test-disclosure"},{"version","fixture-1"}}}};
        store.save(marketHistory::key(q),data);auto plan=marketHistory::inspect(store,q);QVERIFY(plan["complete"].toBool());QCOMPARE(plan["knownMarketClosed"].toInt(),1);QCOMPARE(plan["knownSuspended"].toInt(),1);
        auto unlisted=query("2020-01-01","2020-01-03");data=snapshot(query());data["queryCoverage"]=QJsonArray{QJsonObject{{"start","2020-01-01"},{"end","2020-01-03"},{"evidence","provider-response-window"}}};data["sessionEvidence"]=QJsonObject{{"2020-01-01",QJsonObject{{"status","not-listed"},{"source","controlled-listing-register"},{"version","fixture-1"}}}};data["replaceHistory"]=true;store.save(marketHistory::key(q),data);QCOMPARE(marketHistory::inspect(store,unlisted)["knownNotListed"].toInt(),1);
        auto capped=marketHistory::annotate(snapshot(query()),query("2019-01-01","2020-01-06"),true,2);capped["replaceHistory"]=true;store.save(marketHistory::key(q),capped);plan=marketHistory::inspect(store,query("2019-01-01","2020-01-06"));QVERIFY(plan["sourceTruncated"].toBool());QCOMPARE(plan["missingRanges"].toArray().size(),2);QVERIFY(!plan["complete"].toBool());
        evidence_["calendarEvidence"]=QJsonObject{{"unknownIsNotWeekendAssumption",true},{"closedSuspendedNotListedRequireVersionedEvidence",true},{"truncatedResponseNotFullCoverage",true}};
    }
    void adjustedPaginationAtomicRefreshAndRevision(){
        QTemporaryDir dir;Network net;MarketFeed feed(dir.filePath("live"),nullptr,&net,false);MarketStore store(feed.historyStorePath());auto q=query("2018-01-02","2020-12-31","forward");
        auto old=snapshot(q,QDateTime::currentDateTimeUtc().addDays(-1));old["replaceHistory"]=true;old=store.save(marketHistory::key(q),old);auto plan=feed.inspectHistory(q);QVERIFY(plan["staleAdjusted"].toBool());QCOMPARE(plan["missingRanges"].toArray(),QJsonArray({QJsonObject{{"start",q["startDate"]},{"end",q["endDate"]}}}));
        bool done=false;QString error;net.reviseSecondPage=true;feed.fetchHistory(q,true,[&](QJsonObject,QString e){done=true;error=e;});QTRY_VERIFY_WITH_TIMEOUT(done,5000);QVERIFY(error.contains("修订"));QCOMPARE(store.read(marketHistory::key(q)),old);
        net.requests.clear();net.reviseSecondPage=false;done=false;feed.fetchHistory(q,true,[&](QJsonObject,QString e){done=true;error=e;});QTRY_VERIFY_WITH_TIMEOUT(done,5000);QVERIFY2(error.isEmpty(),qPrintable(error));QCOMPARE(net.requests.size(),3);
        auto saved=store.read(marketHistory::key(q));QVERIFY(saved["seriesKey"]!=old["seriesKey"]);QCOMPARE(saved["rows"].toArray().size(),bars(QDate(2018,1,2),QDate(2020,12,31)).size());QVERIFY(feed.inspectHistory(q)["missingRanges"].toArray().isEmpty());
        auto firstEnd=QDate::fromString(net.requests[0][3],Qt::ISODate),nextStart=QDate::fromString(net.requests[1][2],Qt::ISODate);QVERIFY(nextStart<=firstEnd);
        evidence_["adjustedRefresh"]=QJsonObject{{"staleRebuildsWholeRange",true},{"pages",3},{"overlapValidated",true},{"revisionAbortsWithoutReplacingOld",true},{"newSeriesVersion",saved["seriesKey"]},{"sourceRequestHashes",saved["sourceRequests"]}};
    }
    void nativeCacheToRealIndicatorBacktestAndUninstall(){
        QVERIFY(!packages_.isEmpty());QTemporaryDir dir;auto root=dir.filePath("quant-plugins");install(root,{"org.webstock.akshare","org.webstock.talib","org.webstock.backtesting-py"});
        Network net;MarketFeed feed(dir.filePath("live"),nullptr,&net,false);feed.instruments={QJsonObject{{"id","SZ:stock:000001"},{"symbol","sz000001"},{"name","Controlled fixture"}}};
        feed.chart("SZ:stock:000001","day",true);QTRY_COMPARE_WITH_TIMEOUT(feed.instruments[0].toObject()["dayMeta"].toObject()["persistenceState"].toString(),QString("saved"),5000);
        auto q=query("2020-01-02","2020-04-30");auto plan=feed.inspectHistory(q);QVERIFY(plan["compatible"].toBool());auto token=marketHistory::token(plan["snapshot"].toObject(),q);net.requests.clear();
        Job reader(root);auto input=reader.marketDataInput(token);QCOMPARE(net.requests.size(),0);QCOMPARE(input["policy"].toObject()["dataset"].toObject()["securityId"].toString(),QString("SZ:stock:000001"));
        QCOMPARE(input["result"].toObject()["tables"].toArray()[0].toObject()["rows"].toArray()[0].toArray()[6].toDouble(),10000.);
        QJsonArray runs;
        for(auto id:{"org.webstock.talib","org.webstock.backtesting-py"}){
            QuantPluginWidget consumer(root,nullptr,id);consumer.resize(1350,920);consumer.show();
            if(QString(id)=="org.webstock.talib"){auto ops=consumer.findChild<QComboBox*>("pluginOperation");for(int i=0;i<ops->count();++i)if(ops->itemData(i).toJsonObject()["id"]=="rsi")ops->setCurrentIndex(i);}
            consumer.useSavedData(token);consumer.findChild<QPushButton*>("pluginRun")->click();QTRY_VERIFY_WITH_TIMEOUT(!consumer.isRunning(),30000);
            QJsonObject record;for(auto v:reader.records())if(v.toObject()["pluginId"]==id)record=v.toObject();QCOMPARE(record["status"].toString(),QString("completed"));auto result=reader.reopen(record["runId"].toString())["result"].toObject();
            QCOMPARE(result["inputSha256"].toString(),hash(read(input["path"].toString())));QCOMPARE(result["dataPolicy"].toObject()["sharedMarketVersion"],input["summary"].toObject()["version"]);QCOMPARE(result["dataPolicy"].toObject()["source"].toString(),QString("tencent-kline"));
            runs.append(QJsonObject{{"pluginId",id},{"inputSha256",result["inputSha256"]},{"dataPolicy",result["dataPolicy"]},{"runId",record["runId"]}});shot(consumer,QString(id)=="org.webstock.talib"?"04-native-cache-rsi":"05-native-cache-backtest");
            if(!output_.isEmpty())write(output_+"/"+QString(id)+"-native-cache.wsresult",reader.exportResult(record["runId"].toString()));
        }
        Repository repo(root);repo.uninstall("org.webstock.akshare");QCOMPARE(reader.marketDataInput(token)["summary"],input["summary"]);QVERIFY(feed.inspectHistory(q)["compatible"].toBool());QCOMPARE(net.requests.size(),0);
        auto changed=snapshot(q);auto all=changed["rows"].toArray();auto first=all[0].toObject();first["volume"]=111.;all[0]=first;changed["rows"]=all;MarketStore(feed.historyStorePath()).save(marketHistory::key(q),changed);
        QVERIFY_EXCEPTION_THROWN(reader.marketDataInput(token),std::runtime_error);for(auto v:runs)QCOMPARE(reader.reopen(v.toObject()["runId"].toString())["status"].toString(),QString("completed"));
        evidence_["nativeToResearch"]=QJsonObject{{"nativeChartProducer",true},{"consumerNetworkRequests",0},{"unitsConvertedToShares",true},{"sourceUninstallRetainsPublicCache",true},{"staleSelectionRejected",true},{"frozenRunsSurviveLaterCacheRevision",true},{"runs",runs}};
    }
    void existingNativeCacheToConsumers(){
        QVERIFY(!source_.isEmpty());QTemporaryDir dir;auto root=dir.filePath("quant-plugins");install(root,{"org.webstock.talib","org.webstock.backtesting-py"});
        MarketStore original(QFileInfo(source_).absolutePath()+"/live/market-v1.sqlite");
        QDir().mkpath(dir.filePath("live"));MarketStore copied(dir.filePath("live/market-v1.sqlite"));
        auto key=QString("sh000001-day");auto before=original.read(key);QVERIFY(!before.isEmpty());copied.save(key,before);
        Job reader(root);auto datasets=reader.savedMarketData();QVERIFY(!datasets.isEmpty());auto dataset=datasets[0].toObject();QCOMPARE(dataset["securityId"].toString(),QString("SH:index:000001"));
        auto input=reader.marketDataInput(dataset["runId"].toString());QJsonArray runs;
        for(auto id:{"org.webstock.talib","org.webstock.backtesting-py"}){
            Repository repo(root);auto plugin=repo.plugin(id);auto op=QString(id)=="org.webstock.talib"?QString("rsi"):plugin["manifest"].toObject()["operations"].toArray().first().toObject()["id"].toString();
            Job job(root);job.start(id,op,input["path"].toString(),{},input["policy"].toObject(),60);QTRY_VERIFY_WITH_TIMEOUT(!job.active(),30000);QCOMPARE(job.current()["status"].toString(),QString("completed"));
            auto result=job.reopen(job.current()["runId"].toString())["result"].toObject();QCOMPARE(result["inputSha256"].toString(),hash(read(input["path"].toString())));QCOMPARE(result["dataPolicy"].toObject()["dataset"].toObject()["securityId"].toString(),QString("SH:index:000001"));
            runs.append(QJsonObject{{"pluginId",id},{"operationId",op},{"status","completed"},{"inputSha256",result["inputSha256"]}});
            if(!output_.isEmpty())write(output_+"/"+QString(id)+"-original-native-cache.wsresult",job.exportResult(job.current()["runId"].toString()));
        }
        QCOMPARE(original.read(key),before);
        evidence_["originalNativeCache"]=QJsonObject{{"sourceKey",key},{"sourceContentSha256",hash(QJsonDocument(before).toJson(QJsonDocument::Compact))},{"sourceCheckedAt",before["checkedAt"]},{"sourceUnchanged",true},{"networkRequests",0},{"copiedToIsolatedTestRoot",true},{"dataset",input["summary"]},{"runs",runs}};
    }
    void realTencentRequest(){
        if(!qEnvironmentVariableIsSet("WEBSTOCK_SHARED_LIVE"))QSKIP("Explicit real source probe is opt-in");
        QTemporaryDir dir;MarketFeed feed(dir.filePath("live"),nullptr,nullptr,false);auto q=query("2020-01-02","2020-01-03");bool done=false;QString error;QJsonObject result;
        feed.fetchHistory(q,false,[&](QJsonObject r,QString e){result=r;error=e;done=true;});QTRY_VERIFY_WITH_TIMEOUT(done,20000);
        evidence_["realTencentProbe"]=QJsonObject{{"query",q},{"success",error.isEmpty()},{"error",error},{"bars",result["rows"].toArray().size()},{"sourceRequests",result["sourceRequests"]}};
        if(error.isEmpty())QVERIFY(feed.inspectHistory(q)["compatible"].toBool());else QVERIFY(!QFileInfo::exists(feed.historyStorePath()));
    }
    void cleanupTestCase(){if(!output_.isEmpty())write(output_+"/shared-market-verification.json",evidence_);}
};
QTEST_MAIN(SharedHistoryTests)
#include "shared_market_history_tests.moc"
