package org.marketreview.nativeapp;
import java.util.UUID;
import org.json.*;

/** Synthetic data for the v56 test mode only; never creates execution authority. */
final class SectorAiFixture {
 static final String ID="v56-sector-full-source", TOPIC="v56-sector-topic";
 static final String QUESTION="完整材料支持哪些产业关系，哪些结论仍然缺证据？";
 static final String QUOTE="甲公司在测试材料中声称生产光模块，产能、客户与收入仍需独立公告核验，不能据此认定供货关系。";
 static final String MANUAL="V56人工草稿起点\n"+"人工补充尚未核验。".repeat(1800)+"\nV56人工草稿终点";
 static JSONObject row()throws Exception{return new JSONObject().put("id",ID).put("title","v56隔离测试全文")
   .put("text","V56完整正文起点\n"+QUOTE+"\n"+"M".repeat(90000)+"\nV56完整正文终点")
   .put("originalText","V56原始正文必须完整保留\n"+QUOTE).put("verification","unverified")
   .put("fixtureMetadata",new JSONObject().put("revision",1).put("purpose","synthetic-local-only"));}
 static JSONObject prefs()throws Exception{return new JSONObject().put("provider","openai").put("endpoint","https://api.openai.com/v1/chat/completions")
   .put("model","v56-local-fixture-model").put("enabledPreference",true).put("timeoutMs",1000);}
 static JSONObject topic()throws Exception{return new JSONObject().put("id",TOPIC).put("name","v56隔离产业主题").put("fixture",true);}
 static JSONObject scope(JSONObject topic)throws Exception{return new JSONObject().put("kind","industry").put("id","business:topics:"+topic.getString("id"))
   .put("name",topic.getString("name")).put("source","本机产业主题原记录；不代表已核验成员或在线研究")
   .put("asOf",topic.opt("asOf")==null?JSONObject.NULL:topic.get("asOf")).put("cached",true)
   .put("coverage","成员与月度热度未由主题名称推断").put("snapshot",new JSONObject(topic.toString()));}
 static JSONObject report(JSONObject plan)throws Exception{return new JSONObject().put("schema","sector-ai-report/v1").put("planId",plan.get("planId"))
   .put("scopeKey",SectorAiModel.scopeKey(plan.getJSONObject("scope"))).put("summary","完整本机夹具报告，不构成真实公司或供应链结论。")
   .put("relations",new JSONArray().put(new JSONObject().put("stage","components").put("product","光模块").put("companyName","甲公司")
    .put("claim","材料中的待核验观点").put("polarity","supports").put("evidenceId","docs:"+ID).put("quote",QUOTE)))
   .put("risks",new JSONArray().put("仅受控测试材料，不能代替公告或财报")).put("missingData",new JSONArray().put("缺独立收入与客户证据"));}
 static JSONObject attempt(AiKnowledgeRequest.Prepared request,JSONObject plan)throws Exception{
  String raw=report(plan).toString();return new JSONObject().put("schema","native-knowledge-ai-attempt/v1").put("id","v56-local-fixture-"+UUID.randomUUID())
   .put("status","completed").put("errorCode","").put("preview",request.preview()).put("previewDigest",request.digest())
   .put("verification","unverified").put("finishReason","stop").put("provenance","local-fixture").put("networkAttempted",false).put("report",raw)
   .put("providerResponse",new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("index",0).put("finish_reason","stop")
    .put("message",new JSONObject().put("role","assistant").put("content",raw)))));
 }
 static JSONObject candidate(JSONObject plan)throws Exception{AiKnowledgeRequest.Prepared q=SectorAiModel.request(plan,prefs());return SectorAiModel.completed(plan,q.preview(),attempt(q,plan));}
}
