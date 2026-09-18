const test = require('node:test');
const assert = require('node:assert/strict');

const MarketOverviewModel = require('../js/modules/marketOverview');

function healthyPayloads(overrides = {}) {
  const indices = Array.from({ length: 8 }, (_, index) => ({
    name: '指数' + index,
    code: String(index).padStart(6, '0'),
    price: 3000 + index,
    changePct: index === 0 ? 0 : 0.5,
    amount: 100000000
  }));
  return Object.assign({
    indices: {
      indices,
      turnover: { total: 1200000000000 },
      source: { label: '指数测试源' }
    },
    sentiment: {
      aShare: {
        score: 60,
        label: '偏强',
        advancing: 3000,
        declining: 2000,
        total: 5200,
        breadthPct: 57.69,
        avgChangePct: 0.4,
        strongCount: 200,
        weakCount: 100,
        sourceStatus: 'live',
        source: '宽度测试源'
      }
    },
    hot: {
      marketStatus: 'available',
      degraded: false,
      boards: {
        day: [
          { name: '半导体', kind: 'industry', dailyChangePct: 2.1, mainNetInflow: 300000000 },
          { name: '通信设备', kind: 'sina-industry', dailyChangePct: 1.4, mainNetInflow: 120000000 },
          { name: '机器人概念', kind: 'concept', dailyChangePct: 3.2, mainNetInflow: 180000000 }
        ]
      },
      sources: ['板块测试源']
    }
  }, overrides);
}

async function renderPayloads(payloads) {
  const ids = [
    'marketIndexGrid',
    'marketBreadthPanel',
    'marketFlowPanel',
    'marketSectorPanel',
    'marketOverviewStatus',
    'marketOverviewSources'
  ];
  const elements = new Map(ids.map(id => [id, { innerHTML: '', textContent: '', dataset: {} }]));
  const originalDocument = global.document;
  const originalApiClient = global.ApiClient;
  global.document = { getElementById(id) { return elements.get(id) || null; } };
  global.ApiClient = {
    async fetchJsonData(url) {
      if (url.startsWith('/api/market/indices')) return payloads.indices;
      if (url.startsWith('/api/sentiment/overview')) return payloads.sentiment;
      return payloads.hot;
    }
  };
  try {
    await MarketOverviewModel.load({ refresh: true });
    return elements;
  } finally {
    global.document = originalDocument;
    global.ApiClient = originalApiClient;
  }
}

test('sector flow summary keeps industry and concept samples separate without a cross-type total', () => {
  const result = MarketOverviewModel.summarizeSectorFlows([
    { name: '半导体', kind: 'industry', mainNetInflow: 320000000 },
    { name: '证券概念', kind: 'concept', mainNetInflow: -180000000 },
    { name: '通信', kind: 'sina-industry', mainNetInflow: 80000000 },
    { name: '无数据概念', kind: 'concept', mainNetInflow: null }
  ]);

  assert.deepEqual(result.industry.leaders.map(function(item) { return item.name; }), ['半导体', '通信']);
  assert.deepEqual(result.concept.leaders.map(function(item) { return item.name; }), ['证券概念']);
  assert.equal(result.industry.availableCount, 2);
  assert.equal(result.concept.availableCount, 1);
  assert.equal(result.totalCount, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'sampleNetTotal'), false);
});

test('sector ranking exposes gainers, laggards and net-flow leaders without replacing unavailable flow with zero', () => {
  const result = MarketOverviewModel.rankBoards([
    { name: 'A', dailyChangePct: 3.2, mainNetInflow: null },
    { name: 'B', dailyChangePct: -1.1, mainNetInflow: 50000000 },
    { name: 'C', dailyChangePct: 1.4, mainNetInflow: -80000000 }
  ], 2);

  assert.deepEqual(result.gainers.map(item => item.name), ['A', 'C']);
  assert.deepEqual(result.laggards.map(item => item.name), ['B', 'C']);
  assert.deepEqual(result.flowLeaders.map(item => item.name), ['B', 'C']);
  assert.equal(result.gainers[0].mainNetInflow, null);
});

test('market overview keeps industry and concept rankings in separate groups', async () => {
  const elements = await renderPayloads(healthyPayloads());
  const sectorHtml = elements.get('marketSectorPanel').innerHTML;
  const flowHtml = elements.get('marketFlowPanel').innerHTML;

  assert.match(sectorHtml, /行业领涨/);
  assert.match(sectorHtml, /半导体/);
  assert.match(sectorHtml, /通信设备/);
  assert.match(sectorHtml, /概念领涨/);
  assert.match(sectorHtml, /机器人概念/);
  assert.match(flowHtml, /行业资金净额靠前/);
  assert.match(flowHtml, /概念资金净额靠前/);
  assert.doesNotMatch(flowHtml, /板块合计|样本净额/);
});

test('market breadth distinguishes missing counts from a real zero', async () => {
  const payloads = healthyPayloads();
  payloads.sentiment.aShare = Object.assign({}, payloads.sentiment.aShare, {
    score: null,
    label: '',
    advancing: null,
    declining: 0,
    total: undefined,
    breadthPct: null,
    avgChangePct: null,
    strongCount: null,
    weakCount: 0
  });
  const elements = await renderPayloads(payloads);
  const html = elements.get('marketBreadthPanel').innerHTML;

  assert.match(html, /<strong>--<\/strong><span>状态暂不可用<\/span>/);
  assert.match(html, /--<\/i> \/ <i class="pnl-down">0<\/i> \/ --/);
  assert.match(html, /<b>-- \/ 0<\/b>/);
  assert.doesNotMatch(html, /上涨家数占比<\/span><b>0\.00%/);
});

test('market overview status is partial for degraded or incomplete source coverage', async () => {
  const cases = [
    (() => {
      const payloads = healthyPayloads();
      payloads.hot.boards.day[2].mainNetInflow = null;
      return payloads;
    })(),
    (() => {
      const payloads = healthyPayloads();
      payloads.hot.boards.day[1].mainNetInflow = null;
      return payloads;
    })(),
    (() => {
      const payloads = healthyPayloads();
      payloads.indices.turnover.total = null;
      return payloads;
    })(),
    (() => {
      const payloads = healthyPayloads();
      payloads.hot.degraded = true;
      return payloads;
    })(),
    (() => {
      const payloads = healthyPayloads();
      payloads.indices.indices = payloads.indices.indices.slice(0, 7);
      return payloads;
    })(),
    (() => {
      const payloads = healthyPayloads();
      payloads.sentiment.aShare.sourceStatus = 'fallback';
      return payloads;
    })(),
    (() => {
      const payloads = healthyPayloads();
      payloads.indices.indices.forEach(function(item) {
        item.price = null;
        item.changePct = null;
        item.amount = null;
      });
      return payloads;
    })(),
    (() => {
      const payloads = healthyPayloads();
      payloads.hot.boards.day.forEach(function(item) { item.dailyChangePct = null; });
      return payloads;
    })(),
    (() => {
      const payloads = healthyPayloads();
      payloads.hot.boards.day.push({ name: '未知分类', kind: 'other', dailyChangePct: 1, mainNetInflow: 1 });
      return payloads;
    })(),
    healthyPayloads({ sentiment: null })
  ];

  for (const payloads of cases) {
    const elements = await renderPayloads(payloads);
    assert.equal(elements.get('marketOverviewStatus').dataset.state, 'partial');
    assert.match(elements.get('marketOverviewStatus').textContent, /部分数据不可用/);
  }

  const healthy = await renderPayloads(healthyPayloads());
  assert.equal(healthy.get('marketOverviewStatus').dataset.state, 'ready');
});

test('missing sector flow stays unavailable instead of becoming a fabricated zero', async () => {
  const payloads = healthyPayloads();
  payloads.hot.boards.day.forEach(item => { item.mainNetInflow = null; });
  const elements = await renderPayloads(payloads);
  const html = elements.get('marketFlowPanel').innerHTML;

  assert.match(html, /行业板块资金净额暂不可用/);
  assert.match(html, /概念板块资金净额暂不可用/);
  assert.doesNotMatch(html, />0\.00亿</);
});
