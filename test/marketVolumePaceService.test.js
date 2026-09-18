const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeEastmoneyMinuteDays,
  normalizeSinaVolumeDays,
  buildVolumePace,
  createMarketVolumePaceService
} = require('../services/marketVolumePaceService');

function trend(date, label, amount) {
  return date + ' ' + label + ',10,10,10,10,100,' + amount + ',10';
}

function rows(date, amounts) {
  return amounts.map(function(amount, index) {
    const minute = 9 * 60 + 30 + index;
    const label = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    return { date, label, amount };
  });
}

test('Eastmoney minute normalization keeps valid trading minutes from multiple dates', () => {
  const normalized = normalizeEastmoneyMinuteDays({ data: { trends: [
    trend('2026-08-28', '09:30', 100),
    trend('2026-08-28', '12:15', 999),
    trend('2026-08-28', '09:30', 120),
    trend('2026-08-31', '13:00', 200),
    trend('2026-08-31', '13:01', -1),
    'bad-row'
  ] } });

  assert.deepEqual(normalized, [
    { date: '2026-08-28', label: '09:30', amount: 120 },
    { date: '2026-08-31', label: '13:00', amount: 200 }
  ]);
});

test('missing and nonnumeric amount or volume fields do not become zero-coverage observations', () => {
  for (const amount of [null, undefined, '', '  ', false, true]) {
    const input = rows('2026-08-28', Array(10).fill(amount)).concat(rows('2026-08-31', Array(10).fill(amount)));
    const result = buildVolumePace(input, input);
    assert.equal(result.status, 'unavailable', String(amount));
    assert.equal(result.metrics.todayCumulativeAmount, null, String(amount));
    assert.equal(normalizeSinaVolumeDays([{ day: '2026-08-31 09:35:00', close: 10, volume: amount }]).length, 0);
  }
  assert.equal(normalizeEastmoneyMinuteDays({ data: { trends: [trend('2026-08-31', '09:30', '')] } }).length, 0);
  const zeros = rows('2026-08-28', Array(10).fill(0)).concat(rows('2026-08-31', Array(10).fill('0')));
  const result = buildVolumePace(zeros, zeros);
  assert.equal(result.status, 'available');
  assert.equal(result.metrics.todayCumulativeAmount, 0);
  assert.equal(result.coverage.alignedCoveragePct, 100);
});

test('volume pace compares cumulative and rolling five-minute amount at the same trading slots', () => {
  const previous = rows('2026-08-28', Array(10).fill(100));
  const current = rows('2026-08-31', Array(10).fill(110));
  const result = buildVolumePace(previous.concat(current), previous.concat(current));

  assert.equal(result.status, 'available');
  assert.equal(result.tradingDate, '2026-08-31');
  assert.equal(result.comparisonDate, '2026-08-28');
  assert.equal(result.asOf, '09:39');
  assert.equal(result.metrics.cumulativeYoYPct, 10);
  assert.equal(result.metrics.rolling5YoYPct, 10);
  assert.equal(result.metrics.rolling5SequentialPct, 0);
  assert.equal(result.metrics.todayCumulativeAmount, 2200);
  assert.equal(result.metrics.previousCumulativeAmount, 2000);
  assert.equal(result.metrics.todayRolling5Amount, 1100);
  assert.equal(result.metrics.previousRolling5Amount, 1000);
  assert.equal(result.metrics.priorRolling5Amount, 1100);
  assert.equal(result.metrics.cumulativeState, 'expanding');
  assert.equal(result.metrics.shortTermState, 'flat');
  assert.equal(result.metrics.divergence, 'none');
});

test('intraday coverage compares only slots available up to the current as-of time', () => {
  const previous = rows('2026-08-28', Array(30).fill(100));
  const current = rows('2026-08-31', Array(10).fill(120));
  const result = buildVolumePace(previous.concat(current), previous.concat(current));

  assert.equal(result.status, 'available');
  assert.equal(result.asOf, '09:39');
  assert.equal(result.coverage.alignedPoints, 10);
  assert.equal(result.coverage.alignedCoveragePct, 100);
  assert.equal(result.quality.usable, true);
  assert.equal(result.metrics.cumulativeState, 'expanding');
});

test('coverage counts expected trading slots even when both markets and dates share the same gaps', () => {
  const labels = ['09:30', '09:31', '09:32', '09:33', '09:34', '14:55', '14:56', '14:57', '14:58', '14:59'];
  const input = ['2026-08-28', '2026-08-31'].flatMap(function(date) {
    return labels.map(function(label) { return { date, label, amount: 100 }; });
  });
  const result = buildVolumePace(input, input);

  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.alignedPoints, 10);
  assert.equal(result.coverage.expectedAlignedPoints, 241);
  assert.equal(result.coverage.alignedCoveragePct, 4.15);
  assert.equal(result.quality.usable, false);
  assert.equal(result.metrics.cumulativeState, 'unavailable');
  assert.match(result.reason, /覆盖/);
});

test('expected one-minute coverage excludes the lunch break', () => {
  const morning = rows('2026-08-28', Array(121).fill(100)).map(function(row) { return row.label; });
  const labels = morning.concat(['13:00', '13:01', '13:02', '13:03', '13:04']);
  const input = ['2026-08-28', '2026-08-31'].flatMap(function(date) {
    return labels.map(function(label) { return { date, label, amount: 100 }; });
  });
  const result = buildVolumePace(input, input);

  assert.equal(result.status, 'available');
  assert.equal(result.coverage.expectedAlignedPoints, 126);
  assert.equal(result.coverage.alignedCoveragePct, 100);
});

test('five-minute closing-label coverage does not require synthetic opening bars', () => {
  const labels = Array.from({ length: 24 }, function(_, index) {
    const minute = 575 + index * 5;
    return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
  }).concat(['13:05', '13:10']);
  const input = ['2026-08-28', '2026-08-31'].flatMap(function(date) {
    return labels.map(function(label) { return { date, label, amount: 100 }; });
  });
  const result = buildVolumePace(input, input, { intervalSeconds: 300, measure: 'volume' });

  assert.equal(result.status, 'available');
  assert.equal(result.coverage.expectedAlignedPoints, 26);
  assert.equal(result.coverage.alignedCoveragePct, 100);
  assert.equal(result.metrics.todayRolling5Value, 200);
  assert.equal(result.metrics.todayCumulativeAmount, null);
});

test('five-minute coverage detects jointly missing five-minute bars', () => {
  const input = ['2026-08-28', '2026-08-31'].flatMap(function(date) {
    return ['09:35', '09:40', '14:55', '15:00'].map(function(label) { return { date, label, amount: 100 }; });
  });
  const result = buildVolumePace(input, input, { intervalSeconds: 300, measure: 'volume' });

  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.expectedAlignedPoints, 48);
  assert.equal(result.coverage.alignedCoveragePct, 8.33);
});

test('service excludes future minute slots and future dates before choosing its comparison days', async () => {
  const input = rows('2026-08-28', Array(11).fill(100))
    .concat(rows('2026-08-31', Array(11).fill(120)), rows('2026-09-01', Array(11).fill(999)));
  const service = createMarketVolumePaceService({
    now: function() { return Date.parse('2026-08-31T09:39:30+08:00'); },
    marketData: { async get() { return { data: { data: { trends: input.map(function(row) {
      return trend(row.date, row.label, row.amount);
    }) } } }; } }
  });
  const result = await service.fetch({ refresh: true });

  assert.equal(result.tradingDate, '2026-08-31');
  assert.equal(result.comparisonDate, '2026-08-28');
  assert.equal(result.asOf, '09:39');
  assert.equal(result.coverage.alignedCoveragePct, 100);
  assert.equal(result.metrics.todayCumulativeAmount, 2400);
});

test('rolling windows restart after lunch instead of treating the break as adjacent minutes', () => {
  const labels = ['11:28', '11:29', '11:30', '13:00', '13:01', '13:02', '13:03', '13:04'];
  const previous = labels.map(function(label) { return { date: '2026-08-28', label, amount: 100 }; });
  const current = labels.map(function(label) { return { date: '2026-08-31', label, amount: 120 }; });
  const result = buildVolumePace(previous.concat(current), previous.concat(current));
  const at1301 = result.series.find(function(point) { return point.label === '13:01'; });
  const at1304 = result.series.find(function(point) { return point.label === '13:04'; });

  assert.equal(at1301.rolling5YoYPct, null);
  assert.equal(at1304.rolling5YoYPct, 20);
});

test('five-minute sequential pace waits for the second complete afternoon window', () => {
  const labels = ['11:25', '11:30', '13:00', '13:05'];
  const previous = labels.map(function(label) { return { date: '2026-08-28', label, amount: 100 }; });
  const currentAmounts = [100, 100, 80, 120];
  const current = labels.map(function(label, index) {
    return { date: '2026-08-31', label, amount: currentAmounts[index] };
  });
  const result = buildVolumePace(previous.concat(current), previous.concat(current), { intervalSeconds: 300 });
  const at1300 = result.series.find(function(point) { return point.label === '13:00'; });
  const at1305 = result.series.find(function(point) { return point.label === '13:05'; });

  assert.equal(at1300.rolling5SequentialPct, null);
  assert.equal(at1305.rolling5SequentialPct, 50);
});

test('sequential volume pace cannot skip a gap between two individually complete windows', () => {
  for (const [intervalSeconds, labels] of [
    [60, ['09:30', '09:31', '09:32', '09:33', '09:34', '09:40', '09:41', '09:42', '09:43', '09:44']],
    [300, ['09:35', '09:45']]
  ]) {
    const input = ['2026-08-28', '2026-08-31'].flatMap(date => labels.map(label => ({ date, label, amount: 100 })));
    const result = buildVolumePace(input, input, { intervalSeconds });
    assert.equal(result.metrics.priorRolling5Value, null, String(intervalSeconds));
    assert.equal(result.metrics.rolling5SequentialPct, null, String(intervalSeconds));
    assert.equal(result.series[result.series.length - 1].rolling5SequentialPct, null, String(intervalSeconds));
  }
});

test('a one-slot spike does not switch the short-term state', () => {
  const previous = rows('2026-08-28', Array(10).fill(100));
  const current = rows('2026-08-31', Array(9).fill(100).concat([200]));
  const result = buildVolumePace(previous.concat(current), previous.concat(current));

  assert.equal(result.metrics.rolling5YoYPct, 20);
  assert.equal(result.metrics.shortTermState, 'flat');
});

test('an afternoon warmup cannot reuse the morning short-term acceleration signal', () => {
  const previous = rows('2026-08-28', Array(121).fill(100)).concat([{ date: '2026-08-28', label: '13:00', amount: 100 }]);
  const current = rows('2026-08-31', Array(116).fill(100).concat(Array(5).fill(200)))
    .concat([{ date: '2026-08-31', label: '13:00', amount: 100 }]);
  const result = buildVolumePace(previous.concat(current), previous.concat(current));

  assert.equal(result.coverage.alignedCoveragePct, 100);
  assert.equal(result.metrics.rolling5SequentialPct, null);
  assert.equal(result.metrics.shortTermState, 'unavailable');
  assert.equal(result.metrics.divergence, 'unavailable');
});

test('volume pace identifies whole-session expansion while the latest five minutes contract', () => {
  const previous = rows('2026-08-28', Array(10).fill(100));
  const current = rows('2026-08-31', Array(5).fill(200).concat(Array(5).fill(50)));
  const result = buildVolumePace(previous.concat(current), previous.concat(current));

  assert.equal(result.metrics.cumulativeYoYPct, 25);
  assert.equal(result.metrics.rolling5YoYPct, -50);
  assert.equal(result.metrics.rolling5SequentialPct, -75);
  assert.equal(result.metrics.divergence, 'cumulative-up-short-down');
});

test('short-term state follows adjacent five-minute contraction even while five-minute YoY remains positive', () => {
  const previous = rows('2026-08-28', Array(15).fill(100));
  const current = rows('2026-08-31', Array(5).fill(300).concat(Array(5).fill(200), Array(5).fill(120)));
  const result = buildVolumePace(previous.concat(current), previous.concat(current));

  assert.equal(result.metrics.cumulativeState, 'expanding');
  assert.equal(result.metrics.rolling5YoYPct, 20);
  assert.equal(result.metrics.rolling5SequentialPct, -40);
  assert.equal(result.metrics.shortTermState, 'decelerating');
  assert.equal(result.metrics.divergence, 'cumulative-up-short-down');
});

test('volume pace excludes slots missing from either market or comparison date', () => {
  const previous = rows('2026-08-28', Array(10).fill(100));
  const current = rows('2026-08-31', Array(10).fill(100));
  const shenzhen = previous.concat(current).filter(function(row) {
    return !(row.date === '2026-08-31' && row.label === '09:34');
  });
  const result = buildVolumePace(previous.concat(current), shenzhen);

  assert.equal(result.coverage.alignedPoints, 9);
  assert.equal(result.series.some(function(point) { return point.label === '09:34'; }), false);
  assert.equal(result.metrics.cumulativeYoYPct, 0);
});

test('service uses bounded cache and returns stale cache when the provider later fails', async () => {
  let now = Date.parse('2026-08-31T02:00:00.000Z');
  let fail = false;
  const payload = { data: { trends: rows('2026-08-28', Array(10).fill(100)).concat(rows('2026-08-31', Array(10).fill(110))).map(function(row) {
    return trend(row.date, row.label, row.amount);
  }) } };
  const service = createMarketVolumePaceService({
    now: function() { return now; },
    marketData: {
      async get() {
        if (fail) throw new Error('provider down');
        return { data: payload };
      }
    }
  });

  const first = await service.fetch({ refresh: true });
  assert.equal(first.status, 'available');
  fail = true;
  now += 20 * 1000;
  const stale = await service.fetch({ refresh: true });
  assert.equal(stale.marketState, 'stale-cache');
  assert.equal(stale.stale, true);
  assert.match(stale.reason, /provider-request-failed/);
});

function serviceAt(clock, input) {
  return createMarketVolumePaceService({
    now: function() { return typeof clock === 'function' ? clock() : Date.parse(clock); },
    marketData: { async get() { return { data: { data: { trends: input.map(function(row) {
      return trend(row.date, row.label, row.amount);
    }) } } }; } }
  });
}

test('volume pace does not label a same-day old as-of time as live', async () => {
  const input = rows('2026-08-28', Array(10).fill(100)).concat(rows('2026-08-31', Array(10).fill(100)));
  const result = await serviceAt('2026-08-31T14:50:00+08:00', input).fetch();
  assert.equal(result.marketState, 'delayed');
  assert.equal(result.stale, true);
  assert.match(result.reason, /延迟|滞后|时效/);
});

test('volume pace recognizes holiday and preopen previous-close observations without marking them stale', async () => {
  for (const clock of ['2026-10-01T10:00:00+08:00', '2026-10-08T08:00:00+08:00']) {
    const input = ['2026-09-29', '2026-09-30'].flatMap(date => ['14:59', '15:00'].map(label => ({ date, label, amount: 100 })));
    const result = await serviceAt(clock, input).fetch();
    assert.equal(result.marketState, 'latest-close', clock);
    assert.equal(result.stale, false, clock);
  }
});

test('volume pace freshness rechecks cached observations and excludes lunch from their age', async () => {
  let clock = Date.parse('2026-08-31T13:01:55+08:00');
  const input = ['2026-08-28', '2026-08-31'].flatMap(date => ['11:29', '11:30'].map(label => ({ date, label, amount: 100 })));
  const service = serviceAt(() => clock, input);
  const first = await service.fetch();
  assert.equal(first.marketState, 'live');
  clock += 10000;
  const second = await service.fetch();
  assert.equal(second.marketState, 'delayed');
  assert.equal(second.fetchedAt, first.fetchedAt);
});

test('five-minute fallback has a resolution-aware freshness budget', async () => {
  const input = ['2026-08-28', '2026-08-31'].flatMap(date => ['09:35', '09:40'].map(label => ({ day: date + ' ' + label + ':00', close: 10, volume: 100 })));
  const service = createMarketVolumePaceService({
    now: () => Date.parse('2026-08-31T09:44:30+08:00'),
    marketData: { async get(key) {
      if (key.startsWith('market-volume-pace:')) throw new Error('fixture unavailable');
      return { data: input };
    } }
  });
  const result = await service.fetch();
  assert.equal(result.coverage.intervalSeconds, 300);
  assert.equal(result.marketState, 'live');
  assert.equal(result.stale, false);
});

test('service falls back to clearly labelled Sina five-minute volume when one-minute amount is unavailable', async () => {
  let requestedSinaFallback = 0;
  const fallbackRows = ['09:30', '09:35', '09:40', '09:45'].flatMap(function(label, index) {
    return [
      { day: '2026-08-28 ' + label + ':00', close: '10', volume: String(100 + index) },
      { day: '2026-08-31 ' + label + ':00', close: '10', volume: String(120 + index) }
    ];
  });
  const service = createMarketVolumePaceService({
    now: function() { return Date.parse('2026-08-31T02:15:00.000Z'); },
    marketData: {
      async get(key) {
        if (key.startsWith('market-volume-pace:')) throw new Error('Eastmoney blocked');
        requestedSinaFallback += 1;
        return { data: fallbackRows };
      }
    }
  });

  const result = await service.fetch({ refresh: true });
  assert.equal(result.status, 'available');
  assert.equal(result.coverage.intervalSeconds, 300);
  assert.equal(result.measure, 'volume');
  assert.equal(result.source.id, 'sina-public-index-5m-volume');
  assert.equal(result.source.fallbackFrom, 'eastmoney-public-index-minute-amount');
  assert.equal(requestedSinaFallback, 2);
});

test('market route exposes the volume pace API', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/market.js'), 'utf8');
  assert.match(source, /market\/volume-pace/);
  assert.match(source, /marketVolumePaceService/);
});
