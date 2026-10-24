package org.marketreview.nativeapp;
import java.time.LocalDate;
import java.util.Collection;

/** Selection policy shared with desktop; only the confirmed 2026 calendar. */
final class TradingDaySelection {
  static Boolean open(LocalDate day) {
    if (day == null || day.getYear() != 2026) return null;
    if (day.getDayOfWeek().getValue() > 5) return false;
    String md = day.toString().substring(5);
    for (String range : new String[] {"01-01/01-03", "02-15/02-23", "04-04/04-06",
             "05-01/05-05", "06-19/06-21", "09-25/09-27", "10-01/10-07"}) {
      String[] bounds = range.split("/");
      if (md.compareTo(bounds[0]) >= 0 && md.compareTo(bounds[1]) <= 0) return false;
    }
    return true;
  }
  static LocalDate effective(LocalDate chosen) {
    LocalDate day = chosen;
    for (int n = 0; n < 40; n++, day = day.minusDays(1)) {
      Boolean state = open(day);
      if (state == null) return chosen;
      if (state) return day;
    }
    return chosen;
  }
  static LocalDate parse(String value) {
    try { return value != null && value.matches("\\d{4}-\\d{2}-\\d{2}") ? LocalDate.parse(value) : null; }
    catch (RuntimeException e) { return null; }
  }
  static String caption(LocalDate chosen) {
    LocalDate actual = effective(chosen);
    if (!actual.equals(chosen)) return chosen + " 休市 · 回看 " + actual;
    if (open(chosen) == null) return chosen + " · 交易日历未知";
    if (!open(chosen)) return chosen + " 休市 · 上一交易日未知";
    return chosen.toString();
  }
  static String latestOnOrBefore(Collection<String> sourceDays, LocalDate chosen) {
    LocalDate limit = effective(chosen);
    String best = "";
    for (String value : sourceDays) {
      LocalDate day = parse(value);
      if (day != null && !day.isAfter(limit) && value.compareTo(best) > 0) best = value;
    }
    return best;
  }
  static String recordCaption(LocalDate chosen, String sourceDay) {
    String prefix = caption(chosen);
    if (sourceDay.isEmpty()) return prefix + " · 无已保存来源数据";
    return prefix + (sourceDay.equals(effective(chosen).toString()) ? " · 来源数据 " : " · 最近可用记录 ") + sourceDay;
  }
}
