const iconv = require('iconv-lite');
const marketData = require('./marketDataService');

const GLOBAL_SIGNAL_DEFINITIONS = Object.freeze([
  {
    key: 'china-a50-future', symbol: 'hf_CHA50CFD', name: '富时中国A50期货', parser: 'future', digits: 2,
    group: 'china', relevance: 'A股离岸风险温度计', inverseForAShares: false
  },
  {
    key: 'nasdaq100-future', symbol: 'hf_NQ', name: '纳指100期货', parser: 'future', digits: 2,
    group: 'global', relevance: '全球科技风险偏好', inverseForAShares: false
  },
  {
    key: 'sp500-future', symbol: 'hf_ES', name: '标普500期货', parser: 'future', digits: 2,
    group: 'global', relevance: '全球权益风险偏好', inverseForAShares: false
  },
  {
    key: 'hang-seng', symbol: 'int_hangseng', name: '恒生指数', parser: 'index', digits: 2,
    group: 'china', relevance: '港股中国资产联动', inverseForAShares: false
  },
  {
    key: 'nikkei225', symbol: 'int_nikkei', name: '日经225', parser: 'index', digits: 2,
    group: 'asia', relevance: '亚洲风险偏好', inverseForAShares: false
  },
  {
    key: 'kospi', symbol: 'b_KOSPI', name: '韩国KOSPI', parser: 'index-dated', digits: 2,
    group: 'asia', relevance: '亚洲科技与出口周期', inverseForAShares: false
  },
  {
    key: 'usd-cnh', symbol: 'fx_susdcnh', name: '美元/离岸人民币', parser: 'fx', digits: 4,
    group: 'currency', relevance: '上行代表人民币走弱', inverseForAShares: true
  }
]);

function finiteNumber(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, digits) {
  const number = finiteNumber(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function payloadText(value) {
  if (Buffer.isBuffer(value)) return iconv.decode(value, 'gb18030');
  if (value instanceof ArrayBuffer) return iconv.decode(Buffer.from(value), 'gb18030');
  return String(value == null ? '' : value);
}

function assignmentMap(payload) {
  const result = new Map();
  const pattern = /var\s+hq_str_([\w]+)="([^"]*)"\s*;/g;
  let match;
  while ((match = pattern.exec(payloadText(payload)))) result.set(match[1], match[2]);
  return result;
}

function parseDefinition(definition, raw) {
  const fields = String(raw || '').split(',');
  if (!raw || !fields.length) return null;
  let value = null;
  let changePct = null;
  let observedAt = '';
  if (definition.parser === 'future') {
    value = finiteNumber(fields[0]);
    const previous = finiteNumber(fields[7]);
    changePct = value !== null && previous && previous > 0 ? (value / previous - 1) * 100 : null;
    observedAt = [fields[12], fields[6]].filter(Boolean).join(' ');
  } else if (definition.parser === 'index') {
    value = finiteNumber(fields[1]);
    changePct = finiteNumber(fields[3]);
  } else if (definition.parser === 'index-dated') {
    value = finiteNumber(fields[1]);
    changePct = finiteNumber(fields[3]);
    observedAt = [fields[6], fields[5]].filter(Boolean).join(' ');
  } else if (definition.parser === 'fx') {
    value = finiteNumber(fields[1]);
    changePct = finiteNumber(fields[10]);
    observedAt = [fields[17], fields[0]].filter(Boolean).join(' ');
  }
  if (value === null || value <= 0) return null;
  return Object.assign({}, definition, {
    status: 'available',
    value: rounded(value, definition.digits || 2),
    changePct: rounded(changePct, 4),
    observedAt
  });
}

function parseSinaGlobalSignals(payload, definitions) {
  const assignments = assignmentMap(payload);
  return (definitions || GLOBAL_SIGNAL_DEFINITIONS).map(function(definition) {
    return parseDefinition(definition, assignments.get(definition.symbol));
  }).filter(Boolean);
}

function createGlobalMarketSignalService(options) {
  options = options || {};
  const client = options.marketData || marketData;
  const definitions = options.definitions || GLOBAL_SIGNAL_DEFINITIONS;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? Math.max(0, options.cacheTtlMs) : 15 * 1000;
  let cache = null;

  async function fetch(optionsInput) {
    optionsInput = optionsInput || {};
    const timestamp = now();
    if (!optionsInput.force && cache && timestamp - cache.storedAt < cacheTtlMs) return cache.value;
    const url = 'https://hq.sinajs.cn/list=' + definitions.map(function(item) { return item.symbol; }).join(',');
    const response = await client.get('global-market-signals', url, {
      responseType: 'arraybuffer',
      headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0 WebStock' }
    });
    const availableByKey = new Map(parseSinaGlobalSignals(response && response.data, definitions).map(function(item) {
      return [item.key, item];
    }));
    const items = definitions.map(function(definition) {
      return availableByKey.get(definition.key) || Object.assign({}, definition, {
        status: 'unavailable', value: null, changePct: null, observedAt: '', reason: '公开行情当前无返回值'
      });
    });
    const availableCount = items.filter(function(item) { return item.status === 'available'; }).length;
    const result = {
      status: availableCount === items.length ? 'available' : (availableCount ? 'partial' : 'unavailable'),
      fetchedAt: new Date(timestamp).toISOString(),
      items,
      source: {
        id: 'sina-public-global-quote',
        label: '新浪公开跨市场行情',
        note: '公开行情快照，不保证交易所实时；只作联动观察，相关不代表因果。'
      }
    };
    cache = { storedAt: timestamp, value: result };
    return result;
  }

  return { fetch };
}

const defaultService = createGlobalMarketSignalService();

module.exports = {
  GLOBAL_SIGNAL_DEFINITIONS,
  parseSinaGlobalSignals,
  createGlobalMarketSignalService,
  fetch: defaultService.fetch
};
