(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MarketComparison = api;
})(typeof window !== 'undefined' ? window : null, function(root) {
  const COLORS = ['#494fdf', '#f6c445', '#a78bfa', '#e23b4a', '#00a87e', '#38bdf8', '#e61e49', '#8d969e'];
  const DEFAULT_SELECTED_KEYS = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
  let comparisonChart = null;
  let heatmapChart = null;
  let indexDetailChart = null;
  let indexDetailKey = '';
  let indexDetailPeriod = 'intraday';
  let indexDetailRefreshTimer = null;
  let heatmapRefreshTimer = null;
  let heatmapSnapshot = null;
  let heatmapSnapshotLoaded = false;
  let heatmapRequestSequence = 0;
  let heatmapDrillSnapshot = null;
  let heatmapDrillBoard = null;
  let miniCharts = [];
  let bound = false;
  let snapshot = null;
  let selectedWindow = 60;
  let heatmapMode = 'turnover';
  let heatmapBoardType = 'concept';
  let heatmapDensity = 'focus';
  let windowRequestSequence = 0;
  let activeWindowRequestId = 0;
  let selectedWindowPinned = false;
  let indexCardsSignature = '';
  let historyRenderSignature = '';
  let heatmapRenderSignature = '';
  let selectedPeriod = 'intraday';
  let catalog = [];
  let catalogStatus = null;
  let selectedKeys = DEFAULT_SELECTED_KEYS.slice();
  let draftSelectedKeys = selectedKeys.slice();
  let comparisonKindFilter = 'all';
  let dailyComparison = null;
  let intradayComparison = null;
  const historicalComparisons = new Map();
  const indexHistoryByPeriod = new Map();
  let indexIntraday = null;
  let comparisonRequestSequence = 0;
  let activeComparisonRequestId = 0;
  let indexIntradayRequestSequence = 0;
  let intradayRefreshTimer = null;
  let globalSignalsRefreshTimer = null;
  let globalSignalsSignature = '';
  const historyCacheByWindow = new Map();
  const comparisonCache = new Map();
  const HISTORY_CACHE_MS = 5 * 60 * 1000;
  const INTRADAY_CACHE_MS = 12 * 1000;
  const SELECTION_STORAGE_KEY = 'webstock.marketComparison.selection.v1';
  const PERIOD_STORAGE_KEY = 'webstock.marketComparison.period.v3';
  const HEATMAP_DRILL_HISTORY_KEY = 'webstockHeatmapDrill';

  function normalizeSelectedKeys(input, allowedKeys) {
    const values = Array.isArray(input) ? input : [];
    const seen = new Set();
    const result = values.map(function(value) { return String(value || '').trim(); }).filter(function(key) {
      if (!key || seen.has(key) || (allowedKeys && !allowedKeys.has(key))) return false;
      seen.add(key);
      return true;
    });
    if (result.length < 2) throw new Error('请至少选择 2 个比较对象');
    if (result.length > 8) throw new Error('最多选择 8 个比较对象');
    return result;
  }

  function sameSelection(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every(function(key, index) { return key === right[index]; });
  }

  function reconcileCatalogSelection(input, catalogData) {
    const items = catalogData && Array.isArray(catalogData.items) ? catalogData.items : [];
    let current;
    try { current = normalizeSelectedKeys(input); } catch (error) { current = DEFAULT_SELECTED_KEYS.slice(); }
    if (!catalogData || catalogData.status !== 'available') {
      return { keys: current, changed: false };
    }
    const allowed = new Set(items.map(function(item) { return item.key; }));
    let next;
    try { next = normalizeSelectedKeys(current, allowed); } catch (error) {
      next = DEFAULT_SELECTED_KEYS.filter(function(key) { return allowed.has(key); });
    }
    return { keys: next, changed: !sameSelection(current, next) };
  }

  function reconcileSelectionWithCatalog(input, catalogData) {
    return reconcileCatalogSelection(input, catalogData).keys;
  }

  function comparisonRequestUrl(period, window, keys) {
    const encodedKeys = encodeURIComponent((keys || []).join(','));
    if (period === 'intraday') return '/api/market/comparison-intraday?keys=' + encodedKeys;
    return '/api/market/comparison-history?window=' + ([20, 60, 120].includes(Number(window)) ? Number(window) : 60) +
      (period === 'daily' ? '' : '&period=' + encodeURIComponent(period)) + '&keys=' + encodedKeys;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function minuteLabel(value) {
    const match = String(value || '').match(/(\d{2}):(\d{2})/);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return '';
    return match[1] + ':' + match[2];
  }

  function buildFullTradingMinuteAxis() {
    const labels = [];
    [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]].forEach(function(session) {
      for (let value = session[0]; value <= session[1]; value++) {
        labels.push(String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0'));
      }
    });
    return labels;
  }

  function alignIntradayValues(labels, values, axis) {
    const byMinute = new Map();
    (Array.isArray(labels) ? labels : []).forEach(function(label, index) {
      const minute = minuteLabel(label);
      if (minute) byMinute.set(minute, finiteNumber(Array.isArray(values) ? values[index] : null));
    });
    return (Array.isArray(axis) ? axis : buildFullTradingMinuteAxis()).map(function(minute) {
      return byMinute.has(minute) ? byMinute.get(minute) : null;
    });
  }

  function intradayAxisLabelInterval(index, value) {
    return ['09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00'].includes(value);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatPoint(value) {
    const number = finiteNumber(value);
    return number === null ? '--' : number.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatPct(value) {
    const number = finiteNumber(value);
    return number === null ? '--' : (number > 0 ? '+' : '') + number.toFixed(2) + '%';
  }

  function globalSignalDisplay(item) {
    item = item || {};
    const value = finiteNumber(item.value);
    const change = finiteNumber(item.changePct);
    const digits = item.key === 'usd-cnh' ? 4 : 2;
    let direction = change === null || change === 0 ? 'flat' : (change > 0 ? 'up' : 'down');
    if (item.inverseForAShares && change > 0) direction = 'risk-off';
    return {
      value: value === null ? '--' : value.toFixed(digits),
      change: change === null ? '--' : (change > 0 ? '+' : '') + change.toFixed(2) + '%',
      direction
    };
  }

  function renderGlobalSignals(payload) {
    if (!root || !root.document) return;
    const box = root.document.getElementById('dashboardGlobalSignals');
    if (!box) return;
    const items = payload && Array.isArray(payload.items) ? payload.items : [];
    const signature = JSON.stringify(items.map(function(item) {
      return [item.key, item.status, item.value, item.changePct, item.observedAt,item.trend];
    }));
    if (signature === globalSignalsSignature) return;
    globalSignalsSignature = signature;
    if (!items.length) {
      box.innerHTML = '<div class="dashboard-market-unavailable">跨市场行情暂不可用。</div>';
      return;
    }
    box.innerHTML = items.map(function(item) {
      const display = globalSignalDisplay(item);
      const available = item.status === 'available';
      const observed = item.observedAt ? '更新 ' + item.observedAt :
        (available ? '来源未提供更新时间' : (item.reason || '当前无返回值'));
      const trend=Array.isArray(item.trend)?item.trend:[],values=trend.map(point=>point.close).filter(value=>value!=null);
      const min=Math.min(...values),span=Math.max(...values)-min || 1;
      let path='',connected=false;
      trend.forEach((point,index)=>{if(point.close==null){connected=false;return;}path+=(connected?'L':'M')+(index/Math.max(1,trend.length-1)*160).toFixed(2)+','+(24-(point.close-min)/span*21).toFixed(2)+' ';connected=true;});
      const spark=trend.length>1?'<svg class="global-daily-spark" viewBox="0 0 160 27" preserveAspectRatio="none" role="img" aria-label="最近一个月日线走势"><path d="'+path+'" fill="none" stroke="currentColor" stroke-width="1.1" vector-effect="non-scaling-stroke"/></svg>':'';
      return '<article class="dashboard-global-signal" data-direction="' + display.direction + '" data-state="' +
        (available ? 'available' : 'unavailable') + '" title="' + escapeHtml(observed+' · '+(item.source || '新浪公开快照 · 延迟未确定')) + '">' +
        '<header><strong>' + escapeHtml(item.name || item.key) + '</strong><small>' + escapeHtml(item.group || '') + '</small></header>' +
        '<div><b>' + display.value + '</b><span>' + display.change + '</span></div>' +
        spark+'<p>' + escapeHtml(observed) + '</p></article>';
    }).join('') + '<p class="dashboard-global-signals-note">' + escapeHtml(payload.source && payload.source.note ||
      '跨市场信号只作联动观察，相关不代表因果。') + '</p>';
  }

  async function loadGlobalSignals(options) {
    if (!root || !root.ApiClient) return null;
    options = options || {};
    try {
      const [data,trends] = await Promise.all([
        root.ApiClient.fetchJsonData('/api/market/global-signals' + (options.force ? '?refresh=1' : '')),
        root.ApiClient.fetchJsonData('/api/market/global-index-trends',{maxRetries:0}).catch(()=>({items:[]}))
      ]);
      const byKey=new Map((trends.items || []).map(item=>[item.key,item]));
      data.items=(data.items || []).map(item=>byKey.has(item.key)?Object.assign({},item,byKey.get(item.key)):item);
      renderGlobalSignals(data);
      return data;
    } catch (error) {
      if (!globalSignalsSignature) renderGlobalSignals({ items: [] });
      throw error;
    } finally {
      if (root && typeof root.setTimeout === 'function') {
        if (globalSignalsRefreshTimer) root.clearTimeout(globalSignalsRefreshTimer);
        globalSignalsRefreshTimer = root.setTimeout(function() {
          if (!activeDashboardVisible()) return loadGlobalSignals().catch(function() {});
          loadGlobalSignals({ force: true }).catch(function() {});
        }, 60 * 1000);
      }
    }
  }

  function formatAmount(value) {
    const number = finiteNumber(value);
    if (number === null) return '--';
    if (Math.abs(number) >= 1000000000000) return (number / 1000000000000).toFixed(2) + '万亿';
    return (number / 100000000).toFixed(2) + '亿';
  }

  function formatObservedAt(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '未记录';
    return date.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
  }

  function trendClass(value) {
    const number = finiteNumber(value);
    if (number === null || number === 0) return 'market-flat';
    return number > 0 ? 'pnl-up' : 'pnl-down';
  }

  function chartUsable(chart) {
    return Boolean(chart && (typeof chart.isDisposed !== 'function' || !chart.isDisposed()));
  }

  function disposeChart(chart) {
    if (chart && typeof chart.dispose === 'function') chart.dispose();
  }

  function buildComparisonOption(comparison) {
    comparison = comparison || {};
    const dates = Array.isArray(comparison.dates) ? comparison.dates : [];
    const series = Array.isArray(comparison.series) ? comparison.series : [];
    return {
      animation: false,
      color: COLORS,
      tooltip: {
        trigger: 'axis',
        valueFormatter: function(value) {
          const number = finiteNumber(value);
          return number === null ? '--' : number.toFixed(2);
        }
      },
      legend: { type: 'scroll', top: 2, left: 8, right: 8, textStyle: { fontSize: 12, color: '#334155' } },
      grid: { left: 48, right: 18, top: 42, bottom: 58 },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, start: dates.length > 80 ? 40 : 0, end: 100 },
        { type: 'slider', xAxisIndex: 0, start: dates.length > 80 ? 40 : 0, end: 100, height: 16, bottom: 5 }
      ],
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLabel: { fontSize: 9, hideOverlap: true },
        axisLine: { lineStyle: { color: '#cbd5e1' } }
      },
      yAxis: {
        type: 'value',
        name: '起点=100',
        nameTextStyle: { fontSize: 10, color: '#64748b' },
        scale: true,
        axisLabel: { fontSize: 9, formatter: function(value) { return Number(value).toFixed(1); } },
        splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } }
      },
      series: series.map(function(item, index) {
        return {
          name: item.name || item.key,
          type: 'line',
          data: Array.isArray(item.values) ? item.values : [],
          showSymbol: false,
          smooth: false,
          connectNulls: false,
          lineStyle: { width: index < 4 ? 2.4 : 1.8 },
          emphasis: { focus: 'series' }
        };
      })
    };
  }

  function buildMiniIndexOption(points) {
    const rows = (Array.isArray(points) ? points : []).slice(-20);
    const hasOhlc = rows.length && rows.every(function(point) {
      return ['open', 'close', 'low', 'high'].every(function(key) {
        return finiteNumber(point && point[key]) !== null;
      });
    });
    const base = {
      animation: false,
      grid: { left: 1, right: 1, top: 3, bottom: 1 },
      xAxis: { type: 'category', data: rows.map(function(item) { return item.date; }), show: false },
      yAxis: { type: 'value', scale: true, show: false },
      tooltip: { show: false }
    };
    if (hasOhlc) {
      base.series = [{
        type: 'candlestick',
        data: rows.map(function(item) {
          return [Number(item.open), Number(item.close), Number(item.low), Number(item.high)];
        }),
        itemStyle: {
          color: '#f23645',
          color0: '#00a87b',
          borderColor: '#f23645',
          borderColor0: '#00a87b'
        },
        barMaxWidth: 5,
        silent: true
      }];
    } else {
      base.series = [{
        type: 'line',
        data: rows.map(function(item) { return finiteNumber(item && item.close); }),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.4, color: '#2563eb' },
        areaStyle: { color: 'rgba(37,99,235,0.08)' },
        silent: true
      }];
    }
    return base;
  }

  function buildMiniIntradayOption(points, meta) {
    meta = meta || {};
    const rows = Array.isArray(points) ? points : [];
    const sourceLabels = rows.map(function(item) { return item && (item.label || item.time); });
    const labels = buildFullTradingMinuteAxis();
    const areaColor = 'rgba(73,79,223,0.18)';
    const previousClose = finiteNumber(meta.previousClose);
    const weightedSeries = {
      name: '白线·加权指数',
      type: 'line',
      data: alignIntradayValues(sourceLabels, rows.map(function(item) { return item && item.price; }), labels),
      showSymbol: false,
      connectNulls: false,
      smooth: false,
      lineStyle: { width: 1.6, color: '#f8fafc' },
      areaStyle: { color: areaColor },
      silent: true
    };
    if (previousClose !== null) {
      weightedSeries.markLine = {
        silent: true,
        symbol: 'none',
        label: { show: false },
        lineStyle: { color: '#64748b', width: 1, type: 'dashed' },
        data: [{ yAxis: previousClose }]
      };
    }
    const equalWeightData = alignIntradayValues(
      sourceLabels,
      rows.map(function(item) { return item && item.equalWeightPrice; }),
      labels
    );
    const series = [weightedSeries];
    if (equalWeightData.some(function(value) { return value !== null; })) {
      series.push({
        name: '黄线·不加权领先',
        type: 'line',
        data: equalWeightData,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 1.7, color: '#f6c445' },
        silent: true
      });
    }
    return {
      animation: false,
      backgroundColor: '#0b1020',
      grid: { left: 1, right: 1, top: 3, bottom: 1 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        show: false
      },
      yAxis: { type: 'value', scale: true, show: false },
      tooltip: { show: false },
      series
    };
  }

  function buildIndexDetailOption(options) {
    options = options || {};
    const period = normalizePeriod(options.period);
    const historical = period !== 'intraday';
    const history = options.history || {};
    const rows = Array.isArray(history.points) ? history.points : [];
    const sourceLabels = rows.map(function(item) {
      return historical
        ? String(item && item.date || '')
        : String(item && (item.label || item.time) || '').replace(/^.*(?:T|\s)/, '').slice(0, 5);
    });
    const labels = historical ? sourceLabels : buildFullTradingMinuteAxis();
    const rawVolumeData = rows.map(function(item) { return finiteNumber(item && item.volume); });
    const volumeData = historical ? rawVolumeData : alignIntradayValues(sourceLabels, rawVolumeData, labels);
    const common = {
      animation: false,
      color: COLORS,
      backgroundColor: historical ? 'transparent' : '#0b1020',
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 58, right: 24, top: 32, height: '66%' },
        { left: 58, right: 24, top: '76%', bottom: 34 }
      ],
      xAxis: [
        { type: 'category', boundaryGap: historical, data: labels, axisLabel: { hideOverlap: true, interval: historical ? 'auto' : intradayAxisLabelInterval, color: historical ? '#64748b' : '#94a3b8' }, axisLine: { lineStyle: { color: historical ? '#cbd5e1' : '#334155' } } },
        { type: 'category', gridIndex: 1, boundaryGap: true, data: labels, axisLabel: { hideOverlap: true, interval: historical ? 'auto' : intradayAxisLabelInterval, color: historical ? '#64748b' : '#94a3b8' }, axisLine: { lineStyle: { color: historical ? '#cbd5e1' : '#334155' } } }
      ],
      yAxis: [
        { type: 'value', scale: true, axisLabel: { color: historical ? '#64748b' : '#94a3b8' }, splitLine: { lineStyle: { color: historical ? '#e2e8f0' : '#263244', type: 'dashed' } } },
        { type: 'value', gridIndex: 1, scale: true, splitNumber: 2, axisLabel: { color: historical ? '#64748b' : '#94a3b8', formatter: function(value) { return Number(value) >= 100000000 ? (Number(value) / 100000000).toFixed(1) + '亿' : Number(value) >= 10000 ? (Number(value) / 10000).toFixed(0) + '万' : value; } }, splitLine: { show: false } }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: historical ? 20 : 0, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1], height: 16, bottom: 4, start: historical ? 20 : 0, end: 100 }
      ]
    };
    if (historical) {
      common.series = [{
        name: options.name || '指数', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0,
        data: rows.map(function(item) {
          return [finiteNumber(item && item.open), finiteNumber(item && item.close), finiteNumber(item && item.low), finiteNumber(item && item.high)];
        }),
        itemStyle: { color: '#f23645', color0: '#00a87b', borderColor: '#f23645', borderColor0: '#00a87b' }
      }, {
        name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumeData,
        itemStyle: {
          color: function(params) {
            const row = rows[params.dataIndex] || {};
            const open = finiteNumber(row.open);
            const close = finiteNumber(row.close);
            return open !== null && close !== null && close < open ? '#00a87b' : '#f23645';
          }
        }
      }];
      return common;
    }
    const previousClose = finiteNumber(history.previousClose);
    const prices = alignIntradayValues(sourceLabels, rows.map(function(item) { return item && item.price; }), labels);
    const equalWeightPrices = alignIntradayValues(sourceLabels, rows.map(function(item) { return item && item.equalWeightPrice; }), labels);
    const hasEqualWeight = equalWeightPrices.some(function(value) { return value !== null; });
    const lineSeries = {
      name: hasEqualWeight ? '白线·加权指数' : (options.name || '指数'),
      type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: prices,
      showSymbol: false, connectNulls: false, smooth: false,
      lineStyle: { width: 2, color: '#f8fafc' },
      areaStyle: { color: 'rgba(73,79,223,0.16)' }
    };
    if (previousClose !== null) {
      lineSeries.markLine = {
        silent: true, symbol: 'none', label: { formatter: '昨收 ' + formatPoint(previousClose), color: '#94a3b8' },
        lineStyle: { color: '#64748b', width: 1, type: 'dashed' }, data: [{ yAxis: previousClose }]
      };
    }
    const priceSeries = [lineSeries];
    if (hasEqualWeight) {
      priceSeries.push({
        name: '黄线·不加权领先', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: equalWeightPrices, showSymbol: false, connectNulls: false, smooth: false,
        lineStyle: { width: 2, color: '#f6c445' }
      });
      common.legend = {
        top: 2, right: 24, textStyle: { color: '#cbd5e1', fontSize: 12 },
        data: ['白线·加权指数', '黄线·不加权领先']
      };
    }
    common.series = priceSeries.concat({
      name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumeData,
      itemStyle: { color: '#494fdf', opacity: 0.72 }
    });
    return common;
  }

  function buildIntradayComparisonOption(comparison) {
    comparison = comparison || {};
    const sourceLabels = Array.isArray(comparison.labels) ? comparison.labels : [];
    const labels = buildFullTradingMinuteAxis();
    const series = Array.isArray(comparison.series) ? comparison.series : [];
    return {
      animation: false,
      color: COLORS,
      tooltip: {
        trigger: 'axis',
        valueFormatter: function(value) {
          const number = finiteNumber(value);
          return number === null ? '--' : number.toFixed(2);
        }
      },
      legend: { type: 'scroll', top: 2, left: 8, right: 8, textStyle: { fontSize: 12, color: '#334155' } },
      grid: { left: 48, right: 18, top: 42, bottom: 30 },
      xAxis: {
        type: 'category', boundaryGap: false, data: labels,
        axisLabel: { fontSize: 9, hideOverlap: true, interval: intradayAxisLabelInterval },
        axisLine: { lineStyle: { color: '#cbd5e1' } }
      },
      yAxis: {
        type: 'value', name: comparison.basis === 'previous-close-100' ? '昨收=100' : '首点=100', scale: true,
        nameTextStyle: { fontSize: 10, color: '#64748b' },
        axisLabel: { fontSize: 9, formatter: function(value) { return Number(value).toFixed(1); } },
        splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } }
      },
      series: series.map(function(item, index) {
        return {
          name: item.name || item.key,
          type: 'line',
          data: alignIntradayValues(sourceLabels, item.values, labels),
          showSymbol: false,
          smooth: false,
          connectNulls: false,
          lineStyle: { width: index < 4 ? 2.4 : 1.8 },
          emphasis: { focus: 'series' }
        };
      })
    };
  }

  function correlationCells(correlation, series) {
    correlation = correlation || {};
    const keys = Array.isArray(correlation.keys) ? correlation.keys : [];
    const values = Array.isArray(correlation.values) ? correlation.values : [];
    const counts = Array.isArray(correlation.sampleCounts) ? correlation.sampleCounts : [];
    const names = new Map((Array.isArray(series) ? series : []).map(function(item) {
      return [item.key, item.name || item.key];
    }));
    const cells = [];
    keys.forEach(function(rowKey, rowIndex) {
      keys.forEach(function(columnKey, columnIndex) {
        const value = finiteNumber(values[rowIndex] && values[rowIndex][columnIndex]);
        const sampleCount = finiteNumber(counts[rowIndex] && counts[rowIndex][columnIndex]);
        cells.push({
          rowKey,
          columnKey,
          rowName: names.get(rowKey) || rowKey,
          columnName: names.get(columnKey) || columnKey,
          value,
          sampleCount,
          label: value === null ? '样本不足' : value.toFixed(2)
        });
      });
    });
    return cells;
  }

  function signedColor(value, maxAbsolute) {
    const number = finiteNumber(value);
    if (number === null || number === 0) return '#8a93a4';
    const ratio = Math.max(0.22, Math.min(1, Math.abs(number) / Math.max(maxAbsolute || 1, 1)));
    const alpha = (0.38 + ratio * 0.55).toFixed(3);
    return number > 0 ? 'rgba(242,54,69,' + alpha + ')' : 'rgba(0,168,123,' + alpha + ')';
  }

  function heatmapDirectionGroups(nodes, maxAbsolute) {
    const definitions = [
      { direction: 'up', name: '上涨 / 净流入', test: function(value) { return value > 0; } },
      { direction: 'down', name: '下跌 / 净流出', test: function(value) { return value < 0; } },
      { direction: 'flat', name: '平盘', test: function(value) { return value === 0; } }
    ];
    return definitions.map(function(definition) {
      const children = nodes.filter(function(item) {
        return definition.test(Number(item.colorValue) || 0);
      }).map(function(item) {
        return Object.assign({}, item, {
          value: item.areaValue,
          itemStyle: { color: signedColor(item.colorValue, maxAbsolute) }
        });
      });
      return {
        name: definition.name + ' · ' + children.length,
        direction: definition.direction,
        nodeType: 'direction-group',
        value: children.reduce(function(total, item) { return total + Number(item.value || 0); }, 0),
        children
      };
    }).filter(function(group) { return group.children.length; });
  }

  function heatmapCanvasWidth(nodeCount, density) {
    const count = Math.max(0, Number(nodeCount) || 0);
    if (density === 'drill') return Math.max(5000, Math.min(14000, Math.ceil(count * 14)));
    return density === 'all' ? 9000 : 3000;
  }

  function buildHeatmapOption(model) {
    model = model || { nodes: [] };
    const nodes = Array.isArray(model.nodes) ? model.nodes : [];
    const maxAbsolute = nodes.reduce(function(max, item) {
      return Math.max(max, Math.abs(Number(item.colorValue) || 0));
    }, 0);
    const flowMode = model.mode === 'flow';
    return {
      animation: false,
      tooltip: {
        formatter: function(params) {
          const item = params && params.data || {};
          if (item.nodeType === 'direction-group') return '<strong>' + escapeHtml(item.name) + '</strong>';
          const metric = flowMode ? formatAmount(item.colorValue) : formatPct(item.colorValue);
          const drillHint = item.nodeType === 'board'
            ? (item.drillable === false ? '<br>当前来源暂不提供成分股下钻' : '<br>点击查看成分股')
            : '';
          return '<strong>' + escapeHtml(item.name) + '</strong><br>' +
            (flowMode ? '资金净额 ' : '涨跌幅 ') + metric + '<br>' +
            '成交额 ' + formatAmount(item.amount) + '<br>' +
            '主力净流入 ' + formatAmount(item.mainNetInflow) + drillHint;
        }
      },
      series: [{
        type: 'treemap',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        visibleMin: 60,
        label: {
          show: true,
          color: '#ffffff',
          fontSize: 13,
          fontWeight: 700,
          formatter: function(params) {
            const item = params && params.data || {};
            if (!item.name) return '';
            if (item.nodeType === 'direction-group') return item.name;
            const metric = flowMode ? formatAmount(item.colorValue) : formatPct(item.colorValue);
            return item.name + '\n' + metric + '\n成交额 ' + formatAmount(item.amount) +
              '\n主力 ' + formatAmount(item.mainNetInflow);
          }
        },
        upperLabel: { show: nodes.some(function(item) { return item.nodeType === 'board'; }), height: 30, color: '#f8fafc', fontSize: 15, fontWeight: 700 },
        itemStyle: { borderColor: '#0b1020', borderWidth: 2, gapWidth: 2 },
        levels: [
          { itemStyle: { borderColor: '#0b1020', borderWidth: 0, gapWidth: 6 } },
          { upperLabel: { show: true, height: 30, color: '#f8fafc', fontSize: 15, fontWeight: 700 }, itemStyle: { borderColor: '#0b1020', borderWidth: 3, gapWidth: 3 } },
          { label: { show: true, color: '#fff', fontSize: 13, fontWeight: 700 }, itemStyle: { borderColor: '#f8fafc', borderWidth: 1, gapWidth: 1 } }
        ],
        data: nodes.some(function(item) { return item.nodeType === 'board'; })
          ? heatmapDirectionGroups(nodes, maxAbsolute)
          : nodes.map(function(item) {
              return Object.assign({}, item, {
                value: item.areaValue,
                itemStyle: { color: signedColor(item.colorValue, maxAbsolute) }
              });
            })
      }]
    };
  }

  function buildConstituentTreemapModel(items) {
    const nodes = (Array.isArray(items) ? items : []).map(function(item) {
      const colorValue = finiteNumber(heatmapMode === 'flow' ? item.mainNetInflow : item.changePct);
      const sourceArea = finiteNumber(heatmapMode === 'flow' ? item.mainNetInflow : item.amount);
      const areaValue = heatmapMode === 'flow' && sourceArea !== null ? Math.abs(sourceArea) : sourceArea;
      if (!item || !item.code || !item.name || colorValue === null || areaValue === null || areaValue <= 0) return null;
      return {
        id: String(item.code), code: String(item.code), name: String(item.name), nodeType: 'stock',
        value: [areaValue, colorValue], areaValue, colorValue,
        amount: finiteNumber(item.amount), changePct: finiteNumber(item.changePct),
        mainNetInflow: finiteNumber(item.mainNetInflow), price: finiteNumber(item.price)
      };
    }).filter(Boolean).sort(function(left, right) { return right.areaValue - left.areaValue; });
    return {
      mode: heatmapMode,
      availability: nodes.length ? 'available' : 'unavailable',
      nodes,
      totalCount: Array.isArray(items) ? items.length : 0,
      includedCount: nodes.length
    };
  }

  function disposeMiniCharts() {
    miniCharts.forEach(disposeChart);
    miniCharts = [];
  }

  function historyByKey(history) {
    const result = new Map();
    (history && Array.isArray(history.series) ? history.series : []).forEach(function(item) {
      result.set(item.key, item);
      if (String(item.key || '').startsWith('index:')) result.set(String(item.key).slice(6), item);
    });
    return result;
  }

  function selectedIndexItem() {
    const indices = snapshot && snapshot.indices && Array.isArray(snapshot.indices.indices)
      ? snapshot.indices.indices : [];
    return indices.find(function(item) { return item.key === indexDetailKey; }) || null;
  }

  function selectedIndexHistory() {
    const source = indexDetailPeriod === 'intraday' ? indexIntraday : currentIndexHistory(indexDetailPeriod);
    const row = historyByKey(source).get(indexDetailKey);
    if (!row) return null;
    const merged = Object.assign({
      source: source && source.source,
      fetchedAt: source && source.fetchedAt,
      tradingDate: source && source.tradingDate
    }, row);
    if (!merged.tradingDate && Array.isArray(merged.points) && merged.points.length) {
      const last = merged.points[merged.points.length - 1];
      merged.tradingDate = String(last && (last.date || last.time) || '').slice(0, 10);
    }
    return merged;
  }

  function closeIndexDetail() {
    if (!root || !root.document) return;
    const overlay = root.document.getElementById('dashboardIndexDetailOverlay');
    if (overlay) overlay.style.display = 'none';
    if (indexDetailRefreshTimer) root.clearTimeout(indexDetailRefreshTimer);
    indexDetailRefreshTimer = null;
    disposeChart(indexDetailChart);
    indexDetailChart = null;
    indexDetailKey = '';
  }

  function indexDetailRefreshPlan(live) {
    return intradayRefreshPlan(live);
  }

  function scheduleIndexDetailRefresh() {
    if (!root || typeof root.setTimeout !== 'function') return;
    if (indexDetailRefreshTimer) root.clearTimeout(indexDetailRefreshTimer);
    indexDetailRefreshTimer = null;
    if (!indexDetailKey || indexDetailPeriod !== 'intraday' || selectedPeriod === 'intraday') return;
    const history = selectedIndexHistory();
    const plan = indexDetailRefreshPlan(history && history.marketState === 'live');
    indexDetailRefreshTimer = root.setTimeout(function() {
      if (!indexDetailKey || indexDetailPeriod !== 'intraday') return;
      const request = activeDashboardVisible()
        ? loadIndexIntraday({ force: plan.force }).catch(function() {})
        : Promise.resolve();
      request.finally(scheduleIndexDetailRefresh);
    }, plan.delayMs);
  }

  function renderIndexDetail() {
    if (!root || !root.document || !indexDetailKey) return;
    const overlay = root.document.getElementById('dashboardIndexDetailOverlay');
    const element = root.document.getElementById('dashboardIndexDetailChart');
    const title = root.document.getElementById('dashboardIndexDetailTitle');
    const meta = root.document.getElementById('dashboardIndexDetailMeta');
    const source = root.document.getElementById('dashboardIndexDetailSource');
    const item = selectedIndexItem();
    const history = selectedIndexHistory();
    if (!overlay || !element || !item) return;
    overlay.style.display = 'grid';
    if (title) title.textContent = (item.name || item.code) + ' · ' + (indexDetailPeriod === 'intraday' ? '实时分时详情' : periodLabel(indexDetailPeriod) + '详情');
    root.document.querySelectorAll('[data-index-detail-period]').forEach(function(button) {
      const active = button.getAttribute('data-index-detail-period') === indexDetailPeriod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const usable = history && history.status === 'available' && Array.isArray(history.points) && history.points.length;
    const state = history && history.marketState === 'live' ? '盘中实时' : '最近交易日';
    if (meta) meta.textContent = usable
      ? (state + (history.tradingDate ? ' ' + history.tradingDate : '') + ' · ' + history.points.length + ' 个数据点')
      : '该周期行情暂不可用';
    if (source) source.textContent = usable
      ? ('公开行情 · ' + (history.providerLabel || history.source && (history.source.label || history.source.id) || history.provider || '来源已记录') +
        ' · 抓取 ' + formatObservedAt(history.fetchedAt || history.observedAt) +
        (history.marketState === 'live' ? ' · 盘中每15秒尝试刷新' : ' · 休市显示最近交易日'))
      : ('没有伪造补值；' + String(history && history.reason || '公开行情源暂不可用'));
    if (!usable || !root.echarts) {
      disposeChart(indexDetailChart);
      indexDetailChart = null;
      element.innerHTML = '<div class="dashboard-market-unavailable">' + escapeHtml(history && history.reason || '指数详情暂不可用') + '</div>';
      return;
    }
    if (!chartUsable(indexDetailChart)) {
      element.innerHTML = '';
      indexDetailChart = root.echarts.init(element);
    }
    indexDetailChart.setOption(buildIndexDetailOption({
      period: indexDetailPeriod,
      name: item.name || item.code,
      history
    }), true);
    if (typeof indexDetailChart.resize === 'function') indexDetailChart.resize();
  }

  function openIndexDetail(key) {
    if (!key) return;
    indexDetailKey = String(key);
    indexDetailPeriod = selectedPeriod;
    renderIndexDetail();
    if (indexDetailPeriod === 'intraday' && !selectedIndexHistory()) {
      loadIndexIntraday({ force: false }).catch(function() {}).finally(function() {
        renderIndexDetail();
        scheduleIndexDetailRefresh();
      });
      return;
    }
    scheduleIndexDetailRefresh();
  }

  function indexCardDisplayQuote(item, intradayHistory) {
    const useIntraday = intradayHistory && intradayHistory.status === 'available';
    const intradayPrice = useIntraday ? finiteNumber(intradayHistory.latestPrice) : null;
    const intradayChangePct = useIntraday ? finiteNumber(intradayHistory.changePct) : null;
    return {
      price: intradayPrice === null ? finiteNumber(item && item.price) : intradayPrice,
      changePct: intradayChangePct === null ? finiteNumber(item && item.changePct) : intradayChangePct
    };
  }

  function intradayPointMinute(history) {
    const points = history && Array.isArray(history.points) ? history.points : [];
    const last = points.length ? points[points.length - 1] : null;
    const value = String(last && (last.label || last.time) || '');
    const match = value.match(/(?:T|\s)(\d{2}:\d{2})(?::\d{2})?/) || value.match(/^(\d{2}:\d{2})/);
    return match ? match[1] : '';
  }

  function indexCardIntradayStatus(history) {
    if (!history || history.status !== 'available') return '分时暂不可用';
    const state = history.marketState === 'live' ? '盘中分时' : '最近交易日分时';
    const date = history.tradingDate ? ' ' + String(history.tradingDate).slice(5) : '';
    const minute = intradayPointMinute(history);
    const leading = history.leadingIndicator && history.leadingIndicator.available ? ' · 黄白线' : '';
    return state + date + (minute ? ' · 截至 ' + minute : '') + leading;
  }

  function indexCardSnapshotSignature(indices, chartHistories, intradayHistories, mode) {
    return JSON.stringify((indices || []).slice(0, 8).map(function(item) {
      const history = chartHistories.get(item.key);
      const quote = indexCardDisplayQuote(item, intradayHistories.get(item.key));
      return {
        mode,
        key: item.key,
        name: item.name,
        code: item.code,
        price: quote.price,
        changePct: quote.changePct,
        amount: finiteNumber(item.amount),
        historyStatus: history && history.status,
        availableDays: history && history.availableDays,
        tradingDate: history && history.tradingDate,
        previousClose: history && history.previousClose,
        points: history && Array.isArray(history.points) ? (mode === 'intraday' ? history.points : history.points.slice(-20)).map(function(point) {
          return mode === 'intraday'
            ? [point.time, point.price, point.equalWeightPrice]
            : [point.date, point.open, point.close, point.low, point.high];
        }) : []
      };
    }));
  }

  function renderIndexCards(indicesData, dailyHistory, intradayData) {
    if (!root || !root.document) return;
    if (root.HomeTerminal) root.HomeTerminal.renderIndices(indicesData, intradayData);
    const box = root.document.getElementById('dashboardMarketIndices');
    if (!box) return;
    const indices = indicesData && Array.isArray(indicesData.indices) ? indicesData.indices : [];
    if (!indices.length) {
      disposeMiniCharts();
      box.innerHTML = '<div class="dashboard-market-unavailable">主要指数行情暂不可用，其他模块仍可查看。</div>';
      return;
    }
    const sourceData = selectedPeriod === 'intraday' ? intradayData : dailyHistory;
    const histories = historyByKey(sourceData);
    const intradayHistories = historyByKey(intradayData);
    const nextSignature = indexCardSnapshotSignature(indices, histories, intradayHistories, selectedPeriod);
    if (nextSignature === indexCardsSignature && box.querySelectorAll('[data-index-key]').length === Math.min(8, indices.length)) {
      renderIndexDetail();
      return;
    }
    indexCardsSignature = nextSignature;
    disposeMiniCharts();
    box.innerHTML = indices.slice(0, 8).map(function(item) {
      const row = histories.get(item.key);
      const quote = indexCardDisplayQuote(item, intradayHistories.get(item.key));
      const historyState = row && row.status === 'available'
        ? (selectedPeriod === 'intraday'
          ? indexCardIntradayStatus(row)
          : (selectedPeriod === 'weekly' ? '近1年周线' : selectedPeriod === 'yearly' ? '近5年月线' : '近20日K线'))
        : (selectedPeriod === 'intraday' ? '分时暂不可用' : '历史暂不可用');
      return '<article class="dashboard-market-index" data-index-key="' + escapeHtml(item.key) + '" role="button" tabindex="0" title="点击放大查看分时、日线、周线或长期走势">' +
        '<div><strong>' + escapeHtml(item.name || item.code) + '</strong><span>' + escapeHtml(item.code || '') + '</span>' +
        '<button type="button" class="dashboard-index-expand" aria-label="放大' + escapeHtml(item.name || item.code) + '图表" title="放大图表">⛶ 放大</button></div>' +
        '<b>' + formatPoint(quote.price) + '</b>' +
        '<em class="' + trendClass(quote.changePct) + '">' + formatPct(quote.changePct) + '</em>' +
        '<div class="dashboard-index-mini-chart" data-mini-index="' + escapeHtml(item.key) + '" aria-label="' + escapeHtml(item.name) + escapeHtml(selectedPeriod === 'intraday' ? '分时线' : periodLabel(selectedPeriod)) + '"></div>' +
        '<small>成交额 ' + formatAmount(item.amount) + ' · ' + historyState + '</small>' +
      '</article>';
    }).join('');
    if (!root.echarts) return;
    box.querySelectorAll('[data-mini-index]').forEach(function(element) {
      const row = histories.get(element.getAttribute('data-mini-index'));
      if (!row || row.status !== 'available' || !row.points || !row.points.length) return;
      const chart = root.echarts.init(element);
      chart.setOption(selectedPeriod === 'intraday'
        ? buildMiniIntradayOption(row.points, row)
        : buildMiniIndexOption(row.points), true);
      miniCharts.push(chart);
    });
    renderIndexDetail();
  }

  function correlationBackground(value) {
    const number = finiteNumber(value);
    if (number === null) return '#eef2f7';
    return signedColor(number, 1);
  }

  function renderCorrelation(history) {
    if (!root || !root.document) return;
    const box = root.document.getElementById('dashboardIndexCorrelation');
    const title = root.document.getElementById('dashboardCorrelationTitle');
    if (!box) return;
    if (title) title.textContent = selectedPeriod === 'intraday' ? '分时收益率相关性' : periodLabel(selectedPeriod) + '收益率相关性';
    const correlation = history && history.correlation;
    const allSeries = history && Array.isArray(history.series) ? history.series : [];
    const available = allSeries.filter(function(item) { return item.status === 'available'; });
    const correlationKeys = correlation && Array.isArray(correlation.keys) ? correlation.keys : [];
    const keys = history && Array.isArray(history.requestedKeys) && history.requestedKeys.length
      ? history.requestedKeys : correlationKeys;
    if (!keys.length) {
      box.innerHTML = '<div class="dashboard-market-unavailable">所选对象相关性暂不可用。</div>';
      return;
    }
    const names = new Map(allSeries.map(function(item) { return [item.key, item.name || selectedItemName(item.key)]; }));
    const reasons = new Map(allSeries.map(function(item) { return [item.key, item.reason || '']; }));
    const cells = correlationCells(correlation, available);
    const byPair = new Map(cells.map(function(item) { return [item.rowKey + ':' + item.columnKey, item]; }));
    box.innerHTML = '<table><caption class="sr-only">当前所选对象收益率相关性矩阵</caption><thead><tr><th scope="col"></th>' + keys.map(function(key) {
      return '<th scope="col" title="' + escapeHtml(names.get(key) || selectedItemName(key)) + '">' + escapeHtml((names.get(key) || selectedItemName(key)).replace('指数', '')) + '</th>';
    }).join('') + '</tr></thead><tbody>' + keys.map(function(rowKey) {
      return '<tr><th scope="row" title="' + escapeHtml(names.get(rowKey) || selectedItemName(rowKey)) + '">' + escapeHtml((names.get(rowKey) || selectedItemName(rowKey)).replace('指数', '')) + '</th>' + keys.map(function(columnKey) {
        const item = byPair.get(rowKey + ':' + columnKey);
        const title = item && item.value !== null
          ? item.rowName + ' / ' + item.columnName + '：' + item.label + '，共同样本 ' + item.sampleCount
          : ((reasons.get(rowKey) || reasons.get(columnKey)) || (item ? item.rowName + ' / ' + item.columnName + '：样本不足' : '样本不足'));
        const missing = !item || item.value === null;
        return '<td class="' + (missing ? 'correlation-missing' : '') + '" style="background:' + correlationBackground(item && item.value) + '" title="' + escapeHtml(title) + '">' +
          '<b>' + escapeHtml(item && item.label || '样本不足') + '</b>' +
          '<small>' + (item && item.sampleCount !== null ? 'n=' + item.sampleCount : '') + '</small>' +
        '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table><p>' + (selectedPeriod === 'intraday'
      ? '按共同分钟的对数收益率计算；休市时为最近交易日样本。'
      : '按共同' + (selectedPeriod === 'weekly' ? '周' : selectedPeriod === 'yearly' ? '月' : '交易日') + '的对数收益率计算。') + ' 相关性只表示同步程度，不表示因果关系。</p>';
  }

  function updateComparisonStatus(history) {
    if (!root || !root.document) return;
    const status = root.document.getElementById('dashboardIndexHistoryStatus');
    if (!status) return;
    const comparison = history && history.comparison;
    const labels = comparison && (Array.isArray(comparison.dates) ? comparison.dates : comparison.labels);
    const availableCount = history && Array.isArray(history.series)
      ? history.series.filter(function(item) { return item.status === 'available'; }).length : 0;
    const requestedCount = history && Array.isArray(history.requestedKeys)
      ? history.requestedKeys.length : (history && Array.isArray(history.series) ? history.series.length : 0);
    const actualDays = Array.isArray(labels) ? labels.length : 0;
    const stateLabel = history && history.status === 'available' ? '完整' : history && history.status === 'partial' ? '部分可用' : '不可用';
    const tradingDates = history && Array.isArray(history.series)
      ? Array.from(new Set(history.series.map(function(item) { return item.tradingDate; }).filter(Boolean))).sort() : [];
    status.textContent = history ? (availableCount + '/' + requestedCount + ' 项 · ' +
      (selectedPeriod === 'intraday'
        ? ((tradingDates.length === 1 ? tradingDates[0] + ' · ' : '') + '共同' + actualDays + '分钟')
        : ((selectedPeriod === 'weekly' ? '近1年/共同' + actualDays + '周' : selectedPeriod === 'yearly' ? '近5年/共同' + actualDays + '月' : '请求' + history.window + '日/共同' + actualDays + '日'))) +
      ' · ' + stateLabel + ' · ' + (history.source && history.source.label || '来源未记录') +
      ' · 抓取 ' + formatObservedAt(history.fetchedAt)) : '所选对象行情暂不可用';
    status.dataset.state = history && history.status || 'unavailable';
  }

  function renderComparison(history) {
    if (!root || !root.document) return;
    const element = root.document.getElementById('dashboardIndexComparisonChart');
    const status = root.document.getElementById('dashboardIndexHistoryStatus');
    const title = root.document.getElementById('dashboardComparisonTitle');
    const subtitle = root.document.getElementById('dashboardComparisonSubtitle');
    if (!element) return;
    const comparison = history && history.comparison;
    const labels = comparison && (Array.isArray(comparison.dates) ? comparison.dates : comparison.labels);
    const usable = comparison && Array.isArray(labels) && labels.length > 1 &&
      Array.isArray(comparison.series) && comparison.series.length;
    if (title) title.textContent = selectedPeriod === 'intraday' ? '所选对象分时走势' : '所选对象' + periodLabel(selectedPeriod) + '走势';
    if (subtitle) subtitle.textContent = selectedPeriod === 'intraday'
      ? ((comparison && comparison.basis === 'previous-close-100' ? '昨收=100' : '共同首点=100') + '，比较日内相对强弱；休市时显示最近交易日。')
      : (selectedPeriod === 'weekly'
        ? '近1年日线按自然周聚合；共同起点=100，可拖动下方滑块查看全部。'
        : selectedPeriod === 'yearly'
          ? '近5年日线按月聚合；共同起点=100，可拖动下方滑块查看全部。'
          : '共同窗口起点=100，直接比较相对强弱；可拖动下方滑块查看全部。');
    updateComparisonStatus(history);
    if (!usable || !root.echarts) {
      disposeChart(comparisonChart);
      comparisonChart = null;
      element.innerHTML = '<div class="dashboard-market-unavailable">指数归一化走势暂不可用。</div>';
      renderCorrelation(history);
      return;
    }
    if (!chartUsable(comparisonChart)) {
      element.innerHTML = '';
      comparisonChart = root.echarts.init(element);
    }
    comparisonChart.setOption(selectedPeriod === 'intraday'
      ? buildIntradayComparisonOption(comparison)
      : buildComparisonOption(comparison), true);
    if (typeof element.setAttribute === 'function') {
      element.setAttribute('aria-label', (history && Array.isArray(history.series)
        ? history.series.filter(function(item) { return item.status === 'available'; }).map(function(item) { return item.name; }).join('、')
        : '所选对象') + (selectedPeriod === 'intraday' ? '分时归一化走势' : periodLabel(selectedPeriod) + '归一化走势'));
    }
    renderCorrelation(history);
  }

  function heatmapItems(data) {
    if (data && Array.isArray(data.items)) return data.items;
    return data && data.boards && Array.isArray(data.boards.day) ? data.boards.day : [];
  }

  function heatmapTypeLabel(type) {
    const taxonomy = type || heatmapBoardType;
    return taxonomy === 'industry' ? '行业细分' : taxonomy === 'concept' ? '概念热点' : '地域';
  }

  function latestMarketContext() {
    const series = indexIntraday && Array.isArray(indexIntraday.series) ? indexIntraday.series : [];
    const available = series.filter(function(item) { return item && item.status === 'available'; });
    const clock = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).reduce(function(result, part) {
      result[part.type] = part.value;
      return result;
    }, {});
    const minute = Number(clock.hour) * 60 + Number(clock.minute);
    const tradingClock = !['Sat', 'Sun'].includes(clock.weekday) &&
      ((minute >= 9 * 60 + 30 && minute <= 11 * 60 + 30) || (minute >= 13 * 60 && minute <= 15 * 60));
    const live = tradingClock && available.some(function(item) { return item.marketState === 'live'; });
    const dates = available.map(function(item) { return item.tradingDate; }).filter(Boolean).sort();
    return { live, tradingDate: dates.length ? dates[dates.length - 1] : '' };
  }

  function renderHeatmapBreadcrumb() {
    if (!root || !root.document) return;
    const box = root.document.getElementById('dashboardHeatmapBreadcrumb');
    if (!box) return;
    if (!heatmapDrillBoard) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = '<button type="button" class="small-btn" data-heatmap-back>← 返回全部' +
      escapeHtml(heatmapTypeLabel(heatmapDrillBoard.taxonomy)) + '</button><strong>' + escapeHtml(heatmapDrillBoard.name || heatmapDrillBoard.code) +
      '</strong><span>成分股云图与明细</span>';
  }

  function renderHeatmapConstituentSummary(data, context) {
    if (!root || !root.document) return;
    const box = root.document.getElementById('dashboardHeatmapConstituentSummary');
    if (!box) return;
    const items = context && context.drilled && data && Array.isArray(data.items) ? data.items : [];
    if (!items.length || context && context.loading) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const flowRanking = heatmapMode === 'flow';
    const rows = items.slice().sort(function(left, right) {
      const rightValue = flowRanking ? Math.abs(Number(right && right.mainNetInflow || 0)) : Number(right && right.amount || 0);
      const leftValue = flowRanking ? Math.abs(Number(left && left.mainNetInflow || 0)) : Number(left && left.amount || 0);
      return rightValue - leftValue;
    }).slice(0, 200);
    box.hidden = false;
    box.innerHTML = '<header><span>成分股（按' + (flowRanking ? '主力净流入绝对值' : '成交额') + '前 ' + rows.length + '/' + items.length + '，点击详情）</span>' +
      '<span>最新价</span><span>涨跌幅</span><span>成交额</span><span>主力净流入</span></header>' +
      rows.map(function(item) {
        const change = finiteNumber(item && item.changePct);
        const flow = finiteNumber(item && item.mainNetInflow);
        return '<button type="button" class="dashboard-heatmap-stock-row" data-heatmap-stock="' + escapeHtml(item.code) + '">' +
          '<strong>' + escapeHtml(item.name || item.code) + '<small>' + escapeHtml(item.code) + '</small></strong>' +
          '<span>' + formatPoint(item.price) + '</span>' +
          '<span class="' + (change > 0 ? 'is-up' : change < 0 ? 'is-down' : '') + '">' + formatPct(change) + '</span>' +
          '<span>' + formatAmount(item.amount) + '</span>' +
          '<span class="' + (flow > 0 ? 'is-up' : flow < 0 ? 'is-down' : '') + '">' + formatAmount(flow) + '</span>' +
          '</button>';
      }).join('');
  }

  function clearHeatmapDrill() {
    heatmapRequestSequence += 1;
    heatmapDrillSnapshot = null;
    heatmapDrillBoard = null;
    renderHeatmapBreadcrumb();
    renderHeatmapConstituentSummary(null, null);
    const wrap = root && root.document && root.document.getElementById('dashboardMarketSectors');
    if (wrap && wrap.parentElement) wrap.parentElement.scrollLeft = 0;
    heatmapRenderSignature = '';
  }

  function heatmapHistoryMarker() {
    return root && root.history && root.history.state && root.history.state[HEATMAP_DRILL_HISTORY_KEY];
  }

  function pushHeatmapDrillHistory(board) {
    if (!board || !root || !root.history || typeof root.history.pushState !== 'function' || !root.location) return;
    const current = heatmapHistoryMarker();
    if (current && current.code === board.code && current.taxonomy === board.taxonomy) return;
    const state = Object.assign({}, root.history.state || {});
    state[HEATMAP_DRILL_HISTORY_KEY] = { code: board.code, taxonomy: board.taxonomy };
    root.history.pushState(state, '', root.location.href);
  }

  function renderHeatmapOverview() {
    clearHeatmapDrill();
    renderHeatmapIfChanged(heatmapSnapshotLoaded ? heatmapSnapshot : snapshot && snapshot.hot);
  }

  function returnHeatmapToOverview(consumeHistory) {
    const shouldConsumeHistory = consumeHistory && Boolean(heatmapHistoryMarker()) &&
      root && root.history && typeof root.history.back === 'function';
    renderHeatmapOverview();
    if (shouldConsumeHistory) root.history.back();
  }

  function openHeatmapStock(item) {
    if (!item || !item.code || !root || !root.StockList || typeof root.StockList.runRowAction !== 'function') return;
    const allStocks = root.State && Array.isArray(root.State.allStocks) ? root.State.allStocks : [];
    const stock = allStocks.find(function(candidate) { return String(candidate.code) === String(item.code); }) || {
      code: String(item.code), name: String(item.name || item.code)
    };
    Promise.resolve(root.StockList.runRowAction('view', stock)).catch(function(error) {
      if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
    });
  }

  async function loadHeatmapConstituents(item) {
    if (!root || !root.ApiClient || !item || !item.code) return null;
    const taxonomy = item.group || item.taxonomy || item.sourceKind || heatmapBoardType;
    const requestedCode = String(item.code);
    const requestId = ++heatmapRequestSequence;
    const requestedBoard = { code: requestedCode, name: String(item.name || item.code), taxonomy };
    heatmapDrillBoard = requestedBoard;
    pushHeatmapDrillHistory(requestedBoard);
    heatmapDrillSnapshot = { status: 'loading', taxonomy, board: heatmapDrillBoard, items: [] };
    renderHeatmapBreadcrumb();
    renderHeatmapIfChanged(heatmapDrillSnapshot);
    try {
      const data = await root.ApiClient.fetchJsonData('/api/market/boards/constituents?code=' +
        encodeURIComponent(heatmapDrillBoard.code) + '&taxonomy=' + encodeURIComponent(taxonomy));
      if (requestId !== heatmapRequestSequence || !heatmapDrillBoard || heatmapDrillBoard.code !== requestedCode) return null;
      const responseTaxonomy = String(data && (data.taxonomy || data.board && data.board.taxonomy) || '');
      const responseBoardCode = String(data && data.board && data.board.code || '');
      if (responseTaxonomy !== String(taxonomy) || responseBoardCode !== requestedCode) {
        heatmapDrillBoard = requestedBoard;
        heatmapDrillSnapshot = {
          status: 'unavailable', taxonomy, board: requestedBoard, items: [], coverageComplete: false,
          reason: '板块成分股响应与请求不匹配，已拒绝展示。'
        };
        renderHeatmapBreadcrumb();
        renderHeatmapIfChanged(heatmapDrillSnapshot);
        return heatmapDrillSnapshot;
      }
      heatmapDrillSnapshot = data;
      if (data && data.board) heatmapDrillBoard = Object.assign({}, heatmapDrillBoard, data.board);
      renderHeatmapBreadcrumb();
      renderHeatmapIfChanged(data);
      return data;
    } catch (error) {
      if (requestId !== heatmapRequestSequence) return null;
      heatmapDrillSnapshot = {
        status: 'unavailable', taxonomy, board: heatmapDrillBoard, items: [],
        reason: error && error.message || '板块成分股暂不可用'
      };
      renderHeatmapIfChanged(heatmapDrillSnapshot);
      throw error;
    }
  }

  function bindHeatmapChartClick() {
    if (!chartUsable(heatmapChart) || typeof heatmapChart.off !== 'function' || typeof heatmapChart.on !== 'function') return;
    heatmapChart.off('click');
    heatmapChart.on('click', function(params) {
      const item = params && params.data;
      if (!item) return;
      if (item.nodeType === 'stock') openHeatmapStock(item);
      else if (item.nodeType === 'board' && item.drillable !== false) loadHeatmapConstituents(item).catch(function(error) {
        if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
      });
    });
  }

  function heatmapRenderContext(data) {
    const boards = heatmapItems(data);
    const drilled = Boolean(data && data.board);
    const model = drilled
      ? buildConstituentTreemapModel(boards)
      : root.MarketHeatmapModel && root.MarketHeatmapModel.buildTreemapModel
        ? root.MarketHeatmapModel.buildTreemapModel(boards, {
            mode: heatmapMode,
            boardType: heatmapBoardType,
            limit: heatmapDensity === 'focus' ? 80 : null
          })
        : { availability: 'unavailable', nodes: [] };
    const typeLabel = drilled ? String(data.board.name || data.board.code || '板块') + '成分股' : heatmapTypeLabel();
    const loading = data && data.status === 'loading';
    const providerUnavailable = data && Array.isArray(data.items) && data.status === 'unavailable';
    return {
      boards,
      drilled,
      model,
      typeLabel,
      loading,
      unavailable: Boolean(loading || providerUnavailable || model.availability !== 'available' || !root.echarts)
    };
  }

  function updateHeatmapLegend(data, context) {
    if (!root || !root.document) return;
    const legend = root.document.getElementById('dashboardMarketHeatmapLegend');
    if (!legend) return;
    context = context || heatmapRenderContext(data);
    const reason = String(data && data.reason || '').trim();
    if (context.loading || context.unavailable) {
      legend.textContent = context.loading ? '正在请求完整板块快照。' : (heatmapMode === 'flow'
        ? '资金模式：面积=资金净额绝对值，颜色=净流入/净流出；当前口径不可用。'
        : '强弱模式：面积=成交额，颜色=涨跌幅；当前快照不可用。') +
        (reason ? ' 原因：' + reason : '');
      legend.dataset.state = context.loading ? 'loading' : 'unavailable';
      return;
    }
    const classification = data && (data.classification || data.items && data.items.find(function(item) {
      return item && item.classification;
    }) && data.items.find(function(item) { return item && item.classification; }).classification);
    const marketContext = latestMarketContext();
    const marketDateNote = marketContext.tradingDate
      ? ' · ' + (marketContext.live ? '盘中 ' : '最近交易日 ') + marketContext.tradingDate : '';
    const sourceNote = data && Array.isArray(data.items)
      ? ' · 来源 ' + (data.provider || '未记录') + ' · 抓取 ' + formatObservedAt(data.fetchedAt) +
        (classification ? ' · 分类 ' + classification : '') +
        marketDateNote +
        (data.stale ? ' · 缓存已过期' : '') +
        (data.coverageComplete === true ? ' · 目录完整' : data.coverageComplete === false ? ' · 目录部分可用' : '') +
        (reason ? ' · 说明 ' + reason : '')
      : '';
    const metricNote = heatmapMode === 'flow'
      ? (context.drilled
        ? '面积=个股资金净额绝对值 · 颜色=个股资金净额正负 · 红=净流入 / 绿=净流出 · 不是交易所逐笔资金真值'
        : '面积=供应商资金净额绝对值 · 颜色=资金净额正负 · 红=净流入 / 绿=净流出 · 不是交易所逐笔资金真值')
      : (context.drilled
        ? '面积=个股成交额 · 颜色=' + (marketContext.live ? '盘中' : '最近交易日') + '涨跌幅 · 红=上涨 / 绿=下跌'
        : '面积=板块成交额 · 颜色=' + (marketContext.live ? '盘中' : '最近交易日') + '涨跌幅 · 红=上涨 / 绿=下跌');
    const drillNote = !context.drilled && context.model.nodes.some(function(item) { return item.drillable === false; })
      ? ' · 当前来源暂不提供成分股下钻' : '';
    const densityNote = !context.drilled && Number(context.model.omittedCount) > 0
      ? '核心 ' + context.model.displayedCount + '/' + context.model.validCount + '（按面积指标排序，可切换全部横向浏览）'
      : '显示 ' + context.model.includedCount + '/' + context.boards.length;
    legend.textContent = context.typeLabel + ' · ' + densityNote +
      ' 项 · ' + metricNote + drillNote + sourceNote;
    legend.dataset.state = data && (data.status === 'partial' || data.stale === true || data.coverageComplete === false)
      ? 'partial' : 'available';
  }

  function renderHeatmap(data) {
    if (!root || !root.document) return;
    const element = root.document.getElementById('dashboardMarketHeatmap');
    const legend = root.document.getElementById('dashboardMarketHeatmapLegend');
    const wrap = root.document.getElementById('dashboardMarketSectors');
    if (!element || !legend) return;
    const context = heatmapRenderContext(data);
    const density = context.drilled ? 'drill' : heatmapDensity;
    const canvasWidth = heatmapCanvasWidth(context.model && context.model.nodes && context.model.nodes.length, density);
    if (wrap && wrap.dataset) wrap.dataset.density = density;
    if (wrap && wrap.style) wrap.style.minWidth = canvasWidth + 'px';
    if (element.style) element.style.width = canvasWidth + 'px';
    renderHeatmapConstituentSummary(data, context);
    if (context.unavailable) {
      disposeChart(heatmapChart);
      heatmapChart = null;
      element.innerHTML = '<div class="dashboard-market-unavailable">' + (context.loading
        ? (context.drilled ? '正在加载' + context.typeLabel + '…' : '正在加载全部' + context.typeLabel + '板块…')
        : heatmapMode === 'flow'
          ? context.typeLabel + (context.drilled ? '资金净额' : '板块资金净额') + '暂不可用；不会用成交额或 0 冒充资金。'
          : context.typeLabel + (context.drilled ? '成交额或涨跌幅' : '板块成交额或涨跌幅') + '暂不可用。') + '</div>';
      updateHeatmapLegend(data, context);
      return;
    }
    if (!chartUsable(heatmapChart)) {
      element.innerHTML = '';
      heatmapChart = root.echarts.init(element);
    } else if (typeof heatmapChart.resize === 'function') {
      heatmapChart.resize();
    }
    heatmapChart.setOption(buildHeatmapOption(context.model), true);
    bindHeatmapChartClick();
    updateHeatmapLegend(data, context);
  }

  function kindLabel(kind) {
    return kind === 'index' ? '指数' : kind === 'sector-index' ? '板块指数' :
      kind === 'industry' ? '行业' : kind === 'concept' ? '概念' :
        kind === 'region' ? '地域' : kind === 'style' ? '风格' : '对象';
  }

  function catalogProviderLabel(item) {
    return String(item && (item.providerLabel || item.provider) || '来源未记录');
  }

  function catalogItemSupportsPeriod(item, period) {
    const capabilities = item && item.capabilities;
    const capability = period === 'intraday' ? 'intraday' : 'daily';
    return Boolean(capabilities && capabilities[capability]);
  }

  function catalogCapabilityLabel(item) {
    const daily = Boolean(item && item.capabilities && item.capabilities.daily);
    const intraday = Boolean(item && item.capabilities && item.capabilities.intraday);
    if (daily && intraday) return '日线/分时';
    if (daily) return '仅日线';
    if (intraday) return '仅分时';
    return '暂无可用周期';
  }

  function currentPeriodLabel() {
    return periodLabel(selectedPeriod);
  }

  function normalizePeriod(period) {
    return ['intraday', 'daily', 'weekly', 'yearly'].includes(period) ? period : 'daily';
  }

  function periodLabel(period) {
    return period === 'daily' ? '日线' : period === 'weekly' ? '周线' : period === 'yearly' ? '年线' : '分时';
  }

  function historicalComparison(period) {
    return period === 'daily' ? dailyComparison : historicalComparisons.get(period) || null;
  }

  function setHistoricalComparison(period, value) {
    if (period === 'daily') dailyComparison = value;
    else historicalComparisons.set(period, value);
  }

  function clearHistoricalComparisons() {
    dailyComparison = null;
    historicalComparisons.clear();
  }

  function currentIndexHistory(period) {
    const mode = period || selectedPeriod;
    if (mode === 'daily') return snapshot && snapshot.indexHistory || null;
    return indexHistoryByPeriod.get(mode) || null;
  }

  function catalogByKey() {
    return new Map(catalog.map(function(item) { return [item.key, item]; }));
  }

  function selectedItemName(key) {
    const item = catalogByKey().get(key);
    if (item) return item.name;
    const fallback = {
      'index:sse': '上证指数', 'index:szse': '深证成指', 'index:chinext': '创业板指',
      'index:star50': '科创50', 'index:csi300': '沪深300', 'index:csi500': '中证500',
      'index:csi1000': '中证1000', 'index:sse50': '上证50', 'sector-index:bank': '中证银行'
    };
    return fallback[key] || key;
  }

  function setSelectionStatus(message, error) {
    if (!root || !root.document) return;
    const status = root.document.getElementById('dashboardComparisonSelectionStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = error ? 'error' : 'ready';
  }

  function renderSelection() {
    if (!root || !root.document) return;
    const box = root.document.getElementById('dashboardComparisonSelection');
    const button = root.document.getElementById('dashboardComparisonPickerButton');
    if (button) button.textContent = '选择比较对象 ' + selectedKeys.length + '/8';
    if (!box) return;
    const lookup = catalogByKey();
    box.innerHTML = selectedKeys.map(function(key) {
      const item = lookup.get(key);
      const unsupported = item && !catalogItemSupportsPeriod(item, selectedPeriod);
      const label = item ? (unsupported ? '不支持' + currentPeriodLabel() : kindLabel(item.kind)) : '目录暂不可用';
      return '<span class="dashboard-comparison-chip ' + (unsupported || !item ? 'is-unavailable' : '') + '" data-selected-comparison-key="' + escapeHtml(key) + '">' +
        escapeHtml(item && item.name || selectedItemName(key)) + '<small>' + escapeHtml(label) + '</small>' +
        '<button type="button" data-remove-comparison-key="' + escapeHtml(key) + '" aria-label="移除 ' +
          escapeHtml(item && item.name || selectedItemName(key)) + '" ' + (selectedKeys.length <= 2 ? 'disabled' : '') + '>×</button></span>';
    }).join('');
  }

  function optionSearchText(item) {
    return [item.name, item.code, item.key].concat(item.aliases || []).join(' ').toLowerCase();
  }

  function renderPickerOptions() {
    if (!root || !root.document) return;
    const box = root.document.getElementById('dashboardComparisonOptions');
    const search = root.document.getElementById('dashboardComparisonSearch');
    if (!box) return;
    const query = String(search && search.value || '').trim().toLowerCase();
    const matches = catalog.filter(function(item) {
      return (comparisonKindFilter === 'all' || item.kind === comparisonKindFilter) &&
        (!query || optionSearchText(item).includes(query));
    });
    if (!matches.length) {
      box.innerHTML = '<div class="dashboard-market-unavailable">没有匹配的可用对象。动态板块源断线时只保留已验证的指数。</div>';
      setSelectionStatus('匹配 0 项 · 已暂选 ' + draftSelectedKeys.length + ' 项', false);
      return;
    }
    const visibleMatches = matches.slice(0, 240);
    const selected = new Set(draftSelectedKeys);
    box.innerHTML = visibleMatches.map(function(item) {
      const supported = catalogItemSupportsPeriod(item, selectedPeriod);
      const capabilityLabel = catalogCapabilityLabel(item);
      const alternatePeriod = selectedPeriod === 'daily' ? '分时' : '日线';
      const alternateSupported = catalogItemSupportsPeriod(item, selectedPeriod === 'daily' ? 'intraday' : 'daily');
      const disabledTitle = alternateSupported ? '请切换到' + alternatePeriod + '后选择' : '当前没有可用行情周期';
      const metadata = kindLabel(item.kind) + ' · 来源 ' + catalogProviderLabel(item) + ' · ' + capabilityLabel +
        (supported ? '' : ' · 当前' + currentPeriodLabel() + '不可用');
      return '<label class="dashboard-comparison-option ' + (supported ? '' : 'is-period-unavailable') + '">' +
        '<input type="checkbox" data-comparison-key="' + escapeHtml(item.key) + '" ' + (selected.has(item.key) ? 'checked' : '') +
          (supported ? '' : ' disabled title="' + escapeHtml(disabledTitle) + '"') + '>' +
        '<span title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>' +
        '<small>' + escapeHtml(metadata) + '</small></label>';
    }).join('');
    setSelectionStatus('匹配 ' + matches.length + ' 项' + (visibleMatches.length < matches.length
      ? ' · 当前显示前 ' + visibleMatches.length + ' 项，请搜索定位其余板块' : '') +
      ' · 已暂选 ' + draftSelectedKeys.length + ' 项', false);
  }

  function savePreferences() {
    if (!root || !root.localStorage) return;
    try {
      root.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selectedKeys));
      root.localStorage.setItem(PERIOD_STORAGE_KEY, selectedPeriod);
    } catch (error) {}
  }

  function readPreferences() {
    if (!root || !root.localStorage) return;
    try {
      const stored = JSON.parse(root.localStorage.getItem(SELECTION_STORAGE_KEY) || 'null');
      if (Array.isArray(stored) && stored.length >= 2 && stored.length <= 8) selectedKeys = stored.slice();
      selectedPeriod = normalizePeriod(root.localStorage.getItem(PERIOD_STORAGE_KEY) || 'intraday');
    } catch (error) {
      selectedPeriod = 'intraday';
    }
  }

  function openPicker() {
    const picker = root.document.getElementById('dashboardComparisonPicker');
    const button = root.document.getElementById('dashboardComparisonPickerButton');
    if (!picker || !button) return;
    draftSelectedKeys = selectedKeys.slice();
    picker.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    renderPickerOptions();
    const search = root.document.getElementById('dashboardComparisonSearch');
    if (search && typeof search.focus === 'function') search.focus();
  }

  function closePicker(restoreFocus) {
    const picker = root.document.getElementById('dashboardComparisonPicker');
    const button = root.document.getElementById('dashboardComparisonPickerButton');
    if (picker) picker.hidden = true;
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus && typeof button.focus === 'function') button.focus();
    }
  }

  function applyDraftSelection() {
    try {
      const allowed = catalog.length
        ? new Set(catalog.filter(function(item) {
          return catalogItemSupportsPeriod(item, selectedPeriod);
        }).map(function(item) { return item.key; })) : null;
      selectedKeys = normalizeSelectedKeys(draftSelectedKeys, allowed);
      clearHistoricalComparisons();
      intradayComparison = null;
      comparisonRequestSequence += 1;
      savePreferences();
      renderSelection();
      closePicker(true);
      setSelectionStatus('已选择 ' + selectedKeys.length + ' 项', false);
      showComparisonLoading();
      loadActivePeriod({ force: true }).catch(function(error) { setSelectionStatus(error.message || '加载失败', true); });
    } catch (error) {
      setSelectionStatus(error.message, true);
    }
  }

  function removeSelectedKey(key) {
    if (selectedKeys.length <= 2) {
      setSelectionStatus('至少保留 2 个比较对象', true);
      return;
    }
    selectedKeys = selectedKeys.filter(function(item) { return item !== key; });
    clearHistoricalComparisons();
    intradayComparison = null;
    comparisonRequestSequence += 1;
    savePreferences();
    renderSelection();
    setSelectionStatus('已选择 ' + selectedKeys.length + ' 项', false);
    showComparisonLoading();
    loadActivePeriod({ force: true }).catch(function(error) { setSelectionStatus(error.message || '加载失败', true); });
  }

  function comparisonCacheKey(period, window, keys) {
    return period + '|' + (period === 'intraday' ? 'latest' : window) + '|' + keys.join(',');
  }

  async function loadCatalog() {
    if (!root || !root.ApiClient) return null;
    let data;
    try {
      data = await root.ApiClient.fetchJsonData('/api/market/comparison-catalog');
    } catch (error) {
      const fallback = await root.ApiClient.fetchJsonData('/api/market/boards/catalog');
      const fallbackItems = fallback && Array.isArray(fallback.items) ? fallback.items : [];
      data = Object.assign({}, fallback, {
        status: fallbackItems.length ? 'partial' : 'unavailable',
        coverageComplete: false,
        fallbackFrom: 'comparison-catalog',
        warnings: [error && error.message || '完整板块目录加载失败'].concat(
          fallback && Array.isArray(fallback.warnings) ? fallback.warnings : []
        )
      });
    }
    catalogStatus = data;
    catalog = data && Array.isArray(data.items) ? data.items.map(function(item) {
      return Object.assign({}, item, { kind: item.kind || item.taxonomy || 'unknown' });
    }) : [];
    const reconciliation = reconcileCatalogSelection(selectedKeys, data);
    selectedKeys = reconciliation.keys;
    draftSelectedKeys = selectedKeys.slice();
    if (reconciliation.changed) savePreferences();
    renderSelection();
    renderPickerOptions();
    if (data && data.status === 'partial') setSelectionStatus('完整目录部分可用；断线分类保留最后成功目录', false);
    return data;
  }

  async function loadHeatmapSnapshot(options) {
    if (!root || !root.ApiClient) return null;
    options = options || {};
    const requestedType = heatmapBoardType;
    const requestId = ++heatmapRequestSequence;
    const existingUsableSnapshot = heatmapSnapshot && heatmapSnapshot.taxonomy === requestedType &&
      heatmapSnapshot.status !== 'loading' && heatmapSnapshot.status !== 'unavailable' && heatmapItems(heatmapSnapshot).length;
    heatmapSnapshotLoaded = true;
    if (!existingUsableSnapshot) {
      heatmapSnapshot = { status: 'loading', taxonomy: requestedType, items: [] };
      renderHeatmapIfChanged(heatmapSnapshot);
    }
    try {
      const data = await root.ApiClient.fetchJsonData('/api/market/boards/snapshot?taxonomy=' + encodeURIComponent(requestedType) +
        (options.force ? '&refresh=1' : ''));
      if (requestId !== heatmapRequestSequence || requestedType !== heatmapBoardType) return null;
      heatmapSnapshot = data;
      renderHeatmapIfChanged(data);
      return data;
    } catch (error) {
      if (requestId !== heatmapRequestSequence || requestedType !== heatmapBoardType) return null;
      heatmapSnapshot = {
        status: 'unavailable', taxonomy: requestedType, items: [],
        reason: error && error.message || '完整板块快照加载失败'
      };
      renderHeatmapIfChanged(heatmapSnapshot);
      throw error;
    } finally {
      if (requestId === heatmapRequestSequence && requestedType === heatmapBoardType) scheduleHeatmapRefresh();
    }
  }

  async function loadComparisonData(period, options) {
    if (!root || !root.ApiClient) return null;
    options = options || {};
    const keys = selectedKeys.slice();
    const requestedWindow = selectedWindow;
    normalizeSelectedKeys(keys);
    const requestId = ++comparisonRequestSequence;
    activeComparisonRequestId = requestId;
    const cacheKey = comparisonCacheKey(period, requestedWindow, keys);
    const ttl = period === 'intraday' ? INTRADAY_CACHE_MS : HISTORY_CACHE_MS;
    const cached = comparisonCache.get(cacheKey);
    const status = root.document && root.document.getElementById('dashboardIndexHistoryStatus');
    if (status) {
      status.textContent = '正在加载所选对象' + periodLabel(period) + '…';
      status.dataset.state = 'loading';
    }
    try {
      const data = !options.force && cached && Date.now() - cached.storedAt < ttl
        ? cached.value
        : await root.ApiClient.fetchJsonData(comparisonRequestUrl(period, requestedWindow, keys));
      if (requestId !== comparisonRequestSequence || selectedPeriod !== period ||
          selectedKeys.join(',') !== keys.join(',') || (period !== 'intraday' && selectedWindow !== requestedWindow)) return null;
      comparisonCache.set(cacheKey, { storedAt: Date.now(), value: data });
      if (period === 'intraday') intradayComparison = data;
      else setHistoricalComparison(period, data);
      renderHistoryIfChanged(data);
      return data;
    } catch (error) {
      if (requestId !== comparisonRequestSequence || selectedPeriod !== period ||
          selectedKeys.join(',') !== keys.join(',') || (period !== 'intraday' && selectedWindow !== requestedWindow)) return null;
      showComparisonFailure(error && error.message || '所选对象行情加载失败');
      throw error;
    } finally {
      if (activeComparisonRequestId === requestId) activeComparisonRequestId = 0;
    }
  }

  async function loadIndexIntraday(options) {
    if (!root || !root.ApiClient) return null;
    options = options || {};
    const requestId = ++indexIntradayRequestSequence;
    const cacheKey = 'index-cards|intraday';
    const cached = comparisonCache.get(cacheKey);
    const data = !options.force && cached && Date.now() - cached.storedAt < INTRADAY_CACHE_MS
      ? cached.value
      : await root.ApiClient.fetchJsonData('/api/market/index-intraday');
    if (requestId !== indexIntradayRequestSequence) return null;
    comparisonCache.set(cacheKey, { storedAt: Date.now(), value: data });
    indexIntraday = data;
    renderIndexCards(snapshot && snapshot.indices, snapshot && snapshot.indexHistory, indexIntraday);
    renderIndexDetail();
    if (heatmapSnapshotLoaded) scheduleHeatmapRefresh();
    return data;
  }

  function activeDashboardVisible() {
    if (!root || !root.document || root.document.hidden) return false;
    const view = root.document.getElementById('dashboardView');
    return !view || !view.classList || view.classList.contains('active');
  }

  function scheduleIntradayRefresh() {
    if (intradayRefreshTimer) root.clearTimeout(intradayRefreshTimer);
    intradayRefreshTimer = null;
    if (selectedPeriod !== 'intraday' || !root || typeof root.setTimeout !== 'function') return;
    const live = indexIntraday && Array.isArray(indexIntraday.series) && indexIntraday.series.some(function(item) {
      return item.marketState === 'live';
    });
    const refreshPlan = intradayRefreshPlan(live);
    intradayRefreshTimer = root.setTimeout(function() {
      if (selectedPeriod !== 'intraday') return;
      const request = activeDashboardVisible()
        ? loadActivePeriod({ force: refreshPlan.force }).catch(function() {})
        : Promise.resolve();
      request.finally(scheduleIntradayRefresh);
    }, refreshPlan.delayMs);
  }

  function intradayRefreshPlan(live) {
    return live
      ? { delayMs: 15000, force: true }
      : { delayMs: 5 * 60 * 1000, force: false };
  }

  function heatmapRefreshPlan(live) {
    return live
      ? { delayMs: 60 * 1000, force: true }
      : { delayMs: 5 * 60 * 1000, force: false };
  }

  function scheduleHeatmapRefresh() {
    if (!root || typeof root.setTimeout !== 'function') return;
    if (heatmapRefreshTimer) root.clearTimeout(heatmapRefreshTimer);
    const marketContext = latestMarketContext();
    const plan = heatmapRefreshPlan(marketContext.live);
    heatmapRefreshTimer = root.setTimeout(function() {
      if (!activeDashboardVisible()) {
        scheduleHeatmapRefresh();
        return;
      }
      loadHeatmapSnapshot({ force: plan.force }).catch(function() {});
    }, plan.delayMs);
  }

  async function loadIndexHistoryForPeriod(period, options) {
    if (!root || !root.ApiClient || period === 'intraday') return null;
    options = options || {};
    if (period === 'daily' && snapshot && snapshot.indexHistory && !options.force) return snapshot.indexHistory;
    const cacheKey = 'index-cards|' + period + '|' + selectedWindow;
    const cached = comparisonCache.get(cacheKey);
    const data = !options.force && cached && Date.now() - cached.storedAt < HISTORY_CACHE_MS
      ? cached.value
      : await root.ApiClient.fetchJsonData('/api/market/index-history?window=' + selectedWindow + '&period=' + encodeURIComponent(period));
    if (selectedPeriod !== period && !options.allowInactive) return null;
    comparisonCache.set(cacheKey, { storedAt: Date.now(), value: data });
    if (period === 'daily') {
      snapshot = snapshot || {};
      snapshot.indexHistory = data;
    } else {
      indexHistoryByPeriod.set(period, data);
    }
    if (selectedPeriod === period) {
      indexCardsSignature = '';
      renderIndexCards(snapshot && snapshot.indices, data, indexIntraday);
    }
    renderIndexDetail();
    return data;
  }

  async function loadActivePeriod(options) {
    options = options || {};
    if (selectedPeriod === 'intraday') {
      const results = await Promise.allSettled([
        loadIndexIntraday(options),
        loadComparisonData('intraday', options)
      ]);
      scheduleIntradayRefresh();
      const rejected = results.find(function(item) { return item.status === 'rejected'; });
      if (rejected && results.every(function(item) { return item.status === 'rejected'; })) throw rejected.reason;
      return results;
    }
    const activeHistory = currentIndexHistory(selectedPeriod);
    if (activeHistory) {
      indexCardsSignature = '';
      renderIndexCards(snapshot.indices, activeHistory, indexIntraday);
    }
    if (selectedPeriod === 'daily') return loadComparisonData('daily', options);
    const results = await Promise.allSettled([
      loadIndexHistoryForPeriod(selectedPeriod, options),
      loadComparisonData(selectedPeriod, options)
    ]);
    const rejected = results.find(function(item) { return item.status === 'rejected'; });
    if (rejected && results.every(function(item) { return item.status === 'rejected'; })) throw rejected.reason;
    return results;
  }

  function showComparisonLoading() {
    if (!root || !root.document) return;
    disposeChart(comparisonChart);
    comparisonChart = null;
    const chart = root.document.getElementById('dashboardIndexComparisonChart');
    const correlation = root.document.getElementById('dashboardIndexCorrelation');
    const title = root.document.getElementById('dashboardComparisonTitle');
    const correlationTitle = root.document.getElementById('dashboardCorrelationTitle');
    const status = root.document.getElementById('dashboardIndexHistoryStatus');
    if (chart) chart.innerHTML = '<div class="dashboard-market-unavailable">正在加载当前选择…</div>';
    if (correlation) correlation.innerHTML = '<div class="dashboard-market-unavailable">正在重算相关性…</div>';
    if (title) title.textContent = '所选对象' + periodLabel(selectedPeriod) + '走势';
    if (correlationTitle) correlationTitle.textContent = periodLabel(selectedPeriod) + '收益率相关性';
    if (status) {
      status.textContent = '正在加载所选对象' + periodLabel(selectedPeriod) + '…';
      status.dataset.state = 'loading';
    }
    historyRenderSignature = '';
  }

  function showComparisonFailure(message) {
    if (!root || !root.document) return;
    disposeChart(comparisonChart);
    comparisonChart = null;
    const chart = root.document.getElementById('dashboardIndexComparisonChart');
    const correlation = root.document.getElementById('dashboardIndexCorrelation');
    const status = root.document.getElementById('dashboardIndexHistoryStatus');
    const detail = String(message || '公开行情源暂不可用');
    if (chart) {
      chart.innerHTML = '<div class="dashboard-market-unavailable">所选对象行情加载失败：' +
        escapeHtml(detail) + '</div>';
    }
    if (correlation) {
      correlation.innerHTML = '<div class="dashboard-market-unavailable">相关性暂不可用：' +
        escapeHtml(detail) + '</div>';
    }
    if (status) {
      status.textContent = '所选对象行情加载失败：' + detail;
      status.dataset.state = 'unavailable';
    }
    historyRenderSignature = '';
  }

  function comparisonMatchesRequest(data, period, window, keys) {
    if (!data || data.mode !== period || !Array.isArray(data.requestedKeys)) return false;
    if (!sameSelection(data.requestedKeys, keys)) return false;
    return period !== 'daily' || Number(data.window) === Number(window);
  }

  function setPeriod(period) {
    selectedPeriod = normalizePeriod(period);
    savePreferences();
    historyRenderSignature = '';
    indexCardsSignature = '';
    syncButtonState();
    renderIndexCards(snapshot && snapshot.indices, currentIndexHistory(selectedPeriod), indexIntraday);
    const active = selectedPeriod === 'intraday' ? intradayComparison : historicalComparison(selectedPeriod);
    const matchesSelection = comparisonMatchesRequest(active, selectedPeriod, selectedWindow, selectedKeys);
    if (matchesSelection) renderHistoryIfChanged(active);
    else showComparisonLoading();
    return loadActivePeriod();
  }

  function syncButtonState() {
    if (!root || !root.document) return;
    root.document.querySelectorAll('[data-index-period]').forEach(function(button) {
      const active = button.getAttribute('data-index-period') === selectedPeriod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const windowControls = root.document.getElementById('dashboardIndexWindowControls');
    if (windowControls) windowControls.hidden = selectedPeriod !== 'daily';
    root.document.querySelectorAll('[data-index-window]').forEach(function(button) {
      const active = Number(button.getAttribute('data-index-window')) === selectedWindow;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    root.document.querySelectorAll('[data-heatmap-mode]').forEach(function(button) {
      const active = button.getAttribute('data-heatmap-mode') === heatmapMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    root.document.querySelectorAll('[data-heatmap-board-type]').forEach(function(button) {
      const active = button.getAttribute('data-heatmap-board-type') === heatmapBoardType;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    root.document.querySelectorAll('[data-heatmap-density]').forEach(function(button) {
      const active = button.getAttribute('data-heatmap-density') === heatmapDensity;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    root.document.querySelectorAll('[data-comparison-kind]').forEach(function(button) {
      const active = button.getAttribute('data-comparison-kind') === comparisonKindFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function sameHistorySnapshot(cached, history) {
    if (!cached || !history) return false;
    if (cached.value === history) return true;
    const cachedFetchedAt = cached.value && cached.value.fetchedAt;
    const nextFetchedAt = history.fetchedAt;
    return Boolean(cachedFetchedAt && nextFetchedAt && cachedFetchedAt === nextFetchedAt);
  }

  function historySnapshotSignature(history) {
    if (!history) return 'history:none';
    return JSON.stringify({
      mode: history.mode || 'daily',
      window: history.window,
      status: history.status,
      requestedKeys: history.requestedKeys || [],
      series: (Array.isArray(history.series) ? history.series : []).map(function(item) {
        return [item.key, item.status, item.availableDays, item.reason || ''];
      }),
      comparison: history.comparison || null,
      correlation: history.correlation || null
    });
  }

  function heatmapSnapshotSignature(data) {
    const boards = heatmapItems(data);
    const rawStatus = data && (data.status || data.marketStatus);
    return JSON.stringify({
      mode: heatmapMode,
      boardType: heatmapBoardType,
      density: heatmapDensity,
      status: rawStatus === 'loading' || rawStatus === 'unavailable' ? rawStatus : 'usable',
      drillBoard: data && data.board && data.board.code,
      boards: boards.map(function(item) {
        return [item.code, item.name, item.kind || item.taxonomy, item.amount,
          item.dailyChangePct === undefined ? item.changePct : item.dailyChangePct, item.mainNetInflow];
      })
    });
  }

  function renderHistoryIfChanged(history) {
    const signature = historySnapshotSignature(history);
    if (signature === historyRenderSignature) {
      updateComparisonStatus(history);
      return false;
    }
    historyRenderSignature = signature;
    renderComparison(history);
    return true;
  }

  function renderHeatmapIfChanged(data) {
    const signature = heatmapSnapshotSignature(data);
    if (signature === heatmapRenderSignature) {
      updateHeatmapLegend(data);
      return false;
    }
    heatmapRenderSignature = signature;
    renderHeatmap(data);
    return true;
  }

  function render(nextSnapshot) {
    snapshot = nextSnapshot || snapshot || {};
    const history = snapshot.indexHistory || null;
    if (history && history.window && !activeWindowRequestId && !selectedWindowPinned) {
      selectedWindow = Number(history.window);
    }
    if (history && history.window) {
      const cacheWindow = Number(history.window);
      const cached = historyCacheByWindow.get(cacheWindow);
      if (!sameHistorySnapshot(cached, history)) {
        historyCacheByWindow.set(cacheWindow, { storedAt: Date.now(), value: history });
      }
    }
    syncButtonState();
    renderSelection();
    renderIndexCards(snapshot.indices, selectedPeriod === 'daily' ? history : currentIndexHistory(selectedPeriod), indexIntraday);
    const activeComparison = selectedPeriod === 'intraday' ? intradayComparison : historicalComparison(selectedPeriod);
    const activeMatches = comparisonMatchesRequest(activeComparison, selectedPeriod, selectedWindow, selectedKeys);
    if (activeMatches) renderHistoryIfChanged(activeComparison);
    else showComparisonLoading();
    renderHeatmapIfChanged(heatmapDrillSnapshot || (heatmapSnapshotLoaded ? heatmapSnapshot : snapshot.hot));
  }

  async function loadWindow(window) {
    if (!root || !root.ApiClient) return null;
    const requestedWindow = [20, 60, 120].includes(Number(window)) ? Number(window) : 60;
    const requestId = ++windowRequestSequence;
    activeWindowRequestId = requestId;
    selectedWindowPinned = true;
    selectedWindow = requestedWindow;
    syncButtonState();
    const status = root.document && root.document.getElementById('dashboardIndexHistoryStatus');
    if (status) {
      status.textContent = '正在加载 ' + requestedWindow + ' 日指数历史…';
      status.dataset.state = 'loading';
    }
    try {
      const cached = historyCacheByWindow.get(requestedWindow);
      const data = cached && Date.now() - cached.storedAt < HISTORY_CACHE_MS
        ? cached.value
        : await root.ApiClient.fetchJsonData('/api/market/index-history?window=' + requestedWindow);
      if (requestId !== windowRequestSequence || selectedWindow !== requestedWindow || selectedPeriod !== 'daily') return null;
      historyCacheByWindow.set(requestedWindow, { storedAt: Date.now(), value: data });
      snapshot = snapshot || {};
      snapshot.indexHistory = data;
      if (root.MarketOverview && typeof root.MarketOverview.setIndexHistory === 'function') {
        root.MarketOverview.setIndexHistory(data);
      }
      renderIndexCards(snapshot.indices, data, indexIntraday);
      return data;
    } catch (error) {
      if (requestId !== windowRequestSequence || selectedWindow !== requestedWindow || selectedPeriod !== 'daily') return null;
      if (status) {
        status.textContent = error && error.message || '指数历史加载失败';
        status.dataset.state = 'unavailable';
      }
      throw error;
    } finally {
      if (activeWindowRequestId === requestId) activeWindowRequestId = 0;
    }
  }

  function bind() {
    if (bound || !root || !root.document) return;
    bound = true;
    draftSelectedKeys = selectedKeys.slice();
    syncButtonState();
    renderSelection();
    root.document.addEventListener('click', function(event) {
      const detailClose = event.target.closest('#dashboardIndexDetailClose');
      const detailOverlay = root.document.getElementById('dashboardIndexDetailOverlay');
      if (detailClose || event.target === detailOverlay) {
        closeIndexDetail();
        return;
      }
      const detailPeriodButton = event.target.closest('[data-index-detail-period]');
      if (detailPeriodButton) {
        indexDetailPeriod = normalizePeriod(detailPeriodButton.getAttribute('data-index-detail-period'));
        renderIndexDetail();
        if (indexDetailPeriod === 'intraday') {
          loadIndexIntraday({ force: false }).catch(function() {}).finally(scheduleIndexDetailRefresh);
        } else {
          loadIndexHistoryForPeriod(indexDetailPeriod, { force: false, allowInactive: true }).catch(function() {}).finally(function() {
            renderIndexDetail();
          });
        }
        return;
      }
      const indexCard = event.target.closest('[data-index-key]');
      if (indexCard) {
        openIndexDetail(indexCard.getAttribute('data-index-key'));
        return;
      }
      const heatmapBack = event.target.closest('[data-heatmap-back]');
      if (heatmapBack) {
        returnHeatmapToOverview(true);
        return;
      }
      const heatmapStock = event.target.closest('[data-heatmap-stock]');
      if (heatmapStock) {
        const stockCode = heatmapStock.getAttribute('data-heatmap-stock');
        const stock = heatmapDrillSnapshot && Array.isArray(heatmapDrillSnapshot.items)
          ? heatmapDrillSnapshot.items.find(function(item) { return String(item.code) === String(stockCode); })
          : null;
        if (stock) openHeatmapStock(stock);
        return;
      }
      const periodButton = event.target.closest('[data-index-period]');
      if (periodButton) {
        setPeriod(periodButton.getAttribute('data-index-period')).catch(function(error) {
          if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
        });
        return;
      }
      const windowButton = event.target.closest('[data-index-window]');
      if (windowButton) {
        selectedWindowPinned = true;
        selectedWindow = [20, 60, 120].includes(Number(windowButton.getAttribute('data-index-window')))
          ? Number(windowButton.getAttribute('data-index-window')) : 60;
        syncButtonState();
        dailyComparison = null;
        comparisonRequestSequence += 1;
        showComparisonLoading();
        Promise.allSettled([loadComparisonData('daily')]).then(function(results) {
          const rejected = results.find(function(item) { return item.status === 'rejected'; });
          if (rejected && root.console && typeof root.console.warn === 'function') root.console.warn(rejected.reason);
        }).catch(function(error) {
          if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
        });
        return;
      }
      const pickerButton = event.target.closest('#dashboardComparisonPickerButton');
      if (pickerButton) {
        const picker = root.document.getElementById('dashboardComparisonPicker');
        if (picker && !picker.hidden) closePicker(false);
        else openPicker();
        return;
      }
      const removeButton = event.target.closest('[data-remove-comparison-key]');
      if (removeButton) {
        removeSelectedKey(removeButton.getAttribute('data-remove-comparison-key'));
        return;
      }
      const kindButton = event.target.closest('[data-comparison-kind]');
      if (kindButton) {
        comparisonKindFilter = kindButton.getAttribute('data-comparison-kind') || 'all';
        syncButtonState();
        renderPickerOptions();
        return;
      }
      const comparisonAction = event.target.closest('[data-comparison-action]');
      if (comparisonAction) {
        if (comparisonAction.getAttribute('data-comparison-action') === 'apply') applyDraftSelection();
        else closePicker(true);
        return;
      }
      const modeButton = event.target.closest('[data-heatmap-mode]');
      if (modeButton) {
        heatmapMode = modeButton.getAttribute('data-heatmap-mode') === 'flow' ? 'flow' : 'turnover';
        syncButtonState();
        renderHeatmapIfChanged(heatmapDrillSnapshot || (heatmapSnapshotLoaded ? heatmapSnapshot : snapshot && snapshot.hot));
        return;
      }
      const typeButton = event.target.closest('[data-heatmap-board-type]');
      if (typeButton) {
        const nextType = typeButton.getAttribute('data-heatmap-board-type');
        heatmapBoardType = ['industry', 'concept', 'region'].includes(nextType) ? nextType : 'concept';
        clearHeatmapDrill();
        syncButtonState();
        heatmapRenderSignature = '';
        loadHeatmapSnapshot().catch(function(error) {
          if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
        });
        return;
      }
      const densityButton = event.target.closest('[data-heatmap-density]');
      if (densityButton) {
        heatmapDensity = densityButton.getAttribute('data-heatmap-density') === 'all' ? 'all' : 'focus';
        syncButtonState();
        heatmapRenderSignature = '';
        renderHeatmapIfChanged(heatmapDrillSnapshot || (heatmapSnapshotLoaded ? heatmapSnapshot : snapshot && snapshot.hot));
      }
    });
    root.document.addEventListener('change', function(event) {
      const input = event.target && event.target.matches && event.target.matches('[data-comparison-key]')
        ? event.target : null;
      if (!input) return;
      const key = input.getAttribute('data-comparison-key');
      if (input.checked) {
        if (!draftSelectedKeys.includes(key) && draftSelectedKeys.length >= 8) {
          input.checked = false;
          setSelectionStatus('最多选择 8 个比较对象', true);
          return;
        }
        if (!draftSelectedKeys.includes(key)) draftSelectedKeys.push(key);
      } else {
        draftSelectedKeys = draftSelectedKeys.filter(function(item) { return item !== key; });
      }
      setSelectionStatus('已暂选 ' + draftSelectedKeys.length + ' 项，点击应用后更新', draftSelectedKeys.length < 2);
    });
    const search = root.document.getElementById('dashboardComparisonSearch');
    if (search) search.addEventListener('input', renderPickerOptions);
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('popstate', function(event) {
        if (!heatmapDrillBoard) return;
        const nextMarker = event && event.state && event.state[HEATMAP_DRILL_HISTORY_KEY];
        if (nextMarker && nextMarker.code === heatmapDrillBoard.code && nextMarker.taxonomy === heatmapDrillBoard.taxonomy) return;
        renderHeatmapOverview();
      });
    }
    root.document.addEventListener('keydown', function(event) {
      if ((event.key === 'Enter' || event.key === ' ') && event.target && event.target.matches && event.target.matches('[data-index-key]')) {
        event.preventDefault();
        openIndexDetail(event.target.getAttribute('data-index-key'));
        return;
      }
      if (event.key !== 'Escape') return;
      if (indexDetailKey) {
        closeIndexDetail();
        return;
      }
      const picker = root.document.getElementById('dashboardComparisonPicker');
      if (picker && !picker.hidden) closePicker(true);
    });
    const initialSelectionKey = selectedKeys.join(',');
    loadActivePeriod().catch(function(error) {
      if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
    });
    if (selectedPeriod !== 'intraday') {
      loadIndexIntraday({ force: false }).catch(function(error) {
        if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
      });
    }
    loadCatalog().then(function() {
      if (selectedKeys.join(',') === initialSelectionKey) return null;
      return loadActivePeriod({ force: false });
    }).catch(function(error) {
      catalogStatus = { status: 'unavailable', warnings: [error && error.message || String(error)] };
      setSelectionStatus('比较目录加载失败；已保留固定指数', true);
    });
    loadHeatmapSnapshot().catch(function(error) {
      if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
    });
    loadGlobalSignals().catch(function(error) {
      if (root.console && typeof root.console.warn === 'function') root.console.warn(error && error.message || error);
    });
  }

  function resize() {
    if (chartUsable(comparisonChart) && typeof comparisonChart.resize === 'function') comparisonChart.resize();
    if (chartUsable(heatmapChart) && typeof heatmapChart.resize === 'function') heatmapChart.resize();
    if (chartUsable(indexDetailChart) && typeof indexDetailChart.resize === 'function') indexDetailChart.resize();
    miniCharts.forEach(function(chart) {
      if (chartUsable(chart) && typeof chart.resize === 'function') chart.resize();
    });
  }

  function rerenderTheme() {
    indexCardsSignature = '';
    historyRenderSignature = '';
    heatmapRenderSignature = '';
    render(snapshot);
    renderIndexDetail();
  }

  readPreferences();
  return {
    buildFullTradingMinuteAxis,
    alignIntradayValues,
    buildComparisonOption,
    buildMiniIndexOption,
    buildMiniIntradayOption,
    buildIndexDetailOption,
    buildIntradayComparisonOption,
    indexCardDisplayQuote,
    indexCardIntradayStatus,
    correlationCells,
    globalSignalDisplay,
    renderGlobalSignals,
    loadGlobalSignals,
    buildHeatmapOption,
    heatmapCanvasWidth,
    normalizeSelectedKeys,
    reconcileCatalogSelection,
    reconcileSelectionWithCatalog,
    comparisonRequestUrl,
    intradayRefreshPlan,
    heatmapRefreshPlan,
    historySnapshotSignature,
    render,
    loadWindow,
    getSelectedWindow: function() { return selectedWindow; },
    getSelectedPeriod: function() { return selectedPeriod; },
    getHeatmapBoardType: function() { return heatmapBoardType; },
    getHeatmapDensity: function() { return heatmapDensity; },
    getSelectedKeys: function() { return selectedKeys.slice(); },
    loadActivePeriod,
    loadHeatmapSnapshot,
    bind,
    rerenderTheme,
    resize
  };
});
