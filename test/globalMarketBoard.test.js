const test = require('node:test');
const assert = require('node:assert/strict');
const board = () => require('../services/globalMarketBoardService');
function yahoo(symbol = '^SOX') {
  const start = Date.parse('2026-10-08T13:30:00Z') / 1000;
  return { chart: { result: [{ meta: { symbol, regularMarketTime: start + 180,
    regularMarketPrice: 102, previousClose: 100, currentTradingPeriod: { regular: { start, end: start + 23400 } } },
    timestamp: [start - 86400, start, start + 60, start + 180],
    indicators: { quote: [{ close: [90, 100, null, 102], volume: [0, 0, 0, 0] }] } }] } };
}
test('cash indices are separate from futures and include requested benchmarks', () => {
  const list = board().CATALOG;
  for (const key of ['nasdaq-composite', 'dow-jones', 'sox', 'sp500', 'vix']) assert.ok(list.find(x => x.key === key));
  assert.notEqual(list.find(x => x.key === 'dow-jones').symbol, list.find(x => x.key === 'dow-future').symbol);
});
test('latest source session preserves missing minutes and uses source previous close', () => {
  const row = board().parseYahooIntraday(yahoo(), board().CATALOG.find(x => x.key === 'sox'));
  assert.equal(row.points.length, 4);
  assert.equal(row.points[1].close, null);
  assert.equal(row.points[2].close, null);
  assert.equal(row.points[3].close, 102);
  assert.equal(row.changePct, 2);
  assert.equal(row.sessionDate, '2026-10-08');
  assert.equal(row.points[0].volume, null);
  assert.throws(() => board().parseYahooIntraday(yahoo('WRONG'), board().CATALOG.find(x => x.key === 'sox')));
});
test('CFD night session retains cross-midnight source timestamps, never fabricates volume', () => {
  const raw = '/*ignored*/var _globalT=({"result":{"data":{"minLine_1d":[["2026-10-08","100","cme","","23:59","101","0","0","101","2026-10-08 23:59:00"],["00:01","102","0","0","101","2026-10-09 00:01:00"]]}}});';
  const row = board().parseSinaIntraday(raw, board().CATALOG.find(x => x.key === 'nasdaq100-future'));
  assert.equal(row.points.length, 3); assert.equal(row.points[1].close, null);
  assert.equal(row.points[2].close, 102); assert.equal(row.changePct, 2);
  assert.equal(row.points[0].volume, null);
  assert.throws(() => board().parseSinaIntraday('var _globalT=(process.exit());', {}));
});
test('requests are single-flight and a failed refresh retains old timestamps', async () => {
  let clock = 1791470000000, calls = 0, fail = false;
  const service = board().createGlobalMarketBoardService({ now: () => clock, http: { get: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 5));
    if (fail) throw Error('timeout'); return { data: yahoo() };
  } } });
  const [first, duplicate] = await Promise.all([service.get('sox'), service.get('sox')]);
  assert.equal(calls, 1); assert.deepEqual(first, duplicate);
  clock += 31000; fail = true;
  const retained = await service.get('sox');
  assert.equal(retained.fetchedAt, first.fetchedAt); assert.equal(retained.status, 'cached');
  assert.deepEqual(retained.points, first.points);
  await assert.rejects(service.get('file:///secret'));
});
test('one slow source does not block the board; at most four sources run concurrently', async () => {
  let active = 0, maximum = 0;
  const service = board().createGlobalMarketBoardService({ responseBudgetMs: 5, http: { get: async () => {
    active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 40)); active--; throw Error('source offline');
  } } });
  const result = await service.fetch(['sox', 'dow-jones', 'sp500', 'vix', 'nasdaq-composite']);
  assert.ok(result.items.some(item => item.status === 'loading'));
  await Promise.all(result.items.map(item => service.get(item.key)));
  assert.equal(maximum, 4);
});
