package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import org.json.*;

public final class MainActivity extends Activity {
  CffexDisclosureScreen cffexScreen;CffexDisclosureTransport cffexTransport;CffexDisclosureTransport.Opener cffexTestOpener;
  void cffexActive(boolean active){if(!active&&cffexScreen!=null)cffexScreen.cancel();}
  void openCffexDisclosure(){
    try{
      if(cffexScreen==null){
        final boolean isolated=testing&&cffexTestOpener==null;
        cffexTransport=cffexTestOpener==null?new CffexDisclosureTransport(this::runOnUiThread):new CffexDisclosureTransport(this::runOnUiThread,cffexTestOpener);
        cffexScreen=new CffexDisclosureScreen(this,new File(getFilesDir(),testing?"cffex-disclosure-tests-v38.json":"cffex-disclosure-v1.json"),new CffexDisclosureScreen.Host(){
          public void fetch(String token,JSONObject query){try{if(isolated){cffexScreen.fail(token,"隔离模式未连接真实来源");return;}cffexTransport.start(token,query,(t,report,error)->{if(cffexScreen==null)return;if(error.isEmpty())cffexScreen.accept(t,report);else cffexScreen.fail(t,error);});}catch(Exception e){cffexScreen.fail(token,e.getMessage());}}
          public void cancel(String token){if(cffexTransport!=null)cffexTransport.cancel(token);}
        });
      }
      showPage("cffexDisclosure","股指期货指定日披露",cffexScreen);cffexScreen.setDarkTheme(dark);
    }catch(Exception e){disposeCffexDisclosure();reviewFileMessage("披露页未打开："+e.getMessage());}
  }
  void disposeCffexDisclosure(){cffexActive(false);if(cffexTransport!=null)cffexTransport.close();cffexTransport=null;cffexScreen=null;}
  ArchiveVideoReviewScreen archiveVideoScreen;JSONObject archiveVideoRow=new JSONObject();
  void archiveVideoActive(boolean active){if(archiveVideoScreen!=null)archiveVideoScreen.setActive(active);}
  JSONObject archiveVideoCurrent(String id){try{JSONArray all=businessStore.read("collections");for(int i=0;i<all.length();i++){JSONObject row=all.getJSONObject(i);if(row.optString("id").equals(id))return row;}}catch(Exception ignored){}return new JSONObject();}
  String archiveVideoHash(JSONObject row)throws Exception{byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(ArchiveVideoReviewModel.canonical(row).getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte x:hash)out.append(String.format(java.util.Locale.ROOT,"%02x",x&255));return out.toString();}
  void openArchiveVideo(JSONObject captured)throws Exception{
    JSONObject latest=archiveVideoCurrent(captured.optString("id"));BusinessStore.require(!captured.optString("id").isEmpty()&&ArchiveVideoReviewModel.canonical(captured).equals(ArchiveVideoReviewModel.canonical(latest)),"作品记录已变化，请重新选择");
    if(archiveVideoScreen!=null){archiveVideoScreen.close();((FrameLayout)findViewById(R.id.businessHost)).removeView(archiveVideoScreen);businessPages.remove("archiveVideo");LinearLayout tabs=findViewById(R.id.pageTabs);View old=tabs.findViewWithTag("page:archiveVideo");if(old!=null)tabs.removeView(old);}
    archiveVideoRow=new JSONObject(captured.toString());
    archiveVideoScreen=new ArchiveVideoReviewScreen(this,archiveVideoRow,Arrays.asList(new File(getFilesDir(),testing?"collection-media-tests":"collection-media"),new File(getFilesDir(),testing?"recognition-tests/media":"recognition/media")),this::archiveVideoCurrent);
    showPage("archiveVideo","归档视频 / 逐字稿复核",archiveVideoScreen);archiveVideoActive(true);
  }
  void restoreArchiveVideo(String saved){try{JSONObject state=new JSONObject(saved),row=archiveVideoCurrent(state.getString("id"));BusinessStore.require(state.getString("rowHash").equals(archiveVideoHash(row)),"作品版本已变化，未恢复旧视频定位");openArchiveVideo(row);archiveVideoScreen.restoreState(state);archiveVideoActive(false);}catch(Exception ex){reviewFileMessage("视频复核未恢复："+ex.getMessage());}}
  AccountReferenceScreen accountReferenceScreen;String accountReferenceId="";Spinner accountReferenceChoice;
  final ArrayList<String> accountReferenceIds=new ArrayList<>();
  void openAccountReference(String requested){
    try{
      String wanted=requested==null||requested.isEmpty()?accountReferenceId:requested;
      JSONArray accounts=businessStore.read("accounts");ArrayList<String> labels=new ArrayList<>();accountReferenceIds.clear();
      for(int i=0;i<accounts.length();i++){JSONObject a=accounts.getJSONObject(i);accountReferenceIds.add(a.getString("id"));labels.add(a.optString("name")+" · "+a.getString("id"));}
      if(wanted.isEmpty()&&!accountReferenceIds.isEmpty())wanted=accountReferenceIds.get(0);accountReferenceId=wanted;
      LinearLayout container=(LinearLayout)businessPages.get("accountReference");
      if(container==null){
        container=new LinearLayout(this);container.setOrientation(LinearLayout.VERTICAL);accountReferenceChoice=new Spinner(this);accountReferenceChoice.setTag("accountReferenceAccount");container.addView(accountReferenceChoice);
        TextView note=new TextView(this);note.setText("只读本机账本与已有报价，不自动联网；今日时点缺失时显示未知。");container.addView(note);
        accountReferenceScreen=new AccountReferenceScreen(this,()->HostAccountReference.output(this,accountReferenceId));container.addView(accountReferenceScreen,new LinearLayout.LayoutParams(-1,0,1));
      }
      accountReferenceChoice.setOnItemSelectedListener(null);accountReferenceChoice.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,labels));accountReferenceChoice.setSelection(accountReferenceIds.indexOf(wanted));
      accountReferenceChoice.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?> p){}public void onItemSelected(android.widget.AdapterView<?> p,View v,int at,long id){if(at>=0&&at<accountReferenceIds.size()){accountReferenceId=accountReferenceIds.get(at);accountReferenceScreen.reload();}}});
      showPage("accountReference","今日参考盈亏 / 成本比例",container);accountReferenceScreen.reload();accountReferenceScreen.setDarkTheme(dark);
    }catch(Exception ex){reviewFileMessage("参考盈亏读取失败："+ex.getMessage());}
  }
  AccountEditScreen accountEditScreen;boolean accountEditStateFailed;
  void accountEditActive(boolean active){if(accountEditScreen!=null)accountEditScreen.setActive(active);}
  void openAccountEdit(){
    if(accountEditScreen==null)accountEditScreen=new AccountEditScreen(this,new AccountEditScreen.Host(){
      public JSONArray loadAccounts()throws Exception{return businessStore.read("accounts");}
      public boolean supportsAtomicCas(){return true;}
      public JSONObject compareAndSave(JSONObject expected,JSONObject candidate)throws Exception{
        requireWatchlistUi();JSONObject saved=businessStore.editAccount(expected,candidate);
        for(View view:businessPages.values())if(view instanceof BusinessScreen){BusinessScreen b=(BusinessScreen)view;if(b.kind.equals("accounts")||b.kind.equals("paper"))b.refreshAccounts();}
        return saved;
      }
    });
    showPage("accountEdit","账户资料 / 手工现金",accountEditScreen);accountEditScreen.setActive(true);accountEditScreen.setDarkTheme(dark);
  }
  MaterialLibraryScreen materialLibraryScreen;
  KnowledgeAiHostScreen knowledgeAiHostScreen;
  DataSourceStatusScreen dataSourceStatusScreen;
  boolean sourceEvidenceNavigation;
  JSONArray materialLibrarySources()throws Exception{
    JSONArray result=new JSONArray();
    for(String kind:new String[]{"docs","collections"}) {
      JSONArray rows=businessStore.read(kind);
      for(int n=0;n<rows.length();n++){JSONObject row=rows.getJSONObject(n);result.put(new JSONObject().put("kind",kind).put("id",row.getString("id")).put("row",row));}
    }
    return result;
  }
  void openMaterialLibrary(){
    try{
      if(materialLibraryScreen==null){
        materialLibraryScreen=new MaterialLibraryScreen(this,getDatabasePath(testing?"material-library-host-v34.sqlite":"material-library-v1.sqlite"),this::materialLibrarySources,this::openHandoffSource);
        materialLibraryScreen.setTag("materialLibraryPage");materialLibraryScreen.setFileActions(this::exportReviewFile,()->chooseReviewImport(458));
        final MaterialLibraryScreen owner=materialLibraryScreen;
        Button knowledge=add(owner,"资料研究请求 · 选择 / 预览 / 历史",()->{});
        owner.removeView(knowledge);owner.addView(knowledge,0,new LinearLayout.LayoutParams(-1,dp(48)));
        knowledge.setTag("libraryOpenKnowledgeAi");
        knowledge.setOnClickListener(v->{if(owner==materialLibraryScreen&&unifiedBackupEntryActive("materialLibrary",owner)&&v.isShown())openKnowledgeAiHost();});
      }
      showPage("materialLibrary","全量资料库 / 人工分类",materialLibraryScreen);materialLibraryScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("资料库未打开，原文未修改："+e.getMessage());}
  }
  void openKnowledgeAiHost(){
    try{
      if(knowledgeAiHostScreen==null)knowledgeAiHostScreen=new KnowledgeAiHostScreen(this,
          new java.io.File(getFilesDir(),testing?"knowledge-ai-host-tests-v42":"knowledge-ai-host-v1"),
          this::materialLibrarySources,
          ()->new AiSettingsStore(getDatabasePath(testing?"ai-settings-host-tests.sqlite":"ai-settings-v1.sqlite")).read().getJSONObject("preferences"));
      final KnowledgeAiHostScreen expected=knowledgeAiHostScreen;
      expected.setEntryCheck(()->expected==knowledgeAiHostScreen&&unifiedBackupEntryActive("knowledgeAiHost",expected));
      showPage("knowledgeAiHost","资料研究请求 · 未就绪",knowledgeAiHostScreen);
      knowledgeAiHostScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("资料研究宿主未打开，私有原稿保留");}
  }
  void knowledgeAiHostActive(boolean wanted){
    final KnowledgeAiHostScreen expected=knowledgeAiHostScreen;
    if(expected==null)return;
    expected.setActive(false);
    if(wanted)expected.post(()->{if(expected==knowledgeAiHostScreen&&unifiedBackupEntryActive("knowledgeAiHost",expected))expected.setActive(true);});
  }
  JSONObject dataSourceEvidence()throws Exception{
    JSONObject input=new JSONObject().put("generatedAt",java.time.Instant.now().toString()).put("instruments",new JSONArray(instruments));
    if(sectorScreen!=null){
      JSONArray sectors=new JSONArray();
      for(int n=0;n<2;n++){
        if(n==1&&sectorScreen.board.optString("code").isEmpty())continue;
        JSONObject query=n==0?sectorScreen.catalogQuery():sectorScreen.memberQuery();
        JSONObject snapshot=n==0?sectorScreen.catalog:sectorScreen.current;
        JSONObject saved=sectorScreen.store.read(query,()->false);sectors.put(new JSONObject().put("snapshot",snapshot).put("query",query).put("lastAttempt",saved.opt("lastAttempt")));
      }
      input.put("sectorSnapshots",sectors);
    }
    if(marketOverviewScreen!=null)input.put("marketSnapshots",new JSONArray().put(new JSONObject().put("snapshot",new JSONObject().put("schema","native-market-overview/v1").put("sections",marketOverviewScreen.cache)).put("attempt",marketOverviewScreen.snapshot)));
    if(newsScreen!=null&&newsScreen.snapshot!=null)input.put("newsSnapshots",new JSONArray().put(new JSONObject().put("snapshot",newsScreen.snapshot).put("attempt",newsScreen.attempt)));
    JSONObject result=DataSourceSnapshotAdapter.adapt(input),snapshot=result.getJSONObject("snapshot");JSONArray records=snapshot.getJSONArray("records");
    for(int n=0;n<records.length();n++){
      JSONObject row=records.getJSONObject(n),target=row.getJSONObject("target");String product=row.getString("product"),route="";
      if(target.optString("kind").equals("instrument")){
        if(Arrays.asList("quote","intraday","kline").contains(product))route="detail";
        else if(product.equals("funds"))route="capital";else if(product.equals("auction"))route="auction";
      }else if(product.equals("news"))route="news";
      else if(target.optString("kind").equals("market"))route="market-overview";
      else if(product.equals("industry")||product.equals("concept"))route="sector-watch";
      row.put("route",route);
    }
    result.put("snapshot",DataSourceStatusModel.snapshot(snapshot));return result;
  }
  void openDataSourceTarget(String route,JSONObject target)throws Exception{
    boolean exact=false;JSONArray rows=dataSourceEvidence().getJSONObject("snapshot").getJSONArray("records");
    for(int n=0;n<rows.length();n++){JSONObject row=rows.getJSONObject(n);if(row.optString("route").equals(route)&&EvidenceReviewModel.canonical(DataSourceStatusModel.navigation(row)).equals(EvidenceReviewModel.canonical(target)))exact=true;}
    BusinessStore.require(exact,"证据目标已变化，未猜测其他证券");
    if(target.optString("kind").equals("instrument")){
      JSONObject selected=null;for(JSONObject row:instruments)if(row.optString("id").equals(target.optString("id")))selected=row;
      BusinessStore.require(selected!=null,"完整证券身份未匹配");
      sourceEvidenceNavigation=true;
      try{
        String grain=target.optString("granularity");if(route.equals("detail")&&Arrays.asList("day","week","month","year","minute","minute5s","minute30s").contains(grain))period=grain;
        resumeChart();open(selected,true);
        if(route.equals("capital")){funds();int index=capitalScreen.ids.indexOf(target.getString("id"));BusinessStore.require(index>=0,"资金页无此完整身份");capitalScreen.symbols.setSelection(index);capitalScreen.modes.setSelection(grain.equals("day")?0:grain.equals("minute")?1:2);}
        else if(route.equals("auction"))auctionView();
      }finally{sourceEvidenceNavigation=false;}
    }else if(route.equals("news"))openNews(false);
    else if(route.equals("market-overview"))marketOverview();
    else if(route.equals("sector-watch")){
      sectors();JSONObject state=sectorScreen.saveState();String provider=target.optString("sourceProvider");
      state.put("provider",provider.startsWith("sina-public-")?"sina":provider).put("taxonomy",target.getString("product")).put("boardFilter",target.optString("code")).put("filter","").put("memberId","");
      state.put("boardKey",target.optString("kind").equals("board")?SectorWatchModel.key(SectorWatchModel.query(target.getString("provider"),target.getString("taxonomy"),target.getString("code"))):"");sectorScreen.restoreState(state);
    }
  }
  void openDataSourceStatus(){
    try{
      if(dataSourceStatusScreen==null){
        dataSourceStatusScreen=new DataSourceStatusScreen(this,new DataSourceStatusScreen.Host(){
          public void openNative(String route,JSONObject target)throws Exception{openDataSourceTarget(route,target);}
          public boolean supportsExport(){return true;}
          public void exportEvidence(byte[] bytes)throws Exception{exportReviewFile("data-source-evidence.json","application/json",bytes);}
        });
        dataSourceStatusScreen.setAllowedRoutes(Arrays.asList("detail","capital","auction","sector-watch","market-overview","news"));
        Button reload=new Button(this);reload.setText("重读已持有证据（不请求数据源）");reload.setTag("dataSourceReload");reload.setOnClickListener(v->openDataSourceStatus());dataSourceStatusScreen.addFilterAccessory(reload);
        TextView scope=new TextView(this);scope.setTag("dataSourceCoverage");dataSourceStatusScreen.addFilterAccessory(scope);
      }
      JSONObject state=dataSourceStatusScreen.saveState(),result=dataSourceEvidence();dataSourceStatusScreen.setSnapshot(result.getJSONObject("snapshot"));dataSourceStatusScreen.restoreState(state);
      dataSourceStatusScreen.<TextView>findViewWithTag("dataSourceCoverage").setText("仅已载入行情和已打开页面；未扫描全库。元信息缺失/不支持 "+result.optInt("omittedCount")+" 项，同身份去重 "+result.optInt("duplicateCount")+" 项。");
      showPage("dataSourceStatus","本机来源 / 时点",dataSourceStatusScreen);dataSourceStatusScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("来源证据未更新，旧记录保留；未请求外部接口。");}
  }
  MigrationStatusScreen migrationStatusScreen;
  AiSettingsScreen aiSettingsScreen;

  IndustryTopicScreen industryTopicScreen;IndustryTopicRuntime industryTopicRuntime;
  File industryTopicTestDirectory(){
    String name=testing?getIntent().getStringExtra("f08IndustryTest"):null;if(name==null)return null;
    if(!name.matches("f08-industry-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))throw new IllegalArgumentException("产业专项目录无效");
    try{File cache=getCacheDir().getCanonicalFile(),dir=new File(cache,name).getCanonicalFile();if(!cache.equals(dir.getParentFile())||!dir.isDirectory())throw new IllegalArgumentException("产业专项目录缺失或越界");return dir;}catch(IOException e){throw new IllegalArgumentException("产业专项目录不可核对",e);}
  }
  File industryTopicDirectory(){File test=industryTopicTestDirectory();return test==null?new File(getFilesDir(),testing?"industry-topics-tests":"industry-topics-v1"):new File(test,"industry-topics-v1");}
  JSONArray industryTopicRows()throws Exception{if(android.os.Build.VERSION.SDK_INT<35)throw new Exception("完整本机来源需要当前Android SQLite只读保护；未降级读取");return new BusinessRestoreStore(getDatabasePath(businessStore.getDatabaseName())).capture().getJSONObject("payload").getJSONArray("records");}
  IndustryTopicRuntime ensureIndustryTopicRuntime()throws Exception{if(industryTopicRuntime==null){File dir=industryTopicDirectory();if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("产业私有执行目录不可创建");industryTopicRuntime=new IndustryTopicRuntime(new IndustryTopicStore(new File(dir,"state.json")),this::industryTopicRows);}return industryTopicRuntime;}
  void industryTopicActive(boolean value){if(industryTopicScreen!=null)industryTopicScreen.setActive(value&&foreground);}
  void openIndustryTopic(){try{if(android.os.Build.VERSION.SDK_INT<35)throw new Exception("当前Android不支持完整本机来源保护，此功能未运行");IndustryTopicRuntime runtime=ensureIndustryTopicRuntime();if(industryTopicScreen==null){industryTopicScreen=new IndustryTopicScreen(this,runtime.store,runtime,this::industryTopicRows,new File(industryTopicDirectory(),"draft.json"),()->openBusiness("research"));industryTopicScreen.exportRequested=(name,text)->{try{exportReviewFile(name,name.endsWith(".json")?"application/json":"text/plain",text.getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception e){reviewFileMessage(e.getMessage());}};}showPage("industryTopic","产业主题更新",industryTopicScreen);industryTopicActive(true);industryTopicScreen.setDarkTheme(dark);if(foreground)runtime.start();}catch(Exception e){reviewFileMessage(e.getMessage());}}

  PaperMonitorHostScreen paperMonitorHostScreen;
  File paperAutomationTestDirectory(){
    String name=testing?getIntent().getStringExtra("paperAutomationTest"):null;if(name==null)return null;
    if(!name.matches("f05-paper-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))throw new IllegalArgumentException("纸面专项目录无效");
    try{File base=getCacheDir().getCanonicalFile(),dir=new File(base,name).getCanonicalFile();if(!base.equals(dir.getParentFile())||!dir.isDirectory())throw new IllegalArgumentException("纸面专项目录缺失或越界");return dir;}catch(IOException e){throw new IllegalArgumentException("纸面专项目录不可核对",e);}
  }
  String paperMonitorNow(){
    if(paperAutomationTestDirectory()!=null){String cut=getIntent().getStringExtra("paperAutomationCut");if("2026-10-14T02:00:00Z".equals(cut)||"2026-10-14T02:01:20Z".equals(cut))return cut;}

    if(testing&&"2026-10-13T02:00:00Z".equals(getIntent().getStringExtra("paperMonitorFixtureCut")))return "2026-10-13T02:00:00Z";
    return java.time.Instant.ofEpochMilli(System.currentTimeMillis()).toString();
  }
  void paperMonitorActive(boolean value){if(paperMonitorHostScreen!=null)paperMonitorHostScreen.setActive(value);}
  void openPaperMonitor(){
    try{
      if(paperMonitorHostScreen==null){
        File testDir=paperAutomationTestDirectory();File privateDir=testDir==null?new File(getFilesDir(),testing?"paper-monitor-host-tests":"paper-monitor-host"):new File(testDir,"paper-host");
        File evidence=PaperMonitorNativeHost.evidenceDirectory(this);
        PaperMonitorFlow flow=new PaperMonitorFlow(new PaperMonitorFlow.Host(){
          public JSONObject read()throws Exception{
            JSONArray loaded=new JSONArray();for(JSONObject row:instruments)loaded.put(new JSONObject(row.toString()));
            return PaperMonitorNativeHost.readSnapshot(getDatabasePath(businessStore.getDatabaseName()),loaded,
              ()->paperMonitorNow(),()->isFinishing());
          }
          public String now(){return paperMonitorNow();}
        },privateDir,evidence);
        paperMonitorHostScreen=new PaperMonitorHostScreen(this,flow);paperMonitorHostScreen.setAutomationHost(new PaperMonitorHostScreen.AutomationHost(){public JSONObject preferences()throws Exception{return new AiSettingsStore(getDatabasePath(testing?"ai-settings-host-tests.sqlite":"ai-settings-v1.sqlite")).read().getJSONObject("preferences");}public void refresh(JSONArray ids)throws Exception{if(!testing&&feed!=null){feed.refreshQuotes();for(int i=0;i<ids.length();i++)feed.chart(ids.getString(i),"minute",true);}}});paperMonitorHostScreen.setTag("paperMonitorHostPage");
      }
      showPage("paperMonitor","人工纸面监控",paperMonitorHostScreen);paperMonitorHostScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("纸面监控已阻断："+e.getMessage());}
  }
  PortfolioMirrorScreen portfolioMirrorScreen;
  JSONObject portfolioMirrorInputs()throws Exception{
    JSONArray accounts=new JSONArray(),ledgers=new JSONArray(),roster=new JSONArray(),legacy=new JSONArray();JSONObject quotes=new JSONObject();
    for(JSONObject row:instruments){JSONObject exact=new JSONObject(row.toString());String id=row.getString("id");BusinessStore.require(id.matches("^(SH|SZ|BJ):(stock|etf|index):[0-9]{6}$"),"持仓镜像需要完整证券身份");
      if(!exact.has("code"))exact.put("code",id.split(":")[2]); // Exact full-ID projection, not market inference.
      roster.put(exact);quotes.put(id,row.opt("quote"));}
    JSONArray all=businessStore.read("accounts"),trades=businessStore.read("trades");
    for(int i=0;i<all.length();i++){
      JSONObject a=all.getJSONObject(i);if(!a.optString("type").equals("ledger"))continue;accounts.put(a);
      ledgers.put(new JSONObject().put("accountId",a.getString("id")).put("positions",BusinessStore.portfolio(trades,quotes,a.getString("id")).getJSONArray("positions"))
        .put("positionsComplete",true).put("asOf",a.isNull("ledgerAsOf")?"":a.optString("ledgerAsOf"))
        .put("basis","all-local-recorded-transactions").put("sourceLabel","完整本机已记录流水；不证明券商全部持仓")
        .put("cashBalance",a.opt("cashBalance") instanceof Number?a.opt("cashBalance"):JSONObject.NULL).put("cashAsOf",a.isNull("cashAsOf")?"":a.optString("cashAsOf")));
    }
    JSONArray reports=businessStore.read("reports");for(int i=0;i<reports.length();i++)if(reports.getJSONObject(i).optString("legacySource").equals("portfolio_snapshots"))legacy.put(reports.getJSONObject(i));
    return new JSONObject().put("accounts",accounts).put("ledgers",ledgers).put("instruments",roster).put("legacySnapshots",legacy)
      .put("capturedAt",java.time.Instant.now().toString()).put("sourceLabel",testing?"隔离测试账本与报价，不是真实券商数据":"本机账本 / 已载入行情 / 已迁旧快照；捕获时间不是账本时点，不联网刷新");
  }
  void openPortfolioMirror(){
    try{
      if(portfolioMirrorScreen==null){
        portfolioMirrorScreen=new PortfolioMirrorScreen(this,new PortfolioMirrorStore(this,testing?"portfolio-mirror-host-tests-v33b.sqlite":"portfolio-mirror-v1.sqlite"),this::portfolioMirrorInputs,this::openRiskInstrument);
        portfolioMirrorScreen.setTag("portfolioMirrorPage");portfolioMirrorScreen.importRequested=()->chooseReviewImport(457);
        portfolioMirrorScreen.exportRequested=text->{try{exportReviewFile("portfolio-mirror-evidence.json","application/json",text.getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception e){reviewFileMessage("镜像证据未导出："+e.getMessage());}};
      }
      showPage("portfolioMirror","持仓镜像 / 只读对账",portfolioMirrorScreen);portfolioMirrorScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("持仓镜像未打开；原账本保留："+e.getMessage());}
  }
  JSONObject migrationSnapshot()throws Exception{
    try(InputStream in=getAssets().open("migration-status.json")){
      JSONObject snapshot=MigrationStatusModel.validate(new JSONObject(new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)));
      snapshot.put("snapshotSource","随当前安装包冻结的审查表；不会联网更新，不代表全部迁移完成");return snapshot;
    }
  }
  String migrationTarget(String id,String route)throws Exception{
    if("null".equals(route))route="";
    boolean exact=false;JSONArray entries=migrationSnapshot().getJSONArray("entries");
    for(int n=0;n<entries.length();n++){JSONObject row=entries.getJSONObject(n);if(row.optString("id").equals(id)&&(row.isNull("route")?"":row.optString("route")).equals(route))exact=true;}
    if(!exact)return "";
    switch(id+"|"+route){
      case "D27|health":return "sources";case "P016|":case "A16|reader":return "library";
      case "A20|migration":return "migration";case "A28|ai-settings":case "P034|":case "P042|":return "ai";
      case "D01|dashboard":return "overview";case "D03|sectors":return "sectors";case "D06|watchlist":return "home";
      case "D07|portfolio":return "mirror";case "D08|recent":return "recent";case "D09|trades":case "D10|stats":return "account";
      case "D13|rotation":return "rotation";case "D15|capitalDaily":return "etf";case "D17|screener":return "candidate";
      case "D18|news":return "news";case "D19|aiResearch":return "runs";case "D22|aiHistory":return "handoff";
      case "D23|creatorTasks":return "collection";case "D24|compoundLab":return "scenario";
      case "D25|paperPortfolio":return "paper";case "D26|settings":case "A17|more":case "A18|settings":return "settings";default:return "";
    }
  }
  void openMigrationTarget(String id,String route)throws Exception{
    String target=migrationTarget(id,route);BusinessStore.require(!target.isEmpty(),"不在已接入口白名单；未按路径或名称猜测");
    switch(target){case "sources":openDataSourceStatus();break;case "library":openMaterialLibrary();break;case "mirror":openPortfolioMirror();break;case "migration":openMigrationStatus();break;case "ai":openAiSettings();break;case "overview":marketOverview();break;
      case "sectors":sectors();break;case "home":goHome();break;case "recent":recent();break;case "account":openBusiness("accounts");break;
      case "rotation":rotation();break;case "etf":etfDaily();break;case "candidate":localCandidates();break;case "news":openNews(false);break;
      case "runs":openResearchRuns();break;case "handoff":openSourceHandoff();break;case "collection":openBusiness("collection");break;
      case "scenario":scenarioTools();break;case "paper":openBusiness("paper");break;case "settings":openBusiness("settings");break;}
  }
  void openMigrationStatus(){
    try{
      if(migrationStatusScreen==null){
        migrationStatusScreen=new MigrationStatusScreen(this,this::migrationSnapshot,(id,route)->!migrationTarget(id,route).isEmpty(),this::openMigrationTarget,(id,ref)->{
          JSONArray entries=migrationSnapshot().getJSONArray("entries");for(int n=0;n<entries.length();n++){JSONObject row=entries.getJSONObject(n);
            if(row.optString("id").equals(id)&&MigrationStatusModel.references(row).contains(ref))return new JSONObject().put("source","安装包冻结审查表").put("available",false)
              .put("message","这里只携带引用和原始审查记录，未携带外部附件；不会按引用读取任意本机路径。").put("text",row.toString(2));}
          throw new IllegalArgumentException("证据身份或引用不在随包白名单");
        });
        migrationStatusScreen.setTag("migrationStatusPage");migrationStatusScreen.setFileActions(this::exportReviewFile);
      }
      showPage("migrationStatus","功能迁移总览",migrationStatusScreen);migrationStatusScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("迁移总览未打开："+e.getMessage());}
  }
  void openAiSettings(){
    try{
      if(aiSettingsScreen==null){
        aiSettingsScreen=new AiSettingsScreen(this,getDatabasePath(testing?"ai-settings-host-tests.sqlite":"ai-settings-v1.sqlite"),new AiSettingsScreen.Host(){
          public boolean supportsManualHandoff(){return true;}
          public void openManualHandoff(){if("aiSettings".equals(activePage))openSourceAnalysis();}
          public void configurationSaved(JSONObject ignored){reviewFileMessage("非敏感偏好已保存；未配置凭据，未授权或调用网络模型。");}
        });
        LinearLayout files=new LinearLayout(this);files.setTag("aiHostFiles");aiSettingsScreen.addView(files);
        add(files,"选择配置文件",()->chooseReviewImport(456));
        add(files,"导出安全配置",()->{try{exportReviewFile("ai-preferences.json","application/json",aiSettingsScreen.exportArchive());}catch(Exception e){reviewFileMessage("配置导出失败");}});
      }
      showPage("aiSettings","AI偏好 / 能力声明",aiSettingsScreen);aiSettingsScreen.setActive(true);aiSettingsScreen.setDarkTheme(dark);
      SourceHandoffPanel.styleTree(aiSettingsScreen.findViewWithTag("aiHostFiles"),dark);
    }catch(Exception e){reviewFileMessage("AI偏好未打开；本机数据保留。");}
  }
  private final List<JSONObject> instruments = new ArrayList<>(), visible = new ArrayList<>();
  private JSONObject instrument;
  private String group = "全部", period = "day", layout = "focus", watchMode = "quotes";
  private boolean detail = false, dark = false, manualLandscape = false;
  private SharedPreferences prefs;
  boolean testing;
  MarketFeed feed;
  CapitalScreen capitalScreen;
  RotationScreen rotationScreen;
  DarkStockScreen darkStockScreen;
  FuturesMonitorScreen futuresMonitorScreen;
  FuturesMonitorTransport futuresMonitorTransport;
  FuturesMonitorTransport.Opener futuresTestOpener;
  void futuresMonitorActive(boolean active){if(!active&&futuresMonitorScreen!=null)futuresMonitorScreen.cancel();}
  void openFuturesMonitor(){
    try{
      if(futuresMonitorScreen==null){
        final java.util.concurrent.atomic.AtomicReference<java.lang.ref.WeakReference<FuturesMonitorScreen>> target=new java.util.concurrent.atomic.AtomicReference<>(new java.lang.ref.WeakReference<>(null));
        final boolean fixtureWithoutTransport=testing&&futuresTestOpener==null;
        futuresMonitorTransport=futuresTestOpener==null?new FuturesMonitorTransport(this::runOnUiThread):new FuturesMonitorTransport(this::runOnUiThread,futuresTestOpener);
        final FuturesMonitorTransport client=futuresMonitorTransport;
        futuresMonitorScreen=new FuturesMonitorScreen(this,new File(getFilesDir(),testing?"futures-monitor-tests-v36.sqlite":"futures-monitor-v1.sqlite"),
          (token,symbols)->{if(fixtureWithoutTransport){FuturesMonitorScreen p=target.get().get();if(p!=null)p.deliver(token,new JSONArray(),"隔离模式未连接来源");return;}
            client.start(token,symbols,(t,rows,error)->{FuturesMonitorScreen p=target.get().get();if(p!=null)p.deliver(t,rows,error);});},client::cancel);
        target.set(new java.lang.ref.WeakReference<>(futuresMonitorScreen));
      }
      showPage("futuresMonitor","股指期货价量仓",futuresMonitorScreen);futuresMonitorScreen.setDarkTheme(dark);
    }catch(Exception ex){disposeFuturesMonitor();reviewFileMessage("期货页未打开："+ex.getMessage());}
  }
  void disposeFuturesMonitor(){if(futuresMonitorScreen!=null)futuresMonitorScreen.close();if(futuresMonitorTransport!=null)futuresMonitorTransport.close();futuresMonitorScreen=null;futuresMonitorTransport=null;}
  EtfMonitorScreen etfMonitorScreen;
  String etfRefreshToken="";
  JSONArray etfLoaded(){return new JSONArray(feed!=null?feed.instruments:instruments);}
  void etfMonitorActive(boolean on){if(!on)etfRefreshToken="";if(etfMonitorScreen!=null)etfMonitorScreen.setActive(on);}
  void openEtfMonitor(){
    try{
      if(etfMonitorScreen==null){
        File archive=new File(getFilesDir(),testing?"etf-monitor-tests-v35.json":"etf-monitor-v35.json");boolean existing=archive.exists();
        etfMonitorScreen=new EtfMonitorScreen(this,archive,new EtfMonitorScreen.Host(){
          public boolean supportsRefresh(){return feed!=null;}
          public boolean supportsExport(){return true;}
          public void exportEvidence(byte[] data)throws Exception{exportReviewFile("ETF盘中观测.json","application/json",data);}
          public void cancelRefresh(String token){if(token.equals(etfRefreshToken))etfRefreshToken="";}
          public void refresh(String token,JSONObject selection)throws Exception{refreshEtfMonitor(token,selection);}
          public void openChart(String id,String p)throws Exception{
            JSONObject target=EtfHostSnapshot.chart(etfLoaded(),id,p);boolean prior=sourceEvidenceNavigation;sourceEvidenceNavigation=true;
            try{for(JSONObject row:instruments)if(target.getString("id").equals(row.opt("id"))){if(!p.equals("quote"))samplingSeconds=0;openFromUser(row);if(!p.equals("quote"))period(p);return;}throw new IllegalArgumentException("证券不在当前宿主清单中");}finally{sourceEvidenceNavigation=prior;}
          }
        });
        Button held=new Button(this);held.setText("读取现有行情缓存 · 不联网");held.setTag("etfMonitorReadHeld");etfMonitorScreen.addView(held,0,new LinearLayout.LayoutParams(-1,dp(44)));
        held.setOnClickListener(v->{try{etfMonitorScreen.setSnapshot(EtfHostSnapshot.adapt(etfLoaded()).getJSONObject("snapshot"));}catch(Exception e){etfMonitorScreen.setHostError(e.getMessage());}});
        showPage("etfMonitor","ETF盘中观察",etfMonitorScreen);etfMonitorActive(true);
        if(!existing)etfMonitorScreen.setSnapshot(EtfHostSnapshot.adapt(etfLoaded()).getJSONObject("snapshot"));
      }
      showPage("etfMonitor","ETF盘中观察",etfMonitorScreen);etfMonitorActive(true);etfMonitorScreen.setRefreshAvailable(feed!=null);etfMonitorScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("ETF观察未打开，原缓存保留："+e.getMessage());}
  }
  void refreshEtfMonitor(String token,JSONObject selection)throws Exception{
    BusinessStore.require(feed!=null&&activePage.equals("etfMonitor")&&!isFinishing()&&!isDestroyed(),"行情源未连接或页面已离开");
    JSONObject original=new JSONObject(selection.toString()),plan=EtfHostSnapshot.request(etfLoaded(),original);
    etfRefreshToken=token;JSONArray ids=plan.getJSONArray("ids");String product=plan.getString("period");int[] remaining={ids.length()};Set<String> seen=new HashSet<>();
    for(int i=0;i<ids.length()&&etfRefreshToken.equals(token);i++){
      String id=ids.getString(i);
      feed.refreshEtf(id,product,token,receipt->{
        if(isFinishing()||isDestroyed()||etfMonitorScreen==null||!EtfHostSnapshot.accepts(etfRefreshToken,receipt.optString("token"),activePage.equals("etfMonitor")))return;
        try{
          BusinessStore.require(id.equals(receipt.optString("id"))&&product.equals(receipt.optString("period"))&&seen.add(id),"刷新回执身份不符");
          BusinessStore.require(receipt.optString("status").equals("success"),"本次ETF刷新未全部成功，原观测保留");
          BusinessStore.require(EtfMonitorModel.equal(EtfHostSnapshot.request(etfLoaded(),original),plan),"ETF清单已变化，请重新选择");
          if(--remaining[0]==0){JSONObject snapshot=EtfHostSnapshot.adapt(etfLoaded(),java.time.Instant.now().toString()).getJSONObject("snapshot");etfRefreshToken="";etfMonitorScreen.acceptSnapshot(token,snapshot);}
        }catch(Exception e){etfRefreshToken="";etfMonitorScreen.failRefresh(token,e.getMessage());}
      });
    }
  }

  EtfScreen etfScreen;
  RecentScreen recentScreen;
  LocalCandidateScreen candidateScreen;
  SectorWatchScreen sectorScreen;
  MarketOverviewScreen marketOverviewScreen;
  LinearLayout marketOverviewHost;
  void openOverviewBoard(String code,String taxonomy)throws Exception{
    JSONObject query=SectorWatchModel.query("eastmoney-public-board",taxonomy,code);
    sectors();JSONObject state=sectorScreen.saveState();state.put("provider","eastmoney-public-board").put("taxonomy",taxonomy).put("boardKey",SectorWatchModel.key(query)).put("boardFilter",code).put("memberId","");
    sectorScreen.restoreState(state);
  }
  void marketOverview(){
    try{
      if(marketOverviewScreen==null){
        marketOverviewHost=new LinearLayout(this);marketOverviewHost.setOrientation(LinearLayout.VERTICAL);
        LinearLayout files=new LinearLayout(this);
        add(files,"导入观测档案",()->chooseReviewImport(452));
        add(files,"导出完整档案",()->{try{exportReviewFile("市场全景观测.json","application/json",marketOverviewScreen.exportArchive());}catch(Exception e){marketOverviewScreen.setHostError(e.getMessage());}});
        marketOverviewScreen=new MarketOverviewScreen(this,!testing,getDatabasePath(testing?"market-overview-host-tests.sqlite":"market-overview-v1.sqlite"),this::openOverviewBoard);
        marketOverviewScreen.imports.addView(files,0);
        marketOverviewHost.addView(marketOverviewScreen,new LinearLayout.LayoutParams(-1,0,1));
      }
      showPage("marketOverview","市场全景 / 热度",marketOverviewHost);marketOverviewScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("市场全景未打开："+e.getMessage());}
  }
  IndustryDiscoveryScreen discoveryScreen;
  SectorResearchScreen sectorResearchScreen;
  JSONArray sectorResearchScopes()throws Exception{
    return sectorResearchScopesFromTopics(businessStore.read("topics"));
  }
  JSONArray sectorReportScopes()throws Exception{
    return sectorResearchScopesFromTopics(SectorReportReader.topics(getDatabasePath(businessStore.getDatabaseName())));
  }
  JSONArray sectorResearchScopesFromTopics(JSONArray topics)throws Exception{
    JSONArray scopes=new JSONArray();
    for(int i=0;i<topics.length();i++){
      JSONObject row=topics.getJSONObject(i);BusinessStore.require(!row.optString("id").isEmpty()&&!row.optString("name").isEmpty(),"本机产业主题身份不完整，未猜测替换");
      scopes.put(new JSONObject().put("kind","industry").put("id","business:topics:"+row.getString("id")).put("name",row.getString("name"))
        .put("source","本机产业主题原记录；不代表已核验成员或在线研究").put("asOf",row.opt("asOf")==null?JSONObject.NULL:row.get("asOf"))
        .put("cached",true).put("coverage","成员与月度热度未由主题名称推断").put("snapshot",new JSONObject(row.toString())));
    }
    JSONArray discovered=new IndustryDiscoveryStore(getDatabasePath(testing?"industry-discovery-host-tests.sqlite":"industry-discovery-v1.sqlite")).read(()->false).getJSONArray("topics");
    for(int i=0;i<discovered.length();i++){
      JSONObject row=discovered.getJSONObject(i);scopes.put(new JSONObject().put("kind","sector").put("id","discovery:"+row.getString("id")).put("name",row.getString("name"))
        .put("source",row.getString("provider")).put("asOf",row.get("sourceObservedAt")).put("cached",true)
        .put("coverage","仅经手工确认的目录线索；没有成分/月度观测，在线AI未执行").put("snapshot",new JSONObject(row.toString())));
    }
    return scopes;
  }
  void openSectorResearch(){
    try{
      if(sectorResearchScreen==null){
        sectorResearchScreen=new SectorResearchScreen(this,businessStore,getDatabasePath(testing?"sector-research-host-tests.sqlite":"sector-research-v1.sqlite"),this::sectorResearchScopes,this::evidenceInstruments,this::openHandoffSource,(action,expected)->{JSONObject row=new JSONObject(expected.toString()).put("instrumentId",expected.getString("id"));evidenceInstrumentAction(action,row);});
        sectorResearchScreen.setAiPreferences(()->new AiSettingsStore(getDatabasePath(testing?"ai-settings-host-tests.sqlite":"ai-settings-v1.sqlite")).read().getJSONObject("preferences"));
        sectorResearchScreen.setAiScopes(this::sectorReportScopes);
        sectorResearchScreen.setTag("sectorResearchPage");sectorResearchScreen.setFileActions(this::exportReviewFile,()->chooseReviewImport(455));
      }
      showPage("sectorResearch","板块 / 产业外部研究",sectorResearchScreen);sectorResearchScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("板块产业研究未打开："+e.getMessage());}
  }
  QuantResearchScreen quantResearchScreen;
  void openQuantResearch(){
    try{
      if(quantResearchScreen==null){
        quantResearchScreen=new QuantResearchScreen(this,new QuantResearchStore(this,testing?"quant-research-host-tests.json":"quant-research-v1.json"),this::personMethodVersions,this::openPersonMethodSource);
        quantResearchScreen.setTag("quantResearchPage");
        quantResearchScreen.importRequested=()->chooseReviewImport(454);
        quantResearchScreen.exportRequested=text->{try{exportReviewFile("量化研究完整档案.json","application/json",text.getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception e){reviewFileMessage(e.getMessage());}};
      }
      showPage("quantResearch","量化研究 / 历史模拟",quantResearchScreen);quantResearchScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("量化研究未打开："+e.getMessage());}
  }
  void industryDiscovery(){
    try{
      if(discoveryScreen==null){
        discoveryScreen=new IndustryDiscoveryScreen(this,!testing,getDatabasePath(testing?"industry-discovery-host-tests.sqlite":"industry-discovery-v1.sqlite"),new IndustryDiscoveryScreen.Host(){
          public boolean supportsMaterials(){return true;}
          public void openMaterials(JSONObject expected)throws Exception{
            BusinessStore.require(discoveryScreen.isShown(),"已离开发现页，未自动打开研究");
            JSONArray rows=new IndustryDiscoveryStore(getDatabasePath(testing?"industry-discovery-host-tests.sqlite":"industry-discovery-v1.sqlite")).read(()->false).getJSONArray("topics");boolean exact=false;
            for(int i=0;i<rows.length();i++)if(SectorWatchModel.equal(rows.getJSONObject(i),expected))exact=true;
            BusinessStore.require(exact,"候选完整版本已变化，请重读；未用同名主题替代");openSectorResearch();
            BusinessStore.require(sectorResearchScreen!=null&&sectorResearchScreen.selectScope("sector","discovery:"+expected.getString("id")),"完整主题不在本机清单，未保存或研究");
          }
          public void openBoard(String provider,String taxonomy,String code)throws Exception{
            BusinessStore.require(discoveryScreen.isShown(),"已离开发现页面，未切换板块");
            JSONObject query=SectorWatchModel.query(provider,taxonomy,code);sectors();JSONObject state=sectorScreen.saveState();
            state.put("provider",provider.startsWith("sina-public-")?"sina":provider).put("taxonomy",taxonomy).put("boardKey",SectorWatchModel.key(query)).put("boardFilter",code).put("filter","").put("memberId","");sectorScreen.restoreState(state);
          }
        });
        LinearLayout files=new LinearLayout(this);discoveryScreen.imports.addView(files,0);
        add(files,"导入发现档案",()->chooseReviewImport(453));
        add(files,"导出完整档案",()->{try{exportReviewFile("行业概念发现.json","application/json",discoveryScreen.exportArchive());}catch(Exception e){discoveryScreen.setHostError(e.getMessage());}});
      }
      showPage("industryDiscovery","行业概念发现",discoveryScreen);discoveryScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("发现入口未打开："+e.getMessage());}
  }
  // The B05 instrumentation owns a new cache directory, preserving all older databases.
  File observationRestoreTestDirectory(){
    String name=testing?getIntent().getStringExtra("observationRestoreV83"):null;if(name==null)return null;
    if((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0||!getIntent().getBooleanExtra("testFixtures",false)||!name.matches("observation-restore-v83-[A-Za-z0-9-]{1,64}"))throw new IllegalArgumentException("观察专项目录无效");
    try{File cache=getCacheDir().getCanonicalFile(),dir=new File(cache,name).getCanonicalFile();if(!cache.equals(dir.getParentFile())||!dir.isDirectory())throw new IllegalArgumentException("观察专项目录缺失或越界");return dir;}catch(IOException e){throw new IllegalArgumentException("观察专项目录不可核对",e);}
  }
  File sectorLeaderStoreFile(){File dir=observationRestoreTestDirectory();return dir==null?getDatabasePath(testing?"sector-leaders-tests.sqlite":"sector-leaders-v1.sqlite"):new File(dir,"leaders.sqlite");}
  SectorLeaderScreen leaderScreen;
  void sectorLeaders() {
    if (leaderScreen == null) {
      leaderScreen = new SectorLeaderScreen(this, !testing,
          sectorLeaderStoreFile(),
          new SectorLeaderScreen.Host() {
            public void backupRestore() throws Exception {if(leaderScreen==null||!unifiedBackupEntryActive("sectorLeaders",leaderScreen))return;openUnifiedBackup();unifiedBackupLeaderOrigin=true;}
            public JSONArray availableInstruments() throws Exception {
              JSONArray rows = new JSONArray();
              for (JSONObject row : instruments) if (!row.optBoolean("transient")) rows.put(new JSONObject(row.toString()));
              return rows;
            }
            public void observeInstrument(JSONObject row) throws Exception {
              JSONObject observed = observeRecent(row);
              leaderScreen.updateInstrument(observed);
              if (feed != null) {
                feed.refreshQuote(observed.getString("id"));
                feed.chart(observed.getString("id"), "minute", false);
              }
            }
            public void openInstrument(String id) throws Exception {
              for (JSONObject row : instruments) if (id.equals(row.optString("id"))) { openFromUser(row); return; }
              throw new IllegalArgumentException("证券未进入临时观察；请重新选择身份明确的候选");
            }
            public void addWatchlist(JSONObject row) throws Exception {
              JSONObject item = recentIdentity(row); boolean exists = false;
              for (JSONObject current : instruments)
                if (item.getString("id").equals(current.optString("id")) && !current.optBoolean("transient")) exists = true;
              if (!exists) {
                if (feed != null) feed.add(item);
                else { JSONObject current = observeRecent(row); current.remove("transient"); current.put("group", "默认分组"); }
              }
              prefs.edit().putBoolean("watch/" + item.getString("id"), true).apply();
              makeGroups(); filter();
            }
          });
      LinearLayout imports = (LinearLayout) ((View) leaderScreen.findViewWithTag("leaderExportConfig").getParent()).getParent();
      LinearLayout files = new LinearLayout(this); imports.addView(files, 0);
      add(files, "选择配置文件", () -> chooseReviewImport(444));
      add(files, "保存配置", () -> exportLeaderFile(false));
      add(files, "保存CSV", () -> exportLeaderFile(true));
    }
    showPage("sectorLeaders", "人工龙头", leaderScreen);
    leaderScreen.setDarkTheme(dark);
  }
  void exportLeaderFile(boolean csv) {
    try { exportReviewFile(csv ? "人工龙头快照.csv" : "人工龙头配置.json", csv ? "text/csv" : "application/json",
        csv ? leaderScreen.exportCsv() : leaderScreen.exportConfig()); }
    catch (Exception e) { reviewFileMessage(e.getMessage()); }
  }
  void sectors() {
    if (sectorScreen == null) sectorScreen = new SectorWatchScreen(this, !testing,
        new File(getFilesDir(), testing ? "sector-watch-tests.sqlite" : "sector-watch-v1.sqlite"),
        new SectorWatchScreen.Host() {
          public void observeInstrument(JSONObject row) throws Exception {
            JSONObject observed = observeRecent(row);
            sectorScreen.updateInstrument(observed);
            if (feed != null) {
              feed.refreshQuote(observed.getString("id"));
              feed.chart(observed.getString("id"), "minute", false);
            }
          }
          public void openInstrument(String id) throws Exception {
            for (JSONObject item : instruments) if (id.equals(item.optString("id"))) {
              openFromUser(item);
              return;
            }
            throw new IllegalArgumentException("该证券尚未进入临时观察，请先选择成分股");
          }
          public void addWatchlist(JSONObject row) throws Exception {
            JSONObject item = recentIdentity(row);
            boolean member = false;
            for (JSONObject s : instruments)
              if (s.optString("id").equals(item.getString("id")) && !s.optBoolean("transient")) member = true;
            if (!member) {
              if (feed != null) feed.add(item);
              else {
                JSONObject observed = observeRecent(row);
                observed.remove("transient");
                observed.put("group", "默认分组");
              }
            }
            prefs.edit().putBoolean("watch/" + item.getString("id"), true).apply();
            makeGroups(); filter();
          }
        });
    showPage("sectors", "板块观察", sectorScreen);
    sectorScreen.setDarkTheme(dark);
  }
  void marketHome() {
    View page = businessPages.get("marketHome");
    if (page == null) {
      ScrollView scroll = new ScrollView(this);
      LinearLayout body = new LinearLayout(this);
      body.setOrientation(LinearLayout.VERTICAL);
      body.setPadding(dp(8), dp(4), dp(8), dp(8));
      scroll.addView(body, new ScrollView.LayoutParams(-1, -2));
      TextView heading = new TextView(this);
      heading.setText("行情与资金"); heading.setTextSize(17);
      heading.setPadding(dp(6), dp(8), dp(6), dp(8)); body.addView(heading);
      String[] labels = {"市场全景 / 热度", "板块观察", "人工龙头", "本地候选", "行情详情", "资金历史", "集合竞价过程", "个股明暗盘", "明暗盘 / 轮动", "ETF盘中观察", "股指期货价量仓", "股指期货指定日披露", "ETF申赎日报", "市场资讯"};
      Runnable[] actions = {this::marketOverview, this::sectors, this::sectorLeaders, this::localCandidates, () -> openFromUser(instrument), this::funds,
          this::auctionView, this::darkStocks, this::rotation, this::openEtfMonitor, this::openFuturesMonitor, this::openCffexDisclosure, this::etfDaily, () -> openNews(false)};
      for (int i = 0; i < labels.length; i += 2) {
        LinearLayout row = new LinearLayout(this);
        body.addView(row, new LinearLayout.LayoutParams(-1, -2));
        for (int n = i; n < Math.min(i + 2, labels.length); n++) {
          Button button = add(row, labels[n], actions[n]);
          button.setLayoutParams(new LinearLayout.LayoutParams(0, dp(52), 1));
        }
      }
      TextView note = new TextView(this);
      note.setText("板块与资金分别显示来源时点。查看成分不自动加入自选；本地候选仅使用已有数据。");
      note.setTextSize(12); note.setPadding(dp(6), dp(8), dp(6), dp(8)); body.addView(note);
      page = scroll;
    }
    showPage("marketHome", "市场", page);
  }
  void localCandidates() {
    if (candidateScreen == null) candidateScreen = new LocalCandidateScreen(this,
        new LocalCandidateStore(candidateStoreFile()),
        new LocalCandidateScreen.Host() {
          public HostCandidateBackground background(){return new HostCandidateBackground(getDatabasePath(businessStore.getDatabaseName()),recentStoreFile(),getDatabasePath(testing?"sector-leaders-tests.sqlite":"sector-leaders-v1.sqlite"),candidateBackgroundStoreFile());}
          public JSONArray existingData() throws Exception {
            JSONArray rows = new JSONArray();
            for (JSONObject item : instruments) if (!item.optBoolean("transient"))
              rows.put(new JSONObject().put("id",item.optString("id")).put("name",item.optString("name"))
                  .put("group",item.optString("group")).put("symbol",item.optString("symbol")));
            return rows;
          }
          public JSONArray snapshot(Set<String> ids) throws Exception {
            MarketData.require(ids.size() > 0 && ids.size() <= 50,"请选择1至50只股票");
            JSONArray rows = new JSONArray();
            for (JSONObject item : instruments) if (ids.contains(item.optString("id")) && !item.optBoolean("transient")) {
              JSONObject copy = new JSONObject();
              for (String key : new String[]{"id","symbol","name","group","quote","dayMeta"})
                if (item.has(key)) copy.put(key,item.get(key));
              JSONArray day=item.optJSONArray("day"), kept=new JSONArray();
              if (day!=null) for(int i=Math.max(0,day.length()-81);i<day.length();i++) kept.put(day.get(i));
              copy.put("day",kept);
              rows.put(new JSONObject(copy.toString()));
            }
            MarketData.require(rows.length()==ids.size(),"所选自选范围已变化，请重新选择");
            return rows;
          }
          public void openInstrument(String id) { openBusinessInstrument(id); }
          public void requestExport(byte[] csv) {
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("text/csv");intent.putExtra(Intent.EXTRA_TITLE,"本地候选.csv");
            startActivityForResult(intent,432);
          }
        });
    showPage("candidates","本地候选",candidateScreen);
  }
  // Explicit debug-only namespace for the focused candidate backup instrumentation.
  File candidateRestoreTestDirectory(){
    String name=testing?getIntent().getStringExtra("candidateRestoreV81"):null;if(name==null)return null;
    if((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0||!getIntent().getBooleanExtra("testFixtures",false)||!name.matches("candidate-restore-v81-[A-Za-z0-9-]{1,64}"))throw new IllegalArgumentException("候选专项目录无效");
    try{File cache=getCacheDir().getCanonicalFile(),dir=new File(cache,name).getCanonicalFile();if(!cache.equals(dir.getParentFile())||!dir.isDirectory())throw new IllegalArgumentException("候选专项目录缺失或越界");return dir;}catch(IOException e){throw new IllegalArgumentException("候选专项目录不可核对",e);}
  }
  File candidateStoreFile(){File dir=candidateRestoreTestDirectory();return dir==null?getDatabasePath(testing?"candidate-tests.sqlite":"local-candidates-v1.sqlite"):new File(dir,"candidates.sqlite");}
  File candidateBackgroundStoreFile(){File dir=candidateRestoreTestDirectory();return dir==null?getDatabasePath(testing?"candidate-background-tests.sqlite":"local-candidate-background-v2.sqlite"):new File(dir,"background.sqlite");}
  File candidateBackupReceiptDirectory(){File observation=observationRestoreTestDirectory();if(observation!=null)return new File(observation,"receipts");File dir=candidateRestoreTestDirectory();return dir==null?recentBackupReceiptDirectory():new File(dir,"receipts");}
  String recentQuoteSnapshot = "";
  // A focused instrumentation namespace keeps the B02 device checks off existing recent files.
  File recentRestoreTestDirectory(){
    String name=testing?getIntent().getStringExtra("recentRestoreV68"):null;if(name==null)return null;
    if(!name.matches("recent-restore-v68-[A-Za-z0-9-]{1,64}"))throw new IllegalArgumentException("专项最近库目录无效");
    try{File cache=getCacheDir().getCanonicalFile(),dir=new File(cache,name).getCanonicalFile();if(!cache.equals(dir.getParentFile())||!dir.isDirectory())throw new IllegalArgumentException("专项最近库目录缺失或越界");return dir;}catch(IOException e){throw new IllegalArgumentException("专项最近库目录不可核对",e);}
  }
  File recentStoreFile(){File dir=recentRestoreTestDirectory();return dir==null?getDatabasePath(testing?"recent-tests.sqlite":"recent-v1.sqlite"):new File(dir,"recent.sqlite");}
  File businessRestoreTestDirectory(){
    String name=testing?getIntent().getStringExtra("businessRestoreV85"):null;if(name==null)return null;
    if(!name.matches("business-restore-v85-[A-Za-z0-9-]{1,64}"))throw new IllegalArgumentException("专项业务库目录无效");
    try{File cache=getCacheDir().getCanonicalFile(),dir=new File(cache,name).getCanonicalFile();if(!cache.equals(dir.getParentFile())||!dir.isDirectory())throw new IllegalArgumentException("专项业务库目录缺失或越界");return dir;}catch(IOException e){throw new IllegalArgumentException("专项业务库目录不可核对",e);}
  }
  File recentBackupReceiptDirectory(){File dir=recentRestoreTestDirectory();if(dir==null)dir=businessRestoreTestDirectory();return dir==null?new File(getFilesDir(),testing?"unified-backup-receipts-tests":"unified-backup-receipts"):new File(dir,"receipts");}
  RecentScreen ensureRecent() {
    if (recentScreen == null) {recentScreen = new RecentScreen(this,
        new RecentStore(recentStoreFile()), new RecentScreen.Actions() {
          public void open(JSONObject row, boolean analysis) throws Exception {
            JSONObject item = observeRecent(row);
            openFromUser(item);
            if (analysis) explain();
          }
          public void add(JSONObject row) throws Exception {
            JSONObject item = recentIdentity(row);
            boolean member = false;
            for (JSONObject s : instruments) if (s.optString("id").equals(item.getString("id")) && !s.optBoolean("transient")) member = true;
            if (!member) {
              if (feed != null) feed.add(item);
              else { JSONObject existing = observeRecent(row); existing.remove("transient"); existing.put("group", "默认分组"); }
            }
            prefs.edit().putBoolean("watch/" + item.getString("id"), true).apply();
            makeGroups(); filter(); recentScreen.state.setText("已加入本机自选；没有改变查看次数");
          }
          public void ledger(JSONObject row) throws Exception {
            JSONObject item = observeRecent(row);
            openBusiness("accounts");
            BusinessScreen page = (BusinessScreen) businessPages.get("business:accounts");
            try { page.prepareNewTrade(new JSONObject(item.toString()).put("quote", currentQuote(item))); }
            catch (Exception error) { page.state.setText("未预填，原草稿保留：" + error.getMessage()); }
          }
          public void refreshQuotes(JSONArray rows) throws Exception {
            if (feed == null) { recentScreen.state.setText("设计模拟环境不联网；没有生成新报价"); return; }
            List<JSONObject> items = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) items.add(recentIdentity(rows.getJSONObject(i)));
            feed.observeAll(items); feed.refreshQuotes();
            recentScreen.state.setText("正在读取公开报价；以来源时间为准，未加入自选");
          }
          public void chooseImport() { recentFile(false); }
          public void chooseExport() { recentFile(true); }
        });
      final RecentScreen page=recentScreen;page.setBackupAction(()->{if(!foreground||isFinishing()||isDestroyed()||!"recent".equals(activePage)||recentScreen!=page||!page.isShown())return;openUnifiedBackup();});
    }
    return recentScreen;
  }
  void recent() { RecentScreen page = ensureRecent(); showPage("recent", "最近查看", page); page.load("本机最近查看；报价以记录来源时间为准"); }
  JSONObject recentIdentity(JSONObject row) throws Exception {
    String id = row.optString("id");
    MarketData.require(id.matches("(SH|SZ|BJ):(stock|index|etf):[0-9]{6}") && row.optBoolean("canOpen", true), "证券身份不明确，不能打开行情");
    String[] fields = id.split(":");
    return new JSONObject().put("id", id).put("symbol", fields[0].toLowerCase(Locale.ROOT) + fields[2])
        .put("name", row.getString("name")).put("group", "默认分组").put("order", 0);
  }
  JSONObject observeRecent(JSONObject row) throws Exception {
    JSONObject item = recentIdentity(row);
    for (JSONObject existing : instruments) if (existing.optString("id").equals(item.getString("id"))) return existing;
    if (feed != null) { feed.observe(item); instruments.clear(); instruments.addAll(feed.instruments); }
    else {
      item = MarketData.roster(new JSONObject().put("schema", "native-watchlist/v1").put("instruments", new JSONArray().put(item))).get(0);
      item.put("transient", true); instruments.add(item);
    }
    for (JSONObject existing : instruments) if (existing.optString("id").equals(item.getString("id"))) return existing;
    throw new IllegalArgumentException("该证券未能加入临时观察");
  }
  JSONObject recentRecord(JSONObject item) throws Exception {
    return recentIdentity(item).put("quote", currentQuote(item));
  }
  void recordRecent() {
    try { ensureRecent().recordView(recentRecord(instrument), java.time.Instant.now()); }
    catch (Exception e) { Toast.makeText(this, "最近查看未保存：" + e.getMessage(), Toast.LENGTH_SHORT).show(); }
  }
  void openFromUser(JSONObject item) {
    if(rotationScreen!=null)rotationScreen.revokeDocumentTicket();
    unifiedBackupPickerOwner=null;
    if(unifiedBackupScreen!=null)unifiedBackupScreen.setActive(false);
    unifiedBackupPickerOwner=null;
    if(unifiedBackupScreen!=null)unifiedBackupScreen.setActive(false);
    etfMonitorActive(false);futuresMonitorActive(false);cffexActive(false);accountEditActive(false);archiveVideoActive(false);
    if (leaderScreen != null) leaderScreen.setActive(false);
    if (candidateScreen != null) candidateScreen.visibleChanged(false);
    if (sectorScreen != null) sectorScreen.setActive(false);
    if (marketOverviewScreen != null) marketOverviewScreen.setActive(false);
    if (discoveryScreen != null) discoveryScreen.setActive(false);
    if (sourceScreen != null) sourceScreen.leave();
    activePage = ""; findViewById(R.id.businessHost).setVisibility(View.GONE); findViewById(R.id.pageSwitch).setVisibility(View.GONE);
    open(item, true); recordRecent();
  }
  void explainFromUser() { explain(); recordRecent(); }
  void recentFile(boolean exporting) {
    Intent intent = new Intent(exporting ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType(exporting ? "text/csv" : "application/json");
    if (exporting) intent.putExtra(Intent.EXTRA_TITLE, "最近查看.csv");
    startActivityForResult(intent, exporting ? 431 : 430);
  }
  void etfDaily(){if(etfScreen==null)etfScreen=new EtfScreen(this);showPage("etfDaily","ETF申赎日报",etfScreen);}
int creatorAiPickerNext=63000;
static final class CreatorAiPicker {
  final CreatorAiPanel owner;final long ticket;
  boolean returned,reading;android.net.Uri uri;byte[] bytes;String error;
  CreatorAiPicker(CreatorAiPanel owner,long ticket){this.owner=owner;this.ticket=ticket;}
}
final android.util.SparseArray<CreatorAiPicker> creatorAiPickers=new android.util.SparseArray<>();
CreatorPanel creatorPanel(){
  View value=businessPages.get("business:creator");
  return value instanceof BusinessScreen?((BusinessScreen)value).creator:null;
}
void configureCreatorAi(BusinessScreen expected){
  final CreatorPanel panel=expected.creator;
  if(panel==null)return;
  panel.configureAi(()->businessPages.get("business:creator")==expected&&expected.creator==panel
      &&unifiedBackupEntryActive("business:creator",expected),
    (row,candidate,cancelled)->businessStore.saveCreatorAiAnalysis(row,candidate,cancelled),
    this::launchCreatorAiPicker);
}
void launchCreatorAiPicker(CreatorAiPanel owner,long ticket)throws Exception{
  CreatorPanel panel=creatorPanel();
  BusinessStore.require(panel!=null&&panel.ai==owner&&owner.active()&&owner.ownsTicket(ticket),"原作者分析内页已离开");
  BusinessStore.require(creatorAiPickerNext<64000,"本次文件选择次数已达上限");
  int request=creatorAiPickerNext++;creatorAiPickers.put(request,new CreatorAiPicker(owner,ticket));
  try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),request);}
  catch(RuntimeException e){creatorAiPickers.remove(request);owner.importTicket=0;throw e;}
}
boolean creatorAiFileResult(int request,int result,Intent data){
  if(request<63000||request>=64000)return false;
  CreatorAiPicker pending=creatorAiPickers.get(request);
  if(pending!=null&&!pending.returned){pending.returned=true;pending.uri=result==RESULT_OK&&data!=null?data.getData():null;drainCreatorAiDocuments();}
  return true;
}
void drainCreatorAiDocuments(){
  if(!foreground)return;
  for(int i=creatorAiPickers.size()-1;i>=0;i--){
    int request=creatorAiPickers.keyAt(i);CreatorAiPicker pending=creatorAiPickers.valueAt(i);
    CreatorPanel panel=creatorPanel();
    if(panel==null||panel.ai!=pending.owner||!pending.owner.ownsTicket(pending.ticket)){creatorAiPickers.removeAt(i);continue;}
    if(!pending.returned||!pending.owner.active())continue;
    if(pending.bytes!=null||pending.error!=null||pending.uri==null){
      creatorAiPickers.removeAt(i);
      if(pending.bytes!=null)pending.owner.acceptFile(pending.ticket,pending.bytes);
      else pending.owner.fileFailure(pending.ticket,pending.error==null?"文件选择已取消；未保存":pending.error);
      continue;
    }
    if(pending.reading)continue;pending.reading=true;
    pending.owner.worker.execute(()->{
      byte[] bytes=null;String error=null;
      try(java.io.InputStream in=getContentResolver().openInputStream(pending.uri)){
        if(in==null)throw new java.io.IOException("无法读取返回文件");
        bytes=CreatorAiPanel.readBounded(in);
      }catch(Exception e){error="未导入："+CreatorAiPanel.message(e);}
      final byte[] result=bytes;final String failure=error;
      runOnUiThread(()->{if(creatorAiPickers.get(request)!=pending)return;pending.bytes=result;pending.error=failure;drainCreatorAiDocuments();});
    });
  }
}
void creatorAiNavigateAway(){
  CreatorPanel panel=creatorPanel();
  if(panel!=null&&panel.ai.open)panel.ai.invalidate("已切换页面；请重新校验",true);
  creatorAiPickers.clear();
}
void creatorAiPause(){CreatorPanel panel=creatorPanel();if(panel!=null&&panel.ai.open)panel.ai.pause();}
void creatorAiClose(){
  creatorAiPickers.clear();CreatorPanel panel=creatorPanel();if(panel!=null)panel.ai.close();
}
  int rotationPickerNext=62000;
  static final class RotationPicker{
    final RotationScreen owner;boolean returned;android.net.Uri uri;
    RotationPicker(RotationScreen owner){this.owner=owner;}
  }
  final android.util.SparseArray<RotationPicker> rotationPickers=new android.util.SparseArray<>();
  void rotationDocumentPicker(RotationScreen expected,int action,Intent intent){
    BusinessStore.require(expected==rotationScreen&&unifiedBackupEntryActive("rotation",expected),"原轮动页面已离开或被替换");
    BusinessStore.require((action==406||action==407)&&expected.pendingDocumentTicket<0,"文件选择尚未返回");
    BusinessStore.require(rotationPickerNext<63000,"本次页面文件选择次数已达上限，请重新打开任务");
    int ticket=rotationPickerNext++;expected.pendingDocumentTicket=ticket;expected.pendingDocumentAction=action;
    rotationPickers.put(ticket,new RotationPicker(expected));
    try{startActivityForResult(intent,ticket);}catch(RuntimeException error){rotationPickers.remove(ticket);expected.revokeDocumentTicket();throw error;}
  }
  boolean rotationDocumentResult(int ticket,int result,Intent data){
    if(ticket<62000||ticket>=63000)return false;
    RotationPicker pending=rotationPickers.get(ticket);
    if(pending!=null&&!pending.returned){pending.returned=true;pending.uri=result==RESULT_OK&&data!=null?data.getData():null;drainRotationDocuments();}
    return true;
  }
  void drainRotationDocuments(){
    if(!foreground)return;
    for(int i=rotationPickers.size()-1;i>=0;i--){
      int ticket=rotationPickers.keyAt(i);RotationPicker pending=rotationPickers.valueAt(i);if(!pending.returned)continue;
      boolean current=pending.owner==rotationScreen&&"rotation".equals(activePage)&&businessPages.get("rotation")==pending.owner&&!isFinishing()&&!isDestroyed();
      if(current&&(!pending.owner.isAttachedToWindow()||!pending.owner.isShown()))continue;
      rotationPickers.removeAt(i);pending.owner.document(ticket,pending.uri);
    }
  }
  @Override public void onWindowFocusChanged(boolean hasFocus){
    super.onWindowFocusChanged(hasFocus);
    if(hasFocus&&chartFullscreen!=null)chartFullscreen.apply();
    if(hasFocus)getWindow().getDecorView().post(this::drainCreatorAiDocuments);
    if(hasFocus)getWindow().getDecorView().post(this::drainRotationDocuments);
    if(hasFocus){researchWorkbenchActive("researchWorkbench".equals(activePage));getWindow().getDecorView().post(this::drainResearchWorkbenchDocuments);}
  }
  void rotationActive(boolean requested){
    final RotationScreen expected=rotationScreen;
    if(expected==null)return;
    if(!requested){expected.setActive(false);return;}
    expected.post(()->{if(rotationScreen==expected)expected.setActive(unifiedBackupEntryActive("rotation",expected));});
  }
  void rotation(){if(rotationScreen==null)rotationScreen=new RotationScreen(this);showPage("rotation","明暗盘 / 轮动",rotationScreen);}
  void darkStocks(){if(darkStockScreen==null)darkStockScreen=new DarkStockScreen(this);showPage("darkStocks","个股明暗盘",darkStockScreen);}
  String capitalImportId = "";
  AuctionScreen auctionScreen;
  BusinessStore businessStore;
  SourceScreen sourceScreen;
  ScenarioToolsScreen scenarioScreen;
  SourceAnalysisPanel analysisScreen;
  SourceHandoffPanel handoffScreen;
  ResearchRunsScreen researchRunsScreen;
  StockResearchScreen stockResearchScreen;
  StockResearchStore stockResearchStore;
  CommentWorkshopScreen commentWorkshopScreen;
  PersonMethodScreen personMethodScreen;
  PersonMethodStore personMethodStore;
  EvidenceReviewScreen evidenceReviewScreen;
  RiskSettingsScreen riskSettingsScreen;
  RiskSettingsStore riskSettingsStore;
  DataSafetyScreen dataSafetyScreen;
  JSONArray dataSafetyInventory() throws Exception {
    JSONArray rows=new JSONArray();
    rows.put(safetyLocation("business","账户 / 研究 / 采集七类业务",getDatabasePath(testing?"native-business-tests.sqlite":"native-business-v1.sqlite"),"sqlite",new JSONArray().put("records"),true));
    rows.put(safetyLocation("market","行情与自选快照 / K线缓存",new File(getFilesDir(),testing?"live-tests/market-v1.sqlite":"live/market-v1.sqlite"),"sqlite",new JSONArray().put("snapshots").put("bars").put("series"),false));
    rows.put(safetyLocation("risk","本机风险阈值",new File(getFilesDir(),testing?"risk-settings-host-tests.json":"risk-settings-v1.json"),"file",new JSONArray(),false));
    rows.put(safetyLocation("leaders","人工龙头独立库",getDatabasePath(testing?"sector-leaders-tests.sqlite":"sector-leaders-v1.sqlite"),"sqlite",new JSONArray(),false));
    return rows;
  }
  private JSONObject safetyLocation(String id,String label,File file,String format,JSONArray tables,boolean backedUp)throws Exception {
    return new JSONObject().put("id",id).put("role",id).put("label",label).put("path",file.getAbsolutePath()).put("format",format).put("tables",tables).put("backupIncluded",backedUp)
        .put("source","原生宿主明确位置；仅检查文件与安全表计数，不扫描目录、不读取记录正文；文件时间不是行情时间");
  }
  void verifySafetyPlan(JSONObject plan)throws Exception {
    BusinessStore.require(plan.optString("schema").equals("data-safety-plan-v1")&&plan.optBoolean("eligible")&&!plan.optBoolean("automaticApply"),"恢复计划尚不可交接");
    BusinessStore.require(plan.optString("baselineHash").equals(DataSafetyModel.baselineHash(businessStore.backup())),"业务数据已变化，请重新核验；未合并");
    BusinessStore.require(plan.optString("policyHash").equals(DataSafetyModel.fingerprint(dataSafetyScreen.store.settings())),"安全设置已变化，请重新核验；未合并");
  }
  void openDataSafety(){
    try{
      if(dataSafetyScreen==null){
        dataSafetyScreen=new DataSafetyScreen(this,businessStore,getDatabasePath(testing?"data-safety-tests.sqlite":"data-safety-v1.sqlite"),this::dataSafetyInventory,plan->{
          BusinessStore.require(!isFinishing()&&!isDestroyed()&&activePage.equals("dataSafety"),"已离开数据安全页面，未自动切换或恢复；重新进入后可再次交接");
          verifySafetyPlan(plan);JSONObject incoming=new JSONObject(plan.getJSONObject("incoming").toString()).put("mergePolicy","keep-existing");
          stageBusinessPreview(incoming,()->verifySafetyPlan(plan));
        });
        dataSafetyScreen.setTag("dataSafetyPage");
        dataSafetyScreen.setFileActions(this::exportReviewFile,()->chooseReviewImport(451));
      }
      showPage("dataSafety","数据位置 / 安全核验",dataSafetyScreen);dataSafetyScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("数据安全未打开："+e.getMessage());}
  }
  JSONObject riskInputs() throws Exception {
    JSONArray quotes=new JSONArray(),watch=new JSONArray();
    for(JSONObject original:instruments){
      JSONObject row=new JSONObject(original.toString());
      if(row.optJSONObject("quote")==null)row.put("quote",new JSONObject());
      quotes.put(row);
      if(!row.optBoolean("transient")&&prefs.getBoolean("watch/"+row.getString("id"),true))watch.put(row);
    }
    JSONObject leaders=new SectorLeaderStore(getDatabasePath(testing?"sector-leaders-tests.sqlite":"sector-leaders-v1.sqlite")).read(null);
    return new JSONObject().put("accounts",businessStore.read("accounts")).put("trades",businessStore.read("trades"))
        .put("quoteInstruments",quotes).put("watchlistInstruments",watch).put("leaderConfig",leaders)
        .put("capturedAt",java.time.Instant.now().toString())
        .put("sourceLabel",testing?"隔离测试数据，非实时行情":"本机账本 / 已载入行情 / 实际自选 / 人工龙头；只读当前缓存，不自动刷新");
  }
  void openRiskInstrument(JSONObject expected) throws Exception {
    JSONObject current=null;int count=0;
    for(JSONObject row:instruments)if(row.optString("id").equals(expected.optString("id"))){current=row;count++;}
    BusinessStore.require(count==1&&current!=null&&current.optString("name").equals(expected.optString("name")),"完整证券身份或名称已变化；未打开其他证券");
    openBusinessInstrument(current.getString("id"));
  }
  void openRiskSettings() {
    try{
      if(riskSettingsScreen==null){
        riskSettingsStore=new RiskSettingsStore(this,testing?"risk-settings-host-tests.json":"risk-settings-v1.json");
        riskSettingsScreen=new RiskSettingsScreen(this,riskSettingsStore,this::riskInputs,this::openRiskInstrument,
            ()->Toast.makeText(this,"风险阈值已保存并重算；未修改持仓或下单",Toast.LENGTH_SHORT).show());
        riskSettingsScreen.importRequested=()->chooseReviewImport(450);
        riskSettingsScreen.exportRequested=text->{try{exportReviewFile("风险阈值.json","application/json",text.getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception e){reviewFileMessage(e.getMessage());}};
      }
      showPage("riskSettings","风险阈值 / 本地提醒",riskSettingsScreen);riskSettingsScreen.setDarkTheme(dark);
    }catch(Exception e){reviewFileMessage("风险设置未打开："+e.getMessage());}
  }
  NewsScreen newsScreen;
  LinearLayout newsHost;
  void openNews(boolean selectCurrent) {
    try {
      if (newsScreen == null) {
        newsScreen = new NewsScreen(this, !testing,
            getDatabasePath(testing ? "news-public-host-tests.sqlite" : "news-public-v1.sqlite"),
            url -> {
              String target = NewsModel.url(url, false);
              if (testing) throw new IllegalStateException("隔离检查不打开外部网站");
              startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(target)));
            });
        newsHost = new LinearLayout(this);newsHost.setOrientation(LinearLayout.VERTICAL);
        LinearLayout files = new LinearLayout(this);
        newsHost.addView(files, new LinearLayout.LayoutParams(-1, dp(48)));
        newsHost.addView(newsScreen, new LinearLayout.LayoutParams(-1, 0, 1));
        add(files, "导入档案文件", () -> chooseReviewImport(447)).setTag("hostNewsImport");
        add(files, "另存档案文件", () -> {
          try { exportReviewFile("资讯档案.json", "application/json", newsScreen.exportArchive()); }
          catch (Exception e) { newsScreen.setHostError("未导出：" + e.getMessage()); }
        }).setTag("hostNewsExport");
      }
      if (selectCurrent && instrument != null) newsScreen.setInstrument(new JSONObject(instrument.toString()));
      showPage("news", "市场资讯", newsHost);
      newsScreen.setDarkTheme(dark);
      styleNewsFileActions();
    } catch (Exception e) { reviewFileMessage("资讯页面未打开：" + e.getMessage()); }
  }
  void styleNewsFileActions() {
    if (newsHost == null) return;
    for (String tag : new String[]{"hostNewsImport", "hostNewsExport"}) {
      TextView action = newsHost.findViewWithTag(tag);
      if (action != null) action.setTextColor(dark ? Color.rgb(217, 229, 245) : ink);
    }
  }
  java.io.File companyProfileNamespaceV86() throws Exception {
    String name=testing?getIntent().getStringExtra("companyProfileV86"):null;if(name==null)return null;
    BusinessStore.require(getIntent().getBooleanExtra("testFixtures",false)&&(getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0,"公司资料隔离路径仅限可调试检查");
    BusinessStore.require(name.matches("company-profile-v86-[A-Za-z0-9-]{1,64}"),"公司资料隔离名称无效");
    java.io.File root=getCacheDir().getCanonicalFile(),folder=new java.io.File(root,name).getCanonicalFile();BusinessStore.require(folder.getParentFile().equals(root)&&folder.isDirectory(),"公司资料隔离路径缺失或越界");return folder;
  }
  String companyProfileResearchName() throws Exception {java.io.File folder=companyProfileNamespaceV86();return folder==null?(testing?"stock-research-host-tests.sqlite":"stock-research-v1.sqlite"):new java.io.File(folder,"research.sqlite").getAbsolutePath();}
  void openStockResearch(boolean selectCurrent) {
    try {
      if (stockResearchScreen == null) {
        stockResearchStore = new StockResearchStore(this, companyProfileResearchName());
        stockResearchScreen = new StockResearchScreen(this, stockResearchStore,
            id -> ResearchContext.snapshot(id, instruments, businessStore.read("docs"), businessStore.read("relations")),
            this::openResearchDocument, this::openBusinessInstrument);
        stockResearchScreen.setProfileAccess(!testing);
        stockResearchScreen.importRequested = () -> chooseReviewImport(445);
        stockResearchScreen.exportRequested = text -> {
          try { exportReviewFile("个股研究.json", "application/json", text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
          catch (Exception e) { reviewFileMessage(e.getMessage()); }
        };
      }
      if (selectCurrent && instrument != null && !instrument.optString("id").isEmpty())
        stockResearchScreen.setInstrument(instrument.getString("id"));
      showPage("stockResearch", "个股研究", stockResearchScreen);
      stockResearchScreen.setDarkTheme(dark);
    } catch (Exception e) { reviewFileMessage(e.getMessage()); }
  }
  void openCommentWorkshop() {
    try {
      if (commentWorkshopScreen == null) {
        commentWorkshopScreen = new CommentWorkshopScreen(this, businessStore,
            getDatabasePath(testing ? "comment-workshop-tests.sqlite" : "comment-workshop-v1.sqlite"), this::openHandoffSource);
        commentWorkshopScreen.setFileActions(this::exportReviewFile, () -> chooseReviewImport(446));
      }
      showPage("commentWorkshop", "评论工坊", commentWorkshopScreen);
      commentWorkshopScreen.setDarkTheme(dark);
    } catch (Exception e) { reviewFileMessage(e.getMessage()); }
  }
  JSONArray evidenceInstruments() throws Exception {
    JSONArray rows = new JSONArray();
    for(JSONObject row:instruments) rows.put(new JSONObject().put("id",row.getString("id")).put("name",row.getString("name")));
    return rows;
  }
  void evidenceInstrumentAction(String action,JSONObject expected) throws Exception {
    BusinessStore.require(action.equals("chart") || action.equals("watchlist"),"不支持的候选操作");
    String id=expected.getString("instrumentId");JSONObject item=null;int matches=0;
    for(JSONObject row:instruments)if(id.equals(row.optString("id"))){item=row;matches++;}
    BusinessStore.require(matches==1 && item!=null && item.optString("name").equals(expected.optString("name")),
        "完整证券身份/名称已变化或不在本机目录；未打开其他证券或加入自选");
    if(action.equals("chart")){openBusinessInstrument(id);return;}
    if(item.optBoolean("transient")){
      JSONObject saved=recentIdentity(item);saved.remove("transient");saved.put("group","默认分组");
      if(feed!=null)feed.add(saved);else{item.remove("transient");item.put("group","默认分组");}
    }
    prefs.edit().putBoolean("watch/"+id,true).apply();makeGroups();filter();
    Toast.makeText(this,"已明确加入或恢复本机自选；候选仍待独立核验",Toast.LENGTH_SHORT).show();
  }
  void openEvidenceReview() {
    try {
      if(evidenceReviewScreen==null){
        evidenceReviewScreen=new EvidenceReviewScreen(this,businessStore,
            getDatabasePath(testing?"evidence-review-host-tests.sqlite":"evidence-review-v1.sqlite"),
            this::evidenceInstruments,this::evidenceInstrumentAction,this::openHandoffSource);
        evidenceReviewScreen.setFileActions(this::exportReviewFile,()->chooseReviewImport(449));
        evidenceReviewScreen.status.setText("本机报告 / 引用 / 候选复核 · 身份目录仅含本机自选与临时观察，不代表全市场；无模型调用");
      }
      showPage("evidenceReview","报告与候选复核",evidenceReviewScreen);
      evidenceReviewScreen.setDarkTheme(dark);
    } catch(Exception e){reviewFileMessage("报告复核未打开："+e.getMessage());}
  }
  org.json.JSONArray personMethodVersions() throws Exception {
    org.json.JSONArray versions = new org.json.JSONArray();
    for (String kind : new String[]{"docs", "collections", "reports"}) {
      org.json.JSONArray rows = businessStore.read(kind);
      for (int i = 0; i < rows.length(); i++) {
        JSONObject row = rows.getJSONObject(i);
        if (!row.optString("id").isEmpty())
          versions.put(PersonMethodModel.version("native-business", kind, row.getString("id"), row));
      }
    }
    return versions;
  }
  void openPersonMethodSource(JSONObject expected) throws Exception {
    PersonMethodModel.validateVersion(expected);
    BusinessStore.require("native-business".equals(expected.optString("namespace")), "来源空间不匹配；未打开其他记录");
    boolean matched = false;
    org.json.JSONArray versions = personMethodVersions();
    for (int i = 0; i < versions.length(); i++)
      if (PersonMethodModel.canonical(versions.get(i)).equals(PersonMethodModel.canonical(expected))) { matched = true; break; }
    BusinessStore.require(matched, "来源完整版本已变化或缺失；冻结原文仍可阅读，未按名称替换");
    String kind = expected.getString("kind");
    JSONObject record = expected.getJSONObject("originalRecord");
    if (!kind.equals("reports")) { openHandoffSource(kind, record); return; }
    ScrollView page = (ScrollView) businessPages.get("methodReport");
    if (page == null) {
      page = new ScrollView(this);
      TextView reader = new TextView(this);reader.setTag("methodReportReader");reader.setTextSize(14);
      reader.setTextIsSelectable(true);reader.setPadding(dp(10), dp(8), dp(10), dp(8));page.addView(reader);
    }
    TextView reader = page.findViewWithTag("methodReportReader");
    reader.setText("本机研究报告完整版本 · " + expected.getString("id") + "\n" + expected.getString("fingerprint")
        + "\n\n" + PersonMethodModel.body(record) + "\n\n完整原记录（不是在线AI执行结果）\n" + record.toString(2));
    reader.setTextColor(dark ? Color.rgb(217, 229, 245) : ink);
    showPage("methodReport", "方法引用报告", page);
  }
  void openPersonMethod() {
    try {
      if (personMethodScreen == null) {
        personMethodStore = new PersonMethodStore(this, testing ? "person-method-host-tests.sqlite" : "person-method-v1.sqlite");
        personMethodScreen = new PersonMethodScreen(this, personMethodStore, this::personMethodVersions, this::openPersonMethodSource);
        personMethodScreen.importRequested = () -> chooseReviewImport(448);
        personMethodScreen.exportRequested = text -> {
          try { exportReviewFile("人物与方法版本库.json", "application/json", text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
          catch (Exception e) { reviewFileMessage(e.getMessage()); }
        };
      }
      showPage("personMethod", "人物与方法", personMethodScreen);
      personMethodScreen.setDarkTheme(dark);
    } catch (Exception e) { reviewFileMessage("人物方法库未打开：" + e.getMessage()); }
  }
  String reviewExportFile = "";
  void openSourceAnalysis() {
    try {
      if (analysisScreen == null) {
        analysisScreen = new SourceAnalysisPanel(this, businessStore,
            getDatabasePath(testing ? "source-handoff-tests.sqlite" : "source-handoff-v1.sqlite"), this::openHandoffSource);
        analysisScreen.setFileActions(this::exportReviewFile, () -> chooseReviewImport(442));
      }
      showPage("sourceAnalysis", "分析材料", analysisScreen);
      analysisScreen.setDarkTheme(dark);
    } catch (Exception e) { reviewFileMessage(e.getMessage()); }
  }
  void openSourceHandoff() {
    try {
      if (handoffScreen == null) {
        handoffScreen = new SourceHandoffPanel(this, businessStore,
            getDatabasePath(testing ? "source-handoff-tests.sqlite" : "source-handoff-v1.sqlite"), this::openHandoffSource);
        handoffScreen.setFileActions(this::exportReviewFile, () -> chooseReviewImport(443));
      }
      showPage("sourceHandoff", "交接历史", handoffScreen);
      handoffScreen.setDarkTheme(dark);
    } catch (Exception e) { reviewFileMessage(e.getMessage()); }
  }
  ResearchWorkbenchScreen researchWorkbenchScreen;
  long f07Epoch;int f07PickerNext=64000;
  static final class F07Picker {
    final Object owner;final long epoch;final int action;final byte[] exportBytes;
    boolean returned,reading;volatile boolean revoked;android.net.Uri uri;byte[] bytes;String error;
    F07Picker(Object owner,long epoch,int action,byte[] exportBytes){this.owner=owner;this.epoch=epoch;this.action=action;this.exportBytes=exportBytes==null?null:exportBytes.clone();}
    boolean current(Object expected,long now){return !revoked&&owner!=null&&owner==expected&&epoch==now;}
    boolean ready(Object expected,long now,boolean resumed,boolean visible){return current(expected,now)&&returned&&resumed&&visible;}
    void revoke(){revoked=true;uri=null;bytes=null;}
  }
  final android.util.SparseArray<F07Picker> f07Pickers=new android.util.SparseArray<>();
  JSONObject researchWorkbenchInputs()throws Exception{
    File privateDir=businessRestoreTestDirectory();File candidateFile=privateDir==null?candidateStoreFile():new File(privateDir,"candidates.sqlite");
    LocalCandidateStore store=new LocalCandidateStore(candidateFile);JSONArray saved=store.list();JSONObject selected=saved.length()==0?new JSONObject():store.read(saved.getJSONObject(0).getString("id"));
    File newsFile=privateDir==null?getDatabasePath(testing?"news-public-host-tests.sqlite":"news-public-v1.sqlite"):new File(privateDir,"news.sqlite");
    File quantFile=new File(privateDir==null?getFilesDir():privateDir,testing?"quant-research-host-tests.json":"quant-research-v1.json");
    return ResearchWorkbenchHost.build(portfolioMirrorInputs(),selected,new NewsStore(newsFile).archive(null),ResearchModelSources.read(quantFile));
  }
  boolean researchWorkbenchCurrent(ResearchWorkbenchScreen owner){return owner!=null&&owner==researchWorkbenchScreen&&"researchWorkbench".equals(activePage)&&businessPages.get("researchWorkbench")==owner&&!isFinishing()&&!isDestroyed();}
  boolean researchWorkbenchReady(ResearchWorkbenchScreen owner){return researchWorkbenchCurrent(owner)&&foreground&&owner.isAttachedToWindow()&&owner.isShown()&&owner.hasWindowFocus()&&owner.getWindowVisibility()==View.VISIBLE;}
  void researchWorkbenchActive(boolean wanted){ResearchWorkbenchScreen owner=researchWorkbenchScreen;if(owner==null)return;owner.setActive(wanted&&researchWorkbenchCurrent(owner)&&foreground);}
  void revokeResearchWorkbenchPickers(){f07Epoch++;for(int i=0;i<f07Pickers.size();i++)f07Pickers.valueAt(i).revoke();f07Pickers.clear();}
  void researchWorkbenchNavigateAway(){revokeResearchWorkbenchPickers();researchWorkbenchActive(false);}
  void launchResearchWorkbenchPicker(ResearchWorkbenchScreen owner,int action,String original){
    BusinessStore.require(researchWorkbenchReady(owner)&&f07Pickers.size()==0,"原研究页已离开，或已有文件选择未返回");
    BusinessStore.require((action==0||action==1)&&f07PickerNext<65000,"研究文件选择次数已达上限，请重新打开任务");
    byte[] bytes=action==1?original.getBytes(java.nio.charset.StandardCharsets.UTF_8):null;
    BusinessStore.require(bytes==null||bytes.length<=64*1024*1024,"研究导出超过64MiB");
    int request=f07PickerNext++;F07Picker ticket=new F07Picker(owner,f07Epoch,action,bytes);f07Pickers.put(request,ticket);
    Intent intent=new Intent(action==0?Intent.ACTION_OPEN_DOCUMENT:Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
    if(action==1)intent.putExtra(Intent.EXTRA_TITLE,"研究完整原件.json");
    try{startActivityForResult(intent,request);}catch(RuntimeException error){f07Pickers.remove(request);ticket.revoke();throw error;}
  }
  boolean researchWorkbenchFileResult(int request,int result,Intent data){
    if(request<64000||request>=65000)return false;F07Picker ticket=f07Pickers.get(request);
    if(ticket!=null&&!ticket.returned){ticket.returned=true;ticket.uri=result==RESULT_OK&&data!=null?data.getData():null;drainResearchWorkbenchDocuments();}
    return true;
  }
  void drainResearchWorkbenchDocuments(){
    for(int i=f07Pickers.size()-1;i>=0;i--){int request=f07Pickers.keyAt(i);F07Picker ticket=f07Pickers.valueAt(i);ResearchWorkbenchScreen owner=researchWorkbenchScreen;
      if(!ticket.current(owner,f07Epoch)||!researchWorkbenchCurrent(owner)){f07Pickers.removeAt(i);ticket.revoke();continue;}
      if(!ticket.ready(owner,f07Epoch,foreground,researchWorkbenchReady(owner)))continue;
      if(ticket.uri==null){f07Pickers.removeAt(i);ticket.revoke();owner.fileStatus("文件选择已取消；未导入或导出");continue;}
      if(ticket.action==1){f07Pickers.removeAt(i);try(java.io.OutputStream out=getContentResolver().openOutputStream(ticket.uri,"wt")){BusinessStore.require(out!=null,"研究目标文件不可写");out.write(ticket.exportBytes);owner.fileStatus("已保存完整研究原件");}catch(Exception error){owner.fileStatus("原件未保存："+error.getMessage());}finally{ticket.revoke();}continue;}
      if(ticket.bytes!=null||ticket.error!=null){f07Pickers.removeAt(i);if(ticket.error==null)owner.acceptBytes(ticket.bytes);else owner.fileStatus(ticket.error);ticket.revoke();continue;}
      if(ticket.reading)continue;ticket.reading=true;final android.net.Uri source=ticket.uri;
      new Thread(()->{byte[] bytes=null;String error=null;try{if(!ticket.revoked)bytes=readReviewImport(source,8*1024*1024);}catch(Exception failure){error="研究文件未导入："+failure.getMessage();}final byte[] result=bytes;final String failure=error;
        runOnUiThread(()->{if(f07Pickers.get(request)!=ticket||!ticket.current(researchWorkbenchScreen,f07Epoch))return;ticket.bytes=result;ticket.error=failure;drainResearchWorkbenchDocuments();});},"f07-file-read").start();
    }
  }
  void openResearchWorkbench(){try{
    if(researchWorkbenchScreen==null){researchWorkbenchScreen=new ResearchWorkbenchScreen(this,new File(businessStore.getReadableDatabase().getPath()),this::researchWorkbenchInputs);final ResearchWorkbenchScreen owner=researchWorkbenchScreen;
      owner.importRequested=()->{try{launchResearchWorkbenchPicker(owner,0,null);}catch(Exception error){owner.fileStatus("文件选择未开始："+error.getMessage());}};
      owner.exportRequested=original->{try{launchResearchWorkbenchPicker(owner,1,original);}catch(Exception error){owner.fileStatus(error.getMessage());}};
    }
    showPage("researchWorkbench","研究编排 / 整批导入",researchWorkbenchScreen);researchWorkbenchScreen.setDarkTheme(dark);
  }catch(Exception error){reviewFileMessage("研究入口未打开："+error.getMessage());}}
  void openResearchRuns() {
    if (researchRunsScreen == null) {
      researchRunsScreen = new ResearchRunsScreen(this, businessStore);
      researchRunsScreen.importRequested = () -> chooseReviewImport(440);
      researchRunsScreen.exportRequested = text -> {
        try { exportReviewFile("历史研究报告.json", "application/json", text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch (Exception e) { reviewFileMessage(e.getMessage()); }
      };
    }
    showPage("researchRuns", "历史报告", researchRunsScreen);
    researchRunsScreen.setDarkTheme(dark);
  }
  void openHandoffSource(String kind, JSONObject expected) throws Exception {
    JSONObject current = SourceHandoffPanel.verifyExpected(businessStore, kind, expected);
    if (kind.equals("docs")) { openResearchDocument(current); return; }
    BusinessStore.require(kind.equals("collections"), "原文类型无效");
    BusinessScreen existing = (BusinessScreen) businessPages.get("business:collection");
    if (existing != null && existing.extension != null) existing.extension.requireSavedCollection();
    openBusiness("collection");
    ((BusinessScreen) businessPages.get("business:collection")).extension.loadCollection(current);
  }
  void chooseReviewImport(int request) {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
    if(request==457){intent.setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/json","text/plain","text/csv","text/tab-separated-values"});}
    else intent.setType("application/json");
    startActivityForResult(intent, request);
  }
  void exportReviewFile(String suggestedName, String mime, byte[] bytes) throws Exception {
    BusinessStore.require(bytes.length <= 64 * 1024 * 1024, "导出超过64MiB，请缩小范围");
    // Freeze the exact selected content before opening SAF. Bundle only stores a private basename.
    String name = "review-export-" + UUID.randomUUID() + ".bin";
    try (FileOutputStream out = new FileOutputStream(new File(getCacheDir(), name))) { out.write(bytes); }
    reviewExportFile = name;
    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType(mime); intent.putExtra(Intent.EXTRA_TITLE, suggestedName);
    startActivityForResult(intent, 441);
  }
  byte[] readReviewImport(android.net.Uri uri, int limit) throws Exception {
    try (InputStream in = getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      if (in == null) throw new IOException("所选文件不可读");
      byte[] buffer = new byte[8192]; int n;
      while ((n = in.read(buffer)) != -1) {
        if (out.size() + n > limit) throw new IOException("文件过大；没有导入");
        out.write(buffer, 0, n);
      }
      return out.toByteArray();
    }
  }
  void reviewFileMessage(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
  void scenarioTools() {
    if (scenarioScreen == null) scenarioScreen = new ScenarioToolsScreen(this);
    showPage("scenarioTools", "情景工具", scenarioScreen);
    scenarioScreen.setDarkTheme(dark);
  }
  JSONObject pendingSourcePlans;
  boolean historyExportLegacy;
  long historyExportAnchor=-1;
  void openSource() {
    if (sourceScreen == null) {
      sourceScreen = new SourceScreen(this);
      sourceScreen.setResearchOpener(this::openResearchDocument);
      sourceScreen.setHandoffEntrances(this::openSourceAnalysis, this::openSourceHandoff);
    }
    showPage("source", "作者来源", sourceScreen);
  }
  void openResearchDocument(JSONObject expected) throws Exception {
    BusinessScreen collection = (BusinessScreen) businessPages.get("business:collection");
    if (collection != null && collection.extension != null) collection.extension.requireSavedCollection();
    BusinessScreen research = (BusinessScreen) businessPages.get("business:research");
    if (research == null) {
      openBusiness("research");
      research = (BusinessScreen) businessPages.get("business:research");
    }
    research.openResearchDocument(expected);
    showPage("business:research", "研究资料", research);
  }
  void openCollectionRecord(String id) throws Exception {
    BusinessScreen existing=(BusinessScreen)businessPages.get("business:collection");
    if(existing!=null&&existing.extension!=null)existing.extension.requireSavedCollection();
    openBusiness("collection");
    ((BusinessScreen) businessPages.get("business:collection")).extension.loadCollection(tasks().recognition.record(id));
  }
  CollectionService collectionService;
  boolean collectionBound;
  final DeviceRecognizer.Progress collectionObserver = this::recognitionMessage;
  final ServiceConnection collectionConnection = new ServiceConnection() {
    public void onServiceConnected(ComponentName name, IBinder binder) {
      collectionService = ((CollectionService.LocalBinder) binder).service();
      collectionService.observe(collectionObserver);
      consumeRecognitionFile();
    }
    public void onServiceDisconnected(ComponentName name) { collectionService = null; }
  };
  CollectionService tasks() {
    BusinessStore.require(collectionService != null, "本机任务服务正在连接，请稍后重试");
    return collectionService;
  }
  String recognitionImportId = "";
  android.net.Uri recognitionPendingUri;
  String recognitionPendingId = "";
  int recognitionPendingRequest;
  void consumeRecognitionFile() {
    if (recognitionPendingUri == null || collectionService == null) return;
    android.net.Uri uri = recognitionPendingUri;
    int request = recognitionPendingRequest;
    String id = recognitionPendingId;
    recognitionPendingUri = null; // Consume once; failed operations need an explicit retry.
    try {
      ContentResolver resolver = getApplicationContext().getContentResolver();
      if (request == 411) tasks().installModel(() -> resolver.openInputStream(uri));
      else tasks().importMedia(id, () -> resolver.openInputStream(uri));
    } catch (Exception e) { recognitionMessage(e.getMessage()); }
  }
  String businessFileAction = "";
  JSONObject pendingBusiness;
  void openBusiness(String kind) {
    String key = "business:" + kind;
    BusinessScreen page = (BusinessScreen) businessPages.get(key);
    if (page == null) {
      page = new BusinessScreen(this, kind, businessStore);
      if(kind.equals("creator"))configureCreatorAi(page);
      if(kind.equals("paper")){LinearLayout tools=new LinearLayout(this);page.addView(tools,1);Button monitor=add(tools,"人工纸面监控",()->{});monitor.setTag("paperOpenMonitor");monitor.setOnClickListener(v->{if(v.isShown()&&hasWindowFocus()&&"business:paper".equals(activePage))openPaperMonitor();});page.themeControl(tools);}
      if(kind.equals("accounts")){
        LinearLayout mirrorTools=new LinearLayout(this);page.addView(mirrorTools,1);
        add(mirrorTools,"持仓镜像 / 只读对账",this::openPortfolioMirror).setTag("accountOpenMirror");page.themeControl(mirrorTools);
        BusinessScreen accountPage=page;add(mirrorTools,"今日参考盈亏",()->{int at=accountPage.accounts.getSelectedItemPosition();openAccountReference(at>=0&&at<accountPage.accountIds.size()?accountPage.accountIds.get(at):"");}).setTag("accountOpenReference");
      }
      if(kind.equals("accounts")||kind.equals("paper")){
        LinearLayout editTools=new LinearLayout(this);page.addView(editTools,1);add(editTools,"账户资料 / 手工现金",this::openAccountEdit).setTag("accountOpenEditor");page.themeControl(editTools);
      }
      if (kind.equals("research") || kind.equals("settings") || kind.equals("collection")) {
        LinearLayout tools = new LinearLayout(this);
        page.addView(tools, 1);
        add(tools, "分析材料", this::openSourceAnalysis).setTag("openSourceAnalysis");
        add(tools, "交接历史", this::openSourceHandoff).setTag("openSourceHandoff");
        if (kind.equals("research")) { add(tools, "历史报告", this::openResearchRuns).setTag("openResearchRuns"); Button f07Entry=add(tools,"研究编排 / 整批导入",()->{});f07Entry.setTag("openResearchWorkbench");final BusinessScreen f07EntryOwner=page;f07Entry.setOnClickListener(v->{if(unifiedBackupEntryActive("business:research",f07EntryOwner)&&v.isShown())openResearchWorkbench();}); }
        if(kind.equals("research")){Button f08Entry=add(tools,"产业主题更新",()->{});f08Entry.setTag("openIndustryTopic");final BusinessScreen f08Owner=page;f08Entry.setOnClickListener(v->{if(unifiedBackupEntryActive("business:research",f08Owner)&&v.isShown())openIndustryTopic();});}
        page.themeControl(tools);
        if(kind.equals("settings")){
          LinearLayout sources=new LinearLayout(this);page.addView(sources,2);
          add(sources,"数据来源 / 时点证据",this::openDataSourceStatus).setTag("openDataSourceStatus");page.themeControl(sources);
          LinearLayout migrationTools=new LinearLayout(this);page.addView(migrationTools,2);
          add(migrationTools,"功能迁移总览",this::openMigrationStatus).setTag("openMigrationStatus");
          add(migrationTools,"AI偏好 / 能力声明",this::openAiSettings).setTag("openAiSettings");page.themeControl(migrationTools);
          LinearLayout riskTools=new LinearLayout(this);page.addView(riskTools,2);
          add(riskTools,"风险阈值 / 本地提醒",this::openRiskSettings).setTag("openRiskSettings");page.themeControl(riskTools);
          add(riskTools,"数据位置 / 安全核验",this::openDataSafety).setTag("openDataSafety");page.themeControl(riskTools);
          add(riskTools,"统一非敏感备份",this::openUnifiedBackup).setTag("openUnifiedBackup");page.themeControl(riskTools);
        }
        if (kind.equals("research")) {
          LinearLayout material=new LinearLayout(this);page.addView(material,2);
          add(material,"全量资料库 / 人工分类",this::openMaterialLibrary).setTag("openMaterialLibrary");page.themeControl(material);
          Button knowledge=add(material,"资料研究请求",()->{});knowledge.setTag("researchOpenKnowledgeAi");
          final BusinessScreen knowledgeOwner=page;
          knowledge.setOnClickListener(v->{if(unifiedBackupEntryActive("business:research",knowledgeOwner)&&v.isShown())openKnowledgeAiHost();});
          page.themeControl(material);
          LinearLayout more = new LinearLayout(this);page.addView(more, 2);
          add(more, "当前个股研究", () -> openStockResearch(true)).setTag("openStockResearch");
          add(more, "评论工坊", this::openCommentWorkshop).setTag("openCommentWorkshop");
          add(more, "市场资讯", () -> openNews(false)).setTag("openNews");
          page.themeControl(more);
          LinearLayout libraries = new LinearLayout(this);page.addView(libraries, 3);
          add(libraries, "人物与方法", this::openPersonMethod).setTag("openPersonMethod");
          add(libraries, "报告与候选复核", this::openEvidenceReview).setTag("openEvidenceReview");
          add(libraries, "概念发现", this::industryDiscovery).setTag("openIndustryDiscovery");
          add(libraries, "量化研究", this::openQuantResearch).setTag("openQuantResearch");
          Button sectorResearchEntry=add(libraries, "板块 / 产业研究", ()->{});sectorResearchEntry.setTag("openSectorResearch");
          final BusinessScreen sectorResearchOwner=page;
          sectorResearchEntry.setOnClickListener(v->{if(unifiedBackupEntryActive("business:research",sectorResearchOwner)&&v.isShown())openSectorResearch();});
          page.themeControl(libraries);
        }
      }
    }
    showPage(key,
        kind.equals("creator")       ? "作者观点 / 关系图"
            : kind.equals("industry")       ? "产业关系"
            : kind.equals("collection") ? "采集文稿"
            : kind.equals("research")       ? "研究资料"
            : kind.equals("settings") ? "我的 / 数据"
            : kind.equals("paper")    ? "纸面模拟"
                                      : "账户",
        page);
  }
  void openBusinessInstrument(String id) {
    for (JSONObject s : instruments)
      if (s.optString("id").equals(id)) {
        activePage = "";
        findViewById(R.id.businessHost).setVisibility(View.GONE);
        findViewById(R.id.pageSwitch).setVisibility(View.GONE);
        openFromUser(s);
        return;
      }
    Toast.makeText(this, "请先把该标的添加到自选", Toast.LENGTH_SHORT).show();
  }
  void businessFile(String action) {
    businessFileAction = action;
    Intent intent = new Intent(
        action.equals("export") ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType(action.equals("text") || action.equals("transcript") ? "text/*" : "application/json");
    if (action.equals("export"))
      intent.putExtra(Intent.EXTRA_TITLE, "原生业务备份.json");
    startActivityForResult(intent, 404);
  }
  void recognitionFile(boolean model, String id) {
    recognitionImportId = id;
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType(model ? "application/zip" : "*/*");
    if (!model) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"video/*", "audio/*"});
    startActivityForResult(intent, model ? 411 : 410);
  }
  void recognitionMessage(String message) {
    BusinessScreen page = (BusinessScreen) businessPages.get("business:collection");
    if (page != null) {
      page.state.setText(message);
      if (page.extension != null) page.extension.refreshCollection();
    }
  }
  void stopCollectionWork() throws Exception {
    tasks().stopTask("下载与识别已停止；原有媒体和文稿保留");
  }
  void collectionNotifications() {
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
        != android.content.pm.PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 412);
  }
  String auctionImportId = "";
  private String activePage = "";
  private final LinkedHashMap<String, View> businessPages = new LinkedHashMap<>();
  void showPage(String key, String label, View page) {
    industryTopicActive("industryTopic".equals(key)&&industryTopicScreen==page);
    if(!"researchWorkbench".equals(key)||page!=researchWorkbenchScreen)researchWorkbenchNavigateAway();
    leaveChartFullscreen();
    if(!"business:creator".equals(key)||businessPages.get(key)!=page)creatorAiNavigateAway();
    knowledgeAiHostActive(false);
    if(rotationScreen!=null&&(!"rotation".equals(key)||page!=rotationScreen))rotationScreen.revokeDocumentTicket();
    rotationActive(false);
    paperMonitorActive("paperMonitor".equals(key));
    if (!key.equals("source") && sourceScreen != null) sourceScreen.leave();
    if (!businessPages.containsKey(key)) {
      businessPages.put(key, page);
      ((FrameLayout) findViewById(R.id.businessHost))
          .addView(page, new FrameLayout.LayoutParams(-1, -1));
      Button tab = add(findViewById(R.id.pageTabs), label, () -> showPage(key, label, page));
      tab.setTag("page:" + key);
      tab.setLayoutParams(new LinearLayout.LayoutParams(dp(92), dp(48)));
    }
    activePage = key;
    if("rotation".equals(key))rotationActive(true);
    if(unifiedBackupScreen!=null)unifiedBackupScreen.setActive("unifiedBackup".equals(key));
    if(!"unifiedBackup".equals(key))unifiedBackupPickerOwner=null;
    accountEditActive("accountEdit".equals(key));archiveVideoActive("archiveVideo".equals(key));
    etfMonitorActive("etfMonitor".equals(key));futuresMonitorActive("futuresMonitor".equals(key));cffexActive("cffexDisclosure".equals(key));
    if(dataSourceStatusScreen!=null)dataSourceStatusScreen.setActive("dataSourceStatus".equals(key));
    if(aiSettingsScreen!=null)aiSettingsScreen.setActive("aiSettings".equals(key));
    for (View p : businessPages.values()) p.setVisibility(p == page ? View.VISIBLE : View.GONE);
    findViewById(R.id.home).setVisibility(View.GONE);
    findViewById(R.id.detail).setVisibility(View.GONE);
    findViewById(R.id.businessHost).setVisibility(View.VISIBLE);
    findViewById(R.id.pageSwitch).setVisibility(View.VISIBLE);
    findViewById(R.id.navigation).setVisibility(View.VISIBLE);
    findViewById(R.id.back).setVisibility(View.VISIBLE);
    title.setText(label);
    configure();
    if (candidateScreen != null) candidateScreen.visibleChanged("candidates".equals(key));
    if (sectorScreen != null) sectorScreen.setActive("sectors".equals(key));
    if (marketOverviewScreen != null) marketOverviewScreen.setActive("marketOverview".equals(key));
    if (discoveryScreen != null) discoveryScreen.setActive("industryDiscovery".equals(key));
    if (leaderScreen != null) leaderScreen.setActive("sectorLeaders".equals(key));
    if (newsScreen != null) newsScreen.setActive("news".equals(key));
    if (page instanceof BusinessScreen)
      ((BusinessScreen) page).render();
    knowledgeAiHostActive("knowledgeAiHost".equals(key));
    researchWorkbenchActive("researchWorkbench".equals(key));getWindow().getDecorView().post(this::drainResearchWorkbenchDocuments);
  }
  private void resumeChart() {
    researchWorkbenchNavigateAway();
    leaveChartFullscreen();
    creatorAiNavigateAway();
    knowledgeAiHostActive(false);
    if(rotationScreen!=null)rotationScreen.revokeDocumentTicket();
    unifiedBackupPickerOwner=null;
    if(unifiedBackupScreen!=null)unifiedBackupScreen.setActive(false);
    unifiedBackupPickerOwner=null;
    if(unifiedBackupScreen!=null)unifiedBackupScreen.setActive(false);
    etfMonitorActive(false);futuresMonitorActive(false);cffexActive(false);accountEditActive(false);archiveVideoActive(false);
    if(dataSourceStatusScreen!=null)dataSourceStatusScreen.setActive(false);
    if(aiSettingsScreen!=null)aiSettingsScreen.setActive(false);
    if (newsScreen != null) newsScreen.setActive(false);
    if (leaderScreen != null) leaderScreen.setActive(false);
    if (candidateScreen != null) candidateScreen.visibleChanged(false);
    if (sectorScreen != null) sectorScreen.setActive(false);
    if (marketOverviewScreen != null) marketOverviewScreen.setActive(false);
    if (discoveryScreen != null) discoveryScreen.setActive(false);
    if (sourceScreen != null) sourceScreen.leave();
    activePage = "";
    findViewById(R.id.businessHost).setVisibility(View.GONE);
    findViewById(R.id.pageSwitch).setVisibility(View.GONE);
    findViewById(R.id.home).setVisibility(View.GONE);
    findViewById(R.id.detail).setVisibility(View.VISIBLE);
    detail = true;
    findViewById(R.id.back).setVisibility(View.VISIBLE);
    configure();
    if (feed != null)
      syncLive(false);
  }
  AuctionAnalysisScreen auctionAnalysisScreen;
  JSONArray auctionAnalysisSnapshots()throws Exception{
    if(auctionHistoryLoaded)return auctionHistorySnapshots;
    JSONArray result=new JSONArray();HashSet<String> seen=new HashSet<>();
    for(JSONObject item:instruments)for(String p:new String[]{"auctionOpening","auctionClosing"}){
      JSONObject meta=MarketData.obj(item,p+"Meta"),input=meta.optJSONObject("rawInput");
      if(input==null||input.length()==0||!MarketData.obj(input,"meta").optString("instrumentId").equals(item.optString("id")))continue;
      String id=item.optString("id")+":"+p+":"+HostMigrationState.hash(SourceAnalysisPacket.json(input).getBytes(java.nio.charset.StandardCharsets.UTF_8));
      if(!seen.add(id))continue;
      result.put(new JSONObject().put("id",id).put("instrumentId",item.optString("id")).put("name",item.optString("name")).put("input",new JSONObject(input.toString())).put("coverage",meta.optJSONObject("coverage")));
    }
    return result;
  }
    boolean auctionHistoryLoaded,auctionHistoryBusy;JSONArray auctionHistorySnapshots=new JSONArray();
  void reloadAuctionHistory(){
    if(auctionHistoryBusy||auctionAnalysisScreen==null)return;auctionHistoryBusy=true;
    auctionAnalysisScreen.sourceNote.setText("正在后台只读核对本机竞价归档；当前阅读内容保留。");
    final JSONArray captured=new JSONArray();int ignored=0;try{for(JSONObject s:instruments){String[] id=s.optString("id").split(":");if(id.length==3&&(id[1].equals("stock")||id[1].equals("etf")))captured.put(new JSONObject(s.toString()));else ignored++;}}catch(Exception e){auctionHistoryBusy=false;auctionAnalysisScreen.sourceNote.setText(e.getMessage());return;}
    final int excluded=ignored;final java.io.File file=new java.io.File(getFilesDir(),testing?"live-tests/market-v1.sqlite":"live/market-v1.sqlite");
    new Thread(()->{JSONObject result;try{result=AuctionHistorySource.collect(file,captured);}catch(Exception e){result=new JSONObject();try{result.put("state","failed").put("reason",e.getMessage());}catch(Exception ignoredError){}}
      final JSONObject finished=result;runOnUiThread(()->{auctionHistoryBusy=false;if(isFinishing()||isDestroyed())return;
        auctionHistorySnapshots=MarketData.array(finished,"snapshots");auctionHistoryLoaded=true;
        if(auctionAnalysisScreen!=null){auctionAnalysisScreen.sourceEvidence=finished;auctionAnalysisScreen.guard(()->auctionAnalysisScreen.refresh());
          auctionAnalysisScreen.sourceNote.setText("本机竞价归档："+finished.optString("state")+" · "+finished.optString("reason")+"\n检查归档"+finished.optInt("archiveRowsVisited")+"，缓存"+finished.optInt("cacheRowsVisited")+"，去重"+finished.optInt("duplicates")+"；指数/其他身份不适用"+excluded+"。未发起网络采集。"+"\n排除项："+MarketData.array(finished,"diagnostics").length()+"；可打开来源读取完整说明。");
        }
      });
    },"auction-history-readonly").start();
  }
  void openAuctionAnalysis(){
    if(auctionAnalysisScreen==null){auctionAnalysisScreen=new AuctionAnalysisScreen(this,this::auctionAnalysisSnapshots);auctionAnalysisScreen.requestReload=this::reloadAuctionHistory;if(!testing)reloadAuctionHistory();}
    showPage("auctionAnalysis","竞价八形态 / 历史覆盖",auctionAnalysisScreen);auctionAnalysisScreen.setDarkTheme(dark);
  }
  void auctionView() {
    String key = "auction:" + str(instrument, "id");
    auctionScreen = (AuctionScreen) businessPages.get(key);
    if (auctionScreen == null)
      auctionScreen = new AuctionScreen(this, str(instrument, "id"), str(instrument, "name"));
    auctionScreen.show();
  }
  List<JSONObject> rosterForPanels() {
    return instruments;
  }
  boolean darkTheme() {
    return dark;
  }
  void funds() {
    if (capitalScreen == null)
      capitalScreen = new CapitalScreen(this, str(instrument, "id"));
    capitalScreen.show();
  }
  private boolean foreground, pendingLiveRosterChange;
  private int samplingSeconds;
  private final Handler refreshHandler = new Handler(Looper.getMainLooper());
  private final Runnable refreshLoop = new Runnable() {
    @Override
    public void run() {
      if (foreground && feed != null) {
        refreshLive();
        refreshHandler.postDelayed(this, 60000);
      }
    }
  };
  private final Runnable sampleLoop = new Runnable() {
    public void run() {
      if (foreground && feed != null) {
        AuctionScreen visibleAuction = businessPages.get(activePage) instanceof AuctionScreen
            ? (AuctionScreen) businessPages.get(activePage)
            : null;
        if (visibleAuction != null && visibleAuction.isShowing()
            && visibleAuction.mode.getSelectedItemPosition() == 0)
          feed.sampleAuction(visibleAuction.id,
              visibleAuction.phase.getSelectedItemPosition() == 0 ? "opening" : "closing");
        if (activePage.isEmpty() && detail && samplingSeconds > 0 && period.startsWith("minute"))
          feed.sample(str(instrument, "id"), samplingSeconds);
        refreshHandler.postDelayed(this, 5000);
      }
    }
  };
  private LinearLayout root, periods, indicators, actions, groupRow;
  static final String[] INDICATORS = {"MACD", "ATR", "RVOL", "KDJ", "RSI", "CCI", "OBV"};
  private Spinner indicatorSelector;
  private TextView title, quote, readout, status;
  private EditText search;
  private ListView stocks;
  private GridView stockGrid;
  ChartFullscreenController chartFullscreen;
  void installChartFullscreen(Bundle saved){
    chartFullscreen=new ChartFullscreenController(this,chart,new ChartFullscreenController.Host(){
      public boolean chartPage(){return detail&&activePage.isEmpty()&&!isFinishing()&&!isDestroyed();}
      public boolean foreground(){return MainActivity.this.foreground;}
      public boolean dark(){return dark;}
      public String symbol(){return instrument==null?"":str(instrument,"id");}
      public String title(){return instrument==null?"":str(instrument,"name")+" "+str(instrument,"id");}
      public String period(){return period;}
      public String source(){return sourceLabel(period);}
      public String[] indicators(){return INDICATORS.clone();}
      public void period(String value){samplingSeconds=value.equals("minute5s")?5:value.equals("minute30s")?30:0;MainActivity.this.period(value);if(feed!=null&&samplingSeconds>0&&!sourceEvidenceNavigation)feed.sample(str(instrument,"id"),samplingSeconds);}
      public void indicator(String value){selectIndicator(value);}
      public void parameters(){MainActivity.this.parameters();}
      public void configure(){MainActivity.this.configure();}
      public void inspect(boolean secondary){if(secondary&&reference.isShown())readFrom(reference,reference.selected);else read(chart.selected);}
    });
    if(saved!=null)chartFullscreen.restore(saved.getBundle("chartFullscreen"));
  }
  void leaveChartFullscreen(){if(chartFullscreen!=null)chartFullscreen.leave(false);}
  boolean fullscreenControl(View view){return chartFullscreen==null||!chartFullscreen.disposed&&(!chartFullscreen.open()||(foreground&&view.isShown()));}

  MarketChart chart, reference;
  private MarketChart inspected;
  private BaseAdapter adapter, gridAdapter;
  private Parcelable homeListState, homeGridState;
  private final int ink = Color.rgb(31, 48, 72), muted = Color.rgb(120, 136, 157),
                    blue = Color.rgb(43, 102, 182), up = Color.rgb(218, 65, 80),
                    down = Color.rgb(21, 151, 127);
  int dp(float x) {
    return Math.round(x * getResources().getDisplayMetrics().density);
  }
  String str(JSONObject o, String key) {
    return o.optString(key);
  }
  static String num(double v) {
    return Double.isFinite(v) ? String.format(Locale.ROOT, "%.3f", v) : "— 样本不足/缺失";
  }
  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    if(state!=null)rotationPickerNext=Math.max(62000,Math.min(63000,state.getInt("rotationPickerNext",62000)));
    if(state!=null)creatorAiPickerNext=Math.max(63000,Math.min(64000,state.getInt("creatorAiPickerNext",63000)));
    if(state!=null)f07PickerNext=Math.max(64000,Math.min(65000,state.getInt("f07PickerNext",64000)));
    testing = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        && getIntent().getBooleanExtra("testFixtures", false);
    File paperTestDirectory=paperAutomationTestDirectory();
    File industryTestDirectory=industryTopicTestDirectory();
    prefs = getSharedPreferences(industryTestDirectory!=null?industryTestDirectory.getName():paperTestDirectory!=null?paperTestDirectory.getName():(testing ? "native-review-tests" : "native-review"), MODE_PRIVATE);
    File businessTestDirectory=industryTestDirectory!=null?industryTestDirectory:paperTestDirectory!=null?paperTestDirectory:businessRestoreTestDirectory();
    businessStore = new BusinessStore(this,businessTestDirectory==null?(testing?"native-business-tests.sqlite":"native-business-v1.sqlite"):new File(businessTestDirectory,"business.sqlite").getAbsolutePath());
    collectionBound = bindService(new Intent(this, CollectionService.class)
        .putExtra("testFixtures", testing), collectionConnection, BIND_AUTO_CREATE);
    if (state != null) {
      auctionImportId = state.getString("auctionImportId", "");
      capitalImportId = state.getString("capitalImportId", "");
      businessFileAction = state.getString("businessFileAction", "");
      reviewExportFile = state.getString("reviewExportFile", "");
      try { if (state.containsKey("pendingSourcePlans")) pendingSourcePlans = new JSONObject(state.getString("pendingSourcePlans")); }
      catch (Exception e) { pendingSourcePlans = null; }
      historyExportLegacy=state.getBoolean("historyExportLegacy",false);
      historyExportAnchor=state.getLong("historyExportAnchor",-1);
      recognitionImportId = state.getString("recognitionImportId", "");
      String pendingUri = state.getString("recognitionPendingUri", "");
      if (!pendingUri.isEmpty()) recognitionPendingUri = android.net.Uri.parse(pendingUri);
      recognitionPendingId = state.getString("recognitionPendingId", "");
      recognitionPendingRequest = state.getInt("recognitionPendingRequest", 0);
      samplingSeconds = state.getInt("samplingSeconds", 0);
    }
    dark = prefs.getBoolean("dark", false);
    watchlistLegacyMode=!prefs.contains("watchlistWorkspace/groupId");
    group = prefs.getString(watchlistLegacyMode?"group":"watchlistWorkspace/groupId", watchlistLegacyMode?"全部":"");
    layout = prefs.getString("layout", "focus");
    watchMode = prefs.getString("watchMode", "quotes");
    if (!testing) {
      feed = new MarketFeed(this);
      instruments.addAll(feed.instruments);
    } else
      try (InputStream in = getAssets().open("review-data.json")) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) != -1) out.write(b, 0, n);
        JSONArray a = new JSONObject(out.toString("UTF-8")).getJSONArray("instruments");
        for (int i = 0; i < a.length(); i++) instruments.add(a.getJSONObject(i));
      } catch (Exception e) {
        TextView error = new TextView(this);
        error.setText("评审样本未加载，请重新安装本评审包。\n未读取正式数据。");
        setContentView(error);
        return;
      }
    setContentView(R.layout.activity_main);
    root = findViewById(R.id.root);
    add(findViewById(R.id.pageTabs), "行情", this::resumeChart)
        .setLayoutParams(new LinearLayout.LayoutParams(dp(92), dp(48)));
    title = findViewById(R.id.title);
    quote = findViewById(R.id.quote);
    readout = findViewById(R.id.readout);
    status = findViewById(R.id.homeStatus);
    search = findViewById(R.id.search);
    stocks = findViewById(R.id.stocks);
    stockGrid = findViewById(R.id.stockGrid);
    chart = findViewById(R.id.chart);
    reference = findViewById(R.id.reference);
    inspected = chart;
    periods = findViewById(R.id.periods);
    indicators = findViewById(R.id.indicators);
    actions = findViewById(R.id.actions);
    groupRow = findViewById(R.id.groups);
    root.setOnApplyWindowInsetsListener((v, insets) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets i =
            insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        v.setPadding(i.left, i.top, i.right, i.bottom);
      } else
        v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
      if(Build.VERSION.SDK_INT>=28&&Build.VERSION.SDK_INT<30&&insets.getDisplayCutout()!=null){DisplayCutout cut=insets.getDisplayCutout();v.setPadding(Math.max(v.getPaddingLeft(),cut.getSafeInsetLeft()),Math.max(v.getPaddingTop(),cut.getSafeInsetTop()),Math.max(v.getPaddingRight(),cut.getSafeInsetRight()),Math.max(v.getPaddingBottom(),cut.getSafeInsetBottom()));}
      return insets;
    });
    if (Build.VERSION.SDK_INT >= 33)
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
          android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> {
            if (closeInternalReader()) return;
            if (detail || !activePage.isEmpty())
              goHome();
            else
              finish();
          });
    findViewById(R.id.back).setOnClickListener(v -> { if (fullscreenControl(v)&&!closeInternalReader()) goHome(); });
    findViewById(R.id.theme).setOnClickListener(v -> {
      if(!fullscreenControl(v))return;
      if (activePage.isEmpty() && detail && landscape()) {
        explainFromUser();
        return;
      }
      dark = !dark;
      prefs.edit().putBoolean("dark", dark).apply();
      applyTheme();
    });
    findViewById(R.id.manage).setOnClickListener(v -> {
      if(!fullscreenControl(v))return;
      if (!activePage.isEmpty()) {
        resumeChart();
        return;
      }
      if (detail)
        chooseLayout();
      else
        manage();
    });
    makeGroups();
    adapter = new BaseAdapter() {
      public int getCount() {
        return visible.size();
      }
      public Object getItem(int p) {
        return visible.get(p);
      }
      public long getItemId(int p) {
        return p;
      }
      public View getView(int p, View old, android.view.ViewGroup parent) {
        return watchRow(visible.get(p), false);
      }
    };
    gridAdapter = new BaseAdapter() {
      public int getCount() {
        return visible.size();
      }
      public Object getItem(int p) {
        return visible.get(p);
      }
      public long getItemId(int p) {
        return p;
      }
      public View getView(int p, View old, android.view.ViewGroup parent) {
        return watchRow(visible.get(p), true);
      }
    };
    stocks.setAdapter(adapter);
    stockGrid.setAdapter(gridAdapter);
    stocks.setOnItemClickListener((p, v, pos, id) -> openFromUser(visible.get(pos)));
    stockGrid.setOnItemClickListener((p, v, pos, id) -> openFromUser(visible.get(pos)));
    findViewById(R.id.recent).setOnClickListener(v -> recent());
    LinearLayout modes = findViewById(R.id.watchModes);
    String[] modeNames = {"报价", "走势", "多股对比"}, modeValues = {"quotes", "spark", "grid"};
    for (int i = 0; i < modeNames.length; i++) {
      final String value = modeValues[i];
      add(modes, modeNames[i], () -> {
        watchMode = value;
        prefs.edit().putString("watchMode", value).apply();
        updateWatchMode();
      }).setTag(value);
    }
    if (!testing)
      add(modes, "刷新", this::refreshLive).setTag("refresh");
    ((ViewGroup) modes.getParent()).removeView(modes);
    modes.setPadding(0, 0, 0, 0);
    ((LinearLayout) findViewById(R.id.header))
        .addView(modes, 2, new LinearLayout.LayoutParams(dp(testing ? 144 : 192), dp(48)));
    for (int i = 0; i < modes.getChildCount(); i++) ((Button) modes.getChildAt(i)).setTextSize(11);
    search.addTextChangedListener(new TextWatcher() {
      public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
      public void onTextChanged(CharSequence s, int st, int before, int count) {
        filter();
      }
      public void afterTextChanged(Editable e) {}
    });
    ChartPeriodBar periodBar = new ChartPeriodBar(this, (key, seconds) -> {
      samplingSeconds = seconds;
      period(key);
      if (feed != null && seconds > 0 && !sourceEvidenceNavigation)
        feed.sample(str(instrument, "id"), seconds);
    });
    periods.addView(periodBar, new LinearLayout.LayoutParams(0, -1, 1));
    add(actions, "最新", () -> chart.latest()).setTooltipText("回到最新已取得的数据位置，不补造缺失行情");
    for (String s : INDICATORS) add(indicators, s, () -> selectIndicator(s));
    indicatorSelector = new Spinner(this);
    indicatorSelector.setTag("indicatorSelector");
    indicatorSelector.setContentDescription("副图指标");
    indicatorSelector.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, INDICATORS) {
      @Override public View getView(int position, View convert, ViewGroup parent) {
        TextView v=(TextView)super.getView(position,convert,parent);v.setTextColor(dark?0xffdce5f0:ink);v.setTextSize(14);return v;
      }
      @Override public View getDropDownView(int position, View convert, ViewGroup parent) {
        TextView v=(TextView)super.getDropDownView(position,convert,parent);
        v.setTextColor(dark?0xffdce5f0:ink);v.setBackgroundColor(dark?0xff151b25:0xffffffff);v.setMinHeight(dp(48));return v;
      }
    });
    indicators.addView(indicatorSelector, new LinearLayout.LayoutParams(0, dp(48), 1));
    indicatorSelector.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(AdapterView<?> parent) {}
      public void onItemSelected(AdapterView<?> parent, View view, int at, long id) {
        if (fullscreenControl(indicatorSelector) && at == indicatorSelector.getSelectedItemPosition() && !INDICATORS[at].equals(chart.indicator)) selectIndicator(INDICATORS[at]);
      }
    });
    indicators.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> fitIndicatorToolbar());
    add(indicators, "参数", () -> parameters());
    add(indicators, "九转", () -> {
      chart.nine = !chart.nine;
      reference.nine = chart.nine;
      chart.invalidate();
      reference.invalidate();
      refreshButtons();
    });
    add(actions, "信号解释", this::explainFromUser);
    add(actions, "个股研究", () -> openStockResearch(true)).setTag("chartStockResearch");
    add(actions, "盘口", () -> {
      layout = layout.equals("quotes") && chart.minute ? "focus" : "quotes";
      prefs.edit().putString("layout", layout).apply();
      if (layout.equals("quotes") && !chart.minute)
        period("minute");
      configure();
    });
    add(actions, "资金", this::funds);
    add(actions, "竞价", this::auctionView);
    add(actions, "横屏", () -> {
      manualLandscape = true;
      setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    });
    if (!testing)
      add(actions, "刷新", this::refreshLive);
    findViewById(R.id.bookBelow)
        .setOnClickListener(v
            -> new AlertDialog.Builder(this)
                   .setTitle("五档盘口")
                   .setMessage(bookText())
                   .setPositiveButton("关闭", null)
                   .show());
    findViewById(R.id.notice).setOnClickListener(v -> explainFromUser());
    LinearLayout nav = findViewById(R.id.navigation);
    for (String s : new String[] {"自选", "市场", "研究", "账户", "我的"}) {
      Button navButton = add(nav, s, () -> {
        if (s.equals("自选"))
          goHome();
        else if (s.equals("市场"))
          marketHome();
        else if (s.equals("研究"))
          openBusiness("research");
        else if (s.equals("账户"))
          openBusiness("accounts");
        else if (s.equals("我的"))
          openBusiness("settings");
        else
          new AlertDialog.Builder(this)
              .setTitle(s + " · 后续迁移")
              .setMessage("本次原生评审已开放自选、K线、指标切换和信号解释。其他工作区没有假接入。")
              .setPositiveButton("知道了", null)
              .show();
      });
      navButton.setTextSize(10);
      navButton.setLayoutParams(new LinearLayout.LayoutParams(0, dp(48), 1));
      navButton.setGravity(Gravity.CENTER);
      navButton.setCompoundDrawablePadding(dp(3));
    }
    chart.listener = i -> read(i);
    reference.listener = i -> readFrom(reference, i);
    chart.annotationsEnabled=prefs.getBoolean("chartAnnotations",false);
    chart.vwapEnabled=prefs.getBoolean("vwapEnabled",false);chart.vwapMode=prefs.getString("vwapMode","legacy-close-approx");chart.vwapAnchor=prefs.getString("vwapAnchor","auto");
    chart.emaPeriod = prefs.getInt("ema", 20);
    chart.atrPeriod = prefs.getInt("atr", 14);
    chart.volumePeriod = prefs.getInt("rvol", 20);
    chart.maType = prefs.getString("maType", "MA").equals("EMA") ? "EMA" : "MA";
    try {
      chart.maPeriods = readMaPeriods(prefs.getString("maPeriods", "5,10,20,60"));
    } catch (Exception ignored) {
    }
    chart.macdFast = Math.max(1, Math.min(499, prefs.getInt("macdFast", 12)));
    chart.macdSlow = Math.max(chart.macdFast + 1, Math.min(500, prefs.getInt("macdSlow", 26)));
    chart.macdSignal = Math.max(1, Math.min(500, prefs.getInt("macdSignal", 9)));
    chart.kdjPeriod = Math.max(1, Math.min(500, prefs.getInt("kdj", 9)));
    chart.rsiPeriod = Math.max(1, Math.min(500, prefs.getInt("rsi", 14)));
    chart.cciPeriod = Math.max(1, Math.min(500, prefs.getInt("cci", 14)));
    chart.indicator = validIndicator(prefs.getString("indicator", "MACD"));
    indicatorSelector.setSelection(Arrays.asList(INDICATORS).indexOf(chart.indicator));
    chart.overlay = prefs.getBoolean("overlay", true);
    if (state != null && state.containsKey("temporaryInstrument")) {
      try { observeRecent(new JSONObject(state.getString("temporaryInstrument"))); }
      catch (Exception e) { Toast.makeText(this, "临时查看恢复失败：" + e.getMessage(), Toast.LENGTH_SHORT).show(); }
    }
    instrument = instruments.isEmpty() ? new JSONObject() : instruments.get(0);
    if (feed != null)
      feed.listener = this::syncLive;
    filter();
    applyTheme();
    configure();
    if (state != null && state.getBoolean("detail") && !instruments.isEmpty()) {
      for (JSONObject s : instruments)
        if (str(s, "id").equals(state.getString("instrument")))
          instrument = s;
      period = state.getString("period", "day");
      manualLandscape = state.getBoolean("manualLandscape", false);
      open(instrument, true);
      homeListState = state.getParcelable("homeList");
      homeGridState = state.getParcelable("homeGrid");
      chart.selected = state.getInt("selected", chart.selected);
      chart.end = chart.minute ? chart.bars.size() : state.getInt("end", chart.end);
      chart.count =
          chart.minute ? Math.max(1, chart.bars.size()) : state.getInt("count", chart.count);
      chart.indicator = validIndicator(state.getString("indicator", chart.indicator));
      chart.nine = state.getBoolean("nine", true);
      chart.recalculate();
      reference.indicator = chart.indicator;
      reference.nine = chart.nine;
      reference.recalculate();
      read(chart.selected);
      refreshButtons();
      reference.end = state.getInt("referenceEnd", reference.end);
      reference.selected = state.getInt("referenceSelected", reference.selected);
      reference.count = state.getInt("referenceCount", reference.count);
      if (state.getBoolean("inspectReference", false) && reference.getVisibility() == View.VISIBLE)
        readFrom(reference, reference.selected);
    }
    if (state != null) {
      try{watchlistBridgeRestoreViews();}catch(Exception e){reviewFileMessage("完整分组草稿未恢复，原文件保留："+e.getMessage());}
      ArrayList<String> keys = state.getStringArrayList("openPages");
      if (keys != null)
        for (String key : keys) {
          if (key.startsWith("business:")) {
            openBusiness(key.substring(9));
            ((BusinessScreen) businessPages.get(key)).restoreDraft(state.getBundle(key + ":draft"));
          } else if (key.equals("recent")) {
            recent();recentScreen.restore(state.getBundle("recentState"));
          } else if (key.equals("candidates")) {
            localCandidates();candidateScreen.restoreState(state.getBundle("candidateState"));
          } else if (key.equals("marketOverview")) {
            marketOverview();
            try{String saved=state.getString("marketOverviewState",null);if(saved!=null)marketOverviewScreen.restoreState(new JSONObject(saved));}
            catch(Exception e){marketOverviewScreen.setHostError("界面草稿恢复失败，观测档案保留："+e.getMessage());}
          } else if(key.equals("industryDiscovery")){
            industryDiscovery();
            try{String saved=state.getString("industryDiscoveryState",null);if(saved!=null)discoveryScreen.restoreState(new JSONObject(saved));}
            catch(Exception e){discoveryScreen.setHostError("发现草稿恢复失败，档案保留："+e.getMessage());}
          } else if(key.equals("quantResearch")){
            openQuantResearch();if(quantResearchScreen!=null)quantResearchScreen.restoreState(state.getBundle("quantResearchState"));
          } else if(key.equals("archiveVideo")){
            restoreArchiveVideo(state.getString("archiveVideoState","{}"));
          } else if(key.equals("accountReference")){
            openAccountReference(state.getString("accountReferenceId",""));
          } else if(key.equals("accountEdit")){
            openAccountEdit();try{String marker=state.getString("accountEditState");if(marker!=null)accountEditScreen.restoreState(new HostAccountEditState(this,testing).read(new JSONObject(marker)));}catch(Exception e){accountEditStateFailed=true;reviewFileMessage("账户草稿未恢复，原文件保留："+e.getMessage());}
          } else if(key.equals("watchlistHost")){
            openWatchlistHost();
          } else if(key.equals("watchlistWorkspace")){
            openWatchlistWorkspace();
          } else if(key.equals("watchlistReconciliation")){
            openWatchlistReconciliation();
          } else if(key.equals("auctionAnalysis")){
            openAuctionAnalysis();try{String marker=state.getString("auctionAnalysisState");if(marker!=null)auctionAnalysisScreen.restoreState(new HostAuctionState(this,testing).read(new JSONObject(marker)));}catch(Exception e){reviewFileMessage("竞价阅读状态未恢复，原缓存保留："+e.getMessage());}
          } else if(key.equals("materialLibrary")){
            openMaterialLibrary();
          } else if(key.equals("knowledgeAiHost")){
            openKnowledgeAiHost();
            try{String marker=state.getString("knowledgeAiHostState");if(marker!=null&&knowledgeAiHostScreen!=null)knowledgeAiHostScreen.restoreState(new JSONObject(marker));}
            catch(Exception e){reviewFileMessage("资料研究草稿未恢复；原文件保留，需核对");}
          } else if(key.equals("dataSourceStatus")){
            openDataSourceStatus();try{if(dataSourceStatusScreen!=null)dataSourceStatusScreen.restoreState(new JSONObject(state.getString("dataSourceStatusState","{}")));}catch(Exception e){reviewFileMessage("来源筛选状态未恢复，原证据保留");}
          } else if(key.equals("migrationStatus")){
            openMigrationStatus();try{String marker=state.getString("migrationStatusState");if(marker!=null&&migrationStatusScreen!=null)migrationStatusScreen.restoreState(new HostMigrationState(this,testing).read(new JSONObject(marker)));}catch(Exception e){reviewFileMessage("迁移阅读位置未恢复，冻结审查表保留："+e.getMessage());}
          } else if(key.equals("paperMonitor")){
            openPaperMonitor();if(paperMonitorHostScreen!=null)paperMonitorHostScreen.restoreState(state.getBundle("paperMonitorState"));
          } else if(key.equals("portfolioMirror")){
            openPortfolioMirror();if(portfolioMirrorScreen!=null)portfolioMirrorScreen.restoreState(state.getBundle("portfolioMirrorState"));
          } else if(key.equals("aiSettings")){
            openAiSettings();try{String marker=state.getString("aiSettingsState");if(marker!=null&&aiSettingsScreen!=null)aiSettingsScreen.restoreState(new JSONObject(marker));}catch(Exception e){reviewFileMessage("AI偏好草稿未恢复，已保存配置保留");}
          } else if(key.equals("sectorResearch")){
            openSectorResearch();
          } else if (key.equals("marketHome")) {
            marketHome();
          } else if (key.equals("sectors")) {
            sectors();
            try {
              String saved = state.getString("sectorState");
              if (saved != null) sectorScreen.restoreState(new JSONObject(saved));
            } catch (Exception e) { sectorScreen.setHostError("页面选择恢复失败；已保存的板块缓存保留"); }
          } else if (key.equals("source")) {
            openSource();
          } else if (key.equals("sectorLeaders")) {
            sectorLeaders();
            try {
              String saved = state.getString("sectorLeaderState");
              if (saved != null) leaderScreen.restoreState(new JSONObject(saved));
            } catch (Exception e) { leaderScreen.setHostError("页面状态未恢复；人工稿仍保留：" + e.getMessage()); }
          } else if (key.equals("sourceAnalysis")) {
            openSourceAnalysis();
          } else if (key.equals("stockResearch")) {
            openStockResearch(false);
            try {
              String saved = state.getString("stockResearchState");
              if (saved != null && stockResearchScreen != null) stockResearchScreen.restoreState(new JSONObject(saved));
            } catch (Exception e) { reviewFileMessage("个股研究阅读位置未恢复：" + e.getMessage()); }
          } else if (key.equals("commentWorkshop")) {
            openCommentWorkshop();
          } else if (key.equals("evidenceReview")) {
            openEvidenceReview();
          } else if (key.equals("personMethod")) {
            openPersonMethod();
            try { if (personMethodScreen != null) personMethodScreen.restoreState(state.getBundle("personMethodState")); }
            catch (Exception e) { reviewFileMessage("人物方法草稿未恢复：" + e.getMessage()); }
          } else if (key.equals("dataSafety")) {
            openDataSafety();
          } else if (key.equals("riskSettings")) {
            openRiskSettings();
            try { if(riskSettingsScreen!=null)riskSettingsScreen.restoreState(state.getBundle("riskSettingsState")); }
            catch(Exception e){reviewFileMessage("风险设置草稿未恢复："+e.getMessage());}
          } else if (key.equals("methodReport")) {
            // A source locator must verify current full identity again; never restore a stale display as current.
            openPersonMethod();
          } else if (key.equals("news")) {
            openNews(false);
            try {
              String saved = state.getString("newsState");
              if (saved != null && newsScreen != null) newsScreen.restoreState(new JSONObject(saved));
            } catch (Exception e) { reviewFileMessage("资讯草稿未恢复：" + e.getMessage()); }
          } else if (key.equals("sourceHandoff")) {
            openSourceHandoff();
          } else if(key.equals("researchWorkbench")){
            openResearchWorkbench();try{String marker=state.getString("researchWorkbenchState");if(marker!=null&&researchWorkbenchScreen!=null)researchWorkbenchScreen.restoreState(new JSONObject(marker));}catch(Exception error){reviewFileMessage("研究完整草稿未恢复："+error.getMessage());}
          } else if(key.equals("industryTopic")){
            openIndustryTopic();try{String saved=state.getString("industryTopicState");if(saved!=null&&industryTopicScreen!=null)industryTopicScreen.restoreState(new JSONObject(saved));}catch(Exception e){reviewFileMessage("产业完整草稿未恢复，原件保留："+e.getMessage());}
          } else if (key.equals("researchRuns")) {
            openResearchRuns();
            try {
              String saved = state.getString("researchRunsState");
              if (saved != null) researchRunsScreen.restoreState(new JSONObject(saved));
            } catch (Exception e) { reviewFileMessage("研究阅读位置未恢复：" + e.getMessage()); }
          } else if (key.equals("scenarioTools")) {
            scenarioTools();
            try {
              String draft = state.getString("scenarioState");
              if (draft != null) scenarioScreen.restoreState(new JSONObject(draft));
            } catch (Exception e) {
              Toast.makeText(this, "情景草稿恢复失败；本机已保存草稿保留", Toast.LENGTH_LONG).show();
            }
          } else if (key.equals("rotation")) {
            rotation();rotationScreen.restore(state.getBundle("rotationState"));
          } else if(key.equals("cffexDisclosure")){
            openCffexDisclosure();try{String saved=state.getString("cffexState");if(saved!=null&&cffexScreen!=null)cffexScreen.restoreState(new JSONObject(saved));}catch(Exception e){reviewFileMessage("披露阅读未恢复，原文件保留："+e.getMessage());}
          } else if(key.equals("futuresMonitor")){
            openFuturesMonitor();try{if(futuresMonitorScreen!=null)futuresMonitorScreen.restoreState(new JSONObject(state.getString("futuresMonitorState","{}")));}catch(Exception e){reviewFileMessage("期货页面状态未恢复，归档保留");}
          } else if(key.equals("etfMonitor")){
            openEtfMonitor();try{if(etfMonitorScreen!=null)etfMonitorScreen.restoreState(new JSONObject(state.getString("etfMonitorState","{}")));}catch(Exception e){reviewFileMessage("ETF筛选未恢复，观测档案保留");}
          } else if (key.equals("etfDaily")) {
            etfDaily();etfScreen.restore(state.getBundle("etfState"));
          } else if (key.equals("darkStocks")) {
            darkStocks();darkStockScreen.restore(state.getBundle("darkStockState"));
          } else if (key.equals("funds")) {
            capitalScreen =
                new CapitalScreen(this, state.getString("fundId", str(instrument, "id")));
            capitalScreen.modes.setSelection(state.getInt("fundMode", 0));
            capitalScreen.show();
            capitalScreen.selectHistory(state.getString("fundDate", ""));
            capitalScreen.cursor.setProgress(
                state.getInt("fundCursor", capitalScreen.cursor.getMax()));
            Parcelable scroll = state.getParcelable("fundScroll");
            capitalScreen.list.post(() -> {
              if (scroll != null)
                capitalScreen.list.onRestoreInstanceState(scroll);
            });
          } else if (key.startsWith("auction:")) {
            String id = key.substring(8), name = id;
            for (JSONObject s : instruments)
              if (id.equals(s.optString("id")))
                name = s.optString("name");
            auctionScreen = new AuctionScreen(this, id, name);
            auctionScreen.phase.setSelection(state.getInt(key + ":phase", 0));
            auctionScreen.mode.setSelection(state.getInt(key + ":mode", 0));
            auctionScreen.show();
          }
        }
      String restored = state.getString("activePage", "");
      if (restored.equals("methodReport")) restored = "personMethod";
      View page = businessPages.get(restored);
      if(restored.equals("migrationStatus")&&page!=null)showPage(restored,"功能迁移总览",page);
      else if(restored.equals("aiSettings")&&page!=null)showPage(restored,"AI偏好 / 能力声明",page);
      else if(restored.equals("archiveVideo")&&page!=null)showPage(restored,"归档视频 / 逐字稿复核",page);
      else if(restored.equals("accountReference")&&page!=null)showPage(restored,"今日参考盈亏 / 成本比例",page);
      else if(restored.equals("accountEdit")&&page!=null)showPage(restored,"账户资料 / 手工现金",page);
      else if(restored.equals("auctionAnalysis")&&page!=null)showPage(restored,"竞价八形态 / 历史覆盖",page);
      else if(restored.equals("materialLibrary")&&page!=null)showPage(restored,"全量资料库 / 人工分类",page);
      else if(restored.equals("knowledgeAiHost")&&page!=null)showPage(restored,"资料研究请求 · 未就绪",page);
      else if(restored.equals("dataSourceStatus")&&page!=null)showPage(restored,"本机来源 / 时点",page);
      else if(restored.equals("paperMonitor")&&page!=null)showPage(restored,"人工纸面监控",page);
      else if(restored.equals("portfolioMirror")&&page!=null)showPage(restored,"持仓镜像 / 只读对账",page);
      else if(restored.equals("sectorResearch")&&page!=null)
        showPage(restored,"板块 / 产业外部研究",page);
      else if(restored.equals("quantResearch")&&page!=null)
        showPage(restored,"量化研究 / 历史模拟",page);
      else if(restored.equals("industryDiscovery")&&page!=null)
        showPage(restored,"行业概念发现",page);
      else if (page instanceof BusinessScreen)
        openBusiness(((BusinessScreen) page).kind);
      else if (page != null)
        showPage(restored, restored.equals("cffexDisclosure") ? "股指期货指定日披露" : restored.equals("futuresMonitor") ? "股指期货价量仓" : restored.equals("etfMonitor") ? "ETF盘中观察" : restored.equals("watchlistHost") ? "自选 / 分组" : restored.equals("watchlistWorkspace") ? "独立分组管理" : restored.equals("watchlistReconciliation") ? "主自选变化协调" : restored.equals("marketOverview") ? "市场全景 / 热度" : restored.equals("dataSafety") ? "数据位置 / 安全核验" : restored.equals("riskSettings") ? "风险阈值 / 本地提醒" : restored.equals("evidenceReview") ? "报告与候选复核" : restored.equals("personMethod") ? "人物与方法" : restored.equals("news") ? "市场资讯" : restored.equals("stockResearch") ? "个股研究" : restored.equals("commentWorkshop") ? "评论工坊" : restored.equals("sourceAnalysis") ? "分析材料" : restored.equals("sourceHandoff") ? "交接历史" : restored.equals("researchWorkbench") ? "研究编排 / 整批导入" : restored.equals("researchRuns") ? "历史报告" : restored.equals("sectorLeaders") ? "人工龙头" : restored.equals("sectors") ? "板块观察" : restored.equals("marketHome") ? "市场" : restored.equals("scenarioTools") ? "情景工具" : restored.equals("candidates") ? "本地候选" : restored.equals("recent") ? "最近查看" : restored.equals("darkStocks") ? "个股明暗盘" : restored.equals("etfDaily") ? "ETF申赎日报" : restored.equals("rotation") ? "明暗盘 / 轮动" : restored.equals("source") ? "作者来源" : restored.equals("funds") ? "资金" : "竞价", page);
      else if (state.getBoolean("detail"))
        resumeChart();
      else
        goHome();
    }
    if(state==null)try{watchlistBridgeRestoreViews();goHome();}catch(Exception e){reviewFileMessage("完整分组草稿未恢复，原文件保留："+e.getMessage());}
    installChartFullscreen(state);
    if (getIntent().getBooleanExtra("openCollection", false)) openBusiness("collection");
  }
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (intent.getBooleanExtra("openCollection", false)) openBusiness("collection");
  }
  @Override
  public void onResume() {
    super.onResume();
    paperMonitorActive("paperMonitor".equals(activePage));
    if(unifiedBackupScreen!=null)unifiedBackupScreen.setActive("unifiedBackup".equals(activePage));
    accountEditActive("accountEdit".equals(activePage));archiveVideoActive("archiveVideo".equals(activePage));
    etfMonitorActive("etfMonitor".equals(activePage));futuresMonitorActive("futuresMonitor".equals(activePage));cffexActive("cffexDisclosure".equals(activePage));
    if(dataSourceStatusScreen!=null)dataSourceStatusScreen.setActive("dataSourceStatus".equals(activePage));
    if(aiSettingsScreen!=null)aiSettingsScreen.setActive("aiSettings".equals(activePage));
    foreground = true;
    industryTopicActive("industryTopic".equals(activePage));
    try{if(android.os.Build.VERSION.SDK_INT>=35&&new File(industryTopicDirectory(),"state.json").isFile())ensureIndustryTopicRuntime().start();}catch(Exception e){reviewFileMessage("产业持久执行未恢复："+e.getMessage());}
    researchWorkbenchActive("researchWorkbench".equals(activePage));getWindow().getDecorView().post(this::drainResearchWorkbenchDocuments);
    if(chartFullscreen!=null)chartFullscreen.resume();
    getWindow().getDecorView().post(this::drainCreatorAiDocuments);
    knowledgeAiHostActive("knowledgeAiHost".equals(activePage));
    rotationActive("rotation".equals(activePage));
    getWindow().getDecorView().post(this::drainRotationDocuments);
    if(newsScreen!=null)newsScreen.setActive("news".equals(activePage));
    if(candidateScreen!=null)candidateScreen.visibleChanged("candidates".equals(activePage));
    if(sectorScreen!=null)sectorScreen.setActive("sectors".equals(activePage));
    if(marketOverviewScreen!=null)marketOverviewScreen.setActive("marketOverview".equals(activePage));
    if(discoveryScreen!=null)discoveryScreen.setActive("industryDiscovery".equals(activePage));
    if(leaderScreen!=null)leaderScreen.setActive("sectorLeaders".equals(activePage));
    // The saved ETF plan belongs to the foreground application, not an open tab.
    if (etfScreen == null) etfScreen = new EtfScreen(this);
    etfScreen.resumeSchedule();
    if (feed != null) {
      syncLive(false);
      refreshHandler.removeCallbacks(refreshLoop);
      refreshHandler.post(refreshLoop);
      refreshHandler.removeCallbacks(sampleLoop);
      refreshHandler.post(sampleLoop);
    }
  }
  @Override
  public void onPause() {
    industryTopicActive(false);if(industryTopicRuntime!=null)industryTopicRuntime.stop();
    if(f07Pickers.size()==0)revokeResearchWorkbenchPickers();researchWorkbenchActive(false);
    if(chartFullscreen!=null)chartFullscreen.pause();
    creatorAiPause();
    knowledgeAiHostActive(false);
    rotationActive(false);
    paperMonitorActive(false);
    if(unifiedBackupScreen!=null&&!unifiedBackupScreen.pickerInFlight())unifiedBackupScreen.setActive(false);
    etfMonitorActive(false);futuresMonitorActive(false);cffexActive(false);accountEditActive(false);archiveVideoActive(false);
    try{if(businessPages.containsKey("watchlistHost")||watchlistWorkspaceScreen!=null||watchlistReconciliationScreen!=null)watchlistBridgeSaveViews();}catch(Exception e){reviewFileMessage("分组完整草稿未保存："+e.getMessage());}
    if(dataSourceStatusScreen!=null)dataSourceStatusScreen.setActive(false);
    if(materialLibraryScreen!=null)materialLibraryScreen.persist();
    if(aiSettingsScreen!=null){aiSettingsScreen.saveState();aiSettingsScreen.setActive(false);}
    if(riskSettingsScreen!=null)try { riskSettingsScreen.saveState(); }
    catch(Exception e) { reviewFileMessage("风险设置草稿未保存："+e.getMessage()); }
    if(personMethodScreen!=null)try { personMethodScreen.saveState(); }
    catch(Exception e) { reviewFileMessage("人物方法草稿未保存：" + e.getMessage()); }
    if(newsScreen!=null) {
      try { newsScreen.saveState(); } catch(Exception e) { reviewFileMessage("资讯草稿未保存：" + e.getMessage()); }
      newsScreen.setActive(false);
    }
    if(stockResearchScreen!=null)try { stockResearchScreen.saveState(); }
    catch(Exception e) { reviewFileMessage("个股研究草稿未保存：" + e.getMessage()); }
    if(leaderScreen!=null)leaderScreen.setActive(false);
    if(candidateScreen!=null)candidateScreen.visibleChanged(false);
    if(sectorScreen!=null)sectorScreen.setActive(false);
    if(marketOverviewScreen!=null)marketOverviewScreen.setActive(false);
    if(discoveryScreen!=null)discoveryScreen.setActive(false);
    if (etfScreen != null) etfScreen.pauseSchedule();
    if (sourceScreen != null) sourceScreen.leave();
    if (darkStockScreen != null) darkStockScreen.cancel();
    foreground = false;
    refreshHandler.removeCallbacks(refreshLoop);
    refreshHandler.removeCallbacks(sampleLoop);
    super.onPause();
  }
  @Override
  public void onDestroy() {
    if(industryTopicScreen!=null)industryTopicScreen.close();if(industryTopicRuntime!=null)industryTopicRuntime.close();
    researchWorkbenchNavigateAway();
    if(chartFullscreen!=null)chartFullscreen.close();
    creatorAiClose();
    if(knowledgeAiHostScreen!=null)knowledgeAiHostScreen.close();
    paperMonitorActive(false);
    if(unifiedBackupLane!=null)unifiedBackupLane.closeOwner();
    unifiedBackupPickerOwner=null;
    if(unifiedBackupScreen!=null)unifiedBackupScreen.dispose();
    if(archiveVideoScreen!=null)archiveVideoScreen.close();
    disposeCffexDisclosure();disposeFuturesMonitor();etfRefreshToken="";if(etfMonitorScreen!=null)etfMonitorScreen.close();
    if(dataSourceStatusScreen!=null)dataSourceStatusScreen.close();
    if(aiSettingsScreen!=null)aiSettingsScreen.close();
    if(personMethodStore!=null)personMethodStore.close();
    if(newsScreen!=null)newsScreen.close();
    if(stockResearchStore!=null)stockResearchStore.close();
    if(leaderScreen!=null)leaderScreen.close();
    if(sectorScreen!=null)sectorScreen.close();
    if(marketOverviewScreen!=null)marketOverviewScreen.close();
    if(discoveryScreen!=null)discoveryScreen.close();
    if(candidateScreen!=null)candidateScreen.close();
    if(recentScreen!=null)recentScreen.close();
    if(darkStockScreen!=null)darkStockScreen.close();
    if(etfScreen!=null)etfScreen.close();
    if(rotationScreen!=null)rotationScreen.close();
    if (sourceScreen != null) sourceScreen.close();
    refreshHandler.removeCallbacksAndMessages(null);
    if (feed != null)
      feed.close();
    if (collectionService != null) collectionService.forget(collectionObserver);
    if (collectionBound) unbindService(collectionConnection);
    if (businessStore != null)
      businessStore.close();
    super.onDestroy();
  }
  void refreshLive() {
    if (feed == null)
      return;
    if (instruments.isEmpty()) {
      status.setText("请在“我的”导入自选清单或添加标的");
      return;
    }
    feed.refreshQuotes();
    if (detail && activePage.isEmpty()) {
      feed.chart(str(instrument, "id"), period, true);
      if (reference.getVisibility() == View.VISIBLE)
        feed.chart(str(instrument, "id"), "week", true);
    }
    refreshVisibleMinute();
  }
  private void refreshVisibleMinute() {
    if (!foreground || feed == null || isFinishing() || isDestroyed())
      return;
    String id = "";
    if ("sectorLeaders".equals(activePage) && leaderScreen != null)
      id = leaderScreen.minuteObservationId();
    else if ("sectors".equals(activePage) && sectorScreen != null)
      id = sectorScreen.minuteObservationId();
    if (id.isEmpty())
      return;
    for (JSONObject item : feed.instruments)
      if (id.equals(item.optString("id"))) {
        feed.chart(id, "minute", true);
        break;
      }
  }
  void syncLive(boolean changed) {
    if (isFinishing() || isDestroyed())
      return;
    pendingLiveRosterChange |= changed;
    if (!foreground || feed == null)
      return;
    changed = pendingLiveRosterChange;
    pendingLiveRosterChange = false;
    String id = str(instrument, "id");
    instruments.clear();
    instruments.addAll(feed.instruments);
    if (changed)
      makeGroups();
    if (detail && activePage.isEmpty()) {
      boolean found = false;
      for (JSONObject s : instruments)
        if (id.equals(str(s, "id")))
          found = true;
      if (!found)
        goHome();
    }
    filter();
    for (JSONObject s : instruments)
      if (id.equals(str(s, "id")))
        instrument = s;
    if (detail && activePage.isEmpty()) {
      boolean keepReference = inspected == reference && reference.getVisibility() == View.VISIBLE;
      updateChart(false);
      reference.vwapRows=MarketData.array(instrument,"week");reference.vwapMeta=MarketData.obj(instrument,"weekMeta");reference.vwapPeriod="week";
      reference.bindAnnotations(reference.vwapRows,reference.vwapMeta,str(instrument,"id"),"week");
      reference.setSeries(series(instrument, "week"), "周K", false);
      configure();
      if (keepReference && reference.getVisibility() == View.VISIBLE)
        readFrom(reference, reference.selected);
    }
    if (capitalScreen != null && capitalScreen.isShowing())
      capitalScreen.render();
    for (View page : businessPages.values())
      if (page instanceof AuctionScreen && page.isShown())
        ((AuctionScreen) page).render();
    if (recentScreen != null) try {
      JSONArray quotes = new JSONArray();
      for (JSONObject item : instruments) quotes.put(recentRecord(item));
      String snapshot = quotes.toString();
      if (!snapshot.equals(recentQuoteSnapshot)) { recentScreen.applyQuotes(quotes); recentQuoteSnapshot = snapshot; }
    } catch (Exception e) { recentScreen.state.setText("最近报价未保存：" + e.getMessage()); }
    if (sectorScreen != null && "sectors".equals(activePage))
      for (JSONObject item : instruments) sectorScreen.updateInstrument(item);
    if (leaderScreen != null && "sectorLeaders".equals(activePage))
      for (JSONObject item : instruments) leaderScreen.updateInstrument(item);
  }
  JSONObject currentQuote(JSONObject s) {
    if (!testing)
      return MarketData.obj(s, "quote");
    JSONArray a = MarketData.array(s, "day");
    if (a.length() < 2)
      return new JSONObject();
    try {
      JSONObject q = new JSONObject(a.getJSONObject(a.length() - 1).toString());
      double prev = a.getJSONObject(a.length() - 2).getDouble("close");
      return q.put("price", q.getDouble("close"))
          .put("source", "设计模拟 · 非实时")
          .put("previousClose", prev)
          .put("changePercent", (q.getDouble("close") / prev - 1) * 100);
    } catch (Exception e) {
      return new JSONObject();
    }
  }
  String sourceLabel(String p) {
    if (testing)
      return "内置设计模拟 · 非实时";
    JSONObject q = currentQuote(instrument), m = MarketData.obj(instrument, p + "Meta");
    String quoteTime = q.optString("tradeDate") + " " + q.optString("tradeTime");
    return "新浪报价 " + (quoteTime.trim().isEmpty() ? "未取得" : quoteTime)
        + (q.optBoolean("cached") ? " · 旧缓存" : "") + "\n" + m.optString("source", "本周期待加载")
        + " " + m.optString("dataDate")
        + (p.startsWith("minute")                         ? ""
                : "qfq".equals(m.optString("adjustment")) ? " · 前复权"
                                                          : " · 不复权")
        + (m.optBoolean("cached") ? " · 旧缓存" : "")
        + (m.optInt("offSessionCount") > 0
                ? "\n常规分时不含源返回的 " + m.optInt("offSessionCount") + " 个盘外点"
                : "")
        + "\n取得时间 " + m.optString("checkedAt", "—") + "\n保存状态 "
        + (m.optString("persistenceState").equals("saved") ? "已保存 " + m.optString("persistedAt")
                : m.optString("persistenceState").equals("pending") ? "已取得 · 保存中"
                : m.optString("persistenceState").equals("failed")
                ? "更新未保存 · 保留已有数据：" + m.optString("persistenceError")
                : "旧版缓存 / 尚未入库")
        + (m.optString("historyBoundary").isEmpty() ? "" : "\n" + m.optString("historyBoundary"))
        + (q.optString("persistenceState").equals("failed") ? "\n报价未保存" : "")
        + (!m.optString("error").isEmpty() ? "\n" + m.optString("error") : "")
        + (!q.optString("error").isEmpty() ? "\n" + q.optString("error") : "")
        + (p.startsWith("minute") && !p.equals("minute")
                ? "\n" + instrument.optString("samplingStatus")
                : "");
  }
  String bookText() {
    if (str(instrument, "id").contains(":index:"))
      return "指数没有可成交的买卖五档，此项不适用。";
    JSONObject q = currentQuote(instrument);
    StringBuilder text = new StringBuilder("新浪五档快照 · 数量为股\n" + q.optString("tradeDate")
        + " " + q.optString("tradeTime") + (q.optBoolean("cached") ? " · 旧缓存" : "") + "\n");
    for (int n = 0; n < 10; n++) {
      boolean sell = n < 5;
      int level = sell ? 4 - n : n - 5;
      JSONObject row = MarketData.array(q, sell ? "asks" : "bids").optJSONObject(level);
      double p = row == null ? Double.NaN : row.optDouble("price"),
             v = row == null ? Double.NaN : row.optDouble("volume");
      text.append("\n")
          .append(sell ? "卖" : "买")
          .append(level + 1)
          .append("    ")
          .append(price(instrument, p))
          .append("    ")
          .append(Double.isFinite(v) ? String.format(Locale.ROOT, "%.0f", v) : "—");
    }
    return text.toString();
  }
  TextView text(String s, int size, int color) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(color);
    return t;
  }
  Button add(LinearLayout parent, String s, Runnable run) {
    Button b = new Button(this);
    b.setText(s);
    b.setTextSize(13);
    b.setAllCaps(false);
    b.setPadding(0, 0, 0, 0);
    b.setMinWidth(0);
    b.setMinimumWidth(0);
    b.setMinHeight(dp(48));
    b.setBackgroundResource(android.R.drawable.list_selector_background);
    parent.addView(b, new LinearLayout.LayoutParams(0, dp(48), 1));
    b.setOnClickListener(v -> {if(fullscreenControl(v))run.run();});
    return b;
  }
// MainActivity fields. Existing "group" becomes stable ID; empty string means all.
WatchlistWorkspaceStore watchlistGroupStore;
WatchlistWorkspaceScreen watchlistWorkspaceScreen;
WatchlistReconciliationScreen watchlistReconciliationScreen;
JSONObject watchlistInitPacket=new JSONObject();
JSONArray watchlistImportedGroupEvidence=null; // only explicitly verified source config records
String watchlistBridgeError="";
boolean watchlistViewRestoreFailed=false;
boolean watchlistLegacyMode=true;

// Insert these methods inside MainActivity. Do not rewrite lifecycle/chart/auction functions.
void requireWatchlistUi()throws Exception {
  BusinessStore.require(android.os.Looper.myLooper()==android.os.Looper.getMainLooper(),"主自选捕获及组侧库操作须在宿主主线程串行执行");
}
String watchlistBridgeFilename(){return testing?"watchlist-workspace-tests-v35.sqlite":"watchlist-workspace-v35.sqlite";}
JSONObject watchlistBridgeRead(JSONObject inputs)throws Exception{if(!new java.io.File(getFilesDir(),watchlistBridgeFilename()).exists())return new JSONObject().put("schema","watchlist-workspace-store-result/v1").put("state","uninitialized");return watchlistBridgeStore().read(inputs);}
WatchlistWorkspaceStore watchlistBridgeStore()throws Exception{return watchlistBridgeStore(false);}
WatchlistWorkspaceStore watchlistBridgeStore(boolean create)throws Exception {
  requireWatchlistUi();
  BusinessStore.require(create||new java.io.File(getFilesDir(),watchlistBridgeFilename()).exists(),"未明确初始化，普通读取不创建侧库");
  if(watchlistGroupStore==null)watchlistGroupStore=new WatchlistWorkspaceStore(this,watchlistBridgeFilename());
  return watchlistGroupStore;
}
JSONObject watchlistBridgeCapture()throws Exception {
  requireWatchlistUi();JSONArray current=new JSONArray();JSONObject colors=new JSONObject();
  for(JSONObject row:instruments){current.put(row);if(row.optBoolean("transient"))continue;String label=row.optString("group");
    if(prefs.contains("groupColor/"+label)){int color=prefs.getInt("groupColor/"+label,0);
      colors.put(label,android.graphics.Color.alpha(color)==255?String.format(java.util.Locale.ROOT,"#%06x",color&0xffffff):"未核验ARGB透明识别色");
    }
  }
  JSONObject evidence=new JSONObject().put("nativeLocalSingletonContract",true).put("localColors",colors);
  if(watchlistImportedGroupEvidence!=null)evidence.put("importedGroups",watchlistImportedGroupEvidence);
  return WatchlistHostAdapter.inputs(current,evidence);
}
JSONObject watchlistBridgeLegacyDirectory()throws Exception {
  JSONArray options=new JSONArray().put(new JSONObject().put("groupId","").put("name","全部").put("displayName","全部").put("color","").put("readOnly",true).put("memberIds",new JSONArray()));
  java.util.LinkedHashSet<String> names=new java.util.LinkedHashSet<>();for(JSONObject row:instruments)if(!row.optBoolean("transient"))names.add(row.optString("group"));
  String selected="",selectedName="全部自选";JSONArray chosen=new JSONArray();
  for(String name:names){if(name.equals("全部"))continue;JSONArray members=new JSONArray();for(JSONObject row:instruments)if(!row.optBoolean("transient")&&row.optString("group").equals(name))members.put(row.get("id"));
    String shade=prefs.contains("groupColor/"+name)?String.format(java.util.Locale.ROOT,"#%06x",prefs.getInt("groupColor/"+name,0)&0xffffff):"";
    options.put(new JSONObject().put("groupId",name).put("selectorKind","legacy-name").put("name",name).put("displayName",name).put("color",shade).put("readOnly",false).put("memberIds",members));
    if(name.equals(group)){selected=name;selectedName=name;chosen=members;}
  }return new JSONObject().put("schema","watchlist-host-directory/v1").put("state","uninitialized").put("mode","legacy-native-label").put("options",options).put("selectedGroupId",selected).put("selectedName",selectedName).put("memberIds",chosen).put("requiresReconciliation",false);
}
JSONObject watchlistBridgeDirectory() {
  try{JSONObject capture=watchlistBridgeCapture(),result=watchlistBridgeRead(capture.getJSONObject("inputs"));
    JSONObject view=result.getString("state").equals("uninitialized")?watchlistBridgeLegacyDirectory():WatchlistHostAdapter.directory(result,watchlistLegacyMode?"":group);watchlistBridgeError=WatchlistHostAdapter.diagnostics(capture);
    if(result.getString("state").equals("uninitialized"))watchlistBridgeError="本机分组尚未显式初始化。\n"+watchlistBridgeError;
    if(result.getString("state").equals("needsReconciliation"))watchlistBridgeError="主自选范围已变，关联需显式协调；旧关系未删除。\n"+watchlistBridgeError;
    return view.put("reason",watchlistBridgeError);
  }catch(Exception e){watchlistBridgeError=e.getMessage();try{return watchlistBridgeLegacyDirectory().put("state","unavailable").put("reason",watchlistBridgeError);}catch(Exception impossible){throw new IllegalStateException(impossible);}}
}
void makeGroups() {
  JSONObject view=watchlistBridgeDirectory();group=view.optString("selectedGroupId","");watchlistLegacyMode=view.optString("mode").equals("legacy-native-label");
  groupRow.removeAllViews();JSONArray options=view.optJSONArray("options");
  for(int i=0;i<options.length();i++){JSONObject o=options.optJSONObject(i);String id=o.optString("groupId"),name=o.optString("displayName");
    if(!id.isEmpty()&&(o.optString("name").equals("全部")||o.optString("name").equals("全部自选")))name+=" · "+id;
    Button b=new Button(this);b.setText(name);b.setTag("watchlist-group:"+id);b.setAllCaps(false);b.setTextSize(14);b.setMinHeight(dp(48));b.setMinWidth(dp(66));b.setMinimumWidth(dp(66));b.setPadding(dp(12),0,dp(12),0);
    String shade=o.optString("color");b.setTextColor(watchlistLegacyMode?(id.equals(group)?prefs.getInt("groupColor/"+o.optString("name"),blue):muted):shade.isEmpty()?(id.equals(group)?blue:muted):android.graphics.Color.parseColor(shade));
    b.setContentDescription(id+"\n"+(watchlistLegacyMode?"旧本机标签，尚未生成持久ID":id.isEmpty()?"主自选过滤":o.optBoolean("readOnly")?"来源只读":"本地组")+"\n"+view.optString("reason"));
    b.setBackground(tabBackground(id.equals(group)));b.setTypeface(null,id.equals(group)?android.graphics.Typeface.BOLD:android.graphics.Typeface.NORMAL);groupRow.addView(b,new LinearLayout.LayoutParams(-2,dp(48)));
    b.setOnClickListener(v->{group=id;if(!watchlistLegacyMode)prefs.edit().putString("watchlistWorkspace/groupId",id).apply();makeGroups();filter();});
  }
}
void openWatchlistHost() {
  try{requireWatchlistUi();String key="watchlistHost";View existing=businessPages.get(key);
    if(existing!=null){((TextView)existing.findViewWithTag("watchlistHostState")).setText(watchlistBridgeDirectory().optString("state")+"\n"+watchlistBridgeError);showPage(key,"自选 / 分组",existing);return;}
    LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);
    TextView state=new TextView(this);state.setTag("watchlistHostState");state.setTextSize(13);box.addView(state);
    ScrollView scroll=new ScrollView(this);TextView text=new TextView(this);text.setTextSize(13);text.setTextIsSelectable(true);scroll.addView(text);box.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    CheckBox ack=new CheckBox(this);ack.setText("已核对本机旧组，生成稳定ID到独立组库");ack.setTag("watchlistInitAck");box.addView(ack);
    LinearLayout bar=new LinearLayout(this);box.addView(bar);
    java.util.function.BiConsumer<String,Runnable> add=(title,action)->{Button b=new Button(this);b.setText(title);b.setTextSize(11);bar.addView(b,new LinearLayout.LayoutParams(0,dp(48),1));b.setOnClickListener(v->action.run());};
    add.accept("预览初始化",()->{try{JSONObject capture=watchlistBridgeCapture();state.setText(WatchlistHostAdapter.diagnostics(capture));BusinessStore.require(watchlistBridgeRead(capture.getJSONObject("inputs")).getString("state").equals("uninitialized"),"已有配置，未按旧名称重投影");
      watchlistInitPacket=WatchlistHostAdapter.initializationPreview(capture);ack.setChecked(false);text.setText(watchlistInitPacket.toString(2));
    }catch(Exception e){state.setText(e.getMessage());}});
    add.accept("确认初始化",()->{try{BusinessStore.require(watchlistInitPacket.length()>0&&ack.isChecked(),"先预览并明确确认初始化");JSONObject captured=watchlistBridgeCapture();
      BusinessStore.require(WatchlistWorkspaceModel.equal(WatchlistHostAdapter.initializationPreview(captured),watchlistInitPacket),"初始化预览后主自选或旧组证据已变");
      JSONObject result=watchlistBridgeStore(true).initialize(WatchlistHostAdapter.requireInputs(captured));WatchlistHostAdapter.verifyInitialization(watchlistInitPacket,result);
      watchlistInitPacket=new JSONObject();ack.setChecked(false);makeGroups();filter();state.setText("独立侧库回读确认初始化；主清单和报价未写。");
    }catch(Exception e){state.setText(e.getMessage());}});
    add.accept("取消预览",()->{watchlistInitPacket=new JSONObject();ack.setChecked(false);text.setText("");});
    LinearLayout actions=new LinearLayout(this);box.addView(actions);
    for(String label:new String[]{"编辑分组","显式协调","显示 / 隐藏","行情 / 导入导出"}){Button b=new Button(this);b.setText(label);actions.addView(b,new LinearLayout.LayoutParams(0,dp(48),1));b.setOnClickListener(v->{if(label.equals("编辑分组"))openWatchlistWorkspace();else if(label.equals("显式协调"))openWatchlistReconciliation();else if(label.equals("显示 / 隐藏"))manageVisibility();else liveMenu();});}
    state.setText(watchlistBridgeDirectory().optString("state")+"\n"+watchlistBridgeError);showPage(key,"自选 / 分组",box);
  }catch(Exception e){Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();}
}
JSONObject watchlistBridgeSnapshot()throws Exception {
  JSONObject result=watchlistBridgeRead(watchlistBridgeCapture().getJSONObject("inputs"));
  BusinessStore.require(result.getString("state").equals("ready"),"先显式初始化或协调主自选；旧关系仍保留");return result.getJSONObject("snapshot");
}
void openWatchlistWorkspace() {
  try{watchlistBridgeSnapshot();if(watchlistWorkspaceScreen==null)watchlistWorkspaceScreen=new WatchlistWorkspaceScreen(this,this::watchlistBridgeSnapshot,p->{
      // Main-thread contract: capture + store.save must not permit roster reentrancy.
      requireWatchlistUi();JSONObject saved=watchlistBridgeStore().save(p,watchlistBridgeCapture().getJSONObject("inputs"));makeGroups();filter();return saved;
    });watchlistWorkspaceScreen.setBackupActions(()->exportReviewFile("自选分组备份.json","application/json",watchlistWorkspaceScreen.exportBackupBytes()),()->chooseReviewImport(459));watchlistWorkspaceScreen.setDarkTheme(dark);showPage("watchlistWorkspace","独立分组管理",watchlistWorkspaceScreen);
  }catch(Exception e){Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();}
}
void openWatchlistReconciliation() {
  try{watchlistBridgeStore();if(watchlistReconciliationScreen==null){WatchlistReconciliationStore store=new WatchlistReconciliationStore(this,watchlistGroupStore.filePath().getName());
      watchlistReconciliationScreen=new WatchlistReconciliationScreen(this,store,()->watchlistBridgeCapture().getJSONObject("inputs"),(packet,ack)->{
        requireWatchlistUi();JSONObject result=store.confirm(packet,watchlistBridgeCapture().getJSONObject("inputs"),ack,java.time.Instant.now().toString());makeGroups();filter();return result;
      });}
    watchlistReconciliationScreen.setDarkTheme(dark);showPage("watchlistReconciliation","主自选变化协调",watchlistReconciliationScreen);
  }catch(Exception e){Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();}
}
void groupColor() { openWatchlistWorkspace(); }
void watchlistBridgeSaveViews()throws Exception {
  requireWatchlistUi();BusinessStore.require(!watchlistViewRestoreFailed,"分组旧界面草稿未恢复，原界面文件保留");
  JSONObject state=new JSONObject().put("schema","watchlist-host-ui-state/v1").put("initialization",watchlistInitPacket).put("selectedGroupId",group).put("selectorMode",watchlistLegacyMode?"legacy-native-label":"persistent-group-id");
  if(watchlistWorkspaceScreen!=null)state.put("workspace",watchlistWorkspaceScreen.saveViewState());
  if(watchlistReconciliationScreen!=null)state.put("reconciliation",watchlistReconciliationScreen.saveViewState());
  new WatchlistHostAdapterState(this,testing).save(state);
}
void watchlistBridgeRestoreViews()throws Exception {
  requireWatchlistUi();try{JSONObject state=new WatchlistHostAdapterState(this,testing).read();if(state.length()==0)return;BusinessStore.require(state.getString("schema").equals("watchlist-host-ui-state/v1"),"分组界面状态格式失效");
    watchlistInitPacket=state.optJSONObject("initialization");if(watchlistInitPacket==null)watchlistInitPacket=new JSONObject();group=state.optString("selectedGroupId","");watchlistLegacyMode=state.optString("selectorMode").equals("legacy-native-label");makeGroups();
    String previous=activePage;boolean wasDetail=detail;
    if(state.optJSONObject("workspace")!=null){openWatchlistWorkspace();BusinessStore.require(watchlistWorkspaceScreen!=null,"旧分组草稿暂不能恢复；原文件保留");watchlistWorkspaceScreen.restoreViewState(state.getJSONObject("workspace"));}
    if(state.optJSONObject("reconciliation")!=null){openWatchlistReconciliation();BusinessStore.require(watchlistReconciliationScreen!=null,"协调界面状态暂不能恢复");watchlistReconciliationScreen.restoreViewState(state.getJSONObject("reconciliation"));}
    if(!previous.isEmpty()&&businessPages.containsKey(previous))showPage(previous,title.getText().toString(),businessPages.get(previous));else if(wasDetail)resumeChart();else goHome();
    watchlistViewRestoreFailed=false;
  }catch(Exception e){watchlistViewRestoreFailed=true;throw e;}
}

  void filter() {
    if (adapter == null)
      return;
    visible.clear();
    JSONObject groupDirectory=watchlistBridgeDirectory();
    String q = search.getText().toString().trim();
    for (JSONObject s : instruments) {
      String id = str(s, "id");
      if (s.optBoolean("transient")) continue;
      if (!prefs.getBoolean("watch/" + id, true))
        continue;
      try {if(!WatchlistHostAdapter.includes(groupDirectory,id))continue;}catch(Exception e){status.setText("分组过滤未确认："+e.getMessage());continue;}
      if (!q.isEmpty() && !str(s, "name").contains(q) && !id.contains(q))
        continue;
      visible.add(s);
    }
    adapter.notifyDataSetChanged();
    gridAdapter.notifyDataSetChanged();
    findViewById(R.id.empty).setVisibility(visible.isEmpty() ? View.VISIBLE : View.GONE);
    status.setText(testing ? "设计模拟 · 非实时  |  " + visible.size() + "只  |  独立离线运行"
                           : "新浪公开报价 · 独立联网 | 每60秒 / 点刷新 | 点此查看时间");
    if (!testing)
      status.setOnClickListener(v
          -> new AlertDialog.Builder(this)
                 .setTitle("数据状态")
                 .setMessage(sourceLabel(period)
                     + ("\n\n仅自选报价定时更新；日/"
                         + "周K每次最多取640根，本机增量留存；分时按交易日归档。公开源无交易所实时保证。\n")
                     + feed.lastError)
                 .setPositiveButton("关闭", null)
                 .show());
    int rising = 0, falling = 0, missing = 0;
    String oldest = "", newest = "";
    for (JSONObject item : visible) {
      JSONObject qv = currentQuote(item);
      double change = qv.optDouble("changePercent");
      if (!Double.isFinite(change))
        missing++;
      String date = qv.optString("tradeDate");
      if (!date.isEmpty()) {
        if (oldest.isEmpty() || date.compareTo(oldest) < 0)
          oldest = date;
        if (date.compareTo(newest) > 0)
          newest = date;
      }
      if (change > 0)
        rising++;
      if (change < 0)
        falling++;
    }
    ((TextView) findViewById(R.id.marketOverview))
        .setText(visible.size() + "只　"
            + (testing ? "上涨 " + rising + " 下跌 " + falling + "｜模拟快照"
                    : oldest.equals(newest) ? "涨" + rising + " 跌" + falling + " 缺" + missing
                        + "｜" + (newest.isEmpty() ? "未取得报价" : newest)
                                            : "报价日期不一致，暂不汇总涨跌"));
  }
  List<Engine.Bar> series(JSONObject s, String p) {
    List<Engine.Bar> out = new ArrayList<>();
    JSONArray a = MarketData.array(s, p);
    for (int i = 0; i < a.length(); i++) {
      JSONObject b = a.optJSONObject(i);
      Engine.Bar x = new Engine.Bar(b.optDouble("time"), b.optDouble("open"), b.optDouble("high"),
          b.optDouble("low"), b.optDouble("close"), b.optDouble("volume"), b.optBoolean("valid"),
          b.optBoolean("closed"));
      x.label = b.optString("label");
      out.add(x);
    }
    return out;
  }
  void open(JSONObject s, boolean reset) {
    if(instrument!=null&&!str(instrument,"id").equals(str(s,"id"))){leaveChartFullscreen();chart.clearPendingViewport();}
    if(newsScreen!=null)newsScreen.setActive(false);
    if (!detail) {
      homeListState = stocks.onSaveInstanceState();
      homeGridState = stockGrid.onSaveInstanceState();
    }
    instrument = s;
    detail = true;
    findViewById(R.id.home).setVisibility(View.GONE);
    findViewById(R.id.detail).setVisibility(View.VISIBLE);
    findViewById(R.id.back).setVisibility(View.VISIBLE);
    title.setText(str(s, "name") + "  " + str(s, "id").split(":")[2]);
    chart.previousClose = testing ? s.optDouble("previousClose")
                                  : MarketData.obj(s, "minuteMeta").optDouble("previousClose");
    period(period);
    reference.vwapRows=MarketData.array(s,"week");reference.vwapMeta=MarketData.obj(s,"weekMeta");reference.vwapPeriod="week";
    reference.bindAnnotations(reference.vwapRows,reference.vwapMeta,str(s,"id"),"week");
    reference.annotationsEnabled=chart.annotationsEnabled;reference.vwapEnabled=chart.vwapEnabled;reference.vwapMode=chart.vwapMode;reference.vwapAnchor=chart.vwapAnchor;
    reference.setSeries(series(s, "week"), "周K", reset);
    reference.volumeLabel = testing ? "成交量 · 模拟股数" : "成交量 · 手（来源口径）";
    reference.live = !testing;
    reference.emaPeriod = chart.emaPeriod;
    reference.atrPeriod = chart.atrPeriod;
    reference.volumePeriod = chart.volumePeriod;
    reference.maType = chart.maType;
    reference.maPeriods = chart.maPeriods.clone();
    reference.macdFast = chart.macdFast;
    reference.macdSlow = chart.macdSlow;
    reference.macdSignal = chart.macdSignal;
    reference.kdjPeriod = chart.kdjPeriod;
    reference.rsiPeriod = chart.rsiPeriod;
    reference.cciPeriod = chart.cciPeriod;
    reference.overlay = chart.overlay;
    reference.indicator = chart.indicator;
    reference.nine = chart.nine;
    reference.recalculate();
    reference.dark = dark;
    reference.referencePane = true;
    reference.active = false;
    configure();
    if (feed != null && !sourceEvidenceNavigation)
      feed.chart(str(s, "id"), "week", false);
  }
  void period(String p) {
    period = p.equals("minute") && samplingSeconds > 0 ? "minute" + samplingSeconds + "s" : p;
    updateChart(true);
    if (feed != null && !sourceEvidenceNavigation)
      feed.chart(str(instrument, "id"), period, false);
  }
  void updateChart(boolean reset) {
    String p = period;
    chart.previousClose = testing
        ? instrument.optDouble("previousClose")
        : MarketData.obj(instrument, (p.startsWith("minute") ? p : "minute") + "Meta")
              .optDouble("previousClose");
    chart.volumeLabel = testing ? "成交量 · 模拟股数" : "成交量 · 手（来源口径）";
    if (p.equals("minute5s") || p.equals("minute30s"))
      chart.volumeLabel = "相邻快照成交增量 · 股 · 缺口不归桶";
    chart.live = !testing;
    chart.bookQuote = currentQuote(instrument);
    chart.precision = str(instrument, "id").contains(":etf:") ? 3 : 2;
    chart.vwapRows=MarketData.array(instrument,p);chart.vwapMeta=MarketData.obj(instrument,p+"Meta");chart.vwapPeriod=p;
    chart.bindAnnotations(chart.vwapRows,chart.vwapMeta,str(instrument,"id"),p);
    chart.setSeries(series(instrument, p),
        p.equals("minute")          ? "分时"
            : p.equals("minute5s")  ? "分时 · 本机5秒快照"
            : p.equals("minute30s") ? "分时 · 本机30秒快照"
            : p.equals("week")      ? "周K"
            : p.equals("month")     ? "月K"
            : p.equals("year")      ? "年K"
                                    : "日K",
        reset);
    JSONObject current = currentQuote(instrument);
    double last = current.optDouble("price"), prev = current.optDouble("previousClose"),
           pct = current.optDouble("changePercent");
    String price = price(instrument, last);
    SpannableString display = new SpannableString(price + "\n" + (last >= prev ? "+" : "")
        + price(instrument, last - prev)
        + (Double.isFinite(pct) ? String.format(Locale.ROOT, "   %+.2f%%", pct) : "   —"));
    display.setSpan(new android.text.style.RelativeSizeSpan(.48f), price.length(), display.length(),
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    quote.setText(display);
    quote.setTextColor(!Double.isFinite(pct) || pct == 0 ? muted : pct > 0 ? up : down);
    quote.setContentDescription(str(instrument, "name") + " " + price + " " + sourceLabel(p));
    ((TextView) findViewById(R.id.quoteStats))
        .setText("今开 " + price(instrument, current.optDouble("open")) + "  昨收 "
            + price(instrument, prev) + "\n最高 " + price(instrument, current.optDouble("high"))
            + "  最低 " + price(instrument, current.optDouble("low")) + "\n成交额 "
            + (Double.isFinite(current.optDouble("amount"))
                    ? String.format(Locale.ROOT, "%.2f亿", current.optDouble("amount") / 1e8)
                    : "—")
            + (testing ? " · 模拟" : " · " + current.optString("tradeTime")));
    read(chart.selected);
    refreshButtons();
    configure();
  }
  void refreshButtons() {
    for (int i = 0; i < periods.getChildCount(); i++) {
      if (periods.getChildAt(i) instanceof ChartPeriodBar) {
        ((ChartPeriodBar)periods.getChildAt(i)).refresh(period, dark);
        continue;
      }
      if (!(periods.getChildAt(i) instanceof Button)) continue;
      Button b = (Button) periods.getChildAt(i);
      boolean selected = b.getText().toString().equals(chart.period)
          || b.getText().toString().equals("分时") && period.startsWith("minute");
      b.setTextColor(selected ? blue : muted);
      b.setBackground(tabBackground(selected));
    }
    for (int i = 0; i < indicators.getChildCount(); i++) {
      if (!(indicators.getChildAt(i) instanceof Button)) continue;
      Button b = (Button) indicators.getChildAt(i);
      String s = b.getText().toString();
      b.setTextColor(s.equals(chart.indicator) || (s.equals("九转") && chart.nine) ? blue : muted);
      b.setBackground(tabBackground(s.equals(chart.indicator) || (s.equals("九转") && chart.nine)));
    }
    int at=Arrays.asList(INDICATORS).indexOf(chart.indicator);
    if (indicatorSelector != null && at >= 0 && indicatorSelector.getSelectedItemPosition()!=at) indicatorSelector.setSelection(at);
    if (indicatorSelector != null) {
      indicatorSelector.setBackground(tabBackground(true));
      if (indicatorSelector.getSelectedView() instanceof TextView) ((TextView)indicatorSelector.getSelectedView()).setTextColor(dark?0xffdce5f0:ink);
    }
  }
  void read(int i) {
    readFrom(chart, i);
  }
  void readFrom(MarketChart source, int i) {
    inspected = source;
    chart.active = source == chart;
    reference.active = source == reference;
    chart.invalidate();
    reference.invalidate();
    if (i < 0 || i >= source.bars.size()) {
      readout.setText("本周期暂无有效数据 · 可刷新重试");
      ((TextView) findViewById(R.id.notice))
          .setText(testing ? "暂无样本" : sourceLabel(period).replace('\n', ' ') + " ›");
      return;
    }
    Engine.Bar b = source.bars.get(i);
    if (!Engine.valid(b)) {
      readout.setText(b.label + "  数据缺口 / 不可用 · 不参与计算");
      ((TextView) findViewById(R.id.notice))
          .setText((testing ? "设计模拟 · 非实时｜" : "真实行情｜") + "数据缺口，不形成信号");
      return;
    }
    readout.setText(source.period + " " + b.label + "   开 " + price(instrument, b.open) + "   高 "
        + price(instrument, b.high) + "   低 " + price(instrument, b.low) + "\n收 "
        + price(instrument, b.close) + "   " + source.indicatorValues(i)
        + (b.closed ? "   已收盘" : "   形成中 · 未确认"));
    Engine.Seq seq = source.seq.get(i);
    JSONObject currentMeta =
        MarketData.obj(instrument, (source == reference ? "week" : period) + "Meta");
    String sourceDate = currentMeta.optString("dataDate");
    if (sourceDate.length() == 10)
      sourceDate = sourceDate.substring(5);
    String diskState = currentMeta.optString("persistenceState");
    String diskLabel = diskState.equals("saved") ? "已保存"
        : diskState.equals("pending")            ? "保存中"
        : diskState.equals("failed")             ? "未保存"
                                                 : "旧缓存";
    ((TextView) findViewById(R.id.notice))
        .setText((testing ? "模拟非实时｜"
                          : currentMeta.optString("source", "来源待确认") + " " + sourceDate
                             + (currentMeta.optBoolean("cached") ? " 缓存" : "") + " · " + diskLabel
                             + "｜")
            + "九转 " + seq.setup + " / C" + seq.countdown
            + (b.closed ? " · 历史条件" : " · 形成中，未确认") + " ›");
  }
  String explanation() {
    MarketChart source = inspected != null ? inspected : chart;
    int i = source.selected;
    if (i < 0 || i >= source.bars.size())
      return "本周期暂无有效数据，不计算信号。\n"
          + sourceLabel(source == reference ? "week" : period);
    Engine.Bar b = source.bars.get(i);
    Engine.Seq s = source.seq.get(i);
    if (!Engine.valid(b))
      return "这是一处数据缺口。该根不参与计算，不补零，指标从后续完整样本重新预热。";
    String state =
        b.closed ? "已收盘样本（不代表所有条件均已触发）" : "形成中预览，不登记为已确认信号";
    String out = str(instrument, "name") + " · " + b.label + " · " + source.period + "\n" + state
        + "\n\n开 " + num(b.open) + "   高 " + num(b.high) + "\n低 " + num(b.low) + "   收 "
        + num(b.close) + "\n\n" + source.indicatorTitle() + "规则与证据\nEMA(" + source.emaPeriod
        + ") = " + num(source.ema[i]) + "\n副图 = " + source.indicatorValues(i) + "\n";
    out+="\n关键位与历史事件\n"+source.annotationText(i)+"\n";
    if(source.vwapEnabled)out+="\nVWAP 主图与口径\n"+source.vwapText(i)+"\n";
    if (source.indicator.equals("MACD"))
      out += "MACD(" + source.macdFast + "," + source.macdSlow + "," + source.macdSignal
          + ")\nDIF = " + num(source.dif[i]) + "\nDEA = " + num(source.dea[i])
          + "\n柱 = 2 × (DIF − DEA)\n";
    else if (source.indicator.equals("ATR"))
      out += "ATR：TR取高低差及相对前收差的最大值，首N项均值起算，此后Wilder平滑。\n";
    else if (source.indicator.equals("RVOL"))
      out += "RVOL：当前成交量 / 前N根均量，不把当前量放入基准。\n";
    else if (source.indicator.equals("KDJ"))
      out += "KDJ：N根最高/最低计算RSV，K、D初始化50，按1/3平滑且每步保留2位；J=3K−2D，不截在0–100。未满N根仅初始化，非确认信号。\n";
    else if (source.indicator.equals("RSI"))
      out += "RSI：N根简单滚动涨额均值/绝对变动均值×100，非Wilder；首差记0，平价为100，未满周期不补值。\n";
    else if (source.indicator.equals("CCI"))
      out += "CCI：典型价(高+低+收)/3，N根简单均值与平均绝对偏差，系数0.015；中间4位、最终2位，负值保留。\n";
    else if (source.indicator.equals("OBV"))
      out += "OBV：全载入历史累计，首根量起算，收盘上涨加量、下跌减量、平收不变；单位沿来源，缩放不重置，真实缺口后重新起算。\n";
    out += "\n主图均线：本周期根数，周K10根即10周；各线独立预热。\n";
    for (int k = 0; k < source.maPeriods.length; k++)
      out += source.maType + "(" + source.maPeriods[k] + ") " + num(source.maData[k][i]) + "\n";
    if (source.indicator.equals("MACD") && i > 0 && Double.isFinite(source.dif[i - 1]) && Double.isFinite(source.dea[i - 1]))
      out += "\nMACD上穿："
          + (source.dif[i] > source.dea[i] && source.dif[i - 1] <= source.dea[i - 1] ? "条件满足"
                                                                                     : "未满足")
          + "\n条件：前根DIF≤DEA，本根DIF>DEA。\n";
    double[] rv = Engine.rvol(source.bars, source.volumePeriod),
             ph = Engine.priorHigh(source.bars, 20);
    out += "\n相对量能 = " + num(rv[i]) + " 倍\n前20根最高价 = " + num(ph[i]) + "\n严格突破："
        + (!Double.isFinite(ph[i]) ? "样本不足"
                : b.close > ph[i]  ? "条件满足"
                                   : "未满足")
        + "\n";
    out += "\n九转公开规则  1–9 / C1–C13\n当前准备 " + s.setup + "，计数 C" + s.countdown
        + (s.deferred ? "+（13对8未通过，延迟）" : "") + "\n准备9确认："
        + (s.setupTriggered ? "是" : "否") + "  C13确认：" + (s.cdTriggered ? "是" : "否")
        + ("\n严格价格翻转后与前4根收盘连续比较；9后与前2根高低非连续比较，13需通过对8检验。\nTDST"
            + "支撑 ")
        + num(s.support) + "（"
        + (!Double.isFinite(s.support) ? "未形成"
                : s.supportActive      ? "有效"
                                       : "已突破失效")
        + "）\nTDST阻力 " + num(s.resistance) + "（"
        + (!Double.isFinite(s.resistance) ? "未形成"
                : s.resistanceActive      ? "有效"
                                          : "已突破失效")
        + "）\n";
    for (String event : s.events)
      out += (b.closed ? "当根事件：" : "预览事件（未确认）：") + eventLabel(event) + "\n";
    return out + "\n来源：" + sourceLabel(source == reference ? "week" : period)
        + ("\n规则版本：sequential-public-rules-"
            + "v1\n未认证任何付费商业版等价；不是买卖建议或获利承诺。");
  }
  static String eventLabel(String event) {
    switch (event) {
      case "price-flip":
        return "严格价格翻转";
      case "setup-complete":
        return "准备序列达到9";
      case "setup-perfected":
        return "准备序列完善条件满足";
      case "countdown-complete":
        return "倒计数达到13";
      case "tdst-breached:resistance":
        return "阻力被突破，失效";
      case "tdst-breached:support":
        return "支撑被突破，失效";
      case "countdown-cancelled:data-gap":
        return "数据缺口，倒计数取消";
      case "countdown-cancelled:tdst-breach":
        return "TDST越界，倒计数取消";
      case "countdown-cancelled:opposite-setup":
        return "反向准备9完成，倒计数取消";
      case "countdown-recycled:setup-range":
        return "同向范围满足条件，倒计数重新开始";
      case "countdown-recycled:setup-22":
        return "同向准备达到22，倒计数重新开始";
      default:
        return event;
    }
  }
  void explain() {
    MarketChart source = inspected != null ? inspected : chart;
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setPadding(dp(20), dp(8), dp(20), dp(14));
    int i = source.selected;
    Engine.Bar b = i >= 0 && i < source.bars.size() ? source.bars.get(i) : null;
    if (b != null && Engine.valid(b)) {
      TextView meta =
          text(str(instrument, "name") + " · " + source.period + " · " + b.label, 13, ink);
      content.addView(meta);
      TextView state = text(b.closed ? "已收盘样本 · 条件仅描述历史" : "形成中 · 以下读数尚未确认",
          12, b.closed ? muted : 0xffb47c25);
      state.setPadding(0, dp(8), 0, dp(14));
      content.addView(state);
      double[] rv = Engine.rvol(source.bars, source.volumePeriod),
               ph = Engine.priorHigh(source.bars, 20);
      Engine.Seq s = source.seq.get(i);
      String[][] rows = {{source.indicatorTitle(), source.indicatorValues(i).replace("  ", "\n")},
          {"相对量能", num(rv[i]) + " 倍"},
          {"前20根最高价突破",
              !Double.isFinite(ph[i]) ? "样本不足"
                  : b.close > ph[i]   ? "条件满足"
                                      : "未满足"},
          {"九转准备 / 倒计数", s.setup + " / C" + s.countdown + (s.deferred ? "+" : "")}};
      for (String[] r : rows) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.addView(text(r[0], 13, muted), new LinearLayout.LayoutParams(0, dp(42), 1));
        TextView value = text(r[1], 14, ink);
        value.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        value.setMinHeight(dp(42));
        row.addView(value, new LinearLayout.LayoutParams(0, -2, 1));
        content.addView(row);
      }
    }
    TextView evidence = text(explanation(), 13, ink);
    evidence.setLineSpacing(dp(4), 1);
    evidence.setVisibility(View.GONE);
    Button expand = new Button(this);
    expand.setText("展开公式与全部依据");
    expand.setAllCaps(false);
    expand.setOnClickListener(v -> {
      boolean open = evidence.getVisibility() != View.VISIBLE;
      evidence.setVisibility(open ? View.VISIBLE : View.GONE);
      expand.setText(open ? "收起详细依据" : "展开公式与全部依据");
    });
    content.addView(expand);
    content.addView(evidence);
    content.addView(text("来源：" + sourceLabel(source == reference ? "week" : period)
            + "\n公开规则实现，不等于付费产品信号，不构成买卖建议。",
        11, muted));
    if (b == null || !Engine.valid(b))
      evidence.setVisibility(View.VISIBLE);
    ScrollView scroll = new ScrollView(this);
    scroll.addView(content);
    String key = "signal";
    View previous = businessPages.get(key);
    if (previous instanceof ScrollView) {
      ((ScrollView) previous).removeAllViews();
      scroll.removeView(content);
      ((ScrollView) previous).addView(content);
      showPage(key, "信号解释", previous);
    } else
      showPage(key, "信号解释", scroll);
  }
  static String validIndicator(String value) {
    return Arrays.asList(INDICATORS).contains(value) ? value : "MACD";
  }
  void selectIndicator(String value) {
    String choice=validIndicator(value);
    for (MarketChart target : new MarketChart[]{chart,reference}) {
      target.indicator=choice;
      target.recalculate();
    }
    prefs.edit().putString("indicator",choice).apply();
    refreshButtons();
    if (inspected != null) readFrom(inspected,inspected.selected);
  }
  void fitIndicatorToolbar() {
    if (indicatorSelector==null || indicators.getWidth()==0) return;
    boolean compact=indicators.getWidth()<dp(INDICATORS.length*56+128);
    for(int i=0;i<INDICATORS.length;i++) indicators.getChildAt(i).setVisibility(compact?View.GONE:View.VISIBLE);
    indicatorSelector.setVisibility(compact?View.VISIBLE:View.GONE);
    for(int i=INDICATORS.length+1;i<indicators.getChildCount();i++) {
      View child=indicators.getChildAt(i);
      LinearLayout.LayoutParams p=(LinearLayout.LayoutParams)child.getLayoutParams();
      if(p.width!=dp(64)||p.weight!=0) {p.width=dp(64);p.weight=0;child.setLayoutParams(p);}
    }
  }
  void parameters() {
    final long fullscreenTicket=chartFullscreen==null?0:chartFullscreen.ticket();
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(20), dp(12), dp(20), dp(10));
    NumberPicker[] picks = new NumberPicker[9];
    String[] names = {
        "EMA 参考周期", "ATR 周期", "相对量能参考周期", "MACD 快线", "MACD 慢线", "MACD 信号", "KDJ 周期", "RSI 周期", "CCI 周期"};
    int[] vals = {chart.emaPeriod, chart.atrPeriod, chart.volumePeriod, chart.macdFast,
        chart.macdSlow, chart.macdSignal, chart.kdjPeriod, chart.rsiPeriod, chart.cciPeriod};
    CheckBox overlay = new CheckBox(this);
    overlay.setText("显示主图均线");
    overlay.setChecked(chart.overlay);
    box.addView(overlay);
    Spinner type = new Spinner(this);
    type.setAdapter(new ArrayAdapter<String>(
        this, android.R.layout.simple_spinner_dropdown_item, new String[] {"MA", "EMA"}));
    type.setSelection(chart.maType.equals("EMA") ? 1 : 0);
    box.addView(text("均线算法 MA / EMA", 13, ink));
    box.addView(type);
    EditText ma = new EditText(this);
    String initial = Arrays.toString(chart.maPeriods).replace("[", "").replace("]", "");
    ma.setText(initial);
    ma.setHint("5,10,20,60，可手动添加");
    ma.setContentDescription("均线周期");
    box.addView(text("均线周期/根（1–500，逗号分隔，最多12条）", 13, ink));
    box.addView(ma);
    CheckBox annotationsOn=new CheckBox(this);annotationsOn.setText("显示关键位 / 历史事件（所选闭合周期）");annotationsOn.setTag("chartAnnotationsEnabled");annotationsOn.setChecked(chart.annotationsEnabled);box.addView(annotationsOn);
    CheckBox vwapOn=new CheckBox(this);vwapOn.setText("显示 VWAP 主图线");vwapOn.setContentDescription("VWAP主图开关");vwapOn.setChecked(chart.vwapEnabled);box.addView(vwapOn);
    String[] vwapModes={"legacy-close-approx","hlc3-approx","actual-amount"},vwapAnchors={"auto","session","loaded-window"};
    Spinner vwapMode=new Spinner(this),vwapAnchor=new Spinner(this);
    vwapMode.setContentDescription("VWAP计算口径");vwapAnchor.setContentDescription("VWAP累计范围");
    vwapMode.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"收盘价×量近似（旧口径）","HLC3×量近似","真实成交金额/量（缺数不回退）"}));
    vwapAnchor.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"自动：分时按日，K线按载入起点","按交易日（周/月/年不适用）","当前载入起点（非全日均价）"}));
    vwapMode.setSelection(Math.max(0,Arrays.asList(vwapModes).indexOf(chart.vwapMode)));vwapAnchor.setSelection(Math.max(0,Arrays.asList(vwapAnchors).indexOf(chart.vwapAnchor)));
    box.addView(text("VWAP 口径与累计范围",13,ink));box.addView(vwapMode);box.addView(vwapAnchor);
    box.addView(text("黄线为主图叠加。近似不是真实成交均价；真实模式缺金额、单位或连续记录时不回退。起点取当前载入数据而非缩放可见区。",12,muted));
    for (int i = 0; i < picks.length; i++) {
      LinearLayout row = new LinearLayout(this);
      row.setGravity(Gravity.CENTER_VERTICAL);
      row.addView(text(i == 0 ? "信号解释 EMA 参考周期" : names[i], 15, ink),
          new LinearLayout.LayoutParams(0, -2, 1));
      NumberPicker p = new NumberPicker(this);
      p.setContentDescription(names[i]);
      p.setMinValue(i < 3 ? 2 : 1);
      p.setMaxValue(i < 3 ? 120 : 500);
      p.setValue(vals[i]);
      p.setWrapSelectorWheel(false);
      picks[i] = p;
      row.addView(p, new LinearLayout.LayoutParams(dp(100), dp(90)));
      box.addView(row);
    }
    box.addView(text("DIF、DEA、柱各自预热；缺数不补零。快线需小于慢线。KDJ平滑固定3,3；OBV无周期，从全载入历史累计。", 12, muted));
    ScrollView scroller = new ScrollView(this);
    scroller.addView(box);
    AlertDialog dialog = new AlertDialog.Builder(this)
                             .setTitle("指标参数")
                             .setView(scroller)
                             .setNegativeButton("取消", null)
                             .setPositiveButton("应用", null)
                             .create();
    dialog.setOnShowListener(
        unused -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
          if(fullscreenTicket!=0&&(chartFullscreen==null||!chartFullscreen.accepts(fullscreenTicket))){dialog.dismiss();return;}
          int[] configured;
          try {
            configured = readMaPeriods(ma.getText().toString());
            if (picks[3].getValue() >= picks[4].getValue())
              throw new IllegalArgumentException("MACD快线必须小于慢线");
          } catch (Exception e) {
            ma.setError(e.getMessage());
            return;
          }
          chart.annotationsEnabled=annotationsOn.isChecked();
          chart.vwapEnabled=vwapOn.isChecked();chart.vwapMode=vwapModes[vwapMode.getSelectedItemPosition()];chart.vwapAnchor=vwapAnchors[vwapAnchor.getSelectedItemPosition()];
          chart.emaPeriod = picks[0].getValue();
          chart.atrPeriod = picks[1].getValue();
          chart.volumePeriod = picks[2].getValue();
          chart.overlay = overlay.isChecked();
          chart.maType = type.getSelectedItem().toString();
          chart.maPeriods = configured;
          chart.macdFast = picks[3].getValue();
          chart.macdSlow = picks[4].getValue();
          chart.macdSignal = picks[5].getValue();
          chart.kdjPeriod = picks[6].getValue();
          chart.rsiPeriod = picks[7].getValue();
          chart.cciPeriod = picks[8].getValue();
          prefs.edit()
              .putBoolean("chartAnnotations",chart.annotationsEnabled)
              .putBoolean("vwapEnabled",chart.vwapEnabled).putString("vwapMode",chart.vwapMode).putString("vwapAnchor",chart.vwapAnchor)
              .putInt("ema", chart.emaPeriod)
              .putInt("atr", chart.atrPeriod)
              .putInt("rvol", chart.volumePeriod)
              .putBoolean("overlay", chart.overlay)
              .putString("maType", chart.maType)
              .putString("maPeriods", ma.getText().toString())
              .putInt("macdFast", chart.macdFast)
              .putInt("macdSlow", chart.macdSlow)
              .putInt("macdSignal", chart.macdSignal)
              .putInt("kdj", chart.kdjPeriod)
              .putInt("rsi", chart.rsiPeriod)
              .putInt("cci", chart.cciPeriod)
              .apply();
          chart.recalculate();
          reference.annotationsEnabled=chart.annotationsEnabled;reference.vwapEnabled=chart.vwapEnabled;reference.vwapMode=chart.vwapMode;reference.vwapAnchor=chart.vwapAnchor;
          reference.emaPeriod = chart.emaPeriod;
          reference.atrPeriod = chart.atrPeriod;
          reference.volumePeriod = chart.volumePeriod;
          reference.maType = chart.maType;
          reference.maPeriods = chart.maPeriods.clone();
          reference.macdFast = chart.macdFast;
          reference.macdSlow = chart.macdSlow;
          reference.macdSignal = chart.macdSignal;
          reference.kdjPeriod = chart.kdjPeriod;
          reference.rsiPeriod = chart.rsiPeriod;
          reference.cciPeriod = chart.cciPeriod;
          reference.overlay = chart.overlay;
          reference.recalculate();
          readFrom(inspected, inspected.selected);
          dialog.dismiss();
        }));
    if(chartFullscreen!=null)chartFullscreen.trackDialog(dialog);
    dialog.show();
  }
  static int[] readMaPeriods(String csv) {
    LinkedHashSet<Integer> values = new LinkedHashSet<>();
    for (String word : csv.trim().split("[,;，\\s]+")) {
      int n = Integer.parseInt(word);
      if (n < 1 || n > 500)
        throw new IllegalArgumentException("均线周期需为1–500整数");
      values.add(n);
    }
    if (values.isEmpty() || values.size() > 12)
      throw new IllegalArgumentException("请设置1–12条均线");
    int[] out = new int[values.size()];
    int i = 0;
    for (int n : values) out[i++] = n;
    return out;
  }
  void manage() { openWatchlistHost(); }
  void manageVisibility() {
    List<JSONObject> members = new ArrayList<>();
    for (JSONObject item : instruments) if (!item.optBoolean("transient")) members.add(item);
    String[] names = new String[members.size()];
    boolean[] checked = new boolean[names.length];
    for (int i = 0; i < names.length; i++) {
      names[i] = str(members.get(i), "name");
      checked[i] = prefs.getBoolean("watch/" + str(members.get(i), "id"), true);
    }
    new AlertDialog.Builder(this)
        .setTitle("自选管理 · 本机独立保存")
        .setMultiChoiceItems(names, checked, (d, i, v) -> checked[i] = v)
        .setNeutralButton("分组识别色", (d, w) -> groupColor())
        .setNegativeButton("取消", null)
        .setPositiveButton("保存",
            (d, w) -> {
              SharedPreferences.Editor e = prefs.edit();
              for (int i = 0; i < checked.length; i++)
                e.putBoolean("watch/" + str(members.get(i), "id"), checked[i]);
              e.apply();
              filter();
            })
        .show();
  }
  void liveMenu() {
    new AlertDialog.Builder(this)
        .setTitle("本机自选与数据")
        .setItems(new String[] {"显示 / 隐藏自选与分组色", "添加股票 / 指数 / ETF", "导入自选清单",
                      "导出本机自选", "刷新真实行情", "来源与更新时间"},
            (d, n) -> {
              if (n == 0)
                manageVisibility();
              if (n == 1)
                addInstrument();
              if (n == 2)
                startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
                                           .setType("*/*")
                                           .addCategory(Intent.CATEGORY_OPENABLE),
                    401);
              if (n == 3)
                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT)
                                           .setType("application/json")
                                           .addCategory(Intent.CATEGORY_OPENABLE)
                                           .putExtra(Intent.EXTRA_TITLE, "native-watchlist.json"),
                    402);
              if (n == 4)
                refreshLive();
              if (n == 5)
                new AlertDialog.Builder(this)
                    .setTitle("真实数据与使用边界")
                    .setMessage(sourceLabel(period) + "\n\n本机自选及本次临时观察 " + instruments.size()
                        + (" 只。临时观察不写自选。报价每60秒或手动更新；后台不轮询。K线按需取得，最多640根；分时为来"
                            + "源提供的交易日。\n\n公开源可能延迟、限流或缺失，不承诺交易所实时性；"
                            + "无付费L2。安卓直接联网，不经过电脑。\n")
                        + feed.lastError)
                    .setPositiveButton("关闭", null)
                    .show();
            })
        .setNegativeButton("取消", null)
        .show();
  }
  void addInstrument() {
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(20), dp(8), dp(20), 0);
    Spinner market = new Spinner(this), type = new Spinner(this);
    market.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
        new String[] {"深圳 SZ", "上海 SH", "北京 BJ"}));
    type.setAdapter(new ArrayAdapter<>(
        this, android.R.layout.simple_spinner_dropdown_item, new String[] {"股票", "指数", "ETF"}));
    box.addView(market);
    box.addView(type);
    EditText code = new EditText(this), name = new EditText(this), groupInput = new EditText(this);
    code.setHint("六位证券代码");
    code.setInputType(2);
    name.setHint("自选名称");
    groupInput.setHint("分组名称");
    JSONObject selectedGroup=watchlistBridgeDirectory();
    groupInput.setText(selectedGroup.optString("selectedGroupId").isEmpty()?"默认分组":selectedGroup.optString("selectedName","默认分组"));
    box.addView(code);
    box.addView(name);
    box.addView(groupInput);
    AlertDialog dialog = new AlertDialog.Builder(this)
                             .setTitle("添加本机自选")
                             .setView(box)
                             .setNegativeButton("取消", null)
                             .setPositiveButton("添加", null)
                             .create();
    dialog.setOnShowListener(
        d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
          try {
            String ex = new String[] {"SZ", "SH", "BJ"}[market.getSelectedItemPosition()],
                   t = new String[] {"stock", "index", "etf"}[type.getSelectedItemPosition()],
                   c = code.getText().toString().trim(), nm = name.getText().toString().trim();
            JSONObject row = new JSONObject()
                                 .put("id", ex + ":" + t + ":" + c)
                                 .put("symbol", ex.toLowerCase(Locale.ROOT) + c)
                                 .put("name", nm)
                                 .put("group", groupInput.getText().toString().trim())
                                 .put("order", instruments.size());
            feed.add(row);
            prefs.edit().putBoolean("watch/" + row.getString("id"), true).apply();
            group = "全部";
            makeGroups();
            filter();
            refreshLive();
            dialog.dismiss();
          } catch (Exception e) {
            Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
          }
        }));
    dialog.show();
  }
  void stageBusinessPreview(JSONObject input, DataSafetyScreen.Work guard) throws Exception {
  pendingBusiness = new JSONObject(input.toString());
  BusinessStore.require(pendingBusiness.optString("schema").equals("native-business-v1"),
      "不支持的备份格式");
  LinearLayout page = new LinearLayout(this);
  page.setOrientation(LinearLayout.VERTICAL);
  TextView note = text(pendingBusiness.optString("mergePolicy").equals("keep-existing")
          ? "旧库迁移：同ID跳过，保留本机编辑。仅用于同一旧库；删除后再次导入会恢复。合并前自动保存恢复前快照。"
          : "备份预览：同ID将更新，其他记录保留。合并前自动保存本机恢复前快照。",
      13, ink);
  page.addView(note);
  StringBuilder details =
      new StringBuilder("迁移预览（每类最多显示前30条，导入保留完整原文）\n");
  for (String kind : BusinessStore.KINDS) {
    org.json.JSONArray rows = MarketData.array(pendingBusiness, kind);
    java.util.Set<String> existing = new java.util.HashSet<>();
    org.json.JSONArray before = businessStore.read(kind);
    for (int i = 0; i < before.length(); i++)
      existing.add(before.getJSONObject(i).optString("id"));
    int duplicates = 0;
    for (int i = 0; i < rows.length(); i++)
      if (existing.contains(rows.getJSONObject(i).optString("id")))
        duplicates++;
    details.append("\n")
        .append(kind)
        .append(": ")
        .append(rows.length())
        .append("条，同ID ")
        .append(duplicates)
        .append("条\n");
    for (int i = 0; i < Math.min(30, rows.length()); i++) {
      JSONObject r = rows.getJSONObject(i);
      details.append(r.optString("id"))
          .append("  ")
          .append(r.optString("title", r.optString("name")))
          .append("\n");
    }
  }
  details.append("\n未迁表：")
      .append(pendingBusiness.optString("notMigratedTables", "见原生迁移清单"));
  ScrollView scroll = new ScrollView(this);
  TextView preview = text(details.toString(), 12, ink);
  preview.setTextIsSelectable(true);
  scroll.addView(preview);
  page.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
  Button apply = new Button(this);
  apply.setText("确认合并这份备份");
  page.addView(apply);
  final JSONObject incoming = pendingBusiness;
  apply.setOnClickListener(v -> {
    android.util.AtomicFile before = new android.util.AtomicFile(
        new File(getFilesDir(), "business-before-restore.json"));
    FileOutputStream out = null;
    try {
      if (guard != null) guard.run();
      out = before.startWrite();
      out.write(businessStore.backup().toString().getBytes(
          java.nio.charset.StandardCharsets.UTF_8));
      before.finishWrite(out);
      out = null;
      if (guard != null) guard.run();
      businessStore.restore(incoming);
      note.setText("合并已保存，恢复前快照留在本机");
      apply.setEnabled(false);
    } catch (Exception e) {
      if (out != null)
        before.failWrite(out);
      note.setText("未合并：" + e.getMessage());
    }
  });
  String key = "businessPreview";
  View old = businessPages.remove(key);
  if (old != null)
    ((ViewGroup) old.getParent()).removeView(old);
  LinearLayout tabs = findViewById(R.id.pageTabs);
  View oldTab = tabs.findViewWithTag("page:" + key);
  if (oldTab != null)
    tabs.removeView(oldTab);
  showPage(key, "备份预览", page);
  }
// v42 replacement MainActivity members. ACTION_* selection remains in MainActivity callbacks.
UnifiedBackupHostScreen unifiedBackupScreen;
UnifiedBackupHostScreen unifiedBackupPickerOwner;
UnifiedBackupAsyncLane unifiedBackupLane;
final android.os.Handler unifiedBackupUi=new android.os.Handler(android.os.Looper.getMainLooper());
boolean unifiedBackupEntryActive(String key,View expected){
  return expected!=null&&foreground&&!isFinishing()&&!isDestroyed()&&key.equals(activePage)&&businessPages.get(key)==expected&&expected.isAttachedToWindow()&&expected.isShown();
}
void launchUnifiedBackupPicker(UnifiedBackupHostScreen owner,Intent intent,int code)throws Exception{
  BusinessStore.require(owner==unifiedBackupScreen&&unifiedBackupEntryActive("unifiedBackup",owner),"原备份页面已离开或被替换");
  BusinessStore.require(unifiedBackupPickerOwner==null,"文件选择尚未返回");
  unifiedBackupPickerOwner=owner;
  try{startActivityForResult(intent,code);}catch(Exception e){unifiedBackupPickerOwner=null;throw e;}
}
android.net.Uri unifiedBackupOriginal;
boolean unifiedBackupLeaderOrigin;
void openUnifiedBackup() {
  unifiedBackupLeaderOrigin=false;
  try{
    requireWatchlistUi();
    LinearLayout setup=new LinearLayout(this);setup.setOrientation(LinearLayout.VERTICAL);
    TextView note=new TextView(this);note.setText("统一非敏感备份\n勾选命名候选或完整背景方案，保留原编号和历史内容。每类最多100份，未勾选不导出。恢复范围以备份内记录为准；可不选候选，继续其它域。");setup.addView(note);
    ScrollView scroll=new ScrollView(this);LinearLayout options=new LinearLayout(this);options.setOrientation(LinearLayout.VERTICAL);scroll.addView(options);setup.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    java.util.List<CheckBox> choices=new ArrayList<>();
    File candidateFile=candidateStoreFile();
    try{JSONArray rows=new LocalCandidateStore(candidateFile).list();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);CheckBox box=new CheckBox(this);box.setText(row.getString("title")+" · "+row.getString("savedAt")+" · "+row.getString("id"));box.setTag(row.getString("id"));options.addView(box);choices.add(box);}}
    catch(Exception e){TextView error=new TextView(this);error.setText("候选列表未读取："+e.getMessage()+"；可继续其它域。");options.addView(error);}
    File backgroundFile=candidateBackgroundStoreFile();
    java.util.List<CheckBox> backgroundChoices=new ArrayList<>();
    try{JSONArray rows=new HostCandidateBackground(getDatabasePath(businessStore.getDatabaseName()),recentStoreFile(),getDatabasePath(testing?"sector-leaders-tests.sqlite":"sector-leaders-v1.sqlite"),backgroundFile).list(null);for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);CheckBox box=new CheckBox(this);box.setText("背景方案 · "+row.getString("title")+" · "+row.getString("savedAt")+" · "+row.getString("id"));box.setTag(row.getString("id"));options.addView(box);backgroundChoices.add(box);}}
    catch(Exception e){TextView error=new TextView(this);error.setText("背景命名列表未读取："+e.getMessage()+"；可继续其它域。");options.addView(error);}
    java.util.List<CheckBox> industryChoices=new ArrayList<>();File industryBusinessFile=getDatabasePath(businessStore.getDatabaseName());
    try{JSONArray rows=new IndustryArchiveStore(industryBusinessFile).catalogRecords();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(!"reports".equals(row.optString("kind")))continue;JSONObject r=IndustryArchiveState.record(row);if(!"industry_research_archive".equals(r.optString("legacySource")))continue;CheckBox box=new CheckBox(this);box.setText(r.getString("title")+" · "+r.getString("id"));box.setTag(r.getString("id"));options.addView(box);industryChoices.add(box);}}
    catch(Exception e){TextView error=new TextView(this);error.setText("完整产业档案列表未读取："+e.getMessage()+"；可继续其它域。");options.addView(error);}
    EditText extra=new EditText(this);extra.setTag("candidateExtraIds");extra.setHint("其它明确候选ID，每行一个；可留空");extra.setMinLines(1);setup.addView(extra);
    EditText extraBackground=new EditText(this);extraBackground.setTag("backgroundExtraIds");extraBackground.setHint("其它明确背景方案ID，每行一个；可留空");extraBackground.setMinLines(1);setup.addView(extraBackground);
    Button begin=new Button(this);begin.setText("创建新操作（既有回执保留）");setup.addView(begin);
    begin.setOnClickListener(v->{if(!unifiedBackupEntryActive("unifiedBackupSetup",setup))return;try{
      BusinessStore.require(unifiedBackupLane==null||!unifiedBackupLane.busy(),"上一操作仍在执行或释放资源");
      java.util.LinkedHashSet<String> selected=new java.util.LinkedHashSet<>();for(CheckBox box:choices)if(box.isChecked())selected.add((String)box.getTag());
      for(String id:extra.getText().toString().split("\n"))if(!id.trim().isEmpty())selected.add(id.trim());BusinessStore.require(selected.size()<=100,"最多明确选择100个冻结结果");
      JSONArray ids=new JSONArray();for(String id:selected)ids.put(id);
      java.util.LinkedHashSet<String> backgroundSelected=new java.util.LinkedHashSet<>();for(CheckBox box:backgroundChoices)if(box.isChecked())backgroundSelected.add((String)box.getTag());for(String id:extraBackground.getText().toString().split("\n"))if(!id.trim().isEmpty())backgroundSelected.add(id.trim());BusinessStore.require(backgroundSelected.size()<=100,"最多明确选择100个背景方案");JSONArray backgroundIds=new JSONArray();for(String id:backgroundSelected)backgroundIds.put(id);
      java.util.List<String> industryIds=new ArrayList<>();for(CheckBox box:industryChoices)if(box.isChecked())industryIds.add((String)box.getTag());
      UnifiedBackupHost.Paths paths=new UnifiedBackupHost.Paths(new File(getFilesDir(),watchlistBridgeFilename()),sectorLeaderStoreFile(),recentStoreFile(),candidateFile,candidateBackupReceiptDirectory(),backgroundFile,getDatabasePath(businessStore.getDatabaseName()));
      UnifiedBackup.Read fresh=()->{requireWatchlistUi();BusinessStore.require(!isFinishing()&&!isDestroyed(),"原提交宿主已关闭");return WatchlistWorkspaceModel.copy(watchlistBridgeCapture().getJSONObject("inputs"));};
      if(unifiedBackupLane!=null)unifiedBackupLane.closeOwner();
      UnifiedBackupAsyncLane lane=new UnifiedBackupAsyncLane(new UnifiedBackupAsyncLane.Ui(){
        public boolean isCurrent(){return android.os.Looper.myLooper()==android.os.Looper.getMainLooper();}
        public void post(Runnable task){if(!unifiedBackupUi.post(task))throw new IllegalStateException("UI分发器已关闭");}
      },fresh);unifiedBackupLane=lane;
      UnifiedBackupHost host=new UnifiedBackupHost(paths,"native-0.61",lane::inputs,(change,inputs)->lane.commitOnUi(()->{
        JSONObject current=fresh.get();BusinessStore.require(WatchlistWorkspaceModel.equal(current,inputs),"确认前主自选输入变化");
        WatchlistWorkspaceStore.readExisting(paths.groups,current);JSONObject saved=watchlistBridgeStore(false).save(change,current);makeGroups();filter();return saved;
      }),ids,backgroundIds,industryIds);
      final UnifiedBackupHostScreen[] operationScreen={null};
      UnifiedBackupHostScreen.Pickers pickers=new UnifiedBackupHostScreen.Pickers(){
        public void importFile()throws Exception{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE);launchUnifiedBackupPicker(operationScreen[0],intent,470);}
        public void newExportFile()throws Exception{Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"统一非敏感备份.json");launchUnifiedBackupPicker(operationScreen[0],intent,471);}
        public void receiptFile(){
          final UnifiedBackupHostScreen owner=operationScreen[0];
          if(owner!=unifiedBackupScreen||!unifiedBackupEntryActive("unifiedBackup",owner))return;
          owner.pickerCancelled();LinearLayout list=new LinearLayout(MainActivity.this);list.setOrientation(LinearLayout.VERTICAL);TextView title=new TextView(MainActivity.this);title.setText("历史回执只读查看；不会继续旧操作。");list.addView(title);
          final ScrollView receiptPage=new ScrollView(MainActivity.this);receiptPage.addView(list);
          File[] files=paths.receipts.listFiles(f->f.isFile()&&f.getName().startsWith("restore-")&&f.getName().endsWith(".json"));
          if(files!=null){java.util.Arrays.sort(files,(a,b)->Long.compare(b.lastModified(),a.lastModified()));for(File file:files){Button row=new Button(MainActivity.this);row.setText(file.getName());list.addView(row);row.setOnClickListener(view->{if(owner!=unifiedBackupScreen||!unifiedBackupEntryActive("unifiedBackupReceipts",receiptPage))return;showPage("unifiedBackup","统一非敏感备份",owner);owner.setActive(true);owner.acceptReceipt(file);});}}
          else title.append("\n当前没有回执目录；未创建。");
          replaceUnifiedBackupPage("unifiedBackupReceipts","历史恢复回执",receiptPage);
        }
      };
      UnifiedBackupHostScreen next=new UnifiedBackupHostScreen(MainActivity.this,host,lane,pickers);operationScreen[0]=next;
      if(unifiedBackupLeaderOrigin){Button back=new Button(MainActivity.this);back.setTag("unifiedBackupReturnLeader");back.setText("返回人工观察历史");next.addView(back,new LinearLayout.LayoutParams(-1,-2));back.setOnClickListener(view->{if(next!=unifiedBackupScreen||!unifiedBackupEntryActive("unifiedBackup",next)||!view.isShown())return;sectorLeaders();});}
      if(unifiedBackupScreen!=null)unifiedBackupScreen.dispose();unifiedBackupScreen=next;unifiedBackupOriginal=null;replaceUnifiedBackupPage("unifiedBackup","统一非敏感备份",next);
    }catch(Exception e){reviewFileMessage("未开始："+e.getMessage());}});
    replaceUnifiedBackupPage("unifiedBackupSetup","统一备份范围",setup);
  }catch(Exception e){reviewFileMessage("入口不可用："+e.getMessage());}
}
void replaceUnifiedBackupPage(String key,String title,View page){
  View old=businessPages.remove(key);if(old!=null&&old.getParent() instanceof ViewGroup)((ViewGroup)old.getParent()).removeView(old);
  LinearLayout tabs=findViewById(R.id.pageTabs);View tab=tabs.findViewWithTag("page:"+key);if(tab!=null)tabs.removeView(tab);showPage(key,title,page);
}
boolean unifiedBackupFileResult(int request,int result,Intent data){
  if(request!=470&&request!=471)return false;
  UnifiedBackupHostScreen selectedOwner=unifiedBackupPickerOwner;unifiedBackupPickerOwner=null;
  if(selectedOwner==null||selectedOwner!=unifiedBackupScreen||!activePage.equals("unifiedBackup")||isFinishing()||isDestroyed()){
    if(selectedOwner!=null)selectedOwner.pickerCancelled();reviewFileMessage("原备份页面已离开或重建；未处理晚到文件");return true;
  }
  if(result!=RESULT_OK||data==null||data.getData()==null){unifiedBackupScreen.pickerCancelled();return true;}
  unifiedBackupScreen.setActive(true);android.net.Uri uri=data.getData();
  if(request==470){unifiedBackupOriginal=uri;unifiedBackupScreen.acceptImport(UnifiedBackupSaf.source(getContentResolver(),uri));}
  else unifiedBackupScreen.acceptExport(UnifiedBackupSaf.createdDocument(getContentResolver(),uri,unifiedBackupOriginal));
  return true;
}
  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if(researchWorkbenchFileResult(request,result,data))return;
    if(creatorAiFileResult(request,result,data))return;
    if(rotationDocumentResult(request,result,data))return;
    if(unifiedBackupFileResult(request,result,data))return;
    if (request >= 440 && request <= 459) {
      if (result != RESULT_OK || data == null || data.getData() == null) {
        if (request == 441) reviewExportFile = "";
        reviewFileMessage("文件选择已取消，没有导入或导出"); return;
      }
      try {
        if (request == 441) {
          BusinessStore.require(reviewExportFile.matches("review-export-[a-f0-9-]+\\.bin"), "待导出内容已失效，请重新点击导出");
          File file = new File(getCacheDir(), reviewExportFile);
          BusinessStore.require(file.isFile() && file.length() <= 64 * 1024 * 1024, "待导出内容不可用，请重新导出");
          try (InputStream in = new FileInputStream(file); OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
            if (out == null) throw new IOException("目标文件不可写");
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
          }
          reviewExportFile = ""; reviewFileMessage("已写入所选文件");
        } else if(request==459){
          byte[] bytes=readReviewImport(data.getData(),WatchlistBackupModel.LIMIT);
          openWatchlistWorkspace();BusinessStore.require(watchlistWorkspaceScreen!=null,"分组页尚未打开");watchlistWorkspaceScreen.previewBackupImport(bytes);
        } else if(request==458){
          byte[] bytes=readReviewImport(data.getData(),25*1024*1024);
          String text=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
          openMaterialLibrary();BusinessStore.require(materialLibraryScreen!=null,"资料库未打开");materialLibraryScreen.previewImport(text);
        } else if(request==457){
          byte[] bytes=readReviewImport(data.getData(),32*1024*1024);
          String source=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
          openPortfolioMirror();BusinessStore.require(portfolioMirrorScreen!=null,"持仓镜像入口不可用");portfolioMirrorScreen.previewImport(source);
        } else if(request==453){
          industryDiscovery();BusinessStore.require(discoveryScreen!=null,"发现入口不可用");discoveryScreen.importArchive(readReviewImport(data.getData(),8*1024*1024));
        } else if(request==452){
          marketOverview();BusinessStore.require(marketOverviewScreen!=null,"市场全景入口不可用");marketOverviewScreen.importArchive(readReviewImport(data.getData(),8*1024*1024));
        } else if(request==451){
          openDataSafety();BusinessStore.require(dataSafetyScreen!=null,"数据安全入口不可用");
          dataSafetyScreen.previewImport(readReviewImport(data.getData(),dataSafetyScreen.maxPreviewBytes()),"用户选择的备份.json");
        } else {
          String text = new String(readReviewImport(data.getData(), (request==450?1:32) * 1024 * 1024), java.nio.charset.StandardCharsets.UTF_8);
          if (request == 444) { sectorLeaders(); leaderScreen.importConfig(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
          else if (request == 445) { openStockResearch(false); stockResearchScreen.previewImport(text); }
          else if (request == 446) { openCommentWorkshop(); commentWorkshopScreen.previewImport(text); }
          else if (request == 447) { openNews(false); newsScreen.importArchive(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
          else if (request == 448) { openPersonMethod(); personMethodScreen.previewImport(text); }
          else if (request == 449) { openEvidenceReview(); evidenceReviewScreen.previewImport(text); }
          else if (request == 450) { openRiskSettings(); riskSettingsScreen.previewImport(text); }
          else if (request == 454) { openQuantResearch();BusinessStore.require(quantResearchScreen!=null,"量化研究入口不可用");quantResearchScreen.previewImport(text); }
          else if (request == 455) { openSectorResearch();BusinessStore.require(sectorResearchScreen!=null,"板块产业研究入口不可用");sectorResearchScreen.previewImport(text); }
          else if (request == 456) { openAiSettings();BusinessStore.require(aiSettingsScreen!=null,"AI偏好入口不可用");aiSettingsScreen.importArchive(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
          else if (request == 440) { openResearchRuns(); researchRunsScreen.previewImport(text); }
          else if (request == 442) {
            openSourceAnalysis(); analysisScreen.previewImport(text, analysisScreen.history.sourceKey.getText().toString());
          } else { openSourceHandoff(); handoffScreen.previewImport(text, handoffScreen.sourceKey.getText().toString()); }
        }
      } catch (Exception e) { reviewFileMessage("文件未处理：" + e.getMessage()); }
      return;
    }
    if(request==432){
      localCandidates();
      if(result!=RESULT_OK||data==null||data.getData()==null)candidateScreen.fileResult(false,"文件选择已取消");
      else try { candidateScreen.document(data.getData()); }
      catch(Exception e){candidateScreen.fileResult(false,e.getMessage());}
      return;
    }
    if (request == 430 || request == 431) {
      recent();
      if (result != RESULT_OK || data == null || data.getData() == null) recentScreen.fileSelectionCancelled();
      else try { recentScreen.document(request == 431, data.getData()); }
      catch (Exception e) { recentScreen.state.setText("文件未处理：" + e.getMessage()); }
      return;
    }
    if(request==406||request==407)return;
    if((request==416||request==417)&&result==RESULT_OK&&data!=null&&data.getData()!=null){etfDaily();etfScreen.document(request,data.getData());return;}
    if ((request >= 420 && request <= 423) && result == RESULT_OK && data != null && data.getData() != null) {
      openSource();
      sourceScreen.safe(() -> sourceScreen.document(request, data.getData()));
      return;
    }
    if ((request == 410 || request == 411) && result == RESULT_OK && data != null && data.getData() != null) {
      recognitionPendingUri = data.getData();
      recognitionPendingId = recognitionImportId;
      recognitionPendingRequest = request;
      consumeRecognitionFile();
      return;
    }
    if (request == 404 && result == RESULT_OK && data != null && data.getData() != null) {
      try {
        if (businessFileAction.equals("export")) {
          try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
            if (out == null)
              throw new IOException("无法写入所选文件");
            out.write(businessStore.backup().toString().getBytes(
                java.nio.charset.StandardCharsets.UTF_8));
          }
          Toast.makeText(this, "业务备份已导出", Toast.LENGTH_SHORT).show();
        } else {
          ByteArrayOutputStream bytes = new ByteArrayOutputStream();
          int byteLimit=businessFileAction.equals("preview")?BusinessStore.BACKUP_BYTE_LIMIT:16*1024*1024;
          try (InputStream in = getContentResolver().openInputStream(data.getData())) {
            if (in == null)
              throw new IOException("文件不可读");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = in.read(buffer)) != -1) {
              if (bytes.size() + count > byteLimit)
                throw new IOException("文件超过"+(byteLimit/1024/1024)+"MiB");
              bytes.write(buffer, 0, count);
            }
          }
          String text = bytes.toString("UTF-8");
          if (businessFileAction.equals("transcript")) {
            View collectionPage=businessPages.get("business:collection");
            if(collectionPage instanceof BusinessScreen)((BusinessScreen)collectionPage).extension.requireReviewRecorded();
            JSONObject imported=CollectionRecords.importText(businessStore,"导入文稿",text);
            openBusiness("collection");
            ((BusinessScreen)businessPages.get("business:collection")).extension.loadCollection(imported);
          } else if (businessFileAction.equals("text")) {
            openBusiness("research");
            BusinessScreen page = (BusinessScreen) businessPages.get("business:research");
            page.selected = "";
            page.inputs.get("evidenceTitle").setText("导入资料");
            page.inputs.get("evidenceText").setText(text);
            page.inputs.get("evidenceSource").setText("");
            page.verification.setSelection(0);
            page.tab = 2;
            page.render();
          } else {
            stageBusinessPreview(new JSONObject(text), null);
          }
        }
      } catch (Exception e) {
        Toast.makeText(this, "操作未完成：" + e.getMessage(), Toast.LENGTH_LONG).show();
      }
      return;
    }
    if (result != RESULT_OK || data == null || data.getData() == null || feed == null)
      return;
    try {
      if (request == 401)
        try (InputStream in = getContentResolver().openInputStream(data.getData())) {
          JSONObject root = new JSONObject(new String(
              MarketFeed.bytes(in, 2 * 1024 * 1024), java.nio.charset.StandardCharsets.UTF_8));
          int count = MarketData.roster(root).size();
          new AlertDialog.Builder(this)
              .setTitle("导入 " + count + " 只自选？")
              .setMessage("替换原生应用本机清单；不修改原程序数据库。不导入报价、账户或密钥。建议先"
                  + "导出当前自选留档。")
              .setNegativeButton("取消", null)
              .setPositiveButton("导入",
                  (d, w) -> {
                    try {
                      feed.importRoster(root);
                      group = "全部";
                      makeGroups();
                      filter();
                      refreshLive();
                    } catch (Exception e) {
                      Toast.makeText(this, "导入失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                  })
              .show();
        }
      if (request == 402)
        try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
          if (out == null)
            throw new IOException();
          out.write(MarketFeed.exportRoster(instruments)
                        .toString(2)
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
          Toast.makeText(this, "已导出本机自选", Toast.LENGTH_SHORT).show();
        }
      if (request == 403)
        try (InputStream in = getContentResolver().openInputStream(data.getData())) {
          JSONObject input = new JSONObject(new String(
              MarketFeed.bytes(in, 2 * 1024 * 1024), java.nio.charset.StandardCharsets.UTF_8));
          feed.importAuction(auctionImportId, input);
          if (auctionScreen != null && auctionScreen.id.equals(auctionImportId))
            auctionScreen.mode.setSelection(1);
          Toast.makeText(this, "竞价过程已取得 · 等待保存完成", Toast.LENGTH_SHORT).show();
        }
      if (request == 405)
        try (InputStream in = getContentResolver().openInputStream(data.getData())) {
          JSONObject input = new JSONObject(new String(
              MarketFeed.bytes(in, 8 * 1024 * 1024), java.nio.charset.StandardCharsets.UTF_8));
          String date =
              java.time.Instant.parse(MarketData.obj(input, "observation").getString("observedAt"))
                  .atOffset(java.time.ZoneOffset.ofHours(8))
                  .toLocalDate()
                  .toString();
          feed.importCapital(capitalImportId, input, error -> {
            if (error.isEmpty()) {
              if (capitalScreen != null)
                capitalScreen.selectHistory(date);
              Toast.makeText(this, "旧资金档案已保存，可离线回放", Toast.LENGTH_SHORT).show();
            } else
              Toast.makeText(this, "档案未保存：" + error, Toast.LENGTH_LONG).show();
          });
        }
    } catch (Exception e) {
      new AlertDialog.Builder(this)
          .setTitle("文件操作失败")
          .setMessage("当前自选保持不变。" + e.getMessage())
          .setPositiveButton("关闭", null)
          .show();
    }
  }
  void chooseLayout() {
    new AlertDialog.Builder(this)
        .setTitle("图表阅读方式")
        .setSingleChoiceItems(
            new String[] {"分时盯盘 · 盘口常驻", "宽图精读 · 默认", "双周期 · 横屏主图 / 周K"},
            layout.equals("quotes")       ? 0
                : layout.equals("matrix") ? 2
                                          : 1,
            (d, i) -> {
              layout = new String[] {"quotes", "focus", "matrix"}[i];
              prefs.edit().putString("layout", layout).apply();
              d.dismiss();
              if (i == 0 && !chart.minute)
                period("minute");
              if (i == 2) {
                manualLandscape = true;
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
              }
              configure();
            })
        .setNegativeButton("取消", null)
        .show();
  }
  boolean landscape() {
    return getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
  }
  void configure() {
    if (root == null)
      return;
    updatePageNavigation();
    if (!activePage.isEmpty()) {
      findViewById(R.id.watchModes).setVisibility(View.GONE);
      ((Button) findViewById(R.id.manage)).setText("行情");
      ((Button) findViewById(R.id.theme)).setText("深浅");
      if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null)
        getWindow().getInsetsController().show(WindowInsets.Type.statusBars());
      return;
    }
    findViewById(R.id.navigation).setVisibility(detail ? View.GONE : View.VISIBLE);
    boolean land = landscape();
    // Landscape is a reading mode: keep navigation/back available, return the
    // system status-bar space to the chart. Restore it on the home/portrait view.
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController controller = getWindow().getInsetsController();
      if (controller != null) {
        if (detail && land)
          controller.hide(WindowInsets.Type.statusBars());
        else
          controller.show(WindowInsets.Type.statusBars());
      }
    } else {
      if (detail && land)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
      else
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }
    LinearLayout t = findViewById(R.id.toolbars);
    LinearLayout detailPanel = findViewById(R.id.detail);
    ViewGroup desiredParent = land ? t : detailPanel;
    if (indicators.getParent() != desiredParent) {
      ((ViewGroup) indicators.getParent()).removeView(indicators);
      if (land)
        t.addView(indicators);
      else
        detailPanel.addView(indicators, detailPanel.indexOfChild(actions));
    }
    t.setOrientation(LinearLayout.HORIZONTAL);
    for (LinearLayout row : new LinearLayout[] {periods, indicators})
      row.setLayoutParams(new LinearLayout.LayoutParams(land ? 0 : -1, dp(48), land ? 1 : 0));
    findViewById(R.id.quoteHeader).setVisibility(land ? View.GONE : View.VISIBLE);
    readout.setVisibility(land ? View.GONE : View.VISIBLE);
    actions.setVisibility(land ? View.GONE : View.VISIBLE);
    findViewById(R.id.notice).setVisibility(land ? View.GONE : View.VISIBLE);
    ((Button) findViewById(R.id.theme)).setText(detail && land ? "解释" : "深浅");
    ((Button) findViewById(R.id.manage)).setText(detail ? "布局" : "管理");
    if (detail)
      title.setText(str(instrument, "name") + "  " + str(instrument, "id").split(":")[2]
          + (land ? testing ? " · 模拟非实时"
                            : " · " + currentQuote(instrument).optString("tradeDate")
                  : ""));
    findViewById(R.id.watchModes).setVisibility(detail ? View.GONE : View.VISIBLE);
    reference.setVisibility(detail && land && layout.equals("matrix") ? View.VISIBLE : View.GONE);
    if (reference.getVisibility() != View.VISIBLE && inspected == reference)
      read(chart.selected);
    boolean wantsBook = detail && layout.equals("quotes") && chart.minute;
    chart.book = wantsBook && land;
    chart.bookApplicable = instrument != null && !str(instrument, "id").contains(":index:");
    TextView lowerBook = findViewById(R.id.bookBelow);
    // Reuse the existing 48dp action row; never reduce the main plot to add
    // another toolbar. The full five-level snapshot remains a native dialog.
    if (lowerBook.getParent() != actions) {
      ((ViewGroup) lowerBook.getParent()).removeView(lowerBook);
      actions.addView(lowerBook, 1, new LinearLayout.LayoutParams(0, dp(48), 2));
    }
    lowerBook.setVisibility(wantsBook && !chart.book ? View.VISIBLE : View.GONE);
    ((TextView) findViewById(R.id.bookBelow))
        .setText(chart.bookApplicable ? testing
                    ? "五档盘口 · 样本未提供　查看 →"
                    : "五档快照 · " + currentQuote(instrument).optString("tradeTime") + "　查看 →"
                                      : "五档盘口 · 指数不适用　查看 →");
    if (actions.getChildCount() > 2) {
      actions.getChildAt(2).setVisibility(wantsBook && !land ? View.GONE : View.VISIBLE);
      actions.getChildAt(2).setBackground(tabBackground(wantsBook));
      ((Button) actions.getChildAt(2)).setTextColor(wantsBook ? blue : muted);
    }
    chart.invalidate();
    if (!detail)
      findViewById(R.id.back).setVisibility(View.GONE);
    if(chartFullscreen!=null)chartFullscreen.apply();
  }
  void goHome() {
    industryTopicActive(false);
    researchWorkbenchNavigateAway();
    leaveChartFullscreen();
    creatorAiNavigateAway();
    knowledgeAiHostActive(false);
    if(rotationScreen!=null)rotationScreen.revokeDocumentTicket();
    rotationActive(false);
    paperMonitorActive(false);
    unifiedBackupPickerOwner=null;
    if(unifiedBackupScreen!=null)unifiedBackupScreen.setActive(false);
    etfMonitorActive(false);futuresMonitorActive(false);cffexActive(false);accountEditActive(false);archiveVideoActive(false);
    if(dataSourceStatusScreen!=null)dataSourceStatusScreen.setActive(false);
    if(aiSettingsScreen!=null)aiSettingsScreen.setActive(false);
    if (newsScreen != null) newsScreen.setActive(false);
    if (leaderScreen != null) leaderScreen.setActive(false);
    if (candidateScreen != null) candidateScreen.visibleChanged(false);
    if (sectorScreen != null) sectorScreen.setActive(false);
    if (marketOverviewScreen != null) marketOverviewScreen.setActive(false);
    if (discoveryScreen != null) discoveryScreen.setActive(false);
    if (sourceScreen != null) sourceScreen.leave();
    if (!activePage.isEmpty()) {
      activePage = "";
      findViewById(R.id.businessHost).setVisibility(View.GONE);
      findViewById(R.id.pageSwitch).setVisibility(View.GONE);
      manualLandscape = false;
      setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }
    if (manualLandscape) {
      manualLandscape = false;
      setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
      // Orientation is a workspace setting, not an extra back-stack page.
      // Continue home while retaining the chosen chart layout and viewport.
    }
    detail = false;
    findViewById(R.id.home).setVisibility(View.VISIBLE);
    findViewById(R.id.detail).setVisibility(View.GONE);
    findViewById(R.id.back).setVisibility(View.GONE);
    title.setText("自选");
    filter();
    configure();
    stocks.post(() -> {
      if (homeListState != null)
        stocks.onRestoreInstanceState(homeListState);
      if (homeGridState != null)
        stockGrid.onRestoreInstanceState(homeGridState);
    });
  }
  boolean closeInternalReader() {
    if(chartFullscreen!=null&&chartFullscreen.back())return true;
    CreatorPanel creator=creatorPanel();if(creator!=null&&creator.backAi())return true;
    if(activePage.equals("candidates") && candidateScreen != null && candidateScreen.back()) return true;
    return activePage.equals("accountEdit") && accountEditScreen != null && accountEditScreen.back()
        || activePage.equals("cffexDisclosure") && cffexScreen != null && cffexScreen.back()
        || activePage.equals("futuresMonitor") && futuresMonitorScreen != null && futuresMonitorScreen.back()
        || activePage.equals("watchlistWorkspace") && watchlistWorkspaceScreen != null && watchlistWorkspaceScreen.back()
        || activePage.equals("watchlistReconciliation") && watchlistReconciliationScreen != null && watchlistReconciliationScreen.back()
        || activePage.equals("auctionAnalysis") && auctionAnalysisScreen != null && auctionAnalysisScreen.back()
        || activePage.equals("materialLibrary") && materialLibraryScreen != null && materialLibraryScreen.back()
        || activePage.equals("knowledgeAiHost") && knowledgeAiHostScreen != null && foreground && knowledgeAiHostScreen.isShown() && knowledgeAiHostScreen.back()
        || activePage.equals("paperMonitor") && paperMonitorHostScreen != null && paperMonitorHostScreen.back()
        || activePage.equals("portfolioMirror") && portfolioMirrorScreen != null && portfolioMirrorScreen.back()
        || activePage.equals("migrationStatus") && migrationStatusScreen != null && migrationStatusScreen.back()
        || activePage.equals("quantResearch") && quantResearchScreen != null && quantResearchScreen.back()
        || activePage.equals("sectorResearch") && sectorResearchScreen != null && sectorResearchScreen.back()
        || activePage.equals("dataSafety") && dataSafetyScreen != null && dataSafetyScreen.back()
        || activePage.equals("riskSettings") && riskSettingsScreen != null && riskSettingsScreen.back()
        || activePage.equals("evidenceReview") && evidenceReviewScreen != null && evidenceReviewScreen.back()
        || activePage.equals("personMethod") && personMethodScreen != null && personMethodScreen.back()
        || activePage.equals("commentWorkshop") && commentWorkshopScreen != null && commentWorkshopScreen.back();
  }
  @Override
  public void onBackPressed() {
    if (closeInternalReader()) return;
    if (detail || !activePage.isEmpty())
      goHome();
    else
      super.onBackPressed();
  }
  @Override
  public void onConfigurationChanged(Configuration c) {
    super.onConfigurationChanged(c);
    configure();
  }
  @Override
  protected void onSaveInstanceState(Bundle b) {
    super.onSaveInstanceState(b);
    if(chartFullscreen!=null)chartFullscreen.save(b);
    if(knowledgeAiHostScreen!=null)try{b.putString("knowledgeAiHostState",knowledgeAiHostScreen.saveState().toString());}
    catch(Exception e){reviewFileMessage("资料研究完整草稿未保存；原文件保留");}
    b.putInt("rotationPickerNext",rotationPickerNext);
    b.putInt("creatorAiPickerNext",creatorAiPickerNext);
    b.putInt("f07PickerNext",f07PickerNext);
    if(researchWorkbenchScreen!=null)try{b.putString("researchWorkbenchState",researchWorkbenchScreen.saveState().toString());}catch(Exception error){reviewFileMessage("研究短状态未保存："+error.getMessage());}
    try{if(businessPages.containsKey("watchlistHost")||watchlistWorkspaceScreen!=null||watchlistReconciliationScreen!=null)watchlistBridgeSaveViews();}catch(Exception e){reviewFileMessage("分组完整草稿未保存："+e.getMessage());}
    b.putString("reviewExportFile", reviewExportFile);
    b.putString("accountReferenceId",accountReferenceId);
    if(archiveVideoScreen!=null)try{b.putString("archiveVideoState",archiveVideoScreen.saveState().put("rowHash",archiveVideoHash(archiveVideoRow)).toString());}catch(Exception ex){reviewFileMessage("视频阅读位置未保存："+ex.getMessage());}
    if(accountEditScreen!=null&&!accountEditStateFailed)try{b.putString("accountEditState",new HostAccountEditState(this,testing).save(accountEditScreen.saveState()).toString());}catch(Exception e){reviewFileMessage("账户完整草稿未保存："+e.getMessage());}
    if(migrationStatusScreen!=null)try{b.putString("migrationStatusState",new HostMigrationState(this,testing).save(migrationStatusScreen.saveState()).toString());}catch(Exception e){reviewFileMessage("完整迁移阅读状态未保存："+e.getMessage());}
    if(auctionAnalysisScreen!=null)try{b.putString("auctionAnalysisState",new HostAuctionState(this,testing).save(auctionAnalysisScreen.saveState()).toString());}catch(Exception e){reviewFileMessage("竞价完整状态未保存："+e.getMessage());}
    if(aiSettingsScreen!=null)b.putString("aiSettingsState",aiSettingsScreen.saveState().toString());
    if(materialLibraryScreen!=null)materialLibraryScreen.persist();
    if(dataSourceStatusScreen!=null)b.putString("dataSourceStatusState",dataSourceStatusScreen.saveState().toString());
    if(paperMonitorHostScreen!=null)b.putBundle("paperMonitorState",paperMonitorHostScreen.saveState());
    if(portfolioMirrorScreen!=null)b.putBundle("portfolioMirrorState",portfolioMirrorScreen.saveState());
    if(quantResearchScreen!=null)b.putBundle("quantResearchState",quantResearchScreen.saveState());
    if(riskSettingsScreen!=null)try { b.putBundle("riskSettingsState",riskSettingsScreen.saveState()); }
    catch(Exception e){reviewFileMessage("风险设置位置未保存："+e.getMessage());}
    if (personMethodScreen != null) try { b.putBundle("personMethodState", personMethodScreen.saveState()); }
    catch (Exception e) { reviewFileMessage("人物方法位置未保存：" + e.getMessage()); }
    if (newsScreen != null) try { b.putString("newsState", newsScreen.saveState().toString()); }
    catch (Exception e) { reviewFileMessage("资讯位置未保存：" + e.getMessage()); }
    if (stockResearchScreen != null) try { b.putString("stockResearchState", stockResearchScreen.saveState().toString()); }
    catch (Exception e) { reviewFileMessage("个股研究位置未保存：" + e.getMessage()); }
    if(industryTopicScreen!=null)try{b.putString("industryTopicState",industryTopicScreen.saveState().toString());}catch(Exception e){reviewFileMessage("产业完整草稿未保存："+e.getMessage());}
    if (researchRunsScreen != null) try { b.putString("researchRunsState", researchRunsScreen.saveState().toString()); }
    catch (Exception e) { reviewFileMessage("阅读位置未保存：" + e.getMessage()); }
    b.putString("auctionImportId", auctionImportId);
    b.putString("capitalImportId", capitalImportId);
    b.putString("businessFileAction", businessFileAction);
    if (pendingSourcePlans != null) b.putString("pendingSourcePlans", pendingSourcePlans.toString());
    b.putBoolean("historyExportLegacy",historyExportLegacy);b.putLong("historyExportAnchor",historyExportAnchor);
    b.putString("recognitionImportId", recognitionImportId);
    if (recognitionPendingUri != null) b.putString("recognitionPendingUri", recognitionPendingUri.toString());
    b.putString("recognitionPendingId", recognitionPendingId);
    b.putInt("recognitionPendingRequest", recognitionPendingRequest);
    b.putString("activePage", activePage);
    b.putStringArrayList("openPages", new ArrayList<>(businessPages.keySet()));
    if(recentScreen!=null)b.putBundle("recentState",recentScreen.save());
    if(candidateScreen!=null)b.putBundle("candidateState",candidateScreen.saveState());
    if(sectorScreen!=null)b.putString("sectorState",sectorScreen.saveState().toString());
    if(marketOverviewScreen!=null)try{b.putString("marketOverviewState",marketOverviewScreen.saveState().toString());}catch(Exception e){marketOverviewScreen.setHostError(e.getMessage());}
    if(discoveryScreen!=null)try{b.putString("industryDiscoveryState",discoveryScreen.saveState().toString());}catch(Exception e){discoveryScreen.setHostError(e.getMessage());}
    if(leaderScreen!=null)b.putString("sectorLeaderState",leaderScreen.saveState().toString());
    if(scenarioScreen!=null)b.putString("scenarioState",scenarioScreen.saveState().toString());
    if(instrument!=null&&instrument.optBoolean("transient"))try { b.putString("temporaryInstrument",recentIdentity(instrument).toString()); } catch(Exception ignored) {}
    if(rotationScreen!=null)b.putBundle("rotationState",rotationScreen.save());
    if(etfScreen!=null)b.putBundle("etfState",etfScreen.save());
    if(cffexScreen!=null)try{b.putString("cffexState",cffexScreen.saveState().toString());}catch(Exception e){reviewFileMessage("披露阅读状态未保存："+e.getMessage());}
    if(futuresMonitorScreen!=null)try{b.putString("futuresMonitorState",futuresMonitorScreen.saveState().toString());}catch(Exception e){reviewFileMessage("期货页面状态未保存");}
    if(etfMonitorScreen!=null)b.putString("etfMonitorState",etfMonitorScreen.saveState().toString());
    if(darkStockScreen!=null)b.putBundle("darkStockState",darkStockScreen.save());
    if (capitalScreen != null) {
      int pos = capitalScreen.symbols.getSelectedItemPosition();
      if (pos >= 0 && pos < capitalScreen.ids.size())
        b.putString("fundId", capitalScreen.ids.get(pos));
      b.putInt("fundMode", capitalScreen.modes.getSelectedItemPosition());
      b.putString("fundDate", capitalScreen.selectedDate());
      b.putInt("fundCursor", capitalScreen.cursor.getProgress());
      b.putParcelable("fundScroll", capitalScreen.list.onSaveInstanceState());
    }
    for (Map.Entry<String, View> entry : businessPages.entrySet()) {
      if (entry.getValue() instanceof BusinessScreen)
        b.putBundle(entry.getKey() + ":draft", ((BusinessScreen) entry.getValue()).saveDraft());
      if (entry.getValue() instanceof AuctionScreen) {
        AuctionScreen screen = (AuctionScreen) entry.getValue();
        b.putInt(entry.getKey() + ":phase", screen.phase.getSelectedItemPosition());
        b.putInt(entry.getKey() + ":mode", screen.mode.getSelectedItemPosition());
      }
    }
    b.putInt("samplingSeconds", samplingSeconds);
    b.putBoolean("detail", detail);
    b.putBoolean("manualLandscape", manualLandscape);
    if (instrument != null)
      b.putString("instrument", str(instrument, "id"));
    b.putString("period", period);
    b.putParcelable("homeList", detail ? homeListState : stocks.onSaveInstanceState());
    b.putParcelable("homeGrid", detail ? homeGridState : stockGrid.onSaveInstanceState());
    if (chart != null) {
      b.putInt("selected", chart.selected);
      b.putInt("end", chart.end);
      b.putInt("count", chart.count);
      b.putString("indicator", chart.indicator);
      b.putBoolean("nine", chart.nine);
      b.putBoolean("inspectReference", inspected == reference);
      b.putInt("referenceSelected", reference.selected);
      b.putInt("referenceEnd", reference.end);
      b.putInt("referenceCount", reference.count);
    }
  }
  void tint(android.view.View v) {
    if (v instanceof TextView) {
      TextView t = (TextView) v;
      if (t != quote)
        t.setTextColor(dark ? Color.rgb(219, 229, 243) : ink);
    }
    if (v instanceof android.view.ViewGroup)
      for (int i = 0; i < ((android.view.ViewGroup) v).getChildCount(); i++)
        tint(((android.view.ViewGroup) v).getChildAt(i));
  }
  void applyTheme() {
    root.setBackgroundColor(dark ? Color.rgb(17, 26, 38) : Color.WHITE);
    if(chartFullscreen!=null)chartFullscreen.refresh();
    findViewById(R.id.tableHeader)
        .setBackgroundColor(dark ? Color.rgb(28, 40, 57) : Color.rgb(243, 246, 250));
    for (int id : new int[] {R.id.readout, R.id.marketOverview, R.id.bookBelow, R.id.actions})
      findViewById(id).setBackgroundColor(dark ? 0xff162131 : 0xfff5f7fa);
    tint(root);
    for (View page : businessPages.values()) {
      page.setBackgroundColor(dark ? 0xff101a27 : Color.WHITE);
      if(page instanceof BusinessScreen)((BusinessScreen)page).themeControl(page);
    }
    if (capitalScreen != null)
      capitalScreen.render();
    if(futuresMonitorScreen!=null)futuresMonitorScreen.setDarkTheme(dark);
    if(cffexScreen!=null)cffexScreen.setDarkTheme(dark);
    if(etfMonitorScreen!=null)etfMonitorScreen.setDarkTheme(dark);
    if (etfScreen != null)
      etfScreen.applyColors();
    if (darkStockScreen != null)
      darkStockScreen.applyColors();
    if (recentScreen != null)
      recentScreen.applyColors();
    if (candidateScreen != null)
      candidateScreen.applyColors();
    if (scenarioScreen != null)
      scenarioScreen.setDarkTheme(dark);
    if (sectorScreen != null)
      sectorScreen.setDarkTheme(dark);
    if(industryTopicScreen!=null)industryTopicScreen.setDarkTheme(dark);
    if (researchRunsScreen != null) researchRunsScreen.setDarkTheme(dark);
    if (stockResearchScreen != null) stockResearchScreen.setDarkTheme(dark);
    if (commentWorkshopScreen != null) commentWorkshopScreen.setDarkTheme(dark);
    if (personMethodScreen != null) personMethodScreen.setDarkTheme(dark);
    if (quantResearchScreen != null) quantResearchScreen.setDarkTheme(dark);
    if (sectorResearchScreen != null) sectorResearchScreen.setDarkTheme(dark);
    if (migrationStatusScreen != null) migrationStatusScreen.setDarkTheme(dark);
    if(paperMonitorHostScreen!=null)paperMonitorHostScreen.setDarkTheme(dark);
    if (portfolioMirrorScreen != null) portfolioMirrorScreen.setDarkTheme(dark);
    if(auctionAnalysisScreen!=null)auctionAnalysisScreen.setDarkTheme(dark);
    if(materialLibraryScreen!=null)materialLibraryScreen.setDarkTheme(dark);
    if(knowledgeAiHostScreen!=null)knowledgeAiHostScreen.setDarkTheme(dark);
    if(accountReferenceScreen!=null)accountReferenceScreen.setDarkTheme(dark);
    if(accountEditScreen!=null)accountEditScreen.setDarkTheme(dark);
    if(dataSourceStatusScreen!=null)dataSourceStatusScreen.setDarkTheme(dark);
    if (aiSettingsScreen != null) aiSettingsScreen.setDarkTheme(dark);
    if (aiSettingsScreen != null) SourceHandoffPanel.styleTree(aiSettingsScreen.findViewWithTag("aiHostFiles"),dark);
    if (evidenceReviewScreen != null) evidenceReviewScreen.setDarkTheme(dark);
    if (riskSettingsScreen != null) riskSettingsScreen.setDarkTheme(dark);
    if (dataSafetyScreen != null) dataSafetyScreen.setDarkTheme(dark);
    if (marketOverviewScreen != null) marketOverviewScreen.setDarkTheme(dark);
    if (discoveryScreen != null) discoveryScreen.setDarkTheme(dark);
    if (newsScreen != null) { newsScreen.setDarkTheme(dark); styleNewsFileActions(); }
    if (leaderScreen != null) leaderScreen.setDarkTheme(dark);
    if (analysisScreen != null) analysisScreen.setDarkTheme(dark);
    if (handoffScreen != null) handoffScreen.setDarkTheme(dark);
    search.setBackground(surface(dark ? 0xff1e2c3e : 0xfff2f5f8, 6));
    search.setHintTextColor(muted);
    UiIcon searchIcon = new UiIcon("search", muted);
    searchIcon.setBounds(0, 0, dp(18), dp(18));
    search.setCompoundDrawables(searchIcon, null, null, null);
    search.setCompoundDrawablePadding(dp(8));
    updatePageNavigation();
    chart.dark = reference.dark = dark;
    chart.invalidate();
    reference.invalidate();
    adapter.notifyDataSetChanged();
    getWindow().getDecorView().setSystemUiVisibility(
        dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    if(Build.VERSION.SDK_INT>=30&&getWindow().getInsetsController()!=null){
      int lightBars=WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
      getWindow().getInsetsController().setSystemBarsAppearance(dark?0:lightBars,lightBars);
    }
    refreshButtons();
    makeGroups();
    updateWatchMode();
    configure();
  }

  private void updatePageNavigation() {
    String target = activePage.equals("unifiedBackup") || activePage.equals("unifiedBackupSetup") || activePage.equals("unifiedBackupReceipts") || activePage.equals("dataSourceStatus") || activePage.equals("migrationStatus") || activePage.equals("aiSettings") ? "我的"
        : activePage.equals("auctionAnalysis") ? "资金"
        : activePage.equals("archiveVideo") || activePage.equals("materialLibrary") || activePage.equals("knowledgeAiHost") ? "研究"
        : activePage.equals("industryDiscovery") || activePage.equals("quantResearch") || activePage.equals("sectorResearch") ? "研究"
        : activePage.isEmpty() || activePage.equals("watchlistWorkspace") || activePage.equals("watchlistHost") || activePage.equals("watchlistReconciliation") || activePage.equals("recent")                  ? "自选"
        : activePage.equals("evidenceReview") || activePage.equals("personMethod") || activePage.equals("methodReport") || activePage.equals("stockResearch") || activePage.equals("commentWorkshop") || activePage.equals("source") || activePage.equals("sourceAnalysis") || activePage.equals("sourceHandoff") || activePage.equals("researchRuns") || activePage.equals("business:research") || activePage.equals("business:creator") || activePage.equals("business:industry") || activePage.equals("business:collection") || activePage.equals("signal") ? "研究"
        : activePage.equals("paperMonitor") || activePage.equals("accountReference") || activePage.equals("accountEdit") || activePage.equals("portfolioMirror") || activePage.equals("business:accounts") || activePage.equals("business:paper") || activePage.equals("scenarioTools") ? "账户"
        : activePage.equals("dataSafety") || activePage.equals("riskSettings") || activePage.equals("business:settings") || activePage.equals("businessPreview") ? "我的"
                                                                                         : "市场";
    LinearLayout nav = findViewById(R.id.navigation);
    nav.setBackgroundColor(dark ? 0xff162131 : 0xfffafbfd);
    for (int i = 0; i < nav.getChildCount(); i++) {
      Button b = (Button) nav.getChildAt(i);
      boolean selected = b.getText().toString().equals(target);
      b.setSelected(selected);
      int c = selected ? blue : muted;
      UiIcon icon = new UiIcon(b.getText().toString(), c);
      icon.setBounds(0, 0, dp(22), dp(22));
      b.setCompoundDrawables(null, icon, null, null);
      b.setTextColor(c);
    }
    LinearLayout tabs = findViewById(R.id.pageTabs);
    for (int i = 0; i < tabs.getChildCount(); i++) {
      Button b = (Button) tabs.getChildAt(i);
      boolean selected = ("page:" + activePage).equals(b.getTag());
      b.setSelected(selected);
      b.setBackground(tabBackground(selected));
      b.setTextColor(selected ? blue : muted);
      if (selected) b.post(() -> {
        if (("page:" + activePage).equals(b.getTag()))
          b.requestRectangleOnScreen(new android.graphics.Rect(0, 0, b.getWidth(), b.getHeight()), false);
      });
    }
  }

  android.graphics.drawable.Drawable tabBackground(boolean selected) {
    GradientDrawable fill =
        surface(selected ? (dark ? 0xff1d3551 : 0xffedf4fd) : Color.TRANSPARENT, 0);
    android.graphics.drawable.LayerDrawable normal =
        new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[] {
            fill, surface(selected ? blue : Color.TRANSPARENT, 0)});
    normal.setLayerInset(1, dp(12), dp(46), dp(12), 0);
    android.graphics.drawable.StateListDrawable states =
        new android.graphics.drawable.StateListDrawable();
    states.addState(
        new int[] {android.R.attr.state_pressed}, surface(dark ? 0xff274565 : 0xffdeebfa, 0));
    states.addState(new int[] {}, normal);
    return states;
  }

  GradientDrawable surface(int color, int radius) {
    GradientDrawable shape = new GradientDrawable();
    shape.setColor(color);
    shape.setCornerRadius(dp(radius));
    return shape;
  }
  String price(JSONObject s, double value) {
    if (!Double.isFinite(value))
      return "—";
    return String.format(Locale.ROOT, str(s, "id").contains(":etf:") ? "%.3f" : "%.2f", value);
  }
  View watchRow(JSONObject s, boolean tile) {
    JSONArray data = MarketData.array(s, "day");
    JSONObject q = currentQuote(s);
    double last = q.optDouble("price"), change = q.optDouble("changePercent");
    int direction = !Double.isFinite(change) || change == 0 ? muted
        : change > 0                                        ? up
                                                            : down,
        foreground = dark ? 0xffdce5f0 : ink;
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(tile ? LinearLayout.VERTICAL : LinearLayout.HORIZONTAL);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setPadding(dp(tile ? 8 : 12), dp(tile ? 6 : 0), dp(tile ? 8 : 12), dp(tile ? 6 : 0));
    row.setLayoutParams(new AbsListView.LayoutParams(-1, dp(tile ? 132 : 48)));
    row.setContentDescription(str(s, "name") + "，" + str(s, "id").split(":")[2]
        + (testing ? "，模拟价" : "，来源价") + price(s, last) + "，涨跌"
        + (Double.isFinite(change) ? String.format(Locale.ROOT, "%+.2f%%", change) : "缺失") + " "
        + q.optString("tradeDate") + (q.optBoolean("cached") ? " 旧缓存" : ""));
    LinearLayout names = new LinearLayout(this);
    names.setOrientation(LinearLayout.VERTICAL);
    TextView name = text(str(s, "name"), 14, foreground);
    name.setMaxLines(1);
    name.setEllipsize(TextUtils.TruncateAt.END);
    name.setTypeface(null, Typeface.BOLD);
    TextView code = text(str(s, "id").split(":")[2] + " · " + str(s, "market")
            + (!testing && q.optBoolean("cached") ? " · 缓存" : ""),
        10, muted);
    names.addView(name);
    names.addView(code);
    if (tile)
      row.addView(names);
    else
      row.addView(names, new LinearLayout.LayoutParams(0, -2, 1));
    if (watchMode.equals("spark") && !tile) {
      MarketSpark spark = new MarketSpark(this, data, direction, dark);
      LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(58), dp(27));
      sp.setMargins(dp(4), 0, dp(6), 0);
      row.addView(spark, sp);
    }
    TextView value = text(price(s, last), tile ? 18 : 16, direction);
    value.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    value.setGravity(tile ? Gravity.START : Gravity.END);
    TextView pct =
        text(Double.isFinite(change) ? String.format(Locale.ROOT, "%+.2f%%", change) : "—", 14,
            tile ? direction : Color.WHITE);
    if (tile) {
      row.setBackground(surface(dark ? 0xff172333 : 0xfff7f9fc, 4));
      LinearLayout numbers = new LinearLayout(this);
      numbers.setGravity(Gravity.CENTER_VERTICAL);
      numbers.setPadding(0, dp(6), 0, dp(3));
      numbers.addView(value, new LinearLayout.LayoutParams(0, -2, 1));
      numbers.addView(pct);
      row.addView(numbers);
      row.addView(
          new MarketSpark(this, data, direction, dark), new LinearLayout.LayoutParams(-1, dp(38)));
      row.addView(text(testing    ? "近24根日K · 模拟"
              : data.length() > 0 ? "日K · " + MarketData.obj(s, "dayMeta").optString("dataDate")
                                  : "打开详情后加载真实K线",
          10, muted));
    } else {
      row.addView(
          value, new LinearLayout.LayoutParams(dp(watchMode.equals("spark") ? 72 : 84), -2));
      pct.setGravity(Gravity.CENTER);
      pct.setBackground(surface(direction, 3));
      LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(dp(74), dp(24));
      pp.setMargins(dp(8), 0, 0, 0);
      row.addView(pct, pp);
    }
    return row;
  }
  void updateWatchMode() {
    if (adapter == null)
      return;
    boolean grid = watchMode.equals("grid");
    stocks.setTag(watchMode);
    stocks.setVisibility(grid ? View.GONE : View.VISIBLE);
    stockGrid.setVisibility(grid ? View.VISIBLE : View.GONE);
    findViewById(R.id.tableHeader).setVisibility(grid ? View.GONE : View.VISIBLE);
    ((TextView) findViewById(R.id.nameColumn))
        .setText(watchMode.equals("spark") ? "名称 / 近24根日K" : "名称 / 代码");
    LinearLayout modes = findViewById(R.id.watchModes);
    for (int i = 1; i < modes.getChildCount(); i++) {
      Button b = (Button) modes.getChildAt(i);
      boolean active = watchMode.equals(b.getTag());
      b.setTextColor(active ? blue : muted);
      b.setTypeface(null, active ? Typeface.BOLD : Typeface.NORMAL);
      b.setBackground(tabBackground(active));
    }
    adapter.notifyDataSetChanged();
    gridAdapter.notifyDataSetChanged();
  }
}
