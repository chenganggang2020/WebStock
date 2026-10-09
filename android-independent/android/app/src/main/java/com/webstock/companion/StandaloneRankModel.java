package com.webstock.companion;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.LinkedHashSet;

/** Keeps provider ranking fields separate from the independently fetched dated quote. */
public final class StandaloneRankModel {
    private StandaloneRankModel() {}
    private static Object positive(Object raw,boolean allowZero) {
        Double value=StandaloneCore.number(raw);
        return StandaloneCore.nullable(value!=null && (allowZero?value>=0:value>0)?value:null);
    }
    private static Object date(String value) {
        try {return value.matches("\\d{4}-\\d{2}-\\d{2}")?LocalDate.parse(value).toString():JSONObject.NULL;}
        catch(Exception ignored) {return JSONObject.NULL;}
    }
    private static Object time(String value) {
        try {if(value.matches("\\d{2}:\\d{2}:\\d{2}")) {LocalTime.parse(value);return value;}}
        catch(Exception ignored) {}
        return JSONObject.NULL;
    }
    public static JSONArray sinaEtf(JSONArray input,JSONObject quotes) throws Exception {
        if(input.length()>50) throw new IllegalArgumentException("ETF榜单响应超过条数限制");
        JSONArray rows=new JSONArray();LinkedHashSet<String> seen=new LinkedHashSet<>();
        for(int i=0;i<input.length();i++) {
            JSONObject raw=input.optJSONObject(i);if(raw==null)continue;
            String symbol=raw.optString("symbol"),code=raw.optString("code"),name=raw.optString("name").trim();
            if(!symbol.matches("(?:sh|sz)[0-9]{6}") || !code.equals(symbol.substring(2)) || name.isEmpty() || !seen.add(symbol))continue;
            JSONObject quote=quotes.optJSONObject(symbol);
            if(quote!=null && !symbol.equals(quote.optString("symbol")))quote=null;
            rows.put(new JSONObject().put("code",code).put("symbol",symbol).put("name",name)
                .put("price",positive(raw.opt("trade"),false)).put("changePercent",StandaloneCore.nullable(StandaloneCore.number(raw.opt("changepercent"))))
                .put("amount",positive(raw.opt("amount"),true)).put("netFlow",JSONObject.NULL).put("dataTimestamp",JSONObject.NULL)
                .put("providerTime",time(raw.optString("ticktime")))
                .put("quoteTradeDate",quote==null?JSONObject.NULL:date(quote.optString("tradeDate")))
                .put("quoteTradeTime",quote==null?JSONObject.NULL:time(quote.optString("tradeTime")))
                .put("quotePrice",quote==null?JSONObject.NULL:positive(quote.opt("price"),false))
                .put("quoteSource",quote==null?JSONObject.NULL:"sina-public-quote")
                .put("quoteCheckedAt",quote==null?JSONObject.NULL:StandaloneCore.nullable(quote.opt("checkedAt"))));
        }
        if(rows.length()==0) throw new IllegalArgumentException("新浪 ETF 榜单暂无有效数据");
        return rows;
    }
}
