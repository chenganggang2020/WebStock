const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SOURCE_MODES,
  assessStaleness,
  classifyFlowState,
  deriveKinematics,
  normalizeVendorFlowPayload,
  aggregateAuthorizedTrades,
  estimateLocalFlow,
  createCapitalFlowService
} = require('../services/capitalFlow');

const CHECKED_AT = '2026-08-12T05:10:00.000Z';

test('deriveKinematics uses elapsed minutes for speed and acceleration', () => {
  const points = deriveKinematics([
    { timestamp: '2026-08-12T09:30:00+08:00', netAmount: 0 },
    { timestamp: '2026-08-12T09:31:00+08:00', netAmount: 600 },
    { timestamp: '2026-08-12T09:33:00+08:00', netAmount: 1800 },
    { timestamp: '2026-08-12T09:34:00+08:00', netAmount: 1200 }
  ]);

  assert.equal(points[0].netFlowSpeed, null);
  assert.equal(points[0].netFlowAcceleration, null);
  assert.equal(points[1].netFlowSpeed, 600);
  assert.equal(points[1].netFlowAcceleration, null);
  assert.equal(points[2].netFlowSpeed, 600);
  assert.equal(points[2].netFlowAcceleration, 0);
  assert.equal(points[3].netFlowSpeed, -600);
  assert.equal(points[3].netFlowAcceleration, -1200);
});

test('deriveKinematics preserves null values instead of converting them to zero', () => {
  const points = deriveKinematics([
    { timestamp: '2026-08-12T09:30:00+08:00', netAmount: null },
    { timestamp: '2026-08-12T09:31:00+08:00', netAmount: 100 },
    { timestamp: '2026-08-12T09:32:00+08:00', netAmount: null }
  ]);

  assert.equal(points[0].netAmount, null);
  assert.equal(points[1].netFlowSpeed, null);
  assert.equal(points[2].netAmount, null);
  assert.equal(points[2].netFlowSpeed, null);
});

test('deriveKinematics excludes the A-share lunch break from elapsed minutes', () => {
  const points = deriveKinematics([
    { timestamp: '2026-08-12T11:30:00+08:00', netAmount: 100 },
    { timestamp: '2026-08-12T13:01:00+08:00', netAmount: 300 },
    { timestamp: '2026-08-12T13:02:00+08:00', netAmount: 700 }
  ]);

  assert.equal(points[1].netFlowSpeed, 200);
  assert.equal(points[2].netFlowSpeed, 400);
  assert.equal(points[2].netFlowAcceleration, 200);
});

test('deriveKinematics leaves lunch-only intervals without derivatives', () => {
  const points = deriveKinematics([
    { timestamp: '2026-08-12T11:30:00+08:00', netAmount: 100 },
    { timestamp: '2026-08-12T12:00:00+08:00', netAmount: 200 },
    { timestamp: '2026-08-12T13:00:00+08:00', netAmount: 300 }
  ]);

  assert.equal(points[1].netFlowSpeed, null);
  assert.equal(points[2].netFlowSpeed, null);
});

test('deriveKinematics cuts derivatives across trading days and source identities', () => {
  const points = deriveKinematics([
    { timestamp: '2026-08-11T14:59:00+08:00', netAmount: 100, sourceKey: 'vendor:Eastmoney' },
    { timestamp: '2026-08-12T09:30:00+08:00', netAmount: 200, sourceKey: 'vendor:Eastmoney' },
    { timestamp: '2026-08-12T09:31:00+08:00', netAmount: 400, sourceKey: 'local:WebStock' },
    { timestamp: '2026-08-12T09:32:00+08:00', netAmount: 100, sourceKey: 'local:WebStock' }
  ]);

  assert.equal(points[1].netFlowSpeed, null);
  assert.equal(points[2].netFlowSpeed, null);
  assert.equal(points[3].netFlowSpeed, -300);
  assert.equal(points[3].netFlowAcceleration, null);
});

test('classifyFlowState distinguishes the four signed flow states', () => {
  assert.deepEqual(classifyFlowState({ netAmount: 100, netFlowSpeed: 20 }), {
    code: 'sustained-inflow', label: '持续流入'
  });
  assert.deepEqual(classifyFlowState({ netAmount: 100, netFlowSpeed: -20 }), {
    code: 'inflow-giveback', label: '正流入回吐'
  });
  assert.deepEqual(classifyFlowState({ netAmount: -100, netFlowSpeed: 20 }), {
    code: 'outflow-narrowing', label: '流出收窄'
  });
  assert.deepEqual(classifyFlowState({ netAmount: -100, netFlowSpeed: -20 }), {
    code: 'outflow-accelerating', label: '流出加速'
  });
  assert.deepEqual(classifyFlowState({ netAmount: null, netFlowSpeed: 20 }), {
    code: 'unknown', label: '状态不足'
  });
});

test('assessStaleness reports observation, check time, age, and stale reason', () => {
  const fresh = assessStaleness('2026-08-12T05:08:00.000Z', CHECKED_AT, 5 * 60 * 1000);
  const stale = assessStaleness('2026-08-12T05:00:00.000Z', CHECKED_AT, 5 * 60 * 1000);
  const unavailable = assessStaleness(null, CHECKED_AT, 5 * 60 * 1000);

  assert.deepEqual(fresh, {
    observedAt: '2026-08-12T05:08:00.000Z',
    checkedAt: CHECKED_AT,
    ageMs: 120000,
    staleAfterMs: 300000,
    expiresAt: '2026-08-12T05:13:00.000Z',
    isStale: false,
    state: 'fresh',
    reason: null
  });
  assert.equal(stale.isStale, true);
  assert.equal(stale.reason, 'age-exceeds-threshold');
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.expiresAt, null);
  assert.equal(unavailable.reason, 'observation-time-unavailable');
});

test('assessStaleness rejects observation times beyond the explicit clock-skew tolerance', () => {
  const tolerated = assessStaleness('2026-08-12T05:10:04.000Z', CHECKED_AT, 5 * 60 * 1000);
  const future = assessStaleness('2026-08-12T05:10:06.000Z', CHECKED_AT, 5 * 60 * 1000);

  assert.equal(tolerated.state, 'fresh');
  assert.equal(tolerated.ageMs, 0);
  assert.equal(future.isStale, true);
  assert.equal(future.ageMs, -6000);
  assert.equal(future.reason, 'observation-time-in-future');
  assert.equal(future.state, 'unavailable');
});

test('a future-dated core observation is unavailable instead of chartable stale data', () => {
  const result = normalizeVendorFlowPayload({
    data: {
      code: '000001',
      klines: ['2026-08-12 13:10:06,100,1,2,3,4']
    }
  }, { code: '000001', checkedAt: CHECKED_AT });

  assert.equal(result.availability, 'unavailable');
  assert.equal(result.observation.state, 'unavailable');
  assert.equal(result.observation.reason, 'observation-time-in-future');
});

test('normalizeVendorFlowPayload keeps provider buckets separate from gross inflow/outflow', () => {
  const result = normalizeVendorFlowPayload({
    data: {
      code: '000001',
      name: '平安银行',
      klines: [
        '2026-08-12 13:05,1000,-500,-500,400,600',
        '2026-08-12 13:06,-200,-300,500,-100,-100'
      ]
    }
  }, {
    scope: 'stock',
    code: '000001',
    checkedAt: CHECKED_AT
  });

  assert.equal(result.source.sourceClass, SOURCE_MODES.VENDOR_CLASSIFIED);
  assert.equal(result.source.provider, 'Eastmoney');
  assert.equal(result.metricContract.inflowAmount.isGross, false);
  assert.match(result.metricContract.inflowAmount.definition, /positive portion/i);
  assert.equal(result.points[0].netAmount, 1000);
  assert.equal(result.points[0].inflowAmount, 1000);
  assert.equal(result.points[0].outflowAmount, 0);
  assert.equal(result.points[0].buckets.superLargeNetAmount, 600);
  assert.equal(result.points[1].netAmount, -200);
  assert.equal(result.points[1].inflowAmount, 0);
  assert.equal(result.points[1].outflowAmount, 200);
  assert.equal(result.points[1].buckets.largeNetAmount, -100);
  assert.equal(result.observation.observedAt, '2026-08-12T05:06:00.000Z');
});

test('normalizeVendorFlowPayload preserves missing provider metrics as null', () => {
  const result = normalizeVendorFlowPayload({
    data: {
      code: '000001',
      klines: ['2026-08-12 13:05,,,-500,,600']
    }
  }, {
    scope: 'stock',
    code: '000001',
    checkedAt: CHECKED_AT
  });

  assert.equal(result.points[0].netAmount, null);
  assert.equal(result.points[0].inflowAmount, null);
  assert.equal(result.points[0].outflowAmount, null);
  assert.equal(result.points[0].buckets.smallNetAmount, null);
  assert.equal(result.points[0].buckets.mediumNetAmount, -500);
  assert.equal(result.points[0].buckets.largeNetAmount, null);
});

test('all source types are unavailable and insufficient when every core amount is null', () => {
  const vendor = normalizeVendorFlowPayload({
    data: { code: '000001', klines: ['2026-08-12 13:05,,10,20,30,40'] }
  }, { scope: 'stock', code: '000001', checkedAt: CHECKED_AT });
  const level2 = aggregateAuthorizedTrades([
    { time: '13:05:00', amount: null, side: 'buy' },
    { time: '13:05:00', amount: null, side: 'sell' }
  ], {
    code: '000001', provider: 'licensed-gateway', authorizationVerified: true,
    entitlementVerified: true, fetchedAt: CHECKED_AT, checkedAt: CHECKED_AT
  });
  const local = estimateLocalFlow([
    { time: '2026-08-12 13:05:00', price: null, amount: null }
  ], { code: '000001', checkedAt: CHECKED_AT });

  for (const result of [vendor, level2, local]) {
    assert.equal(result.availability, 'unavailable');
    assert.equal(result.observation.state, 'insufficient');
    assert.equal(result.observation.isStale, true);
    assert.equal(result.observation.reason, 'core-metrics-unavailable');
  }
});

test('aggregateAuthorizedTrades reports observed gross buy and sell amounts', () => {
  const result = aggregateAuthorizedTrades([
    { time: '13:02:00', amount: 300, side: 'sell' },
    { time: '13:01:00', amount: 1000, side: 'buy' },
    { time: '13:03:00', amount: 50, side: 'neutral' }
  ], {
    code: '000001',
    provider: 'licensed-gateway',
    authorizationVerified: true,
    entitlementVerified: true,
    fetchedAt: CHECKED_AT,
    checkedAt: CHECKED_AT
  });

  assert.equal(result.source.sourceClass, SOURCE_MODES.AUTHORIZED_LEVEL2);
  assert.equal(result.metricContract.inflowAmount.isGross, true);
  assert.equal(result.points[0].inflowAmount, 1000);
  assert.equal(result.points[0].outflowAmount, 0);
  assert.equal(result.points[1].inflowAmount, 1000);
  assert.equal(result.points[1].outflowAmount, 300);
  assert.equal(result.points[1].netAmount, 700);
  assert.equal(result.points[2].neutralAmount, 50);
});

test('aggregateAuthorizedTrades carries a conservative Level-2 sample-window coverage contract', () => {
  const result = aggregateAuthorizedTrades([
    { time: '13:01:00', amount: 1000, side: 'buy' },
    { time: '13:02:00', amount: 300, side: 'sell' }
  ], {
    code: '000001', provider: 'licensed-gateway', authorizationVerified: true,
    entitlementVerified: true, fetchedAt: CHECKED_AT, checkedAt: CHECKED_AT,
    coverage: { requestedLimit: 1000, returnedCount: 1000 }
  });

  assert.deepEqual(result.coverage, {
    requestedLimit: 1000,
    returnedCount: 1000,
    coverageStart: '2026-08-12T05:01:00.000Z',
    coverageEnd: '2026-08-12T05:02:00.000Z',
    isComplete: false,
    completeness: 'truncated-at-request-limit',
    ordering: 'chronological-after-local-normalization',
    accumulationBasis: 'sample-window',
    fullSessionCoverage: 'unknown',
    warning: 'Returned count reached the requested limit; earlier trades may be omitted and full-session coverage is unknown.'
  });
  assert.match(result.limitations.join(' '), /sample window/i);
  assert.match(result.limitations.join(' '), /full-session coverage is unknown/i);
});

test('aggregateAuthorizedTrades rejects direct calls unless authorization and field entitlement are both verified', () => {
  const trades = [{ time: '13:01:00', amount: 100, side: 'buy' }];
  const base = { code: '000001', provider: 'licensed-gateway', fetchedAt: CHECKED_AT, checkedAt: CHECKED_AT };

  assert.throws(
    () => aggregateAuthorizedTrades(trades, Object.assign({}, base, { authorizationVerified: true })),
    error => error && error.code === 'LEVEL2_AGGREGATION_AUTHORIZATION_REQUIRED'
  );
  assert.throws(
    () => aggregateAuthorizedTrades(trades, Object.assign({}, base, { entitlementVerified: true })),
    error => error && error.code === 'LEVEL2_AGGREGATION_AUTHORIZATION_REQUIRED'
  );
});

test('aggregateAuthorizedTrades coalesces trades that share one provider timestamp', () => {
  const result = aggregateAuthorizedTrades([
    { time: '13:01:00', amount: 1000, side: 'buy' },
    { time: '13:01:00', amount: 300, side: 'sell' },
    { time: '13:02:00', amount: 400, side: 'sell' }
  ], {
    code: '000001',
    provider: 'licensed-gateway',
    authorizationVerified: true,
    entitlementVerified: true,
    fetchedAt: CHECKED_AT,
    checkedAt: CHECKED_AT
  });

  assert.equal(result.points.length, 2);
  assert.equal(result.points[0].inflowAmount, 1000);
  assert.equal(result.points[0].outflowAmount, 300);
  assert.equal(result.points[0].netAmount, 700);
  assert.equal(result.points[1].netFlowSpeed, -400);
});

test('aggregateAuthorizedTrades preserves missing amounts and cuts cumulative totals at the trading-day boundary', () => {
  const result = aggregateAuthorizedTrades([
    { time: '2026-08-11 14:59:00', amount: 1000, side: 'buy' },
    { time: '2026-08-12 09:30:00', amount: null, side: 'buy' },
    { time: '2026-08-12 09:31:00', amount: 300, side: 'sell' },
    { time: '2026-08-12 09:32:00', amount: 200, side: 'sell' }
  ], {
    code: '000001',
    provider: 'licensed-gateway',
    authorizationVerified: true,
    entitlementVerified: true,
    fetchedAt: CHECKED_AT,
    checkedAt: CHECKED_AT
  });

  assert.equal(result.points.length, 3);
  assert.equal(result.points[0].inflowAmount, null);
  assert.equal(result.points[0].netAmount, null);
  assert.equal(result.points[1].inflowAmount, null);
  assert.equal(result.points[1].outflowAmount, 300);
  assert.equal(result.points[1].netAmount, null);
  assert.equal(result.points[2].inflowAmount, null);
  assert.equal(result.points[2].outflowAmount, 500);
  assert.equal(result.points[2].netAmount, null);
});

test('estimateLocalFlow labels bar-direction allocation as a local estimate', () => {
  const result = estimateLocalFlow([
    { time: '2026-08-12 13:00:00', price: 10, amount: 1000 },
    { time: '2026-08-12 13:05:00', price: 11, amount: 2000 },
    { time: '2026-08-12 13:10:00', price: 10, amount: 1500 }
  ], {
    code: '000001',
    checkedAt: '2026-08-12T05:11:00.000Z'
  });

  assert.equal(result.source.sourceClass, SOURCE_MODES.LOCAL_ESTIMATE);
  assert.equal(result.source.provider, 'WebStock local heuristic');
  assert.equal(result.metricContract.inflowAmount.isGross, false);
  assert.equal(result.points[1].inflowAmount, 2000);
  assert.equal(result.points[1].outflowAmount, 0);
  assert.equal(result.points[2].inflowAmount, 2000);
  assert.equal(result.points[2].outflowAmount, 1500);
  assert.equal(result.points[2].netAmount, 500);
  assert.equal(result.points[2].netFlowSpeed, -300);
  assert.equal(result.points[2].netFlowAcceleration, -140);
  assert.match(result.limitations.join(' '), /not buyer\/seller initiated flow/i);
});

test('estimateLocalFlow keeps only the latest trading day before deriving speed', () => {
  const result = estimateLocalFlow([
    { time: '2026-08-11 15:00:00', price: 9, amount: 9000 },
    { time: '2026-08-12 09:30:00', price: 10, amount: 1000 },
    { time: '2026-08-12 09:35:00', price: 11, amount: 2000 }
  ], {
    code: '000001',
    checkedAt: '2026-08-12T01:36:00.000Z'
  });

  assert.equal(result.points.length, 2);
  assert.equal(result.points[0].timestamp, '2026-08-12T01:30:00.000Z');
  assert.equal(result.points[0].netAmount, 0);
  assert.equal(result.points[1].netFlowSpeed, 400);
});

test('estimateLocalFlow preserves missing bar fields and describes directional allocation without buyer-side claims', () => {
  const result = estimateLocalFlow([
    { time: '2026-08-12 09:30:00', price: null, amount: 1000 },
    { time: '2026-08-12 09:35:00', price: 11, amount: null },
    { time: '2026-08-12 09:40:00', price: 12, amount: 500 }
  ], {
    code: '000001',
    checkedAt: '2026-08-12T01:41:00.000Z'
  });

  assert.equal(result.points[0].netAmount, null);
  assert.equal(result.points[1].netAmount, null);
  assert.equal(result.points[2].netAmount, null);
  assert.match(result.metricContract.inflowAmount.definition, /up-price bars/i);
  assert.doesNotMatch(result.metricContract.inflowAmount.definition, /buyer-side/i);
});

test('createCapitalFlowService never falls back from unconfigured Level-2 to another source', async () => {
  let vendorCalls = 0;
  let level2TradeCalls = 0;
  let localCalls = 0;
  const service = createCapitalFlowService({
    now: () => new Date(CHECKED_AT),
    fetchVendorFlow: async () => {
      vendorCalls += 1;
      return {};
    },
    getLevel2Status: () => ({ configured: false, provider: 'disabled' }),
    fetchLevel2Trades: async () => {
      level2TradeCalls += 1;
      return {};
    },
    fetchMinuteBars: async () => {
      localCalls += 1;
      return [];
    }
  });

  const result = await service.getSeries({
    scope: 'stock',
    code: '000001',
    source: SOURCE_MODES.AUTHORIZED_LEVEL2
  });

  assert.equal(result.availability, 'unavailable');
  assert.equal(result.source.sourceClass, SOURCE_MODES.AUTHORIZED_LEVEL2);
  assert.equal(result.source.authorizationStatus, 'not-configured');
  assert.equal(result.observation.isStale, true);
  assert.equal(result.error.code, 'LEVEL2_NOT_CONFIGURED');
  assert.equal(vendorCalls, 0);
  assert.equal(level2TradeCalls, 0);
  assert.equal(localCalls, 0);
});

test('createCapitalFlowService requires explicit Level-2 authorization verification after configuration', async () => {
  let tradeCalls = 0;
  const service = createCapitalFlowService({
    now: () => new Date(CHECKED_AT),
    getLevel2Status: () => ({
      configured: true,
      authorizationVerified: false,
      provider: 'configured-gateway'
    }),
    fetchLevel2Trades: async () => {
      tradeCalls += 1;
      return { trades: [] };
    }
  });

  const result = await service.getSeries({
    scope: 'stock',
    code: '000001',
    source: SOURCE_MODES.AUTHORIZED_LEVEL2
  });

  assert.equal(result.availability, 'unavailable');
  assert.equal(result.source.authorizationStatus, 'configured-authorization-unverified');
  assert.equal(result.error.code, 'LEVEL2_AUTHORIZATION_UNVERIFIED');
  assert.equal(tradeCalls, 0);
});

test('createCapitalFlowService fetches Level-2 only when authorization is explicitly verified', async () => {
  let tradeCalls = 0;
  const service = createCapitalFlowService({
    now: () => new Date(CHECKED_AT),
    getLevel2Status: () => ({
      configured: true,
      authorizationVerified: true,
      entitlementVerified: true,
      provider: 'licensed-gateway'
    }),
    fetchLevel2Trades: async () => {
      tradeCalls += 1;
      return {
        provider: 'licensed-gateway',
        timestamp: CHECKED_AT,
        trades: [{ time: '13:05:00', amount: 100, side: 'buy' }]
      };
    }
  });

  const result = await service.getSeries({
    scope: 'stock',
    code: '000001',
    source: SOURCE_MODES.AUTHORIZED_LEVEL2
  });

  assert.equal(result.availability, 'available');
  assert.equal(result.source.authorizationStatus, 'verified-by-user-configuration');
  assert.equal(tradeCalls, 1);
});

test('createCapitalFlowService does not fetch when Level-2 entitlement is unverified', async () => {
  let tradeCalls = 0;
  const service = createCapitalFlowService({
    now: () => new Date(CHECKED_AT),
    getLevel2Status: () => ({
      configured: true,
      authorizationVerified: true,
      entitlementVerified: false,
      provider: 'licensed-gateway'
    }),
    fetchLevel2Trades: async () => {
      tradeCalls += 1;
      return { trades: [] };
    }
  });

  const result = await service.getSeries({
    scope: 'stock',
    code: '000001',
    source: SOURCE_MODES.AUTHORIZED_LEVEL2
  });

  assert.equal(result.availability, 'unavailable');
  assert.equal(result.source.authorizationStatus, 'configured-entitlement-unverified');
  assert.equal(result.error.code, 'LEVEL2_ENTITLEMENT_UNVERIFIED');
  assert.equal(tradeCalls, 0);
});

test('createCapitalFlowService rejects local sector estimation instead of relabeling another feed', async () => {
  const service = createCapitalFlowService({ now: () => new Date(CHECKED_AT) });
  const result = await service.getSeries({
    scope: 'sector',
    code: 'BK0475',
    source: SOURCE_MODES.LOCAL_ESTIMATE
  });

  assert.equal(result.availability, 'unavailable');
  assert.equal(result.source.sourceClass, SOURCE_MODES.LOCAL_ESTIMATE);
  assert.equal(result.error.code, 'SOURCE_SCOPE_UNSUPPORTED');
  assert.equal(result.points.length, 0);
});

test('createCapitalFlowService keeps provenance and observation metadata when an upstream source fails', async () => {
  const vendorService = createCapitalFlowService({
    now: () => new Date(CHECKED_AT),
    fetchVendorFlow: async () => {
      const error = new Error('fixture vendor unavailable');
      error.code = 'FIXTURE_VENDOR_DOWN';
      throw error;
    }
  });
  const localService = createCapitalFlowService({
    now: () => new Date(CHECKED_AT),
    fetchMinuteBars: async () => {
      const error = new Error('fixture minute bars unavailable');
      error.code = 'FIXTURE_MINUTE_DOWN';
      throw error;
    }
  });

  const vendor = await vendorService.getSeries({
    scope: 'sector', code: 'BK0475', source: SOURCE_MODES.VENDOR_CLASSIFIED
  });
  const local = await localService.getSeries({
    scope: 'stock', code: '000001', source: SOURCE_MODES.LOCAL_ESTIMATE
  });

  assert.equal(vendor.availability, 'unavailable');
  assert.equal(vendor.source.sourceClass, SOURCE_MODES.VENDOR_CLASSIFIED);
  assert.equal(vendor.observation.checkedAt, CHECKED_AT);
  assert.equal(vendor.observation.state, 'unavailable');
  assert.equal(vendor.error.code, 'FIXTURE_VENDOR_DOWN');
  assert.equal(local.availability, 'unavailable');
  assert.equal(local.source.sourceClass, SOURCE_MODES.LOCAL_ESTIMATE);
  assert.equal(local.observation.checkedAt, CHECKED_AT);
  assert.equal(local.error.code, 'FIXTURE_MINUTE_DOWN');
});

test('all source classes expose provenance tier and explicitly deny exchange ground truth', () => {
  const vendor = normalizeVendorFlowPayload({
    data: { code: '000001', klines: ['2026-08-12 13:05,100,10,20,30,40'] }
  }, { scope: 'stock', code: '000001', checkedAt: CHECKED_AT });
  const level2 = aggregateAuthorizedTrades([
    { time: '13:05:00', amount: 100, side: 'buy' }
  ], {
    code: '000001',
    provider: 'licensed-gateway',
    authorizationVerified: true,
    entitlementVerified: true,
    fetchedAt: CHECKED_AT,
    checkedAt: CHECKED_AT
  });
  const local = estimateLocalFlow([
    { time: '2026-08-12 13:00:00', price: 10, amount: 100 }
  ], { code: '000001', checkedAt: CHECKED_AT });

  assert.equal(vendor.source.provenanceTier, 'provider-classified');
  assert.equal(level2.source.provenanceTier, 'authorized-level2-observation');
  assert.equal(local.source.provenanceTier, 'local-heuristic');
  for (const result of [vendor, level2, local]) {
    assert.equal(result.source.exchangeGroundTruth, false);
    assert.match(result.source.truthStatement, /not exchange ground truth/i);
    assert.ok(result.points.every(function(point) { return typeof point.sourceKey === 'string' && point.sourceKey.length > 0; }));
  }
});
