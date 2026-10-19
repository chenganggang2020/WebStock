'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deliver, localOrigin } = require('../scripts/deliver-research-to-running-app');

function fixture() {
  const calls = []; let applied = 0;
  const validated = { batchKey: 'identity', payloadHash: 'payload', wantsTonghuashun: true,
    normalized: { asOf: { marketDate: '2026-09-10' } } };
  const dependencies = {
    validateBatch: () => validated,
    plan: () => ({ targetName: '00_每日荐股_0910', picks: Array(20).fill({}) }),
    apply: () => { applied++; return { applied: true, backupDirectory: 'backup', cloudSync: 'pending' }; },
    request: async (origin, endpoint, body) => { calls.push({ origin, endpoint, body });
      return { success: true, data: { batchKey: 'identity', payloadHash: 'payload', replayed: true } }; }
  };
  return { calls, dependencies, applied: () => applied, options: { baseUrl: 'http://127.0.0.1:3000', input: {}, apply: true } };
}

test('preview checks the running app but neither imports nor changes local files', async () => {
  const f = fixture(); const result = await deliver({ ...f.options, apply: false }, f.dependencies);
  assert.equal(result.mode, 'preview'); assert.equal(f.applied(), 0);
  assert.deepEqual(f.calls.map(c => c.endpoint), ['/api/health']);
});
test('delivery writes through the app and reports cloud pending, even after local success', async () => {
  const f = fixture(); const result = await deliver(f.options, f.dependencies);
  assert.equal(result.webstockReplayed, true); assert.equal(f.applied(), 1);
  assert.equal(f.calls[2].body.status, 'pending'); assert.equal(f.calls[2].body.details.nativeSyncVerified, false);
  assert.equal(f.calls[2].body.details.localApplied, true);
});
test('offline app has no database fallback and cannot change THS files', async () => {
  const f = fixture(); f.dependencies.request = async () => { throw new Error('offline'); };
  await assert.rejects(deliver(f.options, f.dependencies), /offline/); assert.equal(f.applied(), 0);
});
test('wrong response identity blocks THS writes', async () => {
  const f = fixture(); f.dependencies.request = async () => ({ success: true, data: { batchKey: 'wrong' } });
  await assert.rejects(deliver(f.options, f.dependencies), /身份不匹配/); assert.equal(f.applied(), 0);
});
test('THS failure is recorded as failed rather than succeeded', async () => {
  const f = fixture(); f.dependencies.apply = () => { throw new Error('client running'); };
  await assert.rejects(deliver(f.options, f.dependencies), /client running/);
  assert.equal(f.calls[2].body.status, 'failed'); assert.equal(f.calls[2].body.details.localApplied, false);
});
test('remote URLs, credential URLs and non-root paths are refused', () => {
  for (const url of ['https://example.com', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost',
    'http://localhost/path', 'http://localhost/?token=x']) assert.throws(() => localOrigin(url));
  assert.equal(localOrigin('http://127.0.0.1:3128'), 'http://127.0.0.1:3128');
});
