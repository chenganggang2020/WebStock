// Verified 2026 SSE A-share calendar, checked 2026-09-07.
// https://www.sse.com.cn/disclosure/dealinstruc/closed/
const SOURCE = 'https://www.sse.com.cn/disclosure/dealinstruc/closed/';
const HOLIDAYS = [
  ['2026-01-01', '2026-01-03'], ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'], ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'], ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07']
];

function clock(value) {
  const shifted = new Date(new Date(value).getTime() + 8 * 3600000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19), weekday: shifted.getUTCDay() };
}

function tradingDay(date) {
  const known = /^2026-\d{2}-\d{2}$/.test(String(date));
  if (!known) return { known: false, open: false, reason: '交易日历尚未覆盖该年份，暂停自动判断', source: SOURCE };
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const closed = [0, 6].includes(weekday) || HOLIDAYS.some(([start, end]) => date >= start && date <= end);
  return { known: true, open: !closed, reason: closed ? '交易所休市日' : '', source: SOURCE };
}

function previousTradingDay(date) {
  const value = new Date(date + 'T00:00:00Z');
  for (let index = 0; index < 40; index++) {
    value.setUTCDate(value.getUTCDate() - 1);
    const candidate = value.toISOString().slice(0, 10);
    const state = tradingDay(candidate);
    if (!state.known) return null;
    if (state.open) return candidate;
  }
  return null;
}

function expectedObservation(value) {
  const current = clock(value);
  const state = tradingDay(current.date);
  if (!state.known) return null;
  let date = current.date;
  let time = current.time;
  if (!state.open || time < '09:30:00') {
    date = previousTradingDay(date);
    time = '15:00:00';
  } else if (time > '15:00:00') time = '15:00:00';
  else if (time > '11:30:00' && time < '13:00:00') time = '11:30:00';
  return date ? new Date(date + 'T' + time + '+08:00').toISOString() : null;
}

function isContinuousSession(value) {
  const current = clock(value);
  return tradingDay(current.date).open &&
    (current.time >= '09:30:00' && current.time <= '11:30:00' || current.time >= '13:00:00' && current.time <= '15:00:00');
}

module.exports = { SOURCE, clock, tradingDay, previousTradingDay, expectedObservation, isContinuousSession };
