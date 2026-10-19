// Adapted from the received standalone subset; NOT the original full vendor API.
// No imports, I/O, current clock, account access or trading capability.
const SNAPSHOT_VERSION = 'webstock.cumulative-snapshot/v1';
const STATE_VERSION = 'webstock.cumulative-state/v2';
const SCOPE = ['sourceId', 'methodologyId', 'venue', 'symbol',
  'tradingDay', 'metricId', 'period', 'unit'];

function requireThat(ok, message) {
  if (!ok) throw new TypeError(message);
}
function integer(value, name) {
  requireThat(Number.isSafeInteger(value) && value >= 0, `${name}: nonnegative safe integer required`);
  return value;
}
function money(value, name, unsigned = false) {
  const pattern = unsigned ? /^(0|[1-9]\d*)$/ : /^(0|[1-9]\d*|-[1-9]\d*)$/;
  requireThat(typeof value === 'string' && value.length <= 64 && pattern.test(value),
    `${name}: canonical integer cents string required`);
  return BigInt(value);
}
function normalize(raw) {
  requireThat(raw && typeof raw === 'object', 'snapshot required');
  requireThat(raw.version === SNAPSHOT_VERSION, 'snapshot version mismatch');
  requireThat(raw.kind === 'CUMULATIVE' && raw.unit === 'CNY_CENT', 'cumulative cents only');
  requireThat(raw.automaticTrading === false, 'automaticTrading must be false');
  const x = {version: SNAPSHOT_VERSION, kind: 'CUMULATIVE', automaticTrading: false};
  for (const key of [...SCOPE, 'resetToken']) {
    requireThat(typeof raw[key] === 'string' && raw[key].trim().length > 0 &&
      raw[key].length <= 240, `${key}: nonempty string required`);
    x[key] = raw[key];
  }
  requireThat(['SH', 'SZ'].includes(x.venue), 'venue must be SH or SZ');
  requireThat(/^\d{6}$/.test(x.symbol), 'six-digit symbol required');
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(x.tradingDay), 'tradingDay must be YYYY-MM-DD');
  for (const key of ['observedAtMs', 'receivedAtMs', 'revision']) x[key] = integer(raw[key], key);
  requireThat(x.observedAtMs <= x.receivedAtMs, 'observation cannot follow receipt');
  const day = new Date(x.tradingDay + 'T00:00:00Z');
  requireThat(Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === x.tradingDay,
    'tradingDay must be a real calendar date');
  const localObservation = new Date(x.observedAtMs + 8 * 3600000);
  requireThat(Number.isFinite(localObservation.getTime()) &&
    localObservation.toISOString().slice(0, 10) === x.tradingDay,
    'tradingDay must match observation in Asia/Shanghai');
  requireThat(Number.isFinite(new Date(x.receivedAtMs).getTime()), 'receipt timestamp out of range');
  x.netCents = money(raw.netCents, 'netCents').toString();
  const hasGross = raw.inflowCents !== undefined || raw.outflowCents !== undefined;
  if (hasGross) {
    const inflow = money(raw.inflowCents, 'inflowCents', true);
    const outflow = money(raw.outflowCents, 'outflowCents', true);
    requireThat(inflow - outflow === BigInt(x.netCents), 'gross/net mismatch');
    x.inflowCents = inflow.toString();
    x.outflowCents = outflow.toString();
  }
  return Object.freeze(x);
}
const scopeKey = x => JSON.stringify(SCOPE.map(key => x[key]));
const valueKey = x => JSON.stringify([x.netCents, x.inflowCents, x.outflowCents]);

// This policy covers SH/SZ daytime sessions only; it is not a holiday calendar.
function continuityBetween(old, x, maxTradingGapMs) {
  const midnight = Date.parse(x.tradingDay + 'T00:00:00+08:00');
  const start = old.observedAtMs - midnight, end = x.observedAtMs - midnight;
  const sessions = [[570 * 60000, 690 * 60000], [780 * 60000, 900 * 60000]];
  const inSession = t => sessions.some(([a, b]) => t >= a && t <= b);
  const elapsed = sessions.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(end, b) - Math.max(start, a)), 0);
  const crossesLunch = start <= sessions[0][1] && end >= sessions[1][0];
  let continuity = 'unknown';
  if (inSession(start) && inSession(end)) {
    if (maxTradingGapMs !== null && elapsed > maxTradingGapMs) continuity = 'gap';
    else if (crossesLunch) continuity = 'session-break';
    else if (maxTradingGapMs !== null && elapsed > 0) continuity = 'continuous';
  }
  return {continuity, tradingElapsedMs: elapsed, breakBefore: continuity !== 'continuous'};
}

/** Pure reducer. Input state is null or a previous returned state (JSON round-trip OK).
 * revision is an authoritative per-observation revision number, not a fetch counter.
 * A higher same-time revision starts a NEW segment; its adjustment is NOT trading flow.
 * An older-time correction is quarantined; historical repair is outside this module.
 * resetToken changes ONLY on an externally evidenced reset, never on a falling net.
 */
function cumulativeStep(state, input, options = {}) {
  const maxTradingGapMs = options.maxTradingGapMs ?? null;
  if (maxTradingGapMs !== null) {
    integer(maxTradingGapMs, 'maxTradingGapMs');
    requireThat(maxTradingGapMs > 0, 'maxTradingGapMs must be positive');
  }
  const x = normalize(input);
  let s;
  if (state === null) {
    s = {version: STATE_VERSION, baseline: null, lastReceivedAtMs: null, segment: 0, blocked: null, retiredResetTokens: []};
  } else {
    requireThat(state && state.version === STATE_VERSION, 'invalid state version');
    const baseline = normalize(state.baseline);
    integer(state.lastReceivedAtMs, 'lastReceivedAtMs');
    integer(state.segment, 'segment');
    requireThat(state.segment > 0 && state.lastReceivedAtMs >= baseline.receivedAtMs, 'invalid state');
    requireThat(state.blocked === null || ['SAME_REVISION_CONFLICT', 'SCHEMA_CHANGED',
      'COUNTER_REGRESSION'].includes(state.blocked), 'invalid blocked reason');
    requireThat(Array.isArray(state.retiredResetTokens) && state.retiredResetTokens.every(
      t => typeof t === 'string' && t.length > 0 && t.length <= 240 && t !== baseline.resetToken),
      'invalid retired reset tokens');
    s = {version: STATE_VERSION, baseline, lastReceivedAtMs: state.lastReceivedAtMs,
      segment: state.segment, blocked: state.blocked, retiredResetTokens: [...state.retiredResetTokens]};
    requireThat(x.receivedAtMs >= s.lastReceivedAtMs, 'arrival order violation');
  }
  const old = s.baseline;
  function output(status, reason, patch = {}, values = {}) {
    const next = Object.freeze({...s, ...patch, lastReceivedAtMs: x.receivedAtMs,
      retiredResetTokens: Object.freeze([...(patch.retiredResetTokens ?? s.retiredResetTokens)])});
    const result = Object.freeze({status, reason, segment: next.segment,
      observedAtMs: x.observedAtMs, knownAtMs: x.receivedAtMs,
      deltaNetCents: null, revisionAdjustmentCents: null,
      intervalStartMs: null, intervalEndMs: null, breakBefore: false,
      continuity: 'not-applicable', tradingElapsedMs: null,
      automaticTrading: false, ...values});
    return Object.freeze({state: next, result});
  }
  function baseline(reason) {
    integer(s.segment + 1, 'next segment');
    const retired = reason === 'EXPLICIT_RESET' ? [...s.retiredResetTokens, old.resetToken] : [];
    return output('BASELINE', reason, {baseline: x, segment: s.segment + 1, blocked: null,
      retiredResetTokens: retired},
      {breakBefore: true});
  }
  function block(reason) {
    return output('BLOCKED', reason, {blocked: reason}, {breakBefore: true});
  }
  if (!old) return baseline('FIRST_OBSERVATION');
  if (x.tradingDay < old.tradingDay) return output('LATE', 'PRIOR_TRADING_DAY');
  if (scopeKey(x) !== scopeKey(old)) return baseline('SCOPE_CHANGED');
  // A late packet must not switch a current reset epoch back to an older one.
  if (x.observedAtMs < old.observedAtMs) return output('LATE', 'HISTORICAL_REVIEW_REQUIRED');
  if (s.retiredResetTokens.includes(x.resetToken)) return output('STALE_RESET', 'RETIRED_RESET_TOKEN');
  if (x.resetToken !== old.resetToken) return baseline('EXPLICIT_RESET');
  const recoversConflict = s.blocked === 'SAME_REVISION_CONFLICT' &&
    x.observedAtMs === old.observedAtMs && x.revision > old.revision &&
    (x.inflowCents !== undefined) === (old.inflowCents !== undefined);
  if (s.blocked && !recoversConflict) return output('BLOCKED', s.blocked, {}, {breakBefore: true});
  if (x.observedAtMs === old.observedAtMs) {
    if (x.revision < old.revision) return output('STALE_REVISION', 'LOWER_REVISION');
    if (x.revision === old.revision) {
      return valueKey(x) === valueKey(old)
        ? output('DUPLICATE', 'SAME_OBSERVATION') : block('SAME_REVISION_CONFLICT');
    }
    integer(s.segment + 1, 'next segment');
    return output('REVISION_BASELINE', 'AUTHORITATIVE_SAME_TIME_REVISION',
      {baseline: x, segment: s.segment + 1, blocked: null},
      {breakBefore: true, revisionAdjustmentCents: (BigInt(x.netCents) - BigInt(old.netCents)).toString()});
  }
  const hasGross = x.inflowCents !== undefined;
  if (hasGross !== (old.inflowCents !== undefined)) return block('SCHEMA_CHANGED');
  if (hasGross && (BigInt(x.inflowCents) < BigInt(old.inflowCents) ||
    BigInt(x.outflowCents) < BigInt(old.outflowCents))) return block('COUNTER_REGRESSION');
  const continuity = continuityBetween(old, x, maxTradingGapMs);
  const newSegment = ['gap', 'session-break'].includes(continuity.continuity);
  const segment = integer(s.segment + (newSegment ? 1 : 0), 'next segment');
  return output('DELTA', 'SAME_SCOPE_AND_RESET', {baseline: x, segment}, {
    ...continuity,
    deltaNetCents: (BigInt(x.netCents) - BigInt(old.netCents)).toString(),
    intervalStartMs: old.observedAtMs, intervalEndMs: x.observedAtMs});
}

// Preserve arrival order. Each instrument/provider/method gets an independent
// active-day state; historical packets remain in the output but never replace it.
function replaySnapshots(rows, options = {}) {
  requireThat(Array.isArray(rows) && rows.length <= 10000, 'snapshots must be an array of at most 10000 rows');
  const states = new Map();
  let lastArrival = -1;
  return rows.map(raw => {
    const snapshot = normalize(raw);
    requireThat(snapshot.receivedAtMs >= lastArrival, 'replay arrival order violation');
    lastArrival = snapshot.receivedAtMs;
    const key = JSON.stringify(SCOPE.filter(k => k !== 'tradingDay').map(k => snapshot[k]));
    const next = cumulativeStep(states.get(key) || null, snapshot, options);
    states.set(key, next.state);
    return Object.freeze({snapshot, activeTradingDay: next.state.baseline.tradingDay, result: next.result});
  });
}

module.exports = { SNAPSHOT_VERSION, cumulativeStep, replaySnapshots };
