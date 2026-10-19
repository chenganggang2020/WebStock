package org.marketreview.nativeapp;
import android.os.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
final class AuctionHostChecks {
 static void history(FlowInstrumentation f,JSONObject fixture)throws Exception{
  String[] before={""};
  f.ui(()->{try{
   java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);List<JSONObject> items=(List<JSONObject>)field.get(f.activity);items.clear();
   items.add(new JSONObject().put("id","SH:stock:600000").put("symbol","sh600000").put("name","只读来源专项").put("auctionOpeningMeta",fixture.getJSONObject("metadata")));
   items.add(new JSONObject().put("id","SH:index:000001").put("symbol","sh000001").put("name","指数不适用"));before[0]=SourceAnalysisPacket.json(new JSONArray(items));
   f.activity.openAuctionAnalysis();f.activity.reloadAuctionHistory();
  }catch(Exception e){throw new RuntimeException(e);}});
  long end=SystemClock.elapsedRealtime()+15000;boolean[] ready={false};while(SystemClock.elapsedRealtime()<end){f.ui(()->ready[0]=f.activity.auctionHistoryLoaded&&!f.activity.auctionHistoryBusy);if(ready[0])break;Thread.sleep(30);}
  f.ui(()->{try{
   f.check(ready[0],"background archive read terminates");AuctionAnalysisScreen s=f.activity.auctionAnalysisScreen;
   f.check(s.sourceNote.getText().toString().contains("不适用1"),"unsupported index count explicit");
   JSONArray records=f.activity.auctionHistorySnapshots;boolean found=false;for(int i=0;i<records.length();i++)if(SourceAnalysisPacket.json(records.getJSONObject(i).getJSONObject("input")).equals(SourceAnalysisPacket.json(fixture.getJSONObject("input"))))found=true;
   f.check(found,"complete valid in-memory original retained while local archive checked");
   java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);f.check(before[0].equals(SourceAnalysisPacket.json(new JSONArray((List<?>)field.get(f.activity)))),"background reader leaves roster and quotes unchanged");
  }catch(Exception e){throw new RuntimeException(e);}});
  f.click("来源读取完整说明");f.ui(()->{f.check(f.activity.auctionAnalysisScreen.reader.getText().toString().contains("archiveRowsVisited"),"full source evidence visible");f.check(f.activity.closeInternalReader()&&!f.activity.closeInternalReader(),"source reader returns to selection not analysis");});
  f.shot("android-v35-auction-history");
 }
 static void run(FlowInstrumentation f)throws Exception{
  JSONObject fixture;try(InputStream in=f.getContext().getAssets().open("auction-analysis-fixture.json")){fixture=new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));}
  AuctionAnalysisChecks.run(f,fixture.getJSONArray("cases"));
  JSONObject sample=fixture.getJSONArray("cases").getJSONObject(0).getJSONObject("snapshot");String[] before={""};
  f.ui(()->{try{
   java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);
   List<JSONObject> roster=(List<JSONObject>)field.get(f.activity);JSONObject item=roster.get(0);
   item.put("id",sample.getString("instrumentId")).put("name","竞价专项·模拟材料").put("auctionOpeningMeta",new JSONObject().put("rawInput",sample.getJSONObject("input")).put("coverage",sample.getJSONObject("coverage")));
   before[0]=SourceAnalysisPacket.json(new JSONArray(roster));f.activity.open(item,true);f.activity.auctionView();
  }catch(Exception e){throw new RuntimeException(e);}});
  f.click("八形态 / 历史覆盖");f.waitForIdleSync();
  f.ui(()->{try{
   AuctionAnalysisScreen s=f.activity.auctionAnalysisScreen;f.check(s!=null&&s.isShown(),"native host opens internal auction analysis");
   f.check(s.list.getChildCount()==1,"only accepted exact-ID raw snapshot");((Button)s.list.getChildAt(0)).performClick();
   f.check(s.result.getInt("historyCount")==20&&s.data.getChildCount()==13,"actual native selection analyzes stored raw contract");
   s.reader.setText(AuctionAnalysisModel.detail(s.result)+"\n长材料:"+"完整记录".repeat(100000));s.show(2);
   Bundle state=new Bundle();f.activity.onSaveInstanceState(state);Parcel parcel=Parcel.obtain();state.writeToParcel(parcel,0);int bytes=parcel.dataSize();parcel.recycle();
   f.check(bytes<250000,"large complete auction reader is outside Binder");
   JSONObject marker=new JSONObject(state.getString("auctionAnalysisState"));f.check(marker.length()==2&&!marker.has("reader"),"digest marker only");
   f.check(new HostAuctionState(f.activity,true).read(marker).getString("reader").contains("长材料"),"private complete reader roundtrip");
   java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);f.check(before[0].equals(SourceAnalysisPacket.json(new JSONArray((List<?>)field.get(f.activity)))),"analysis leaves source and quote unchanged");
  }catch(Exception e){throw new RuntimeException(e);}});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{f.check(f.activity.auctionAnalysisScreen!=null&&f.activity.auctionAnalysisScreen.view==2,"host recreation restores reader page");f.check(f.activity.auctionAnalysisScreen.reader.getText().toString().contains("长材料"),"recreation keeps complete reader");f.check(f.activity.closeInternalReader()&&f.activity.closeInternalReader()&&!f.activity.closeInternalReader(),"internal back before homepage");});
  f.ui(()->{try{f.activity.auctionAnalysisScreen.choose(sample);}catch(Exception e){throw new RuntimeException(e);}});f.shot("android-v35-auction");
 }
}
