package org.marketreview.nativeapp;
import org.json.*;
import java.util.*;
import java.util.regex.Pattern;
/** Complete filtered cached universe first; existing screen pagination follows this result. */
final class DarkStockRank {
 private static final Pattern INTEGER=Pattern.compile("^-?(0|[1-9][0-9]{0,17})$");
 private static void need(boolean ok,String reason){if(!ok)throw new IllegalArgumentException(reason);}
 private static final class Entry {final JSONObject row;final long value;Entry(JSONObject row,long value){this.row=row;this.value=value;}}
 static JSONObject apply(JSONArray rows,String metric,String direction)throws JSONException{
  need(rows!=null&&rows.length()<=6000,"Ranking input exceeds existing cache limit");
  need(Arrays.asList("amount","visible","combined").contains(metric),"Unknown ranking metric");
  need(Arrays.asList("source","inflow","outflow").contains(direction),"Unknown ranking direction");
  String field=metric.equals("amount")?"darkNetCents":metric.equals("visible")?"visibleNetCents":"combinedNetCents";
  int missing=0,zero=0,unreconciled=0;List<Entry> selected=new ArrayList<>();
  for(int i=0;i<rows.length();i++){
   Object value=rows.opt(i);need(value instanceof JSONObject,"Ranking row is not an object");JSONObject row=(JSONObject)value;Object money=row.opt(field);
   if(!Boolean.TRUE.equals(row.opt("reconciled")))unreconciled++;
   if(money==null||money==JSONObject.NULL){missing++;if(direction.equals("source"))selected.add(new Entry(row,0));continue;}
   need(money instanceof String&&INTEGER.matcher((String)money).matches(),"Ranking amount is not integer cents");
   long n=Long.parseLong((String)money);need(n>=-900719925474099100L&&n<=900719925474099100L,"Ranking amount exceeds source limit");if(n==0)zero++;
   if(direction.equals("source")||(direction.equals("inflow")&&n>0)||(direction.equals("outflow")&&n<0))selected.add(new Entry(row,n));
  }
  // List.sort is stable, so equal values retain the original provider/watchlist order.
  if(!direction.equals("source"))selected.sort((a,b)->direction.equals("inflow")?Long.compare(b.value,a.value):Long.compare(a.value,b.value));
  JSONArray ranked=new JSONArray();for(Entry entry:selected)ranked.put(entry.row);
  return new JSONObject().put("rows",ranked).put("inputCount",rows.length()).put("rankedCount",ranked.length()).put("missingMetricCount",missing).put("zeroMetricCount",zero).put("unreconciledCount",unreconciled).put("metric",metric).put("direction",direction).put("paginationSnapshotConsistent",false);
 }
}
