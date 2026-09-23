const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCapturePayload,
  createTonghuashunWindowHoldingService
} = require('../services/tonghuashunWindowHoldingService');

const catalog = new Map([
  ['000657', '中钨高新'],
  ['600183', '生益科技']
]);

test('Tonghuashun window capture normalizes validated numeric holding cells', () => {
  const result = normalizeCapturePayload({
    available: true,
    observedAt: '2026-09-03T02:30:00.000Z',
    cashBalance: '78.17',
    displayedMarketValue: '40642.17',
    rows: [
      { code: '000657', quantity: '200', avgCost: '67.135', currentPrice: '60.020' },
      { code: '600183', quantity: '200', avgCost: '137.352', currentPrice: '143.190' }
    ]
  }, { catalog, now: new Date('2026-09-03T02:30:20.000Z') });

  assert.equal(result.snapshotDate, '2026-09-03');
  assert.equal(result.cashBalance, 78.17);
  assert.equal(result.holdings.length, 2);
  assert.deepEqual(result.holdings[0], {
    code: '000657',
    name: '中钨高新',
    quantity: 200,
    avgCost: 67.135,
    currentPrice: 60.02
  });
  assert.equal(result.totalMarketValue, 40642);
});

test('Tonghuashun window capture rejects duplicate or unknown security codes', () => {
  assert.throws(() => normalizeCapturePayload({
    available: true,
    observedAt: '2026-09-03T02:30:00.000Z',
    cashBalance: '10',
    displayedMarketValue: '12004',
    rows: [
      { code: '000657', quantity: '200', avgCost: '67.135', currentPrice: '60.020' },
      { code: '000657', quantity: '200', avgCost: '67.135', currentPrice: '60.020' }
    ]
  }, { catalog, now: new Date('2026-09-03T02:30:20.000Z') }), /重复/);

  assert.throws(() => normalizeCapturePayload({
    available: true,
    observedAt: '2026-09-03T02:30:00.000Z',
    cashBalance: '10',
    displayedMarketValue: '12004',
    rows: [{ code: '999999', quantity: '200', avgCost: '67.135', currentPrice: '60.020' }]
  }, { catalog, now: new Date('2026-09-03T02:30:20.000Z') }), /证券代码/);
});

test('Tonghuashun window capture rejects an incomplete visible grid by market-value reconciliation', () => {
  assert.throws(() => normalizeCapturePayload({
    available: true,
    observedAt: '2026-09-03T02:30:00.000Z',
    cashBalance: '10',
    displayedMarketValue: '50000',
    rows: [{ code: '000657', quantity: '200', avgCost: '67.135', currentPrice: '60.020' }]
  }, { catalog, now: new Date('2026-09-03T02:30:20.000Z') }), /市值合计/);
});

test('Tonghuashun window capture accepts a complete grid when holding PnL reconciles despite a stale summary market value', () => {
  const result = normalizeCapturePayload({
    available: true,
    observedAt: '2026-09-03T02:30:00.000Z',
    cashBalance: '2315.17',
    displayedMarketValue: '50000.00',
    displayedHoldingPnl: '-255.40',
    visibleRowsComplete: true,
    rows: [
      { code: '000657', quantity: '200', avgCost: '67.135', currentPrice: '60.020' },
      { code: '600183', quantity: '200', avgCost: '137.352', currentPrice: '143.190' }
    ]
  }, { catalog, now: new Date('2026-09-03T02:30:20.000Z') });

  assert.equal(result.totalMarketValue, 40642);
  assert.equal(result.summaryMarketValueMismatch, true);
});

test('Tonghuashun window capture rejects a grid that may contain off-screen holding rows', () => {
  assert.throws(() => normalizeCapturePayload({
    available: true,
    observedAt: '2026-09-03T02:30:00.000Z',
    cashBalance: '10',
    displayedMarketValue: '12004',
    displayedHoldingPnl: '-1423',
    visibleRowsComplete: false,
    rows: [{ code: '000657', quantity: '200', avgCost: '67.135', currentPrice: '60.020' }]
  }, { catalog, now: new Date('2026-09-03T02:30:20.000Z') }), /未显示持仓行/);
});

test('Tonghuashun window holding service syncs only a validated capture', async () => {
  const synced = [];
  const service = createTonghuashunWindowHoldingService({
    runCapture: async function() {
      return {
        available: true,
        observedAt: '2026-09-03T02:30:00.000Z',
        cashBalance: '78.17',
        displayedMarketValue: '12004.17',
        rows: [{ code: '000657', quantity: '200', avgCost: '67.135', currentPrice: '60.020' }]
      };
    },
    catalog: function() { return catalog; },
    holdings: {
      syncHoldingText: function(text, options) {
        synced.push({ payload: JSON.parse(text), options });
        return { account: { id: 4 }, snapshot: { id: 9 }, importedCount: 1, unchanged: false };
      }
    }
  });

  const result = await service.captureAndSync({ now: new Date('2026-09-03T02:30:20.000Z') });

  assert.equal(result.available, true);
  assert.equal(result.method, 'windows-ocr');
  assert.equal(result.holdingCount, 1);
  assert.equal(synced[0].options.sourceLabel, '同花顺窗口只读采集');
  assert.match(synced[0].options.dedupeKey, /^[a-f0-9]{64}$/);
});

test('Tonghuashun window holding service limits unchanged snapshots to one per five-minute freshness bucket', async () => {
  const synced = [];
  const service = createTonghuashunWindowHoldingService({
    runCapture: async function(input) {
      const currentPrice = input.now.getUTCMinutes() === 31 ? 61 : 60;
      return {
        available: true,
        observedAt: input.now.toISOString(),
        cashBalance: '100',
        displayedMarketValue: String(currentPrice * 200),
        visibleRowsComplete: true,
        rows: [{ code: '000657', quantity: '200', avgCost: '67.135', currentPrice: String(currentPrice) }]
      };
    },
    catalog: function() { return catalog; },
    holdings: {
      syncHoldingText: function(text, options) {
        synced.push({ payload: JSON.parse(text), options });
        return { account: { id: 4 }, snapshot: { id: synced.length }, importedCount: 1, unchanged: false };
      }
    }
  });

  await service.captureAndSync({ now: new Date('2026-09-03T02:30:00.000Z') });
  await service.captureAndSync({ now: new Date('2026-09-03T02:31:00.000Z') });
  await service.captureAndSync({ now: new Date('2026-09-03T02:35:00.000Z') });

  assert.equal(synced[0].options.dedupeKey, synced[1].options.dedupeKey);
  assert.notEqual(synced[1].options.dedupeKey, synced[2].options.dedupeKey);
});
