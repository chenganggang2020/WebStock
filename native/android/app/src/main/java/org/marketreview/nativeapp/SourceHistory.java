package org.marketreview.nativeapp;
import java.util.*;
import java.util.regex.*;
import org.json.*;

/** Read-only legacy receipts. No media, session, automatic plan or execution consent. */
final class SourceHistory {
  static final String[] COUNTS={"work_count","discovered_count","candidate_count","detailed_count","detail_error_count","transcription_attempted_count","transcribed_count","media_missing_count","transcript_error_count","added_count","updated_count","unchanged_count"};
  static String clean(String text) {
    Matcher m=Pattern.compile("https?://[^\\s<>\"'，。；！？、（）【】]+").matcher(text);
    StringBuffer out=new StringBuffer();while(m.find())m.appendReplacement(out,Matcher.quoteReplacement(m.group().split("[?#]",2)[0]));m.appendTail(out);return out.toString();
  }
  static String text(JSONObject value,String key,int max) throws Exception {
    Object raw=value.opt(key);BusinessStore.require(raw==null||raw instanceof String,"历史文本字段无效："+key);
    String s=raw==null?"":(String)raw;BusinessStore.require(s.length()<=max,"历史文本过长："+key);return clean(s);
  }
  static JSONObject row(JSONObject in) throws Exception {
    JSONObject r=new JSONObject();for(String k:new String[]{"id","channelId","author","status","trigger","startedAt","finishedAt","message","error"})
      r.put(k,text(in,k,k.equals("message")||k.equals("error")?4000:k.equals("author")?300:k.equals("id")?100:k.equals("channelId")?60:k.endsWith("At")?64:80));
    BusinessStore.require(r.getString("id").matches("legacy-webstock:sync-run:[1-9][0-9]*"),"旧轮次身份无效");
    BusinessStore.require(!r.getString("startedAt").isEmpty()&&!r.getString("status").isEmpty(),"历史缺时间或状态");
    BusinessStore.require(in.optJSONObject("counts")!=null&&in.optJSONArray("items")!=null,"历史缺计数或明细");
    JSONObject counts=new JSONObject(),raw=in.getJSONObject("counts");
    for(String k:COUNTS)if(raw.has(k)) {Object v=raw.get(k);double d=v instanceof Number?((Number)v).doubleValue():Double.NaN;
      BusinessStore.require(v==JSONObject.NULL||(Double.isFinite(d)&&d>=0&&d<=1e9&&Math.floor(d)==d),"旧计数无效");counts.put(k,v);}
    r.put("counts",counts);JSONArray items=new JSONArray(),values=in.getJSONArray("items");HashSet<String> seen=new HashSet<>();
    BusinessStore.require(values.length()<=2000,"单轮明细超过2000条");
    for(int i=0;i<values.length();++i) {JSONObject x=values.getJSONObject(i),item=new JSONObject();
      for(String k:new String[]{"contentId","title","sourceUrl","detail_status","transcription_status","message"}) item.put(k,text(x,k,4000));
      String id=item.getString("contentId");BusinessStore.require(!id.isEmpty()&&id.length()<=100&&seen.add(id),"明细身份缺失或重复");
      for(String k:new String[]{"media_bytes","elapsed_seconds"})if(x.has(k)) {Object v=x.get(k);double d=v instanceof Number?((Number)v).doubleValue():Double.NaN;
        BusinessStore.require(v==JSONObject.NULL||(Double.isFinite(d)&&d>=0&&d<=9e15),"明细数值无效");item.put(k,v);}
      items.put(item);
    }return r.put("items",items);
  }
  static JSONArray validate(JSONObject file) throws Exception {
    BusinessStore.require(file.optString("schema").equals("native-source-history-v1")&&file.optJSONArray("runs")!=null,"不是旧来源历史档案");
    JSONArray rows=file.getJSONArray("runs"),out=new JSONArray();BusinessStore.require(rows.length()<=10000,"档案超过一万轮，请分批");
    HashSet<String> ids=new HashSet<>();int items=0;
    for(int i=0;i<rows.length();++i) {JSONObject r=row(rows.getJSONObject(i));BusinessStore.require(ids.add(r.getString("id")),"重复旧轮次身份");
      items+=r.getJSONArray("items").length();BusinessStore.require(items<=50000,"档案明细超过五万条");out.put(r);}
    return out;
  }
  static JSONObject bundle(JSONArray rows) throws Exception {return new JSONObject().put("schema","native-source-history-v1").put("runs",rows);}
  static String canonical(Object v) throws Exception {
    if(v instanceof JSONObject) {JSONObject j=(JSONObject)v;TreeSet<String> keys=new TreeSet<>();Iterator<String> i=j.keys();while(i.hasNext())keys.add(i.next());StringBuilder s=new StringBuilder("{");for(String k:keys)s.append(JSONObject.quote(k)).append(':').append(canonical(j.get(k))).append(',');return s.append('}').toString();}
    if(v instanceof JSONArray) {JSONArray a=(JSONArray)v;StringBuilder s=new StringBuilder("[");for(int i=0;i<a.length();++i)s.append(canonical(a.get(i))).append(',');return s.append(']').toString();}
    if(v instanceof Number)return new java.math.BigDecimal(v.toString()).stripTrailingZeros().toPlainString();
    return v instanceof String?JSONObject.quote((String)v):String.valueOf(v);
  }
}
