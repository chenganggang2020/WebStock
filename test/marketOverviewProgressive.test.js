const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const requests = [], published = [];
  const window = {
    MarketComparison: { getSelectedWindow: () => 60 },
    Dashboard: { renderMarketCockpit: value => published.push(value) },
    ApiClient: { fetchJsonData: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/modules/marketOverview'), 'utf8'), {
    window, document: { getElementById: () => null }
  });
  return { api: window.MarketOverview, requests, published };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const data = [
  { indices: [], fetchedAt: '2026-10-09T01:00:00Z' },
  { aShare: { score: 51 }, updatedAt: '2026-10-09T01:00:00Z' },
  { boards: { day: [] }, generatedAt: '2026-10-09T01:00:00Z' },
  { window: 60, series: [] }
];

test('sentiment and sectors publish independently while indices/history are still pending', async () => {
  const h = harness(), loading = h.api.load();
  h.requests[1].resolve(data[1]); await tick();
  assert.equal(h.published.at(-1)?.sentiment, data[1]);
  h.requests[2].resolve(data[2]); await tick();
  assert.equal(h.published.at(-1)?.hot, data[2]);
  h.requests[0].resolve(data[0]); h.requests[3].resolve(data[3]);
  await loading;
});

test('failed sections retain original data and timestamps, report errors, and permit retry', async () => {
  const h = harness(), initial = h.api.load();
  h.requests.forEach((request, i) => request.resolve(data[i])); await initial;
  const refresh = h.api.load({ refresh: true });
  h.requests.slice(4).forEach(request => request.reject(new Error('fixture timeout')));
  const retained = await refresh;
  ['indices', 'sentiment', 'hot', 'indexHistory'].forEach((key, i) => {
    assert.equal(retained[key], data[i]);
    assert.equal(retained.refreshErrors[key], 'fixture timeout');
  });
  const retry = h.api.load();
  assert.equal(h.requests.length, 12, 'failure must not mark the cached result fresh for 60 seconds');
  h.requests.slice(8).forEach((request, i) => request.resolve(data[i]));
  assert.equal(Object.keys((await retry).refreshErrors).length, 0);
});

test('late rejected or successful requests cannot overwrite a newer forced refresh', async () => {
  const h = harness(), old = h.api.load(), latest = h.api.load({ refresh: true });
  h.requests.slice(4).forEach((request, i) => request.resolve(data[i]));
  const expected = await latest;
  h.requests[0].reject(new Error('old error'));
  h.requests.slice(1, 4).forEach(request => request.resolve({ marker: 'old response' }));
  assert.equal(await old, expected);
  assert.equal(h.published.at(-1), expected);
});
