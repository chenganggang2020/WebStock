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

test('public minute service falls back to the existing Sina five-minute source', async () => {
  const calls = [];
  const service = createPublicMinuteService({
    now: function() { return new Date('2026-08-14T07:00:00.000Z').getTime(); },
    marketData: {
      get: async function(key) {
        calls.push(key);
        if (key.startsWith('minute-1m-')) throw Object.assign(new Error('one-minute failed'), { code: 'ECONNRESET' });
        return {
          data: [
            { day: '2026-08-14 09:35:00', close: '10.00', volume: '100', amount: '1000' },
            { day: '2026-08-14 09:40:00', close: '10.10', volume: '120', amount: '1212' }
          ]
        };
      }
    }
  });

  const result = await service.fetch('002565');

  assert.deepEqual(calls, ['minute-1m-tencent:002565', 'minute-1m-eastmoney:002565', 'minute-5m:002565']);
  assert.equal(result.meta.dataSource, 'sina-5m');
  assert.equal(result.meta.fallbackFrom, 'public-1m');
  assert.equal(result.meta.reason, 'one-minute-providers-unavailable');
  assert.equal(result.meta.sampling.intervalMinutes, 5);
  assert.equal(result.rows.length, 2);
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
});
