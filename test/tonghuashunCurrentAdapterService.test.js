const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  applyCurrentDelivery,
  buildDailyCsv,
  loadConfig,
  planCurrentDelivery
} = require('../services/tonghuashunCurrentAdapterService');

function validatedFixture(count, codes) {
  const picks = Array.from({ length: count }, function(_, index) {
    return {
      rank: index + 1,
      priority: index < 5 ? '重点' : '观察',
      code: codes ? codes[index] : (index < 9 ? '00000' : '0000') + (index + 1),
      name: '候选' + (index + 1),
      thesis: '研究理由' + (index + 1),
      risks: ['风险' + (index + 1)],
      evidenceRefs: ['https://example.com/' + (index + 1)],
      includeInTonghuashun: true
    };
  });
  return {
    normalized: {
      source: { system: 'chatgpt-automation', taskId: 'daily', model: 'pro' },
      asOf: { marketDate: '2026-08-31', observedAt: '2026-08-31T15:00:00+08:00' },
      artifacts: [{ payload: { picks } }]
    }
  };
}

test('current Tonghuashun adapter builds the v4 daily CSV with rank and priority intact', () => {
  const csv = buildDailyCsv(validatedFixture(10));
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines.length, 11);
  assert.match(lines[0], /^"priority","code","name","role"/);
  assert.match(lines[1], /^"1","000001","候选1","重点"/);
  assert.match(lines[10], /^"10","000010","候选10","观察"/);
  assert.match(lines[1], /"2026-08-31","2026-08-31"/);
});

test('current Tonghuashun adapter rejects a delivery outside the verified 10-20 item contract', () => {
  assert.throws(function() { buildDailyCsv(validatedFixture(9)); }, /10–20/);
});

test('current Tonghuashun preview resolves the configured SelfStockInfo custom-block package without writing', function(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-current-'));
  t.after(function() { fs.rmSync(root, { recursive: true, force: true }); });
  const packageDir = path.join(root, 'package');
  const userDir = path.join(root, 'user');
  const backupRoot = path.join(root, 'backups');
  const originalBackupDir = path.join(root, 'baseline');
  fs.mkdirSync(packageDir);
  fs.mkdirSync(userDir);
  fs.mkdirSync(backupRoot);
  fs.mkdirSync(originalBackupDir);
  fs.writeFileSync(path.join(packageDir, 'run_daily_import.ps1'), '# fixture', 'utf8');
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    launcherPath: path.join(root, 'hexinlauncher.exe'), userDir, backupRoot, originalBackupDir, packageDir
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'hexinlauncher.exe'), '', 'utf8');

  const config = loadConfig(configPath);
  const plan = planCurrentDelivery(validatedFixture(10), configPath);
  assert.equal(config.userDir, userDir);
  assert.equal(plan.groupName, '00_每日荐股_0831');
  assert.equal(plan.candidateCount, 10);
  assert.equal(fs.existsSync(path.join(packageDir, 'daily_recommendations.csv')), false);
});

test('current Tonghuashun adapter performs no write or sync when the daily group already matches', function(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-no-change-'));
  t.after(function() { fs.rmSync(root, { recursive: true, force: true }); });
  const packageDir = path.join(root, 'package');
  const userDir = path.join(root, 'user');
  const customDir = path.join(userDir, 'custom_block');
  const backupRoot = path.join(root, 'backups');
  const originalBackupDir = path.join(root, 'baseline');
  [packageDir, userDir, customDir, backupRoot, originalBackupDir].forEach(function(dir) {
    fs.mkdirSync(dir, { recursive: true });
  });
  const runScript = path.join(packageDir, 'run_daily_import.ps1');
  fs.writeFileSync(runScript, "throw 'the importer must not run'", 'utf8');
  const launcherPath = path.join(root, 'hexinlauncher.exe');
  fs.writeFileSync(launcherPath, '', 'utf8');
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    launcherPath, userDir, backupRoot, originalBackupDir, packageDir
  }), 'utf8');
  const codes = ['000001', '000002', '000004', '000006', '000007', '000008', '000009', '000010', '000011', '000012'];
  fs.writeFileSync(path.join(userDir, 'stockblock.ini'), '[BLOCK_NAME_MAP_TABLE]\r\n151=00_每日荐股_0831\r\n', 'utf8');
  fs.writeFileSync(path.join(customDir, '0'), JSON.stringify({ sortstr: '151' }), 'utf8');
  fs.writeFileSync(path.join(customDir, '337'), JSON.stringify({
    context: codes.join('|') + ',' + codes.map(function() { return '0'; }).join('|')
  }), 'utf8');

  const validated = validatedFixture(codes.length, codes);
  const plan = planCurrentDelivery(validated, configPath);
  assert.equal(plan.noChange, true);
  assert.deepEqual(plan.addedCodes, []);
  assert.deepEqual(plan.removedCodes, []);

  const delivery = applyCurrentDelivery(validated, configPath);
  assert.equal(delivery.applied, false);
  assert.equal(delivery.noChange, true);
  assert.equal(fs.existsSync(path.join(packageDir, 'daily_recommendations.csv')), false);
});
