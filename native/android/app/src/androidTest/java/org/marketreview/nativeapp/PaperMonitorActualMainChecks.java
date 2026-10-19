package org.marketreview.nativeapp;

import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Test-only actual MainActivity controls; no replacement Flow, live feed, or broker operation. */
final class PaperMonitorActualMainChecks {
 static final String CUT="2026-10-13T02:00:00Z", DB="native-business-tests.sqlite";
 interface Checked {void run()throws Exception;}
 static void isolate(Context context)throws Exception {
  if((context.getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)
   throw new IllegalStateException("debug instrumentation only");
  String suffix=".previous-v48-"+UUID.randomUUID();
  for(String tail:new String[]{"","-wal","-shm","-journal"}){
   File file=context.getDatabasePath(DB+tail);
   if(file.exists())Files.move(file.toPath(),new File(file.getParentFile(),file.getName()+suffix).toPath());
  }
  File directory=new File(context.getFilesDir(),"paper-monitor-host-tests");
  if(directory.exists())Files.move(directory.toPath(),new File(directory.getParentFile(),directory.getName()+suffix).toPath());
 }
 @SuppressWarnings("unchecked") static <T>T field(Object owner,String name)throws Exception {
  Field f=owner.getClass().getDeclaredField(name);f.setAccessible(true);return (T)f.get(owner);
 }
 static JSONObject asset(FlowInstrumentation f)throws Exception {
  try(InputStream in=f.getContext().getAssets().open("paper-monitor-host-fixture.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] chunk=new byte[4096];int n;while((n=in.read(chunk))!=-1)out.write(chunk,0,n);
   return new JSONObject(out.toString("UTF-8"));
  }
 }
 static void run(FlowInstrumentation f)throws Exception {new Session(f).run();}

 static final class Session {
  final FlowInstrumentation f;
  final JSONArray assertions=new JSONArray(),layouts=new JSONArray();
  final List<String> failures=new ArrayList<>();
  JSONObject fixture;PaperMonitorHostScreen page;String ledgerBefore,reply;
  byte[] dbBefore;File dbFile;int steps;
  Session(FlowInstrumentation f){this.f=f;}
  void ui(Checked work){f.ui(()->{try{work.run();}catch(Exception e){throw new RuntimeException(e);}});}
  void expect(boolean value,String label)throws Exception {
   f.assertions++;assertions.put(new JSONObject().put("passed",value).put("label",label));
   if(!value)failures.add(label);
  }
  void need(boolean value,String label){f.check(value,label);}
  PaperMonitorFlow flow()throws Exception{return field(page,"flow");}
  JSONObject state()throws Exception{return flow().state();}
  Button button(String label){Button result=f.find(page,label);need(result!=null,"visible actual button: "+label);return result;}
  void tap(String label)throws Exception {final Button[] b={null};ui(()->b[0]=button(label));tap(b[0]);}
  void tap(Button b)throws Exception {
   ui(()->{need(b!=null&&b.isEnabled()&&b.isShown(),"enabled visible control");b.requestRectangleOnScreen(new Rect(0,0,b.getWidth(),b.getHeight()),true);});
   ui(()->{Rect r=new Rect();need(b.getGlobalVisibleRect(r)&&r.width()>0&&r.height()>0,"control has visible clickable area: "+b.getText());
    expect(r.width()==b.getWidth()&&r.height()==b.getHeight(),"control fully visible: "+b.getText());b.performClick();});
  }
  void setCheck(String name,boolean checked){ui(()->{CheckBox box=field(page,name);need(box.isShown()&&box.isEnabled(),"visible checkbox "+name);box.setChecked(checked);});}
  void roster()throws Exception {
   List<JSONObject> rows=field(f.activity,"instruments");rows.clear();
   JSONArray source=fixture.getJSONArray("instruments");
   for(int i=0;i<source.length();i++)rows.add(new JSONObject(source.getJSONObject(i).toString()));
  }
  String ledger()throws Exception {
   return PortfolioMirrorModel.canonical(BusinessStore.readLedgerSnapshot(dbFile,()->false));
  }
  void bindPage() {
   View found=f.activity.getWindow().getDecorView().findViewWithTag("paperMonitorHostPage");
   need(found instanceof PaperMonitorHostScreen&&found.isShown(),"actual Main owns visible paper host");
   page=(PaperMonitorHostScreen)found;
  }
  void enter()throws Exception {
   final Button[] account={null},paper={null},entry={null};
   ui(()->{LinearLayout nav=f.activity.findViewById(R.id.navigation);account[0]=f.find(nav,"账户");need(account[0]!=null,"account bottom navigation");});
   tap(account[0]);
   ui(()->paper[0]=f.find(f.activity.getWindow().getDecorView(),"纸面"));tap(paper[0]);
   ui(()->{View e=f.activity.getWindow().getDecorView().findViewWithTag("paperOpenMonitor");need(e instanceof Button,"actual paperOpenMonitor entry");entry[0]=(Button)e;});tap(entry[0]);
   ui(()->{bindPage();navigation();});
  }
  void navigation()throws Exception {
   LinearLayout nav=f.activity.findViewById(R.id.navigation);Button account=f.find(nav,"账户");
   expect(account!=null&&account.isSelected(),"paper monitor remains in account navigation");
  }
  void selectAccount() {
   ui(()->{Spinner accounts=field(page,"accounts");int selected=-1;
    for(int i=0;i<accounts.getCount();i++)if(accounts.getItemAtPosition(i).toString().contains("(paper-1)"))selected=i;
    need(selected>=0,"fixture paper account available through actual spinner");
    accounts.setSelection(selected);
   });
   ui(()->need("paper-1".equals(state().getString("accountId")),"explicit selected paper account"));
  }
  PaperPolicyScreen policy()throws Exception {
   ViewGroup panel=field(page,"settings");need(panel!=null&&panel.isShown(),"actual settings subpage visible");
   for(int i=0;i<panel.getChildCount();i++)if(panel.getChildAt(i) instanceof PaperPolicyScreen)return (PaperPolicyScreen)panel.getChildAt(i);
   throw new AssertionError("policy subpage missing");
  }
  void fillPolicy(String percent)throws Exception {
   ui(()->{PaperPolicyScreen p=policy();Spinner status=field(p,"state");status.setSelection(1);
    EditText weight=field(p,"percent");weight.setText(percent);CheckBox ack=field(p,"confirmed");ack.setChecked(true);});
  }
  void configure()throws Exception {
   tap("账户策略设置");fillPolicy("20");tap("保存设置");
   ui(()->{JSONObject saved=new PaperPolicyStore(flow().settingsFile()).read();
    JSONObject row=PaperPolicySettings.latest(saved,"paper-1");
    need("active".equals(row.optString("status"))&&row.optDouble("maxSingleWeight")==.2,"actual strategy save");
   });f.shot("paper-policy-portrait");tap("返回纸面监控");
  }
  void preparePreview()throws Exception {
   setCheck("scope",true);tap("检查并准备");
   ui(()->{JSONObject s=state();need(s.getBoolean("preparedForCurrentSession"),"actual prepare: "+((TextView)field(page,"status")).getText());
    JSONObject p=s.getJSONObject("evidence");need(java.time.Instant.parse(CUT).equals(java.time.Instant.parse(p.getString("preparedAt"))),"fixture clock exercised by actual host");
    String code=p.getJSONObject("readiness").getJSONArray("allowedUniverse").getJSONObject(0).getString("code");
    JSONObject order=new JSONObject().put("code",code).put("action","hold").put("targetPositionPercent",10).put("confidence",70).put("reason","隔离人工答复，不是行情建议").put("invalidation","测试结束即失效");
    reply=new JSONObject().put("asOf",p.getString("preparedAt")).put("marketView","neutral").put("cashTargetPercent",90)
     .put("orders",new JSONArray().put(order)).put("portfolioRisk",new JSONArray()).put("nextReviewAt","2026-10-13T02:05:00Z").toString();
    EditText response=field(page,"response");need(response.isShown()&&response.isEnabled(),"actual manual response editor");response.setText(reply);
   });tap("预览人工答复");
   ui(()->{need(state().getBoolean("canConfirm"),"actual manual response preview");expect(!state().getBoolean("automaticTrading"),"automaticTrading remains false");});
  }
  void noAuthority(String label)throws Exception {
   JSONObject s=state();expect(!s.getBoolean("preparedForCurrentSession")&&!s.getBoolean("canConfirm")&&!s.getBoolean("canReject"),label);
  }
  void layout(String name)throws Exception {
   ui(()->{
    TextView reader=field(page,"reader");View parent=(View)reader.getParent();
    while(!(parent instanceof ScrollView)&&parent!=page&&parent.getParent() instanceof View)parent=(View)parent.getParent();
    Rect visible=new Rect();boolean has=parent.getGlobalVisibleRect(visible);
    float density=page.getResources().getDisplayMetrics().density;
    JSONObject row=new JSONObject().put("name",name).put("orientation",page.getResources().getConfiguration().orientation)
     .put("pageWidthDp",page.getWidth()/density).put("pageHeightDp",page.getHeight()/density)
     .put("readerViewportHeightDp",parent.getHeight()/density).put("visibleReaderHeightDp",has?visible.height()/density:0)
     .put("readerTextUnits",reader.length());
    layouts.put(row);expect(parent instanceof ScrollView&&parent.getHeight()>=96*density&&has&&visible.height()>=96*density,"reader usable viewport >=96dp: "+name);
    navigation();
   });f.shot(name);
  }
  void orient(boolean landscape)throws Exception {
   ui(()->f.activity.setRequestedOrientation(landscape?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
   long end=SystemClock.elapsedRealtime()+8000;int stable=0;String last="";
   while(SystemClock.elapsedRealtime()<end){
    final String[] size={""};final boolean[] correct={false};
    ui(()->{View decor=f.activity.getWindow().getDecorView();correct[0]=
      ((f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE)==landscape)
      &&((decor.getWidth()>decor.getHeight())==landscape);
      size[0]=decor.getWidth()+"x"+decor.getHeight();
    });
    stable=correct[0]&&last.equals(size[0])?stable+1:0;last=size[0];
    if(stable>=3){Thread.sleep(600);f.waitForIdleSync();return;}Thread.sleep(100);
   }throw new AssertionError("decor did not stabilize after orientation");
  }
  void guards()throws Exception {
   // Settings guards deliberately invoke retained real buttons, including invisible ones.
   preparePreview();final Button[] prepare={null},preview={null},save={null};
   ui(()->{prepare[0]=button("检查并准备");preview[0]=button("预览人工答复");});
   tap("账户策略设置");
   ui(()->{
    noAuthority("opening settings revokes preparation");
    prepare[0].performClick();noAuthority("hidden main prepare while settings shown cannot authorize");
    preview[0].performClick();noAuthority("hidden main preview while settings shown cannot authorize");
    expect(((View)field(page,"settings")).isShown(),"hidden main callbacks do not replace settings");
   });
   fillPolicy("25");ui(()->save[0]=f.find(policy(),"保存设置"));tap("返回纸面监控");
   final byte[][] before={null};
   ui(()->{before[0]=Files.readAllBytes(flow().settingsFile().toPath());save[0].performClick();
    expect(Arrays.equals(before[0],Files.readAllBytes(flow().settingsFile().toPath())),"old settings save after back does not write policy");
    noAuthority("old settings save does not regain authority");
   });
   // Restore test policy through the visible real editor if an unfixed build accepted the old button.
   configure();
   preparePreview();final Button[] confirm={null},entry={null};final int[] records={0};
   ui(()->{
    confirm[0]=button("确认并归档");
    entry[0]=f.activity.getWindow().getDecorView().findViewWithTag("paperOpenMonitor");
    records[0]=flow().history().length();f.activity.goHome();
    prepare[0].performClick();preview[0].performClick();confirm[0].performClick();
    noAuthority("old prepare/preview/confirm after leaving cannot authorize");
    expect(flow().history().length()==records[0],"old hidden actions cannot append history");
    need(entry[0]!=null,"retained real paper entry");
    entry[0].performClick();
    expect(!page.isShown(),"hidden paper entry cannot reopen and activate page");
    f.activity.goHome();
   });
   enter();ui(()->noAuthority("reentry cannot reuse previous preparation"));
   preparePreview();
   ui(()->{page.setVisibility(View.GONE);confirm[0].performClick();noAuthority("whole-page hide rejects old confirmation");page.setVisibility(View.VISIBLE);});
   enter();ui(()->noAuthority("showing page again does not restore preparation"));
  }
  void run()throws Exception {
   Throwable failed=null;
   try {
    need(Build.VERSION.SDK_INT>=35,"real read-only SQLite transaction requires API35");
    fixture=asset(f);
    ui(()->{
     need(f.activity.testing&&DB.equals(f.activity.businessStore.getDatabaseName()),"isolated actual Main business Store");
     need(CUT.equals(f.activity.getIntent().getStringExtra("paperMonitorFixtureCut")),"explicit test clock extra required");
     need(!new File(f.activity.getFilesDir(),"paper-monitor-host-tests").exists(),"fresh isolated paper private directory");
     for(String kind:new String[]{"accounts","trades"}){JSONArray rows=fixture.getJSONArray(kind);for(int i=0;i<rows.length();i++)f.activity.businessStore.save(kind,rows.getJSONObject(i));}
     roster();dbFile=f.activity.getDatabasePath(DB);ledgerBefore=ledger();dbBefore=Files.readAllBytes(dbFile.toPath());steps++;
    });
    enter();selectAccount();ui(()->need(CUT.equals(flow().now()),"Main paper-only fixture clock hook required"));
    configure();preparePreview();layout("paper-preview-portrait");
    final int[] count={0};ui(()->count[0]=flow().history().length());
    ui(()->{Button confirmation=button("确认并归档");if(confirmation.isEnabled())confirmation.performClick();
     expect(flow().history().length()==count[0],"unchecked explicit decision cannot archive");});
    tap("预览人工答复");
    setCheck("decisionAck",true);tap("确认并归档");
    ui(()->{JSONArray h=flow().history();need(h.length()==count[0]+1,"actual confirmation appends one private paper record");
     JSONObject record=h.getJSONObject(h.length()-1);
     expect("confirmed".equals(record.getString("choice"))&&"none".equals(record.getString("execution"))&&!record.getBoolean("automaticTrading"),"paper confirmation never executes orders");
     expect(ledgerBefore.equals(ledger()),"actual readonly host left all account/trade records identical");
     expect(Arrays.equals(dbBefore,Files.readAllBytes(dbFile.toPath())),"business database bytes unchanged through policy and confirmation");
     steps++;
    });
    preparePreview();tap("取消准备");
    ui(()->{noAuthority("cancel revokes prepared and preview authority");expect(reply.equals(state().getString("response")),"cancel preserves full manual response");
     Spinner history=field(page,"history");need(history.getCount()>1,"history spinner has archived decision");history.setSelection(1);
    });
    ui(()->noAuthority("historical selection is readonly"));layout("paper-history-portrait");
    orient(true);ui(()->noAuthority("rotation does not revive cancelled/history authority"));layout("paper-history-landscape");orient(false);
    guards();steps++;
    preparePreview();final PaperMonitorHostScreen old=page;final Button[] oldConfirm={null};
    ui(()->{oldConfirm[0]=button("确认并归档");Bundle marker=page.saveState();Parcel parcel=Parcel.obtain();parcel.writeBundle(marker);
     expect(marker.size()==2&&parcel.dataSize()<1024,"recreation bundle contains only short id/hash marker");parcel.recycle();
    });
    SourceHistoryChecks.recreateActivity(f);
    ui(()->{bindPage();need(page!=old,"actual Main recreation replaced host instance");noAuthority("recreation never restores preparation or confirmation");
     expect(reply.equals(state().getString("response")),"full manual response restored from private draft");
     int records=flow().history().length();oldConfirm[0].performClick();
     expect(flow().history().length()==records,"old activity confirmation cannot append history");
     expect(ledgerBefore.equals(ledger()),"recreation preserves actual account/trade records");
     roster();navigation();
    });
    layout("paper-recreated-portrait");steps++;
    ui(()->expect(ledgerBefore.equals(ledger()),"final full account/trade snapshot unchanged"));
    if(!failures.isEmpty())throw new AssertionError(String.join("; ",failures));
   } catch(Throwable error){failed=error;if(error instanceof Exception)throw (Exception)error;throw new AssertionError(error);}
   finally {
    JSONObject report=new JSONObject().put("status",failed==null?"PASS_ACTUAL_MAIN":"FAIL_ACTUAL_MAIN")
     .put("assertions",assertions).put("failures",new JSONArray(failures)).put("layout",layouts).put("completedStages",steps)
     .put("clock","fixed test-only 2026-10-13T02:00:00Z").put("fixture","v41 host.json used by v42")
     .put("scope","actual Main controls + real isolated SQLite; performClick instrumentation, not touch gestures/live market/AI/broker acceptance");
    if(failed!=null)report.put("exception",failed.toString());
    File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);if(!dir.isDirectory())dir.mkdirs();
    Files.write(new File(dir,"paper-actual-main-v48.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));
   }
  }
 }
}
