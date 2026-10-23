package org.marketreview.nativeapp;
import android.content.Context;import android.widget.EditText;import org.json.*;
/** Root-only optional UI acceptance helper; compiled, not run on a device by this lease. */
public final class AccountEditDeviceChecks{
 public static void run(Context context)throws Exception{
  final JSONObject[] row={new JSONObject().put("id","legacy-account-7").put("type","ledger").put("name","old").put("history",new JSONArray().put("kept"))};
  final int[] writes={0};AccountEditScreen screen=new AccountEditScreen(context,new AccountEditScreen.Host(){
   public JSONArray loadAccounts()throws Exception{return new JSONArray().put(new JSONObject(row[0].toString()));}
   public boolean supportsAtomicCas(){return true;}
   public JSONObject compareAndSave(JSONObject expected,JSONObject candidate)throws Exception{AccountEditModel.check(expected,row[0]);row[0]=new JSONObject(candidate.toString());writes[0]++;return new JSONObject(row[0].toString());}
  });
  ((EditText)screen.findViewWithTag("accountEditName")).setText("cancel");screen.cancel();screen.commit();if(writes[0]!=0)throw new AssertionError("cancel wrote");
  ((EditText)screen.findViewWithTag("accountEditName")).setText("change");screen.preview();row[0].put("external","concurrent");screen.commit();if(writes[0]!=0||!row[0].getString("name").equals("old"))throw new AssertionError("CAS overwrote");
  screen.reload();((EditText)screen.findViewWithTag("accountEditName")).setText("saved");screen.preview();screen.commit();if(writes[0]!=1||!row[0].getString("id").equals("legacy-account-7")||!row[0].getJSONArray("history").getString(0).equals("kept"))throw new AssertionError("ID/history changed");
  screen.setActive(false);screen.commit();if(writes[0]!=1)throw new AssertionError("inactive wrote");
 }
}
