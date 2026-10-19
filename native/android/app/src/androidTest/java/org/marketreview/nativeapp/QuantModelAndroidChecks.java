package org.marketreview.nativeapp;
import android.app.Activity;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

/** Root invokes on its Activity UI thread with the actual Windows-produced bundle. No training or network. */
public final class QuantModelAndroidChecks {
 interface Work{void run()throws Exception;}
 static void need(boolean value,String message){if(!value)throw new AssertionError(message);}
 static void reject(Work work)throws Exception{boolean rejected=false;try{work.run();}catch(Exception error){rejected=true;}need(rejected,"Expected integrity/conflict rejection");}
 static Button button(View view,String label){if(view instanceof Button&&((Button)view).getText().toString().equals(label))return (Button)view;if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){Button result=button(group.getChildAt(i),label);if(result!=null)return result;}}return null;}
 public static JSONObject run(Activity activity,String actualBundle)throws Exception{
  need(android.os.Looper.myLooper()==android.os.Looper.getMainLooper(),"UI thread required");int checks=0;
  JSONObject result=QuantModelResult.verify(actualBundle);String id=result.getString("id");String name="f06-model-check-"+UUID.randomUUID()+".json";
  QuantResearchStore store=new QuantResearchStore(activity,name);QuantModelArchive archive=new QuantModelArchive(store.filePath());QuantResearchScreen page=new QuantResearchScreen(activity,store,JSONArray::new,original->{});
  page.previewImport(actualBundle);need(archive.list().isEmpty(),"Preview wrote archive");checks++;page.cancelImport();need(archive.list().isEmpty(),"Cancelled preview wrote archive");checks++;
  page.previewImport(actualBundle);page.confirmImport();need(archive.list().size()==1&&archive.read(id).equals(actualBundle),"Original result bytes not retained");checks++;
  page.previewImport(actualBundle);page.confirmImport();need(archive.list().size()==1,"Duplicate result created another record");checks++;
  String conflict=new JSONObject(actualBundle).put("createdAt","2099-01-01T00:00:00Z").toString();reject(()->archive.save(conflict));need(archive.read(id).equals(actualBundle),"Conflict overwrote original");checks++;
  QuantResearchScreen reopened=new QuantResearchScreen(activity,new QuantResearchStore(activity,name),JSONArray::new,original->{});reopened.openModelResult(id);TextView reader=(TextView)reopened.findViewWithTag("quantOriginal");need(reader!=null&&reader.getText().length()>0,"Original-page result reader empty");checks++;
  AtomicReference<String> exported=new AtomicReference<>();reopened.exportRequested=exported::set;Button export=button(reopened,"导出模型结果");need(export!=null,"Model result export entry missing");export.performClick();need(actualBundle.equals(exported.get()),"Re-export changed full bundle");checks++;
  reopened.saveState();QuantResearchScreen restored=new QuantResearchScreen(activity,new QuantResearchStore(activity,name),JSONArray::new,original->{});restored.exportRequested=exported::set;exported.set(null);button(restored,"导出模型结果").performClick();need(actualBundle.equals(exported.get()),"Recreated page lost verified model identity/export");checks++;
  JSONObject missing=new JSONObject(actualBundle);missing.getJSONArray("files").remove(0);reject(()->reopened.previewImport(missing.toString()));checks++;
  JSONObject changed=new JSONObject(actualBundle);changed.getJSONArray("steps").getJSONObject(0).getJSONObject("result").put("asOf","2099-01-01");reject(()->QuantModelResult.verify(changed.toString()));checks++;
  for(boolean dark:new boolean[]{false,true}){reopened.setDarkTheme(dark);reopened.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(540,View.MeasureSpec.EXACTLY));reopened.layout(0,0,960,540);need(reader.getMeasuredHeight()>0,"Result reader lost layout");checks++;}
  need(store.read().getJSONArray("records").length()==0,"Model archive overwrote five-strategy research store");checks++;
  return new JSONObject().put("checks",checks).put("originalQuantScreen",true).put("androidOfflineVerification",true).put("androidTraining",false).put("network",false).put("isolatedStore",name);
 }
}
