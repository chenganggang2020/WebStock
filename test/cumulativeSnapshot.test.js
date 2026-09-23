const test = require('node:test');
const assert = require('node:assert/strict');
const {SNAPSHOT_VERSION, cumulativeStep: step} = require('../services/capitalFlow/cumulativeSnapshot');

// Fixed synthetic fixture; no current clock or trading calendar lookup.
const T = 1789608600000;
const snap = (dt = 0, patch = {}) => ({version: SNAPSHOT_VERSION,
  sourceId: 'fixture-vendor', methodologyId: 'v1', venue: 'SZ', symbol: '000001',
  tradingDay: '2026-09-17', metricId: 'dark_net', period: 'DAY',
  unit: 'CNY_CENT', kind: 'CUMULATIVE', automaticTrading: false,
  resetToken: 'a', revision: 0, observedAtMs: T + dt,
  receivedAtMs: T + dt + 10, netCents: '100', ...patch});
const start = patch => step(null, snap(0, patch)).state;
const gross = {inflowCents: '200', outflowCents: '100'};
const eq = assert.equal;

test('first snapshot is only a baseline', () => {
  const r = step(null, snap()).result;
  eq(r.reason, 'FIRST_OBSERVATION'); eq(r.deltaNetCents, null); eq(r.breakBefore, true);
});
test('net falls and crosses zero without reset', () => {
  const a = step(start(), snap(100, {netCents: '40'}));
  const b = step(a.state, snap(200, {netCents: '-20'}));
  for (const r of [a.result, b.result]) {
    eq(r.status, 'DELTA'); eq(r.deltaNetCents, '-60'); eq(r.segment, 1);
  }
});
test('gross rises while net falls', () => {
  const r = step(start(gross), snap(100, {
    netCents: '50', inflowCents: '220', outflowCents: '170'})).result;
  eq(r.status, 'DELTA'); eq(r.deltaNetCents, '-50');
});
test('zero is distinct from unavailable', () => {
  eq(step(start(), snap(100)).result.deltaNetCents, '0');
});
test('money above Number safe range stays exact', () => {
  const s = start({netCents: '90071992547409930000'});
  eq(step(s, snap(100, {netCents: '90071992547409930001'})).result.deltaNetCents, '1');
});
for (const [field, value] of Object.entries({sourceId: 'vendor-b', methodologyId: 'v2',
  venue: 'SH', symbol: '600000', tradingDay: '2026-09-18', metricId: 'visible_net', period: 'AM'})) {
  test(`${field} switch`, () => {
    const r = step(start(), snap(field === 'tradingDay' ? 86400000 : 100, {[field]: value})).result;
    eq(r.reason, 'SCOPE_CHANGED'); eq(r.deltaNetCents, null); eq(r.segment, 2);
  });
}
test('explicit reset, then same token permits normal delta', () => {
  const a = step(start(), snap(100, {resetToken: 'b', netCents: '3'}));
  eq(a.result.reason, 'EXPLICIT_RESET'); eq(a.result.deltaNetCents, null);
  eq(step(a.state, snap(200, {resetToken: 'b', netCents: '1'})).result.deltaNetCents, '-2');
});
test('explicit reset at identical observation time', () => {
  const r = step(start(), snap(0, {resetToken: 'b', netCents: '0', receivedAtMs: T + 20})).result;
  eq(r.reason, 'EXPLICIT_RESET'); eq(r.deltaNetCents, null);
});
test('duplicate updates arrival watermark, not baseline', () => {
  const a = step(start(), snap(0, {receivedAtMs: T + 500}));
  eq(a.result.status, 'DUPLICATE'); eq(a.state.baseline.receivedAtMs, T + 10);
  eq(a.state.lastReceivedAtMs, T + 500);
  assert.throws(() => step(a.state, snap(100)), /arrival order/);
});
test('same-time revision is adjustment, not trading flow', () => {
  const a = step(start(), snap(100, {netCents: '130'}));
  const b = step(a.state, snap(100, {revision: 1, netCents: '120', receivedAtMs: T + 120}));
  eq(b.result.status, 'REVISION_BASELINE'); eq(b.result.deltaNetCents, null);
  eq(b.result.revisionAdjustmentCents, '-10'); eq(b.result.breakBefore, true);
  eq(b.result.segment, 2); eq(a.result.deltaNetCents, '30');
  eq(step(b.state, snap(200, {netCents: '150'})).result.deltaNetCents, '30');
});
test('lower revision cannot roll back state', () => {
  const r = step(start({revision: 2}), snap(0, {revision: 1, netCents: '90'}));
  eq(r.result.status, 'STALE_REVISION'); eq(r.state.baseline.netCents, '100');
});
test('same-revision conflict blocks; evidenced reset or scope switch recovers', () => {
  const a = step(start(), snap(0, {netCents: '99', receivedAtMs: T + 20}));
  eq(a.result.reason, 'SAME_REVISION_CONFLICT');
  const b = step(a.state, snap(100, {netCents: '150'}));
  eq(b.result.status, 'BLOCKED'); eq(b.result.deltaNetCents, null);
  eq(b.state.baseline.netCents, '100');
  eq(step(b.state, snap(200, {resetToken: 'b'})).result.status, 'BASELINE');
  eq(step(b.state, snap(200, {sourceId: 'b'})).result.reason, 'SCOPE_CHANGED');
});
test('late correction cannot restore an old reset epoch', () => {
  const a = step(start(), snap(100, {resetToken: 'b'}));
  const b = step(a.state, snap(0, {revision: 9, netCents: '999', receivedAtMs: T + 200}));
  eq(b.result.status, 'LATE'); eq(b.result.deltaNetCents, null);
  eq(b.state.baseline.resetToken, 'b');
});
test('gross regression blocks instead of guessing a reset', () => {
  const r = step(start(gross), snap(100, {
    netCents: '50', inflowCents: '150', outflowCents: '100'}));
  eq(r.result.reason, 'COUNTER_REGRESSION'); eq(r.result.deltaNetCents, null);
  eq(r.state.segment, 1);
});
test('adding or removing gross counters blocks', () => {
  eq(step(start(), snap(100, gross)).result.reason, 'SCHEMA_CHANGED');
  eq(step(start(gross), snap(100)).result.reason, 'SCHEMA_CHANGED');
});
test('invalid inputs reject rather than repair', () => {
  for (const p of [{unit: 'CNY'}, {netCents: 100}, {netCents: '-0'}, {netCents: '01'},
    {netCents: '1.5'}, {automaticTrading: true}, {inflowCents: '200'},
    {inflowCents: '200', outflowCents: '90'}, {revision: -1}, {resetToken: ''},
    {sourceId: ''}, {version: 'bad'}, {receivedAtMs: T - 1},
    {observedAtMs: Number.MAX_SAFE_INTEGER + 1}]) {
    assert.throws(() => step(null, snap(0, p)), TypeError);
  }
});
test('pure and JSON-serializable; previous outputs remain unchanged', () => {
  const s = start(), x = Object.freeze(snap(100, {netCents: '80'}));
  const before = JSON.stringify({s, x}), a = step(s, x);
  assert.deepEqual(a, step(JSON.parse(JSON.stringify(s)), x));
  eq(JSON.stringify({s, x}), before);
  eq(Object.isFrozen(a.result), true); eq(Object.isFrozen(a.state.baseline), true);
});
test('deterministic prefix replay without future data', () => {
  const xs = [snap(), snap(100, {netCents: '90'}),
    snap(100, {revision: 1, netCents: '85', receivedAtMs: T + 120}), snap(200)];
  const replay = rows => {
    let state = null;
    return rows.map(x => {const r = step(state, x); state = r.state; return r.result;});
  };
  assert.deepEqual(replay(xs.slice(0, 2)), replay(xs).slice(0, 2));
  assert.deepEqual(replay(xs), replay(xs));
});
test('a retired reset token cannot reappear at the same timestamp', () => {
  const a = step(start(), snap(0, {resetToken: 'b', netCents: '0', receivedAtMs: T + 20}));
  const b = step(a.state, snap(0, {receivedAtMs: T + 30}));
  eq(b.result.status, 'STALE_RESET'); eq(b.state.baseline.resetToken, 'b');
});

test('rejects impossible dates and observation-day mismatch in Beijing time', () => {
  for (const tradingDay of ['2026-99-99', '2026-02-30', '2026-09-16']) {
    assert.throws(() => step(null, snap(0, {tradingDay})), /tradingDay/);
  }
});

test('accepts a valid leap day and next-day receipt without changing observation date', () => {
  const observedAtMs = Date.parse('2024-02-29T15:00:00+08:00');
  eq(step(null, snap(0, {tradingDay: '2024-02-29', observedAtMs,
    receivedAtMs: observedAtMs + 86400000})).result.status, 'BASELINE');
});

test('late prior-day packet never replaces today baseline', () => {
  const r = step(start(), snap(-86400000, {tradingDay: '2026-09-16', receivedAtMs: T + 100}));
  eq(r.result.status, 'LATE'); eq(r.result.deltaNetCents, null);
  eq(r.state.baseline.tradingDay, '2026-09-17');
});

test('authoritative higher revision recovers same-time conflict without counting adjustment as flow', () => {
  const blocked = step(start(), snap(0, {netCents: '99', receivedAtMs: T + 20}));
  const r = step(blocked.state, snap(0, {netCents: '110', revision: 1, receivedAtMs: T + 30}));
  eq(r.result.status, 'REVISION_BASELINE'); eq(r.result.revisionAdjustmentCents, '10');
  eq(r.result.deltaNetCents, null); eq(r.result.breakBefore, true);
  eq(step(r.state, snap(100, {netCents: '115'})).result.deltaNetCents, '5');
});

test('revision cannot clear a schema or counter-regression block', () => {
  const blocked = step(start(gross), snap(100, {netCents: '50', inflowCents: '150', outflowCents: '100'}));
  eq(step(blocked.state, snap(0, {...gross, revision: 1, receivedAtMs: T + 200})).result.status, 'BLOCKED');
});

test('ten-minute sampling gap keeps total change but breaks continuity and segment', () => {
  const r = step(start(), snap(600000, {netCents: '130'}), {maxTradingGapMs: 60000});
  eq(r.result.status, 'DELTA'); eq(r.result.deltaNetCents, '30');
  eq(r.result.breakBefore, true); eq(r.result.continuity, 'gap'); eq(r.result.segment, 2);
  eq(r.result.tradingElapsedMs, 600000);
  eq(step(r.state, snap(660000, {netCents: '140'}), {maxTradingGapMs: 60000}).result.continuity, 'continuous');
});

test('lunch break is not a sampling outage or a per-minute flow interval', () => {
  const at = time => Date.parse('2026-09-17T' + time + '+08:00');
  const a = step(null, snap(0, {observedAtMs: at('11:30:00'), receivedAtMs: at('11:30:01')}));
  const b = step(a.state, snap(0, {observedAtMs: at('13:00:00'), receivedAtMs: at('13:00:01')}), {maxTradingGapMs: 60000});
  eq(b.result.continuity, 'session-break'); eq(b.result.breakBefore, true);
  eq(b.result.tradingElapsedMs, 0);
});

test('unknown cadence never asserts continuous observations', () => {
  eq(step(start(), snap(100)).result.continuity, 'unknown');
  eq(step(start(), snap(100)).result.breakBefore, true);
  assert.throws(() => step(start(), snap(100), {maxTradingGapMs: 0}), /maxTradingGapMs/);
});
