package org.marketreview.nativeapp;
import java.time.Instant;
import java.util.*;
import org.json.*;

/** Author assertions with immutable evidence revisions; no fact or security inference. */
final class CreatorAnalysis {
  static final String SPEC="creator-industry-graph/v2";
  static final List<String> TYPES=Arrays.asList("使用","组成","制造","需求驱动","替代","技术路线","观点关联");
  static final List<String> SOURCE_FIELDS=Arrays.asList("id","title","channel","publishedAt","sourceUrl");
  static JSONObject sourceSnapshot(JSONObject row)throws Exception {JSONObject result=new JSONObject();for(String key:SOURCE_FIELDS)result.put(key,row.optString(key));return result;}
  static JSONObject identity(JSONObject row)throws Exception {
    String author="";
    try{java.net.URI uri=new java.net.URI(row.optString("sourceProfile"));java.util.regex.Matcher match=java.util.regex.Pattern.compile("^/user/([A-Za-z0-9_-]{6,200})/?$").matcher(uri.getPath()==null?"":uri.getPath());
      if("https".equals(uri.getScheme())&&Arrays.asList("douyin.com","www.douyin.com").contains(uri.getHost()==null?"":uri.getHost().toLowerCase(Locale.ROOT))&&uri.getUserInfo()==null&&(uri.getPort()==-1||uri.getPort()==443)&&match.matches())author="douyin:"+match.group(1);
    }catch(java.net.URISyntaxException ignored){}
    if(author.isEmpty()&&row.optString("legacySource").equals("expert_observations")){
      Object value=CollectionQuality.object(row,"legacyOriginal").opt("channel_id");String channel=value instanceof String?(String)value:value instanceof Number&&((Number)value).doubleValue()>0&&((Number)value).doubleValue()<=9007199254740991.0&&Math.floor(((Number)value).doubleValue())==((Number)value).doubleValue()?Long.toString(((Number)value).longValue()):"";
      if(channel.matches("^[1-9][0-9]{0,15}$"))author="legacy-webstock:channel:"+channel;
    }
    String root=row.optString("sourceRootId");if(root.isEmpty())root=row.optString("id");if(author.isEmpty())author="document:"+root;
    return new JSONObject().put("authorKey",author).put("workKey",author+"|"+root);
  }
  static String sourceLabel(JSONObject analysis,JSONObject row){
    if(analysis.length()!=0&&!analysis.has("sourceSnapshot"))return "该分析缺少来源快照；不使用当前文稿来源代替。";
    JSONObject source=analysis.length()==0?row:analysis.optJSONObject("sourceSnapshot");
    return source.optString("channel")+" · "+source.optString("publishedAt")+" · "+source.optString("title")+"\n"+source.optString("sourceUrl");
  }
  static boolean eligible(JSONObject row) throws Exception {
    return CollectionQuality.evaluate(row).getBoolean("eligibleForAnalysis") && (!row.has("legacyOriginal") || CollectionQuality.object(row,"legacyOriginal").optString("evidence_level").equals("primary"));
  }
  static JSONObject relation(JSONObject edge,String body) throws Exception {
    JSONObject result=new JSONObject();
    for(String key:Arrays.asList("topic","from","to","relation","quote","polarity","uncertainty")) {
      BusinessStore.require(edge.opt(key) instanceof String || key.equals("uncertainty")&&!edge.has(key),"关系字段必须为文字");
      result.put(key,CollectionQuality.trim(edge.optString(key)));
    }
    String quote=result.getString("quote");
    BusinessStore.require(quote.length()>=12&&quote.length()<=500&&body.contains(quote),"引用必须为12至500字连续原文");
    for(String key:Arrays.asList("from","to")) {String entity=result.getString(key);BusinessStore.require(!entity.isEmpty()&&entity.length()<=100&&quote.toLowerCase(Locale.ROOT).contains(entity.toLowerCase(Locale.ROOT)),"实体须为1至100字，且出现在引文中");}
    BusinessStore.require(!result.getString("topic").isEmpty()&&result.getString("topic").length()<=80,"主题须为1至80字");
    BusinessStore.require(TYPES.contains(result.getString("relation"))&&Arrays.asList("supports","contradicts").contains(result.getString("polarity")),"关系类型或方向无效");
    BusinessStore.require(result.getString("uncertainty").length()<=500,"疑点说明不可超过500字");
    return result.put("status","author_claim");
  }
  static void validate(JSONObject a) throws Exception {
    if(a.has("sourceIdentity")){
      JSONObject value=a.optJSONObject("sourceIdentity");BusinessStore.require(value!=null&&value.length()==2,"来源身份格式无效");
      for(String key:Arrays.asList("authorKey","workKey"))BusinessStore.require(value.opt(key) instanceof String&&!value.optString(key).isEmpty()&&value.optString(key).length()<=8192,"来源身份字段无效");
    }
    if(a.has("sourceSnapshot")){
      JSONObject source=a.optJSONObject("sourceSnapshot");BusinessStore.require(source!=null,"来源快照格式无效");
      Iterator<String> keys=source.keys();while(keys.hasNext()){String key=keys.next();BusinessStore.require(SOURCE_FIELDS.contains(key)&&source.opt(key) instanceof String&&source.getString(key).length()<=8192,"来源快照字段无效或超过8192字");}
      for(String key:SOURCE_FIELDS)BusinessStore.require(source.has(key),"来源快照字段缺失");
    }
    BusinessStore.require(!a.optString("id").isEmpty()&&a.optString("id").length()<=100&&a.optString("specVersion").equals(SPEC),"分析身份或规则版本无效");
    String text=a.optString("bodyText");
    BusinessStore.require(a.opt("bodyText") instanceof String&&CollectionQuality.trim(text).length()>=30&&text.length()<=200000&&a.optString("bodyHash").equals(CollectionQuality.bodyHash(text)),"分析正文快照或哈希无效");
    BusinessStore.require(a.opt("summary") instanceof String&&a.optString("summary").length()<=1500&&a.opt("model") instanceof String&&!a.optString("model").isEmpty()&&a.optString("model").length()<=100,"分析摘要或来源无效");
    Instant.parse(a.getString("analyzedAt"));JSONArray edges=a.optJSONArray("relations");BusinessStore.require(edges!=null&&edges.length()<=500,"单篇关系不可超过500条");
    for(int i=0;i<edges.length();i++){JSONObject edge=edges.getJSONObject(i);relation(edge,text);BusinessStore.require(edge.optString("status").equals("author_claim"),"作者观点不能升级为事实");}
  }
  static void validateHistory(JSONObject row) throws Exception {
    if(!row.has("creatorAnalyses"))return;
    JSONArray history=row.optJSONArray("creatorAnalyses");BusinessStore.require(history!=null&&history.length()<=100,"单篇分析历史不可超过100版");
    Set<String> ids=new HashSet<>();for(int i=0;i<history.length();i++){JSONObject a=history.getJSONObject(i);validate(a);BusinessStore.require(ids.add(a.getString("id")),"分析历史身份重复");}
  }
  static String lastId(JSONObject row) throws Exception {JSONArray a=CollectionQuality.array(row,"creatorAnalyses");return a.length()==0?"":a.getJSONObject(a.length()-1).getString("id");}
  static JSONObject current(JSONObject row) throws Exception {
    if(!eligible(row))return new JSONObject();
    JSONArray history=CollectionQuality.array(row,"creatorAnalyses");String hash=CollectionQuality.bodyHash(row.optString("text"));
    for(int i=history.length()-1;i>=0;i--){JSONObject a=history.getJSONObject(i);if(a.optString("bodyHash").equals(hash)&&a.optString("specVersion").equals(SPEC))return a;}
    return new JSONObject();
  }
}
