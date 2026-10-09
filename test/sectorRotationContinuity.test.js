const test = require('node:test');
const assert = require('node:assert/strict');
const { rotationResult } = require('../services/capitalFlow/sectorRotationModel');

function lunchSamples() {
  const labels = [];
  for (let minute = 10 * 60 + 50; minute <= 11 * 60 + 30; minute++) labels.push(minute);
  for (let minute = 13 * 60; minute <= 13 * 60 + 4; minute++) labels.push(minute);
  return labels.map(minute => {
    const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const elapsed = minute - 570 - (minute >= 780 ? 90 : 0);
    const cents = elapsed * 100000000;
    return { date: '2026-09-17', scope: 'industry', sourceKey: 'fixture:unchanged',
      receivedAt: new Date(`2026-09-17T${hhmm}:00+08:00`).toISOString(),
      coverage: { totalReported: 1, complete: true },
      rows: [{ code: 'BK0001', name: 'Fixture', reconciled: true,
        combinedNetCents: String(cents), darkNetCents: String(cents * 2),
        visibleNetCents: String(-cents), changeRatio: 0.01 }] };
  });
}
function calculate(snapshots, options = {}) {
  return rotationResult(snapshots, { scope: 'industry', metric: 'combined',
    minutes: 5, code: 'BK0001', now: Date.parse('2026-09-17T13:04:00+08:00'), ...options });
}
test('5/15/30 trading-minute windows continue through lunch without synthetic samples', () => {
  for (const minutes of [5, 15, 30]) {
    const samples = lunchSamples(), result = calculate(samples, { minutes });
    assert.equal(result.eligible, 1);
    assert.equal(result.detail.deltaCents, String(minutes * 100000000));
    assert.equal(result.detail.elapsedMinutes, minutes);
    assert.equal(result.detail.speedYuanPerMinute, 1000000);
    assert.equal(result.sampleCount, samples.length);
    assert.equal(result.windowBasis, 'trading-minutes');
  }
});
test('13:02 uses the 11:27 endpoint; lunch adds no time to the speed denominator', () => {
  const s = lunchSamples().filter(p => p.receivedAt <= '2026-09-17T05:02:00.000Z');
  const r = calculate(s, { now: Date.parse('2026-09-17T13:02:00+08:00') });
  assert.equal(r.detail.startAt, '2026-09-17T03:27:00.000Z');
  assert.equal(r.detail.endAt, '2026-09-17T05:02:00.000Z');
  assert.equal(r.detail.deltaCents, '500000000');
  assert.equal(r.detail.speedChange, 0);
});
test('a real gap in trading time is not erased by lunch compression', () => {
  const s = lunchSamples().filter(p => !(p.receivedAt > '2026-09-17T03:25:00.000Z' &&
    p.receivedAt < '2026-09-17T05:02:00.000Z'));
  assert.equal(calculate(s).eligible, 0);
});
test('source, universe-size, reconciliation and field-validity barriers remain', () => {
  for (const mutate of [
    p => { p.sourceKey = 'fixture:changed'; },
    p => { p.coverage.totalReported = 2; },
    p => { p.rows[0].reconciled = false; },
    p => { p.rows[0].combinedNetCents = null; },
    p => { p.rows = []; }
  ]) {
    const s = lunchSamples(); mutate(s.find(p => p.receivedAt === '2026-09-17T05:00:00.000Z'));
    assert.equal(calculate(s).eligible, 0);
  }
});
test('row-level timestamps from a different date cannot inherit the batch session', () => {
  const s = lunchSamples();
  s.at(-1).rows[0].receivedAt = '2026-09-18T05:04:00.000Z';
  assert.equal(calculate(s).eligible, 0);
});
test('display clock and explicit continuity metadata retain original observed timestamps', () => {
  const s = lunchSamples(), r = calculate(s);
  const before = r.detail.series.find(p => p.at === '2026-09-17T03:30:00.000Z');
  const after = r.detail.series.find(p => p.at === '2026-09-17T05:00:00.000Z');
  assert.equal(before.tradingTimeMs, 120 * 60000);
  assert.equal(after.tradingTimeMs, before.tradingTimeMs);
  assert.equal(after.gapBefore, false);
  assert.equal(after.sourceKey, 'fixture:unchanged');
  assert.equal(after.clockVersion, 'cn-continuous-samples/v1');
});
