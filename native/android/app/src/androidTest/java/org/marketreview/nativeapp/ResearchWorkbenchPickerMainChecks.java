package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** F07 caller/picker delta only; does not rerun page7, model-source14, or batch-store suites. */
final class ResearchWorkbenchPickerMainChecks {
 interface Work{void run()throws Exception;}
 final FlowInstrumentation f;final JSONArray evidence=new JSONArray(),pickerStates=new JSONArray();ResearchWorkbenchScreen page;File dir;int code;boolean importAction;
 ResearchWorkbenchPickerMainChecks(FlowInstrumentation t){f=t;}
 void ui(Work a){f.ui(()->{try{a.run();}catch(Exception e){throw new RuntimeException(e);}});}
 void check(boolean ok,String text)throws Exception{f.check(ok,text);evidence.put(text);}
 @SuppressWarnings("unchecked") static <T>T field(Object object,String name)throws Exception{Field value=object.getClass().getDeclaredField(name);value.setAccessible(true);return (T)value.get(object);}
 View tag(String name){View view=page.findViewWithTag(name);f.check(view!=null,"F07 actual control "+name);return view;}
 String raw(){return ((EditText)tag("f07BatchInput")).getText().toString();}
 void await(java.util.function.BooleanSupplier condition)throws Exception{long end=SystemClock.elapsedRealtime()+5000;while(SystemClock.elapsedRealtime()<end){final boolean[] value={false};ui(()->value[0]=condition.getAsBoolean());if(value[0])return;Thread.sleep(30);}throw new AssertionError("F07 focused condition not ready");}
 void active()throws Exception{await(()->page.isShown()&&page.hasWindowFocus());}
 void tap(String name){ui(()->{View button=tag(name);f.check(button.isShown()&&button.isEnabled()&&page.hasWindowFocus(),"visible original F07 button "+name);button.performClick();});}
 void resumed(){ui(()->f.activity.onResume());}
 JSONObject pickerState(String stage,Instrumentation.ActivityMonitor monitor,Intent offered)throws Exception{
  MainActivity a=f.activity;MainActivity.F07Picker ticket=a.f07Pickers.get(code);View button=page.findViewWithTag(importAction?"f07Import":"f07Export");JSONObject state=new JSONObject().put("stage",stage).put("request",code).put("monitorHits",monitor==null?0:monitor.getHits()).put("nextRequest",a.f07PickerNext).put("tickets",a.f07Pickers.size()).put("ticketPresent",ticket!=null).put("foreground",(Boolean)field(a,"foreground")).put("screenActive",(Boolean)field(page,"active")).put("currentOwner",a.researchWorkbenchCurrent(page)).put("drainReady",a.researchWorkbenchReady(page)).put("attached",page.isAttachedToWindow()).put("shown",page.isShown()).put("focus",page.hasWindowFocus()).put("windowVisibility",page.getWindowVisibility()).put("buttonShown",button!=null&&button.isShown()).put("buttonEnabled",button!=null&&button.isEnabled()).put("rawLength",raw().length()).put("status",((TextView)tag("f07Status")).getText().toString()).put("epoch",a.f07Epoch);
  if(ticket!=null)state.put("sameOwner",ticket.owner==page).put("ticketEpoch",ticket.epoch).put("returned",ticket.returned).put("reading",ticket.reading).put("revoked",ticket.revoked).put("hasBytes",ticket.bytes!=null).put("uri",ticket.uri==null?JSONObject.NULL:ticket.uri.toString()).put("error",ticket.error==null?JSONObject.NULL:ticket.error);
  if(offered!=null)state.put("intentAction",offered.getAction()).put("intentType",offered.getType()).put("intentCategories",String.valueOf(offered.getCategories())).put("actionOnlyFilterMatch",new IntentFilter(offered.getAction()).match(offered.getAction(),offered.getType(),offered.getScheme(),offered.getData(),offered.getCategories(),"F07-picker-observation"));
  pickerStates.put(state);try(FileOutputStream out=new FileOutputStream(new File(dir,"f07-picker-checkpoints.json"))){out.write(pickerStates.toString(2).getBytes(StandardCharsets.UTF_8));out.flush();out.getFD().sync();}System.out.println("F07_PICKER_STATE "+state);return state;
 }
 void pausedResult(File file,boolean export)throws Exception{
  final String action=export?Intent.ACTION_CREATE_DOCUMENT:Intent.ACTION_OPEN_DOCUMENT;importAction=!export;IntentFilter filter=new IntentFilter(action);filter.addCategory(Intent.CATEGORY_OPENABLE);filter.addDataType("application/json");
  Intent launched=new Intent(action).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
  // Block the launch with no framework-generated result; deliver the controlled result below.
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(filter,null,true);final MainActivity.F07Picker[] pending={null};final String[] draft={null};
  f.addMonitor(monitor);try{
   ui(()->{code=f.activity.f07PickerNext;draft[0]=raw();pickerState("before-blocked-button",monitor,launched);check(filter.match(launched.getAction(),launched.getType(),launched.getScheme(),launched.getData(),launched.getCategories(),"F07-picker-order")>=0,"MIME/category filter matches actual document intent");});tap(export?"f07Export":"f07Import");f.waitForIdleSync();
   ui(()->{code=f.activity.f07PickerNext-1;pending[0]=f.activity.f07Pickers.get(code);JSONObject armed=pickerState("armed-no-framework-result",monitor,null);check(monitor.getHits()==1&&pending[0]!=null&&!pending[0].returned,"actual Main starts dedicated "+action+" with no automatic result "+armed);
    f.activity.onPause();f.activity.onActivityResult(code,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file)));MainActivity.F07Picker ticket=f.activity.f07Pickers.get(code);JSONObject state=pickerState("returned-before-explicit-resume",monitor,null);check(ticket==pending[0]&&ticket.returned&&!ticket.reading&&ticket.bytes==null&&!ticket.revoked&&ticket.owner==page&&ticket.epoch==f.activity.f07Epoch&&Uri.fromFile(file).equals(ticket.uri)&&!((Boolean)field(f.activity,"foreground"))&&raw().equals(draft[0])&&(!export||!file.exists()),"result before onResume only memory-stashes URI; no read/overwrite/write "+state);
   });
   f.waitForIdleSync();ui(()->{MainActivity.F07Picker ticket=f.activity.f07Pickers.get(code);JSONObject state=pickerState("idle-still-before-explicit-resume",monitor,null);check(ticket==pending[0]&&ticket.returned&&!ticket.reading&&ticket.bytes==null&&!ticket.revoked&&!((Boolean)field(f.activity,"foreground"))&&raw().equals(draft[0])&&(!export||!file.exists()),"same-owner returned ticket stays memory-only until explicit resume "+state);});
  }finally{f.removeMonitor(monitor);}
 }
 void reading(String original)throws Exception{ui(()->{Method set=ResearchWorkbenchScreen.class.getDeclaredMethod("setReader",String.class,String.class);set.setAccessible(true);set.invoke(page,"Owned original for host export\n"+original,original);});}
 static JSONObject run(FlowInstrumentation f)throws Exception{return new ResearchWorkbenchPickerMainChecks(f).run();}
 JSONObject run()throws Exception{
  String namespace="business-restore-v85-f07-pickers-"+UUID.randomUUID();File cache=f.getTargetContext().getCacheDir().getCanonicalFile();dir=new File(cache,namespace);check(dir.mkdir()&&dir.getCanonicalFile().getParentFile().equals(cache),"owned current Main test namespace");String selected="F07 selected original 😀\n完整源数据",manual="original manual draft";File input=new File(dir,"selected.json");Files.write(input.toPath(),selected.getBytes(StandardCharsets.UTF_8));
  f.activity=(MainActivity)f.startActivitySync(new Intent(f.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).putExtra("businessRestoreV85",namespace).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));f.waitForIdleSync();
  try{
   ui(()->{check(f.activity.testing&&f.activity.feed==null,"actual Main testing mode without live feed");f.activity.openBusiness("research");});f.click("研究编排 / 整批导入");page=f.activity.researchWorkbenchScreen;active();ui(()->{((EditText)tag("f07BatchInput")).setText(manual);File quant=new File(dir,"quant-research-host-tests.json"),models=new File(quant+".model-results");check(!quant.exists()&&!models.exists(),"owned original quant path starts absent");JSONObject context=f.activity.researchWorkbenchInputs();check(context.getJSONArray("quantEntries").length()==0&&!quant.exists()&&!models.exists(),"Main reads absent existing model archive as explicit no-result without creating repository");});
   pausedResult(input,false);check(raw().equals(manual),"normal picker temporary遮挡 does not overwrite before resume");resumed();active();await(()->raw().equals(selected));check(f.activity.f07Pickers.size()==0,"normal resume delivers and consumes same-owner ticket");
   ui(()->{((EditText)tag("f07BatchInput")).setText(manual);});pausedResult(input,false);int stale=code;ui(()->f.activity.goHome());resumed();ui(()->f.activity.openResearchWorkbench());page=f.activity.researchWorkbenchScreen;active();ui(()->{f.activity.onActivityResult(stale,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input)));check(raw().equals(manual)&&f.activity.f07Pickers.size()==0,"leave then reopen does not restore old import authority");});
   File exported=new File(dir,"exported.json");reading(selected);pausedResult(exported,true);check(!exported.exists(),"export result before onResume does not open target");resumed();active();await(exported::isFile);check(Arrays.equals(Files.readAllBytes(exported.toPath()),selected.getBytes(StandardCharsets.UTF_8)),"normal same-owner export exact snapshot bytes");
   File oldExport=new File(dir,"old-export.json");reading(selected);pausedResult(oldExport,true);int oldCode=code;ui(()->f.activity.goHome());resumed();ui(()->f.activity.openResearchWorkbench());page=f.activity.researchWorkbenchScreen;active();ui(()->f.activity.onActivityResult(oldCode,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(oldExport))));check(!oldExport.exists(),"old export URI does not write after leave/reopen");
   tap("f07ReadBack");tap("f07BatchMode");ui(()->{MainActivity.F07Picker existing=new MainActivity.F07Picker(page,f.activity.f07Epoch,0,null);int request=f.activity.f07PickerNext++;f.activity.f07Pickers.put(request,existing);page.importRequested.run();check(f.activity.f07Pickers.get(request)==existing&&((TextView)tag("f07Status")).getText().toString().contains("未开始"),"second import rejection stays original-page status and preserves existing ticket");f.activity.revokeResearchWorkbenchPickers();});
   Instrumentation.ActivityMonitor failing=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_OPEN_DOCUMENT.equals(intent.getAction()))throw new ActivityNotFoundException("owned picker launch failure");return null;}};f.addMonitor(failing);try{tap("f07Import");ui(()->check(f.activity.f07Pickers.size()==0&&((TextView)tag("f07Status")).getText().toString().contains("未开始"),"import launch failure cannot escape button and revokes new ticket"));}finally{f.removeMonitor(failing);}
   pausedResult(input,false);int orphan=code;ResearchWorkbenchScreen old=page;final Bundle saved=new Bundle();final int[] savedParcelBytes={-1};ui(()->{f.activity.onSaveInstanceState(saved);Parcel parcel=Parcel.obtain();try{saved.writeToParcel(parcel,0);savedParcelBytes[0]=parcel.dataSize();check(savedParcelBytes[0]>0,"actual saved Bundle Parcel measured");}finally{parcel.recycle();}check(!saved.containsKey("f07ImportPending")&&!saved.containsKey("f07PickerOwner")&&!saved.containsKey("f07Pickers"),"actual Bundle contains no pending F07 authority");});Instrumentation.ActivityMonitor renewal=f.addMonitor(MainActivity.class.getName(),null,false);ui(()->f.activity.recreate());Activity rebuilt=renewal.waitForActivityWithTimeout(20000);f.removeMonitor(renewal);check(rebuilt instanceof MainActivity,"actual Main recreated while picker result pending");f.activity=(MainActivity)rebuilt;f.waitForIdleSync();page=f.activity.researchWorkbenchScreen;active();ui(()->{String before=raw();f.activity.onActivityResult(orphan,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input)));check(page!=old&&f.activity.f07Pickers.size()==0&&raw().equals(before)&&f.activity.f07PickerNext>orphan,"recreated Main neither restores old ticket nor reuses request number");});
   JSONObject report=new JSONObject().put("passed",true).put("checks",evidence).put("actualMain",true).put("controlledLifecycleCallbacks",true).put("deterministicReturnBeforeResume",true).put("pickerCheckpoints",pickerStates).put("genuineRecreation",true).put("savedInstanceStateParcelBytes",savedParcelBytes[0]).put("page7Rerun",false).put("modelSource14Rerun",false).put("network",false).put("manualPickerAcceptance",false).put("namespace",namespace);Files.write(new File(dir,"f07-picker-main.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));return report;
  }finally{f.ui(()->f.activity.finish());}
 }
}
