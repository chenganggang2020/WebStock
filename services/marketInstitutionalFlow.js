const axios = require('axios');

const ETF_SOURCE_URL = 'https://fund.stockstar.com/etf/';
const ETF_DATA_URL = 'https://fund.stockstar.com/etf/data/GetBBChartDatas?count=10';
const CFFEX_SOURCE_URL = 'https://www.cffex.com.cn/cn/ccpm.html';
const CFFEX_PRODUCTS = ['IF', 'IH', 'IC', 'IM'];
const PRODUCT_NAMES = {
  IF: '沪深300股指期货',
  IH: '上证50股指期货',
  IC: '中证500股指期货',
  IM: '中证1000股指期货'
};
const FUND_NAME_BY_CODE = new Map((function() {
  try { return require('../funds.json'); } catch (error) { return []; }
})().map(function(row) {
  return [String(row && (row.code || row[0]) || '').trim(), String(row && (row.name || row[2]) || '').trim()];
}).filter(function(entry) { return /^\d{6}$/.test(entry[0]) && entry[1]; }));
let cffexSecureTransportAvailable = null;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function calculateEtfEstimatedFlow(input = {}) {
  const currentShares = finiteNumber(input.currentShares);
  const previousShares = finiteNumber(input.previousShares);
  const averagePrice = finiteNumber(input.averagePrice);
  if (currentShares === null || previousShares === null || averagePrice === null) return null;
  if (currentShares < 0 || previousShares < 0 || averagePrice <= 0) return null;

  const shareChange = currentShares - previousShares;
  const estimatedNetFlowYuan = round(shareChange * averagePrice, 2);
  return {
    shareChange,
    estimatedNetFlowYuan,
    estimatedNetFlowHundredMillion: round(estimatedNetFlowYuan / 100000000, 6),
    direction: estimatedNetFlowYuan > 0 ? 'inflow' : estimatedNetFlowYuan < 0 ? 'outflow' : 'flat'
  };
}

function parseEtfLabel(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(.*)\((\d{6})\)$/);
  return match ? { name: match[1].trim(), code: match[2] } : { name: text, code: '' };
}

function normalizeEtfItems(names, values, scaleChanges, direction) {
  const size = Math.min(names.length, values.length);
  const items = [];
  for (let index = 0; index < size; index += 1) {
    const amount = finiteNumber(values[index]);
    const scaleChange = finiteNumber(scaleChanges[index]);
    if (amount === null) continue;
    const identity = parseEtfLabel(names[index]);
    items.push({
      code: identity.code,
      name: FUND_NAME_BY_CODE.get(identity.code) || identity.name,
      estimatedNetFlowHundredMillion: amount,
      scaleChangeHundredMillion: scaleChange,
      direction: amount > 0 ? 'inflow' : amount < 0 ? 'outflow' : direction || 'flat',
      calculationMode: 'provider-published-estimate'
    });
  }
  return items;
}

function normalizeStockstarEtfPayload(payload = {}) {
  if (Number(payload.ret) !== 0 || !payload.time) {
    const error = new Error(payload.msg || 'ETF provider returned no usable data');
    error.code = 'ETF_DATA_UNAVAILABLE';
    throw error;
  }
  const inflows = normalizeEtfItems(
    Array.isArray(payload.jlrnames) ? payload.jlrnames : [],
    Array.isArray(payload.jlrvalues) ? payload.jlrvalues : [],
    Array.isArray(payload.jlrgmbh) ? payload.jlrgmbh : [],
    'inflow'
  );
  const outflows = normalizeEtfItems(
    Array.isArray(payload.jlcnames) ? payload.jlcnames : [],
    Array.isArray(payload.jlcvalues) ? payload.jlcvalues : [],
    Array.isArray(payload.jlcgmbh) ? payload.jlcgmbh : [],
    'outflow'
  );
  if (inflows.length + outflows.length === 0) {
    const error = new Error('ETF provider returned an empty ranking');
    error.code = 'ETF_DATA_UNAVAILABLE';
    throw error;
  }
  return {
    availability: 'available',
    asOf: String(payload.time),
    frequency: 'daily-after-close',
    unit: '亿元',
    items: inflows.concat(outflows),
    methodology: '行业常用估算口径：净申购赎回额 ≈ 份额变化（当日场内流通份额－前一交易日场内流通份额）× 当日均价。当前榜单值由数据提供方发布，并非 WebStock 用逐只基金原始份额独立复算。',
    formula: '(currentShares - previousShares) * dailyAveragePrice',
    source: {
      provider: '证券之星 ETF 数据宝',
      url: ETF_SOURCE_URL,
      provenanceTier: 'public-secondary-provider',
      calculationMode: 'provider-published-estimate'
    },
    truthStatement: '这是日终ETF申赎资金估算，不是盘中逐笔主动买卖资金。'
  };
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlTag(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : '';
}

function normalizeTradingDay(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function parseCffexPositionXml(xml) {
  const blocks = String(xml || '').match(/<data\b[\s\S]*?<\/data>/gi) || [];
  return blocks.map(function(block) {
    const datatype = xmlTag(block, 'datatypeid');
    const positionType = datatype === '1' ? 'long' : datatype === '2' ? 'short' : 'turnover';
    return {
      product: xmlTag(block, 'productid').toUpperCase(),
      contract: xmlTag(block, 'instrumentid').toUpperCase(),
      tradingDay: normalizeTradingDay(xmlTag(block, 'tradingday')),
      positionType,
      rank: finiteNumber(xmlTag(block, 'rank')),
      member: xmlTag(block, 'shortname'),
      volume: finiteNumber(xmlTag(block, 'volume')),
      change: finiteNumber(xmlTag(block, 'varvolume'))
    };
  }).filter(function(row) {
    return row.product && row.contract && row.tradingDay && row.rank !== null &&
      row.volume !== null && row.change !== null;
  });
}

function focusMemberName(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  return /^中信期货(?:$|[（(]|有限)/.test(compact) ? '中信期货' : '';
}

function aggregateCffexPositionRows(rows = []) {
  const contracts = new Map();
  rows.forEach(function(row) {
    if (!CFFEX_PRODUCTS.includes(row.product)) return;
    if (!['long', 'short'].includes(row.positionType)) return;
    if (!Number.isFinite(row.rank) || row.rank < 1 || row.rank > 20) return;
    const key = `${row.product}:${row.contract}:${row.tradingDay}`;
    if (!contracts.has(key)) {
      contracts.set(key, {
        product: row.product,
        contract: row.contract,
        tradingDay: row.tradingDay,
        disclosedLong: 0,
        disclosedLongChange: 0,
        disclosedShort: 0,
        disclosedShortChange: 0,
        focusMembers: new Map()
      });
    }
    const item = contracts.get(key);
    if (row.positionType === 'long') {
      item.disclosedLong += row.volume;
      item.disclosedLongChange += row.change;
    } else {
      item.disclosedShort += row.volume;
      item.disclosedShortChange += row.change;
    }
    const memberName = focusMemberName(row.member);
    if (memberName) {
      if (!item.focusMembers.has(memberName)) {
        item.focusMembers.set(memberName, {
          member: memberName,
          disclosedLong: 0,
          disclosedLongChange: 0,
          disclosedShort: 0,
          disclosedShortChange: 0,
          hasLong: false,
          hasShort: false
        });
      }
      const member = item.focusMembers.get(memberName);
      if (row.positionType === 'long') {
        member.disclosedLong += row.volume;
        member.disclosedLongChange += row.change;
        member.hasLong = true;
      } else {
        member.disclosedShort += row.volume;
        member.disclosedShortChange += row.change;
        member.hasShort = true;
      }
    }
  });

  return Array.from(contracts.values()).map(function(item) {
    const imbalance = item.disclosedLong - item.disclosedShort;
    const focusMembers = Array.from(item.focusMembers.values()).filter(function(member) {
      return member.hasLong && member.hasShort;
    }).map(function(member) {
      const memberImbalance = member.disclosedLong - member.disclosedShort;
      return {
        member: member.member,
        disclosedLong: member.disclosedLong,
        disclosedLongChange: member.disclosedLongChange,
        disclosedShort: member.disclosedShort,
        disclosedShortChange: member.disclosedShortChange,
        rankedMemberImbalance: memberImbalance,
        rankedMemberImbalanceChange: member.disclosedLongChange - member.disclosedShortChange,
        direction: memberImbalance > 0 ? 'ranked-net-long' : memberImbalance < 0 ? 'ranked-net-short' : 'balanced'
      };
    });
    return {
      product: item.product,
      contract: item.contract,
      tradingDay: item.tradingDay,
      disclosedLong: item.disclosedLong,
      disclosedLongChange: item.disclosedLongChange,
      disclosedShort: item.disclosedShort,
      disclosedShortChange: item.disclosedShortChange,
      rankedMemberImbalance: imbalance,
      rankedMemberImbalanceChange: item.disclosedLongChange - item.disclosedShortChange,
      direction: imbalance > 0 ? 'ranked-net-long' : imbalance < 0 ? 'ranked-net-short' : 'balanced',
      scope: 'cffex-disclosed-ranked-members',
      focusMembers
    };
  }).sort(function(a, b) {
    return a.product.localeCompare(b.product) || a.contract.localeCompare(b.contract);
  });
}

async function defaultFetchEtfPayload() {
  const response = await axios.get(ETF_DATA_URL, {
    timeout: 12000,
    maxContentLength: 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 WebStock/1.1' }
  });
  return response.data;
}

async function defaultFetchCffexProductXml(product, tradingDay) {
  const compactDate = String(tradingDay).replace(/-/g, '');
  if (!/^\d{8}$/.test(compactDate) || !CFFEX_PRODUCTS.includes(product)) {
    throw new Error('invalid CFFEX product or trading day');
  }
  const path = `/sj/ccpm/${compactDate.slice(0, 6)}/${compactDate.slice(6, 8)}/${product}.xml`;
  const protocols = cffexSecureTransportAvailable === false ? ['http'] : ['https', 'http'];
  let lastError = null;
  for (const protocol of protocols) {
    try {
      const response = await axios.get(`${protocol}://www.cffex.com.cn${path}`, {
        timeout: protocol === 'https' ? 3500 : 12000,
        responseType: 'text',
        transformResponse: [function(data) { return data; }],
        maxContentLength: 2 * 1024 * 1024,
        headers: { 'User-Agent': 'Mozilla/5.0 WebStock/1.1' }
      });
      cffexSecureTransportAvailable = protocol === 'https';
      return response.data;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('CFFEX request failed');
}

function formatBeijingDate(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cffexCandidateTradingDays(now, preferredDay) {
  const candidates = [];
  let cursor = new Date(now.getTime());
  const beijingClock = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  if (beijingClock.getUTCHours() < 17) cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 12 && candidates.length < 8; attempt += 1) {
    const shifted = new Date(cursor.getTime() + 8 * 60 * 60 * 1000);
    const weekday = shifted.getUTCDay();
    const date = formatBeijingDate(cursor);
    if (weekday !== 0 && weekday !== 6 && !candidates.includes(date)) candidates.push(date);
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(preferredDay || '')) && !candidates.includes(preferredDay)) {
    candidates.push(preferredDay);
  }
  return candidates;
}

async function fetchCffexSnapshot(fetchProductXml, candidateDays) {
  let lastError = null;
  for (const tradingDay of candidateDays) {
    try {
      const firstXml = await fetchProductXml(CFFEX_PRODUCTS[0], tradingDay);
      const remainingXml = await Promise.all(CFFEX_PRODUCTS.slice(1).map(function(product) {
        return fetchProductXml(product, tradingDay);
      }));
      const items = aggregateCffexPositionRows([firstXml].concat(remainingXml).flatMap(parseCffexPositionXml));
      if (items.length > 0) return items;
      lastError = new Error(`CFFEX returned no disclosed position rankings for ${tradingDay}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No settled CFFEX trading day is available');
}

function unavailableSection(code, message, checkedAt, truthStatement) {
  return {
    availability: 'unavailable',
    asOf: null,
    checkedAt,
    items: [],
    error: { code, message },
    truthStatement
  };
}

function createMarketInstitutionalFlowService(options = {}) {
  const now = options.now || (() => new Date());
  const fetchEtfPayload = options.fetchEtfPayload || defaultFetchEtfPayload;
  const fetchCffexProductXml = options.fetchCffexProductXml || defaultFetchCffexProductXml;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : 15 * 60 * 1000;
  let cache = null;

  async function getSnapshot(input = {}) {
    const force = input.force === true;
    const clock = now();
    const checkedAt = clock.toISOString();
    if (!force && cache && clock.getTime() - cache.savedAt < cacheTtlMs) return cache.value;

    let etf;
    try {
      etf = normalizeStockstarEtfPayload(await fetchEtfPayload());
      etf.checkedAt = checkedAt;
    } catch (error) {
      etf = unavailableSection(
        'ETF_DATA_UNAVAILABLE',
        error.message || String(error),
        checkedAt,
        'ETF日终估算数据当前不可用，未使用行情成交额或其他指标冒充。'
      );
      etf.source = { provider: '证券之星 ETF 数据宝', url: ETF_SOURCE_URL };
    }

    let futures;
    try {
      const items = (await fetchCffexSnapshot(
        fetchCffexProductXml,
        cffexCandidateTradingDays(clock, etf.asOf)
      )).map(function(item) {
        return { ...item, productName: PRODUCT_NAMES[item.product] || item.product };
      });
      futures = {
        availability: 'available',
        asOf: items[0].tradingDay,
        checkedAt,
        frequency: 'daily-after-close',
        unit: '手',
        items,
        source: {
          provider: '中国金融期货交易所（中金所）',
          url: CFFEX_SOURCE_URL,
          provenanceTier: 'official-exchange-disclosure'
        },
        methodology: '单合约持仓差＝该合约披露持买量－披露持卖量；全部可比合约合计＝逐合约中信期货披露持买量之和－逐合约披露持卖量之和。仅统计中信期货在持买、持卖两侧都进入前20名的合约；代表合约另按每个品种披露持买与持卖总量最大的合约选取，不能代替全部合约合计。',
        truthStatement: '这是披露排名会员的客户经纪业务持仓差，不是全市场净多/净空；全市场多空持仓在会计意义上必然相等。'
      };
    } catch (error) {
      futures = unavailableSection(
        'CFFEX_DATA_UNAVAILABLE',
        error.message || String(error),
        checkedAt,
        '中金所排名数据当前不可用，未使用第三方估算或历史旧值替代，未使用替代值。'
      );
      futures.source = { provider: '中国金融期货交易所（中金所）', url: CFFEX_SOURCE_URL };
    }

    const value = {
      schema: 'webstock.market-institutional-flow.v1',
      checkedAt,
      etf,
      futures
    };
    cache = { savedAt: clock.getTime(), value };
    return value;
  }

  return { getSnapshot };
}

module.exports = {
  ETF_SOURCE_URL,
  CFFEX_SOURCE_URL,
  calculateEtfEstimatedFlow,
  normalizeStockstarEtfPayload,
  parseCffexPositionXml,
  aggregateCffexPositionRows,
  cffexCandidateTradingDays,
  createMarketInstitutionalFlowService
};
