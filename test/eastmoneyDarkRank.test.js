const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/eastmoney-dark-rank-20260916.json');
const { normalizeDarkRank, fetchDarkRank, buildQuery, ENDPOINT } = require('../services/capitalFlow/eastmoneyDarkRank');
const request = { date: '2026-09-16', scope: 'stock', page: 1 };
const receivedAt = '2026-09-17T08:20:00.000Z';
const fresh = () => JSON.parse(JSON.stringify(fixture));

test('real two-row provider sample preserves exact money, date and partial coverage', () => {
  const result = normalizeDarkRank(fresh(), request, receivedAt);
  assert.equal(result.source.id, 'eastmoney-darktrade-rank');
  assert.equal(result.source.classification, 'provider-model-estimate');
  assert.equal(result.source.documentedPublicApi, false);
  assert.equal(result.tradingDay, request.date);
  assert.equal(result.receivedAt, receivedAt);
  assert.equal(result.coverage.totalReported, 5350);
  assert.equal(result.coverage.receivedRows, 2);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.rows[0].darkNetCents, '100977344600');
  assert.equal(result.rows[0].visibleNetCents, '91962869100');
  assert.equal(result.rows[0].combinedNetCents, '192940213700');
  assert.equal(result.rows[0].price, 423.69);
  assert.equal(result.rows[0].darkActivityRatio, 0.06348);
  assert.equal(result.rows[0].changeRatio, 0.0672);
  assert.equal(result.rows[0].sourceTimeRaw, 153451);
  assert.equal(result.rows[0].sourceObservedAt, null);
  assert.equal(result.rows[0].reconciled, true);
  assert.equal(result.automaticTrading, false);
});

test('zero, missing and negative amounts remain distinct', () => {
  const raw = fresh();
  Object.assign(raw.data[0], {6: 0, 7: -5, 8: -5});
  raw.data[1][6] = null;
  const result = normalizeDarkRank(raw, request, receivedAt);
  assert.equal(result.rows[0].darkNetCents, '0');
  assert.equal(result.rows[0].visibleNetCents, '-500');
  assert.equal(result.rows[1].darkNetCents, null);
  assert.equal(result.rows[1].reconciled, null);
  assert.equal(result.quality.missingCoreRows, 1);
});

test('wrong dates and invalid provider envelopes are rejected instead of relabeled', () => {
  assert.throws(() => normalizeDarkRank({...fresh(), 1:20260915}, request, receivedAt), /date/i);
  assert.throws(() => normalizeDarkRank({...fresh(), errid:1}, request, receivedAt), /provider/i);
  assert.throws(() => normalizeDarkRank({...fresh(), data:null}, request, receivedAt), /data/i);
  assert.throws(() => buildQuery({...request,date:'2026-02-30'}), /date/i);
  assert.throws(() => buildQuery({...request,page:0}), /page/i);
  assert.throws(() => buildQuery({...request,scope:'unknown'}), /scope/i);
  assert.throws(() => normalizeDarkRank(fresh(), request, 'invalid'), /receivedAt/i);
});

test('schema drift, duplicate keys and unsafe money fail closed', () => {
  let raw = fresh(); raw.data[1] = raw.data[0];
  assert.throws(() => normalizeDarkRank(raw, request, receivedAt), /duplicate/i);
  raw = fresh(); raw.data[0][6] = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => normalizeDarkRank(raw, request, receivedAt), /amount/i);
  raw = fresh(); raw.data[0][6] = '';
  assert.throws(() => normalizeDarkRank(raw, request, receivedAt), /amount/i);
  raw = fresh(); raw.data[0][4] = 'BK0448';
  assert.throws(() => normalizeDarkRank(raw, request, receivedAt), /code/i);
});

test('mismatched totals are retained and flagged rather than silently corrected', () => {
  const raw = fresh(); raw.data[0][8] += 1;
  const result = normalizeDarkRank(raw, request, receivedAt);
  assert.equal(result.quality.reconciliationFailures, 1);
  assert.equal(result.rows[0].reconciled, false);
  assert.equal(result.rows[0].combinedNetCents, '192940213800');
});

test('industry and concept scope use separate provider filters; no stock price for sectors', () => {
  assert.equal(buildQuery({...request,scope:'industry'}).datetype, '2');
  assert.equal(buildQuery({...request,scope:'concept'}).datetype, '3');
  const raw = {...fresh(), 2:1, data:[{3:90,4:'BK0448',5:153932,6:2981624306,7:-1842719771,8:1138904535,11:0.01683,12:0.3956,13:24632353,14:-0.00113,15:'世嘉科技',16:'通信设备',20:'002796'}]};
  const result = normalizeDarkRank(raw, {...request,scope:'industry'}, receivedAt);
  assert.equal(result.rows[0].price, null);
  assert.equal(result.rows[0].darkInflowStockRatio, 0.3956);
  assert.equal(result.rows[0].reconciled, true);
});

test('fetch is one bounded GET without credentials, fallback, database or automatic pagination', async () => {
  const calls=[];
  const httpClient={get:async (url,options)=>{calls.push({url,options});return {data:fresh()};}};
  const result=await fetchDarkRank(request,{httpClient,now:()=>new Date(receivedAt)});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,ENDPOINT);
  assert.equal(calls[0].options.params.NumPerPage,30);
  assert.equal(calls[0].options.maxRedirects,0);
  assert.equal(calls[0].options.headers.Cookie,undefined);
  assert.equal(result.rows.length,2);
  assert.deepEqual(result.raw,fixture);
  await assert.rejects(fetchDarkRank(request,{httpClient:{get:async()=>{throw new Error('HTTP 403');}}}),/403/);
});
