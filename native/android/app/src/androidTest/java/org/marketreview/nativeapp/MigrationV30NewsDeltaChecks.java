package org.marketreview.nativeapp;
import org.json.*;
import java.nio.charset.StandardCharsets;

/** Only the late deferred-import delta; existing unrelated suites are not rerun. */
final class MigrationV30NewsDeltaChecks {
 static void run(FlowInstrumentation f)throws Exception {
  f.click("市场");f.click("市场资讯");MigrationV29RemainingChecks.newsIdle(f);
  String id="delta-"+System.nanoTime();
  JSONObject item=NewsModel.item(NewsChecks.raw().put("id",id).put("title","取消与恢复 "+id)
   .put("link","https://finance.sina.com.cn/test/"+id+".shtml"));
  byte[] input=NewsModel.empty().put("items",new JSONArray().put(item)).toString().getBytes(StandardCharsets.UTF_8);
  int before=f.activity.newsScreen.store.archive(null).getJSONArray("items").length();
  f.ui(()->{try{
   NewsScreen n=f.activity.newsScreen;n.setActive(false);n.importArchive(input);
   f.check(n.deferredInput!=null&&n.preview==null,"inactive file awaits local preview only");
   n.cancelShown();f.check(n.deferredInput==null,"explicit cancel clears deferred work");
   n.setActive(true);
  }catch(Exception e){throw new RuntimeException(e);}});
  MigrationV29RemainingChecks.newsIdle(f);
  f.ui(()->f.check(f.activity.newsScreen.preview==null,"reopen does not restart explicitly cancelled import"));
  f.check(f.activity.newsScreen.store.archive(null).getJSONArray("items").length()==before,"cancel never writes archive");
  f.ui(()->{try{NewsScreen n=f.activity.newsScreen;n.setActive(false);n.importArchive(input);
   f.check(n.saveState().toString().length()<2048,"deferred full input stored outside Bundle");
  }catch(Exception e){throw new RuntimeException(e);}});
  SourceHistoryChecks.recreateActivity(f);MigrationV29RemainingChecks.newsIdle(f);
  f.ui(()->{NewsScreen n=f.activity.newsScreen;
   f.check(n.preview!=null&&n.preview.optInt("added")==1,"lifecycle interruption preserves explicit import preview");
   f.check(!n.allowNetwork&&n.deferredInput==null,"resume finishes local preview without network");
  });
  f.check(f.activity.newsScreen.store.archive(null).getJSONArray("items").length()==before,"restored preview still requires explicit merge");
  MigrationV29RemainingChecks.tag(f,"newsApplyImport");MigrationV29RemainingChecks.newsIdle(f);
  f.check(f.activity.newsScreen.store.archive(null).getJSONArray("items").length()==before+1,"explicit merge applies once");
 }
}
