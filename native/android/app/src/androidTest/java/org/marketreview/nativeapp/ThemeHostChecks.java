package org.marketreview.nativeapp;

import android.content.*;
import android.database.sqlite.SQLiteDatabase;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

/** Focused v61 runner: actual Main, native Views and real SQLite in explicit test paths only. */
final class ThemeHostChecks {
  static final List<String> ACCOUNTS=Collections.singletonList("account-A");
  interface Call {void run()throws Exception;}
  static void reject(FlowInstrumentation f,Call call,String fragment)throws Exception {
    String reason="";try{call.run();}catch(Exception e){reason=String.valueOf(e.getMessage());}
    f.check(reason.contains(fragment),"expected rejection "+fragment+", received "+reason);
  }
  static JSONObject fixture(FlowInstrumentation f)throws Exception {
    try(InputStream in=f.getContext().getAssets().open("candidate-theme-v61.json")) {
      return new JSONObject(new String(MarketFeed.bytes(in,1024*1024),StandardCharsets.UTF_8));
    }
  }
  static void row(SQLiteDatabase db,String kind,JSONObject value)throws Exception {
    ContentValues v=new ContentValues();v.put("kind",kind);v.put("id",value.getString("id"));v.put("payload",value.toString());db.insertOrThrow("records",null,v);
  }
  static void seed(File business,File recent,File leaders,JSONObject fixture)throws Exception {
    for(File file:new File[]{business,recent,leaders}){if(file.exists())throw new IllegalArgumentException("Fresh isolated source required: "+file);File parent=file.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("Cannot create test directory");}
    JSONObject source=fixture.getJSONObject("backgroundSources").getJSONObject("sources");
    try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(business,null)) {
      db.execSQL("CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))");
      for(String kind:new String[]{"accounts","trades"}){JSONArray rows=source.getJSONObject("holdings").getJSONObject("data").getJSONArray(kind);for(int i=0;i<rows.length();i++)row(db,kind,rows.getJSONObject(i));}
      for(String kind:new String[]{"topics","relations","docs"}){JSONArray rows=fixture.getJSONObject("catalogue").getJSONArray(kind);for(int i=0;i<rows.length();i++)row(db,kind,rows.getJSONObject(i));}
      db.setVersion(1);
    }
    try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(recent,null)) {
      db.execSQL("PRAGMA application_id=1381188401");db.execSQL("CREATE TABLE recent_entries(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
      JSONArray rows=source.getJSONObject("recent").getJSONObject("data").getJSONArray("rows");for(int i=0;i<rows.length();i++){JSONObject x=rows.getJSONObject(i);ContentValues v=new ContentValues();v.put("id",x.getString("id"));v.put("payload",x.toString());db.insertOrThrow("recent_entries",null,v);}
    }
    try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(leaders,null)) {
      db.execSQL("PRAGMA application_id=1397511729");db.execSQL("CREATE TABLE config(id INTEGER PRIMARY KEY,revision INTEGER,digest TEXT,payload BLOB)");
      JSONObject config=source.getJSONObject("leaders").getJSONObject("data");byte[] bytes=config.toString().getBytes(StandardCharsets.UTF_8);ContentValues v=new ContentValues();v.put("id",1);v.put("revision",config.getLong("revision"));v.put("digest",SectorLeaderModel.hash(bytes));v.put("payload",bytes);db.insertOrThrow("config",null,v);
    }
  }
  static void document(File business,JSONObject value)throws Exception {
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(business.getPath(),null,SQLiteDatabase.OPEN_READWRITE)) {
      ContentValues v=new ContentValues();v.put("payload",value.toString());if(db.update("records",v,"kind='docs' AND id=?",new String[]{value.getString("id")})!=1)throw new IllegalStateException("test document missing");
    }
  }
  static String sourceHash(HostCandidateBackground h)throws Exception {
    StringBuilder out=new StringBuilder();for(File file:new File[]{h.business,h.recent,h.leaders})out.append(file.getName()).append(':').append(SectorLeaderModel.hash(Files.readAllBytes(file.toPath()))).append(';');return out.toString();
  }
  static HostCandidateBackground host(File dir,HostCandidateBackground.Hooks hooks) {
    return new HostCandidateBackground(new File(dir,"business.sqlite"),new File(dir,"recent.sqlite"),new File(dir,"leaders.sqlite"),new File(dir,"evidence.sqlite"),hooks);
  }
  static JSONObject held(HostCandidateBackground h,JSONArray selected)throws Exception {
    return CandidateThemeSelection.select(h.themeCatalogue(null),selected,Arrays.asList("t1","t2"),Arrays.asList("r1","r2"),"明确合成需求，不推断事实",null);
  }
  static JSONObject preview(HostCandidateBackground h,JSONArray selected,String strategy)throws Exception {
    return h.prepare(selected,strategy,ACCOUNTS,held(h,selected),null);
  }
  static void theme24(FlowInstrumentation f,JSONObject bundle)throws Exception {
    JSONArray rows=bundle.getJSONObject("result").getJSONArray("rows"),contributions=rows.getJSONObject(0).getJSONArray("contributions");int matches=0,points=0;
    for(int i=0;i<contributions.length();i++){JSONObject c=contributions.getJSONObject(i);if(c.optString("rule").equals("background.themeDemand")){matches++;points+=c.getInt("points");}}
    f.check(matches==1&&points==24,"two explicit themes still contribute +24 once");
    JSONObject selection=bundle.getJSONObject("adapter").getJSONObject("input").getJSONObject("themeSelection");
    f.check(selection.getJSONArray("relations").length()==2&&selection.getJSONArray("docs").getJSONObject(0).getString("verification").equals("unverified"),"complete source relation scope and unverified status frozen");
  }
  static JSONObject sqlite(FlowInstrumentation f,JSONObject fixture)throws Exception {
    int start=f.assertions;File dir=Files.createTempDirectory(f.getTargetContext().getCacheDir().toPath(),"candidate-theme-v61-").toFile();HostCandidateBackground h=host(dir,null);seed(h.business,h.recent,h.leaders,fixture);
    JSONArray selected=fixture.getJSONArray("selected");String sources=sourceHash(h);JSONObject p=preview(h,selected,"stable");
    f.check(!p.has("result")&&!h.evidence.exists(),"real SQLite preview neither scores nor creates evidence database");
    f.check(sourceHash(h).equals(sources),"actual read-only source capture leaves all source file bytes unchanged");
    JSONObject bundle=h.completePreview(p,null);theme24(f,bundle);String first=h.putDraft(bundle,"",null);String id=h.save("隔离主题原档案",bundle,Instant.now(),null);
    f.check(h.list(null).length()==1&&HostCandidateBackground.digest(h.read(id,null).getJSONObject("bundle")).equals(first),"atomic evidence bundle save and original archive readback");
    JSONObject doc=fixture.getJSONObject("catalogue").getJSONArray("docs").getJSONObject(0),changed=new JSONObject(doc.toString()).put("text",doc.getString("text")+"\n独立修订");
    JSONObject waiting=preview(h,selected,"stable");document(h.business,changed);reject(f,()->h.completePreview(waiting,null),"版本已变化");f.check(h.head(null).equals(first)&&h.list(null).length()==1,"source-change rejection preserves draft and named archive");document(h.business,doc);
    JSONObject newer=h.completePreview(preview(h,selected,"breakout"),null);String second=h.putDraft(newer,first,null);reject(f,()->h.putDraft(bundle,first,null),"草稿已变化");reject(f,()->h.save("过期计算",bundle,Instant.now(),null),"草稿版本已变化");f.check(h.head(null).equals(second)&&h.list(null).length()==1,"competing draft wins without stale save or overwrite");
    AtomicBoolean cancelled=new AtomicBoolean();HostCandidateBackground rollback=host(dir,new HostCandidateBackground.Hooks(){public Instant now(){return Instant.now();}public void betweenReads(){}public void beforeCommit(){cancelled.set(true);}});
    reject(f,()->rollback.putDraft(bundle,second,cancelled::get),"取消");f.check(h.head(null).equals(second)&&h.list(null).length()==1,"precommit cancellation rolls back draft replacement");
    HostCandidateBackground changedAtCommit=host(dir,new HostCandidateBackground.Hooks(){public Instant now(){return Instant.now();}public void betweenReads(){}public void beforeCommit()throws Exception{document(h.business,changed);}});
    reject(f,()->changedAtCommit.putDraft(bundle,second,null),"版本已变化");f.check(h.head(null).equals(second),"source edit before evidence commit rolls back draft");document(h.business,doc);
    reject(f,()->changedAtCommit.save("不得落库",newer,Instant.now(),null),"版本已变化");f.check(h.list(null).length()==1,"source edit before named-save commit leaves archive count unchanged");document(h.business,doc);
    HostCandidateBackground between=host(dir,new HostCandidateBackground.Hooks(){public Instant now(){return Instant.now();}public void betweenReads()throws Exception{document(h.business,changed);}});
    reject(f,()->preview(between,selected,"stable"),"版本已变化");document(h.business,doc);
    File absent=new File(dir,"missing-source.sqlite");HostCandidateBackground replay=new HostCandidateBackground(absent,absent,absent,h.evidence);
    f.check(HostCandidateBackground.digest(replay.read(id,null).getJSONObject("bundle")).equals(first)&&!absent.exists(),"original archive rereads without reopening or reconstructing missing sources");
    String stable=h.head(null);reject(f,()->h.prepare(selected,"stable",ACCOUNTS,held(h,selected),()->true),"取消");f.check(h.head(null).equals(stable),"pre-read cancellation keeps evidence head");
    return new JSONObject().put("passed",true).put("assertions",f.assertions-start).put("isolatedDirectory",dir.getAbsolutePath()).put("crossDatabaseAtomicSnapshot",false).put("scope","actual Android SQLite transactions; only new cache-directory fixtures");
  }
  static final class ProbeFile extends File {
    int touched;ProbeFile(File parent){super(parent,"never-open-v61.sqlite");}
    @Override public boolean isFile(){touched++;throw new AssertionError("unsupported API touched source before rejecting");}
    @Override public String getAbsolutePath(){touched++;throw new AssertionError("unsupported API attempted source path access");}
  }
  static JSONObject lowApi(FlowInstrumentation f)throws Exception {
    ProbeFile file=new ProbeFile(f.getTargetContext().getCacheDir());
    reject(f,()->BusinessStore.readCandidateThemeSnapshot(file,null),"只读事务");reject(f,()->BusinessStore.readLedgerSnapshot(file,null),"只读事务");
    HostCandidateBackground h=new HostCandidateBackground(file,file,file,file);reject(f,()->h.read("absent",null),"只读事务");reject(f,()->h.readDraft("absent",null),"只读事务");f.check(file.touched==0,"API 26-34 rejects before filesystem or SQLite open");
    return new JSONObject().put("passed",true).put("sdk",Build.VERSION.SDK_INT).put("workflow","unsupported-api-blocked").put("scope","expected unsupported API gate only; Main/SQLite workflow not run");
  }
  static void button(FlowInstrumentation f,String tag){f.ui(()->{View v=f.activity.candidateScreen.findViewWithTag(tag);f.check(v!=null&&v.isShown()&&v.isEnabled(),"current visible enabled control "+tag);v.performClick();});}
  static void await(FlowInstrumentation f,java.util.function.BooleanSupplier predicate,String why)throws Exception {
    long end=SystemClock.elapsedRealtime()+15000;boolean[] done={false};String[] state={""};
    while(SystemClock.elapsedRealtime()<end){f.ui(()->{done[0]=predicate.getAsBoolean();LocalCandidateScreen s=f.activity.candidateScreen;state[0]=s.state.getText()+"; mode="+s.mode+"; busy="+s.busy;});if(done[0])return;Thread.sleep(40);}throw new AssertionError(why+": "+state[0]);
  }
  static void choices(FlowInstrumentation f)throws Exception {
    button(f,"candidateThemeChoose");await(f,()->!f.activity.candidateScreen.busy&&f.activity.candidateScreen.findViewWithTag("candidateThemeDemand")!=null&&f.activity.candidateScreen.accountScroll.isShown(),"actual theme picker");
    f.ui(()->{LocalCandidateScreen s=f.activity.candidateScreen;for(String tag:new String[]{"candidateTheme:t1","candidateTheme:t2","candidateThemeMember:r1","candidateThemeMember:r2"}){CheckBox box=s.findViewWithTag(tag);f.check(box!=null&&!box.isChecked(),"explicit unchecked "+tag);box.setChecked(true);}((EditText)s.findViewWithTag("candidateThemeDemand")).setText("明确合成需求，不推断事实");});
    button(f,"candidateThemePreview");await(f,()->!f.activity.candidateScreen.busy&&f.activity.candidateScreen.findViewWithTag("candidateThemeFullPreview")!=null&&f.activity.candidateScreen.accountScroll.isShown(),"actual complete theme preview");
  }
  static void seedMain(FlowInstrumentation f,JSONObject fixture)throws Exception {
    Context c=f.getTargetContext();for(String name:new String[]{"native-business-tests.sqlite","recent-tests.sqlite","sector-leaders-tests.sqlite","candidate-tests.sqlite","candidate-background-tests.sqlite"})for(String suffix:new String[]{"","-wal","-shm","-journal"})f.check(!c.getDatabasePath(name+suffix).exists(),"requires fresh assigned test app; existing file preserved: "+name+suffix);
    seed(c.getDatabasePath("native-business-tests.sqlite"),c.getDatabasePath("recent-tests.sqlite"),c.getDatabasePath("sector-leaders-tests.sqlite"),fixture);
  }
  static JSONArray preservePreviousTestFiles(FlowInstrumentation f)throws Exception {
    f.check(f.activity==null,"test databases isolated before Main opens any stores");
    Context c=f.getTargetContext();String stamp=".previous-theme52-"+UUID.randomUUID();JSONArray preserved=new JSONArray();
    File parent=c.getDatabasePath("native-business-tests.sqlite").getCanonicalFile().getParentFile();
    for(String name:new String[]{"native-business-tests.sqlite","recent-tests.sqlite","sector-leaders-tests.sqlite","candidate-tests.sqlite","candidate-background-tests.sqlite"}) {
      for(String suffix:new String[]{"","-wal","-shm","-journal"}) {
        File old=c.getDatabasePath(name+suffix).getCanonicalFile();
        if(!old.getParentFile().equals(parent))throw new IOException("test database escaped exact assigned directory");
        if(!old.exists())continue;
        File backup=new File(parent,old.getName()+stamp);
        if(!old.isFile()||backup.exists())throw new IOException("cannot preserve prior test database safely");
        long bytes=old.length();Files.move(old.toPath(),backup.toPath());
        f.check(!old.exists()&&backup.isFile()&&backup.length()==bytes,"prior isolated test file retained without deletion: "+old.getName());
        preserved.put(new JSONObject().put("original",old.getAbsolutePath()).put("backup",backup.getAbsolutePath()).put("bytes",bytes));
      }
    }
    return preserved;
  }
  static JSONObject main(FlowInstrumentation f,JSONObject fixture)throws Exception {
    int start=f.assertions;JSONArray preserved=preservePreviousTestFiles(f);seedMain(f,fixture);
    f.activity=(MainActivity)f.startActivitySync(new Intent(f.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));f.waitForIdleSync();
    f.ui(()->{try{f.check(f.activity.testing&&f.activity.feed==null,"actual Main debug fixtures, no live feed");java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);List<JSONObject> roster=(List<JSONObject>)field.get(f.activity);roster.clear();JSONArray selected=fixture.getJSONArray("selected");for(int i=0;i<selected.length();i++)roster.add(new JSONObject(selected.getJSONObject(i).toString()));f.activity.localCandidates();}catch(Exception e){throw new RuntimeException(e);}});
    final LocalCandidateScreen s=f.activity.candidateScreen;f.ui(()->{f.check(s.isShown()&&s.chosen.isEmpty()&&s.backgroundAccounts.isEmpty(),"Main page requires explicit stock and account");s.list.performItemClick(s.list.getChildAt(0),0,0);f.check(s.chosen.equals(new LinkedHashSet<>(Collections.singletonList("SH:stock:600001"))),"actual list selects exact security");s.backgroundMode.setChecked(true);});
    button(f,"candidateThemeChoose");f.ui(()->f.check(s.state.getText().toString().contains("账本账户")&&!s.busy,"theme path blocked until account is selected"));
    button(f,"candidateBackgroundAccounts");await(f,()->!s.busy&&s.mode.equals("accounts"),"actual account picker");f.ui(()->{CheckBox a=s.findViewWithTag("candidateAccount:account-A");f.check(a!=null&&!a.isChecked()&&s.findViewWithTag("candidateAccount:paper")==null,"ledger only, no implicit default");a.setChecked(true);});button(f,"candidateBackgroundAccountApply");
    String sourceBefore=sourceHash(s.background);choices(f);final View[] oldCompute={null};f.ui(()->{TextView full=s.findViewWithTag("candidateThemeFullPreview");String text=full.getText().toString();f.check(text.contains("正文尾部_V61_不得截断")&&text.contains("unverified")&&text.contains("逐项版本摘要")&&text.contains("不代表跨库原子快照"),"actual full reader preserves tail, verification and boundary");f.check(s.current==null&&s.currentBundle==null&&s.anchor.isEmpty(),"preview has no score or frozen draft");oldCompute[0]=s.findViewWithTag("candidateThemeCompute");});
    f.check(!s.background.evidence.exists()&&sourceHash(s.background).equals(sourceBefore),"Main preview creates no evidence and leaves source SQLite bytes unchanged");button(f,"candidateThemeCancel");f.ui(()->{long generation=s.generation;oldCompute[0].performClick();f.check(s.generation==generation&&!s.busy&&s.anchor.isEmpty(),"cancelled old confirmation cannot act");});
    choices(f);button(f,"candidateThemeCompute");await(f,()->!s.busy&&s.anchor.startsWith("bg-draft:"),"actual confirmation and SQLite frozen draft");final String first=s.background.head(null);theme24(f,s.currentBundle);
    f.ui(()->s.name.setText("v61 原始主题档案"));button(f,"candidateSave");await(f,()->!s.busy&&s.anchor.startsWith("bg-saved:"),"actual named save");final String saved=s.anchor.substring(9);f.check(s.background.list(null).length()==1,"one named history exists");
    final View[] oldChoose={null},oldDelete={null};button(f,"candidateDelete");f.ui(()->{oldChoose[0]=s.findViewWithTag("candidateThemeChoose");oldDelete[0]=s.confirm;f.check(s.confirm.isShown(),"explicit delete confirmation was visible");f.activity.goHome();long generation=s.generation;oldChoose[0].performClick();oldDelete[0].performClick();f.check(s.generation==generation&&!s.busy,"hidden stale choose and delete controls cannot start work");});
    f.check(s.background.list(null).length()==1&&s.background.head(null).equals(first),"hidden stale controls preserve original archive and draft");f.ui(()->f.activity.localCandidates());
    JSONObject original=fixture.getJSONObject("catalogue").getJSONArray("docs").getJSONObject(0),changed=new JSONObject(original.toString()).put("text",original.getString("text")+"\n预览后真实修订");
    choices(f);document(s.background.business,changed);button(f,"candidateThemeCompute");await(f,()->!s.busy&&s.state.getText().toString().contains("版本已变化"),"actual Main source-change rejection");f.check(s.background.head(null).equals(first)&&s.background.list(null).length()==1,"UI source rejection keeps old evidence");document(s.background.business,original);
    choices(f);f.ui(()->{try{java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);List<JSONObject> roster=(List<JSONObject>)field.get(f.activity);JSONObject quote=roster.get(0).getJSONObject("quote");quote.put("amount",quote.getDouble("amount")+1);}catch(Exception e){throw new RuntimeException(e);}});button(f,"candidateThemeCompute");f.ui(()->f.check(!s.busy&&s.state.getText().toString().contains("证券版本已变化"),"actual Main source security changed after preview"));f.check(s.background.head(null).equals(first),"security change does not replace original draft");f.ui(()->{try{java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);List<JSONObject> roster=(List<JSONObject>)field.get(f.activity);roster.set(0,new JSONObject(fixture.getJSONArray("selected").getJSONObject(0).toString()));}catch(Exception e){throw new RuntimeException(e);}});
    choices(f);final JSONArray[] fresh={null};f.ui(()->{try{fresh[0]=s.host.snapshot(Collections.unmodifiableSet(new LinkedHashSet<>(s.chosen)));}catch(Exception e){throw new RuntimeException(e);}});JSONArray selected=fresh[0];HostCandidateBackground competing=new HostCandidateBackground(s.background.business,s.background.recent,s.background.leaders,s.background.evidence);JSONObject next=competing.completePreview(preview(competing,selected,"breakout"),null);String newer=competing.putDraft(next,first,null);button(f,"candidateThemeCompute");await(f,()->!s.busy&&s.state.getText().toString().contains("草稿已变化"),"actual Main competing draft rejection");f.check(s.background.head(null).equals(newer)&&s.background.list(null).length()==1,"newer draft and original archive survive UI race");
    document(s.background.business,changed);button(f,"candidateHistory");await(f,()->!s.busy&&s.historyLoaded&&s.history.length()==1,"actual original history list");f.ui(()->s.list.performItemClick(s.list.getChildAt(0),0,0));await(f,()->!s.busy&&s.anchor.equals("bg-saved:"+saved)&&s.currentBundle!=null,"actual original archive reopened");f.check(HostCandidateBackground.digest(s.currentBundle).equals(first),"archive reread keeps frozen original even after source revision and newer draft");
    f.ui(()->{s.list.performItemClick(s.list.getChildAt(0),0,0);f.check(s.detail.getText().toString().contains("正文尾部_V61_不得截断"),"actual saved detail retains full evidence");f.activity.goHome();});
    return new JSONObject().put("passed",true).put("assertions",f.assertions-start).put("archiveId",saved).put("originalDigest",first).put("newerDraftDigest",newer).put("preservedPreviousTestFiles",preserved).put("scope","actual MainActivity and native View callbacks with isolated Android SQLite; no online data or physical touch claim");
  }
  static JSONObject run(FlowInstrumentation f)throws Exception {
    f.check((f.getTargetContext().getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0,"assigned debug test app required");
    if(Build.VERSION.SDK_INT<35)return lowApi(f);
    JSONObject fixture=fixture(f),sqlite=sqlite(f,fixture),main=main(f,fixture);
    JSONObject report=new JSONObject().put("passed",true).put("sdk",Build.VERSION.SDK_INT).put("sqlite",sqlite).put("actualMain",main).put("crossDatabaseAtomicSnapshot",false);
    Files.write(new File(f.activity.getExternalFilesDir(null),"candidate-theme-v61.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));return report;
  }
}
