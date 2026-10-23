package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
final class MigrationV29RemainingChecks {
 static void newsIdle(FlowInstrumentation f)throws Exception {
  SourceChecks.waitFor(f,()->f.activity.newsScreen!=null&&!f.activity.newsScreen.busy,8000,"news local worker");
 }
 static void tag(FlowInstrumentation f,String tag) { f.ui(()->{
  Button b=f.activity.newsHost.findViewWithTag(tag);f.check(b!=null&&b.isShown(),"actual news button "+tag);b.performClick();
 }); }
 static File file(FlowInstrumentation f,String text)throws Exception {
  File file=new File(f.getTargetContext().getCacheDir(),"v29-host-"+System.nanoTime()+".json");
  try(FileOutputStream out=new FileOutputStream(file)){out.write(text.getBytes(StandardCharsets.UTF_8));}return file;
 }
 static void news(FlowInstrumentation f)throws Exception {
  f.click("市场");f.click("市场资讯");newsIdle(f);
  f.ui(()->f.check(f.activity.newsScreen.isShown()&&!f.activity.newsScreen.allowNetwork,"actual independent native news, test network disabled"));
  String unique="host-"+System.nanoTime();JSONObject raw=NewsChecks.raw().put("id",unique)
      .put("title","主机受控原文 "+unique).put("link","https://finance.sina.com.cn/test/"+unique+".shtml");
  JSONObject normalized=NewsModel.item(raw);
  JSONObject article=NewsModel.article(normalized,new JSONArray().put("受控存档完整正文。这里只验证原生读取、备注保存和恢复，不将测试正文称为实时资讯。完整尾部保持。"),normalized.getString("link"),java.time.Instant.now(),"");
  normalized.put("article",article);
  JSONObject archive=NewsModel.empty().put("items",new JSONArray().put(normalized));
  File input=file(f,archive.toString());
  final int before=f.activity.newsScreen.store.archive(null).getJSONArray("items").length();
  tag(f,"hostNewsImport");MigrationV28HostChecks.waitPicker(f,true);
  f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
  MigrationV28HostChecks.waitPicker(f,false);newsIdle(f);
  f.check(f.activity.newsScreen.store.archive(null).getJSONArray("items").length()==before,"actual file picker cancel no writes");
  f.ui(()->f.activity.onActivityResult(447,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));newsIdle(f);
  f.check(f.activity.newsScreen.preview!=null&&f.activity.newsScreen.store.archive(null).getJSONArray("items").length()==before,"host file read previews only");
  SourceHistoryChecks.recreateActivity(f);newsIdle(f);
  f.check(f.activity.newsScreen.preview!=null,"pending news import survived Activity recreation");
  tag(f,"newsApplyImport");newsIdle(f);
  f.check(f.activity.newsScreen.store.archive(null).getJSONArray("items").length()==before+1,"explicit merge actual SQLite");
  f.ui(()->{NewsScreen n=f.activity.newsScreen;n.search.setText(unique);
   f.check(n.shown.size()==1,"same source identity found");n.list.performItemClick(n.list.getChildAt(0),0,0);
  });newsIdle(f);
  f.ui(()->{NewsScreen n=f.activity.newsScreen;f.check(n.body.getText().toString().contains("完整尾部保持"),"actual complete body reader");n.note.setText("主机未保存人工备注 "+unique);
   f.check(n.saveState().toString().length()<2048,"only small state marker in Bundle");
  });
  SourceHistoryChecks.recreateActivity(f);newsIdle(f);
  f.ui(()->f.check(f.activity.newsScreen.note.getText().toString().equals("主机未保存人工备注 "+unique),"news draft restored without network"));
  tag(f,"newsSave");newsIdle(f);
  f.check(f.activity.newsScreen.store.archive(null).toString().contains("主机未保存人工备注 "+unique),"manual note persisted and read back");
  f.ui(()->{TextView action=f.activity.newsHost.findViewWithTag("hostNewsImport");
   f.check(!f.activity.darkTheme() || action.getCurrentTextColor()==android.graphics.Color.rgb(217,229,245),"host file action respects dark theme");
  });
  f.shot("android-v29-news-reader");
  f.ui(()->{f.activity.findViewById(R.id.theme).performClick();f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);});
  SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"news landscape");newsIdle(f);
  f.ui(()->f.activity.newsScreen.readerScroll.scrollTo(0,f.activity.newsScreen.body.getTop()));
  f.shot("android-v29-news-landscape");
  f.ui(()->{android.graphics.Rect r=new android.graphics.Rect();f.check(f.activity.newsScreen.readerScroll.getGlobalVisibleRect(r)&&r.height()>=f.activity.dp(70),"news landscape readable area");
   f.check(f.activity.newsScreen.body.getGlobalVisibleRect(r)&&r.height()>=f.activity.dp(48),"actual news text visible after reader scroll");
   f.check(f.activity.newsHost.getOrientation()==LinearLayout.VERTICAL,"host file tools above adaptive news, never a horizontal column");
   f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);f.activity.goHome();
   f.check(f.activity.findViewById(R.id.home).isShown(),"news direct home");
  });
 }
 static void comments(FlowInstrumentation f)throws Exception {
  f.click("研究");f.click("评论工坊");
  f.ui(()->f.check(f.activity.commentWorkshopScreen.isShown(),"actual comment workshop host"));
  String title="主机规则 "+System.nanoTime();
  f.click("规则卡");
  f.ui(()->{CommentWorkshopScreen p=f.activity.commentWorkshopScreen;p.fields.get("title").setText(title);p.fields.get("entryRule").setText("未保存规则全文 "+title);});
  SourceHistoryChecks.recreateActivity(f);
  f.click("规则卡");
  f.ui(()->f.check(f.activity.commentWorkshopScreen.fields.get("entryRule").getText().toString().equals("未保存规则全文 "+title),"comment draft restored actual host"));
  f.click("明确保存规则卡（未验证）");
  f.check(f.activity.commentWorkshopScreen.store.list("rules",0).toString().contains(title),"comment explicit card save");
  File input=file(f,CommentWorkshopChecks.fixture().toString());
  f.ui(()->f.activity.onActivityResult(446,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));
  f.check(f.activity.commentWorkshopScreen.pending.length()>0,"comment actual file callback preview");
  SourceHistoryChecks.recreateActivity(f);f.click("确认合并（保留已有人工记录）");
  f.check(f.activity.commentWorkshopScreen.store.list("observations",0).length()>0,"comment confirmed staged import after recreate");
  f.ui(()->{CommentWorkshopScreen p=f.activity.commentWorkshopScreen;Button first=(Button)p.commentRows.getChildAt(0);f.check(first!=null,"actual comment row");first.performClick();
   f.check(p.detail.getText().toString().contains("完整尾部"),"full comment reader");
   p.detail.requestRectangleOnScreen(new android.graphics.Rect(0,0,p.detail.getWidth(),f.activity.dp(120)),true);
  });
  f.shot("android-v29-comments-reader");
  f.click("查看分类原记录（含缺失来源）");
  f.ui(()->{f.check(f.activity.commentWorkshopScreen.readerScroll.isShown(),"internal reader not popup");
   f.activity.onBackPressed();f.check(f.activity.commentWorkshopScreen.mainScroll.isShown(),"host back closes internal reader first");f.activity.goHome();
   f.check(f.activity.findViewById(R.id.home).isShown(),"comment direct home");
  });
 }
}
