const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeEtfMinute,
  normalizeSinaFuturesMinutePayload,
  summarizeFuturesMinute,
  createMarketInstitutionalIntradayService
} = require('../services/marketInstitutionalIntradayService');

test('ETF minute summary reports turnover momentum without calling it subscription flow', () => {
  const rows = [
    { time: '2026-08-31 14:51:00', price: 4.60, amount: 100 },
    { time: '2026-08-31 14:52:00', price: 4.61, amount: 100 },
    { time: '2026-08-31 14:53:00', price: 4.62, amount: 100 },
    { time: '2026-08-31 14:54:00', price: 4.63, amount: 100 },
    { time: '2026-08-31 14:55:00', price: 4.64, amount: 100 },
    { time: '2026-08-31 14:56:00', price: 4.65, amount: 150 },
    { time: '2026-08-31 14:57:00', price: 4.66, amount: 150 },
    { time: '2026-08-31 14:58:00', price: 4.67, amount: 150 },
    { time: '2026-08-31 14:59:00', price: 4.68, amount: 150 },
    { time: '2026-08-31 15:00:00', price: 4.69, amount: 150 }
  ];

  const result = summarizeEtfMinute(
    { code: '510300', name: '沪深300ETF', product: 'IF' },
    { rows, meta: { tradingDate: '2026-08-31', sampling: { intervalMinutes: 1 }, changePercent: 1.2 } }
  );

  assert.equal(result.availability, 'available');
  assert.equal(result.latestMinuteAmountYuan, 150);
  assert.equal(result.rolling5AmountYuan, 750);
  assert.equal(result.previous5AmountYuan, 500);
  assert.equal(result.rolling5ChangePct, 50);
  assert.equal(result.turnoverState, 'expanding');
  assert.match(result.metricLabel, /成交/);
  assert.doesNotMatch(result.metricLabel, /净申购|净流入/);
});

function etfInput(labels, meta = {}) {
  return {
    rows: labels.map(time => ({ time: '2026-08-31 ' + time + ':00', price: 4.6, amount: 100 })),
    meta: { sampling: { intervalMinutes: 1 }, ...meta }
  };
}

test('ETF five-minute momentum rejects five scattered observations instead of counting rows', () => {
  const result = summarizeEtfMinute({ code: '510300' }, etfInput(['09:30', '10:00', '10:30', '11:00', '14:50']));

  assert.equal(result.availability, 'available');
  assert.equal(result.latestMinuteAmountYuan, 100);
  assert.equal(result.rolling5AmountYuan, null);
  assert.equal(result.rolling5ChangePct, null);
  assert.equal(result.turnoverState, 'unavailable');
  assert.match(result.reason, /连续|窗口/);
});

test('ETF five-minute windows do not count duplicate timestamps as distinct minutes', () => {
  const input = etfInput(['09:30', '09:31', '09:32', '09:33', '09:33']);
  const result = summarizeEtfMinute({ code: '510300' }, input);

  assert.equal(result.rolling5AmountYuan, null);
  assert.equal(result.previous5AmountYuan, null);
});

test('ETF rolling and prior windows restart at the afternoon session after lunch', () => {
  const morning = ['11:26', '11:27', '11:28', '11:29', '11:30'];
  const early = summarizeEtfMinute({ code: '510300' }, etfInput(morning.concat(['13:00', '13:01', '13:02'])));
  const complete = summarizeEtfMinute({ code: '510300' }, etfInput(morning.concat(['13:00', '13:01', '13:02', '13:03', '13:04'])));

  assert.equal(early.rolling5AmountYuan, null);
  assert.equal(complete.rolling5AmountYuan, 500);
  assert.equal(complete.previous5AmountYuan, null);
  assert.equal(complete.rolling5ChangePct, null);
});

test('ETF sequential momentum requires the previous window to be adjacent to the latest five minutes', () => {
  const input = etfInput(['09:30', '09:31', '09:32', '09:33', '09:34', '09:40', '09:41', '09:42', '09:43', '09:44']);
  const result = summarizeEtfMinute({ code: '510300' }, input);

  assert.equal(result.rolling5AmountYuan, 500);
  assert.equal(result.previous5AmountYuan, null);
  assert.equal(result.rolling5ChangePct, null);
});

test('Sina futures minute data preserves price volume and open interest at one-minute grain', () => {
  const payload = 'var _IF0=([{"d":"2026-08-31 14:59:00","o":"4598.0","h":"4600.0","l":"4597.8","c":"4599.0","v":"80","p":"145020"},{"d":"2026-08-31 15:00:00","o":"4599.0","h":"4602.0","l":"4598.8","c":"4601.6","v":"119","p":"145044"}]);';
  const rows = normalizeSinaFuturesMinutePayload(payload);
  const result = summarizeFuturesMinute(
    { product: 'IF', symbol: 'IF0', name: '沪深300股指期货' },
    rows
  );

  assert.equal(rows.length, 2);
  assert.equal(result.availability, 'available');
  assert.equal(result.price, 4601.6);
  assert.equal(result.minuteVolume, 119);
  assert.equal(result.openInterest, 145044);
  assert.equal(result.openInterestChange, 24);
  assert.equal(result.positioningState, 'price-up-oi-up');
  assert.match(result.metricLabel, /价量仓/);
  assert.doesNotMatch(result.metricLabel, /净多|净空/);
});

test('intraday service refuses a five-minute ETF fallback when one-minute monitoring is required', async () => {
  const service = createMarketInstitutionalIntradayService({
    now: () => new Date('2026-08-31T07:00:30.000Z'),
    publicMinutes: {
      fetch: async () => ({
        rows: [{ time: '2026-08-31 15:00:00', price: 1, amount: 1 }],
        meta: { tradingDate: '2026-08-31', sampling: { intervalMinutes: 5 } }
      })
    },
    marketData: {
      get: async () => ({ data: 'var _IF0=([{"d":"2026-08-31 15:00:00","o":"1","h":"1","l":"1","c":"1","v":"1","p":"1"}]);' })
    }
  });

  const result = await service.fetch({ force: true });
  assert.equal(result.frequency, 'one-minute-bars');
  assert.ok(result.etfs.every(item => item.availability === 'unavailable'));
  assert.ok(result.futures.every(item => item.availability === 'available'));
  assert.match(result.truthStatement, /不是ETF净申购赎回/);
  assert.match(result.truthStatement, /不是净多净空/);
});

function fixtureService(clock, etfPayload, futuresRows = [], options = {}) {
  return createMarketInstitutionalIntradayService({
    now: () => new Date(typeof clock === 'function' ? clock() : clock),
    etfDefinitions: [{ code: '510300', product: 'IF', name: '沪深300ETF' }],
    futuresDefinitions: futuresRows.length ? [{ symbol: 'IF0', product: 'IF' }] : [],
    publicMinutes: { fetch: async () => etfPayload },
    marketData: { get: async () => ({ data: 'var _IF0=(' + JSON.stringify(futuresRows) + ');' }) },
    ...options
  });
}

test('intraday freshness cannot hide an ETF stale flag behind another fresh instrument', async () => {
  const service = fixtureService('2026-08-31T14:50:30+08:00',
    etfInput(['09:30'], { stale: true, reason: '上游返回旧缓存' }),
    [{ d: '2026-08-31 14:50:00', o: 1, h: 1, l: 1, c: 1, v: 1, p: 1 }]);
  const result = await service.fetch();

  assert.equal(result.stale, true);
  assert.notEqual(result.marketState, 'live');
  assert.equal(result.etfs[0].stale, true);
  assert.match(result.etfs[0].staleReason, /旧缓存/);
  assert.equal(result.futures[0].marketState, 'live');
});

test('same-day old ETF and futures observations are delayed even if the provider does not flag them', async () => {
  const service = fixtureService('2026-08-31T14:50:30+08:00', etfInput(['09:30']),
    [{ d: '2026-08-31 09:30:00', o: 1, h: 1, l: 1, c: 1, v: 1, p: 1 }]);
  const result = await service.fetch();

  assert.equal(result.marketState, 'delayed');
  assert.equal(result.etfs[0].stale, true);
  assert.equal(result.futures[0].stale, true);
  assert.match(result.etfs[0].staleReason, /时效|滞后|延迟/);
});

test('an explicit upstream stale flag is retained even when the timestamp looks current', async () => {
  const result = await fixtureService('2026-08-31T14:50:30+08:00',
    etfInput(['14:50'], { stale: true, reason: '缓存回退，刷新失败' })).fetch();

  assert.equal(result.etfs[0].stale, true);
  assert.notEqual(result.marketState, 'live');
  assert.match(result.etfs[0].staleReason, /刷新失败/);
});

test('intraday summaries exclude future points and future dates before choosing the latest day', async () => {
  const payload = etfInput(['09:30', '09:31']);
  payload.rows.push({ time: '2026-09-01 09:30:00', price: 999, amount: 999 });
  const result = await fixtureService('2026-08-31T09:30:30+08:00', payload, [
    { d: '2026-08-31 09:30:00', o: 1, h: 1, l: 1, c: 1, v: 1, p: 1 },
    { d: '2026-08-31 09:31:00', o: 2, h: 2, l: 2, c: 2, v: 2, p: 2 },
    { d: '2026-09-01 09:30:00', o: 999, h: 999, l: 999, c: 999, v: 999, p: 999 }
  ]).fetch();

  assert.equal(result.etfs[0].observedAt, '2026-08-31 09:30:00');
  assert.equal(result.futures[0].observedAt, '2026-08-31 09:30:00');
  assert.equal(result.etfs[0].price, 4.6);
  assert.equal(result.futures[0].price, 1);
});

test('future-only observations are unavailable rather than live', async () => {
  const result = await fixtureService('2026-08-31T09:30:30+08:00', etfInput(['09:31']),
    [{ d: '2026-08-31 09:31:00', o: 1, h: 1, l: 1, c: 1, v: 1, p: 1 }]).fetch();

  assert.equal(result.etfs[0].availability, 'unavailable');
  assert.equal(result.futures[0].availability, 'unavailable');
  assert.equal(result.marketState, 'unavailable');
});

test('intraday freshness uses the completed expected session during lunch, after close, preopen and holidays', async () => {
  const cases = [
    ['2026-08-31T12:45:00+08:00', '2026-08-31 11:30:00'],
    ['2026-08-31T15:45:00+08:00', '2026-08-31 15:00:00'],
    ['2026-09-01T08:00:00+08:00', '2026-08-31 15:00:00'],
    ['2026-09-05T14:00:00+08:00', '2026-09-04 15:00:00'],
    ['2026-10-01T10:00:00+08:00', '2026-09-30 15:00:00']
  ];
  for (const [clock, observedAt] of cases) {
    const payload = { rows: [{ time: observedAt, price: 1, amount: 1 }], meta: { sampling: { intervalMinutes: 1 } } };
    const result = await fixtureService(clock, payload).fetch();
    assert.equal(result.marketState, 'latest-close', clock);
    assert.equal(result.etfs[0].stale, false, clock);
  }
});

test('an incomplete old session is not called latest-close simply because the market is closed', async () => {
  const result = await fixtureService('2026-08-31T15:45:00+08:00', etfInput(['09:30'])).fetch();

  assert.equal(result.marketState, 'delayed');
  assert.equal(result.etfs[0].stale, true);
});

test('the two-minute freshness budget excludes lunch but expires after trading resumes', async () => {
  for (const [clock, expectedState] of [
    ['2026-08-31T13:00:30+08:00', 'live'],
    ['2026-08-31T13:02:00+08:00', 'live'],
    ['2026-08-31T13:02:01+08:00', 'delayed']
  ]) {
    const result = await fixtureService(clock, etfInput(['11:30'])).fetch();
    assert.equal(result.marketState, expectedState, clock);
  }
});

test('freshness is rechecked after requests finish and while serving the short cache', async () => {
  let clock = '2026-08-31T14:50:00+08:00';
  const service = fixtureService(() => clock, etfInput(['14:50']), [], {
    publicMinutes: { fetch: async () => { clock = '2026-08-31T14:51:50+08:00'; return etfInput(['14:50']); } }
  });
  const first = await service.fetch();
  assert.equal(first.checkedAt, '2026-08-31T06:51:50.000Z');
  assert.equal(first.marketState, 'live');
  clock = '2026-08-31T14:52:10+08:00';
  const second = await service.fetch();
  assert.equal(second.marketState, 'delayed');
  assert.equal(second.etfs[0].stale, true);
});
