package org.marketreview.nativeapp;
import android.os.Bundle;
import android.content.pm.ActivityInfo;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
final class MigrationV40HostChecks {
 static JSONObject fixture(FlowInstrumentation f)throws Exception{
  try(InputStream in=f.getContext().getAssets().open("dark-stock-rank-fixture.json")){return new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));}
 }
 static void run(FlowInstrumentation f)throws Exception{
  JSONObject guards=CollectionPublicationChecks.run(f.getTargetContext(),new File(f.getTargetContext().getCacheDir(),"publication-v43-"+UUID.randomUUID()));
  f.check(guards.getInt("checks")==15,"actual SQLite publication preservation checks");
  final JSONObject[] doc={null};final JSONObject[] source={null};
  f.ui(()->{try{
   MainActivity a=f.activity;f.check(a.testing&&a.feed==null,"isolated host, no provider feed");
   source[0]=a.businessStore.save("collections",new JSONObject().put("id","publication-ui-v40").put("title","原生入研究验证").put("text","人工校对正文\n完整保留").put("originalText","来源初版\n不得改写").put("status","completed").put("executionRevision","v1").put("unknownMetadata","keep"));
   a.openBusiness("collection");BusinessScreen p=(BusinessScreen)((Map<?,?>)EtfMonitorHostChecks.field(a,"businessPages")).get("business:collection");p.extension.loadCollection(source[0]);f.check(p.inputs.get("collectionText").getText().toString().equals(source[0].getString("text")),"collection internal editor full text");
   Button publish=f.find(p,"入研究资料");f.check(publish!=null,"actual publication control");publish.performClick();
   JSONArray docs=a.businessStore.read("docs");f.check(docs.length()==1,"actual button creates one research document");doc[0]=docs.getJSONObject(0);
   f.check(doc[0].getString("text").equals(source[0].getString("text"))&&doc[0].getString("originalText").equals(source[0].getString("originalText")),"text and original exact");
   JSONObject retained=CollectionPublicationChecks.find(a.businessStore,"collections","publication-ui-v40");f.check(retained.getString("originalText").equals(source[0].getString("originalText"))&&retained.getString("unknownMetadata").equals("keep"),"source original and metadata preserved");
   a.openResearchDocument(doc[0]);BusinessScreen research=(BusinessScreen)((Map<?,?>)EtfMonitorHostChecks.field(a,"businessPages")).get("business:research");f.check(research.isShown()&&research.inputs.get("evidenceText").getText().toString().equals(doc[0].getString("text")),"exact research reader");
   JSONObject human=a.businessStore.save("docs",new JSONObject(doc[0].toString()).put("text","并行人工后续研究"));a.openBusiness("collection");publish.performClick();
   f.check(CollectionPublicationChecks.equal(human,CollectionPublicationChecks.find(a.businessStore,"docs",human.getString("id"))),"repeat button never overwrites manual research");
   f.check(p.state.getText().toString().contains("人工修改"),"repeat reason visible in internal page");
  }catch(Exception e){throw new RuntimeException(e);}});
  f.shot("android-v40-publication");
  File dir=new File(f.getTargetContext().getFilesDir(),"dark-stocks-tests");new DarkStock.Store(dir).save(fixture(f),()->false);File cache=new File(dir,"2026-10-09.json");byte[] original=Files.readAllBytes(cache.toPath());
  f.ui(()->{f.activity.darkStocks();DarkStockScreen s=f.activity.darkStockScreen;s.own.setChecked(false);s.date.setText("2026-10-09");s.load();});
  SourceChecks.waitFor(f,()->f.activity.darkStockScreen.rows.size()==100,7000,"full actual cached rank page");
  DarkStockScreen s=f.activity.darkStockScreen;
  f.ui(()->{f.check(!s.networkEnabled&&s.scan==null,"ranking does not start provider");s.rankDirection.setSelection(1);});
  SourceChecks.waitFor(f,()->s.rows.get(0).optString("key").equals("sz000208"),3000,"complete universe ranked before page");
  f.ui(()->{f.check(!s.rows.get(0).optBoolean("reconciled"),"unreconciled numeric ranking keeps flag");s.next.performClick();s.next.performClick();f.check(s.rows.size()==7&&!s.next.isEnabled(),"rank across all pages");s.rankMetric.setSelection(1);});
  SourceChecks.waitFor(f,()->s.page==0&&s.rows.get(0).optString("key").equals("sz000000"),3000,"new metric resets page");
  f.ui(()->s.rankDirection.setSelection(2));SourceChecks.waitFor(f,()->s.rows.size()==1&&s.rows.get(0).optString("key").equals("sz000205"),3000,"negative list order");
  f.ui(()->s.rankMetric.setSelection(2));SourceChecks.waitFor(f,()->s.loadedRankMetric==2,3000,"combined field");
  final Bundle[] saved={null};f.ui(()->{saved[0]=s.save();f.check(saved[0].getInt("rankMetric")==2&&saved[0].getInt("rankDirection")==2,"two enum states persisted");s.rankMetric.setSelection(0);s.rankDirection.setSelection(0);});
  f.ui(()->s.restore(saved[0]));SourceChecks.waitFor(f,()->s.rankMetric.getSelectedItemPosition()==2&&s.rankDirection.getSelectedItemPosition()==2&&s.rows.size()==1,7000,"restore rank after asynchronous cache");
  f.ui(()->{s.rankMetric.setSelection(0);s.rankDirection.setSelection(1);});SourceChecks.waitFor(f,()->s.rows.size()==100,3000,"return to positive");
  f.ui(()->{f.check(s.state.getText().toString().contains("缺失2项")&&s.state.getText().toString().contains("多页非同步快照"),"missing amounts and snapshot boundary visible");s.search.setText("sz000204");f.check(s.rows.size()==1,"search before rank");s.search.setText("");s.setSymbols(Arrays.asList("sz000001","sz000204","sz000999"));f.check(s.rows.size()==2&&s.rows.get(0).optString("key").equals("sz000204"),"watchlist subset before rank");s.own.setChecked(false);});
  f.shot("android-v40-rank");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
  SourceChecks.waitFor(f,()->s.getOrientation()==LinearLayout.HORIZONTAL&&s.list.getHeight()>=f.activity.dp(100),7000,"landscape list");
  f.ui(()->f.check(s.rows.size()==100&&s.rankDirection.getSelectedItemPosition()==1,"rotation preserves ranking"));f.shot("android-v40-rank-landscape");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));SourceChecks.waitFor(f,()->s.getOrientation()==LinearLayout.VERTICAL,7000,"portrait return");
  f.ui(()->{s.date.setText("2026-10-08");s.load();});SourceChecks.waitFor(f,()->s.rows.isEmpty()&&!s.cacheReadPending,7000,"missing date no substitution");
  f.ui(()->{f.check(s.snapshot.length()==0&&!s.refresh.isEnabled(),"no borrowed current snapshot");f.activity.goHome();});
  f.check(Arrays.equals(original,Files.readAllBytes(cache.toPath())),"ranking and readback leave cache bytes unchanged");
  File out=new File(f.getTargetContext().getExternalFilesDir(null),f.shotFolder+"/publication-sqlite.json");Files.write(out.toPath(),guards.toString(2).getBytes(StandardCharsets.UTF_8));
 }
}
