package org.marketreview.nativeapp;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.*;
import android.widget.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** Visual-only follow-up: existing Main fixture/helpers; never invokes the logic-suite run. */
final class CreatorAiCompactUiChecks {
  static CreatorAiPanel ai(FlowInstrumentation f){return CreatorAiActualMainChecks.ai(f);}
  static CreatorPanel panel(FlowInstrumentation f){return CreatorAiActualMainChecks.panel(f);}
  static void ui(FlowInstrumentation f,CreatorAiActualMainChecks.Work w){CreatorAiActualMainChecks.ui(f,w);}
  static void tap(FlowInstrumentation f,String tag){CreatorAiActualMainChecks.tap(f,tag);}
  static View find(FlowInstrumentation f,String tag){return CreatorAiActualMainChecks.find(f,tag);}
  static void shot(FlowInstrumentation f,List<String> shots,String name)throws Exception{f.waitForIdleSync();f.shot(name);shots.add(name);}
  static void orientation(FlowInstrumentation f,boolean landscape)throws Exception{
    ui(f,()->f.activity.setRequestedOrientation(landscape?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
    long end=SystemClock.elapsedRealtime()+8000;boolean[] ready={false};
    while(SystemClock.elapsedRealtime()<end){ui(f,()->ready[0]=(f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE)==landscape);if(ready[0])break;Thread.sleep(40);}
    f.check(ready[0],"actual orientation "+(landscape?"landscape":"portrait"));f.waitForIdleSync();
  }
  static JSONObject rect(Rect r)throws Exception{return new JSONObject().put("left",r.left).put("top",r.top).put("right",r.right).put("bottom",r.bottom);}
  static void controls(FlowInstrumentation f,JSONArray evidence,String label){
    ui(f,()->{
      JSONObject row=new JSONObject().put("state",label);JSONArray buttons=new JSONArray();
      for(String tag:new String[]{"creatorAiPrepare","creatorAiImport","creatorAiValidate","creatorAiConfirm"}){
        View v=find(f,tag);Rect visible=new Rect();boolean shown=v.isShown()&&v.getGlobalVisibleRect(visible);
        f.check(shown&&visible.height()>=f.activity.dp(40)&&visible.height()>=v.getHeight()-2&&visible.width()>=v.getWidth()-2,label+" fully visible fixed control "+tag);
        buttons.put(new JSONObject().put("tag",tag).put("rect",rect(visible)).put("enabled",v.isEnabled()));
      }
      row.put("buttons",buttons);evidence.put(row);
    });
  }
  static void reader(FlowInstrumentation f,JSONArray evidence,String label){
    f.waitForIdleSync();
    ui(f,()->{
      TextView text=ai(f).fullReader;ScrollView scroll=(ScrollView)text.getParent();Rect viewport=new Rect(),back=new Rect();
      f.check(ai(f).reading&&scroll.isShown()&&scroll.getGlobalVisibleRect(viewport)&&viewport.height()>=f.activity.dp(96),label+" usable complete-reader viewport");
      View control=find(f,"creatorAiReadBack");
      f.check(control.isShown()&&control.getGlobalVisibleRect(back)&&back.height()>=f.activity.dp(40),label+" visible reader return");
      for(String tag:new String[]{"creatorAiPrepare","creatorAiImport","creatorAiValidate","creatorAiConfirm"})f.check(!find(f,tag).isShown(),label+" flow control hidden in reader "+tag);
      evidence.put(new JSONObject().put("state",label).put("viewport",rect(viewport)).put("return",rect(back)));
    });
  }
  static void marker(FlowInstrumentation f,JSONArray evidence,String phrase,boolean last,boolean bottom){
    final int[] range={-1,-1};
    ui(f,()->{
      TextView text=ai(f).fullReader;String body=text.getText().toString();range[0]=last?body.lastIndexOf(phrase):body.indexOf(phrase);range[1]=range[0]+phrase.length()-1;
      f.check(range[0]>=0&&text.getLayout()!=null,"reader has complete marker "+phrase);
      if(bottom)((ScrollView)text.getParent()).scrollTo(0,text.getBottom());
      else {int a=text.getLayout().getLineForOffset(range[0]),b=text.getLayout().getLineForOffset(range[1]);text.requestRectangleOnScreen(new Rect(0,text.getTotalPaddingTop()+text.getLayout().getLineTop(a),text.getWidth(),text.getTotalPaddingTop()+text.getLayout().getLineBottom(b)),true);}
    });
    f.waitForIdleSync();
    ui(f,()->{
      TextView text=ai(f).fullReader;Rect visible=new Rect();int a=text.getLayout().getLineForOffset(range[0]),b=text.getLayout().getLineForOffset(range[1]);
      int top=text.getTotalPaddingTop()+text.getLayout().getLineTop(a),end=text.getTotalPaddingTop()+text.getLayout().getLineBottom(b);
      f.check(text.isShown()&&text.getLocalVisibleRect(visible)&&visible.top<=top&&visible.bottom>=end,"entire Chinese marker line is actually visible: "+phrase);
      ScrollView scroll=(ScrollView)text.getParent();
      if(bottom)f.check(!scroll.canScrollVertically(1),"complete chunk scrolled to real bottom");
      evidence.put(new JSONObject().put("marker",phrase).put("offset",range[0]).put("lineTop",top).put("lineBottom",end).put("visible",rect(visible)).put("scrollY",scroll.getScrollY()).put("atBottom",!scroll.canScrollVertically(1)));
    });
  }
  static void candidateEvidence(FlowInstrumentation f,JSONArray evidence){
    f.waitForIdleSync();
    final int[] offsets={-1,-1};
    ui(f,()->{
      TextView text=ai(f).fullReader;String body=text.getText().toString(),quote=CreatorAiActualMainChecks.QUOTE;
      int heading=body.indexOf("关系与原文依据"),at=body.indexOf(quote),raw=body.indexOf("完整候选记录（含全文和来源身份，原样保留）");
      f.check(heading>=0&&at>heading&&raw>at+quote.length(),"candidate review shows heading and real quote before raw JSON");
      f.check(body.endsWith(ai(f).candidate.getJSONObject("analysis").toString(2)),"candidate review retains exact full original JSON suffix");
      offsets[0]=heading;offsets[1]=at+quote.length()-1;
      int first=text.getLayout().getLineForOffset(offsets[0]),last=text.getLayout().getLineForOffset(offsets[1]);
      text.requestRectangleOnScreen(new Rect(0,text.getTotalPaddingTop()+text.getLayout().getLineTop(first),text.getWidth(),text.getTotalPaddingTop()+text.getLayout().getLineBottom(last)),true);
    });
    f.waitForIdleSync();
    ui(f,()->{
      TextView text=ai(f).fullReader;Rect visible=new Rect();int first=text.getLayout().getLineForOffset(offsets[0]),last=text.getLayout().getLineForOffset(offsets[1]);
      int top=text.getTotalPaddingTop()+text.getLayout().getLineTop(first),bottom=text.getTotalPaddingTop()+text.getLayout().getLineBottom(last);
      f.check(text.getLocalVisibleRect(visible)&&visible.top<=top&&visible.bottom>=bottom,"relationship heading and entire real fixture quote visible together");
      evidence.put(new JSONObject().put("state","candidate heading and actual quote").put("lineTop",top).put("lineBottom",bottom).put("visible",rect(visible)));
    });
  }
  static void run(FlowInstrumentation f)throws Exception{
    Throwable failure=null;int first=f.assertions;JSONArray evidence=new JSONArray();List<String> shots=new ArrayList<>();
    try{
      orientation(f,false);
      ui(f,()->{f.check(f.activity.testing,"isolated actual Main");f.activity.openBusiness("creator");panel(f).load(CreatorAiActualMainChecks.ID);});
      tap(f,"creatorAiOpen");tap(f,"creatorAiPrepare");controls(f,evidence,"portrait frozen steps");shot(f,shots,"v54-ui-steps-portrait");
      tap(f,"creatorAiReadChunk");reader(f,evidence,"portrait first full chunk");marker(f,evidence,"全文起点",false,false);shot(f,shots,"v54-ui-chunk-head-portrait");tap(f,"creatorAiReadBack");
      ui(f,()->ai(f).chunks.setSelection(ai(f).plan.getJSONArray("blocks").length()-1));f.waitForIdleSync();
      tap(f,"creatorAiReadChunk");reader(f,evidence,"portrait last full chunk");marker(f,evidence,"全文终点",true,true);shot(f,shots,"v54-ui-chunk-tail-portrait");tap(f,"creatorAiReadBack");
      CreatorAiActualMainChecks.candidate(f,CreatorAiActualMainChecks.returns(ai(f).plan,false));
      controls(f,evidence,"portrait ready candidate");ui(f,()->f.check(ai(f).confirm.isEnabled(),"explicitly checked candidate is confirmable"));shot(f,shots,"v54-ui-candidate-steps");
      tap(f,"creatorAiReadCandidate");reader(f,evidence,"portrait complete candidate");candidateEvidence(f,evidence);shot(f,shots,"v54-ui-candidate-head");marker(f,evidence,"全文终点",false,false);shot(f,shots,"v54-ui-candidate-tail");tap(f,"creatorAiReadBack");
      tap(f,"creatorAiCancel");tap(f,"creatorAiReadChunk");
      orientation(f,true);reader(f,evidence,"landscape full chunk");marker(f,evidence,"全文终点",true,true);shot(f,shots,"v54-ui-chunk-tail-landscape");
      ui(f,()->f.check(ai(f).candidate.length()==0&&!ai(f).confirm.isEnabled(),"orientation does not resurrect cancelled candidate"));
      tap(f,"creatorAiReadBack");controls(f,evidence,"landscape returned steps");shot(f,shots,"v54-ui-steps-landscape");
      orientation(f,false);controls(f,evidence,"portrait returned steps");
      ui(f,()->f.check(ai(f).candidate.length()==0&&!ai(f).confirm.isEnabled(),"portrait return still needs explicit validation"));
      tap(f,"creatorAiValidate");CreatorAiActualMainChecks.idle(f);tap(f,"creatorAiConfirm");
      ui(f,()->{
        CreatorPanel page=panel(f);Rect visible=new Rect();
        f.check(!ai(f).open&&page.view==1&&!page.versionId.isEmpty(),"explicit save returns original historical graph");
        f.check(page.graph.isShown()&&page.graph.getGlobalVisibleRect(visible)&&visible.height()>=f.activity.dp(96),"saved original graph has usable viewport");
        f.check(page.edges.length()==1&&!page.save.isEnabled(),"saved historical graph contains one read-only relation");
        evidence.put(new JSONObject().put("state","saved original graph").put("analysisId",page.versionId).put("viewport",rect(visible)));
      });
      shot(f,shots,"v54-ui-saved-original-graph");
    }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
    finally{
      JSONObject report=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN_VISUAL":"FAIL_ACTUAL_MAIN_VISUAL").put("checks",f.assertions-first).put("screenshots",new JSONArray(shots)).put("visibleEvidence",evidence)
        .put("scope","single visual follow-up; actual Main; controlled local file; no old logic suite/online/Grant/credentials");
      if(failure!=null)report.put("failure",failure.toString());
      File out=new File(f.activity.getExternalFilesDir(null),f.shotFolder);out.mkdirs();Files.write(new File(out,"creator-ai-compact-ui-v54.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));
    }
  }
}
