package org.marketreview.nativeapp;
import java.util.*;
import org.json.*;

final class CapitalHistoryCoverage {
 private CapitalHistoryCoverage(){}
 static String range(SortedSet<String> dates){return dates.isEmpty()?"无":dates.first()+" ～ "+dates.last()+" · "+dates.size()+"个日期";}
 static String caption(JSONArray daily,Collection<String> archives){
  SortedSet<String> days=new TreeSet<>(),saved=new TreeSet<>();
  for(int i=0;i<daily.length();i++){JSONObject row=daily.optJSONObject(i);String day=row==null?"":row.optString("label");if(TradingDaySelection.parse(day)!=null)days.add(day);}
  for(String day:archives)if(TradingDaySelection.parse(day)!=null)saved.add(day);
  return "已取得日线："+range(days)+"\n本机分时档案："+range(saved)+"\n仅已取得日期，不保证连续；未自动回补更早历史。";
 }
}
