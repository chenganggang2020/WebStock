package org.marketreview.nativeapp;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.time.format.*;
import java.util.*;
import java.util.regex.*;
import org.json.*;
final class FuturesMonitorModel {
 static final String SCHEMA="webstock.native-futures-monitor.v1";
 static final ZoneOffset BEIJING=ZoneOffset.ofHours(8);
 static final DateTimeFormatter LABEL=DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss").withResolverStyle(ResolverStyle.STRICT);
 static void require(boolean ok,String why){if(!ok)throw new IllegalArgumentException(why);}
 static JSONArray catalog()throws Exception{return new JSONArray().put(new JSONObject().put("symbol","IF0").put("product","IF").put("name","沪深300股指期货")).put(new JSONObject().put("symbol","IH0").put("product","IH").put("name","上证50股指期货")).put(new JSONObject().put("symbol","IC0").put("product","IC").put("name","中证500股指期货")).put(new JSONObject().put("symbol","IM0").put("product","IM").put("name","中证1000股指期货"));}
 static String sourceUrl(String s){require(Arrays.asList("IF0","IH0","IC0","IM0").contains(s),"非已核目录中的主力连续序列");return "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_"+s+"=/InnerFuturesNewService.getFewMinLine?symbol="+s+"&type=1";}
 static Object number(Object v){if(!(v instanceof Number)&&!(v instanceof String))return JSONObject.NULL;try{double n=Double.parseDouble(v.toString());return Double.isFinite(n)&&Math.abs(n)<=9007199254740991d?n:JSONObject.NULL;}catch(Exception e){return JSONObject.NULL;}}
 static Object rounded(double n,int digits){double k=Math.pow(10,digits);return Double.isFinite(n)?Math.copySign(Math.floor(Math.abs(n*k)+.5),n)/k:JSONObject.NULL;}
 static Instant event(String label){try{if(!label.matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}"))return null;return LocalDateTime.parse(label,LABEL).toInstant(BEIJING);}catch(Exception e){return null;}}
 static String hash(String input)throws Exception{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();for(byte v:bytes)b.append(String.format(Locale.ROOT,"%02x",v&255));return b.toString();}
 static JSONObject parse(String symbol,String payload,String receivedAt)throws Exception{
  String url=sourceUrl(symbol);require(payload!=null&&payload.getBytes(StandardCharsets.UTF_8).length<=4*1024*1024,"期货响应超过4MiB边界");require(receivedAt!=null&&receivedAt.matches(".*(Z|[+-]\\d{2}:\\d{2})$"),"接收时间必须包含明确时区");Instant cutoff=OffsetDateTime.parse(receivedAt).toInstant();
  JSONObject r=new JSONObject().put("schema",SCHEMA).put("symbol",symbol).put("instrumentId","CFFEX:continuous:"+symbol).put("contractKind","continuous-series").put("expiry",JSONObject.NULL).put("exchangeTradingDay",JSONObject.NULL).put("sourceDate",JSONObject.NULL).put("receivedAt",receivedAt).put("rawPayload",payload).put("availability","unavailable").put("reason","公开源未返回可用一分钟价量仓").put("rows",new JSONArray()).put("audit",new JSONArray()).put("summary",new JSONObject()).put("source",new JSONObject().put("provider","新浪财经公开期货行情").put("dataSource","sina-futures-1m").put("url",url).put("intervalMinutes",1).put("volumeUnit","手（旧页来源语义）").put("transportVerified",false).put("realtimeGuaranteed",false));
  r.put("id",hash("CFFEX:continuous:"+symbol+"\n"+receivedAt+"\n"+payload));Matcher declared=Pattern.compile("^\\s*var\\s+_([A-Za-z0-9]+)\\s*=").matcher(payload);if(declared.find()&&!symbol.equals(declared.group(1)))return r.put("reason","响应声明序列与请求身份不一致");Matcher match=Pattern.compile("=\\s*\\((\\[.*\\])\\);?\\s*$",Pattern.DOTALL).matcher(payload);if(!match.find())return r;JSONArray input;try{input=new JSONArray(match.group(1));}catch(JSONException e){return r;}require(input.length()<=50000,"期货响应行数超过边界");TreeMap<String,JSONObject> valid=new TreeMap<>();JSONArray audit=new JSONArray();String day="";
  for(int i=0;i<input.length();i++){
   JSONObject item=input.optJSONObject(i);String label=item==null?"":item.optString("d","");Instant t=event(label);String reason="";Object p=number(item==null?null:item.opt("c")),v=number(item==null?null:item.opt("v")),oi=number(item==null?null:item.opt("p"));
   if(item==null||t==null)reason="来源日期/时间无效";else if(t.isAfter(cutoff))reason="来源时点晚于接收时点，排除";else if(!(p instanceof Number)||((Number)p).doubleValue()<=0||!(v instanceof Number)||((Number)v).doubleValue()<0||!(oi instanceof Number)||((Number)oi).doubleValue()<0)reason="价格、成交量或持仓量缺失/无效；不补零";
   audit.put(new JSONObject().put("sourceIndex",i).put("raw",input.get(i)).put("reason",reason.isEmpty()?JSONObject.NULL:reason));if(!reason.isEmpty())continue;
   JSONObject row=new JSONObject().put("time",label).put("eventTime",t.toString()).put("sourceIndex",i).put("open",number(item.opt("o"))).put("high",number(item.opt("h"))).put("low",number(item.opt("l"))).put("price",p).put("volume",v).put("openInterest",oi);valid.put(label,row);if(label.substring(0,10).compareTo(day)>0)day=label.substring(0,10);
  }
  JSONArray rows=new JSONArray();for(Map.Entry<String,JSONObject> e:valid.entrySet())if(e.getKey().startsWith(day))rows.put(e.getValue());for(int i=0;i<audit.length();i++){JSONObject a=audit.getJSONObject(i);if(!a.isNull("reason"))continue;String label=a.getJSONObject("raw").getString("d");if(!label.startsWith(day))a.put("reason","非本响应最新来源日期；原记录保留");else if(valid.get(label).getInt("sourceIndex")!=i)a.put("reason","同来源时点被后列记录覆盖（旧源规则）；原记录保留");}
  r.put("audit",audit).put("rows",rows);if(rows.length()==0)return r;JSONObject first=rows.getJSONObject(0),last=rows.getJSONObject(rows.length()-1);boolean adjacent=rows.length()>1&&Duration.between(event(rows.getJSONObject(rows.length()-2).getString("time")),event(last.getString("time"))).toMillis()==60000;Object delta=JSONObject.NULL,oiDelta=JSONObject.NULL,change=JSONObject.NULL;String state="unavailable";
  if(adjacent){JSONObject prev=rows.getJSONObject(rows.length()-2);delta=rounded(last.getDouble("price")-prev.getDouble("price"),4);oiDelta=rounded(last.getDouble("openInterest")-prev.getDouble("openInterest"),0);state=((Number)delta).doubleValue()>=0?(((Number)oiDelta).doubleValue()>=0?"price-up-oi-up":"price-up-oi-down"):(((Number)oiDelta).doubleValue()>=0?"price-down-oi-up":"price-down-oi-down");}
  double baseline=first.opt("open") instanceof Number&&first.getDouble("open")!=0?first.getDouble("open"):first.getDouble("price");if(baseline>0)change=rounded((last.getDouble("price")/baseline-1)*100,2);
  JSONObject summary=new JSONObject().put("observedAt",last.get("time")).put("price",last.get("price")).put("minuteVolume",last.get("volume")).put("openInterest",last.get("openInterest")).put("minutePriceChange",delta).put("openInterestChange",oiDelta).put("sessionChangePct",change).put("baselineLabel","响应最新来源日期首条加载记录的开盘价/收盘价；非保证全日开盘").put("baselineTime",first.get("time")).put("positioningState",state).put("adjacentMinute",adjacent);
  return r.put("availability","available").put("reason",adjacent?JSONObject.NULL:"相邻一分钟窗口不足或存在断档；变化量不可用").put("summary",summary).put("sourceDate",day);
 }
 static String canonical(Object o)throws Exception{
  if(o instanceof JSONObject){JSONObject j=(JSONObject)o;List<String> keys=new ArrayList<>();Iterator<String> it=j.keys();while(it.hasNext())keys.add(it.next());Collections.sort(keys);StringBuilder b=new StringBuilder("{");for(String k:keys){if(b.length()>1)b.append(',');b.append(JSONObject.quote(k)).append(':').append(canonical(j.get(k)));}return b.append('}').toString();}
  if(o instanceof JSONArray){JSONArray a=(JSONArray)o;StringBuilder b=new StringBuilder("[");for(int i=0;i<a.length();i++){if(i>0)b.append(',');b.append(canonical(a.get(i)));}return b.append(']').toString();}
  if(o==null||o==JSONObject.NULL)return "null";if(o instanceof String)return JSONObject.quote((String)o);if(o instanceof Number)return JSONObject.numberToString((Number)o);return o.toString();
 }
 static JSONObject validate(JSONObject s)throws Exception{require("available".equals(s.optString("availability")),"失败/缺数响应不能覆写成功历史");JSONObject parsed=parse(s.getString("symbol"),s.getString("rawPayload"),s.getString("receivedAt"));require(canonical(parsed).equals(canonical(s)),"快照内容与实际响应解析不一致");return parsed;}
}

