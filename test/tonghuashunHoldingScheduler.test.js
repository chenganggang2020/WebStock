const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTonghuashunHoldingScheduler } = require('../services/tonghuashunHoldingScheduler');

test('Tonghuashun holding scheduler continuously checks holdings without overlapping ticks', async () => {
  let release;
  const blocker = new Promise(function(resolve) { release = resolve; });
  const calls = [];
  const scheduler = createTonghuashunHoldingScheduler({
    now: function() { return new Date('2026-09-02T02:30:00.000Z'); },
    holdings: {
      getMonitorHoldingContext: async function(options) {
        calls.push(options);
        await blocker;
        return { available: true, unchanged: false };
      }
    },
    windowCapture: {
      captureAndSync: async function() { return { available: false, error: 'window unavailable' }; }
    },
    log: function() {}
  });

  const first = scheduler.tick();
  const second = scheduler.tick();
  release();
  const results = await Promise.all([first, second]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fallbackToSnapshot, false);
  assert.equal(calls[0].now.toISOString(), '2026-09-02T02:30:00.000Z');
  assert.deepEqual(results[0], { available: true, unchanged: false });
  assert.deepEqual(results[1], { available: true, unchanged: false });
});

test('Tonghuashun holding scheduler prefers a validated live window capture', async () => {
  let fileChecks = 0;
  const scheduler = createTonghuashunHoldingScheduler({
    now: function() { return new Date('2026-09-03T02:30:00.000Z'); },
    windowCapture: {
      captureAndSync: async function() {
        return { available: true, method: 'windows-ocr', holdingCount: 9, unchanged: false };
      }
    },
    holdings: {
      getMonitorHoldingContext: async function() {
        fileChecks += 1;
        return { available: false };
      }
    },
    log: function() {}
  });

  const result = await scheduler.tick();

  assert.equal(result.method, 'windows-ocr');
  assert.equal(fileChecks, 0);
});

test('Tonghuashun holding scheduler records the latest window-capture result for status reporting', async () => {
  const recorded = [];
  const scheduler = createTonghuashunHoldingScheduler({
    now: function() { return new Date('2026-09-03T02:30:00.000Z'); },
    windowCapture: {
      captureAndSync: async function() {
        return { available: false, method: 'windows-ocr', error: '同花顺交易窗口未打开' };
      }
    },
    holdings: {
      recordWindowCaptureStatus: function(result, options) { recorded.push({ result, options }); },
      getMonitorHoldingContext: async function() { return { available: false, error: 'no export' }; }
    },
    log: function() {}
  });

  await scheduler.tick();

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].result.error, '同花顺交易窗口未打开');
  assert.equal(recorded[0].options.now.toISOString(), '2026-09-03T02:30:00.000Z');
});

test('desktop and standalone lifecycles start and stop the Tonghuashun holding scheduler', () => {
  const electronSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(electronSource, /createTonghuashunHoldingScheduler/);
  assert.match(electronSource, /tonghuashunHoldingScheduler\.start\(\)/);
  assert.match(electronSource, /tonghuashunHoldingScheduler\.stop\(\)/);
  assert.match(serverSource, /createTonghuashunHoldingScheduler/);
  assert.match(serverSource, /tonghuashunHoldingScheduler\.start\(\)/);
  assert.match(serverSource, /tonghuashunHoldingScheduler\.stop\(\)/);
});
