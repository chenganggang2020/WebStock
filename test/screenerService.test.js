const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-screener-service-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../db');
const screener = require('../services/screenerService');

function risingKline(start, step) {
  return Array.from({ length: 80 }, (_, index) => ({
    close: start + index * step,
    volume: index < 70 ? 10000 : 16000
  }));
}

test('smart screener parses demand and promotes matching theme business candidates', () => {
  db.prepare('DELETE FROM stock_profiles WHERE code IN (?, ?)').run('688362', '600584');
  db.prepare(`
    INSERT INTO stock_profiles (code, source, payload_json, fetched_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run('688362', 'test', JSON.stringify({
    code: '688362',
    name: '甬矽电子',
    industry: '半导体',
    boards: ['先进封装', '芯片封测'],
    businessSummary: '主营集成电路封装测试服务，先进封装占比较高',
    mainBusinessItems: [
      { name: '集成电路封装测试服务', ratio: 82.1, reportDate: '2025-12-31' }
    ],
    tags: ['科创板', '先进封装', '半导体']
  }));

  const result = screener.runScreener({
    strategy: 'sector-leader',
    scope: 'all',
    demand: '先进封装和半导体方向，只看科创板或创业板，不要已经涨太高，优先主营业务真实相关',
    limit: 50,
    marketSnapshot: [
      { code: '688362', price: 25.2, change: 2.1, amount: 900000000 },
      { code: '600584', price: 58.3, change: 9.8, amount: 2400000000 }
    ],
    klineSnapshot: [
      { code: '688362', data: risingKline(20, 0.04) },
      { code: '600584', data: risingKline(45, 0.22) }
    ]
  });

  assert.ok(result.parsedDemand.themes.some(item => item.name === '先进封装'));
  assert.deepEqual(result.parsedDemand.markets.sort(), ['创业板', '科创板']);
  assert.equal(result.parsedDemand.avoidOverheated, true);

  const preferred = result.candidates.find(item => item.code === '688362');
  assert.ok(preferred, 'expected matched theme leader to be in candidates');
  assert.equal(preferred.marketLabel, '科创板');
  assert.ok(preferred.factorTags.includes('先进封装'));
  assert.ok(preferred.factorTags.includes('主营匹配'));
  assert.ok(preferred.reasons.some(reason => /主营|需求/.test(reason)));

  const overheated = result.candidates.find(item => item.code === '600584');
  assert.ok(overheated, 'expected overheated theme leader to remain visible for comparison');
  assert.ok(overheated.risks.some(risk => /过热|涨幅/.test(risk)));
  assert.ok(preferred.score > overheated.score);
});
