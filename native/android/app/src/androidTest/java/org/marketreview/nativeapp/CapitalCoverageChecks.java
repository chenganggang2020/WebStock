package org.marketreview.nativeapp;
import java.util.Arrays;
import org.json.*;
public final class CapitalCoverageChecks {
 public static void main(String[] args)throws Exception {
  JSONArray rows=new JSONArray("[{\"label\":\"2026-09-30\"},{\"label\":\"2026-10-23\"},{\"label\":\"2026-09-30\"},{\"label\":\"invalid\"}]");
  String text=CapitalHistoryCoverage.caption(rows,Arrays.asList("","2026-10-22","2026-10-20","invalid"));
  if(!text.contains("2026-09-30 ～ 2026-10-23 · 2个日期")||!text.contains("2026-10-20 ～ 2026-10-22 · 2个日期")||!text.contains("不保证连续")||!text.contains("未自动回补"))throw new AssertionError(text);
  text=CapitalHistoryCoverage.caption(new JSONArray(),Arrays.asList("","bad"));
  if(!text.contains("日线：无")||!text.contains("分时档案：无"))throw new AssertionError(text);
  if(!rows.getJSONObject(0).getString("label").equals("2026-09-30"))throw new AssertionError("source mutated");
  System.out.println("PASS 3 capital history coverage checks");
 }
}
