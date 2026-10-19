package org.marketreview.nativeapp;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.util.*;

final class LocalCandidateHostChecks {
  static void realCache(FlowInstrumentation f) throws Exception {
    f.activity=(MainActivity)f.startActivitySync(new android.content.Intent(f.getTargetContext(),MainActivity.class)
        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
    MainActivity owner=f.activity;
    f.check(!owner.testing&&owner.feed!=null,"real market cache loaded, not review-data fixtures");
    java.io.File isolated=owner.getDatabasePath("candidate-tests.sqlite");
    for(String suffix:new String[]{"","-wal","-shm","-journal"}) {
      java.io.File previous=new java.io.File(isolated.getPath()+suffix);
      if(previous.exists())java.nio.file.Files.move(previous.toPath(),new java.io.File(previous.getPath()+".saved-"+UUID.randomUUID()).toPath());
    }
    f.ui(()->{
      // Only the candidate store is isolated. The actual MainActivity Host still
      // reads its existing, independently loaded real-market roster and cache.
      owner.testing=true;
      try{owner.localCandidates();}finally{owner.testing=false;}
      f.check(owner.candidateScreen.store.file.equals(isolated),"candidate QA never writes the normal user's candidate history");
      f.check(owner.candidateScreen.current==null,"real-cache page does not auto-compute");
    });
    final String[] id={""};
    f.ui(()->{
      try {
        JSONArray actual=owner.candidateScreen.host.existingData();
        for(int i=0;i<actual.length();i++) {
          String selected=actual.getJSONObject(i).optString("id");
          if(!selected.matches("(SH|SZ|BJ):stock:[0-9]{6}"))continue;
          JSONObject frozen=owner.candidateScreen.host.snapshot(Collections.singleton(selected)).getJSONObject(0);
          JSONObject evaluated=LocalCandidateModel.evaluate(LocalCandidateModel.snapshot(new JSONArray().put(frozen),"stable",java.time.Instant.now()));
          JSONObject row=evaluated.getJSONArray("rows").getJSONObject(0);
          if(!row.isNull("score")){id[0]=selected;break;}
        }
      }catch(Exception e){throw new RuntimeException(e);}
      f.check(!id[0].isEmpty(),"actual cache has at least one provenance-valid stock with enough closed daily bars");
      owner.candidateScreen.chosen.add(id[0]);
      owner.candidateScreen.findViewWithTag("candidateCalculate").performClick();
    });
    SourceChecks.waitFor(f,()->owner.candidateScreen.current!=null&&!owner.candidateScreen.busy,12000,"actual cached stock computes through native MainActivity candidate entry");
    final JSONObject[] result={null};
    f.ui(()->{
      try {
        result[0]=new JSONObject(owner.candidateScreen.current.toString());
        JSONObject row=result[0].getJSONArray("rows").getJSONObject(0);
        f.check(result[0].getJSONArray("rows").length()==1&&row.getString("id").equals(id[0]),"actual result is exactly the explicitly chosen real stock");
        f.check(!row.isNull("score")&&row.getInt("barCount")>=20,"real cached daily data produces a score without invented bars");
        owner.candidateScreen.list.performItemClick(owner.candidateScreen.list.getChildAt(0),0,0);
        f.check(owner.candidateScreen.detail.getText().toString().contains("来源"),"real source and score explanation visible in native page");
        f.check(owner.candidateScreen.detail.getText().toString().contains("北京时间")&&owner.candidateScreen.detail.getText().toString().contains("20根均价 MA20"),"native explanation uses Chinese factors and explicit local receive time");
        f.check(owner.candidateScreen.count.getText().toString().contains("保存时模板：稳健观察"),"results label the frozen strategy, independently of current controls");
      }catch(Exception e){throw new RuntimeException(e);}
    });
    f.shot("android-candidate-real-cache-detail");
    JSONObject stored=owner.candidateScreen.store.readDraft(owner.candidateScreen.anchor.substring(6));
    f.check(LocalCandidateModel.digest(stored).equals(LocalCandidateModel.digest(result[0])),"real input/result saved and read back from isolated SQLite");
    java.io.File directory=new java.io.File(owner.getExternalFilesDir(null),f.shotFolder);directory.mkdirs();
    JSONObject receipt=new JSONObject().put("fixture",false).put("source","actual Android local market cache")
        .put("realtimeVerified",false).put("capturedAt",result[0].getJSONObject("input").getString("capturedAt"))
        .put("model",LocalCandidateModel.VERSION).put("rows",result[0].getJSONArray("rows"))
        .put("digest",LocalCandidateModel.digest(result[0]));
    try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(directory,"candidate-real-cache.json"))){out.write(receipt.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
    f.ui(()->owner.candidateScreen.findViewWithTag("candidateOpen").performClick());
    f.ui(()->f.check(owner.chart.getVisibility()==View.VISIBLE,"candidate opens the actual native chart instead of a browser"));
    f.shot("android-candidate-real-cache-chart");
  }
  static void run(FlowInstrumentation f) throws Exception {
    f.check(f.activity.testing,"candidate host checks use isolated application data");
    f.ui(()->f.activity.openBusiness("research"));
    f.ui(()->{
      View entry=f.activity.findViewById(R.id.businessHost).findViewWithTag("openLocalCandidates");
      f.check(entry!=null&&entry.isShown(),"research has an actual visible candidate entry");
      entry.performClick();
      f.check(f.activity.candidateScreen.isShown(),"entry mounts the Java candidate internal page");
      f.check(f.activity.candidateScreen.getParent()==f.activity.findViewById(R.id.businessHost),"candidate page uses existing internal host");
      f.check(f.activity.candidateScreen.current==null,"opening candidate page never auto-computes");
    });
    final JSONArray[] copy={null};
    f.ui(()->{
      try {
        f.activity.observeRecent(new JSONObject().put("id","SH:stock:600000").put("name","临时观察样本"));
        JSONArray identities=f.activity.candidateScreen.host.existingData();
        boolean observed=false;
        for(int i=0;i<identities.length();i++)observed|=identities.getJSONObject(i).optString("id").equals("SH:stock:600000");
        f.check(!observed,"recent transient observations are excluded from candidate watchlist range");
        f.check(identities.length()==8,"actual fixture watchlist remains eight members");
        copy[0]=f.activity.candidateScreen.host.snapshot(Collections.singleton("SZ:stock:000001"));
        f.check(copy[0].length()==1,"host freezes only explicitly selected identity");
        f.check(copy[0].getJSONObject(0).getJSONArray("day").length()<=81,"host snapshot keeps bounded daily history");
        f.check(!copy[0].getJSONObject(0).has("minute")&&!copy[0].getJSONObject(0).has("week"),"candidate daily snapshot excludes other chart periods");
        f.activity.candidateScreen.chosen.add("SZ:stock:000001");
        f.activity.candidateScreen.search.setText("银行");
        f.activity.candidateScreen.strategies.setSelection(1);
      }catch(Exception e){throw new RuntimeException(e);}
    });
    SourceHistoryChecks.recreateActivity(f);
    SourceChecks.waitFor(f,()->f.activity.candidateScreen!=null&&f.activity.candidateScreen.isShown(),5000,"actual candidate page restores after Activity recreation");
    f.ui(()->{
      f.check(f.activity.candidateScreen.chosen.contains("SZ:stock:000001"),"chosen range survives actual recreation");
      f.check(f.activity.candidateScreen.search.getText().toString().equals("银行"),"candidate query survives actual recreation");
      f.check(f.activity.candidateScreen.strategies.getSelectedItemPosition()==1,"candidate template survives actual recreation");
      f.check(f.activity.candidateScreen.current==null,"restoration never invents or recalculates results");
      f.activity.onActivityResult(432,android.app.Activity.RESULT_CANCELED,null);
      f.check(f.activity.candidateScreen.state.getText().toString().contains("取消"),"system file cancellation returns to candidate page with explicit status");
    });
    f.shot("android-candidate-host");
    f.ui(()->{
      LocalCandidateScreen page=f.activity.candidateScreen;
      f.activity.goHome();
      f.check(!page.isShown()&&f.activity.findViewById(R.id.home).isShown(),"candidate back returns directly to watchlist home");
      f.activity.localCandidates();
      f.check(f.activity.candidateScreen==page,"reopening retains existing internal candidate page");
    });
  }
}
