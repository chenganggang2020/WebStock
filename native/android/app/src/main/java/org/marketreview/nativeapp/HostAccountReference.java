package org.marketreview.nativeapp;
import android.widget.*;import org.json.*;import java.time.*;
/** Root adapter: local input only, never invent ledger completion or historical quotes. */
final class HostAccountReference {
 static JSONObject output(MainActivity owner,String id)throws Exception{
  JSONObject selected=null;JSONArray accounts=owner.businessStore.read("accounts");
  for(int i=0;i<accounts.length();i++)if(accounts.getJSONObject(i).getString("id").equals(id))selected=accounts.getJSONObject(i);
  BusinessStore.require(selected!=null,"当前账户不存在；未保留旧结果");
  JSONArray trades=owner.businessStore.read("trades");JSONObject quotes=new JSONObject();
  for(JSONObject row:owner.rosterForPanels()){String full=row.getString("id");BusinessStore.require(!quotes.has(full),"行情包含重复证券身份");if(row.opt("quote") instanceof JSONObject)quotes.put(full,new JSONObject(row.getJSONObject("quote").toString()));}
  Instant cut=Instant.now();JSONObject context=new JSONObject().put("schema","native-account-reference-context/v1").put("date",cut.atOffset(ZoneOffset.ofHours(8)).toLocalDate().toString()).put("asOf",cut.toString()).put("nativeTradeContract",true).put("nativeSinaPreviousCloseContract",true);
  return AccountReferenceModel.evaluate(selected,trades,quotes,context);
 }
}

