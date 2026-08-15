const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMobileSnapshot } = require('../services/mobileSnapshotService');

test('mobile snapshot keeps accounts and exposes only a read-only summary', () => {
  const snapshot = buildMobileSnapshot({
    generatedAt: '2026-08-13T01:30:00.000Z',
    accounts: [
      {
        id: 1,
        name: '默认账户',
        broker: '',
        maskedNumber: '',
        cashBalance: 1000,
        positions: [{
          code: '600584', name: '长电科技', quantity: 200, avgCost: 56.275,
          currentPrice: 58.05, marketValue: 11610, costValue: 11255,
          unrealizedPnl: 355, unrealizedPnlRate: 3.15, todayPnl: 799.93,
          quoteDate: '2026-08-13', quoteTime: '09:30:00', quoteStatus: 'live',
          localAssetPath: 'D:\\private\\should-not-leak.mp4'
        }],
        summary: {
          cashBalance: 1000, totalAssets: 12610, totalMarketValue: 11610,
          totalCost: 11255, unrealizedPnl: 355, todayPnl: 799.93,
          totalPnl: 355, totalPnlRate: 3.15, positionCount: 1
        },
        latestSnapshot: null,
        pairingToken: 'secret-token'
      },
      {
        id: 2,
        name: '广发证券 **7280',
        broker: '广发证券',
        maskedNumber: '**7280',
        cashBalance: 10000,
        positions: [],
        summary: {},
        latestSnapshot: null
      }
    ],
    researchChannels: [{
      channelKey: 'douyin-model-mr', displayName: '模型先生', platform: 'douyin',
      observationCount: 381, videoCount: 361, transcriptCount: 352,
      archiveCount: 359, lastUpdatedAt: '2026-08-12T12:30:00.000Z',
      transcript: 'private transcript', localAssetPath: 'D:\\private\\video.mp4'
    }]
  });

  assert.equal(snapshot.schema, 'webstock.mobile-snapshot/v1');
  assert.equal(snapshot.mode, 'read-only');
  assert.equal(snapshot.accounts.length, 2);
  assert.equal(snapshot.accounts[0].valuationStatus, 'live');
  assert.equal(snapshot.accounts[0].positions[0].currentPrice, 58.05);
  assert.equal(snapshot.research.channels[0].transcriptCount, 352);
  assert.equal(snapshot.research.totals.observationCount, 381);

  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('private transcript'), false);
  assert.equal(serialized.includes('should-not-leak'), false);
  assert.equal(serialized.includes('localAssetPath'), false);
});

test('mobile snapshot uses a dated broker snapshot when no live quote is available', () => {
  const snapshot = buildMobileSnapshot({
    generatedAt: '2026-08-13T01:30:00.000Z',
    accounts: [{
      id: 2,
      name: '广发证券 **7280',
      broker: '广发证券',
      maskedNumber: '**7280',
      cashBalance: 10000,
      positions: [{
        code: '600584', name: '长电科技', quantity: 200, avgCost: 59.669,
        currentPrice: null, marketValue: null, costValue: 11933.8,
        unrealizedPnl: null, quoteStatus: 'unavailable'
      }],
      summary: { cashBalance: 10000, totalCost: 11933.8, positionCount: 1 },
      latestSnapshot: {
        snapshotDate: '2026-08-11', totalMarketValue: 15490,
        cashBalance: 10000, totalAssets: 25490, totalCost: 11933.8,
        unrealizedPnl: 3556.2, totalPnl: 3556.2, todayPnl: -2013,
        sourceLabel: '同花顺截图', createdAt: '2026-08-11 10:10:00',
        holdings: [{
          code: '600584', name: '长电科技', quantity: 200, avgCost: 59.669,
          currentPrice: 77.45, marketValue: 15490, pnl: 3556.2, pnlRate: 29.797
        }]
      }
    }],
    researchChannels: []
  });

  const account = snapshot.accounts[0];
  assert.equal(account.valuationStatus, 'saved-snapshot');
  assert.equal(account.observedAt, '2026-08-11');
  assert.equal(account.summary.totalAssets, 25490);
  assert.equal(account.positions[0].currentPrice, 77.45);
  assert.equal(account.positions[0].quoteStatus, 'saved-snapshot');
});

test('mobile snapshot leaves valuation fields unavailable when quotes and saved snapshots are absent', () => {
  const snapshot = buildMobileSnapshot({
    generatedAt: '2026-08-13T01:30:00.000Z',
    accounts: [{
      id: 1, name: '默认账户', broker: '', maskedNumber: '', cashBalance: 500,
      positions: [{
        code: '000001', name: '平安银行', quantity: 100, avgCost: 10,
        currentPrice: null, marketValue: null, costValue: 1000,
        unrealizedPnl: null, quoteStatus: 'unavailable'
      }],
      summary: { cashBalance: 500, totalCost: 1000, positionCount: 1 },
      latestSnapshot: null
    }],
    researchChannels: []
  });

  const account = snapshot.accounts[0];
  assert.equal(account.valuationStatus, 'unavailable');
  assert.equal(account.summary.totalAssets, null);
  assert.equal(account.summary.totalMarketValue, null);
  assert.equal(account.summary.unrealizedPnl, null);
  assert.equal(account.positions[0].currentPrice, null);
});

test('mobile snapshot labels a previous-session market quote as stale instead of live', () => {
  const snapshot = buildMobileSnapshot({
    generatedAt: '2026-08-13T01:30:00.000Z',
    accounts: [{
      id: 1, name: '默认账户', cashBalance: 0,
      positions: [{
        code: '600584', name: '长电科技', quantity: 200, avgCost: 56,
        currentPrice: 58.05, marketValue: 11610, costValue: 11200,
        unrealizedPnl: 410, quoteDate: '2026-08-12', quoteTime: '15:00:00',
        quoteStatus: 'latest-close'
      }],
      summary: { totalAssets: 11610, totalMarketValue: 11610, totalCost: 11200, unrealizedPnl: 410, positionCount: 1 },
      latestSnapshot: null
    }],
    researchChannels: []
  });

  assert.equal(snapshot.accounts[0].valuationStatus, 'stale');
  assert.equal(snapshot.accounts[0].source.label, '最近收盘行情');
  assert.equal(snapshot.accounts[0].source.stale, true);
  assert.equal(snapshot.accounts[0].observedAt, '2026-08-12 15:00:00');
});

test('mobile snapshot exposes bounded news, transparent importance, watchlist quotes and real saved candidates', () => {
  const snapshot = buildMobileSnapshot({
    generatedAt: '2026-08-13T02:00:00.000Z',
    accounts: [],
    watchlist: [{
      code: '600584', name: '长电科技', groupName: '持仓关注', note: '观察量价',
      currentPrice: 58.05, previousClose: 57, change: 1.84,
      quoteDate: '2026-08-13', quoteTime: '10:00:00', quoteStatus: 'live'
    }],
    newsFeed: {
      generatedAt: '2026-08-13T02:00:00.000Z',
      degraded: false,
      coverage: { sourceItemCount: 80, returnedItemCount: 2, truncated: true },
      items: [{
        title: '重点政策推动产业链更新', source: '测试来源', provider: '测试采集方',
        time: '2026-08-13T01:50:00.000Z', summary: '政策事件摘要',
        link: 'https://example.com/important', relatedStocks: ['600584'],
        importance: {
          score: 72, level: 'high', method: 'local-research-priority-v1',
          reasons: ['明确事件词 +12 分：政策。', '来源、采集方与原文链接均可追溯 +8 分。']
        }
      }, {
        title: '普通资讯', source: '测试来源', time: '2026-08-13T01:40:00.000Z',
        summary: '', link: 'javascript:alert(1)', importance: { score: 12, level: 'low', reasons: [] }
      }]
    },
    capitalMomentum: {
      availability: 'available', scope: 'stock', target: { code: '600584', name: '长电科技' },
      source: { sourceClass: 'vendor-classified', provider: 'Eastmoney', truthStatement: 'Provider-classified data is not exchange ground truth.' },
      observation: { state: 'fresh', observedAt: '2026-08-13T01:59:00.000Z', isStale: false },
      latest: { timestamp: '2026-08-13T01:59:00.000Z', netAmount: 12000000, netFlowSpeed: -250000, netFlowAcceleration: -10000, flowState: { code: 'inflow-giveback', label: '正流入回吐' } }
    },
    screenerResult: {
      id: 7, taskName: '全市场技术候选', strategy: 'technical', createdAt: '2026-08-13 09:58:00',
      aiResult: '优先观察基本面和量价确认。',
      result: { candidates: [{
        code: '688981', name: '中芯国际', score: 88.5, strategy: 'technical',
        reasons: ['站上均线'], risks: ['波动较大'], dataCoverage: { quote: true, technical: true }
      }] }
    },
    latestGptPicks: null,
    researchChannels: []
  });

  assert.equal(snapshot.watchlist.items[0].currentPrice, 58.05);
  assert.equal(snapshot.news.items.length, 2);
  assert.equal(snapshot.news.pagination.limit, 40);
  assert.equal(snapshot.news.pagination.hasMore, true);
  assert.equal(snapshot.news.items[0].importance.label, '重点');
  assert.match(snapshot.news.items[0].importance.reason, /事件词/);
  assert.equal(snapshot.news.items[1].link, '#');
  assert.equal(snapshot.capitalMomentum.status, 'available');
  assert.equal(snapshot.capitalMomentum.latest.flowState.label, '正流入回吐');
  assert.equal(snapshot.screener.status, 'available');
  assert.equal(snapshot.screener.candidates[0].code, '688981');
  assert.equal(snapshot.screener.candidates.some(item => item.code === '600584'), false);
  assert.equal(snapshot.latestGptPicks.status, 'empty');
});

test('mobile snapshot keeps capital momentum and saved screener absence explicit', () => {
  const snapshot = buildMobileSnapshot({
    generatedAt: '2026-08-13T02:00:00.000Z',
    accounts: [],
    capitalMomentum: {
      availability: 'unavailable', scope: 'stock', target: { code: '000001', name: '平安银行' },
      error: { code: 'VENDOR_FLOW_UNAVAILABLE', message: '上游资金数据暂不可用' }
    },
    screenerResult: null,
    researchChannels: []
  });

  assert.equal(snapshot.capitalMomentum.status, 'unavailable');
  assert.match(snapshot.capitalMomentum.message, /暂不可用/);
  assert.equal(snapshot.screener.status, 'empty');
  assert.deepEqual(snapshot.screener.candidates, []);
});

test('mobile snapshot maps the guarded ChatGPT import contract without inventing a score', () => {
  const snapshot = buildMobileSnapshot({
    accounts: [], researchChannels: [],
    latestGptPicks: {
      id: 19, title: '8月14日候选', importedAt: '2026-08-14T01:00:00.000Z',
      analysis: '总体等待量价确认',
      candidates: [{
        code: '600519', name: '贵州茅台', reason: '现金流稳定',
        risk: '需求不及预期', originalAnalysis: '仅作观察'
      }]
    }
  });

  assert.equal(snapshot.latestGptPicks.status, 'available');
  assert.equal(snapshot.latestGptPicks.createdAt, '2026-08-14T01:00:00.000Z');
  assert.deepEqual(snapshot.latestGptPicks.picks[0].reasons, ['现金流稳定']);
  assert.deepEqual(snapshot.latestGptPicks.picks[0].risks, ['需求不及预期']);
  assert.equal(snapshot.latestGptPicks.picks[0].score, null);
});
