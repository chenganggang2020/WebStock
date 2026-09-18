const test = require('node:test');
const assert = require('node:assert/strict');

function loadSubject() {
  try {
    return require('../services/marketComparisonService');
  } catch (error) {
    assert.fail('marketComparisonService contract is not implemented: ' + error.message);
  }
}

function sinaRows(count, start) {
  return Array.from({ length: count }, function(_, index) {
    const date = new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10);
    const close = start + index;
    return {
      day: date,
      open: String(close - 0.2),
      close: String(close),
      high: String(close + 0.4),
      low: String(close - 0.5),
      volume: String(1000 + index)
    };
  });
}

function eastmoneyRows(count, start) {
  return Array.from({ length: count }, function(_, index) {
    const date = new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10);
    const close = start + index;
    return [date, close - 0.2, close, close + 0.4, close - 0.5, 1000 + index, 5000 + index].join(',');
  });
}

test('comparison catalog exposes namespaced indices and the verified bank sector index', async () => {
  const { createMarketComparisonService } = loadSubject();
  const service = createMarketComparisonService({
    marketData: { get: async function() { throw new Error('planned board catalog outage'); } }
  });

  const catalog = await service.fetchCatalog();
  const byKey = new Map(catalog.items.map(item => [item.key, item]));
  assert.equal(byKey.get('index:sse').providerId, 'sh000001');
  assert.equal(byKey.get('index:sse').providerLabel, '新浪公开指数行情');
  assert.equal(byKey.get('index:sse').kind, 'index');
  assert.equal(byKey.get('sector-index:bank').name, '中证银行');
  assert.equal(byKey.get('sector-index:bank').providerId, 'sz399986');
  assert.equal(byKey.get('sector-index:bank').kind, 'sector-index');
  assert.equal(catalog.status, 'partial');
});

test('selected comparison keys are unique, ordered and limited to two through eight', () => {
  const { normalizeSelectedKeys } = loadSubject();
  assert.deepEqual(normalizeSelectedKeys('index:sse,sector-index:bank,index:sse'), [
    'index:sse', 'sector-index:bank'
  ]);
  assert.throws(() => normalizeSelectedKeys('index:sse'), /至少选择 2/);
  assert.throws(() => normalizeSelectedKeys(Array.from({ length: 9 }, (_, index) => 'index:k' + index)), /最多选择 8/);
});

test('dynamic board keys only accept canonical four-digit Eastmoney BK identities', () => {
  const { parseEastmoneyBoardKey } = loadSubject();
  assert.equal(parseEastmoneyBoardKey('eastmoney-industry:BK0475').providerId, '90.BK0475');
  assert.equal(parseEastmoneyBoardKey('eastmoney-style:BK0475'), null);
  assert.equal(parseEastmoneyBoardKey('eastmoney-industry:BK04750'), null);
  assert.equal(parseEastmoneyBoardKey('eastmoney-industry:../../BK0475'), null);
});

test('daily comparison uses explicit index symbols and preserves requested order', async () => {
  const { createMarketComparisonService } = loadSubject();
  const calls = [];
  const service = createMarketComparisonService({
    marketData: {
      get: async function(key, url) {
        calls.push(url);
        if (url.includes('CN_MarketData.getKLineData')) {
          return { data: sinaRows(21, url.includes('sz399986') ? 200 : 100) };
        }
        throw new Error('planned dynamic catalog outage');
      }
    }
  });

  const result = await service.fetchHistory({
    window: 20,
    keys: ['sector-index:bank', 'index:sse']
  });

  assert.deepEqual(result.series.map(item => item.key), ['sector-index:bank', 'index:sse']);
  assert.equal(result.status, 'available');
  assert.equal(result.comparison.dates.length, 20);
  assert.deepEqual(result.correlation.keys, ['sector-index:bank', 'index:sse']);
  assert.ok(calls.some(url => url.includes('symbol=sz399986')));
  assert.ok(calls.some(url => url.includes('symbol=sh000001')));
  assert.ok(calls.every(url => !url.includes('symbol=sz000001')));
});

test('Eastmoney board points keep real OHLC values and reject malformed rows', () => {
  const { normalizeEastmoneyBoardPoints } = loadSubject();
  const points = normalizeEastmoneyBoardPoints({ data: { klines: [
    '2026-08-27,10,11,12,9,1000,5000,0,1.0,0,0',
    'malformed,10,11,12,9,1000,5000',
    '2026-08-28,11,12,13,10,1200,6000,0,1.0,0,0'
  ] } });
  assert.deepEqual(points.map(item => [item.date, item.open, item.close, item.low, item.high]), [
    ['2026-08-27', 10, 11, 9, 12],
    ['2026-08-28', 11, 12, 10, 13]
  ]);
});

test('comparison catalog includes Eastmoney region boards when that verified directory is available', async () => {
  const { createMarketComparisonService } = loadSubject();
  const service = createMarketComparisonService({
    catalogGet: async function(url) {
      const filter = new URL(url).searchParams.get('fs');
      const code = filter.includes('t:1') ? 'BK0101' : (filter.includes('t:3') ? 'BK0201' : 'BK0301');
      const name = filter.includes('t:1') ? '上海板块' : (filter.includes('t:3') ? 'AI概念' : '电子行业');
      return { data: { data: { diff: [{ f12: code, f14: name }] } } };
    }
  });

  const catalog = await service.fetchCatalog();

  assert.equal(catalog.status, 'available');
  assert.equal(catalog.items.some(item => item.key === 'eastmoney-region:BK0101' && item.capabilities.daily), true);
});

test('dynamic Eastmoney industry concept and region keys resolve directly to their BK daily history', async () => {
  const { createMarketComparisonService } = loadSubject();
  const requestUrls = [];
  const historyUrls = [];
  const service = createMarketComparisonService({
    marketData: {
      get: async function(key, url) {
        requestUrls.push(url);
        if (url.includes('/api/qt/stock/kline/get')) {
          historyUrls.push(url);
          return { data: { data: { klines: eastmoneyRows(21, 100 + historyUrls.length * 10) } } };
        }
        throw new Error('planned comparison catalog outage');
      }
    }
  });

  const result = await service.fetchHistory({
    window: 20,
    keys: [
      'eastmoney-industry:BK0475',
      'eastmoney-concept:BK0816',
      'eastmoney-region:BK0101'
    ]
  });

  assert.equal(result.status, 'available');
  assert.deepEqual(result.series.map(item => [item.key, item.providerId, item.capabilities.daily]), [
    ['eastmoney-industry:BK0475', '90.BK0475', true],
    ['eastmoney-concept:BK0816', '90.BK0816', true],
    ['eastmoney-region:BK0101', '90.BK0101', true]
  ]);
  assert.equal(historyUrls.length, 3);
  assert.equal(historyUrls.every(url => new URL(url).searchParams.get('secid').startsWith('90.BK')), true);
  assert.equal(requestUrls.some(url => url.includes('/api/qt/clist/get')), false);
});

test('Sina industry keys use an explicitly labelled current-constituent composite instead of inventing a provider symbol', async () => {
  const { createMarketComparisonService } = loadSubject();
  const urls = [];
  const boardDefinition = {
    key: 'sina-industry:sw2_270100', code: 'sw2_270100', providerId: 'sw2_270100',
    name: '半导体', kind: 'industry', provider: 'sina-public-industry',
    capabilities: { catalog: true, snapshot: true, daily: false, intraday: false }
  };
  const service = createMarketComparisonService({
    boardCatalogService: {
      fetchCatalog: async function() {
        return { status: 'partial', items: [boardDefinition], warnings: ['public board index unavailable'] };
      }
    },
    boardCompositeHistoryService: {
      isAvailable: function() { return true; },
      fetchHistory: async function(definition, rawDays) {
        assert.equal(definition.key, boardDefinition.key);
        assert.equal(rawDays, 20);
        return {
          points: sinaRows(21, 100).map(function(row) {
            return { date: row.day, close: Number(row.close), open: Number(row.open), high: Number(row.high), low: Number(row.low), volume: Number(row.volume) };
          }),
          source: { id: 'local-current-constituent-equal-weight', label: '当前完整成分等权估算' },
          warnings: ['当前成分口径存在幸存者偏差']
        };
      }
    },
    marketData: {
      get: async function(key, url) {
        urls.push(url);
        if (url.includes('symbol=sh000001')) return { data: sinaRows(21, 100) };
        throw new Error('planned catalog outage');
      }
    }
  });

  const result = await service.fetchHistory({
    window: 20,
    keys: ['index:sse', boardDefinition.key]
  });

  assert.equal(result.status, 'available');
  assert.equal(result.series[1].status, 'available');
  assert.equal(result.series[1].capabilities.daily, true);
  assert.equal(result.series[1].historyMode, 'current-constituent-equal-weight-estimate');
  assert.equal(urls.some(url => url.includes('symbol=sw2_270100')), false);
  assert.match(result.warnings.join(' '), /幸存者偏差/);
});
