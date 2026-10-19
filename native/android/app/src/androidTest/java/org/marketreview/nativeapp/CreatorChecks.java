package org.marketreview.nativeapp;
import org.json.*;
import android.widget.*;

final class CreatorChecks {
  static void run(FlowInstrumentation f)throws Exception {
    String body="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";
    String id="creator-"+java.util.UUID.randomUUID();BusinessStore store=f.activity.businessStore;
    JSONObject row=store.save("collections",new JSONObject().put("id",id).put("title","作者观点关系 · 隔离操作测试").put("channel","示例作者，非实证").put("status","completed").put("text",body).put("originalText",body)
      .put("asrResult",new JSONObject().put("text",body).put("durationSeconds",10).put("segments",new JSONArray().put(new JSONObject().put("start",0).put("end",10).put("text",body)))));
    store.save("collections",new JSONObject().put("id",id+"other").put("title","另一个文稿").put("text","未通过质检").put("status","imported"));
    JSONObject edge=new JSONObject().put("topic","光通信").put("from","光模块").put("to","光芯片").put("relation","使用").put("quote",body).put("polarity","supports").put("uncertainty","");
    String hash=CollectionQuality.bodyHash(body);JSONObject a=store.saveCreatorAnalysis(id,hash,"","作者观点",new JSONArray().put(edge));
    f.check(a.optJSONObject("sourceSnapshot")!=null&&a.getJSONObject("sourceSnapshot").optString("channel").equals("示例作者，非实证"),"analysis keeps author metadata snapshot");
    JSONObject metadataEdit=new JSONObject(row.toString()).put("channel","更正后的作者").put("sourceUrl","https://example.org/updated");store.save("collections",metadataEdit);
    f.check(record(store,id).getJSONArray("creatorAnalyses").getJSONObject(0).getJSONObject("sourceSnapshot").getString("channel").equals("示例作者，非实证"),"metadata edit cannot rewrite historical attribution");
    f.check(!CreatorAnalysis.sourceLabel(a,metadataEdit).contains("更正后的作者"),"historical display cannot use new source metadata");
    JSONObject old=new JSONObject(a.toString());old.remove("sourceSnapshot");CreatorAnalysis.validate(old);f.check(CreatorAnalysis.sourceLabel(old,metadataEdit).contains("缺少来源快照"),"older version without metadata labeled unknown");
    boolean rejected=false;try{store.saveCreatorAnalysis(id,hash,"","",new JSONArray().put(edge));}catch(Exception e){rejected=true;}f.check(rejected,"stale analysis revision cannot overwrite");
    rejected=false;try{store.saveCreatorAnalysis(id,hash,a.getString("id"),"",new JSONArray().put(new JSONObject(edge.toString()).put("to","不存在的实体")));}catch(Exception e){rejected=true;}f.check(rejected,"entity absent from quote rejected");
    store.save("collections",row);f.check(record(store,id).getJSONArray("creatorAnalyses").length()==1,"background stale save preserves analysis history");
    final CreatorPanel[] panel={null};f.ui(()->{try{f.activity.openBusiness("creator");panel[0]=((BusinessScreen)f.activity.getWindow().getDecorView().findViewWithTag("creatorDocuments").getParent().getParent()).creator;panel[0].load(id);panel[0].select(0);}catch(Exception e){throw new RuntimeException(e);}});
    f.ui(()->panel[0].type.setSelection(2));
    f.ui(()->{panel[0].documents.setSelection(panel[0].ids.indexOf(id+"other"));});
    f.ui(()->f.check(panel[0].id.equals(id),"changing only relation type still protects draft on document switch"));
    f.click("保存关系修订");f.check(record(store,id).getJSONArray("creatorAnalyses").length()==2,"native save creates revision");
    f.click("关系图");
    f.ui(()->panel[0].focus.setText("未出现的实体"));f.click("定位");f.ui(()->f.check(panel[0].graph.shown.isEmpty(),"graph focus only displays matching entities"));
    f.ui(()->panel[0].focus.setText("光芯片"));f.click("定位");f.ui(()->f.check(panel[0].graph.shown.size()==1,"graph focus includes incoming relation"));f.click("复位");f.shot("android-author-graph");
    f.ui(()->{CreatorPanel p=panel[0];long now=android.os.SystemClock.uptimeMillis();float y=f.activity.dp(42),x=p.graph.getWidth()*.5f;android.view.MotionEvent down=android.view.MotionEvent.obtain(now,now,0,x,y,0),up=android.view.MotionEvent.obtain(now,now+30,1,x,y,0);p.graph.dispatchTouchEvent(down);p.graph.dispatchTouchEvent(up);down.recycle();up.recycle();f.check(p.selected==0&&p.view==2,"native graph tap opens corresponding evidence");p.p.inputs.get("creatorUncertainty").setText("仍需公告交叉验证");});
    panel[0]=recreate(f);
    f.ui(()->{f.check(panel[0].p.value("creatorUncertainty").equals("仍需公告交叉验证"),"draft survives actual Activity recreation");f.check(panel[0].selected==0,"editing identity survives recreation");});
    f.click("保存关系修订");f.check(record(store,id).getJSONArray("creatorAnalyses").length()==3,"reconstructed draft saves against same revision");
    f.ui(()->panel[0].versions.setSelection(2));f.ui(()->{f.check(!panel[0].save.isEnabled(),"historical version read-only");f.check(!panel[0].p.inputs.get("creatorQuote").isEnabled()&&!panel[0].type.isEnabled(),"history editing controls disabled");f.check(!panel[0].selectedText.isEnabled(),"history selection copy disabled");});
    f.click("原文 / 编辑");f.shot("android-author-history");
    f.ui(()->panel[0].versions.setSelection(0));
    row.put("text",body+"更正");store.save("collections",row);
    f.ui(()->{try{panel[0].load(id);f.check(panel[0].edges.length()==0,"changed manuscript excluded before recreation");}catch(Exception e){throw new RuntimeException(e);}});
    panel[0]=recreate(f);f.ui(()->f.check(panel[0].edges.length()==0&&panel[0].versionId.isEmpty(),"recreation cannot promote stale analysis to current graph"));
    row.put("text",body);store.save("collections",row);f.ui(()->{try{panel[0].load(id);}catch(Exception e){throw new RuntimeException(e);}});
    f.ui(()->{panel[0].versions.setSelection(0);});f.ui(()->{try{panel[0].select(0);}catch(Exception e){throw new RuntimeException(e);}});f.click("移除选中关系");f.check(CreatorAnalysis.current(record(store,id)).getJSONArray("relations").length()==0,"empty analysis retained, not pending");
    row.put("text",body+"更正");store.save("collections",row);f.check(CreatorAnalysis.current(record(store,id)).length()==0,"modified body suppresses all historical relations");
    rejected=false;try{store.saveCreatorAnalysis(id,CollectionQuality.bodyHash(row.getString("text")),CreatorAnalysis.lastId(record(store,id)),"",new JSONArray().put(edge));}catch(Exception e){rejected=true;}f.check(rejected,"edited ASR source blocked by quality gate");
    JSONObject backup=store.backup();try(BusinessStore restored=new BusinessStore(f.getTargetContext(),"creator-restore-"+java.util.UUID.randomUUID()+".sqlite")){restored.restore(backup);f.check(record(restored,id).getJSONArray("creatorAnalyses").toString().equals(record(store,id).getJSONArray("creatorAnalyses").toString()),"all evidence snapshots roundtrip");}
  }
  static CreatorPanel recreate(FlowInstrumentation f)throws Exception {
    android.app.Instrumentation.ActivityMonitor monitor=f.addMonitor(MainActivity.class.getName(),null,false);f.ui(()->f.activity.recreate());android.app.Activity next=monitor.waitForActivityWithTimeout(5000);f.check(next instanceof MainActivity,"native Activity recreated");f.activity=(MainActivity)next;f.removeMonitor(monitor);f.waitForIdleSync();final CreatorPanel[] p={null};f.ui(()->p[0]=((BusinessScreen)f.activity.getWindow().getDecorView().findViewWithTag("creatorDocuments").getParent().getParent()).creator);return p[0];
  }
  static JSONObject record(BusinessStore s,String id)throws Exception {JSONArray all=s.read("collections");for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optString("id").equals(id))return all.getJSONObject(i);throw new Exception("missing fixture");}
}
