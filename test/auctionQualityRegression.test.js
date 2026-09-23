const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auctionIndicativeFields,
  parseProviderTime
} = require('../services/localThirtySecondBarService');
const MarketSignalModel = require('../js/modules/marketSignalModel');

const tradingDate = '2026-09-17';
const dailyRows = [
  { date: '2026-09-16', open: 10, close: 10, high: 10.1, low: 9.9, volume: 10000 },
  { date: tradingDate, open: 10.1, close: 10.2, high: 10.3, low: 9.9, volume: 12000 }
];
const minuteMeta = { tradingDate, previousClose: 10, dataSource: 'public-minute-test' };
const explicitAuction = {
  auctionReferencePrice: 10.2,
  auctionMatchedVolume: 36000,
  auctionUnmatchedBuyVolume: 6000,
  auctionUnmatchedSellVolume: 0
};
const missingAuction = {
  auctionReferencePrice: null,
  auctionMatchedVolume: null,
  auctionUnmatchedBuyVolume: null,
  auctionUnmatchedSellVolume: null
};

function minute(time, price, volume) {
  return { time: tradingDate + ' ' + time, price, volume };
}

for (const time of ['14:57:00', '14:58:35', '15:00:00']) {
  test('explicit closing-auction fields survive the ' + time + ' snapshot unchanged', () => {
    const result = auctionIndicativeFields(explicitAuction, parseProviderTime(tradingDate + ' ' + time));
    assert.deepEqual(result, explicitAuction);
  });
}

test('opening-auction fields still survive the 09:25 boundary', () => {
  assert.deepEqual(
    auctionIndicativeFields(explicitAuction, parseProviderTime(tradingDate + ' 09:25:00')),
    explicitAuction
  );
});

test('auction fields are not retained outside opening and closing auction stages', () => {
  for (const time of ['09:14:59', '09:25:01', '14:56:59', '15:00:01']) {
    assert.deepEqual(
      auctionIndicativeFields(explicitAuction, parseProviderTime(tradingDate + ' ' + time)),
      missingAuction,
      time
    );
  }
});

test('ordinary closing quote levels do not manufacture auction matching quantities', () => {
  const result = auctionIndicativeFields({
    price: 10.2, volume: 36000, amount: 367200,
    buy1Price: 10.2, sell1Price: 10.2,
    buy1Vol: 36000, sell1Vol: 36000,
    buy2Vol: 6000, sell2Vol: 0
  }, parseProviderTime(tradingDate + ' 14:58:35'));
  assert.deepEqual(result, missingAuction);
});

const incompleteClosingCases = [
  { label: 'only the first closing minute', rows: [minute('14:57:00', 10.1, 200)] },
  {
    label: 'a rising interval without the final 15:00 sample',
    rows: [minute('14:57:00', 10.1, 200), minute('14:58:00', 10.3, 300)]
  },
  { label: 'only the final 15:00 sample', rows: [minute('15:00:00', 10.2, 300)] },
  {
    label: 'both endpoints but missing the intermediate minutes',
    rows: [minute('14:57:00', 10.1, 200), minute('15:00:00', 10.2, 300)]
  }
];

for (const fixture of incompleteClosingCases) {
  test('incomplete closing data cannot imply a complete auction: ' + fixture.label, () => {
    const result = MarketSignalModel.analyzeAuction(dailyRows,
      [minute('09:30:00', 10.1, 1000)].concat(fixture.rows), minuteMeta);

    assert.doesNotMatch(result.closing.interpretation, /温和|偏强|抛压/);
    assert.match(result.closing.interpretation, /不足|不完整|缺少|未完成|不能判定/);
  });
}

test('ordinary minute history explicitly cannot determine auction-process patterns', () => {
  const result = MarketSignalModel.analyzeAuction(dailyRows, [
    minute('09:30:00', 10.1, 1000),
    minute('14:57:00', 10.1, 200),
    minute('14:58:00', 10.12, 200),
    minute('14:59:00', 10.15, 200),
    minute('15:00:00', 10.2, 300)
  ], minuteMeta);

  assert.equal(result.opening.volumeIsAuctionExact, false);
  assert.equal(result.opening.indicativeMatchedVolume, null);
  assert.equal(result.opening.dataLevel, 'D0');
  assert.equal(result.closing.dataLevel, 'D0');
  assert.equal(result.opening.patternStatus, 'insufficient-data');
  assert.equal(result.closing.patternStatus, 'insufficient-data');
  assert.match(result.limitation, /形态/);
  assert.match(result.limitation, /不能|无法|不可|不足/);
});

test('local prices without explicit indicative fields do not upgrade auction-process evidence', () => {
  const result = MarketSignalModel.analyzeAuction(dailyRows,
    [minute('09:30:00', 10.1, 1000)], minuteMeta, [
      minute('09:15:00', 10, null),
      minute('09:20:00', 10.05, 500),
      minute('09:25:00', 10.1, 1000)
    ], { dataSource: 'local-public-quote-5s' });

  assert.equal(result.opening.indicativePrice, null);
  assert.equal(result.opening.indicativeMatchedVolume, null);
  assert.equal(result.opening.dataLevel, 'D0');
  assert.equal(result.opening.patternStatus, 'insufficient-data');
  assert.match(result.limitation, /形态/);
  assert.match(result.limitation, /不能|无法|不可|不足/);
});

test('unverified provider-specific indicative fields alone do not establish D2 process coverage', () => {
  const result = MarketSignalModel.analyzeAuction(dailyRows,
    [minute('09:30:00', 10.1, 1000)], minuteMeta, [
      Object.assign(minute('09:25:00', 10.1, 500), explicitAuction)
    ], { dataSource: 'local-public-quote-5s' });

  assert.equal(result.opening.indicativeMatchedVolume, 36000);
  assert.equal(result.opening.dataLevel, 'D0');
  assert.equal(result.opening.patternStatus, 'insufficient-data');
});
