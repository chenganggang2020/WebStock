package org.marketreview.nativeapp;
import android.app.Instrumentation;
import android.os.Bundle;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Isolated domain/database tests; does not open or clear the normal application database. */
final class DarkRotationChecks {
  static JSONObject live(Instrumentation t) throws Exception {
    JSONObject receipt=new JSONObject().put("platform","Android Java direct").put("requestedDate","2026-10-09").put("attempted",true).put("sourceClockKnown",false).put("realtimeVerified",false).put("checkedAt",java.time.Instant.now().toString());
    try{JSONObject data=new DarkRotation.Scan().fetch("2026-10-09","industry",true);DarkRotation.Store store=new DarkRotation.Store(new File(t.getTargetContext().getCacheDir(),"rotation-live.sqlite"));store.save(data);receipt.put("rows",data.getJSONArray("rows").length()).put("state","complete historical daily query saved");}catch(Exception e){receipt.put("rows",0).put("state","source unavailable").put("error",e.getClass().getSimpleName()+": "+e.getMessage());}return receipt;
  }
  static void realUi(FlowInstrumentation t) throws Exception {
    android.net.Uri export=android.net.Uri.parse("content://org.marketreview.nativeapp.test.source-plans/rotation-export?id="+java.util.UUID.randomUUID());
    t.ui(()->{t.activity.rotation();t.activity.rotationScreen.document(406,android.net.Uri.parse("content://org.marketreview.nativeapp.test.source-plans/rotation-input"));});
    SourceChecks.waitFor(t,()->t.activity.rotationScreen.rows.size()==71&&t.activity.rotationScreen.snapshots.length()==216,90000,"real industry216 /71");
    SourceChecks.waitFor(t,()->t.activity.rotationScreen.detail.getText().toString().contains("累计净额变化"),15000,"actual historical5minute delta");t.shot("android-real-rotation-industry");
    t.ui(()->t.activity.rotationScreen.rank.setSelection(1));SourceChecks.waitFor(t,()->!t.activity.rotationScreen.rows.isEmpty()&&t.activity.rotationScreen.rows.size()<71,10000,"positive direction filter");
    t.ui(()->t.activity.rotationScreen.curveMode());SourceChecks.waitFor(t,()->t.activity.rotationScreen.curve.data.length()>0,10000,"native curve populated");t.shot("android-rotation-curve");
    t.ui(()->t.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
    try {SourceChecks.waitFor(t,()->t.activity.rotationScreen.getWidth()>t.activity.rotationScreen.getHeight(),5000,"real curve landscape");t.ui(()->t.check(t.activity.rotationScreen.curve.getHeight()>=t.activity.dp(120),"real curve landscape usable"));t.shot("android-real-rotation-landscape");}
    finally {t.ui(()->t.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));}
    SourceChecks.waitFor(t,()->t.activity.rotationScreen.getHeight()>t.activity.rotationScreen.getWidth(),5000,"real curve portrait restored");
    t.ui(()->{t.activity.rotationScreen.selected();t.activity.rotationScreen.cancelFromUi();t.check(t.activity.rotationScreen.curve.data.length()==0&&t.activity.rotationScreen.historyLines.isEmpty(),"cancel new selection cannot expose prior series");t.activity.rotationScreen.rank.setSelection(0);t.activity.rotationScreen.historyMode(false);});
    t.ui(()->t.activity.rotationScreen.scope.setSelection(1));SourceChecks.waitFor(t,()->t.activity.rotationScreen.rows.size()==342&&t.activity.rotationScreen.snapshots.length()==178,30000,"real concept178 /342");
    t.shot("android-real-rotation-concept");
    t.ui(()->t.activity.rotationScreen.captureExport());SourceHistoryChecks.recreateActivity(t);
    SourceChecks.waitFor(t,()->t.activity.rotationScreen.rows.size()==342,30000,"scope preserved on recreate");
    t.check(t.activity.rotationScreen.pendingExport!=null,"picker export anchor restored");
    t.ui(()->t.activity.rotationScreen.document(407,export));
    SourceChecks.waitFor(t,()->!t.activity.rotationScreen.state.getText().toString().equals("导出当前范围…"),30000,"content export finished");
    t.shot("android-rotation-export-result");t.check(t.activity.rotationScreen.state.getText().toString().startsWith("已导出"),"export status: "+t.activity.rotationScreen.state.getText());
    long bytes=0;int lines=0;try(InputStream in=t.getContext().getContentResolver().openInputStream(export);BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){String line;while((line=r.readLine())!=null){JSONObject s=new JSONObject(line);DarkRotation.validate(s);t.check(s.optString("scope").equals("concept"),"export same scope");lines++;bytes+=line.length();}}
    t.check(lines==178&&bytes>0,"all178 exported, not current visible rows");
    t.ui(()->{t.activity.rotationScreen.captureExport();t.activity.rotationScreen.document(407,export);});
    SourceChecks.waitFor(t,()->t.activity.rotationScreen.state.getText().toString().contains("不覆盖"),15000,"existing export protected");
    t.ui(()->{t.activity.rotationScreen.historyMode(true);});t.shot("android-real-rotation-history");
    parity(t);
  }
  static void parity(FlowInstrumentation t) throws Exception {
    JSONArray cases;try(InputStream in=t.getContext().getContentResolver().openInputStream(android.net.Uri.parse("content://org.marketreview.nativeapp.test.source-plans/rotation-oracle"))){cases=new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8)).getJSONArray("cases");}t.check(cases.length()==18,"18 old model comparisons");
    for(int i=0;i<cases.length();i++){JSONObject expected=cases.getJSONObject(i);int scope=expected.getString("scope").equals("industry")?0:1;t.ui(()->{t.activity.rotationScreen.rank.setSelection(0);t.activity.rotationScreen.scope.setSelection(scope);});SourceChecks.waitFor(t,()->t.activity.rotationScreen.rows.size()==(scope==0?71:342)&&t.activity.rotationScreen.snapshots.length()==(scope==0?216:178),30000,"parity uses one UI dataset");JSONArray data=t.activity.rotationScreen.snapshots;JSONObject actual=RotationAnalysis.analyze(data,expected.getString("field"),expected.getInt("minutes"),expected.getString("now"));t.check(actual.getInt("eligible")==expected.getInt("eligible"),"same eligible boards");t.check(actual.optString("windowEndAt").equals(expected.optString("windowEndAt")),"same common endpoint "+expected.getString("scope")+expected.getInt("minutes"));java.util.Map<String,JSONObject> rows=new java.util.HashMap<>();for(int j=0;j<actual.getJSONArray("rows").length();j++){JSONObject r=actual.getJSONArray("rows").getJSONObject(j);rows.put(r.getString("code"),r);}
      for(int j=0;j<expected.getJSONArray("rows").length();j++){JSONObject e=expected.getJSONArray("rows").getJSONObject(j),a=rows.get(e.getString("code"));java.util.Iterator<String> keys=e.keys();while(keys.hasNext()){String key=keys.next();Object value=e.get(key);if(value instanceof Number)t.check(Math.abs(e.getDouble(key)-a.getDouble(key))<1e-7*Math.max(1,Math.abs(e.getDouble(key))),"old numeric "+key);else t.check(value.equals(a.get(key)),"old field "+key);}}
      for(String key:new String[]{"inflow","outflow","accelerating","decelerating"}){JSONArray a=actual.getJSONArray(key),e=expected.getJSONArray(key);t.check(a.length()==e.length(),"rank count");for(int j=0;j<a.length();j++)t.check(a.getJSONObject(j).getString("code").equals(e.getString(j)),"rank order");}
    }
  }
  static void ui(FlowInstrumentation t) throws Exception {
    File db=t.activity.getDatabasePath("rotation-tests-v21.sqlite");
    DarkRotation.Store store=new DarkRotation.Store(db);store.save(snap("2026-10-09T01:30:00Z","100"));
    t.ui(()->{t.activity.rotation();t.activity.rotationScreen.date.setText("2026-10-09");t.activity.rotationScreen.load();});
    long end=android.os.SystemClock.elapsedRealtime()+5000;boolean[] ready={false};
    while(android.os.SystemClock.elapsedRealtime()<end){t.ui(()->ready[0]=t.activity.rotationScreen.rows.size()==1);if(ready[0])break;Thread.sleep(50);}
    t.check(ready[0],"native rotation row loaded");
    t.ui(()->{t.activity.rotationScreen.list.performItemClick(null,0,0);t.check(t.activity.rotationScreen.detail.getText().toString().contains("测试板块"),"selected native board");});
    t.ui(()->{t.activity.rotationScreen.scope.setSelection(1);});Thread.sleep(300);
    t.ui(()->t.check(t.activity.rotationScreen.rows.isEmpty(),"no cross-scope results"));
    t.ui(()->{t.activity.rotationScreen.scope.setSelection(0);});Thread.sleep(300);
    t.ui(()->t.check(t.activity.rotationScreen.rows.size()==1,"return to cached scope"));
    t.ui(()->{t.activity.rotationScreen.curveMode();t.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);});
    try {
      SourceChecks.waitFor(t,()->t.activity.rotationScreen.getWidth()>t.activity.rotationScreen.getHeight(),5000,"rotation page landscape");
      t.ui(()->t.check(t.activity.rotationScreen.curve.getHeight()>=t.activity.dp(120),"landscape rotation curve has usable height"));
      t.ui(()->{for(android.widget.Spinner s:new android.widget.Spinner[]{t.activity.rotationScreen.scope,t.activity.rotationScreen.kind,t.activity.rotationScreen.metric,t.activity.rotationScreen.minutes}){android.widget.TextView label=(android.widget.TextView)s.getSelectedView();t.check(label.getLayout()!=null&&label.getLayout().getEllipsisCount(0)==0&&label.getPaint().measureText(label.getText().toString())<=label.getWidth()-label.getPaddingLeft()-label.getPaddingRight(),"landscape selected filter text fully readable: "+label.getText());}});
      t.shot("android-rotation-landscape");
    } finally {t.ui(()->{t.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);t.activity.rotationScreen.historyMode(false);});}
    SourceChecks.waitFor(t,()->t.activity.rotationScreen.getHeight()>t.activity.rotationScreen.getWidth(),5000,"rotation returns portrait");
    t.ui(()->t.activity.rotationScreen.captureExport());SourceHistoryChecks.recreateActivity(t);
    SourceChecks.waitFor(t,()->t.activity.rotationScreen.rows.size()==1,5000,"recreated fixture rows");
    android.net.Uri target=android.net.Uri.parse("content://org.marketreview.nativeapp.test.source-plans/rotation-export?id="+java.util.UUID.randomUUID());t.ui(()->t.activity.rotationScreen.document(407,target));
    SourceChecks.waitFor(t,()->!t.activity.rotationScreen.state.getText().toString().equals("导出当前范围…"),10000,"small export returned");
    t.check(t.activity.rotationScreen.state.getText().toString().startsWith("已导出"),"export result "+t.activity.rotationScreen.state.getText());
  }
  int assertions;
  void check(boolean ok,String message){assertions++;if(!ok)throw new AssertionError(message);}
  interface Work {void run() throws Exception;}
  void rejected(Work work) throws Exception {boolean failed=false;try{work.run();}catch(Exception expected){failed=true;}check(failed,"invalid input rejected");}
  static JSONObject raw() throws Exception {return new JSONObject("{\"errid\":0,\"1\":\"20261009\",\"2\":1,\"data\":[{\"3\":90,\"4\":\"BK0001\",\"16\":\"测试板块\",\"6\":-23,\"7\":25,\"8\":2,\"5\":145539}]}");}
  static JSONObject snap(String at,String dark) throws Exception {
    JSONObject s=DarkRotation.normalize(raw(),"2026-10-09","industry",1,at);
    s.put("schema","webstock.rotation-snapshot/v1").put("date","2026-10-09").put("sourceKey",DarkRotation.sourceKey(s));
    s.getJSONArray("rows").getJSONObject(0).put("darkNetCents",dark).put("visibleNetCents","200").put("combinedNetCents",DarkRotation.add(dark,"200"));return s;
  }
  int run(Instrumentation test) throws Exception {
    JSONArray analysis=new JSONArray();for(int i=0;i<=10;i++)analysis.put(snap(String.format(java.util.Locale.ROOT,"2026-10-09T01:%02d:00Z",30+i),""+((i<=5?i:5+(i-5)*2)*100)));
    JSONObject result=RotationAnalysis.analyze(analysis,"combinedNetCents",5,"2026-10-12T00:00:00Z");
    JSONObject derived=result.getJSONArray("rows").getJSONObject(0);
    check(result.getInt("eligible")==1&&derived.getString("deltaCents").equals("1000"),"analysis common endpoint delta");
    check(derived.getDouble("speedYuanPerMinute")==2&&derived.getDouble("speedChange")==1,"speed and change not acceleration");
    check(result.getJSONArray("inflow").length()==1&&result.getJSONArray("outflow").length()==0,"signed ranks exclude zero");
    check(RotationAnalysis.analyze(analysis,"combinedNetCents",5,"2026-10-09T01:00:00Z").getInt("eligible")==0,"future rejected");
    analysis.put(snap("2026-10-09T07:01:00Z","1000"));
    check(RotationAnalysis.analyze(analysis,"combinedNetCents",5,"2026-10-12T00:00:00Z").getString("windowEndAt").equals("2026-10-09T01:40:00Z"),"historical common anchor");
    JSONArray lunch=new JSONArray().put(snap("2026-10-09T03:29:00Z","0")).put(snap("2026-10-09T03:30:00Z","100")).put(snap("2026-10-09T04:00:00Z","100")).put(snap("2026-10-09T05:00:00Z","100")).put(snap("2026-10-09T05:04:00Z","200"));
    JSONArray plotted=RotationAnalysis.series(lunch,"BK0001","combinedNetCents");check(plotted.length()==4&&!plotted.getJSONObject(2).getBoolean("gapBefore")&&plotted.getJSONObject(3).getBoolean("gapBefore"),"lunch connects, outage breaks curve");
    check(DarkRotation.add("9999999999999999999999","1").equals("10000000000000000000000"),"exact decimal");
    JSONObject n=DarkRotation.normalize(raw(),"2026-10-09","industry",1,"2026-10-12T00:00:00Z");
    check(n.getJSONArray("rows").getJSONObject(0).getString("darkNetCents").equals("-2300"),"yuan to cents");
    check(n.getJSONArray("rows").getJSONObject(0).isNull("sourceObservedAt"),"unknown source clock");
    JSONObject missing=raw();missing.getJSONArray("data").getJSONObject(0).remove("6");
    check(DarkRotation.normalize(missing,"2026-10-09","industry",1,"2026-10-12T00:00:00Z").getJSONArray("rows").getJSONObject(0).isNull("reconciled"),"missing not zero");
    rejected(()->DarkRotation.normalize(raw(),"2026-10-08","industry",1,"2026-10-12T00:00:00Z"));
    File file=File.createTempFile("rotation-tests-",".sqlite",test.getTargetContext().getCacheDir());
    DarkRotation.Store store=new DarkRotation.Store(file);JSONObject s=snap("2026-10-09T01:30:00Z","100");
    check(store.save(s)==1&&store.save(s)==0,"immutable dedup");
    check(store.importStream(new ByteArrayInputStream((s.toString()+"\n").getBytes(StandardCharsets.UTF_8)),false)==0,"parse and native numeric dedup");
    rejected(()->DarkRotation.parse("{\"x\":1e-2147483647}".getBytes(StandardCharsets.UTF_8)));
    check(!DarkRotation.captureAllowed("2026-10-01","2026-10-01T02:00:00Z","2026-10-01T02:00:10Z"),"closed holiday");
    check(!DarkRotation.captureAllowed("2026-10-09","2026-10-09T03:29:50Z","2026-10-09T03:30:01Z"),"cross lunch rejected");
    check(!DarkRotation.captureAllowed("2026-10-09","2026-10-09T06:56:50Z","2026-10-09T06:57:00Z"),"cross closing rejected");
    rejected(()->store.save(snap("2026-10-09T01:30:00Z","200")));
    String body=snap("2026-10-09T01:31:00Z","200").toString()+"\n{broken\n";
    rejected(()->store.importStream(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)),false));
    check(store.read("2026-10-09","industry",false).length()==1,"import rollback");
    s.put("schema","webstock.rotation-daily/v1");store.save(s);
    check(store.read("2026-10-09","industry",true).length()==1,"daily separate");
    check(store.read("2026-10-09","concept",false).length()==0,"scope separate");
    JSONArray seq=new JSONArray();for(int i=0;i<=5;i++)seq.put(snap(String.format(java.util.Locale.ROOT,"2026-10-09T03:%02d:00Z",25+i),""+(i*100)));
    check(DarkRotation.window(seq,"BK0001","combinedNetCents",5).optString("deltaCents").equals("500"),"5-minute delta");
    seq.put(snap("2026-10-09T05:00:00Z","500"));check(DarkRotation.window(seq,"BK0001","combinedNetCents",5).optString("deltaCents").equals("500"),"lunch no90 minutes");
    seq.put(snap("2026-10-09T05:05:00Z","900"));check(DarkRotation.window(seq,"BK0001","combinedNetCents",5).isNull("deltaCents"),"gap unavailable");
    JSONObject err=raw();err.put("errid",0.5);rejected(()->DarkRotation.normalize(err,"2026-10-09","industry",1,"2026-10-12T00:00:00Z"));
    String trailing=snap("2026-10-09T01:32:00Z","300").toString()+"garbage\n";
    rejected(()->store.importStream(new ByteArrayInputStream(trailing.getBytes(StandardCharsets.UTF_8)),false));
    JSONArray edge=new JSONArray().put(snap("2026-10-09T03:25:00Z","0")).put(snap("2026-10-09T03:26:00Z","100")).put(snap("2026-10-09T03:27:00Z","200"));
    JSONObject last=snap("2026-10-09T03:30:00Z","500");last.put("receivedAt","2026-10-09T03:30:30Z");DarkRotation.validate(last);edge.put(last);
    check(DarkRotation.window(edge,"BK0001","combinedNetCents",5).isNull("deltaCents"),"no lunch-batch gap bypass");
    store.save(snap("2026-10-09T01:30:00.100Z","100"));
    check(store.read("2026-10-09","industry",false).getJSONObject(1).getString("receivedAt").endsWith(".100Z"),"subsecond stable ordering");
    try(android.database.sqlite.SQLiteDatabase locked=store.open()){
      locked.beginTransaction();java.util.concurrent.atomic.AtomicBoolean rejected=new java.util.concurrent.atomic.AtomicBoolean();
      Thread writer=new Thread(()->{try{store.save(snap("2026-10-09T01:36:00Z","300"));}catch(Exception e){rejected.set(true);}});writer.start();Thread.sleep(150);writer.interrupt();locked.endTransaction();writer.join(6000);check(!writer.isAlive()&&rejected.get(),"cancel while database locked rejects save");
    }
    check(store.read("2026-10-09","industry",false).length()==2,"cancelled snapshot not persisted");
    ByteArrayOutputStream exported=new ByteArrayOutputStream();
    store.exportStream(exported,"2026-10-09","industry",false,"2026-10-09T01:30:00Z","2026-10-09T01:30:00.100Z",2);
    DarkRotation.Store copy=new DarkRotation.Store(File.createTempFile("rotation-export-",".sqlite",test.getTargetContext().getCacheDir()));
    check(copy.importStream(new ByteArrayInputStream(exported.toByteArray()),false)==2,"streamed export roundtrip all selected samples");
    check(copy.read("2026-10-09","industry",true).length()==0,"export excludes daily kind");
    ByteArrayOutputStream stale=new ByteArrayOutputStream();
    rejected(()->store.exportStream(stale,"2026-10-09","industry",false,"2026-10-09T01:30:00Z","2026-10-09T01:30:00.100Z",1));
    check(stale.size()==0,"changed export range rejected before writing");
    Thread.currentThread().interrupt();
    try{rejected(()->store.exportStream(stale,"2026-10-09","industry",false,"2026-10-09T01:30:00Z","2026-10-09T01:30:00.100Z",2));}finally{Thread.interrupted();}
    check(stale.size()==0,"cancelled export does not write a first record");
    JSONArray changed=new JSONArray();for(int i=0;i<=5;i++){JSONObject item=snap(String.format(java.util.Locale.ROOT,"2026-10-09T01:%02d:00Z",30+i),""+(i*100));if(i>=3)item.getJSONObject("source").put("methodologyVersion","v2");changed.put(item);}
    check(RotationAnalysis.analyze(changed,"combinedNetCents",5,"2026-10-12T00:00:00Z").getInt("eligible")==0,"model version change cannot join window");
    check(RotationAnalysis.series(changed,"BK0001","combinedNetCents").getJSONObject(3).getBoolean("gapBefore"),"model version curve gap");
    return assertions;
  }
}
