package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.widget.*;
import java.time.*;
import java.util.*;
import org.json.*;
final class VwapHostChecks {
 static void dialogReady(FlowInstrumentation f)throws Exception {
  f.waitForIdleSync();
  long deadline=android.os.SystemClock.uptimeMillis()+4000;
  while(android.os.SystemClock.uptimeMillis()<deadline){
   android.view.accessibility.AccessibilityNodeInfo root=f.getUiAutomation().getRootInActiveWindow();
   if(root!=null&&!root.findAccessibilityNodeInfosByText("显示 VWAP 主图线").isEmpty())return;
   Thread.sleep(100);
  }
  throw new AssertionError("VWAP parameter dialog did not become accessible");
 }
 static void run(FlowInstrumentation f)throws Exception{
  VwapChecks.run();
  f.ui(()->{try{
   long t=Instant.parse("2026-10-12T01:30:00Z").toEpochMilli();JSONArray rows=new JSONArray();ArrayList<Engine.Bar> bars=new ArrayList<>();
   for(int i=0;i<3;i++){double price=10+i*2;rows.put(new JSONObject().put("time",t+i*60000).put("open",price).put("high",price+1).put("low",price-1).put("close",price).put("volume",100).put("valid",true).put("closed",true));bars.add(new Engine.Bar(t+i*60000,price,price+1,price-1,price,100,true,true));}
   MarketChart c=new MarketChart(f.activity,null);c.vwapEnabled=true;c.vwapRows=rows;c.vwapMeta=new JSONObject().put("volumeUnit","手").put("adjustment","none");c.vwapPeriod="minute";c.setSeries(bars,"分时",true);
   f.check(c.vwapData.values[2]==12,"Android source adapter aligned approximation");
   int count=c.count,end=c.end;c.vwapMode="actual-amount";c.recalculate();f.check(!Double.isFinite(c.vwapData.values[2]),"missing amount/units stays unknown");f.check(count==c.count&&end==c.end,"VWAP keeps fixed minute extent");
   c.vwapMode="legacy-close-approx";c.recalculate();c.measure(android.view.View.MeasureSpec.makeMeasureSpec(390,android.view.View.MeasureSpec.EXACTLY),android.view.View.MeasureSpec.makeMeasureSpec(720,android.view.View.MeasureSpec.EXACTLY));c.layout(0,0,390,720);
   Bitmap on=Bitmap.createBitmap(390,720,Bitmap.Config.ARGB_8888);c.draw(new Canvas(on));c.vwapEnabled=false;
   Bitmap off=Bitmap.createBitmap(390,720,Bitmap.Config.ARGB_8888);c.draw(new Canvas(off));f.check(!on.sameAs(off),"actual native overlay rendered");on.recycle();off.recycle();
   bars.get(0).time++;c.setSeries(bars,"分时",true);f.check(!c.vwapError.isEmpty()&&c.vwapData.values.length==0,"wrong timestamp refuses old series");
   java.lang.reflect.Field roster=MainActivity.class.getDeclaredField("instruments");roster.setAccessible(true);
   JSONObject item=((java.util.List<JSONObject>)roster.get(f.activity)).get(0);item.put("dayMeta",new JSONObject().put("volumeUnit","shares").put("adjustment","none"));
   f.activity.open(item,true);f.activity.period("day");f.activity.parameters();
  }catch(Exception e){throw new RuntimeException(e);}});
  dialogReady(f);
  f.dialogClick("显示 VWAP 主图线");
  f.dialogClick("取消");f.check(!f.activity.chart.vwapEnabled,"cancel unchanged");
  f.ui(()->f.activity.parameters());dialogReady(f);
  f.dialogClick("显示 VWAP 主图线");
  f.dialogClick("应用");
  f.check(f.activity.chart.vwapEnabled&&f.activity.reference.vwapEnabled,"both native chart panes enabled");
  f.check(f.activity.explanation().contains("VWAP 主图"),"explanation includes actual selected point provenance");
  f.check(f.activity.getSharedPreferences("native-review-tests",0).getBoolean("vwapEnabled",false),"native preference persisted");
  f.shot("android-v35-vwap");
  SourceHistoryChecks.recreateActivity(f);f.check(f.activity.chart.vwapEnabled,"rotation/recreation restores preference");
 }
}
