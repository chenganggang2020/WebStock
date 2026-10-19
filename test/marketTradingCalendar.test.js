const test = require('node:test');
const assert = require('node:assert/strict');

test('exchange calendar excludes holidays and make-up weekends and fails closed outside verified years', () => {
  const calendar = require('../services/marketTradingCalendar');
  assert.equal(calendar.tradingDay('2026-09-07').open, true);
  assert.equal(calendar.tradingDay('2026-09-25').open, false);
  assert.equal(calendar.tradingDay('2026-10-01').open, false);
  assert.equal(calendar.tradingDay('2026-10-10').open, false);
  assert.equal(calendar.tradingDay('2026-10-08').open, true);
  assert.equal(calendar.tradingDay('2027-01-04').known, false);
  assert.equal(calendar.tradingDay('2027-01-04').open, false);
});

test('latest expected observation respects lunch, holiday and pre-open sessions', () => {
  const calendar = require('../services/marketTradingCalendar');
  assert.equal(calendar.expectedObservation('2026-09-07T04:00:00Z'), '2026-09-07T03:30:00.000Z');
  assert.equal(calendar.expectedObservation('2026-09-07T01:00:00Z'), '2026-09-04T07:00:00.000Z');
  assert.equal(calendar.expectedObservation('2026-10-07T02:00:00Z'), '2026-09-30T07:00:00.000Z');
});
