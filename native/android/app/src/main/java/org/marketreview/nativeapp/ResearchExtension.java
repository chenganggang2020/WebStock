package org.marketreview.nativeapp;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Independent on-device evidence linking and transcript editing; no desktop RPC. */
final class ResearchExtension {
  final BusinessScreen p;
  final List<String> docIds = new ArrayList<>();
  final String[] stages = {"materials", "equipment", "components", "manufacturing", "applications"};
  Spinner stage;
  TextView original;
  LinearLayout collectionSearch;
  TextView empty;
  TextView modelState;
  TextView localRetryState;
  LinearLayout qualityPanel;
  TextView qualityState,qualityHistory;
  View qualityToggle;
  boolean qualityOpen;
  ResearchCompaniesScreen companies;View industryNavigation;
  IndustryVersionScreen history;
  final Map<String,String> collectionBaseline = new HashMap<>();
  final String[][] collectionFields = {{"collectionTitle", "title"}, {"collectionSource", "sourceUrl"},
      {"collectionRights", "rightsBasis"}, {"collectionMediaUrl", "mediaUrl"}, {"collectionText", "text"}};
  String fingerprint(String value) {
    try { return RecognitionAssets.hex(java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
    catch (Exception e) { throw new IllegalStateException(e); }
  }
  ResearchExtension(BusinessScreen page) throws Exception {
    p = page;
    if (p.kind.equals("industry"))
      industry();
    else
      collection();
  }
  void safe(Action a) {
    try {
      a.run();
    } catch (Exception e) {
      p.state.setText(e.getMessage());
    }
  }
  interface Action {
    void run() throws Exception;
  }
  LinearLayout bar() {
    LinearLayout b = new LinearLayout(p.owner);
    b.setOrientation(LinearLayout.HORIZONTAL);
    p.body.addView(b);
    return b;
  }
  void editor() {
    ScrollView scroll = new ScrollView(p.owner);
    p.editor = new LinearLayout(p.owner);
    p.editor.setOrientation(LinearLayout.VERTICAL);
    scroll.addView(p.editor);
    p.body.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
  }
  void emptyList(String message) {
    empty = p.text(message);
    empty.setGravity(Gravity.CENTER);
    empty.setVisibility(View.GONE);
    p.body.addView(empty, new LinearLayout.LayoutParams(-1, 0, 1));
  }
  EditText multi(String label, String key) {
    EditText e = p.field(p.editor, label, key, "", false);
    e.setSingleLine(false);
    e.setHorizontallyScrolling(false);
    e.setMinLines(5);
    e.setMaxLines(10);
    e.setMinimumHeight(p.owner.dp(160));
    e.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
    e.setGravity(Gravity.TOP);
    return e;
  }
  String topic() {
    int i = p.accounts.getSelectedItemPosition();
    return i >= 0 && i < p.accountIds.size() ? p.accountIds.get(i) : "";
  }
  String doc() {
    int i = p.symbols.getSelectedItemPosition();
    return i >= 0 && i < docIds.size() ? docIds.get(i) : "";
  }
  void refreshTopics() throws Exception {
    String selected = topic();
    p.accountIds.clear();
    List<String> names = new ArrayList<>();
    JSONArray ts = p.store.read("topics");
    for (int i = 0; i < ts.length(); i++) {
      JSONObject t = ts.getJSONObject(i);
      p.accountIds.add(t.getString("id"));
      names.add(t.getString("name"));
    }
    ArrayAdapter<String> a = (ArrayAdapter<String>) p.accounts.getAdapter();
    a.clear();
    a.addAll(names);
    a.notifyDataSetChanged();
    p.accounts.setSelection(Math.max(0, p.accountIds.indexOf(selected)));
  }
  void refreshDocs() throws Exception {
    String selected = doc();
    docIds.clear();
    List<String> names = new ArrayList<>();
    JSONArray ds = p.store.read("docs");
    for (int i = 0; i < ds.length(); i++) {
      JSONObject d = ds.getJSONObject(i);
      docIds.add(d.getString("id"));
      names.add(d.getString("title"));
    }
    ArrayAdapter<String> a = (ArrayAdapter<String>) p.symbols.getAdapter();
    a.clear();
    a.addAll(names);
    a.notifyDataSetChanged();
    p.symbols.setSelection(Math.max(0, docIds.indexOf(selected)));
  }
  void industry() throws Exception {
    p.state.setText("产业关系引用本机原文；人工核验不等于自动确认。");
    p.accounts = p.choices(p.body, new ArrayList<>());
    p.accounts.setTag("researchTopics");
    p.field(p.body, "主题名", "topicName", "", false);
    LinearLayout b = bar();
    industryNavigation=b;
    p.button(b, "新增主题", () -> safe(() -> {
      JSONObject t = p.store.save("topics", new JSONObject().put("name", p.value("topicName")));
      refreshTopics();
      p.accounts.setSelection(p.accountIds.indexOf(t.getString("id")));
      render();
    }));
    p.button(b, "关系列表", () -> {
      p.tab = 0;
      p.render();
    });
    p.button(b,"公司 / 环节图",()->safe(()->{p.tab=3;companies.setTopic(topic());companies.setDarkTheme(p.owner.darkTheme());render();})).setTag("openResearchCompanies");
    p.button(b,"历史版本 / 完整原件",()->safe(()->{p.tab=4;history.reload();history.setTopic(topic());render();})).setTag("openIndustryVersions");
    p.button(b, "新关系", () -> safe(() -> {
      p.selected = "";
      p.inputs.get("relationClaim").setText("");
      p.inputs.get("relationQuote").setText("");
      p.tab = 2;
      refreshDocs();
      render();
    }));
    p.fillList();
    p.list.setTag("relationList");
    emptyList("此主题暂无关系记录。\n点“新关系”选择原文并添加引文，不自动推断事实。");
    editor();
    p.symbols = p.choices(p.editor, new ArrayList<>());
    p.symbols.setTag("relationDocument");
    original = p.text("");
    original.setTextIsSelectable(true);
    original.setMaxLines(8);
    p.editor.addView(original);
    p.button(p.editor, "展开 / 收起原文",
        () -> original.setMaxLines(original.getMaxLines() == 8 ? Integer.MAX_VALUE : 8));
    p.symbols.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onItemSelected(AdapterView<?> a, View v, int n, long id) {
        safe(() -> {
          JSONObject d = p.existing("docs", doc());
          original.setText(d.optString("sourceUrl") + "\n" + d.optString("text"));
        });
      }
      public void onNothingSelected(AdapterView<?> a) {}
    });
    stage = p.choices(p.editor, Arrays.asList("原材料", "设备", "零部件", "制造", "应用"));
    p.field(p.editor, "关系 / 判断", "relationClaim", "", false);
    multi("与原文逐字一致的引文", "relationQuote");
    p.side = p.choices(p.editor, Arrays.asList("支持", "反证"));
    p.verification = p.choices(p.editor, Arrays.asList("待核验", "人工已核验"));
    p.button(p.editor, "保存关系", () -> safe(() -> {
      JSONObject j = p.store.save("relations",
          p.existing("relations", p.selected)
              .put("id", p.selected)
              .put("topicId", topic())
              .put("documentId", doc())
              .put("stage", stages[stage.getSelectedItemPosition()])
              .put("claim", p.value("relationClaim"))
              .put("quote", p.value("relationQuote"))
              .put("polarity", p.side.getSelectedItemPosition() == 0 ? "supports" : "contradicts")
              .put("verification",
                  p.verification.getSelectedItemPosition() == 0 ? "unverified"
                                                                : "manuallyVerified"));
      p.selected = j.getString("id");
      p.tab = 0;
      render();
      p.state.setText("已保存关系，原文引用已校验");
    }));
    p.button(p.editor, "删除关系", () -> {
      if (!p.selected.isEmpty())
        new android.app.AlertDialog.Builder(p.owner)
            .setMessage("仅删除当前关系，保留原文？")
            .setPositiveButton("删除", (a, b1) -> safe(() -> {
              p.store.remove("relations", p.selected);
              p.selected = "";
              p.tab = 0;
              render();
            }))
            .setNegativeButton("取消", null)
            .show();
    });
    p.accounts.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onItemSelected(AdapterView<?> a, View v, int n, long id) {
        if (p.tab != 2)
          safe(() -> render());
      }
      public void onNothingSelected(AdapterView<?> a) {}
    });
    p.list.setOnItemClickListener((a, v, n, id) -> safe(() -> {
      JSONObject j = p.data.getJSONObject(n);
      p.selected = j.getString("id");
      refreshDocs();
      p.symbols.setSelection(docIds.indexOf(j.getString("documentId")));
      p.inputs.get("relationClaim").setText(j.optString("claim"));
      p.inputs.get("relationQuote").setText(j.optString("quote"));
      stage.setSelection(Arrays.asList(stages).indexOf(j.optString("stage")));
      p.side.setSelection(j.optString("polarity").equals("contradicts") ? 1 : 0);
      p.verification.setSelection(j.optString("verification").equals("manuallyVerified") ? 1 : 0);
      p.tab = 2;
      render();
    }));
    refreshTopics();
    refreshDocs();
    companies=new ResearchCompaniesScreen(p.owner,p.store);
    history=new IndustryVersionScreen(p.owner,p.store,()->safe(()->{p.tab=0;render();}),p.owner::openUnifiedBackup);
    p.body.addView(history,new LinearLayout.LayoutParams(-1,0,1));history.setVisibility(View.GONE);
    companies.returnToRelations=()->safe(()->{p.tab=0;render();});
    companies.topicChanged=id->{int at=p.accountIds.indexOf(id);if(at>=0&&p.accounts.getSelectedItemPosition()!=at)p.accounts.setSelection(at);};
    p.body.addView(companies,new LinearLayout.LayoutParams(-1,0,1));
    companies.setVisibility(View.GONE);
    render();
  }
  void collection() throws Exception {
    p.state.setText(p.owner.collectionService == null ? "正在连接本机任务服务…"
        : p.owner.collectionService.status());
    p.body.addView(p.text("手机独立下载→离线转写→研究入库 · 单次上限30分钟 · 结果待校对"));
    LinearLayout sourceActions = bar();
    p.button(sourceActions, "作者来源", p.owner::openSource);
    p.button(sourceActions, "开启任务通知", p.owner::collectionNotifications);
    collectionSearch = new LinearLayout(p.owner);
    collectionSearch.setOrientation(LinearLayout.VERTICAL);
    p.body.addView(collectionSearch);
    p.field(collectionSearch, "搜索标题 / 渠道 / 文稿", "collectionSearch", "", false)
        .addTextChangedListener(new TextWatcher() {
          public void beforeTextChanged(CharSequence s, int a, int c, int d) {}
          public void onTextChanged(CharSequence s, int a, int b, int c) {
            safe(() -> render());
          }
          public void afterTextChanged(Editable e) {}
        });
    LinearLayout b = bar();
    p.button(b, "文稿列表", () -> {
      p.tab = 0;
      p.render();
    });
    p.button(b, "导入文稿", () -> safe(()->{requireReviewRecorded();p.owner.businessFile("transcript");}));
    p.button(b, "新增链接", () -> safe(() -> {requireReviewRecorded();loadCollection(p.store.save("collections",
        new JSONObject().put("title","新媒体任务").put("status","imported")
            .put("text","").put("originalText","")));}));
    p.button(b, "研究资料", () -> p.owner.openBusiness("research"));
    p.fillList();
    p.list.setTag("collectionList");
    emptyList("没有匹配的采集文稿。\n可调整搜索，或主动导入本机文稿。");
    editor();
    qualityToggle=p.button(p.editor,"文稿质检",()->safe(()->{requireSavedCollection();qualityOpen=!qualityOpen;showQuality();}));
    qualityPanel=new LinearLayout(p.owner);qualityPanel.setOrientation(LinearLayout.VERTICAL);p.editor.addView(qualityPanel);
    qualityState=p.text("");qualityState.setTag("collectionQualityState");qualityPanel.addView(qualityState);
    EditText qualityNote=p.field(qualityPanel,"本次核对内容 / 剩余疑点","qualityReviewNote","",false);qualityNote.setSingleLine(false);qualityNote.setMinLines(3);
    p.button(qualityPanel,"记录本次复核",()->safe(()->{
      requireSavedCollection();p.store.reviewCollection(p.selected,collectionBaseline.get("collectionText"),p.value("qualityReviewNote"));
      qualityNote.setText("");refreshCollection();p.state.setText("已记录当前正文复核；机器异常与事实核验状态未被覆盖");
    }));
    qualityHistory=p.text("");qualityHistory.setTextIsSelectable(true);qualityPanel.addView(qualityHistory);
    qualityPanel.setVisibility(View.GONE);
    p.field(p.editor, "标题", "collectionTitle", "", false);
    p.field(p.editor, "来源链接", "collectionSource", "", false);
    p.field(p.editor, "授权依据", "collectionRights", "", false);
    p.field(p.editor, "HTTPS媒体直链（非作品网页）", "collectionMediaUrl", "", false);
    LinearLayout mediaActions = new LinearLayout(p.owner); p.editor.addView(mediaActions);
    p.button(mediaActions, "导入本机音视频", () -> safe(() -> {
      saveCollection(); p.owner.tasks().recognition.available();
      BusinessStore.require(!p.owner.tasks().busy(), "请先等待或停止本机任务");
      BusinessStore.require(!p.value("collectionRights").trim().isEmpty(), "请先填写授权依据");
      p.owner.recognitionFile(false, p.selected);
    }));
    p.button(mediaActions, "下载到本机", () -> safe(() -> {
      saveCollection();
      p.owner.tasks().download(p.selected, false);
    }));
    p.button(mediaActions, "停止下载", () -> safe(() -> {
      p.owner.tasks().stopTask("本机下载与后续识别已停止；旧媒体和文稿保留");
    }));
    modelState = p.text(p.owner.collectionService == null ? "正在读取本机模型状态…"
        : p.owner.collectionService.recognition.modelStatus()); p.editor.addView(modelState);
    LinearLayout models = new LinearLayout(p.owner); p.editor.addView(models);
    p.button(models, "下载中文模型42MB", () -> safe(() -> p.owner.tasks().installModel(null)));
    p.button(models, "导入模型ZIP", () -> safe(() -> { p.owner.tasks().recognition.available(); p.owner.recognitionFile(true, ""); }));
    LinearLayout asr = new LinearLayout(p.owner); p.editor.addView(asr);
    p.button(asr, "本机转写并入库", () -> safe(() -> {
      saveCollection(); p.owner.tasks().recognize(p.selected);
    }));
    p.button(asr, "下载并转写", () -> safe(() -> {
      saveCollection(); p.owner.tasks().download(p.selected, true);
    }));
    p.button(asr, "停止本机任务", () -> safe(p.owner::stopCollectionWork));
    p.editor.addView(p.text("自动重试默认关闭。每次明确批准仅当前文稿、当前服务内有效，最多30分钟；各阶段失败5次停止。重新批准会重新计数，重启后需重新批准。"));
    p.button(p.editor, "明确批准本次自动重试（重新计数）", () -> safe(() -> {
      BusinessStore.require(p.owner.hasWindowFocus() && p.isShown() && p.tab == 2 && !p.selected.isEmpty(),
          "请在当前可见文稿页明确批准");
      CollectionService service = p.owner.tasks();
      BusinessStore.require(!service.busy() && service.run.isEmpty(), "已有本机任务，请等待或停止");
      saveCollection(); service.approveLocalRetry(p.selected);
    })).setTag("approveCollectionLocalRetry");
    p.button(p.editor, "取消本次自动重试", () -> safe(() -> p.owner.tasks().cancelLocalRetry()))
        .setTag("cancelCollectionLocalRetry");
    localRetryState = p.text("本机自动重试：默认关闭");
    localRetryState.setTag("collectionLocalRetryStatus"); p.editor.addView(localRetryState);
    p.button(p.editor,"归档视频 / 逐字稿复核",()->safe(()->{requireSavedCollection();requireReviewRecorded();BusinessStore.require(!p.selected.isEmpty(),"先选择采集文稿");p.owner.openArchiveVideo(p.existing("collections",p.selected));})).setTag("openArchiveVideo");
    multi("校对文稿（保存不覆盖原稿）", "collectionText");
    p.button(p.editor, "保存校对", () -> safe(() -> {
      saveCollection();
      p.state.setText("校对稿已保存；识别原稿未改变");
    }));
    p.button(p.editor, "入研究资料", () -> safe(() -> {
      saveCollection();
      CollectionRecords.publish(p.store, p.selected);
      p.state.setText("已入研究资料，默认待核验");
    }));
    p.button(p.editor, "查看来源初版", () -> safe(() -> {
      for (String[] pair : collectionFields)
        BusinessStore.require(fingerprint(p.inputs.get(pair[0]).getText().toString()).equals(collectionBaseline.get(pair[0])), "请先保存当前校对，再查看初版");
      JSONObject current = p.existing("collections", p.selected);
      BusinessStore.require(!current.optString("sourceRootId").isEmpty(), "当前是初版或导入资料，没有更早的来源版本");
      loadCollection(p.existing("collections", current.getString("sourceRootId")));
    }));
    original = p.text("");
    original.setTextIsSelectable(true);
    p.editor.addView(original);
    p.list.setOnItemClickListener(
        (a, v, n, id) -> safe(() -> loadCollection(p.data.getJSONObject(n))));
    render();
  }
  void requireSavedCollection() {
    if(collectionBaseline.isEmpty())return;
    for(String[] pair:collectionFields)
      BusinessStore.require(fingerprint(p.inputs.get(pair[0]).getText().toString()).equals(collectionBaseline.get(pair[0])),"请先保存当前校对，再打开其他文稿");
  }
  void requireReviewRecorded() {
    BusinessStore.require(!p.inputs.containsKey("qualityReviewNote")||CollectionQuality.trim(p.inputs.get("qualityReviewNote").getText().toString()).isEmpty(),"请先记录或清空复核说明，再创建或导入文稿");
  }
  void loadCollection(JSONObject j) throws Exception {
    BusinessStore.require(p.selected.equals(j.getString("id"))||!p.inputs.containsKey("qualityReviewNote")||CollectionQuality.trim(p.inputs.get("qualityReviewNote").getText().toString()).isEmpty(),"复核说明尚未记录；请先记录或清空说明，再切换文稿");
    if(!p.selected.equals(j.getString("id"))&&p.inputs.containsKey("qualityReviewNote"))p.inputs.get("qualityReviewNote").setText("");
    p.selected = j.getString("id");
    collectionBaseline.clear();
    for (String[] pair : collectionFields) {
      p.inputs.get(pair[0]).setText(j.optString(pair[1]));
      collectionBaseline.put(pair[0], fingerprint(j.optString(pair[1])));
    }
    renderCollectionStatus(j);
    p.tab = 2;
    render();
  }
  String collectionValue(String field) {
    return field.equals("collectionText") ? p.inputs.get(field).getText().toString() : p.value(field);
  }
  void saveCollection() throws Exception {
    BusinessStore.require(!p.selected.isEmpty(), "请先导入或选择文稿");
    JSONObject latest = p.existing("collections", p.selected);
    for (String[] pair : collectionFields)
      if (!fingerprint(collectionValue(pair[0])).equals(collectionBaseline.get(pair[0]))) latest.put(pair[1], collectionValue(pair[0]));
    p.store.save("collections", latest);
    for (String[] pair : collectionFields) collectionBaseline.put(pair[0], fingerprint(collectionValue(pair[0])));
    refreshCollection();
  }
  void renderCollectionStatus(JSONObject j) throws Exception {
    if (localRetryState != null) localRetryState.setText(p.owner.collectionService == null
        ? "服务未连接，自动重试未执行" : p.owner.collectionService.localRetryStatus(j));
    if(qualityState!=null){qualityState.setText(CollectionQuality.describe(j));StringBuilder history=new StringBuilder();JSONArray reviews=CollectionQuality.array(j,"qualityReviews");
      for(int i=0;i<reviews.length();i++){JSONObject r=reviews.getJSONObject(i);history.append(r.optString("reviewedAt")).append("\n").append(r.optString("note")).append("\n\n");}
      qualityHistory.setText(history.length()==0?"尚无人工复核记录；转写完成不会生成复核记录。":history.toString());}
    JSONObject asr=j.optJSONObject("asrResult");
    StringBuilder timed=new StringBuilder();
    if(asr!=null&&asr.optJSONArray("segments")!=null) {
      JSONArray segments=asr.optJSONArray("segments");
      for(int i=0;i<segments.length();i++) {
        JSONObject part=segments.optJSONObject(i); if(part!=null)timed.append(String.format(Locale.ROOT,"[%.2f–%.2f秒] %s\n",part.optDouble("start"),part.optDouble("end"),part.optString("text")));
      }
    }
    original.setText((j.optString("sourceRootId").isEmpty() ? "" :
        "来源文本更新：" + j.optString("sourceRevisionAt") + "\n初版：" + j.optString("sourceRootId") +
        "\n新旧稿独立保留；文字改变不证明视频文件改变。\n") + j.optString("downloadMessage") + "\n" + j.optString("asrMessage")
        + "\n本机媒体：" + j.optString("assetPath","未下载")
        + "\n保留原稿\n" + j.optString("originalText")
        + "\n最近识别（待核验；保存校对不覆盖已发布研究资料）\n" + (asr == null ? "尚无" : timed.length()>0?timed.toString():asr.optString("text")));
  }
  void refreshCollection() {
    if (!p.kind.equals("collection")) return;
    safe(() -> {
      if (modelState != null && p.owner.collectionService != null)
        modelState.setText(p.owner.collectionService.recognition.modelStatus());
      if (p.selected.isEmpty()) return;
      JSONObject j = p.existing("collections", p.selected);
      for (String[] pair : collectionFields) {
        if (fingerprint(collectionValue(pair[0])).equals(collectionBaseline.get(pair[0]))) {
          p.inputs.get(pair[0]).setText(j.optString(pair[1]));
          collectionBaseline.put(pair[0], fingerprint(j.optString(pair[1])));
        }
      }
      renderCollectionStatus(j);
    });
  }
  void render() throws Exception {
    if(history!=null&&p.tab==4){for(int i=0;i<p.body.getChildCount();i++)p.body.getChildAt(i).setVisibility(p.body.getChildAt(i)==history?View.VISIBLE:View.GONE);p.state.setVisibility(View.GONE);return;}
    if(history!=null)history.setVisibility(View.GONE);
    if(companies!=null){boolean show=p.tab==3;for(int i=0;i<p.body.getChildCount();i++){View child=p.body.getChildAt(i);if(child!=companies&&child!=history)child.setVisibility(!show?View.VISIBLE:View.GONE);}companies.setVisibility(show?View.VISIBLE:View.GONE);p.state.setVisibility(show?View.GONE:View.VISIBLE);if(show){((View)p.editor.getParent()).setVisibility(View.GONE);p.list.setVisibility(View.GONE);if(empty!=null)empty.setVisibility(View.GONE);companies.setTopic(topic());companies.setDarkTheme(p.owner.darkTheme());return;}}
    if (p.editor == null || p.rows == null)
      return;
    ((View) p.editor.getParent()).setVisibility(p.tab == 2 ? View.VISIBLE : View.GONE);
    p.list.setVisibility(p.tab == 2 ? View.GONE : View.VISIBLE);
    if (empty != null) empty.setVisibility(View.GONE);
    if (collectionSearch != null)
      collectionSearch.setVisibility(p.tab == 2 ? View.GONE : View.VISIBLE);
    if (p.tab == 2) {
      if(qualityPanel!=null){renderCollectionStatus(p.existing("collections",p.selected));showQuality();}
      return;
    }
    p.rows.clear();
    p.data = new JSONArray();
    boolean industry = p.kind.equals("industry");
    JSONArray all = p.store.read(industry ? "relations" : "collections");
    String query = industry ? "" : p.value("collectionSearch").toLowerCase(Locale.ROOT);
    for (int i = 0; i < all.length(); i++) {
      JSONObject j = all.getJSONObject(i);
      if (industry && !j.optString("topicId").equals(topic()))
        continue;
      if (!industry
          && !(j.optString("title") + j.optString("channel") + j.optString("text"))
              .toLowerCase(Locale.ROOT)
              .contains(query))
        continue;
      p.data.put(j);
      p.rows.add(industry ? j.optString("claim") + "\n"
                  + (j.optString("polarity").equals("contradicts") ? "反证" : "支持") + " · "
                  + (j.optString("verification").equals("manuallyVerified") ? "人工已核验"
                                                                            : "待核验")
                  + "\n" + j.optString("quote")
                          : j.optString("title") + "\n" + j.optString("channel") + " · "
                  + j.optString("status") + "\n" + j.optString("publishedAt"));
    }
    p.rows.notifyDataSetChanged();
    if (empty != null && p.rows.isEmpty()) {
      p.list.setVisibility(View.GONE);
      empty.setVisibility(View.VISIBLE);
    }
  }
  void showQuality() {
    for(int i=0;i<p.editor.getChildCount();i++){View child=p.editor.getChildAt(i);child.setVisibility(child==qualityToggle||child==qualityPanel&&qualityOpen||child!=qualityPanel&&!qualityOpen?View.VISIBLE:View.GONE);}
  }
}
