package org.marketreview.nativeapp;

import android.os.*;
import android.widget.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.json.*;

/** Native, read-only metadata directory; never opens a platform session. */
final class SourceDiscoveryPanel extends LinearLayout {
  final SourceScreen screen;
  final TextView summary;
  final ListView list;
  final ArrayAdapter<String> rows;
  final Button previous, next;
  int offset;
  String loadedAuthor = "";
  long generation;
  java.util.concurrent.Future<?> work;
  static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
      .withZone(ZoneId.of("Asia/Shanghai"));

  SourceDiscoveryPanel(SourceScreen screen) {
    super(screen.owner); this.screen = screen; setOrientation(VERTICAL);
    summary = screen.text("发现目录尚未读取"); summary.setTag("sourceDiscoverySummary"); addView(summary);
    addView(screen.text("仅保存曾看见的公开作品元数据；发现时间不是发布时间。目录不含媒体、登录信息或执行许可。"));
    LinearLayout buttons = screen.bar(this);
    previous = button(buttons, "上一页", () -> load(Math.max(0, offset - 50)));
    next = button(buttons, "下一页", () -> load(offset + 50));
    button(buttons, "刷新目录", () -> load(0));
    list = new ListView(screen.owner); list.setTag("sourceDiscoveryRows");
    rows = new ArrayAdapter<>(screen.owner, android.R.layout.simple_list_item_1, new ArrayList<>());
    list.setAdapter(rows); addView(list, new LayoutParams(-1, 0, 1));
    addView(screen.text("继续处理：返回官方页面，打开当前作者并明确采集；必须重新核对登录与作者，不会从目录自行启动。"));
  }
  Button button(LinearLayout parent, String label, Runnable action) {
    Button button = new Button(screen.owner); button.setText(label); button.setTextSize(12);
    parent.addView(button, new LayoutParams(0, screen.owner.dp(48), 1));
    button.setOnClickListener(v -> action.run()); return button;
  }
  void cancel() {
    generation++;
    if (work != null) { work.cancel(true); work = null; }
  }
  void load(int requestedOffset) {
    cancel(); previous.setEnabled(false); next.setEnabled(false);
    final String author;
    try { author = SourceCapture.profile(screen.author.getText().toString().trim()); }
    catch (Exception e) { rows.clear(); loadedAuthor = ""; summary.setText("请填写作者完整主页后读取本机目录；未打开网页"); return; }
    if (!author.equals(loadedAuthor)) { rows.clear(); offset = 0; }
    final int requested = author.equals(loadedAuthor) ? requestedOffset : 0;
    final long ticket = generation;
    summary.setText("正在读取本机目录；不会打开网页或启动任务");
    work = screen.fileIo.submit(() -> {
      String error = ""; int total = 0, pending = 0, selectedOffset = 0;
      List<String> values = new ArrayList<>();
      try {
        JSONObject counts = screen.discovery.counts(author);
        total = counts.getInt("total"); pending = counts.getInt("pending");
        selectedOffset = Math.min(requested, Math.max(0, (total - 1) / 50 * 50));
        JSONArray items = screen.discovery.page(author, selectedOffset);
        for (int n = 0; n < items.length(); n++) {
          JSONObject row = items.getJSONObject(n);
          String status = row.getString("state").equals("pending_detail") ? "待详情核对（需明确运行）"
              : "已保存详情（不等于下载、识别或入库完成）";
          values.add((row.getString("title").isEmpty() ? "标题未提供" : row.getString("title"))
              + "\n" + row.getString("contentId") + " · " + status
              + "\n首次发现 " + DATE.format(Instant.ofEpochMilli(row.getLong("firstSeenAt")))
              + "\n最近发现 " + DATE.format(Instant.ofEpochMilli(row.getLong("lastSeenAt")))
              + "\n" + row.getString("sourceUrl"));
        }
      } catch (Exception e) { error = e.toString(); }
      final String failure = error; final int totalCount = total, pendingCount = pending, start = selectedOffset;
      new Handler(Looper.getMainLooper()).post(() -> {
        if (screen.closed || generation != ticket || getVisibility() != VISIBLE) return;
        work = null;
        String now;
        try { now = SourceCapture.profile(screen.author.getText().toString().trim()); }
        catch (Exception e) { now = ""; }
        if (!author.equals(now)) { rows.clear(); loadedAuthor = ""; summary.setText("作者已改变，请刷新当前作者的目录"); return; }
        if (!failure.isEmpty()) { summary.setText("目录读取失败；此前显示未更新：" + failure); return; }
        rows.clear(); rows.addAll(values); loadedAuthor = author; offset = start;
        summary.setText("本机已发现 " + totalCount + " · 待核对 " + pendingCount + " · 第 "
            + (values.isEmpty() ? 0 : start + 1) + "–" + (start + values.size()) + " 条");
        previous.setEnabled(start > 0); next.setEnabled(start + values.size() < totalCount);
      });
    });
  }
}
