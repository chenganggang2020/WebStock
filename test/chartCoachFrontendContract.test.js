const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadChartCoach() {
  const source = fs.readFileSync(path.resolve(__dirname, '../js/modules/chartCoach.js'), 'utf8');
  const context = {
    window: {},
    document: {
      getElementById() { return null; },
      addEventListener() {},
      body: { classList: { add() {}, remove() {} } }
    }
  };
  vm.runInNewContext(source, context, { filename: 'chartCoach.js' });
  return context.window.ChartCoach;
}

function deferred() {
  let resolve;
  const promise = new Promise(function(done) { resolve = done; });
  return { promise, resolve };
}

function loadInteractiveChartCoach(requests) {
  const elements = {
    chartCoachBody: { innerHTML: '' },
    chartCoachBtn: {
      disabled: false,
      addEventListener() {},
      setAttribute() {},
      removeAttribute() {},
      focus() {}
    },
    chartCoachCloseBtn: { addEventListener() {}, focus() {} },
    chartCoachOverlay: { style: { display: 'none' }, addEventListener() {} }
  };
  const window = {
    State: {
      currentStock: { code: '000001' },
      currentPeriod: 'day',
      currentRawData: [{ date: '2026-08-11', open: 10, close: 11, high: 12, low: 9, volume: 100 }]
    },
    ApiClient: {
      apiFetch(path, options) {
        if (path.includes('/api/capital-flow/series')) return Promise.resolve(null);
        const request = deferred();
        request.body = JSON.parse(options.body);
        requests.push(request);
        return request.promise;
      }
    }
  };
  const context = {
    window,
    alert(message) { throw new Error('Unexpected alert: ' + message); },
    document: {
      getElementById(id) { return elements[id] || null; },
      addEventListener() {},
      body: { classList: { add() {}, remove() {} } }
    }
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../js/modules/chartCoach.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'chartCoach.js' });
  return { ChartCoach: window.ChartCoach, state: window.State, body: elements.chartCoachBody };
}

function chartResult(code, period, asOf) {
  return {
    status: 'ok',
    code,
    period,
    asOf,
    coverage: { eligibleBars: 1, minimumBars: 1 },
    observations: [],
    rules: [],
    evidence: [],
    plainMeaning: [],
    confirmations: [],
    invalidation: [],
    limitations: []
  };
}

test('chart coach renders versioned rule definitions and non-predictive knowledge scope', () => {
  const ChartCoach = loadChartCoach();
  const html = ChartCoach.renderResult({
    status: 'ok',
    code: '000001',
    period: 'day',
    asOf: '2026-08-12',
    rulesVersion: 'webstock-chart-rules/1.0.0',
    knowledgeScope: 'phase-one-deterministic-rule-dictionary',
    strategyValidation: 'not-backtested',
    coverage: { eligibleBars: 40, minimumBars: 20 },
    observations: [{
      label: '均线结构',
      state: 'mixed',
      ruleId: 'trend.ma-stack.v1',
      rulesVersion: 'webstock-chart-rules/1.0.0',
      invalidation: ['均线顺序改变时本条观察失效。'],
      limitations: ['只描述历史价格。']
    }],
    rules: [{
      ruleId: 'trend.ma-stack.v1',
      rulesVersion: 'webstock-chart-rules/1.0.0',
      label: '均线结构',
      trigger: '比较收盘与 MA5、MA10、MA20 的顺序。',
      assumptions: ['至少 20 根有效数据。'],
      limitations: ['均线具有滞后性。'],
      predictiveClaim: false
    }],
    knowledgeReferences: [{
      id: 'talib-stoch',
      title: 'TA-Lib STOCH',
      url: 'https://ta-lib.org/functions/stoch.html',
      usage: 'indicator-definition-reference',
      implementedInChartAnalysis: true,
      notes: 'KDJ 与默认 STOCH 输出并不相同。'
    }],
    evidence: [],
    plainMeaning: [],
    confirmations: [],
    invalidation: [],
    limitations: []
  });

  assert.match(html, /规则版本 webstock-chart-rules\/1\.0\.0/);
  assert.match(html, /一期确定性规则词典/);
  assert.match(html, /未经回测/);
  assert.match(html, /trend\.ma-stack\.v1/);
  assert.match(html, /触发口径/);
  assert.match(html, /比较收盘与 MA5、MA10、MA20 的顺序/);
  assert.match(html, /失效条件/);
  assert.match(html, /均线顺序改变时本条观察失效/);
  assert.match(html, /知识范围说明/);
  assert.match(html, /不用于预测或给出买卖建议/);
  assert.match(html, /当前规则参考/);
});

test('chart coach escapes service text and only links http or https references', () => {
  const ChartCoach = loadChartCoach();
  const html = ChartCoach.renderResult({
    status: 'insufficient',
    code: '<img src=x onerror=alert(1)>',
    coverage: {},
    observations: [],
    knowledgeReferences: [
      { title: '<b>unsafe label</b>', url: 'javascript:alert(1)', notes: '<script>x</script>' },
      { title: 'Official reference', url: 'https://example.com/docs', notes: 'safe' }
    ]
  });

  assert.doesNotMatch(html, /<img|<script|href="javascript:/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;b&gt;unsafe label&lt;\/b&gt;/);
  assert.match(html, /href="https:\/\/example\.com\/docs"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('chart coach keeps the newest request when responses complete out of order', async () => {
  const requests = [];
  const loaded = loadInteractiveChartCoach(requests);
  const firstOpen = loaded.ChartCoach.open();

  loaded.state.currentStock = { code: '000002' };
  loaded.state.currentPeriod = 'week';
  loaded.state.currentRawData = [{ date: '2026-08-12', open: 20, close: 21, high: 22, low: 19, volume: 200 }];
  const secondOpen = loaded.ChartCoach.open();

  requests[1].resolve(chartResult('000002', 'week', '2026-08-12'));
  await secondOpen;
  assert.match(loaded.body.innerHTML, /000002/);

  requests[0].resolve(chartResult('000001', 'day', '2026-08-11'));
  await firstOpen;
  assert.match(loaded.body.innerHTML, /000002/);
  assert.doesNotMatch(loaded.body.innerHTML, /000001/);
});

test('chart coach ignores a response after the selected chart identity changes', async () => {
  const requests = [];
  const loaded = loadInteractiveChartCoach(requests);
  const opening = loaded.ChartCoach.open();
  const loadingHtml = loaded.body.innerHTML;

  loaded.state.currentPeriod = 'week';
  requests[0].resolve(chartResult('000001', 'day', '2026-08-11'));
  await opening;

  assert.equal(loaded.body.innerHTML, loadingHtml);
  assert.doesNotMatch(loaded.body.innerHTML, /000001/);
});

test('chart coach converts deterministic evidence into non-predictive chart marks', () => {
  const ChartCoach = loadChartCoach();
  const bars = [
    { date: '2026-08-11', open: 10, high: 11.5, low: 9.8, close: 11.2 },
    { date: '2026-08-12', open: 12.1, high: 12.8, low: 12, close: 12.6 }
  ];
  const result = {
    status: 'ok',
    observations: [
      { id: 'breakout', category: 'breakout', label: '20 根区间突破', state: 'upward-breakout', evidenceIds: ['E1', 'E2'] },
      { id: 'gap', category: 'gap', label: '完整跳空缺口', state: 'up-gap', evidenceIds: ['E3', 'E4'] }
    ],
    evidence: [
      { id: 'E1', observationId: 'breakout', metric: 'prior_high_20', label: '此前20根最高价', value: 12 },
      { id: 'E2', observationId: 'breakout', metric: 'latest_close', label: '最新收盘', value: 12.6, lastBarAt: '2026-08-12' },
      { id: 'E3', observationId: 'gap', metric: 'previous_high', label: '前一根最高', value: 11.5, lastBarAt: '2026-08-11' },
      { id: 'E4', observationId: 'gap', metric: 'latest_low', label: '最新最低', value: 12, lastBarAt: '2026-08-12' }
    ]
  };

  const marks = ChartCoach.buildChartMarks(result, bars);

  assert.ok(marks.markLine.data.some(item => item.yAxis === 12));
  assert.ok(marks.markPoint.data.some(item => item.coord[0] === '2026-08-12'));
  assert.equal(marks.markArea.data.length, 1);
  assert.doesNotMatch(JSON.stringify(marks), /预测|目标价|买入|卖出/);
});

test('chart coach renders larger support resistance and historical validation symbols', () => {
  const ChartCoach = loadChartCoach();
  const bars = [
    { date: '2026-08-11', open: 10, high: 11, low: 9.8, close: 10.8 },
    { date: '2026-08-12', open: 10.9, high: 12.2, low: 10.8, close: 12 }
  ];
  const marks = ChartCoach.buildChartMarks({
    chartAnnotations: {
      currentLevels: {
        resistance: { price: 12.8, label: 'R1 压力', shortLabel: '压', basis: '前一周期 OHLC' },
        support: { price: 10.2, label: 'S1 支撑', shortLabel: '撑', basis: '前一周期 OHLC' }
      },
      events: [{
        type: 'breakout-up', marker: '突', label: '20周期向上突破', date: '2026-08-12',
        price: 10.8, direction: 'positive', triggerUsesFutureData: false,
        validation: { status: 'available', bars: 5, forwardClosePct: 3.2, maxPct: 5, minPct: -1 }
      }]
    }
  }, bars);

  assert.ok(marks.markLine.data.some(item => item.yAxis === 12.8 && item.label.fontSize >= 13));
  assert.ok(marks.markLine.data.some(item => item.yAxis === 10.2 && item.label.fontSize >= 13));
  assert.ok(marks.markPoint.data.some(item => item.value === '突' && item.symbolSize >= 40));
});

test('chart coach explains strength-graded key levels and marks their last confirmed touches', () => {
  const ChartCoach = loadChartCoach();
  const result = chartResult('000001', 'day', '2026-08-12');
  result.chartAnnotations = {
    keyLevels: {
      rulesVersion: 'webstock-key-levels/1.0.0',
      tolerance: 0.18,
      method: { strengthRule: '强=至少3次触碰且至少2次反向收盘；中=至少2次触碰；弱=1次触碰', toleranceRule: 'max(latestClose*0.5%, ATR14*35%)' },
      support: {
        type: 'support', price: 10.12, label: '关键支撑', shortLabel: '强支', strengthKey: 'strong',
        strengthLabel: '强', touchCount: 3, rejectionCount: 3, volumeConfirmedTouches: 1,
        lastTouchAt: '2026-08-10', touchDates: ['2026-07-10', '2026-07-28', '2026-08-10'],
        distancePct: -4.2, basis: '过去60根局部低点聚类', statusLabel: '价格位于支撑上方'
      },
      resistance: {
        type: 'resistance', price: 12.88, label: '关键压力', shortLabel: '中压', strengthKey: 'moderate',
        strengthLabel: '中', touchCount: 2, rejectionCount: 1, volumeConfirmedTouches: 0,
        lastTouchAt: '2026-08-08', touchDates: ['2026-07-20', '2026-08-08'],
        distancePct: 6.1, basis: '过去60根局部高点聚类', statusLabel: '价格位于压力下方'
      },
      limitations: ['关键位是历史证据区，不是价格预测。']
    },
    currentLevels: null,
    events: []
  };

  const html = ChartCoach.renderResult(result);
  const strip = ChartCoach.renderEvidenceStrip(result);
  const marks = ChartCoach.buildChartMarks(result, [{ date: '2026-08-12', close: 10.56 }]);

  assert.match(html, /关键价位强度/);
  assert.match(html, /强支撑/);
  assert.match(html, /触碰 3 次/);
  assert.match(html, /量能确认 1 次/);
  assert.match(html, /不是价格预测/);
  assert.match(strip, /关键支撑/);
  assert.match(strip, /强 · 3次触碰/);
  assert.match(strip, /强=至少3次触碰/);
  assert.match(strip, /chartCoachFlowEvidence/);
  assert.match(strip, /chartCoachNewsEvidence/);
  assert.match(strip, /chartCoachGptEvidence/);
  assert.ok(marks.markLine.data.some(item => item.yAxis === 10.12 && /强支/.test(item.label.formatter)));
  assert.ok(marks.markPoint.data.some(item => item.coord[0] === '2026-08-10' && item.value === '撑'));
});

test('chart coach renders daily GPT, news and capital-flow evidence as separate unverified sources', () => {
  const ChartCoach = loadChartCoach();
  const gptHtml = ChartCoach.renderGptPickHistory({
    code: '000001', source: 'manual-chatgpt', automaticTrading: false,
    items: [{
      importId: 7, importedAt: '2026-08-15T01:00:00.000Z', title: '盘前候选',
      candidate: { code: '000001', name: '平安银行', reason: '估值修复', risk: '息差压力', originalAnalysis: '等待量价确认' }
    }],
    limitations: ['ChatGPT 内容未由 WebStock 验证。']
  });
  const newsHtml = ChartCoach.renderNewsEvidence({
    items: [{ title: '业绩预告', publishedAt: '2026-08-15T00:30:00.000Z', source: '交易所公告',
      importance: { label: '重点', score: 80, reasons: ['公告事件'] } }],
    coverage: { returned: 1 }
  });
  const flowHtml = ChartCoach.renderCapitalFlowEvidence({
    availability: 'available', source: { sourceClass: 'vendor-classified', provider: 'Eastmoney' },
    observation: { state: 'fresh', observedAt: '2026-08-15T02:00:00.000Z' },
    latest: { netAmount: 12000000, netFlowSpeed: -300000, netFlowAcceleration: -20000, flowState: { label: '流入减速' } },
    limitations: ['供应商分类不等于交易所真值。']
  });

  assert.match(gptHtml, /手动 GPT 研究记录/);
  assert.match(gptHtml, /估值修复/);
  assert.match(gptHtml, /未由 WebStock 验证/);
  assert.doesNotMatch(gptHtml, /自动交易|买入信号/);
  assert.match(newsHtml, /业绩预告/);
  assert.match(newsHtml, /本地重要性/);
  assert.match(flowHtml, /流入减速/);
  assert.match(flowHtml, /供应商分类/);
  assert.match(flowHtml, /减速/);
});

test('chart coach only marks fresh provider-classified capital flow with provenance', () => {
  const ChartCoach = loadChartCoach();
  const bars = [{ date: '2026-08-12', close: 12 }];
  const fresh = ChartCoach.buildCapitalFlowMark({
    availability: 'available',
    source: { sourceClass: 'vendor-classified', provider: 'Eastmoney' },
    observation: { state: 'fresh', observedAt: '2026-08-12T06:55:00.000Z' },
    latest: { netAmount: 23000000, flowState: { label: '持续流入' } }
  }, bars);
  const stale = ChartCoach.buildCapitalFlowMark({
    availability: 'available',
    source: { sourceClass: 'vendor-classified', provider: 'Eastmoney' },
    observation: { state: 'stale', observedAt: '2026-08-11T06:55:00.000Z' },
    latest: { netAmount: 23000000 }
  }, bars);

  assert.equal(fresh.value, '资');
  assert.match(fresh.signal.detail, /Eastmoney/);
  assert.match(fresh.signal.detail, /供应商分类/);
  assert.equal(stale, null);
});

test('chart coach signal tooltip labels historical forward values as retrospective validation', () => {
  const ChartCoach = loadChartCoach();
  const html = ChartCoach.signalTooltip({
    label: '20周期向上突破',
    triggerUsesFutureData: false,
    triggerEvidence: { close: 12, threshold: 11.8, volumeRatio: 2.1 },
    validation: { status: 'available', bars: 5, forwardClosePct: 3.2, maxPct: 5.1, minPct: -1.3 }
  });

  assert.match(html, /后验回看 5 根/);
  assert.match(html, /触发未使用未来数据/);
  assert.doesNotMatch(html, /预测|目标价|买入|卖出/);
});
