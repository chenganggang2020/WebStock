const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('daily view renders the preserved CITIC all-contract aggregate without the removed dashboard', () => {
  const box = {innerHTML: ''};
  const api = require('../js/modules/marketInstitutionalFlow').createModule({
    document: {getElementById: id => id === 'dashboardCiticAggregate' ? box : null}
  });
  api.render({futures: {availability: 'available', items: [{product: 'IC', contract: 'IC2612',
    focusMembers: [{member: '中信期货', disclosedLong: 100, disclosedShort: 120,
      rankedMemberImbalance: -20, rankedMemberImbalanceChange: -5}]}]}});
  assert.ok(box.innerHTML.includes('中信全部可比合约'), 'CITIC summary must not depend on removed dashboard cards');
});

test('capital-flow page exposes source-backed ETF and CFFEX daily panels', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="institutionalFlowRefreshBtn"/);
  assert.match(html, /id="etfFlowInList"/);
  assert.match(html, /id="etfFlowOutList"/);
  assert.match(html, /id="cffexPositionGrid"/);
  assert.match(html, /ETF日度申赎估算/);
  assert.match(html, /中金所会员持仓差/);
  assert.match(html, /js\/modules\/marketInstitutionalFlow\.js/);
  assert.doesNotMatch(html, /id="dashboardInstitutionalFlow"/);
  assert.match(html, /id="dashboardCiticAggregate"/);
  assert.match(html, /id="cffexCiticFocus"/);
  assert.match(html, /id="cffexAggregate"/);
  assert.match(html, /中信期货披露席位/);
  assert.match(html, /id="eastmoneyEtfDailyReport"/);
  assert.doesNotMatch(html, /<details class="dashboard-daily-baseline"/);
});

test('one canonical intraday view exposes ETF and futures monitoring', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="etfView"/);
  assert.doesNotMatch(html, /id="dashboardEtfIntraday"/);
  assert.doesNotMatch(html, /id="dashboardFuturesIntraday"/);
  assert.match(html, /id="marketEtfIntraday"/);
  assert.match(html, /id="marketFuturesIntraday"/);
  assert.match(html, /ETF一分钟成交动量/);
  assert.match(html, /股指期货一分钟价量仓/);
  assert.match(html, /成交量与持仓量变化/);
  assert.match(html, /不代表净多净空/);
});

test('frontend module selects one representative contract per futures product by disclosed positions', () => {
  const moduleApi = require('../js/modules/marketInstitutionalFlow');
  const selected = moduleApi.selectRepresentativeContracts([
    { product: 'IF', contract: 'IF2609', disclosedLong: 100, disclosedShort: 120 },
    { product: 'IF', contract: 'IF2612', disclosedLong: 20, disclosedShort: 30 },
    { product: 'IC', contract: 'IC2609', disclosedLong: 70, disclosedShort: 60 }
  ]);
  assert.deepEqual(selected.map(item => item.contract), ['IC2609', 'IF2609']);
});

test('homepage summary keeps ETF extremes and one representative futures contract per product', () => {
  const moduleApi = require('../js/modules/marketInstitutionalFlow');
  const summary = moduleApi.buildDashboardSummary({
    etf: {
      availability: 'available', asOf: '2026-08-28', items: [
        { code: '588000', name: '科创50ETF华夏', direction: 'inflow', estimatedNetFlowHundredMillion: 5.18 },
        { code: '510300', name: '沪深300ETF华泰柏瑞', direction: 'outflow', estimatedNetFlowHundredMillion: -13.29 }
      ]
    },
    futures: {
      availability: 'available', asOf: '2026-08-28', items: [
        { product: 'IF', contract: 'IF2609', disclosedLong: 100, disclosedShort: 120, rankedMemberImbalance: -20,
          focusMembers: [
            { member: '中信期货', rankedMemberImbalance: -8, rankedMemberImbalanceChange: 3 },
            { member: '其他期货', rankedMemberImbalance: 99, rankedMemberImbalanceChange: 10 }
          ] },
        { product: 'IF', contract: 'IF2612', disclosedLong: 10, disclosedShort: 12, rankedMemberImbalance: -2 },
        { product: 'IM', contract: 'IM2609', disclosedLong: 200, disclosedShort: 170, rankedMemberImbalance: 30 }
      ]
    }
  });

  assert.equal(summary.asOf, '2026-08-28');
  assert.equal(summary.topInflow.code, '588000');
  assert.equal(summary.topOutflow.code, '510300');
  assert.deepEqual(summary.futures.map(item => item.contract), ['IF2609', 'IM2609']);
  assert.deepEqual(summary.citicFutures, [{
    product: 'IF', contract: 'IF2609', member: '中信期货',
    rankedMemberImbalance: -8, rankedMemberImbalanceChange: 3
  }]);
  assert.deepEqual(summary.citicAggregate, {
    disclosedLong: 0,
    disclosedShort: 0,
    rankedMemberImbalance: -8,
    rankedMemberImbalanceChange: 3,
    comparableContracts: 1,
    products: [{
      product: 'IF', disclosedLong: 0, disclosedShort: 0,
      rankedMemberImbalance: -8, rankedMemberImbalanceChange: 3,
      comparableContracts: 1
    }]
  });
  assert.deepEqual(summary.disclosedAggregate, {
    disclosedLong: 310,
    disclosedShort: 302,
    rankedMemberImbalance: 8,
    rankedMemberImbalanceChange: 0,
    contractCount: 3,
    products: [
      { product: 'IF', disclosedLong: 110, disclosedShort: 132, rankedMemberImbalance: -22, rankedMemberImbalanceChange: 0, contractCount: 2 },
      { product: 'IM', disclosedLong: 200, disclosedShort: 170, rankedMemberImbalance: 30, rankedMemberImbalanceChange: 0, contractCount: 1 }
    ]
  });
});

test('CITIC aggregate separates all comparable contracts from representative contracts', () => {
  const moduleApi = require('../js/modules/marketInstitutionalFlow');
  const result = moduleApi.summarizeCiticComparableContracts([
    { product: 'IF', contract: 'IF2609', focusMembers: [{
      member: '中信期货', disclosedLong: 100, disclosedShort: 130,
      rankedMemberImbalance: -30, rankedMemberImbalanceChange: -5
    }] },
    { product: 'IF', contract: 'IF2612', focusMembers: [{
      member: '中信期货', disclosedLong: 40, disclosedShort: 60,
      rankedMemberImbalance: -20, rankedMemberImbalanceChange: 2
    }] },
    { product: 'IC', contract: 'IC2609', focusMembers: [{
      member: '中信期货', disclosedLong: 90, disclosedShort: 70,
      rankedMemberImbalance: 20, rankedMemberImbalanceChange: 4
    }] }
  ]);

  assert.equal(result.disclosedLong, 230);
  assert.equal(result.disclosedShort, 260);
  assert.equal(result.rankedMemberImbalance, -30);
  assert.equal(result.rankedMemberImbalanceChange, 1);
  assert.equal(result.comparableContracts, 3);
  assert.deepEqual(result.products.map(function(item) {
    return [item.product, item.disclosedLong, item.disclosedShort, item.rankedMemberImbalance, item.comparableContracts];
  }), [
    ['IC', 90, 70, 20, 1],
    ['IF', 140, 190, -50, 2]
  ]);
});

test('all disclosed contracts and CITIC rows reproduce the settled daily totals without mixing stock and change', () => {
  const moduleApi = require('../js/modules/marketInstitutionalFlow');
  const items = [
    { product: 'IF', disclosedLong: 210000, disclosedShort: 236221, rankedMemberImbalance: -26221, rankedMemberImbalanceChange: 364,
      focusMembers: [{ member: '中信期货', disclosedLong: 40000, disclosedShort: 61560, rankedMemberImbalance: -21560, rankedMemberImbalanceChange: 97 }] },
    { product: 'IH', disclosedLong: 160000, disclosedShort: 178009, rankedMemberImbalance: -18009, rankedMemberImbalanceChange: 965,
      focusMembers: [{ member: '中信期货', disclosedLong: 30000, disclosedShort: 43417, rankedMemberImbalance: -13417, rankedMemberImbalanceChange: -63 }] },
    { product: 'IC', disclosedLong: 190000, disclosedShort: 208246, rankedMemberImbalance: -18246, rankedMemberImbalanceChange: 845,
      focusMembers: [{ member: '中信期货', disclosedLong: 35000, disclosedShort: 46921, rankedMemberImbalance: -11921, rankedMemberImbalanceChange: 138 }] },
    { product: 'IM', disclosedLong: 253268, disclosedShort: 302852, rankedMemberImbalance: -49584, rankedMemberImbalanceChange: -274,
      focusMembers: [{ member: '中信期货', disclosedLong: 38912, disclosedShort: 69921, rankedMemberImbalance: -31009, rankedMemberImbalanceChange: 17 }] }
  ];

  const all = moduleApi.summarizeDisclosedRankedContracts(items);
  const citic = moduleApi.summarizeCiticComparableContracts(items);
  assert.equal(all.rankedMemberImbalance, -112060);
  assert.equal(all.rankedMemberImbalanceChange, 1900);
  assert.equal(citic.rankedMemberImbalance, -77907);
  assert.equal(citic.rankedMemberImbalanceChange, 189);
  assert.deepEqual(citic.products.map(item => [item.product, item.rankedMemberImbalanceChange]), [
    ['IC', 138], ['IF', 97], ['IH', -63], ['IM', 17]
  ]);
});

test('dashboard entry loads the shared daily institutional snapshot', () => {
  const appSource = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(appSource, /view === 'dashboard'.*MarketInstitutionalFlow/s);
  assert.match(appSource, /MarketInstitutionalFlow\.ensureLoaded/);
});

test('dashboard reports a failed institutional snapshot without leaving a loading label', async () => {
  const moduleApi = require('../js/modules/marketInstitutionalFlow');
  const elements = {
    institutionalFlowStatus: { textContent: '' },
    dashboardInstitutionalFlowStatus: { textContent: '' }
  };
  const module = moduleApi.createModule({
    document: { getElementById: function(id) { return elements[id] || null; } },
    fetchData: async function() { throw new Error('offline'); }
  });
  await assert.rejects(module.load(false), /offline/);
  assert.match(elements.dashboardInstitutionalFlowStatus.textContent, /不可用/);
});

test('intraday labels describe turnover and price-open-interest quadrants without net-flow claims', () => {
  const moduleApi = require('../js/modules/marketInstitutionalFlow');
  assert.equal(moduleApi.turnoverStateLabel('expanding'), '近5分钟放量');
  assert.equal(moduleApi.turnoverStateLabel('contracting'), '近5分钟缩量');
  assert.equal(moduleApi.positioningStateLabel('price-up-oi-up'), '上涨增仓');
  assert.equal(moduleApi.positioningStateLabel('price-down-oi-up'), '下跌增仓');
  assert.doesNotMatch(moduleApi.positioningStateLabel('price-up-oi-up'), /净多|净空/);
});

test('frontend requests the one-minute endpoint and refreshes it once per minute while live', () => {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'marketInstitutionalFlow.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  assert.match(source, /\/api\/market\/institutional-flow\/intraday/);
  assert.match(source, /refreshIntervalMs/);
  assert.match(source, /60 \* 1000/);
  assert.match(source, /institutional-intraday-focus/);
  assert.match(source, /近5分钟成交/);
  assert.match(styles, /\.institutional-intraday-focus\s+strong\s*\{[^}]*font-size:\s*20px/s);
});

test('intraday UI distinguishes delayed and unavailable data from a valid previous close', () => {
  const moduleApi = require('../js/modules/marketInstitutionalFlow');
  const elements = {
    dashboardInstitutionalFlowStatus: { textContent: '' },
    institutionalIntradayStatus: { textContent: '' },
    dashboardEtfIntraday: { innerHTML: '' }
  };
  const document = { getElementById: id => elements[id] || null };
  const module = moduleApi.createModule({ document });
  module.renderIntraday({ marketState: 'delayed', etfs: [{
    availability: 'available', code: '510300', product: 'IF', name: '沪深300ETF',
    stale: true, staleReason: '上游旧缓存', observedAt: '2026-08-31 09:30:00',
    reason: '连续一分钟窗口不足', rolling5AmountYuan: null, rolling5ChangePct: null,
    latestMinuteAmountYuan: 100
  }] }, document);

  assert.match(elements.dashboardInstitutionalFlowStatus.textContent, /延迟|旧缓存/);
  assert.doesNotMatch(elements.dashboardInstitutionalFlowStatus.textContent, /最近收盘/);
  assert.match(elements.dashboardEtfIntraday.innerHTML, /09:30/);
  assert.match(elements.dashboardEtfIntraday.innerHTML, /上游旧缓存/);
  assert.match(elements.dashboardEtfIntraday.innerHTML, /连续一分钟窗口不足/);
  assert.match(elements.dashboardEtfIntraday.innerHTML, /近5分钟成交<\/span><strong>--<\/strong>/);
  assert.doesNotMatch(elements.dashboardEtfIntraday.innerHTML, /动量不可用 0\.00%/);

  module.renderIntraday({ marketState: 'unavailable', etfs: [], futures: [] }, document);
  assert.match(elements.dashboardInstitutionalFlowStatus.textContent, /不可用/);
  module.renderIntraday({ marketState: 'partial', etfs: [], futures: [] }, document);
  assert.match(elements.dashboardInstitutionalFlowStatus.textContent, /部分/);
});
