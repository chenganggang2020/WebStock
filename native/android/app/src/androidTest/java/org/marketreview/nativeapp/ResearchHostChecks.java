package org.marketreview.nativeapp;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.view.View;
import android.widget.*;
import org.json.*;

/** Real Activity navigation using isolated records; not live research or investment validation. */
final class ResearchHostChecks {
  static <T extends View> T view(FlowInstrumentation f, String tag) {
    return f.activity.findViewById(R.id.businessHost).findViewWithTag(tag);
  }
  static BusinessScreen research(FlowInstrumentation f) {
    View child = view(f, "evidenceText");
    while (child != null && !(child instanceof BusinessScreen)) child = (View) child.getParent();
    return (BusinessScreen) child;
  }
  static void run(FlowInstrumentation f) throws Exception {
    f.check(f.activity.testing, "research checks use isolated application data");
    JSONObject first = f.activity.businessStore.save("docs", new JSONObject().put("title", "来源处理原文一")
        .put("text", "第一份校对原文"));
    JSONObject second = f.activity.businessStore.save("docs", new JSONObject().put("title", "来源处理原文二")
        .put("text", "第二份校对原文"));
    f.ui(() -> {try {f.activity.openResearchDocument(first);} catch(Exception e){throw new RuntimeException(e);}});
    f.ui(() -> {
      f.check(((EditText)view(f,"evidenceText")).getText().toString().equals("第一份校对原文"), "exact source research document opens editor");
      ((EditText)view(f,"evidenceTitle")).setText("未保存草稿");
      try {f.activity.openResearchDocument(second);throw new AssertionError("dirty draft overwritten");}
      catch(Exception expected){f.check(expected.getMessage().contains("未保存"), "external navigation protects dirty research");}
      f.check(((EditText)view(f,"evidenceTitle")).getText().toString().equals("未保存草稿"), "draft remains unchanged");
      ((Button)view(f,"discardEvidence")).performClick();
      try {f.activity.openResearchDocument(second);} catch(Exception e){throw new RuntimeException(e);}
    });
    JSONObject changed = new JSONObject(second.toString()).put("text", "其他操作更新过的原文");
    JSONObject current = f.activity.businessStore.save("docs", changed);
    f.ui(() -> {
      try {f.activity.openResearchDocument(second);throw new AssertionError("stale source accepted");}
      catch(Exception expected){f.check(expected.getMessage().contains("变化"), "stale source snapshot refused");}
      ((EditText)view(f,"evidenceTitle")).setText("迟到编辑");
      ((Button)view(f,"saveEvidence")).performClick();
      f.check(research(f).state.getText().toString().contains("变化"), "stale save refused");
      ((Button)view(f,"discardEvidence")).performClick();
      try {f.activity.openResearchDocument(current);} catch(Exception e){throw new RuntimeException(e);}
      f.check(((EditText)view(f,"evidenceText")).getText().toString().equals("其他操作更新过的原文"), "explicit current record loads");
    });
    f.shot("android-exact-research-document");
    JSONObject topic=f.activity.businessStore.save("topics",new JSONObject().put("name","研究公司宿主检查"));
    JSONObject doc=f.activity.businessStore.save("docs",new JSONObject().put("title","设备公告原文")
        .put("text","测试公司（600001，上交所）生产设备").put("sourceUrl","https://example.test/authorized-fixture"));
    JSONObject relation=ResearchCompaniesChecks.relation();relation.remove("id");
    relation.put("topicId",topic.getString("id")).put("documentId",doc.getString("id"));
    relation.getJSONObject("company").put("identityDocumentId",doc.getString("id"));
    JSONObject saved=f.activity.businessStore.save("relations",relation);
    f.ui(() -> f.activity.openBusiness("industry"));
    f.ui(() -> ((Button)view(f,"openResearchCompanies")).performClick());
    f.ui(() -> {
      ResearchCompaniesScreen page=view(f,"researchCompaniesScreen");
      page.setTopic(topic.optString("id"));
      f.check(page.isShown(), "company workspace mounted in actual industry host");
      ListView list=page.findViewWithTag("researchCompanyList");
      f.check(list.getCount()==1, "selected topic has its own company rows");
      list.performItemClick(null,0,0);
      f.check(((TextView)view(f,"companyOriginal")).getText().toString().contains("测试公司（600001，上交所）生产设备"), "company selection opens exact original text");
      ((EditText)view(f,"companyProduct")).setText("尚未保存的设备名称");
      ((Button)view(f,"companyGraphMode")).performClick();
      f.check(page.getGlobalVisibleRect(new Rect()) && page.getHeight()>=f.activity.dp(180), "graph workspace has usable actual host space");
    });
    f.shot("android-research-company-graph");
    f.ui(() -> f.activity.findViewById(R.id.theme).performClick());
    f.ui(() -> f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
    SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"research landscape");
    f.ui(() -> ((Button)view(f,"companyOriginalMode")).performClick());
    f.shot("android-research-company-landscape-before-check");
    f.ui(() -> {
      f.check(((EditText)view(f,"companyProduct")).getText().toString().equals("尚未保存的设备名称"),"landscape preserves unsaved company draft");
      f.check(view(f,"companyOriginal").getGlobalVisibleRect(new Rect()), "original text visible in landscape internal page");
    });
    f.shot("android-research-company-landscape");
    SourceHistoryChecks.recreateActivity(f);
    f.ui(() -> {
      f.check(view(f,"researchCompaniesScreen").isShown(), "recreation restores company subpage");
      f.check(((EditText)view(f,"companyProduct")).getText().toString().equals("尚未保存的设备名称"), "recreation retains unsaved company edit");
      ((Button)view(f,"companySave")).performClick();
      f.check(((TextView)view(f,"companyState")).getText().toString().contains("已保存"), "explicit save through actual host works");
    });
    JSONObject updated=null;JSONArray rows=f.activity.businessStore.read("relations");
    for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).optString("id").equals(saved.getString("id")))updated=rows.getJSONObject(i);
    f.check(updated!=null&&updated.optString("product").equals("尚未保存的设备名称")&&updated.optString("verification").equals("manuallyVerified"), "saved product preserves original verification");
    f.ui(() -> {f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);if(f.activity.darkTheme())f.activity.findViewById(R.id.theme).performClick();});
    SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_PORTRAIT,5000,"research portrait");
    f.shot("android-research-company-editor");
    f.ui(() -> {f.activity.goHome();f.check(f.activity.findViewById(R.id.home).isShown(),"research back goes directly home");});
  }
}
