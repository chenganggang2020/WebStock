const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GLOBAL_SIGNAL_DEFINITIONS,
  parseSinaGlobalSignals,
  createGlobalMarketSignalService
} = require('../services/globalMarketSignalService');

const payload = [
  'var hq_str_hf_CHA50CFD="14711.520,,14711.000,14712.000,14753.000,14706.000,01:24:44,14728.000,14724.000,824830,21,6,2026-09-02,富时中国A50期货,41400";',
  'var hq_str_hf_ES="7642.430,,7642.500,7642.750,7708.000,7638.750,01:24:47,7699.000,7701.250,0,26,32,2026-09-02,标普500指数期货,0";',
  'var hq_str_int_hangseng="恒生指数,25329.73,-237.26,-0.93";',
  'var hq_str_b_KOSPI="韩国KOSPI指数,6835.8000,15.78,0.23,2:27 AM,14:27:00,2026-09-01,14:32:40,6784.2900,6820.0200,6857.3500,6732.4700,0";',
  'var hq_str_fx_susdcnh="01:24:48,6.721900,6.722100,6.717800,90,6.717800,6.725000,6.716000,6.721900,离岸人民币（香港）,0.060000,0.004100,0.00134,,6.995700,6.715000,,2026-09-02";'
].join('\n');

test('cross-market parser rejects missing and non-positive prices without inventing a flat change', () => {
  for (const price of ['', ' ', '0', '-1', 'NaN']) {
    assert.equal(parseSinaGlobalSignals('var hq_str_int_hangseng="恒生指数,' + price + ',,";').length, 0);
  }
  const missing = parseSinaGlobalSignals('var hq_str_int_hangseng="恒生指数,25000,,";')[0];
  assert.equal(missing.changePct, null);
  const flat = parseSinaGlobalSignals('var hq_str_int_hangseng="恒生指数,25000,,0";')[0];
  assert.equal(flat.changePct, 0);
});

test('cross-market parser keeps prices, percent changes and source timestamps explicit', () => {
  const selected = GLOBAL_SIGNAL_DEFINITIONS.filter(item => [
    'china-a50-future', 'sp500-future', 'hang-seng', 'kospi', 'usd-cnh'
  ].includes(item.key));
  const result = parseSinaGlobalSignals(payload, selected);

  assert.equal(result.length, 5);
  assert.equal(result[0].key, 'china-a50-future');
  assert.equal(result[0].value, 14711.52);
  assert.equal(result[0].changePct, -0.1119);
  assert.equal(result[0].observedAt, '2026-09-02 01:24:44');
  assert.equal(result[2].changePct, -0.93);
  assert.equal(result[3].observedAt, '2026-09-01 14:27:00');
  assert.equal(result[4].value, 6.7219);
  assert.equal(result[4].changePct, 0.06);
  assert.equal(result[4].inverseForAShares, true);
});

test('cross-market service reports partial availability instead of fabricating missing quotes', async () => {
  const service = createGlobalMarketSignalService({
    definitions: GLOBAL_SIGNAL_DEFINITIONS.slice(0, 2),
    now: () => Date.parse('2026-09-02T01:30:00+08:00'),
    marketData: {
      get: async () => ({ data: 'var hq_str_hf_CHA50CFD="14711.520,,14711.000,14712.000,14753.000,14706.000,01:24:44,14728.000,14724.000,824830,21,6,2026-09-02,富时中国A50期货,41400";' })
    }
  });

  const result = await service.fetch();
  assert.equal(result.status, 'partial');
  assert.equal(result.items[0].status, 'available');
  assert.equal(result.items[1].status, 'unavailable');
  assert.match(result.source.note, /公开行情快照/);
});

test('unavailable snapshot feed returns dated-unavailable slots so independent index history can still render',async()=>{
  const service=createGlobalMarketSignalService({marketData:{get:async()=>{throw Error('offline');}}});
  const result=await service.fetch();
  assert.equal(result.items.length,GLOBAL_SIGNAL_DEFINITIONS.length);assert.equal(result.status,'unavailable');
  assert.ok(result.items.every(item=>item.value===null && item.observedAt===''));
});

test('watch desk includes verified US futures and commodity symbols without substituting empty legacy Dow feed', () => {
  const required = ['hf_YM', 'hf_GC', 'hf_CL', 'hf_OIL', 'hf_NQ', 'hf_ES'];
  for (const symbol of required) assert.ok(GLOBAL_SIGNAL_DEFINITIONS.some(item => item.symbol === symbol), symbol);
  assert.ok(!GLOBAL_SIGNAL_DEFINITIONS.some(item => item.symbol === 'hf_DJS'));
  const raw = 'var hq_str_hf_GC="4323.299,,4320.300,4320.700,4351.600,4289.200,04:59:59,4298.000,4309.500,0,3,2,2026-09-26,纽约黄金,0";';
  const [gold] = parseSinaGlobalSignals(raw);
  assert.equal(gold.value, 4323.3);
  assert.equal(gold.observedAt, '2026-09-26 04:59:59');
  assert.equal(gold.changePct, 0.5886);
  assert.match(gold.name, /CFD/);
  assert.equal(gold.unit, '美元/盎司');
});
