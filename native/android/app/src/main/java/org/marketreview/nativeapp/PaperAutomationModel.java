package org.marketreview.nativeapp;
import org.json.*;
import java.time.*;
import java.util.*;
/** Pure transitions for the isolated paper execution book. No broker orders. */
final class PaperAutomationModel {
 static void need(boolean ok,String why){PaperMonitorModel.need(ok,why);}
 static JSONObject obj(Object...kv)throws Exception{return PaperMonitorModel.object(kv);}
 static JSONObject copy(JSONObject x)throws Exception{return new JSONObject(x.toString());}
 static Instant time(String s){return PaperMonitorModel.time(s);}
 static String stamp(Instant t){return PaperMonitorModel.stamp(t);}
 static String day(String s){return time(s).atOffset(ZoneOffset.ofHours(8)).toLocalDate().toString();}
 static double num(JSONObject o,String k,double lo,double hi){return PaperMonitorModel.number(o,k,lo,hi);}
 static double optionalNumber(JSONObject o,String key){Object n=o.opt(key);return n instanceof Number?((Number)n).doubleValue():Double.NaN;}
 static double round(double n,int digits){double m=Math.pow(10,digits);return Math.floor(n*m+.5+1e-8)/m;}
 static List<String> keys(JSONObject o){List<String>k=new ArrayList<>();o.keys().forEachRemaining(k::add);Collections.sort(k);return k;}
 static boolean continuous(Instant t){LocalTime c=t.atOffset(ZoneOffset.ofHours(8)).toLocalTime();return !c.isBefore(LocalTime.of(9,30))&&c.isBefore(LocalTime.of(11,30))||!c.isBefore(LocalTime.of(13,0))&&c.isBefore(LocalTime.of(15,0));}
 static void session(JSONObject s,String now,boolean trading)throws Exception{
  need(Boolean.TRUE.equals(s.opt("verified"))&&s.opt("open") instanceof Boolean&&day(now).equals(s.optString("date")),"缺少当前已验证交易日证据");
  PaperMonitorModel.text(s,"source");PaperMonitorModel.fresh(s.getString("checkedAt"),time(now));
  if(trading)need(Boolean.TRUE.equals(s.opt("open"))&&Boolean.TRUE.equals(s.opt("continuous"))&&continuous(time(now)),"当前不是已验证连续交易时段");
 }
 static JSONObject settings(JSONObject raw,String now)throws Exception{
  JSONObject s=copy(raw);need(s.opt("enabled") instanceof Boolean&&s.opt("simulationEnabled") instanceof Boolean,"需明确分析及模拟成交开关");
  need(Arrays.asList("today","next-trading-day").contains(s.optString("startMode")),"启用日期方式无效");time(s.getString("activatedAt"));need(!time(s.getString("activatedAt")).isAfter(time(now)),"启用时间在未来");
  double max=num(s,"maxPositions",1,20);need(max==Math.floor(max),"持股数须整数");num(s,"cashReserve",0,.9);
  JSONArray a=s.getJSONArray("schedule");need(a.length()>0&&a.length()<=12,"需1–12个明确监控时点");TreeSet<String>times=new TreeSet<>();
  for(int i=0;i<a.length();i++){String x=a.getString(i);need(x.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]"),"监控时点无效");need(continuous(time("2000-01-01T"+x+":00+08:00")),"监控时点须位于连续交易时段");times.add(x);}
  need(times.size()==a.length(),"监控时点重复");s.put("schedule",new JSONArray(times));
  need(!s.has("candidateIds")||s.getJSONArray("candidateIds").length()==0,"本机监控沿用已持有证券范围，不能隐式扩展候选");s.put("candidateIds",new JSONArray());return s;
 }
 static String openingHash(JSONObject input)throws Exception{
  JSONObject ledger=copy(input.getJSONObject("ledger"));ledger.remove("asOf");
  return PaperMonitorModel.hash(obj("account",input.getJSONObject("account"),"ledger",ledger,"constraints",input.getJSONObject("constraints"),"policy",input.optJSONObject("hostEvidence")==null?JSONObject.NULL:input.getJSONObject("hostEvidence").opt("policy")));
 }
 static void bound(JSONObject b,JSONObject input)throws Exception{
  need("native-paper-automation-book/v1".equals(b.optString("schema"))&&b.getString("accountId").equals(input.getJSONObject("account").optString("id"))&&b.getString("openingHash").equals(openingHash(input)),"起始账户、策略或人工账本已改变，需核对纸面执行账本");
 }
 static JSONObject openingCosts(JSONArray trades)throws Exception{
  List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<trades.length();i++)sorted.add(trades.getJSONObject(i));sorted.sort(Comparator.comparing(t->t.optString("date")));JSONObject costs=new JSONObject();
  for(JSONObject t:sorted){String id=t.getString("instrumentId"),side=t.getString("side");JSONObject p=costs.optJSONObject(id);if(p==null)p=obj("quantity",0,"entryValue",0,"entryFee",0);double q=p.getDouble("quantity"),n=t.getDouble("quantity");
   if(side.equals("buy")){p.put("quantity",q+n).put("entryValue",p.getDouble("entryValue")+n*t.getDouble("price")).put("entryFee",p.getDouble("entryFee")+t.getDouble("fee"));}
   else if(side.equals("sell")){double ratio=(q-n)/q;p.put("quantity",q-n).put("entryValue",p.getDouble("entryValue")*ratio).put("entryFee",p.getDouble("entryFee")*ratio);}costs.put(id,p);
  }return costs;
 }
 static JSONObject seed(JSONObject input,JSONObject rawSettings,String now)throws Exception{
  PaperMonitorModel.prepare(input,now,true);JSONObject s=settings(rawSettings,now);
  need(!s.getBoolean("enabled")&&!s.getBoolean("simulationEnabled"),"建立账本默认关闭，启用需单独明确操作");
  String id=input.getJSONObject("account").getString("id");JSONArray trades=input.getJSONObject("ledger").getJSONArray("transactions");
  JSONArray rows=BusinessStore.portfolio(trades,input.getJSONObject("quotes"),id).getJSONArray("positions");JSONObject positions=new JSONObject(),costs=openingCosts(trades);
  for(int i=0;i<rows.length();i++){JSONObject p=rows.getJSONObject(i);if(p.getLong("quantity")<=0)continue;String full=p.getString("instrumentId");JSONObject c=costs.getJSONObject(full);positions.put(full,obj("instrumentId",full,"name",p.getString("name"),"quantity",p.getLong("quantity"),"cost",p.getDouble("cost"),"entryValue",round(c.getDouble("entryValue"),2),"entryFee",round(c.getDouble("entryFee"),2),"realized",0));}
  return obj("schema","native-paper-automation-book/v1","revision",0,"accountId",id,"createdAt",now,"openingInput",copy(input),"openingHash",openingHash(input),"settings",s,"cash",input.getJSONObject("account").getDouble("cashBalance"),"positions",positions,"tasks",new JSONObject(),"slots",new JSONObject(),"orders",new JSONArray(),"fills",new JSONArray(),"snapshots",new JSONArray(),"latestExecutionAt","");
 }
 static String executionHash(JSONObject b)throws Exception{return PaperMonitorModel.hash(obj("cash",b.get("cash"),"positions",b.get("positions"),"settings",b.get("settings"),"fills",b.get("fills")));}
 static JSONObject executionInput(JSONObject b,JSONObject current,String now)throws Exception{
  bound(b,current);JSONObject x=copy(current),account=x.getJSONObject("account"),ledger=x.getJSONObject("ledger");
  account.put("cashBalance",b.get("cash")).put("cashSource","paper-ledger").put("cashVerification","ledger-reconciled").put("cashAsOf",now);
  JSONArray trades=ledger.getJSONArray("transactions"),fills=b.getJSONArray("fills");
  for(int i=0;i<fills.length();i++){JSONObject f=fills.getJSONObject(i);trades.put(obj("id","paper-execution:"+f.getString("id"),"accountId",b.getString("accountId"),"instrumentId",f.get("instrumentId"),"name",f.get("name"),"side",f.get("side"),"date",day(f.getString("filledAt")),"quantity",f.get("quantity"),"price",f.get("price"),"fee",f.get("fee"),"tax",f.get("tax")));}
  ledger.put("revision",executionHash(b)).put("source","native-paper-execution-book");return x;
 }
 static boolean live(String status){return status.equals("running")||status.equals("awaiting-authorization");}
 static JSONObject configure(JSONObject input,JSONObject raw,String now)throws Exception{
  JSONObject b=copy(input),s=settings(raw,now);if(PaperMonitorModel.equal(s,b.getJSONObject("settings")))return b;
  b=cancel(b,now,"settings-changed");b.put("settings",s);return b;
 }
 static JSONObject cancel(JSONObject input,String now,String reason)throws Exception{
  JSONObject b=copy(input),tasks=b.getJSONObject("tasks"),slots=b.getJSONObject("slots");time(now);
  for(String k:keys(tasks)){JSONObject t=tasks.getJSONObject(k);if(live(t.optString("status"))){t.put("status","cancelled").put("finishedAt",now).put("error",reason);if(slots.has(t.getString("slot")))slots.getJSONObject(t.getString("slot")).put("status","cancelled");}}
  JSONArray orders=b.getJSONArray("orders");for(int i=0;i<orders.length();i++){JSONObject o=orders.getJSONObject(i);if(o.optString("status").equals("pending"))o.put("status","cancelled").put("reason",reason).put("updatedAt",now);}return b;
 }
 static JSONObject prepareTask(JSONObject input,JSONObject current,String now,String slot)throws Exception{
  JSONObject b=copy(input);bound(b,current);need(b.getJSONObject("settings").getBoolean("enabled"),"纸面自动监控未启用");
  JSONObject slots=b.getJSONObject("slots"),prior=slots.optJSONObject(slot);if(prior!=null&&!prior.optString("status").equals("retrying"))return b;
  need(slot.matches("manual:[A-Za-z0-9-]{1,80}")||slot.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}@[0-9]{2}:[0-9]{2}"),"时段身份无效");need(b.getJSONObject("tasks").length()<2000,"纸面任务超过2000条，需导出核对");
  for(String k:keys(b.getJSONObject("tasks")))need(!live(b.getJSONObject("tasks").getJSONObject(k).optString("status")),"纸面分析忙碌，未重复开始");
  JSONObject p=PaperMonitorModel.prepare(executionInput(b,current,now),now,true);
  int attempts=prior==null?1:prior.getInt("attempts")+1;need(attempts<=3,"该时段重试次数已用尽");
  String id=PaperMonitorModel.hash(obj("accountId",b.get("accountId"),"slot",slot,"attempt",attempts,"prepared",p));
  b.getJSONObject("tasks").put(id,obj("id",id,"slot",slot,"attempt",attempts,"status","awaiting-authorization","startedAt",now,"prepared",p,"executionHash",executionHash(b)));
  slots.put(slot,obj("slot",slot,"status","handoff","attempts",attempts,"taskId",id,"lastAttemptAt",now));return b;
 }
 static JSONObject claim(JSONObject input,String taskId,String digest,String now)throws Exception{
  JSONObject b=copy(input),t=b.getJSONObject("tasks").getJSONObject(taskId);need(t.optString("status").equals("awaiting-authorization"),"任务不在等待授权状态");
  need(digest.equals(t.getJSONObject("prepared").getString("preparationId")),"授权材料与准备记录不一致");need(!time(now).isAfter(time(t.getJSONObject("prepared").getJSONObject("readiness").getString("expiresAt"))),"准备已过期");
  need(executionHash(b).equals(t.getString("executionHash")),"执行账户已改变，旧授权不能消费");
  t.put("status","running").put("requestStartedAt",now);b.getJSONObject("slots").getJSONObject(t.getString("slot")).put("status","running").put("leaseUntil",stamp(time(now).plusSeconds(180)));return b;
 }
 static JSONObject fail(JSONObject input,String taskId,String now,String reason,boolean retryable)throws Exception{
  JSONObject b=copy(input),t=b.getJSONObject("tasks").getJSONObject(taskId);if(!live(t.optString("status")))return b;
  JSONObject slot=b.getJSONObject("slots").getJSONObject(t.getString("slot"));t.put("status","failed").put("finishedAt",now).put("error",reason);
  boolean retry=retryable&&slot.getInt("attempts")<3&&!t.getString("slot").startsWith("manual:");slot.put("status",retry?"retrying":"failed").put("error",reason);if(retry)slot.put("nextRetryAt",stamp(time(now).plusSeconds(60L*slot.getInt("attempts"))));return b;
 }
 static JSONObject row(JSONObject market,Instant after,Instant now)throws Exception{return row(market,after,now,false,now);}
 static JSONObject row(JSONObject market,Instant after,Instant now,boolean latest,Instant cutoff)throws Exception{
  if(market==null)return null;JSONObject meta=market.optJSONObject("meta");if(meta==null||!Boolean.FALSE.equals(meta.opt("stale"))||meta.optString("source").isEmpty())return null;
  Instant checked=time(meta.getString("checkedAt"));if(checked.isAfter(now.plusSeconds(5))||checked.isBefore(now.minusSeconds(300)))return null;
  JSONArray rows=market.getJSONArray("rows");need(rows.length()<=2000,"分钟行情超过本机上限，未截断");JSONObject best=null;
  for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);Instant t=time(r.getString("time"));double p=optionalNumber(r,"price");if(t.isAfter(after)&&!t.isAfter(now)&&!t.isAfter(cutoff)&&Double.isFinite(p)&&p>0&&(best==null||(latest?t.isAfter(time(best.getString("time"))):t.isBefore(time(best.getString("time"))))))best=r;}
  return best;
 }
 static JSONObject execute(JSONObject input,JSONObject current,JSONObject markets,String now)throws Exception{
  JSONObject b=copy(input);bound(b,current);JSONObject settings=b.getJSONObject("settings");if(!settings.getBoolean("enabled")||!settings.getBoolean("simulationEnabled"))return b;
  session(current.getJSONObject("session"),now,true);JSONObject positions=b.getJSONObject("positions");JSONArray orders=b.getJSONArray("orders"),fills=b.getJSONArray("fills");List<JSONObject> pending=new ArrayList<>();
  for(int i=0;i<orders.length();i++){JSONObject o=orders.getJSONObject(i);if(!o.optString("status").equals("pending"))continue;Instant advised=time(o.getString("advisedAt"));
   if(!day(now).equals(day(o.getString("advisedAt")))||time(now).isAfter(advised.plusSeconds(300))){o.put("status","cancelled").put("reason","decision-expired").put("updatedAt",now);continue;}
   JSONObject m=markets.optJSONObject(o.getString("instrumentId"));JSONObject r=m!=null&&o.getString("instrumentId").equals(m.optString("instrumentId"))?row(m,advised,time(now)):null;
   if(r==null){o.put("waitingReason","缺少建议后有效一分钟行情");continue;}pending.add(obj("order",o,"market",m,"row",r));
  }
  pending.sort(Comparator.comparing((JSONObject x)->time(x.optJSONObject("row").optString("time"))).thenComparing(x->x.optJSONObject("order").optString("id")));
  for(JSONObject item:pending){JSONObject o=item.getJSONObject("order"),r=item.getJSONObject("row"),market=item.getJSONObject("market"),meta=market.getJSONObject("meta");String id=o.getString("instrumentId"),code=o.getString("code"),filledAt=r.getString("time"),side=o.getString("action");
   String error="";double previous=optionalNumber(meta,"previousClose"),price=r.getDouble("price"),volume=optionalNumber(r,"volume");String name=o.getString("name").toUpperCase(Locale.ROOT);
   if(!continuous(time(filledAt))||!day(now).equals(day(filledAt)))error="minute-outside-session";
   else if(!b.getString("latestExecutionAt").isEmpty()&&time(filledAt).isBefore(time(b.getString("latestExecutionAt"))))error="historical-minute-rejected";
   else if(!Double.isFinite(volume)||volume<=0)error="minute-volume-unavailable";
   else if(!id.matches("(?:SH:stock:(?:600|601|603|605|688)|SZ:stock:(?:000|001|002|003|300|301))[0-9]{3}")||!id.endsWith(":"+code)||name.startsWith("ST")||name.startsWith("*ST")||name.startsWith("N")||name.startsWith("C")||name.contains("退"))error="risk-or-board-unverified";
   else if(!Double.isFinite(previous)||previous<=0)error="previous-close-unavailable";
   double limit=code.startsWith("300")||code.startsWith("301")||code.startsWith("688")?.2:.1;
   if(error.isEmpty()&&(side.equals("buy")&&price>=round(previous*(1+limit),2)||side.equals("sell")&&price<=round(previous*(1-limit),2)))error="price-limit";
   JSONObject p=positions.optJSONObject(id);long qty=p==null?0:p.getLong("quantity");double cash=b.getDouble("cash"),equity=cash;boolean coverage=true;int count=0;
   for(String k:keys(positions)){JSONObject pos=positions.getJSONObject(k);if(pos.getLong("quantity")==0)continue;count++;JSONObject m=markets.optJSONObject(k),quote=m==null?null:row(m,time(filledAt).minusSeconds(300),time(now),true,time(filledAt));if(k.equals(id))quote=r;if(quote==null||time(quote.getString("time")).isAfter(time(filledAt))){coverage=false;break;}equity+=pos.getLong("quantity")*quote.getDouble("price");}
   if(error.isEmpty()&&!coverage){o.put("waitingReason","持仓估值行情不完整，未计算可交易数量");continue;}
   double target=equity*o.getDouble("targetPositionPercent")/100,executionPrice=round(price*(side.equals("buy")?1.0002:.9998),4);int step=code.startsWith("688")?1:100,min=code.startsWith("688")?200:100;long amount=0;
   if(!Double.isFinite(executionPrice)||executionPrice<=0||!Double.isFinite(equity))error="execution-price-or-valuation-invalid";
   if(error.isEmpty()&&side.equals("buy")){
    if(qty==0&&count>=settings.getInt("maxPositions"))error="max-positions";
    long high=(long)Math.floor(Math.min(1e9,Math.max(0,target-qty*price)/executionPrice)/step),low=0;double available=Math.max(0,cash-equity*settings.getDouble("cashReserve"));
    // Search whole lots using the exact rounded debit that will be committed.
    while(low<high){long middle=low+(high-low+1)/2;double gross=round(middle*step*executionPrice,2),debit=gross+Math.max(5,round(gross*.00025,2));if(debit<=available+.000001)low=middle;else high=middle-1;}amount=low*step;
    if(amount<min)error="cash-reserve-or-minimum-lot";
   }else if(error.isEmpty()){
    long locked=0;JSONArray opening=b.getJSONObject("openingInput").getJSONObject("ledger").getJSONArray("transactions");
    for(int i=0;i<opening.length();i++){JSONObject t=opening.getJSONObject(i);if(id.equals(t.optString("instrumentId"))&&t.optString("side").equals("buy")&&day(now).equals(t.optString("date")))locked+=t.getLong("quantity");}
    for(int i=0;i<fills.length();i++){JSONObject f=fills.getJSONObject(i);if(id.equals(f.getString("instrumentId"))&&f.getString("side").equals("buy")&&day(now).equals(day(f.getString("filledAt"))))locked+=f.getLong("quantity");}
    long sellable=Math.max(0,qty-locked);amount=o.getDouble("targetPositionPercent")==0?qty:(long)Math.floor(Math.max(0,qty*price-target)/price/step)*step;amount=Math.min(amount,sellable);
    if(amount<=0||amount<min&&amount!=sellable)error="t-plus-one-or-minimum-lot";
   }
   amount=Math.min(amount,1000000000L);if(!error.isEmpty()){o.put("status","rejected").put("reason",error).put("updatedAt",now);continue;}
   double gross=round(amount*executionPrice,2),fee=Math.max(5,round(gross*.00025,2)),tax=side.equals("sell")?round(gross*.0005,2):0,newCash=round(cash+(side.equals("buy")?-gross-fee:gross-fee-tax),2);need(newCash>=0&&Double.isFinite(newCash),"模拟成交导致负现金或非有限值，事务拒绝");
   if(p==null)p=obj("instrumentId",id,"name",o.get("name"),"quantity",0,"cost",0,"entryValue",0,"entryFee",0,"realized",0);double value=p.getDouble("entryValue"),entryFee=p.getDouble("entryFee"),realized=p.getDouble("realized");
   if(side.equals("buy")){p.put("quantity",qty+amount).put("entryValue",round(value+gross,2)).put("entryFee",round(entryFee+fee,2));}else{double removed=(value+entryFee)*amount/qty;p.put("quantity",qty-amount).put("entryValue",round(value*(qty-amount)/qty,2)).put("entryFee",round(entryFee*(qty-amount)/qty,2)).put("realized",round(realized+gross-fee-tax-removed,2));}p.put("cost",round(p.getDouble("entryValue")+p.getDouble("entryFee"),2));
   positions.put(id,p);b.put("cash",newCash).put("latestExecutionAt",filledAt);o.put("status","filled").put("fillId",o.getString("id")).put("updatedAt",now);o.remove("waitingReason");
   JSONObject fill=obj("id",o.getString("id"),"orderId",o.getString("id"),"taskId",o.get("taskId"),"instrumentId",id,"name",o.get("name"),"side",side,"quantity",amount,"price",executionPrice,"gross",gross,"fee",fee,"tax",tax,"cashBefore",cash,"cashAfter",newCash,"filledAt",filledAt,"recordedAt",now,"source",meta.get("source"),"origin",market.optString("origin","native-market-cache"),"minute",copy(r),"meta",copy(meta));fills.put(fill);
   b.getJSONArray("snapshots").put(obj("fillId",fill.get("id"),"at",filledAt,"cash",newCash,"positions",copy(positions),"valuation","execution-ledger; revalue requires current coverage"));
  }return b;
 }
 static JSONObject schedule(JSONObject input,JSONObject current,String now)throws Exception{
  JSONObject b=copy(input),s=b.getJSONObject("settings");if(!s.getBoolean("enabled"))return b;bound(b,current);
  for(String key:keys(b.getJSONObject("tasks"))){JSONObject t=b.getJSONObject("tasks").getJSONObject(key);if(live(t.optString("status"))&&time(now).isAfter(time(t.getJSONObject("prepared").getJSONObject("readiness").getString("expiresAt")))){t.put("status","cancelled").put("error","preparation-expired").put("finishedAt",now);b.getJSONObject("slots").getJSONObject(t.getString("slot")).put("status","missed");}}
  JSONObject evidence=current.getJSONObject("session");session(evidence,now,false);
  if(!evidence.getBoolean("open"))return b;String date=day(now);if(s.getString("startMode").equals("next-trading-day")&&date.compareTo(day(s.getString("activatedAt")))<=0)return b;
  JSONObject slots=b.getJSONObject("slots");JSONArray times=s.getJSONArray("schedule");
  for(int i=0;i<times.length();i++){String slot=date+"@"+times.getString(i);Instant at=time(date+"T"+times.getString(i)+":00+08:00");if(time(now).isBefore(at))continue;
   JSONObject r=slots.optJSONObject(slot);String status=r==null?"":r.optString("status");
   if(!time(now).isBefore(at.plusSeconds(300))){if(r==null||Arrays.asList("retrying","running","handoff").contains(status)){if(r==null)r=obj("slot",slot,"attempts",0);String task=r.optString("taskId");if(!task.isEmpty()){JSONObject t=b.getJSONObject("tasks").getJSONObject(task);if(live(t.optString("status")))t.put("status","cancelled").put("error","slot-expired").put("finishedAt",now);}r.put("status","missed").put("recordedAt",now);slots.put(slot,r);}continue;}
   if(status.equals("running")&&time(now).isAfter(time(r.getString("leaseUntil")))){b=fail(b,r.getString("taskId"),now,"interrupted-or-expired-lease",true);slots=b.getJSONObject("slots");r=slots.getJSONObject(slot);status=r.getString("status");}
   if(r!=null&&(!status.equals("retrying")||time(now).isBefore(time(r.getString("nextRetryAt")))))continue;
   boolean busy=false;for(String k:keys(b.getJSONObject("tasks")))busy|=live(b.getJSONObject("tasks").getJSONObject(k).optString("status"));if(busy)continue;
   try{b=prepareTask(b,current,now,slot);slots=b.getJSONObject("slots");}catch(Exception e){int n=r==null?1:r.getInt("attempts")+1;slots.put(slot,obj("slot",slot,"attempts",n,"status",n<3?"retrying":"failed","error",e.getMessage(),"lastAttemptAt",now,"nextRetryAt",stamp(time(now).plusSeconds(n*60L))));}
  }return b;
 }
 static JSONObject accept(JSONObject input,JSONObject current,String taskId,String raw,String now,JSONObject provenance)throws Exception{
  JSONObject b=copy(input),t=b.getJSONObject("tasks").getJSONObject(taskId);
  if(t.optString("status").equals("completed")){need(t.getString("rawResponse").equals(raw),"同一任务的回复内容冲突");return b;}
  need(t.optString("status").equals("running"),"任务已取消、结束或尚未授权，旧回包未消费");bound(b,current);
  JSONObject p=t.getJSONObject("prepared");need(!time(now).isBefore(time(t.getString("requestStartedAt")))&&!time(now).isAfter(time(p.getJSONObject("readiness").getString("expiresAt"))),"回包早于请求或已过期");
  need(executionHash(b).equals(t.getString("executionHash")),"纸面余额、持仓或策略变化，旧回包未消费");
  need(provenance.has("source")&&!provenance.optString("source").isEmpty(),"需保留响应来源");JSONObject preview=PaperMonitorModel.preview(p,raw);
  t.put("rawResponse",raw).put("preview",preview).put("provenance",copy(provenance)).put("finishedAt",now).put("status",preview.getBoolean("valid")?"completed":"invalid");
  b.getJSONObject("slots").getJSONObject(t.getString("slot")).put("status",preview.getBoolean("valid")?"succeeded":"invalid");if(!preview.getBoolean("valid"))return b;
  JSONObject ids=new JSONObject();JSONArray universe=p.getJSONObject("readiness").getJSONArray("allowedUniverse");for(int i=0;i<universe.length();i++){JSONObject u=universe.getJSONObject(i);ids.put(u.getString("code"),u.getString("instrumentId"));}
  JSONArray orders=b.getJSONArray("orders"),decisions=preview.getJSONObject("decision").getJSONArray("orders");need(orders.length()+decisions.length()<=10000,"执行账本订单容量已满，需先导出核对");
  for(int i=0;i<decisions.length();i++){JSONObject o=copy(decisions.getJSONObject(i));String id=ids.getString(o.getString("code"));
   for(int j=0;j<orders.length();j++){JSONObject old=orders.getJSONObject(j);if(id.equals(old.optString("instrumentId"))&&old.optString("status").equals("pending"))old.put("status","cancelled").put("reason","superseded").put("updatedAt",now);}
   o.put("id",taskId+":"+i).put("taskId",taskId).put("instrumentId",id).put("name",p.getJSONObject("input").getJSONObject("quotes").getJSONObject(id).optString("name",id)).put("advisedAt",now).put("marketAsOf",p.getString("preparedAt")).put("status",o.getString("action").equals("hold")?"held":"pending");orders.put(o);
  }return b;
 }
}
