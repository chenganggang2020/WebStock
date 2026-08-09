const test = require('node:test');
const assert = require('node:assert/strict');

const quotes = require('../services/quoteService');

test('Sina quote parser keeps source time and rejects zero-price rows', () => {
  const parsed = quotes.parseSinaQuotes([
    'var hq_str_sz000001="平安银行,10.00,10.10,10.20,10.30,9.90,0,0,100,1000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-08-09,14:55:00";',
    'var hq_str_sh600000="浦发银行,10.00,10.10,0,10.30,9.90,0,0,100,1000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-08-09,14:55:00";'
  ].join('\n'));
  assert.equal(parsed['000001'].price, 10.2);
  assert.equal(parsed['000001'].tradeDate, '2026-08-09');
  assert.equal(parsed['600000'], undefined);
});

test('quote code normalization is bounded and exchange agnostic', () => {
  assert.deepEqual(quotes.normalizeCodes(['1', '000001', '600000', 'bad']), ['000001', '600000']);
});
