package org.marketreview.nativeapp;
import java.util.*;
import org.json.*;

/** Derived display only. The validated original report and archive schema stay unchanged. */
final class CffexPositionSummary {
 private CffexPositionSummary(){}
 static boolean citicName(String name){return name.replaceAll("[\\s\u3000]+","").matches("中信期货(?:[（(].*|有限.*)?");}
 static Object value(JSONObject row,String key){return row==null||row.isNull(key)?JSONObject.NULL:row.opt(key);}
 static JSONObject empty()throws Exception{
  JSONObject out=new JSONObject().put("member","中信期货").put("memberKey","").put("citic",true).put("complete",false);
  for(String key:new String[]{"long","short","longChange","shortChange","net","netChange"})out.put(key,JSONObject.NULL);
  return out;
 }
 static JSONObject contract(JSONObject contract)throws Exception{
  Map<String,JSONObject[]> paired=new TreeMap<>();JSONArray input=contract.getJSONArray("rows");
  for(int i=0;i<input.length();i++){
   JSONObject row=input.getJSONObject(i);String type=row.getString("type");
   if(!type.equals("long")&&!type.equals("short"))continue;
   paired.computeIfAbsent(row.getString("memberKey"),k->new JSONObject[2])[type.equals("long")?0:1]=row;
  }
  List<JSONObject> members=new ArrayList<>();JSONObject focus=empty();int candidates=0;
  for(Map.Entry<String,JSONObject[]> entry:paired.entrySet()){
   JSONObject buy=entry.getValue()[0],sell=entry.getValue()[1];
   boolean buyCitic=buy!=null&&citicName(buy.getString("member")),sellCitic=sell!=null&&citicName(sell.getString("member"));
   Object net=CffexDisclosureModel.difference(value(buy,"volume"),value(sell,"volume"));
   Object change=CffexDisclosureModel.difference(value(buy,"change"),value(sell,"change"));
   JSONObject member=new JSONObject().put("memberKey",entry.getKey()).put("member",(buy==null?sell:buy).getString("member"))
       .put("long",value(buy,"volume")).put("short",value(sell,"volume"))
       .put("longChange",value(buy,"change")).put("shortChange",value(sell,"change"))
       .put("net",net).put("netChange",change).put("complete",net!=JSONObject.NULL).put("citic",buyCitic||sellCitic);
   if(buy!=null&&sell!=null&&buyCitic!=sellCitic)member.put("net",JSONObject.NULL).put("netChange",JSONObject.NULL).put("complete",false).put("reason","同一标识的会员名称不一致");
   members.add(member);
   if(buyCitic||sellCitic){candidates++;focus=new JSONObject(member.toString());
    if(buy!=null&&sell!=null&&!(buyCitic&&sellCitic))focus=empty().put("reason","同一标识的会员名称不一致");}
  }
  if(candidates!=1)focus=empty().put("reason",candidates==0?"未披露可识别的中信期货席位":"中信会员标识不唯一，未跨标识合并");
  members.sort((a,b)->{int priority=Boolean.compare(b.optBoolean("citic"),a.optBoolean("citic"));
   return priority!=0?priority:a.optString("memberKey").compareTo(b.optString("memberKey"));});
  return new JSONObject().put("members",new JSONArray(members)).put("citic",focus);
 }
 static Object add(Object a,Object b){
  if(a==JSONObject.NULL||b==JSONObject.NULL)return JSONObject.NULL;
  double n=((Number)a).doubleValue()+((Number)b).doubleValue();
  return Double.isFinite(n)&&Math.abs(n)<=9007199254740000d?n:JSONObject.NULL;
 }
 static JSONObject citicTotal(JSONObject report)throws Exception{
  JSONArray contracts=report.getJSONArray("contracts");int covered=0,changeCovered=0;
  JSONObject total=new JSONObject();String[] fields={"long","short","longChange","shortChange","net","netChange"};
  for(String key:fields)total.put(key,0);
  for(int i=0;i<contracts.length();i++){
   JSONObject member=contract(contracts.getJSONObject(i)).getJSONObject("citic");
   if(!member.getBoolean("complete"))continue;
   covered++;if(!member.isNull("netChange"))changeCovered++;
   for(String key:fields)total.put(key,add(total.get(key),member.get(key)));
  }
  if(covered==0)for(String key:fields)total.put(key,JSONObject.NULL);
  return total.put("covered",covered).put("total",contracts.length()).put("changeCovered",changeCovered);
 }
 static String quantity(JSONObject row,String key){return row.isNull(key)?"未知":String.format(Locale.ROOT,"%.0f",row.optDouble(key));}
 static String netText(JSONObject row){
  if(row.isNull("net"))return "净头寸未知";
  double n=row.optDouble("net");return (n>0?"净多 ":n<0?"净空 ":"净持仓 ")+String.format(Locale.ROOT,"%.0f",Math.abs(n))+" 手";
 }
 static String changeText(JSONObject row){
  if(row.isNull("netChange"))return "当日净增减未知";
  double d=row.optDouble("netChange");if(d==0)return "当日净增减 0 手";
  return (d>0?"当日净增多 ":"当日净增空 ")+String.format(Locale.ROOT,"%.0f",Math.abs(d))+" 手";
 }
 static JSONObject dailyTotals(JSONArray reports)throws Exception{
  JSONObject scope=CffexDisclosureBatch.scope(reports);
  JSONObject citic=new JSONObject().put("longChange",0).put("shortChange",0),institutions=new JSONObject().put("longChange",0).put("shortChange",0);
  int contracts=0,citicCovered=0,listedCovered=0,longSeats=0,shortSeats=0;
  for(int r=0;r<reports.length();r++){
   JSONArray input=reports.getJSONObject(r).getJSONArray("contracts");
   for(int i=0;i<input.length();i++){
    JSONObject c=input.getJSONObject(i);contracts++;
    Object lc=value(c,"listedLongChange"),sc=value(c,"listedShortChange");
    if(lc!=JSONObject.NULL&&sc!=JSONObject.NULL)listedCovered++;
    institutions.put("longChange",add(institutions.get("longChange"),lc)).put("shortChange",add(institutions.get("shortChange"),sc));
    longSeats+=c.getJSONObject("rowCounts").getInt("long");shortSeats+=c.getJSONObject("rowCounts").getInt("short");
    JSONObject member=contract(c).getJSONObject("citic");
    if(member.getBoolean("complete")){
     citicCovered++;citic.put("longChange",add(citic.get("longChange"),member.get("longChange"))).put("shortChange",add(citic.get("shortChange"),member.get("shortChange")));
    }
   }
  }
  if(citicCovered==0)citic.put("longChange",JSONObject.NULL).put("shortChange",JSONObject.NULL);
  for(JSONObject item:new JSONObject[]{citic,institutions})item.put("netChange",CffexDisclosureModel.difference(item.get("longChange"),item.get("shortChange"))).put("total",contracts);
  citic.put("covered",citicCovered);institutions.put("covered",listedCovered).put("longSeats",longSeats).put("shortSeats",shortSeats);
  return scope.put("citic",citic).put("institutions",institutions);
 }
}
