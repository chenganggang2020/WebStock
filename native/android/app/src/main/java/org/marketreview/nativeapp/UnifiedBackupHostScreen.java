package org.marketreview.nativeapp;
import android.content.Context;
import android.widget.*;
import org.json.*;
import java.io.File;
import java.lang.ref.WeakReference;
import static org.marketreview.nativeapp.UnifiedBackup.*;

/** Internal wrapper: preview -> explicit picker -> new target -> independent reread. */
public final class UnifiedBackupHostScreen extends LinearLayout {
 public interface Pickers {void importFile()throws Exception;void newExportFile()throws Exception;void receiptFile()throws Exception;}
 final UnifiedBackupHost host;final UnifiedBackupAsyncLane lane;final UnifiedBackupAsyncLane.Runner runner;final Pickers pickers;
 final UnifiedBackupScreen page;final TextView details;final Button save,discard,oldReceipt,cancelTask;final LinearLayout hostActions;final ScrollView contentScroll;
 byte[] pending=null;JSONArray pendingIds=new JSONArray();boolean busy=false,picking=false,closed=false,active=true;
 interface Result {void accept(JSONObject result)throws Exception;}
 public UnifiedBackupHostScreen(Context context,UnifiedBackupHost host,UnifiedBackupAsyncLane lane,Pickers pickers)throws Exception{
  super(context);this.host=host;this.lane=lane;this.runner=lane.runner();this.pickers=pickers;setOrientation(VERTICAL);setTag("unifiedBackupHostScreen");
  contentScroll=new ScrollView(context);contentScroll.setFillViewport(true);contentScroll.setTag("backupContentScroll");addView(contentScroll,new LayoutParams(-1,0,1));LinearLayout content=new LinearLayout(context);content.setOrientation(VERTICAL);content.setPadding(dp(12),dp(4),dp(12),dp(12));contentScroll.addView(content,new ScrollView.LayoutParams(-1,-2));
  Button locationToggle=new Button(context);locationToggle.setText("回执位置与历史");locationToggle.setTextSize(14);locationToggle.setAllCaps(false);locationToggle.setMinHeight(dp(48));locationToggle.setTag("toggleBackupLocation");content.addView(locationToggle,new LayoutParams(-1,-2));
  LinearLayout locationPanel=new LinearLayout(context);locationPanel.setOrientation(VERTICAL);locationPanel.setTag("backupLocationPanel");locationPanel.setVisibility(GONE);content.addView(locationPanel,new LayoutParams(-1,-2));TextView location=new TextView(context);location.setText("本次回执位置（确认开始前不会创建）：\n"+host.receiptFile());location.setTextSize(14);location.setTextIsSelectable(true);location.setTag("backupReceiptLocation");locationPanel.addView(location,new LayoutParams(-1,-2));locationToggle.setOnClickListener(v->{boolean expand=locationPanel.getVisibility()!=VISIBLE;locationPanel.setVisibility(expand?VISIBLE:GONE);locationToggle.setText(expand?"收起回执位置与历史":"回执位置与历史");});
  LinearLayout historyRow=new LinearLayout(context);locationPanel.addView(historyRow,new LayoutParams(-1,-2));oldReceipt=button(historyRow,"只读查看历史回执","inspectOldReceipt");
  details=new TextView(context);details.setTag("hostBackupDetails");details.setTextIsSelectable(true);details.setTextSize(14);details.setLineSpacing(dp(2),1f);details.setPadding(0,dp(8),0,dp(8));
  page=new UnifiedBackupScreen(context,host.coordinator,lane,pickers==null?null:()->{picking=true;refresh();try{pickers.importFile();}catch(Exception e){pickerCancelled();throw e;}},(bytes,summary)->{pending=bytes;pendingIds=summary.getJSONArray("selectedDomainIds");display(summary.getString("display"));refresh();});
  content.addView(page,new LayoutParams(-1,-2));content.addView(details,new LayoutParams(-1,-2));page.removeView(page.actionDock);addView(page.actionDock,new LayoutParams(-1,-2));
  hostActions=new LinearLayout(context);hostActions.setTag("backupHostActions");addView(hostActions,new LayoutParams(-1,-2));save=button(hostActions,"确认并另存新文件","saveBackupNew");save.setContentDescription("确认预览并另存新文件");discard=button(hostActions,"取消待导出","discardBackupExport");discard.setContentDescription("取消待导出备份");cancelTask=button(hostActions,"取消读取 / 预览","cancelBackupTask");cancelTask.setOnClickListener(v->{lane.invalidate();pending=null;pendingIds=new JSONArray();page.cancelPreview();display("预览已取消，等待后台释放资源；晚到结果不会接受。");});
  save.setOnClickListener(v->{try{WatchlistWorkspaceModel.need(!lane.busy(),"后台任务仍在执行");
    if(!WatchlistWorkspaceModel.equal(pendingIds,page.selected())){pending=null;refresh();throw new IllegalStateException("所选范围已变化，请重新生成并预览备份");}
    picking=true;refresh();pickers.newExportFile();
   }catch(Exception e){pickerCancelled();details.setText(e.getMessage());}});
  discard.setOnClickListener(v->{pending=null;details.setText("已取消待导出备份；未写入文件。");refresh();});
  oldReceipt.setOnClickListener(v->{picking=true;refresh();try{pickers.receiptFile();}catch(Exception e){pickerCancelled();details.setText(e.getMessage());}});
  page.onInvalidate=()->{pending=null;pendingIds=new JSONArray();refresh();};page.onPresentationChanged=this::refresh;refresh();
 }
 int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
 Button button(LinearLayout row,String title,String tag){Button b=new Button(getContext());b.setText(title);b.setTag(tag);b.setTextSize(14);b.setAllCaps(false);b.setMinHeight(dp(48));b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(8),dp(4),dp(8),dp(4));row.addView(b,new LayoutParams(0,-2,1));return b;}
 void refresh(){if(save==null)return;boolean idle=active&&!busy&&!picking&&!closed;save.setEnabled(idle&&pending!=null&&pickers!=null);discard.setEnabled(idle&&pending!=null);oldReceipt.setEnabled(idle&&pickers!=null);page.setVisibility(idle?VISIBLE:GONE);cancelTask.setEnabled(active&&!closed&&lane.busy()&&!lane.writeInFlight());
  boolean reading=cancelTask.isEnabled(),exportReady=pending!=null&&!reading;save.setVisibility(exportReady?VISIBLE:GONE);discard.setVisibility(exportReady?VISIBLE:GONE);cancelTask.setVisibility(reading?VISIBLE:GONE);hostActions.setVisibility(exportReady||reading?VISIBLE:GONE);page.actionDock.setVisibility(idle&&!exportReady&&!reading?VISIBLE:GONE);details.setVisibility(details.length()>0?VISIBLE:GONE);if(exportReady)page.stage.setText("2  核对导出预览");else page.updateStage();
 }
 void run(boolean writing,boolean needsInputs,Read work,Result done){if(busy||closed||!active)return;busy=true;display(writing?"正在写入并核验；离开不会撤销已开始的操作。":"正在读取并校验，可取消预览；后台释放资源前不会接收新任务。");refresh();WeakReference<UnifiedBackupHostScreen> ref=new WeakReference<>(this);UnifiedBackupAsyncLane.Done finish=(value,error)->{UnifiedBackupHostScreen view=ref.get();if(view==null||view.closed)return;view.busy=false;if(error!=null)view.display("操作未确认："+error.getMessage()+"\n不会自动重试。");else try{if(!writing)view.display("");done.accept(value);}catch(Exception e){view.display(e.getMessage());}view.refresh();};try{runner.run(writing,needsInputs,work,finish);refresh();}catch(Exception e){finish.finish(null,e);}}
 public void pickerCancelled(){picking=false;if(closed)return;details.setText("文件选择已取消；未写入数据或文件。");refresh();}
 public void acceptImport(UnifiedBackupFiles.Source source){if(closed)return;picking=false;if(!page.startImport()){refresh();return;}pending=null;pendingIds=new JSONArray();final UnifiedBackupHost owner=host;run(false,false,()->{JSONObject b=decode(owner.readImport(source));return WatchlistWorkspaceModel.object("payload",b,"display",UnifiedBackupScreen.importText(b));},r->page.acceptPrepared(r.getJSONObject("payload"),r.getString("display")));}
 public void acceptExport(UnifiedBackupFiles.NewTarget target){if(closed)return;picking=false;final byte[] bytes=pending;pending=null;pendingIds=new JSONArray();final UnifiedBackupHost owner=host;run(true,false,()->{owner.saveExportNew(target,bytes);return new JSONObject();},v->display("已写入新文件并独立回读确认。"));}
 public void acceptReceipt(File file){if(closed)return;picking=false;final UnifiedBackupHost owner=host;run(false,true,()->{JSONObject inspection=owner.inspectReceipt(file);StringBuilder text=new StringBuilder(UnifiedBackupFiles.historicalText(inspection));JSONArray rows=inspection.getJSONObject("receipt").getJSONArray("domains");for(int i=0;i<rows.length();i++)text.append(RecentRestore.describeOperationRow(rows.getJSONObject(i))).append(SectorObservationRestore.describeOperationRow(rows.getJSONObject(i))).append(BusinessRestore.describeOperationRow(rows.getJSONObject(i))).append(CandidateRestore.describe(rows.getJSONObject(i))).append(IndustryArchiveReading.describeOperationRow(rows.getJSONObject(i)));return WatchlistWorkspaceModel.object("display",text.toString());},v->{page.collapseScope();page.showReceiptInspection(v.getString("display"));display("历史回执已校验；完整原字段与回执在上方分页阅读。不会继续旧操作。");});}
 void display(String text){if(text==null)text="";details.setText(text.length()>32768?text.substring(0,32768)+"\n[本区仅显示前32768字符；完整内容保留原文件，恢复差异在上方分页]":text);details.post(()->{if(!closed&&active&&details.isShown())details.requestRectangleOnScreen(new android.graphics.Rect(0,0,details.getWidth(),Math.min(details.getHeight(),dp(96))),true);});}
 public void setActive(boolean value){active=value;page.setActive(value);if(!value){pending=null;pendingIds=new JSONArray();}refresh();}
 public void dispose(){closed=true;pending=null;page.dispose();refresh();}
 public boolean pickerInFlight(){return picking;}
 @Override protected void onVisibilityChanged(android.view.View changed,int visibility){super.onVisibilityChanged(changed,visibility);if(page!=null&&!closed&&(changed==this||!picking))setActive(isShown());}
}
