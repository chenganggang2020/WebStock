package com.webstock.companion;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashSet;

public final class StandaloneBackend {
    private final Context context;
    private final StandaloneStore store;
    private final StandaloneSecret secret;
    public StandaloneBackend(Context context) {this.context=context;store=new StandaloneStore(context);secret=new StandaloneSecret(context);}
    public StandaloneStore store() {return store;}
    private String param(URI uri,String name,String fallback) throws Exception {
        for(String part:(uri.getRawQuery()==null?"":uri.getRawQuery()).split("&")) {String[] pair=part.split("=",2);if(pair.length==2 && pair[0].equals(name)) return URLDecoder.decode(pair[1],"UTF-8");}
        return fallback;
    }
    public JSONObject request(String method,String address,JSONObject body) throws Exception {
        URI uri=new URI(address); if(uri.isAbsolute() || uri.getHost()!=null || address.length()>10000) throw new IllegalArgumentException("本地请求地址无效");
        String path=uri.getPath();
        if(path.equals("/state") && method.equals("GET")) return store.state();
        if(path.equals("/record") && method.equals("POST")) return store.save(body.getString("kind"),body.getJSONObject("item"));
        if(path.equals("/record") && method.equals("DELETE")) {store.remove(body.getString("kind"),body.getString("id"));return store.state();}
        if(path.equals("/portfolio") && method.equals("GET")) return StandaloneCore.ledger(store.read("trades"),store.quotes(),param(uri,"account","local"));
        if(path.equals("/quotes") && method.equals("GET")) return quotes(param(uri,"symbols","sh000001,sz399001,sz399006"));
        if(path.equals("/kline") && method.equals("GET")) return kline(StandaloneCore.symbol(param(uri,"code","000001")),param(uri,"period","day"));
        if(path.equals("/kline-history") && method.equals("GET")) {
            String before=param(uri,"before","");
            if(!before.matches("\\d{4}-\\d{2}-\\d{2}")) throw new IllegalArgumentException("历史截止日期无效");
            java.time.LocalDate.parse(before);
            return kline(StandaloneCore.symbol(param(uri,"code","000001")),param(uri,"period","day"),before);
        }
        if(path.equals("/minute") && method.equals("GET")) return minute(StandaloneCore.symbol(param(uri,"code","000001")));
        if(path.equals("/chart-cache") && method.equals("GET")) {
            String symbol=StandaloneCore.symbol(param(uri,"code","000001")),type=param(uri,"type","kline"),period=param(uri,"period","day");
            if(!type.matches("kline|minute") || !period.matches("day|week|month")) throw new IllegalArgumentException("图表类型无效");
            JSONObject cached=store.cached(type.equals("minute")?"minute-v2:"+symbol:"kline-v2:"+symbol+":"+period);
            return cached==null?new JSONObject().put("available",false):cached.put("available",true).put("cached",true).put("cacheRead",true);
        }
        if(path.equals("/rank") && method.equals("GET")) return rank(param(uri,"board","stocks"),param(uri,"sort","change"));
        if(path.equals("/news") && method.equals("GET")) return news();
        if(path.equals("/settings") && method.equals("GET")) return settings();
        if(path.equals("/settings") && method.equals("POST")) {
            String endpoint=body.optString("endpoint").trim(),model=body.optString("model").trim();
            if(!endpoint.isEmpty()) {URI target=new URI(endpoint);if(!"https".equals(target.getScheme()) || target.getHost()==null || target.getRawUserInfo()!=null) throw new IllegalArgumentException("AI 服务地址需使用 HTTPS");}
            if(body.has("key") && !body.optString("key").isEmpty()) secret.save(body.getString("key"));
            if(body.optBoolean("clearKey")) secret.save("");
            context.getSharedPreferences("independent-settings",0).edit().putString("endpoint",endpoint).putString("model",model).apply();return settings();
        }
        if(path.equals("/ai") && method.equals("POST")) return ai(body);
        if(path.equals("/backup") && method.equals("GET")) return store.backup();
        if(path.equals("/backup") && method.equals("POST")) {store.importBackup(body);return store.state();}
        throw new IllegalArgumentException("该功能尚未迁移到独立安卓端");
    }
    private JSONObject settings() throws Exception {
        android.content.SharedPreferences prefs=context.getSharedPreferences("independent-settings",0);
        return new JSONObject().put("endpoint",prefs.getString("endpoint","")).put("model",prefs.getString("model","")).put("keySet",secret.hasKey());
    }
    private JSONObject stale(String key,Exception error) throws Exception {
        JSONObject cached=store.cached(key); if(cached==null) throw new java.io.IOException("暂时无法取得数据，且本机尚无缓存。"+StandaloneCore.friendlyError(error));
        return cached.put("stale",true).put("attemptedAt",Instant.now().toString()).put("error","刷新失败，显示原缓存；"+StandaloneCore.friendlyError(error));
    }
    private JSONObject quotes(String input) throws Exception {
        LinkedHashSet<String> symbols=new LinkedHashSet<>(); for(String value:input.split(",")) {if(symbols.size()>=200) break;symbols.add(StandaloneCore.symbol(value));}
        JSONObject result=new JSONObject(),all=new JSONObject(); String now=Instant.now().toString();
        try {
            all=StandaloneCore.sina(StandaloneHttp.get("https://hq.sinajs.cn/list="+String.join(",",symbols),"https://finance.sina.com.cn",Charset.forName("GBK")),now);
            if(all.length()==0) throw new java.io.IOException("公开报价源未返回有效行情");
            for(String symbol:symbols) {JSONObject quote=all.optJSONObject(symbol);if(quote!=null) store.cache("quote:"+symbol,quote);}
        } catch(Exception error) {result.put("error",StandaloneCore.friendlyError(error)).put("stale",true);}
        JSONObject cached=store.quotes(); JSONArray missing=new JSONArray();
        for(String symbol:symbols) {
            JSONObject quote=all.optJSONObject(symbol);
            if(quote==null) {quote=cached.optJSONObject(symbol);if(quote!=null) quote.put("cached",true);else missing.put(symbol);}
            if(quote!=null) result.put(symbol,quote);
        }
        return new JSONObject().put("quotes",result).put("missing",missing).put("checkedAt",now).put("stale",result.optBoolean("stale")).put("error",result.optString("error"));
    }
    private JSONObject kline(String symbol,String period) throws Exception {
        return kline(symbol,period,"");
    }
    private JSONObject kline(String symbol,String period,String before) throws Exception {
        if(!period.matches("day|week|month")) throw new IllegalArgumentException("K线周期无效"); String key="kline-v2:"+symbol+":"+period+(before.isEmpty()?"":":"+before);
        try {
            JSONObject raw=new JSONObject(StandaloneHttp.get("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param="+symbol+","+period+",,"+before+",640,qfq","https://gu.qq.com/",StandardCharsets.UTF_8));
            JSONArray rows=StandaloneCore.kline(raw,symbol,period); if(rows.length()==0) throw new java.io.IOException("K线数据暂不可用");
            JSONObject result=new JSONObject().put("rows",rows).put("symbol",symbol).put("period",period).put("adjustment",StandaloneCore.klineAdjustment(raw,symbol,period)).put("volumeUnit","手").put("source","tencent-public-kline").put("checkedAt",Instant.now().toString()).put("stale",false);store.cache(key,result);return result;
        } catch(Exception error) {return stale(key,error);}
    }
    private JSONObject minute(String symbol) throws Exception {
        String key="minute-v2:"+symbol;
        try {
            JSONObject raw=new JSONObject(StandaloneHttp.get("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code="+symbol,"https://gu.qq.com/",StandardCharsets.UTF_8));
            JSONObject result=StandaloneCore.minute(raw,symbol);
            if(result.getJSONArray("rows").length()==0) throw new java.io.IOException("该代码暂缺一分钟分时");
            result.put("source","tencent-1m").put("checkedAt",Instant.now().toString()).put("stale",false);store.cache(key,result);return result;
        } catch(Exception error) {return stale(key,error);}
    }
    private JSONObject rank(String board,String sort) throws Exception {
        String fs=board.equals("industry")?"m:90+t:2":board.equals("concept")?"m:90+t:3":board.equals("etf")?"b:MK0021,b:MK0022,b:MK0023,b:MK0024":"m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
        String field=sort.equals("flow")?"f62":"f3",key="rank:"+board+":"+field;
        try {
            String url="https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=30&po=1&np=1&fltt=2&invt=2&fid="+field+"&fs="+URLEncoder.encode(fs,"UTF-8")+"&fields=f12,f14,f2,f3,f62,f124";
            JSONArray data=new JSONObject(StandaloneHttp.get(url,"https://quote.eastmoney.com/",StandardCharsets.UTF_8)).getJSONObject("data").getJSONArray("diff"),rows=new JSONArray();
            for(int i=0;i<data.length();i++) {JSONObject row=data.getJSONObject(i);rows.put(new JSONObject().put("code",row.optString("f12")).put("name",row.optString("f14")).put("price",StandaloneCore.nullable(StandaloneCore.number(row.opt("f2")))).put("changePercent",StandaloneCore.nullable(StandaloneCore.number(row.opt("f3")))).put("netFlow",StandaloneCore.nullable(StandaloneCore.number(row.opt("f62")))).put("dataTimestamp",StandaloneCore.nullable(StandaloneCore.number(row.opt("f124")))));}
            if(rows.length()==0) throw new java.io.IOException("榜单暂无有效数据");
            JSONObject result=new JSONObject().put("rows",rows).put("source","eastmoney-public-model").put("checkedAt",Instant.now().toString()).put("stale",false);store.cache(key,result);return result;
        } catch(Exception error) {return stale(key,error);}
    }
    private JSONObject news() throws Exception {
        String key="news";
        try {
            JSONArray rows=StandaloneCore.news(new JSONObject(StandaloneHttp.get("https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2510&num=30&page=1","https://finance.sina.com.cn/",StandardCharsets.UTF_8)));
            JSONObject result=new JSONObject().put("rows",rows).put("source","sina-finance-public-news").put("checkedAt",Instant.now().toString()).put("stale",false);store.cache(key,result);return result;
        } catch(Exception error) {return stale(key,error);}
    }
    private JSONObject ai(JSONObject input) throws Exception {
        JSONObject settings=settings(); String key=secret.read(),endpoint=settings.optString("endpoint"),model=settings.optString("model");
        if(key.isEmpty() || endpoint.isEmpty() || model.isEmpty()) throw new IllegalArgumentException("请先在手机设置自己的 AI 服务地址、模型和密钥");
        String prompt=input.getString("prompt"); if(prompt.length()>60000) throw new IllegalArgumentException("研究内容过长，请拆分提交");
        JSONArray messages=new JSONArray().put(new JSONObject().put("role","system").put("content","你是研究资料整理助手。区分原文事实、推断与待核验内容。只依据用户给出的资料和带来源的报价，不捏造来源或数据，不执行交易。"))
            .put(new JSONObject().put("role","user").put("content",prompt));
        JSONObject body=new JSONObject().put("model",model).put("messages",messages).put("stream",false);
        JSONObject response=new JSONObject(StandaloneHttp.request(endpoint,null,body,key,StandardCharsets.UTF_8));
        String text=response.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content");
        return store.save("reports",new JSONObject().put("title",input.optString("title","AI研究记录")).put("text",text).put("sourceUrl","").put("verification","unverified").put("model",model).put("prompt",prompt));
    }
}
