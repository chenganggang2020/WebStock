#include "etf_schedule.hpp"
#include <QFile>
#include <QTemporaryDir>
#include <QtTest>
class EtfScheduleTests : public QObject {
  Q_OBJECT
  QDateTime at(QString time) { return QDateTime::fromString(time, Qt::ISODate); }
  QJsonObject enabled() { return {{"scheduleEnabled", true}}; }
  void attempted(QJsonObject &s, const QString &key, const QDateTime &now) {
    s["lastScheduledKey"] = key;
    s["lastScheduledAt"] = now.toUTC().toString(Qt::ISODateWithMs);
  }
  QJsonObject report() {
    QFile file(QFINDTESTDATA("../../test/fixtures/eastmoney-etf-daily-20260910.html"));
    if(!file.open(QIODevice::ReadOnly)) throw std::runtime_error("fixture missing");
    return etfDaily::article(QString::fromUtf8(file.readAll()),
      {{"code","202609103869906865"},{"title","ETF追踪丨9月9日股票型ETF净赎回20亿元"},
       {"stime","2026-09-10 08:00:59"},{"source","东方财富Choice数据"}},
      at("2026-09-10T08:50:00+08:00"));
  }
private slots:
  void unverifiedOrImportedReportDoesNotCompleteDay() {
    auto now=at("2026-09-10T08:50:00+08:00");
    for (auto marker : {QString(), QString("legacy-import"),
                        QString("catalog+article-footer"),
                        QString("catalog+official-content-api")}) {
      QTemporaryDir dir;etfDaily::Store store(dir.filePath("etf.sqlite"));
      store.setScheduleEnabled(true);etfDaily::ScheduleClock clock;
      auto r=report();r["sourceVerification"]=marker;
      store.importReports({r},now);
      QVERIFY(store.state()["lastSuccessTargetDate"].toString().isEmpty());
      auto token=store.beginScheduled(clock,now);QVERIFY(!token.isEmpty());
      QVERIFY(store.finish(token,r,now.addSecs(1)));
      const bool verified=marker=="catalog+article-footer" || marker=="catalog+official-content-api";
      QCOMPARE(store.state()["lastSuccessTargetDate"].toString(),
               verified ? QString("2026-09-10") : QString());
    }
  }
  void atomicPersistentClaimAndSuccess() {
    QTemporaryDir dir;etfDaily::Store store(dir.filePath("etf.sqlite"));
    etfDaily::ScheduleClock clock;
    auto now=at("2026-09-10T08:50:00+08:00");
    QVERIFY(store.beginScheduled(clock,now).isEmpty());
    store.setScheduleEnabled(true);
    auto token=store.beginScheduled(clock,now);QVERIFY(!token.isEmpty());
    auto state=store.state();
    QCOMPARE(state["lastScheduledKey"].toString(),QString("2026-09-10@08:50"));
    QCOMPARE(state["activeToken"].toString(),token);
    etfDaily::Store other(dir.filePath("etf.sqlite"));etfDaily::ScheduleClock restarted;
    QVERIFY(other.beginScheduled(restarted,now).isEmpty());
    QVERIFY(store.finish(token,report(),now.addSecs(1)));
    QCOMPARE(other.state()["lastSuccessTargetDate"].toString(),QString("2026-09-10"));
    QVERIFY(other.beginScheduled(restarted,now.addSecs(600)).isEmpty());
  }
  void oldReportFailureDisableAndManualCooldown() {
    QTemporaryDir dir;etfDaily::Store store(dir.filePath("etf.sqlite"));
    store.setScheduleEnabled(true);etfDaily::ScheduleClock clock;
    auto now=at("2026-09-11T08:50:00+08:00");
    auto token=store.beginScheduled(clock,now);
    QVERIFY(store.finish(token,report(),now.addSecs(1)));
    QVERIFY(store.state()["lastSuccessTargetDate"].toString().isEmpty());
    token=store.beginScheduled(clock,now.addSecs(600));QVERIFY(!token.isEmpty());
    QVERIFY(store.fail(token,"受控失败",now.addSecs(601)));
    QCOMPARE(store.history().size(),1);
    store.setScheduleEnabled(false);
    QVERIFY(store.beginScheduled(clock,now.addSecs(1200)).isEmpty());
    store.setScheduleEnabled(true);
    auto manual=store.begin(now.addSecs(1190));
    QVERIFY(store.beginScheduled(clock,now.addSecs(1200)).isEmpty());
    QVERIFY(store.fail(manual,"取消",now.addSecs(1201)));
    QVERIFY(!store.beginScheduled(clock,now.addSecs(1250)).isEmpty());
  }
  void slotsAndRestartDeduplication() {
    etfDaily::ScheduleClock clock;
    auto s=enabled();
    for (auto time : {"08:50:00", "09:00:00", "09:10:00", "09:20:00"}) {
      auto now=at(QString("2026-09-10T")+time+"+08:00");
      auto key=clock.due(s,now);
      QCOMPARE(key,QString("2026-09-10@")+QString(time).left(5));
      attempted(s,key,now);
      etfDaily::ScheduleClock restarted;
      QVERIFY(restarted.due(s,now).isEmpty());
    }
    QVERIFY(clock.due(s,at("2026-09-10T09:24:59+08:00")).isEmpty());
  }
  void lateStartupOnlyOnceAndNoContinuousCatchup() {
    auto s=enabled();etfDaily::ScheduleClock clock;
    auto now=at("2026-09-10T09:20:00+08:00");
    auto key=clock.due(s,now);attempted(s,key,now);
    QVERIFY(clock.due(s,at("2026-09-10T12:00:00+08:00")).isEmpty());
    etfDaily::ScheduleClock restarted;
    now=at("2026-09-10T12:00:00+08:00");
    key=restarted.due(s,now);QCOMPARE(key,QString("2026-09-10@catchup"));
    attempted(s,key,now);
    etfDaily::ScheduleClock again;
    QVERIFY(again.due(s,at("2026-09-10T14:00:00+08:00")).isEmpty());
  }
  void actualAttemptSpacingAndClockRollback() {
    etfDaily::ScheduleClock clock;auto s=enabled();
    auto now=at("2026-09-10T08:59:59+08:00");
    attempted(s,clock.due(s,now),now);
    QVERIFY(clock.due(s,at("2026-09-10T09:00:00+08:00")).isEmpty());
    QCOMPARE(clock.due(s,at("2026-09-10T09:09:59+08:00")),QString("2026-09-10@09:00"));
    s["lastScheduledAt"]="2026-09-11T01:00:00Z";
    QVERIFY(clock.due(s,at("2026-09-10T09:10:00+08:00")).isEmpty());
  }
  void successOnlyForTargetDay() {
    etfDaily::ScheduleClock clock;auto s=enabled();
    s["lastSuccessTargetDate"]="2026-09-10";
    QVERIFY(clock.due(s,at("2026-09-10T08:50:00+08:00")).isEmpty());
    QCOMPARE(clock.due(s,at("2026-09-11T08:50:00+08:00")),QString("2026-09-11@08:50"));
    s.remove("lastSuccessTargetDate");s["attemptStatus"]="checked";
    etfDaily::ScheduleClock other;
    QCOMPARE(other.due(s,at("2026-09-10T08:50:00+08:00")),QString("2026-09-10@08:50"));
  }
  void disabledHolidaysAndUnknownYearNeverRun() {
    etfDaily::ScheduleClock clock;
    QVERIFY(clock.due({},at("2026-09-10T08:50:00+08:00")).isEmpty());
    for(auto text:{"2026-09-10T08:49:59+08:00","2026-09-12T09:00:00+08:00",
                   "2026-10-01T09:00:00+08:00","2027-01-04T09:00:00+08:00"})
      QVERIFY(clock.due(enabled(),at(text)).isEmpty());
    QVERIFY(clock.due(enabled(),QDateTime()).isEmpty());
  }
  void observedDayIsNotResetByToggling() {
    etfDaily::ScheduleClock clock;auto s=enabled();
    s["scheduleEnabled"]=false;
    QVERIFY(clock.due(s,at("2026-09-10T08:00:00+08:00")).isEmpty());
    s["scheduleEnabled"]=true;
    QVERIFY(clock.due(s,at("2026-09-10T10:00:00+08:00")).isEmpty());
    QCOMPARE(clock.due(s,at("2026-09-11T08:50:00+08:00")),QString("2026-09-11@08:50"));
  }
};
QTEST_GUILESS_MAIN(EtfScheduleTests)
#include "etf_schedule_tests.moc"
