package org.marketreview.nativeapp;
import android.os.Bundle;
import org.json.*;

/** Recent -> ledger must create only a draft and must preserve a dirty existing form. */
final class RecentLedgerChecks {
  static void prepare(BusinessScreen page, JSONObject item) throws Exception {
    java.lang.reflect.Method method=BusinessScreen.class.getDeclaredMethod("prepareNewTrade",JSONObject.class);
    method.setAccessible(true);
    try { method.invoke(page,item); }
    catch(java.lang.reflect.InvocationTargetException error) {
      if(error.getCause() instanceof Exception)throw (Exception)error.getCause();
      throw error;
    }
  }
  static void run(FlowInstrumentation f) throws Exception {
    final BusinessScreen[] page={null};
    final JSONObject item=new JSONObject().put("id","SZ:stock:000001").put("symbol","sz000001")
        .put("name","平安银行").put("quote",new JSONObject().put("price",12.34));
    f.ui(()->page[0]=new BusinessScreen(f.activity,"accounts",f.activity.businessStore));
    int before=f.activity.businessStore.read("trades").length();
    f.ui(()->{try{
      prepare(page[0],item);
      f.check(page[0].selected.isEmpty()&&page[0].tab==2,"prefill is explicitly a new trade");
      f.check(page[0].instrumentIds.get(page[0].symbols.getSelectedItemPosition()).equals("SZ:stock:000001"),"canonical symbol selected");
      f.check(page[0].value("tradePrice").equals("12.34"),"available positive price prefilled");
      page[0].inputs.get("tradeNote").setText("未保存的原草稿");
      String old=page[0].value("tradeNote");
      boolean rejected=false;
      try{prepare(page[0],new JSONObject(item.toString()).put("id","SH:stock:600519"));}
      catch(Exception expected){rejected=true;}
      f.check(rejected&&page[0].value("tradeNote").equals(old),"dirty draft not overwritten");
      Bundle saved=page[0].saveDraft();
      BusinessScreen rebuilt=new BusinessScreen(f.activity,"accounts",f.activity.businessStore);
      rebuilt.restoreDraft(saved);
      rejected=false;
      try{prepare(rebuilt,item);}catch(Exception expected){rejected=true;}
      f.check(rejected&&rebuilt.value("tradeNote").equals(old),"recreated dirty draft still guarded");
      f.check(rebuilt.instrumentIds.get(rebuilt.symbols.getSelectedItemPosition()).equals("SZ:stock:000001"),"non-watchlist draft identity survives restore");
      BusinessScreen empty=new BusinessScreen(f.activity,"accounts",f.activity.businessStore);
      prepare(empty,new JSONObject(item.toString()).put("quote",new JSONObject()));
      f.check(empty.value("tradePrice").isEmpty(),"missing price is blank not zero");
      rejected=false;
      try{prepare(new BusinessScreen(f.activity,"accounts",f.activity.businessStore),new JSONObject().put("id","SH:index:000001").put("name","上证指数"));}catch(Exception expected){rejected=expected.getMessage().contains("股票/ETF");}
      f.check(rejected,"index cannot enter stock ledger");
    }catch(Exception e){throw new AssertionError(e);}});
    f.check(f.activity.businessStore.read("trades").length()==before,"prefilling/guarding never writes a trade");
  }
}
