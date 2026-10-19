package org.marketreview.nativeapp;

import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.widget.*;
import org.json.*;

/** Host-page acceptance on the review emulator; no account imports or market requests. */
final class ScenarioToolsHostChecks {
  static void run(FlowInstrumentation f) throws Exception {
    SharedPreferences drafts = f.getTargetContext().getSharedPreferences("scenario_tools_drafts_v1", Context.MODE_PRIVATE);
    boolean hadDraft = drafts.contains("draft");
    String original = drafts.getString("draft", null);
    JSONObject fixtures;
    try (java.io.InputStream input = f.getContext().getAssets().open("scenario-tools-v1.json")) {
      java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
      byte[] buffer = new byte[8192]; int n;
      while ((n = input.read(buffer)) != -1) bytes.write(buffer, 0, n);
      fixtures = new JSONObject(bytes.toString("UTF-8"));
    }
    try {
      f.ui(() -> {
        f.check(drafts.edit().remove("draft").commit(), "temporary draft isolation");
        f.activity.openBusiness("accounts");
      });
      f.click("情景工具");
      f.ui(() -> {
        f.check(f.activity.scenarioScreen.isShown() && f.activity.findViewById(R.id.businessHost).isShown(),
            "account entry opens actual internal native scenario page");
        try { ScenarioToolsScreenChecks.ui(f.activity, fixtures); }
        catch (Exception e) { throw new RuntimeException(e); }
      });
      JSONArray cases = fixtures.getJSONArray("cases");
      for (String module : ScenarioTools.MODULES) {
        JSONObject input = null;
        for (int i = 0; i < cases.length(); i++)
          if (module.equals(cases.getJSONObject(i).getString("name"))) input = cases.getJSONObject(i).getJSONObject("input");
        f.check(input != null, "fixture for actual host tool " + module);
        JSONObject state = ScenarioToolsScreenChecks.state(module, ScenarioToolsScreenChecks.raw(module, input));
        f.ui(() -> f.activity.scenarioScreen.restoreState(state));
        f.ui(() -> {
          ScenarioToolsScreen page = f.activity.scenarioScreen;
          ((Button) page.findViewWithTag("scenarioCalculate")).performClick();
          TextView status = page.findViewWithTag("scenarioStatus"), result = page.findViewWithTag("scenarioResult");
          f.check(status.getText().toString().startsWith("已按") && result.getText().length() > 0,
              "mounted native form calculates " + module);
        });
        f.ui(() -> ((ScrollView) f.activity.scenarioScreen.findViewWithTag("scenarioScroll")).fullScroll(android.view.View.FOCUS_DOWN));
        f.ui(() -> {
          TextView result = f.activity.scenarioScreen.findViewWithTag("scenarioResult");
          f.check(result.getGlobalVisibleRect(new Rect()), "result has visible host pixels " + module);
        });
      }
      JSONObject input = new JSONObject().put("initialCapital", 10000).put("targetCapital", 20000)
          .put("years", 5).put("monthlyContribution", 0);
      JSONObject target = ScenarioToolsScreenChecks.state("target", ScenarioToolsScreenChecks.raw("target", input));
      f.ui(() -> {
        f.activity.scenarioScreen.restoreState(target);
        ((EditText) f.activity.scenarioScreen.findViewWithTag("scenario_initialCapital")).setText("12000");
        ((Button) f.activity.scenarioScreen.findViewWithTag("scenarioSave")).performClick();
      });
      f.ui(() -> ((EditText) f.activity.scenarioScreen.findViewWithTag("scenario_initialCapital")).setText("13000"));
      f.ui(() -> f.activity.findViewById(R.id.back).performClick());
      f.ui(() -> f.check(f.activity.findViewById(R.id.home).isShown(), "scenario returns home through host back"));
      f.ui(() -> f.activity.openBusiness("paper"));
      f.click("情景工具");
      assertDraft(f, "13000");
      scrollToInput(f);
      f.ui(() -> f.activity.findViewById(R.id.theme).performClick());
      f.ui(() -> {
        TextView text = f.activity.scenarioScreen.findViewWithTag("scenarioStatus");
        f.check(text.getCurrentTextColor() == (f.activity.darkTheme() ? 0xffdae5f5 : 0xff1f3048),
            "scenario text follows host theme");
      });
      f.shot("android-scenario-dark-portrait");
      f.ui(() -> f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
      SourceChecks.waitFor(f, () -> f.activity.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE,
          5000, "scenario host landscape");
      assertDraft(f, "13000");
      scrollToInput(f);
      f.ui(() -> f.check(f.activity.scenarioScreen.findViewWithTag("scenario_initialCapital").getGlobalVisibleRect(new Rect()),
          "landscape input has visible pixels and nonzero height"));
      f.shot("android-scenario-dark-landscape");
      SourceHistoryChecks.recreateActivity(f);
      assertDraft(f, "13000");
      f.check(new JSONObject(drafts.getString("draft", "{}")).getJSONObject("drafts")
          .getJSONObject("target").getString("initialCapital").equals("12000"),
          "unsaved session input does not overwrite explicit disk draft");
      f.ui(() -> {
        f.check(((TextView) f.activity.scenarioScreen.findViewWithTag("scenarioResult")).getText().length() == 0,
            "activity recreation never restores stale calculation result");
        f.activity.findViewById(R.id.theme).performClick();
        f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
      });
      SourceChecks.waitFor(f, () -> f.activity.getResources().getConfiguration().orientation == Configuration.ORIENTATION_PORTRAIT,
          5000, "scenario host portrait");
      f.ui(() -> {
        f.check(!f.activity.darkTheme(), "return to light theme");
        ((Button) f.activity.scenarioScreen.findViewWithTag("scenarioCalculate")).performClick();
        f.check(((TextView) f.activity.scenarioScreen.findViewWithTag("scenarioResult")).getText().length() > 0,
            "explicit calculate after recreation");
      });
      scrollToInput(f);
      f.shot("android-scenario-light-portrait");
      f.ui(() -> f.activity.goHome());
    } finally {
      SharedPreferences.Editor restore = drafts.edit();
      if (hadDraft) restore.putString("draft", original); else restore.remove("draft");
      f.check(restore.commit(), "original scenario draft restored after test");
      f.check(drafts.contains("draft") == hadDraft && java.util.Objects.equals(drafts.getString("draft", null), original),
          "no scenario fixture pollution in original disk draft");
    }
  }
  static void assertDraft(FlowInstrumentation f, String expected) {
    f.ui(() -> {
      ScenarioToolsScreen page = f.activity.scenarioScreen;
      f.check(page != null && page.isShown() && f.activity.findViewById(R.id.businessHost).isShown(),
          "scenario remains an internal host page");
      f.check(((EditText) page.findViewWithTag("scenario_initialCapital")).getText().toString().equals(expected),
          "scenario input survives navigation, orientation and recreation");
    });
  }
  static void scrollToInput(FlowInstrumentation f) {
    f.ui(() -> {
      EditText input = f.activity.scenarioScreen.findViewWithTag("scenario_initialCapital");
      input.requestRectangleOnScreen(new Rect(0, 0, input.getWidth(), input.getHeight()), true);
    });
  }
}
