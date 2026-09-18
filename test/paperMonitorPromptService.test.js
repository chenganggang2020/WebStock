const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAllowedUniverse,
  validateDecisionPayload,
  assertFreshHoldingContext,
  buildMonitorPrompt
} = require('../services/paperMonitorPromptService');

function validDecision() {
  return {
    asOf: '2026-09-02T02:30:00.000Z',
    marketView: 'neutral',
    cashTargetPercent: 30,
    orders: [{
      code: '600183',
      action: 'buy',
      targetPositionPercent: 10,
      confidence: 72,
      reason: '量价结构改善',
      invalidation: '跌破盘中支撑'
    }],
    portfolioRisk: ['公开行情并非交易所逐笔'],
    nextReviewAt: '2026-09-02T06:50:00.000Z'
  };
}

test('paper monitor universe merges candidates, paper positions and latest Tonghuashun holdings', () => {
  const result = buildAllowedUniverse({
    items: [{ code: '600183', name: '生益科技' }],
    positions: [{ code: '002463', name: '沪电股份' }]
  }, {
    holdings: [
      { code: '002463', name: '沪电股份', quantity: 200 },
      { code: '000977', name: '浪潮信息', quantity: 100 }
    ]
  });

  assert.deepEqual(result.map(item => item.code), ['600183', '002463', '000977']);
  assert.deepEqual(result[1].roles, ['paper-position', 'tonghuashun-holding']);
});

test('paper monitor decision contract accepts exact valid JSON', () => {
  const result = validateDecisionPayload(validDecision());

  assert.equal(result.valid, true);
  assert.equal(result.value.orders[0].targetPositionPercent, 10);
  assert.deepEqual(result.errors, []);
});

test('paper monitor decision contract rejects missing, extra and out-of-range fields', () => {
  const invalid = validDecision();
  invalid.orders[0].code = 'SH600183';
  invalid.orders[0].surprise = true;
  invalid.cashTargetPercent = 120;
  delete invalid.orders[0].invalidation;

  const result = validateDecisionPayload(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join('；'), /cashTargetPercent/);
  assert.match(result.errors.join('；'), /code/);
  assert.match(result.errors.join('；'), /invalidation/);
  assert.match(result.errors.join('；'), /surprise/);
});

test('paper monitor blocks unavailable or non-current Tonghuashun holdings', () => {
  assert.throws(() => assertFreshHoldingContext({ available: false, error: '没有导出文件' }, {
    now: new Date('2026-09-02T02:30:00.000Z')
  }), /没有导出文件/);

  assert.throws(() => assertFreshHoldingContext({
    available: true,
    snapshotDate: '2026-09-01',
    observedAt: '2026-09-01T07:00:00.000Z',
    holdings: []
  }, { now: new Date('2026-09-02T02:30:00.000Z') }), /不是本交易日/);
});

test('paper monitor prompt separates real holdings from paper holdings and carries source times', () => {
  const holdingContext = assertFreshHoldingContext({
    available: true,
    snapshotDate: '2026-09-02',
    observedAt: '2026-09-02T02:29:00.000Z',
    source: 'tonghuashun-export-file',
    holdings: [{ code: '000977', name: '浪潮信息', quantity: 100, costValue: 8500 }]
  }, { now: new Date('2026-09-02T02:30:00.000Z') });

  const result = buildMonitorPrompt({
    paper: {
      id: 7,
      capital: 100000,
      positions: [{ code: '600183', name: '生益科技', quantity: 100, lastPrice: 143.21 }],
      latestSnapshot: { cashValue: 85674, totalValue: 99995 }
    },
    holdingContext,
    quotes: {
      '600183': { price: 143.21, tradeDate: '2026-09-02', tradeTime: '10:30:00' },
      '000977': { price: 85.6, tradeDate: '2026-09-02', tradeTime: '10:30:00' }
    },
    asOf: '2026-09-02T02:30:00.000Z'
  });

  assert.match(result.prompt, /同花顺真实持仓（只读参考，不是模拟账户）/);
  assert.match(result.prompt, /纸面账户持仓（仅模拟成交）/);
  assert.match(result.prompt, /tonghuashun-export-file/);
  assert.match(result.prompt, /2026-09-02T02:29:00.000Z/);
  assert.equal(result.allowedUniverse.some(item => item.code === '000977'), true);
  assert.match(result.promptHash, /^[a-f0-9]{64}$/);
});
