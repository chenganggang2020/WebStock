package org.marketreview.nativeapp;

import android.content.*;
import android.view.*;
import android.widget.*;
import org.json.*;

/** Configuration and receipts stay native; official session stays in SourceBrowser. */
final class SourcePlansPanel extends ScrollView {
  final SourceScreen source;
  final SourceSchedule ledger;
  final EditText name, author, rights, limit, interval;
  final CheckBox desktop;
  final LinearLayout rows, editor;
  String selected = "";
  boolean history;
  boolean legacyHistory;
  long historyAnchor=-1;
  int historyOffset;
  JSONObject pendingHistory;
  final LinearLayout historyTools;
  SourcePlansPanel(SourceScreen s) {
    super(s.owner);
    source = s;
    ledger = s.schedule;
    LinearLayout body = new LinearLayout(s.owner);
    body.setOrientation(LinearLayout.VERTICAL);
    addView(body);
    body.addView(
        s.text("保存 ≠ 启用 ≠ 恢复调度。仅当前来源页前台发现，后台暂停；已启动的下载/转写由本机任务继续。"));
    LinearLayout tabs = s.bar(body);
    s.button(tabs, "作者计划", () -> s.safe(() -> {
      history = false;
      render();
    }));
    s.button(tabs, "运行历史", () -> s.safe(() -> {
      history = true;
      render();
    }));
    historyTools=s.bar(body);
    s.button(historyTools,"原生轮次",()->s.safe(()->{history=true;legacyHistory=false;historyAnchor=-1;historyOffset=0;render();}));
    s.button(historyTools,"旧历史档案",()->s.safe(()->{history=true;legacyHistory=true;historyAnchor=-1;historyOffset=0;render();}));
    s.button(historyTools,"刷新历史",()->s.safe(()->{historyAnchor=-1;historyOffset=0;render();}));
    editor = new LinearLayout(s.owner);
    editor.setOrientation(LinearLayout.VERTICAL);
    body.addView(editor);
    name = s.field(editor, "作者名称", "planName", "");
    author = s.field(editor, "官方作者主页", "planAuthor", s.author.getText().toString());
    rights = s.field(editor, "有权处理的依据", "planRights", s.rights.getText().toString());
    LinearLayout options = s.bar(editor);
    options.addView(s.text("条数"));
    limit = s.field(options, "1–50", "planLimit", "5");
    limit.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
    limit.setLayoutParams(new LinearLayout.LayoutParams(s.owner.dp(64), s.owner.dp(48)));
    options.addView(s.text("间隔/分"));
    interval = s.field(options, "10–1440", "planInterval", "60");
    interval.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
    interval.setLayoutParams(new LinearLayout.LayoutParams(s.owner.dp(80), s.owner.dp(48)));
    desktop = new CheckBox(s.owner);
    desktop.setText("桌面网页");
    desktop.setTextSize(12);
    desktop.setChecked(true);
    options.addView(desktop);
    LinearLayout edit = s.bar(editor);
    s.button(edit, "保存计划", () -> s.safe(this::save));
    s.button(edit, "启用所选", () -> s.safe(() -> enabled(true)));
    s.button(edit, "停用所选", () -> s.safe(() -> enabled(false)));
    LinearLayout execution = s.bar(editor);
    s.button(execution, "运行所选一次", () -> s.safe(() -> {
      BusinessStore.require(!selected.isEmpty(), "请先选择作者计划");
      s.runPlan(ledger.plan(selected), true);
    }));
    s.button(execution, "恢复调度", () -> s.safe(s::resumeSchedule));
    LinearLayout files = s.bar(editor);
    s.button(files, "导出计划", () -> file(true));
    s.button(files, "导入计划", () -> file(false));
    rows = new LinearLayout(s.owner);
    rows.setOrientation(LinearLayout.VERTICAL);
    body.addView(rows);
  }
  void save() throws Exception {
    JSONObject p = ledger.save(new JSONObject()
            .put("name", name.getText().toString())
            .put("profileUrl", author.getText().toString())
            .put("rightsBasis", rights.getText().toString())
            .put("limit", Integer.parseInt(limit.getText().toString().trim()))
            .put("intervalMinutes", Integer.parseInt(interval.getText().toString().trim()))
            .put("desktop", desktop.isChecked()));
    selected = p.getString("id");
    render();
    source.state.setText("计划已保存；启用与恢复调度需单独操作");
  }
  void enabled(boolean value) throws Exception {
    BusinessStore.require(!selected.isEmpty(), "请先选择或保存作者计划");
    ledger.enable(selected, value);
    render();
    source.state.setText(value ? "已启用所选计划；调度尚需主动恢复" : "已停用所选计划；本轮停止请用停止本轮");
  }
  void choose(JSONObject p) throws Exception {
    selected = p.getString("id");
    name.setText(p.getString("name"));
    author.setText(p.getString("profileUrl"));
    rights.setText(p.getString("rightsBasis"));
    limit.setText(p.getString("limit"));
    interval.setText(p.getString("intervalMinutes"));
    desktop.setChecked(p.getBoolean("desktop"));
    render();
    smoothScrollTo(0, 0);
  }
  static String status(String state) {
    switch (state) {
      case "finished":
        return "本轮结束";
      case "failed":
        return "来源失败";
      case "stopped":
        return "主动停止";
      case "interrupted":
        return "运行中断";
      case "running":
        return "进行中";
      default:
        return "尚未运行";
    }
  }
  void render() throws Exception {
    editor.setVisibility(history ? GONE : VISIBLE);
    historyTools.setVisibility(history?VISIBLE:GONE);
    rows.removeAllViews();
    if(history&&historyAnchor<0)historyAnchor=ledger.historyAnchor(legacyHistory);
    JSONArray values = history ? ledger.historyPage(legacyHistory,historyAnchor,historyOffset) : ledger.plans();
    rows.addView(
        source.text(history ? "第"+(values.length()==0?0:historyOffset+1)+"–"+(historyOffset+values.length())+" / 共"+ledger.historyCount(legacyHistory,historyAnchor)+"轮 · 每页50 · 新轮次点刷新" : "选择作者可编辑；新计划默认停用"));
    if(history) {
      LinearLayout paging=source.bar(rows);
      source.button(paging,"上一页",()->source.safe(()->{historyOffset=Math.max(0,historyOffset-50);render();smoothScrollTo(0,0);}));
      source.button(paging,"下一页",()->source.safe(()->{if(historyOffset+50<ledger.historyCount(legacyHistory,historyAnchor))historyOffset+=50;render();smoothScrollTo(0,0);}));
      LinearLayout files=source.bar(rows);
      source.button(files,"导入旧历史",()->historyFile(false));source.button(files,"导出此类全部",()->historyFile(true));
      if(legacyHistory)rows.addView(source.text("旧completed仅表示轮次结束，非转写/入库成功。档案不带执行许可。"));
    }
    if (values.length() == 0)
      rows.addView(source.text(history ? "暂无运行记录" : "尚未保存作者计划"));
    for (int i = 0; i < values.length(); i++) {
      JSONObject p = values.getJSONObject(i);
      Button b = new Button(source.owner);
      b.setAllCaps(false);
      b.setTextSize(13);
      b.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
      b.setMinHeight(source.owner.dp(56));
      if (history) {
        if(legacyHistory){b.setText(p.getString("author")+" · 旧状态 "+p.getString("status")+"\n"+p.getString("startedAt")+" · "+p.getString("id"));b.setOnClickListener(v->source.safe(()->legacyDetail(p)));}
        else {b.setText(p.getJSONObject("plan").getString("name") + " · " + status(p.optString("status")) + "\n"
            + java.time.Instant.ofEpochMilli(p.getLong("startedMs")) + " · " + SourceTaskReceipt.discoverySummary(p)
            + " · 来源结束时入库" + p.optInt("published") + " · 下游见详情");
          b.setOnClickListener(v -> source.safe(() -> detail(p)));}
      } else {
        b.setText((selected.equals(p.getString("id")) ? "✓ " : "") + p.getString("name") + " · "
            + (p.getBoolean("enabled") ? "启用" : "停用") + "\n每" + p.getInt("intervalMinutes") + "分 / 最多"
            + p.getInt("limit") + "条 · " + status(p.optString("lastState")) + "\n"
            + SourceTaskReceipt.discoverySummary(p.optJSONObject("lastRun") == null ? new JSONObject() : p.optJSONObject("lastRun")));
        b.setOnClickListener(v -> source.safe(() -> choose(p)));
      }
      rows.addView(b, new LinearLayout.LayoutParams(-1, -2));
    }
    if (source.owner.pendingSourcePlans != null)
      preview();
    if(pendingHistory!=null) {
      rows.addView(source.text("待导入旧历史"+pendingHistory.getJSONArray("runs").length()+"轮；重复保留，冲突整批拒绝；不自动启动任务。"));
      source.button(source.bar(rows),"确认导入历史",()->source.safe(()->{
        BusinessStore.require(!source.fileBusy,"正在处理历史文件，请稍候");
        source.importHistory(pendingHistory);
      }));
      source.button(source.bar(rows),"取消历史导入",()->source.safe(()->{pendingHistory=null;render();}));
    }
  }
  void historyFile(boolean export) {
    if(export)captureHistoryExport();
    Intent i=new Intent(export?Intent.ACTION_CREATE_DOCUMENT:Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
    if(export)i.putExtra(Intent.EXTRA_TITLE,legacyHistory?"旧来源历史档案.json":"安卓原生轮次.json");
    source.owner.startActivityForResult(i,export?423:422);
  }
  void captureHistoryExport() {
    source.owner.historyExportLegacy=legacyHistory;
    source.owner.historyExportAnchor=historyAnchor<0?ledger.historyAnchor(legacyHistory):historyAnchor;
  }
  void legacyDetail(JSONObject run) throws Exception {
    rows.removeAllViews();source.button(source.bar(rows),"返回历史列表",()->source.safe(this::render));
    rows.addView(source.text(run.getString("author")+" · "+run.getString("id")+"\n旧状态："+run.getString("status")+"\n开始："+run.getString("startedAt")+"\n结束："+run.getString("finishedAt")+"\n"+run.getString("message")+"\n"+run.getString("error")));
    String[] names={"作品","发现","候选","详情完成","详情失败","尝试转写","转写完成","缺媒体","转写失败","新增","更新","未变化"};JSONObject c=run.getJSONObject("counts");StringBuilder counts=new StringBuilder();
    for(int i=0;i<SourceHistory.COUNTS.length;i++){String k=SourceHistory.COUNTS[i];counts.append(names[i]).append('：').append(!c.has(k)||c.isNull(k)?"—":c.get(k)).append("  ");}
    rows.addView(source.text(counts.toString()));JSONArray items=run.getJSONArray("items");
    if(items.length()==0)rows.addView(source.text("旧库此轮没有明细，不推断为全部成功。"));
    for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);
      rows.addView(source.text(item.getString("title")+" · "+item.getString("contentId")+"\n详情 "+item.getString("detail_status")+" / 转写 "+item.getString("transcription_status")+"\n"+item.getString("message")));
      source.button(source.bar(rows),"查看本机对应文稿",()->source.safe(()->{
        String found="",id=item.getString("contentId"),url=item.getString("sourceUrl");JSONArray jobs=source.store.read("collections");
        for(int n=0;n<jobs.length();n++){JSONObject j=jobs.getJSONObject(n);JSONObject original=j.optJSONObject("legacyOriginal");
          if((!url.isEmpty()&&SourceHistory.clean(j.optString("sourceUrl")).equals(url))||(original!=null&&id.equals(original.optString("external_content_id")))){
            BusinessStore.require(found.isEmpty(),"匹配到多个版本，请从文稿列表按来源选择");found=j.getString("id");}}
        BusinessStore.require(!found.isEmpty(),"没有匹配的本机文稿；未触发采集");source.owner.openCollectionRecord(found);
      }));
    }smoothScrollTo(0,0);
  }
  void detail(JSONObject run) throws Exception {
    rows.removeAllViews();
    source.button(source.bar(rows), "返回历史列表", () -> source.safe(this::render));
    source.button(source.bar(rows), "刷新下游结果", () -> source.safe(() -> detail(run)));
    rows.addView(source.text("来源结束时记录（不会被后来任务改写）"));
    TextView info =
        source.text(run.getJSONObject("plan").getString("name") + " · " + status(run.optString("status"))
            + "\n开始 " + java.time.Instant.ofEpochMilli(run.getLong("startedMs")) + "\n"
            + run.optString("message") + "\n" + SourceTaskReceipt.discoverySummary(run) + "\n选中" + run.optInt("selected") + " / 处理"
            + run.optInt("processed") + " / 入库" + run.optInt("published") + " / 已有"
            + run.optInt("existing") + " / 缺媒体" + run.optInt("unavailable"));
    info.setTextIsSelectable(true);
    info.setTag("sourceRunInfo");
    rows.addView(info);
    JSONArray outcomes = run.optJSONArray("results");
    java.util.Map<String, JSONObject> jobs = SourceTaskReceipt.index(source.store.read("collections"));
    java.util.Map<String, JSONObject> docs = SourceTaskReceipt.index(source.store.read("docs"));
    rows.addView(source.text("本轮已提交任务的下游回执 · 按下发身份核对，不合并后来手工重试"));
    if (outcomes != null)
      for (int i = 0; i < outcomes.length(); i++) {
        JSONObject r = outcomes.getJSONObject(i);
        rows.addView(source.text(r.optString("contentId") + " · " + r.optString("outcome")));
        String outcome = SourceTaskReceipt.state(r, run.getString("id"), jobs.get(r.optString("jobId")), docs);
        TextView downstream = source.text(SourceTaskReceipt.label(outcome));
        downstream.setTag("sourceDownstream:" + r.optString("jobId"));
        rows.addView(downstream);
        if (outcome.equals("published")) {
          source.button(source.bar(rows), "查看本轮研究原文", () -> source.safe(() -> researchDetail(run, r)));
          source.button(source.bar(rows), "打开本轮研究条目", () -> source.safe(() -> source.openResearchRecord(r, run.getString("id"))));
        }
        if (!r.optString("jobId").isEmpty())
          source.button(source.bar(rows), "查看此条文稿",
              () -> source.safe(() -> {
                JSONObject latest = SourceTaskReceipt.find(source.store.read("collections"), r.getString("jobId"));
                BusinessStore.require(latest != null && (r.optString("sourceAttemptId").isEmpty()
                    || SourceTaskReceipt.sameJob(latest, r)), "文稿已恢复或替换，请从文稿列表核对新版本");
                source.owner.openCollectionRecord(r.getString("jobId"));
              }));
      }
    smoothScrollTo(0, 0);
  }
  void researchDetail(JSONObject run, JSONObject link) throws Exception {
    JSONObject doc = source.researchRecord(link, run.getString("id"));
    rows.removeAllViews();
    source.button(source.bar(rows), "返回本轮回执", () -> source.safe(() -> detail(run)));
    TextView text = source.text(doc.optString("title") + "\n研究ID " + doc.getString("id")
        + "\n" + doc.optString("sourceUrl") + "\n本轮精确资料 · 当前校对稿 · "
        + (doc.optString("verification").equals("manuallyVerified") ? "人工已核验" : "待人工核验")
        + "\n\n" + doc.optString("text"));
    text.setTextIsSelectable(true); text.setTag("sourceExactResearch"); rows.addView(text);
    smoothScrollTo(0, 0);
  }
  void file(boolean export) {
    Intent intent = new Intent(export ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json");
    if (export)
      intent.putExtra(Intent.EXTRA_TITLE, "安卓作者计划.json");
    source.owner.startActivityForResult(intent, export ? 420 : 421);
  }
  void preview() throws Exception {
    JSONArray configs = ledger.previewPlans(source.owner.pendingSourcePlans);
    rows.addView(source.text("待合并" + configs.length()
        + "个计划：同作者保留本机；新作者停用。此文件不含运行历史、会话、媒体和研究文稿。"));
    for (int i = 0; i < configs.length(); i++)
      rows.addView(source.text(configs.getJSONObject(i).getString("name") + "\n"
          + configs.getJSONObject(i).getString("profileUrl")));
    LinearLayout actions = source.bar(rows);
    source.button(actions, "确认合并计划", () -> source.safe(() -> {
      int added = ledger.importPlans(source.owner.pendingSourcePlans);
      source.owner.pendingSourcePlans = null;
      history = false;
      render();
      source.state.setText("新增" + added + "个停用计划；同作者保留本机");
    }));
    source.button(actions, "取消导入", () -> source.safe(() -> {
      source.owner.pendingSourcePlans = null;
      render();
    }));
  }
}
