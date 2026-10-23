package org.marketreview.nativeapp;

import java.time.*;
import java.io.File;
import java.util.*;
import org.json.*;

/** Synthetic inputs only. Host model checks do not initialize an Activity, Feed or SQLite. */
final class LocalCandidateChecks {
  interface Check { void that(boolean ok, String message); }
  interface Work { void run() throws Exception; }
  static final Instant NOW = Instant.parse("2026-10-12T08:00:00Z");
  static JSONObject stock(int code, int count) throws Exception {
    JSONArray bars = new JSONArray(); LocalDate first = LocalDate.of(2026, 6, 1);
    for (int i=0;i<count;i++) {
      double close=10+i*.05+Math.sin(i*.7)*.1; LocalDate d=first.plusDays(i);
      bars.put(new JSONObject().put("time",d.atTime(15,0).toInstant(ZoneOffset.ofHours(8)).toEpochMilli())
          .put("label",d.toString()).put("open",close-.02).put("close",close).put("high",close+.2)
          .put("low",close-.2).put("volume",i<count-5?1000:1400).put("valid",true).put("closed",true));
    }
    String date=count==0?"":bars.getJSONObject(count-1).getString("label");
    return new JSONObject().put("id","SH:stock:"+code).put("symbol","sh"+code).put("name","测试"+code)
        .put("group","测试分组").put("day",bars)
        .put("dayMeta",new JSONObject().put("source","受控日线").put("adjustment","qfq").put("volumeUnit","手")
          .put("timeUnit","milliseconds").put("dataDate",date).put("checkedAt",NOW.toString()).put("cached",true))
        .put("quote",new JSONObject().put("price",14).put("changePercent",3.1).put("amount",700000000)
          .put("volume",100000).put("source","受控报价").put("tradeDate",date).put("tradeTime","15:00:00")
          .put("checkedAt",NOW.toString()).put("cached",true));
  }
  static JSONObject evaluate(JSONObject stock, String strategy) throws Exception {
    return LocalCandidateModel.evaluate(LocalCandidateModel.snapshot(new JSONArray().put(stock),strategy,NOW));
  }
  static JSONObject row(JSONObject result) throws Exception { return result.getJSONArray("rows").getJSONObject(0); }
  static void rejects(Check check, Work work, String message) throws Exception {
    boolean rejected=false; try { work.run(); } catch(IllegalArgumentException|JSONException e) { rejected=true; }
    check.that(rejected,message);
  }
  static void model(Check check) throws Exception {
    JSONObject input=stock(600000,80); String before=input.toString();
    for(String strategy:LocalCandidateModel.STRATEGIES) {
      JSONObject result=evaluate(input,strategy), r=row(result);
      check.that(result.getString("model").equals("native-local-candidates/v1"),"explicit new model version");
      check.that(r.getString("status").equals("ready"),"80 closed daily bars ready");
      JSONArray contributions=r.getJSONArray("contributions"); int sum=0;
      for(int i=0;i<contributions.length();i++) sum+=contributions.getJSONObject(i).getInt("points");
      check.that(sum==r.getInt("rawScore") && r.getInt("score")==Math.max(0,Math.min(100,sum)),"explanation exactly reconciles score");
      check.that(!r.getString("background").isEmpty(),"unsupported context explicitly unparticipating");
      check.that(r.getJSONObject("source").getJSONObject("dayMeta").getBoolean("cached"),"retain real cached source state");
      LocalCandidateModel.verify(result);
    }
    check.that(input.toString().equals(before),"no mutation of input/feed objects");
    for(int n:new int[]{0,5,19,20,25,26,33,34,59,60}) {
      JSONObject r=row(evaluate(stock(600000,n),"breakout")), f=r.getJSONObject("factors");
      check.that(f.isNull("ma20")== (n<20),"MA20 requires 20 bars: "+n);
      check.that(f.isNull("trend60")== (n<60),"no fake 60-bar trend: "+n);
      check.that(f.isNull("macdDea")== (n<34),"native DEA SMA warmup: "+n);
      check.that(r.isNull("score")== (n<20),"insufficient 20-bar study remains unscored: "+n);
    }
    JSONObject bad=stock(600000,80); bad.getJSONArray("day").getJSONObject(79).put("close",JSONObject.NULL);
    check.that(row(evaluate(bad,"stable")).isNull("score"),"null is not coerced to zero or removed");
    bad=stock(600000,80); bad.getJSONArray("day").getJSONObject(79).put("valid",false);
    check.that(row(evaluate(bad,"stable")).isNull("score"),"explicit invalid gap cannot bridge");
    bad=stock(600000,80); bad.getJSONArray("day").getJSONObject(79).put("time",bad.getJSONArray("day").getJSONObject(78).getLong("time"));
    check.that(row(evaluate(bad,"stable")).isNull("score"),"duplicate/nonordered time rejected");
    JSONObject forming=stock(600000,80);forming.getJSONArray("day").getJSONObject(79).put("closed",false);
    check.that(row(evaluate(forming,"stable")).getInt("barCount")==79,"forming bar not confirmed factor input");
    JSONObject cross=stock(600000,80);cross.getJSONObject("quote").put("tradeDate","2026-10-12");
    JSONObject crossed=row(evaluate(cross,"short-strong"));
    check.that(crossed.getJSONObject("factors").isNull("change"),"mixed-date quote excluded from daily factors");
    check.that(crossed.getString("status").equals("partial"),"mixed-date coverage is visible");
    JSONObject noChange=stock(600000,80); noChange.getJSONObject("quote").put("changePercent",JSONObject.NULL);
    check.that(row(evaluate(noChange,"stable")).getJSONObject("factors").isNull("change"),"null change preserved");
    noChange.getJSONObject("quote").put("changePercent",0);
    check.that(row(evaluate(noChange,"stable")).getJSONObject("factors").getDouble("change")==0,"real zero retained");
    JSONObject emptySource=stock(600000,80); emptySource.getJSONObject("dayMeta").remove("source");
    check.that(row(evaluate(emptySource,"stable")).isNull("score"),"unproven daily source not scored");
    JSONObject mismatched=stock(600000,80);mismatched.getJSONObject("dayMeta").put("dataDate","2026-10-10");
    check.that(row(evaluate(mismatched,"stable")).isNull("score"),"day rows and source identity date must agree");
    JSONObject early=stock(600000,80);LocalDate lastDay=LocalDate.parse(early.getJSONObject("dayMeta").getString("dataDate"));
    early.getJSONObject("dayMeta").put("checkedAt",lastDay.atTime(14,0).toInstant(ZoneOffset.ofHours(8)).toString());
    check.that(row(evaluate(early,"stable")).isNull("score"),"source checked before closed-bar end cannot prove that close");
    early.getJSONArray("day").getJSONObject(79).put("closed",false);
    check.that(!row(evaluate(early,"stable")).isNull("score"),"forming endpoint allows earlier check when all used closed bars are already past");
    JSONObject earlyQuote=stock(600000,80);earlyQuote.getJSONObject("quote").put("checkedAt",lastDay.atTime(14,0).toInstant(ZoneOffset.ofHours(8)).toString());
    check.that(row(evaluate(earlyQuote,"stable")).getJSONObject("factors").isNull("change"),"source check before quote timestamp excludes quote factors");
    earlyQuote.getJSONObject("quote").put("checkedAt",lastDay.atTime(15,0).toInstant(ZoneOffset.ofHours(8)).toString());
    check.that(!row(evaluate(earlyQuote,"stable")).getJSONObject("factors").isNull("change"),"equal check and quote timestamps are valid");
    JSONObject extreme=stock(600000,80);
    for(int i=0;i<80;i++)for(String key:new String[]{"open","close","high","low"})extreme.getJSONArray("day").getJSONObject(i).put(key,i==78?Double.MIN_NORMAL:1e300);
    JSONObject overflow=row(evaluate(extreme,"stable"));
    check.that(!overflow.getString("status").equals("ready")&&overflow.getJSONArray("missing").toString().contains("volatility"),"finite-input arithmetic overflow is visible as missing, never all-factors-ready");
    JSONObject longInput=stock(600000,100);
    check.that(row(evaluate(longInput,"stable")).getInt("barCount")==80,"explicit last80 window");
    JSONObject zeros=stock(600000,80); for(int i=0;i<80;i++)zeros.getJSONArray("day").getJSONObject(i).put("volume",0);
    check.that(row(evaluate(zeros,"stable")).getJSONObject("factors").isNull("volumeRatio5"),"zero denominator does not produce fake ratio");
    JSONArray selected=new JSONArray(); for(int i=0;i<51;i++)selected.put(stock(600000+i,20));
    rejects(check,()->LocalCandidateModel.snapshot(selected,"stable",NOW),"51 explicit selections rejected, not silently trimmed");
    rejects(check,()->LocalCandidateModel.snapshot(new JSONArray().put(input).put(input),"stable",NOW),"duplicate identities rejected");
    JSONObject index=stock(600000,80).put("id","SH:index:600000");
    rejects(check,()->LocalCandidateModel.snapshot(new JSONArray().put(index),"stable",NOW),"index not silently treated as stock");
    rejects(check,()->LocalCandidateModel.snapshot(new JSONArray().put(input),"sector-leader",NOW),"unsupported template not pretended");
    JSONObject tamper=evaluate(input,"stable");row(tamper).put("score",0);
    rejects(check,()->LocalCandidateModel.verify(tamper),"frozen result cannot disagree with frozen inputs");
    JSONObject titled=stock(600000,80).put("name","=受控名称");
    String csv=new String(LocalCandidateModel.csv(evaluate(titled,"stable")),java.nio.charset.StandardCharsets.UTF_8);
    check.that(csv.contains("'=受控名称")&&csv.contains("native-local-candidates/v1"),"CSV formula escape and model provenance");
    String largeText=String.join("",Collections.nCopies(500,"边"));JSONArray oversized=new JSONArray();
    for(int i=0;i<50;i++){
      JSONObject item=stock(600000+i,80).put("group",largeText);
      for(String key:new String[]{"source","error","persistenceState","previousClose","volume"})item.getJSONObject("quote").put(key,largeText);
      for(String key:new String[]{"source","error","persistenceState"})item.getJSONObject("dayMeta").put(key,largeText);
      oversized.put(item);
    }
    rejects(check,()->LocalCandidateModel.snapshot(oversized,"stable",NOW),"oversized allowed metadata rejected before SQLite cursor storage");
  }
  static void store(Check check,File file) throws Exception {
    LocalCandidateStore store=new LocalCandidateStore(file);
    check.that(store.list().length()==0&&!file.exists(),"reading absent candidate history never creates a DB");
    JSONObject result=evaluate(stock(600000,80),"stable");
    String draft=store.putDraft(result);JSONObject restored=store.readDraft(draft);
    check.that(LocalCandidateModel.canonical(restored).equals(LocalCandidateModel.canonical(result)),"frozen draft survives new store");
    String id=store.save("测试快照",result,NOW);
    result.getJSONArray("rows").getJSONObject(0).put("name","已变的内存");
    check.that(store.read(id).getJSONObject("result").getJSONArray("rows").getJSONObject(0).getString("name").equals("测试600000"),"history immutable after input/result mutation");
    JSONObject next=evaluate(stock(600001,80),"breakout");store.putDraft(next);
    rejects(check,()->store.readDraft(draft),"stale draft anchor never opens newer unrelated calculation");
    check.that(store.list().length()==1,"draft replacement never overwrites named history");
    store.remove(id);check.that(store.list().length()==0,"delete does not resurrect from draft");
    for(int i=0;i<100;i++)store.save("容量"+i,next,NOW);
    rejects(check,()->store.save("第101条",next,NOW),"capacity100 rejects without silent eviction");
    check.that(store.list().length()==100,"all named history retained at capacity");
    JSONObject invalid=new JSONObject(next.toString());invalid.put("inputHash","wrong");
    rejects(check,()->store.putDraft(invalid),"invalid draft rejected before replacement");
    check.that(store.readDraft(LocalCandidateModel.digest(next)).getJSONObject("input").getString("strategy").equals("breakout"),"failed draft replacement retains prior data");
    byte[] csv=LocalCandidateModel.csv(next);String export=store.putExport(csv);
    check.that(Arrays.equals(csv,new LocalCandidateStore(file).readExport(export)),"frozen CSV survives store reconstruction");
  }
  static void model(FlowInstrumentation f) throws Exception { model(f::check); }
  static void run(FlowInstrumentation f) throws Exception {
    model(f::check);File base=new File(f.getTargetContext().getCacheDir(),"local-candidates-"+UUID.randomUUID());
    store(f::check,new File(base,"capacity.sqlite"));
    LocalCandidateStore data=new LocalCandidateStore(new File(base,"ui.sqlite"));
    JSONArray roster=new JSONArray();for(int i=0;i<61;i++)roster.put(stock(600000+i,i==0?5:80));
    List<String> opened=new ArrayList<>();List<byte[]> exports=new ArrayList<>();
    LocalCandidateScreen.Host host=new LocalCandidateScreen.Host(){
      public JSONArray existingData() throws Exception{JSONArray out=new JSONArray();for(int i=0;i<roster.length();i++){JSONObject r=roster.getJSONObject(i);out.put(new JSONObject().put("id",r.getString("id")).put("name",r.getString("name")).put("group",r.getString("group")));}return out;}
      public JSONArray snapshot(Set<String> ids) throws Exception{JSONArray out=new JSONArray();for(int i=0;i<roster.length();i++)if(ids.contains(roster.getJSONObject(i).getString("id")))out.put(new JSONObject(roster.getJSONObject(i).toString()));return out;}
      public void openInstrument(String id){opened.add(id);}
      public void requestExport(byte[] bytes){exports.add(bytes);}
    };
    LocalCandidateScreen[] page={null};
    f.ui(()->{page[0]=new LocalCandidateScreen(f.activity,data,host);f.activity.showPage("candidates-test","本地候选",page[0]);});
    f.ui(()->{
      f.check(page[0].available.size()==61&&page[0].chosen.isEmpty(),"all61 shown, no initial automatic choice");
      page[0].findViewWithTag("candidateSelectGroup").performClick();
      f.check(page[0].chosen.isEmpty()&&page[0].state.getText().toString().contains("50"),"oversize group not silently first50");
      page[0].list.performItemClick(page[0].list.getChildAt(0),0,0);page[0].list.performItemClick(page[0].list.getChildAt(1),1,1);
      page[0].findViewWithTag("candidateCalculate").performClick();
    });
    SourceChecks.waitFor(f,()->page[0].current!=null,8000,"explicit selection computes and persists bounded draft");
    f.ui(()->{
      f.check(page[0].current.optJSONArray("rows").length()==2,"exact chosen range, not full roster");
      f.check(page[0].state.getText().toString().contains("未评分1"),"excluded short-history row remains visible");
      page[0].list.performItemClick(page[0].list.getChildAt(0),0,0);
      f.check(page[0].detail.getText().toString().contains("贡献")&&page[0].detail.getText().toString().contains("来源"),"real native details explain contribution and provenance");
      page[0].findViewWithTag("candidateOpen").performClick();
      page[0].name.setText("手机离线结果");page[0].findViewWithTag("candidateSave").performClick();
    });
    SourceChecks.waitFor(f,()->page[0].anchor.startsWith("saved:"),8000,"named snapshot actually committed");
    f.check(opened.equals(Collections.singletonList("SH:stock:600001")),"open exact ranked full identity only upon button");
    android.os.Bundle[] bundle={null};
    f.ui(()->{
      bundle[0]=page[0].saveState();android.os.Parcel parcel=android.os.Parcel.obtain();try{parcel.writeBundle(bundle[0]);f.check(parcel.dataSize()<8192,"Bundle excludes50x80 input data");}finally{parcel.recycle();}
      page[0].close();page[0]=new LocalCandidateScreen(f.activity,data,host);page[0].restoreState(bundle[0]);
      f.activity.showPage("candidates-test","本地候选",page[0]);
    });
    SourceChecks.waitFor(f,()->page[0].current!=null,8000,"new screen reloads frozen saved result, no re-run");
    f.ui(()->page[0].findViewWithTag("candidateExport").performClick());
    SourceChecks.waitFor(f,()->!exports.isEmpty(),8000,"native export prepares exact CSV bytes for SAF host");
    f.check(new String(exports.get(0),java.nio.charset.StandardCharsets.UTF_8).contains("SH:stock:600001"),"export contains actual selected results");
    // Rebuild while system document selection is pending; no CSV body is stored in Bundle.
    f.ui(()->{bundle[0]=page[0].saveState();page[0].close();page[0]=new LocalCandidateScreen(f.activity,data,host);page[0].restoreState(bundle[0]);f.activity.showPage("candidates-export","本地候选",page[0]);});
    SourceChecks.waitFor(f,()->page[0].current!=null,8000,"result restored without changing pending export anchor");
    java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
    f.ui(()->{page[0].exportTo(()->output);page[0].visibleChanged(false);page[0].visibleChanged(true);});
    SourceChecks.waitFor(f,()->page[0].state.getText().toString().contains("导出完成"),8000,"visibility return cannot cancel accepted frozen export");
    f.check(Arrays.equals(exports.get(0),output.toByteArray()),"actual exporter writes exactly selector-time CSV after rebuild");
    f.ui(()->{page[0].findViewWithTag("candidateHistory").performClick();});
    SourceChecks.waitFor(f,()->page[0].history.length()==1,8000,"history list is actual SQLite snapshot");
    f.ui(()->{
      page[0].list.performItemClick(page[0].list.getChildAt(0),0,0);
    });
    SourceChecks.waitFor(f,()->page[0].mode.equals("results"),8000,"history opens exact saved result");
    f.ui(()->{page[0].findViewWithTag("candidateDelete").performClick();f.check(page[0].confirm.getVisibility()==android.view.View.VISIBLE,"delete needs inline confirmation");page[0].confirm.performClick();});
    SourceChecks.waitFor(f,()->page[0].anchor.isEmpty()&&page[0].history.length()==0,8000,"confirmed delete removes stored history");
    f.check(data.list().length()==0,"history deletion persisted independently");
    // Hold the real shared worker before a calculation, then change its explicit selection.
    java.lang.reflect.Field executorField=LocalCandidateScreen.class.getDeclaredField("WORKER");executorField.setAccessible(true);
    java.util.concurrent.ExecutorService worker=(java.util.concurrent.ExecutorService)executorField.get(null);
    java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.Future<?> held=worker.submit(()->{entered.countDown();try{release.await(10,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}});
    try {
      f.check(entered.await(5,java.util.concurrent.TimeUnit.SECONDS),"controlled worker held before range-change race");
      f.ui(()->{
        page[0].findViewWithTag("candidateRange").performClick();
        page[0].findViewWithTag("candidateCalculate").performClick();
        page[0].list.performItemClick(page[0].list.getChildAt(0),0,0);
        f.check(page[0].chosen.equals(Collections.singleton("SH:stock:600001")),"real row click changes selected scope while old calculation queued");
      });
      release.countDown();held.get(5,java.util.concurrent.TimeUnit.SECONDS);worker.submit(()->{}).get(8,java.util.concurrent.TimeUnit.SECONDS);f.waitForIdleSync();
      f.ui(()->f.check(page[0].current==null&&page[0].mode.equals("range"),"changed explicit selection cancels stale result without automatic rerun"));
      f.ui(()->page[0].findViewWithTag("candidateCalculate").performClick());
      SourceChecks.waitFor(f,()->page[0].current!=null,8000,"explicitly recalculate changed one-stock scope");
      f.ui(()->f.check(page[0].current.optJSONArray("rows").length()==1&&page[0].current.optJSONArray("rows").optJSONObject(0).optString("id").equals("SH:stock:600001"),"fresh result uses exactly changed selection"));
      for(String action:new String[]{"candidateClear","candidateSelectGroup"}) {
        java.util.concurrent.CountDownLatch nextEntered=new java.util.concurrent.CountDownLatch(1),nextRelease=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.Future<?> nextHeld=worker.submit(()->{nextEntered.countDown();try{nextRelease.await(10,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}});
        JSONObject previous=page[0].current;
        try {
          f.check(nextEntered.await(5,java.util.concurrent.TimeUnit.SECONDS),"hold worker before "+action);
          f.ui(()->{
            page[0].findViewWithTag("candidateRange").performClick();page[0].chosen.clear();page[0].chosen.add("SH:stock:600001");
            page[0].search.setText("60000");page[0].findViewWithTag("candidateCalculate").performClick();page[0].findViewWithTag(action).performClick();
            f.check(page[0].chosen.size()==(action.equals("candidateClear")?0:10),action+" actually changes scope");
          });
          nextRelease.countDown();nextHeld.get(5,java.util.concurrent.TimeUnit.SECONDS);worker.submit(()->{}).get(8,java.util.concurrent.TimeUnit.SECONDS);f.waitForIdleSync();
          f.ui(()->f.check(page[0].current==previous&&page[0].mode.equals("range")&&!page[0].busy,action+" cancels pending calculation, preserves earlier result without rerun"));
        }finally{nextRelease.countDown();}
      }
      String firstId=data.save("可读历史A",evaluate(stock(600010,80),"stable"),NOW);
      String brokenId=data.save("摘要损坏历史B",evaluate(stock(600011,80),"breakout"),NOW);
      try(android.database.sqlite.SQLiteDatabase db=android.database.sqlite.SQLiteDatabase.openDatabase(data.file.getAbsolutePath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READWRITE)){
        android.content.ContentValues invalid=new android.content.ContentValues();invalid.put("digest","fixture-invalid");db.update("snapshots",invalid,"id=?",new String[]{brokenId});
      }
      f.ui(()->{page[0].search.setText("");page[0].loadAnchor("saved:"+firstId,"results");});
      SourceChecks.waitFor(f,()->page[0].anchor.equals("saved:"+firstId)&&page[0].current!=null&&!page[0].busy,8000,"load genuine first history before failure isolation");
      java.util.concurrent.CountDownLatch loadEntered=new java.util.concurrent.CountDownLatch(1),loadRelease=new java.util.concurrent.CountDownLatch(1);
      java.util.concurrent.Future<?> loadHeld=worker.submit(()->{loadEntered.countDown();try{loadRelease.await(10,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}});
      try {
        f.check(loadEntered.await(5,java.util.concurrent.TimeUnit.SECONDS),"hold actual history load before corrupt second record");
        f.ui(()->page[0].loadAnchor("saved:"+brokenId,"results"));
        loadRelease.countDown();loadHeld.get(5,java.util.concurrent.TimeUnit.SECONDS);worker.submit(()->{}).get(8,java.util.concurrent.TimeUnit.SECONDS);f.waitForIdleSync();
        f.ui(()->{
          f.check(page[0].state.getText().toString().startsWith("未完成：")&&!page[0].busy,"corrupt second history explicitly fails");
          f.check(page[0].current==null||!page[0].anchor.equals("saved:"+brokenId),"failed history B must not bind visible A to B deletion identity");
          f.check(!page[0].remove.isEnabled()&&!page[0].save.isEnabled()&&!page[0].open.isEnabled(),"failed history exposes no stale delete/save/open operations");
        });
        f.check(data.list().length()==2,"failed read never mutates either saved history");
      }finally{loadRelease.countDown();}
      String nextId=data.save("可读历史C",evaluate(stock(600012,80),"pullback"),NOW);
      for(String action:new String[]{"candidateResults","candidateRange"}) {
        f.ui(()->page[0].loadAnchor("saved:"+firstId,"results"));
        SourceChecks.waitFor(f,()->page[0].current!=null&&!page[0].busy,8000,"restore first history before pending-read navigation");
        java.util.concurrent.CountDownLatch navigationEntered=new java.util.concurrent.CountDownLatch(1),navigationRelease=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.Future<?> navigationHeld=worker.submit(()->{navigationEntered.countDown();try{navigationRelease.await(10,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}});
        try {
          f.check(navigationEntered.await(5,java.util.concurrent.TimeUnit.SECONDS),"hold target history before "+action);
          f.ui(()->{
            page[0].loadAnchor("saved:"+nextId,"results");page[0].findViewWithTag(action).performClick();
            f.check(page[0].current==null&&!page[0].remove.isEnabled()&&!page[0].open.isEnabled(),action+" cannot expose earlier A under pending C identity");
          });
          navigationRelease.countDown();navigationHeld.get(5,java.util.concurrent.TimeUnit.SECONDS);worker.submit(()->{}).get(8,java.util.concurrent.TimeUnit.SECONDS);f.waitForIdleSync();
          f.ui(()->{
            if(action.equals("candidateResults"))f.check(page[0].current!=null&&page[0].anchor.equals("saved:"+nextId)&&page[0].current.optJSONArray("rows").optJSONObject(0).optString("id").equals("SH:stock:600012"),"successful retry binds exactly C result and C identity");
            else f.check(page[0].current==null&&page[0].mode.equals("range")&&!page[0].busy,"leaving pending history cancels late result without reviving A");
          });
        }finally{navigationRelease.countDown();}
      }
      f.check(data.list().length()==3,"cancelled or retried reads never delete another history");
    }finally{release.countDown();f.ui(()->page[0].close());}
  }
  public static void main(String[] args) throws Exception {
    final int[] count={0};model((ok,msg)->{if(!ok)throw new AssertionError(msg);count[0]++;});
    System.out.println("PASS local candidate pure model checks="+count[0]+"; synthetic data, no network or SQLite");
  }
}
