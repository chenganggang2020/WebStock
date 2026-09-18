const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const {
  createLocalThirtySecondBarService,
  createLocalFiveSecondBarService
} = require('../services/localThirtySecondBarService');
const chartModel = require('../js/modules/realtimeChartModel');

// These tests use only an in-memory database and an isolated renderer context.
// They must never import the application database, server, or live collectors.
function localService(t, intervalSeconds, now) {
  const database = new Database(':memory:');
  t.after(function() { database.close(); });
  const create = intervalSeconds === 5 ? createLocalFiveSecondBarService : createLocalThirtySecondBarService;
  return create({ db: database, now: function() { return Date.parse(now); } });
}

function quote(providerObservedAt, volume, amount) {
  return { code: '000001', price: 10, volume, amount, providerObservedAt };
}

test('future provider timestamps cannot poison the monotonic collection watermark', t => {
 const service=localService(t,5,'2026-09-18T02:00:10.000Z');
 assert.equal(service.recordQuotes([quote('2026-09-18 10:05:00',100,1000)]).recorded,0);
 assert.equal(service.recordQuotes([quote('2026-09-18 10:00:05',100,1000)]).recorded,1);
 assert.equal(service.list('000001').meta.stale,false);
});

function rendererClock() {
  const context = {
    window: {
      State: {},
      RealtimeChartModel: chartModel,
      WebStockTime: {
        todayDate: function() { return '2026-09-18'; },
        currentMinutes: function() { return 9 * 60 + 30; }
      },
      addEventListener: function() {}
    },
    document: {
      getElementById: function() { return null; },
      addEventListener: function() {}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/realtimeChart.js'), 'utf8'), context);
  return context;
}

for (const intervalSeconds of [5, 30]) {
  const label = intervalSeconds + 's';
  const observedClock = intervalSeconds === 5 ? '09:30:05' : '09:30:30';

  test(label + ' renderer retains an already observed sub-minute point in the current minute', function(t) {
    const service = localService(t, intervalSeconds, '2026-09-18T01:30:40.000Z');
    service.recordQuotes([quote('2026-09-18 ' + observedClock, 1000, 10000)]);
    const result = service.list('000001');
    const context = rendererClock();
    const axis = chartModel.buildCompressedTradingAxis(result.rows, { intervalSeconds });
    const series = chartModel.buildMinuteSeries(axis.times, result.rows, {
      cutoffMinutes: context.realtimeCutoffMinutes(result.rows)
    });

    assert.equal(result.rows.length, 1, 'the observed point is present in storage');
    assert.equal(series.observedSamples, 1, 'minute-only clipping must not hide a real sub-minute sample');
    assert.ok(series.prices.includes(10));
  });

  test(label + ' renderer retains the final sub-minute point when reading an older session', function(t) {
    const service = localService(t, intervalSeconds, '2026-09-18T01:30:40.000Z');
    service.recordQuotes([quote('2026-09-17 ' + observedClock, 1000, 10000)]);
    const result = service.list('000001', { tradingDate: '2026-09-17' });
    const context = rendererClock();
    const axis = chartModel.buildCompressedTradingAxis(result.rows, { intervalSeconds });
    const series = chartModel.buildMinuteSeries(axis.times, result.rows, {
      cutoffMinutes: context.realtimeCutoffMinutes(result.rows)
    });

    assert.equal(series.observedSamples, 1, 'an older session must not lose its last non-zero-second point');
  });

  test(label + ' turnover does not assign a ten-minute observation gap to a single bar', function(t) {
    const service = localService(t, intervalSeconds, '2026-09-18T02:00:00.000Z');
    service.recordQuotes([
      quote('2026-09-18 09:30:01', 1000, 10000),
      quote('2026-09-18 09:40:01', 5000, 50000)
    ]);
    const rows = service.list('000001').rows;

    assert.equal(rows.length, 2, 'missing observation slots are not filled');
    assert.equal(rows[1].volume, null, '4000 shares over ten minutes are not one ' + label + ' bar volume');
    assert.equal(rows[1].amount, null, 'gap turnover cannot be attributed to the final bar');
  });

  test(label + ' latest read marks a previous-day snapshot stale during the next trading session', function(t) {
    const service = localService(t, intervalSeconds, '2026-09-18T02:00:00.000Z');
    service.recordQuotes([quote('2026-09-17 15:00:00', 1000, 10000)]);
    const result = service.list('000001');

    assert.equal(result.tradingDate, '2026-09-17');
    assert.equal(result.meta.stale, true, 'a fresh read timestamp does not make yesterday\'s sample current');
  });

  test(label + ' latest read marks a stopped same-day sampler stale', function(t) {
    const service = localService(t, intervalSeconds, '2026-09-18T02:00:00.000Z');
    service.recordQuotes([quote('2026-09-18 09:30:00', 1000, 10000)]);
    const result = service.list('000001');

    assert.equal(result.meta.providerObservedAt, '2026-09-18 09:30:00');
    assert.equal(result.meta.stale, true, 'a sampler stopped for thirty trading minutes is not fresh');
  });

  test(label + ' control: no recording stays unavailable and a first quote has no invented turnover', function(t) {
    const service = localService(t, intervalSeconds, '2026-09-18T02:00:00.000Z');
    const empty = service.list('000001', { tradingDate: '2026-09-18' });
    assert.equal(empty.rows.length, 0);
    assert.equal(empty.meta.reason, 'not-yet-collected');

    service.recordQuotes([quote('2026-09-18 09:30:01', 1000, 10000)]);
    const rows = service.list('000001').rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].volume, null);
    assert.equal(rows[0].amount, null);
    assert.equal(service.recordQuotes([quote('2026-09-18 09:30:01', 1000, 10000)]).recorded, 0);
  });

  test(label + ' latest-close and lunch snapshots do not falsely imply a stopped collector', function(t) {
    const lunch = localService(t, intervalSeconds, '2026-09-18T04:00:00Z');
    lunch.recordQuotes([quote('2026-09-18 11:30:00', 1000, 10000)]);
    assert.equal(lunch.list('000001').meta.stale, false);
    const closed = localService(t, intervalSeconds, '2026-09-19T04:00:00Z');
    closed.recordQuotes([quote('2026-09-18 15:00:00', 1000, 10000)]);
    assert.equal(closed.list('000001').meta.stale, false);
    assert.equal(closed.list('000001').meta.marketState, 'latest-close');
  });
}

test('renderer labels missing and old local observations without calling them current', function() {
  const context = rendererClock();
  assert.match(context.realtimeSourceLabel({dataSource: 'local-public-quote-5s', stale: true}), /旧|延迟|停采/);
  assert.match(context.realtimeSourceLabel({dataSource: 'local-30s-unavailable', reason: 'not-yet-collected'}), /未采集/);
});
