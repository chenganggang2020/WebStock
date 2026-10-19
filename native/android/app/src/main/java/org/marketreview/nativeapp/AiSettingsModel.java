package org.marketreview.nativeapp;
import org.json.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
public final class AiSettingsModel {
 private AiSettingsModel(){}
 static void need(boolean ok,String message)throws Exception{if(!ok)throw new Exception(message);}
 static String hash(byte[] bytes)throws Exception{byte[] b=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder s=new StringBuilder();for(byte n:b)s.append(String.format(Locale.ROOT,"%02x",n&255));return s.toString();}
 private static boolean sensitive(String s){return Pattern.compile("(sk-[a-z0-9_-]+|bearer\\s|api[_-]?key|password|token=|authorization)",Pattern.CASE_INSENSITIVE).matcher(s).find();}
 private static String text(JSONObject i,String k,String fallback)throws Exception{if(!i.has(k))return fallback;need(i.opt(k) instanceof String,"文本字段无效");return i.getString(k);}
 private static int integer(JSONObject i,String key,String alias,int fallback,int lo,int hi)throws Exception{Object v=i.has(key)?i.opt(key):i.opt(alias);if(v==null)return fallback;need(v instanceof Number,"数值类型无效");double n=((Number)v).doubleValue();need(Double.isFinite(n)&&n==Math.floor(n)&&n>=lo&&n<=hi,"数值范围无效");return (int)n;}
 private static boolean bool(JSONObject i,String key)throws Exception{if(!i.has(key))return false;need(i.opt(key) instanceof Boolean,"开关类型无效");return i.getBoolean(key);}
 public static JSONObject preferences(JSONObject i)throws Exception{
  String provider=text(i,"provider","manual-handoff"),model=text(i,"model",""),endpoint=text(i,"endpoint",text(i,"apiUrl",""));
  need(Arrays.asList("manual-handoff","openai","openai-compatible").contains(provider),"供应商选项无效");
  need(model.isEmpty()||(!sensitive(model)&&model.matches("[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}")),"模型标识无效或含敏感内容");
  if(endpoint.isEmpty()&&!text(i,"baseUrl","").isEmpty())endpoint=text(i,"baseUrl","").replaceAll("/+$","")+"/chat/completions";
  if(!endpoint.isEmpty()){
   URI u;try{u=new URI(endpoint);}catch(Exception e){throw new Exception("接口地址格式无效");}String host=u.getHost()==null?"":u.getHost().toLowerCase(Locale.ROOT);
   need(endpoint.length()<=512&&!sensitive(endpoint)&&"https".equals(u.getScheme())&&u.getUserInfo()==null&&u.getRawQuery()==null&&u.getRawFragment()==null&&u.getPort()==-1,"接口须为无凭据、查询参数和片段的 HTTPS 地址");
   need(host.matches("(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}")&&!host.endsWith(".local")&&!host.endsWith(".lan")&&!host.endsWith(".internal")&&!host.endsWith(".localhost")&&!host.endsWith(".invalid")&&!endpoint.contains("%"),"接口须使用公开域名");
   need(!provider.equals("openai")||(host.equals("api.openai.com")&&"/v1/chat/completions".equals(u.getPath())),"OpenAI 接口地址不匹配");endpoint=u.toASCIIString();
  }
  Object t=i.opt("temperature");need(t==null||t==JSONObject.NULL||(t instanceof Number&&Double.isFinite(((Number)t).doubleValue())&&((Number)t).doubleValue()>=0&&((Number)t).doubleValue()<=2),"温度范围无效");boolean send=bool(i,"sendTemperature");need(!send||t instanceof Number,"发送温度时须填写温度");
  return new JSONObject().put("provider",provider).put("model",model).put("endpoint",endpoint).put("timeoutMs",integer(i,"timeoutMs","timeout",120000,1000,300000)).put("maxCompletionTokens",integer(i,"maxCompletionTokens","maxTokens",4096,128,65536)).put("temperature",t==null?JSONObject.NULL:t).put("sendTemperature",send).put("enabledPreference",bool(i,"enabledPreference"));
 }
 public static JSONObject empty()throws Exception{return new JSONObject().put("schema","native-ai-settings/v1").put("revision",0).put("preferences",preferences(new JSONObject())).put("capabilities",new JSONArray()).put("savedAt",JSONObject.NULL);}
 public static JSONObject parse(byte[] bytes)throws Exception{need(bytes.length>0&&bytes.length<=1024*1024,"导入须为 1MiB 内 JSON");JSONObject i;try{i=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}catch(Exception e){throw new Exception("导入 JSON 无效");}need(!i.has("preferences")||i.opt("preferences") instanceof JSONObject,"配置对象无效");for(String key:new String[]{"capabilities","models"})need(!i.has(key)||i.opt(key) instanceof JSONArray,"能力数组无效");return empty().put("preferences",preferences(i.has("preferences")?i.getJSONObject("preferences"):i)).put("capabilities",AiSettingsCapabilities.reported(i.has("capabilities")?i.optJSONArray("capabilities"):i.optJSONArray("models"),"import"));}
 public static JSONObject status(JSONObject i)throws Exception{JSONObject p=preferences(i);return new JSONObject().put("configuration",p.getString("provider").equals("manual-handoff")?"manual-handoff":(!p.getString("model").isEmpty()&&!p.getString("endpoint").isEmpty()?"configured":"incomplete")).put("credentialConfigured",false).put("credentialStore","not-connected").put("networkAuthorized",false).put("connectivity","not-tested").put("executionConsumer","not-connected");}
 static boolean equal(Object a,Object b)throws Exception{if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;Iterator<String> k=x.keys();while(k.hasNext()){String key=k.next();if(!y.has(key)||!equal(x.get(key),y.get(key)))return false;}return true;}if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int n=0;n<x.length();n++)if(!equal(x.get(n),y.get(n)))return false;return true;}if(a instanceof Number&&b instanceof Number)return ((Number)a).doubleValue()==((Number)b).doubleValue();return Objects.equals(a,b);}
}
