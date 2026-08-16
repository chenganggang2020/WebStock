const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseSelfStockCache,
  findNewestSelfStockCache
} = require('../services/tonghuashunWatchlistService');

test('Tonghuashun self-stock parser keeps supported securities in source order', () => {
  const catalog = new Map([
    ['601138', '工业富联'],
    ['159001', '货币ETF易方达'],
    ['000977', '浪潮信息']
  ]);
  const payload = JSON.stringify({
    Data: {
      Selfstock: '601138|1A0001|159001|601138|000977,17|48|17|17|33',
      Count: 5,
      ModifyTime: '20260817090102'
    }
  });

  const result = parseSelfStockCache(payload, catalog);

  assert.deepEqual(result.items, [
    { code: '601138', name: '工业富联' },
    { code: '159001', name: '货币ETF易方达' },
    { code: '000977', name: '浪潮信息' }
  ]);
  assert.deepEqual(result.ignoredCodes, ['1A0001']);
  assert.equal(result.sourceCount, 5);
  assert.equal(result.modifyTime, '20260817090102');
});

test('Tonghuashun cache discovery chooses the newest user cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-'));
  const older = path.join(root, 'user-a', 'SelfStockCache.json');
  const newer = path.join(root, 'user-b', 'SelfStockCache.json');
  fs.mkdirSync(path.dirname(older), { recursive: true });
  fs.mkdirSync(path.dirname(newer), { recursive: true });
  fs.writeFileSync(older, '{}');
  fs.writeFileSync(newer, '{}');
  fs.utimesSync(older, new Date('2026-08-16T01:00:00Z'), new Date('2026-08-16T01:00:00Z'));
  fs.utimesSync(newer, new Date('2026-08-17T01:00:00Z'), new Date('2026-08-17T01:00:00Z'));

  assert.equal(findNewestSelfStockCache([root]), newer);
  fs.rmSync(root, { recursive: true, force: true });
});
