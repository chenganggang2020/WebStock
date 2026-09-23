(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChartTheme = api;
})(typeof window !== 'undefined' ? window : null, function() {
  const widths = Object.freeze({
    main: 1.4,
    average: 1.15,
    indicator: 1.2,
    mini: 1.15,
    miniEmphasis: 1.45,
    zeroReference: 1.05,
    reference: 0.7,
    grid: 0.6
  });

  const palettes = {
    light: {
      background: '#ffffff',
      text: '#586c81',
      up: '#c72d3d',
      down: '#087f5b',
      limitUp: '#f5c542',
      grid: '#e2e8f0',
      axis: '#cbd5e1',
      reference: '#94a3b8',
      movingAverages: ['#bd962f', '#c56870', '#5682ad', '#806ca2', '#629078', '#b8764e', '#488e8a'],
      indicators: ['#5682ad', '#b9813e', '#b85f83', '#629078', '#806ca2', '#488e8a', '#b8764e']
    },
    dark: {
      background: '#191919',
      text: '#b4b4b4',
      up: '#ff6368',
      down: '#36d19d',
      limitUp: '#ffd54f',
      grid: '#333333',
      axis: '#606060',
      reference: '#a0a0a0',
      movingAverages: ['#d0ad55', '#d58188', '#72a0ca', '#a18ac1', '#7bab91', '#ce906b', '#68aaa5'],
      indicators: ['#72a0ca', '#d19a58', '#cf7c9f', '#7bab91', '#a18ac1', '#68aaa5', '#ce906b']
    }
  };

  function get(dark) {
    const mode = dark ? 'dark' : 'light';
    const colors = palettes[mode];
    return {
      mode: mode,
      colors: Object.assign({}, colors, {
        movingAverages: colors.movingAverages.slice(),
        indicators: colors.indicators.slice()
      }),
      widths: widths,
      volumeBarWidth: '42%'
    };
  }

  function asList(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  function ensureLineStyle(target) {
    if (!target.lineStyle) target.lineStyle = {};
    return target.lineStyle;
  }

  function styleAxis(axis, theme) {
    if (!axis) return;
    const color = axis.axisLabel && typeof axis.axisLabel.color === 'function' ? axis.axisLabel.color : theme.colors.text;
    axis.axisLabel = Object.assign({ fontSize: 12, hideOverlap: true }, axis.axisLabel, {color: color});
    axis.nameTextStyle = Object.assign({}, axis.nameTextStyle, {color: theme.colors.text});
    if (!axis.axisLine) axis.axisLine = {};
    const axisLine = ensureLineStyle(axis.axisLine);
    axisLine.color = theme.colors.axis;
    axisLine.width = theme.widths.reference;

    if (!axis.splitLine) axis.splitLine = {};
    const splitLine = ensureLineStyle(axis.splitLine);
    splitLine.color = theme.colors.grid;
    splitLine.width = theme.widths.grid;
  }

  function applyToOption(option, settings) {
    const result = option || {};
    const theme = get(Boolean(settings && settings.dark));
    result.backgroundColor = theme.colors.background;
    result.animation = false;
    result.textStyle = Object.assign({ fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 12 }, result.textStyle);
    result.textStyle.color = theme.colors.text;
    asList(result.legend).forEach(function(legend) {
      legend.textStyle = Object.assign({}, legend.textStyle, {color: theme.colors.text});
    });
    if (result.tooltip) {
      result.tooltip.confine = true;
      result.tooltip.backgroundColor = theme.colors.background;
      result.tooltip.borderColor = theme.colors.axis;
      result.tooltip.textStyle = Object.assign({}, result.tooltip.textStyle, { color: theme.colors.text });
    }

    asList(result.xAxis).forEach(function(axis) { styleAxis(axis, theme); });
    asList(result.yAxis).forEach(function(axis) { styleAxis(axis, theme); });

    let averageIndex = 0;
    asList(result.series).forEach(function(series) {
      if (!series) return;
      const name = String(series.name || '');
      const movingAverage = /^(?:VOL_)?MA\d+/i.test(name);
      const reference = /^(?:昨收|参考)/.test(name);
      const zeroReference = reference && series.referenceRole === 'zero';
      const observedMinuteLine = /^(?:分时价格|均价)$/.test(name);

      if (series.type === 'line') {
        const lineStyle = ensureLineStyle(series);
        if (observedMinuteLine) {
          series.smooth = false;
          lineStyle.width = Math.min(Number(lineStyle.width) || theme.widths.main, theme.widths.main);
        } else if (movingAverage) {
          series.smooth = false;
          lineStyle.width = theme.widths.average;
          lineStyle.color = theme.colors.movingAverages[averageIndex % theme.colors.movingAverages.length];
          averageIndex += 1;
        } else if (reference) {
          lineStyle.width = zeroReference ? theme.widths.zeroReference : theme.widths.reference;
          lineStyle.color = theme.colors.reference;
        } else {
          lineStyle.width = Math.min(Number(lineStyle.width) || theme.widths.main, theme.widths.main);
        }
      }

      if (series.markLine) {
        const markLineStyle = ensureLineStyle(series.markLine);
        markLineStyle.width = zeroReference ? theme.widths.zeroReference : theme.widths.reference;
        markLineStyle.color = theme.colors.reference;
      }

      if (series.type === 'bar' && /(?:成交量|volume)/i.test(name)) {
        series.barWidth = theme.volumeBarWidth;
      }
    });

    return result;
  }

  // Merge chart framing only. A color change never replaces data, zoom or selection.
  function refreshExisting(engine, document) {
    if (!engine || !document) return;
    const dark = document.body.classList.contains('dark');
    document.querySelectorAll('[_echarts_instance_]').forEach(function(node) {
      const chart = engine.getInstanceByDom(node);
      if (!chart || chart.isDisposed()) return;
      const current = chart.getOption();
      if (!current) return;
      const patch = {tooltip: {}};
      ['xAxis', 'yAxis', 'legend'].forEach(function(key) {
        if (current[key] && asList(current[key]).length) patch[key] = asList(current[key]).map(function(item) {
          return key !== 'legend' && item.axisLabel && typeof item.axisLabel.color === 'function'
            ? {axisLabel: {color: item.axisLabel.color}} : {};
        });
      });
      chart.setOption(applyToOption(patch, {dark: dark}), {notMerge: false, lazyUpdate: false});
    });
  }

  // Preserve interaction only within the same stock, date and resolution.
  // A new instrument gets its own default viewport, not the previous stock's crop.
  function renderTo(engine, dom, current, option, frameKey) {
    const reusable = current && (!current.isDisposed || !current.isDisposed()) &&
      (!current.getDom || current.getDom() === dom);
    let chart = current;
    if (!reusable) {
      if (current && current.dispose && (!current.isDisposed || !current.isDisposed())) current.dispose();
      dom.innerHTML = '';
      chart = engine.init(dom);
    } else if (current.__terminalFrameKey === frameKey && typeof current.getOption === 'function') {
      const previous = current.getOption();
      asList(option.dataZoom).forEach(function(zoom, index) {
        const old = asList(previous.dataZoom)[index];
        if (old && Number.isFinite(old.start) && Number.isFinite(old.end)) {
          zoom.start = old.start; zoom.end = old.end;
        }
      });
      asList(option.legend).forEach(function(legend, index) {
        const old = asList(previous.legend)[index];
        if (old && old.selected) legend.selected = Object.assign({}, old.selected);
      });
    }
    chart.__terminalFrameKey = frameKey;
    chart.setOption(option, { notMerge: true, lazyUpdate: false });
    return chart;
  }

  function bindReadout(chart, options) {
    if (!chart || !chart.on || !chart.off) return;
    const previous = chart.__fixedReadout;
    if (previous) {
      chart.off('updateAxisPointer', previous.move);
      chart.off('globalout', previous.reset);
    }
    const labels = options.labels;
    const latest = options.defaultIndex == null ? labels.length - 1 : options.defaultIndex;
    let last = -1;
    function show(index) {
      if (index < 0 || index >= labels.length || index === last || chart.isDisposed?.()) return;
      last = index;
      const patch = { graphic: { id: 'fixed-quote-readout', type: 'text', silent: true,
        left: options.left || 48, top: options.top == null ? 28 : options.top,
        style: { text: options.textAt(index), fill: options.color || '#586C81', fontSize: 12,
          overflow: 'truncate', width: Math.max(240, (chart.getWidth?.() || 1200) - 105) } } };
      if (options.legendAt) patch.legend = { formatter: options.legendAt(index) };
      chart.setOption(patch, { lazyUpdate: true });
    }
    const move = event => {
      const axis = (event.axesInfo || []).find(item => item.axisDim === 'x');
      if (axis) show(typeof axis.value === 'number' ? axis.value : labels.indexOf(String(axis.value)));
    };
    const reset = () => show(latest);
    chart.__fixedReadout = { move, reset };
    chart.on('updateAxisPointer', move);
    chart.on('globalout', reset);
    reset();
  }

  function formatAxisNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    if (number === 0) return '0';
    return Math.abs(number) < 1 ? String(Number(number.toPrecision(3))) : String(Number(number.toFixed(2)));
  }

  return {
    get: get,
    applyToOption: applyToOption,
    refreshExisting: refreshExisting,
    renderTo: renderTo,
    bindReadout: bindReadout,
    formatAxisNumber: formatAxisNumber
  };
});
