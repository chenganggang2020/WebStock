const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  shanghaiClock,
  selectDueSlot,
  createPaperMonitorScheduler
} = require('../services/paperMonitorScheduler');

test('paper monitor scheduler only selects a slot inside its five-minute live window', () => {
  const settings = {
    enabled: true,
    startMode: 'today',
    activatedAt: '2026-09-02T01:00:00.000Z',
    schedule: ['09:35', '10:30', '14:50'],
    lastRunSlot: ''
  };

  assert.equal(selectDueSlot(new Date('2026-09-02T02:33:00.000Z'), settings), '2026-09-02@10:30');
  assert.equal(selectDueSlot(new Date('2026-09-02T02:36:00.000Z'), settings), '');
  assert.equal(selectDueSlot(new Date('2026-09-05T02:30:00.000Z'), settings), '');
});

test('paper monitor next-trading-day mode never runs on the activation date', () => {
  const settings = {
    enabled: true,
    startMode: 'next-trading-day',
    activatedAt: '2026-09-02T01:00:00.000Z',
    schedule: ['10:30'],
    lastRunSlot: ''
  };

  assert.equal(selectDueSlot(new Date('2026-09-02T02:31:00.000Z'), settings), '');
  assert.equal(selectDueSlot(new Date('2026-09-03T02:31:00.000Z'), settings), '2026-09-03@10:30');
  assert.deepEqual(shanghaiClock(new Date('2026-09-03T02:31:00.000Z')), {
    date: '2026-09-03', time: '10:31', weekday: 'Thu', minuteOfDay: 631
  });
});

test('paper monitor scheduler runs due advice and polls pending executions without overlap', async () => {
  const calls = [];
  const scheduler = createPaperMonitorScheduler({
    now: function() { return new Date('2026-09-02T02:31:00.000Z'); },
    ensurePortfolio: function() {},
    trading: {
      listEnabledMonitorSettings: function() {
        return [{
          portfolioId: 7,
          enabled: true,
          startMode: 'today',
          activatedAt: '2026-09-02T01:00:00.000Z',
          schedule: ['10:30'],
          lastRunSlot: ''
        }];
      }
    },
    monitor: {
      run: async function(id, input) { calls.push(['run', id, input.scheduleSlot]); },
      execute: async function(id) { calls.push(['execute', id]); }
    },
    log: function() {}
  });

  const first = scheduler.tick();
  const second = scheduler.tick();
  await Promise.all([first, second]);

  assert.deepEqual(calls, [
    ['run', 7, '2026-09-02@10:30'],
    ['execute', 7]
  ]);
});

test('paper monitor scheduler bootstraps a default account before reading enabled schedules', async () => {
  const calls = [];
  const scheduler = createPaperMonitorScheduler({
    now: function() { return new Date('2026-09-02T02:31:00.000Z'); },
    ensurePortfolio: function(input) {
      calls.push(['ensure', input.now.toISOString()]);
    },
    trading: {
      listEnabledMonitorSettings: function() {
        calls.push(['list']);
        return [];
      }
    },
    monitor: { run: async function() {}, execute: async function() {} },
    log: function() {}
  });

  await scheduler.tick();

  assert.deepEqual(calls, [
    ['ensure', '2026-09-02T02:31:00.000Z'],
    ['list']
  ]);
});

test('desktop lifecycle starts and stops the paper monitor scheduler', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

  assert.match(source, /createPaperMonitorScheduler/);
  assert.match(source, /paperMonitorScheduler\.start\(\)/);
  assert.match(source, /paperMonitorScheduler\.stop\(\)/);
});
