// Deterministic oracle: executes the existing chart formulas, never the new engine.
// Usage: node native/tests/generate_legacy_indicators.cjs [--check]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const sourcePath = path.join(root, 'js/modules/indicators.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceSha = 'f43b5456d039171fd1bbe8da065317610236d808d0571b2e9597ca1e8b97a3ca';
if (sha(source) !== sourceSha) throw Error('Legacy oracle changed; review the numerical contract before regenerating.');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: sourcePath, timeout: 1000 });
const oracle = sandbox.window.Indicators;
const cols = ['case', 'contract', 'kdjPeriod', 'rsiPeriod', 'cciPeriod', 'index',
  'time', 'open', 'high', 'low', 'close', 'volume', 'valid', 'closed',
  'k', 'd', 'j', 'rsi', 'cci', 'obv', 'kdjReady'];
const cases = [];
function bars(closes, spread = 1, volumes = []) {
  return closes.map((close, i) => ({ time: 60000 * (i + 1), open: close,
    high: close + spread, low: close - spread, close,
    volume: volumes[i] ?? 100 + 10 * i, valid: true, closed: true }));
}
function add(id, input, periods = [9, 14, 14], contract = 'legacy-chart-v1', note = '') {
  cases.push({ id, input, periods, contract, note });
}
add('default-mixed', bars(Array.from({ length: 48 }, (_, i) => 20 + ((i * 7) % 19) / 3)));
add('mixed-n3', bars([10, 11, 10, 12, 11, 13]), [3, 3, 3], 'legacy-chart-v1', 'Independent hand-checked anchor.');
add('flat-n3', bars([10, 10, 10, 10, 10], 0), [3, 3, 3]);
add('rising', bars(Array.from({ length: 30 }, (_, i) => 10 + i)), [9, 14, 14]);
add('falling', bars(Array.from({ length: 30 }, (_, i) => 50 - i)), [9, 14, 14]);
add('period-one', bars([10, 11, 10, 10, 12], 0), [1, 1, 1]);
add('short-warmup', bars([10, 11]), [3, 3, 3]);
add('warmup-boundary', bars([10, 11, 12, 13]), [3, 3, 3]);
add('kdj-overshoot', bars([100, 100, 100, 200, 300, 400, 400, 100, 20, 10], 0), [3, 3, 3]);
add('cci-rounding', bars(Array.from({ length: 73 }, (_, i) =>
  3.14155 + ((i * 17) % 43) * 0.000037), 0.00006), [9, 14, 14]);
add('cci-tiny-deviation', bars([1.23445, 1.23446, 1.23444, 1.23455, 1.23456], 0), [3, 3, 3]);
add('obv-zero-equal-negative', bars([10, 10, 9, 8, 9, 9, 10], 0.5,
  [25, 999, 100, 100, 0, 10000, 400]), [3, 3, 3]);
add('obv-large', bars([10, 11, 9, 12, 8, 8], 0.5,
  [1000000000000, 3000000000000, 4000000000000, 2000000000000, 5000000000000, 9000000000000]), [3, 3, 3]);
let seed = 0x14c0ffee;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const randomBars = Array.from({ length: 520 }, (_, i) => {
  const close = 5 + random() * 195, open = 5 + random() * 195;
  return { time: (i + 1) * 60000, open, high: Math.max(open, close) + random() * 5,
    low: Math.min(open, close) - random() * 4, close, volume: Math.floor(random() * 1000000), valid: true, closed: true };
});
add('seeded-random', randomBars);
add('period-500', randomBars, [500, 500, 500]);
function safety(id, edit, note = '') {
  const input = bars([10, 11, 10, 12, 11, 13, 14, 12, 15, 13, 17, 18], 0.5);
  edit(input);
  add(id, input, [3, 3, 3], 'native-gap-v1', note);
}
safety('gap-valid-flag', b => { b[3].valid = false; });
safety('gap-price-missing', b => { b[3].close = NaN; });
safety('gap-ohlc-invalid', b => { b[3].high = b[3].low - 1; });
safety('gap-nonpositive', b => { b[3].low = 0; });
safety('gap-duplicate-time', b => { b[3].time = b[2].time; });
safety('gap-backward-time', b => { b[3].time = b[1].time; });
safety('gap-time-missing', b => { b[3].time = NaN; });
safety('gap-volume-missing', b => { b[3].volume = NaN; }, 'Volume invalidates OBV only.');
safety('gap-volume-negative', b => { b[3].volume = -1; }, 'Volume invalidates OBV only.');
safety('provisional-tail', b => { b[b.length - 1].closed = false; }, 'Value may preview; readiness is not confirmation.');
safety('provisional-followed', b => { b[3].closed = false; }, 'Following row suppressed, matching market::closes; then restart.');
safety('provisional-consecutive', b => { b[3].closed = false; b[4].closed = false; });
safety('ordinary-session-gap', b => { b.slice(4).forEach(x => x.time += 5400000); }, 'Time distance alone does not create a gap.');

function priceMask(input) {
  let last = -Infinity, previousUnclosed = false;
  return input.map(b => {
    const valid = b.valid && [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)
      && b.low > 0 && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close);
    const result = valid && b.time > last && !previousUnclosed;
    previousUnclosed = !b.closed;
    if (b.time > last) last = b.time;
    return result;
  });
}
function expected(c) {
  const out = c.input.map(() => ({ k: null, d: null, j: null, rsi: null, cci: null, obv: null, kdjReady: false }));
  const price = priceMask(c.input);
  if (c.contract === 'legacy-chart-v1' && (!price.every(Boolean) ||
      !c.input.every(b => Number.isFinite(b.volume) && b.volume >= 0 && b.closed))) {
    throw Error(`${c.id}: unsafe input cannot be labelled a normal legacy oracle case`);
  }
  const evaluate = (mask, volumeOnly) => {
    for (let start = 0; start < c.input.length;) {
      if (!mask[start]) { start++; continue; }
      let end = start + 1;
      while (end < c.input.length && mask[end]) end++;
      const segment = c.input.slice(start, end).map(b => ({ ...b }));
      if (volumeOnly) oracle.calcOBV(segment);
      else {
        oracle.calcKDJ(segment, c.periods[0]);
        oracle.calcRSI(segment, c.periods[1]);
        oracle.calcCCI(segment, c.periods[2]);
      }
      segment.forEach((b, j) => {
        if (volumeOnly) out[start + j].obv = b.obv;
        else Object.assign(out[start + j], { k: b.kdj_k, d: b.kdj_d, j: b.kdj_j,
          rsi: b.rsi, cci: b.cci, kdjReady: j >= c.periods[0] - 1 });
      });
      start = end;
    }
  };
  evaluate(price, false);
  evaluate(price.map((ok, i) => ok && Number.isFinite(c.input[i].volume) && c.input[i].volume >= 0), true);
  return out;
}
const cell = value => value === null || (typeof value === 'number' && !Number.isFinite(value)) ? 'null'
  : typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
const lines = [cols.join(',')];
for (const c of cases) {
  const e = expected(c);
  c.input.forEach((b, index) => {
    const row = { case: c.id, contract: c.contract, kdjPeriod: c.periods[0], rsiPeriod: c.periods[1],
      cciPeriod: c.periods[2], index, ...b, ...e[index] };
    lines.push(cols.map(col => cell(row[col])).join(','));
  });
}
const csv = lines.join('\n') + '\n';
const manifest = {
  schemaVersion: 1, columns: cols, nullLiteral: 'null', numericTolerance: 1e-8,
  oracle: { path: 'js/modules/indicators.js', sha256: sha(source), execution: 'isolated Node vm; no business modules' },
  generator: { path: 'native/tests/generate_legacy_indicators.cjs', sha256: sha(fs.readFileSync(__filename)) },
  fixtureSha256: sha(csv), rows: lines.length - 1,
  contracts: {
    'legacy-chart-v1': 'Exact existing chart formulas on finite valid ordered bars. KDJ 9 fixed smoothing 3/3; simple rolling RSI 14 (flat=100); CCI 14 with intermediate toFixed(4); OBV starts at first volume.',
    'native-gap-v1': 'Explicit validity/time/previous-unclosed mask, then run the same oracle independently per segment. Invalid volume resets only OBV. Last unclosed value may preview, never implies signal confirmation.'
  },
  safetyOutsideFixture: 'Non-finite arithmetic result becomes missing and restarts only that indicator on the following valid row; tested directly in C++.',
  inputPolicy: { prices: 'one consistent supplied OHLC basis; no adjustment inside indicators', adjustment: 'synthetic-unadjusted',
    volumeUnit: 'supplied unit, fixture uses lots; no shares/lots conversion', timeUnit: 'milliseconds; strictly increasing, no inferred gap from duration' },
  readiness: 'KDJ ready means N valid rows, not closed/confirmed. RSI/CCI missing until N rows. OBV cumulative from segment start, not visible-window start.',
  excluded: ['VWAP (amount/unit/adjustment contract pending)', 'MACD/ATR/EMA/SMA/RVOL/sequential changes', 'UI/parameter persistence/native device acceptance'],
  cases: cases.map(c => ({ id: c.id, contract: c.contract, rows: c.input.length,
    periods: c.periods, note: c.note }))
};
const outputs = [['legacy-indicators.csv', csv], ['legacy-indicators-manifest.json', JSON.stringify(manifest, null, 2) + '\n']];
for (const [name, content] of outputs) {
  const file = path.join(root, 'native/contracts', name);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) throw Error(`${name} is not reproducible`);
  } else fs.writeFileSync(file, content);
}
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${manifest.rows} rows / ${cases.length} cases; oracle ${manifest.oracle.sha256}`);
