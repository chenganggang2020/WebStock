package org.marketreview.nativeapp;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import org.json.*;

/** Document triage matching the desktop contract. Never a fact-check or ASR accuracy score. */
final class CollectionQuality {
  static final Pattern ECHO=Pattern.compile("请(?:使用中国大陆简体中文逐字转写|只分析以下财经文稿)|不要改写、总结或补充原文|以下是中国大陆普通话财经视频|重点术语\\s*[：:]|(?:提取|总结)(?:产业链)?关系.{0,30}只返回JSON",Pattern.CASE_INSENSITIVE);
  // Qt QString::trimmed Unicode White_Space, without changing the body fingerprint.
  static String trim(String s) {int first=0,last=s.length();while(first<last&&space(s.charAt(first)))first++;while(last>first&&space(s.charAt(last-1)))last--;return s.substring(first,last);}
  static boolean space(char c) {return c>=9&&c<=13||c==32||c==0x85||c==0xa0||c==0x1680||c>=0x2000&&c<=0x200a||c==0x2028||c==0x2029||c==0x202f||c==0x205f||c==0x3000;}
  static JSONObject object(JSONObject parent,String key) {JSONObject value=parent.optJSONObject(key);return value==null?new JSONObject():value;}
  static JSONArray array(JSONObject parent,String key) {JSONArray value=parent.optJSONArray(key);return value==null?new JSONArray():value;}
  static String bodyHash(String body) {
    try{return RecognitionAssets.hex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}
  }
  static boolean validReview(JSONObject r) {
    if(r==null||!(r.opt("bodyHash") instanceof String)||!(r.opt("note") instanceof String)||!(r.opt("scope") instanceof String)||!(r.opt("reviewedAt") instanceof String))return false;
    if(r==null||!r.optString("bodyHash").matches("[a-f0-9]{64}")||trim(r.optString("note")).isEmpty()||r.optString("note").length()>2000||!r.optString("scope").equals("transcript_only"))return false;
    try{Instant.parse(r.getString("reviewedAt"));return true;}catch(Exception e){return false;}
  }
  static double metric(JSONObject j,String key) {
    Object v=j.opt(key);if(!(v instanceof Number)&&!(v instanceof String))return Double.NaN;
    try{double n=Double.parseDouble(v.toString());return Double.isFinite(n)?n:Double.NaN;}catch(Exception e){return Double.NaN;}
  }
  static JSONObject evaluate(JSONObject row) throws Exception {
    String raw=row.optString("text"),body=trim(raw);JSONObject saved=object(row,"qualitySource"),nativeResult=object(row,"asrResult");
    boolean hasNative=nativeResult.length()>0,note=!hasNative&&saved.optString("mediaType").equals("note");
    JSONObject source=hasNative?nativeResult:object(saved,note?"note":"asr"),quality=object(source,"quality");
    String expected=hasNative?bodyHash(nativeResult.optString("transcript",nativeResult.optString("text"))):saved.optString("bodyHash");
    Set<String> reasons=new LinkedHashSet<>();JSONArray stored=array(quality,"reasons");
    for(int i=0;i<stored.length();i++)if(stored.opt(i) instanceof String&&!stored.getString(i).isEmpty())reasons.add(stored.getString(i));
    if(ECHO.matcher(body).find())reasons.add("prompt_echo");
    double duration=metric(source,"durationSeconds");
    if(!Double.isFinite(duration)&&hasNative&&source.opt("decodedSeconds") instanceof Number)duration=source.optDouble("decodedSeconds")+source.optDouble("audioOffsetSeconds",0);
    JSONArray segments=array(source,"segments");
    if(!note)for(int i=0;i<segments.length();i++){JSONObject s=segments.optJSONObject(i);if(s==null)s=new JSONObject();double a=metric(s,"start"),b=metric(s,"end");
      if(a<0||b<0||(Double.isFinite(a)&&Double.isFinite(b)&&b<a)||(duration>0&&(a>duration+1||b>duration+1)))reasons.add("timestamp_out_of_range");}
    boolean nativeComplete=hasNative&&duration>0&&segments.length()>0;StringBuilder joined=new StringBuilder();double last=0;
    if(hasNative)for(int i=0;i<segments.length();i++){JSONObject s=segments.optJSONObject(i);if(s==null)s=new JSONObject();double a=metric(s,"start"),b=metric(s,"end");
      nativeComplete=nativeComplete&&Double.isFinite(a)&&Double.isFinite(b)&&a>=last&&b>=a&&b<=duration+1&&!s.optString("text").isEmpty();
      if(joined.length()>0&&!source.has("transcript"))joined.append('\n');joined.append(s.optString("text"));last=b;}
    nativeComplete=nativeComplete&&joined.toString().equals(source.optString("transcript",source.optString("text")));
    if(hasNative&&!nativeComplete)reasons.add("incomplete_asr_evidence");
    String status=source.optString("status",nativeComplete?"complete":"");boolean complete;
    if(note){JSONArray pages=array(source,"pages");double count=metric(source,"imageCount");complete=source.opt("imageCount") instanceof Number&&count>=1&&count<=50&&count==pages.length();boolean some=false;
      for(int i=0;i<pages.length();i++){JSONObject p=pages.optJSONObject(i);if(p==null)p=new JSONObject();String t=trim(p.optString("text"));some|=!t.isEmpty();
        complete=complete&&p.opt("index") instanceof Number&&p.optDouble("index")==i+1&&((p.optString("status").equals("recognized")&&!t.isEmpty()&&body.contains(t))||(p.optString("status").equals("no_text")&&t.isEmpty()));}
      complete=complete&&some&&Arrays.asList("complete","needs_review").contains(status);
    }else complete=Arrays.asList("complete","needs_review").contains(status)&&(!hasNative||nativeComplete);
    String extraction=body.isEmpty()?"empty":status.equals("error")?"error":complete?"complete":Arrays.asList("no_text","no_speech").contains(status)?"empty":source.length()==0?"missing":"partial";
    if(!expected.isEmpty()&&!expected.equals(bodyHash(raw)))reasons.add("body_edited");
    if(!hasNative&&!note&&saved.length()>0&&expected.isEmpty())reasons.add("missing_body_baseline");
    String gate="ready";
    if(reasons.contains("prompt_echo"))gate="suspected_prompt_echo";
    else if(note&&(!complete||!reasons.isEmpty()||quality.optBoolean("needsReview")))gate="note_ocr_required";
    else if(!reasons.isEmpty()||quality.optBoolean("needsReview")||(!note&&status.equals("needs_review")))gate="asr_review_required";
    else if(body.length()<30)gate="missing_text";
    else if(!complete)gate="asr_review_required";
    String machine=!reasons.isEmpty()||quality.optBoolean("needsReview")||(!note&&status.equals("needs_review"))?"review_required":extraction.equals("complete")?"pass":"not_evaluated";
    JSONArray reviews=array(row,"qualityReviews");String human=reviews.length()==0?"unreviewed":"outdated";
    if(reviews.length()>0){JSONObject review=reviews.optJSONObject(reviews.length()-1);if(!validReview(review))human="unreviewed";else if(review.optString("bodyHash").equals(bodyHash(raw)))human="reviewed";}
    return new JSONObject().put("schema","native-document-quality-v1").put("extraction",extraction).put("machineQuality",machine).put("humanReview",human).put("claimScope","author_claim").put("bodyHash",bodyHash(raw)).put("textLength",body.length()).put("qualityReasons",new JSONArray(reasons)).put("gate",gate).put("eligibleForAnalysis",gate.equals("ready")).put("model",source.optString("model"));
  }
  static String describe(JSONObject row) throws Exception {
    JSONObject q=evaluate(row);String machine=q.getString("machineQuality"),human=q.getString("humanReview");List<String> reasons=new ArrayList<>();JSONArray rs=q.getJSONArray("qualityReasons");
    for(int i=0;i<rs.length();i++){String r=rs.getString(i);reasons.add(r.equals("prompt_echo")?"疑似提示词回声":r.equals("timestamp_out_of_range")?"识别时间超出媒体范围":r.equals("body_edited")?"正文已编辑，不能沿用识别稿质检":r.equals("incomplete_asr_evidence")?"缺少完整识别分段 / 时长":r.equals("missing_body_baseline")?"缺少原识别正文基线":r);}
    return "机器质检："+(machine.equals("pass")?"未标异常":machine.equals("review_required")?"待复核":"未评估 / 缺提取证据")
        +"\n人工复核："+(human.equals("reviewed")?"当前正文有复核记录":human.equals("outdated")?"正文变化，旧复核已过期":"未复核")
        +"\n正文："+q.getInt("textLength")+"字 · "+(q.getBoolean("eligibleForAnalysis")?"满足机器分析准入，不代表已有分析":"不满足机器分析准入")
        +"\n"+String.join("；",reasons)+"\n模型："+(q.getString("model").isEmpty()?"未提供":q.getString("model"))
        +"\n机器未标异常不等于识别准确或事实已证实；本页仅记录文稿复核。";
  }
}
