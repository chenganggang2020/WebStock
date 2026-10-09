package com.webstock.companion;

import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class StandaloneCore {
    private StandaloneCore() {}
    public static String symbol(String input) {
        String code=input==null?"":input.trim().toLowerCase(java.util.Locale.ROOT);
        if(code.matches("(sh|sz|bj)[0-9]{6}")) return code;
        if(!code.matches("[0-9]{6}")) throw new IllegalArgumentException("请输入六位股票代码");
        String prefix=code.startsWith("92") || code.startsWith("4") || code.startsWith("8") ? "bj" : code.matches("[569].*")?"sh":"sz";
        return prefix+code;
    }
    public static JSONObject failure(String message) throws Exception { return new JSONObject().put("success",false).put("error",message); }
    public static String friendlyError(Exception error) {
        if(error instanceof java.net.UnknownHostException || error instanceof java.net.ConnectException) return "手机网络不可用或无法连接数据服务，请检查网络后重试";
        if(error instanceof java.net.SocketTimeoutException) return "数据服务连接超时，请稍后重试";
        if(error instanceof javax.net.ssl.SSLException) return "无法建立安全连接，请检查手机网络与系统时间";
        if(error instanceof org.json.JSONException) return "数据服务返回了无法识别的内容，请稍后重试";
        String message=error.getMessage();return message!=null&&message.matches("[\\s\\S]*[\\u4e00-\\u9fff][\\s\\S]*")?message:"操作未完成，请检查网络或输入信息后重试";
    }
    public static JSONObject success(Object data) throws Exception { return new JSONObject().put("success",true).put("data",data); }
    public static JSONObject sina(String raw,String checkedAt) throws Exception {
        JSONObject result=new JSONObject();
        Matcher lines=Pattern.compile("hq_str_((?:sh|sz|bj)[0-9]{6})=\"([^\"]*)\"").matcher(raw);
        while(lines.find()) {
            String[] fields=lines.group(2).split(",",-1);
            if(fields.length<32) continue;
            Double price=number(fields[3]),previous=number(fields[2]);
            if(price==null || price<=0) continue;
            Double change=previous!=null && previous>0 ? (price-previous)/previous*100 : null;
            JSONObject quote=new JSONObject().put("symbol",lines.group(1)).put("code",lines.group(1).substring(2))
                .put("name",fields[0]).put("price",price).put("previousClose",nullable(previous))
                .put("changePercent",nullable(change)).put("open",nullable(number(fields[1])))
                .put("high",nullable(number(fields[4]))).put("low",nullable(number(fields[5])))
                .put("volume",nullable(number(fields[8]))).put("amount",nullable(number(fields[9])))
                .put("tradeDate",fields[30]).put("tradeTime",fields[31]).put("checkedAt",checkedAt).put("source","sina-public-quote");
            result.put(lines.group(1),quote);
        }
        return result;
    }
    public static Double number(Object value) {
        try { double n=Double.parseDouble(String.valueOf(value)); return Double.isFinite(n)?n:null; }
        catch(Exception ignored) { return null; }
    }
    public static Object nullable(Object value) { return value==null?JSONObject.NULL:value; }
    public static JSONArray news(JSONObject response) throws Exception {
        JSONObject result=response.getJSONObject("result");
        if(result.getJSONObject("status").optInt("code",-1)!=0) throw new IllegalArgumentException("资讯源返回失败状态");
        JSONArray input=result.getJSONArray("data"),rows=new JSONArray();
        for(int i=0;i<input.length();i++) {JSONObject row=input.getJSONObject(i);
            if(row.optString("title").trim().isEmpty() || !row.optString("url").matches("https?://[^\\s]+")) continue;
            rows.put(new JSONObject().put("title",row.getString("title")).put("url",row.getString("url")).put("publishedAt",row.optString("ctime")).put("summary",row.optString("intro")));
        }
        if(rows.length()==0) throw new IllegalArgumentException("资讯源未返回有效文章");return rows;
    }
    public static String klineAdjustment(JSONObject response,String symbol,String period) throws Exception {
        JSONObject data=response.getJSONObject("data").getJSONObject(symbol);
        return data.optJSONArray("qfq"+period)!=null?"qfq":"none";
    }
    public static JSONArray kline(JSONObject response,String symbol,String period) throws Exception {
        if(response.optInt("code",0)!=0) throw new IllegalArgumentException("K线数据源返回失败状态");
        JSONObject data=response.getJSONObject("data").getJSONObject(symbol);
        JSONArray input=data.optJSONArray("qfq"+period);
        if(input==null) input=data.optJSONArray(period);
        JSONArray rows=new JSONArray();
        if(input==null) return rows;
        for(int i=0;i<input.length();i++) {
            JSONArray row=input.getJSONArray(i);
            if(row.length()<6) throw new IllegalArgumentException("K线字段不完整，保留原缓存");
            Double open=number(row.opt(1)),close=number(row.opt(2)),high=number(row.opt(3)),low=number(row.opt(4)),volume=number(row.opt(5));
            if(open==null || close==null || high==null || low==null || volume==null || low<=0 || high<low || open<low || open>high || close<low || close>high || volume<0) throw new IllegalArgumentException("K线价格或成交量无效，保留原缓存");
            String date=row.getString(0); LocalDate.parse(date);
            if(rows.length()>0 && date.compareTo(rows.getJSONObject(rows.length()-1).getString("date"))<=0) throw new IllegalArgumentException("K线日期顺序异常，保留原缓存");
            rows.put(new JSONObject().put("date",date).put("open",open).put("close",close).put("high",high).put("low",low).put("volume",volume));
        }
        return rows;
    }
    public static JSONObject minute(JSONObject response,String symbol) throws Exception {
        if(response.optInt("code",0)!=0) throw new IllegalArgumentException("分时数据源返回失败状态");
        JSONObject container=response.getJSONObject("data").getJSONObject(symbol),data=container.getJSONObject("data");
        String date=data.getString("date");LocalDate.parse(date,java.time.format.DateTimeFormatter.BASIC_ISO_DATE);
        JSONArray input=data.getJSONArray("data"),rows=new JSONArray();Double previousVolume=null;int previousMinute=-1;
        for(int i=0;i<input.length();i++) {
            String[] fields=input.getString(i).trim().split("\\s+");
            if(fields.length<3 || !fields[0].matches("[0-9]{4}")) continue;
            int hour=Integer.parseInt(fields[0].substring(0,2)),minutePart=Integer.parseInt(fields[0].substring(2));
            int minute=hour*60+minutePart; if(minutePart>59 || !((minute>=570&&minute<=690)||(minute>=780&&minute<=900)))continue;
            Double price=number(fields[1]),cumulative=number(fields[2]),amount=fields.length>3?number(fields[3]):null;
            if(price==null||price<=0||cumulative==null||cumulative<0)continue;
            if(minute<=previousMinute)throw new IllegalArgumentException("分时时间顺序异常，保留原缓存");
            boolean continuous=minute==previousMinute+1 || previousMinute==690&&minute==780;
            Double volume=previousVolume==null?(minute==570?cumulative:null):continuous&&cumulative>=previousVolume?cumulative-previousVolume:null;
            Double average=cumulative>0&&amount!=null&&amount>0?amount/(cumulative*100):null;
            rows.put(new JSONObject().put("time",fields[0]).put("price",price).put("volume",nullable(volume)).put("averagePrice",nullable(average)));
            previousVolume=cumulative;previousMinute=minute;
        }
        JSONObject qt=container.optJSONObject("qt");JSONArray quote=qt==null?null:qt.optJSONArray(symbol);
        Double previousClose=quote==null?null:number(quote.opt(4));
        return new JSONObject().put("rows",rows).put("symbol",symbol).put("date",date).put("previousClose",nullable(previousClose)).put("volumeUnit","手");
    }
    private static final class Position {
        String code,name; long quantity; BigDecimal cost=BigDecimal.ZERO;
        Position(String code,String name) { this.code=code; this.name=name; }
    }
    private static BigDecimal amount(JSONObject trade,String key,boolean positive) throws Exception {
        Double value=number(trade.opt(key));
        if(value==null || value<0 || positive && value<=0 || value>1e12) throw new IllegalArgumentException("交易金额或数量无效："+key);
        return BigDecimal.valueOf(value);
    }
    private static double rounded(BigDecimal value) { return value.setScale(2,RoundingMode.HALF_UP).doubleValue(); }
    public static JSONObject ledger(JSONArray input,JSONObject quotes,String accountId) throws Exception {
        ArrayList<JSONObject> trades=new ArrayList<>();
        for(int i=0;i<input.length();i++) {
            JSONObject trade=input.getJSONObject(i);
            if(accountId.equals(trade.optString("accountId"))) { LocalDate.parse(trade.getString("date")); trades.add(trade); }
        }
        // Stable ordering keeps user-entered order for multiple records on the same date.
        trades.sort(Comparator.comparing(trade->trade.optString("date")));
        LinkedHashMap<String,Position> holdings=new LinkedHashMap<>();
        BigDecimal realized=BigDecimal.ZERO,totalCost=BigDecimal.ZERO,marketValue=BigDecimal.ZERO;
        boolean missingQuote=false;
        for(JSONObject trade:trades) {
            String code=trade.getString("code"),sym=symbol(code); code=sym.substring(2);
            BigDecimal qty=amount(trade,"quantity",true),price=amount(trade,"price",true),fee=amount(trade,"fee",false);
            long count=qty.longValueExact(); if(count>1_000_000_000L) throw new IllegalArgumentException("交易数量过大");
            Position position=holdings.get(code);
            if(position==null) { position=new Position(code,trade.optString("name",code)); holdings.put(code,position); }
            String side=trade.getString("side");
            if("buy".equals(side)) { position.cost=position.cost.add(price.multiply(qty)).add(fee); position.quantity+=count; }
            else if("sell".equals(side)) {
                if(count>position.quantity) throw new IllegalArgumentException(code+" 卖出数量超过该账户已有持仓");
                BigDecimal removed=position.cost.multiply(qty).divide(BigDecimal.valueOf(position.quantity),12,RoundingMode.HALF_UP);
                realized=realized.add(price.multiply(qty).subtract(fee).subtract(removed));
                position.cost=position.cost.subtract(removed); position.quantity-=count;
                if(position.quantity==0) position.cost=BigDecimal.ZERO;
            } else throw new IllegalArgumentException("请选择买入或卖出");
        }
        JSONArray rows=new JSONArray();
        for(Position position:holdings.values()) {
            if(position.quantity==0) continue;
            JSONObject quote=quotes.optJSONObject(symbol(position.code)); Double price=quote==null?null:number(quote.opt("price"));
            if(price!=null && price<=0) price=null;
            BigDecimal value=price==null?null:BigDecimal.valueOf(price).multiply(BigDecimal.valueOf(position.quantity));
            if(value==null) missingQuote=true; else marketValue=marketValue.add(value);
            totalCost=totalCost.add(position.cost);
            rows.put(new JSONObject().put("code",position.code).put("name",position.name).put("quantity",position.quantity)
                .put("averageCost",position.cost.divide(BigDecimal.valueOf(position.quantity),8,RoundingMode.HALF_UP).doubleValue())
                .put("price",nullable(price)).put("marketValue",value==null?JSONObject.NULL:rounded(value))
                .put("unrealizedPnl",value==null?JSONObject.NULL:rounded(value.subtract(position.cost))).put("quote",nullable(quote)));
        }
        return new JSONObject().put("positions",rows).put("cost",rounded(totalCost)).put("realizedPnl",rounded(realized))
            .put("marketValue",missingQuote?JSONObject.NULL:rounded(marketValue))
            .put("unrealizedPnl",missingQuote?JSONObject.NULL:rounded(marketValue.subtract(totalCost))).put("missingQuotes",missingQuote);
    }
}
