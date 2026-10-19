const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/marketVolumePaceService');
const view = require('../js/modules/volumePace');

function payload(symbol, lines) {
  return { code: 0, data: { [symbol]: { data: [
    { date: '20260918', data: lines }, { date: '20260921', data: lines }
  ] } } };
}
test('Tencent historical cumulative amount becomes real one-minute increments, preserving lunch and date resets', () => {
  const rows = service.normalizeTencentAmountDays(payload('sh000001', [
    '0930 10 3 100', '0931 10 4 140', '1130 10 5 180',
    '1300 10 5 180', '1301 10 6 200'
  ]), 'sh000001');
  assert.deepEqual(rows.filter(r => r.date === '2026-09-21').map(r => [r.label, r.amount]),
    [['09:30', 100], ['09:31', 40], ['13:00', 0], ['13:01', 20]]);
  assert.equal(rows.find(r => r.date === '2026-09-18').amount, 100);
  assert.equal(rows.some(r => r.label === '11:30'), false, 'multi-hour change cannot become a one-minute amount');
});
test('Tencent normalization rejects missing fields, wrong identities and counter decreases instead of making zero', () => {
  assert.equal(service.normalizeTencentAmountDays(payload('sz399001', ['0930 10 3 100']), 'sh000001').length, 0);
  assert.deepEqual(service.normalizeTencentAmountDays(payload('sh000001', [
    '0930 10 3 100', '0931 10 4', '0932 10 5 160', '0933 10 6 150', '0934 10 7 180'
  ]), 'sh000001').filter(r => r.date === '2026-09-21').map(r => [r.label, r.amount]),
  [['09:30', 100], ['09:34', 30]]);
});
test('minute amount backup is attempted before five-minute volume and is explicitly sourced', async () => {
  const requests = [];
  const data = Array.from({ length: 11 }, (_, i) => `09${String(30 + i).padStart(2, '0')} 10 ${i + 1} ${(i + 1) * 100}`);
  const api = service.createMarketVolumePaceService({ now: () => Date.parse('2026-09-21T09:40:00+08:00'), marketData: {
    async get(key, url) {
      requests.push(url);
      if (url.includes('eastmoney')) throw new Error('primary unavailable');
      if (url.includes('gtimg')) return { data: payload(url.includes('sh000001') ? 'sh000001' : 'sz399001', data) };
      throw new Error('five-minute fallback must not be used');
    }
  } });
  const result = await api.fetch();
  assert.equal(result.coverage.intervalSeconds, 60);
  assert.equal(result.measure, 'amount');
  assert.equal(result.source.id, 'tencent-public-index-minute-amount');
  assert.equal(result.metrics.todayCumulativeAmount, 2200);
  assert.equal(requests.some(url => url.includes('sina')), false);
});
test('one missing real minute is never reported as complete cumulative data', () => {
  const rows = ['2026-09-18', '2026-09-21'].flatMap(date => Array.from({ length: 100 }, (_, i) => ({
    date, label: `${String(Math.floor((570 + i) / 60)).padStart(2, '0')}:${String((570 + i) % 60).padStart(2, '0')}`, amount: 100
  })).filter((_, i) => i !== 50));
  const result = service.buildVolumePace(rows, rows);
  assert.equal(result.quality.usable, false);
  assert.equal(result.status, 'partial');
});

test('a successful but single-day primary response still tries the minute backup', async () => {
  const api = service.createMarketVolumePaceService({ now: () => Date.parse('2026-09-21T15:01:00+08:00'), marketData: {
    async get(key, url) {
      if (url.includes('eastmoney')) return { data: { data: { trends: ['2026-09-21 09:30,10,10,10,10,1,100'] } } };
      if (url.includes('gtimg')) return { data: payload(url.includes('sh000001') ? 'sh000001' : 'sz399001', ['0930 10 1 100']) };
      throw new Error('must not reach five-minute volume');
    }
  } });
  assert.equal((await api.fetch()).source.id, 'tencent-public-index-minute-amount');
});
test('five-minute fallback uses five-minute axis instead of empty hover minutes', () => {
  const axis = view.chartAxis({ coverage: { intervalSeconds: 300 }, series: [{ label: '09:35' }, { label: '09:40' }] });
  assert.ok(axis.includes('09:35'));
  assert.ok(axis.includes('15:00'));
  assert.equal(axis.includes('09:49'), false);
  assert.equal(view.chartAxis({coverage:{intervalSeconds:60}}).includes('09:49'), true);
});
