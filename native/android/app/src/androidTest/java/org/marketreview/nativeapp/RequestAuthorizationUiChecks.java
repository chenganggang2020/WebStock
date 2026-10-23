package org.marketreview.nativeapp;
import android.app.Activity;
import android.os.Looper;
import android.os.Parcelable;
import android.util.SparseArray;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
/** Optional root-owned device check. UI thread, synthetic input only, no transport or user DB. */
public final class RequestAuthorizationUiChecks {
 private static void need(boolean ok,String why)throws Exception{if(!ok)throw new Exception(why);}
 public static int run(Activity owner)throws Exception{
  need(Looper.myLooper()==Looper.getMainLooper(),"run on UI thread");
  int checks=0;FrameLayout frame=new FrameLayout(owner);owner.addContentView(frame,new ViewGroup.LayoutParams(-1,-1));
  RequestAuthorizationView view=new RequestAuthorizationView(owner,()->frame.isShown()&&owner.hasWindowFocus());frame.addView(view,new FrameLayout.LayoutParams(-1,-1));
  try{
   JSONObject prefs=new JSONObject().put("provider","openai").put("endpoint","https://api.openai.com/v1/chat/completions").put("model","fixture-model").put("enabledPreference",true).put("timeoutMs",1000);
   JSONArray materials=new JSONArray().put(new JSONObject().put("kind","docs").put("id","fixture").put("row",new JSONObject().put("id","fixture").put("text","synthetic local material")));
   AiKnowledgeRequest.Prepared request=AiKnowledgeRequest.prepare(prefs,"fixture",materials);
   EditText key=view.findViewWithTag("authorizationCredential");key.setId(198751);
   need(!key.isSaveEnabled()&&!key.isSaveFromParentEnabled()&&!key.getFreezesText()&&key.getImportantForAutofill()==View.IMPORTANT_FOR_AUTOFILL_NO,"credential saving and autofill disabled");checks++;
   for(String withdrawn:new String[]{"authorizationReviewed","authorizationModel","authorizationBilling","credential"}){
    view.bind(Collections.singletonList(request));need(!view.ready(),"no inherited grant");checks++;
    for(String tag:new String[]{"authorizationReviewed","authorizationModel","authorizationBilling"})((CheckBox)view.findViewWithTag(tag)).setChecked(true);
    key.setText("synthetic-fixture-secret-0123456789");SparseArray<Parcelable> state=new SparseArray<>();key.saveHierarchyState(state);need(state.size()==0,"typed credential excluded from hierarchy state");checks++;
    ((Button)view.findViewWithTag("authorizationApprove")).performClick();need(view.ready()&&key.length()==0,"explicit authorization clears input");checks++;
    AiKnowledgeRequest.Grant grant=view.authorize(request);
    if(withdrawn.equals("credential"))key.setText("replacement-fixture-secret-0123456789");else ((CheckBox)view.findViewWithTag(withdrawn)).setChecked(false);
    need(!view.ready()&&grant.isRevoked(),"withdraw/edit revokes issued grant");checks++;
    boolean blocked=false;try{view.authorize(request);}catch(Exception expected){blocked=true;}need(blocked,"no further request");checks++;
   }
   view.bind(Collections.singletonList(request));view.clear();need(!view.ready()&&key.length()==0,"cancel clears authority and input");checks++;
   return checks;
  }finally{view.clear();ViewGroup parent=(ViewGroup)frame.getParent();if(parent!=null)parent.removeView(frame);}
 }
}
