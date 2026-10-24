package org.marketreview.nativeapp;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.RippleDrawable;
import android.widget.*;

/** Host keeps sampling, source fetching and viewport ownership. */
final class ChartPeriodBar extends HorizontalScrollView {
  interface Host { void select(String period, int samplingSeconds); }
  static final String[] LABELS = {"5秒", "30秒", "1分钟", "日K", "周K", "月K", "年K"};
  static final String[] KEYS = {"minute", "minute", "minute", "day", "week", "month", "year"};
  static final String[] NOTES = {"本机快照", "快照聚合", "来源历史", "按交易日", "按自然周", "按自然月", "月线汇总"};
  static final int[] SAMPLING = {5, 30, 0, 0, 0, 0, 0};
  final Button[] buttons = new Button[LABELS.length];
  ChartPeriodBar(Context context, Host host) {
    super(context);
    setTag("chartPeriodBar");
    setHorizontalScrollBarEnabled(false);
    LinearLayout row = new LinearLayout(context);
    addView(row);
    for (int n = 0; n < buttons.length; n++) {
      final int index = n;
      Button button = new Button(context);
      buttons[n] = button;
      button.setTag("chartPeriod:" + LABELS[n]);
      button.setText(LABELS[n] + "\n" + NOTES[n]);
      button.setTextSize(12);
      button.setAllCaps(false);
      button.setPadding(dp(4), 0, dp(4), 0);
      button.setMinWidth(0);
      button.setMinimumWidth(0);
      button.setContentDescription(LABELS[n] + "，" + NOTES[n]);
      button.setTooltipText(n < 2 ? NOTES[n] + "；仅前台当前标的，不是交易所秒级历史" : NOTES[n]);
      button.setOnClickListener(v -> host.select(KEYS[index], SAMPLING[index]));
      row.addView(button, new LinearLayout.LayoutParams(dp(70), dp(48)));
    }
  }
  int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
  void refresh(String period, boolean dark) {
    for (int n = 0; n < buttons.length; n++) {
      String key = SAMPLING[n] > 0 ? "minute" + SAMPLING[n] + "s" : KEYS[n];
      boolean selected = key.equals(period);
      buttons[n].setSelected(selected);
      buttons[n].setTextColor(dark ? 0xffdce5f0 : 0xff172b45);
      int fill = selected ? (dark ? 0xff315b88 : 0xffcfe3fa) : (dark ? 0xff111a26 : 0xffffffff);
      buttons[n].setBackground(new RippleDrawable(ColorStateList.valueOf(dark ? 0x44ffffff : 0x33172b45), new ColorDrawable(fill), null));
    }
  }
}
