const axios = require('axios');

const CBOE_VIX_HISTORY_URL = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv';
const EASTMONEY_HOSTS = [
  'https://push2.eastmoney.com',
  'https://41.push2.eastmoney.com',
  'https://33.push2.eastmoney.com'
];
const EASTMONEY_TOKEN = 'bd1d9ddb04089700cf9c27f6f7426281';
const SINA_MARKET_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const CACHE_TTL_MS = 30 * 60 * 1000;

let cachedOverview = null;

function isExternalDisabled() {
  return process.env.WEBSTOCK_SENTIMENT_OFFLINE === '1' || process.env.NODE_ENV === 'test';
}

function round(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits == null ? 2 : digits));
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function parseCsvLine(line) {
  return String(line || '').split(',').map(item => item.trim());
}

function parseVixHistory(csvText) {
  const lines = String(csvText || '').trim().split(/\r?\n/).filter(Boolean);
  const rows = lines.slice(1).map(line => {
    const [date, open, high, low, close] = parseCsvLine(line);
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close)
    };
  }).filter(row => row.date && Number.isFinite(row.close));
  const latest = rows[rows.length - 1] || null;
  const previous = rows[rows.length - 2] || null;
  if (!latest) throw new Error('VIX history is empty');
  const change = previous ? latest.close - previous.close : null;
  return {
    date: latest.date,
    value: round(latest.close, 2),
    change: round(change, 2),
    changePct: previous && previous.close ? round(change / previous.close * 100, 2) : null
  };
}

function labelVix(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '未知';
  if (n >= 30) return '高度恐慌';
  if (n >= 20) return '风险升温';
  if (n >= 15) return '中性波动';
  return '低波动';
}

function labelScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return '未知';
  if (n < 25) return '极度恐慌';
  if (n < 45) return '偏恐慌';
  if (n <= 55) return '中性';
  if (n <= 75) return '偏贪婪';
  return '过热';
}

async function fetchVix() {
  const response = await axios.get(CBOE_VIX_HISTORY_URL, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 WebStock' }
  });
  const vix = parseVixHistory(response.data);
  return Object.assign(vix, {
    name: 'Cboe VIX',
    label: labelVix(vix.value),
    source: 'Cboe VIX History CSV',
    sourceUrl: CBOE_VIX_HISTORY_URL,
    meaning: 'VIX 用标普 500 指数期权价格估算未来 30 天预期波动率，数值越高通常代表美股风险偏好越谨慎。'
  });
}

async function eastmoneyGet(params, timeoutMs) {
  if (isExternalDisabled()) throw new Error('external sentiment fetch disabled');
  const errors = [];
  for (const host of EASTMONEY_HOSTS) {
    try {
      const response = await axios.get(host + '/api/qt/clist/get', {
        params,
        timeout: timeoutMs || 6500,
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 WebStock'
        }
      });
      if (response.data && response.data.rc === 0) return response.data;
      throw new Error('Eastmoney rc=' + (response.data && response.data.rc));
    } catch (error) {
      errors.push(host + ': ' + (error.message || error.code || 'failed'));
    }
  }
  throw new Error(errors.join(' | '));
}

async function fetchAshareSnapshot() {
  const rows = [];
  for (let page = 1; page <= 5; page++) {
    const payload = await eastmoneyGet({
      pn: page,
      pz: 100,
      po: 1,
      np: 1,
      ut: EASTMONEY_TOKEN,
      fltt: 2,
      invt: 2,
      fid: 'f6',
      fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
      fields: 'f12,f14,f2,f3,f4,f5,f6,f20'
    }, 8000);
    const diff = payload && payload.data && Array.isArray(payload.data.diff) ? payload.data.diff : [];
    rows.push(...diff);
    if (diff.length < 100) break;
  }
  return rows.map(row => ({
    code: String(row.f12 || ''),
    name: String(row.f14 || row.f12 || ''),
    price: round(row.f2, 3),
    changePct: round(row.f3, 2),
    amount: round(row.f6, 0)
  })).filter(item => item.code && Number.isFinite(Number(item.changePct)));
}

async function fetchSinaAshareSnapshot() {
  if (isExternalDisabled()) throw new Error('external sentiment fetch disabled');
  const samplePages = [1, 8, 16, 24, 32, 40, 48, 56];
  const results = await Promise.all(samplePages.map(async function(page) {
    const response = await axios.get(SINA_MARKET_URL, {
      params: {
        page,
        num: 100,
        sort: 'code',
        asc: 1,
        node: 'hs_a',
        symbol: '',
        _s_r_a: 'page'
      },
      timeout: 7000,
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0 WebStock'
      }
    });
    return Array.isArray(response.data) ? response.data : [];
  }));
  return results.flat().map(row => ({
    code: String(row.code || '').replace(/\D/g, '').slice(-6),
    name: String(row.name || row.code || ''),
    price: round(row.trade, 3),
    changePct: round(row.changepercent, 2),
    amount: round(row.amount, 0)
  })).filter(item => item.code && Number.isFinite(Number(item.changePct)));
}

function fallbackAshareSnapshot() {
  return [
    { code: '000001', name: '样本银行', changePct: -0.8, amount: 900000000 },
    { code: '300308', name: '样本科技', changePct: 3.2, amount: 1200000000 },
    { code: '688981', name: '样本芯片', changePct: 1.5, amount: 1600000000 },
    { code: '600519', name: '样本消费', changePct: -1.2, amount: 1500000000 },
    { code: '002230', name: '样本算力', changePct: 5.4, amount: 1100000000 },
    { code: '600030', name: '样本券商', changePct: -3.1, amount: 1000000000 }
  ];
}

function calcAshareSentiment(stocks, sourceStatus) {
  const items = (stocks || []).filter(item => Number.isFinite(Number(item.changePct)));
  const total = items.length;
  if (!total) throw new Error('A-share snapshot is empty');
  const advancing = items.filter(item => Number(item.changePct) > 0).length;
  const declining = items.filter(item => Number(item.changePct) < 0).length;
  const strong = items.filter(item => Number(item.changePct) >= 3).length;
  const weak = items.filter(item => Number(item.changePct) <= -3).length;
  const limitUpLike = items.filter(item => Number(item.changePct) >= 9.5).length;
  const sharpDown = items.filter(item => Number(item.changePct) <= -5).length;
  const avgChange = items.reduce((sum, item) => sum + Number(item.changePct), 0) / total;
  const breadthScore = advancing / total * 100;
  const changeScore = clamp(50 + avgChange * 9, 0, 100);
  const strengthScore = clamp(50 + (strong - weak) / total * 220, 0, 100);
  const tailRiskPenalty = clamp((sharpDown / total) * 140, 0, 25);
  const score = round(
    breadthScore * 0.45 +
    changeScore * 0.30 +
    strengthScore * 0.25 -
    tailRiskPenalty,
    0
  );

  return {
    name: 'A股情绪分',
    score,
    label: labelScore(score),
    total,
    advancing,
    declining,
    breadthPct: round(advancing / total * 100, 2),
    avgChangePct: round(avgChange, 2),
    strongCount: strong,
    weakCount: weak,
    limitUpLike,
    sharpDown,
    components: [
      { name: '上涨家数占比', score: round(breadthScore, 0), value: advancing + '/' + total },
      { name: '平均涨跌幅', score: round(changeScore, 0), value: round(avgChange, 2) + '%' },
      { name: '强弱股差', score: round(strengthScore, 0), value: strong + ' 强 / ' + weak + ' 弱' }
    ],
    sourceStatus,
    source: sourceStatus === 'fallback' ? '内置样本兜底' : (sourceStatus === 'sina' ? '新浪财经 A 股行情跨页抽样' : '东方财富沪深京 A 股行情快照'),
    meaning: 'A股情绪分由上涨家数占比、平均涨跌幅、强弱股差和大跌尾部风险合成，0 表示恐慌，100 表示过热。'
  };
}

async function buildOverview(options = {}) {
  if (!options.refresh && cachedOverview && Date.now() - cachedOverview.ts < CACHE_TTL_MS) {
    return Object.assign({}, cachedOverview.data, { cached: true });
  }

  const errors = [];
  let vix = null;
  let stocks = null;
  let sourceStatus = 'live';

  try {
    vix = isExternalDisabled()
      ? { name: 'Cboe VIX', date: 'sample', value: 18.6, change: -0.4, changePct: -2.1, label: '中性波动', source: '测试样本', meaning: 'VIX 用标普 500 指数期权价格估算未来 30 天预期波动率。' }
      : await fetchVix();
  } catch (error) {
    errors.push('VIX: ' + error.message);
  }

  try {
    stocks = await fetchAshareSnapshot();
  } catch (error) {
    errors.push('A-share breadth: ' + error.message);
    try {
      sourceStatus = 'sina';
      stocks = await fetchSinaAshareSnapshot();
    } catch (sinaError) {
      sourceStatus = 'fallback';
      errors.push('Sina A-share breadth: ' + sinaError.message);
      stocks = fallbackAshareSnapshot();
    }
  }

  const aShare = calcAshareSentiment(stocks, sourceStatus);
  const data = {
    updatedAt: new Date().toISOString(),
    tradeDate: aShare.sourceStatus === 'fallback' ? 'sample' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
    aShare,
    vix,
    fearGreed: {
      name: 'CNN Fear & Greed',
      value: null,
      label: '说明项',
      meaning: 'CNN Fear & Greed Index 是 0-100 的美股情绪指标，综合市场动量、股价强度、市场宽度、看跌/看涨期权、市场波动率、避险需求和垃圾债需求七类指标。',
      source: 'CNN methodology reference'
    },
    errors,
    cached: false
  };
  cachedOverview = { ts: Date.now(), data };
  return data;
}

module.exports = {
  buildOverview,
  parseVixHistory,
  calcAshareSentiment,
  fetchSinaAshareSnapshot,
  labelScore,
  labelVix
};
