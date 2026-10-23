package org.marketreview.nativeapp;
import android.content.Context;
import android.widget.*;
import org.json.*;
public final class AccountReferenceScreenChecks {
 public static String screen(Context context,String fixture)throws Exception{JSONObject f=new JSONObject(fixture),out=AccountReferenceModel.evaluate(f.getJSONObject("account"),f.getJSONArray("trades"),f.getJSONObject("quotes"),f.getJSONObject("context"));final boolean[] fail={false};AccountReferenceScreen v=new AccountReferenceScreen(context,()->{if(fail[0])throw new Exception("read failure");return out;});if(v.findViewWithTag("accountReferenceRow_0")==null)throw new Exception("missing contribution");TextView summary=(TextView)v.findViewWithTag("accountReferenceSummary");if(!summary.getText().toString().contains("33.36")||!summary.getText().toString().contains("旧未清仓"))throw new Exception("missing scope/rate");((TextView)v.findViewWithTag("accountReferenceRow_0")).performClick();if(v.findViewWithTag("accountReferenceDetail_0").getVisibility()!=android.view.View.VISIBLE)throw new Exception("basis cannot expand");v.setDarkTheme(true);fail[0]=true;v.reload();if(v.frozenOutput().length()!=0||v.findViewWithTag("accountReferenceRow_0")!=null||!summary.getText().toString().contains("read failure"))throw new Exception("stale prior account result retained");return "v38 Android Screen checks PASS 4";}
}

