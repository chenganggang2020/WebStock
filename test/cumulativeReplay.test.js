const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {SNAPSHOT_VERSION, replaySnapshots} = require('../services/capitalFlow/cumulativeSnapshot');
const T = Date.parse('2026-09-17T09:30:00+08:00');
const row = (dt = 0, patch = {}) => ({version: SNAPSHOT_VERSION, kind: 'CUMULATIVE',
  unit: 'CNY_CENT', sourceId: 'synthetic', methodologyId: 'v1', venue: 'SZ', symbol: '000001',
  tradingDay: '2026-09-17', metricId: 'test_net', period: 'DAY', resetToken: 'a', revision: 0,
  automaticTrading: false, observedAtMs: T + dt, receivedAtMs: T + dt + 10, netCents: '100', ...patch});

test('replay isolates securities, providers and methodologies across interleaved arrivals', () => {
  const xs = [row(), row(100, {symbol: '000002', netCents: '900'}),
    row(200, {sourceId: 'other', netCents: '300'}), row(300, {methodologyId: 'v2', netCents: '500'}),
    row(400, {netCents: '110'}), row(500, {symbol: '000002', netCents: '890'})];
  const rs = replaySnapshots(xs, {maxTradingGapMs: 60000});
  assert.equal(rs[4].result.deltaNetCents, '10');
  assert.equal(rs[5].result.deltaNetCents, '-10');
  assert.deepEqual(replaySnapshots(xs.slice(0, 4)), replaySnapshots(xs).slice(0, 4));
});

test('replay quarantines yesterday without poisoning current baseline', () => {
  const rs = replaySnapshots([row(), row(-86400000, {tradingDay: '2026-09-16', receivedAtMs: T + 20}),
    row(100, {netCents: '120'})]);
  assert.equal(rs[1].result.status, 'LATE');
  assert.equal(rs[1].activeTradingDay, '2026-09-17');
  assert.equal(rs[2].result.deltaNetCents, '20');
});

test('replay never sorts by observation time or accepts malformed / oversized input', () => {
  assert.throws(() => replaySnapshots([row(100), row()]), /arrival order/);
  assert.throws(() => replaySnapshots([row(), row(100, {netCents: null})]), /netCents/);
  assert.throws(() => replaySnapshots(new Array(10001).fill(row())), /10000/);
});

const cli = path.resolve(__dirname, '../scripts/replay-cumulative-snapshots.js');
const run = (input, args = []) => spawnSync(process.execPath, [cli, '--input', '-', ...args],
  {input, encoding: 'utf8', timeout: 10000});
test('offline CLI emits exact input hash, interval delta and unverified provenance', () => {
  const input = JSON.stringify({version: 'webstock.cumulative-replay/v1', snapshots: [row(), row(60000, {netCents: '125'})]});
  const result = run(input, ['--max-gap-ms', '60000']);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.provenance.inputSha256, createHash('sha256').update(input).digest('hex'));
  assert.equal(output.provenance.verification, 'not-verified');
  assert.equal(output.records[1].result.deltaNetCents, '25');
  assert.equal(output.automaticTrading, false);
});

test('offline CLI rejects bad schema, trailing errors and excess input without partial output', () => {
  for (const input of ['{}', '{', JSON.stringify({version: 'webstock.cumulative-replay/v1', snapshots: [row(), row(100, {automaticTrading: true})]}), ' '.repeat(2 * 1024 * 1024 + 1)]) {
    const result = run(input);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
  }
  assert.equal(run('{}', ['--max-gap-ms', 'NaN']).status, 1);
});

test('normal day transition starts a baseline and repeat rows do not count twice', () => {
  const next = row(86400000, {tradingDay: '2026-09-18', netCents: '5'});
  const rs = replaySnapshots([row(), next, {...next, receivedAtMs: next.receivedAtMs + 1}]);
  assert.equal(rs[1].result.status, 'BASELINE');
  assert.equal(rs[1].result.deltaNetCents, null);
  assert.equal(rs[2].result.status, 'DUPLICATE');
  assert.equal(rs[2].result.deltaNetCents, null);
});

test('rejects malformed UTF-8 rather than silently changing evidence labels', () => {
  const {replayDocument} = require('../scripts/replay-cumulative-snapshots');
  const head = Buffer.from('{"version":"webstock.cumulative-replay/v1","note":"');
  assert.throws(() => replayDocument(Buffer.concat([head, Buffer.from([0xff]), Buffer.from('","snapshots":[]}')])), /encoded data/);
});
