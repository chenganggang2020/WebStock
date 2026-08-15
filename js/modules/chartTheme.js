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
      text: '#334155',
      up: '#cf646b',
      down: '#3d9b74',
      grid: '#e2e8f0',
      axis: '#cbd5e1',
      reference: '#94a3b8',
      movingAverages: ['#bd962f', '#c56870', '#5682ad', '#806ca2', '#629078', '#b8764e', '#488e8a'],
      indicators: ['#5682ad', '#b9813e', '#b85f83', '#629078', '#806ca2', '#488e8a', '#b8764e']
    },
    dark: {
      background: '#1e293b',
      text: '#cbd5e1',
      up: '#df7b82',
      down: '#62b58b',
      grid: '#334155',
      axis: '#475569',
      reference: '#94a3b8',
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

  return {
    get: get,
    applyToOption: applyToOption
  };
});
