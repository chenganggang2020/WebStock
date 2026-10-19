package org.marketreview.nativeapp;
import android.app.*;
import android.view.*;
import android.widget.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;

/** Root runs these phases on an isolated Activity UI thread, waiting for idle between phases. */
public final class QuantModelUiChecks {
 static void need(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 static Button button(View v,String label){if(v instanceof Button&&((Button)v).getText().toString().equals(label))return (Button)v;if(v instanceof ViewGroup){ViewGroup group=(ViewGroup)v;for(int i=0;i<group.getChildCount();i++){Button found=button(group.getChildAt(i),label);if(found!=null)return found;}}return null;}
 public final FrameLayout root;public final QuantResearchScreen page;
 final QuantModelArchive archive;final AtomicInteger exports=new AtomicInteger();final JSONArray outcomes=new JSONArray();
 java.util.function.Consumer<String> originalExport;AdapterView.OnItemClickListener retained;ListView oldList;String before;
 public QuantModelUiChecks(Activity activity,String actualBundle)throws Exception{
  need(android.os.Looper.myLooper()==android.os.Looper.getMainLooper(),"UI thread required");QuantResearchStore store=new QuantResearchStore(activity,"f06-ui-review-"+UUID.randomUUID()+".json");archive=new QuantModelArchive(store.filePath());
  page=new QuantResearchScreen(activity,store,JSONArray::new,record->{});page.exportRequested=raw->exports.incrementAndGet();page.previewImport(actualBundle);page.confirmImport();root=new FrameLayout(activity);root.addView(page,new FrameLayout.LayoutParams(-1,-1));
 }
 public QuantModelUiChecks(QuantResearchScreen current)throws Exception{page=current;Field field=QuantResearchScreen.class.getDeclaredField("store");field.setAccessible(true);archive=new QuantModelArchive(((QuantResearchStore)field.get(page)).filePath());root=null;originalExport=page.exportRequested;page.exportRequested=raw->{exports.incrementAndGet();if(originalExport!=null)originalExport.accept(raw);};}
 public void restoreExportHandler(){page.exportRequested=originalExport;}
 void pass(String name)throws Exception{outcomes.put(new JSONObject().put("name",name).put("passed",true));}
 public void openHistoryAfterMountAndIdle()throws Exception{need(page.isShown()&&page.isAttachedToWindow()&&page.hasWindowFocus(),"Mount root in test Activity and wait for idle");button(page,"模型结果").performClick();}
 public void captureHideAndReplayAfterDialogIdle()throws Exception{
  Field field=QuantResearchScreen.class.getDeclaredField("modelHistoryDialog");field.setAccessible(true);AlertDialog dialog=(AlertDialog)field.get(page);need(dialog!=null&&dialog.getWindow().getDecorView().hasWindowFocus(),"Dialog must be actual foreground before replay");oldList=dialog.getListView();retained=oldList.getOnItemClickListener();need(retained!=null,"Actual dialog callback missing");
  TextView reader=(TextView)page.findViewWithTag("quantOriginal");reader.setText("retained-reader-sentinel");before=reader.getText().toString();page.setVisibility(View.GONE);need(!dialog.isShowing(),"Hidden owner retained dialog");pass("hidden-owner-dismisses-history-dialog");
  retained.onItemClick(oldList,null,0,oldList.getAdapter().getItemId(0));need(before.equals(reader.getText().toString()),"Hidden old dialog callback changed page");pass("hidden-history-callback-ignored");button(page,"导出模型结果").performClick();need(exports.get()==0,"Hidden old export ran");pass("hidden-export-ignored");page.setVisibility(View.VISIBLE);
 }
 public void replayAfterReshowAndIdle()throws Exception{retained.onItemClick(oldList,null,0,oldList.getAdapter().getItemId(0));need(before.equals(((TextView)page.findViewWithTag("quantOriginal")).getText().toString()),"Old callback regained authority after show");pass("old-dialog-after-hide-show-ignored");}
 public void previewSecondThenHide(String secondActualBundle)throws Exception{need(page.hasWindowFocus(),"Return owner to foreground first");page.previewImport(secondActualBundle);int count=archive.list().size();page.setVisibility(View.GONE);button(page,"确认导入").performClick();need(archive.list().size()==count,"Hidden confirm wrote archive");pass("hidden-confirm-ignored");page.setVisibility(View.VISIBLE);}
 public JSONObject normalFileReturnAfterReshowAndIdle(String secondActualBundle)throws Exception{need(page.hasWindowFocus(),"Wait for foreground idle");page.previewImport(secondActualBundle);button(page,"确认导入").performClick();String id=QuantModelResult.verify(secondActualBundle).getString("id");need(archive.read(id).equals(secondActualBundle),"Normal explicit file return/confirm failed");pass("normal-file-return-confirm-retains-bytes");return new JSONObject().put("checks",outcomes.length()).put("outcomes",outcomes).put("actualAndroidPage",true).put("modelTraining",false).put("network",false);}
}
