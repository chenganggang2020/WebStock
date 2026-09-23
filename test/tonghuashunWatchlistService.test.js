const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseSelfStockCache,
  parseSelfStockInfo,
  parseCustomBlockCatalog,
  findNewestSelfStockCache,
  findNewestSelfStockFile,
  readLocalCatalog,
  getStatus,
  previewLocalDiff
} = require('../services/tonghuashunWatchlistService');
const {
  buildRecommendationPlan,
  replaceRecommendationBlock,
  defaultRecommendationGroupName
} = require('../services/tonghuashunRecommendationService');

test('Tonghuashun self-stock parser keeps supported securities in source order', () => {
  const catalog = new Map([
    ['601138', '工业富联'],
    ['159001', '货币ETF易方达'],
    ['000977', '浪潮信息']
  ]);
  const payload = JSON.stringify({
    Data: {
      Selfstock: '601138|1A0001|159001|601138|000977,17|48|17|17|33',
      Count: 5,
      ModifyTime: '20260817090102'
    }
  });

  const result = parseSelfStockCache(payload, catalog);

  assert.deepEqual(result.items, [
    { code: '601138', name: '工业富联' },
    { code: '159001', name: '货币ETF易方达' },
    { code: '000977', name: '浪潮信息' }
  ]);
  assert.deepEqual(result.ignoredCodes, ['1A0001']);
  assert.equal(result.sourceCount, 5);
  assert.equal(result.modifyTime, '20260817090102');
});

test('Tonghuashun cache discovery chooses the newest user cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-'));
  const older = path.join(root, 'user-a', 'SelfStockCache.json');
  const newer = path.join(root, 'user-b', 'SelfStockCache.json');
  fs.mkdirSync(path.dirname(older), { recursive: true });
  fs.mkdirSync(path.dirname(newer), { recursive: true });
  fs.writeFileSync(older, '{}');
  fs.writeFileSync(newer, '{}');
  fs.utimesSync(older, new Date('2026-08-16T01:00:00Z'), new Date('2026-08-16T01:00:00Z'));
  fs.utimesSync(newer, new Date('2026-08-17T01:00:00Z'), new Date('2026-08-17T01:00:00Z'));

  assert.equal(findNewestSelfStockCache([root]), newer);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun new self-stock parser keeps supported securities in source order', () => {
  const catalog = new Map([
    ['002552', '宝鼎科技'],
    ['600406', '国电南瑞'],
    ['159001', '货币ETF易方达']
  ]);
  const payload = JSON.stringify([
    { C: '002552', M: '33', P: '54.30', T: '20260821' },
    { C: '600406', M: '17', P: '', T: '' },
    { C: '001232', M: '33', P: '184.01', T: '20260810' },
    { C: '883418', M: '48', P: '2095.868', T: '20260818' },
    { C: '002552', M: '33', P: '54.30', T: '20260821' },
    { C: '159001', M: '33', P: '1.00', T: '20260820' }
  ]);

  const result = parseSelfStockInfo(payload, catalog);

  assert.deepEqual(result.items, [
    { code: '002552', name: '宝鼎科技' },
    { code: '600406', name: '国电南瑞' },
    { code: '001232', name: '001232' },
    { code: '159001', name: '货币ETF易方达' }
  ]);
  assert.deepEqual(result.ignoredCodes, ['883418']);
  assert.equal(result.sourceCount, 6);
  assert.equal(result.modifyTime, '20260821');
});

test('Tonghuashun discovery supports the current SelfStockInfo format', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-current-'));
  const oldCache = path.join(root, 'user-a', 'SelfStockCache.json');
  const currentCache = path.join(root, 'user-b', 'SelfStockInfo.json');
  fs.mkdirSync(path.dirname(oldCache), { recursive: true });
  fs.mkdirSync(path.dirname(currentCache), { recursive: true });
  fs.writeFileSync(oldCache, '{}');
  fs.writeFileSync(currentCache, '[]');
  fs.utimesSync(oldCache, new Date('2026-08-25T01:00:00Z'), new Date('2026-08-25T01:00:00Z'));
  fs.utimesSync(currentCache, new Date('2026-08-26T01:00:00Z'), new Date('2026-08-26T01:00:00Z'));

  assert.equal(findNewestSelfStockFile([root]), currentCache);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun custom-block parser keeps local group order and ignores concept indexes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-groups-'));
  const customDir = path.join(root, 'custom_block');
  fs.mkdirSync(customDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'stockblock.ini'), Buffer.from(
    '[BLOCK_NAME_MAP_TABLE]\r\n151=00_每日荐股_0828\r\n14A=09_AI算力\r\n[SYSTEM]\r\nLastSynCodeID=708\r\n',
    'utf8'
  ));
  fs.writeFileSync(path.join(customDir, '0'), JSON.stringify({ sortstr: '151,14A,' }));
  fs.writeFileSync(path.join(customDir, '337'), JSON.stringify({
    context: '601138|000977|,17|33|'
  }));
  fs.writeFileSync(path.join(customDir, '330'), JSON.stringify({
    context: '885957|000977|000938|,48|33|33|'
  }));
  const catalog = new Map([
    ['601138', '工业富联'],
    ['000977', '浪潮信息'],
    ['000938', '紫光股份']
  ]);

  const result = parseCustomBlockCatalog(root, catalog);

  assert.deepEqual(result.groups.map(group => group.name), ['00_每日荐股_0828', '09_AI算力']);
  assert.deepEqual(result.groups[0].items.map(item => item.code), ['601138', '000977']);
  assert.deepEqual(result.groups[1].items.map(item => item.code), ['000977', '000938']);
  assert.deepEqual(result.groups[1].ignoredCodes, ['885957']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun local catalog combines the default self list and custom groups without writing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-catalog-'));
  const customDir = path.join(root, 'custom_block');
  fs.mkdirSync(customDir, { recursive: true });
  const selfPath = path.join(root, 'SelfStockInfo.json');
  fs.writeFileSync(selfPath, JSON.stringify([
    { C: '601138', M: '17', T: '20260827' },
    { C: '000977', M: '33', T: '20260827' }
  ]));
  fs.writeFileSync(path.join(root, 'stockblock.ini'), '[BLOCK_NAME_MAP_TABLE]\n151=每日观察\n');
  fs.writeFileSync(path.join(customDir, '0'), JSON.stringify({ sortstr: '151,' }));
  fs.writeFileSync(path.join(customDir, '337'), JSON.stringify({ context: '000977|,33|' }));
  const before = fs.statSync(selfPath).mtimeMs;

  const result = readLocalCatalog({
    cachePath: selfPath,
    catalog: new Map([['601138', '工业富联'], ['000977', '浪潮信息']])
  });

  assert.equal(result.groups[0].name, '同花顺自选');
  assert.deepEqual(result.groups[0].items.map(item => item.code), ['601138', '000977']);
  assert.equal(result.groups[1].name, '每日观察');
  assert.deepEqual(result.groups[1].items.map(item => item.code), ['000977']);
  assert.equal(fs.statSync(selfPath).mtimeMs, before);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun status reports the supported self-stock count', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-status-'));
  const selfPath = path.join(root, 'SelfStockInfo.json');
  fs.writeFileSync(selfPath, JSON.stringify([
    { C: '601138', M: '17', T: '20260827' },
    { C: '000977', M: '33', T: '20260827' }
  ]));

  const result = getStatus({
    cachePath: selfPath,
    catalog: new Map([['601138', '工业富联'], ['000977', '浪潮信息']])
  });

  assert.equal(result.available, true);
  assert.equal(result.supportedCount, 2);
  assert.equal(result.sourceCount, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun diff preview is read-only and separates shared and one-sided symbols', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-diff-'));
  const selfPath = path.join(root, 'SelfStockInfo.json');
  fs.writeFileSync(selfPath, JSON.stringify([
    { C: '601138', M: '17', T: '20260827' },
    { C: '000977', M: '33', T: '20260827' }
  ]));
  const before = fs.readFileSync(selfPath);

  const result = previewLocalDiff({
    cachePath: selfPath,
    catalog: new Map([
      ['601138', '工业富联'],
      ['000977', '浪潮信息'],
      ['600584', '长电科技']
    ]),
    webstockItems: [
      { code: '000977', name: '浪潮信息' },
      { code: '600584', name: '长电科技' }
    ]
  });

  assert.equal(result.readOnly, true);
  assert.equal(result.group.id, 'default-self-stock');
  assert.deepEqual(result.onlyInTonghuashun.map(item => item.code), ['601138']);
  assert.deepEqual(result.onlyInWebStock.map(item => item.code), ['600584']);
  assert.deepEqual(result.shared.map(item => item.code), ['000977']);
  assert.deepEqual(fs.readFileSync(selfPath), before);
  fs.rmSync(root, { recursive: true, force: true });
});

test('recommendation plan keeps order, deduplicates codes, and reports group changes', () => {
  const xml = '<hevo>\n' +
    '  <Block name="00_每日荐股_0817" id="337" IsLock="false">\n' +
    '    <security market="USHA" code="603986" />\n' +
    '    <security market="USZA" code="000977" />\n' +
    '  </Block>\n' +
    '  <Block name="其他分组" id="338" IsLock="false">\n' +
    '    <security market="USHA" code="600584" />\n' +
    '  </Block>\n' +
    '</hevo>\n';

  const plan = buildRecommendationPlan(xml, [
    { code: '000977', name: '浪潮信息', tier: '重点' },
    { code: '601138', name: '工业富联', tier: '重点' },
    { code: '000977', name: '浪潮信息' }
  ], { date: '2026-08-17' });

  assert.equal(plan.groupName, '00_每日荐股_0817');
  assert.deepEqual(plan.items.map(item => item.code), ['000977', '601138']);
  assert.deepEqual(plan.addedCodes, ['601138']);
  assert.deepEqual(plan.removedCodes, ['603986']);
  assert.deepEqual(plan.unchangedCodes, ['000977']);
});

test('recommendation block replacement preserves unrelated groups and existing block id', () => {
  const xml = '<hevo>\n' +
    '  <Block name="00_每日荐股_0817" id="337" IsLock="false">\n' +
    '    <security market="USHA" code="603986" />\n' +
    '  </Block>\n' +
    '  <Block name="其他分组" id="338" IsLock="false">\n' +
    '    <security market="USHA" code="600584" />\n' +
    '  </Block>\n' +
    '</hevo>\n';
  const plan = buildRecommendationPlan(xml, [
    { code: '000977', name: '浪潮信息' },
    { code: '601138', name: '工业富联' }
  ], { date: '2026-08-17' });

  const updated = replaceRecommendationBlock(xml, plan);

  assert.match(updated, /<Block name="00_每日荐股_0817" id="337" IsLock="false">/);
  assert.match(updated, /<security market="USZA" code="000977" \/>/);
  assert.match(updated, /<security market="USHA" code="601138" \/>/);
  assert.doesNotMatch(updated, /code="603986"/);
  assert.match(updated, /<Block name="其他分组" id="338" IsLock="false">[\s\S]*code="600584"/);
});

test('default recommendation group name uses Beijing trading date', () => {
  assert.equal(defaultRecommendationGroupName('2026-08-17'), '00_每日荐股_0817');
});

test('new recommendation dates add a group without replacing prior dates', () => {
  const xml = '<hevo>\n' +
    '  <Block name="00_每日荐股_0813" id="337" IsLock="false">\n' +
    '    <security market="USHA" code="603986" />\n' +
    '  </Block>\n' +
    '  <Block name="00_每日荐股_0817" id="338" IsLock="false">\n' +
    '    <security market="USZA" code="000977" />\n' +
    '  </Block>\n' +
    '</hevo>\n';

  const plan = buildRecommendationPlan(xml, [
    { code: '601138', name: '工业富联' }
  ], { date: '2026-08-18' });
  const updated = replaceRecommendationBlock(xml, plan);

  assert.deepEqual(plan.groupsToRemove, []);
  assert.match(updated, /name="00_每日荐股_0813"/);
  assert.match(updated, /name="00_每日荐股_0817"/);
  assert.match(updated, /name="00_每日荐股_0818"/);
});

test('rolling recommendation groups remove only the oldest date after the fourth group', () => {
  const xml = '<hevo>\n' +
    '  <Block name="00_每日荐股_0813" id="337" IsLock="false">\n' +
    '    <security market="USHA" code="603986" />\n' +
    '  </Block>\n' +
    '  <Block name="00_每日荐股_0817" id="338" IsLock="false">\n' +
    '    <security market="USZA" code="000977" />\n' +
    '  </Block>\n' +
    '  <Block name="00_每日荐股_0818" id="339" IsLock="false">\n' +
    '    <security market="USHA" code="601138" />\n' +
    '  </Block>\n' +
    '</hevo>\n';

  const plan = buildRecommendationPlan(xml, [
    { code: '600584', name: '长电科技' }
  ], { date: '2026-08-19' });
  const updated = replaceRecommendationBlock(xml, plan);

  assert.deepEqual(plan.groupsToRemove, ['00_每日荐股_0813']);
  assert.doesNotMatch(updated, /name="00_每日荐股_0813"/);
  assert.match(updated, /name="00_每日荐股_0817"/);
  assert.match(updated, /name="00_每日荐股_0818"/);
  assert.match(updated, /name="00_每日荐股_0819"/);
});

test('latest recommendation group is ordered before older daily groups', () => {
  const xml = '<hevo>\n' +
    '  <Block name="普通分组" id="336" IsLock="false">\n' +
    '    <security market="USHA" code="600584" />\n' +
    '  </Block>\n' +
    '  <Block name="00_每日荐股_0817" id="337" IsLock="false">\n' +
    '    <security market="USZA" code="000977" />\n' +
    '  </Block>\n' +
    '  <Block name="00_每日荐股_0813" id="338" IsLock="false">\n' +
    '    <security market="USHA" code="603986" />\n' +
    '  </Block>\n' +
    '  <Block name="00_每日荐股_0818" id="339" IsLock="false">\n' +
    '    <security market="USHA" code="601138" />\n' +
    '  </Block>\n' +
    '</hevo>\n';

  const plan = buildRecommendationPlan(xml, [
    { code: '601138', name: '工业富联' }
  ], { date: '2026-08-18' });
  const updated = replaceRecommendationBlock(xml, plan);

  assert.ok(updated.indexOf('name="00_每日荐股_0818"') < updated.indexOf('name="00_每日荐股_0817"'));
  assert.ok(updated.indexOf('name="00_每日荐股_0817"') < updated.indexOf('name="00_每日荐股_0813"'));
  assert.match(updated, /name="普通分组"/);
});
