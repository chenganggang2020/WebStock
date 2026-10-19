package org.marketreview.nativeapp;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.view.View;
import android.widget.*;
import org.json.*;

final class AccountHostChecks {
  static <T extends View> T view(FlowInstrumentation f,String tag){return f.activity.findViewById(R.id.businessHost).findViewWithTag(tag);}
  static void run(FlowInstrumentation f)throws Exception{
    f.check(f.activity.testing,"account host uses isolated records");
    JSONObject trade=AccountAnalysisChecks.buy();trade.remove("id");trade.put("accountId","local");
    f.activity.businessStore.save("trades",trade);
    f.activity.businessStore.save("reports",new JSONObject().put("title","受控历史快照").put("text","原记录")
        .put("accountId","local").put("legacySource","portfolio_snapshots")
        .put("legacyOriginal",new JSONObject().put("snapshot_date","2026-10-01").put("total_assets",3000.).put("cash_balance",1000.).put("total_market_value",2000.)));
    String trades=f.activity.businessStore.read("trades").toString(),reports=f.activity.businessStore.read("reports").toString();
    f.ui(()->f.activity.openBusiness("accounts"));
    f.ui(()->((Button)view(f,"openAccountAnalysis")).performClick());
    f.ui(()->{
      f.check(view(f,"accountAnalysisScreen").isShown(),"actual account internal analysis page");
      f.check(view(f,"analysisPosition_0")!=null,"position structure rendered");
      ((Button)view(f,"analysisHistoryMode")).performClick();
      TextView item=view(f,"analysisSnapshot_0");f.check(item!=null&&item.getText().toString().contains("3000"),"original historical asset value");item.performClick();
      f.check(view(f,"analysisOriginal_0").isShown(),"native click reveals exact historical JSON");
    });
    f.shot("android-account-history");
    f.ui(()->{f.activity.findViewById(R.id.theme).performClick();f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);});
    SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"account landscape");
    f.shot("android-account-landscape-before-check");
    f.ui(()->f.check(view(f,"analysisHistoryPlot").getGlobalVisibleRect(new Rect()),"landscape history plot visible"));
    f.shot("android-account-landscape");
    SourceHistoryChecks.recreateActivity(f);
    f.ui(()->{
      f.check(view(f,"accountAnalysisScreen").isShown()&&view(f,"analysisHistoryPlot")!=null,"account and history mode survive actual recreation");
      ((Button)view(f,"analysisFlowMode")).performClick();
    });
    f.check(trades.equals(f.activity.businessStore.read("trades").toString())&&reports.equals(f.activity.businessStore.read("reports").toString()),"analysis navigation did not rewrite trades/history");
    f.ui(()->{f.activity.goHome();f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);if(f.activity.darkTheme())f.activity.findViewById(R.id.theme).performClick();});
    SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_PORTRAIT,5000,"account portrait");
  }
}
