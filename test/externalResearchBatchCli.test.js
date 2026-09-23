const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('unified CLI writes one idempotent WebStock run and the same filtered batch to Tonghuashun', function(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-batch-cli-'));
  t.after(function() { fs.rmSync(directory, { recursive: true, force: true }); });
  const dbPath = path.join(directory, 'webstock.db');
  const xmlPath = path.join(directory, 'blockstockV3.xml');
  const inputPath = path.join(directory, 'batch.json');
  fs.writeFileSync(xmlPath, '<?xml version="1.0" encoding="utf-8"?>\n<hevo>\n</hevo>\n', 'utf8');
  fs.writeFileSync(inputPath, JSON.stringify({
    schema: 'webstock.external-research-batch/v1',
    source: { system: 'chatgpt-automation', taskId: 'daily', runId: '2026-08-31', generatedAt: '2026-08-31T20:45:00+08:00', model: 'pro' },
    revision: 1,
    asOf: { marketDate: '2026-08-31', observedAt: '2026-08-31T15:00:00+08:00', timezone: 'Asia/Shanghai' },
    automaticTrading: false,
    artifacts: [{ artifactId: 'daily-picks', kind: 'research-picks', schema: 'webstock.research-picks/v1', payload: {
      analysis: 'test',
      picks: [
        { code: '000001', name: '平安银行', thesis: '观察', risks: ['风险'], evidenceRefs: ['https://example.com/a'], includeInTonghuashun: true },
        { code: '600519', name: '贵州茅台', thesis: '观察', risks: ['风险'], evidenceRefs: ['https://example.com/b'], includeInTonghuashun: false }
      ]
    } }],
    deliveries: [{ target: 'webstock-research', required: true }, { target: 'tonghuashun-watchlist', required: false }]
  }), 'utf8');

  const args = [path.join(__dirname, '../scripts/import-external-research-batch.js'), '--input', inputPath, '--xml', xmlPath, '--apply'];
  const env = Object.assign({}, process.env, { WEBSTOCK_DB_PATH: dbPath });
  childProcess.execFileSync(process.execPath, args, { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  childProcess.execFileSync(process.execPath, args, { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });

  const xml = fs.readFileSync(xmlPath, 'utf8');
  assert.match(xml, /00_每日荐股_0831/);
  assert.match(xml, /code="000001"/);
  assert.doesNotMatch(xml, /code="600519"/);
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM external_research_batches').get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ai_research_runs WHERE json_extract(request_json, '$.source') = 'external-chatgpt-batch'").get().count, 1);
  assert.equal(db.prepare('SELECT status FROM external_research_batches').get().status, 'completed');
  db.close();
});

test('unified CLI respects a WebStock-only delivery without requiring or changing Tonghuashun', function(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-batch-cli-web-only-'));
  t.after(function() { fs.rmSync(directory, { recursive: true, force: true }); });
  const dbPath = path.join(directory, 'webstock.db');
  const inputPath = path.join(directory, 'batch.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    schema: 'webstock.external-research-batch/v1',
    source: { system: 'chatgpt-automation', taskId: 'daily', runId: 'web-only', generatedAt: '2026-08-31T20:45:00+08:00', model: 'pro' },
    revision: 1,
    asOf: { marketDate: '2026-08-31', observedAt: '2026-08-31T15:00:00+08:00', timezone: 'Asia/Shanghai' },
    automaticTrading: false,
    artifacts: [{ artifactId: 'daily-picks', kind: 'research-picks', schema: 'webstock.research-picks/v1', payload: {
      analysis: 'test', picks: [{ code: '000001', name: '平安银行', thesis: '观察', risks: ['风险'], evidenceRefs: ['https://example.com/a'] }]
    } }],
    deliveries: [{ target: 'webstock-research', required: true }]
  }), 'utf8');

  const args = [path.join(__dirname, '../scripts/import-external-research-batch.js'), '--input', inputPath, '--apply'];
  const env = Object.assign({}, process.env, { WEBSTOCK_DB_PATH: dbPath });
  const output = JSON.parse(childProcess.execFileSync(process.execPath, args, { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' }));

  assert.equal(output.wrote, false);
  assert.equal(output.tonghuashunCandidateCount, 0);
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT status, tonghuashun_status FROM external_research_batches').get();
  assert.deepEqual(row, { status: 'completed', tonghuashun_status: 'not-requested' });
  db.close();
});

test('current-format CLI records no-change without rewriting or starting native sync', function(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-batch-cli-current-'));
  t.after(function() { fs.rmSync(directory, { recursive: true, force: true }); });
  const dbPath = path.join(directory, 'webstock.db');
  const inputPath = path.join(directory, 'batch.json');
  const configPath = path.join(directory, 'config.json');
  const packageDir = path.join(directory, 'package');
  const userDir = path.join(directory, 'user');
  const customDir = path.join(userDir, 'custom_block');
  const backupRoot = path.join(directory, 'backups');
  const originalBackupDir = path.join(directory, 'baseline');
  [packageDir, customDir, backupRoot, originalBackupDir].forEach(function(dir) {
    fs.mkdirSync(dir, { recursive: true });
  });
  const launcherPath = path.join(directory, 'hexinlauncher.exe');
  fs.writeFileSync(launcherPath, '', 'utf8');
  fs.writeFileSync(path.join(packageDir, 'run_daily_import.ps1'), "throw 'native sync must not start'", 'utf8');
  fs.writeFileSync(configPath, JSON.stringify({ launcherPath, userDir, backupRoot, originalBackupDir, packageDir }), 'utf8');
  const codes = ['000001', '000002', '000004', '000006', '000007', '000008', '000009', '000010', '000011', '000012'];
  fs.writeFileSync(path.join(userDir, 'stockblock.ini'), '[BLOCK_NAME_MAP_TABLE]\r\n151=00_每日荐股_0831\r\n', 'utf8');
  fs.writeFileSync(path.join(customDir, '0'), JSON.stringify({ sortstr: '151' }), 'utf8');
  fs.writeFileSync(path.join(customDir, '337'), JSON.stringify({
    context: codes.join('|') + ',' + codes.map(function() { return '0'; }).join('|')
  }), 'utf8');
  fs.writeFileSync(inputPath, JSON.stringify({
    schema: 'webstock.external-research-batch/v1',
    source: { system: 'chatgpt-automation', taskId: 'daily', runId: 'current-no-change', generatedAt: '2026-08-31T20:45:00+08:00', model: 'pro' },
    revision: 1,
    asOf: { marketDate: '2026-08-31', observedAt: '2026-08-31T15:00:00+08:00', timezone: 'Asia/Shanghai' },
    automaticTrading: false,
    artifacts: [{ artifactId: 'daily-picks', kind: 'research-picks', schema: 'webstock.research-picks/v1', payload: {
      analysis: 'test',
      picks: codes.map(function(code, index) {
        return {
          rank: index + 1,
          priority: index < 5 ? '重点' : '观察',
          code,
          name: '候选' + (index + 1),
          thesis: '研究理由',
          risks: ['风险'],
          evidenceRefs: ['https://example.com/' + code],
          includeInTonghuashun: true
        };
      })
    } }],
    deliveries: [{ target: 'webstock-research', required: true }, { target: 'tonghuashun-watchlist', required: true }]
  }), 'utf8');

  const args = [path.join(__dirname, '../scripts/import-external-research-batch.js'), '--input', inputPath, '--ths-config', configPath, '--apply'];
  const env = Object.assign({}, process.env, { WEBSTOCK_DB_PATH: dbPath });
  const output = JSON.parse(childProcess.execFileSync(process.execPath, args, { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' }));

  assert.equal(output.wrote, false);
  assert.equal(output.tonghuashunNoChange, true);
  assert.equal(output.delivery.noChange, true);
  assert.equal(fs.existsSync(path.join(packageDir, 'daily_recommendations.csv')), false);
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT status, tonghuashun_status FROM external_research_batches').get();
  assert.deepEqual(row, { status: 'completed', tonghuashun_status: 'no-change' });
  db.close();
});
