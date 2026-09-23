'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { applyCurrentDelivery } = require('../services/tonghuashunCurrentAdapterService');
const { buildPlan } = require('../services/tonghuashunSafeFileDeliveryService');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-safe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDir = path.join(root, 'user'); const customDir = path.join(userDir, 'custom_block');
  fs.mkdirSync(customDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'backup'), { recursive: true });
  const codes = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(6, '0'));
  const names = new Map(codes.map(code => [code, '股票' + Number(code)]));
  const market = code => code.startsWith('6') ? '17' : '33';
  const context = (values, markets) => values.join('|') + '|,' + markets.join('|') + '|';
  const iniContext = (values, markets) => values.map((code, index) => markets[index] + ':' + code).join(',') + ',,';
  const old = context(codes, codes.map(market));
  const ini = '[BLOCK_NAME_MAP_TABLE]\r\n14A=我的其他组\r\n151=00_每日荐股_0907\r\n152=00_每日荐股_0908\r\n153=00_每日荐股_0909\r\n[BLOCK_STOCK_CONTEXT]\r\n14A=33:999999,,\r\n151=' + iniContext(codes, codes.map(market)) + '\r\n152=' + iniContext(codes, codes.map(market)) + '\r\n153=' + iniContext(codes, codes.map(market)) + '\r\n[OTHER]\r\nkeep=this-entry\r\n';
  fs.writeFileSync(path.join(userDir, 'stockblock.ini'), Buffer.from(ini, 'utf8'));
  fs.writeFileSync(path.join(userDir, 'SelfStockInfo.json'), '{"keep":true}\n');
  fs.writeFileSync(path.join(customDir, '0'), JSON.stringify({ sortstr: '14A,151,152,153' }, null, 2));
  ['14A', '151', '152', '153'].forEach(id => fs.writeFileSync(path.join(customDir, String(parseInt(id, 16))), JSON.stringify({ ln: Buffer.from('group-' + id).toString('base64'), context: old, other: id }, null, 2)));
  const picks = codes.map((code, index) => ({ code, name: names.get(code), includeInTonghuashun: true, rank: index + 1 }));
  return {
    root, userDir, customDir, names, codes, market,
    config: { userDir, backupRoot: path.join(root, 'backup') },
    validated: { normalized: { asOf: { marketDate: '2026-09-10' }, artifacts: [{ payload: { picks } }] } },
    options: { mode: 'safe-file', processNames: [], securityResolver: code => ({ name: names.get(code), market: market(code) }) }
  };
}

test('safe file delivery updates only the latest three daily groups and preserves protected data', t => {
  const f = fixture(t); const selfStockBefore = fs.readFileSync(path.join(f.userDir, 'SelfStockInfo.json'));
  const otherBefore = fs.readFileSync(path.join(f.customDir, '330')); const priorOld = fs.readFileSync(path.join(f.customDir, '338'));
  const result = applyCurrentDelivery(f.validated, f.config, f.options);
  assert.equal(result.applied, true); assert.equal(result.cloudSync, 'pending'); assert.equal(result.cloudVerified, false);
  const ini = fs.readFileSync(path.join(f.userDir, 'stockblock.ini'), 'utf8');
  assert.match(ini, /151=00_每日荐股_0910/); assert.doesNotMatch(ini, /151=00_每日荐股_0907/); assert.match(ini, /14A=我的其他组/); assert.match(ini, /keep=this-entry/);
  assert.deepEqual(fs.readFileSync(path.join(f.userDir, 'SelfStockInfo.json')), selfStockBefore);
  assert.deepEqual(fs.readFileSync(path.join(f.customDir, '330')), otherBefore); assert.deepEqual(fs.readFileSync(path.join(f.customDir, '338')), priorOld);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.customDir, '337'), 'utf8')).context, f.codes.join('|') + '|,' + f.codes.map(f.market).join('|') + '|');
  const before = new Map([path.join(f.userDir, 'stockblock.ini'), path.join(f.customDir, '0'), path.join(f.customDir, '337')].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  const repeat = applyCurrentDelivery(f.validated, f.config, f.options); assert.equal(repeat.noChange, true); assert.equal(repeat.applied, false);
  for (const [file, hash] of before) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hash);
});

test('safe file delivery rolls back all files after a staged write failure', t => {
  const f = fixture(t); const files = [path.join(f.userDir, 'stockblock.ini'), path.join(f.customDir, '0'), path.join(f.customDir, '337')];
  const before = files.map(file => fs.readFileSync(file)); let writes = 0;
  assert.throws(() => applyCurrentDelivery(f.validated, f.config, { ...f.options, writeFileSync(file, value) { writes++; if (writes === 2) throw new Error('fixture write failure'); fs.writeFileSync(file, value); } }), /fixture write failure/);
  files.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
});

test('safe file delivery rejects duplicate or ambiguous identities and running THS processes', t => {
  const f = fixture(t); const duplicate = structuredClone(f.validated); duplicate.normalized.artifacts[0].payload.picks[1].code = duplicate.normalized.artifacts[0].payload.picks[0].code;
  assert.throws(() => applyCurrentDelivery(duplicate, f.config, f.options), /唯一/);
  assert.throws(() => applyCurrentDelivery(f.validated, f.config, { ...f.options, processNames: ['happ.exe'] }), /关闭/);
});

test('safe file delivery rejects malformed existing date-group JSON before writing', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.customDir, '338'), '{bad-json', 'utf8');
  assert.throws(() => applyCurrentDelivery(f.validated, f.config, f.options), /JSON/);
});

test('safe file delivery no-change checks JSON context and rejects a historical same-day replay', t => {
  const f = fixture(t); applyCurrentDelivery(f.validated, f.config, f.options);
  const targetFile = path.join(f.customDir, '337'); const payload = JSON.parse(fs.readFileSync(targetFile, 'utf8')); payload.context = '000001|,33|'; fs.writeFileSync(targetFile, JSON.stringify(payload), 'utf8');
  assert.equal(buildPlan(f.validated, f.config, f.options).noChange, false);
  const historical = structuredClone(f.validated); historical.normalized.asOf.marketDate = '2025-09-10';
  assert.throws(() => buildPlan(historical, f.config, f.options), /当前年份/);
  const olderSameGroup = structuredClone(f.validated); olderSameGroup.normalized.asOf.marketDate = '2026-09-08';
  assert.throws(() => buildPlan(olderSameGroup, f.config, f.options), /历史荐股日期/);
  const invalidDate = structuredClone(f.validated); invalidDate.normalized.asOf.marketDate = '2026-09-31';
  assert.throws(() => buildPlan(invalidDate, f.config, f.options), /当前年份/);
});
