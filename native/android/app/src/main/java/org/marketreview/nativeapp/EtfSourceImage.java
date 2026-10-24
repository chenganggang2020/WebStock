package org.marketreview.nativeapp;
import org.json.JSONObject;

/** In-memory identity for the selected report's image; no report/store mutation. */
final class EtfSourceImage {
  static final int MAX_BYTES = 4 * 1024 * 1024;
  private String key;
  String url = "";
  long generation;
  boolean select(JSONObject report) {
    String candidate = report.optString("originalImageUrl", "");
    String next = report.optString("articleId") + "\n" + report.optString("asOf") + "\n" + candidate;
    if (next.equals(key)) return false;
    key = next;
    url = EtfDaily.allowedUrl(candidate, true) ? candidate : "";
    generation++;
    return true;
  }
  boolean current(long token) { return generation == token; }
  void clear() { key = null; url = ""; generation++; }
  static boolean safeDimensions(int width, int height) {
    return width > 0 && height > 0 && width <= 8192 && height <= 32768 &&
        (long)width * height <= 8 * 1024 * 1024;
  }
}
