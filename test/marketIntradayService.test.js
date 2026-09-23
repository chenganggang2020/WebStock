const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadSubject() {
  try {
    return require('../services/marketIntradayService');
  } catch (error) {
    assert.fail('marketIntradayService contract is not implemented: ' + error.message);
  }
}

function tencentPayload(symbol, prices, tradingDate) {
  return {
    data: {
      [symbol]: {
        data: {
          date: tradingDate || '20260828',
          data: prices.map(function(price, index) {
            const label = ['0930', '0931', '0932', '0933'][index];
            return label + ' ' + price + ' ' + ((index + 1) * 10) + ' ' + ((index + 1) * 1000);
          })
        },
        qt: {
          [symbol]: Array.from({ length: 35 }, function(_, index) {
            if (index === 3) return String(prices.at(-1));
            if (index === 4) return '100';
            if (index === 5) return String(prices[0]);
            if (index === 32) return String(prices.at(-1) - 100);
            if (index === 33) return String(Math.max.apply(null, prices));
            if (index === 34) return String(Math.min.apply(null, prices));
            return '';
          })
        }
      }
    }
  };
}

function tonghuashunLeadingPayload(options) {
  options = options || {};
  const id = options.id || '1A0001';
  const name = options.name || '上证指数';
  const previousClose = options.previousClose || '3986.30';
  return 'quotebridge_v6_time_hs_' + id + '_last(' + JSON.stringify({
    ['hs_' + id]: {
      name,
      pre: previousClose,
      date: '20260901',
      data: [
        '0930,3979.88,7479427800,3984.3069,538594100',
        '0931,3984.29,23781418000,3990.2863,1477610100',
        '0932,3986.37,24363822000,3995.0699,1492146800'
      ].join(';')
    }
  }) + ')';
}

test('Tonghuashun Shanghai leading minutes keep weighted white and unweighted yellow values separate', async () => {
  const { normalizeTonghuashunSseLeadingMinute, createMarketIntradayService } = loadSubject();
  const normalized = normalizeTonghuashunSseLeadingMinute(tonghuashunLeadingPayload());

  assert.equal(normalized.tradingDate, '2026-09-01');
  assert.equal(normalized.previousClose, 3986.3);
  assert.deepEqual(normalized.points.map(function(point) {
    return [point.label, point.price, point.equalWeightPrice];
  }), [
    ['09:30', 3979.88, 3984.3069],
    ['09:31', 3984.29, 3990.2863],
    ['09:32', 3986.37, 3995.0699]
  ]);

  const service = createMarketIntradayService({
    definitions: [{
      key: 'index:sse', kind: 'index', code: '000001', name: '上证指数', providerId: 'sh000001',
      capabilities: { intraday: true }
    }],
    marketData: { get: async function() { throw new Error('Tencent should not be needed'); } },
    leadingGet: async function(key, url) {
      assert.match(key, /index-leading/);
      assert.match(url, /hs_1A0001/);
      return { data: tonghuashunLeadingPayload() };
    },
    now: function() { return Date.parse('2026-09-01T08:30:00.000Z'); }
  });
  const result = await service.fetchIndexIntraday(['index:sse']);

  assert.equal(result.series[0].status, 'available');
  assert.equal(result.series[0].dataSource, 'tonghuashun-public-index-leading-minute');
  assert.equal(result.series[0].points[1].equalWeightPrice, 3990.2863);
  assert.equal(result.series[0].leadingIndicator.available, true);
});

test('every primary index with a verified Tonghuashun leading id receives a true yellow-white series', async () => {
  const { createMarketIntradayService } = loadSubject();
  const definitions = [
    ['index:sse', '000001', '上证指数', 'sh000001', '1A0001'],
    ['index:szse', '399001', '深证成指', 'sz399001', '399001'],
    ['index:chinext', '399006', '创业板指', 'sz399006', '399006'],
    ['index:star50', '000688', '科创50', 'sh000688', '1B0688'],
    ['index:csi300', '000300', '沪深300', 'sh000300', '1B0300'],
    ['index:csi500', '000905', '中证500', 'sh000905', '1B0905'],
    ['index:csi1000', '000852', '中证1000', 'sh000852', '1B0852'],
    ['index:sse50', '000016', '上证50', 'sh000016', '1B0016']
  ].map(function(row) {
    return { key: row[0], kind: 'index', code: row[1], name: row[2], providerId: row[3], expectedLeadingId: row[4], capabilities: { intraday: true } };
  });
  const requestedIds = [];
  const service = createMarketIntradayService({
    definitions,
    marketData: { get: async function() { throw new Error('fallback should not be needed'); } },
    leadingGet: async function(key, url) {
      const id = /\/hs_([^/]+)\/last\.js/.exec(url)[1];
      const definition = definitions.find(function(item) { return item.expectedLeadingId === id; });
      requestedIds.push(id);
      return { data: tonghuashunLeadingPayload({ id, name: definition.name }) };
    },
    now: function() { return Date.parse('2026-09-01T08:30:00.000Z'); }
  });

  const result = await service.fetchIndexIntraday(definitions.map(function(item) { return item.key; }));

  assert.deepEqual(requestedIds.sort(), definitions.map(function(item) { return item.expectedLeadingId; }).sort());
  assert.equal(result.series.length, 8);
  result.series.forEach(function(item) {
    assert.equal(item.status, 'available');
    assert.equal(item.points.length, 3);
    assert.equal(item.points.every(function(point) { return Number.isFinite(point.equalWeightPrice); }), true);
    assert.equal(item.leadingIndicator.available, true);
    assert.equal(item.leadingIndicator.meaning, '白线为加权指数，黄线为不加权领先指标');
  });
});

test('index intraday requests use explicit Shanghai symbol and never infer Ping An Bank', async () => {
  const { createMarketIntradayService } = loadSubject();
  const calls = [];
  const service = createMarketIntradayService({
    definitions: [{
      key: 'index:sse', code: '000001', name: '上证指数', providerId: 'sh000001',
      capabilities: { intraday: true }
    }],
    marketData: { get: async function(key, url) {
      calls.push(url);
      return { data: tencentPayload('sh000001', [101, 102, 101, 103]) };
    } },
    now: function() { return Date.parse('2026-08-29T04:00:00.000Z'); },
    minCorrelationSamples: 2
  });

  const result = await service.fetchIntraday(['index:sse']);
  assert.equal(result.series[0].status, 'available');
  assert.equal(result.series[0].points.length, 4);
  assert.equal(result.series[0].previousClose, 100);
  assert.ok(calls[0].includes('code=sh000001'));
  assert.ok(!calls[0].includes('code=sz000001'));
  assert.equal(result.series[0].marketState, 'latest-close');
});

test('Tencent minute normalization derives quote bounds from real points when qt is missing', () => {
  const { normalizeTencentInstrumentMinute } = loadSubject();
  const payload = tencentPayload('sh000001', [101, 103, 102, 104]);
  delete payload.data.sh000001.qt;

  const result = normalizeTencentInstrumentMinute(payload, {
    code: '000001', providerId: 'sh000001'
  });

  assert.equal(result.latestPrice, 104);
  assert.equal(result.openPrice, 101);
  assert.equal(result.highPrice, 104);
  assert.equal(result.lowPrice, 101);
  assert.equal(result.previousClose, null);
  assert.equal(result.changePct, null);
});

test('intraday comparison aligns selected instruments by minute and computes minute-return correlation', async () => {
  const { createMarketIntradayService } = loadSubject();
  const definitions = [
    { key: 'index:sse', code: '000001', name: '上证指数', providerId: 'sh000001', capabilities: { intraday: true } },
    { key: 'sector-index:bank', code: '399986', name: '中证银行', providerId: 'sz399986', capabilities: { intraday: true } }
  ];
  const service = createMarketIntradayService({
    definitions,
    marketData: { get: async function(key, url) {
      const symbol = url.includes('sz399986') ? 'sz399986' : 'sh000001';
      return { data: tencentPayload(symbol, symbol === 'sz399986' ? [200, 202, 201, 204] : [100, 101, 100.5, 102]) };
    } },
    now: function() { return Date.parse('2026-08-29T04:00:00.000Z'); },
    minCorrelationSamples: 2
  });

  const result = await service.fetchIntraday(['sector-index:bank', 'index:sse']);
  assert.deepEqual(result.comparison.series.map(item => item.key), ['sector-index:bank', 'index:sse']);
  assert.deepEqual(result.comparison.labels, ['09:30', '09:31', '09:32', '09:33']);
  assert.deepEqual(result.correlation.keys, ['sector-index:bank', 'index:sse']);
  assert.equal(result.correlation.sampleCounts[0][1], 3);
  assert.equal(Number.isFinite(result.correlation.values[0][1]), true);
});

test('intraday comparison reports first-point normalization when a fallback source has no previous close', () => {
  const { normalizeIntradayComparison } = loadSubject();
  const result = normalizeIntradayComparison([
    {
      key: 'index:sse', name: '上证指数', status: 'available', previousClose: 100,
      points: [{ label: '09:30', price: 101 }, { label: '09:35', price: 102 }]
    },
    {
      key: 'sector-index:bank', name: '中证银行', status: 'available', previousClose: null,
      points: [{ label: '09:30', price: 200 }, { label: '09:35', price: 202 }]
    }
  ]);

  assert.equal(result.basis, 'first-shared-point-100');
  assert.deepEqual(result.series[1].values, [100, 101]);
});

test('daily-only catalog selections remain visible as unavailable in intraday mode', async () => {
  const { createMarketIntradayService } = loadSubject();
  const service = createMarketIntradayService({
    definitions: [
      { key: 'index:sse', code: '000001', name: '上证指数', providerId: 'sh000001', capabilities: { intraday: true } }
    ],
    marketData: { get: async function() {
      return { data: tencentPayload('sh000001', [100, 101, 102, 103]) };
    } },
    now: function() { return Date.parse('2026-08-29T04:00:00.000Z'); },
    minCorrelationSamples: 2
  });

  const result = await service.fetchIntraday(
    ['index:sse', 'eastmoney-industry:BK0475'],
    { minimum: 2, keepUnknown: true }
  );

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.requestedKeys, ['index:sse', 'eastmoney-industry:BK0475']);
  assert.equal(result.series[1].status, 'unavailable');
  assert.match(result.series[1].reason, /暂无可验证的分时数据/);
});

test('intraday comparison never aligns identical clock labels across different trading dates', async () => {
  const { createMarketIntradayService } = loadSubject();
  const definitions = [
    { key: 'index:sse', kind: 'index', code: '000001', name: '上证指数', providerId: 'sh000001', capabilities: { intraday: true } },
    { key: 'index:star50', kind: 'index', code: '000688', name: '科创50', providerId: 'sh000688', capabilities: { intraday: true } }
  ];
  const service = createMarketIntradayService({
    definitions,
    marketData: { get: async function(key, url) {
      if (url.includes('sh000688')) {
        return { data: tencentPayload('sh000688', [200, 202, 201, 204], '20260828') };
      }
      return { data: tencentPayload('sh000001', [100, 101, 100.5, 102], '20260827') };
    } },
    now: function() { return Date.parse('2026-08-29T04:00:00.000Z'); },
    minCorrelationSamples: 2
  });

  const result = await service.fetchIntraday(['index:sse', 'index:star50']);

  assert.equal(result.status, 'partial');
  assert.equal(result.series.find(item => item.key === 'index:sse').status, 'unavailable');
  assert.match(result.series.find(item => item.key === 'index:sse').reason, /交易日不一致/);
  assert.deepEqual(result.comparison.series.map(item => item.key), ['index:star50']);
  assert.deepEqual(result.correlation.keys, ['index:star50']);
  assert.equal(result.correlation.keys.includes('index:sse'), false);
});

test('index intraday endpoint rejects sector-index keys instead of mixing catalogs', async () => {
  const { createMarketIntradayService } = loadSubject();
  let calls = 0;
  const service = createMarketIntradayService({
    definitions: [
      { key: 'index:sse', kind: 'index', code: '000001', name: '上证指数', providerId: 'sh000001', capabilities: { intraday: true } },
      { key: 'sector-index:bank', kind: 'sector-index', code: '399986', name: '中证银行', providerId: 'sz399986', capabilities: { intraday: true } }
    ],
    marketData: { get: async function() {
      calls += 1;
      return { data: tencentPayload('sh000001', [100, 101, 102, 103]) };
    } },
    now: function() { return Date.parse('2026-08-29T04:00:00.000Z'); }
  });

  await assert.rejects(
    service.fetchIndexIntraday(['index:sse', 'sector-index:bank']),
    /indexDefinitions|固定指数/
  );
  assert.equal(calls, 0);
});

test('intraday correlation default accepts 20 common returns but rejects 19', () => {
  const { buildIntradayCorrelation } = loadSubject();
  function series(key, count, multiplier) {
    return {
      key,
      status: 'available',
      tradingDate: '2026-08-28',
      points: Array.from({ length: count }, function(_, index) {
        const minute = 30 + index;
        return {
          time: '2026-08-28 09:' + String(minute).padStart(2, '0') + ':00',
          label: '09:' + String(minute).padStart(2, '0'),
          price: 100 * multiplier + index * multiplier + (index % 2 ? 0.25 : 0)
        };
      })
    };
  }

  const enough = buildIntradayCorrelation([series('left', 21, 1), series('right', 21, 2)]);
  const insufficient = buildIntradayCorrelation([series('left', 20, 1), series('right', 20, 2)]);

  assert.equal(enough.minSamples, 20);
  assert.equal(enough.sampleCounts[0][1], 20);
  assert.equal(Number.isFinite(enough.values[0][1]), true);
  assert.equal(insufficient.sampleCounts[0][1], 19);
  assert.equal(insufficient.values[0][1], null);
});

test('closed-market intraday cache remains valid for ten minutes', async () => {
  const { createMarketIntradayService } = loadSubject();
  let nowValue = Date.parse('2026-08-29T04:00:00.000Z');
  let calls = 0;
  const service = createMarketIntradayService({
    definitions: [
      { key: 'index:sse', kind: 'index', code: '000001', name: '上证指数', providerId: 'sh000001', capabilities: { intraday: true } }
    ],
    marketData: { get: async function() {
      calls += 1;
      return { data: tencentPayload('sh000001', [100, 101, 102, 103]) };
    } },
    now: function() { return nowValue; }
  });

  await service.fetchIndexIntraday(['index:sse']);
  nowValue += 9 * 60 * 1000;
  await service.fetchIndexIntraday(['index:sse']);
  assert.equal(calls, 1);

  nowValue += 61 * 1000;
  await service.fetchIndexIntraday(['index:sse']);
  assert.equal(calls, 2);
});

test('pre-open cache is refreshed immediately after the trading session begins', async () => {
  const { createMarketIntradayService } = loadSubject();
  let nowValue = Date.parse('2026-08-31T01:25:00.000Z');
  let calls = 0;
  const service = createMarketIntradayService({
    definitions: [
      { key: 'index:sse', kind: 'index', code: '000001', name: '上证指数', providerId: 'sh000001', capabilities: { intraday: true } }
    ],
    marketData: { get: async function() {
      calls += 1;
      return { data: tencentPayload('sh000001', [100, 101, 102, 103], '20260828') };
    } },
    now: function() { return nowValue; }
  });

  await service.fetchIndexIntraday(['index:sse']);
  nowValue = Date.parse('2026-08-31T01:30:01.000Z');
  await service.fetchIndexIntraday(['index:sse']);

  assert.equal(calls, 2);
});

test('stale-cache fallback preserves source time and marks the response partial and stale', async () => {
  const { createMarketIntradayService } = loadSubject();
  let nowValue = Date.parse('2026-08-29T04:00:00.000Z');
  let providerCalls = 0;
  const service = createMarketIntradayService({
    definitions: [
      { key: 'index:sse', kind: 'index', code: '000001', name: '上证指数', providerId: 'sh000001', capabilities: { intraday: true } }
    ],
    marketData: { get: async function() {
      providerCalls += 1;
      if (providerCalls === 1) {
        return { data: tencentPayload('sh000001', [100, 101, 102, 103]) };
      }
      throw new Error('provider offline');
    } },
    now: function() { return nowValue; }
  });

  const fresh = await service.fetchIndexIntraday(['index:sse']);
  const originalFetchedAt = fresh.series[0].fetchedAt;
  nowValue += 11 * 60 * 1000;
  const fallback = await service.fetchIndexIntraday(['index:sse']);

  assert.equal(fallback.series[0].fetchedAt, originalFetchedAt);
  assert.equal(fallback.series[0].attemptedAt, new Date(nowValue).toISOString());
  assert.equal(fallback.series[0].servedAt, new Date(nowValue).toISOString());
  assert.equal(fallback.series[0].stale, true);
  assert.equal(fallback.status, 'partial');
  assert.equal(fallback.stale, true);
  assert.equal(fallback.fetchedAt, originalFetchedAt);
  assert.equal(fallback.servedAt, new Date(nowValue).toISOString());
});

test('market router exposes dedicated intraday endpoints instead of the stock minute route', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/market.js'), 'utf8');
  assert.match(source, /router\.get\(['"]\/market\/index-intraday['"]/);
  assert.match(source, /router\.get\(['"]\/market\/comparison-intraday['"]/);
  assert.match(source, /\/market\/index-intraday[\s\S]*INDEX_INTRADAY_KEY_INVALID[\s\S]*\? 400/);
});
