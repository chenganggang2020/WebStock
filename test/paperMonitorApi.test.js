const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-paper-monitor-api-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';

const paperPortfolios = require('../services/paperPortfolioService');
const monitor = require('../services/paperMonitorService');
const app = require('../server');

function requestJson(server, pathName, method, body) {
  const address = server.address();
  return new Promise(function(resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1', port: address.port, path: pathName, method: method || 'GET',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' }
    }, function(res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() { resolve({ status: res.statusCode, json: JSON.parse(raw) }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function createPaper() {
  return paperPortfolios.createFromPacket({
    capital: 100000,
    packet: {
      schema: 'webstock.research.decision-packet.v1', generatedAt: '2026-09-02T02:25:00.000Z',
      candidates: [{ code: '600183', name: '生益科技', consensusScore: 90, signalCount: 2 }], evidence: []
    }
  });
}

test('paper monitor API exposes state, settings, preparation, run, manual submission and execution', async function(t) {
  const originals = {
    prepare: monitor.prepare,
    run: monitor.run,
    submitManual: monitor.submitManual,
    execute: monitor.execute
  };
  monitor.prepare = async function() { return { prompt: 'copy me', promptHash: 'abc', allowedUniverse: [] }; };
  monitor.run = async function() { return { handoffMode: true, prompt: 'copy me' }; };
  monitor.submitManual = function(_id, body) { return { accepted: body.rawResponse === '{"ok":true}' }; };
  monitor.execute = async function() { return { fills: [], orders: [] }; };
  const server = app.listen(0);
  t.after(function() {
    server.close();
    Object.assign(monitor, originals);
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
    }
  });

  const bootstrap = await requestJson(server, '/api/paper-portfolios/default-monitor', 'POST', {
    capital: 100000,
    startMode: 'today'
  });
  const bootstrapAgain = await requestJson(server, '/api/paper-portfolios/default-monitor', 'POST', {
    capital: 100000,
    startMode: 'today'
  });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.json.data.id, bootstrapAgain.json.data.id);
  assert.equal(bootstrap.json.data.latestSnapshot.cashValue, 100000);

  const paper = createPaper();

  const state = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor');
  assert.equal(state.status, 200);
  assert.equal(state.json.data.settings.enabled, true);
  assert.deepEqual(state.json.data.settings.schedule, ['09:35', '10:30', '14:50']);
  assert.ok(Array.isArray(state.json.data.readiness.checks));

  const settings = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/settings', 'PUT', {
    enabled: false,
    startMode: 'next-trading-day',
    schedule: ['09:35', '14:50']
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.json.data.enabled, false);
  assert.equal(settings.json.data.startMode, 'next-trading-day');
  const mode = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/settings', 'PUT', { holdingsSyncRequired: false });
  assert.equal(mode.json.data.holdingsSyncRequired, false);
  assert.equal((await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/settings', 'PUT', { holdingsSyncRequired: 'false' })).status, 400);
  const check = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/check', 'POST', {});
  assert.equal(check.status, 200);
  assert.equal(check.json.data.checks.find(item => item.id === 'holdings').status, 'not-required');
  paperPortfolios.updateStatus(paper.id, 'active');
  const candidates = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/candidates', 'POST', { codes: ['000977'] });
  assert.equal(candidates.status, 200);
  assert.equal(candidates.json.data.addedCount, 1);

  const prepared = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/prepare', 'POST', {});
  assert.equal(prepared.status, 200);
  assert.equal(prepared.json.data.prompt, 'copy me');

  const run = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/run', 'POST', {});
  assert.equal(run.status, 200);
  assert.equal(run.json.data.handoffMode, true);

  const manual = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/manual', 'POST', { rawResponse: '{"ok":true}' });
  assert.equal(manual.status, 200);
  assert.equal(manual.json.data.accepted, true);

  const execution = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/execute', 'POST', {});
  assert.equal(execution.status, 200);
  assert.deepEqual(execution.json.data.fills, []);
});

test('paper monitor API reports Tonghuashun freshness failures as a conflict', async function(t) {
  const paper = createPaper();
  const original = monitor.prepare;
  monitor.prepare = async function() { throw new Error('同花顺持仓同步不可用：没有导出文件'); };
  const server = app.listen(0);
  t.after(function() {
    server.close();
    monitor.prepare = original;
  });

  const result = await requestJson(server, '/api/paper-portfolios/' + paper.id + '/monitor/prepare', 'POST', {});

  assert.equal(result.status, 409);
  assert.match(result.json.error, /同花顺持仓/);
});

test('public monitor routes never accept client overrides of the execution clock', async function(t) {
  const originals = { prepare: monitor.prepare, run: monitor.run, execute: monitor.execute };
  const seen = [];
  for (const method of Object.keys(originals)) monitor[method] = async function(_id, body) { seen.push(body); return {}; };
  const server = app.listen(0);
  t.after(() => { server.close(); Object.assign(monitor, originals); });
  for (const method of Object.keys(originals)) {
    assert.equal((await requestJson(server, '/api/paper-portfolios/1/monitor/' + method, 'POST', { now: '2026-09-07T02:00:00Z', scheduleSlot: 'forged' })).status, 200);
  }
  for (const body of seen) { assert.equal(body.now, undefined); assert.equal(body.scheduleSlot, undefined); }
});
