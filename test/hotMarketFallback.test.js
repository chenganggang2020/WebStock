const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const hotMarket = require('../services/hotMarketService');

test('unavailable market sources keep local watch sectors outside today hot boards', async () => {
  const overview = await hotMarket.getOverview({ refresh: true, fast: true });

  assert.equal(overview.marketStatus, 'unavailable');
  assert.deepEqual(overview.boards.day, []);
  assert.ok(overview.localWatchBoards.length > 0);
  assert.ok(overview.localWatchBoards.every(board => board.kind === 'local-watch'));
  assert.ok(overview.localWatchBoards.every(board => board.heatScore === null));
});
