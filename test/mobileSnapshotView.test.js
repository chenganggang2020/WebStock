const test = require('node:test');
const assert = require('node:assert/strict');

const view = require('../js/modules/mobileSnapshotView');

test('mobile view renders the full bounded news stream with importance reasons and independent data states', () => {
  const newsItems = Array.from({ length: 12 }, function(_, index) {
    return {
      title: '资讯 ' + (index + 1), source: '来源 A', time: '2026-08-13T02:00:00.000Z',
      summary: index === 0 ? '重点摘要' : '', link: 'https://example.com/news/' + index,
      relatedStocks: index === 0 ? ['688981'] : [],
      importance: index === 0
        ? { score: 78, level: 'high', label: '重点', reason: '重大风险事件词 +30 分。' }
        : { score: 10, level: 'low', label: '一般', reason: '暂无可验证的本地重点信号。' }
    };
  });
  const html = view.renderSnapshot({
    schema: 'webstock.mobile-snapshot/v1', generatedAt: '2026-08-13T02:00:00.000Z', accounts: [],
    watchlist: { status: 'available', items: [{ code: '600584', name: '长电科技', currentPrice: 58.05, change: 1.84, groupName: '关注' }] },
    news: { status: 'available', items: newsItems, pagination: { returned: 12, hasMore: true } },
    capitalMomentum: { status: 'unavailable', message: '资金源暂不可用', target: { code: '600584', name: '长电科技' }, latest: null },
    screener: { status: 'available', taskName: '真实保存任务', candidates: [{ code: '688981', name: '中芯国际', score: 88, reasons: ['量价确认'], risks: ['波动风险'] }] },
    latestGptPicks: { status: 'empty', picks: [] },
    research: { totals: {}, channels: [] }
  }, 0);

  assert.match(html, /资讯 12/);
  assert.match(html, /重点/);
  assert.match(html, /重大风险事件词/);
  assert.match(html, /资金源暂不可用/);
  assert.match(html, /688981/);
  assert.match(html, /暂无已同步的 ChatGPT 每日选股/);
  assert.doesNotMatch(html, /600584[^]*本地候选筛选分/);
});

test('mobile view shows saved screener empty state without substituting watchlist stocks', () => {
  const html = view.renderSnapshot({
    schema: 'webstock.mobile-snapshot/v1', accounts: [],
    watchlist: { status: 'available', items: [{ code: '000001', name: '平安银行' }] },
    news: { status: 'empty', items: [], pagination: {} },
    capitalMomentum: { status: 'unavailable', message: '暂无可展示的资金动量', latest: null },
    screener: { status: 'empty', candidates: [] },
    latestGptPicks: { status: 'empty', picks: [] },
    research: { totals: {}, channels: [] }
  }, 0);

  assert.match(html, /暂无已保存的本地候选结果/);
  assert.match(html, /不冒充全市场实时选股/);
  assert.match(html, /000001/);
  assert.doesNotMatch(html, /000001[^]*候选分/);
});

test('mobile view reserves the prominent news marker for high-priority evidence', () => {
  const html = view.renderSnapshot({
    schema: 'webstock.mobile-snapshot/v1', accounts: [], watchlist: { items: [] },
    news: {
      status: 'available', pagination: {}, items: [{
        title: '仅具时效性的普通资讯', source: '来源 A',
        importance: { score: 33, level: 'medium', label: '关注', reason: '有效发布时间按时效性 +25 分。' }
      }]
    },
    capitalMomentum: { status: 'unavailable', latest: null },
    screener: { status: 'empty', candidates: [] }, latestGptPicks: { status: 'empty', picks: [] },
    research: { totals: {}, channels: [] }
  }, 0);

  assert.match(html, /importance-tag medium/);
  assert.match(html, /关注原因/);
  assert.doesNotMatch(html, /news-row important/);
});
