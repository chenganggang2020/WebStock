package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;
import java.io.*;
/** Executes the native widget flow on an emulator; this is not physical-device acceptance. */
public class FlowInstrumentation extends Instrumentation {
  MainActivity activity;
  int assertions;
  boolean liveMode;
  boolean skipUnavailableFunds;
  boolean businessOnly;
  String businessScenario = "";
  String shotFolder = "qa";
  String industryResumeNamespace = "";
  String paperResumeNamespace = "";
  String f07ResumeNamespace = "";
  void check(boolean value, String label) {
    assertions++;
    if (!value)
      throw new AssertionError(label);
  }
  void ui(Runnable action) {
    Throwable[] failure = new Throwable[1];
    runOnMainSync(() -> {
      try {
        action.run();
      } catch (Throwable e) {
        failure[0] = e;
      }
    });
    waitForIdleSync();
    if (failure[0] != null)
      throw new AssertionError(failure[0]);
  }
  void awaitCollectionService() throws Exception {
    long end = SystemClock.elapsedRealtime() + 5000;
    boolean[] ready = {false};
    while (SystemClock.elapsedRealtime() < end) {
      ui(() -> ready[0] = activity.collectionService != null);
      if (ready[0]) return;
      Thread.sleep(50);
    }
    throw new AssertionError("local collection service not connected");
  }
  AccessibilityNodeInfo byClass(AccessibilityNodeInfo node, String name) {
    if (node == null)
      return null;
    if (name.contentEquals(node.getClassName()))
      return node;
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo found = byClass(node.getChild(i), name);
      if (found != null)
        return found;
    }
    return null;
  }
  Button find(View v, String text) {
    if (v instanceof Button && v.isShown() && ((Button) v).getText().toString().equals(text))
      return (Button) v;
    if (v instanceof ViewGroup)
      for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) {
        Button b = find(((ViewGroup) v).getChildAt(i), text);
        if (b != null)
          return b;
      }
    return null;
  }
  void click(String text) {
    ui(() -> {
      Button b = find(activity.getWindow().getDecorView(), text);
      check(b != null, "button " + text);
      b.performClick();
    });
  }
  void dialogClick(String text) {
    AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
    for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText(text))
      if (node.getText() != null && node.getText().toString().equals(text)
          && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
        waitForIdleSync();
        return;
      }
    throw new AssertionError("dialog control " + text);
  }
  void dragChart() {
    ui(() -> {
      MarketChart c = activity.chart;
      long now = SystemClock.uptimeMillis();
      float y = c.getHeight() / 2f, x = c.getWidth() * .35f;
      MotionEvent e = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
      c.dispatchTouchEvent(e);
      e.recycle();
      e = MotionEvent.obtain(now, now + 50, MotionEvent.ACTION_MOVE, x + c.getWidth() * .25f, y, 0);
      c.dispatchTouchEvent(e);
      e.recycle();
      e = MotionEvent.obtain(now, now + 100, MotionEvent.ACTION_UP, x + c.getWidth() * .25f, y, 0);
      c.dispatchTouchEvent(e);
      e.recycle();
      check(c.end < c.bars.size(), "native touch pan changes history");
    });
  }
  void shot(String name) throws Exception {
    waitForIdleSync();
    Thread.sleep(600);
    Bitmap bitmap = getUiAutomation().takeScreenshot();
    File dir = new File(activity.getExternalFilesDir(null), shotFolder);
    dir.mkdirs();
    try (FileOutputStream out = new FileOutputStream(new File(dir, name + ".png"))) {
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
    }
    bitmap.recycle();
  }
  @Override
  public void onCreate(Bundle args) {
    super.onCreate(args);
    liveMode = "live".equals(args.getString("mode")) || "live-core".equals(args.getString("mode"));
    skipUnavailableFunds = "live-core".equals(args.getString("mode"));
    businessScenario = args.getString("mode", "");
    businessOnly = businessScenario.startsWith("business");
    shotFolder = args.getString("shots", "qa");
    industryResumeNamespace = args.getString("industryNamespace", "");
    paperResumeNamespace = args.getString("paperNamespace", "");
    f07ResumeNamespace = args.getString("f07Namespace", "");
    start();
  }
  @Override
  public void onStart() {
    Bundle result = new Bundle();
    try {
      if(businessScenario.equals("f07-main-visual")){
        org.json.JSONObject report=ResearchWorkbenchMainChecks.visual(this);
        result.putString("stream","PASS F07 settled reader visual "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f07-main")||businessScenario.equals("f07-main-remaining")){
        org.json.JSONObject report=ResearchWorkbenchMainChecks.run(this);
        result.putString("stream","PASS F07 complete actual Main research batch "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f07-picker-main")){
        org.json.JSONObject report=ResearchWorkbenchPickerMainChecks.run(this);
        result.putString("stream","PASS F07 actual Main dedicated owner/epoch pickers "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f08-industry-files")){
        org.json.JSONObject report=IndustryTopicFileChecks.run(this);result.putString("stream","PASS F08 actual Android atomic file layer "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f08-industry-main")){
        if(android.os.Build.VERSION.SDK_INT<35){result.putString("stream","NOT_RUN F08 current SQLite source protection unavailable on this API\n");finish(0,result);return;}
        org.json.JSONObject report=IndustryTopicMainChecks.run(this);result.putString("stream","PASS F08 focused native persistent execution and actual Main "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f07-lifecycle")){
        org.json.JSONObject report=ResearchWorkbenchLifecycleChecks.run(this);
        result.putString("stream","PASS F07 focused Android page lifecycle "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f06-quant-main")||businessScenario.equals("f06-quant-main-remaining")||businessScenario.equals("f06-quant-main-landscape")){
        org.json.JSONObject report=businessScenario.endsWith("-landscape")?QuantModelMainChecks.runLandscape(this):QuantModelMainChecks.run(this,businessScenario.endsWith("-remaining"));
        result.putString("stream","PASS F06 actual Main offline result import/read/history/export/recreation "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f02-authority-other")){
        org.json.JSONObject report=RequestAuthorizationMainChecks.otherConsumers(this);
        result.putString("stream","PASS F02 actual author/report authorization without send "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f02-authority-main")||businessScenario.equals("f02-authority-remaining")||businessScenario.equals("f02-authority-evidence")){
        org.json.JSONObject report=RequestAuthorizationMainChecks.run(this,!businessScenario.equals("f02-authority-main"));
        result.putString("stream","PASS F02 actual Main authority lifecycle, synthetic input and no send "+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("f05-store-review-delta")){
        org.json.JSONObject report=PaperAutomationStoreBoundaryChecks.run(this);
        result.putString("stream","PASS F05 focused Store API/schema/read-only boundary "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f05-paper-reading")){
        org.json.JSONObject report=PaperAutomationMainChecks.reading(this,paperResumeNamespace);
        result.putString("stream","PASS F05 focused current Main reading only "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("f05-paper-automation")){
        org.json.JSONObject report=PaperAutomationMainChecks.run(this);
        result.putString("stream","PASS F05 isolated actual Main/SQLite local authorized analysis and simulated fill "+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v61-knowledge-index")||businessScenario.equals("v61-knowledge-index-main")){
        org.json.JSONObject report=KnowledgeIndexMainChecks.run(this,businessScenario.equals("v61-knowledge-index"));
        result.putString("stream","PASS C08 actual SQLite and Main focused delta "+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v90-industry-context")){
        org.json.JSONObject report=IndustryArchiveMainChecks.contextOnly(this);
        result.putString("stream","PASS focused original industry context; no SQLite/restore rerun "+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v90-industry-remaining")){
        org.json.JSONObject report=IndustryArchiveMainChecks.remaining(this);
        result.putString("stream","PASS remaining actual industry Main recreation/export; prior SQLite/restore not repeated "+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v90-industry-archive-main")){
        org.json.JSONObject report=IndustryArchiveMainChecks.run(this);
        result.putString("stream",(Build.VERSION.SDK_INT<35?"PASS v90 unsupported pre-file guards only; Main/SQLite NOT RUN ":"PASS v90 industry compatibility actual SQLite/Main focused delta; old suites not repeated ")+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v85-business-seven-main")){
        org.json.JSONObject report=BusinessRestoreMainChecks.run(this);
        result.putString("stream",(Build.VERSION.SDK_INT<35?"PASS v85 B06 unsupported pre-file guards only; actual Main/SQLite NOT RUN ":"PASS v85 B06 actual native seven SQLite/Main/full original reading; old suites not repeated ")+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("candidate-business-v66")||businessScenario.equals("candidate-business-v79-resume")){
        boolean remainingOnly=businessScenario.equals("candidate-business-v79-resume");
        org.json.JSONObject report=remainingOnly?BusinessHostChecks.resume(this):BusinessHostChecks.run(this);
        result.putString("stream",(Build.VERSION.SDK_INT<35?"PASS v79 business unsupported-API guards only; Main/SQLite/visual NOT RUN ":remainingOnly?"PASS v79 remaining actualMain visual/recreation checks; prior SQLite/Main not repeated ":"PASS v79 v66 business actual Main/SQLite/final visual focused checks ")+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v86-company-profile-main")){
        org.json.JSONObject report=CompanyProfileMainChecks.run(this);result.putString("stream","PASS B07 focused actual Main/profile consumer; "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("v72-knowledge-retrieval-main")){
        KnowledgeRetrievalActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();KnowledgeRetrievalActualMainChecks.run(this);
        result.putString("stream","PASS v72 actual Main knowledge retrieval: portrait/landscape readers, back/recreation/private marker/source revocation/stale callbacks; "+assertions+" focused checks; no Grant/credential/send or earlier suites\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v73-sector-readers")||businessScenario.equals("v54-graph-layout")){
        if(android.os.Build.VERSION.SDK_INT<35){
          result.putString("stream","SKIP v73 readers: API35+ readonly supplier required; no fixture database opened\n");
          finish(0,result);return;
        }
        SectorAiActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();SectorReaderVisualChecks.run(this);
        result.putString("stream","PASS "+(businessScenario.equals("v54-graph-layout")?"focused graph layout only; 2 screenshots; ":"v73 actual I02 readers only; 6 screenshots; ")+assertions+" focused assertions; no prior Main/SQLite suite rerun\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v69-sector-relations")||businessScenario.equals("v54-i02-ui-diagnostic")){
        SectorAiActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();SectorRelationActualMainChecks.run(this);
        result.putString("stream","PASS v69 actual Main relation host and unique SQLite checks; "+assertions+" focused checks; no old suites/network\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v62-creator-internal-main")){
        CreatorInternalMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();CreatorInternalMainChecks.run(this);
        result.putString("stream","PASS v62 creator internal navigation "+assertions+" checks; synthetic archive; no old suites\n");
        finish(0,result);return;
      }
      if(businessScenario.startsWith("v59-observation-tail:")){
        org.json.JSONObject report=ObservationRestoreMainChecks.tail(this,businessScenario.substring("v59-observation-tail:".length()));
        result.putString("stream","PASS B05 remaining actual Main/durable receipt/short Bundle; prior Main/SQLite not repeated "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("v83-observation-restore-main")||businessScenario.equals("v59-observation-resume")){
        org.json.JSONObject report=businessScenario.equals("v59-observation-resume")?ObservationRestoreMainChecks.resume(this):ObservationRestoreMainChecks.run(this);
        result.putString("stream","PASS B05 focused actual Main/original observation restore; old suites not rerun "+report.toString()+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("candidate-backup-v81-sqlite")){
        org.json.JSONObject report=CandidateRestoreSqliteChecks.run(getTargetContext().getCacheDir(),CandidateBackupMainChecks.fixture(this));
        File output=new File(getTargetContext().getExternalFilesDir(null),"candidate-backup-v81-sqlite-report.json");
        try(FileOutputStream stream=new FileOutputStream(output)){stream.write(report.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        result.putString("stream","PASS v81 isolated real candidate SQLite checks; no Main or prior suites "+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("candidate-backup-v81-main")){
        org.json.JSONObject report=CandidateBackupMainChecks.run(this);
        result.putString("stream","PASS v81 focused actual Main/candidate SQLite/complete reading, controlled picker returns and recreation; older suites not rerun "+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v68-recent-restore")||businessScenario.equals("v82-recent-restore-main")||businessScenario.equals("v84-recent-main-resume")) {
        boolean mainOnly=businessScenario.equals("v84-recent-main-resume");
        org.json.JSONObject report=mainOnly?RecentRestoreMainChecks.resumeMain(this):RecentRestoreMainChecks.run(this);
        result.putString("stream",(Build.VERSION.SDK_INT<35?"PASS v84 unsupported-API pre-file guards only; actual Main/SQLite restore NOT RUN ":mainOnly?"PASS v84 B02 remaining actual Main/full original reading; prior native SQLite not repeated; prior count unavailable ":"PASS v82 B02 actual Main/native SQLite/full original reading focused checks; frozen pure/Qt suites not repeated ")+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v52-theme-ui")) {
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();ThemeUiChecks.run(this);
        result.putString("stream","PASS v52 theme reading UI "+assertions+" checks; prior model and SQLite suites not repeated\n");finish(0,result);return;
      }
      if(businessScenario.equals("v61-candidate-theme-host")) {
        org.json.JSONObject report=ThemeHostChecks.run(this);
        result.putString("stream",(Build.VERSION.SDK_INT<35?"PASS v61 unsupported-API pre-open guards only; full workflow NOT RUN ":"PASS v61 candidate theme actual Main/SQLite focused checks ")+report.toString()+"\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v64-chart-annotations")){
        AnnotationHostFlowChecks.requireFixtureTarget(this);
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();AnnotationHostFlowChecks.run(this);
        result.putString("stream","PASS v64 actual Main chart annotations "+assertions+" focused checks; offline fixture; direction-aware screenshots\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v60-sector-ai-reading")){
        SectorAiActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();SectorAiReadingMainChecks.run(this);
        result.putString("stream","PASS v60 sector compact reading UI "+assertions+" focused checks; local fixtures; no old Main/SQLite suite\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v56-sector-ai-main")){
        SectorAiActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();SectorAiActualMainChecks.run(this);
        result.putString("stream","PASS v56 actual Main sector report + isolated Android SQLite "+assertions+" UI checks; local callback fixtures; no Grant/credentials/network or old suite\n");
        finish(0,result);return;
      }

      if(businessScenario.equals("v57-creator-execution-main")){
        CreatorAiExecutionMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();CreatorAiExecutionMainChecks.run(this);
        result.putString("stream","PASS v57 creator execution actual Main/SQLite "+assertions+" focused checks; local fixtures only; no old suite\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v55-chart-fullscreen")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();ChartFullscreenActualMainChecks.run(this);
        result.putString("stream","PASS A22 native fullscreen "+assertions+" focused checks; same chart; offline test fixtures; no old suite\n");
        finish(0,result);return;
      }      if(businessScenario.equals("v54-creator-ai-ui")){
        CreatorAiActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();CreatorAiCompactUiChecks.run(this);
        result.putString("stream","PASS v54 actual Main creator compact visual UI "+assertions+" checks; source head/tail, candidate, landscape return, saved graph; no prior logic suite\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v54-creator-ai-store")){
        org.json.JSONObject report=CreatorAiStoreChecks.run(getTargetContext());
        check(report.getJSONArray("failures").length()==0,report.toString());
        result.putString("stream","PASS actual SQLite creator fulltext CAS "+report+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("v54-creator-ai-main")){
        CreatorAiActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();CreatorAiActualMainChecks.run(this);
        result.putString("stream","PASS actual Main author full-chunk UI "+assertions+" checks; controlled file returns; no Grant/credentials/online or prior suite\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v53-knowledge-ui")){
        KnowledgeAiActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();KnowledgeAiCompactUiChecks.run(this);
        result.putString("stream","PASS actual Main compact knowledge UI "+assertions+" checks; screenshots in "+shotFolder+"; no prior86/online execution\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v52-knowledge-ai-storage")){
        org.json.JSONObject report=KnowledgeAiStorageChecks.run(getTargetContext().getCacheDir());
        check(report.getJSONArray("failures").length()==0,report.toString());
        result.putString("stream","PASS actual Android knowledge storage "+report+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("v52-knowledge-ai-main")){
        KnowledgeAiActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();KnowledgeAiActualMainChecks.run(this);
        result.putString("stream","PASS v52 actual Main knowledge host "+assertions+" checks; full private draft/short marker; no Grant, credential or online request\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v50-observation-memory")){
        String report=FocusedStoreProbe.run(getTargetContext().getCacheDir(),DarkObservationActualMainChecks.fixture(211,0));
        result.putString("stream","PASS actual Android observation 16MiB capacity "+report+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("v51-observation-ui")){
        DarkObservationActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();
        DarkObservationActualMainChecks.compact(this);
        result.putString("stream","PASS v51 compact observation actual Main "+assertions+" checks; layout/reader/recreation only, no HTTP or full regression\n");finish(0,result);return;
      }
      if(businessScenario.equals("v50-observation-main")||businessScenario.equals("v50-observation-large")){
        boolean large=businessScenario.equals("v50-observation-large");
        DarkObservationActualMainChecks.isolate(getTargetContext(),large?6000:211);
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();
        if(large)DarkObservationActualMainChecks.large(this);else DarkObservationActualMainChecks.run(this);
        result.putString("stream","PASS v50 observation actual Main "+assertions+" checks; isolated file repository, no HTTP or full regression\n");finish(0,result);return;
      }
      if(businessScenario.equals("v49-rotation-boundary")){
        String report=RotationCancelCommitBoundaryChecks.run(getTargetContext(),RotationSamplingSession.install(getTargetContext()));
        result.putString("stream","PASS actual SQLite rotation boundary "+report+"\n");finish(0,result);return;
      }
      if(businessScenario.equals("v49-rotation-main")){
        RotationSamplingActualMainChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();
        RotationSamplingActualMainChecks.run(this);RotationDocumentOwnershipChecks.run(this);
        result.putString("stream","PASS v49 actual Main rotation "+assertions+" assertions; injected source/clock, real SQLite; no HTTP or full regression\n");finish(0,result);return;
      }
      if(businessScenario.equals("v49-rotation-ownership")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();awaitCollectionService();RotationDocumentOwnershipChecks.run(this);
        result.putString("stream","PASS v49 document ownership "+assertions+" actual Main/Downloads/SQLite checks; existing isolated rotation history, no HTTP\n");finish(0,result);return;
      }
      if(businessScenario.equals("v48-paper-main")){
        PaperMonitorActualMainChecks.isolate(getTargetContext());
        Intent intent=new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("testFixtures",true).putExtra("paperMonitorFixtureCut","2026-10-13T02:00:00Z");
        activity=(MainActivity)startActivitySync(intent);waitForIdleSync();
        PaperMonitorActualMainChecks.run(this);result.putString("stream","PASS actual paper Main "+assertions+" checks; isolated inputs, not live/AI/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v48-paper-recovery")){
        String report=PaperMonitorRecoveryQuoteDeviceChecks.run(getTargetContext());
        result.putString("stream","PASS actual Android recovery and quote checks "+report+"\n");finish(0,result);return;
      }
      if (businessScenario.equals("source-readiness")) {
        SourceReadinessChecks.run(this);
        result.putString("stream", "PASS source readiness and exact research identity; model checks on Android, not platform collection\n");
        finish(0, result); return;
      }
      if (businessScenario.equals("v42-backup-components")||businessScenario.equals("v42-backup-capacity")) {
        final boolean capacity=businessScenario.equals("v42-backup-capacity");
        final String[] host={""}; if(!capacity)ui(()->{try{host[0]=UnifiedBackupNativeHostChecks.run(getTargetContext());}catch(Exception e){throw new RuntimeException(e);}});
        java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);
        final String[] report={null};final Exception[] failure={null};
        ui(()->{try{UnifiedBackupAsyncDeviceChecks.start(getTargetContext(),capacity,(text,error)->{report[0]=text;failure[0]=error;done.countDown();});}catch(Exception e){throw new RuntimeException(e);}});
        if(!done.await(180,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("backup worker timeout");
        if(capacity&&failure[0] instanceof UnifiedBackup.MemoryLimitException){
          if(!report[0].contains("phase=write")||!report[0].contains("originalExists=false")||!report[0].contains("exportExists=false"))throw new AssertionError("capacity rejection did not preserve new targets: "+report[0]);
          result.putString("stream","BLOCKED_MEMORY (not full-capacity PASS): "+report[0]+"\n"+failure[0].getMessage()+"\n");finish(0,result);return;
        }
        if(failure[0]!=null)throw new Exception(report[0],failure[0]);
        result.putString("stream",host[0]+"\nPASS "+report[0]+"\n");finish(0,result);return;
      }
      if (businessScenario.equals("v42-backup-ui")) {
        AccountBackupHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        UnifiedBackupUiHostChecks.run(this);result.putString("stream","PASS v42 unified backup "+assertions+" actual MainActivity/provider/file checks; picker result intercepted, not manual picker/ARM acceptance\n");finish(0,result);return;
      }
      if (businessScenario.equals("v45-collection-retry-host")) {
        org.json.JSONObject report = CollectionRetryHostChecks.run(this);
        result.putString("stream", "PASS v45 collection retry host " + report.toString() + "\n");
        finish(0, result); return;
      }
      if(businessScenario.equals("v40-publication-rank")){
        AccountBackupHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        MigrationV40HostChecks.run(this);result.putString("stream","PASS v40 publication and ranking "+assertions+" host checks plus publication SQLite; isolated data, not live/ASR/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v39-background")||businessScenario.equals("v39-background-ui")){
        CandidateBackgroundHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        CandidateBackgroundHostChecks.run(this);result.putString("stream","PASS v39 candidate background "+assertions+" actual host checks plus components; isolated data not live/AI/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v38-cffex")){
        CffexHostChecks.isolate(getTargetContext());AccountBackupHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        CffexHostChecks.run(this);result.putString("stream","PASS v38 CFFEX "+assertions+" host checks; isolated source, not live provider or ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v37-video")){
        AccountBackupHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        ArchiveVideoHostChecks.run(this);result.putString("stream","PASS v37 archive video "+assertions+" host checks; generated MP4 codec/seek, not platform collection or ASR-media correspondence\n");finish(0,result);return;
      }
      if(businessScenario.equals("v37-reference")){
        AccountBackupHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        AccountReferenceHostChecks.run(this);result.putString("stream","PASS v37 account reference "+assertions+" host checks plus component; isolated ledger, not live brokerage or ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v36-account-backup")||businessScenario.equals("v36-backup-only")){
        AccountBackupHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        AccountBackupHostChecks.run(this);result.putString("stream","PASS "+businessScenario+" native host "+assertions+" checks plus component UI; actual SQLite and intercepted document callback, not real picker/ARM acceptance\\n");finish(0,result);return;
      }
      if(businessScenario.equals("v36-futures")){
        FuturesHostChecks.isolate(getTargetContext());WatchlistHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        FuturesHostChecks.run(this);result.putString("stream","PASS v36 futures native host "+assertions+" checks plus model/storage/reader; isolated HTTP, not live provider/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v35-etf")){
        EtfMonitorHostChecks.isolate(getTargetContext());WatchlistHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        EtfMonitorHostChecks.run(this);result.putString("stream","PASS v35 ETF actual host "+assertions+" checks plus module/storage/layout; isolated network fixtures and real SQLite, not live provider or ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v36-sqlite-guards")){
        result.putString("stream",SqliteGuardDeviceChecks.run(getTargetContext()).toString());finish(0,result);return;
      }
      if(businessScenario.equals("v35-watchlist")){
        WatchlistHostChecks.isolate(getTargetContext());
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        WatchlistHostChecks.run(this);result.putString("stream","PASS v35 watchlist native host "+assertions+" checks; isolated configuration, not source cloud sync or ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v35-auction-history")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        org.json.JSONObject fixture;try(InputStream in=getContext().getAssets().open("auction-history-fixture.json")){fixture=new org.json.JSONObject(new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));}
        AuctionHistorySourceChecks.run(this,fixture);AuctionHostChecks.history(this,fixture);
        result.putString("stream","PASS auction readonly archive/module and background host "+assertions+" assertions; isolated fixtures, not live auction history or ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v35-auction")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        AuctionHostChecks.run(this);result.putString("stream","PASS v35 auction native host "+assertions+" checks; isolated old formula fixtures, not live source or ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v35-vwap")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        VwapHostChecks.run(this);result.putString("stream","PASS v35 VWAP native host "+assertions+" checks; isolated data, no live-source/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v34-modules")||businessScenario.equals("v34-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        if(businessScenario.equals("v34-modules")){MaterialLibraryChecks.run(this);DataSourceStatusChecks.model();DataSourceStatusChecks.ui(activity);DataSourceStatusChecks.geometry(activity);DataSourceSnapshotAdapterChecks.main(new String[0]);MigrationV34Checks.foreign(this);}
        else MigrationV34Checks.host(this);
        result.putString("stream","PASS "+businessScenario+" "+assertions+" host assertions plus module guards; no live source or ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v33-mirror-module")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        String fixture;try(InputStream input=getContext().getAssets().open("portfolio-mirror-fixture.json")){fixture=new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
        String storeResult=PortfolioMirrorChecks.run(activity,fixture);String[] screenResult={""};
        ui(()->{try{screenResult[0]=PortfolioMirrorChecks.runScreen(activity,fixture);}catch(Exception e){throw new RuntimeException(e);}});
        result.putString("stream","PASS v33-mirror-module; "+storeResult+"; "+screenResult[0]+"; isolated native DB and Views, not broker/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v33-mirror-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        MigrationV33MirrorChecks.host(this);result.putString("stream","PASS v33-mirror-host "+assertions+" actual native host checks; no broker/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v33-settings-module")||businessScenario.equals("v33-settings-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        if(businessScenario.equals("v33-settings-module")){MigrationStatusChecks.run(this);AiSettingsChecks.store(activity);AiSettingsChecks.foreignStore(activity);AiSettingsChecks.ui(activity);AiSettingsChecks.geometry(activity);}
        else MigrationV33SettingsChecks.host(this);
        result.putString("stream","PASS "+businessScenario+" "+assertions+" host checks plus dedicated module assertions; no online AI or ARM acceptance\n");finish(0,result);return;
      }
      if (businessScenario.equals("business-evidence-review") || businessScenario.equals("v30-evidence-host")) {
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(), MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();
        if(businessScenario.equals("business-evidence-review")) EvidenceReviewChecks.run(this);
        else MigrationV30EvidenceChecks.run(this);
        result.putString("stream","PASS "+businessScenario+" "+assertions+" host assertions; module has additional non-counted checks; isolated data, not AI/source/ARM acceptance\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("v31-risk-module")||businessScenario.equals("v31-risk-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        if(businessScenario.equals("v31-risk-module"))MigrationV31RiskChecks.module(this);else MigrationV31RiskChecks.host(this);
        result.putString("stream","PASS "+businessScenario+" "+assertions+" checks; isolated native host, no orders/live-source/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v31-safety-module")||businessScenario.equals("v31-safety-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        if(businessScenario.equals("v31-safety-module"))DataSafetyChecks.run(this);else MigrationV31SafetyChecks.host(this);
        result.putString("stream","PASS "+businessScenario+" "+assertions+" host assertions; module additional checks uncounted; isolated databases only\n");finish(0,result);return;
      }
      if(businessScenario.equals("v31-market-module")||businessScenario.equals("v31-market-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        if(businessScenario.equals("v31-market-module"))MigrationV31MarketChecks.module(this);else MigrationV31MarketChecks.host(this);
        result.putString("stream","PASS "+businessScenario+" "+assertions+" checks; isolated host/module, no whole-market/real-source/ARM claim\n");finish(0,result);return;
      }
      if(businessScenario.equals("v32-sector-module")||businessScenario.equals("v32-sector-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        if(businessScenario.equals("v32-sector-module"))SectorResearchChecks.run(this);else MigrationV32SectorChecks.host(this);
        result.putString("stream","PASS "+businessScenario+" "+assertions+" host checks; dedicated module checks separately uncounted; isolated data not AI/source/ARM proof\n");finish(0,result);return;
      }
      if(businessScenario.equals("v32-discovery-module")){
        assertions+=IndustryDiscoveryChecks.store(getTargetContext());
        assertions+=IndustryDiscoveryChecks.ui(getTargetContext());
        assertions+=IndustryDiscoveryChecks.geometry(getTargetContext());
        result.putString("stream","PASS v32-discovery-module "+assertions+" device storage/widget/geometry checks; not live-source/ARM acceptance\n");finish(0,result);return;
      }
      if(businessScenario.equals("v32-quant-module")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        String fixture;try(java.io.InputStream input=getContext().getAssets().open("quant-research-fixture.json")){fixture=new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
        String storeResult=QuantResearchChecks.run(getTargetContext(),fixture);
        ui(()->{try{QuantResearchChecks.runScreen(activity,fixture);QuantResearchChecks.runGeometry(activity,fixture);}catch(Exception e){throw new RuntimeException(e);}});
        result.putString("stream","PASS v32-quant-module; "+storeResult+"; native large-state screen/geometry passed, no live/profit/ARM proof\n");finish(0,result);return;
      }
      if(businessScenario.equals("v32-quant-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        MigrationV32QuantChecks.host(this);
        Bundle r=new Bundle();r.putString("stream","PASS v32-quant-host "+assertions+" checks; isolated synthetic host, not real-feed/AI/profit/ARM acceptance\n");finish(Activity.RESULT_OK,r);return;
      }
      if(businessScenario.equals("v32-discovery-host")){
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
        MigrationV32DiscoveryChecks.host(this);
        result.putString("stream","PASS "+businessScenario+" "+assertions+" checks; isolated host, not live-source/online-AI/ARM acceptance\n");finish(0,result);return;
      }
      if (businessScenario.equals("person-method-module") || businessScenario.equals("v30-methods-host") || businessScenario.equals("v30-methods-visual")) {
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(), MainActivity.class)
            .putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();
        if(businessScenario.equals("person-method-module")) MigrationV30HostChecks.module(this);
        else if(businessScenario.equals("v30-methods-visual")) MigrationV30HostChecks.visual(this);
        else MigrationV30HostChecks.methods(this);
        result.putString("stream","PASS v30 "+businessScenario+" "+assertions+" checks; isolated data, not online source or ARM acceptance\n");
        finish(0,result);return;
      }
      if (businessScenario.equals("sector-watch-module")) {
        SectorWatchChecks.model(); SectorWatchChecks.feed();
        SectorWatchChecks.store(getTargetContext()); SectorWatchChecks.ui(getTargetContext()); SectorWatchChecks.marketFeed(getTargetContext());
        result.putString("stream", "PASS sector model, device SQLite, cancellation and native page; not live-source acceptance\n");
        finish(0, result); return;
      }
      if (businessScenario.equals("research-companies-module")) {
        ui(() -> {
          try { assertions += ResearchCompaniesChecks.run(getTargetContext()); }
          catch (Exception e) { throw new RuntimeException(e); }
        });
        result.putString("stream", "PASS research companies device model/store/widget " + assertions + " checks; host acceptance separate\n");
        finish(0, result); return;
      }
      if (businessScenario.equals("account-analysis-module")) {
        ui(() -> {
          try { assertions += AccountAnalysisChecks.run(getTargetContext()); }
          catch (Exception e) { throw new RuntimeException(e); }
        });
        result.putString("stream", "PASS account analysis device model/store/widget " + assertions + " checks; host acceptance separate\n");
        finish(0, result); return;
      }
      if (businessScenario.equals("sector-watch-live")) {
        result.putString("stream", SectorWatchChecks.realPublic(getTargetContext()).toString(2) + "\n");
        finish(0, result); return;
      }
      if(businessScenario.equals("source-discovery-store")){SourceDiscoveryChecks.run(this);result.putString("stream","PASS isolated Android discovery inventory "+assertions+" assertions; storage only, not source UI or platform collection\n");finish(0,result);return;}
      if(businessScenario.equals("local-candidate-device-golden")){File golden=new File(getTargetContext().getCacheDir(),"candidate-golden-android-v1.json");CandidateGolden.main(new String[]{golden.getAbsolutePath()});result.putString("stream","PASS actual Android candidate golden generated; canonical="+LocalCandidateModel.canonical(new org.json.JSONObject().put("model",LocalCandidateModel.VERSION))+"\n");finish(0,result);return;}
      if(businessScenario.equals("local-candidate-cache-real")){LocalCandidateHostChecks.realCache(this);result.putString("stream","PASS actual Android cached-market candidate flow "+assertions+" assertions; not realtime or ARM acceptance\n");finish(0,result);return;}
      if(businessScenario.equals("local-candidate-model")){LocalCandidateChecks.model((ok,message)->check(ok,message));result.putString("stream","PASS local candidate model "+assertions+" assertions\n");finish(0,result);return;}
      if(businessScenario.equals("legacy-indicator-chart")){LegacyIndicatorChartChecks.run(this);result.putString("stream","PASS legacy indicator chart "+assertions+" assertions\n");finish(0,result);return;}
      if(businessScenario.equals("recent-feed")){RecentFeedChecks.run(this);result.putString("stream","PASS recent feed "+assertions+" assertions\n");finish(0,result);return;}
      if(businessScenario.equals("recent-model")){RecentChecks.model(this);result.putString("stream","PASS recent model "+assertions+" assertions\n");finish(0,result);return;}
      if(businessScenario.equals("etf-schedule-model")){EtfScheduleChecks.model(this);result.putString("stream","PASS ETF schedule model "+assertions+" assertions\n");finish(0,result);return;}
      if(businessScenario.equals("dark-stock-model")){DarkStockChecks.model(this);result.putString("stream","PASS dark stock model "+assertions+" assertions\n");finish(0,result);return;}
      if(businessScenario.equals("etf-model")){EtfDailyChecks.model(this);result.putString("stream","PASS ETF parser/cache "+assertions+" assertions\n");finish(0,result);return;}
      if(businessScenario.equals("etf-live")){result.putString("stream",EtfDailyChecks.live(this).toString()+"\n");finish(0,result);return;}
      if (businessScenario.equals("dark-rotation")) {
        int count=new DarkRotationChecks().run(this);
        result.putString("stream","PASS dark rotation "+count+" assertions\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("dark-rotation-live")){result.putString("stream",DarkRotationChecks.live(this).toString()+"\n");finish(0,result);return;}
      if (businessScenario.equals("setup-asr-model")) {
        CollectionAsrChecks.setupModel(this);
        result.putString("stream", "PASS normal review-device model setup, " + assertions + " checks; no demo business records inserted\n");
        finish(0, result);
        return;
      }
      if (businessScenario.equals("funds-snapshot-live")) {
        new LiveChecks(this).snapshotOnly();
        result.putString("stream", "PASS actual public snapshot only, " + assertions + " checks; not minute realtime\n");
        finish(0,result);return;
      }
      if(businessScenario.equals("funds-minute-live")){new LiveChecks(this).minuteOnly();result.putString("stream","PASS actual current-session minute funds, "+assertions+" assertions; bounded one-instrument check, not SLA\n");finish(0,result);return;}
      if (businessScenario.equals("migration-live")) {
        MigrationChecks.run(this);
        result.putString(
            "stream", "PASS actual legacy migration " + assertions + " native checks\n");
        finish(0, result);
        return;
      }
      if (liveMode) {
        new LiveChecks(this).run();
        result.putString("stream",
            (skipUnavailableFunds
                    ? "PASS live CORE (funding endpoint excluded and separately FAILED), "
                    : "PASS live native flow, ")
                + assertions + " checks; public HTTPS + real cache + no-PC dependence\n");
        finish(0, result);
        return;
      }
      if (businessScenario.equals("migration-v28-host") || businessScenario.equals("source-analysis-handoff") || businessScenario.equals("research-runs-module")
          || businessScenario.equals("sector-leader-module") || businessScenario.equals("v28-business-storage")) {
        activity = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class)
            .putExtra("testFixtures", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();
        if (businessScenario.equals("source-analysis-handoff")) SourceAnalysisHandoffChecks.run(this);
        else if (businessScenario.equals("sector-leader-module")) {
          SectorLeaderChecks.checks = 0;
          SectorLeaderChecks.model(); SectorLeaderChecks.store(getTargetContext());
          SectorLeaderChecks.ui(activity); SectorLeaderChecks.quotes(activity);
          assertions += SectorLeaderChecks.checks;
        }
        else if (businessScenario.equals("v28-business-storage")) {
          BusinessChecks.run(this); BusinessChecks.duplicateBackup(this);
        }
        else if (businessScenario.equals("research-runs-module")) ui(() -> {
          try { assertions += ResearchRunsChecks.run(getTargetContext()); }
          catch (Exception e) { throw new RuntimeException(e); }
        });
        else MigrationV28HostChecks.run(this);
        result.putString("stream", "PASS v28 " + businessScenario + " " + assertions + " checks; no live source claim\n");
        finish(0, result); return;
      }
      if (businessScenario.equals("stock-research-module") || businessScenario.equals("migration-v29-host")
          || businessScenario.equals("comment-workshop-module") || businessScenario.equals("v29-news-host")
          || businessScenario.equals("v29-comments-host") || businessScenario.equals("news-module") || businessScenario.equals("v30-news-delta")) {
        activity = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class)
            .putExtra("testFixtures", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        waitForIdleSync();
        if (businessScenario.equals("stock-research-module")) ui(() -> {
          try { assertions += StockResearchChecks.run(getTargetContext()); MigrationV29HostChecks.context(this); }
          catch (Exception e) { throw new RuntimeException(e); }
        });
        else if (businessScenario.equals("comment-workshop-module")) CommentWorkshopChecks.run(this);
        else if (businessScenario.equals("news-module")) {
          NewsChecks.checks=0;
          NewsChecks.model(); NewsChecks.feed(); NewsChecks.store(getTargetContext()); NewsChecks.ui(activity);
          assertions+=NewsChecks.checks;
        }
        else if (businessScenario.equals("v30-news-delta")) MigrationV30NewsDeltaChecks.run(this);
        else if (businessScenario.equals("v29-news-host")) MigrationV29RemainingChecks.news(this);
        else if (businessScenario.equals("v29-comments-host")) MigrationV29RemainingChecks.comments(this);
        else MigrationV29HostChecks.run(this);
        result.putString("stream", "PASS v29 " + businessScenario + " " + assertions + " checks; isolated fixtures, not live source acceptance\n");
        finish(0,result);return;
      }
      MarketDataTests.run();
      if(businessScenario.startsWith("business-rotation")){
        File rotation=getTargetContext().getDatabasePath("rotation-tests-v21.sqlite");
        for(String suffix:new String[]{"","-wal","-shm","-journal"}){File p=new File(rotation.getPath()+suffix);if(p.exists()&&!p.renameTo(new File(p.getPath()+".saved-"+java.util.UUID.randomUUID())))throw new IOException("cannot preserve previous isolated rotation test DB");}
      }
      FundsV8Checks.run(this);
      FundsHistoryChecks.run(this);
      assertions += FundsV9Checks.run(getTargetContext());
      // This instrumentation is used only on the isolated review emulator.
      getTargetContext()
          .getSharedPreferences("native-review-tests", Context.MODE_PRIVATE)
          .edit()
          .clear()
          .commit();
      // Dedicated fixture DB only; preserve prior runs instead of silently
      // accumulating plans until the production 50-plan safety limit is hit.
      File plans=getTargetContext().getDatabasePath("source-plans-tests.sqlite");
      String saved=".saved-"+java.util.UUID.randomUUID();
      for(String suffix:new String[]{"","-wal","-shm","-journal"}){
        File file=new File(plans.getPath()+suffix);
        if(file.isFile())java.nio.file.Files.move(file.toPath(),new File(plans.getPath()+saved+suffix).toPath());
      }
      activity = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class)
                                                      .putExtra("testFixtures", true)
                                                      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      waitForIdleSync();
      awaitCollectionService();
      if (businessScenario.equals("legacy-ui")) {
        LegacyUiChecks.run(this);
        result.putString("stream", "PASS legacy widget editing, " + assertions + " assertions\n");
        finish(0, result);
        return;
      }
      if (businessOnly) {
        if (businessScenario.equals("business-market-navigation"))
          MarketNavigationChecks.run(this);
        else if (businessScenario.equals("business-research-host"))
          ResearchHostChecks.run(this);
        else if (businessScenario.equals("business-account-host"))
          AccountHostChecks.run(this);
        else if (businessScenario.equals("business-source-research-links"))
          SourceReadinessChecks.ui(this);
        else if (businessScenario.equals("business-local-candidate-host"))
          LocalCandidateHostChecks.run(this);
        else if (businessScenario.equals("business-local-candidates"))
          LocalCandidateChecks.run(this);
        else if (businessScenario.equals("business-legacy-indicator-host"))
          LegacyIndicatorHostChecks.run(this);
        else if (businessScenario.equals("business-recent-ui"))
          RecentChecks.ui(this);
        else if (businessScenario.equals("business-recent-ledger"))
          RecentLedgerChecks.run(this);
        else if (businessScenario.equals("business-recent-integration"))
          RecentIntegrationChecks.run(this);
        else if (businessScenario.equals("business-etf-schedule"))
          EtfScheduleChecks.ui(this);
        else if (businessScenario.equals("business-dark-stock"))
          DarkStockChecks.ui(this);
        else if (businessScenario.equals("business-etf-real"))
          EtfDailyChecks.realUi(this);
        else if (businessScenario.equals("business-etf"))
          EtfDailyChecks.ui(this);
        else if (businessScenario.equals("business-rotation-real"))
          DarkRotationChecks.realUi(this);
        else if (businessScenario.equals("business-rotation"))
          DarkRotationChecks.ui(this);
        else if (businessScenario.equals("business-creator-index-real"))
          CreatorIndexChecks.real(this);
        else if (businessScenario.equals("business-creator-index"))
          CreatorIndexChecks.run(this);
        else if (businessScenario.equals("business-creator"))
          CreatorChecks.run(this);
        else if (businessScenario.equals("business-quality"))
          CollectionQualityChecks.run(this);
        else if(businessScenario.equals("business-quality-real"))
          CollectionQualityChecks.real(this);
        else if (businessScenario.equals("business-schedule-slow-file"))
          SourceScheduleChecks.slowFile(this);
        else if (businessScenario.equals("business-schedule-write"))
          SourceScheduleChecks.writeFailure(this);
        else if (businessScenario.equals("business-schedule-files"))
          SourceScheduleChecks.files(this);
        else if (businessScenario.equals("business-schedule-chain") || businessScenario.equals("business-schedule-failure"))
          SourceScheduleChecks.pipeline(this);
        else if (businessScenario.equals("business-schedule-controls"))
          SourceScheduleChecks.controls(this);
        else if (businessScenario.equals("business-schedule"))
          SourceScheduleChecks.contract(this);
        else if (businessScenario.equals("business-source-discovery"))
          SourceDiscoveryUiChecks.run(this);
        else if (businessScenario.equals("business-scenario-tools"))
          ScenarioToolsHostChecks.run(this);
        else if (businessScenario.equals("business-source-receipt"))
          SourceTaskReceiptChecks.run(this);
        else if (businessScenario.equals("business-source-history"))
          SourceHistoryChecks.contract(this);
        else if (businessScenario.equals("business-source-history-real"))
          SourceHistoryChecks.realControls(this);
        else if (businessScenario.equals("business-source-history-recreate"))
          SourceHistoryChecks.recreate(this);
        else if (businessScenario.equals("business-source-history-draft"))
          SourceHistoryChecks.dirtyNavigation(this);
        else if (businessScenario.equals("business-source-revisions"))
          SourceRevisionChecks.contract(this);
        else if (businessScenario.equals("business-source-version-navigation"))
          SourceRevisionChecks.navigation(this);
        else if (businessScenario.equals("business-source-update-chain"))
          SourceChecks.pipeline(this, false, true);
        else if (businessScenario.equals("business-source-update-real"))
          SourceChecks.pipeline(this, true, true);
        else if (businessScenario.equals("business-source-live"))
          SourceChecks.live(this);
        else if (businessScenario.equals("business-source-stop"))
          SourceChecks.guards(this, false);
        else if (businessScenario.equals("business-source-restore"))
          SourceChecks.guards(this, true);
        else if (businessScenario.equals("business-source-chain"))
          SourceChecks.pipeline(this, false);
        else if (businessScenario.equals("business-source-chain-real"))
          SourceChecks.pipeline(this, true);
        else if (businessScenario.equals("business-source-controls"))
          SourceChecks.controls(this);
        else if (businessScenario.equals("business-source-browser"))
          SourceChecks.browser(this);
        else if (businessScenario.equals("business-source-merge"))
          SourceChecks.merge(this);
        else if (businessScenario.equals("business-source-contract"))
          SourceChecks.identities(this);
        else if (businessScenario.equals("business-lifecycle-content"))
          CollectionLifecycleChecks.contentImport(this);
        else if (businessScenario.equals("business-lifecycle-interrupt-prepare"))
          CollectionLifecycleChecks.prepareInterrupt(this);
        else if (businessScenario.equals("business-lifecycle-interrupt-verify"))
          CollectionLifecycleChecks.verifyInterrupt(this);
        else if (businessScenario.equals("business-lifecycle-download-cleanup"))
          CollectionLifecycleChecks.downloadCleanup(this);
        else if (businessScenario.equals("business-lifecycle-picker"))
          CollectionLifecycleChecks.picker(this);
        else if (businessScenario.equals("business-lifecycle-stop-guards"))
          CollectionLifecycleChecks.stopGuards(this);
        else if (businessScenario.equals("business-lifecycle-recovery"))
          CollectionLifecycleChecks.recovery(this);
        else if (businessScenario.equals("business-lifecycle"))
          CollectionLifecycleChecks.run(this);
        else if (businessScenario.equals("business-asr-cleanup"))
          CollectionAsrChecks.cleanup(this);
        else if (businessScenario.equals("business-asr-stop"))
          CollectionAsrChecks.stopChain(this);
        else if (businessScenario.equals("business-asr-live"))
          CollectionAsrChecks.live(this);
        else if (businessScenario.equals("business-asr"))
          CollectionAsrChecks.run(this);
        else if (businessScenario.equals("business-download"))
          CollectionDownloadChecks.run(this);
        else if (businessScenario.equals("business-v9"))
          ResearchV9Checks.run(this);
        else if (businessScenario.equals("business-restore"))
          BusinessChecks.restoreAccountSelector(this);
        else if (businessScenario.equals("business-duplicates"))
          BusinessChecks.duplicateBackup(this);
        else if (businessScenario.equals("business-picker"))
          BusinessChecks.pendingPickerState(this);
        else if (businessScenario.equals("business-navigation"))
          BusinessChecks.navigationSelection(this);
        else if (businessScenario.equals("business-large-draft"))
          BusinessChecks.largeEvidenceDraft(this);
        else if (businessScenario.equals("business-recreation"))
          BusinessChecks.pageRecreation(this);
        else if (businessScenario.equals("business"))
          BusinessChecks.run(this);
        else
          throw new IllegalArgumentException("Unknown business test mode: " + businessScenario);
        result.putString("stream", "PASS native business slice, " + assertions + " assertions\n");
        finish(0, result);
        return;
      }
      new ChartChecks(this).run();
      V6ChartChecks.run(this);
      StoreChecks.run(this);
      WorkspaceChecks.run(this);
      ui(activity::funds);
      ui(()
              -> check(activity.capitalScreen.rows.size() == 2,
                  "native funding fixture table, not missing=zero"));
      shot("android-v6-funds-fixture");
      ui(() -> activity.capitalScreen.dismiss());
      ui(activity::auctionView);
      ui(()
              -> check(
                  activity.auctionScreen.rows.isEmpty(), "auction not replaced by ordinary quote"));
      shot("android-v6-auction-boundary");
      ui(() -> activity.auctionScreen.dismiss());
      ui(activity::parameters);
      boolean changed = false;
      for (int attempt = 0; attempt < 3 && !changed; attempt++) {
        AccessibilityNodeInfo editRoot = getUiAutomation().getRootInActiveWindow();
        for (AccessibilityNodeInfo node :
            editRoot.findAccessibilityNodeInfosByText("5, 10, 20, 60"))
          if ("android.widget.EditText".contentEquals(node.getClassName())) {
            Bundle edit = new Bundle();
            edit.putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "10,20,33,20");
            changed = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, edit);
            break;
          }
        if (!changed) {
          AccessibilityNodeInfo scroll = byClass(editRoot, "android.widget.ScrollView");
          if (scroll != null)
            scroll.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
          waitForIdleSync();
        }
      }
      check(changed, "manual native MA periods editable");
      shot("android-v6-parameters");
      dialogClick("应用");
      ui(()
              -> check(java.util.Arrays.equals(activity.chart.maPeriods, new int[] {10, 20, 33}),
                  "MA CSV applied and deduplicated through native dialog"));
      ui(() -> {
        MarketChart unloaded = new MarketChart(activity, null);
        unloaded.setSeries(new java.util.ArrayList<>(), "分时", true);
        java.util.List<Engine.Bar> minute = new java.util.ArrayList<>();
        for (int i = 0; i < 242; i++)
          minute.add(new Engine.Bar(i * 60000., 10, 12, 9, 11, 100, true, true));
        unloaded.setSeries(minute, "分时", false);
        check(
            unloaded.count == 242 && unloaded.end == 242, "first async minute opens full session");
        unloaded.count = 60;
        unloaded.end = 100;
        unloaded.selected = 80;
        unloaded.setSeries(minute, "分时", false);
        check(unloaded.count == 242 && unloaded.end == 242 && unloaded.selected == 80,
            "later minute refresh restores full fixed session and retains selected time");
        ListView list = activity.findViewById(R.id.stocks);
        check(list.getCount() == 8, "eight fixtures");
      });
      shot("android-home");
      ui(() -> {
        ListView list = activity.findViewById(R.id.stocks);
        check(list.getChildAt(0).getHeight() == activity.dp(48), "compact 48dp native quote rows");
        ViewGroup modes = activity.findViewById(R.id.watchModes);
        check(modes.getParent() == activity.findViewById(R.id.header),
            "modes share header instead of extra toolbar");
        check(
            modes.getChildAt(0).getWidth() >= activity.dp(48), "compact mode retains touch width");
      });
      click("走势");
      ui(() -> {
        check("spark".equals(activity.findViewById(R.id.stocks).getTag()),
            "spark watchlist selected");
        LinearLayout row =
            (LinearLayout) ((ListView) activity.findViewById(R.id.stocks)).getChildAt(0);
        boolean nativePlot = false;
        for (int i = 0; i < row.getChildCount(); i++)
          if (row.getChildAt(i) instanceof MarketSpark)
            nativePlot = true;
        check(nativePlot, "actual native sparkline attached to visible row");
      });
      shot("android-watch-spark");
      click("多股对比");
      ui(() -> {
        View grid = activity.findViewById(R.id.root).findViewWithTag("stockGrid");
        check(grid != null && grid.getVisibility() == View.VISIBLE,
            "native multi-stock grid visible");
      });
      shot("android-watch-grid");
      ui(() -> {
        GridView grid = activity.findViewById(R.id.stockGrid);
        grid.performItemClick(grid.getChildAt(1), 1, 1);
        check(((TextView) activity.findViewById(R.id.title))
                  .getText()
                  .toString()
                  .contains("贵州茅台"),
            "grid opens same instrument identity");
      });
      ui(() -> activity.goHome());
      ui(() -> ((GridView) activity.findViewById(R.id.stockGrid)).setSelection(2));
      final int[] homePosition = new int[1];
      ui(() -> {
        GridView grid = activity.findViewById(R.id.stockGrid);
        homePosition[0] = grid.getFirstVisiblePosition();
        grid.performItemClick(null, 4, 4);
        String quote = ((TextView) activity.findViewById(R.id.quote)).getText().toString();
        check(quote.contains("3.049") && quote.contains("-0.039"),
            "ETF quote and absolute change use three decimals");
      });
      ui(() -> activity.goHome());
      ui(()
              -> check(((GridView) activity.findViewById(R.id.stockGrid)).getFirstVisiblePosition()
                      == homePosition[0],
                  "home restores multi-stock comparison scroll position"));
      click("报价");
      ui(() -> {
        ListView list = activity.findViewById(R.id.stocks);
        list.performItemClick(list.getChildAt(0), 0, 0);
      });
      ui(() -> {
        check(activity.chart.bars.size() == 116, "daily bars");
        check(activity.chart.getHeight() > 0, "native chart visible");
        check(activity.chart.count == 64, "64 daily bars in compact portrait chart");
        check(!activity.findViewById(R.id.navigation).isShown(),
            "root navigation is absent from detail");
      });
      shot("android-day");
      ui(() -> {
        int[] chartOrigin = new int[2], indicatorOrigin = new int[2];
        activity.chart.getLocationInWindow(chartOrigin);
        activity.findViewById(R.id.indicators).getLocationInWindow(indicatorOrigin);
        check(indicatorOrigin[1] >= chartOrigin[1] + activity.chart.getHeight(),
            "quick indicators below chart");
      });
      ui(() -> {
        int[] origin = new int[2], rootOrigin = new int[2];
        activity.chart.getLocationInWindow(origin);
        View root = activity.findViewById(R.id.root);
        root.getLocationInWindow(rootOrigin);
        float usable = root.getHeight() - root.getPaddingTop() - root.getPaddingBottom();
        float density = activity.getResources().getDisplayMetrics().density;
        System.out.println(
            "geometry widthDp=" + activity.getResources().getConfiguration().screenWidthDp
            + " usableDp=" + usable / density + " priceHeightDp=" + activity.chart.priceHeightDp());
        check(
            origin[1] - rootOrigin[1] - root.getPaddingTop() + activity.chart.priceTopDp() * density
                <= usable * .30f,
            "portrait price grid begins in upper 30 percent");
        check(activity.chart.priceHeightDp() * density >= usable * .40f,
            "portrait price grid at least 40 percent");
      });
      dragChart();
      click("最新");
      ui(() -> {
        activity.chart.selected = 80;
        activity.chart.end = 95;
      });
      click("ATR");
      ui(() -> {
        check(activity.chart.selected == 80 && activity.chart.end == 95,
            "indicator keeps time anchor");
        check(activity.chart.indicator.equals("ATR"), "ATR selected");
      });
      click("RVOL");
      ui(() -> check(activity.chart.indicator.equals("RVOL"), "RVOL selected"));
      click("MACD");
      click("参数");
      Thread.sleep(200);
      AccessibilityNodeInfo picker =
          byClass(getUiAutomation().getRootInActiveWindow(), "android.widget.NumberPicker");
      check(picker != null, "native parameter picker found");
      check(picker.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD),
          "native picker scroll action");
      Thread.sleep(500);
      dialogClick("应用");
      ui(() -> {
        check(activity.chart.emaPeriod == 21,
            "parameter applied through native picker: " + activity.chart.emaPeriod);
        check(activity.chart.selected == 80 && activity.chart.end == 95,
            "parameters keep time anchor");
      });
      click("最新");
      click("分时");
      ui(() -> {
        check(activity.chart.bars.size() == 240, "intraday count");
        check(!activity.chart.bars.get(170).valid, "real gap preserved");
        activity.chart.selected = 170;
        activity.read(170);
        String readout = ((TextView) activity.findViewById(R.id.readout)).getText().toString();
        check(
            readout.contains("数据缺口") && !readout.contains("已收盘") && !readout.contains("收 "),
            "gap readout does not present valid price");
      });
      shot("android-gap");
      click("最新");
      shot("android-minute");
      click("日K");
      click("布局");
      Thread.sleep(250);
      dialogClick("分时盯盘 · 盘口常驻");
      ui(() -> {
        check(activity.chart.minute, "order-book mode explicitly opens intraday");
        check(!activity.chart.book,
            "portrait keeps full chart width and moves book below at every width");
        check(activity.findViewById(R.id.bookBelow).isShown() == !activity.chart.book,
            "compact book fallback actually visible below chart");
      });
      shot("android-quotes");
      click("日K");
      ui(()
              -> check(
                  !activity.chart.book, "day K is always full width, not squeezed by order book"));
      shot("android-day-with-book-preference");
      click("布局");
      Thread.sleep(250);
      dialogClick("宽图精读 · 默认");
      ui(() -> {
        int invalidated = -1;
        for (int i = 0; i < activity.chart.seq.size(); i++) {
          Engine.Seq s = activity.chart.seq.get(i);
          if ((Double.isFinite(s.support) && !s.supportActive)
              || (Double.isFinite(s.resistance) && !s.resistanceActive)) {
            invalidated = i;
            break;
          }
        }
        check(invalidated >= 0, "fixture includes invalidated TDST");
        activity.chart.selected = invalidated;
        check(activity.explanation().contains("已突破失效"), "TDST invalidation explained");
        activity.chart.selected = 115;
        check(activity.explanation().contains("形成中"), "unfinished signal not confirmed");
      });
      click("信号解释");
      ui(()
              -> check(activity.findViewById(R.id.businessHost).isShown(),
                  "signal explanation is an in-Activity workspace"));
      shot("android-explanation");
      click("展开公式与全部依据");
      shot("android-explanation-expanded");
      getUiAutomation().executeShellCommand("input keyevent 4").close();
      Thread.sleep(350);
      ui(()
              -> check(activity.findViewById(R.id.home).isShown()
                      && !activity.findViewById(R.id.businessHost).isShown(),
                  "back from explanation goes directly to homepage"));
      ui(activity::explain);
      click("行情");
      ui(()
              -> check(
                  activity.findViewById(R.id.detail).isShown() && activity.chart.selected == 115,
                  "workspace chart switch restores the inspected history"));
      click("深浅");
      shot("android-dark");
      click("深浅");
      click("横屏");
      Thread.sleep(700);
      waitForIdleSync();
      ui(()
              -> check(activity.chart.bars.size() == 116 && activity.chart.selected == 115,
                  "rotation keeps context"));
      shot("android-landscape");
      click("布局");
      Thread.sleep(250);
      dialogClick("分时盯盘 · 盘口常驻");
      shot("android-landscape-quotes");
      click("布局");
      Thread.sleep(250);
      dialogClick("宽图精读 · 默认");
      click("日K");
      ui(() -> check(activity.chart.priceHeightDp() > 100, "landscape main plot usable height"));
      click("参数");
      Thread.sleep(200);
      AccessibilityNodeInfo scroller =
          byClass(getUiAutomation().getRootInActiveWindow(), "android.widget.ScrollView");
      check(scroller != null && scroller.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD),
          "landscape parameters scroll to lower controls");
      Thread.sleep(350);
      shot("android-landscape-parameters");
      dialogClick("显示主图均线");
      dialogClick("应用");
      ui(() -> check(!activity.chart.overlay, "landscape lower parameter saved"));
      click("解释");
      Thread.sleep(150);
      click("行情");
      click("布局");
      Thread.sleep(150);
      dialogClick("双周期 · 横屏主图 / 周K");
      Thread.sleep(250);
      ui(()
              -> check(activity.reference.getVisibility() == View.VISIBLE,
                  "native linked weekly chart visible"));
      shot("android-matrix");
      ui(() -> {
        MarketChart c = activity.reference;
        long now = SystemClock.uptimeMillis();
        for (int action : new int[] {MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP}) {
          MotionEvent e =
              MotionEvent.obtain(now, now + 20, action, c.getWidth() * .6f, c.getHeight() * .4f, 0);
          c.dispatchTouchEvent(e);
          e.recycle();
        }
        check(activity.explanation().contains("周K"),
            "linked reference has its own signal explanation");
        check(activity.chart.selected == 115, "reference selection preserves primary bar");
      });
      click("ATR");
      ui(() -> {
        check(activity.chart.indicator.equals("ATR") && activity.reference.indicator.equals("ATR"),
            "linked chart indicator toolbar applies to both panes");
        check(activity.explanation().contains("周K"), "indicator retains reference explanation");
      });
      click("九转");
      ui(() -> {
        check(
            !activity.chart.nine && !activity.reference.nine, "nine toggle applies to both panes");
        check(activity.explanation().contains("周K"), "nine toggle retains reference selection");
      });
      click("九转");
      click("参数");
      Thread.sleep(200);
      dialogClick("应用");
      ui(()
              -> check(activity.explanation().contains("周K"),
                  "parameters retain reference explanation"));
      ActivityMonitor monitor = addMonitor(MainActivity.class.getName(), null, false);
      ui(() -> activity.recreate());
      Activity recreated = monitor.waitForActivityWithTimeout(3000);
      check(recreated instanceof MainActivity, "activity recreated");
      activity = (MainActivity) recreated;
      removeMonitor(monitor);
      waitForIdleSync();
      ui(()
              -> check(activity.chart.selected == 115 && activity.chart.bars.size() == 116,
                  "recreation preserves selected bar"));
      ui(()
              -> check(activity.reference.emaPeriod == activity.chart.emaPeriod
                      && activity.reference.atrPeriod == activity.chart.atrPeriod
                      && activity.reference.volumePeriod == activity.chart.volumePeriod
                      && activity.reference.overlay == activity.chart.overlay,
                  "recreation preserves shared parameters on both charts"));
      ui(() -> {
        check(activity.reference.indicator.equals(activity.chart.indicator)
                && activity.reference.nine == activity.chart.nine,
            "recreation preserves shared indicator and nine toggle");
        check(activity.explanation().contains("周K"), "recreation preserves reference selection");
      });
      getUiAutomation().executeShellCommand("input keyevent 4").close();
      Thread.sleep(550);
      ui(()
              -> check(activity.findViewById(R.id.detail).getVisibility() == View.VISIBLE,
                  "first back closes landscape"));
      getUiAutomation().executeShellCommand("input keyevent 4").close();
      Thread.sleep(400);
      ui(()
              -> check(activity.findViewById(R.id.home).getVisibility() == View.VISIBLE,
                  "system back directly home"));
      result.putString("stream",
          "PASS " + assertions + " native assertions; screenshots in app external files/qa\n");
      finish(0, result);
    } catch (Throwable e) {
      result.putString(
          "stream", "FAIL " + e.toString() + "\n" + android.util.Log.getStackTraceString(e));
      finish(1, result);
    }
  }
}
