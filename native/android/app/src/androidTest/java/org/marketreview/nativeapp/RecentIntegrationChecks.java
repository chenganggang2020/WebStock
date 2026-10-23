package org.marketreview.nativeapp;
import android.widget.*;
import android.os.Bundle;
import org.json.*;
import java.time.Instant;
import java.util.concurrent.TimeUnit;

/** Real native entrypoint acceptance; never uses the normal application database. */
final class RecentIntegrationChecks {
  static void run(FlowInstrumentation f) throws Exception {
    f.check(f.activity.testing, "isolated fixture activity");
    f.click("最近");
    f.ui(() -> f.check(f.activity.recentScreen.isShown() && f.activity.findViewById(R.id.businessHost).isShown(),
        "recent is the actually visible internal native page"));
    RecentStore store=f.activity.recentScreen.store;
    f.activity.recentScreen.worker.submit(()->{try{store.clear();}catch(Exception e){throw new RuntimeException(e);}}).get(5,TimeUnit.SECONDS);
    final String[] id={""};
    f.ui(()->{
      f.activity.goHome();
      ListView list=f.activity.findViewById(R.id.stocks);
      id[0]=((JSONObject)list.getAdapter().getItem(0)).optString("id");
      list.performItemClick(list.getChildAt(0),0,0);
      f.check(f.activity.chart.isShown(),"watchlist native item opens actual chart");
    });
    drain(f); f.check(count(store,id[0])==1,"one explicit chart open records exactly one visit");
    f.ui(()->{f.activity.period("week");f.activity.period("day");f.activity.applyTheme();});
    drain(f); f.check(count(store,id[0])==1,"period and theme updates never count as another visit");
    SourceHistoryChecks.recreateActivity(f);
    f.ui(()->f.check(f.activity.chart.isShown(),"chart is restored after real Activity recreation"));
    f.check(count(store,id[0])==1,"Activity restoration never increments history");
    f.ui(()->f.activity.goHome()); f.click("最近");
    SourceChecks.waitFor(f,()->f.activity.recentScreen.rows.size()==1,5000,"history read after returning home");
    f.ui(()->RecentChecks.clickRow(f.activity.recentScreen,id[0]));
    drain(f); f.check(count(store,id[0])==1,"selection alone never counts a visit");
    f.ui(()->f.activity.recentScreen.analysis.performClick());
    drain(f); f.check(count(store,id[0])==2,"recent analysis counts once, not chart plus analysis twice");
    f.ui(()->f.check(f.activity.findViewById(R.id.businessHost).isShown(),"analysis uses internal page"));
    f.ui(()->f.activity.recent());
    f.shot("android-recent-integrated");
    JSONObject foreign=new JSONObject().put("id","BJ:stock:920999").put("name","北证测试证券")
        .put("symbol","bj920999").put("quote",new JSONObject());
    store.recordView(foreign,Instant.now());
    String roster=MarketFeed.exportRoster(f.activity.rosterForPanels()).toString();
    int trades=f.activity.businessStore.read("trades").length();
    f.ui(()->f.activity.recentScreen.load("读取受控新增记录"));
    SourceChecks.waitFor(f,()->f.activity.recentScreen.rows.size()==2,5000,"non-watchlist recent record loaded");
    f.ui(()->{RecentChecks.clickRow(f.activity.recentScreen,"BJ:stock:920999");f.activity.recentScreen.open.performClick();});
    drain(f);
    f.ui(()->{
      f.check(f.activity.chart.isShown()&&f.activity.chart.bars.isEmpty(),"unknown data stays an empty actual chart, not fabricated bars");
      f.check(((TextView)f.activity.findViewById(R.id.title)).getText().toString().contains("920999"),"correct canonical instrument opened");
      f.check(roster.equals(roster(f)),"temporary observation leaves exported watchlist unchanged");
    });
    SourceHistoryChecks.recreateActivity(f);
    f.ui(()->f.check(((TextView)f.activity.findViewById(R.id.title)).getText().toString().contains("920999"),"temporary identity survives recreation rather than falling back to another stock"));
    f.check(count(store,"BJ:stock:920999")==2,"temporary recreation has no extra count");
    f.ui(()->{f.activity.goHome();f.activity.recent();});
    SourceChecks.waitFor(f,()->f.activity.recentScreen.rows.size()==2,5000,"recent list after recreation");
    f.ui(()->{RecentChecks.clickRow(f.activity.recentScreen,"BJ:stock:920999");f.activity.recentScreen.ledger.performClick();});
    f.ui(()->{
      BusinessScreen page=BusinessChecks.openPage(f.activity,"accounts");
      f.check(page.tab==2 && page.selected.isEmpty()&&page.tradePrefilled,"recent opens new native ledger draft");
      f.check(page.instrumentIds.get(page.symbols.getSelectedItemPosition()).equals("BJ:stock:920999")&&page.value("tradePrice").isEmpty(),"non-watchlist identity preserved and missing quote left blank");
      page.inputs.get("tradeNote").setText("未保存原草稿");
    });
    f.check(f.activity.businessStore.read("trades").length()==trades,"recent ledger action never saves a trade implicitly");
    f.ui(()->f.activity.recent());
    SourceChecks.waitFor(f,()->f.activity.recentScreen.rows.size()==2,5000,"history remains after ledger");
    f.ui(()->{RecentChecks.clickRow(f.activity.recentScreen,id[0]);f.activity.recentScreen.ledger.performClick();});
    f.ui(()->{
      BusinessScreen page=BusinessChecks.openPage(f.activity,"accounts");
      f.check(page.value("tradeNote").equals("未保存原草稿")&&page.state.getText().toString().contains("原草稿保留"),"dirty ledger remains intact and its warning is visible");
      f.activity.recent();
    });
    SourceChecks.waitFor(f,()->!f.activity.recentScreen.readWanted,5000,"recent active again");
    f.ui(()->{RecentChecks.clickRow(f.activity.recentScreen,"BJ:stock:920999");f.activity.recentScreen.add.performClick();});
    f.ui(()->{
      f.check(roster(f).contains("BJ:stock:920999"),"explicit add promotes only selected identity");
      f.activity.recentScreen.search.setText("920999");f.activity.recentScreen.sort.setSelection(1);
    });
    SourceChecks.waitFor(f,()->f.activity.recentScreen.rows.size()==1&&!f.activity.recentScreen.readWanted,5000,"saved filter settled");
    SourceHistoryChecks.recreateActivity(f);
    SourceChecks.waitFor(f,()->f.activity.recentScreen!=null&&f.activity.recentScreen.isShown()&&f.activity.recentScreen.rows.size()==1,5000,"actual recent page and query restore");
    f.ui(()->{
      f.check(f.activity.recentScreen.sortValue.equals("view_count"),"recent sort restored");
      f.activity.onActivityResult(430,android.app.Activity.RESULT_CANCELED,null);
      f.check(f.activity.recentScreen.state.getText().toString().contains("已取消"),"cancelled document selection is handled");
    });
    drain(f);
    f.ui(()->f.check(f.activity.recentScreen.state.getText().toString().contains("已取消"),"late read cannot replace document cancellation result"));
    f.shot("android-recent-restored-query");
  }
  static void drain(FlowInstrumentation f)throws Exception {
    if(f.activity.recentScreen!=null)f.activity.recentScreen.worker.submit(()->{}).get(5,TimeUnit.SECONDS);
    f.waitForIdleSync();
  }
  static String roster(FlowInstrumentation f) {
    try{return MarketFeed.exportRoster(f.activity.rosterForPanels()).toString();}
    catch(Exception e){throw new AssertionError(e);}
  }
  static int count(RecentStore store,String id)throws Exception {
    JSONArray rows=store.list("","last_viewed",100);
    for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).optString("id").equals(id))return rows.getJSONObject(i).getInt("viewCount");
    return 0;
  }
}
