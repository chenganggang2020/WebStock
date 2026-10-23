package org.marketreview.nativeapp;

import android.view.View;

/** Exercises the actual Activity host; module data tests are separate. */
final class MarketNavigationChecks {
  static void run(FlowInstrumentation f) throws Exception {
    f.check(f.activity.testing, "market host checks use isolated application data");
    f.click("市场");
    f.ui(() -> {
      f.check(f.activity.findViewById(R.id.businessHost).isShown(), "market mounts an internal page, not a menu dialog");
      for (String label : new String[]{"板块观察", "本地候选", "行情详情", "资金历史", "集合竞价过程", "个股明暗盘", "明暗盘 / 轮动", "ETF申赎日报"})
        f.check(f.find(f.activity.getWindow().getDecorView(), label) != null, "market tool visible: " + label);
    });
    f.shot("android-market-navigation");
    f.click("板块观察");
    f.ui(() -> {
      f.check(f.activity.sectorScreen != null && f.activity.sectorScreen.isShown(), "sector entry opens native screen");
      f.check(f.activity.sectorScreen.getParent() == f.activity.findViewById(R.id.businessHost), "sector shares existing internal host");
      f.check(f.activity.findViewById(R.id.home).getVisibility() == View.GONE, "market page does not overlap watchlist");
    });
    SourceHistoryChecks.recreateActivity(f);
    SourceChecks.waitFor(f, () -> f.activity.sectorScreen != null && f.activity.sectorScreen.isShown(), 5000,
        "sector internal page restores after actual Activity recreation");
    f.shot("android-sector-host-restored");
    f.ui(() -> f.activity.goHome());
    f.ui(() -> f.check(f.activity.findViewById(R.id.home).isShown() && !f.activity.sectorScreen.isShown(),
        "back returns directly to watchlist home, not prior market page"));
    f.click("市场");
    SectorWatchScreen previous = f.activity.sectorScreen;
    f.click("板块观察");
    f.ui(() -> f.check(previous == f.activity.sectorScreen, "switching reuses existing sector page"));
    f.click("市场");
    f.click("本地候选");
    f.ui(() -> f.check(f.activity.candidateScreen.isShown() && !f.activity.sectorScreen.isShown(),
        "market tool switching has one visible internal page"));
    f.ui(() -> f.activity.goHome());
  }
}
