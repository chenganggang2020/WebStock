(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CapitalFlow = api.createCapitalFlowModule();
})(typeof window !== 'undefined' ? window : null, function() {
  const SOURCE_LABELS = {
    'vendor-classified': '供应商分类口径',
    'authorized-level2': '授权 Level-2 观察',
    'local-estimate': '本地启发式估算'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    const absolute = Math.abs(number);
    if (absolute >= 100000000) return (number / 100000000).toFixed(2) + ' 亿';
    if (absolute >= 10000) return (number / 10000).toFixed(2) + ' 万';
    return number.toFixed(2);
  }

  function timeText(value) {
    if (!value) return '--';
    if (typeof window !== 'undefined' && window.WebStockTime && window.WebStockTime.formatDateTime) {
      return window.WebStockTime.formatDateTime(value);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  }

  function describeSource(source) {
    source = source || {};
    const title = SOURCE_LABELS[source.sourceClass] || '来源未知';
    return {
      title,
      tier: source.provenanceTier || 'unknown',
      detail: [source.provider, source.methodology].filter(Boolean).join(' · ') || '--',
      warning: source.exchangeGroundTruth === false
        ? '来源等级仅说明可追溯性，不等于交易所真值。' + (source.truthStatement ? ' ' + source.truthStatement : '')
        : '来源真值边界未声明。'
    };
  }

  function describeObservation(observation) {
    observation = observation || {};
    const state = observation.state || 'unavailable';
    let label = '不可用';
    if (state === 'fresh' && !observation.isStale) label = '新鲜';
    else if (state === 'stale') label = '已过期';
    return {
      state,
      label,
      observedAt: timeText(observation.observedAt),
      checkedAt: timeText(observation.checkedAt),
      expiresAt: timeText(observation.expiresAt),
      reason: observation.reason || null
    };
  }

  function seriesData(points, key) {
    return (points || []).map(function(point) {
      const value = point[key];
      return [point.timestamp, value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value)];
    });
  }

  function deltaData(points) {
    return (points || []).map(function(point, index) {
      if (index === 0 || point.netAmount === null || point.netAmount === undefined || points[index - 1].netAmount === null || points[index - 1].netAmount === undefined) {
        return [point.timestamp, null];
      }
      return [point.timestamp, Number(point.netAmount) - Number(points[index - 1].netAmount)];
    });
  }

  function buildChartOption(result, theme) {
    const points = result && Array.isArray(result.points) ? result.points : [];
    theme = theme || {};
    const textColor = theme.textColor || '#475569';
    const borderColor = theme.borderColor || '#e2e8f0';
    const sampleWindow = result && result.source && result.source.sourceClass === 'authorized-level2' &&
      (!result.coverage || result.coverage.isComplete !== true);
    const positiveName = result && result.metricContract && result.metricContract.inflowAmount && result.metricContract.inflowAmount.isGross
      ? (sampleWindow ? '样本窗口累计主动买入' : '累计主动买入')
      : '净流入正向部分';
    const negativeName = result && result.metricContract && result.metricContract.outflowAmount && result.metricContract.outflowAmount.isGross
      ? (sampleWindow ? '样本窗口累计主动卖出' : '累计主动卖出')
      : '净流出负向部分';
    const speedUnit = result && result.metricContract && result.metricContract.netFlowSpeed && result.metricContract.netFlowSpeed.unit || 'CNY/min';
    const accelerationUnit = result && result.metricContract && result.metricContract.netFlowAcceleration && result.metricContract.netFlowAcceleration.unit || 'CNY/min²';
    const unitLabel = function(unit) {
      return String(unit).replace(/^CNY/, '元').replace('/min²', '/分钟²').replace('/min', '/分钟');
    };

    return {
      animation: false,
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { top: 0, textStyle: { color: textColor } },
      grid: [
        { left: 66, right: 28, top: 50, height: '34%' },
        { left: 66, right: 28, top: '49%', height: '17%' },
        { left: 66, right: 66, top: '72%', height: '20%' }
      ],
      xAxis: [0, 1, 2].map(function(index) {
        return {
          type: 'time',
          gridIndex: index,
          axisLabel: { color: textColor, show: index === 2 },
          axisLine: { lineStyle: { color: borderColor } },
          splitLine: { show: false }
        };
      }),
      yAxis: [
        { type: 'value', gridIndex: 0, name: '累计金额', axisLabel: { color: textColor }, splitLine: { lineStyle: { color: borderColor } } },
        { type: 'value', gridIndex: 1, name: '本点变化量', axisLabel: { color: textColor }, splitLine: { lineStyle: { color: borderColor } } },
        { type: 'value', gridIndex: 2, position: 'left', name: unitLabel(speedUnit), axisLabel: { color: textColor }, splitLine: { lineStyle: { color: borderColor } } },
        { type: 'value', gridIndex: 2, position: 'right', name: unitLabel(accelerationUnit), axisLabel: { color: textColor }, splitLine: { show: false } }
      ],
      series: [
        { name: positiveName, type: 'line', showSymbol: false, xAxisIndex: 0, yAxisIndex: 0, data: seriesData(points, 'inflowAmount'), lineStyle: { color: '#dc2626' } },
        { name: negativeName, type: 'line', showSymbol: false, xAxisIndex: 0, yAxisIndex: 0, data: seriesData(points, 'outflowAmount'), lineStyle: { color: '#16a34a' } },
        { name: '净额', type: 'line', showSymbol: false, xAxisIndex: 0, yAxisIndex: 0, data: seriesData(points, 'netAmount'), lineStyle: { color: '#2563eb', width: 2 } },
        { name: '净额变化量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: deltaData(points), itemStyle: { color: '#7c3aed' } },
        { name: '净流速度', type: 'line', showSymbol: false, xAxisIndex: 2, yAxisIndex: 2, data: seriesData(points, 'netFlowSpeed'), lineStyle: { color: '#ea580c' } },
        { name: '净流加速度', type: 'line', showSymbol: false, xAxisIndex: 2, yAxisIndex: 3, data: seriesData(points, 'netFlowAcceleration'), lineStyle: { color: '#0891b2', type: 'dashed' } }
      ]
    };
  }

  function defaultFetch(path) {
    if (typeof window === 'undefined') return Promise.reject(new Error('Capital-flow API is available only in the browser'));
    if (window.ApiClient && window.ApiClient.fetchJsonData) return window.ApiClient.fetchJsonData(path);
    return window.fetch(path).then(function(response) {
      return response.json().then(function(payload) {
        if (!response.ok || payload.success === false) {
          const error = new Error(payload.error && payload.error.message || 'Capital-flow request failed');
          error.code = payload.error && payload.error.code;
          throw error;
        }
        return payload.data === undefined ? payload : payload.data;
      });
    });
  }

  function defaultTheme() {
    if (typeof document === 'undefined') return {};
    const style = getComputedStyle(document.body);
    return {
      textColor: style.getPropertyValue('--text').trim() || '#475569',
      borderColor: style.getPropertyValue('--border').trim() || '#e2e8f0'
    };
  }

  function normalizeInput(input) {
    input = input || {};
    return {
      scope: String(input.scope || 'stock').trim(),
      code: String(input.code || '').trim(),
      source: String(input.source || '').trim()
    };
  }

  function queryKey(input) {
    return [input.scope, input.code, input.source].join('|');
  }

  function failedResult(input, error) {
    return {
      availability: 'unavailable',
      scope: input.scope,
      code: input.code,
      source: {
        sourceClass: input.source,
        provenanceTier: 'unavailable',
        provider: null,
        exchangeGroundTruth: false,
        truthStatement: '本次请求失败，未切换到其他资金来源。',
        methodology: null
      },
      observation: {
        observedAt: null,
        checkedAt: new Date().toISOString(),
        expiresAt: null,
        isStale: true,
        state: 'unavailable',
        reason: 'request-failed'
      },
      points: [],
      latest: null,
      error: {
        code: error && error.code || 'CAPITAL_FLOW_REQUEST_FAILED',
        message: error && error.message || String(error)
      },
      limitations: ['请求失败；旧查询结果已清除，且未静默切换数据来源。']
    };
  }

  function loadingResult(input) {
    return {
      availability: 'loading',
      scope: input.scope,
      code: input.code,
      source: {
        sourceClass: input.source,
        provenanceTier: 'pending',
        provider: null,
        exchangeGroundTruth: false,
        truthStatement: '正在检查用户选择的资金来源；未显示旧查询数据。',
        methodology: null
      },
      observation: {
        observedAt: null,
        checkedAt: new Date().toISOString(),
        expiresAt: null,
        isStale: true,
        state: 'loading',
        reason: 'request-pending'
      },
      points: [],
      latest: null,
      limitations: ['正在加载 ' + input.scope + ' ' + input.code + '；旧查询读数已清除。']
    };
  }

  function defaultRenderMeta(data, documentObject) {
    if (!documentObject) return;
    const source = describeSource(data && data.source);
    const observation = describeObservation(data && data.observation);
    const latest = data && data.availability === 'available' ? data.latest : null;
    const state = latest && latest.flowState ? latest.flowState : { code: 'unknown', label: '状态不足' };
    const loading = data && data.availability === 'loading';
    const speedUnit = data && data.metricContract && data.metricContract.netFlowSpeed && data.metricContract.netFlowSpeed.unit || 'CNY/min';
    const accelerationUnit = data && data.metricContract && data.metricContract.netFlowAcceleration && data.metricContract.netFlowAcceleration.unit || 'CNY/min²';
    const unitLabel = function(unit) {
      return String(unit).replace(/^CNY/, '元').replace('/min²', '/分钟²').replace('/min', '/分钟');
    };
    const setText = function(id, value) {
      const element = documentObject.getElementById(id);
      if (element) element.textContent = value;
    };
    setText('capitalFlowSourceTitle', source.title);
    setText('capitalFlowSourceTier', '来源等级：' + source.tier);
    setText('capitalFlowSourceDetail', source.detail);
    setText('capitalFlowTruthWarning', source.warning);
    setText('capitalFlowFreshness', loading ? '加载中' : observation.label);
    setText('capitalFlowObservedAt', '观测时间：' + observation.observedAt);
    setText('capitalFlowCheckedAt', '检查时间：' + observation.checkedAt);
    setText('capitalFlowExpiresAt', '过期时间：' + observation.expiresAt);
    setText('capitalFlowState', state.label);
    setText('capitalFlowNetAmount', money(latest && latest.netAmount));
    setText('capitalFlowSpeed', money(latest && latest.netFlowSpeed) + ' ' + unitLabel(speedUnit));
    setText('capitalFlowAcceleration', money(latest && latest.netFlowAcceleration) + ' ' + unitLabel(accelerationUnit));
    const coverage = data && data.coverage;
    const level2Window = data && data.source && data.source.sourceClass === 'authorized-level2' &&
      (!coverage || coverage.isComplete !== true);
    let historyStatus = data && data.points && data.points.length >= 3
      ? '盘中序列 ' + data.points.length + ' 点'
      : '尚未形成盘中序列；不会补零或生成模拟曲线。';
    if (loading) historyStatus = '正在加载 ' + data.scope + ' ' + data.code + '；旧读数已清除。';
    else if (level2Window) {
      const count = coverage && Number.isFinite(Number(coverage.returnedCount)) ? Number(coverage.returnedCount) : (data.points || []).length;
      const truncated = coverage && (coverage.isComplete === false || Number(coverage.returnedCount) >= Number(coverage.requestedLimit || Infinity));
      historyStatus = '样本窗口 ' + count + ' 条，全天覆盖未知' + (truncated ? '，可能已截断' : '') + '。';
    }
    setText('capitalFlowHistoryStatus', historyStatus);
    const errorBox = documentObject.getElementById('capitalFlowError');
    if (errorBox) {
      errorBox.textContent = data && data.error ? data.error.message : '';
      errorBox.hidden = !(data && data.error);
    }
    const limitations = documentObject.getElementById('capitalFlowLimitations');
    if (limitations) {
      limitations.innerHTML = (data && data.limitations || []).map(function(item) {
        return '<li>' + escapeHtml(item) + '</li>';
      }).join('');
    }
  }

  function createCapitalFlowModule(dependencies) {
    dependencies = dependencies || {};
    const documentObject = dependencies.document || (typeof document !== 'undefined' ? document : null);
    const fetchData = dependencies.fetchData || defaultFetch;
    let chart = null;
    let bound = false;
    let lastResult = null;
    let lastQueryKey = null;
    let requestSequence = 0;

    function getChart() {
      if (dependencies.getChart) return dependencies.getChart();
      if (chart) return chart;
      if (!documentObject || typeof window === 'undefined' || !window.echarts) return null;
      const element = documentObject.getElementById('capitalFlowChart');
      if (!element) return null;
      chart = window.echarts.init(element);
      return chart;
    }

    async function load(input) {
      input = normalizeInput(input);
      const activeQueryKey = queryKey(input);
      const sequence = ++requestSequence;
      const activeChart = getChart();
      if (activeChart && activeChart.clear) activeChart.clear();
      lastResult = null;
      lastQueryKey = null;
      const pending = loadingResult(input);
      if (dependencies.renderMeta) dependencies.renderMeta(pending);
      else defaultRenderMeta(pending, documentObject);
      const path = '/api/capital-flow/series?scope=' + encodeURIComponent(input.scope) +
        '&code=' + encodeURIComponent(input.code) +
        '&source=' + encodeURIComponent(input.source);
      let data;
      try {
        data = await fetchData(path);
      } catch (error) {
        if (sequence !== requestSequence) return null;
        lastResult = null;
        lastQueryKey = null;
        const unavailable = failedResult(input, error);
        if (dependencies.renderMeta) dependencies.renderMeta(unavailable);
        else defaultRenderMeta(unavailable, documentObject);
        throw error;
      }
      if (sequence !== requestSequence) return data;
      lastResult = data;
      lastQueryKey = activeQueryKey;
      if (activeChart && activeChart.clear) activeChart.clear();
      if (dependencies.renderMeta) dependencies.renderMeta(data);
      else defaultRenderMeta(data, documentObject);
      if (data && data.availability === 'available' && data.points && data.points.length && activeChart) {
        activeChart.setOption(buildChartOption(data, dependencies.getTheme ? dependencies.getTheme() : defaultTheme()), true);
      }
      return data;
    }

    function readControls() {
      const scope = documentObject && documentObject.getElementById('capitalFlowScope');
      const code = documentObject && documentObject.getElementById('capitalFlowCode');
      const source = documentObject && documentObject.getElementById('capitalFlowSource');
      return {
        scope: scope ? scope.value : 'stock',
        code: code ? code.value.trim() : '',
        source: source ? source.value : 'vendor-classified'
      };
    }

    function bind() {
      if (bound || !documentObject) return;
      bound = true;
      const refresh = documentObject.getElementById('capitalFlowRefreshBtn');
      if (refresh) refresh.addEventListener('click', function() {
        load(readControls()).catch(function(error) {
          const box = documentObject.getElementById('capitalFlowError');
          if (box) {
            box.hidden = false;
            box.textContent = error.message || String(error);
          }
        });
      });
      const scope = documentObject.getElementById('capitalFlowScope');
      if (scope) scope.addEventListener('change', function() {
        const source = documentObject.getElementById('capitalFlowSource');
        if (source && scope.value === 'sector' && source.value !== 'vendor-classified') source.value = 'vendor-classified';
      });
    }

    function ensureLoaded() {
      bind();
      const input = readControls();
      if (lastResult && lastQueryKey === queryKey(normalizeInput(input))) return Promise.resolve(lastResult);
      if (!input.code) return Promise.resolve(null);
      return load(input);
    }

    function resize() {
      const activeChart = getChart();
      if (activeChart && activeChart.resize) activeChart.resize();
    }

    function rerender() {
      const activeChart = getChart();
      if (activeChart && lastResult && lastResult.availability === 'available') {
        activeChart.setOption(buildChartOption(lastResult, dependencies.getTheme ? dependencies.getTheme() : defaultTheme()), true);
      }
    }

    return { bind, load, ensureLoaded, resize, rerender, readControls };
  }

  return {
    buildChartOption,
    describeSource,
    describeObservation,
    createCapitalFlowModule
  };
});
