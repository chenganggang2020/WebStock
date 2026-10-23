package org.marketreview.nativeapp;
import java.time.*;
import java.util.*;
import org.json.*;
final class VwapChartInput {
 static Vwap.Series calculate(JSONArray rows,JSONObject meta,String period,String mode,String anchor){
  boolean minute=period.startsWith("minute");Vwap.Params p=new Vwap.Params();
  p.mode=mode;p.period=minute?"intraday":period;
  p.anchor=anchor.equals("auto")?(minute?"session":"loaded-window"):anchor;
  p.volumeUnit=meta.optString("volumeUnit","unknown");p.volumeToShares=meta.optDouble("volumeToShares");
  p.amountToCny=meta.optString("amountUnit").equals("CNY")?meta.optDouble("amountToCny"):Double.NaN;
  p.priceBasis=meta.optString("adjustment").equals("none")?"unadjusted":meta.optString("adjustment").isEmpty()?"unknown":"adjusted";
  if(mode.equals("actual-amount")&&!meta.optString("quantitySemantics").equals("incremental"))p.amountToCny=Double.NaN;
  long receipt=-1;try{receipt=OffsetDateTime.parse(meta.optString("checkedAt")).toInstant().toEpochMilli();}catch(Exception ignored){}
  ArrayList<Vwap.Point> points=new ArrayList<>();
  for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row==null)row=new JSONObject();Vwap.Point x=new Vwap.Point();
   double time=row.optDouble("time");if(Double.isFinite(time)&&time>=0&&time<=253402214400000.0)x.time=(long)time;
   x.session=x.time<0?"":Instant.ofEpochMilli(x.time).atOffset(ZoneOffset.ofHours(8)).toLocalDate().toString();
   x.high=row.optDouble("high");x.low=row.optDouble("low");x.close=row.optDouble("close");x.volume=row.optDouble("volume");x.amount=row.optDouble("amount");
   x.valid=row.optBoolean("valid");x.closed=row.optBoolean("closed");x.axisGap=minute&&!x.valid&&receipt>=0&&x.time>receipt;
   points.add(x);
  }
  p.anchorId=points.isEmpty()?"empty":Long.toString(points.get(0).time);p.coversFromOpen=false;
  return Vwap.calculate(points,p);
 }
}
