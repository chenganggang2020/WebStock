const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-paper-monitor-service-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const paperPortfolios = require('../services/paperPortfolioService');
const trading = require('../services/paperTradingService');
const { createPaperMonitorService } = require('../services/paperMonitorService');

test.after(function() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});

function createPaper() {
  const paper = paperPortfolios.createFromPacket({
    capital: 100000,
    packet: {
      schema: 'webstock.research.decision-packet.v1',
      generatedAt: '2026-09-02T02:25:00.000Z',
      candidates: [{ code: '600183', name: '生益科技', consensusScore: 90, signalCount: 2 }],
      evidence: []
    }
  });
  return paperPortfolios.updateStatus(paper.id, 'active');
}

function modelDecision(asOf) {
  return JSON.stringify({
    asOf,
    marketView: 'neutral',
    cashTargetPercent: 90,
    orders: [{
      code: '600183', action: 'buy', targetPositionPercent: 10, confidence: 70,
      reason: '量价改善', invalidation: '跌破支撑'
    }],
    portfolioRisk: ['公开行情延迟风险'],
    nextReviewAt: '2026-09-02T06:50:00.000Z'
  });
}

function service(options = {}) {
  return createPaperMonitorService({
    research: options.research || { listLatestArtifacts: () => ({}) },
    holdings: options.holdings || {
      getMonitorHoldingContext: function() {
        return {
          available: true,
          method: 'export-file',
          source: 'tonghuashun-export-file',
          observedAt: options.holdingObservedAt || '2026-09-02T02:29:00.000Z',
          snapshotDate: '2026-09-02',
          cashBalance: 20000,
          holdings: [{ code: '000977', name: '浪潮信息', quantity: 100, costValue: 8500 }]
        };
      }
    },
    quotes: {
      fetchSinaQuotes: async function(codes) {
        if (options.onQuotes) options.onQuotes();
        if (options.quoteError) throw new Error(options.quoteError);
        return {
          fetchedAt: '2026-09-02T02:30:00.000Z',
          source: 'sina-public-quote',
          quotes: Object.fromEntries(codes.map(function(code) {
            return [code, { code, name: code === '600183' ? '生益科技' : '浪潮信息', price: code === '600183' ? 10 : 85.6, tradeDate: '2026-09-02', tradeTime: options.quoteTime || '10:30:00' }];
          }))
        };
      }
    },
    marketOverview: { fetchIndexOverview: async function() { return options.marketOverview || { fetchedAt: '2026-09-02T02:30:00.000Z', indices: [] }; } },
    volumePace: { fetch: async function() { return options.volumePace || { fetchedAt: '2026-09-02T02:30:00.000Z', available: true, latest: { cumulativeYoY: -5 } }; } },
    ai: {
      getAIConfig: function() { return options.hasApiKey === false ? { model: 'gpt-5-mini', apiKey: '' } : { model: 'gpt-5-mini', apiKey: 'sk-test-valid-key-abcdefghijklmnopqrstuvwxyz' }; },
      getAIEnabled: function() { return options.aiEnabled !== false; },
      isValidApiKey: function(key) { return Boolean(key); },
      callAIModel: async function(_prompt, callOptions) {
        assert.equal(callOptions.responseFormat.type, 'json_schema');
        if (options.onModelResponse) options.onModelResponse();
        return modelDecision('2026-09-02T02:30:00.000Z');
      }
    },
    minute: {
      fetch: async function() {
        return {
          rows: [{ time: '2026-09-02 10:31:00', price: 10, volume: 12000 }],
          meta: { dataSource: 'tencent-1m', previousClose: 9.8, stale: false }
        };
      }
    },
    now: options.now || function() { return new Date('2026-09-02T02:30:00.000Z'); }
  });
}

test('paper monitor preparation syncs holdings and builds point-in-time prompt context', async () => {
  const paper = createPaper();
  const prepared = await service().prepare(paper.id);

  assert.equal(prepared.holdingContext.source, 'tonghuashun-export-file');
  assert.equal(prepared.allowedUniverse.some(item => item.code === '000977'), true);
  assert.equal(prepared.context.quotes['600183'].tradeTime, '10:30:00');
  assert.match(prepared.prompt, /同花顺真实持仓/);
  assert.equal(trading.getMonitorState(paper.id).settings.lastHoldingsSource, 'tonghuashun-export-file');
});

test('independent monitor does not read or expose real holdings and accepts its original handoff', async () => {
  const paper = createPaper();
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false });
  const subject = service({ holdings: { getMonitorHoldingContext() { throw new Error('must not read real holdings'); } }, hasApiKey: false });
  const prepared = await subject.run(paper.id);
  assert.equal(prepared.context.holdingsSyncRequired, false);
  assert.equal(prepared.context.tonghuashunRealHoldings.included, false);
  assert.deepEqual(prepared.context.tonghuashunRealHoldings.holdings, []);
  assert.deepEqual(prepared.allowedUniverse.map(item => item.code), ['600183']);
  const result = subject.submitManual(paper.id, { prepared, rawResponse: modelDecision(prepared.asOf) });
  assert.equal(result.decision.validationStatus, 'valid');
  assert.equal(result.orders[0].status, 'pending');
});

test('changing holding mode invalidates unused preparations even if switched back', async () => {
  const paper = createPaper();
  const subject = service();
  const prepared = await subject.prepare(paper.id);
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false });
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: true });
  assert.throws(() => subject.submitManual(paper.id, { prepared, rawResponse: modelDecision(prepared.asOf) }), /重新|校验|模式/);
  assert.equal(trading.listDecisions(paper.id).length, 0);
});

test('reference mode remains blocked without fresh Tonghuashun holdings', async () => {
  const paper = createPaper();
  const subject = service({ holdings: { getMonitorHoldingContext: () => ({ available: false, error: 'window closed' }) } });
  await assert.rejects(subject.prepare(paper.id), /同花顺持仓同步不可用/);
});

test('readiness distinguishes handoff configuration from automatic model readiness without creating decisions', async () => {
  const paper = createPaper();
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false, enabled: false });
  const subject = service({ hasApiKey: false, holdings: { getMonitorHoldingContext() { throw new Error('private holdings must not be read'); } } });
  const result = await subject.getReadiness(paper.id, { checkQuotes: true });
  const checks = Object.fromEntries(result.checks.map(item => [item.id, item]));
  assert.equal(checks.holdings.status, 'not-required');
  assert.equal(checks.market.status, 'ready');
  assert.equal(checks.model.status, 'handoff');
  assert.equal(checks.schedule.status, 'waiting');
  assert.equal(result.canPrepare, true);
  assert.equal(result.canRunDirect, false);
  assert.equal(result.automaticReady, false);
  assert.equal(trading.listDecisions(paper.id).length, 0);
  assert.equal(trading.listOrders(paper.id).length, 0);
  const db = require('../db');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM paper_monitor_preparations WHERE portfolio_id = ?').get(paper.id).n, 0);
  assert.doesNotMatch(JSON.stringify(result), /apiKey|sk-test/);
});

test('readiness keeps stale quotes, empty universe, reference holdings and off-session failures visible', async () => {
  const paper = createPaper();
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false });
  const stale = await service({ quoteTime: '10:00:00' }).getReadiness(paper.id, { checkQuotes: true });
  assert.equal(stale.checks.find(item => item.id === 'market').status, 'blocked');
  assert.equal(stale.canPrepare, false);
  const closed = await service({ now: () => new Date('2026-09-02T04:00:00Z') }).getReadiness(paper.id, { checkQuotes: true });
  assert.equal(closed.checks.find(item => item.id === 'session').status, 'waiting');
  assert.equal(closed.canPrepare, false);
  const empty = paperPortfolios.ensureDefaultMonitorPortfolio();
  trading.updateMonitorSettings(empty.id, { holdingsSyncRequired: false });
  const result = await service().getReadiness(empty.id, { checkQuotes: true });
  assert.equal(result.checks.find(item => item.id === 'universe').status, 'blocked');
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: true });
  const missing = await service({ holdings: { getMonitorHoldingContext: () => ({ available: false, error: '窗口未打开' }), getMonitorStatus: () => ({ available: false, error: '窗口未打开' }) } }).getReadiness(paper.id, { checkQuotes: true });
  assert.equal(missing.checks.find(item => item.id === 'holdings').status, 'blocked');
});

test('lightweight readiness never fetches quotes or claims verified market readiness', async () => {
  const paper = createPaper();
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false });
  const result = await service({ quoteError: 'no network in passive check' }).getReadiness(paper.id);
  assert.equal(result.checks.find(item => item.id === 'market').status, 'unchecked');
  assert.equal(result.canPrepare, false);
});

test('unused handoff survives reload but disappears after receipt, mode change or expiry', async () => {
  const paper = createPaper();
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false });
  let time = '2026-09-02T02:30:00Z';
  const subject = service({ now: () => new Date(time), hasApiKey: false });
  assert.equal(subject.getPendingHandoff(paper.id), null);
  const prepared = await subject.run(paper.id);
  assert.equal(subject.getPendingHandoff(paper.id).preparationId, prepared.preparationId);
  subject.submitManual(paper.id, { prepared, rawResponse: modelDecision(prepared.asOf) });
  assert.equal(subject.getPendingHandoff(paper.id), null);
  await subject.prepare(paper.id);
  time = '2026-09-02T02:36:00Z';
  assert.equal(subject.getPendingHandoff(paper.id), null);
});

test('invalid handoff is audited but can be corrected in the same slot without duplicate decisions', async () => {
  const paper = createPaper();
  const subject = service();
  const prepared = await subject.prepare(paper.id);
  const bad = subject.submitManual(paper.id, { prepared, rawResponse: '{bad JSON}' });
  assert.equal(bad.decision.validationStatus, 'invalid');
  assert.equal(subject.submitManual(paper.id, { prepared, rawResponse: '{bad JSON}' }).decision.id, bad.decision.id);
  const corrected = subject.submitManual(paper.id, { prepared, rawResponse: modelDecision(prepared.asOf) });
  assert.equal(corrected.decision.validationStatus, 'valid');
  assert.equal(corrected.orders.length, 1);
  assert.equal(trading.listDecisions(paper.id).length, 2);
  const another = await subject.prepare(paper.id);
  assert.equal(subject.submitManual(paper.id, { prepared: another, rawResponse: modelDecision(another.asOf) }).decision.id, corrected.decision.id);
});

test('a completed slot never reports a different or invalid new reply as accepted', async () => {
  const paper = createPaper();
  const subject = service();
  const first = await subject.prepare(paper.id);
  const accepted = subject.submitManual(paper.id, { prepared: first, rawResponse: modelDecision(first.asOf) });
  const next = await subject.prepare(paper.id);
  const bad = subject.submitManual(paper.id, { prepared: next, rawResponse: '{bad after valid slot}' });
  assert.equal(bad.decision.validationStatus, 'invalid');
  assert.equal(bad.decision.rawResponse, '{bad after valid slot}');
  const changedReply = JSON.parse(modelDecision(next.asOf));
  changedReply.orders[0].action = 'hold';
  const changed = subject.submitManual(paper.id, { prepared: next, rawResponse: JSON.stringify(changedReply) });
  assert.equal(changed.decision.validationStatus, 'invalid');
  assert.match(changed.decision.validationErrors.join(' '), /时段|已存在|未采用/);
  assert.equal(trading.listDecisions(paper.id).filter(item => item.validationStatus === 'valid').length, 1);
  assert.equal(trading.listOrders(paper.id)[0].decisionId, accepted.decision.id);
});

test('readiness discards a result when mode or market session changes during quote fetch', async () => {
  const paper = createPaper();
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false });
  const changed = await service({ onQuotes: () => trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: true }) }).getReadiness(paper.id, { checkQuotes: true });
  assert.equal(changed.canPrepare, false);
  assert.equal(changed.checks.find(item => item.id === 'market').status, 'blocked');
  trading.updateMonitorSettings(paper.id, { holdingsSyncRequired: false });
  let time = '2026-09-02T03:29:50Z';
  const ended = await service({ quoteTime: '11:29:00', now: () => new Date(time), onQuotes: () => { time = '2026-09-02T03:31:00Z'; } }).getReadiness(paper.id, { checkQuotes: true });
  assert.equal(ended.canPrepare, false);
  assert.equal(ended.checks.find(item => item.id === 'session').status, 'waiting');
});

test('archiving a paper account rejects new model receipt from its earlier preparation', async () => {
  const paper = createPaper();
  const subject = service();
  const prepared = await subject.prepare(paper.id);
  paperPortfolios.updateStatus(paper.id, 'archived');
  assert.throws(() => subject.submitManual(paper.id, { prepared, rawResponse: modelDecision(prepared.asOf) }), /观察中|归档|状态/);
  assert.equal(trading.listDecisions(paper.id).length, 0);
});

test('future index and native volume timestamps are excluded from model inputs', async () => {
  const prepared = await service({
    marketOverview: { fetchedAt: '2026-09-02T02:35:00Z', indices: [{ close: 4000 }] },
    volumePace: { fetchedAt: '2026-09-02T02:30:00Z', tradingDate: '2026-09-02', asOf: '10:35', latest: { cumulativeYoY: 999 } }
  }).prepare(createPaper().id);
  assert.equal(prepared.context.marketOverview.available, false);
  assert.equal(prepared.context.volumePace.available, false);
  assert.equal(prepared.context.volumePace.latest, undefined);
});

test('paper monitor direct run saves the structured model response and pending order', async () => {
  const paper = createPaper();
  const result = await service().run(paper.id, { scheduleSlot: '2026-09-02@10:30' });

  assert.equal(result.handoffMode, false);
  assert.equal(result.saved.decision.validationStatus, 'valid');
  assert.equal(result.saved.orders[0].status, 'pending');
  assert.equal(trading.getMonitorState(paper.id).settings.lastRunSlot, '2026-09-02@10:30');
});

test('paper monitor without an API key returns a manual handoff and does not create a decision', async () => {
  const paper = createPaper();
  const result = await service({ hasApiKey: false }).run(paper.id);

  assert.equal(result.handoffMode, true);
  assert.match(result.prompt, /返回一个 JSON 对象/);
  assert.equal(trading.listDecisions(paper.id).length, 0);
});

test('scheduled manual handoff records the slot once when AI is disabled', async () => {
  const paper = createPaper();
  const result = await service({ aiEnabled: false }).run(paper.id, {
    scheduleSlot: '2026-09-02@10:30'
  });

  assert.equal(result.handoffMode, true);
  assert.equal(trading.getMonitorState(paper.id).settings.lastRunSlot, '2026-09-02@10:30');
  assert.equal(trading.listDecisions(paper.id).length, 0);
});

test('paper monitor executes pending orders through the public minute service', async () => {
  const paper = createPaper();
  await service().run(paper.id);

  const result = await service().execute(paper.id, { now: '2026-09-02T02:31:10.000Z' });

  assert.equal(result.fills.length, 1);
  assert.equal(result.paper.positions[0].quantity, 900);
});

test('delayed model response cannot fill a minute before the answer existed', async () => {
  const paper = createPaper();
  let clock = '2026-09-02T02:30:00.000Z';
  const subject = service({ now: () => new Date(clock), onModelResponse: () => { clock = '2026-09-02T02:33:00.000Z'; } });
  const result = await subject.run(paper.id);
  assert.equal(result.saved.decision.marketAsOf, '2026-09-02T02:30:00.000Z');
  assert.equal(result.saved.decision.advisedAt, clock);
  assert.equal((await subject.execute(paper.id)).fills.length, 0);
});

test('manual handoff uses receipt time, is single-use, and rejects changed context or expiry', async () => {
  const paper = createPaper();
  let clock = '2026-09-02T02:30:00.000Z';
  const subject = service({ now: () => new Date(clock) });
  const prepared = await subject.prepare(paper.id);
  const tampered = JSON.parse(JSON.stringify(prepared));
  tampered.context.quotes['600183'].price = 1;
  assert.throws(() => subject.submitManual(paper.id, { prepared: tampered, rawResponse: modelDecision(prepared.asOf) }), /校验|修改/);
  clock = '2026-09-02T02:32:00.000Z';
  const result = subject.submitManual(paper.id, { prepared, rawResponse: modelDecision(prepared.asOf) });
  assert.equal(result.decision.advisedAt, clock);
  const replay = subject.submitManual(paper.id, { prepared, rawResponse: modelDecision(prepared.asOf) });
  assert.equal(replay.decision.id, result.decision.id);
  assert.equal(trading.listDecisions(paper.id).length, 1);
  const another = await subject.prepare(paper.id);
  clock = '2026-09-02T02:40:00.000Z';
  assert.throws(() => subject.submitManual(paper.id, { prepared: another, rawResponse: modelDecision(another.asOf) }), /过期/);
});

test('automatic execution marks existing positions without new orders or synthetic buys', async () => {
  const paper = createPaper();
  const subject = service();
  await subject.run(paper.id);
  await subject.execute(paper.id, { now: '2026-09-02T02:31:10.000Z' });
  const markSubject = createPaperMonitorService({
    now: () => new Date('2026-09-02T02:34:10.000Z'),
    minute: { fetch: async () => ({ rows: [{ time: '2026-09-02 10:34:00', price: 9.5, volume: 1000 }], meta: { stale: false, previousClose: 9.8, dataSource: 'test-minute' } }) }
  });
  const marked = await markSubject.execute(paper.id);
  assert.equal(marked.paper.positions[0].lastPrice, 9.5);
  assert.equal(marked.paper.latestSnapshot.marketTime, '10:34:00');
  assert.equal(marked.paper.snapshots.length, 2);
  assert.equal(trading.listFills(paper.id).length, 1);
  await markSubject.execute(paper.id);
  assert.equal(paperPortfolios.getPortfolio(paper.id).snapshots.length, 2, 'same quote must not create artificial observations');
  const empty = createPaper();
  await markSubject.execute(empty.id);
  assert.equal(paperPortfolios.getPortfolio(empty.id).positions.length, 0);
});

test('preparation rejects stale holdings and stale or future quotes', async () => {
  const paper = createPaper();
  await assert.rejects(service({ holdingObservedAt: '2026-09-02T01:00:00Z' }).prepare(paper.id), /过期/);
  await assert.rejects(service({ quoteTime: '10:00:00' }).prepare(paper.id), /行情.*过期|行情.*新鲜/);
  await assert.rejects(service({ quoteTime: '10:31:00' }).prepare(paper.id), /行情.*未来|行情.*新鲜/);
});

test('readiness rechecks reference holdings that expire while current quotes are loading', async () => {
  const paper = createPaper();
  let time = '2026-09-02T02:30:00.000Z';
  const subject = service({
    holdingObservedAt: '2026-09-02T02:25:01.000Z',
    now: () => new Date(time),
    onQuotes: () => { time = '2026-09-02T02:30:02.000Z'; }
  });

  const result = await subject.getReadiness(paper.id, { checkQuotes: true });

  assert.equal(result.checkedAt, time);
  assert.equal(result.checks.find(item => item.id === 'market').status, 'ready');
  assert.equal(result.checks.find(item => item.id === 'holdings').status, 'blocked');
  assert.equal(result.canPrepare, false);
  assert.equal(result.canRunDirect, false);
  assert.equal(result.automaticReady, false);
  assert.equal(trading.listDecisions(paper.id).length, 0);
});

test('prepare rejects reference holdings that expire during the two-second quote fetch', async () => {
  const paper = createPaper();
  let time = '2026-09-02T02:30:00.000Z';
  const subject = service({
    holdingObservedAt: '2026-09-02T02:25:01.000Z',
    now: () => new Date(time),
    onQuotes: () => { time = '2026-09-02T02:30:02.000Z'; }
  });

  await assert.rejects(subject.prepare(paper.id), /持仓.*过期|持仓.*5 分钟/);

  assert.equal(subject.getPendingHandoff(paper.id), null);
  const db = require('../db');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM paper_monitor_preparations WHERE portfolio_id = ?').get(paper.id).n, 0);
});

test('reference preparation expires no later than the remaining five-minute holding validity', async () => {
  const paper = createPaper();
  const observedAt = '2026-09-02T02:25:30.000Z';
  const prepared = await service({ holdingObservedAt: observedAt }).prepare(paper.id);
  const holdingExpiresAt = Date.parse(observedAt) + 5 * 60 * 1000;

  assert.ok(Date.parse(prepared.expiresAt) > Date.parse(prepared.asOf));
  assert.ok(Date.parse(prepared.expiresAt) <= holdingExpiresAt,
    'prepared expiry ' + prepared.expiresAt + ' must not exceed holding expiry ' + new Date(holdingExpiresAt).toISOString());
});

test('pending reference handoff cannot be restored after the holding validity expires', async () => {
  const paper = createPaper();
  let time = '2026-09-02T02:30:00.000Z';
  const subject = service({
    holdingObservedAt: '2026-09-02T02:25:30.000Z',
    hasApiKey: false,
    now: () => new Date(time)
  });
  const prepared = await subject.run(paper.id);
  assert.equal(subject.getPendingHandoff(paper.id).preparationId, prepared.preparationId);

  time = '2026-09-02T02:30:31.000Z';

  assert.equal(subject.getPendingHandoff(paper.id) === null, true,
    'restoring an unused handoff must respect the holding expiry, not only the preparation age');
  assert.equal(trading.listDecisions(paper.id).length, 0);
});

test('independent preparations for the same live slot produce only one decision', async () => {
  const paper = createPaper();
  const subject = service();
  const first = await subject.prepare(paper.id, { scheduleSlot: '2026-09-02@10:30' });
  const second = await subject.prepare(paper.id, { scheduleSlot: '2026-09-02@10:30' });
  const a = subject.submitManual(paper.id, { prepared: first, rawResponse: modelDecision(first.asOf) });
  const b = subject.submitManual(paper.id, { prepared: second, rawResponse: modelDecision(second.asOf) });
  assert.equal(a.decision.id, b.decision.id);
  assert.equal(trading.listDecisions(paper.id).length, 1);
});

test('model context includes saved research only when it already existed at preparation time', async () => {
  const paper = createPaper();
  const research = { listLatestArtifacts: () => ({
    industryChains: { marketDate: '2026-09-02', createdAt: '2026-09-01 13:00:00', source: { generatedAt: '2026-09-01T12:00:00Z' }, asOf: { observedAt: '2026-09-01T07:00:00Z' }, payload: { summary: 'known research' } },
    hotspots: { marketDate: '2026-09-02', createdAt: '2026-09-02 03:00:00', source: { generatedAt: '2026-09-02T03:00:00Z' }, asOf: { observedAt: '2026-09-02T03:00:00Z' }, payload: { summary: 'future research' } }
  }) };
  const prepared = await service({ research }).prepare(paper.id);
  assert.match(prepared.prompt, /known research/);
  assert.doesNotMatch(prepared.prompt, /future research/);
  assert.equal(prepared.context.researchEvidence.items.length, 1);
});
