package org.marketreview.nativeapp;
import android.graphics.Rect;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
/** Root-only read-only geometry inspection on a real, attached, laid-out HostScreen.
 * Compiled in staging, NOT device-run here. Never put this class in production sources. */
public final class UnifiedBackupCompactUiChecks {
 static void need(boolean ok,String why)throws Exception{if(!ok)throw new Exception(why);}
 static void collect(View v,List<View>all){all.add(v);if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++)collect(g.getChildAt(i),all);}}
 public static JSONObject inspect(UnifiedBackupHostScreen screen)throws Exception{
  need(Looper.myLooper()==Looper.getMainLooper(),"inspect on main Looper after layout");need(screen.isAttachedToWindow()&&screen.isShown()&&screen.getWidth()>0&&screen.getHeight()>0,"real laid-out visible screen required");
  List<View>all=new ArrayList<>();collect(screen,all);int scrolls=0;Map<String,Integer>tags=new HashMap<>();for(View v:all){if(v instanceof ScrollView)scrolls++;if(v.getTag() instanceof String)tags.merge((String)v.getTag(),1,Integer::sum);}
  need(scrolls==1,"one shared content ScrollView");String[] original={"unifiedBackupHostScreen","unifiedBackupScreen","hostBackupDetails","backupDetails","exportBackup","openBackup","previewBackup","cancelBackup","beginBackup","nextBackup","stopBackup","readReceipt","ackBackup","previousPreviewText","nextPreviewText","saveBackupNew","discardBackupExport","inspectOldReceipt","cancelBackupTask"};for(String tag:original)need(tags.getOrDefault(tag,0)==1,"original tag missing or duplicated: "+tag);
  JSONArray domains=screen.host.coordinator.catalog();for(int i=0;i<domains.length();i++){String id=domains.getJSONObject(i).getString("id");need(tags.getOrDefault(id,0)==1,"domain checkbox missing or duplicated: "+id);}
  float density=screen.getResources().getDisplayMetrics().density;need(screen.contentScroll.getHeight()>0,"body viewport remains scrollable");JSONArray buttons=new JSONArray();int actionRows=0;
  // Paging is reparented with the dock, so resolve it from the Host tree.
  for(View row:new View[]{screen.page.primaryActions,screen.findViewWithTag("backupPaging"),screen.hostActions}){
   need(row!=null,"dock row missing");if(!row.isShown())continue;actionRows++;int visible=0;ViewGroup g=(ViewGroup)row;
   for(int i=0;i<g.getChildCount();i++){View v=g.getChildAt(i);if(!(v instanceof Button)||!v.isShown())continue;visible++;Button button=(Button)v;Rect rect=new Rect();need(button.getGlobalVisibleRect(rect)&&rect.width()==button.getWidth()&&rect.height()==button.getHeight(),"dock button clipped: "+button.getTag());need(button.getHeight()+1>=48*density,"touch height below 48dp: "+button.getTag());need(button.getWidth()>=96*density,"dock button too narrow: "+button.getTag());if(button.getLayout()!=null){for(int line=0;line<button.getLineCount();line++)need(button.getLayout().getEllipsisCount(line)==0,"dock label ellipsized");need(button.getLayout().getHeight()+button.getCompoundPaddingTop()+button.getCompoundPaddingBottom()<=button.getHeight(),"dock label vertically clipped");}buttons.put(new JSONObject().put("tag",button.getTag()).put("enabled",button.isEnabled()).put("widthDp",button.getWidth()/density).put("heightDp",button.getHeight()/density));}
   need(visible<=2,"more than two dock actions in one row");
  }
  need(actionRows<=2,"dock exceeds two rows");need(screen.page.details.getMaxLines()==Integer.MAX_VALUE&&screen.details.getMaxLines()==Integer.MAX_VALUE,"body text capped by line count");
  return new JSONObject().put("status","PASS_GEOMETRY").put("stage",screen.page.stage.getText()).put("viewportHeightDp",screen.contentScroll.getHeight()/density).put("viewportWidthDp",screen.contentScroll.getWidth()/density).put("dockRows",actionRows).put("buttons",buttons).put("fullCoreTextUnits",screen.page.fullText.length()).put("shownCoreTextUnits",screen.page.details.length()).put("note","Geometry only; root must also scroll all options/body, expand disclosures, paginate and exercise real enabled actions.");
 }
}
