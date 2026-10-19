package com.webstock.companion;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.math.BigDecimal;
import java.math.RoundingMode;
import static org.junit.Assert.*;

public class StandaloneAnalyticsTest {
    private JSONObject trade(String id,String date,String side,int quantity,double price,double fee) throws Exception {
        return new JSONObject().put("id",id).put("accountId","local").put("code","600000").put("name","浦发银行")
            .put("date",date).put("side",side).put("quantity",quantity).put("price",price).put("fee",fee).put("note","复盘备注");
    }
    @Test public void feesAndPartialSaleUseRecordedMovingAverageCost() throws Exception {
        JSONArray trades=new JSONArray().put(trade("buy","2026-09-28","buy",100,10,5)).put(trade("sell","2026-09-29","sell",40,12,2));
        JSONObject state=StandaloneCore.ledger(trades,new JSONObject(),"local"),a=state.getJSONObject("analytics");
        assertEquals(7,a.getDouble("totalFees"),0);assertEquals(1005,a.getDouble("buyAmount"),0);assertEquals(478,a.getDouble("sellProceeds"),0);
        assertEquals(76,a.getDouble("realizedPnl"),0);assertEquals(2,a.getInt("tradeCount"));assertEquals(1,a.getInt("winningSellCount"));
        JSONObject buy=a.getJSONArray("trades").getJSONObject(0),sell=a.getJSONArray("trades").getJSONObject(1);
        assertTrue(buy.isNull("realizedPnl"));assertEquals(1005,buy.getDouble("netAmount"),0);
        assertEquals(76,sell.getDouble("realizedPnl"),0);assertEquals(60,sell.getInt("positionQuantity"));assertEquals("复盘备注",sell.getString("note"));
        assertEquals(603,a.getJSONArray("symbols").getJSONObject(0).getDouble("cost"),0);
        assertTrue(state.isNull("marketValue"));assertTrue(state.isNull("unrealizedPnl"));
        assertFalse(a.has("returnRate"));assertFalse(a.has("marketValueSeries"));
    }
    @Test public void sameDayEntriesKeepOrderAndClosedPositionReopensAtNewCost() throws Exception {
        JSONArray trades=new JSONArray().put(trade("z-buy","2026-09-28","buy",100,10,0))
            .put(trade("a-sell","2026-09-28","sell",100,12,0)).put(trade("m-reopen","2026-09-28","buy",50,20,5))
            .put(trade("n-sell","2026-09-29","sell",50,19,5));
        JSONObject state=StandaloneCore.ledger(trades,new JSONObject(),"local"),a=state.getJSONObject("analytics");
        assertEquals(0,state.getJSONArray("positions").length());assertEquals(140,a.getDouble("realizedPnl"),0);
        assertEquals(1,a.getInt("winningSellCount"));assertEquals(1,a.getInt("losingSellCount"));
        assertEquals("z-buy",a.getJSONArray("trades").getJSONObject(0).getString("id"));
        assertEquals(-60,a.getJSONArray("trades").getJSONObject(3).getDouble("realizedPnl"),0);
        JSONArray series=a.getJSONArray("realizedSeries");assertEquals(2,series.length());
        assertEquals(3,series.getJSONObject(0).getInt("tradeCount"));assertEquals(200,series.getJSONObject(0).getDouble("realizedPnl"),0);
        assertEquals(140,series.getJSONObject(1).getDouble("cumulativeRealizedPnl"),0);
        JSONObject symbol=a.getJSONArray("symbols").getJSONObject(0);
        assertEquals(0,symbol.getInt("quantity"));assertEquals(0,symbol.getDouble("cost"),0);assertEquals(140,symbol.getDouble("realizedPnl"),0);
    }
    @Test public void statisticsSortDatesAndIsolateAccountsAndSymbols() throws Exception {
        JSONObject other=trade("other","2026-09-01","buy",100,1,50).put("accountId","other");
        JSONObject second=trade("second","2026-09-30","buy",100,5,2).put("code","000001").put("name","平安银行");
        JSONArray trades=new JSONArray().put(trade("sell","2026-09-29","sell",100,10,0)).put(other).put(second)
            .put(trade("buy","2026-09-28","buy",100,10,0));
        JSONObject a=StandaloneCore.ledger(trades,new JSONObject(),"local").getJSONObject("analytics");
        assertEquals(3,a.getInt("tradeCount"));assertEquals(2,a.getInt("buyCount"));assertEquals(1,a.getInt("flatSellCount"));
        assertEquals(2,a.getDouble("totalFees"),0);assertEquals(1502,a.getDouble("buyAmount"),0);assertEquals(1000,a.getDouble("sellProceeds"),0);
        assertEquals("2026-09-28",a.getString("firstTradeDate"));assertEquals("2026-09-30",a.getString("lastTradeDate"));
        assertEquals("buy",a.getJSONArray("trades").getJSONObject(0).getString("id"));assertEquals(2,a.getJSONArray("symbols").length());
        assertEquals(502,a.getJSONArray("symbols").getJSONObject(1).getDouble("buyAmount"),0);
        JSONObject empty=StandaloneCore.ledger(trades,new JSONObject(),"absent").getJSONObject("analytics");
        assertEquals(0,empty.getInt("tradeCount"));assertEquals(0,empty.getDouble("realizedPnl"),0);
        assertTrue(empty.isNull("firstTradeDate"));assertTrue(empty.isNull("lastTradeDate"));assertEquals(0,empty.getJSONArray("realizedSeries").length());
    }
    @Test public void finalSaleConsumesRemainingCostWithoutRoundingDrift() throws Exception {
        JSONArray trades=new JSONArray().put(trade("buy","2026-09-01","buy",3,10,0.01))
            .put(trade("sale1","2026-09-02","sell",1,11,0.01)).put(trade("sale2","2026-09-03","sell",1,11,0.01))
            .put(trade("sale3","2026-09-04","sell",1,11,0.01));
        JSONObject a=StandaloneCore.ledger(trades,new JSONObject(),"local").getJSONObject("analytics");
        assertEquals(2.96,a.getDouble("realizedPnl"),0);assertEquals(0.04,a.getDouble("totalFees"),0);
        assertEquals(2.96,a.getJSONArray("realizedSeries").getJSONObject(3).getDouble("cumulativeRealizedPnl"),0);
        assertEquals(0,a.getJSONArray("symbols").getJSONObject(0).getDouble("cost"),0);
    }
    @Test public void sameDayOversellIsNotReorderedAroundLaterPurchase() throws Exception {
        JSONArray trades=new JSONArray().put(trade("sell","2026-09-28","sell",100,10,0)).put(trade("buy","2026-09-28","buy",100,10,0));
        try {StandaloneCore.ledger(trades,new JSONObject(),"local");fail("Same-day order must not hide overselling");}
        catch(IllegalArgumentException expected) {assertTrue(expected.getMessage().contains("超过"));}
    }
    @Test public void filteredPartialSalesRoundExactValuesOnlyAfterAggregation() throws Exception {
        JSONArray trades=new JSONArray().put(trade("buy","2026-09-01","buy",3,10,0.01))
            .put(trade("sale1","2026-09-02","sell",1,11,0.01)).put(trade("sale2","2026-09-02","sell",1,11,0.01))
            .put(trade("sale3","2026-09-03","sell",1,11,0.01))
            .put(trade("other-buy","2026-09-02","buy",1,5,0).put("code","000001"))
            .put(trade("other-sell","2026-09-02","sell",1,6,0).put("code","000001"));
        JSONObject a=StandaloneCore.ledger(trades,new JSONObject(),"local").getJSONObject("analytics");
        JSONArray rows=a.getJSONArray("trades");BigDecimal filtered=BigDecimal.ZERO,fees=BigDecimal.ZERO,net=BigDecimal.ZERO,gross=BigDecimal.ZERO;
        assertTrue(rows.getJSONObject(0).isNull("realizedPnlExact"));
        for(int i=0;i<rows.length();i++) {
            JSONObject row=rows.getJSONObject(i);
            if(!"2026-09-02".equals(row.getString("date")) || !"600000".equals(row.getString("code")))continue;
            filtered=filtered.add(new BigDecimal(row.getString("realizedPnlExact")));
            fees=fees.add(new BigDecimal(row.getString("feeExact")));net=net.add(new BigDecimal(row.getString("netAmountExact")));
            gross=gross.add(new BigDecimal(row.getString("grossAmountExact")));
        }
        assertEquals("1.97",filtered.setScale(2,RoundingMode.HALF_UP).toPlainString());
        assertEquals(0,new BigDecimal("0.02").compareTo(fees));assertEquals(0,new BigDecimal("21.98").compareTo(net));
        assertEquals(0,new BigDecimal("22").compareTo(gross));
        assertEquals(2.97,a.getJSONArray("realizedSeries").getJSONObject(1).getDouble("realizedPnl"),0);
    }
}
