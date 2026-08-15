package com.webstock.companion;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

final class MobileSnapshotHtml {
    private static final DecimalFormat MONEY = new DecimalFormat("#,##0.00", DecimalFormatSymbols.getInstance(Locale.US));

    private MobileSnapshotHtml() {}

    static String render(String json, String reason) {
        JSONObject root;
        try {
            root = new JSONObject(json);
        } catch (Exception error) {
            throw new IllegalArgumentException("移动快照无法显示");
        }
        StringBuilder body = new StringBuilder();
        body.append("<header><div><strong>离线快照</strong><span>")
            .append(escape(reason)).append("</span></div><time>")
            .append(escape(root.optString("generatedAt", "--"))).append("</time></header>");

        JSONArray accounts = root.optJSONArray("accounts");
        if (accounts == null || accounts.length() == 0) {
            body.append("<section class='empty'>尚无账户快照。连接 Windows 主机后会自动保存。</section>");
        } else {
            for (int index = 0; index < accounts.length(); index += 1) {
                body.append(renderAccount(accounts.optJSONObject(index)));
            }
        }
        body.append(renderResearch(root.optJSONObject("research")));
        body.append("<footer>只读缓存，不支持交易或修改数据。行情与盈亏以标注时间为准。</footer>");
        return "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
            "<style>" + styles() + "</style></head><body>" + body + "</body></html>";
    }

    private static String renderAccount(JSONObject account) {
        if (account == null) return "";
        JSONObject summary = account.optJSONObject("summary");
        JSONObject source = account.optJSONObject("source");
        JSONArray positions = account.optJSONArray("positions");
        String status = account.optString("valuationStatus", "unavailable");
        String statusLabel = "live".equals(status) ? "实时" :
            ("saved-snapshot".equals(status) ? "已保存快照" :
            ("stale".equals(status) ? "最近收盘" :
            ("cash-only".equals(status) ? "仅现金" : "行情不可用")));
        StringBuilder html = new StringBuilder();
        html.append("<section class='account'><div class='account-head'><div><h2>")
            .append(escape(account.optString("name", "未命名账户"))).append("</h2><p>")
            .append(escape(source == null ? "" : source.optString("label")))
            .append(account.optString("observedAt").isEmpty() ? "" : " · " + escape(account.optString("observedAt")))
            .append("</p></div><b class='status ").append(escape(status)).append("'>")
            .append(statusLabel).append("</b></div>");
        html.append("<div class='metrics'>")
            .append(metric("总资产", number(summary, "totalAssets"), false))
            .append(metric("总盈亏", number(summary, "totalPnl"), true))
            .append(metric("当日参考盈亏", number(summary, "todayPnl"), true))
            .append("</div>");
        if (positions == null || positions.length() == 0) {
            html.append("<div class='empty compact'>暂无持仓</div>");
        } else {
            html.append("<div class='positions'>");
            for (int index = 0; index < positions.length(); index += 1) {
                JSONObject position = positions.optJSONObject(index);
                if (position == null) continue;
                Double pnl = number(position, "unrealizedPnl");
                Double rate = number(position, "unrealizedPnlRate");
                html.append("<article><div><h3>").append(escape(position.optString("name")))
                    .append(" <small>").append(escape(position.optString("code"))).append("</small></h3><p>")
                    .append(formatQuantity(number(position, "quantity"))).append(" 股 · 现价 ")
                    .append(formatNumber(number(position, "currentPrice"), false)).append("</p></div><div class='position-value ")
                    .append(valueClass(pnl)).append("'><strong>").append(formatNumber(pnl, true)).append("</strong><span>")
                    .append(formatPercent(rate)).append("</span></div></article>");
            }
            html.append("</div>");
        }
        return html.append("</section>").toString();
    }

    private static String renderResearch(JSONObject research) {
        JSONObject totals = research == null ? null : research.optJSONObject("totals");
        int observations = totals == null ? 0 : totals.optInt("observationCount");
        int videos = totals == null ? 0 : totals.optInt("videoCount");
        int transcripts = totals == null ? 0 : totals.optInt("transcriptCount");
        int archives = totals == null ? 0 : totals.optInt("archiveCount");
        return "<section class='research'><h2>研究资料 " + observations + "</h2><div>视频 " + videos +
            "</div><div>已转写 " + transcripts + "</div><div>本地存档 " + archives + "</div></section>";
    }

    private static String metric(String label, Double value, boolean signed) {
        return "<div><span>" + label + "</span><strong class='" + (signed ? valueClass(value) : "") + "'>" +
            formatNumber(value, signed) + "</strong></div>";
    }

    private static Double number(JSONObject object, String key) {
        if (object == null || object.isNull(key)) return null;
        double value = object.optDouble(key, Double.NaN);
        return Double.isFinite(value) ? value : null;
    }

    private static String formatNumber(Double value, boolean signed) {
        if (value == null) return "--";
        return (signed && value > 0 ? "+" : "") + MONEY.format(value);
    }

    private static String formatQuantity(Double value) {
        return value == null ? "--" : new DecimalFormat("#,##0", DecimalFormatSymbols.getInstance(Locale.US)).format(value);
    }

    private static String formatPercent(Double value) {
        if (value == null) return "--";
        return (value > 0 ? "+" : "") + MONEY.format(value) + "%";
    }

    private static String valueClass(Double value) {
        if (value == null || value == 0) return "flat";
        return value > 0 ? "rise" : "fall";
    }

    private static String escape(String value) {
        return String.valueOf(value == null ? "" : value).replace("&", "&amp;")
            .replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    }

    private static String styles() {
        return "*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#152238;font:14px sans-serif;padding:14px}" +
            "header{background:#111923;color:#fff;padding:16px;border-radius:8px;margin-bottom:12px;display:flex;justify-content:space-between;gap:12px}" +
            "header strong{display:block;font-size:19px}header span,header time{color:#aeb9c8;font-size:12px}" +
            ".account,.research,.empty{background:#fff;border:1px solid #dfe4eb;border-radius:8px;margin-bottom:12px;padding:14px}" +
            ".account-head{display:flex;justify-content:space-between;gap:10px}.account h2,.research h2{font-size:17px;margin:0}.account p{color:#6b788b;margin:5px 0 0}" +
            ".status{font-size:12px;padding:4px 7px;border-radius:4px;background:#edf1f6;color:#526176;height:24px}.status.live{background:#e7f7f0;color:#087b56}.status.saved-snapshot{background:#fff3d9;color:#9a6300}" +
            ".metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:13px 0}.metrics>div{background:#f6f8fa;padding:10px;border-radius:6px;min-width:0}.metrics span{display:block;color:#768397;font-size:11px}.metrics strong{display:block;margin-top:5px;font-size:15px;overflow-wrap:anywhere}" +
            ".positions{border-top:1px solid #e6e9ee}.positions article{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f4}.positions h3{font-size:15px;margin:0}.positions small,.positions p{color:#78869a;font-weight:400}.positions p{font-size:12px;margin:4px 0 0}.position-value{text-align:right}.position-value strong,.position-value span{display:block}.position-value span{font-size:12px;margin-top:3px}" +
            ".rise{color:#e62946}.fall{color:#009b72}.flat{color:#59677b}.research{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.research h2{grid-column:1/-1}.research div{background:#f6f8fa;padding:10px;border-radius:6px;text-align:center;color:#536176}" +
            ".compact{border:0;margin:0;padding:10px 0;color:#78869a}footer{text-align:center;color:#7c8796;font-size:12px;padding:4px 12px 18px}@media(max-width:380px){.metrics{grid-template-columns:1fr}.research{grid-template-columns:1fr}}";
    }
}
