(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MarketHeatmapModel = api;
})(typeof window !== 'undefined' ? window : null, function() {
  const METRICS = {
    turnover: {
      area: { key: 'amount', label: '成交额', unit: 'CNY' },
      color: { key: 'dailyChangePct', label: '涨跌幅', unit: 'percent' }
    },
    flow: {
      area: { key: 'absoluteMainNetInflow', label: '资金净额绝对值', unit: 'CNY' },
      color: { key: 'mainNetInflow', label: '资金净额', unit: 'CNY' }
    }
  };

  function finiteNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function boardGroup(kind) {
    if (kind === 'industry' || kind === 'sina-industry') return 'industry';
    if (kind === 'concept') return 'concept';
    if (kind === 'region') return 'region';
    return null;
  }

  function buildTreemapModel(boards, options) {
    const items = Array.isArray(boards) ? boards : [];
    options = options || {};
    const mode = options.mode === 'flow' ? 'flow' : 'turnover';
    const boardType = ['industry', 'concept', 'region'].includes(options.boardType)
      ? options.boardType : 'all';
    const nodes = [];

    items.forEach(function(board) {
      if (!board) return;
      const group = boardGroup(board.kind || board.taxonomy);
      if (!group || (boardType !== 'all' && group !== boardType)) return;
      const name = String(board.name || board.code || '').trim();
      if (!name) return;

      const colorValue = mode === 'flow'
        ? finiteNumber(board.mainNetInflow)
        : finiteNumber(board.dailyChangePct === undefined ? board.changePct : board.dailyChangePct);
      const sourceArea = mode === 'flow'
        ? finiteNumber(board.mainNetInflow)
        : finiteNumber(board.amount);
      const areaValue = mode === 'flow' && sourceArea !== null ? Math.abs(sourceArea) : sourceArea;
      if (colorValue === null || areaValue === null || areaValue <= 0) return;
      const code = String(board.code || '');

      nodes.push({
        id: String(code || group + ':' + name),
        key: String(board.key || ''),
        code: code,
        name: name,
        group: group,
        taxonomy: group,
        sourceKind: board.kind || board.taxonomy,
        nodeType: 'board',
        drillable: /^BK\d{4}$/i.test(code) || Boolean(board.capabilities && board.capabilities.constituents === true),
        value: [areaValue, colorValue],
        areaValue: areaValue,
        colorValue: colorValue,
        amount: finiteNumber(board.amount),
        dailyChangePct: finiteNumber(board.dailyChangePct === undefined ? board.changePct : board.dailyChangePct),
        mainNetInflow: finiteNumber(board.mainNetInflow),
        leaderName: String(board.leaderName || '')
      });
    });

    nodes.sort(function(a, b) { return b.areaValue - a.areaValue; });
    const validCount = nodes.length;
    const requestedLimit = Number(options.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : null;
    const displayedNodes = limit ? nodes.slice(0, limit) : nodes;
    return {
      mode: mode,
      boardType: boardType,
      availability: displayedNodes.length ? 'available' : 'unavailable',
      areaMetric: Object.assign({}, METRICS[mode].area),
      colorMetric: Object.assign({}, METRICS[mode].color),
      nodes: displayedNodes,
      totalCount: items.length,
      validCount: validCount,
      displayedCount: displayedNodes.length,
      omittedCount: validCount - displayedNodes.length,
      includedCount: displayedNodes.length,
      excludedCount: items.length - validCount,
      unavailableReason: displayedNodes.length ? null : 'no-complete-board-metrics'
    };
  }

  return {
    boardGroup: boardGroup,
    buildTreemapModel: buildTreemapModel
  };
});
