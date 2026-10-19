const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadService(get) {
  const context = { module: { exports: {} }, process: { env: {} }, require: () => ({ get }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/sentimentService.js'), 'utf8'), context);
  return context.module.exports;
}

test('failed sentiment providers do not manufacture a production sample score', async () => {
  const service = loadService(async () => { throw new Error('offline'); });
  const result = await service.buildOverview({ refresh: true });
  assert.equal(result.aShare.score, null);
  assert.equal(result.aShare.sourceStatus, 'unavailable');
  assert.equal(result.aShare.breadthPct, null);
  assert.equal(result.tradeDate, null);
  assert.equal(result.vix, null);
});

test('empty provider responses degrade to unavailable rather than an exception', async () => {
  const service = loadService(async url => ({ data: url.includes('eastmoney') ? { rc: 0, data: { diff: [] } } : [] }));
  const result = await service.buildOverview({ refresh: true });
  assert.equal(result.aShare.score, null);
  assert.equal(result.aShare.sourceStatus, 'unavailable');
});

test('sentiment excludes absent changes but retains actual zero returns', () => {
  const service = loadService(async () => { throw new Error('not requested'); });
  const result = service.calcAshareSentiment([{ changePct: null }, { changePct: '' }, { changePct: 0 }, { changePct: 2 }], 'sina');
  assert.equal(result.total, 2);
  assert.equal(result.breadthPct, 50);
  assert.equal(service.labelScore(null), '未知');
  assert.equal(service.labelVix(null), '未知');
});

test('VIX history ignores missing closes instead of reporting a zero index', () => {
  const service = loadService(async () => { throw new Error('not requested'); });
  const result = service.parseVixHistory('DATE,OPEN,HIGH,LOW,CLOSE\n09/04/2026,15,16,14,15\n09/07/2026,,,,');
  assert.equal(result.value, 15);
  assert.equal(result.date, '09/04/2026');
});
