package org.marketreview.nativeapp;
import java.time.*;
import org.json.JSONObject;

/** One process observes the clock; SQLite owns attempts and source success. */
final class EtfSchedule {
  static final class Clock {
    private LocalDate observedDay;
    private boolean lateStartup;
    synchronized void observe(Instant now) {
      if (now == null) return;
      OffsetDateTime local = now.atOffset(ZoneOffset.ofHours(8));
      if (!local.toLocalDate().equals(observedDay)) {
        observedDay = local.toLocalDate();
        lateStartup = !local.toLocalTime().isBefore(LocalTime.of(9,25));
      }
    }
    synchronized String due(JSONObject state, Instant now) {
      if (now == null) return "";
      observe(now);
      OffsetDateTime local = now.atOffset(ZoneOffset.ofHours(8));
      LocalDate date = local.toLocalDate();
      LocalTime time = local.toLocalTime();
      String day = date.toString();
      if (!state.optBoolean("scheduleEnabled", false) || !EtfDaily.knownOpen(date) ||
          time.isBefore(LocalTime.of(8,50)) || day.equals(state.optString("lastSuccessTargetDate")))
        return "";
      String prior = state.optString("lastScheduledAt"), key = state.optString("lastScheduledKey");
      if (!prior.isEmpty()) {
        try {
          if (Duration.between(Instant.parse(prior),now).toMillis() < 600000) return "";
        } catch (RuntimeException invalid) { return ""; }
      }
      if (key.equals(day + "@catchup")) return "";
      String slot = "";
      if (!time.isBefore(LocalTime.of(9,25))) {
        if (!lateStartup) return "";
        slot = "catchup";
      } else {
        for (String candidate : new String[] {"08:50","09:00","09:10","09:20"})
          if (!time.isBefore(LocalTime.parse(candidate))) slot = candidate;
      }
      String next = day + "@" + slot;
      return slot.isEmpty() || key.equals(next) ? "" : next;
    }
  }
}
