const SOURCE_MODES = Object.freeze({
  VENDOR_CLASSIFIED: 'vendor-classified',
  AUTHORIZED_LEVEL2: 'authorized-level2',
  LOCAL_ESTIMATE: 'local-estimate'
});

const DEFAULT_STALE_AFTER_MS = Object.freeze({
  [SOURCE_MODES.VENDOR_CLASSIFIED]: 10 * 60 * 1000,
  [SOURCE_MODES.AUTHORIZED_LEVEL2]: 2 * 60 * 1000,
  [SOURCE_MODES.LOCAL_ESTIMATE]: 10 * 60 * 1000
});

const FUTURE_CLOCK_SKEW_TOLERANCE_MS = 5000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = nullableNumber(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function isoTime(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function chinaDateTimeToIso(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return isoTime(value);
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]) - 8,
      Number(match[5]),
      Number(match[6] || 0)
    )
  ).toISOString();
}

function checkedAtFrom(options) {
  return isoTime(options && options.checkedAt) || new Date().toISOString();
}

function assessStaleness(observedAt, checkedAt, staleAfterMs) {
  const checked = isoTime(checkedAt) || new Date().toISOString();
  const observed = isoTime(observedAt);
  const threshold = Math.max(0, finiteNumber(staleAfterMs, 0));
  if (!observed) {
    return {
      observedAt: null,
      checkedAt: checked,
      ageMs: null,
      staleAfterMs: threshold,
      expiresAt: null,
      isStale: true,
      state: 'unavailable',
      reason: 'observation-time-unavailable'
    };
  }

  const rawAgeMs = new Date(checked).getTime() - new Date(observed).getTime();
  if (rawAgeMs < -FUTURE_CLOCK_SKEW_TOLERANCE_MS) {
    return {
      observedAt: observed,
      checkedAt: checked,
      ageMs: rawAgeMs,
      staleAfterMs: threshold,
      expiresAt: null,
      isStale: true,
      state: 'unavailable',
      reason: 'observation-time-in-future'
    };
  }
  const ageMs = Math.max(0, rawAgeMs);
  const expiresAt = new Date(new Date(observed).getTime() + threshold).toISOString();
  const isStale = ageMs > threshold;
  return {
    observedAt: observed,
    checkedAt: checked,
    ageMs,
    staleAfterMs: threshold,
    expiresAt,
    isStale,
    state: isStale ? 'stale' : 'fresh',
    reason: isStale ? 'age-exceeds-threshold' : null
  };
}

function chinaTimeParts(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    dateKey: [
      shifted.getUTCFullYear(),
      String(shifted.getUTCMonth() + 1).padStart(2, '0'),
      String(shifted.getUTCDate()).padStart(2, '0')
    ].join('-'),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + shifted.getUTCSeconds() / 60
  };
}

function elapsedTradingMinutes(previousTimestamp, currentTimestamp) {
  const previous = chinaTimeParts(previousTimestamp);
  const current = chinaTimeParts(currentTimestamp);
  if (!previous || !current || previous.dateKey !== current.dateKey) return null;
  let elapsed = current.minuteOfDay - previous.minuteOfDay;
  if (elapsed <= 0) return elapsed;

  const lunchStart = 11 * 60 + 30;
  const lunchEnd = 13 * 60;
  const overlap = Math.max(0, Math.min(current.minuteOfDay, lunchEnd) - Math.max(previous.minuteOfDay, lunchStart));
  elapsed -= overlap;
  return elapsed;
}

function classifyFlowState(point) {
  const netAmount = nullableNumber(point && point.netAmount);
  const speed = nullableNumber(point && point.netFlowSpeed);
  if (netAmount === null || speed === null || netAmount === 0 || speed === 0) {
    return { code: 'unknown', label: '状态不足' };
  }
  if (netAmount > 0 && speed > 0) return { code: 'sustained-inflow', label: '持续流入' };
  if (netAmount > 0 && speed < 0) return { code: 'inflow-giveback', label: '正流入回吐' };
  if (netAmount < 0 && speed > 0) return { code: 'outflow-narrowing', label: '流出收窄' };
  return { code: 'outflow-accelerating', label: '流出加速' };
}

function deriveKinematics(inputPoints) {
  const points = (Array.isArray(inputPoints) ? inputPoints : []).map(function(point) {
    return Object.assign({}, point, {
      timestamp: isoTime(point.timestamp),
      netAmount: round(point.netAmount, 2),
      netFlowSpeed: null,
      netFlowAcceleration: null,
      flowState: { code: 'unknown', label: '状态不足' }
    });
  });

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous.timestamp || !current.timestamp) {
      const error = new Error('Capital-flow points require valid timestamps');
      error.code = 'INVALID_POINT_TIME';
      throw error;
    }
    const wallElapsedMinutes = (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 60000;
    if (wallElapsedMinutes <= 0) {
      const error = new Error('Capital-flow point timestamps must be strictly increasing');
      error.code = 'NON_INCREASING_POINT_TIME';
      throw error;
    }
    const sourceChanged = String(previous.sourceKey || '') !== String(current.sourceKey || '');
    const elapsedMinutes = sourceChanged ? null : elapsedTradingMinutes(previous.timestamp, current.timestamp);
    if (elapsedMinutes === null || current.netAmount === null || previous.netAmount === null) {
      current.flowState = classifyFlowState(current);
      continue;
    }
    if (elapsedMinutes === 0) {
      current.flowState = classifyFlowState(current);
      continue;
    }
    if (elapsedMinutes < 0) {
      const error = new Error('Capital-flow points require positive trading elapsed time');
      error.code = 'NON_INCREASING_TRADING_TIME';
      throw error;
    }
    current.netFlowSpeed = round((current.netAmount - previous.netAmount) / elapsedMinutes);
    if (index >= 2 && previous.netFlowSpeed !== null && !sourceChanged) {
      current.netFlowAcceleration = round((current.netFlowSpeed - previous.netFlowSpeed) / elapsedMinutes);
    }
    current.flowState = classifyFlowState(current);
  }
  return points;
}

function vendorSource() {
  return {
    sourceClass: SOURCE_MODES.VENDOR_CLASSIFIED,
    provenanceTier: 'provider-classified',
    provider: 'Eastmoney',
    exchangeGroundTruth: false,
    truthStatement: 'Provider-classified data is not exchange ground truth.',
    authorizationStatus: 'public-access-license-not-verified',
    observationTimeBasis: 'provider-minute-label',
    methodology: 'Provider-defined capital-size buckets and cumulative net amounts.',
    limitations: 'Provider bucket definitions and classification thresholds are not verified in this repository.'
  };
}

function level2Source(provider, authorizationStatus, verification = {}) {
  return {
    sourceClass: SOURCE_MODES.AUTHORIZED_LEVEL2,
    provenanceTier: 'authorized-level2-observation',
    provider: provider || 'configured Level-2 gateway',
    exchangeGroundTruth: false,
    truthStatement: 'Authorized gateway observations and local aggregation are not exchange ground truth.',
    authorizationStatus: authorizationStatus || 'not-configured',
    authorizationVerified: verification.authorizationVerified === true,
    entitlementVerified: verification.entitlementVerified === true,
    observationTimeBasis: 'gateway-trade-time',
    methodology: 'Gross buyer-initiated and seller-initiated amounts aggregated locally from gateway trades.',
    limitations: 'Configuration does not prove an active vendor license or field entitlement.'
  };
}

function localEstimateSource() {
  return {
    sourceClass: SOURCE_MODES.LOCAL_ESTIMATE,
    provenanceTier: 'local-heuristic',
    provider: 'WebStock local heuristic',
    exchangeGroundTruth: false,
    truthStatement: 'Local heuristic estimates are not exchange ground truth.',
    authorizationStatus: 'not-applicable',
    observationTimeBasis: 'bar-time',
    methodology: 'Assign each bar amount by price direction, then accumulate estimated inflow and outflow.',
    limitations: 'Bar direction is not buyer/seller initiation and is not Level-2 order flow.'
  };
}

function vendorMetricContract() {
  return {
    currency: 'CNY',
    netAmount: {
      definition: 'Provider-classified cumulative net amount.',
      isVendorDefined: true
    },
    inflowAmount: {
      definition: 'Positive portion of provider cumulative net amount; not gross purchases.',
      isGross: false
    },
    outflowAmount: {
      definition: 'Absolute negative portion of provider cumulative net amount; not gross sales.',
      isGross: false
    },
    netFlowSpeed: { definition: 'Change in cumulative net amount per elapsed minute.', unit: 'CNY/min' },
    netFlowAcceleration: { definition: 'Change in net-flow speed per elapsed minute.', unit: 'CNY/min²' }
  };
}

function observedMetricContract(isGross, methodology) {
  return {
    currency: 'CNY',
    netAmount: { definition: 'Cumulative inflow minus cumulative outflow.', methodology },
    inflowAmount: { definition: 'Cumulative buyer-side amount.', isGross },
    outflowAmount: { definition: 'Cumulative seller-side amount.', isGross },
    netFlowSpeed: { definition: 'Change in cumulative net amount per elapsed minute.', unit: 'CNY/min' },
    netFlowAcceleration: { definition: 'Change in net-flow speed per elapsed minute.', unit: 'CNY/min²' }
  };
}

function localEstimateMetricContract() {
  return {
    currency: 'CNY',
    netAmount: {
      definition: 'Cumulative amount assigned to up-price bars minus amount assigned to down-price bars.',
      methodology: 'price-direction-bar-allocation'
    },
    inflowAmount: { definition: 'Cumulative amount assigned to up-price bars; not buyer-initiated flow.', isGross: false },
    outflowAmount: { definition: 'Cumulative amount assigned to down-price bars; not seller-initiated flow.', isGross: false },
    netFlowSpeed: { definition: 'Change in estimated cumulative net amount per elapsed trading minute.', unit: 'CNY/min' },
    netFlowAcceleration: { definition: 'Change in estimated net-flow speed per elapsed trading minute.', unit: 'CNY/min²' }
  };
}

function resultEnvelope(input) {
  const points = input.points || [];
  const observedAt = points.length ? points[points.length - 1].timestamp : null;
  const staleAfterMs = DEFAULT_STALE_AFTER_MS[input.source.sourceClass];
  const hasCoreMetrics = points.some(function(point) {
    return ['netAmount', 'inflowAmount', 'outflowAmount'].some(function(key) {
      return nullableNumber(point && point[key]) !== null;
    });
  });
  const observation = hasCoreMetrics
    ? assessStaleness(observedAt, input.checkedAt, staleAfterMs)
    : Object.assign(assessStaleness(null, input.checkedAt, staleAfterMs), {
        observedAt,
        state: 'insufficient',
        reason: 'core-metrics-unavailable'
      });
  const invalidFutureObservation = observation.reason === 'observation-time-in-future';
  return {
    schema: 'webstock.capital-flow.v1',
    availability: hasCoreMetrics && !invalidFutureObservation ? 'available' : 'unavailable',
    scope: input.scope,
    code: input.code || '',
    name: input.name || '',
    source: input.source,
    observation,
    metricContract: input.metricContract,
    points,
    latest: points.length ? points[points.length - 1] : null,
    coverage: input.coverage || null,
    limitations: input.limitations || [input.source.limitations].filter(Boolean)
  };
}

function normalizeVendorFlowPayload(payload, options = {}) {
  const data = payload && payload.data ? payload.data : payload || {};
  const rows = Array.isArray(data.klines) ? data.klines : [];
  const parsed = rows.map(function(row) {
    const fields = String(row || '').split(',');
    if (fields.length < 6) return null;
    const timestamp = chinaDateTimeToIso(fields[0]);
    const netAmount = nullableNumber(fields[1]);
    return {
      timestamp,
      sourceKey: SOURCE_MODES.VENDOR_CLASSIFIED + ':Eastmoney',
      netAmount,
      inflowAmount: netAmount === null ? null : round(Math.max(netAmount, 0), 2),
      outflowAmount: netAmount === null ? null : round(Math.max(-netAmount, 0), 2),
      neutralAmount: null,
      buckets: {
        smallNetAmount: round(fields[2], 2),
        mediumNetAmount: round(fields[3], 2),
        largeNetAmount: round(fields[4], 2),
        superLargeNetAmount: round(fields[5], 2)
      }
    };
  }).filter(function(point) { return point && point.timestamp; });
  parsed.sort(function(a, b) { return a.timestamp.localeCompare(b.timestamp); });

  return resultEnvelope({
    scope: options.scope || 'stock',
    code: String(options.code || data.code || ''),
    name: String(data.name || options.name || ''),
    source: vendorSource(),
    checkedAt: checkedAtFrom(options),
    metricContract: vendorMetricContract(),
    points: deriveKinematics(parsed),
    limitations: [
      'Inflow and outflow are the positive and negative portions of vendor net flow, not gross buys and sells.',
      vendorSource().limitations
    ]
  });
}

function tradeTimestamp(value, fetchedAt) {
  const text = String(value || '').trim();
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
    const chinaDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(fetchedAt));
    return chinaDateTimeToIso(chinaDate + ' ' + text);
  }
  return chinaDateTimeToIso(text);
}

function aggregateAuthorizedTrades(trades, options = {}) {
  if (options.authorizationVerified !== true || options.entitlementVerified !== true) {
    const error = new Error('Level-2 aggregation requires explicit authorization and field-entitlement verification');
    error.code = 'LEVEL2_AGGREGATION_AUTHORIZATION_REQUIRED';
    throw error;
  }
  const fetchedAt = checkedAtFrom({ checkedAt: options.fetchedAt || options.checkedAt });
  let rows = (Array.isArray(trades) ? trades : []).map(function(trade) {
    return {
      timestamp: tradeTimestamp(trade.time || trade.timestamp, fetchedAt),
      amount: nullableNumber(trade.amount),
      side: String(trade.side || 'neutral').toLowerCase()
    };
  }).filter(function(trade) { return trade.timestamp; });
  rows.sort(function(a, b) { return a.timestamp.localeCompare(b.timestamp); });
  if (rows.length) {
    const latestTradingDate = chinaTimeParts(rows[rows.length - 1].timestamp).dateKey;
    rows = rows.filter(function(row) {
      const parts = chinaTimeParts(row.timestamp);
      return parts && parts.dateKey === latestTradingDate;
    });
  }

  const groups = [];
  rows.forEach(function(trade) {
    const current = groups[groups.length - 1];
    if (!current || current.timestamp !== trade.timestamp) {
      groups.push({
        timestamp: trade.timestamp,
        buyAmount: 0,
        sellAmount: 0,
        neutralAmount: 0,
        missingBuyAmount: false,
        missingSellAmount: false,
        missingNeutralAmount: false
      });
    }
    const group = groups[groups.length - 1];
    if (trade.amount === null && trade.side === 'buy') group.missingBuyAmount = true;
    else if (trade.amount === null && trade.side === 'sell') group.missingSellAmount = true;
    else if (trade.amount === null) group.missingNeutralAmount = true;
    else if (trade.side === 'buy') group.buyAmount += trade.amount;
    else if (trade.side === 'sell') group.sellAmount += trade.amount;
    else group.neutralAmount += trade.amount;
  });

  let inflowAmount = 0;
  let outflowAmount = 0;
  let neutralAmount = 0;
  let missingBuyAmount = false;
  let missingSellAmount = false;
  let missingNeutralAmount = false;
  const points = groups.map(function(group) {
    inflowAmount += group.buyAmount;
    outflowAmount += group.sellAmount;
    neutralAmount += group.neutralAmount;
    missingBuyAmount = missingBuyAmount || group.missingBuyAmount;
    missingSellAmount = missingSellAmount || group.missingSellAmount;
    missingNeutralAmount = missingNeutralAmount || group.missingNeutralAmount;
    const hasMissingAmount = missingBuyAmount || missingSellAmount || missingNeutralAmount;
    return {
      timestamp: group.timestamp,
      sourceKey: SOURCE_MODES.AUTHORIZED_LEVEL2 + ':' + String(options.provider || 'configured-gateway'),
      netAmount: hasMissingAmount ? null : round(inflowAmount - outflowAmount, 2),
      inflowAmount: missingBuyAmount ? null : round(inflowAmount, 2),
      outflowAmount: missingSellAmount ? null : round(outflowAmount, 2),
      neutralAmount: missingNeutralAmount ? null : round(neutralAmount, 2),
      buckets: null
    };
  });

  const requestedLimit = nullableNumber(options.coverage && options.coverage.requestedLimit);
  const returnedCount = nullableNumber(options.coverage && options.coverage.returnedCount);
  const reachedLimit = requestedLimit !== null && returnedCount !== null && returnedCount >= requestedLimit;
  const coverage = {
    requestedLimit,
    returnedCount: returnedCount === null ? (Array.isArray(trades) ? trades.length : 0) : returnedCount,
    coverageStart: points.length ? points[0].timestamp : null,
    coverageEnd: points.length ? points[points.length - 1].timestamp : null,
    isComplete: reachedLimit ? false : null,
    completeness: reachedLimit ? 'truncated-at-request-limit' : 'unknown',
    ordering: 'chronological-after-local-normalization',
    accumulationBasis: 'sample-window',
    fullSessionCoverage: 'unknown',
    warning: reachedLimit
      ? 'Returned count reached the requested limit; earlier trades may be omitted and full-session coverage is unknown.'
      : 'Full-session coverage is unknown.'
  };
  const coverageLimitation = reachedLimit
    ? 'Level-2 amounts are accumulated within a sample window that reached the request limit; earlier trades may be omitted and full-session coverage is unknown.'
    : 'Level-2 amounts are accumulated within the returned sample window; full-session coverage is unknown.';

  return resultEnvelope({
    scope: 'stock',
    code: String(options.code || ''),
    name: String(options.name || ''),
    source: level2Source(options.provider, 'verified-by-user-configuration', {
      authorizationVerified: true,
      entitlementVerified: true
    }),
    checkedAt: checkedAtFrom(options),
    metricContract: observedMetricContract(true, 'authorized-level2-trades'),
    points: deriveKinematics(points),
    coverage,
    limitations: [
      coverageLimitation,
      level2Source(options.provider, 'verified-by-user-configuration').limitations
    ]
  });
}

function estimateLocalFlow(bars, options = {}) {
  let rows = (Array.isArray(bars) ? bars : []).map(function(bar) {
    return {
      timestamp: chinaDateTimeToIso(bar.time || bar.timestamp),
      price: nullableNumber(bar.price),
      amount: nullableNumber(bar.amount)
    };
  }).filter(function(bar) { return bar.timestamp; });
  rows.sort(function(a, b) { return a.timestamp.localeCompare(b.timestamp); });
  if (rows.length) {
    const latestTradingDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(rows[rows.length - 1].timestamp));
    rows = rows.filter(function(row) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date(row.timestamp)) === latestTradingDate;
    });
  }

  let inflowAmount = 0;
  let outflowAmount = 0;
  let neutralAmount = 0;
  let hasMissingInput = false;
  const points = rows.map(function(bar, index) {
    const previousPrice = index > 0 ? rows[index - 1].price : null;
    hasMissingInput = hasMissingInput || bar.price === null || bar.amount === null || (index > 0 && previousPrice === null);
    if (!hasMissingInput) {
      if (index > 0 && bar.price > previousPrice) inflowAmount += bar.amount;
      else if (index > 0 && bar.price < previousPrice) outflowAmount += bar.amount;
      else neutralAmount += bar.amount;
    }
    return {
      timestamp: bar.timestamp,
      sourceKey: SOURCE_MODES.LOCAL_ESTIMATE + ':WebStock-price-direction',
      netAmount: hasMissingInput ? null : round(inflowAmount - outflowAmount, 2),
      inflowAmount: hasMissingInput ? null : round(inflowAmount, 2),
      outflowAmount: hasMissingInput ? null : round(outflowAmount, 2),
      neutralAmount: hasMissingInput ? null : round(neutralAmount, 2),
      buckets: null
    };
  });

  return resultEnvelope({
    scope: 'stock',
    code: String(options.code || ''),
    name: String(options.name || ''),
    source: localEstimateSource(),
    checkedAt: checkedAtFrom(options),
    metricContract: localEstimateMetricContract(),
    points: deriveKinematics(points),
    limitations: [
      'This is a local estimate from bar direction, not buyer/seller initiated flow.',
      'The first bar and unchanged-price bars are neutral; results depend on bar interval.'
    ]
  });
}

function unavailableResult(input) {
  const checkedAt = checkedAtFrom({ checkedAt: input.checkedAt });
  return {
    schema: 'webstock.capital-flow.v1',
    availability: 'unavailable',
    scope: input.scope,
    code: input.code || '',
    name: input.name || '',
    source: input.source,
    observation: assessStaleness(null, checkedAt, DEFAULT_STALE_AFTER_MS[input.source.sourceClass]),
    metricContract: input.metricContract,
    points: [],
    latest: null,
    limitations: input.limitations || [input.source.limitations].filter(Boolean),
    error: { code: input.errorCode, message: input.message }
  };
}

function createCapitalFlowService(dependencies = {}) {
  const now = dependencies.now || function() { return new Date(); };
  const fetchVendorFlow = dependencies.fetchVendorFlow || async function() {
    throw new Error('Vendor capital-flow adapter is not configured');
  };
  const getLevel2Status = dependencies.getLevel2Status || function() {
    return { configured: false, provider: 'disabled' };
  };
  const fetchLevel2Trades = dependencies.fetchLevel2Trades || async function() {
    throw new Error('Level-2 trade adapter is not configured');
  };
  const fetchMinuteBars = dependencies.fetchMinuteBars || async function() {
    throw new Error('Minute-bar adapter is not configured');
  };

  async function getSeries(input = {}) {
    const scope = String(input.scope || '').trim().toLowerCase();
    const code = String(input.code || '').trim();
    const sourceClass = String(input.source || '').trim().toLowerCase();
    const checkedAt = isoTime(now()) || new Date().toISOString();

    if (sourceClass === SOURCE_MODES.VENDOR_CLASSIFIED) {
      try {
        const payload = await fetchVendorFlow({ scope, code });
        return normalizeVendorFlowPayload(payload, { scope, code, checkedAt });
      } catch (error) {
        return unavailableResult({
          scope, code, checkedAt,
          source: vendorSource(),
          metricContract: vendorMetricContract(),
          errorCode: error.code || 'VENDOR_FLOW_UNAVAILABLE',
          message: error.message || 'Vendor-classified capital-flow series is unavailable'
        });
      }
    }

    if (sourceClass === SOURCE_MODES.AUTHORIZED_LEVEL2) {
      if (scope !== 'stock') {
        return unavailableResult({
          scope, code, checkedAt,
          source: level2Source('', 'not-configured'),
          metricContract: observedMetricContract(true, 'authorized-level2-trades'),
          errorCode: 'SOURCE_SCOPE_UNSUPPORTED',
          message: 'Authorized Level-2 capital flow is supported only for individual stocks.'
        });
      }
      const status = getLevel2Status();
      if (!status || !status.configured) {
        return unavailableResult({
          scope, code, checkedAt,
          source: level2Source(status && status.provider, 'not-configured'),
          metricContract: observedMetricContract(true, 'authorized-level2-trades'),
          errorCode: 'LEVEL2_NOT_CONFIGURED',
          message: 'No authorized Level-2 gateway is configured. No fallback source was used.'
        });
      }
      if (status.authorizationVerified !== true) {
        return unavailableResult({
          scope, code, checkedAt,
          source: level2Source(status.provider, 'configured-authorization-unverified'),
          metricContract: observedMetricContract(true, 'authorized-level2-trades'),
          errorCode: 'LEVEL2_AUTHORIZATION_UNVERIFIED',
          message: 'The gateway is configured, but Level-2 authorization was not explicitly verified. No request or fallback was used.'
        });
      }
      if (status.entitlementVerified !== true) {
        return unavailableResult({
          scope, code, checkedAt,
          source: level2Source(status.provider, 'configured-entitlement-unverified', {
            authorizationVerified: true,
            entitlementVerified: false
          }),
          metricContract: observedMetricContract(true, 'authorized-level2-trades'),
          errorCode: 'LEVEL2_ENTITLEMENT_UNVERIFIED',
          message: 'The gateway authorization is configured, but Level-2 field entitlement was not explicitly verified. No request or fallback was used.'
        });
      }
      try {
        const payload = await fetchLevel2Trades({ code });
        return aggregateAuthorizedTrades(payload.trades || payload, {
          code,
          name: payload.name,
          provider: payload.provider || status.provider,
          fetchedAt: payload.timestamp || checkedAt,
          authorizationVerified: true,
          entitlementVerified: true,
          checkedAt,
          coverage: payload.coverage
        });
      } catch (error) {
        return unavailableResult({
          scope, code, checkedAt,
          source: level2Source(status.provider, 'verified-by-user-configuration', {
            authorizationVerified: true,
            entitlementVerified: true
          }),
          metricContract: observedMetricContract(true, 'authorized-level2-trades'),
          errorCode: error.code || 'LEVEL2_REQUEST_FAILED',
          message: error.message || 'Authorized Level-2 gateway request failed'
        });
      }
    }

    if (sourceClass === SOURCE_MODES.LOCAL_ESTIMATE) {
      if (scope !== 'stock') {
        return unavailableResult({
          scope, code, checkedAt,
          source: localEstimateSource(),
          metricContract: localEstimateMetricContract(),
          errorCode: 'SOURCE_SCOPE_UNSUPPORTED',
          message: 'Local bar-direction estimation is supported only for individual stocks.'
        });
      }
      try {
        const bars = await fetchMinuteBars({ code });
        return estimateLocalFlow(bars.data || bars, { code, checkedAt });
      } catch (error) {
        return unavailableResult({
          scope, code, checkedAt,
          source: localEstimateSource(),
          metricContract: localEstimateMetricContract(),
          errorCode: error.code || 'MINUTE_BARS_UNAVAILABLE',
          message: error.message || 'Minute bars for the local estimate are unavailable'
        });
      }
    }

    const error = new Error('source must explicitly select vendor-classified, authorized-level2, or local-estimate');
    error.code = 'CAPITAL_FLOW_SOURCE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  return { getSeries };
}

module.exports = {
  SOURCE_MODES,
  DEFAULT_STALE_AFTER_MS,
  assessStaleness,
  classifyFlowState,
  deriveKinematics,
  normalizeVendorFlowPayload,
  aggregateAuthorizedTrades,
  estimateLocalFlow,
  createCapitalFlowService
};
