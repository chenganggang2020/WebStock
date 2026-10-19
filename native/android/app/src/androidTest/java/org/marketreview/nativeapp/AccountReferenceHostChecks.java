package org.marketreview.nativeapp;
import android.widget.*;import android.view.*;import java.time.*;import java.io.*;import org.json.*;
final class AccountReferenceHostChecks{
 static void run(FlowInstrumentation f)throws Exception{
  final String[] saved={""},accounts={""};
  f.ui(()->{try{
   MainActivity a=f.activity;OffsetDateTime now=Instant.now().minusSeconds(60).atOffset(ZoneOffset.ofHours(8));
   accounts[0]=a.businessStore.read("accounts").toString();
   a.businessStore.save("trades",new JSONObject().put("id","reference-prior").put("accountId","local").put("instrumentId","SH:stock:600000").put("name","原生参考样本").put("date",now.toLocalDate().minusDays(1).toString()).put("side","buy").put("quantity",100).put("price",10).put("amount",1000).put("fee",0).put("tax",0).put("sourceType","manual"));
   WatchlistHostChecks.roster(a).clear();WatchlistHostChecks.roster(a).add(new JSONObject().put("id","SH:stock:600000").put("name","原生参考样本").put("quote",new JSONObject().put("price",14).put("previousClose",11).put("source","新浪公开报价").put("tradeDate",now.toLocalDate().toString()).put("tradeTime",now.toLocalTime().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"))).put("checkedAt",now.toInstant().toString()).put("cached",false)));
   saved[0]=a.businessStore.read("trades").toString();a.openBusiness("accounts");BusinessScreen ledger=(BusinessScreen)((java.util.Map<?,?>)EtfMonitorHostChecks.field(a,"businessPages")).get("business:accounts");ledger.accounts.setSelection(ledger.accountIds.indexOf("local"));
   Button entry=a.getWindow().getDecorView().findViewWithTag("accountOpenReference");f.check(entry!=null,"account reference native entry");entry.performClick();
   f.check(a.accountReferenceScreen!=null&&a.accountReferenceScreen.isShown(),"reference actual internal page");JSONObject out=a.accountReferenceScreen.frozenOutput();f.check(out.getDouble("todayReferencePnl")==300,"prior holdings current quote daily");f.check(out.getDouble("totalPnlRate")==40&&!out.getBoolean("isTwr")&&!out.getBoolean("isIrr"),"simple cost rate accurately labeled");
   ((TextView)a.accountReferenceScreen.findViewWithTag("accountReferenceRow_0")).performClick();f.check(a.accountReferenceScreen.findViewWithTag("accountReferenceDetail_0").getVisibility()==View.VISIBLE,"basis readable");
   f.check(saved[0].equals(a.businessStore.read("trades").toString())&&accounts[0].equals(a.businessStore.read("accounts").toString()),"reading never edits ledger");
   String fixture;try(InputStream in=f.getContext().getAssets().open("account-reference-fixture.json")){JSONObject all=new JSONObject(new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));fixture=all.toString();}f.check(AccountReferenceScreenChecks.screen(a,fixture).contains("PASS"),"component stale output clearing");
  }catch(Exception e){throw new RuntimeException(e);}});
  f.shot("android-v37-reference");
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{try{MainActivity a=f.activity;f.check(a.accountReferenceScreen!=null&&a.accountReferenceScreen.isShown(),"reference page restored");f.check(a.accountReferenceId.equals("local"),"selected account restored");f.check(((TextView)a.findViewById(R.id.title)).getText().toString().contains("参考盈亏"),"restored reference title");boolean selected=false;LinearLayout nav=a.findViewById(R.id.navigation);for(int i=0;i<nav.getChildCount();i++){Button b=(Button)nav.getChildAt(i);if(b.getText().toString().equals("账户"))selected=b.isSelected();}f.check(selected,"reference navigation account");
   a.openAccountReference("removed");f.check(a.accountReferenceScreen.frozenOutput().length()==0,"missing account clears previous output");a.onBackPressed();f.check(((String)EtfMonitorHostChecks.field(a,"activePage")).isEmpty(),"reference back goes home");f.check(saved[0].equals(a.businessStore.read("trades").toString())&&accounts[0].equals(a.businessStore.read("accounts").toString()),"recreation no ledger write");
  }catch(Exception e){throw new RuntimeException(e);}});
 }
}

