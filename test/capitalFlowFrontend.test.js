const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildChartOption,
  describeSource,
  describeObservation,
  createCapitalFlowModule
} = require('../js/modules/capitalFlow');

function sampleResult(overrides = {}) {
  return Object.assign({
    schema: 'webstock.capital-flow.v1',
    availability: 'available',
    scope: 'stock',
    code: '000001',
    name: '平安银行',
    source: {
      sourceClass: 'vendor-classified',
      provenanceTier: 'provider-classified',
      provider: 'Eastmoney',
      exchangeGroundTruth: false,
      truthStatement: 'Provider-classified data is not exchange ground truth.',
      methodology: 'Provider-defined capital-size buckets.',
      observationTimeBasis: 'provider-minute-label'
    },
    observation: {
      observedAt: '2026-08-12T05:06:00.000Z',
      checkedAt: '2026-08-12T05:10:00.000Z',
      expiresAt: '2026-08-12T05:16:00.000Z',
      isStale: false,
      state: 'fresh',
      reason: null
    },
    metricContract: {
      inflowAmount: { isGross: false },
      outflowAmount: { isGross: false },
      netFlowSpeed: { unit: 'CNY/min' },
      netFlowAcceleration: { unit: 'CNY/min²' }
    },
    points: [
      {
        timestamp: '2026-08-12T05:05:00.000Z',
        inflowAmount: 100,
        outflowAmount: 0,
        netAmount: 100,
        netFlowSpeed: null,
        netFlowAcceleration: null,
        flowState: { code: 'unknown', label: '状态不足' }
      },
      {
        timestamp: '2026-08-12T05:06:00.000Z',
        inflowAmount: 300,
        outflowAmount: 0,
        netAmount: 300,
        netFlowSpeed: 200,
        netFlowAcceleration: null,
        flowState: { code: 'sustained-inflow', label: '持续流入' }
      }
    ],
    latest: {
      timestamp: '2026-08-12T05:06:00.000Z',
      inflowAmount: 300,
      outflowAmount: 0,
      netAmount: 300,
      netFlowSpeed: 200,
      netFlowAcceleration: null,
      flowState: { code: 'sustained-inflow', label: '持续流入' }
    },
    limitations: ['Not gross purchases or sales.']
  }, overrides);
}

test('buildChartOption creates flow, speed, and acceleration panels without changing null to zero', () => {
  const option = buildChartOption(sampleResult(), { textColor: '#111827', borderColor: '#e5e7eb' });

  assert.equal(option.grid.length, 3);
  assert.equal(option.xAxis.length, 3);
  assert.equal(option.yAxis.length, 4);
  assert.deepEqual(option.series.map(function(series) { return series.name; }), [
    '净流入正向部分', '净流出负向部分', '净额', '净额变化量', '净流速度', '净流加速度'
  ]);
  assert.equal(option.series[3].data[0][1], null);
  assert.equal(option.series[4].data[0][1], null);
  assert.equal(option.series[5].data[0][1], null);
  assert.equal(option.series[5].data[1][1], null);
  assert.equal(option.yAxis[2].name, '元/分钟');
  assert.equal(option.yAxis[3].name, '元/分钟²');
  assert.equal(option.series[4].yAxisIndex, 2);
  assert.equal(option.series[5].yAxisIndex, 3);
});

test('describeSource exposes provenance tier and the non-exchange-truth warning', () => {
  const description = describeSource(sampleResult().source);

  assert.match(description.title, /供应商分类/);
  assert.match(description.detail, /Eastmoney/);
  assert.match(description.warning, /不等于交易所真值/);
  assert.equal(description.tier, 'provider-classified');
});

test('describeObservation renders fresh, stale, and unavailable as explicit text', () => {
  assert.match(describeObservation(sampleResult().observation).label, /新鲜/);
  assert.match(describeObservation(Object.assign({}, sampleResult().observation, {
    isStale: true,
    state: 'stale',
    reason: 'age-exceeds-threshold'
  })).label, /已过期/);
  assert.match(describeObservation({
    observedAt: null,
    checkedAt: '2026-08-12T05:10:00.000Z',
    expiresAt: null,
    isStale: true,
    state: 'unavailable',
    reason: 'observation-time-unavailable'
  }).label, /不可用/);
  assert.match(describeObservation({
    observedAt: '2026-08-12T06:10:00.000Z',
    checkedAt: '2026-08-12T05:10:00.000Z',
    expiresAt: null,
    isStale: true,
    state: 'unavailable',
    reason: 'observation-time-in-future'
  }).label, /不可用/);
});

test('module clears the previous chart before an unavailable result and never falls back', async () => {
  const calls = [];
  const chart = {
    clearCalls: 0,
    options: [],
    clear: function() { this.clearCalls += 1; },
    setOption: function(option) { this.options.push(option); },
    resize: function() {},
    dispose: function() {}
  };
  const module = createCapitalFlowModule({
    fetchData: async function(path) {
      calls.push(path);
      return {
        availability: 'unavailable',
        scope: 'stock',
        code: '000001',
        source: {
          sourceClass: 'authorized-level2',
          provenanceTier: 'authorized-level2-observation',
          provider: 'disabled',
          exchangeGroundTruth: false,
          truthStatement: 'Authorized gateway observations are not exchange ground truth.'
        },
        observation: {
          observedAt: null,
          checkedAt: '2026-08-12T05:10:00.000Z',
          expiresAt: null,
          isStale: true,
          state: 'unavailable'
        },
        points: [],
        latest: null,
        error: { code: 'LEVEL2_NOT_CONFIGURED', message: 'No fallback source was used.' }
      };
    },
    getChart: function() { return chart; },
    renderMeta: function(data) { calls.push(data.availability); }
  });

  const result = await module.load({ scope: 'stock', code: '000001', source: 'authorized-level2' });

  assert.equal(chart.clearCalls, 2);
  assert.equal(chart.options.length, 0);
  assert.equal(result.availability, 'unavailable');
  assert.match(calls.find(function(call) { return typeof call === 'string' && call.startsWith('/api/'); }), /source=authorized-level2/);
  assert.equal(calls.some(function(call) { return String(call).includes('vendor-classified'); }), false);
});

test('module does not schedule recurring sampling when it is created or bound', () => {
  let timerCalls = 0;
  const module = createCapitalFlowModule({
    setInterval: function() { timerCalls += 1; },
    document: {
      getElementById: function() { return null; }
    }
  });

  module.bind();
  assert.equal(timerCalls, 0);
});

test('metric cards render unknown values as dashes instead of zero', async () => {
  const elements = {};
  const document = {
    getElementById: function(id) {
      if (!elements[id]) elements[id] = { textContent: '', hidden: false, innerHTML: '' };
      return elements[id];
    }
  };
  const module = createCapitalFlowModule({
    document,
    getChart: function() { return null; },
    fetchData: async function() { return sampleResult(); }
  });

  await module.load({ scope: 'stock', code: '000001', source: 'vendor-classified' });

  assert.equal(elements.capitalFlowAcceleration.textContent, '-- 元/分钟²');
});

test('starting a new query immediately clears old metrics and identifies the pending selection', async () => {
  const elements = {};
  const document = {
    getElementById: function(id) {
      if (!elements[id]) elements[id] = { textContent: '', hidden: false, innerHTML: '' };
      return elements[id];
    }
  };
  let resolvePending;
  let callCount = 0;
  const module = createCapitalFlowModule({
    document,
    getChart: function() { return { clear: function() {}, setOption: function() {} }; },
    fetchData: function() {
      callCount += 1;
      if (callCount === 1) return Promise.resolve(sampleResult());
      return new Promise(function(resolve) { resolvePending = resolve; });
    }
  });

  await module.load({ scope: 'stock', code: '000001', source: 'vendor-classified' });
  assert.equal(elements.capitalFlowNetAmount.textContent, '300.00');

  const pending = module.load({ scope: 'stock', code: '000002', source: 'local-estimate' });
  assert.equal(elements.capitalFlowNetAmount.textContent, '--');
  assert.equal(elements.capitalFlowFreshness.textContent, '加载中');
  assert.match(elements.capitalFlowSourceTitle.textContent, /本地启发式/);
  assert.match(elements.capitalFlowHistoryStatus.textContent, /000002/);

  resolvePending(sampleResult({ code: '000002' }));
  await pending;
});

test('theme rerender cannot restore an old chart while a new query is pending', async () => {
  let resolvePending;
  let callCount = 0;
  const chart = {
    clearCalls: 0,
    options: [],
    clear: function() { this.clearCalls += 1; },
    setOption: function(option) { this.options.push(option); }
  };
  const module = createCapitalFlowModule({
    getChart: function() { return chart; },
    renderMeta: function() {},
    fetchData: function() {
      callCount += 1;
      if (callCount === 1) return Promise.resolve(sampleResult());
      return new Promise(function(resolve) { resolvePending = resolve; });
    }
  });

  await module.load({ scope: 'stock', code: '000001', source: 'vendor-classified' });
  assert.equal(chart.options.length, 1);
  const pending = module.load({ scope: 'stock', code: '000002', source: 'local-estimate' });
  module.rerender();
  assert.equal(chart.options.length, 1);

  resolvePending(sampleResult({ code: '000002' }));
  await pending;
  assert.equal(chart.options.length, 2);
});

test('unavailable future observations never render their invalid latest amount', async () => {
  const elements = {};
  const document = {
    getElementById: function(id) {
      if (!elements[id]) elements[id] = { textContent: '', hidden: false, innerHTML: '' };
      return elements[id];
    }
  };
  const future = sampleResult({
    availability: 'unavailable',
    observation: {
      observedAt: '2026-08-12T06:10:00.000Z',
      checkedAt: '2026-08-12T05:10:00.000Z',
      expiresAt: null,
      isStale: true,
      state: 'unavailable',
      reason: 'observation-time-in-future'
    }
  });
  const module = createCapitalFlowModule({
    document,
    getChart: function() { return null; },
    fetchData: async function() { return future; }
  });

  await module.load({ scope: 'stock', code: '000001', source: 'vendor-classified' });
  assert.equal(elements.capitalFlowFreshness.textContent, '不可用');
  assert.equal(elements.capitalFlowNetAmount.textContent, '--');
  assert.equal(elements.capitalFlowSpeed.textContent, '-- 元/分钟');
});

test('authorized Level-2 is labeled as a sample window unless full-session coverage is proven', async () => {
  const elements = {};
  const document = {
    getElementById: function(id) {
      if (!elements[id]) elements[id] = { textContent: '', hidden: false, innerHTML: '' };
      return elements[id];
    }
  };
  const level2 = sampleResult({
    source: Object.assign({}, sampleResult().source, {
      sourceClass: 'authorized-level2',
      provenanceTier: 'authorized-level2-observation'
    }),
    metricContract: {
      inflowAmount: { isGross: true },
      outflowAmount: { isGross: true },
      netFlowSpeed: { unit: 'CNY/min' },
      netFlowAcceleration: { unit: 'CNY/min²' }
    },
    coverage: {
      requestedLimit: 1000,
      returnedCount: 1000,
      coverageStart: '2026-08-12T05:00:00.000Z',
      coverageEnd: '2026-08-12T06:00:00.000Z',
      isComplete: false,
      ordering: 'ascending'
    }
  });
  const option = buildChartOption(level2);
  const module = createCapitalFlowModule({
    document,
    getChart: function() { return null; },
    fetchData: async function() { return level2; }
  });

  assert.match(option.series[0].name, /样本窗口累计/);
  await module.load({ scope: 'stock', code: '000001', source: 'authorized-level2' });
  assert.match(elements.capitalFlowHistoryStatus.textContent, /样本窗口/);
  assert.match(elements.capitalFlowHistoryStatus.textContent, /全天覆盖未知/);
  assert.match(elements.capitalFlowHistoryStatus.textContent, /可能已截断/);
});

test('ensureLoaded requests again when scope, code, or source no longer match the cached result', async () => {
  const controls = {
    capitalFlowScope: { value: 'stock', addEventListener: function() {} },
    capitalFlowCode: { value: '000001', addEventListener: function() {} },
    capitalFlowSource: { value: 'vendor-classified', addEventListener: function() {} }
  };
  const paths = [];
  const module = createCapitalFlowModule({
    document: {
      getElementById: function(id) { return controls[id] || null; }
    },
    getChart: function() { return null; },
    renderMeta: function() {},
    fetchData: async function(path) {
      paths.push(path);
      return sampleResult({ code: paths.length === 1 ? '000001' : '000002' });
    }
  });

  await module.load({ scope: 'stock', code: '000001', source: 'vendor-classified' });
  controls.capitalFlowCode.value = '000002';
  await module.ensureLoaded();

  assert.equal(paths.length, 2);
  assert.match(paths[1], /code=000002/);
});

test('a slow response for an older query cannot replace the newer query result', async () => {
  const pending = [];
  const renderedStates = [];
  const chart = {
    clear: function() {},
    setOptionCalls: 0,
    setOption: function() { this.setOptionCalls += 1; }
  };
  const module = createCapitalFlowModule({
    getChart: function() { return chart; },
    renderMeta: function(data) { renderedStates.push(data.availability + ':' + data.code); },
    fetchData: function() {
      return new Promise(function(resolve, reject) {
        pending.push({ resolve, reject });
      });
    }
  });

  const older = module.load({ scope: 'stock', code: '000001', source: 'vendor-classified' });
  const newer = module.load({ scope: 'stock', code: '000002', source: 'vendor-classified' });
  pending[1].resolve(sampleResult({ code: '000002' }));
  await newer;
  pending[0].resolve(sampleResult({ code: '000001' }));
  await older;

  assert.deepEqual(renderedStates, ['loading:000001', 'loading:000002', 'available:000002']);
  assert.equal(chart.setOptionCalls, 1);
});

test('a failed current query clears old chart metadata and identifies the requested source without fallback', async () => {
  const elements = {};
  const document = {
    getElementById: function(id) {
      if (!elements[id]) elements[id] = { textContent: '', hidden: false, innerHTML: '' };
      return elements[id];
    }
  };
  const paths = [];
  const chart = {
    clearCalls: 0,
    clear: function() { this.clearCalls += 1; },
    setOption: function() {}
  };
  const module = createCapitalFlowModule({
    document,
    getChart: function() { return chart; },
    fetchData: async function(path) {
      paths.push(path);
      if (paths.length === 1) return sampleResult();
      throw new Error('upstream timeout');
    }
  });

  await module.load({ scope: 'stock', code: '000001', source: 'vendor-classified' });
  assert.equal(elements.capitalFlowNetAmount.textContent, '300.00');
  await assert.rejects(
    module.load({ scope: 'stock', code: '000002', source: 'local-estimate' }),
    /upstream timeout/
  );

  assert.equal(elements.capitalFlowNetAmount.textContent, '--');
  assert.equal(elements.capitalFlowError.hidden, false);
  assert.match(elements.capitalFlowError.textContent, /upstream timeout/);
  assert.equal(paths.length, 2);
  assert.match(paths[1], /source=local-estimate/);
  assert.ok(chart.clearCalls >= 3);
});
