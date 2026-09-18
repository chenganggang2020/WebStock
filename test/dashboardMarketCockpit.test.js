const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dashboardSource = fs.readFileSync(path.join(root, 'js', 'modules', 'dashboard.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');
const MarketOverview = require('../js/modules/marketOverview');

function loadDashboardContext(overrides) {
  overrides = overrides || {};
  const boxes = new Map([
    ['dashboardMarketIndices', { innerHTML: '' }],
    ['dashboardMarketSectors', { innerHTML: '' }],
    ['dashboardMarketFlow', { innerHTML: '' }],
    ['dashboardMarketSources', { textContent: '', dataset: {} }],
    ['dashboardSentimentPanel', { innerHTML: '', oncontextmenu: null }]
  ]);
  const context = {
    window: {
      State: {},
      MarketOverview: overrides.MarketOverview || MarketOverview,
      MarketComparison: overrides.MarketComparison,
      apiFetch: overrides.apiFetch || (async function() { return {}; }),
      WebStockTime: null
    },
    document: {
      getElementById(id) { return boxes.get(id) || null; },
      addEventListener() {}
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    console,
    setInterval() { return 1; },
    clearInterval() {}
  };
  vm.createContext(context);
  vm.runInContext(dashboardSource, context);
  return { context, boxes };
}

test('unavailable sentiment has no fear color and explains missing data', () => {
  const { context, boxes } = loadDashboardContext();
  context.window.State.marketSentiment = { aShare: { score: null, label: '数据不足', sourceStatus: 'unavailable' }, vix: null };
  context.dashboardRenderSentiment();
  const html = boxes.get('dashboardSentimentPanel').innerHTML;
  assert.doesNotMatch(html, /sentiment-score fear/);
  assert.match(html, /暂不可用/);
});

test('dashboard force refresh refreshes the overview and full board cloud without duplicating the first load', async () => {
  const overviewCalls = [];
  const heatmapCalls = [];
  const overview = {
    async load(options) {
      overviewCalls.push(options);
      return { indices: null, sentiment: null, hot: null, indexHistory: null };
    }
  };
  const comparison = {
    render() {},
    async loadHeatmapSnapshot(options) {
      heatmapCalls.push(options);
      return { status: 'available', taxonomy: 'industry', items: [] };
    }
  };
  const { context } = loadDashboardContext({ MarketOverview: overview, MarketComparison: comparison });

  await context.window.Dashboard.load();
  assert.equal(overviewCalls.length, 1);
  assert.equal(overviewCalls[0].refresh, false);
  assert.equal(heatmapCalls.length, 0, 'MarketComparison.bind owns the initial heatmap request');

  await context.window.Dashboard.load({ force: true });
  assert.equal(overviewCalls.length, 2);
  assert.equal(overviewCalls[1].refresh, true);
  assert.equal(heatmapCalls.length, 1);
  assert.equal(heatmapCalls[0].force, true);
});

test('dashboard reuses the cockpit sentiment snapshot instead of requesting it twice', async () => {
  const directCalls = [];
  const sentiment = { aShare: { score: 54, label: '中性' }, vix: { value: 14.43 } };
  const overview = {
    async load() {
      return { indices: null, sentiment, hot: null, indexHistory: null };
    }
  };
  const { context } = loadDashboardContext({
    MarketOverview: overview,
    apiFetch: async function(url) {
      directCalls.push(url);
      return {};
    }
  });

  await context.window.Dashboard.load();
  assert.deepEqual(directCalls, []);
  assert.equal(context.window.State.marketSentiment, sentiment);
});

test('the manual homepage refresh requests a forced dashboard load', () => {
  assert.match(appSource, /Dashboard\.load\(\{\s*force:\s*true\s*\}\)/);
});

test('homepage keeps the market cockpit and sentiment panel without personal summary cards', () => {
  const dashboardStart = indexSource.indexOf('id="dashboardView"');
  const dashboardEnd = indexSource.indexOf('id="marketView"', dashboardStart);
  const dashboardMarkup = indexSource.slice(dashboardStart, dashboardEnd);

  assert.ok(dashboardStart >= 0);
  assert.ok(dashboardEnd > dashboardStart);
  assert.match(dashboardMarkup, /id="dashboardMarketCockpit"/);
  assert.match(dashboardMarkup, /id="dashboardSentimentPanel"/);
  [
    'dashboardRecentList',
    'dashboardWatchlistList',
    'dashboardPortfolioList',
    'dashboardNewsList',
    'dashboardSectorList',
    'dashboardRiskList',
    'dashboardScreenerReviewList',
    'dashboardDataHealthPanel'
  ].forEach(function(id) {
    assert.doesNotMatch(dashboardMarkup, new RegExp('id="' + id + '"'));
  });
  assert.match(indexSource, /id="dashboardMarketIndices"/);
  assert.doesNotMatch(indexSource, /id="dashboardMarketBreadth"/);
  assert.match(indexSource, /id="dashboardMarketSectors"/);
  assert.doesNotMatch(indexSource, /id="dashboardMarketFlow"/);
  assert.match(dashboardMarkup, /id="dashboardMarketSentiment"[\s\S]*id="volumePaceChart"[\s\S]*id="dashboardMarketCockpit"/);
  assert.match(indexSource, /id="dashboardMarketSources"/);
  assert.match(cssSource, /\.dashboard-market-cockpit/);
});

test('homepage puts one merged market sentiment section before the full-width index cockpit', () => {
  const dashboardStart = indexSource.indexOf('id="dashboardView"');
  const dashboardEnd = indexSource.indexOf('id="marketView"', dashboardStart);
  const dashboardMarkup = indexSource.slice(dashboardStart, dashboardEnd);
  const sentimentIndex = dashboardMarkup.indexOf('id="dashboardMarketSentiment"');
  const cockpitIndex = dashboardMarkup.indexOf('id="dashboardMarketCockpit"');

  assert.ok(sentimentIndex >= 0, 'merged market sentiment section should exist');
  assert.ok(cockpitIndex > sentimentIndex, 'market sentiment should be above indices and boards');
  assert.equal((dashboardMarkup.match(/id="dashboardSentimentPanel"/g) || []).length, 1);
  assert.equal((dashboardMarkup.match(/id="dashboardMarketBreadth"/g) || []).length, 0);
  assert.equal((dashboardMarkup.match(/id="dashboardMarketFlow"/g) || []).length, 0);
  assert.equal((dashboardMarkup.match(/id="volumePaceChart"/g) || []).length, 1);
  assert.match(dashboardMarkup, /<h3>市场情绪与量能<\/h3>/);
  assert.doesNotMatch(dashboardMarkup, /市场温度\s*\/\s*宽度/);
  assert.match(cssSource, /\.dashboard-market-sentiment-grid/);
  assert.match(cssSource, /\.dashboard-index-analysis\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(cssSource, /@media \(max-width:\s*720px\)[\s\S]*\.dashboard-market-sentiment-grid \.sentiment-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('merged market sentiment replaces the dense flow summary with the dedicated volume cockpit', () => {
  const dashboardStart = indexSource.indexOf('id="dashboardMarketSentiment"');
  const dashboardEnd = indexSource.indexOf('id="dashboardMarketCockpit"', dashboardStart);
  const sentimentMarkup = indexSource.slice(dashboardStart, dashboardEnd);
  assert.match(sentimentMarkup, /class="dashboard-volume-stage"/);
  assert.match(sentimentMarkup, /id="volumePaceChart"/);
  assert.doesNotMatch(sentimentMarkup, /成交、量能与资金|id="dashboardMarketFlow"/);
});

test('homepage cleanup leaves the dedicated feature pages available', () => {
  assert.match(indexSource, /data-main-view="watchlist"/);
  assert.match(indexSource, /id="watchlistView"/);
  assert.match(indexSource, /id="portfolioView"/);
  assert.match(indexSource, /id="recentView"/);
  assert.match(indexSource, /id="newsView"/);
  assert.match(indexSource, /id="sectorsView"/);
  assert.match(indexSource, /id="screenerView"/);
});

test('homepage sentiment score uses a circular gauge', () => {
  const scoreRule = cssSource.match(/\.sentiment-score\s*\{([^}]*)\}/s);

  assert.match(dashboardSource, /class="sentiment-score /);
  assert.ok(scoreRule, 'sentiment score styling must exist');
  assert.match(scoreRule[1], /border-radius:\s*50%/);
});

test('homepage sentiment presents each breadth metric once and keeps unique tail samples', () => {
  const { context, boxes } = loadDashboardContext();
  context.window.State.marketSentiment = {
    aShare: {
      score: 54,
      label: '中性',
      breadthPct: 56.67,
      avgChangePct: 0.5,
      advancing: 425,
      declining: 308,
      total: 750,
      strongCount: 91,
      weakCount: 53,
      limitUpLike: 8,
      sharpDown: 18,
      components: [
        { name: '上涨家数占比', score: 57, value: '425/750' },
        { name: '平均涨跌幅', score: 54, value: '0.5%' },
        { name: '强弱股差', score: 61, value: '91 强 / 53 弱' }
      ]
    },
    vix: { value: 14.43, label: '低波动', date: '2026-08-28' }
  };

  context.dashboardRenderSentiment();
  const markup = boxes.get('dashboardSentimentPanel').innerHTML;
  assert.equal((markup.match(/上涨家数占比/g) || []).length, 1);
  assert.equal((markup.match(/平均涨跌幅/g) || []).length, 1);
  assert.doesNotMatch(markup, /sentiment-components|强弱股差/);
  assert.match(markup, /平盘 17/);
  assert.match(markup, /涨停样本 8/);
  assert.match(markup, /大跌样本 18/);
});

test('homepage sentiment renders provider fields as validated values instead of executable markup', () => {
  const { context, boxes } = loadDashboardContext();
  context.window.State.marketSentiment = {
    aShare: {
      score: 50,
      label: '中性',
      breadthPct: 50,
      avgChangePct: 0,
      advancing: '<img src=x onerror=alert(1)>',
      declining: '<svg onload=alert(1)>',
      total: '<script>alert(1)</script>',
      strongCount: '<b>99</b>',
      weakCount: '10'
    },
    vix: { value: null, label: '低波动', date: '2026-08-30' }
  };

  context.dashboardRenderSentiment();
  const markup = boxes.get('dashboardSentimentPanel').innerHTML;
  assert.doesNotMatch(markup, /<img|<svg|<script|<b>99<\/b>/i);
  assert.doesNotMatch(markup, />0\.00<\/strong><em>低波动/);
  assert.match(markup, /暂无/);
});

test('homepage market cockpit keeps unavailable values explicit instead of rendering zero', () => {
  const { context, boxes } = loadDashboardContext();
  context.dashboardRenderMarketCockpit({
    indices: {
      indices: [
        { name: '上证指数', code: '000001', price: null, changePct: null, amount: null }
      ],
      turnover: { total: null },
      source: { label: '公开指数测试源' }
    },
    sentiment: null,
    hot: {
      marketStatus: 'unavailable',
      boards: { day: [] },
      sources: ['本地观察分组']
    }
  });

  assert.match(boxes.get('dashboardMarketIndices').innerHTML, /上证指数/);
  assert.match(boxes.get('dashboardMarketIndices').innerHTML, /暂无/);
  assert.doesNotMatch(boxes.get('dashboardMarketIndices').innerHTML, /0\.00/);
  assert.doesNotMatch(boxes.get('dashboardMarketIndices').innerHTML, /class="pnl-up">暂无/);
  assert.match(boxes.get('dashboardSentimentPanel').innerHTML, /暂不可用/);
  assert.match(boxes.get('dashboardMarketSectors').innerHTML, /外部板块行情暂不可用/);
  assert.match(boxes.get('dashboardMarketFlow').innerHTML, /板块资金净额暂不可用/);
  assert.doesNotMatch(boxes.get('dashboardMarketFlow').innerHTML, />0\.00亿</);
  assert.match(boxes.get('dashboardMarketSources').textContent, /公开指数测试源/);
});

test('homepage labels board flow as a provider-classified sample, not whole-market truth', () => {
  const { context, boxes } = loadDashboardContext();
  context.dashboardRenderMarketCockpit({
    indices: {
      indices: [{ name: '上证指数', code: '000001', price: 3888.2, changePct: 0.5, amount: 500000000000 }],
      turnover: { total: 1100000000000 },
      fetchedAt: '2026-08-29T01:30:00.000Z',
      source: { label: '新浪公开指数行情' }
    },
    sentiment: {
      updatedAt: '2026-08-29T01:31:00.000Z',
      aShare: {
        score: 61,
        label: '偏强',
        advancing: 3200,
        declining: 1800,
        total: 5200,
        breadthPct: 61.54,
        strongCount: 300,
        weakCount: 120,
        limitUpLike: 8,
        sharpDown: 12,
        source: '公开行情样本'
      }
    },
    hot: {
      generatedAt: '2026-08-29T01:32:00.000Z',
      marketStatus: 'available',
      boards: {
        day: [
          { name: '半导体', kind: 'industry', dailyChangePct: 2.3, mainNetInflow: 320000000, leaderName: '示例龙头' },
          { name: '白酒概念', kind: 'concept', dailyChangePct: -1.1, mainNetInflow: -180000000 }
        ]
      },
      sources: ['Eastmoney sector rank']
    }
  });

  assert.match(boxes.get('dashboardSentimentPanel').innerHTML, /3200/);
  assert.match(boxes.get('dashboardSentimentPanel').innerHTML, /平盘 200/);
  assert.match(boxes.get('dashboardSentimentPanel').innerHTML, /涨停样本 8/);
  assert.match(boxes.get('dashboardSentimentPanel').innerHTML, /大跌样本 12/);
  assert.match(boxes.get('dashboardMarketSectors').innerHTML, /半导体/);
  assert.match(boxes.get('dashboardMarketSectors').innerHTML, /行业领涨/);
  assert.match(boxes.get('dashboardMarketSectors').innerHTML, /概念领涨/);
  assert.match(boxes.get('dashboardMarketFlow').innerHTML, /行业供应商资金净额/);
  assert.match(boxes.get('dashboardMarketFlow').innerHTML, /概念供应商资金净额/);
  assert.doesNotMatch(boxes.get('dashboardMarketFlow').innerHTML, /样本净流入合计|样本净流出合计/);
  assert.match(boxes.get('dashboardMarketFlow').innerHTML, /不跨类型相加/);
  assert.match(boxes.get('dashboardMarketFlow').innerHTML, /不是全市场真实资金流/);
  assert.match(boxes.get('dashboardMarketSources').textContent, /东方财富板块排行（供应商分类）/);
  assert.doesNotMatch(boxes.get('dashboardMarketSources').textContent, /Eastmoney sector rank/);
  assert.match(boxes.get('dashboardMarketSources').textContent, /抓取时间：/);
});

test('homepage status stays partial when board prices exist but fund-flow fields are unavailable', () => {
  const { context, boxes } = loadDashboardContext();
  context.dashboardRenderMarketCockpit({
    indices: {
      indices: Array.from({ length: 8 }, function(_, index) {
        return { name: '指数' + index, code: String(index), price: 3000 + index, changePct: 0, amount: 100000000 };
      }),
      turnover: { total: 1000000000000 },
      source: { label: '指数源' }
    },
    sentiment: {
      aShare: {
        score: 50,
        advancing: 2500,
        declining: 2500,
        total: 5200,
        breadthPct: 48.08,
        sourceStatus: 'live',
        source: '宽度源'
      }
    },
    hot: {
      marketStatus: 'available',
      degraded: true,
      boards: { day: [
        { name: '行业样本', kind: 'sina-industry', dailyChangePct: 1.2, mainNetInflow: null },
        { name: '概念样本', kind: 'concept', dailyChangePct: 0.8, mainNetInflow: null }
      ] },
      sources: ['降级板块源']
    }
  });

  assert.equal(boxes.get('dashboardMarketSources').dataset.state, 'partial');
  assert.match(boxes.get('dashboardMarketFlow').innerHTML, /暂不可用/);
  assert.doesNotMatch(boxes.get('dashboardMarketFlow').innerHTML, />0\.00亿</);
  assert.match(boxes.get('dashboardMarketSources').textContent, /状态：部分可用（板块源降级）/);
});

test('homepage cannot be ready when index fields or board changes are missing', () => {
  const { context, boxes } = loadDashboardContext();
  context.dashboardRenderMarketCockpit({
    indices: {
      indices: Array.from({ length: 8 }, function(_, index) {
        return { name: '指数' + index, code: String(index), price: null, changePct: null, amount: null };
      }),
      turnover: { total: 1000000000000 }
    },
    sentiment: {
      aShare: { score: 50, advancing: 2500, declining: 2500, total: 5200, breadthPct: 48.08, sourceStatus: 'live' }
    },
    hot: {
      marketStatus: 'available',
      degraded: false,
      boards: { day: [
        { name: '行业样本', kind: 'industry', dailyChangePct: null, mainNetInflow: 1 },
        { name: '概念样本', kind: 'concept', dailyChangePct: null, mainNetInflow: 1 }
      ] }
    }
  });
  assert.equal(boxes.get('dashboardMarketSources').dataset.state, 'partial');
  assert.match(boxes.get('dashboardMarketIndices').innerHTML, /暂无/);
});

test('homepage status is partial when displayed limit-up or sharp-down breadth is missing', () => {
  const { context, boxes } = loadDashboardContext();
  context.dashboardRenderMarketCockpit({
    indices: {
      indices: Array.from({ length: 8 }, function(_, index) {
        return { name: '指数' + index, code: String(index), price: 3000 + index, changePct: 0, amount: 100000000 };
      }),
      turnover: { total: 1000000000000 }
    },
    sentiment: {
      aShare: {
        score: 50,
        advancing: 2500,
        declining: 2500,
        total: 5200,
        breadthPct: 48.08,
        limitUpLike: null,
        sharpDown: null,
        sourceStatus: 'live'
      }
    },
    hot: {
      marketStatus: 'available',
      degraded: false,
      boards: { day: [
        { name: '行业样本', kind: 'industry', dailyChangePct: 1, mainNetInflow: 1 },
        { name: '概念样本', kind: 'concept', dailyChangePct: 1, mainNetInflow: 1 }
      ] }
    }
  });

  assert.equal(boxes.get('dashboardMarketSources').dataset.state, 'partial');
  assert.match(boxes.get('dashboardSentimentPanel').innerHTML, /涨停样本 暂无/);
});

test('homepage source footer limits completeness to cockpit base data and points to the board-cloud status', () => {
  const { context, boxes } = loadDashboardContext();
  context.dashboardRenderMarketCockpit({
    indices: {
      indices: Array.from({ length: 8 }, function(_, index) {
        return { name: '指数' + index, code: String(index), price: 3000 + index, changePct: 0.2, amount: 100000000 };
      }),
      turnover: { total: 1000000000000 },
      source: { label: '指数源' }
    },
    indexHistory: {
      status: 'available',
      window: 2,
      comparison: { dates: ['2026-08-28', '2026-08-29'] },
      source: { label: '历史源' }
    },
    sentiment: {
      aShare: {
        score: 55,
        advancing: 2800,
        declining: 2200,
        total: 5200,
        breadthPct: 53.85,
        limitUpLike: 20,
        sharpDown: 10,
        sourceStatus: 'live',
        source: '宽度源'
      }
    },
    hot: {
      marketStatus: 'available',
      degraded: false,
      boards: { day: [
        { name: '行业样本', kind: 'industry', dailyChangePct: 1, mainNetInflow: 1 },
        { name: '概念样本', kind: 'concept', dailyChangePct: 1, mainNetInflow: 1 }
      ] },
      sources: ['驾驶舱板块样本源']
    }
  });

  assert.equal(boxes.get('dashboardMarketSources').dataset.state, 'ready');
  assert.match(boxes.get('dashboardMarketSources').textContent, /驾驶舱基础数据状态：完整/);
  assert.match(boxes.get('dashboardMarketSources').textContent, /板块云图状态见云图图例/);
  assert.doesNotMatch(boxes.get('dashboardMarketSources').textContent, /(?:^| · )状态：完整/);
});
