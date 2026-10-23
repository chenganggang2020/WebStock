package org.marketreview.nativeapp;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** Run only through f05-paper-automation. Each run owns a new cache directory. */
final class PaperAutomationMainChecks {
 static final String KEY="synthetic-fixture-secret-0123456789";
 interface Checked{void run()throws Exception;}
 final FlowInstrumentation f;final JSONArray evidence=new JSONArray();PaperAutomationScreen page;int sent;boolean header;String response;
 PaperAutomationMainChecks(FlowInstrumentation f){this.f=f;}
 void ui(Checked action){f.ui(()->{try{action.run();}catch(Exception e){throw new RuntimeException(e);}});}
 void need(boolean ok,String why)throws Exception{f.check(ok,why);evidence.put(why);}
 <T extends View>T tag(String name){T v=f.activity.getWindow().getDecorView().findViewWithTag(name);f.check(v!=null,"control "+name);return v;}
 void tap(String name){ui(()->{View v=tag(name);v.requestRectangleOnScreen(new Rect(0,0,v.getWidth(),v.getHeight()),true);});ui(()->{View v=tag(name);Rect r=new Rect();need(v.isShown()&&v.isEnabled()&&v.getGlobalVisibleRect(r)&&r.width()>0&&r.height()>0,"visible actionable "+name);v.performClick();});}
 void check(String name,boolean value){ui(()->((CheckBox)tag(name)).setChecked(value));}
 static JSONObject asset(FlowInstrumentation f,String name)throws Exception{try(InputStream in=f.getContext().getAssets().open(name);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return new JSONObject(out.toString("UTF-8"));}}
 final class Fake extends HttpURLConnection{
  final ByteArrayOutputStream body=new ByteArrayOutputStream();final byte[] payload;
  Fake()throws Exception{super(new URL("https://api.openai.com/v1/chat/completions"));payload=new JSONObject().put("object","chat.completion").put("id","local-f05").put("model","fixture-model").put("created",1).put("choices",new JSONArray().put(new JSONObject().put("index",0).put("message",new JSONObject().put("role","assistant").put("content",response)).put("finish_reason","stop"))).toString().getBytes(StandardCharsets.UTF_8);}
  public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public OutputStream getOutputStream(){return body;}public InputStream getInputStream(){return new ByteArrayInputStream(payload);}public int getResponseCode(){return 200;}public String getContentType(){return "application/json";}public String getHeaderField(String k){return k.equalsIgnoreCase("Content-Length")?Integer.toString(payload.length):k.equalsIgnoreCase("Content-Type")?"application/json":null;}public void setRequestProperty(String k,String v){if(k.equals("Authorization"))header=v.equals("Bearer "+KEY);}
 }
 static JSONObject run(FlowInstrumentation f)throws Exception{return new PaperAutomationMainChecks(f).run();}
 static JSONObject reading(FlowInstrumentation f,String namespace)throws Exception{
  if(!namespace.matches("f05-paper-[0-9a-f-]{36}"))throw new IllegalArgumentException("isolated namespace required");
  PaperAutomationMainChecks c=new PaperAutomationMainChecks(f);File dir=new File(f.getTargetContext().getCacheDir(),namespace);c.need(dir.isDirectory(),"existing isolated completed run");
  byte[] original=Files.readAllBytes(new File(dir,"business.sqlite").toPath());
  f.activity=(MainActivity)f.startActivitySync(new Intent(f.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).putExtra("paperAutomationTest",namespace).putExtra("paperAutomationCut","2026-10-14T02:01:20Z").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));f.waitForIdleSync();
  try{
   JSONObject fixture=asset(f,"f05-host-fixture.json");c.ui(()->{List<JSONObject> roster=PaperMonitorActualMainChecks.field(f.activity,"instruments");roster.clear();JSONArray rows=fixture.getJSONArray("instruments");for(int i=0;i<rows.length();i++)roster.add(rows.getJSONObject(i));});
   f.click("账户");f.click("纸面");c.tap("paperOpenMonitor");c.ui(()->{PaperMonitorHostScreen parent=c.tag("paperMonitorHostPage");Spinner choices=PaperMonitorActualMainChecks.field(parent,"accounts");int selected=-1;for(int i=0;i<choices.getCount();i++)if(choices.getItemAtPosition(i).toString().contains("(paper-1)"))selected=i;c.need(selected>=0,"existing account choice");choices.setSelection(selected);});f.waitForIdleSync();c.tap("paperHostAutomation");
   f.shotFolder="f05-reading-"+namespace;JSONArray sizes=new JSONArray();
   for(int orientation:new int[]{ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE,ActivityInfo.SCREEN_ORIENTATION_PORTRAIT}){
    c.ui(()->f.activity.setRequestedOrientation(orientation));Thread.sleep(500);f.waitForIdleSync();
    f.shot(orientation==ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE?"landscape":"portrait");
    c.ui(()->{TextView reader=c.tag("paperAutomationReader");Rect visible=new Rect();boolean shown=reader.getGlobalVisibleRect(visible);float density=f.activity.getResources().getDisplayMetrics().density;int min=Math.round(80*density);c.need(shown&&visible.height()>=min,"reader visible height at least 80dp; orientation="+orientation+" actual="+visible.height()+" required="+min);c.need(reader.getText().toString().contains("77990.10")&&reader.getText().toString().contains("完整起始材料"),"full existing ledger text retained");sizes.put(new JSONObject().put("orientation",orientation).put("visibleHeightPx",visible.height()).put("minimumPx",min));});
   }
   c.need(Arrays.equals(original,Files.readAllBytes(new File(dir,"business.sqlite").toPath())),"original business bytes retained during reading");return new JSONObject().put("passed",true).put("sizes",sizes).put("checks",c.evidence).put("coreRerun",false);
  }finally{f.ui(()->f.activity.finish());}
 }
 JSONObject run()throws Exception{
  String namespace="f05-paper-"+UUID.randomUUID();File dir=new File(f.getTargetContext().getCacheDir(),namespace);need(dir.mkdir(),"new isolated test directory");
  JSONObject fixture=asset(f,"f05-host-fixture.json"),model=asset(f,"f05-model-fixture.json");response=model.getJSONObject("decision").toString();
  f.activity=(MainActivity)f.startActivitySync(new Intent(f.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).putExtra("paperAutomationTest",namespace).putExtra("paperAutomationCut","2026-10-14T02:00:00Z").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));f.waitForIdleSync();
  try{
   File business=new File(dir,"business.sqlite");
   ui(()->{File actual=f.activity.paperAutomationTestDirectory();need(actual.getCanonicalFile().equals(dir.getCanonicalFile())&&Files.isSameFile(actual.toPath(),dir.toPath())&&Files.isSameFile(actual.getParentFile().toPath(),f.getTargetContext().getCacheDir().toPath())&&actual.getName().equals(namespace),"Main owns exact isolated physical namespace and cache parent");need(f.activity.feed==null,"fixture mode has no live feed");SQLiteDatabase db=f.activity.businessStore.getWritableDatabase();db.beginTransaction();try{db.execSQL("DELETE FROM records WHERE kind IN ('accounts','trades')");for(String kind:new String[]{"accounts","trades"}){JSONArray rows=fixture.getJSONArray(kind);for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);db.execSQL("INSERT INTO records(kind,id,payload) VALUES(?,?,?)",new Object[]{kind,row.getString("id"),row.toString()});}}db.setTransactionSuccessful();}finally{db.endTransaction();}f.activity.businessStore.close();List<JSONObject> roster=PaperMonitorActualMainChecks.field(f.activity,"instruments");roster.clear();JSONArray rows=fixture.getJSONArray("instruments");for(int i=0;i<rows.length();i++)roster.add(rows.getJSONObject(i));});
   byte[] original=Files.readAllBytes(business.toPath());f.click("账户");f.click("纸面");tap("paperOpenMonitor");
   final PaperMonitorHostScreen[] parent={null};ui(()->{parent[0]=tag("paperMonitorHostPage");Spinner choices=PaperMonitorActualMainChecks.field(parent[0],"accounts");int index=-1;for(int i=0;i<choices.getCount();i++)if(choices.getItemAtPosition(i).toString().contains("(paper-1)"))index=i;need(index>=0,"account is selectable");choices.setSelection(index);});
   f.click("账户策略设置");ui(()->{ViewGroup panel=PaperMonitorActualMainChecks.field(parent[0],"settings");PaperPolicyScreen policy=null;for(int i=0;i<panel.getChildCount();i++)if(panel.getChildAt(i) instanceof PaperPolicyScreen)policy=(PaperPolicyScreen)panel.getChildAt(i);need(policy!=null,"actual account policy editor");((Spinner)PaperMonitorActualMainChecks.field(policy,"state")).setSelection(1);((EditText)PaperMonitorActualMainChecks.field(policy,"percent")).setText("40");((CheckBox)PaperMonitorActualMainChecks.field(policy,"confirmed")).setChecked(true);});f.click("保存设置");f.click("返回纸面监控");
   ui(()->{((EditText)PaperMonitorActualMainChecks.field(parent[0],"response")).setText("F05 原人工稿保持完整");parent[0].setAutomationHost(new PaperMonitorHostScreen.AutomationHost(){public JSONObject preferences()throws Exception{return new JSONObject().put("provider","openai").put("endpoint","https://api.openai.com/v1/chat/completions").put("model","fixture-model").put("enabledPreference",true).put("timeoutMs",1000);}public void refresh(JSONArray ids){}});});
   tap("paperHostAutomation");ui(()->{page=tag("paperAutomationPage");page.runtime.fake=()->{sent++;return new Fake();};});check("paperAutomationOpeningAck",true);tap("paperAutomationInitialize");
   PaperAutomationStore store=new PaperAutomationStore(new File(dir,"paper-host/paper-execution-v1.sqlite"));need(store.read("paper-1").length()>0&&sent==0,"seed commits with no request");check("paperAutomationEnabled",true);check("paperAutomationSimulation",true);tap("paperAutomationSave");tap("paperAutomationPrepare");tap("paperAutomationPreview");need(sent==0,"preview sends no request");
   for(String name:new String[]{"authorizationReviewed","authorizationModel","authorizationBilling"})check(name,true);ui(()->((EditText)tag("authorizationCredential")).setText(KEY));tap("authorizationApprove");tap("paperAutomationStart");
   long end=SystemClock.elapsedRealtime()+6000;while(store.read("paper-1").getJSONArray("orders").length()==0&&SystemClock.elapsedRealtime()<end){Thread.sleep(50);f.waitForIdleSync();}JSONObject accepted=store.read("paper-1");Files.write(new File(dir,"f05-before-order-assert.json").toPath(),accepted.toString(2).getBytes(StandardCharsets.UTF_8));final String[] runtimeMessage={""};ui(()->runtimeMessage[0]=page.runtime.message());need(accepted.getJSONArray("orders").length()==1&&accepted.getJSONArray("fills").length()==0&&sent==1&&header,"authorized actual runtime archives one pending order; sent="+sent+" header="+header+" runtime="+runtimeMessage[0]+" evidence="+dir.getCanonicalPath());
   ui(()->{f.activity.getIntent().putExtra("paperAutomationCut","2026-10-14T02:01:20Z");List<JSONObject> roster=PaperMonitorActualMainChecks.field(f.activity,"instruments");roster.get(0).put("minuteMeta",new JSONObject().put("source","腾讯公开分时").put("timeUnit","milliseconds").put("intervalMinutes",1).put("checkedAt","2026-10-14T02:01:10Z").put("previousClose",10)).put("minute",new JSONArray().put(new JSONObject().put("time",java.time.Instant.parse("2026-10-14T02:01:00Z").toEpochMilli()).put("close",10).put("volume",1000).put("valid",true)));});tap("paperAutomationPoll");JSONObject filled=store.read("paper-1");need(filled.getJSONArray("fills").length()==1&&filled.getDouble("cash")==77990.1,"actual minute cache consumption and atomic balance");tap("paperAutomationPoll");need(PaperMonitorModel.equal(filled,store.read("paper-1")),"duplicate tick is persistent no-op");need(Arrays.equals(original,Files.readAllBytes(business.toPath())),"original business database bytes unchanged");need(!filled.toString().contains(KEY),"no credential in execution book");
   long revision=filled.getLong("revision");boolean rolledBack=false;try{store.transact("paper-1",revision,b->{b.put("cash",1);return b;},()->false);}catch(Exception expected){rolledBack=true;}need(rolledBack&&PaperMonitorModel.equal(filled,store.read("paper-1")),"Android SQLite cancelled commit rolls back");
   f.shotFolder="f05-paper-automation-"+namespace;f.shot("filled-portrait");ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));Thread.sleep(400);f.waitForIdleSync();ui(()->{View reader=tag("paperAutomationReader");need(reader.getWidth()>100&&reader.getHeight()>0,"landscape reader has usable geometry");});f.shot("filled-landscape");
   tap("paperAutomationBack");ui(()->need(((EditText)PaperMonitorActualMainChecks.field(parent[0],"response")).getText().toString().equals("F05 原人工稿保持完整"),"manual draft retained"));tap("paperHostAutomation");ui(()->need(((TextView)tag("paperAutomationSummary")).getText().toString().contains("77990.10"),"reopened balance comes from durable book"));need(sent==1,"reopen does not replay request");
   JSONObject report=new JSONObject().put("passed",true).put("namespace",namespace).put("checks",evidence).put("nativeAndroidRuntime",true).put("realProvider",false).put("cash",77990.1).put("fills",1);Files.write(new File(dir,"f05-host-check.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));return report;
  }finally{f.ui(()->f.activity.finish());}
 }
}
