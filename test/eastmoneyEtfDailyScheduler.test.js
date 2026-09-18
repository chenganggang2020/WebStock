const test = require('node:test');
const assert = require('node:assert/strict');
const { createEastmoneyEtfDailyScheduler } = require('../services/eastmoneyEtfDailyScheduler');
function fixture(options = {}) {
  let current = new Date('2026-09-10T00:50:00Z'), state = {}, calls = 0;
  const service = {
    getState: () => state, getLastAttempt: () => state.lastScheduledAttempt || '',
    saveLastAttempt: value => { state.lastScheduledAttempt = value; },
    refresh: async () => { calls++; return { status: 'pending-source', isCurrent: false }; },
    ...options
  };
  const make = () => createEastmoneyEtfDailyScheduler({ service, now: () => current, enabled: true });
  return { service, make, set: time => { current = new Date(time); }, calls: () => calls, state: () => state };
}
test('premarket attempts use bounded slots and restart does not repeat a slot', async () => {
  const f = fixture(), s = f.make();
  await s.tick(); await f.make().tick(); assert.equal(f.calls(), 1);
  f.set('2026-09-10T01:00:00Z'); await s.tick(); assert.equal(f.calls(), 2);
  f.set('2026-09-10T01:10:00Z'); await s.tick();
  f.set('2026-09-10T01:20:00Z'); await s.tick(); assert.equal(f.calls(), 4);
  f.set('2026-09-10T01:24:59Z'); await s.tick(); assert.equal(f.calls(), 4);
});
test('an old HTTP success does not mark the target day done', async () => {
  let calls = 0;
  const f = fixture({ refresh: async () => { calls++; return { status: 'no-change', isCurrent: false }; } }), s = f.make();
  await s.tick(); f.set('2026-09-10T01:00:00Z'); await s.tick();
  assert.equal(calls, 2); assert.equal(s.isDone(), false);
});
test('persisted success suppresses same-day refresh and resets on the next day', async () => {
  const f = fixture();
  f.service.refresh = async () => { f.state().lastSuccessTargetDate = '2026-09-10'; return { isCurrent: true }; };
  const s = f.make(); await s.tick();
  assert.equal(s.isDone(), true);
  f.set('2026-09-10T01:00:00Z'); assert.equal(await f.make().tick(), false);
  f.set('2026-09-11T00:50:00Z'); assert.equal(s.isDone(), false);
  assert.equal(await s.tick(), true);
});
test('late catchup is attempted only once across restarts even when it fails', async () => {
  let calls = 0;
  const f = fixture({ refresh: async () => { calls++; throw new Error('offline'); } });
  f.set('2026-09-10T04:00:00Z');
  await f.make().tick(); await f.make().tick(); assert.equal(calls, 1);
  assert.equal(f.state().lastScheduledAttempt, '2026-09-10@catchup');
});
test('a continuously running scheduler does not extend premarket retries after 09:25', async () => {
  const f = fixture(), s = f.make();
  f.set('2026-09-10T01:20:00Z'); await s.tick();
  f.set('2026-09-10T01:25:00Z'); await s.tick(); assert.equal(f.calls(), 1);
  f.set('2026-09-10T01:30:00Z'); await s.tick(); assert.equal(f.calls(), 1);
  await f.make().tick(); assert.equal(f.calls(), 2);
});
test('closed days, uncovered years, before 08:50 and disabled mode do not fetch', async () => {
  const f = fixture(), s = f.make();
  for (const time of ['2026-09-10T00:49:59Z','2026-09-12T01:00:00Z','2026-10-01T01:00:00Z','2027-01-04T01:00:00Z']) {
    f.set(time); await s.tick();
  }
  assert.equal(f.calls(), 0);
  f.set('2026-09-10T00:50:00Z');
  await createEastmoneyEtfDailyScheduler({ service: f.service, now: () => new Date('2026-09-10T00:50:00Z'), enabled: false }).tick();
  assert.equal(f.calls(), 0);
});
test('attempt persistence finishes before a request and concurrent ticks are single-flight', async () => {
  let release, fetched = 0;
  const f = fixture({
    saveLastAttempt: () => new Promise(resolve => { release = resolve; }),
    refresh: async () => { fetched++; return {}; }
  }), s = f.make();
  const first = s.tick(); const second = s.tick();
  assert.equal(fetched, 0); release(); await Promise.all([first, second]);
  assert.equal(fetched, 1);
});
test('start immediately checks due work and stop cancels the interval', async () => {
  const f = fixture(); let callback, clears = 0;
  const s = createEastmoneyEtfDailyScheduler({ service: f.service, now: () => new Date('2026-09-10T00:50:00Z'), enabled: true,
    setInterval: fn => { callback = fn; return 123; }, clearInterval: () => { clears++; } });
  assert.equal(s.start(), true); assert.equal(s.start(), false);
  await new Promise(r => setImmediate(r)); assert.equal(f.calls(), 1);
  s.stop(); callback(); await new Promise(r => setImmediate(r)); assert.equal(f.calls(), 1); assert.equal(clears, 1);
});
