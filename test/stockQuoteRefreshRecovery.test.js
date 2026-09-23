const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function stocks(count) {
  return Array.from({ length: count }, (_, index) => ({
    code: String(index + 1).padStart(6, '0'),
    name: '样本证券' + (index + 1),
    price: 8,
    change: -1,
    tradeDate: '2026-09-17',
    tradeTime: '15:00:00'
  }));
}

function codesIn(url) {
  return new URL(url, 'http://localhost').searchParams.get('codes').split(',');
}

function quotesFor(codes) {
  return codes.map(code => ({
    code, price: 12, change: 2.5,
    tradeDate: '2026-09-18', tradeTime: '15:00:00'
  }));
}

function loadStockList(fetchJsonData, initialStocks = []) {
  const status = { textContent: '', style: {}, dataset: {} };
  const tbody = { innerHTML: '', querySelectorAll() { return []; } };
  const document = {
    body: { classList: { contains() { return false; } } },
    getElementById(id) {
      if (id === 'stockListStatus') return status;
      if (id === 'stockTbody') return tbody;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const state = {
    allStocks: initialStocks.map(stock => ({ ...stock })),
    filteredStocks: [], searchResults: [], watchlist: [],
    minuteSeriesByCode: {}, currentPage: 0, PAGE_SIZE: 2
  };
  const window = { State: state, ApiClient: { fetchJsonData } };
  const source = fs.readFileSync(path.resolve(__dirname, '../js/modules/stockList.js'), 'utf8');
  vm.runInNewContext(source, {
    window, document, URLSearchParams, setTimeout, clearTimeout,
    getComputedStyle() { return { getPropertyValue() { return ''; } }; },
    console: { warn() {}, error() {}, log() {} }
  }, { filename: 'stockList.js' });
  return { StockList: window.StockList, state, status, tbody };
}

test('large quote refresh splits unique codes into batches of no more than 50', async () => {
  const requested = [];
  const input = stocks(121);
  const loaded = loadStockList(async url => {
    const codes = codesIn(url);
    requested.push(codes);
    return quotesFor(codes);
  }, input);
  input.push({ ...input[0] });

  const result = await loaded.StockList.refreshQuotes(input);

  assert.ok(requested.length >= 3, '121 securities must not be sent as one enormous request');
  assert.ok(requested.every(batch => batch.length <= 50), 'each request must stay within the batch limit');
  assert.equal(requested.flat().length, 121, 'duplicate rows should not duplicate provider work');
  assert.equal(new Set(requested.flat()).size, 121);
  assert.equal(result.ok, true);
  assert.equal(result.count, 121);
  assert.equal(result.observedAt, '2026-09-18 15:00:00');
  assert.ok(input.every(stock => stock.price === 12));
  assert.ok(loaded.state.allStocks.every(stock => stock.price === 12));
});

test('one timed-out quote batch preserves old values while successful batches still update', async () => {
  const input = stocks(120);
  const loaded = loadStockList(async url => {
    const codes = codesIn(url);
    if (codes.includes('000051')) throw new Error('请求超时：' + url);
    return quotesFor(codes);
  }, input);
  loaded.state.searchResults = [ { ...input[0] }, { ...input[50] }, { ...input[119] } ];

  const result = await loaded.StockList.refreshQuotes(input);

  assert.equal(input[0].price, 12, 'successful earlier batch updates immediately');
  assert.equal(input[119].price, 12, 'failure must not prevent later batches from being processed');
  assert.equal(input[50].price, 8, 'failed batch must not erase the existing quote');
  assert.equal(input[50].tradeDate, '2026-09-17', 'failed batch must not pretend the old quote is fresh');
  assert.equal(loaded.state.searchResults[1].price, 8);
  assert.equal(loaded.state.searchResults[2].price, 12);
  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.count, 70);
  assert.match(loaded.status.textContent, /部分/);
  assert.doesNotMatch(loaded.status.textContent, /\/api\/|codes=|https?:\/\//);
});

test('a recovered quote refresh removes the previous failure notice', async () => {
  let failed = true;
  const input = stocks(1);
  const loaded = loadStockList(async url => {
    if (failed) throw new Error('请求超时：' + url);
    return quotesFor(codesIn(url));
  }, input);
  await loaded.StockList.refreshQuotes(input);
  assert.match(loaded.status.textContent, /超时/);

  failed = false;
  const result = await loaded.StockList.refreshQuotes(input);

  assert.equal(result.ok, true);
  assert.equal(input[0].price, 12);
  assert.doesNotMatch(loaded.status.textContent, /失败|超时|不可用|保留/);
});

test('timeout notice is readable and never exposes the request URL or code list', async () => {
  const input = stocks(2);
  const loaded = loadStockList(async url => { throw new Error('请求超时：' + url); }, input);

  await loaded.StockList.refreshQuotes(input);

  assert.match(loaded.status.textContent, /超时/);
  assert.match(loaded.status.textContent, /保留/);
  assert.doesNotMatch(loaded.status.textContent, /\/api\/|codes=|000001|https?:\/\//);
  assert.ok(loaded.status.textContent.length < 160, 'drawer status must remain a short explanation');
  assert.equal(input[0].price, 8);
});

test('an unavailable service is distinguished from a request timeout', async () => {
  const input = stocks(2);
  const loaded = loadStockList(async url => {
    throw Object.assign(new Error('HTTP 503 Service Unavailable: ' + url), { status: 503 });
  }, input);

  await loaded.StockList.refreshQuotes(input);

  assert.match(loaded.status.textContent, /不可用|无法连接|未能连接|服务异常/);
  assert.doesNotMatch(loaded.status.textContent, /超时|\/api\/|codes=|https?:\/\//);
  assert.equal(input[0].price, 8);
});

test('repeated bottom scroll loads only one page and shows its rows before slow quotes arrive', async () => {
  const pending = [];
  const loaded = loadStockList(url => new Promise(resolve => {
    pending.push(() => resolve(quotesFor(codesIn(url))));
  }), stocks(8));
  loaded.state.filteredStocks = loaded.state.allStocks.slice(0, 2);

  const first = loaded.StockList.loadMoreStocks();
  const second = loaded.StockList.loadMoreStocks();
  const third = loaded.StockList.loadMoreStocks();
  const pendingPage = loaded.state.currentPage;
  const pendingRowCount = loaded.state.filteredStocks.length;
  const visibleWhilePending = loaded.tbody.innerHTML;
  const requestCount = pending.length;
  pending.splice(0).forEach(resolve => resolve());
  await Promise.all([first, second, third]);

  assert.equal(pendingPage, 1, 'a pending page must not allow repeated scroll events to advance again');
  assert.equal(pendingRowCount, 4);
  assert.equal(requestCount, 1);
  assert.match(visibleWhilePending, /data-code="000003"/, 'catalog rows should remain usable while prices load');
  assert.equal(new Set(loaded.state.filteredStocks.map(stock => stock.code)).size, 4);

  const next = loaded.StockList.loadMoreStocks();
  pending.splice(0).forEach(resolve => resolve());
  await next;
  assert.equal(loaded.state.currentPage, 2, 'the paging guard must release after completion');
  assert.equal(loaded.state.filteredStocks.length, 6);
});
