const axios = require('axios');
const db = require('../db');
const sectorService = require('./sectorService');
const newsService = require('./newsService');
const { toSinaSymbol } = require('../utils/market');

const EASTMONEY_HOSTS = [
  'https://push2.eastmoney.com',
  'https://41.push2.eastmoney.com',
  'https://33.push2.eastmoney.com'
];
const EASTMONEY_KLINE_HOSTS = [
  'https://push2his.eastmoney.com',
  'https://41.push2his.eastmoney.com'
];
const EASTMONEY_TOKEN = 'bd1d9ddb04089700cf9c27f6f7426281';
const SINA_MARKET_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_NODES_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodes';
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedOverview = null;
let cachedSinaNodes = null;

function todayString() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
}

function currentMonthKey() {
  return todayString().slice(0, 7);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits == null ? 2 : digits));
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function formatYi(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return (n / 100000000).toFixed(2) + '亿';
}

function calcHeatScore(metrics) {
  const dailyChange = Number(metrics.dailyChangePct) || 0;
  const amount = Number(metrics.amount) || 0;
  const activeStocks = Number(metrics.activeStocks) || 0;
  const strongStocks = Number(metrics.strongStocks) || 0;
  const limitUpLike = Number(metrics.limitUpLike) || 0;
  const mainNetInflow = Math.max(Math.abs(Number(metrics.mainNetInflow) || 0), 1);
  const amountScore = Math.log10(Math.max(amount, 1));
  const flowScore = metrics.mainNetInflow == null ? 0 : Math.log10(mainNetInflow);
  return round(dailyChange * 4 + amountScore * 1.6 + activeStocks * 0.8 + strongStocks * 1.2 + limitUpLike * 2 + flowScore * 0.8, 2);
}

function withRankReason(board, metrics) {
  const parts = [
    '热度分 ' + (Number.isFinite(Number(board.heatScore)) ? Number(board.heatScore).toFixed(2) : '--'),
    '日涨幅 ' + formatPct(board.dailyChangePct),
    '成交额 ' + formatYi(board.amount)
  ];
  if (metrics && Number.isFinite(Number(metrics.activeStocks))) parts.push('活跃股 ' + metrics.activeStocks);
  if (metrics && Number.isFinite(Number(metrics.strongStocks))) parts.push('大涨股 ' + metrics.strongStocks);
  if (board.mainNetInflow !== null && board.mainNetInflow !== undefined) parts.push('主力净流入 ' + formatYi(board.mainNetInflow));
  return Object.assign({}, board, {
    rankMetrics: metrics || {},
    rankReason: parts.join(' / ')
  });
}

function isExternalDisabled() {
  return process.env.WEBSTOCK_HOT_MARKET_OFFLINE === '1' || process.env.NODE_ENV === 'test';
}

async function eastmoneyGet(path, params, hosts, timeoutMs) {
  if (isExternalDisabled()) throw new Error('external hot market fetch disabled');
  const errors = [];
  for (const host of hosts || EASTMONEY_HOSTS) {
    try {
      const response = await axios.get(host + path, {
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

async function sinaGet(url, params, timeoutMs) {
  if (isExternalDisabled()) throw new Error('external hot market fetch disabled');
  const response = await axios.get(url, {
    params,
    timeout: timeoutMs || 8000,
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0 WebStock'
    }
  });
  return response.data;
}

function mapBoard(row, kind) {
  const mainNetInflow = numberOrNull(row.f62);
  const dailyChangePct = numberOrNull(row.f3);
  const amount = numberOrNull(row.f6);
  const metrics = {
    dailyChangePct,
    amount,
    mainNetInflow,
    activeStocks: null,
    strongStocks: null,
    limitUpLike: null
  };
  const board = {
    code: String(row.f12 || ''),
    name: String(row.f14 || ''),
    kind,
    latestPoint: numberOrNull(row.f2),
    dailyChangePct,
    dailyChangeAmount: numberOrNull(row.f4),
    volume: numberOrNull(row.f5),
    amount,
    totalMarketValue: numberOrNull(row.f20),
    mainNetInflow,
    leaderName: String(row.f128 || row.f207 || ''),
    leaderCode: String(row.f140 || row.f208 || ''),
    leaderChangePct: numberOrNull(row.f136),
    heatScore: calcHeatScore(metrics)
  };
  return withRankReason(board, metrics);
}

function mapStock(row, sectorName) {
  return {
    code: String(row.f12 || ''),
    name: String(row.f14 || row.f12 || ''),
    sectorName: sectorName || '',
    price: numberOrNull(row.f2),
    changePct: numberOrNull(row.f3),
    changeAmount: numberOrNull(row.f4),
    volume: numberOrNull(row.f5),
    amount: numberOrNull(row.f6),
    totalMarketValue: numberOrNull(row.f20),
    mainNetInflow: numberOrNull(row.f62)
  };
}

function mapSinaStock(row, sectorName) {
  return {
    code: String(row.code || '').replace(/\D/g, '').slice(-6),
    name: String(row.name || row.code || ''),
    sectorName: sectorName || '',
    price: numberOrNull(row.trade),
    changePct: numberOrNull(row.changepercent),
    changeAmount: numberOrNull(row.pricechange),
    volume: numberOrNull(row.volume),
    amount: numberOrNull(row.amount),
    totalMarketValue: Number.isFinite(Number(row.mktcap)) ? Number(row.mktcap) * 10000 : null,
    mainNetInflow: null,
    symbol: row.symbol || ''
  };
}

async function fetchBoardRank(kind, limit) {
  const fs = kind === 'concept' ? 'm:90+t:3+f:!50' : 'm:90+t:2+f:!50';
  const payload = await eastmoneyGet('/api/qt/clist/get', {
    pn: 1,
    pz: Math.max(limit || 12, 12),
    po: 1,
    np: 1,
    ut: EASTMONEY_TOKEN,
    fltt: 2,
    invt: 2,
    fid: 'f3',
    fs,
    fields: 'f12,f14,f2,f3,f4,f5,f6,f20,f62,f128,f136,f140,f141,f207,f208,f209'
  }, EASTMONEY_HOSTS);
  const rows = payload && payload.data && Array.isArray(payload.data.diff) ? payload.data.diff : [];
  return rows.map(row => mapBoard(row, kind)).filter(item => item.code && item.name);
}

async function fetchBoardMembers(board, limit) {
  if (!board || !board.code) return [];
  try {
    const payload = await eastmoneyGet('/api/qt/clist/get', {
      pn: 1,
      pz: Math.max(limit || 8, 8),
      po: 1,
      np: 1,
      ut: EASTMONEY_TOKEN,
      fltt: 2,
      invt: 2,
      fid: 'f3',
      fs: 'b:' + board.code,
      fields: 'f12,f14,f2,f3,f4,f5,f6,f20,f62'
    }, EASTMONEY_HOSTS, 4500);
    const rows = payload && payload.data && Array.isArray(payload.data.diff) ? payload.data.diff : [];
    return rows.map(row => mapStock(row, board.name)).filter(item => item.code && item.name);
  } catch (error) {
    if (board.leaderCode || board.leaderName) {
      return [{
        code: board.leaderCode || '',
        name: board.leaderName || board.leaderCode || '',
        sectorName: board.name,
        price: null,
        changePct: board.leaderChangePct,
        amount: null,
        mainNetInflow: null
      }].filter(item => item.code || item.name);
    }
    return [];
  }
}

function calcMonthStats(klines) {
  const rows = (klines || []).map(line => {
    const parts = String(line || '').split(',');
    return {
      date: parts[0],
      open: numberOrNull(parts[1]),
      close: numberOrNull(parts[2]),
      amount: numberOrNull(parts[6]),
      changePct: numberOrNull(parts[8])
    };
  }).filter(item => item.date && Number.isFinite(Number(item.close)));
  if (!rows.length) return {};

  const currentMonthRows = rows.filter(item => item.date && item.date.slice(0, 7) === currentMonthKey());
  const windowRows = currentMonthRows.length >= 2 ? currentMonthRows : rows.slice(-20);
  const first = windowRows[0];
  const last = windowRows[windowRows.length - 1];
  const base = Number(first.open || first.close);
  const monthChangePct = base ? round((Number(last.close) - base) / base * 100, 2) : null;
  const upDays = windowRows.filter(item => Number(item.changePct) > 0).length;
  const amount = round(windowRows.reduce((sum, item) => sum + (Number(item.amount) || 0), 0), 0);
  return {
    monthChangePct,
    monthAmount: amount,
    upDays,
    sampleDays: windowRows.length,
    monthStart: first.date,
    monthEnd: last.date
  };
}

async function enrichBoardsWithMonthStats(boards) {
  return Promise.all((boards || []).map(async function(board) {
    if (!/^BK\d+$/i.test(String(board.code || ''))) {
      const monthStats = await calcSinaBoardMonthStats(board);
      return Object.assign({}, board, {
        monthChangePct: null,
        sampleDays: 0
      }, monthStats);
    }
    try {
      const payload = await eastmoneyGet('/api/qt/stock/kline/get', {
        secid: '90.' + board.code,
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        klt: 101,
        fqt: 1,
        lmt: 35,
        end: 20500101
      }, EASTMONEY_KLINE_HOSTS, 4500);
      const klines = payload && payload.data && Array.isArray(payload.data.klines) ? payload.data.klines : [];
      return Object.assign({}, board, calcMonthStats(klines));
    } catch (error) {
      return Object.assign({}, board, {
        monthChangePct: null,
        sampleDays: 0
      });
    }
  }));
}

async function fetchHotStocks(limit) {
  const payload = await eastmoneyGet('/api/qt/clist/get', {
    pn: 1,
    pz: Math.max(limit || 20, 20),
    po: 1,
    np: 1,
    ut: EASTMONEY_TOKEN,
    fltt: 2,
    invt: 2,
    fid: 'f3',
    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
    fields: 'f12,f14,f2,f3,f4,f5,f6,f20,f62'
  }, EASTMONEY_HOSTS);
  const rows = payload && payload.data && Array.isArray(payload.data.diff) ? payload.data.diff : [];
  return rows.map(row => mapStock(row, '')).filter(item => item.code && item.name);
}

function collectSinaIndustryNodes(payload) {
  const nodes = [];
  function walk(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'string' && typeof value[2] === 'string' && /^new_/.test(value[2])) {
      nodes.push({ name: value[0], node: value[2] });
    }
    value.forEach(walk);
  }
  walk(payload);
  return nodes.filter(function(item) { return item.node !== 'new_qtxy'; });
}

async function getSinaIndustryNodes() {
  if (cachedSinaNodes && Date.now() - cachedSinaNodes.ts < 24 * 60 * 60 * 1000) return cachedSinaNodes.items;
  const payload = await sinaGet(SINA_NODES_URL, {}, 8000);
  const items = collectSinaIndustryNodes(payload);
  if (!items.length) throw new Error('Sina industry nodes empty');
  cachedSinaNodes = { ts: Date.now(), items };
  return items;
}

async function mapLimit(items, limit, worker) {
  const result = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async function() {
    while (index < items.length) {
      const current = items[index++];
      result.push(await worker(current));
    }
  });
  await Promise.all(runners);
  return result;
}

async function fetchSinaNodeStocks(node, sectorName, limit) {
  const data = await sinaGet(SINA_MARKET_URL, {
    page: 1,
    num: Math.max(limit || 6, 6),
    sort: 'changepercent',
    asc: 0,
    node,
    symbol: '',
    _s_r_a: 'page'
  }, 7000);
  return (Array.isArray(data) ? data : []).map(row => mapSinaStock(row, sectorName)).filter(item => item.code && item.name);
}

async function fetchSinaIndustryRank(limit, options = {}) {
  const nodes = await getSinaIndustryNodes();
  const nodeLimit = Math.min(Math.max(Number(options.nodeLimit) || 60, limit || 12), 80);
  const memberLimit = Math.min(Math.max(Number(options.memberLimit) || 10, 5), 20);
  const boards = await mapLimit(nodes.slice(0, nodeLimit), 6, async function(node) {
    try {
      const stocks = await fetchSinaNodeStocks(node.node, node.name, memberLimit);
      if (!stocks.length) return null;
      const top = stocks.slice(0, 5);
      const avgChange = top.reduce((sum, stock) => sum + (Number(stock.changePct) || 0), 0) / top.length;
      const amount = stocks.reduce((sum, stock) => sum + (Number(stock.amount) || 0), 0);
      const metrics = {
        dailyChangePct: round(avgChange, 2),
        amount,
        mainNetInflow: null,
        activeStocks: stocks.length,
        strongStocks: stocks.filter(stock => Number(stock.changePct) >= 5).length,
        limitUpLike: stocks.filter(stock => Number(stock.changePct) >= 9.8).length
      };
      const board = {
        code: node.node,
        name: node.name,
        kind: 'sina-industry',
        latestPoint: null,
        dailyChangePct: metrics.dailyChangePct,
        dailyChangeAmount: null,
        volume: stocks.reduce((sum, stock) => sum + (Number(stock.volume) || 0), 0),
        amount,
        totalMarketValue: null,
        mainNetInflow: null,
        leaderName: stocks[0].name,
        leaderCode: stocks[0].code,
        leaderChangePct: stocks[0].changePct,
        monthChangePct: null,
        sampleDays: 0,
        heatScore: calcHeatScore(metrics),
        stocks
      };
      return withRankReason(board, metrics);
    } catch (error) {
      return null;
    }
  });
  return boards.filter(Boolean)
    .sort(function(a, b) { return (Number(b.heatScore) || 0) - (Number(a.heatScore) || 0); })
    .slice(0, limit || 12);
}

async function fetchSinaHotStocks(limit) {
  const data = await sinaGet(SINA_MARKET_URL, {
    page: 1,
    num: Math.max(limit || 20, 20),
    sort: 'changepercent',
    asc: 0,
    node: 'hs_a',
    symbol: '',
    _s_r_a: 'page'
  }, 8000);
  return (Array.isArray(data) ? data : []).map(row => mapSinaStock(row, '')).filter(item => item.code && item.name);
}

function calcSinaStockMonthStats(rows) {
  const parsed = (Array.isArray(rows) ? rows : []).map(function(row) {
    return {
      date: row.day || '',
      open: numberOrNull(row.open),
      close: numberOrNull(row.close),
      amount: numberOrNull(row.amount)
    };
  }).filter(item => item.date && Number.isFinite(Number(item.close)));
  if (!parsed.length) return null;
  const monthRows = parsed.filter(item => item.date.slice(0, 7) === currentMonthKey());
  const windowRows = monthRows.length >= 2 ? monthRows : parsed.slice(-20);
  const first = windowRows[0];
  const last = windowRows[windowRows.length - 1];
  const base = Number(first.open || first.close);
  return {
    changePct: base ? round((Number(last.close) - base) / base * 100, 2) : null,
    amount: round(windowRows.reduce((sum, item) => sum + (Number(item.amount) || 0), 0), 0),
    sampleDays: windowRows.length,
    start: first.date,
    end: last.date
  };
}

async function fetchSinaStockMonthStats(stock) {
  const rows = await sinaGet('https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData', {
    symbol: stock.symbol || toSinaSymbol(stock.code),
    scale: 240,
    ma: 'no',
    datalen: 40,
    klt: 100
  }, 6000);
  return calcSinaStockMonthStats(rows);
}

async function calcSinaBoardMonthStats(board) {
  const stocks = (board.stocks || []).slice(0, 3);
  if (!stocks.length || isExternalDisabled()) return {};
  const stats = (await Promise.all(stocks.map(function(stock) {
    return fetchSinaStockMonthStats(stock).catch(function() { return null; });
  }))).filter(Boolean);
  if (!stats.length) return {};
  const validChanges = stats.map(item => item.changePct).filter(value => Number.isFinite(Number(value)));
  return {
    monthChangePct: validChanges.length
      ? round(validChanges.reduce((sum, value) => sum + Number(value), 0) / validChanges.length, 2)
      : null,
    monthAmount: round(stats.reduce((sum, item) => sum + (Number(item.amount) || 0), 0), 0),
    sampleDays: Math.max.apply(null, stats.map(item => item.sampleDays || 0)),
    monthStart: stats.map(item => item.start).filter(Boolean).sort()[0] || '',
    monthEnd: stats.map(item => item.end).filter(Boolean).sort().pop() || '',
    monthBasis: 'leader-stock-sample'
  };
}

function buildFallbackBoards() {
  const sectors = sectorService.listSectors();
  return sectors.slice(0, 10).map(function(sector, index) {
    const stocks = sectorService.listLeaders(sector.id).slice(0, 8).map(function(leader) {
      return {
        code: leader.code,
        name: leader.name || leader.code,
        sectorName: sector.name,
        price: null,
        changePct: null,
        amount: null,
        mainNetInflow: null
      };
    });
    const board = {
      code: 'LOCAL' + sector.id,
      name: sector.name,
      kind: 'local',
      dailyChangePct: null,
      monthChangePct: null,
      amount: null,
      mainNetInflow: null,
      heatScore: 10 - index,
      sourceNote: '本地板块配置兜底',
      stocks
    };
    return withRankReason(board, {
      dailyChangePct: null,
      amount: null,
      activeStocks: stocks.length,
      strongStocks: null,
      limitUpLike: null
    });
  });
}

function fallbackHotStocks(boards) {
  return (boards || []).flatMap(board => (board.stocks || []).map(stock => Object.assign({}, stock, {
    sectorName: stock.sectorName || board.name
  }))).slice(0, 20);
}

function sortMonthBoards(boards) {
  return boards.slice().sort(function(a, b) {
    return (Number(b.monthChangePct) || -999) - (Number(a.monthChangePct) || -999);
  });
}

function latestSnapshotForToday() {
  const row = db.prepare(`
    SELECT id, payload_json, created_at
    FROM hot_market_snapshots
    WHERE snapshot_date = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `).get(todayString());
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json || '{}');
    payload.snapshotId = payload.snapshotId || row.id;
    if (Array.isArray(payload.news)) payload.news = payload.news.slice(0, 120);
    payload.cached = true;
    payload.cachedSnapshot = true;
    payload.snapshotCreatedAt = row.created_at;
    return payload;
  } catch (error) {
    return null;
  }
}

function dashboardTable(boards) {
  return (boards || []).slice(0, 12).map(function(board, index) {
    return [
      index + 1,
      board.name,
      board.kind,
      formatPct(board.dailyChangePct),
      formatPct(board.monthChangePct),
      formatYi(board.amount),
      formatYi(board.mainNetInflow),
      (board.stocks || []).slice(0, 5).map(stock => stock.name + '(' + stock.code + ')').join('、') || board.leaderName || ''
    ].join(' | ');
  }).join('\n');
}

function stockTable(stocks) {
  return (stocks || []).slice(0, 20).map(function(stock, index) {
    return [
      index + 1,
      stock.name,
      stock.code,
      stock.sectorName || '',
      formatPct(stock.changePct),
      formatYi(stock.amount),
      formatYi(stock.mainNetInflow)
    ].join(' | ');
  }).join('\n');
}

function newsTable(news) {
  return (news || []).slice(0, 12).map(function(item, index) {
    return [
      index + 1,
      item.title,
      item.source || '',
      item.time || '',
      item.summary || '',
      item.link || ''
    ].join(' | ');
  }).join('\n');
}

function buildPrompt(snapshot) {
  const dayBoards = (snapshot.boards && snapshot.boards.day) || [];
  const monthBoards = (snapshot.boards && snapshot.boards.month) || [];
  return [
    '你是一个谨慎的A股热点板块研究助手。请只基于我给出的数据做研究梳理，不要编造未提供的数据，不要给出真实下单指令。',
    '',
    '请输出可以被 WebStock 识别的一键复制结果，格式必须严格包含：',
    'WEBSTOCK_HOT_MARKET_ANALYSIS_START',
    '# 今日热点板块分析',
    '...你的 Markdown 分析...',
    'WEBSTOCK_HOT_MARKET_ANALYSIS_END',
    '',
    '分析要求：',
    '1. 分开说明“当日热度”和“当月持续性”，不要把单日上涨直接等同于趋势成立。',
    '2. 对每个重点板块写：触发因素、领涨股/核心股、成交额/资金流是否匹配、持续性观察点、风险点。',
    '3. 从资讯中提取可能的催化，但要标注“数据支持/仅资讯线索/需要验证”。',
    '4. 最后给一个观察清单：重点板块、重点个股、明天需要验证的数据、回避条件。',
    '5. 加上免责声明：仅供复盘研究，不构成投资建议。',
    '',
    '快照时间：' + (snapshot.generatedAt || ''),
    '交易日期：' + (snapshot.tradeDate || ''),
    '数据源：' + ((snapshot.sources || []).join('、') || '--'),
    '月度字段说明：东方财富板块指数可用时使用板块K线；新浪行业降级时使用行业内领涨股样本估算，必须在分析中标注“样本估算”。',
    '降级状态：' + (snapshot.degraded ? '是，部分外部接口失败，需人工复核' : '否'),
    '',
    '## 当日热门板块',
    '排名 | 板块 | 类型 | 日涨跌 | 月涨跌 | 成交额 | 主力净流入 | 核心股票',
    dashboardTable(dayBoards),
    '',
    '## 当月持续性靠前板块',
    '排名 | 板块 | 类型 | 日涨跌 | 月涨跌 | 成交额 | 主力净流入 | 核心股票',
    dashboardTable(monthBoards),
    '',
    '## 热门个股',
    '排名 | 名称 | 代码 | 所属板块 | 涨跌幅 | 成交额 | 主力净流入',
    stockTable(snapshot.hotStocks || []),
    '',
    '## 最新财经资讯',
    '序号 | 标题 | 来源 | 时间 | 摘要 | 链接',
    newsTable(snapshot.news || [])
  ].join('\n');
}

function saveSnapshot(snapshot) {
  const payload = JSON.stringify(snapshot);
  const info = db.prepare(`
    INSERT INTO hot_market_snapshots (snapshot_date, source, payload_json)
    VALUES (?, ?, ?)
  `).run(snapshot.tradeDate || todayString(), (snapshot.sources || []).join(','), payload);
  snapshot.snapshotId = info.lastInsertRowid;
  return snapshot;
}

function listSnapshots(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
  return db.prepare(`
    SELECT id, snapshot_date, source, payload_json, created_at
    FROM hot_market_snapshots
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(limit).map(function(row) {
    let payload = {};
    try { payload = JSON.parse(row.payload_json || '{}'); } catch (error) {}
    return {
      id: row.id,
      snapshotDate: row.snapshot_date,
      source: row.source,
      createdAt: row.created_at,
      summary: {
        dayBoards: payload.boards && payload.boards.day ? payload.boards.day.length : 0,
        hotStocks: payload.hotStocks ? payload.hotStocks.length : 0,
        news: payload.news ? payload.news.length : 0
      }
    };
  });
}

function saveAiResult(input = {}) {
  const resultText = String(input.resultText || '').trim();
  if (!resultText) throw new Error('resultText is required');
  const parsed = input.parsed && typeof input.parsed === 'object' ? JSON.stringify(input.parsed) : '';
  const info = db.prepare(`
    INSERT INTO hot_market_ai_results (snapshot_id, result_text, parsed_json)
    VALUES (?, ?, ?)
  `).run(input.snapshotId || null, resultText, parsed);
  return { id: info.lastInsertRowid };
}

async function getOverview(options = {}) {
  const refresh = Boolean(options.refresh);
  const fast = Boolean(options.fast);
  if (!refresh && cachedOverview && Date.now() - cachedOverview.ts < CACHE_TTL_MS) {
    return Object.assign({}, cachedOverview.data, { cached: true });
  }
  if (!refresh && fast) {
    const latest = latestSnapshotForToday();
    if (latest) return latest;
  }

  const startedAt = Date.now();
  const sources = [];
  const errors = [];
  let dayBoards = [];
  let hotStocks = [];

  try {
    const industry = await fetchBoardRank('industry', 10);
    const concept = await fetchBoardRank('concept', 10);
    dayBoards = industry.concat(concept)
      .sort(function(a, b) { return (Number(b.heatScore) || 0) - (Number(a.heatScore) || 0); })
      .slice(0, 12);
    sources.push('Eastmoney sector rank');
  } catch (error) {
    errors.push('Eastmoney sector rank: ' + error.message);
    try {
      dayBoards = await fetchSinaIndustryRank(fast ? 8 : 12, {
        nodeLimit: fast ? 30 : 60,
        memberLimit: fast ? 6 : 10
      });
      sources.push('Sina industry rank');
    } catch (sinaError) {
      errors.push('Sina industry rank: ' + sinaError.message);
      dayBoards = buildFallbackBoards();
      sources.push('Local sector fallback');
    }
  }

  if (fast) {
    dayBoards = dayBoards.map(function(board) {
      return Object.assign({}, board, {
        monthChangePct: board.monthChangePct == null ? null : board.monthChangePct,
        sampleDays: board.sampleDays || 0
      });
    });
  } else {
    dayBoards = await enrichBoardsWithMonthStats(dayBoards);
  }
  dayBoards = await Promise.all(dayBoards.map(async function(board) {
    if (board.stocks && board.stocks.length) return board;
    return Object.assign({}, board, { stocks: await fetchBoardMembers(board, 8) });
  }));

  try {
    hotStocks = await fetchHotStocks(20);
    sources.push('Eastmoney stock rank');
  } catch (error) {
    errors.push('Eastmoney stock rank: ' + error.message);
    try {
      hotStocks = await fetchSinaHotStocks(20);
      sources.push('Sina stock rank');
    } catch (sinaError) {
      errors.push('Sina stock rank: ' + sinaError.message);
      hotStocks = fallbackHotStocks(dayBoards);
    }
  }

  const newsResult = await newsService.listNewsWithMetaAsync({
    type: 'market',
    days: 7,
    pages: fast ? 3 : 7,
    num: fast ? 30 : 50,
    cacheBust: refresh ? String(Date.now()) : ''
  });
  if (newsResult.meta && newsResult.meta.sources) {
    newsResult.meta.sources.forEach(function(source) {
      if (source && !sources.includes(source)) sources.push(source);
    });
  }

  const overview = {
    generatedAt: new Date().toISOString(),
    tradeDate: todayString(),
    cached: false,
    degraded: Boolean(errors.length || (newsResult.meta && newsResult.meta.degraded)),
    errors,
    sources,
    boards: {
      day: dayBoards,
      month: sortMonthBoards(dayBoards)
    },
    hotStocks,
    news: (newsResult.items || []).slice(0, 120),
    newsMeta: newsResult.meta || null,
    durationMs: Date.now() - startedAt,
    fastMode: fast
  };
  overview.prompt = buildPrompt(overview);
  saveSnapshot(overview);
  cachedOverview = { ts: Date.now(), data: overview };
  return overview;
}

module.exports = {
  getOverview,
  listSnapshots,
  saveAiResult,
  buildPrompt,
  mapBoard,
  mapStock,
  calcMonthStats,
  collectSinaIndustryNodes,
  formatPct,
  formatYi
};
