(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketBoardPreferences = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const defaults = ['nasdaq-composite', 'dow-jones', 'sox', 'sp500', 'hang-seng', 'vix', 'gold-future', 'usd-cnh'];
  const storageKey = 'webstock.market-board.v1', widgetKey = 'webstock.market-widget.v1';
  function normalize(input, allowed) {
    const keys = Array.isArray(input?.keys) ? input.keys : defaults;
    return { keys: [...new Set(keys)].filter(key => typeof key === 'string' && (!allowed || allowed.includes(key))).slice(0, 32) };
  }
  function widget(input) {
    return { keys: normalize(input || { keys: ['nasdaq-composite', 'sox', 'sp500', 'gold-future'] }).keys, showQuotes: input?.showQuotes !== false, showPnl: input?.showPnl !== false,
      showPositions: input?.showPositions === true, hideAmounts: input?.hideAmounts !== false,
      accountId: Number.isSafeInteger(input?.accountId) && input.accountId > 0 ? input.accountId : 0 };
  }
  function read(key, storage) { try { return JSON.parse(storage.getItem(key)); } catch (_) { return null; } }
  function spark(points) {
    const rows = points || [], valid = rows.filter(p => p.close != null && Number.isFinite(p.close));
    if (!valid.length) return '';
    const low = Math.min(...valid.map(p => p.close)), span = Math.max(...valid.map(p => p.close)) - low || 1;
    let d = '', connected = false;
    rows.forEach((row, i) => {
      if (row.close == null) { connected = false; return; }
      d += (connected ? 'L' : 'M') + (i / Math.max(1, rows.length - 1) * 160).toFixed(1) + ',' + (25 - (row.close - low) / span * 23).toFixed(1) + ' ';
      connected = true;
    });
    return '<svg viewBox="0 0 160 28" preserveAspectRatio="none" role="img" aria-label="最近交易时段分钟走势"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.1" vector-effect="non-scaling-stroke"/></svg>';
  }
  return { defaults, storageKey, widgetKey, normalize, widget, read, spark };
});
