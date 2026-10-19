const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateEtfEstimatedFlow,
  normalizeStockstarEtfPayload,
  parseCffexPositionXml,
  aggregateCffexPositionRows,
  cffexCandidateTradingDays,
  createMarketInstitutionalFlowService
} = require('../services/marketInstitutionalFlow');

test('calculateEtfEstimatedFlow applies share change times average price in yuan', () => {
  const result = calculateEtfEstimatedFlow({
    currentShares: 9717000000,
    previousShares: 10000000000,
    averagePrice: 4.694
  });

  assert.equal(result.shareChange, -283000000);
  assert.equal(result.estimatedNetFlowYuan, -1328402000);
  assert.equal(result.estimatedNetFlowHundredMillion, -13.28402);
  assert.equal(result.direction, 'outflow');
});

test('calculateEtfEstimatedFlow refuses incomplete or invalid inputs', () => {
  assert.equal(calculateEtfEstimatedFlow({ currentShares: null, previousShares: 10, averagePrice: 2 }), null);
  assert.equal(calculateEtfEstimatedFlow({ currentShares: 10, previousShares: -1, averagePrice: 2 }), null);
  assert.equal(calculateEtfEstimatedFlow({ currentShares: 10, previousShares: 9, averagePrice: 0 }), null);
});

test('normalizeStockstarEtfPayload preserves provider-published values and calculation provenance', () => {
  const result = normalizeStockstarEtfPayload({
    ret: 0,
    time: '2026-08-28',
    jlrnames: ['科创50ETF华夏(588000)'],
    jlrvalues: ['5.18'],
    jlrgmbh: ['-11.40'],
    jlcnames: ['沪深300ETF华泰柏瑞(510300)'],
    jlcvalues: ['-13.29'],
    jlcgmbh: ['-18.08']
  });

  assert.equal(result.availability, 'available');
  assert.equal(result.asOf, '2026-08-28');
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    code: '588000',
    name: '科创50ETF华夏',
    estimatedNetFlowHundredMillion: 5.18,
    scaleChangeHundredMillion: -11.4,
    direction: 'inflow',
    calculationMode: 'provider-published-estimate'
  });
  assert.equal(result.items[1].direction, 'outflow');
  assert.match(result.methodology, /份额变化/);
  assert.equal(result.source.provider, '证券之星 ETF 数据宝');
});

test('ETF ranking expands abbreviated provider labels from the local exchange fund catalog', () => {
  const result = normalizeStockstarEtfPayload({
    ret: 0,
    time: '2026-08-28',
    jlrnames: ['半导设备(159516)'],
    jlrvalues: ['10.32'],
    jlrgmbh: ['3.10'],
    jlcnames: [],
    jlcvalues: [],
    jlcgmbh: []
  });

  assert.equal(result.items[0].code, '159516');
  assert.equal(result.items[0].name, '半导体设备ETF国泰');
  assert.equal(result.items[0].estimatedNetFlowHundredMillion, 10.32);
});

test('parseCffexPositionXml reads long and short ranking rows without treating trade volume as a position', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <positionRank>
      <data Value="1" Text="IF2609"><instrumentid>IF2609</instrumentid><tradingday>20260828</tradingday><datatypeid>1</datatypeid><rank>1</rank><shortname>甲期货(代客)</shortname><volume>120</volume><varvolume>8</varvolume><partyid>0001</partyid><productid>IF</productid></data>
      <data Value="2" Text="IF2609"><instrumentid>IF2609</instrumentid><tradingday>20260828</tradingday><datatypeid>2</datatypeid><rank>1</rank><shortname>乙期货(代客)</shortname><volume>150</volume><varvolume>-3</varvolume><partyid>0002</partyid><productid>IF</productid></data>
      <data Value="0" Text="IF2609"><instrumentid>IF2609</instrumentid><tradingday>20260828</tradingday><datatypeid>0</datatypeid><rank>1</rank><shortname>丙期货(代客)</shortname><volume>999</volume><varvolume>99</varvolume><partyid>0003</partyid><productid>IF</productid></data>
    </positionRank>`;

  const rows = parseCffexPositionXml(xml);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28',
    positionType: 'long', rank: 1, member: '甲期货(代客)', volume: 120, change: 8
  });
  assert.equal(rows[1].positionType, 'short');
  assert.equal(rows[2].positionType, 'turnover');
});

test('aggregateCffexPositionRows reports disclosed ranked-member imbalance by contract', () => {
  const result = aggregateCffexPositionRows([
    { product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28', positionType: 'long', rank: 1, volume: 120, change: 8 },
    { product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28', positionType: 'long', rank: 2, volume: 80, change: -2 },
    { product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28', positionType: 'short', rank: 1, volume: 150, change: -3 },
    { product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28', positionType: 'short', rank: 2, volume: 90, change: 5 },
    { product: 'IF', contract: 'IF2612', tradingDay: '2026-08-28', positionType: 'long', rank: 21, volume: 999, change: 99 }
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28',
    disclosedLong: 200, disclosedLongChange: 6,
    disclosedShort: 240, disclosedShortChange: 2,
    rankedMemberImbalance: -40,
    rankedMemberImbalanceChange: 4,
    direction: 'ranked-net-short',
    scope: 'cffex-disclosed-ranked-members',
    focusMembers: []
  });
});

test('aggregateCffexPositionRows keeps a separate Zhongxin Futures focus without mixing Zhongxin Jiantou', () => {
  const result = aggregateCffexPositionRows([
    { product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28', positionType: 'long', rank: 2, member: '中信期货(代客)', volume: 75, change: 5 },
    { product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28', positionType: 'short', rank: 3, member: '中信期货（代客）', volume: 90, change: -4 },
    { product: 'IF', contract: 'IF2609', tradingDay: '2026-08-28', positionType: 'long', rank: 4, member: '中信建投期货(代客)', volume: 60, change: 2 }
  ]);

  assert.deepEqual(result[0].focusMembers, [{
    member: '中信期货',
    disclosedLong: 75,
    disclosedLongChange: 5,
    disclosedShort: 90,
    disclosedShortChange: -4,
    rankedMemberImbalance: -15,
    rankedMemberImbalanceChange: 9,
    direction: 'ranked-net-short'
  }]);
});

test('CFFEX candidates prefer the newest settled trading day over a stale ETF date', () => {
  const result = cffexCandidateTradingDays(
    new Date('2026-08-31T15:30:00.000Z'),
    '2026-08-28'
  );

  assert.deepEqual(result.slice(0, 2), ['2026-08-31', '2026-08-28']);
});

test('service keeps ETF and futures availability independent and never fabricates a fallback', async () => {
  const service = createMarketInstitutionalFlowService({
    now: () => new Date('2026-08-31T04:00:00.000Z'),
    fetchEtfPayload: async () => ({
      ret: 0, time: '2026-08-28',
      jlrnames: ['科创50ETF华夏(588000)'], jlrvalues: ['5.18'], jlrgmbh: ['-11.40'],
      jlcnames: [], jlcvalues: [], jlcgmbh: []
    }),
    fetchCffexProductXml: async () => { throw new Error('network unavailable'); }
  });

  const result = await service.getSnapshot();
  assert.equal(result.schema, 'webstock.market-institutional-flow.v1');
  assert.equal(result.etf.availability, 'available');
  assert.equal(result.futures.availability, 'unavailable');
  assert.equal(result.futures.items.length, 0);
  assert.equal(result.futures.error.code, 'CFFEX_DATA_UNAVAILABLE');
  assert.match(result.futures.truthStatement, /未使用替代值/);
});

test('service can publish official CFFEX data when the unrelated ETF source is unavailable', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><positionRank>
    <data Value="1"><instrumentid>IF2609</instrumentid><tradingday>20260828</tradingday><datatypeid>1</datatypeid><rank>1</rank><shortname>甲期货(代客)</shortname><volume>120</volume><varvolume>8</varvolume><productid>IF</productid></data>
    <data Value="2"><instrumentid>IF2609</instrumentid><tradingday>20260828</tradingday><datatypeid>2</datatypeid><rank>1</rank><shortname>乙期货(代客)</shortname><volume>150</volume><varvolume>-3</varvolume><productid>IF</productid></data>
  </positionRank>`;
  const service = createMarketInstitutionalFlowService({
    now: () => new Date('2026-08-31T04:00:00.000Z'),
    fetchEtfPayload: async () => { throw new Error('ETF provider unavailable'); },
    fetchCffexProductXml: async (product, date) => {
      assert.equal(date, '2026-08-28');
      return xml.replaceAll('<productid>IF</productid>', `<productid>${product}</productid>`)
        .replaceAll('IF2609', `${product}2609`);
    }
  });

  const result = await service.getSnapshot();
  assert.equal(result.etf.availability, 'unavailable');
  assert.equal(result.futures.availability, 'available');
  assert.equal(result.futures.asOf, '2026-08-28');
  assert.equal(result.futures.items.length, 4);
  assert.match(result.futures.methodology, /全部可比合约合计/);
  assert.match(result.futures.methodology, /代表合约/);
});
