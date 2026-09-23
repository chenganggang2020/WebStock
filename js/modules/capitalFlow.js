(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CapitalFlow = api.createCapitalFlowModule();
})(typeof window !== 'undefined' ? window : null, function() {
  const SOURCE_LABELS = {
    'vendor-classified': '东方财富资金分类',
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
      detail: source.sourceClass === 'vendor-classified' ? '按来源的大单、小单等分类汇总净额；分类阈值未提供。' : [source.provider, source.methodology].filter(Boolean).join(' · ') || '--',
      warning: source.exchangeGroundTruth === false
        ? '来源等级仅说明可追溯性，不等于交易所真值。' + (source.truthStatement ? ' ' + source.truthStatement : '')
        : '来源真值边界未声明。'
    };
  }

  function describeObservation(observation) {
    observation = observation || {};
    const state = observation.state || 'unavailable';
    let label = '不可用';
    if (observation.observedAt && state !== 'unavailable') label = '数据时间已标注';
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
    const rawPoints = result && Array.isArray(result.points) ? result.points : [];
    // Keep lunch adjacent without connecting genuine missing trading minutes.
    const byTime = new Map(rawPoints.map(point => [Date.parse(point.timestamp), point]));
    const stamps = Array.from(byTime.keys()).filter(Number.isFinite).sort((a,b) => a-b);
    if (stamps.length) for (let t = Math.ceil(stamps[0]/60000)*60000; t < stamps[stamps.length-1]; t += 60000) {
      const date = new Date(t + 8*3600000), minute = date.getUTCHours()*60 + date.getUTCMinutes();
      if ((minute >= 570 && minute <= 690 || minute >= 780 && minute <= 900) && !byTime.has(t)) byTime.set(t,{timestamp:new Date(t).toISOString()});
    }
    const points = Array.from(byTime.entries()).sort((a,b)=>a[0]-b[0]).filter(([t]) => {
      const date = new Date(t+8*3600000), minute = date.getUTCHours()*60+date.getUTCMinutes();
      return minute <= 690 || minute >= 780;
    }).map(([,point])=>point);
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
          type: 'category',
          data: points.map(point=>point.timestamp),
          boundaryGap: false,
          gridIndex: index,
          axisLabel: { color: textColor, show: index === 2, hideOverlap:true,
            formatter: value => new Date(Date.parse(value)+8*3600000).toISOString().slice(11,16) },
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
      source: String(input.source || '').trim(),
      date: String(input.date || '').trim(),
      refresh: input.refresh === true
    };
  }

  function queryKey(input) {
    return [input.scope, input.code, input.source, input.date].join('|');
  }

  function formatCapitalFlowError(error) {
    const message = String(error && error.message || error || '').trim();
    const code = String(error && error.code || '').trim();
    if (/socket hang up|ECONN(?:RESET|REFUSED|ABORTED)|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|network error|upstream timeout/i.test(message + ' ' + code)) {
      return '所选盘中资金来源当前不可用；未切换其他来源，请稍后手动重试。';
    }
    return message || '所选盘中资金来源当前不可用；未切换其他来源，请稍后手动重试。';
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
        message: formatCapitalFlowError(error)
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
    setText('capitalFlowSourceTier', data && data.source && data.source.provider || '--');
    setText('capitalFlowSourceDetail', source.detail);
    setText('capitalFlowTruthWarning', '');
    setText('capitalFlowFreshness', loading ? '加载中' : data?.history?.fromCache ? '历史记录 · ' + data.history.tradingDay : observation.label);
    setText('capitalFlowObservedAt', '观测时间：' + observation.observedAt);
    setText('capitalFlowCheckedAt', '检查时间：' + observation.checkedAt);
    setText('capitalFlowExpiresAt', '');
    setText('capitalFlowState', state.label);
    setText('capitalFlowNetAmount', money(latest && latest.netAmount));
    setText('capitalFlowSpeed', money(latest && latest.netFlowSpeed) + ' ' + unitLabel(speedUnit));
    setText('capitalFlowAcceleration', money(latest && latest.netFlowAcceleration) + ' ' + unitLabel(accelerationUnit));
    const chartElement = documentObject.getElementById('capitalFlowChart');
    if (chartElement) {
      if (!chartElement.dataset) chartElement.dataset = {};
      chartElement.dataset.empty = data && data.availability === 'available' && Array.isArray(data.points) && data.points.length
        ? 'false'
        : 'true';
    }
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
    if (data?.history?.tradingDay) historyStatus = data.history.tradingDay + ' · ' + historyStatus;
    if (data?.history?.availableDates?.length) historyStatus += ' · 已存 ' + data.history.availableDates.length + ' 个交易日';
    setText('capitalFlowHistoryStatus', historyStatus);
    const errorBox = documentObject.getElementById('capitalFlowError');
    if (errorBox) {
      errorBox.textContent = data?.historyWarning || (data?.refreshError ? (data?.history?.fromCache ? '本次刷新未成功，已保留历史记录；数据日期见上方。' : '本次刷新未成功，且尚无该日期历史记录。') : data && data.error ? formatCapitalFlowError(data.error) : '');
      errorBox.hidden = !(data && (data.error || data.refreshError || data.historyWarning));
    }
    const limitations = documentObject.getElementById('capitalFlowLimitations');
    if (limitations) {
      limitations.innerHTML = (data && data.limitations || []).map(function(item) {
        const labels={
          'Inflow and outflow are the positive and negative portions of vendor net flow, not gross buys and sells.':'流入、流出为净额的正负部分，不是买入总额、卖出总额。',
          'Provider bucket definitions and classification thresholds are not verified in this repository.':'大单、小单等分档阈值由来源定义，当前未提供阈值细节。'
        };
        return '<li>' + escapeHtml(labels[item] || item) + '</li>';
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
    let lastLoadedAt = 0;
    const now = dependencies.now || Date.now;
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
      lastLoadedAt = 0;
      const pending = loadingResult(input);
      const onDemandStatus = documentObject && documentObject.getElementById('capitalFlowOnDemandStatus');
      if (onDemandStatus) onDemandStatus.textContent = '正在查询所选来源；旧读数已清除…';
      if (dependencies.renderMeta) dependencies.renderMeta(pending);
      else defaultRenderMeta(pending, documentObject);
      const path = '/api/capital-flow/series?scope=' + encodeURIComponent(input.scope) +
        '&code=' + encodeURIComponent(input.code) +
        '&source=' + encodeURIComponent(input.source) +
        (input.date ? '&date=' + encodeURIComponent(input.date) : '') + (input.refresh ? '&refresh=1' : '');
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
        if (onDemandStatus) onDemandStatus.textContent = unavailable.error.message;
        throw error;
      }
      if (sequence !== requestSequence) return data;
      lastResult = data;
      lastQueryKey = activeQueryKey;
      lastLoadedAt = now();
      if (activeChart && activeChart.clear) activeChart.clear();
      if (dependencies.renderMeta) dependencies.renderMeta(data);
      else defaultRenderMeta(data, documentObject);
      if (onDemandStatus) {
        onDemandStatus.textContent = data && data.availability === 'available'
          ? (data.historyWarning || (data.history?.fromCache ? '显示已保存的历史资金；可选择日期或刷新来源。' : '已取得来源数据；成功记录自动存档。'))
          : '所选来源未返回可用观测；未切换其他来源。';
      }
      if (data && data.availability === 'available' && data.points && data.points.length && activeChart) {
        if (activeChart.resize) activeChart.resize();
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
        source: source ? source.value : 'vendor-classified',
        date: documentObject?.getElementById('capitalFlowDate')?.value || ''
      };
    }

    function bind() {
      if (bound || !documentObject) return;
      bound = true;
      const refresh = documentObject.getElementById('capitalFlowRefreshBtn');
      if (refresh) refresh.addEventListener('click', function() {
        load({ ...readControls(), refresh: true }).catch(function(error) {
          const box = documentObject.getElementById('capitalFlowError');
          if (box) {
            box.hidden = false;
            box.textContent = formatCapitalFlowError(error);
          }
        });
      });
      const scope = documentObject.getElementById('capitalFlowScope');
      documentObject.getElementById('capitalFlowDate')?.addEventListener('change', () => load(readControls()).catch(() => {}));
      documentObject.getElementById('capitalFlowLatestBtn')?.addEventListener('click', () => {
        documentObject.getElementById('capitalFlowDate').value = '';
        load(readControls()).catch(() => {});
      });
      if (scope) scope.addEventListener('change', function() {
        const source = documentObject.getElementById('capitalFlowSource');
        if (source && scope.value === 'sector' && source.value !== 'vendor-classified') source.value = 'vendor-classified';
      });
    }

    function ensureLoaded() {
      bind();
      const input = readControls();
      if (lastResult && lastResult.availability === 'available' &&
          lastQueryKey === queryKey(normalizeInput(input)) && now() - lastLoadedAt < 15000) return Promise.resolve(lastResult);
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
    formatCapitalFlowError,
    createCapitalFlowModule
  };
});
