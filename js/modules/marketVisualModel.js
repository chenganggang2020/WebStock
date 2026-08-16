(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MarketVisualModel = api;
})(typeof window !== 'undefined' ? window : null, function() {
  const PALETTES = {
    light: { up: '#ff2d2d', down: '#00b050', flat: '#64748b', limitUp: '#f5c542' },
    dark: { up: '#ff4d4f', down: '#22c55e', flat: '#94a3b8', limitUp: '#ffd54f' }
  };

  function palette(dark) {
    return Object.assign({}, dark ? PALETTES.dark : PALETTES.light);
  }

  function trendColor(change, dark) {
    const value = Number(change);
    if (!Number.isFinite(value)) return palette(dark).flat;
    return value >= 0 ? palette(dark).up : palette(dark).down;
  }

  function limitRate(stock) {
    const code = String(stock && stock.code || '');
    const name = String(stock && stock.name || '').toUpperCase();
    if (/^(?:\*?ST)/.test(name)) return 0.05;
    if (/^(?:300|301|688|689)/.test(code)) return 0.2;
    if (/^(?:4|8|92)/.test(code)) return 0.3;
    return 0.1;
  }

  function roundedPrice(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function classifyDailyBar(bar, previousClose, stock) {
    const close = Number(bar && bar.close);
    const open = Number(bar && bar.open);
    const base = Number(previousClose);
    if (!Number.isFinite(close)) return 'flat';
    if (Number.isFinite(base) && base > 0) {
      const rate = limitRate(stock);
      const limitUp = roundedPrice(base * (1 + rate));
      const limitDown = roundedPrice(base * (1 - rate));
      if (close >= limitUp - 0.005) return 'limit-up';
      if (close <= limitDown + 0.005) return 'limit-down';
    }
    if (!Number.isFinite(open) || close === open) return 'flat';
    return close > open ? 'up' : 'down';
  }

  function candleColors(stock, rawData, dark) {
    const colors = palette(dark);
    return (rawData || []).map(function(bar, index) {
      const explicitPrevious = Number(bar && bar.prevClose);
      const previousClose = Number.isFinite(explicitPrevious) && explicitPrevious > 0
        ? explicitPrevious
        : index > 0 ? Number(rawData[index - 1].close) : null;
      const kind = classifyDailyBar(bar, previousClose, stock);
      const color = kind === 'limit-up' ? colors.limitUp
        : kind === 'down' || kind === 'limit-down' ? colors.down
        : kind === 'flat' ? colors.flat : colors.up;
      return { kind: kind, color: color };
    });
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function firstNumber(text, pattern) {
    const match = String(text || '').match(pattern);
    return match ? positiveNumber(match[1]) : null;
  }

  function watchlistMarks(item) {
    item = item || {};
    const note = String(item.note || '').replace(/，/g, ',').replace(/；/g, ';');
    const lines = [];
    const areas = [];
    const d1 = note.match(/\bD1\s*([0-9]+(?:\.[0-9]+)?)\s*(?:[-–—~至]\s*([0-9]+(?:\.[0-9]+)?))?/i);
    if (d1) {
      const from = positiveNumber(d1[1]);
      const to = positiveNumber(d1[2]);
      if (from && to) areas.push({ name: 'D1 观察区', from: Math.min(from, to), to: Math.max(from, to) });
      else if (from) lines.push({ name: 'D1 观察', value: from, kind: 'observe' });
    }
    const d2 = firstNumber(note, /\bD2\D*?([0-9]+(?:\.[0-9]+)?)/i);
    const r1Match = note.match(/\bR1\s*([0-9]+(?:\.[0-9]+)?)(?:\s*[-–—~至]\s*([0-9]+(?:\.[0-9]+)?))?/i);
    const r1 = r1Match ? positiveNumber(r1Match[2] || r1Match[1]) : null;
    const strong = firstNumber(note, /强确认\D*?([0-9]+(?:\.[0-9]+)?)/i);
    if (d2) lines.push({ name: 'D2 防守', value: d2, kind: 'defense' });
    if (r1) lines.push({ name: 'R1 转强', value: r1, kind: 'breakout' });
    if (strong) lines.push({ name: '强确认', value: strong, kind: 'confirm' });
    if (!d2) {
      const alertLow = positiveNumber(item.alertLow);
      if (alertLow) lines.push({ name: '预警下限', value: alertLow, kind: 'defense' });
    }
    if (!r1) {
      const alertHigh = positiveNumber(item.alertHigh);
      if (alertHigh) lines.push({ name: '预警上限', value: alertHigh, kind: 'breakout' });
    }
    return { lines: lines, areas: areas };
  }

  return {
    palette: palette,
    trendColor: trendColor,
    limitRate: limitRate,
    classifyDailyBar: classifyDailyBar,
    candleColors: candleColors,
    watchlistMarks: watchlistMarks
  };
});
