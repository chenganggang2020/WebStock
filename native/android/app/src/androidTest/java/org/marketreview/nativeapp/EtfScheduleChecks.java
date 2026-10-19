package org.marketreview.nativeapp;
import java.io.File;
import java.time.*;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Deterministic Beijing clock plus actual device SQLite. No live source. */
final class EtfScheduleChecks {
  static Instant at(String time) { return OffsetDateTime.parse(time).toInstant(); }
  static Instant day(String time) { return at("2026-09-10T" + time + "+08:00"); }
  static JSONObject enabled() throws Exception {
    return new JSONObject().put("scheduleEnabled", true);
  }
  static void attempted(JSONObject s, String key, Instant now) throws Exception {
    s.put("lastScheduledKey", key).put("lastScheduledAt", now.toString());
  }
  static void model(FlowInstrumentation f) throws Exception {
    EtfSchedule.Clock clock = new EtfSchedule.Clock();
    JSONObject s = enabled();
    for (String time : new String[] {"08:50:00", "09:00:00", "09:10:00", "09:20:00"}) {
      Instant now = day(time);
      String key = clock.due(s, now);
      f.check(key.equals("2026-09-10@" + time.substring(0,5)), "four Beijing slots: " + time);
      attempted(s,key,now);
      f.check(new EtfSchedule.Clock().due(s, now).isEmpty(), "same slot survives new process clock");
    }
    f.check(clock.due(s, day("09:24:59")).isEmpty(), "no extra same window");
    f.check(clock.due(s, day("12:00:00")).isEmpty(), "continuous process does not catch up");
    String late = new EtfSchedule.Clock().due(s, day("12:00:00"));
    f.check(late.equals("2026-09-10@catchup"), "late startup catches once");
    attempted(s,late,day("12:00:00"));
    f.check(new EtfSchedule.Clock().due(s, day("14:00:00")).isEmpty(), "persistent catchup dedup");
    s=enabled();clock=new EtfSchedule.Clock();
    attempted(s,clock.due(s,day("08:59:59")),day("08:59:59"));
    f.check(clock.due(s,day("09:00:00")).isEmpty(), "actual ten minute spacing");
    f.check(clock.due(s,day("09:09:59")).equals("2026-09-10@09:00"), "latest eligible slot only");
    s.put("lastScheduledAt",at("2026-09-11T09:00:00+08:00").toString());
    f.check(clock.due(s,day("09:10:00")).isEmpty(), "rollback refuses auto");
    s.put("lastScheduledAt","invalid");
    f.check(clock.due(s,day("09:10:00")).isEmpty(), "corrupt persisted clock refuses auto");
    s=enabled().put("lastSuccessTargetDate","2026-09-10");clock=new EtfSchedule.Clock();
    f.check(clock.due(s,day("08:50:00")).isEmpty(), "known target success ends day");
    f.check(clock.due(s,at("2026-09-11T08:50:00+08:00")).equals("2026-09-11@08:50"), "next day target differs");
    s.remove("lastSuccessTargetDate");s.put("attemptStatus","checked");
    f.check(new EtfSchedule.Clock().due(s,day("08:50:00")).equals("2026-09-10@08:50"), "HTTP checked alone not covered target");
    for(String time:new String[]{"2026-09-10T08:49:59+08:00","2026-09-12T09:00:00+08:00","2026-10-01T09:00:00+08:00","2027-01-04T09:00:00+08:00"})
      f.check(new EtfSchedule.Clock().due(enabled(),at(time)).isEmpty(), "calendar/prewindow refuses " + time);
    f.check(new EtfSchedule.Clock().due(enabled(),null).isEmpty(), "missing clock refuses");
    clock=new EtfSchedule.Clock();s=enabled().put("scheduleEnabled",false);
    f.check(clock.due(s,day("08:00:00")).isEmpty(), "off by default");
    s.put("scheduleEnabled",true);
    f.check(clock.due(s,day("10:00:00")).isEmpty(), "toggle does not fake startup");
    f.check(clock.due(s,at("2026-09-11T08:50:00+08:00")).equals("2026-09-11@08:50"), "next observed day resets only memory clock");
    f.check(new EtfSchedule.Clock().due(enabled(),day("09:24:59")).equals("2026-09-10@09:20"),"last regular second uses09:20");
    f.check(new EtfSchedule.Clock().due(enabled(),day("09:25:00")).equals("2026-09-10@catchup"),"cold process exact09:25 catchup boundary");
    store(f);
  }
  static EtfDaily.Store fresh(FlowInstrumentation f) {
    return new EtfDaily.Store(new File(f.getTargetContext().getCacheDir(),
                                       "etf-schedule-" + UUID.randomUUID() + ".sqlite"));
  }
  static JSONObject report(FlowInstrumentation f) throws Exception {
    return EtfDaily.article(EtfDailyChecks.html(f), EtfDailyChecks.item(), day("08:50:00"));
  }
  static void store(FlowInstrumentation f) throws Exception {
    Instant now=day("08:50:00");
    EtfDaily.Store s=fresh(f);EtfSchedule.Clock clock=new EtfSchedule.Clock();
    f.check(s.beginScheduled(clock,now).isEmpty(),"store default-off");
    s.setScheduleEnabled(true);
    String token=s.beginScheduled(clock,now);
    f.check(!token.isEmpty(),"enabled schedule atomically claims a network token");
    JSONObject state=s.state();
    f.check(state.optString("activeToken").equals(token) && state.optString("lastScheduledKey").equals("2026-09-10@08:50"),"claim+slot persisted together");
    EtfDaily.Store other=new EtfDaily.Store(s.file);
    f.check(other.beginScheduled(new EtfSchedule.Clock(),now).isEmpty(),"other store refuses duplicate slot");
    JSONObject r=report(f);
    f.check(s.finish(token,r,now.plusSeconds(1)),"source-verified commit");
    f.check(other.state().optString("lastSuccessTargetDate").equals("2026-09-10"),"verified previous known trading day stops target");
    f.check(other.beginScheduled(new EtfSchedule.Clock(),now.plusSeconds(600)).isEmpty(),"same day successful target suppressed");
    EtfDaily.Store old=fresh(f);old.setScheduleEnabled(true);clock=new EtfSchedule.Clock();
    now=at("2026-09-11T08:50:00+08:00");token=old.beginScheduled(clock,now);
    f.check(old.finish(token,r,now.plusSeconds(1)) && old.state().optString("lastSuccessTargetDate").isEmpty(),"old HTTP report not target success");
    token=old.beginScheduled(clock,now.plusSeconds(600));
    f.check(!token.isEmpty() && old.fail(token,"受控失败",now.plusSeconds(601)),"next slot after stale source attempts");
    old.setScheduleEnabled(false);
    f.check(old.beginScheduled(clock,now.plusSeconds(1200)).isEmpty() && old.history().length()==1,"disable/failure keep report");
    old.setScheduleEnabled(true);String manual=old.begin(now.plusSeconds(1190));
    f.check(old.beginScheduled(clock,now.plusSeconds(1200)).isEmpty(),"manual60s protects auto claim");
    old.fail(manual,"受控取消",now.plusSeconds(1201));
    f.check(!old.beginScheduled(clock,now.plusSeconds(1250)).isEmpty(),"manual60s window becomes eligible");
    EtfDaily.Store imported=fresh(f);imported.importReports(new JSONArray().put(r),day("08:50:00"));imported.setScheduleEnabled(true);
    f.check(!imported.beginScheduled(new EtfSchedule.Clock(),day("08:50:00")).isEmpty() && imported.state().optString("lastSuccessTargetDate").isEmpty(),"verified-looking import never changes schedule success");
    EtfDaily.Store legacy=fresh(f);JSONObject unverified=new JSONObject(r.toString());unverified.remove("sourceVerification");
    token=legacy.begin(day("08:50:00"));legacy.finish(token,unverified,day("08:50:01"));
    f.check(legacy.state().optString("lastSuccessTargetDate").isEmpty(),"legacy cached shape alone not source-verified target");
    EtfDaily.Store paused=fresh(f);paused.setScheduleEnabled(true);
    f.check(paused.beginScheduled(new EtfSchedule.Clock(),day("08:50:00"),()->false).isEmpty() && !paused.state().has("lastScheduledKey"),"pause before claim leaves no false attempt");
    // Simultaneous device SQLite callers can claim only one token.
    EtfDaily.Store race=fresh(f);race.setScheduleEnabled(true);
    java.util.concurrent.ExecutorService pool=java.util.concurrent.Executors.newFixedThreadPool(2);
    try {
      java.util.concurrent.Future<String> a=pool.submit(()->new EtfDaily.Store(race.file).beginScheduled(new EtfSchedule.Clock(),day("08:50:00")));
      java.util.concurrent.Future<String> b=pool.submit(()->new EtfDaily.Store(race.file).beginScheduled(new EtfSchedule.Clock(),day("08:50:00")));
      f.check(a.get().isEmpty()!=b.get().isEmpty(),"SQLite transaction prevents simultaneous duplicate claim");
    } finally { pool.shutdownNow(); }
    AtomicInteger choice=new AtomicInteger();
    f.check(!race.setScheduleEnabled(false,()->choice.getAndIncrement()==0) && race.state().optBoolean("scheduleEnabled"),
      "superseded pending setting rolls back in same transaction");
    EtfDaily.Store late=fresh(f);late.setScheduleEnabled(true);
    String lateToken=late.beginScheduled(new EtfSchedule.Clock(),day("12:00:00"));
    f.check(!lateToken.isEmpty()&&late.fail(lateToken,"受控失败",day("12:00:01")),"cold late attempt saved even on failure");
    f.check(new EtfDaily.Store(late.file).beginScheduled(new EtfSchedule.Clock(),day("14:00:00")).isEmpty(),"reopened device DB plus cold clock cannot repeat catchup");
  }
  static void ui(FlowInstrumentation f) throws Exception {
    model(f);
    // Activity creates a hidden scheduler even before its ETF route is opened.
    f.ui(() -> f.check(f.activity.etfScreen!=null && f.activity.etfScreen.scheduleForeground &&
                       !f.activity.etfScreen.isShown(),"foreground host keeps hidden ETF instance"));
    EtfSchedule.Clock process=f.activity.etfScreen.scheduleClock;
    EtfScreen first=f.activity.etfScreen;
    f.ui(first::close);first.worker.awaitTermination(5,TimeUnit.SECONDS);
    File db=f.getTargetContext().getDatabasePath("etf-daily-tests-v25.sqlite");
    String backup=".saved-"+UUID.randomUUID();
    for(String suffix:new String[]{"","-wal","-shm","-journal"}) {
      File file=new File(db.getPath()+suffix);
      if(file.exists()&&!file.renameTo(new File(file.getPath()+backup)))throw new java.io.IOException("preserve isolated ETF test DB");
    }
    AtomicReference<Instant> now=new AtomicReference<>(at("2026-09-11T08:00:00+08:00"));
    AtomicInteger calls=new AtomicInteger();AtomicBoolean uiNetwork=new AtomicBoolean();
    AtomicReference<CountDownLatch> gate=new AtomicReference<>();
    AtomicReference<JSONObject> response=new AtomicReference<>(report(f));
    java.util.function.Supplier<EtfDaily.Fetch> factory=()->new EtfDaily.Fetch(){
      JSONObject fetch() throws Exception {
        calls.incrementAndGet();
        uiNetwork.set(uiNetwork.get()||android.os.Looper.myLooper()==android.os.Looper.getMainLooper());
        CountDownLatch wait=gate.get();
        // Deliberately allow a provider's late reply after cancel; caller must reject it.
        if(wait!=null)wait.await(8,TimeUnit.SECONDS);
        return new JSONObject(response.get().toString());
      }
    };
    EtfSchedule.Clock clock=new EtfSchedule.Clock();
    f.ui(()->{
      f.activity.etfScreen=new EtfScreen(f.activity,true,clock,now::get,factory);
      f.activity.etfDaily();f.activity.etfScreen.resumeSchedule();
    });
    SourceChecks.waitFor(f,()->f.activity.etfScreen.state.getText().toString().contains("尝试"),5000,"empty scheduler loaded");
    f.ui(()->{
      f.check(!f.activity.etfScreen.automatic.isChecked(),"explicit default-off automatic checking control");
      f.activity.etfScreen.automatic.performClick();
    });
    SourceChecks.waitFor(f,()->!f.activity.etfScreen.scheduleSaving,5000,"checkbox persisted asynchronously");
    f.check(new EtfDaily.Store(db).state().optBoolean("scheduleEnabled")&&calls.get()==0,"enable saves but does not refresh");
    now.set(at("2026-09-11T08:50:00+08:00"));
    f.ui(()->{f.activity.onBackPressed();f.check(!f.activity.etfScreen.isShown(),"ETF page hidden");f.activity.etfScreen.tickSchedule();});
    SourceChecks.waitFor(f,()->calls.get()==1&&f.activity.etfScreen.fetch==null,5000,"scheduled source commits while other page visible");
    f.check(!uiNetwork.get()&&new EtfDaily.Store(db).history().length()==1,"device worker not main, source saved");
    f.check(new EtfDaily.Store(db).state().optString("lastSuccessTargetDate").isEmpty(),"old source report continues waiting");
    f.ui(()->{f.activity.etfDaily();f.activity.etfScreen.tickSchedule();});
    SourceChecks.waitFor(f,()->f.activity.etfScreen.fetch==null,5000,"same-slot check completes without HTTP");
    f.check(calls.get()==1,"reopen same slot does not fetch");
    // Auto cannot cancel a running user file worker.
    now.set(at("2026-09-11T09:00:00+08:00"));
    CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
    AtomicBoolean interrupted=new AtomicBoolean(),fileDone=new AtomicBoolean();
    f.ui(()->{EtfScreen screen=f.activity.etfScreen;screen.run(screen.generation,()->{
      entered.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){interrupted.set(true);Thread.currentThread().interrupt();}
      fileDone.set(true);
    });});
    f.check(entered.await(3,TimeUnit.SECONDS),"controlled file worker started");
    f.ui(()->f.activity.etfScreen.tickSchedule());
    f.check(calls.get()==1&&!interrupted.get(),"scheduled tick never cancels user file worker");
    release.countDown();SourceChecks.waitFor(f,fileDone::get,5000,"file worker retained");
    // A real content URI import remains a pending preview, never auto-replaced.
    String documentId=UUID.randomUUID().toString();
    android.net.Uri document=android.net.Uri.parse("content://org.marketreview.nativeapp.test.source-plans/etf-export?id="+documentId);
    try(android.os.ParcelFileDescriptor fd=f.getTargetContext().getContentResolver().openFileDescriptor(document,"rw")) {
      try(java.io.OutputStream out=new android.os.ParcelFileDescriptor.AutoCloseOutputStream(fd)) {
        out.write(report(f).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
      }
    }
    f.ui(()->{f.activity.etfScreen.document(416,document);f.activity.etfScreen.tickSchedule();});
    SourceChecks.waitFor(f,()->f.activity.etfScreen.pending.length()>0,7000,"real provider import survives schedule tick");
    f.check(calls.get()==1,"provider not preempted by automatic HTTP");
    f.ui(()->{f.activity.etfScreen.tickSchedule();f.check(f.activity.etfScreen.pending.length()>0,"pending import remains selected");f.activity.etfScreen.invalidatePreview();});
    // Background cancels only schedule's request; a late reply cannot publish.
    CountDownLatch late=new CountDownLatch(1);gate.set(late);
    f.ui(()->f.activity.etfScreen.tickSchedule());
    SourceChecks.waitFor(f,()->calls.get()==2,5000,"second slot starts");
    try(android.os.ParcelFileDescriptor shell=f.getUiAutomation().executeShellCommand("input keyevent KEYCODE_HOME")) {
      try(java.io.InputStream stream=new android.os.ParcelFileDescriptor.AutoCloseInputStream(shell)){stream.readAllBytes();}
    }
    SourceChecks.waitFor(f,()->!f.activity.hasWindowFocus()&&!f.activity.etfScreen.scheduleForeground,5000,"actual Home pauses host scheduler");
    f.ui(()->f.activity.etfScreen.tickSchedule());
    late.countDown();gate.set(null);
    SourceChecks.waitFor(f,()->f.activity.etfScreen.fetch==null,5000,"late background response settled");
    f.check(new EtfDaily.Store(db).state().optString("attemptStatus").equals("failed")&&new EtfDaily.Store(db).history().length()==1,"background response discarded, old cache retained");
    f.ui(()->f.activity.startActivity(new android.content.Intent(f.activity.getIntent())
        .setClass(f.activity,MainActivity.class).putExtra("testFixtures",true)
        .addFlags(android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));
    SourceChecks.waitFor(f,()->f.activity.hasWindowFocus()&&f.activity.etfScreen.scheduleForeground,5000,"actual foreground resumes scheduler");
    f.ui(()->f.activity.etfScreen.tickSchedule());
    SourceChecks.waitFor(f,()->f.activity.etfScreen.fetch==null,5000,"resume same slot settled");
    f.check(calls.get()==2,"resume does not duplicate canceled slot");
    now.set(at("2026-09-11T09:10:00+08:00"));
    f.ui(()->f.activity.etfScreen.automatic.performClick());
    SourceChecks.waitFor(f,()->!f.activity.etfScreen.scheduleSaving,5000,"disabled setting persisted");
    f.ui(()->f.activity.etfScreen.tickSchedule());
    f.check(calls.get()==2&&!new EtfDaily.Store(db).state().optBoolean("scheduleEnabled"),"disabled slot no network");
    f.ui(()->f.activity.etfScreen.automatic.performClick());
    SourceChecks.waitFor(f,()->!f.activity.etfScreen.scheduleSaving,5000,"reenabled setting persisted");
    response.set(new JSONObject(report(f).toString()).put("articleId","202609113869906866")
      .put("sourceUrl",EtfDaily.articleUrl("202609113869906866")).put("title","ETF追踪丨9月10日股票型ETF净赎回20亿元")
      .put("asOf","2026-09-10").put("publishedAt","2026-09-11T08:00:59+08:00"));
    f.ui(()->f.activity.etfScreen.tickSchedule());
    SourceChecks.waitFor(f,()->calls.get()==3&&f.activity.etfScreen.fetch==null,5000,"new target report accepted");
    f.check(new EtfDaily.Store(db).state().optString("lastSuccessTargetDate").equals("2026-09-11"),"verified target day persisted");
    now.set(at("2026-09-11T09:20:00+08:00"));f.ui(()->f.activity.etfScreen.tickSchedule());
    SourceChecks.waitFor(f,()->f.activity.etfScreen.fetch==null,5000,"covered day last slot skipped");
    f.check(calls.get()==3,"stop after actual matching target source");
    // Recreate the real host, then reopen its actual cached subpage. Do not swap
    // its field: onCreate restores every open tab, including a hidden ETF tab.
    String savedKey=new EtfDaily.Store(db).state().optString("lastScheduledKey");
    f.ui(()->f.activity.onBackPressed());
    SourceHistoryChecks.recreateActivity(f);
    f.check(f.activity.testing,"recreation retains isolated test identity");
    SourceChecks.waitFor(f,()->f.activity.etfScreen!=null&&!f.activity.etfScreen.closed&&f.activity.etfScreen.automatic.isChecked(),7000,"recreated enabled setting loaded");
    f.check(f.activity.etfScreen.scheduleClock==process&&process==EtfScreen.PROCESS_CLOCK,"production process clock retained across Activity recreation");
    f.ui(()->f.activity.etfDaily());
    f.check(savedKey.equals(new EtfDaily.Store(db).state().optString("lastScheduledKey")),"Activity reconstruction preserves scheduled request identity");
    SourceChecks.waitFor(f,()->f.activity.etfScreen.isShown()&&f.activity.etfScreen.getWidth()>0&&
      f.activity.etfScreen.automatic.isShown()&&f.activity.etfScreen.automatic.getHeight()>=f.activity.dp(40)&&
      f.activity.etfScreen.list.isShown()&&f.activity.etfScreen.list.getHeight()>f.activity.dp(160)&&
      f.activity.etfScreen.list.getChildCount()>0,5000,"tested scheduler controls and rows actually visible in native page host");
    f.shot("android-etf-schedule-visible");
    CountDownLatch closingEntered=new CountDownLatch(1),closingRelease=new CountDownLatch(1);
    f.ui(()->{EtfScreen screen=f.activity.etfScreen;screen.run(screen.generation,()->{
      closingEntered.countDown();try{closingRelease.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){android.os.SystemClock.sleep(300);}
    });});
    f.check(closingEntered.await(3,TimeUnit.SECONDS),"user file operation holds worker during setting change");
    f.ui(()->f.activity.etfScreen.automatic.performClick());
    SourceHistoryChecks.recreateActivity(f);closingRelease.countDown();
    SourceChecks.waitFor(f,()->f.activity.etfScreen!=null&&f.activity.etfScreen.state.getText().toString().contains("尝试"),7000,"recreated settings read after outstanding choice");
    f.check(!new EtfDaily.Store(db).state().optBoolean("scheduleEnabled"),"recreation cannot lose explicit disable queued behind file operation");
    f.ui(()->{f.check(!f.activity.etfScreen.automatic.isChecked(),"rebuilt control agrees with saved disable");f.activity.etfScreen.pauseSchedule();});
  }
}
