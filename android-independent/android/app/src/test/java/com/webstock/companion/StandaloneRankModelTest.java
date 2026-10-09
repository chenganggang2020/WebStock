package com.webstock.companion;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class StandaloneRankModelTest {
    private JSONArray listed() throws Exception {
        return new JSONArray("[{symbol:'sh510300',code:'510300',name:'沪深300ETF',trade:'4.25',changepercent:1.25,amount:123456.78,ticktime:'15:00:00'}]");
    }
    @Test public void amountsAreNotInventedFundFlows() throws Exception {
        JSONObject row=StandaloneRankModel.sinaEtf(listed(),new JSONObject()).getJSONObject(0);
        assertEquals("510300",row.getString("code"));
        assertEquals(123456.78,row.getDouble("amount"),0.00001);
        assertTrue(row.isNull("netFlow"));assertTrue(row.isNull("dataTimestamp"));
        assertTrue(row.isNull("quoteTradeDate"));assertEquals("15:00:00",row.getString("providerTime"));
    }
    @Test public void quoteDateIsSeparateFromUndatedRankingSnapshot() throws Exception {
        JSONObject quotes=new JSONObject("{sh510300:{symbol:'sh510300',tradeDate:'2026-09-30',tradeTime:'15:00:01',price:4.26,checkedAt:'2026-10-05T01:00:00Z'}}");
        JSONObject row=StandaloneRankModel.sinaEtf(listed(),quotes).getJSONObject(0);
        assertEquals("2026-09-30",row.getString("quoteTradeDate"));
        assertEquals("15:00:01",row.getString("quoteTradeTime"));
        assertEquals(4.25,row.getDouble("price"),0);
        assertEquals(4.26,row.getDouble("quotePrice"),0);
        assertTrue(row.isNull("dataTimestamp"));
    }
    @Test public void absentOrInvalidMetricsRemainNull() throws Exception {
        JSONArray input=new JSONArray("[{symbol:'sz159001',code:'159001',name:'ETF',trade:0,changepercent:'-',amount:-5,ticktime:'25:00:00'}]");
        JSONObject row=StandaloneRankModel.sinaEtf(input,new JSONObject()).getJSONObject(0);
        assertTrue(row.isNull("price"));assertTrue(row.isNull("changePercent"));assertTrue(row.isNull("amount"));assertTrue(row.isNull("providerTime"));
    }
    @Test public void invalidAndDuplicateSymbolsAreSkipped() throws Exception {
        JSONArray input=listed();input.put(input.getJSONObject(0));
        input.put(new JSONObject("{symbol:'sh510300&x=1',code:'510300',name:'invalid'}"));
        input.put(new JSONObject("{symbol:'sz159001',code:'510300',name:'mismatch'}"));
        assertEquals(1,StandaloneRankModel.sinaEtf(input,new JSONObject()).length());
    }
    @Test public void wrongSymbolAndImpossibleQuoteDatesAreNotAttributed() throws Exception {
        JSONObject quotes=new JSONObject("{sh510300:{symbol:'sz159001',tradeDate:'2026-09-30',tradeTime:'15:00:00',price:4.26}}");
        assertTrue(StandaloneRankModel.sinaEtf(listed(),quotes).getJSONObject(0).isNull("quoteTradeDate"));
        quotes.getJSONObject("sh510300").put("symbol","sh510300").put("tradeDate","2026-02-30");
        assertTrue(StandaloneRankModel.sinaEtf(listed(),quotes).getJSONObject(0).isNull("quoteTradeDate"));
    }
    @Test(expected=IllegalArgumentException.class) public void emptyProviderResponseIsUnavailable() throws Exception {
        StandaloneRankModel.sinaEtf(new JSONArray(),new JSONObject());
    }
}
