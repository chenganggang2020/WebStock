package org.marketreview.nativeapp;

import org.json.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.*;

/** Offline integrity checks. This class never executes Python, models, or trades. */
final class QuantModelResult {
 static void need(boolean ok,String message){if(!ok)throw new IllegalArgumentException(message);}
 static String hash(byte[] data)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(data))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 static boolean relative(String path){if(path.isEmpty()||path.startsWith("/")||path.contains("\\")||path.contains(":"))return false;for(String part:path.split("/",-1))if(part.isEmpty()||part.equals(".")||part.equals(".."))return false;return true;}
 static JSONObject json(byte[] data)throws Exception{return QuantResearchJson.parse(new String(data,StandardCharsets.UTF_8));}
 static boolean equal(Object a,Object b)throws Exception{
  if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;for(Iterator<String> it=x.keys();it.hasNext();){String k=it.next();if(!y.has(k)||!equal(x.get(k),y.get(k)))return false;}return true;}
  if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!equal(x.get(i),y.get(i)))return false;return true;}
  if(a instanceof Number&&b instanceof Number)return Double.compare(((Number)a).doubleValue(),((Number)b).doubleValue())==0;
  return Objects.equals(a,b);
 }
 static JSONObject verify(String raw)throws Exception{
  need(raw.getBytes(StandardCharsets.UTF_8).length<=32*1024*1024,"结果包超过32MiB");JSONObject receipt=QuantResearchJson.parse(raw);
  need(receipt.getString("schema").equals("webstock.quant.native-result.v1")&&receipt.getString("status").equals("completed")&&Boolean.FALSE.equals(receipt.get("automaticTrading")),"结果包格式/状态无效");
  need(receipt.getString("id").matches("native-[0-9a-f-]{36}"),"结果任务ID无效");
  Map<String,byte[]>files=new LinkedHashMap<>();JSONArray list=receipt.getJSONArray("files");long total=0;
  for(int i=0;i<list.length();i++){JSONObject file=list.getJSONObject(i);String path=file.getString("path"),encoded=file.getString("base64");byte[] data=Base64.getDecoder().decode(encoded);need(relative(path)&&!files.containsKey(path)&&Base64.getEncoder().encodeToString(data).equals(encoded)&&hash(data).equals(file.getString("sha256")),"附件路径/编码/摘要不一致");total+=data.length;need(total<=24*1024*1024,"附件总量超过24MiB");files.put(path,data);}
  need(files.containsKey("request.json")&&hash(files.get("request.json")).equals(receipt.getString("requestSha256")),"冻结请求原文改变");JSONObject request=json(files.get("request.json"));String task=request.getString("task");
  need(request.getString("id").equals(receipt.getString("id"))&&task.equals(receipt.getString("task")),"任务身份不一致");String datasetId=receipt.getString("datasetId"),manifestPath="workspace/datasets/"+datasetId+"/manifest.json";
  need(files.containsKey(manifestPath)&&hash(files.get(manifestPath)).equals(request.getString("manifestFileSha256")),"数据清单原文不一致");JSONObject manifest=json(files.get(manifestPath));
  need(manifest.getString("datasetId").equals(datasetId)&&manifest.getString("manifestSha256").equals(receipt.getString("manifestSha256"))&&manifest.getString("asOf").equals(receipt.getString("asOf")),"数据身份/时点不一致");
  need(request.getString("schema").equals("webstock.quant.native-request.v1")&&manifest.getString("schema").equals("webstock.quant.dataset.v1"),"请求或数据清单格式不一致");
  need(Arrays.asList("lightgbm","master","factor","strategy","signal","experiment","watchlist","strategy-daily").contains(task),"未知任务类型");
  int count=task.equals("experiment")?3:(task.equals("watchlist")||task.equals("strategy-daily")?4:1);JSONArray steps=receipt.getJSONArray("steps");need(steps.length()==count,"任务步骤不完整");
  for(int i=0;i<steps.length();i++){
   JSONObject entry=steps.getJSONObject(i),step=entry.getJSONObject("step");String path=entry.getString("relativePath");need(files.containsKey(path)&&hash(files.get(path)).equals(entry.getString("sha256")),"结果原文改变");JSONObject result=json(files.get(path));need(equal(result,entry.getJSONObject("result")),"结果摘要与原文不一致");
   String kind=task.equals("experiment")?new String[]{"lightgbm","factor","master"}[i]:count==4?"strategy":task;
   String runId=receipt.getString("id")+"-"+(i+1),directory=kind.equals("factor")?"factor-runs":kind.equals("strategy")?"strategy-runs":kind.equals("signal")?"signal-scans":"runs";
   need(step.getString("kind").equals(kind)&&step.getString("runId").equals(runId)&&path.equals("workspace/"+directory+"/"+runId+"/result.json")&&result.getString("runId").equals(runId)&&result.getString("status").equals("completed"),"结果任务/路径不一致");
   String schema=kind.equals("lightgbm")||kind.equals("master")?"webstock.quant.result.v1":kind.equals("factor")?"webstock.quant.factor-lab.v1":kind.equals("strategy")?"webstock.quant.strategy-lab.v1":"webstock.quant.signal-scan.v1";need(result.getString("schema").equals(schema),"结果类型不一致");
   if(kind.equals("lightgbm")||kind.equals("master"))need(result.getString("modelId").equals(kind.equals("lightgbm")?"qlib-lightgbm-v2":"master-market-guided-v1"),"模型身份不一致");
   JSONObject reference=result.getJSONObject("dataManifest");need(reference.getString("datasetId").equals(datasetId)&&reference.getString("sha256").equals(receipt.getString("manifestSha256")),"结果使用另一数据版本");
   need(!LocalDate.parse(result.getString("asOf")).isAfter(LocalDate.parse(receipt.getString("asOf"))),"预测日期超过数据日期");
   if(kind.equals("strategy")||kind.equals("signal")){String family=count==4?new String[]{"moving-average-crossover","macd-crossover","rsi-rebound","volume-breakout"}[i]:request.getJSONObject("parameters").optString("strategyFamily",kind.equals("signal")?"low-position-volume-stagnation":"moving-average-crossover");need(step.getString("family").equals(family)&&result.getJSONObject("ruleCard").getString("strategyFamily").equals(family)&&result.getString("asOf").equals(receipt.getString("asOf"))&&Boolean.FALSE.equals(result.get("automaticTrading")),"策略身份、时点或执行权限不一致");}
   if(kind.equals("lightgbm")||kind.equals("master")||kind.equals("factor")){JSONObject parameters=step.getJSONObject("parameters"),actual=result.getJSONObject("parameters"),supplied=request.getJSONObject("parameters");need(result.getJSONArray("folds").length()>0&&parameters.length()>0,"模型窗口或参数缺失");for(Iterator<String> it=parameters.keys();it.hasNext();){String key=it.next();need(equal(actual.get(key),parameters.get(key))&&(!supplied.has(key)||equal(supplied.get(key),parameters.get(key))),"模型参数与冻结请求不一致");}}
   JSONArray artifacts=result.getJSONArray("artifacts");need(artifacts.length()>0,"结果附件缺失");Set<String> seen=new HashSet<>();for(int j=0;j<artifacts.length();j++){JSONObject file=artifacts.getJSONObject(j);String rel=file.getString("path"),attachment=path.substring(0,path.lastIndexOf('/')+1)+rel;need(relative(rel)&&!rel.equals("result.json")&&seen.add(rel)&&files.containsKey(attachment)&&hash(files.get(attachment)).equals(file.getString("sha256")),"结果附件缺失或改变");}
  }
  if(count==4){need(files.containsKey("suite-report.json"),"四策略汇总缺失");JSONObject report=json(files.get("suite-report.json"));need(equal(report,receipt.getJSONObject("report"))&&report.getString("status").equals("complete")&&report.getString("datasetId").equals(datasetId)&&report.getString("manifestSha256").equals(receipt.getString("manifestSha256"))&&report.getJSONArray("comparisons").length()==4,"四策略汇总不一致");}
  if(task.equals("watchlist")){need(files.containsKey("watchlist-review.json"),"自选研究解读缺失");JSONObject review=json(files.get("watchlist-review.json"));need(equal(review,receipt.getJSONObject("watchlist"))&&equal(review.getJSONObject("group"),request.getJSONObject("watchlist"))&&Boolean.FALSE.equals(review.getJSONObject("recommendationPreview").get("automaticApply")),"自选研究解读或分组不一致");}
  return receipt;
 }
 static JSONObject summary(JSONObject receipt)throws Exception{JSONObject out=new JSONObject(receipt.toString());JSONArray files=out.getJSONArray("files");for(int i=0;i<files.length();i++){JSONObject file=files.getJSONObject(i);String path=file.getString("path");if(path.equals("request.json")||path.endsWith("/manifest.json"))out.put(path.equals("request.json")?"originalRequest":"originalDatasetManifest",json(Base64.getDecoder().decode(file.getString("base64"))));file.remove("base64");}out.put("androidExecution","完整结果与附件在本机复核；此设备未执行Python训练；不代表模型精度验证");return out;}
}
