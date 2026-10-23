package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
final class MigrationV30EvidenceChecks {
 static void run(FlowInstrumentation f)throws Exception {
  f.click("研究");f.click("报告与候选复核");
  final String unique="主机复核-"+System.nanoTime(),id="SZ:stock:000001";
  JSONObject source=new JSONObject().put("title",unique).put("report","完整报告正文。末尾保留。").put("candidates",new JSONArray()
      .put(new JSONObject().put("instrumentId",id).put("name","平安银行").put("reason","受控理由").put("risk","检查而非投资建议")));
  SharedPreferences prefs=f.activity.getSharedPreferences("native-review-tests",Context.MODE_PRIVATE);
  prefs.edit().putBoolean("watch/"+id,false).commit();
  int before=f.activity.evidenceReviewScreen.store.list("reports",0).length();
  File input=MigrationV29RemainingChecks.file(f,source.toString());
  f.click("选择本机报告 / 旧导出");MigrationV28HostChecks.waitPicker(f,true);
  f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
  MigrationV28HostChecks.waitPicker(f,false);
  f.check(f.activity.evidenceReviewScreen.store.list("reports",0).length()==before,"cancel no report writes");
  f.ui(()->f.activity.onActivityResult(449,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));
  f.check(f.activity.evidenceReviewScreen.pending.length()>0 && f.activity.evidenceReviewScreen.store.list("reports",0).length()==before,"SAF previews only");
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->f.check(f.activity.evidenceReviewScreen.isShown()&&f.activity.evidenceReviewScreen.pending.length()>0,"host restores page and staged preview"));
  f.click("明确合并报告 / 恢复已确认备份");
  f.check(f.activity.evidenceReviewScreen.store.list("reports",0).length()==before+1,"explicit merge actual SQLite");
  f.click("已导入 · "+unique);
  int batches=f.activity.evidenceReviewScreen.store.list("batches",0).length();
  f.click("明确选择此行");
  f.ui(()->f.activity.evidenceReviewScreen.acknowledge.setChecked(false));
  f.click("明确确认所选候选并保存独立历史");
  f.check(f.activity.evidenceReviewScreen.store.list("batches",0).length()==batches,"missing acknowledgement blocks approval");
  f.ui(()->{f.activity.evidenceReviewScreen.input.setText("未保存材料 "+unique);f.activity.evidenceReviewScreen.acknowledge.setChecked(true);});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->f.check(f.activity.evidenceReviewScreen.selected.size()==1&&f.activity.evidenceReviewScreen.acknowledge.isChecked()
      &&f.activity.evidenceReviewScreen.input.getText().toString().equals("未保存材料 "+unique),"selection acknowledgement and full draft survive recreation"));
  f.click("明确确认所选候选并保存独立历史");
  f.check(f.activity.evidenceReviewScreen.store.list("batches",0).length()==batches+1,"independent candidates actually saved");
  f.check(!prefs.getBoolean("watch/"+id,true),"approval never adds to watchlist");
  f.click("阅读完整报告 / 提示词 / 旧原记录");
  f.ui(()->{
   f.check(f.activity.evidenceReviewScreen.reader!=null,"internal full report reader");
   if(!f.activity.darkTheme())f.activity.findViewById(R.id.theme).performClick();
  });
  f.shot("android-v30-evidence-report-dark");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
  SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"evidence landscape");
  f.shot("android-v30-evidence-report-landscape");
  f.ui(()->{
   f.activity.findViewById(R.id.back).performClick();f.check(f.activity.evidenceReviewScreen.isShown()&&f.activity.evidenceReviewScreen.reader==null,"top back closes reader before home");
   f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
  });
  f.ui(()->{try{
   JSONArray rows=f.activity.evidenceReviewScreen.store.list("batches",0);String batchId="";
   for(int n=0;n<rows.length();n++)if(rows.getJSONObject(n).getString("title").equals(unique))batchId=rows.getJSONObject(n).getString("id");
   f.check(!batchId.isEmpty(),"saved batch identity found");f.activity.evidenceReviewScreen.readBatch(batchId);
  }catch(Exception e){throw new RuntimeException(e);}});
  f.click("明确加入自选 · 平安银行 "+id);
  f.check(prefs.getBoolean("watch/"+id,false),"explicit watchlist action restores visibility");
  f.ui(()->{try{
   boolean refused=false;try{f.activity.evidenceInstrumentAction("chart",new JSONObject().put("instrumentId",id).put("name","同码错误名称"));}catch(Exception e){refused=true;}
   f.check(refused&&f.activity.evidenceReviewScreen.isShown(),"host revalidates names not just six digit code");
  }catch(Exception e){throw new RuntimeException(e);}});
  f.click("打开K线 · 平安银行 "+id);
  f.ui(()->f.check(f.activity.chart.isShown()&&!f.activity.evidenceReviewScreen.isShown(),"explicit chart uses actual native chart"));
  f.ui(()->f.activity.openEvidenceReview());
  f.ui(()->{f.activity.onBackPressed();f.check(f.activity.evidenceReviewScreen.reader==null,"system back closes history reader");});
  File output=MigrationV29RemainingChecks.file(f,"");
  f.click("导出已确认完整备份");MigrationV28HostChecks.waitPicker(f,true);
  f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
  MigrationV28HostChecks.waitPicker(f,false);
  // Save a fresh approved snapshot through the host writer; the actual picker cancellation cleared its first pending token.
  f.ui(()->{try{
   f.activity.exportReviewFile("evidence.json","application/json",f.activity.evidenceReviewScreen.store.backup());
  }catch(Exception e){throw new RuntimeException(e);}});
  MigrationV28HostChecks.waitPicker(f,true);
  f.ui(()->f.activity.onActivityResult(441,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(output))));
  f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  JSONObject exported=new JSONObject(new String(java.nio.file.Files.readAllBytes(output.toPath()),StandardCharsets.UTF_8));
  f.check(exported.toString().contains(unique)&&!exported.toString().contains("未保存材料 "+unique),"file export contains confirmed records not drafts");
  f.ui(()->{f.activity.goHome();f.check(f.activity.findViewById(R.id.home).isShown(),"direct home no page history");});
 }
}
