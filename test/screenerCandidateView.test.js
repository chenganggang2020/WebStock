const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const candidateModel = require('../js/modules/screenerCandidateModel');

function loadView() {
  const context = {
    window: { ScreenerCandidateModel: candidateModel },
    console,
    setTimeout,
    Blob,
    URL
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'stockScreener.js'), 'utf8'),
    context
  );
  return context.window.StockScreener;
}

function loadViewWithResultsBox() {
  const resultsBox = { innerHTML: '', onclick: null, oncontextmenu: null, onkeydown: null };
  const context = {
    window: { ScreenerCandidateModel: candidateModel },
    document: {
      getElementById(id) { return id === 'screenerResults' ? resultsBox : null; }
    },
    console,
    setTimeout,
    Blob,
    URL
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'stockScreener.js'), 'utf8'),
    context
  );
  return { view: context.window.StockScreener, resultsBox };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise(function(done, fail) { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function loadInteractiveView(runRequests, capture) {
  const elements = {
    screenerResults: { innerHTML: '', onclick: null, oncontextmenu: null, onkeydown: null },
    screenerHistory: { innerHTML: '' },
    screenerStrategy: { value: 'stable' },
    screenerScope: { value: 'all' },
    screenerPromptStyle: { value: 'sector-chain' },
    screenerDemand: { value: '' },
    screenerMinScoreInput: { value: '0' },
    screenerResultKeywordInput: { value: '' }
  };
  const window = {
    ScreenerCandidateModel: candidateModel,
    State: { allStocks: [], klineSnapshots: {}, watchlist: [], recentStocks: [], positions: [] },
    apiFetch(path, options) {
      if (path === '/api/screener/run') {
        capture.runRequest = JSON.parse(options.body);
        const request = deferred();
        runRequests.push(request);
        return request.promise;
      }
      if (path.indexOf('/api/screener/results?') === 0) return Promise.resolve([]);
      throw new Error('Unexpected path: ' + path);
    }
  };
  const context = {
    window,
    document: {
      getElementById(id) { return elements[id] || null; },
      createElement() {
        return { click() {}, remove() {}, href: '', download: '' };
      },
      body: { appendChild() {} }
    },
    console,
    setTimeout,
    Blob,
    URL: {
      createObjectURL(blob) { capture.blob = blob; return 'blob:fixture'; },
      revokeObjectURL() {}
    }
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'stockScreener.js'), 'utf8'),
    context
  );
  return { view: window.StockScreener, resultsBox: elements.screenerResults, state: window.State };
}

test('candidate view renders four evidence coverage states and compact research card', () => {
  const view = loadView();
  const html = view.renderCandidateCard({
    code: '688362',
    name: '甬矽电子',
    score: 82,
    strategy: 'breakout',
    observePrice: 25.4,
    dataCoverage: { code: true, quote: true, technical: true, profile: false },
    reasons: ['量价结构待复核'],
    risks: ['主营资料缺失'],
    factorTags: ['趋势观察'],
    factorBreakdown: [{ label: '趋势', impact: 8 }]
  });

  assert.match(html, /data-screener-candidate-card/);
  assert.match(html, /本地候选筛选分/);
  assert.match(html, /代码/);
  assert.match(html, /行情数据/);
  assert.match(html, /技术数据/);
  assert.match(html, /主营资料/);
  assert.match(html, /量价结构待复核/);
  assert.match(html, /主营资料缺失/);
});

test('coverage view reports technical exclusion count instead of hiding missing data', () => {
  const view = loadView();
  const html = view.renderCoverage({
    universeCount: 10,
    codeCount: 10,
    codeRate: 100,
    quoteCount: 6,
    quoteRate: 60,
    technicalCount: 4,
    technicalRate: 40,
    profileCount: 5,
    profileRate: 50,
    technicalRequired: true,
    excludedForMissingTechnicalCount: 6,
    limitations: ['技术指标只使用本机当前已加载并随请求提供的 K 线快照；单次最多 50 只。']
  });

  assert.match(html, /本地候选筛选，不是全市场实时选股/);
  assert.match(html, /单次最多 50 只/);
  assert.match(html, /代码覆盖[^]*10[^]*100\.00%/);
  assert.match(html, /行情数据[^]*6[^]*60\.00%/);
  assert.match(html, /技术数据[^]*4[^]*40\.00%/);
  assert.match(html, /主营资料[^]*5[^]*50\.00%/);
  assert.match(html, /缺技术数据已排除[^]*6/);
});

test('an empty technical candidate set still shows the research-only disclaimer', () => {
  const loaded = loadViewWithResultsBox();
  loaded.view.render({
    candidates: [],
    coverage: { technicalRequired: true, excludedForMissingTechnicalCount: 6 },
    disclaimer: '本地筛选结果仅供研究，不构成投资建议。'
  });

  assert.match(loaded.resultsBox.innerHTML, /暂无合格候选/);
  assert.match(loaded.resultsBox.innerHTML, /不构成投资建议/);
});

test('screener keeps the newest run as the rendered and exported result', async () => {
  const requests = [];
  const capture = {};
  const loaded = loadInteractiveView(requests, capture);
  const firstRun = loaded.view.run();
  const secondRun = loaded.view.run();
  const newest = {
    candidates: [{ code: '000002', name: 'Newest result', score: 90, reasons: [], risks: [] }],
    disclaimer: 'research only'
  };
  const stale = {
    candidates: [{ code: '000001', name: 'Stale result', score: 80, reasons: [], risks: [] }],
    disclaimer: 'research only'
  };

  requests[1].resolve(newest);
  await secondRun;
  requests[0].resolve(stale);
  await firstRun;

  assert.match(loaded.resultsBox.innerHTML, /Newest result/);
  assert.doesNotMatch(loaded.resultsBox.innerHTML, /Stale result/);
  await loaded.view.exportCurrentCsv();
  const csv = await capture.blob.text();
  assert.match(csv, /Newest result/);
  assert.doesNotMatch(csv, /Stale result/);
});

test('screener sends at most fifty technical snapshots and keeps the selected stock in that bound', async () => {
  const requests = [];
  const capture = {};
  const loaded = loadInteractiveView(requests, capture);
  for (let index = 1; index <= 55; index += 1) {
    const code = String(index).padStart(6, '0');
    loaded.state.klineSnapshots[code] = Array.from({ length: 5 }, function(_, row) {
      return { close: 10 + row, volume: 1000 + row };
    });
  }
  loaded.state.currentStock = { code: '999999' };
  loaded.state.currentRawData = Array.from({ length: 5 }, function(_, row) {
    return { close: 20 + row, volume: 2000 + row };
  });
  const running = loaded.view.run();
  requests[0].resolve({ candidates: [], coverage: {}, disclaimer: 'research only' });
  await running;

  assert.equal(capture.runRequest.klineSnapshot.length, 50);
  assert.equal(capture.runRequest.technicalSnapshotLimit, 50);
  assert.equal(capture.runRequest.technicalSnapshotSentCount, 50);
  assert.ok(capture.runRequest.klineSnapshot.some(function(item) { return item.code === '999999'; }));
});

test('screener CSV neutralizes formula-like text but preserves numeric negatives', async () => {
  const requests = [];
  const capture = {};
  const loaded = loadInteractiveView(requests, capture);
  const running = loaded.view.run();
  requests[0].resolve({
    candidates: [{
      code: '000001',
      name: '=HYPERLINK("https://bad.invalid")',
      score: 12.5,
      strategy: '\t+SUM(1,1)',
      marketLabel: ' @cmd',
      reasons: ['-malicious'],
      risks: [],
      observePrice: '-3.25'
    }],
    disclaimer: 'research only'
  });
  await running;
  await loaded.view.exportCurrentCsv();
  const csv = await capture.blob.text();

  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'\t\+SUM/);
  assert.match(csv, /' @cmd/);
  assert.match(csv, /'-malicious/);
  assert.match(csv, /"-3\.25"/);
  assert.doesNotMatch(csv, /"'-3\.25"/);
});

test('screener replaces the loading state when the latest run fails', async () => {
  const requests = [];
  const loaded = loadInteractiveView(requests, {});
  const running = loaded.view.run();

  requests[0].reject(new Error('<b>latest failure</b>'));
  await assert.rejects(running, /latest failure/);

  assert.doesNotMatch(loaded.resultsBox.innerHTML, /loading|正在运行/);
  assert.match(loaded.resultsBox.innerHTML, /latest failure/);
  assert.doesNotMatch(loaded.resultsBox.innerHTML, /<b>/);
});

test('screener silently ignores an older failure after a newer run succeeds', async () => {
  const requests = [];
  const loaded = loadInteractiveView(requests, {});
  const oldRun = loaded.view.run();
  const newRun = loaded.view.run();

  requests[1].resolve({
    candidates: [{ code: '000002', name: 'Newest result', score: 90, reasons: [], risks: [] }],
    disclaimer: 'research only'
  });
  await newRun;
  requests[0].reject(new Error('stale failure'));
  assert.equal(await oldRun, null);

  assert.match(loaded.resultsBox.innerHTML, /Newest result/);
  assert.doesNotMatch(loaded.resultsBox.innerHTML, /stale failure/);
});
