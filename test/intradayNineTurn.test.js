const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../js/modules/marketSignalModel');

const meta = { tradingDate: '2026-09-25', sampling: { intervalSeconds: 60, timestampMeaning: 'bar-label' } };
function rows(length, start = 570, date = meta.tradingDate) {
  return Array.from({ length }, (_, i) => ({ time: date + ' ' +
    String(Math.floor((start + i) / 60)).padStart(2, '0') + ':' +
    String((start + i) % 60).padStart(2, '0') + ':00', price: 10 + i }));
}
function calculate(input, options = {}, source = meta) {
  return model.calculateIntradayNineTurn(input, source, { asOf: '2026-09-26T00:00:00Z', ...options });
}

test('minute nine-turn displays each of 1-9 and compares the original fourth previous minute', () => {
  const result = calculate(rows(15));
  assert.equal(result.available, true);
  assert.deepEqual(result.series.slice(4).map(x => x.count), [1,2,3,4,5,6,7,8,9,10,11]);
  const nine = result.series.find(x => x.triggered);
  assert.equal(nine.time, '09:42');
  assert.equal(nine.price, 22);
  assert.equal(nine.referenceTime, '09:38');
  assert.equal(nine.referencePrice, 18);
  assert.doesNotMatch(nine.rule, /日K/);
});

test('falling, equal and reversed minute comparisons follow the daily counting rule', () => {
  const falling = rows(13).map((x, i) => ({ ...x, price: 30 - i }));
  assert.equal(calculate(falling).series.at(-1).direction, 'down');
  assert.equal(calculate(falling).series.at(-1).triggered, true);
  falling.push({ time: '2026-09-25 09:43:00', price: falling[9].price });
  falling.push({ time: '2026-09-25 09:44:00', price: 100 });
  assert.equal(calculate(falling).series.at(-2).count, 0);
  assert.equal(calculate(falling).series.at(-1).count, 1);
});

test('missing and invalid minutes break the sequence instead of compacting it into nine', () => {
  for (const input of [rows(17).filter((x, i) => i !== 8), rows(17).map((x, i) => i === 8 ? { ...x, price: null } : x)]) {
    const result = calculate(input);
    assert.equal(result.series.find(x => x.time === '09:38').price, null);
    assert.equal(result.series.filter(x => x.triggered).length, 0);
    assert.equal(result.series.at(-1).count, 4);
  }
});

test('current minute is provisional until the next minute, even without a new quote', () => {
  const input = rows(13);
  const live = calculate(input, { asOf: '2026-09-25T01:42:59Z' }).series.at(-1);
  assert.equal(live.count, 9);
  assert.equal(live.provisional, true);
  assert.equal(live.triggered, false);
  assert.equal(calculate(input, { asOf: '2026-09-25T01:43:00Z' }).series.at(-1).triggered, true);
  assert.equal(calculate(input, { asOf: '2026-09-25T01:40:00Z' }).series.at(-1).time, '09:40');
});

test('explicit incomplete bars remain unconfirmed even on a past trading day', () => {
  const input = rows(13); input[12].incomplete = true;
  assert.equal(calculate(input).series.at(-1).triggered, false);
});

test('lunch is skipped without inserting 90 missing bars; the count continues within the day', () => {
  const input = [...rows(9, 682), ...rows(4, 780).map(x => ({ ...x, price: x.price + 9 }))];
  const result = calculate(input);
  assert.equal(result.series.at(-1).triggered, true);
  assert.equal(result.series.at(-1).referenceTime, '11:30');
  assert.equal(result.series.some(x => x.time === '12:00'), false);
});

test('opening auction, other days and duplicate refreshes cannot add to the minute count', () => {
  const input = [...rows(15, 555), ...rows(13, 570, '2026-09-24'), ...rows(13), ...rows(13)];
  const result = calculate(input);
  assert.equal(result.series.length, 13);
  assert.equal(result.series[0].time, '09:30');
  assert.equal(result.series.at(-1).count, 9);
  assert.equal(calculate(rows(4)).series.some(x => x.count > 0), false);
});

test('sub-minute samples, five-minute fallback, synthetic and undated feeds are not relabelled as minute nine-turn', () => {
  for (const source of [
    { ...meta, sampling: { intervalSeconds: 5 } }, { ...meta, sampling: { intervalSeconds: 30 } },
    { ...meta, sampling: { intervalSeconds: 300 } }, { ...meta, synthetic: true }, {}
  ]) assert.equal(calculate(rows(13), {}, source).available, false);
  assert.equal(calculate(rows(13).map(x => ({ ...x, time: x.time.slice(11) })), {}, { sampling: meta.sampling }).available, false);
});

test('bar-end providers do not invent session-start samples', () => {
  const result = calculate(rows(13, 571), {}, { ...meta, sampling: { intervalSeconds: 60, timestampMeaning: 'bar-end' } });
  assert.equal(result.series[0].time, '09:31');
  assert.equal(result.series.at(-1).triggered, true);
  assert.equal(calculate(rows(1), {}, { ...meta, sampling: { intervalSeconds: 60, timestampMeaning: 'bar-end' } }).available, false);
});

test('appending future bars cannot change previously confirmed marks', () => {
  const first = calculate(rows(13)).series;
  assert.deepEqual(calculate(rows(25)).series.slice(0, first.length), first);
});

test('boolean prices are invalid rather than numeric observations', () => {
  const input = rows(13); input[8].price = true;
  assert.equal(calculate(input).series[8].price, null);
  assert.equal(calculate(input).series.at(-1).count, 0);
});
