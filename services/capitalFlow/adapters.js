const axios = require('axios');
const { toSinaSymbol } = require('../../utils/market');

const EASTMONEY_FLOW_URL = 'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get';
const SINA_MINUTE_URL = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData';

function normalizeCode(code) {
  return String(code || '').trim().replace(/^(sh|sz)/i, '');
}

function toEastmoneySecid(scope, code) {
  const normalized = normalizeCode(code);
  if (scope === 'sector') return '90.' + normalized.toUpperCase();
  const first = normalized.charAt(0);
  const market = first === '5' || first === '6' || first === '9' ? '1' : '0';
  return market + '.' + normalized;
}

function createCapitalFlowAdapters(options = {}) {
  const httpClient = options.httpClient || axios;
  const env = options.env || process.env;

  function explicitFlag(name) {
    return /^(?:1|true|yes)$/i.test(String(env[name] || '').trim());
  }

  async function fetchVendorFlow(input) {
    const response = await httpClient.get(EASTMONEY_FLOW_URL, {
      timeout: 8000,
      headers: {
        Referer: 'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 WebStock'
      },
      params: {
        lmt: 0,
        klt: 1,
        secid: toEastmoneySecid(input.scope, input.code),
        fields1: 'f1,f2,f3,f7',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63'
      }
    });
    const payload = response && response.data;
    if (!payload || !payload.data || !Array.isArray(payload.data.klines)) {
      const error = new Error('Vendor-classified capital-flow series is unavailable');
      error.code = 'VENDOR_FLOW_UNAVAILABLE';
      throw error;
    }
    return payload;
  }

  function getLevel2Service() {
    // Lazy loading prevents Level-2 configuration/database initialization unless
    // this source was selected explicitly by the caller.
    return options.level2Service || require('../level2Service');
  }

  function getLevel2Status() {
    const authorizationVerified = explicitFlag('LEVEL2_AUTHORIZATION_VERIFIED');
    const entitlementVerified = explicitFlag('LEVEL2_ENTITLEMENT_VERIFIED');
    if (!authorizationVerified || !entitlementVerified) {
      const provider = String(env.LEVEL2_PROVIDER || env.TONGHUASHUN_LEVEL2_PROVIDER || 'disabled').trim().toLowerCase();
      const baseUrl = String(env.LEVEL2_BASE_URL || env.TONGHUASHUN_LEVEL2_BASE_URL || '').trim();
      return {
        configured: provider !== 'disabled' && !!baseUrl,
        provider,
        authorizationVerified,
        entitlementVerified
      };
    }
    const publicStatus = getLevel2Service().getPublicStatus();
    return {
      configured: !!publicStatus.configured,
      provider: publicStatus.provider || 'disabled',
      authorizationVerified,
      entitlementVerified
    };
  }

  async function fetchLevel2Trades(input) {
    const requestedLimit = 1000;
    const payload = await getLevel2Service().getTrades(input.code, { limit: requestedLimit });
    const trades = Array.isArray(payload && payload.trades)
      ? payload.trades
      : (Array.isArray(payload) ? payload : []);
    const returnedCount = trades.length;
    const reachedLimit = returnedCount >= requestedLimit;
    return Object.assign({}, Array.isArray(payload) ? { trades: payload } : payload, {
      coverage: {
        requestedLimit,
        returnedCount,
        coverageStart: null,
        coverageEnd: null,
        isComplete: reachedLimit ? false : null,
        completeness: reachedLimit ? 'truncated-at-request-limit' : 'unknown',
        ordering: 'provider-response-order-unknown',
        accumulationBasis: 'sample-window',
        fullSessionCoverage: 'unknown',
        warning: reachedLimit
          ? 'Returned count reached the requested limit; earlier trades may be omitted and full-session coverage is unknown.'
          : 'Full-session coverage is unknown.'
      }
    });
  }

  async function fetchMinuteBars(input) {
    const response = await httpClient.get(SINA_MINUTE_URL, {
      timeout: 8000,
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0 WebStock'
      },
      params: {
        symbol: toSinaSymbol(input.code),
        scale: 5,
        ma: 'no',
        datalen: 1000
      }
    });
    if (!Array.isArray(response && response.data)) {
      const error = new Error('Minute bars for the local capital-flow estimate are unavailable');
      error.code = 'MINUTE_BARS_UNAVAILABLE';
      throw error;
    }
    return response.data.map(function(row) {
      return {
        time: row.day || '',
        price: row.close == null || row.close === '' ? null : Number(row.close),
        amount: row.amount == null || row.amount === '' ? null : Number(row.amount)
      };
    });
  }

  return {
    fetchVendorFlow,
    getLevel2Status,
    fetchLevel2Trades,
    fetchMinuteBars
  };
}

module.exports = {
  EASTMONEY_FLOW_URL,
  SINA_MINUTE_URL,
  toEastmoneySecid,
  createCapitalFlowAdapters
};
