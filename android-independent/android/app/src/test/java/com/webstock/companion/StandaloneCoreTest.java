package com.webstock.companion;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class StandaloneCoreTest {
    @Test public void minuteUsesVolumeDeltaAndAmountWeightedAverage() throws Exception {
        JSONObject raw=new JSONObject("{data:{sz000001:{data:{date:'20260930',data:['0930 10 100 100000','0931 11 150 155000','0933 11 180 188000','0934 11 10 11000']},qt:{sz000001:['0','name','000001','11','9']}}}}");
        JSONObject result=StandaloneCore.minute(raw,"sz000001");JSONArray rows=result.getJSONArray("rows");
        assertEquals(100,rows.getJSONObject(0).getDouble("volume"),0);
        assertEquals(50,rows.getJSONObject(1).getDouble("volume"),0);
        assertEquals(155000.0/15000,rows.getJSONObject(1).getDouble("averagePrice"),0.00001);
        assertTrue(rows.getJSONObject(2).isNull("volume"));
        assertTrue(rows.getJSONObject(3).isNull("volume"));
        assertEquals(9,result.getDouble("previousClose"),0);
    }
    @Test public void missingMinuteAmountStaysMissing() throws Exception {
        JSONObject raw=new JSONObject("{data:{sz000001:{data:{date:'20260930',data:['1000 10 100']}}}}");
        JSONObject row=StandaloneCore.minute(raw,"sz000001").getJSONArray("rows").getJSONObject(0);
        assertTrue(row.isNull("averagePrice"));assertTrue(row.isNull("volume"));
    }
    @Test public void unadjustedFallbackIsLabelledAccurately() throws Exception {
        JSONObject raw=new JSONObject("{data:{sz000001:{day:[['2026-09-30','10','11','12','9','1000']]}}}");
        assertEquals("none",StandaloneCore.klineAdjustment(raw,"sz000001","day"));
    }
    @Test(expected=IllegalArgumentException.class) public void invalidCandleDoesNotJoinNineTurnAcrossGap() throws Exception {
        StandaloneCore.kline(new JSONObject("{data:{sz000001:{qfqday:[['2026-09-30','30','11','12','9','1000']]}}}"),"sz000001","day");
    }
    @Test public void stockAndIndexSymbolsStayDistinct() {
        assertEquals("sz000001", StandaloneCore.symbol("000001"));
        assertEquals("sh000001", StandaloneCore.symbol("sh000001"));
        assertEquals("sh510300", StandaloneCore.symbol("510300"));
        assertEquals("bj920002", StandaloneCore.symbol("920002"));
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsInjectedSymbols() { StandaloneCore.symbol("000001&secret=1"); }
    @Test public void publicQuotePreservesDateAndMissingChange() throws Exception {
        String[] fields=new String[33]; java.util.Arrays.fill(fields,"0");
        fields[0]="平安银行"; fields[2]="0"; fields[3]="12.36"; fields[30]="2026-09-30"; fields[31]="15:00:00";
        JSONObject quote=StandaloneCore.sina("var hq_str_sz000001=\""+String.join(",",fields)+"\";", "2026-10-01T01:00:00Z").getJSONObject("sz000001");
        assertEquals("2026-09-30",quote.getString("tradeDate")); assertTrue(quote.isNull("changePercent"));
        assertEquals(12.36,quote.getDouble("price"),0.001); assertEquals("sina-public-quote",quote.getString("source"));
    }
    @Test public void unavailableQuotesAreNotZeros() throws Exception {
        assertEquals(0,StandaloneCore.sina("var hq_str_sz000001=\"\";", "now").length());
    }
    @Test public void computesHoldingsWithFeesAndRealizedProfit() throws Exception {
        JSONArray trades=new JSONArray();
        trades.put(new JSONObject("{id:'a',accountId:'local',code:'600000',name:'浦发银行',side:'buy',quantity:100,price:10,fee:5,date:'2026-09-28'}"));
        trades.put(new JSONObject("{id:'b',accountId:'local',code:'600000',name:'浦发银行',side:'sell',quantity:40,price:12,fee:2,date:'2026-09-29'}"));
        JSONObject quote=new JSONObject("{sh600000:{price:11}}");
        JSONObject state=StandaloneCore.ledger(trades,quote,"local"); JSONObject holding=state.getJSONArray("positions").getJSONObject(0);
        assertEquals(60,holding.getInt("quantity")); assertEquals(10.05,holding.getDouble("averageCost"),0.000001);
        assertEquals(76,state.getDouble("realizedPnl"),0.000001); assertEquals(57,holding.getDouble("unrealizedPnl"),0.000001);
    }
    @Test public void missingQuoteDoesNotBecomeZeroValuation() throws Exception {
        JSONArray trades=new JSONArray("[{id:'a',accountId:'local',code:'600000',side:'buy',quantity:100,price:10,fee:0,date:'2026-09-28'}]");
        JSONObject state=StandaloneCore.ledger(trades,new JSONObject(),"local");
        assertTrue(state.isNull("marketValue")); assertTrue(state.getJSONArray("positions").getJSONObject(0).isNull("unrealizedPnl"));
    }
    @Test(expected=IllegalArgumentException.class) public void cannotSellMoreThanOwned() throws Exception {
        StandaloneCore.ledger(new JSONArray("[{id:'a',accountId:'local',code:'600000',side:'sell',quantity:100,price:10,fee:0,date:'2026-09-28'}]"),new JSONObject(),"local");
    }
    @Test public void accountsDoNotShareHoldings() throws Exception {
        JSONObject result=StandaloneCore.ledger(new JSONArray("[{id:'a',accountId:'other',code:'600000',side:'buy',quantity:100,price:10,fee:0,date:'2026-09-28'}]"),new JSONObject(),"local");
        assertEquals(0,result.getJSONArray("positions").length());
    }
    @Test public void klineRetainsTradingDateAndOhlcOrder() throws Exception {
        JSONObject raw=new JSONObject("{data:{sz000001:{qfqday:[['2026-09-30','10','11','12','9','1000']]}}}");
        JSONObject row=StandaloneCore.kline(raw,"sz000001","day").getJSONObject(0);
        assertEquals("2026-09-30",row.getString("date")); assertEquals(11,row.getDouble("close"),0); assertEquals(9,row.getDouble("low"),0);
    }
    @Test public void unsupportedResponseIsNotAnEmptySuccess() throws Exception {
        assertFalse(StandaloneCore.failure("该功能尚未迁移").getBoolean("success"));
    }
    @Test(expected=IllegalArgumentException.class) public void newsProviderFailureIsNotEmptySuccess() throws Exception {
        StandaloneCore.news(new JSONObject("{result:{status:{code:11,msg:'unregistered'},data:[]}}"));
    }
    @Test public void newsPreservesOriginalLinkAndPublicationTime() throws Exception {
        JSONArray rows=StandaloneCore.news(new JSONObject("{result:{status:{code:0},data:[{title:'新闻标题',url:'https://finance.sina.com.cn/example.shtml',ctime:'1790841600',intro:'摘要'}]}}"));
        assertEquals("1790841600",rows.getJSONObject(0).getString("publishedAt"));
        assertEquals("https://finance.sina.com.cn/example.shtml",rows.getJSONObject(0).getString("url"));
    }
    @Test public void offlineErrorIsReadableWithoutNetworkInternals() {
        String message=StandaloneCore.friendlyError(new java.net.UnknownHostException("hq.sinajs.cn"));
        assertTrue(message.contains("网络"));assertFalse(message.contains("hq.sinajs.cn"));
    }
    @Test public void keepsActionableLocalValidationMessage() {
        assertEquals("卖出数量超过已有持仓",StandaloneCore.friendlyError(new IllegalArgumentException("卖出数量超过已有持仓")));
    }
}
