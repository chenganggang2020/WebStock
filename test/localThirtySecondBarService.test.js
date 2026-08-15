const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createLocalThirtySecondBarService } = require('../services/localThirtySecondBarService');

test('local thirty-second bars aggregate only new public quote snapshots', () => {
  const database = new Database(':memory:');
  const service = createLocalThirtySecondBarService({
    db: database,
    now: function() { return new Date('2026-08-14T01:31:00.000Z').getTime(); }
  });

  const first = {
    code: '000001', price: 10, volume: 1000, amount: 10000,
    providerObservedAt: '2026-08-14 09:30:01'
  };
  assert.equal(service.recordQuotes([first]).recorded, 1);
  assert.equal(service.recordQuotes([first]).recorded, 0);
  service.recordQuotes([{
    code: '000001', price: 10.05, volume: 1100, amount: 11050,
    providerObservedAt: '2026-08-14 09:30:05'
  }]);
  service.recordQuotes([{
    code: '000001', price: 10.02, volume: 1200, amount: 12052,
    providerObservedAt: '2026-08-14 09:30:35'
  }]);

  const result = service.list('000001');
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    time: '2026-08-14 09:30:30',
    open: 10,
    price: 10.05,
    high: 10.05,
    low: 10,
    volume: 100,
    amount: 1050,
    observedCount: 2
  });
  assert.equal(result.rows[1].time, '2026-08-14 09:31:00');
  assert.equal(result.rows[1].volume, 100);
  assert.equal(result.meta.dataSource, 'local-public-quote-30s');
  assert.equal(result.meta.sampling.intervalSeconds, 30);
  assert.equal(result.meta.exchangeGroundTruth, false);
  assert.equal(result.meta.volumeCoverage, 'sample-window');
  assert.equal(result.meta.providerObservedAt, '2026-08-14 09:30:35');

  database.close();
});

test('local thirty-second bars ignore lunch snapshots and never carry cumulative volume across days', () => {
  const database = new Database(':memory:');
  const service = createLocalThirtySecondBarService({ db: database });

  service.recordQuotes([{
    code: '600000', price: 8, volume: 5000, amount: 40000,
    providerObservedAt: '2026-08-14 11:30:00'
  }]);
  assert.equal(service.recordQuotes([{
    code: '600000', price: 8.01, volume: 5100, amount: 40801,
    providerObservedAt: '2026-08-14 12:00:00'
  }]).recorded, 0);
  service.recordQuotes([{
    code: '600000', price: 8.2, volume: 200, amount: 1640,
    providerObservedAt: '2026-08-15 09:30:01'
  }]);

  const latest = service.list('600000');
  assert.equal(latest.tradingDate, '2026-08-15');
  assert.equal(latest.rows.length, 1);
  assert.equal(latest.rows[0].volume, null);
  assert.equal(latest.rows[0].amount, null);

  database.close();
});

test('local thirty-second aggregation resumes its cumulative baseline after a service restart', () => {
  const database = new Database(':memory:');
  const firstService = createLocalThirtySecondBarService({ db: database });
  firstService.recordQuotes([{
    code: '300750', price: 200, volume: 1000, amount: 200000,
    providerObservedAt: '2026-08-14 13:00:01'
  }]);

  const resumedService = createLocalThirtySecondBarService({ db: database });
  resumedService.recordQuotes([{
    code: '300750', price: 201, volume: 1050, amount: 210050,
    providerObservedAt: '2026-08-14 13:00:05'
  }]);

  const result = resumedService.list('300750', { tradingDate: '2026-08-14' });
  assert.equal(result.rows[0].volume, 50);
  assert.equal(result.rows[0].amount, 10050);
  assert.equal(result.rows[0].observedCount, 2);

  database.close();
});
