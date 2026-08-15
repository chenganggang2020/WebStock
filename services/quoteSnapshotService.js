const DEFAULT_SOURCE = 'sina-public-quote';
const DEFAULT_MIN_REFRESH_MS = 3000;
const DEFAULT_STALE_AFTER_MS = 15000;
const DEFAULT_BATCH_SIZE = 80;
const DEFAULT_MAX_CODES = 200;

function normalizeCode(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  const normalized = digits.padStart(6, '0');
  return /^\d{6}$/.test(normalized) ? normalized : '';
}

function normalizeRequest(codes, maximum) {
  const valid = (Array.isArray(codes) ? codes : []).map(normalizeCode).filter(Boolean);
  return {
    requested: valid.length,
    codes: Array.from(new Set(valid)).slice(0, maximum)
  };
}

function classifyChinaQuoteStatus(tradeDate, timestamp = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp)).map(function(part) {
    return [part.type, part.value];
  }));
  const marketDate = parts.year + '-' + parts.month + '-' + parts.day;
  if (String(tradeDate || '') !== marketDate || parts.weekday === 'Sat' || parts.weekday === 'Sun') {
    return 'latest-close';
  }
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const trading = (minuteOfDay >= 9 * 60 + 30 && minuteOfDay <= 11 * 60 + 30)
    || (minuteOfDay >= 13 * 60 && minuteOfDay < 15 * 60);
  return trading ? 'live' : 'latest-close';
}

function quoteFingerprint(quote) {
  return JSON.stringify(Object.keys(quote || {}).sort().map(function(key) {
    return [key, quote[key]];
  }));
}

function iso(timestamp) {
  return timestamp === null || timestamp === undefined
    ? null
    : new Date(timestamp).toISOString();
}

function unavailableQuote(code, source, reason, nextRefreshAt) {
  return {
    code,
    name: code,
    price: 0,
    change: 0,
    open: 0,
    high: 0,
    low: 0,
    volume: 0,
    amount: 0,
    prevClose: 0,
    quoteStatus: 'unavailable',
    fetchedAt: null,
    changedAt: null,
    nextRefreshAt,
    stale: true,
    source,
    reason: reason || 'quote-not-fetched'
  };
}

function createQuoteSnapshotService(options = {}) {
  if (typeof options.fetchBatch !== 'function') {
    throw new TypeError('fetchBatch is required');
  }

  const fetchBatch = options.fetchBatch;
  const now = options.now || Date.now;
  const source = options.source || DEFAULT_SOURCE;
  const minRefreshMs = Number.isFinite(options.minRefreshMs)
    ? Math.max(1000, options.minRefreshMs) : DEFAULT_MIN_REFRESH_MS;
  const staleAfterMs = Number.isFinite(options.staleAfterMs)
    ? Math.max(minRefreshMs, options.staleAfterMs) : DEFAULT_STALE_AFTER_MS;
  const batchSize = Number.isInteger(options.batchSize)
    ? Math.min(Math.max(options.batchSize, 1), 80) : DEFAULT_BATCH_SIZE;
  const maxCodes = Number.isInteger(options.maxCodes)
    ? Math.min(Math.max(options.maxCodes, 1), 200) : DEFAULT_MAX_CODES;
  const states = new Map();
  const inFlightByCode = new Map();

  function stateFor(code) {
    if (!states.has(code)) {
      states.set(code, {
        quote: null,
        fingerprint: null,
        fetchedAtMs: null,
        changedAtMs: null,
        lastAttemptAtMs: null,
        lastError: null
      });
    }
    return states.get(code);
  }

  function refreshDue(code, timestamp) {
    if (inFlightByCode.has(code)) return false;
    const state = states.get(code);
    return !state || state.lastAttemptAtMs === null || timestamp - state.lastAttemptAtMs >= minRefreshMs;
  }

  function startBatch(codes) {
    const attemptedAt = now();
    codes.forEach(function(code) {
      stateFor(code).lastAttemptAtMs = attemptedAt;
    });

    const request = (async function() {
      try {
        const result = await fetchBatch(codes.slice());
        const quotes = result && result.quotes && typeof result.quotes === 'object'
          ? result.quotes : result || {};
        const completedAt = now();
        codes.forEach(function(code) {
          const state = stateFor(code);
          const quote = quotes[code];
          state.lastAttemptAtMs = completedAt;
          if (!quote || typeof quote !== 'object') {
            state.lastError = 'provider-returned-no-quote';
            return;
          }
          const fingerprint = quoteFingerprint(quote);
          state.quote = Object.assign({}, quote, { code });
          state.fetchedAtMs = completedAt;
          if (state.fingerprint !== fingerprint || state.changedAtMs === null) {
            state.changedAtMs = completedAt;
          }
          state.fingerprint = fingerprint;
          state.lastError = null;
        });
      } catch (error) {
        const completedAt = now();
        codes.forEach(function(code) {
          const state = stateFor(code);
          state.lastAttemptAtMs = completedAt;
          state.lastError = 'provider-request-failed';
        });
      }
    })();

    codes.forEach(function(code) { inFlightByCode.set(code, request); });
    request.finally(function() {
      codes.forEach(function(code) {
        if (inFlightByCode.get(code) === request) inFlightByCode.delete(code);
      });
    }).catch(function() {});
    return request;
  }

  function refresh(codes) {
    const waits = [];
    codes.forEach(function(code) {
      const pending = inFlightByCode.get(code);
      if (pending && !waits.includes(pending)) waits.push(pending);
    });

    const timestamp = now();
    const due = codes.filter(function(code) { return refreshDue(code, timestamp); });
    for (let index = 0; index < due.length; index += batchSize) {
      waits.push(startBatch(due.slice(index, index + batchSize)));
    }
    return Promise.all(waits);
  }

  function publicQuote(code, timestamp) {
    const state = states.get(code);
    const nextRefreshAt = iso(state && state.lastAttemptAtMs !== null
      ? state.lastAttemptAtMs + minRefreshMs : timestamp);
    if (!state || !state.quote) {
      const pending = inFlightByCode.has(code);
      return unavailableQuote(code, source,
        pending ? 'refresh-pending' : state && state.lastError || 'quote-not-fetched',
        nextRefreshAt);
    }
    const ageMs = Math.max(0, timestamp - state.fetchedAtMs);
    const stale = !!state.lastError || ageMs > staleAfterMs;
    return Object.assign({}, state.quote, {
      quoteStatus: stale ? 'stale' : state.quote.quoteStatus || 'live',
      fetchedAt: iso(state.fetchedAtMs),
      changedAt: iso(state.changedAtMs),
      nextRefreshAt,
      stale,
      source,
      reason: state.lastError || (stale ? 'snapshot-expired' : null)
    });
  }

  function buildSnapshot(request, mode) {
    const timestamp = now();
    const quotes = request.codes.map(function(code) { return publicQuote(code, timestamp); });
    const fetched = quotes.map(function(item) { return item.fetchedAt; }).filter(Boolean).sort();
    const changed = quotes.map(function(item) { return item.changedAt; }).filter(Boolean).sort();
    const nextRefresh = quotes.map(function(item) { return item.nextRefreshAt; }).filter(Boolean).sort();
    return {
      quotes,
      meta: {
        source,
        requested: request.requested,
        accepted: request.codes.length,
        returned: quotes.length,
        truncated: request.requested > request.codes.length,
        fetchedAt: fetched.pop() || null,
        changedAt: changed.pop() || null,
        nextRefreshAt: nextRefresh[0] || null,
        stale: quotes.some(function(item) { return item.stale; }),
        refreshInFlight: request.codes.some(function(code) { return inFlightByCode.has(code); }),
        refreshMode: mode,
        localReadIntervalMs: 1000,
        upstreamMinIntervalMs: minRefreshMs,
        staleAfterMs,
        realtimeGuaranteed: false
      }
    };
  }

  async function read(codes, readOptions = {}) {
    const request = normalizeRequest(codes, maxCodes);
    const shouldRefresh = readOptions.refresh !== false;
    const background = shouldRefresh && readOptions.background === true;
    if (shouldRefresh && request.codes.length) {
      const pending = refresh(request.codes);
      if (!background) await pending;
    }
    return buildSnapshot(request, background ? 'background' : shouldRefresh ? 'wait' : 'local-only');
  }

  async function whenIdle() {
    const pending = Array.from(new Set(inFlightByCode.values()));
    await Promise.all(pending);
  }

  return { read, whenIdle };
}

module.exports = {
  createQuoteSnapshotService,
  normalizeCode,
  classifyChinaQuoteStatus
};
