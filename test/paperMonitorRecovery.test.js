const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-recovery-'));
process.env.WEBSTOCK_DB_PATH = path.join(root, 'test.db');
const db = require('../db');
const portfolios = require('../services/paperPortfolioService');
const trading = require('../services/paperTradingService');
const { createPaperMonitorScheduler, selectDueSlot } = require('../services/paperMonitorScheduler');
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('failed slot retries with backoff and persists success across scheduler restart', async () => {
  const paper = portfolios.ensureDefaultMonitorPortfolio({ now: '2026-09-07T01:00:00Z' });
  let time = '2026-09-07T02:30:00Z';
  let attempts = 0;
  const executionTimes = [];
  const options = { trading, ensurePortfolio: () => {}, now: () => new Date(time), monitor: {
    run: async () => { attempts++; if (attempts === 1) throw new Error('temporary quote failure'); time = '2026-09-07T02:31:30Z'; return { saved: { decision: { validationStatus: 'valid' } } }; },
    execute: async (_id, input) => { executionTimes.push(input.now); }
  } };
  await createPaperMonitorScheduler(options).tick();
  assert.equal(trading.getMonitorRun(paper.id, '2026-09-07@10:30').status, 'retrying');
  time = '2026-09-07T02:30:30Z'; await createPaperMonitorScheduler(options).tick();
  assert.equal(attempts, 1);
  time = '2026-09-07T02:31:00Z'; await createPaperMonitorScheduler(options).tick();
  assert.equal(attempts, 2);
  assert.equal(executionTimes.at(-1), '2026-09-07T02:31:30.000Z');
  assert.equal(trading.getMonitorRun(paper.id, '2026-09-07@10:30').status, 'succeeded');
  time = '2026-09-07T02:32:00Z'; await createPaperMonitorScheduler(options).tick();
  assert.equal(attempts, 2);
});

test('overdue slots are recorded as missed without asking the model retrospectively', async () => {
  const paper = portfolios.ensureDefaultMonitorPortfolio();
  let calls = 0;
  const scheduler = createPaperMonitorScheduler({ trading, ensurePortfolio: () => {}, now: () => new Date('2026-09-07T06:58:00Z'), monitor: {
    run: async () => { calls++; }, execute: async () => {}
  } });
  await scheduler.tick();
  assert.equal(calls, 0);
  assert.equal(trading.getMonitorRun(paper.id, '2026-09-07@14:50').status, 'missed');
});

test('automatic advice never runs on an exchange holiday', () => {
  const settings = { enabled: true, startMode: 'today', activatedAt: '2026-09-01T01:00:00Z', schedule: ['10:30'], lastRunSlot: '' };
  assert.equal(selectDueSlot(new Date('2026-10-01T02:30:00Z'), settings), '');
});
