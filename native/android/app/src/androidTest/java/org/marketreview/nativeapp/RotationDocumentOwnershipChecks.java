package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Append after RotationSamplingActualMainChecks.run; never repeats its core cases. */
final class RotationDocumentOwnershipChecks {
 interface Work{void run()throws Exception;}
 static void ui(FlowInstrumentation f,Work work){f.ui(()->{try{work.run();}catch(Exception e){throw new RuntimeException(e);}});}
 static int ticket(RotationScreen p)throws Exception{Field v=RotationScreen.class.getDeclaredField("pendingDocumentTicket");v.setAccessible(true);return v.getInt(p);}
 static void idle(FlowInstrumentation f)throws Exception {
  long until=SystemClock.elapsedRealtime()+10000;boolean[] ready={false};
  while(SystemClock.elapsedRealtime()<until){ui(f,()->{RotationScreen p=f.activity.rotationScreen;ready[0]=p!=null&&(p.job==null||p.job.isDone())&&p.snapshots.length()>0;});if(ready[0])return;Thread.sleep(30);}
  final String[] detail={""};ui(f,()->{RotationScreen p=f.activity.rotationScreen;detail[0]=p==null?"no screen":("shown="+p.isShown()+" active="+p.samplingActive+" generation="+p.generation+" date="+p.date.getText()+" snapshots="+p.snapshots.length()+" job="+(p.job==null?"null":p.job.isDone()+"/cancelled:"+p.job.isCancelled())+" state="+p.state.getText());});
  throw new AssertionError("rotation history did not settle: "+detail[0]);
 }
 static Button button(FlowInstrumentation f,String label){Button b=f.find(f.activity.rotationScreen,label);f.check(b!=null,"real control "+label);return b;}
 static void tap(FlowInstrumentation f,String label){
  final Button[] b={null};ui(f,()->{b[0]=button(f,label);b[0].requestRectangleOnScreen(new android.graphics.Rect(0,0,b[0].getWidth(),b[0].getHeight()),true);});
  ui(f,()->{android.graphics.Rect r=new android.graphics.Rect();f.check(b[0].isShown()&&b[0].isEnabled()&&b[0].getGlobalVisibleRect(r)&&r.height()>0,"reachable control "+label);b[0].performClick();});
 }
 static byte[] bytes(Context c,Uri uri)throws Exception {
  try(InputStream in=c.getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(out.size()+n>1024*1024)throw new IOException("ownership fixture exceeds 1MiB");out.write(buf,0,n);}return out.toByteArray();
  }
 }
 static IntentFilter filter(String action)throws Exception{IntentFilter f=new IntentFilter(action);f.addCategory(Intent.CATEGORY_OPENABLE);f.addDataType("*/*");return f;}
 static String history(RotationScreen p)throws Exception{return DarkRotation.canonical(new JSONObject().put("industry",p.store.read("2026-10-13","industry",false)).put("concept",p.store.read("2026-10-13","concept",false)));}
 static void run(FlowInstrumentation f)throws Exception {
  Throwable failure=null;int[] oldTicket={-1},newTicket={-1};Uri output=null;byte[] exported=null;
  // Null result + blocking monitor holds the request without launching UI or auto-delivering cancellation.
  Instrumentation.ActivityMonitor open=f.addMonitor(filter(Intent.ACTION_OPEN_DOCUMENT),null,true);
  Instrumentation.ActivityMonitor create=f.addMonitor(filter(Intent.ACTION_CREATE_DOCUMENT),null,true);
  try {
   ui(f,()->{f.check(f.activity.testing,"fixture Main only");f.activity.rotation();});idle(f);
   RotationScreen old=f.activity.rotationScreen;
   final Button[] hidden=new Button[3];final long[] generation={0};final String[] attempts={""},draft={""};
   String before=history(old);
   ui(f,()->{hidden[0]=button(f,"更新");hidden[1]=button(f,"导入");hidden[2]=button(f,"导出");
    f.activity.goHome();generation[0]=old.generation;attempts[0]=old.attempts.toString();draft[0]=old.pendingExport==null?"":old.pendingExport.toString();
    for(Button b:hidden)b.performClick();
    f.check(!old.isShown()&&f.activity.rotationScreen==old,"hidden actions cannot reopen or replace screen");
    f.check(old.generation==generation[0]&&old.attempts.toString().equals(attempts[0])&&old.scan==null,"hidden refresh causes no request/attempt mutation");
    f.check((old.pendingExport==null?"":old.pendingExport.toString()).equals(draft[0]),"hidden export cannot overwrite captured range");
   });
   f.check(open.getHits()==0&&create.getHits()==0,"hidden import/export launch no picker");
   f.check(before.equals(history(old)),"hidden controls preserve SQLite history");

   ui(f,()->f.activity.rotation());idle(f);tap(f,"导入");
   ui(f,()->{oldTicket[0]=ticket(old);f.check(oldTicket[0]>=62000,"visible picker grants distinct ticket");f.activity.goHome();f.check(ticket(old)<0,"actual navigation revokes old ticket");});
   f.check(open.getHits()==1,"actual import request intercepted");
   SourceHistoryChecks.recreateActivity(f);
   ui(f,()->f.activity.rotation());idle(f);
   RotationScreen current=f.activity.rotationScreen;
   f.check(current!=old,"actual Main recreation replaced owner");
   f.shot("rotation-restored-reader");
   tap(f,"导出");
   ui(f,()->{newTicket[0]=ticket(current);f.check(newTicket[0]>=62000&&newTicket[0]!=oldTicket[0],"new owner never reuses prior saved ticket");generation[0]=current.generation;draft[0]=current.pendingExport.toString();});
   f.check(create.getHits()==1,"new owner has one actual export authorization");

   ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,"rotation-owner-"+UUID.randomUUID()+".jsonl");values.put(MediaStore.Downloads.MIME_TYPE,"application/json");
   output=f.getTargetContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);f.check(output!=null,"owned Downloads target");
   try(OutputStream empty=f.getTargetContext().getContentResolver().openOutputStream(output,"w")){f.check(empty!=null,"empty target materialized");}
   final Uri target=output;
   ui(f,()->{
    Intent data=new Intent().setData(target);
    f.activity.onActivityResult(oldTicket[0],Activity.RESULT_OK,data);
    f.activity.onActivityResult(oldTicket[0],Activity.RESULT_CANCELED,null);
    f.activity.onActivityResult(406,Activity.RESULT_OK,data);
    f.activity.onActivityResult(407,Activity.RESULT_OK,data);
    old.document(newTicket[0],target);current.document(oldTicket[0],target);
    f.check(f.activity.rotationScreen==current&&current.isShown(),"late callbacks do not navigate/rebind owner");
    f.check(ticket(current)==newTicket[0]&&current.pendingExport.toString().equals(draft[0]),"late result/cancel cannot consume new ticket or range");
    f.check(current.generation==generation[0],"late callback submits no document work");
   });
   f.check(bytes(f.getTargetContext(),output).length==0,"late callback writes no provider bytes");
   f.check(before.equals(history(current)),"late callback changes no SQLite history");

   // Proper current ticket still works; delayed/duplicate old results did not poison normal manual export.
   ui(f,()->{
    f.callActivityOnPause(f.activity);f.activity.getWindow().getDecorView().setVisibility(View.INVISIBLE);
    f.check(ticket(current)==newTicket[0],"picker pause/window occlusion preserves original ticket");
    generation[0]=current.generation;
    f.activity.onActivityResult(newTicket[0],Activity.RESULT_OK,new Intent().setData(target));
    f.check(ticket(current)==newTicket[0]&&current.generation==generation[0],"paused result waits without consuming authorization");
    f.activity.getWindow().getDecorView().setVisibility(View.VISIBLE);f.callActivityOnResume(f.activity);
   });idle(f);
   long until=SystemClock.elapsedRealtime()+8000;boolean[] done={false};
   while(SystemClock.elapsedRealtime()<until){ui(f,()->done[0]=current.state.getText().toString().startsWith("已导出"));if(done[0])break;Thread.sleep(30);}
   f.check(done[0],"authorized real provider export completed");exported=bytes(f.getTargetContext(),output);f.check(exported.length>0,"real exported bytes exist");
   final long[] afterExport={0};ui(f,()->{f.check(ticket(current)<0,"successful ticket consumed once");afterExport[0]=current.generation;f.activity.onActivityResult(newTicket[0],Activity.RESULT_OK,new Intent().setData(target));f.check(current.generation==afterExport[0],"duplicate result submits no work");});
   f.check(Arrays.equals(exported,bytes(f.getTargetContext(),output)),"duplicate result preserves exported bytes");

   tap(f,"导入");
   ui(f,()->{int accepted=ticket(current);f.activity.onActivityResult(accepted,Activity.RESULT_CANCELED,null);f.check(ticket(current)<0,"matching cancellation consumes only its ticket");});
   tap(f,"导入");
   ui(f,()->{int accepted=ticket(current);afterExport[0]=current.generation;f.activity.onActivityResult(accepted,Activity.RESULT_OK,new Intent().setData(target));f.check(ticket(current)<0&&current.generation>afterExport[0],"authorized manual import entered original worker");});
   idle(f);f.check(before.equals(history(current)),"duplicate manual import preserves exact existing history");
   f.check(Arrays.equals(exported,bytes(f.getTargetContext(),output)),"manual import reads source without changing it");
   f.shot("rotation-owned-import-reader");
  }catch(Throwable error){failure=error;if(error instanceof Exception)throw (Exception)error;throw new AssertionError(error);}
  finally{
   f.removeMonitor(open);f.removeMonitor(create);
   JSONObject report=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN_OWNERSHIP":"FAIL_ACTUAL_MAIN_OWNERSHIP")
    .put("oldTicket",oldTicket[0]).put("newTicket",newTicket[0]).put("openPickerHits",open.getHits()).put("createPickerHits",create.getHits())
    .put("scope","actual Main callback + controls + owned Downloads; picker intercepted and pause/window occlusion simulated, not manual SAF UI")
    .put("hiddenRefreshLimit","testing network gate also remains active; production ordering additionally checked in source diff");
   if(output!=null)report.put("ownedOutput",output.toString());if(exported!=null)report.put("exportedBytes",exported.length);
   if(failure!=null)report.put("exception",failure.toString());
   File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);if(!dir.isDirectory())dir.mkdirs();
   Files.write(new File(dir,"rotation-document-ownership-v49.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));
  }
 }
}
