package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** One actual Main flow; testFixtures only, no model training or online provider. */
final class QuantModelMainChecks {
 interface Work{void run()throws Exception;}
 final FlowInstrumentation f;final JSONArray evidence=new JSONArray();QuantResearchScreen page;File dir;QuantResearchStore store;QuantModelArchive archive;
 QuantModelMainChecks(FlowInstrumentation flow){f=flow;}
 void ui(Work work){f.ui(()->{try{work.run();}catch(Exception error){throw new RuntimeException(error);}});}
 void need(boolean ok,String message)throws Exception{f.check(ok,message);evidence.put(message);}
 @SuppressWarnings("unchecked") static <T>T field(Object object,String name)throws Exception{Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);return (T)field.get(object);}
 static byte[] asset(FlowInstrumentation f,String name)throws Exception{try(InputStream in=f.getContext().getAssets().open(name)){return in.readAllBytes();}}
 static byte[] optional(File path)throws Exception{return path.isFile()?Files.readAllBytes(path.toPath()):null;}
 static Button button(View root,String label){return QuantModelUiChecks.button(root,label);}
 void tap(String label){ui(()->{Button b=button(page,label);need(b!=null&&b.isShown()&&b.isEnabled()&&page.hasWindowFocus(),"actual foreground button "+label);b.requestRectangleOnScreen(new Rect(0,0,b.getWidth(),b.getHeight()),true);});ui(()->{Button b=button(page,label);Rect r=new Rect();need(b.getGlobalVisibleRect(r)&&r.width()>0&&r.height()>0,"visible touch region "+label);b.performClick();});}
 void picker(String action,String label,File path)throws Exception{
  IntentFilter filter=new IntentFilter(action);filter.addCategory(Intent.CATEGORY_OPENABLE);filter.addDataType("application/json");
  Instrumentation.ActivityMonitor monitor=f.addMonitor(filter,new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(Uri.fromFile(path))),true);
  try{tap(label);long end=SystemClock.elapsedRealtime()+5000;while(monitor.getHits()==0&&SystemClock.elapsedRealtime()<end){Thread.sleep(30);f.waitForIdleSync();}need(monitor.getHits()==1,"actual Main picker launch/result "+action);f.waitForIdleSync();page=f.activity.quantResearchScreen;need(page!=null&&page.isShown(),"actual original quant page after file result");}finally{f.removeMonitor(monitor);}
 }
 void history(String id)throws Exception{tap("模型结果");waitFocus(true);ui(()->{AlertDialog dialog=field(page,"modelHistoryDialog");need(dialog!=null&&dialog.isShowing()&&dialog.getWindow().getDecorView().hasWindowFocus(),"actual foreground model history dialog");ListView list=dialog.getListView();int index=-1;for(int i=0;i<list.getAdapter().getCount();i++)if(id.equals(list.getAdapter().getItem(i).toString()))index=i;need(index>=0,"exact model identity in history");list.performItemClick(list.getAdapter().getView(index,null,list),index,list.getAdapter().getItemId(index));});waitFocus(false);}
 JSONObject full(String expectedRaw)throws Exception{
  while(((Integer)field(page,"readerOffset"))>0)tap("上一段");StringBuilder text=new StringBuilder();int parts=0,total=((String)field(page,"readerText")).codePointCount(0,((String)field(page,"readerText")).length());
  do{final String[] segment={null};ui(()->segment[0]=((TextView)page.findViewWithTag("quantOriginal")).getText().toString());text.append(segment[0]);need(++parts<=256,"bounded complete original reader");if(text.codePointCount(0,text.length())>=total)break;tap("下一段");}while(true);
  JSONObject shown=new JSONObject(text.toString()),expected=QuantModelResult.summary(QuantModelResult.verify(expectedRaw));need(QuantModelResult.equal(shown,expected),"all displayed segments equal full verified result");need(shown.has("originalRequest")&&shown.has("originalDatasetManifest")&&shown.getJSONArray("files").length()==expected.getJSONArray("files").length(),"reader retains original request/manifest and every attachment identity");return new JSONObject().put("segments",parts).put("characters",text.length()).put("fullEquality",true);
 }
 JSONObject shortBundle()throws Exception{final JSONObject[] result={null};ui(()->{Bundle saved=new Bundle();f.activity.onSaveInstanceState(saved);Bundle quant=saved.getBundle("quantResearchState");need(quant!=null&&quant.size()==2&&quant.containsKey("quantResearchViewFile")&&quant.containsKey("quantResearchViewFingerprint"),"actual Main quant state uses two short side-file markers");Parcel parcel=Parcel.obtain();try{parcel.writeBundle(saved);String data=new String(parcel.marshall(),StandardCharsets.UTF_16LE);need(parcel.dataSize()<65536&&!data.contains("webstock.quant.native-result.v1"),"actual Main Bundle below64KiB and contains no full result");result[0]=new JSONObject().put("bytes",parcel.dataSize()).put("maxBytes",65536).put("actualOnSaveInstanceState",true).put("fullResultInBundle",false);}finally{parcel.recycle();}});return result[0];}
 JSONObject geometry(int orientation)throws Exception{final JSONObject[] result={null};ui(()->{need(f.activity.getResources().getConfiguration().orientation==orientation,"actual quant orientation "+orientation);TextView reader=(TextView)page.findViewWithTag("quantOriginal");Rect r=new Rect();int floor=Math.round(80*f.activity.getResources().getDisplayMetrics().density);need(reader.isShown()&&reader.getGlobalVisibleRect(r)&&r.height()>=floor,"actual result viewport at least80dp orientation="+orientation+" height="+r.height()+" minimum="+floor);result[0]=new JSONObject().put("orientation",orientation).put("visibleHeightPx",r.height()).put("minimumPx",floor);});return result[0];}
 static JSONObject run(FlowInstrumentation f)throws Exception{return run(f,false);}
 static JSONObject run(FlowInstrumentation f,boolean remaining)throws Exception{return new QuantModelMainChecks(f).run(remaining);}
 static JSONObject runLandscape(FlowInstrumentation f)throws Exception{return new QuantModelMainChecks(f).run(true,true);}
 void waitFocus(boolean dialogExpected)throws Exception{long end=SystemClock.elapsedRealtime()+5000;final boolean[] ready={false};final String[] observed={""};do{ui(()->{AlertDialog d=field(page,"modelHistoryDialog");boolean shown=d!=null&&d.isShowing(),focus=shown&&d.getWindow()!=null&&d.getWindow().getDecorView().hasWindowFocus();observed[0]="dialog="+shown+",dialogFocus="+focus+",pageFocus="+page.hasWindowFocus();ready[0]=dialogExpected?focus:page.hasWindowFocus();});if(ready[0])break;Thread.sleep(40);}while(SystemClock.elapsedRealtime()<end);need(ready[0],"actual window focus ready expectedDialog="+dialogExpected+" "+observed[0]);}
 JSONObject run(boolean remaining)throws Exception{return run(remaining,false);}
 JSONObject run(boolean remaining,boolean landscapeOnly)throws Exception{
  String namespace="f06-main-"+UUID.randomUUID();dir=new File(f.getTargetContext().getCacheDir(),namespace);need(dir.mkdir(),"new owned F06 output directory");byte[] experiment=asset(f,"f06-experiment-native-result.json"),watchlist=asset(f,"f06-watchlist-native-result.json");String first=new String(experiment,StandardCharsets.UTF_8),second=new String(watchlist,StandardCharsets.UTF_8);String firstId=QuantModelResult.verify(first).getString("id"),secondId=QuantModelResult.verify(second).getString("id");File input=new File(dir,"experiment.json");Files.write(input.toPath(),experiment);
  f.activity=(MainActivity)f.startActivitySync(new Intent(f.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));f.waitForIdleSync();
  try{
   ui(()->{need(f.activity.testing&&f.activity.feed==null,"actual Main isolated fixture mode without live feed");f.activity.openBusiness("research");});ui(()->{View entry=f.activity.getWindow().getDecorView().findViewWithTag("openQuantResearch");need(entry instanceof Button&&entry.isShown(),"original Main quant entry");entry.requestRectangleOnScreen(new Rect(0,0,entry.getWidth(),entry.getHeight()),true);entry.performClick();});page=f.activity.quantResearchScreen;need(page!=null&&page.isAttachedToWindow()&&page.isShown(),"original Main owns attached quant page");store=field(page,"store");need(store.filePath().getCanonicalFile().equals(new File(f.activity.getFilesDir(),"quant-research-host-tests.json").getCanonicalFile()),"actual Main uses test quant store only");archive=new QuantModelArchive(store.filePath());byte[] originalStore=optional(store.filePath());JSONObject originalRecords=store.read();int originalModels=archive.list().size();
   JSONObject firstRead;
   waitFocus(false);
   if(!remaining){
   picker(Intent.ACTION_OPEN_DOCUMENT,"导入",input);ui(()->need(first.equals(field(page,"modelPending")),"actual Main file result forms full pending preview"));need(archive.list().size()==originalModels,"Main preview does not save model archive");tap("取消预览");need(archive.list().size()==originalModels,"Main cancelled preview does not write");picker(Intent.ACTION_OPEN_DOCUMENT,"导入",input);tap("确认导入");need(archive.read(firstId).equals(first),"Main confirmed import retains exact Windows bytes");firstRead=full(first);history(firstId);need(firstId.equals(field(page,"selectedModelId")),"actual history callback selects exact model");
   File output=new File(dir,"export.json");picker(Intent.ACTION_CREATE_DOCUMENT,"导出模型结果",output);need(Arrays.equals(experiment,Files.readAllBytes(output.toPath())),"actual Main export picker/result preserves complete original bytes");need(((String)field(f.activity,"reviewExportFile")).isEmpty(),"actual Main consumes short export reference");
   }else{need(archive.read(firstId).equals(first),"resume retains exact previously imported experiment");firstRead=new JSONObject().put("priorEvidenceLog","f06-android-host-first.txt").put("filePhaseNotRerun",true);}
   final JSONObject[] callbackReport={null};
   if(!landscapeOnly){final QuantModelUiChecks[] reused={null};ui(()->reused[0]=new QuantModelUiChecks(page));QuantModelUiChecks callbacks=reused[0];ui(callbacks::openHistoryAfterMountAndIdle);waitFocus(true);ui(callbacks::captureHideAndReplayAfterDialogIdle);waitFocus(false);ui(callbacks::replayAfterReshowAndIdle);ui(()->callbacks.previewSecondThenHide(second));waitFocus(false);ui(()->callbackReport[0]=callbacks.normalFileReturnAfterReshowAndIdle(second));ui(callbacks::restoreExportHandler);need(archive.read(secondId).equals(second),"reused actual Main hidden callback cases preserve normal confirm");}
   else{need(archive.read(secondId).equals(second),"landscape resume preserves exact archived watchlist");callbackReport[0]=new JSONObject().put("priorEvidenceLog","f06-android-host-remaining.txt").put("callbacksAndPortraitNotRerun",true);}
   JSONArray rebuilds=new JSONArray();f.shotFolder="f06-main-"+namespace;
   for(int orientation:landscapeOnly?new int[]{ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE}:new int[]{ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE}){
    ui(()->f.activity.setRequestedOrientation(orientation));Thread.sleep(500);f.waitForIdleSync();page=f.activity.quantResearchScreen;history(secondId);JSONObject beforeRead=full(second),beforeBundle=shortBundle();f.shot("before-recreate-"+orientation);geometry(orientation==ActivityInfo.SCREEN_ORIENTATION_PORTRAIT?Configuration.ORIENTATION_PORTRAIT:Configuration.ORIENTATION_LANDSCAPE);QuantResearchScreen old=page;Button oldExport=button(old,"导出模型结果");
    Instrumentation.ActivityMonitor monitor=f.addMonitor(MainActivity.class.getName(),null,false);ui(()->f.activity.recreate());Activity renewed=monitor.waitForActivityWithTimeout(20000);f.removeMonitor(monitor);need(renewed instanceof MainActivity,"genuine Main recreation orientation="+orientation);f.activity=(MainActivity)renewed;f.waitForIdleSync();page=f.activity.quantResearchScreen;need(page!=null&&page!=old&&page.isShown()&&page.isAttachedToWindow(),"genuine recreation restored current quant owner");String exportMarker=field(f.activity,"reviewExportFile");ui(oldExport::performClick);need(exportMarker.equals(field(f.activity,"reviewExportFile")),"detached old Main export button ignored");need(secondId.equals(field(page,"selectedModelId")),"genuine recreation restores verified result identity");JSONObject afterRead=full(second),afterBundle=shortBundle(),size=geometry(orientation==ActivityInfo.SCREEN_ORIENTATION_PORTRAIT?Configuration.ORIENTATION_PORTRAIT:Configuration.ORIENTATION_LANDSCAPE);rebuilds.put(new JSONObject().put("orientation",orientation).put("before",beforeRead).put("after",afterRead).put("bundleBefore",beforeBundle).put("bundleAfter",afterBundle).put("geometry",size));f.shot(orientation==ActivityInfo.SCREEN_ORIENTATION_PORTRAIT?"recreated-portrait":"recreated-landscape");
   }
   need(QuantModelResult.equal(originalRecords,store.read())&&Arrays.equals(originalStore,optional(store.filePath())),"original five-strategy quant store preserved throughout Main flow");JSONObject report=new JSONObject().put("passed",true).put("namespace",namespace).put("checks",evidence).put("firstFullRead",firstRead).put("callbacks",callbackReport[0]).put("rebuilds",rebuilds).put("actualMain",true).put("pickerIntercepted",true).put("manualPickerAcceptance",false).put("modelTraining",false).put("network",false);Files.write(new File(dir,"f06-main-check.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));return report;
  }finally{f.ui(()->f.activity.finish());}
 }
}
