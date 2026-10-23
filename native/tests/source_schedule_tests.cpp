#include <QTemporaryDir>
#include <QtTest>

#include "source_schedule.hpp"

class SourceScheduleTests : public QObject {
  Q_OBJECT
  QJsonObject plan(QString suffix = "abcdef") {
    return {{"name", "测试作者"},
            {"profileUrl", "https://www.douyin.com/user/" + suffix},
            {"rightsBasis", "隔离测试授权"},
            {"limit", 20},
            {"intervalMinutes", 30}};
  }
 private slots:
  void resumedCandidatesAreSeparateFromCurrentDiscoveryAndOldCountsRemainCompatible() {
    QTemporaryDir dir;
    SourceSchedule store(dir.filePath("plans.sqlite"));
    auto value = plan(); value["limit"] = 12;
    auto p = store.save(value);
    auto run = store.begin(p["id"].toString(), 1000, true);
    try {
      QVERIFY(store.finish(run["id"].toString(), "complete", 2000,
                           {{"discovered", 1}, {"resumed", 12}, {"processed", 12}, {"queued", 0}}, "本机续办"));
    } catch (const std::exception& e) { QFAIL(e.what()); }
    auto counts = store.history()[0].toObject()["counts"].toObject();
    QCOMPARE(counts["discovered"].toInt(), 1); QCOMPARE(counts["resumed"].toInt(), 12);
    auto next = store.begin(p["id"].toString(), 3000, true);
    QVERIFY(store.finish(next["id"].toString(), "complete", 4000,
                         {{"discovered", 1}, {"processed", 1}, {"queued", 0}}, "旧计数输入"));
    QCOMPARE(store.history()[0].toObject()["counts"].toObject()["resumed"].toInt(), 0);
    QCOMPARE(store.history()[1].toObject()["counts"].toObject(), counts);
  }
  void resumedCountsCannotBypassRoundLimitOrCountConservation() {
    QTemporaryDir dir;
    SourceSchedule store(dir.filePath("plans.sqlite"));
    auto value = plan(); value["limit"] = 2;
    auto p = store.save(value);
    auto run = store.begin(p["id"].toString(), 1000, true);
    const QJsonObject invalid[] = {
      {{"discovered", 0}, {"resumed", -1}, {"processed", 0}},
      {{"discovered", 1}, {"resumed", 51}, {"processed", 1}},
      {{"discovered", 0}, {"resumed", 1}, {"processed", 2}},
      {{"discovered", 100}, {"resumed", 0}, {"processed", 3}},
      {{"discovered", 1}, {"resumed", 1}, {"processed", 1}, {"queued", 2}},
      {{"discovered", 1}, {"resumed", 0.5}, {"processed", 1}}
    };
    for (auto counts : invalid) {
      QVERIFY_EXCEPTION_THROWN(store.finish(run["id"].toString(), "complete", 2000, counts, "invalid"), std::exception);
      QCOMPARE(store.history()[0].toObject()["state"].toString(), QString("running"));
    }
  }
  void exactItemsPersistAcrossInterruptedRestartAndNeverChangeAfterFinish() {
    QTemporaryDir dir;
    QString runId;
    QJsonObject item{{"collectionId","local-job"},{"executionRevision",""},
                     {"sourceAttemptId","attempt-1"},{"contentId","7259684447530929443"},
                     {"sourceUrl","https://www.douyin.com/video/7259684447530929443"},
                     {"title","精确任务版本"}};
    {
      SourceSchedule store(dir.filePath("plans.sqlite"));
      const auto id=store.save(plan())["id"].toString();
      runId=store.begin(id,1000,true)["id"].toString();
      store.recordItem(runId,item);
      store.recordItem(runId,item);
      QCOMPARE(store.history()[0].toObject()["items"].toArray(),QJsonArray{item});
      auto conflict=item;conflict["executionRevision"]="replacement";
      QVERIFY_EXCEPTION_THROWN(store.recordItem(runId,conflict),std::exception);
    }
    SourceSchedule reopened(dir.filePath("plans.sqlite"));
    const auto snapshot=reopened.history()[0].toObject();
    QCOMPARE(snapshot["state"].toString(),QString("interrupted"));
    QCOMPARE(snapshot["items"].toArray(),QJsonArray{item});
    QVERIFY_EXCEPTION_THROWN(reopened.recordItem(runId,item),std::exception);
    QCOMPARE(reopened.history()[0].toObject(),snapshot);
  }
  void archiveConflictRollsBackAndNeverEnablesPlans() {
    QTemporaryDir dir;SourceSchedule store(dir.filePath("plans.sqlite"));
    auto row=[](int id){return QJsonObject{{"id","legacy-webstock:sync-run:"+QString::number(id)},{"startedAt","2026-10-10T08:00:00Z"},{"status","completed"},{"counts",QJsonObject{{"transcribed_count",0}}},{"items",QJsonArray{QJsonObject{{"contentId","123"},{"transcription_status","runtime_missing"}}}}};};
    auto file=sourceHistory::bundle(QJsonArray{row(1)});QCOMPARE(store.importHistory(file),1);QCOMPARE(store.importHistory(file),0);
    QVERIFY(store.plans().isEmpty());QVERIFY(store.due(9999999).isEmpty());auto anchor=store.historyAnchor(true);
    auto changed=row(1);changed["status"]="error";
    QVERIFY_EXCEPTION_THROWN(store.importHistory(sourceHistory::bundle(QJsonArray{row(2),changed})),std::exception);
    QCOMPARE(store.historyCount(true,store.historyAnchor(true)),1);
    auto exported=store.exportHistory(true,anchor);QCOMPARE(exported["runs"].toArray().size(),1);
    auto saved=exported["runs"].toArray()[0].toObject();QVERIFY(!saved["counts"].toObject().contains("discovered_count"));
    QVERIFY_EXCEPTION_THROWN(store.importHistory(sourceHistory::bundle(QJsonArray{row(2),row(2)})),std::exception);
  }
  void historyBeyond200IsPagedAndStable() {
    QTemporaryDir dir;
    SourceSchedule store(dir.filePath("plans.sqlite"));
    auto id = store.save(plan())["id"].toString();
    for(int i=0;i<205;++i) {
      auto run=store.begin(id,1000,true);
      QVERIFY(store.finish(run["id"].toString(),"complete",2000,{},QString::number(i)));
    }
    const auto anchor=store.historyAnchor(false);
    QCOMPARE(store.historyCount(false,anchor),205);
    auto page=store.historyPage(false,anchor,200);
    QCOMPARE(page.size(),5);
    QCOMPARE(page[4].toObject()["message"].toString(),QString("0"));
    auto run=store.begin(id,3000,true);
    QVERIFY(store.finish(run["id"].toString(),"complete",3001,{},"new"));
    QCOMPARE(store.historyPage(false,anchor,200),page);
    QCOMPARE(store.historyCount(false,store.historyAnchor(false)),206);
    QVERIFY_EXCEPTION_THROWN(store.historyPage(false,anchor,-1),std::exception);
  }
  void persistValidateAndSingleOwner() {
    QTemporaryDir dir;
    QString id;
    {
      SourceSchedule store(dir.filePath("plans.sqlite"));
      auto value = store.save(plan());
      id = value["id"].toString();
      QVERIFY(!id.isEmpty());
      QVERIFY(!value["enabled"].toBool());
      QVERIFY(store.due(1000).isEmpty());
      auto changed = plan();
      changed["name"] = "更名";
      QCOMPARE(store.save(changed)["id"].toString(), id);
      QCOMPARE(store.plans().size(), 1);
      QVERIFY_EXCEPTION_THROWN(
          SourceSchedule second(dir.filePath("plans.sqlite")), std::exception);
      changed["limit"] = 51;
      QVERIFY_EXCEPTION_THROWN(store.save(changed), std::exception);
      QCOMPARE(store.plans()[0].toObject()["limit"].toInt(), 20);
      changed = plan();
      changed["rightsBasis"] = " ";
      QVERIFY_EXCEPTION_THROWN(store.save(changed), std::exception);
      changed = plan();
      changed["profileUrl"] = "https://evil.example/user/abcdef";
      QVERIFY_EXCEPTION_THROWN(store.save(changed), std::exception);
    }
    SourceSchedule reopened(dir.filePath("plans.sqlite"));
    QCOMPARE(reopened.plans()[0].toObject()["id"].toString(), id);
    QCOMPARE(reopened.plans()[0].toObject()["name"].toString(),
             QString("更名"));
  }
  void dueSerialCompletionAndLateResults() {
    QTemporaryDir dir;
    SourceSchedule store(dir.filePath("plans.sqlite"));
    auto a = store.save(plan()), b = store.save(plan("ghijkl"));
    auto aid = a["id"].toString(), bid = b["id"].toString();
    store.enable(aid, true);
    store.enable(bid, true);
    auto first = store.due(1000);
    QVERIFY(!first.isEmpty());
    auto run = store.begin(first["id"].toString(), 1000, false);
    QVERIFY(store.due(1001).isEmpty());
    QVERIFY_EXCEPTION_THROWN(store.begin(bid, 1001, true), std::exception);
    QVERIFY_EXCEPTION_THROWN(store.save(first), std::exception);
    QVERIFY(store.finish(run["id"].toString(), "complete", 2000,
                         {{"discovered", 20}, {"processed", 3}, {"queued", 2}},
                         "已交下游"));
    auto other = store.due(2001);
    QVERIFY(other["id"] != first["id"]);
    auto run2 = store.begin(other["id"].toString(), 2001, false);
    QVERIFY(
        store.finish(run2["id"].toString(), "cancelled", 2002, {}, "用户停止"));
    QVERIFY(store.due(2003).isEmpty());
    auto before = store.history();
    QVERIFY(
        !store.finish(run["id"].toString(), "failed", 3000, {}, "迟到回调"));
    QCOMPARE(store.history(), before);
    QCOMPARE(before[1].toObject()["counts"].toObject()["queued"].toInt(), 2);
    store.enable(aid, false);
    store.enable(bid, false);
    QVERIFY(store.due(999999999).isEmpty());
  }
  void restartMarksInterruptedWithoutExecution() {
    QTemporaryDir dir;
    QString id, run;
    {
      SourceSchedule store(dir.filePath("plans.sqlite"));
      id = store.save(plan())["id"].toString();
      store.enable(id, true);
      run = store.begin(id, 1000, false)["id"].toString();
    }
    SourceSchedule store(dir.filePath("plans.sqlite"));
    auto previous = store.history()[0].toObject();
    QCOMPARE(previous["id"].toString(), run);
    QCOMPARE(previous["state"].toString(), QString("interrupted"));
    QCOMPARE(store.history().size(), 1);
    QVERIFY(!store.finish(run, "complete", 2000, {}, "旧结果"));
  }
  void invalidFinishCannotPartiallyCommit() {
    QTemporaryDir dir;
    SourceSchedule store(dir.filePath("plans.sqlite"));
    auto a = store.save(plan());
    auto run = store.begin(a["id"].toString(), 1000, true);
    QVERIFY_EXCEPTION_THROWN(store.finish(run["id"].toString(), "complete",
                                          2000, {{"queued", -1}}, ""),
                             std::exception);
    QCOMPARE(store.history()[0].toObject()["state"].toString(),
             QString("running"));
    QVERIFY_EXCEPTION_THROWN(
        store.finish(run["id"].toString(), "anything", 2000, {}, ""),
        std::exception);
    QVERIFY(store.finish(run["id"].toString(), "failed", 2000, {}, "失败保留"));
    auto snap = store.history()[0].toObject()["plan"].toObject();
    auto edit = plan();
    edit["name"] = "后来修改";
    store.save(edit);
    QCOMPARE(store.history()[0].toObject()["plan"].toObject(), snap);
  }
};
QTEST_GUILESS_MAIN(SourceScheduleTests)
#include "source_schedule_tests.moc"
