const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INDEX_DEFINITIONS,
  parseSinaIndexQuotes,
  buildTurnoverSummary
} = require('../services/marketOverviewService');

test('market overview keeps index symbols distinct from six-digit stock codes', () => {
  assert.deepEqual(INDEX_DEFINITIONS.slice(0, 4).map(item => item.symbol), [
    's_sh000001',
    's_sz399001',
    's_sz399006',
    's_sh000688'
  ]);

  const raw = [
    'var hq_str_s_sh000001="上证指数,3868.20,18.20,0.47,412345600,51234567";',
    'var hq_str_s_sz399001="深证成指,12120.30,-22.40,-0.18,523456700,62876543";',
    'var hq_str_s_sz399006="创业板指,2630.10,21.10,0.81,183456700,22876543";',
    'var hq_str_s_sh000688="科创50,1090.40,9.40,0.87,72345600,9876543";'
  ].join('\n');

  const result = parseSinaIndexQuotes(raw, INDEX_DEFINITIONS);

  assert.equal(result.length, 4);
  assert.deepEqual(result[0], {
    key: 'sse',
    code: '000001',
    symbol: 'sh000001',
    name: '上证指数',
    price: 3868.2,
    changeAmount: 18.2,
    changePct: 0.47,
    volume: 412345600,
    amount: 512345670000
  });
  assert.equal(result[3].name, '科创50');
});

test('homepage index strip includes large, mid and small-cap A-share benchmarks', () => {
  const byKey = new Map(INDEX_DEFINITIONS.map(item => [item.key, item]));
  assert.equal(INDEX_DEFINITIONS.length, 8);
  assert.equal(byKey.get('csi300').symbol, 's_sh000300');
  assert.equal(byKey.get('csi500').symbol, 's_sh000905');
  assert.equal(byKey.get('csi1000').symbol, 's_sh000852');
});

test('turnover summary uses Shanghai and Shenzhen index amounts without inventing missing values', () => {
  assert.deepEqual(buildTurnoverSummary([
    { key: 'sse', amount: 512345670000 },
    { key: 'szse', amount: 628765430000 },
    { key: 'chinext', amount: 228765430000 }
  ]), {
    shanghai: 512345670000,
    shenzhen: 628765430000,
    total: 1141111100000
  });

  assert.deepEqual(buildTurnoverSummary([{ key: 'sse', amount: 512345670000 }]), {
    shanghai: 512345670000,
    shenzhen: null,
    total: null
  });
});
