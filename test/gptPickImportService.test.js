const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-gpt-picks-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const gptPicks = require('../services/gptPickImportService');
const app = require('../server');

function requestJson(server, options, body) {
  const address = server.address();
  const requestOptions = Object.assign({
    hostname: '127.0.0.1',
    port: address.port,
    method: 'GET',
    headers: {}
  }, typeof options === 'string' ? { path: options } : options);

  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, json: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('parses Markdown candidates, merges duplicates and treats HTML as untrusted text', () => {
  const original = [
    '| 代码 | 名称 | 理由 | 风险 | 原分析 |',
    '| --- | --- | --- | --- | --- |',
    '| 600519 | <b>贵州茅台</b> | 品牌护城河 | 估值偏高 | 等待量价确认 |',
    '| 300750 | 宁德时代 | 海外份额提升 | 价格竞争 | 关注盈利质量 |',
    '',
    '补充：600519 贵州茅台',
    '风险：消费复苏低于预期<script>alert(1)</script>'
  ].join('\n');

  const parsed = gptPicks.parseManualPickContent(original);

  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.duplicateCount, 1);
  assert.deepEqual(parsed.candidates[0], {
    code: '600519',
    name: '贵州茅台',
    reason: '品牌护城河',
    risk: '估值偏高',
    originalAnalysis: '等待量价确认'
  });
  assert.equal(parsed.originalText, original);
  assert.equal(parsed.security.trustedHtml, false);
  assert.equal(JSON.stringify(parsed.candidates).includes('<script>'), false);
});

test('parses JSON candidates without inventing missing claims', () => {
  const parsed = gptPicks.parseManualPickContent({
    stocks: [
      { code: '688981', name: '中芯国际', reason: '先进制程改善', risks: ['周期波动', '资本开支'], analysis: '只作为观察候选' },
      { stockCode: '002594', stockName: '比亚迪', rationale: '海外扩张' }
    ],
    analysis: 'GPT 每日复盘原文'
  });

  assert.equal(parsed.format, 'json');
  assert.equal(parsed.candidates[0].risk, '周期波动；资本开支');
  assert.equal(parsed.candidates[0].originalAnalysis, '只作为观察候选');
  assert.equal(parsed.candidates[1].risk, '');
  assert.ok(parsed.warnings.some(item => item.includes('002594') && item.includes('风险')));
});

test('parses pasted JSON text and preserves the exact original text', () => {
  const original = '  {"picks":[{"code":"600036","name":"招商银行","reason":"息差韧性","risk":"资产质量","analysis":"观察修复"}],"analysis":"银行板块复盘"}\n';
  const parsed = gptPicks.parseManualPickContent(original);

  assert.equal(parsed.format, 'json');
  assert.equal(parsed.originalText, original);
  assert.equal(parsed.analysis, '银行板块复盘');
  assert.equal(parsed.candidates[0].name, '招商银行');
});

test('parses common name-before-code text and inline reason, risk and analysis labels', () => {
  const parsed = gptPicks.parseManualPickContent(
    '1. **贵州茅台（600519）**—理由：品牌韧性 风险：估值波动 分析：等待放量确认'
  );

  assert.deepEqual(parsed.candidates[0], {
    code: '600519',
    name: '贵州茅台',
    reason: '品牌韧性',
    risk: '估值波动',
    originalAnalysis: '等待放量确认'
  });
});

test('reports malformed pasted JSON instead of guessing from partial fields', () => {
  assert.throws(
    () => gptPicks.parseManualPickContent('{"picks":[{"code":"600519"}]'),
    /JSON 格式无效/
  );
});

test('keeps at most 20 unique A-share codes and rejects unreliable input', () => {
  const source = Array.from({ length: 23 }, (_, index) => {
    const code = String(600000 + index);
    return `${index + 1}. ${code} 测试股票${index + 1}\n理由：候选${index + 1}`;
  }).join('\n');

  const parsed = gptPicks.parseManualPickContent(source);
  assert.equal(parsed.candidates.length, 20);
  assert.equal(parsed.truncated, true);

  assert.throws(
    () => gptPicks.parseManualPickContent('日期 20260814，没有股票代码。'),
    /没有识别到.*A股.*6位代码/
  );
});

test('imports and lists manual ChatGPT picks in AI research runs', () => {
  const imported = gptPicks.importManualPicks({
    title: '2026-08-14 GPT 选股',
    content: '1. 600519 贵州茅台\n理由：品牌优势\n风险：估值波动\n分析：等待确认'
  });

  assert.ok(imported.id > 0);
  assert.equal(imported.source, 'manual-chatgpt');
  assert.equal(imported.runType, 'manual-chatgpt-stock-picks');
  assert.equal(imported.modelId, 'chatgpt-manual');
  assert.equal(imported.candidateCount, 1);
  assert.match(imported.importedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(imported.originalText.includes('品牌优势'), true);
  assert.equal(imported.automaticTrading, false);

  const listed = gptPicks.listManualPickImports({ limit: 5 });
  assert.equal(listed.items[0].id, imported.id);
  assert.equal(listed.items[0].candidates[0].code, '600519');
  assert.ok(listed.total >= 1);
});

test('lists one stock across daily ChatGPT imports without converting it into a trade signal', () => {
  const first = gptPicks.importManualPicks({
    title: '盘前候选 A',
    content: '600519 贵州茅台\n理由：品牌韧性\n风险：估值偏高\n分析：等待量价确认'
  });
  const second = gptPicks.importManualPicks({
    title: '盘后复盘 B',
    content: '600519 贵州茅台\n理由：回到观察区\n风险：支撑失效\n分析：仅保留研究记录\n300750 宁德时代\n理由：产业链观察'
  });

  const history = gptPicks.listManualPickCandidateHistory('600519', { limit: 10 });

  assert.equal(history.code, '600519');
  assert.equal(history.source, 'manual-chatgpt');
  assert.equal(history.totalOccurrences >= 2, true);
  assert.equal(history.items[0].importId, second.id);
  assert.equal(history.items[0].candidate.reason, '回到观察区');
  assert.equal(history.items.some(item => item.importId === first.id), true);
  assert.equal(history.automaticTrading, false);
  assert.ok(history.limitations.some(item => /未验证/.test(item)));
  assert.throws(() => gptPicks.listManualPickCandidateHistory('399001'), /A股/);
  assert.throws(() => gptPicks.listManualPickCandidateHistory('abc600519'), /A股/);
});

test('rejects index and B-share codes that are not A-share candidates', () => {
  assert.throws(
    () => gptPicks.parseManualPickContent('399001 深证成指\n理由：指数'),
    /没有识别到.*A股.*6位代码/
  );
  assert.throws(
    () => gptPicks.parseManualPickContent('900901 云赛B股\n理由：B股'),
    /没有识别到.*A股.*6位代码/
  );
  assert.equal(gptPicks.parseManualPickContent('920000 安徽凤凰\n理由：北交所样例').candidates[0].code, '920000');
});

test('list excludes generic research runs that spoof the pick run type', () => {
  const researchRuns = require('../services/researchRunService');
  researchRuns.createRun({
    runType: 'manual-chatgpt-stock-picks',
    modelId: 'other-model',
    title: 'spoofed import',
    result: 'not imported through the guarded endpoint',
    request: {
      source: 'other-source',
      candidates: Array.from({ length: 25 }, (_, index) => ({ code: '600' + String(index).padStart(3, '0') }))
    }
  });

  const listed = gptPicks.listManualPickImports({ limit: 100 });
  assert.equal(listed.items.some(item => item.title === 'spoofed import'), false);
});

test('POST and GET research-picks API expose the manual import contract without an API key', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const created = await requestJson(server, {
    path: '/api/research-picks/import',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    content: {
      picks: [{ code: '301308', name: '江波龙', reason: '存储周期', risk: '价格回落', analysis: '跟踪现货价格' }]
    }
  });

  assert.equal(created.statusCode, 200);
  assert.equal(created.json.success, true);
  assert.equal(created.json.data.source, 'manual-chatgpt');
  assert.equal(created.json.data.candidates[0].code, '301308');
  assert.equal(created.json.data.security.trustedHtml, false);

  const listed = await requestJson(server, '/api/research-picks?limit=10');
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json.success, true);
  assert.ok(listed.json.data.items.some(item => item.id === created.json.data.id));
  assert.ok(listed.json.data.total >= 1);

  const latest = await requestJson(server, '/api/research-picks/latest');
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.json.data.id, created.json.data.id);

  const stockHistory = await requestJson(server, '/api/research-picks/stock/301308?limit=7');
  assert.equal(stockHistory.statusCode, 200);
  assert.equal(stockHistory.json.data.code, '301308');
  assert.equal(stockHistory.json.data.items[0].candidate.reason, '存储周期');
  assert.equal(stockHistory.json.data.automaticTrading, false);

  const rejected = await requestJson(server, {
    path: '/api/research-picks/import',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { content: '<img src=x onerror=alert(1)>只包含恶意 HTML' });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json.success, false);
  assert.match(rejected.json.error, /没有识别到.*A股.*6位代码/);
});

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});
