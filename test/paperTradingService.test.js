const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-paper-trading-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const paperPortfolios = require('../services/paperPortfolioService');
const trading = require('../services/paperTradingService');

test.after(function() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});

function createPaper() {
  return paperPortfolios.createFromPacket({
    capital: 100000,
    name: '盯盘模拟测试',
    packet: {
      schema: 'webstock.research.decision-packet.v1',
      generatedAt: '2026-09-02T02:25:00.000Z',
      candidates: [{
        code: '600183', name: '生益科技', consensusScore: 90, signalCount: 2
      }],
      evidence: []
    }
  });
}

test('holding mode requires a boolean and switching cancels only pending intents', () => {
  const paper = createPaper();
  trading.ensureMonitorSettings(paper.id);
  assert.throws(() => trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: 'false' }), /布尔|boolean|模式/);
  const asOf = '2026-09-02T02:30:00Z';
  saveDecision(paper, decision('buy', 10, asOf), asOf);
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false });
  assert.equal(trading.listOrders(paper.id)[0].status, 'cancelled');
  assert.equal(trading.listDecisions(paper.id).length, 1);
  assert.equal(trading.listFills(paper.id).length, 0);
});

test('explicit monitor candidates are bounded, additive and never initialize a holding', () => {
  const paper = createPaper();
  assert.throws(() => trading.addMonitorCandidates(paper.id, { codes: ['000977'] }), /观察中/);
  paperPortfolios.updateStatus(paper.id, 'active');
  trading.ensureMonitorSettings(paper.id);
  const before = paperPortfolios.getPortfolio(paper.id);
  const result = trading.addMonitorCandidates(paper.id, { codes: ['600183', '000977', '000977'] });
  assert.equal(result.addedCount, 1);
  assert.equal(result.paper.items.length, 2);
  assert.equal(result.paper.items.find(item => item.code === '600183').targetWeight, before.items[0].targetWeight);
  assert.equal(result.paper.items.find(item => item.code === '000977').targetWeight, 0);
  assert.equal(result.paper.positions.length, 0);
  assert.equal(trading.addMonitorCandidates(paper.id, { codes: ['000977'] }).addedCount, 0);
  assert.throws(() => trading.addMonitorCandidates(paper.id, { codes: ['not-a-code'] }), /代码/);
  assert.throws(() => trading.addMonitorCandidates(paper.id, { codes: Array(51).fill('600183') }), /50/);
});

test('paper execution rejects unverifiable volume and special risk securities instead of guessing a limit', () => {
  for (const caseName of ['missing-volume', 'risk-stock']) {
    const paper = createPaper();
    const asOf = '2026-09-02T02:30:00Z';
    trading.recordModelDecision(paper.id, { advisedAt: asOf, marketAsOf: asOf, modelId: 'test', mode: 'manual',
      allowedUniverse: [{ code: '600183', name: caseName === 'risk-stock' ? '*ST测试' : '测试' }], rawResponse: JSON.stringify(decision('buy', 10, asOf)) });
    const result = trading.executePendingOrders(paper.id, { '600183': {
      rows: [{ time: '2026-09-02 10:31:00', price: 10, volume: caseName === 'missing-volume' ? null : 10000 }],
      meta: { previousClose: 9.8, stale: false }
    } }, { now: '2026-09-02T02:31:10Z' });
    assert.equal(result.fills.length, 0);
    assert.equal(result.orders[0].status, 'rejected');
  }
});

test('paper buys preserve configured cash reserve and obey STAR minimum order size', () => {
  const paper = createPaper();
  const asOf = '2026-09-02T02:30:00Z';
  const payload = decision('buy', 10, asOf);
  payload.orders[0].code = '688001';
  trading.recordModelDecision(paper.id, { advisedAt: asOf, marketAsOf: asOf, modelId: 'test', mode: 'manual',
    allowedUniverse: [{ code: '688001', name: '测试' }], rawResponse: JSON.stringify(payload) });
  const result = trading.executePendingOrders(paper.id, { '688001': {
    rows: [{ time: '2026-09-02 10:31:00', price: 60, volume: 10000 }], meta: { previousClose: 60, stale: false }
  } }, { now: '2026-09-02T02:31:10Z' });
  assert.equal(result.fills.length, 0);
  assert.match(result.orders[0].statusReason, /200/);

  const restricted = paperPortfolios.createFromPacket({ capital: 100000, constraints: { cashReserve: 0.95 }, packet: {
    schema: 'webstock.research.decision-packet.v1', generatedAt: asOf, candidates: [{ code: '600183', name: '测试', consensusScore: 90, signalCount: 2 }], evidence: [] } });
  // createFromPacket caps configurable reserve at 90%; the engine must cap a larger valid target.
  const reservePayload = decision('buy', 15, asOf);
  reservePayload.cashTargetPercent = 85;
  saveDecision(restricted, reservePayload, asOf);
  const reserved = trading.executePendingOrders(restricted.id, { '600183': { rows: [{ time: '2026-09-02 10:31:00', price: 10, volume: 10000 }], meta: { previousClose: 9.8, stale: false } } }, { now: '2026-09-02T02:31:10Z' });
  assert.ok(!reserved.fills.length || reserved.paper.latestSnapshot.cashValue >= reserved.paper.latestSnapshot.totalValue * restricted.constraints.cashReserve);
});

function decision(action, targetPositionPercent, asOf) {
  return {
    asOf,
    marketView: 'neutral',
    cashTargetPercent: action === 'sell' ? 100 : 90,
    orders: [{
      code: '600183',
      action,
      targetPositionPercent,
      confidence: 72,
      reason: action === 'buy' ? '量价改善' : '达到失效条件',
      invalidation: action === 'buy' ? '跌破支撑' : '重新站回阻力'
    }],
    portfolioRisk: ['公开分钟行情并非交易所逐笔'],
    nextReviewAt: '2026-09-02T06:50:00.000Z'
  };
}

function saveDecision(paper, payload, advisedAt) {
  return trading.recordModelDecision(paper.id, {
    advisedAt,
    marketAsOf: advisedAt,
    modelId: 'test-model',
    mode: 'manual',
    prompt: 'test prompt',
    promptHash: 'a'.repeat(64),
    inputContext: { source: 'test' },
    allowedUniverse: [{ code: '600183', name: '生益科技' }],
    rawResponse: JSON.stringify(payload)
  });
}

test('default paper monitor bootstrap creates one active 100000 cash account without copying real holdings', () => {
  const first = paperPortfolios.ensureDefaultMonitorPortfolio({
    now: '2026-09-04T01:00:00.000Z'
  });
  const second = paperPortfolios.ensureDefaultMonitorPortfolio({
    now: '2026-09-04T01:01:00.000Z'
  });

  assert.equal(second.id, first.id);
  assert.equal(first.status, 'active');
  assert.equal(first.capital, 100000);
  assert.equal(first.items.length, 0);
  assert.equal(first.positions.length, 0);
  assert.equal(first.latestSnapshot.cashValue, 100000);
  assert.equal(first.latestSnapshot.marketValue, 0);
  assert.equal(first.latestSnapshot.totalValue, 100000);
  assert.equal(trading.ensureMonitorSettings(first.id).enabled, true);
});

test('paper monitor settings default to enabled three-times-daily automation', () => {
  const paper = createPaper();
  const settings = trading.ensureMonitorSettings(paper.id, {
    now: '2026-09-02T02:25:00.000Z'
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.startMode, 'today');
  assert.deepEqual(settings.schedule, ['09:35', '10:30', '14:50']);
  assert.equal(settings.holdingsSyncRequired, true);
});

test('paper monitor status updates preserve fields that were not supplied', () => {
  const paper = createPaper();
  trading.ensureMonitorSettings(paper.id, { now: '2026-09-02T02:25:00.000Z' });
  trading.updateMonitorRunStatus(paper.id, {
    lastHoldingsSyncAt: '2026-09-02T02:29:00.000Z',
    lastHoldingsSource: 'tonghuashun-export-file',
    lastRunSlot: '2026-09-02@10:30',
    lastError: ''
  });

  const updated = trading.updateMonitorRunStatus(paper.id, { lastError: 'OpenAI 暂不可用' });

  assert.equal(updated.lastHoldingsSyncAt, '2026-09-02T02:29:00.000Z');
  assert.equal(updated.lastHoldingsSource, 'tonghuashun-export-file');
  assert.equal(updated.lastRunSlot, '2026-09-02@10:30');
  assert.equal(updated.lastError, 'OpenAI 暂不可用');
});

test('choosing next trading day resets the activation time to the current choice', () => {
  const paper = createPaper();
  trading.ensureMonitorSettings(paper.id, { now: '2026-09-01T01:00:00.000Z' });

  const updated = trading.updateMonitorSettings(paper.id, {
    startMode: 'next-trading-day',
    now: '2026-09-02T07:00:00.000Z'
  });

  assert.equal(updated.startMode, 'next-trading-day');
  assert.equal(updated.activatedAt, '2026-09-02T07:00:00.000Z');
});

test('paper decision creates an order and fills on the next valid one-minute bar', () => {
  const paper = createPaper();
  const advisedAt = '2026-09-02T02:30:00.000Z';
  const saved = saveDecision(paper, decision('buy', 10, advisedAt), advisedAt);

  assert.equal(saved.decision.validationStatus, 'valid');
  assert.equal(saved.orders[0].status, 'pending');

  const result = trading.executePendingOrders(paper.id, {
    '600183': {
      rows: [
        { time: '2026-09-02 10:30:00', price: 10, volume: 10000 },
        { time: '2026-09-02 10:31:00', price: 10, volume: 12000 }
      ],
      meta: { dataSource: 'tencent-1m', previousClose: 9.8, stale: false }
    }
  }, { now: '2026-09-02T02:31:10.000Z' });

  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].quantity, 900);
  assert.equal(result.fills[0].rawPrice, 10);
  assert.equal(result.fills[0].executionPrice, 10.002);
  assert.equal(result.fills[0].commission, 5);
  assert.equal(result.fills[0].stampDuty, 0);
  assert.equal(result.paper.positions[0].quantity, 900);
  assert.equal(result.paper.latestSnapshot.cashValue, 90993.2);
});

test('paper trading rejects same-day sell under T+1 and allows a new next-day sell', () => {
  const paper = createPaper();
  saveDecision(paper, decision('buy', 10, '2026-09-02T02:30:00.000Z'), '2026-09-02T02:30:00.000Z');
  trading.executePendingOrders(paper.id, {
    '600183': {
      rows: [{ time: '2026-09-02 10:31:00', price: 10, volume: 12000 }],
      meta: { dataSource: 'tencent-1m', previousClose: 9.8, stale: false }
    }
  }, { now: '2026-09-02T02:31:10.000Z' });

  const sameDay = saveDecision(paper, decision('sell', 0, '2026-09-02T03:00:00.000Z'), '2026-09-02T03:00:00.000Z');
  const blocked = trading.executePendingOrders(paper.id, {
    '600183': {
      rows: [{ time: '2026-09-02 11:01:00', price: 10.2, volume: 10000 }],
      meta: { dataSource: 'tencent-1m', previousClose: 9.8, stale: false }
    }
  }, { now: '2026-09-02T03:01:10.000Z' });

  assert.equal(blocked.fills.length, 0);
  assert.equal(blocked.orders.find(item => item.id === sameDay.orders[0].id).status, 'rejected');
  assert.match(blocked.orders.find(item => item.id === sameDay.orders[0].id).statusReason, /T\+1/);

  saveDecision(paper, decision('sell', 0, '2026-09-03T01:30:00.000Z'), '2026-09-03T01:30:00.000Z');
  const sold = trading.executePendingOrders(paper.id, {
    '600183': {
      rows: [{ time: '2026-09-03 09:31:00', price: 10.5, volume: 10000 }],
      meta: { dataSource: 'eastmoney-1m', previousClose: 10.2, stale: false }
    }
  }, { now: '2026-09-03T01:31:10.000Z' });

  assert.equal(sold.fills.length, 1);
  assert.equal(sold.fills[0].quantity, 900);
  assert.equal(sold.fills[0].commission, 5);
  assert.equal(sold.fills[0].stampDuty, 4.72);
  assert.equal(sold.paper.positions.length, 0);
  assert.ok(sold.paper.latestSnapshot.totalPnl > 0);
});

test('invalid model JSON is audited without creating orders', () => {
  const paper = createPaper();
  const saved = trading.recordModelDecision(paper.id, {
    advisedAt: '2026-09-02T02:30:00.000Z',
    marketAsOf: '2026-09-02T02:30:00.000Z',
    modelId: 'test-model',
    mode: 'manual',
    prompt: 'test prompt',
    promptHash: 'b'.repeat(64),
    inputContext: {},
    allowedUniverse: [{ code: '600183', name: '生益科技' }],
    rawResponse: '{"orders":[]}'
  });

  assert.equal(saved.decision.validationStatus, 'invalid');
  assert.equal(saved.orders.length, 0);
  assert.ok(saved.decision.validationErrors.length > 0);
});

test('paper order is rejected when target weight exceeds the portfolio risk limit', () => {
  const paper = createPaper();
  const saved = saveDecision(paper, decision('buy', 40, '2026-09-02T02:30:00.000Z'), '2026-09-02T02:30:00.000Z');

  assert.equal(saved.orders[0].status, 'rejected');
  assert.match(saved.orders[0].statusReason, /单股上限/);
});

test('new hold advice cancels older pending intent for that security', () => {
  const paper = createPaper();
  const buy = saveDecision(paper, decision('buy', 10, '2026-09-02T02:30:00Z'), '2026-09-02T02:30:00Z');
  saveDecision(paper, decision('hold', 0, '2026-09-02T02:32:00Z'), '2026-09-02T02:32:00Z');
  assert.equal(trading.listOrders(paper.id).find(order => order.id === buy.orders[0].id).status, 'cancelled');
});

test('orders never fill retroactively after restart or carry yesterday intent into a new session', () => {
  const paper = createPaper();
  saveDecision(paper, decision('buy', 10, '2026-09-02T02:30:00Z'), '2026-09-02T02:30:00Z');
  const result = trading.executePendingOrders(paper.id, {
    '600183': { rows: [{ time: '2026-09-02 10:31:00', price: 10, volume: 12000 }], meta: { previousClose: 9.8, stale: false } }
  }, { now: '2026-09-03T02:31:00Z' });
  assert.equal(result.fills.length, 0);
  assert.equal(result.orders[0].status, 'cancelled');
});

test('late older bars cannot write behind newer account valuation and resurrect already spent cash', () => {
  const paper = createPaper();
  paperPortfolios.updateStatus(paper.id, 'active');
  const asOf = '2026-09-02T02:30:00Z';
  saveDecision(paper, decision('buy', 10, asOf), asOf);
  paperPortfolios.refreshPortfolio(paper.id, {}, { capturedAt: '2026-09-02T02:33:00Z', initializePositions: false });
  const result = trading.executePendingOrders(paper.id, { '600183': {
    rows: [{ time: '2026-09-02 10:31:00', price: 10, volume: 10000 }], meta: { previousClose: 9.8, stale: false }
  } }, { now: '2026-09-02T02:34:00Z' });
  assert.equal(result.fills.length, 0);
  assert.match(result.orders[0].statusReason, /早于.*净值|倒填/);
  assert.equal(result.paper.latestSnapshot.cashValue, 100000);
});

test('mark-to-market rejects per-security time regression even when the other quote advances', () => {
  const paper = createPaper();
  paperPortfolios.updateStatus(paper.id, 'active');
  const asOf = '2026-09-02T02:30:00Z';
  const payload = decision('buy', 10, asOf);
  payload.cashTargetPercent = 80;
  payload.orders.push({ ...payload.orders[0], code: '600000' });
  trading.recordModelDecision(paper.id, { advisedAt: asOf, marketAsOf: asOf, allowedUniverse: [{ code: '600183', name: 'A' }, { code: '600000', name: 'B' }], rawResponse: JSON.stringify(payload) });
  const market = (time, price) => ({ rows: [{ time: '2026-09-02 ' + time, price, volume: 10000 }], meta: { previousClose: 10, stale: false } });
  trading.executePendingOrders(paper.id, { '600183': market('10:31:00', 10), '600000': market('10:31:00', 10) }, { now: '2026-09-02T02:31:10Z' });
  trading.markToMarket(paper.id, { '600183': market('10:32:00', 10.1), '600000': market('10:32:00', 10.2) }, { now: '2026-09-02T02:32:10Z' });
  const marked = trading.markToMarket(paper.id, { '600183': market('10:33:00', 10.15), '600000': market('10:31:00', 9.9) }, { now: '2026-09-02T02:33:10Z' });
  assert.equal(marked.positions.find(p => p.code === '600000').lastPrice, 10.2);
  assert.equal(marked.latestSnapshot.sourceMetadata.coverageComplete, false);
  assert.ok(marked.latestSnapshot.warnings.length > 0);
});

test('unchanged price still persists an individual security observation-time advance', () => {
  const paper = createPaper();
  paperPortfolios.updateStatus(paper.id, 'active');
  const asOf = '2026-09-02T02:30:00Z';
  const payload = decision('buy', 10, asOf);
  payload.cashTargetPercent = 80;
  payload.orders.push({ ...payload.orders[0], code: '600000' });
  trading.recordModelDecision(paper.id, { advisedAt: asOf, marketAsOf: asOf, allowedUniverse: [{ code: '600183', name: 'A' }, { code: '600000', name: 'B' }], rawResponse: JSON.stringify(payload) });
  const market = (time, price = 10) => ({ rows: [{ time: '2026-09-02 ' + time, price, volume: 10000 }], meta: { previousClose: 10, stale: false } });
  trading.executePendingOrders(paper.id, { '600183': market('10:31:00'), '600000': market('10:31:00') }, { now: '2026-09-02T02:31:10Z' });
  trading.markToMarket(paper.id, { '600183': market('10:32:00'), '600000': market('10:31:00') }, { now: '2026-09-02T02:32:10Z' });
  const unchanged = trading.markToMarket(paper.id, { '600183': market('10:32:00'), '600000': market('10:32:00') }, { now: '2026-09-02T02:32:15Z' });
  assert.equal(unchanged.latestSnapshot.sourceMetadata.priceObservedAt['600000'], '2026-09-02T02:32:00.000Z');
  const marked = trading.markToMarket(paper.id, { '600183': market('10:33:00'), '600000': market('10:31:00', 9.9) }, { now: '2026-09-02T02:33:10Z' });
  assert.equal(marked.positions.find(p => p.code === '600000').lastPrice, 10);
  assert.equal(marked.latestSnapshot.sourceMetadata.coverageComplete, false);
});

test('a fill snapshot does not claim complete valuation for unpriced existing holdings', () => {
  const paper = createPaper();
  paperPortfolios.updateStatus(paper.id, 'active');
  const market = time => ({ rows: [{ time: '2026-09-02 ' + time, price: 10, volume: 10000 }], meta: { previousClose: 10, stale: false } });
  saveDecision(paper, decision('buy', 10, '2026-09-02T02:30:00Z'), '2026-09-02T02:30:00Z');
  trading.executePendingOrders(paper.id, { '600183': market('10:31:00') }, { now: '2026-09-02T02:31:10Z' });
  const asOf = '2026-09-02T02:38:00Z';
  const payload = decision('buy', 10, asOf);
  payload.orders[0].code = '600000';
  trading.recordModelDecision(paper.id, { advisedAt: asOf, marketAsOf: asOf, allowedUniverse: [{ code: '600000', name: 'B' }], rawResponse: JSON.stringify(payload) });
  const result = trading.executePendingOrders(paper.id, { '600000': market('10:39:00') }, { now: '2026-09-02T02:39:10Z' });
  assert.equal(result.paper.latestSnapshot.sourceMetadata.coverageComplete, false);
  const marked = trading.markToMarket(paper.id, { '600000': market('10:39:00') }, { now: '2026-09-02T02:39:10Z' });
  assert.equal(marked.latestSnapshot.sourceMetadata.coverageComplete, false);
  assert.ok(marked.latestSnapshot.warnings.length > 0);
});

test('orders in one batch consume cash in selected market-time order, never future-first', () => {
  const paper = createPaper();
  const firstTime = '2026-09-02T02:30:00Z';
  saveDecision(paper, decision('buy', 10, firstTime), firstTime);
  const secondTime = '2026-09-02T02:31:00Z';
  const payload = decision('buy', 10, secondTime);
  payload.orders[0].code = '600000';
  trading.recordModelDecision(paper.id, { advisedAt: secondTime, marketAsOf: secondTime, allowedUniverse: [{ code: '600000', name: 'B' }], rawResponse: JSON.stringify(payload) });
  const market = time => ({ rows: [{ time: '2026-09-02 ' + time, price: 10, volume: 10000 }], meta: { previousClose: 10, stale: false } });
  const result = trading.executePendingOrders(paper.id, { '600183': market('10:34:00'), '600000': market('10:32:00') }, { now: '2026-09-02T02:34:10Z' });
  assert.deepEqual(result.fills.map(fill => fill.code), ['600000', '600183']);
  assert.equal(result.paper.latestSnapshot.cashValue, 81986.4);
});

test('performance distinguishes an unstarted account from results and exposes all recorded costs', () => {
  const paper = createPaper();
  assert.equal(trading.getMonitorState(paper.id).performance.status, 'not-started');
  const time = '2026-09-02T02:30:00Z';
  saveDecision(paper, decision('buy', 10, time), time);
  trading.executePendingOrders(paper.id, { '600183': { rows: [{ time: '2026-09-02 10:31:00', price: 10, volume: 10000 }], meta: { previousClose: 9.8, stale: false } } }, { now: '2026-09-02T02:31:10Z' });
  const performance = trading.getMonitorState(paper.id).performance;
  assert.equal(performance.fillCount, 1);
  assert.equal(performance.commission, 5);
  assert.equal(performance.slippageCost, 1.8);
  assert.equal(performance.totalCosts, 6.8);
  assert.equal(performance.netPnl, -6.8);
  assert.equal(performance.grossPnl, 0);
  assert.match(performance.limitation, /前向模拟/);
});
