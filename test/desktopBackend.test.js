const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const { createDesktopBackend, createRemoteSession } = require('../electron/desktopBackend');

test('blocked data worker does not block the desktop event loop and exits normally', async t => {
  const backend = createDesktopBackend({ script: path.join(__dirname, 'fixtures/backend-block.js') });
  t.after(() => backend.stop());
  await backend.start({ port: 0 });
  const blocking = once(backend.child, 'message').then(([message]) => assert.equal(message.type, 'blocking'));
  let completed = false;
  const work = backend.call('block', [], { timeoutMs: 5000 }).then(() => { completed = true; });
  await blocking;
  let pulses = 0;
  const timer = setInterval(() => pulses++, 20);
  await new Promise(resolve => setTimeout(resolve, 180));
  clearInterval(timer);
  assert.equal(completed, false, 'data worker should still be blocked');
  assert.ok(pulses >= 3, 'desktop must continue receiving events while data worker is blocked');
  await work;
  await backend.stop();
  assert.equal(backend.child.exitCode, 0);
});

test('archive batches await persistence and propagate save failure across IPC', async t => {
  const order = [];
  const backend = createDesktopBackend({ script: path.join(__dirname, 'fixtures/backend-block.js'),
    getSessionManager: () => ({ async captureProfileArchive(url, options) {
      assert.equal(url, 'https://www.douyin.com/user/test');
      order.push('capture');
      await options.onBatch({ items: [1] });
      order.push('saved');
      return { items: [1], loggedIn: true };
    } }) });
  t.after(() => backend.stop());
  await backend.start({ port: 0 });
  assert.deepEqual(await backend.call('archive'), { items: [1], loggedIn: true });
  assert.deepEqual(order, ['capture', 'saved']);
  await assert.rejects(backend.call('archiveFailure'), /save failed/);
});

test('remote capture releases batch callback even when capture fails', async () => {
  let callbackId;
  const remote = createRemoteSession(async (method, args) => {
    callbackId = args[2];
    throw new Error('capture failed');
  });
  await assert.rejects(remote.sessionManager.captureProfileArchive('url', { onBatch() {} }), /capture failed/);
  await assert.rejects(remote.onBatch(callbackId, {}), /expired/);
});

test('real backend uses an isolated database, preserves API and disables business jobs in smoke mode', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-backend-test-'));
  const dbPath = path.join(directory, 'webstock.db');
  let output = '';
  const backend = createDesktopBackend({ env: {
    WEBSTOCK_DB_PATH: dbPath, WEBSTOCK_BUILD_SMOKE_TEST: '1', WEBSTOCK_SKIP_FUND_REFRESH: '1',
    WEBSTOCK_QUANT_WORKSPACE: path.join(directory, 'quant')
  }, onLog: text => { output += text; } });
  t.after(async () => {
    await backend.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let result;
  try { result = await backend.start({ port: 0, userDataDir: directory, dbPath, nativeCapture: false }); }
  catch (error) { throw new Error(error.message + '\n' + output); }
  assert.ok(result.pid && result.pid !== process.pid);
  const response = await fetch(result.url + 'api/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.database, 'ok');
  const sampling = await (await fetch(result.url + 'api/market/local-sampling-status')).json();
  assert.equal(sampling.data.running, false);
  assert.equal((await fetch(result.url)).status, 200);
  assert.equal((await backend.call('lanStatus')).enabled, false);
  const token = 'a'.repeat(64);
  await backend.call('setPairingToken', [token]);
  const unpaired = await fetch(result.url + 'api/health', { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(unpaired.status, 401);
  const paired = await fetch(result.url + 'api/health', { headers: {
    'X-Forwarded-Proto': 'https', Cookie: 'webstock_lan_token=' + token
  } });
  assert.equal(paired.status, 200);
  await assert.rejects(backend.call('syncAll'), /not started/);
  await backend.stop();
  await assert.rejects(fetch(result.url + 'api/health'));
  assert.ok(fs.existsSync(dbPath));
});

test('Electron window entry point must not load synchronous business services', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\.\/(?:server|db|routes\/market|services\/(?:expertChannelService|douyinSourceService|quantService|mobilePushService))['"]\)/);
});

test('normal shutdown drains an existing child job and can retry after a stop failure', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-backend-drain-'));
  const backend = createDesktopBackend({ script: path.join(__dirname, 'fixtures/backend-drain.js') });
  t.after(async () => { await backend.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await backend.start({ port: 0, userDataDir: directory, nativeCapture: false, failFirstStop: true });
  await backend.call('syncAll');
  await assert.rejects(backend.stop(), /stop failed once/);
  await assert.rejects(backend.call('syncAll'), /stopping/);
  await backend.stop();
  assert.equal(fs.readFileSync(path.join(directory, 'drained.txt'), 'utf8'), 'completed');
  assert.equal(backend.child.exitCode, 0);
});

test('occupied backend port rejects startup and still permits normal cleanup', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-backend-start-fail-'));
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const backend = createDesktopBackend({ env: {
    WEBSTOCK_DB_PATH: path.join(directory, 'test.db'), WEBSTOCK_BUILD_SMOKE_TEST: '1', WEBSTOCK_SKIP_FUND_REFRESH: '1',
    WEBSTOCK_QUANT_WORKSPACE: path.join(directory, 'quant')
  } });
  t.after(async () => {
    await backend.stop();
    await new Promise(resolve => listener.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await assert.rejects(backend.start({ port: listener.address().port, userDataDir: directory, nativeCapture: false }), /EADDRINUSE/);
  await backend.stop();
  assert.equal(backend.child.exitCode, 0);
});
