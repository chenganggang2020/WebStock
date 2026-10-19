package org.marketreview.nativeapp;

import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import org.json.*;

/** Same source identity and frozen snapshot contract as Windows sector_watch_model. */
final class SectorWatchModel {
  static final String SCHEMA="native-sector-watch/v1";
  static final int MAX_BYTES=8*1024*1024;
  static void require(boolean ok,String why){if(!ok)throw new IllegalArgumentException(why);}
  static void active(java.util.function.BooleanSupplier cancel){require(!Thread.currentThread().isInterrupted()&&(cancel==null||!cancel.getAsBoolean()),"板块操作已取消");}
  static JSONObject query(String provider,String taxonomy,String code)throws JSONException{
    require(taxonomy.equals("industry")||taxonomy.equals("concept"),"仅支持行业/概念");
    require(provider.equals("eastmoney-public-board")||provider.equals("sina-public-"+taxonomy),"来源与分类不符");
    if(!code.isEmpty())require(code.matches(provider.equals("eastmoney-public-board")?"BK[0-9]{4}":taxonomy.equals("industry")?"(sw2_[0-9]+|new_[a-z0-9_]+)":"(chgn_[0-9]+|gn_[a-z0-9_]+)"),"来源板块代码无效");
    return new JSONObject().put("provider",provider).put("taxonomy",taxonomy).put("code",code).put("kind",code.isEmpty()?"catalog":"constituents");
  }
  static String key(JSONObject q)throws JSONException{JSONObject expected=query(q.getString("provider"),q.getString("taxonomy"),q.getString("code"));require(equal(q,expected),"查询身份不符");return q.getString("provider")+"|"+q.getString("taxonomy")+"|"+q.getString("code");}
  static boolean equal(Object a,Object b){
    if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;Iterator<String> keys=x.keys();while(keys.hasNext()){String k=keys.next();if(!y.has(k)||!equal(x.opt(k),y.opt(k)))return false;}return true;}
    if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!equal(x.opt(i),y.opt(i)))return false;return true;}
    if(a instanceof Number&&b instanceof Number)return Double.compare(((Number)a).doubleValue(),((Number)b).doubleValue())==0;
    return Objects.equals(a,b);
  }
  static String text(Object v,int max){String s=v instanceof String?((String)v).trim():"";require(!s.isEmpty()&&s.length()<=max,"来源名称或代码为空/过长");return s;}
  static Object number(Object v,boolean nonnegative,boolean positive){try{if(!(v instanceof Number)&&!(v instanceof String))return JSONObject.NULL;double d=Double.parseDouble(v.toString());return Double.isFinite(d)&&(!nonnegative||d>=0)&&(!positive||d>0)?d:JSONObject.NULL;}catch(Exception e){return JSONObject.NULL;}}
  static JSONObject identity(JSONObject q,String code,String sourceMarket)throws JSONException{
    String provider=q.getString("provider"),taxonomy=q.getString("taxonomy");JSONObject r=new JSONObject().put("provider",provider).put("taxonomy",taxonomy).put("code",code).put("boardCode",q.getString("code"));
    if(q.getString("kind").equals("catalog")){require(!code.isEmpty(),"板块代码为空");r.put("key",key(query(provider,taxonomy,code))).put("kind","board");}
    else{
      require(code.matches("[0-9]{6}")&&sourceMarket.length()<=20&&!sourceMarket.contains("|"),"成分身份无效");
      String market=provider.equals("eastmoney-public-board")?(sourceMarket.equals("1")?"SH":sourceMarket.equals("0")?"SZ":""):(sourceMarket.equals("sh")?"SH":sourceMarket.equals("sz")?"SZ":sourceMarket.equals("bj")?"BJ":"");
      boolean valid=market.equals("SH")&&code.matches("(60|68|90)[0-9]{4}")||market.equals("SZ")&&code.matches("(00|20|30)[0-9]{4}")||market.equals("BJ")&&code.matches("(4[0-9]|8[0-9]|92)[0-9]{4}");
      r.put("kind","stock").put("sourceMarket",sourceMarket).put("key",key(q)+"|"+sourceMarket+"|"+code).put("market",valid?market:JSONObject.NULL).put("type",valid?"stock":JSONObject.NULL).put("id",valid?market+":stock:"+code:JSONObject.NULL).put("canOpen",valid).put("identityReason",valid?"":"来源市场/证券类型未确认，不联动、不加入自选");
    }return r;
  }
  static JSONObject eastRow(JSONObject raw,JSONObject q)throws JSONException{
    String source="";Object v=raw.opt("f13");if(v instanceof Number&&Double.isFinite(((Number)v).doubleValue())&&((Number)v).doubleValue()==Math.floor(((Number)v).doubleValue()))source=String.valueOf(((Number)v).longValue());
    JSONObject r=identity(q,text(raw.opt("f12"),24),source);return r.put("name",text(raw.opt("f14"),160)).put("price",number(raw.opt("f2"),true,true)).put("changePct",number(raw.opt("f3"),false,false)).put("amount",number(raw.opt("f6"),true,false)).put("mainNetInflow",number(raw.opt("f62"),false,false));
  }
  static JSONObject sinaRow(JSONObject raw,JSONObject q)throws JSONException{
    String symbol=raw.optString("symbol").toLowerCase(Locale.ROOT);require(symbol.matches("(sh|sz|bj)[0-9]{6}"),"新浪未提供完整市场证券身份");String code=symbol.substring(2);require(!raw.has("code")||raw.optString("code").equals(code),"新浪代码与完整身份不一致");
    return identity(q,code,symbol.substring(0,2)).put("name",text(raw.opt("name"),160)).put("price",number(raw.opt("trade"),true,true)).put("changePct",number(raw.opt("changepercent"),false,false)).put("amount",number(raw.opt("amount"),true,false)).put("mainNetInflow",JSONObject.NULL);
  }
  static boolean quotes(JSONArray rows)throws JSONException{if(rows.length()==0)return false;for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);for(String f:new String[]{"price","changePct","amount"})if(!(r.opt(f) instanceof Number))return false;}return true;}
  static JSONObject snapshot(JSONObject q,Instant start,Instant end,int count,JSONArray rows,boolean complete,String error)throws JSONException{
    return new JSONObject().put("schema",SCHEMA).put("query",q).put("key",key(q)).put("startedAt",start.toString()).put("fetchedAt",end.toString()).put("observedAt",JSONObject.NULL).put("declaredTotal",count).put("coverageComplete",complete).put("quoteComplete",complete&&quotes(rows)).put("items",rows).put("failure",error).put("sourceTiming","来源未提供统一行情时点；仅记录本轮有界抓取窗口，不宣称同时快照");
  }
  static final class Assembly {
    final JSONObject input;final Instant start;final JSONArray items=new JSONArray();final Set<String> seen=new HashSet<>();int next=1,total=-1;
    Assembly(JSONObject q,Instant at)throws JSONException{key(q);input=new JSONObject(q.toString());start=at;require(at!=null,"开始时间缺失");}
    boolean append(JSONArray raw,int count,int page,long elapsed,boolean east)throws JSONException{
      require(elapsed>=0&&elapsed<=8000,"板块读取超过8秒总截止");require(page==next&&page<=100&&count>=0&&count<=10000,"分页顺序或总数无效");require(total<0||count==total,"分页总数变化");require(raw.length()<=(east?500:100)&&(count==0||raw.length()>0)&&items.length()+raw.length()<=count,"分页缺行或越界");
      List<JSONObject> added=new ArrayList<>();Set<String> ids=new HashSet<>(seen);
      for(int i=0;i<raw.length();i++){JSONObject row=east?eastRow(raw.getJSONObject(i),input):sinaRow(raw.getJSONObject(i),input);require(ids.add(row.getString("key")),"分页重复，未保存完整缓存");added.add(row);}
      for(JSONObject r:added)items.put(r);seen.clear();seen.addAll(ids);total=count;next++;return items.length()==total;
    }
    boolean east(JSONObject raw,int page,long elapsed)throws JSONException{require(input.getString("provider").equals("eastmoney-public-board")&&raw.opt("rc") instanceof Number&&raw.getDouble("rc")==0,"东方财富来源错误");JSONObject d=raw.getJSONObject("data");require(d.opt("total") instanceof Number,"来源总数缺失");double count=d.getDouble("total");require(count>=0&&count<=10000&&count==Math.floor(count),"来源总数无效");return append(d.getJSONArray("diff"),(int)count,page,elapsed,true);}
    boolean sina(JSONArray raw,int count,int page,long elapsed)throws JSONException{require(!input.getString("provider").equals("eastmoney-public-board")&&input.getString("kind").equals("constituents"),"新浪查询不符");return append(raw,count,page,elapsed,false);}
    JSONObject finish(Instant end,long elapsed,String error)throws JSONException{long duration=Duration.between(start,end).toMillis();require(duration>=0,"读取时间倒挂");boolean complete=total>=0&&items.length()==total&&error.isEmpty()&&elapsed>=0&&elapsed<=8000&&duration<=8000;JSONObject s=snapshot(input,start,end,total,new JSONArray(items.toString()),complete,complete?"":error.isEmpty()?"本轮未取得完整集合或超过总截止":error);validate(s);return s;}
  }
  static JSONArray find(JSONArray root,String label,int depth,int[] visited)throws JSONException{
    require(depth<=30&&++visited[0]<=100000,"目录层级或数量过大");JSONArray found=null;
    if(root.length()>0&&label.equals(root.opt(0))){require(root.opt(1) instanceof JSONArray,"目录分类结构无效");return root.getJSONArray(1);}
    for(int i=0;i<root.length();i++)if(root.opt(i) instanceof JSONArray){JSONArray candidate=find(root.getJSONArray(i),label,depth+1,visited);if(candidate!=null){require(found==null,"目录分类重复");found=candidate;}}return found;
  }
  static JSONObject sinaCatalog(JSONArray root,String taxonomy,Instant start,Instant end)throws JSONException{
    JSONObject q=query("sina-public-"+taxonomy,taxonomy,"");JSONArray declared=find(root,taxonomy.equals("industry")?"申万二级":"热门概念",0,new int[]{0});if(declared==null)declared=find(root,taxonomy.equals("industry")?"新浪行业":"概念板块",0,new int[]{0});require(declared!=null&&declared.length()>0&&declared.length()<=2048,"目录没有完整目标分类");
    JSONArray rows=new JSONArray();Set<String> ids=new HashSet<>();for(int i=0;i<declared.length();i++){JSONArray a=declared.getJSONArray(i);require(a.length()>2&&a.opt(2) instanceof String,"目录坏叶子，未声明完整");String code=a.getString(2);JSONObject r=identity(q,code,"");require(ids.add(code),"目录重复");r.put("name",text(a.opt(0),160));for(String f:new String[]{"price","changePct","amount","mainNetInflow"})r.put(f,JSONObject.NULL);rows.put(r);}JSONObject s=snapshot(q,start,end,declared.length(),rows,true,"");validate(s);return s;
  }
  static void validate(JSONObject s)throws JSONException{
    require(SCHEMA.equals(s.optString("schema"))&&s.has("observedAt")&&s.isNull("observedAt"),"快照格式或行情时点不符");JSONObject q=s.getJSONObject("query");require(s.getString("key").equals(key(q)),"快照查询不符");long duration=Duration.between(Instant.parse(s.getString("startedAt")),Instant.parse(s.getString("fetchedAt"))).toMillis();require(duration>=0,"读取时间倒挂");
    JSONArray rows=s.getJSONArray("items");double count=s.getDouble("declaredTotal");require(count>=-1&&count<=10000&&count==Math.floor(count)&&rows.length()<=10000&&(count<0||rows.length()<=count),"声明总数不符");require(s.opt("coverageComplete") instanceof Boolean&&s.opt("quoteComplete") instanceof Boolean,"完整标记缺失");boolean complete=s.getBoolean("coverageComplete");require(!complete||duration<=8000&&count==rows.length()&&s.optString("failure").isEmpty(),"不完整不得标完整");require(complete||!s.optString("failure").isEmpty(),"失败原因缺失");Set<String> ids=new HashSet<>();
    for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i),identity=identity(q,r.getString("code"),r.optString("sourceMarket"));Iterator<String> keys=identity.keys();while(keys.hasNext()){String k=keys.next();require(r.has(k)&&equal(r.opt(k),identity.opt(k)),"来源行身份不符");}text(r.opt("name"),160);require(ids.add(r.getString("key")),"结果重复");for(String f:new String[]{"price","changePct","amount","mainNetInflow"}){Object v=r.opt(f);require(r.has(f)&&(v==JSONObject.NULL||v instanceof Number&&Double.isFinite(((Number)v).doubleValue())),"行情格式无效");if(v instanceof Number&&(f.equals("price")||f.equals("amount")))require(f.equals("price")?((Number)v).doubleValue()>0:((Number)v).doubleValue()>=0,"行情值无效");}if(!q.getString("provider").equals("eastmoney-public-board"))require(r.isNull("mainNetInflow"),"新浪无主力净额来源");}
    require(s.getBoolean("quoteComplete")== (complete&&quotes(rows)),"报价完整性不符");require(s.toString().getBytes(StandardCharsets.UTF_8).length<=MAX_BYTES,"快照超过8MiB");
  }
  static List<JSONObject> sorted(JSONArray rows,String field,String filter)throws JSONException{require(Arrays.asList("changePct","amount","mainNetInflow","code").contains(field),"排序字段无效");List<JSONObject> out=new ArrayList<>();String needle=filter.trim().toLowerCase(Locale.ROOT);for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if((r.optString("name")+" "+r.optString("code")+" "+r.optString("id")).toLowerCase(Locale.ROOT).contains(needle))out.add(r);}out.sort((a,b)->{Object x=a.opt(field),y=b.opt(field);if(x instanceof Number!=y instanceof Number)return x instanceof Number?-1:1;if(x instanceof Number){int c=Double.compare(((Number)y).doubleValue(),((Number)x).doubleValue());if(c!=0)return c;}return a.optString("key").compareTo(b.optString("key"));});return out;}
}
