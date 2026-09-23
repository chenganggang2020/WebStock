const test = require('node:test');
const assert = require('node:assert/strict');

const { createBoardCompositeHistoryService } = require('../services/boardCompositeHistoryService');

test('derived board history requires complete current constituents and preserves provenance', async () => {
  const calls = [];
  const service = createBoardCompositeHistoryService({
    resolveDataset: function() {
      return { datasetId: 'qfq-test', datasetDir: 'D:/dataset', asOf: '2026-08-28' };
    },
    constituentLoader: async function(definition) {
      calls.push(['constituents', definition.providerId]);
      return { expectedCount: 3, codes: ['000001', '000002', '600000'] };
    },
    compositeRunner: async function(input) {
      calls.push(['composite', input.codes.join(','), input.rawDays]);
      return {
        points: [
          { date: '2026-08-27', close: 100 },
          { date: '2026-08-28', close: 101 }
        ],
        includedConstituents: 3,
        requestedConstituents: 3,
        minimumDailyCoverage: 2
      };
    }
  });

  assert.equal(service.isAvailable(), true);
  const result = await service.fetchHistory({
    key: 'sina-concept:chgn_700458', providerId: 'chgn_700458', name: '半导体', kind: 'concept'
  }, 60);

  assert.deepEqual(calls, [
    ['constituents', 'chgn_700458'],
    ['composite', '000001,000002,600000', 60]
  ]);
  assert.equal(result.source.id, 'local-current-constituent-equal-weight');
  assert.match(result.source.label, /当前完整成分等权估算/);
  assert.match(result.warnings.join(' '), /不是供应商板块指数/);
  assert.equal(result.points.length, 2);
});

test('derived board history stays unavailable when the forward-adjusted baseline is absent', () => {
  const service = createBoardCompositeHistoryService({ resolveDataset: function() { return null; } });
  assert.equal(service.isAvailable(), false);
});
