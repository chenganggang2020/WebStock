#pragma once
#include <QDate>
#include <QStringList>
#include <optional>

// Mainland exchange calendar already used by the ETF source contract. Unknown
// years are deliberately not guessed. Source dates remain unchanged everywhere.
namespace tradingDaySelection {
inline std::optional<bool> open(QDate day) {
  if (!day.isValid() || day.year()!=2026) return std::nullopt;
  if (day.dayOfWeek()>5) return false;
  const auto md=day.toString("MM-dd");
  for(const auto& range:QStringList{"01-01/01-03","02-15/02-23","04-04/04-06","05-01/05-05","06-19/06-21","09-25/09-27","10-01/10-07"}) {
    const auto bounds=range.split('/');if(md>=bounds[0]&&md<=bounds[1])return false;
  }
  return true;
}
inline QDate effective(QDate chosen) {
  auto day=chosen;
  for(int n=0;n<40;++n) {
    const auto state=open(day);
    if(!state.has_value())return chosen;
    if(*state)return day;
    day=day.addDays(-1);
  }
  return chosen;
}
inline QString caption(QDate chosen) {
  const auto actual=effective(chosen);
  return actual==chosen?chosen.toString(Qt::ISODate):chosen.toString(Qt::ISODate)+" 休市 · 回看 "+actual.toString(Qt::ISODate);
}
}
