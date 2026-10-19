#pragma once
#include "etf_daily.hpp"

namespace etfDaily {
// In-memory observation belongs to one app run; attempts and success live in SQLite.
class ScheduleClock {
  QDate observedDay;
  bool lateStartup = false;
public:
  QString due(const QJsonObject &state, const QDateTime &now) {
    if (!now.isValid()) return {};
    const auto local = now.toOffsetFromUtc(28800);
    const auto date = local.date();
    const auto time = local.time();
    const auto day = date.toString(Qt::ISODate);
    if (observedDay != date) {
      observedDay = date;
      lateStartup = time >= QTime(9,25);
    }
    if (!state["scheduleEnabled"].toBool(false) || !knownOpen(date) ||
        time < QTime(8,50) || state["lastSuccessTargetDate"].toString() == day)
      return {};
    const auto priorKey = state["lastScheduledKey"].toString();
    const auto priorStamp = state["lastScheduledAt"].toString();
    if (!priorStamp.isEmpty()) {
      const auto prior = QDateTime::fromString(priorStamp, Qt::ISODateWithMs);
      if (!prior.isValid() || prior.msecsTo(now) < 600000) return {};
    }
    if (priorKey == day + "@catchup") return {};
    QString slot;
    if (time >= QTime(9,25)) {
      if (!lateStartup) return {};
      slot = "catchup";
    } else {
      for (const auto &candidate : {QTime(8,50),QTime(9,0),QTime(9,10),QTime(9,20)})
        if (time >= candidate) slot = candidate.toString("HH:mm");
    }
    const auto key = day + '@' + slot;
    return slot.isEmpty() || priorKey == key ? QString() : key;
  }
};
} // namespace etfDaily
