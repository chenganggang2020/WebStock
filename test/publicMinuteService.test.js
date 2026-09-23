const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPublicMinuteService,
  normalizeEastmoneyTrends,
  normalizeTencentMinute
} = require('../services/publicMinuteService');

function tencentPayload(date = '20260814') {
  return {
    code: 0,
    data: {
      sz000001: {
        qt: {
          sz000001: [51, '平安银行', '000001', '11.73', '11.59', '11.55', '', '', '', '',
            '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            '20260826150000', '0.14', '1.21', '11.75', '11.52']
        },
        data: {
          date,
          data: [
            '0930 11.22 2852 3199944.00',
            '0931 11.21 19938 22344016.00'
          ]
        }
      }
    }
  };
}

test('public minute service prefers Tencent one-minute bars and derives interval volume', async () => {
  const calls = [];
  const service = createPublicMinuteService({
    now: function() { return new Date('2026-08-14T07:00:00.000Z').getTime(); },
    marketData: {
      get: async function(key, url) {
        calls.push({ key, url });
        return { data: tencentPayload() };
      }
    }
  });

  const result = await service.fetch('000001');

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /appstock\/app\/minute\/query/);
  assert.equal(result.meta.dataSource, 'tencent-1m');
  assert.equal(result.meta.sampling.intervalSeconds, 60);
  assert.equal(result.meta.sampling.intervalMinutes, 1);
  assert.equal(result.meta.marketState, 'latest-close');
  assert.equal(result.meta.stale, false);
  assert.equal(result.meta.derived, false);
  assert.equal(result.meta.exchangeGroundTruth, false);
  assert.equal(result.meta.previousClose, 11.59);
  assert.equal(result.meta.latestPrice, 11.73);
  assert.equal(result.meta.changePercent, 1.21);
  assert.equal(result.meta.openPrice, 11.55);
  assert.equal(result.meta.highPrice, 11.75);
  assert.equal(result.meta.lowPrice, 11.52);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    time: '2026-08-14 09:30:00',
    open: 11.22,
    price: 11.22,
    high: 11.22,
    low: 11.22,
    volume: 285200,
    amount: 3199944,
    averagePrice: 11.22
  });
  assert.equal(result.rows[1].volume, 1708600);
  assert.equal(result.rows[1].amount, 19144072);
});

test('latest public bars are stale only while the market is trading', async () => {
  const weekend = createPublicMinuteService({
    now: function() { return new Date('2026-08-15T02:00:00.000Z').getTime(); },
    marketData: { get: async function() { return { data: tencentPayload() }; } }
  });
  const liveSession = createPublicMinuteService({
    now: function() { return new Date('2026-08-17T02:00:00.000Z').getTime(); },
    marketData: { get: async function() { return { data: tencentPayload() }; } }
  });

  const weekendResult = await weekend.fetch('000001');
  const liveResult = await liveSession.fetch('000001');

  assert.equal(weekendResult.meta.marketState, 'latest-close');
  assert.equal(weekendResult.meta.stale, false);
  assert.equal(liveResult.meta.marketState, 'delayed');
  assert.equal(liveResult.meta.stale, true);
});

test('public minute service refuses five-minute fallback when one-minute providers fail', async () => {
  const calls = [];
  const service = createPublicMinuteService({
    now: function() { return new Date('2026-08-14T07:00:00.000Z').getTime(); },
    marketData: {
      get: async function(key) {
        calls.push(key);
        if (key.startsWith('minute-1m-')) throw Object.assign(new Error('one-minute failed'), { code: 'ECONNRESET' });
        return { data: [] };
      }
    }
  });

  await assert.rejects(service.fetch('002565'), function(error) {
    return error && error.code === 'PROVIDER_REQUEST_FAILED';
  });
  assert.deepEqual(calls, ['minute-1m-tencent:002565', 'minute-1m-eastmoney:002565']);
});

test('Tencent normalization filters after-hours rows and keeps cumulative averages', () => {
  const payload = tencentPayload();
  payload.data.sz000001.data.data.push('1506 11.11 833103 929941921.57');
  const result = normalizeTencentMinute(payload, '000001');

  assert.equal(result.tradingDate, '2026-08-14');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].averagePrice, 11.21);
});

test('Eastmoney normalization selects the latest trading day and rejects invalid rows', () => {
  const result = normalizeEastmoneyTrends({
    rc: 0,
    data: {
      preClose: 9.95,
      trends: [
        '2026-08-13 15:00,10.00,10.00,10.00,10.00,10,10000,10.00',
        '2026-08-14 09:30,10.00,0,10.00,9.99,20,20000,10.00',
        '2026-08-14 09:31,10.00,10.01,10.02,9.99,30,30000,10.01'
      ]
    }
  });

  assert.equal(result.tradingDate, '2026-08-14');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].time, '2026-08-14 09:31:00');
  assert.equal(result.previousClose, 9.95);
});
