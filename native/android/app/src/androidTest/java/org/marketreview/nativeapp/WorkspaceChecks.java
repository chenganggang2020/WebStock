package org.marketreview.nativeapp;

import android.view.View;

/** Business workspaces share the Activity window and retain their own selection. */
final class WorkspaceChecks {
  static void embedded(FlowInstrumentation t, Object page, String label) {
    t.check(page instanceof View, label + " is an embedded native View, not a Dialog");
    View view = (View) page;
    t.check(view.getParent() != null, label + " has a parent container");
    t.check(view.getRootView() == t.activity.getWindow().getDecorView(),
        label + " belongs to the Activity window");
    t.check(view.isShown(), label + " is visible in the current workspace");
  }

  static void run(FlowInstrumentation t) throws Exception {
    MainActivity a = t.activity;
    t.ui(() -> {
      a.chart.end = 90;
      a.chart.selected = 70;
      a.funds();
    });
    CapitalScreen funds = a.capitalScreen;
    t.ui(() -> {
      embedded(t, funds, "funds");
      funds.modes.setSelection(1);
    });
    t.ui(a::funds);
    t.ui(() -> {
      t.check(a.capitalScreen == funds, "reopening funds reuses the existing page");
      t.check(funds.modes.getSelectedItemPosition() == 1, "funding period retained");
      a.auctionView();
    });
    AuctionScreen auction = a.auctionScreen;
    t.ui(() -> {
      embedded(t, auction, "auction");
      t.check(!funds.isShowing(), "funds becomes inactive when auction is selected");
      auction.phase.setSelection(1);
      auction.mode.setSelection(1);
    });
    t.ui(a::funds);
    t.ui(() -> {
      t.check(a.capitalScreen == funds && funds.isShowing(), "funds restored without duplication");
      t.check(!auction.isShowing(), "auction becomes inactive behind funds");
      t.check(funds.modes.getSelectedItemPosition() == 1, "funding period survives page switching");
      t.check(a.chart.end == 90 && a.chart.selected == 70, "chart history survives page switching");
    });
    t.shot("android-v7-funds-embedded");
    t.ui(a::auctionView);
    t.ui(() -> {
      t.check(a.auctionScreen == auction, "same instrument auction page reused");
      t.check(auction.phase.getSelectedItemPosition() == 1
              && auction.mode.getSelectedItemPosition() == 1,
          "auction phase and source mode survive switching");
    });
    t.shot("android-v7-auction-embedded");
    t.ui(a::onBackPressed);
    t.ui(() -> {
      t.check(a.findViewById(R.id.home).isShown(), "business page back goes directly to homepage");
      t.check(!funds.isShowing() && !auction.isShowing(), "no business page remains above homepage");
      t.check(a.chart.end == 90 && a.chart.selected == 70, "back preserves chart history");
      a.funds();
    });
    t.ui(() -> {
      t.check(a.capitalScreen == funds, "home to funds restores retained page");
      t.check(funds.modes.getSelectedItemPosition() == 1, "home to funds retains funding period");
      funds.modes.setSelection(0);
      auction.phase.setSelection(0);
      auction.mode.setSelection(0);
      funds.dismiss();
    });
  }
}
