(function(root) {
  'use strict';

  const REFRESH_MS = 15000;
  let snapshot = null;
  let chart = null;
  let timer = null;
  let loading = null;

  function element(id) {
    return typeof document === 'undefined' ? null : document.getElementById(id);
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatPct(value) {
    const number = finite(value);
    return number === null ? '暂无' : (number > 0 ? '+' : '') + number.toFixed(2) + '%';
  }

  function valueClass(value) {
    const number = finite(value);
    if (number === null || Math.abs(number) < 0.0001) return '';
    return number > 0 ? 'pnl-up' : 'pnl-down';
  }

  function fixedMinuteAxis() {
    const labels = [];
    [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]].forEach(function(session) {
      for (let minute = session[0]; minute <= session[1]; minute += 1) {
        labels.push(String(Math.floor(minute / 60)).padStart(2, '0') + ':' +
          String(minute % 60).padStart(2, '0'));
      }
    });
    return labels;
  }

  function visibleAxisLabel(index, label) {
    return ['09:30', '10:00', '10:30', '11:00', '11:30', '13:30', '14:00', '14:30', '15:00']
      .includes(String(label || ''));
  }

  function chartAxis(data) {
    const minutes = Math.max(1, Math.round(Number(data && data.coverage && data.coverage.intervalSeconds || 60) / 60));
    const axis = fixedMinuteAxis();
    if (minutes === 1) return axis;
    const observed = new Set((data.series || []).map(point => point.label));
    return axis.filter(label => (Number(label.slice(3)) % minutes === 0 && !['09:30', '13:00'].includes(label)) || observed.has(label));
  }

  function stateText(metrics) {
    if (!metrics || metrics.cumulativeState === 'unavailable') return '量能暂不可用';
    if (metrics.divergence === 'cumulative-up-short-down') return '累计放量 · 短时转缩';
    if (metrics.divergence === 'cumulative-down-short-up') return '累计缩量 · 短时转强';
    const cumulative = metrics.cumulativeState === 'expanding' ? '累计放量'
      : (metrics.cumulativeState === 'contracting' ? '累计缩量' : '累计平量');
    const shortTerm = metrics.shortTermState === 'accelerating' ? '短时加速'
      : (metrics.shortTermState === 'decelerating' ? '短时减速'
        : metrics.shortTermState === 'unavailable' ? '短时窗口预热或不可用' : '短时平稳');
    return cumulative + ' · ' + shortTerm;
  }

  function setMetric(id, value) {
    const target = element(id);
    if (!target) return;
    target.textContent = formatPct(value);
    target.className = valueClass(value);
  }

  function formatMeasure(value, measure) {
    const number = finite(value);
    if (number === null) return '暂无';
    const absolute = Math.abs(number);
    const unit = measure === 'amount' ? '元' : '（量）';
    if (absolute >= 1000000000000) return (number / 1000000000000).toFixed(2) + ' 万亿' + unit;
    if (absolute >= 100000000) return (number / 100000000).toFixed(2) + ' 亿' + unit;
    if (absolute >= 10000) return (number / 10000).toFixed(0) + ' 万' + unit;
    return number.toFixed(0) + (measure === 'amount' ? ' 元' : '（量）');
  }

  function setDetail(id, current, previous, previousLabel, measure) {
    const target = element(id);
    if (!target) return;
    const currentNumber = finite(current);
    const previousNumber = finite(previous);
    const delta = currentNumber === null || previousNumber === null ? null : currentNumber - previousNumber;
    target.textContent = previousLabel + ' ' + formatMeasure(previous, measure) +
      (delta === null ? '' : '｜差额 ' + (delta > 0 ? '+' : '') + formatMeasure(delta, measure));
  }

  function setMeasure(id, value, measure) {
    const target = element(id);
    if (!target) return;
    target.textContent = formatMeasure(value, measure);
  }

  function renderChart(data) {
    const target = element('volumePaceChart');
    if (!target || !root.echarts) return;
    if (!chart) chart = root.echarts.init(target);
    const series = data && Array.isArray(data.series) ? data.series : [];
    if (!series.length) {
      chart.clear();
      target.dataset.empty = 'true';
      return;
    }
    delete target.dataset.empty;
    const text = '#94a3b8';
    const grid = '#263244';
    const axis = chartAxis(data);
    const points = new Map(series.map(function(point) { return [point.label, point]; }));
    chart.setOption({
      animation: false,
      color: ['#fb7185', '#60a5fa', '#f6c445'],
      tooltip: { trigger: 'axis', valueFormatter: function(value) { return formatPct(value); } },
      legend: { top: 0, right: 4, textStyle: { color: text, fontSize: 12 } },
      grid: { left: 50, right: 16, top: 34, bottom: 28 },
      xAxis: {
        type: 'category', boundaryGap: false, data: axis,
        axisLabel: { color: text, fontSize: 10, interval: visibleAxisLabel },
        axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }
      },
      yAxis: {
        type: 'value', axisLabel: { color: text, fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: grid, type: 'dashed' } },
        axisLine: { show: false }, axisTick: { show: false }
      },
      series: [
        {
          name: data && data.quality && data.quality.usable === false ? '已对齐槽累计同比（不完整）' : '累计同比',
          type: 'line', showSymbol: false, connectNulls: true,
          data: axis.map(function(label) { const point = points.get(label); return point ? point.cumulativeYoYPct : null; }),
          lineStyle: { width: 2.4 },
          markLine: {
            silent: true, symbol: 'none',
            label: { formatter: (axis.find(label => label >= '13:00') || '13:00') + ' 午后', color: text, fontSize: 10 },
            lineStyle: { color: grid, type: 'dashed', width: 1 },
            data: [{ xAxis: axis.find(label => label >= '13:00') }]
          }
        },
        { name: '5分钟同比', type: 'line', showSymbol: false, connectNulls: true, data: axis.map(function(label) { const point = points.get(label); return point ? point.rolling5YoYPct : null; }), lineStyle: { width: 1.8 } },
        { name: '5分钟环比', type: 'line', showSymbol: false, connectNulls: true, data: axis.map(function(label) { const point = points.get(label); return point ? point.rolling5SequentialPct : null; }), lineStyle: { width: 1.6, type: 'dashed' } }
      ]
    }, true);
    chart.resize();
  }

  function render(data) {
    snapshot = data || null;
    if (root.HomeTerminal) root.HomeTerminal.renderVolume(data);
    const metrics = data && data.metrics || null;
    const cumulativeUsable = !(data && data.quality && data.quality.usable === false);
    const status = element('volumePaceStatus');
    if (status) {
      status.textContent = stateText(metrics);
      status.dataset.state = data && data.status || 'unavailable';
    }
    setMetric('volumePaceCumulative', cumulativeUsable && metrics ? metrics.cumulativeYoYPct : null);
    setMetric('volumePaceRolling5', metrics && metrics.rolling5YoYPct);
    setMetric('volumePaceSequential5', metrics && metrics.rolling5SequentialPct);
    const measure = data && data.measure || 'amount';
    setMeasure('volumePaceCumulativeValue', cumulativeUsable && metrics ? metrics.todayCumulativeValue : null, measure);
    setMeasure('volumePaceRolling5Value', metrics && metrics.todayRolling5Value, measure);
    setMeasure('volumePaceSequential5Value', metrics && metrics.todayRolling5Value, measure);
    setDetail('volumePaceCumulativeDetail', metrics && metrics.todayCumulativeValue,
      metrics && metrics.previousCumulativeValue, '前日', measure);
    const cumulativeDetail = element('volumePaceCumulativeDetail');
    if (cumulativeDetail && data && data.quality && data.quality.usable === false) {
      cumulativeDetail.textContent += ' · 仅已观测对齐槽，非完整累计';
    }
    setDetail('volumePaceRolling5Detail', metrics && metrics.todayRolling5Value,
      metrics && metrics.previousRolling5Value, '前日同期', measure);
    setDetail('volumePaceSequential5Detail', metrics && metrics.todayRolling5Value,
      metrics && metrics.priorRolling5Value, '紧邻前5分', measure);
    const asOf = element('volumePaceAsOf');
    if (asOf) {
      const marketLabel = data && data.marketState === 'live' ? '盘中' :
        (data && data.marketState === 'stale-cache' ? '旧缓存'
          : data && data.marketState === 'delayed' ? '行情延迟' : '最近收盘');
      asOf.textContent = data && data.tradingDate
        ? data.tradingDate + ' ' + (data.asOf || '--') + ' · ' + marketLabel : '--';
    }
    const source = element('volumePaceSource');
    if (source) {
      const sourceLabel = data && data.source && data.source.label || '分钟量能来源暂不可用';
      const comparison = data && data.comparisonDate ? ' · 对比 ' + data.comparisonDate : '';
      const intervalSeconds = data && data.coverage && Number(data.coverage.intervalSeconds) || 60;
      const intervalLabel = intervalSeconds <= 60 ? '个1分钟时点' : '个' + Math.round(intervalSeconds / 60) + '分钟时点';
      const coverage = data && data.coverage ? ' · 对齐 ' + data.coverage.alignedPoints +
        (Number.isFinite(data.coverage.expectedAlignedPoints) ? '/' + data.coverage.expectedAlignedPoints : '') +
        ' ' + intervalLabel + (Number.isFinite(data.coverage.alignedCoveragePct) ? '（' + data.coverage.alignedCoveragePct + '%）' : '') : '';
      const threshold = data && data.quality && data.quality.thresholdProfile
        ? ' · 状态阈值为未校准启发式' : '';
      const resolution = intervalSeconds <= 60
        ? ' · 优先1分钟成交额'
        : ' · 当前为5分钟成交量降级，不是成交额或逐笔数据';
      source.textContent = sourceLabel + comparison + coverage + threshold +
        resolution + (data && data.reason ? ' · ' + data.reason : '') + ' · 公开行情不保证交易所逐笔实时';
    }
    renderChart(data);
  }

  function startTimer() {
    if (timer || typeof setInterval === 'undefined') return;
    timer = setInterval(function() {
      if (!root.State || root.State.currentMainView === 'dashboard') {
        load().catch(function(error) { console.warn(error && error.message ? error.message : error); });
      }
    }, REFRESH_MS);
  }

  function load(options) {
    options = options || {};
    if (loading && !options.refresh) return loading;
    const suffix = options.refresh ? '?refresh=1' : '';
    loading = root.ApiClient.fetchJsonData('/api/market/volume-pace' + suffix).then(function(data) {
      render(data);
      startTimer();
      return data;
    }).finally(function() { loading = null; });
    return loading;
  }

  function resize() {
    if (chart) chart.resize();
  }

  function rerender() {
    if (snapshot) render(snapshot);
  }

  const api = { load, render, resize, rerender, formatPct, stateText, fixedMinuteAxis, chartAxis, visibleAxisLabel, formatMeasure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VolumePace = api;
})(typeof window !== 'undefined' ? window : globalThis);
