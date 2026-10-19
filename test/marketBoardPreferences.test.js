const test = require('node:test');
const assert = require('node:assert/strict');
test('saved empty selection stays empty; unknown keys and duplicates are removed', () => {
  const p = require('../js/modules/marketBoardPreferences');
  assert.deepEqual(p.normalize({ keys: [] }, ['sox']).keys, []);
  assert.deepEqual(p.normalize({ keys: ['sox', 'bad', 'sox'] }, ['sox']).keys, ['sox']);
  assert.ok(p.normalize(null).keys.includes('sox'));
});
test('widget defaults to private amounts and selectable read-only blocks', () => {
  const p = require('../js/modules/marketBoardPreferences');
  assert.equal(p.widget(null).hideAmounts, true);
  assert.equal(p.widget({ accountId: -1 }).accountId, 0);
  assert.equal(p.widget({ showPositions: true }).showPositions, true);
});
