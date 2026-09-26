const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSectorService(payload, historyRows = []) {
  const snapshots = [];
  const sectors = [{ id: 1, name: '测试板块' }];
  const leaders = [{ id: 1, sector_id: 1, code: '600000', name: '测试一' }, { id: 2, sector_id: 1, code: '600001', name: '测试二' }];
  const db = { transaction: fn => fn, prepare(sql) { return {
    all: () => sql.includes('FROM sector_leader_snapshots') ? historyRows : sql.includes('FROM sector_leaders') ? leaders : sectors,
    get: () => ({ count: 1 }), run: value => { snapshots.push(value); return { changes: 1 }; }
  }; } };
  const context = { module: { exports: {} }, console, Buffer, require(name) {
    if (name === '../db') return db;
    if (name === 'axios') return { get: async () => ({ data: payload }) };
    if (name === 'iconv-lite') return { decode: buffer => buffer.toString() };
    if (name === '../utils/market') return { toSinaSymbol: code => 'sh' + code };
    throw new Error(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/sectorService.js'), 'utf8'), context);
  return Object.assign(context.module.exports, { snapshots });
}

test('sector averages do not count unavailable leaders as flat', async () => {
  const service = loadSectorService('');
  const unavailable = await service.getDashboard();
  assert.equal(unavailable.sectors[0].avgChange, null);
  assert.equal(unavailable.sectors[0].status, '待刷新');
  assert.equal(service.snapshots[0].change, null);
  assert.equal(service.snapshots[0].price, null);
  const partial = await loadSectorService('var hq_str_sh600000="测试,10,10,10.2,0,0,0,0,0,100";').getDashboard();
  assert.equal(partial.sectors[0].avgChange, 2);
});

test('incomplete quote fields stay unknown while real zero turnover is preserved', async () => {
  const missingClose = await loadSectorService('var hq_str_sh600000="测试,10,,10.2,0,0,0,0,0,";').getDashboard();
  assert.equal(missingClose.sectors[0].avgChange, null);
  assert.equal(missingClose.overview[0].amount, null);
  const zero = await loadSectorService('var hq_str_sh600000="测试,10,10,10,0,0,0,0,0,0";').getDashboard();
  assert.equal(zero.sectors[0].leaders[0].change, 0);
  assert.equal(zero.sectors[0].leaders[0].amount, 0);
});

test('leader trends keep a missing latest observation and its delta unknown', () => {
  for (const change of [null, undefined, '', ' ', false]) {
    const service = loadSectorService('', [
      { code: '600000', change }, { code: '600000', change: 3 }
    ]);
    const [trend] = service.getLeaderTrends();
    assert.equal(trend.latestChange, null);
    assert.equal(trend.previousChange, 3);
    assert.equal(trend.changeDelta, null);
  }
});

test('leader trends skip unknown previous observations and retain real zero changes', () => {
  const service = loadSectorService('', [
    { code: '600000', change: 0 }, { code: '600000', change: null },
    { code: '600000', change: '' }, { code: '600000', change: 2 },
    { code: '600001', change: 2 }, { code: '600001', change: null },
    { code: '600002', change: 0 }, { code: '600002', change: 0 }
  ]);
  const zero = service.getLeaderTrends().find(item => item.code === '600000');
  assert.equal(zero.latestChange, 0);
  assert.equal(zero.previousChange, 2);
  assert.equal(zero.changeDelta, -2);
  const withoutPrevious = service.getLeaderTrends().find(item => item.code === '600001');
  assert.equal(withoutPrevious.previousChange, null);
  assert.equal(withoutPrevious.changeDelta, null);
  const flat = service.getLeaderTrends().find(item => item.code === '600002');
  assert.equal(flat.previousChange, 0);
  assert.equal(flat.changeDelta, 0);
});
