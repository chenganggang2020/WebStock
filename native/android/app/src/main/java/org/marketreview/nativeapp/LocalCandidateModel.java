package org.marketreview.nativeapp;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.json.*;

/** Bounded local study of explicitly selected existing daily data; never fetches or changes a Feed. */
final class LocalCandidateModel {
  static final String VERSION="native-local-candidates/v1";
  static final String[] STRATEGIES={"stable","breakout","pullback","short-strong"};
  static final String[] LABELS={"稳健观察","趋势观察","回调观察","短线强势"};
  static final String BACKGROUND="主营、主题、人工板块、持仓、最近查看、估值、AI：本版未参与；非投资建议";
  static final String[] FACTORS={"ma5","ma20","ma60","trend5","trend20","trend60","volatility","volumeRatio5","macdDif","macdDea","macdHist","change","amount"};
  static final ZoneOffset BJ=ZoneOffset.ofHours(8);
  static void require(boolean ok,String message) { if(!ok)throw new IllegalArgumentException(message); }
  static void active() throws InterruptedException { if(Thread.currentThread().isInterrupted())throw new InterruptedException("候选操作已取消"); }
  static boolean finite(Object value) { return value instanceof Number&&Double.isFinite(((Number)value).doubleValue()); }
  static JSONObject object(JSONObject row,String key) { JSONObject value=row.optJSONObject(key);return value==null?new JSONObject():value; }
  static JSONArray array(JSONObject row,String key) { JSONArray value=row.optJSONArray(key);return value==null?new JSONArray():value; }
  static JSONObject pick(JSONObject input,String...keys) throws Exception {
    JSONObject out=new JSONObject(); for(String key:keys)if(input.has(key)) {
      Object value=input.get(key); require(!(value instanceof String)||((String)value).length()<=512,"来源字段过长");out.put(key,value);
    } return out;
  }
  static JSONObject snapshot(JSONArray selected,String strategy,Instant capturedAt) throws Exception {
    require(Arrays.asList(STRATEGIES).contains(strategy),"本版不支持该模板");
    require(capturedAt!=null&&selected!=null&&selected.length()>0&&selected.length()<=50,"请明确选择1至50只股票，不会静默截取");
    boolean withBackground=false,business=false;for(int i=0;i<selected.length();i++){if(selected.getJSONObject(i).has("backgroundInput"))withBackground=true;if(LocalCandidateBackground.BUSINESS_VERSION.equals(object(selected.getJSONObject(i),"backgroundInput").optString("schema")))business=true;}JSONArray inputs=new JSONArray();Set<String> ids=new HashSet<>();
    for(int i=0;i<selected.length();i++) {
      active();JSONObject s=selected.getJSONObject(i);String id=s.optString("id");
      require(id.matches("(SH|SZ|BJ):stock:[0-9]{6}")&&ids.add(id),"需唯一且明确的股票市场身份");
      require(!s.optBoolean("transient"),"此版仅计算实际自选，不将临时观察当自选");
      String symbol=id.substring(0,2).toLowerCase(Locale.ROOT)+id.substring(id.length()-6);
      require(symbol.equals(s.optString("symbol")),"证券市场与来源代码不一致");
      String name=s.optString("name");require(!name.trim().isEmpty()&&name.length()<=128,"证券名称无效");
      JSONObject input=new JSONObject().put("id",id).put("symbol",symbol).put("name",name)
          .put("group",s.optString("group","")).put("inWatchlist",true);
      input.put("quote",pick(object(s,"quote"),"price","previousClose","changePercent","amount","volume","source","tradeDate","tradeTime","checkedAt","cached","error","persistenceState"));
      input.put("dayMeta",pick(object(s,"dayMeta"),"source","timeUnit","adjustment","volumeUnit","dataDate","checkedAt","cached","error","persistenceState"));
      JSONArray day=array(s,"day"),kept=new JSONArray();require(day.length()<=2000,"日K输入过大");
      // One extra row permits removing a final forming bar without shortening the 80 closed-bar window.
      for(int j=Math.max(0,day.length()-81);j<day.length();j++)kept.put(pick(day.getJSONObject(j),"time","label","open","high","low","close","volume","valid","closed"));
      input.put("day",kept);if(withBackground){require(!s.has("backgroundInput")||s.opt("backgroundInput") instanceof JSONObject,"背景输入须为对象");JSONObject bg=object(s,"backgroundInput");require(!business||LocalCandidateBackground.BUSINESS_VERSION.equals(bg.optString("schema")),"主营版本须覆盖同一批明确证券");require(bg.toString().getBytes(StandardCharsets.UTF_8).length<=16384,"单证券背景输入超过16KiB");input.put("backgroundInput",bg);}inputs.put(input);
    }
    JSONObject result=new JSONObject().put("model",business?LocalCandidateBackground.BUSINESS_CANDIDATE_VERSION:withBackground?LocalCandidateBackground.CANDIDATE_VERSION:VERSION).put("strategy",strategy).put("capturedAt",capturedAt.toString()).put("inputs",inputs);
    require(result.toString().getBytes(StandardCharsets.UTF_8).length<=1024*1024,"冻结输入超过1MiB，未执行");
    return new JSONObject(result.toString());
  }
  static void number(JSONObject out,String key,double value) throws Exception { out.put(key,Double.isFinite(value)?value:JSONObject.NULL); }
  static double value(JSONObject f,String key) { return finite(f.opt(key))?f.optDouble(key):Double.NaN; }
  static void add(JSONArray c,String rule,String label,int points) throws Exception {
    c.put(new JSONObject().put("rule",rule).put("label",label).put("points",points));
  }
  static double mean(List<Engine.Bar> bars,int from,int to,boolean volume) {
    double sum=0;for(int i=from;i<to;i++)sum+=(volume?bars.get(i).volume:bars.get(i).close)/(to-from);return sum;
  }
  static boolean checked(JSONObject meta,Instant captured) {
    try{return meta.opt("source") instanceof String&&!meta.getString("source").trim().isEmpty()&&!Instant.parse(meta.getString("checkedAt")).isAfter(captured);}
    catch(Exception e){return false;}
  }
  static JSONObject calculate(JSONObject s,String strategy,Instant captured) throws Exception {
    JSONObject meta=object(s,"dayMeta"),quote=object(s,"quote"),f=new JSONObject();
    for(String key:FACTORS)f.put(key,JSONObject.NULL);
    JSONArray missing=new JSONArray(),risks=new JSONArray(),contributions=new JSONArray();
    List<Engine.Bar> bars=new ArrayList<>();String dataError="",end="";boolean forming=false;
    try {
      JSONArray input=array(s,"day");double last=Double.NEGATIVE_INFINITY;
      for(int i=0;i<input.length();i++) {
        active();JSONObject row=input.getJSONObject(i);
        for(String key:new String[]{"time","open","high","low","close","volume"})require(finite(row.opt(key)),"日K缺少有效"+key+"，未跨缺口计算");
        require(row.opt("valid")==Boolean.TRUE&&row.opt("closed") instanceof Boolean,"日K有效/闭合标记缺失");
        Engine.Bar b=new Engine.Bar(row.getDouble("time"),row.getDouble("open"),row.getDouble("high"),row.getDouble("low"),row.getDouble("close"),row.getDouble("volume"),true,row.getBoolean("closed"));
        require(Engine.valid(b)&&b.volume>=0&&b.time>last,"日K价格、量或时间顺序无效");
        LocalDate day=LocalDate.parse(row.getString("label"));
        require(!day.isAfter(captured.atOffset(BJ).toLocalDate())&&b.time==day.atTime(15,0).toInstant(BJ).toEpochMilli(),"日K日期与毫秒时间不一致");
        last=b.time;
        if(!b.closed){require(i==input.length()-1,"历史中混入未闭合日K");forming=true;continue;}
        require(Instant.ofEpochMilli((long)b.time).isBefore(captured),"尚未结束的日K不能标已闭合");
        b.label=day.toString();bars.add(b);
      }
      if(bars.size()>80)bars=new ArrayList<>(bars.subList(bars.size()-80,bars.size()));
    } catch(InterruptedException e){throw e;} catch(Exception e){dataError=e.getMessage();bars.clear();}
    int n=bars.size();if(n>0)end=bars.get(n-1).label;
    if(!dataError.isEmpty())missing.put(dataError);
    boolean provenance=checked(meta,captured)&&meta.optString("timeUnit").equals("milliseconds")
        &&Arrays.asList("qfq","none").contains(meta.optString("adjustment"))&&meta.optString("volumeUnit").equals("手");
    JSONArray original=array(s,"day");String sourceEnd=original.length()==0?"":original.getJSONObject(original.length()-1).optString("label");
    provenance=provenance&&!sourceEnd.isEmpty()&&sourceEnd.equals(meta.optString("dataDate"));
    try{if(n>0&&Instant.ofEpochMilli((long)bars.get(n-1).time).isAfter(Instant.parse(meta.getString("checkedAt"))))provenance=false;}
    catch(Exception e){provenance=false;}
    if(!provenance)missing.put("日K来源/检查时间/复权/单位不完整，或检查早于闭合日K，不评分");
    if(forming)risks.put("末根仍形成中，未参与确认因子");
    for(int period:new int[]{5,20,60}) {
      if(n>=period) { number(f,"ma"+period,mean(bars,n-period,n,false));number(f,"trend"+period,(bars.get(n-1).close/bars.get(n-period).close-1)*100); }
      else missing.put("MA/首末变化"+period+"需"+period+"根闭合日K，现有"+n);
    }
    if(n>=20) {
      double avg=0;for(int i=1;i<n;i++)avg+=(bars.get(i).close/bars.get(i-1).close-1)*100/(n-1);
      double variance=0;for(int i=1;i<n;i++){double diff=(bars.get(i).close/bars.get(i-1).close-1)*100-avg;variance+=diff*diff/(n-1);}
      number(f,"volatility",Math.sqrt(variance));
    } else missing.put("波动率至少需20根闭合日K");
    if(n>=10) { double prior=mean(bars,n-10,n-5,true);if(prior>0)number(f,"volumeRatio5",mean(bars,n-5,n,true)/prior); }
    if(f.isNull("volumeRatio5"))missing.put("5/5均量比缺数或前5根均量为零");
    if(n>0) { Engine.Macd macd=Engine.macd(bars,12,26,9);number(f,"macdDif",macd.dif[n-1]);number(f,"macdDea",macd.dea[n-1]);number(f,"macdHist",macd.hist[n-1]); }
    if(f.isNull("macdDea"))missing.put("MACD DEA需34根闭合日K完成原生预热");
    boolean quoteOk=checked(quote,captured)&&finite(quote.opt("price"))&&quote.optDouble("price")>0&&!end.isEmpty()&&end.equals(quote.optString("tradeDate"));
    try{Instant quoteTime=LocalDate.parse(quote.getString("tradeDate")).atTime(LocalTime.parse(quote.getString("tradeTime"))).toInstant(BJ);
      if(quoteTime.isAfter(Instant.parse(quote.getString("checkedAt"))))quoteOk=false;
    }catch(Exception e){quoteOk=false;}
    if(quoteOk) { if(finite(quote.opt("changePercent")))number(f,"change",quote.getDouble("changePercent"));if(finite(quote.opt("amount"))&&quote.optDouble("amount")>=0)number(f,"amount",quote.getDouble("amount")); }
    if(!quoteOk)missing.put("报价源时间缺失、检查早于行情时间或与闭合日K日期不同；涨跌幅/成交额未计分");
    if(f.isNull("change"))missing.put("涨跌幅缺失，不能当作0%");
    if(f.isNull("amount"))missing.put("成交额缺失，不能当作0元");
    for(String key:FACTORS)if(f.isNull(key))missing.put("因子 "+key+" 不可用（缺数或数值超出有限范围），未参与计分");
    risks.put("交易日覆盖未核验；本机留存数据不保证实时或历史时点可得性");
    risks.put("MACD采用同原生公式，但候选最多末80根闭合日K窗口；与更长图表历史的初始段不同，不保证逐值相同");
    boolean ready=n>=20&&provenance&&dataError.isEmpty()&&Double.isFinite(value(f,"ma20"));
    if(s.optString("name").toUpperCase(Locale.ROOT).matches("^\\*?ST.*")){ready=false;missing.put("ST名称规则排除，不代表完整交易所风险核验");}
    int total=0;
    if(ready) {
      add(contributions,"base","基础观察分",45);
      double change=value(f,"change"),ma5=value(f,"ma5"),ma20=value(f,"ma20"),ma60=value(f,"ma60"),t5=value(f,"trend5"),t20=value(f,"trend20"),t60=value(f,"trend60");
      if(strategy.equals("short-strong")&&change>=3)add(contributions,"change","当日涨幅≥3%",18);
      else if(strategy.equals("breakout")&&change>=1.5)add(contributions,"change","当日涨幅≥1.5%",12);
      else if(strategy.equals("pullback")&&change>=-5&&change<=-1)add(contributions,"change","当日回调-5%..-1%",10);
      if(Math.abs(change)>=6)risks.put("当日波动较大，需人工复核");
      if(value(f,"amount")>=500000000)add(contributions,"amount","成交额≥5亿元",6);
      if(ma5>=ma20)add(contributions,"ma20","MA5≥MA20",strategy.equals("breakout")||strategy.equals("short-strong")?10:5);
      else if(strategy.equals("pullback"))add(contributions,"ma20","MA5<MA20回调观察",5);else risks.put("MA5低于MA20");
      if(strategy.equals("stable")&&Math.abs(t20)<=8)add(contributions,"trend20","20根首末变化绝对值≤8%",6);
      if(strategy.equals("short-strong")&&t20>=8)add(contributions,"trend20","20根首末变化≥8%",8);
      if(ma5>=ma60)add(contributions,"ma60","MA5≥MA60",strategy.equals("breakout")||strategy.equals("short-strong")?7:4);
      else if(Double.isFinite(ma60))risks.put("MA5低于MA60");
      if(strategy.equals("short-strong")&&t5>=2)add(contributions,"trend5","5根首末变化≥2%",6);
      if(strategy.equals("pullback")&&t5>=-8&&t5<=-2)add(contributions,"trend5","5根首末变化-8%..-2%",5);
      if(Math.abs(t5)>=10)risks.put("5根日K变化较快");
      if((strategy.equals("breakout")||strategy.equals("short-strong"))&&t60>=10)add(contributions,"trend60","60根首末变化≥10%",5);
      if(strategy.equals("stable")&&Math.abs(t60)<=15)add(contributions,"trend60","60根首末变化绝对值≤15%",4);
      if(t60<=-12)risks.put("60根首末变化≤-12%");
      if(value(f,"volumeRatio5")>=1.2)add(contributions,"volume","末5/前5均量≥1.2",5);
      if(value(f,"volumeRatio5")<=.7)risks.put("5/5均量比≤0.7，量能收缩");
      if(strategy.equals("stable")&&value(f,"volatility")<=4)add(contributions,"volatility","实际窗口波动率≤4%",5);
      if(value(f,"volatility")>4)risks.put("窗口波动率>4%");
      if((strategy.equals("breakout")||strategy.equals("short-strong"))&&value(f,"macdDif")>=value(f,"macdDea"))add(contributions,"macd","原生MACD DIF≥DEA（不是交叉事件判定）",8);
      if(value(f,"macdDif")<value(f,"macdDea")&&value(f,"macdDif")<0)risks.put("原生MACD空头关系");
      add(contributions,"watchlist","明确属于当前自选",strategy.equals("stable")?14:8);
      add(contributions,"template","规则模板常量；非外部证据",strategy.equals("pullback")?12:strategy.equals("short-strong")?5:4);
      if(f.isNull("change")&&f.isNull("amount")&&!strategy.equals("stable"))add(contributions,"missingQuote","同日有效报价因子缺失",-12);
      for(int i=0;i<contributions.length();i++)total+=contributions.getJSONObject(i).getInt("points");
    }
    return new JSONObject().put("id",s.getString("id")).put("name",s.getString("name")).put("group",s.optString("group"))
        .put("status",!ready?"excluded":missing.length()>0?"partial":"ready").put("score",ready?Math.max(0,Math.min(100,total)):JSONObject.NULL)
        .put("rawScore",ready?total:JSONObject.NULL).put("barCount",n).put("dataDate",end).put("factors",f)
        .put("source",new JSONObject().put("quote",quote).put("dayMeta",meta)).put("missing",missing).put("risks",risks)
        .put("contributions",contributions).put("background",BACKGROUND);
  }
  static JSONObject evaluate(JSONObject input) throws Exception {
    require((VERSION.equals(input.optString("model"))||LocalCandidateBackground.CANDIDATE_VERSION.equals(input.optString("model"))||LocalCandidateBackground.BUSINESS_CANDIDATE_VERSION.equals(input.optString("model"))),"候选模型版本不支持");
    JSONObject frozen=snapshot(input.getJSONArray("inputs"),input.getString("strategy"),Instant.parse(input.getString("capturedAt")));
    require(frozen.getString("model").equals(input.getString("model")),"冻结背景字段与模型版本不一致");List<JSONObject> rows=new ArrayList<>();JSONArray inputs=frozen.getJSONArray("inputs");
    for(int i=0;i<inputs.length();i++){active();JSONObject row=calculate(inputs.getJSONObject(i),frozen.getString("strategy"),Instant.parse(frozen.getString("capturedAt")));if(LocalCandidateBackground.CANDIDATE_VERSION.equals(frozen.getString("model"))||LocalCandidateBackground.BUSINESS_CANDIDATE_VERSION.equals(frozen.getString("model")))row=LocalCandidateBackground.apply(row,object(inputs.getJSONObject(i),"backgroundInput"),frozen.getString("strategy"),Instant.parse(frozen.getString("capturedAt")));rows.add(row);}
    rows.sort((a,b)->{int c=Integer.compare(b.optInt("score",-1),a.optInt("score",-1));return c!=0?c:a.optString("id").compareTo(b.optString("id"));});
    return new JSONObject().put("model",frozen.getString("model")).put("input",frozen).put("inputHash",digest(frozen)).put("rows",new JSONArray(rows));
  }
  static void verify(JSONObject result) throws Exception {
    require((VERSION.equals(result.optString("model"))||LocalCandidateBackground.CANDIDATE_VERSION.equals(result.optString("model"))||LocalCandidateBackground.BUSINESS_CANDIDATE_VERSION.equals(result.optString("model")))&&result.toString().getBytes(StandardCharsets.UTF_8).length<=1536*1024,"候选版本或大小无效");
    JSONObject expected=evaluate(result.getJSONObject("input"));require(canonical(expected).equals(canonical(result)),"候选输入摘要或计算结果不匹配");
  }
  static String canonical(Object value) throws Exception {
    if(value==null||value==JSONObject.NULL)return "null";
    if(value instanceof String)return JSONObject.quote((String)value);
    if(value instanceof Number)return new BigDecimal(value.toString()).stripTrailingZeros().toPlainString();
    if(value instanceof Boolean)return value.toString();
    StringBuilder out=new StringBuilder();
    if(value instanceof JSONArray){out.append('[');JSONArray a=(JSONArray)value;for(int i=0;i<a.length();i++){if(i>0)out.append(',');out.append(canonical(a.get(i)));}return out.append(']').toString();}
    JSONObject obj=(JSONObject)value;List<String> keys=new ArrayList<>();Iterator<String> it=obj.keys();while(it.hasNext())keys.add(it.next());Collections.sort(keys);
    out.append('{');for(String key:keys){if(out.length()>1)out.append(',');out.append(JSONObject.quote(key)).append(':').append(canonical(obj.get(key)));}return out.append('}').toString();
  }
  static String digest(JSONObject value) throws Exception {
    byte[] bytes=MessageDigest.getInstance("SHA-256").digest(canonical(value).getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();
  }
  static String cell(String value) { if(value.matches("(?s)^\\s*[=+@-].*"))value="'"+value;return '"'+value.replace("\"","\"\"")+'"'; }
  static byte[] csv(JSONObject result) throws Exception {
    verify(result);StringBuilder out=new StringBuilder("\ufeffid,name,score,status,model,captured_at,day_date,quote_date,quote_time,day_source,quote_source,adjustment,day_cached,missing,contributions\r\n");
    JSONArray rows=result.getJSONArray("rows");for(int i=0;i<rows.length();i++) {
      JSONObject r=rows.getJSONObject(i),source=r.getJSONObject("source"),meta=source.getJSONObject("dayMeta"),q=source.getJSONObject("quote");
      String[] values={r.getString("id"),r.getString("name"),r.isNull("score")?"":r.get("score").toString(),r.getString("status"),result.getString("model"),result.getJSONObject("input").getString("capturedAt"),r.getString("dataDate"),q.optString("tradeDate"),q.optString("tradeTime"),meta.optString("source"),q.optString("source"),meta.optString("adjustment"),meta.optString("cached"),r.getJSONArray("missing").toString(),r.getJSONArray("contributions").toString()};
      for(int j=0;j<values.length;j++){if(j>0)out.append(',');out.append(cell(values[j]));}out.append("\r\n");
    } return out.toString().getBytes(StandardCharsets.UTF_8);
  }
}

