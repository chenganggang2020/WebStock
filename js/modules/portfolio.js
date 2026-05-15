function portfolioApi(path, options) {
  return window.apiFetch('/api/portfolio' + path, options);
}

function fmt(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits === undefined ? 2 : digits) : '--';
}

function pnlClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 0 ? 'pnl-up' : 'pnl-down';
}

function finalPnlValue(pos) {
  return pos && pos.unrealizedPnl !== undefined && pos.unrealizedPnl !== null ? pos.unrealizedPnl : pos.netPnl;
}

function finalPnlRateValue(pos) {
  return pos && pos.unrealizedPnlRate !== undefined && pos.unrealizedPnlRate !== null ? pos.unrealizedPnlRate : pos.netPnlRate;
}

function portfolioCsvCell(value) {
  const text = String(value == null ? '' : value);
  const safeText = /^[\t\r\n]/.test(text) || /^\s*[=+@]/.test(text) ? "'" + text : text;
  return /[",\r\n]/.test(safeText) ? '"' + safeText.replace(/"/g, '""') + '"' : safeText;
}

function downloadPortfolioCsv(filename, rows) {
  const csv = rows.map(function(row) {
    return row.map(portfolioCsvCell).join(',');
  }).join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function portfolioFileDate() {
  return window.WebStockTime && window.WebStockTime.filenameDate
    ? window.WebStockTime.filenameDate()
    : new Date().toISOString().slice(0, 10);
}

async function loadPortfolio() {
  const result = await portfolioApi('/recalculate', { method: 'POST' });
  window.State.positions = result.positions || [];
  window.State.portfolioSummary = result.summary || {};
  window.State.portfolioAllocation = result.allocation || [];
  renderSummary();
  renderPositions();
  await loadClosedPositions();
  if (window.PortfolioCharts) {
    window.PortfolioCharts.renderAllocationChart(window.State.portfolioAllocation);
    window.PortfolioCharts.renderPnlRankChart(window.State.positions);
    setTimeout(window.PortfolioCharts.resizePortfolioCharts, 30);
  }
  renderStatsOverview();
  if (window.Dashboard) window.Dashboard.refreshCards();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
}

async function loadSummary() {
  window.State.portfolioSummary = await portfolioApi('/summary');
  renderSummary();
  return window.State.portfolioSummary;
}

async function loadPositions() {
  window.State.positions = await portfolioApi('/positions');
  renderPositions();
  return window.State.positions;
}

async function loadClosedPositions() {
  window.State.closedPositions = await portfolioApi('/closed-positions');
  renderClosedPositions();
  return window.State.closedPositions;
}

function renderSummary() {
  const summary = window.State.portfolioSummary || {};
  document.getElementById('summaryMarketValue').textContent = fmt(summary.totalMarketValue);
  document.getElementById('summaryCost').textContent = fmt(summary.totalCost);
  const unrealized = document.getElementById('summaryUnrealizedPnl');
  unrealized.textContent = fmt(summary.unrealizedPnl);
  unrealized.title = '当前剩余持仓浮动收益：市值 - 剩余持仓成本。买入手续费已计入成本，不叠加已实现盈亏。';
  unrealized.className = 'summary-value ' + pnlClass(summary.unrealizedPnl);
  const realized = document.getElementById('summaryRealizedPnl');
  realized.textContent = fmt(summary.realizedPnl);
  realized.className = 'summary-value ' + pnlClass(summary.realizedPnl);
  const rate = document.getElementById('summaryPnlRate');
  rate.textContent = fmt(summary.totalPnlRate) + '%';
  rate.className = 'summary-value ' + pnlClass(summary.totalPnlRate);
}

function visiblePositions() {
  let positions = (window.State.positions || []).slice();
  const keyword = document.getElementById('positionSearchInput') ? document.getElementById('positionSearchInput').value.trim().toLowerCase() : '';
  const sort = document.getElementById('positionSortSelect') ? document.getElementById('positionSortSelect').value : 'market_value';
  if (keyword) {
    positions = positions.filter(function(pos) {
      return [pos.code, pos.name].filter(Boolean).join(' ').toLowerCase().includes(keyword);
    });
  }
  positions.sort(function(a, b) {
    if (sort === 'pnl') return (Number(finalPnlValue(b)) || -999999999) - (Number(finalPnlValue(a)) || -999999999);
    if (sort === 'return') return (Number(finalPnlRateValue(b)) || -999999999) - (Number(finalPnlRateValue(a)) || -999999999);
    if (sort === 'code') return String(a.code || '').localeCompare(String(b.code || ''));
    const bValue = Number(b.marketValue === null ? b.costValue : b.marketValue) || 0;
    const aValue = Number(a.marketValue === null ? a.costValue : a.marketValue) || 0;
    return bValue - aValue;
  });
  return positions;
}

function renderPositions() {
  const allPositions = window.State.positions || [];
  const positions = visiblePositions();
  const tbody = document.getElementById('positionsTbody');
  const table = document.getElementById('positionsTable');
  const empty = document.getElementById('portfolioEmpty');
  if (!tbody) return;
  if (empty) {
    empty.textContent = allPositions.length && !positions.length
      ? 'No positions match current filters.'
      : '暂无持仓，请先新增买入记录。';
  }
  empty.style.display = positions.length ? 'none' : '';
  table.style.display = positions.length ? 'table' : 'none';
  tbody.innerHTML = positions.map(pos => {
    const finalPnl = finalPnlValue(pos);
    const finalRate = finalPnlRateValue(pos);
    return '<tr data-code="' + pos.code + '" tabindex="0" title="双击查看行情，右键打开持仓操作">' +
      '<td><span class="position-code">' + pos.code + '</span></td>' +
      '<td>' + pos.name + '</td>' +
      '<td>' + pos.quantity + '</td>' +
      '<td>' + fmt(pos.avgCost, 3) + '</td>' +
      '<td>' + fmt(pos.currentPrice, 3) + '</td>' +
      '<td>' + fmt(pos.marketValue === null ? pos.costValue : pos.marketValue) + '</td>' +
      '<td class="' + pnlClass(finalPnl) + '" title="当前剩余持仓浮动收益：市值 - 剩余持仓成本；该代码历史已实现盈亏 ' + fmt(pos.realizedPnl) + '">' + fmt(finalPnl) + '</td>' +
      '<td class="' + pnlClass(finalRate) + '">' + fmt(finalRate) + '%</td>' +
      '<td class="' + pnlClass(pos.todayPnl) + '">' + fmt(pos.todayPnl) + '</td>' +
      '<td><span class="position-action-hint">双击查看 · 右键操作</span></td>' +
      '</tr>';
  }).join('');
  tbody.onclick = handlePositionClick;
  tbody.ondblclick = handlePositionDoubleClick;
  tbody.oncontextmenu = handlePositionContextMenu;
  tbody.onkeydown = handlePositionKeydown;
}

function renderClosedPositions() {
  const box = document.getElementById('closedPositionsPanel');
  if (!box) return;
  const rows = window.State.closedPositions || [];
  if (!rows.length) {
    box.innerHTML = '<h3>Closed position review</h3><div class="empty-state compact">No closed positions yet. Completed buy/sell cycles will appear here for realized P/L review.</div>';
    return;
  }
  const totalRealized = rows.reduce(function(sum, item) {
    return sum + (Number(item.realizedPnl) || 0);
  }, 0);
  const wins = rows.filter(function(item) { return Number(item.realizedPnl) > 0; }).length;
  const losses = rows.filter(function(item) { return Number(item.realizedPnl) < 0; }).length;
  const winRate = rows.length ? wins / rows.length * 100 : 0;
  box.innerHTML = '<div class="panel-title-row"><h3>Closed position review</h3><button class="small-btn" data-action="exportClosedPositions">Export CSV</button></div>' +
    '<div class="review-summary">' +
      '<span>Closed: ' + rows.length + '</span>' +
      '<span>Total realized P/L: <strong class="' + pnlClass(totalRealized) + '">' + fmt(totalRealized) + '</strong></span>' +
      '<span>Win rate: ' + fmt(winRate, 0) + '%</span>' +
      '<span>Wins/Losses: ' + wins + '/' + losses + '</span>' +
    '</div>' +
    '<table class="mini-table"><thead><tr><th>Code</th><th>Name</th><th>Realized P/L</th><th>Trades</th><th>First</th><th>Last</th></tr></thead><tbody>' +
    rows.map(function(item) {
      return '<tr>' +
        '<td>' + item.code + '</td>' +
        '<td>' + item.name + '</td>' +
        '<td class="' + pnlClass(item.realizedPnl) + '">' + fmt(item.realizedPnl) + '</td>' +
        '<td>' + item.tradeCount + '</td>' +
        '<td>' + item.firstTradeDate + '</td>' +
        '<td>' + item.lastTradeDate + '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
  box.onclick = handleClosedPositionsClick;
}

function exportPositionsCsv() {
  const rows = visiblePositions();
  if (!rows.length) {
    alert('No positions to export.');
    return;
  }
  const csvRows = [[
    'code',
    'name',
    'quantity',
    'avg_cost',
    'current_price',
    'market_value',
    'cost_value',
    'final_unrealized_pnl',
    'final_unrealized_pnl_rate',
    'total_fee',
    'today_pnl'
  ]].concat(rows.map(function(pos) {
    const marketValue = pos.marketValue === null ? pos.costValue : pos.marketValue;
    return [
      pos.code,
      pos.name,
      pos.quantity,
      fmt(pos.avgCost, 3),
      fmt(pos.currentPrice, 3),
      fmt(marketValue),
      fmt(pos.costValue),
      fmt(finalPnlValue(pos)),
      fmt(finalPnlRateValue(pos)),
      fmt(pos.totalFee),
      fmt(pos.todayPnl)
    ];
  }));
  downloadPortfolioCsv('webstock-positions-' + portfolioFileDate() + '.csv', csvRows);
}

function handleClosedPositionsClick(event) {
  const btn = event.target.closest('[data-action="exportClosedPositions"]');
  if (!btn) return;
  exportClosedPositionsCsv();
}

function exportClosedPositionsCsv() {
  const rows = window.State.closedPositions || [];
  if (!rows.length) {
    alert('No closed positions to export.');
    return;
  }
  const csvRows = [[
    'code',
    'name',
    'realized_pnl',
    'trade_count',
    'first_trade_date',
    'last_trade_date'
  ]].concat(rows.map(function(item) {
    return [
      item.code,
      item.name,
      fmt(item.realizedPnl),
      item.tradeCount,
      item.firstTradeDate,
      item.lastTradeDate
    ];
  }));
  downloadPortfolioCsv('webstock-closed-positions-' + portfolioFileDate() + '.csv', csvRows);
}

function renderStatsOverview() {
  const cards = document.getElementById('statsOverviewCards');
  const table = document.getElementById('statsExposureTable');
  if (!cards && !table) return;
  const summary = window.State.portfolioSummary || {};
  const positions = window.State.positions || [];
  const watchlistCount = (window.State.watchlist || []).length;
  const recentCount = (window.State.recentStocks || []).length;
  const sectorDashboard = window.SectorLeaders && window.SectorLeaders.getDashboard ? window.SectorLeaders.getDashboard() : null;
  const sectorCount = ((sectorDashboard && sectorDashboard.sectors) || []).length;
  if (cards) {
    cards.innerHTML = [
      ['Positions', summary.positionCount || positions.length, ''],
      ['Watchlist', watchlistCount, ''],
      ['Recent', recentCount, ''],
      ['Sectors', sectorCount, ''],
      ['Total P/L', fmt(summary.totalPnl), pnlClass(summary.totalPnl)]
    ].map(function(item) {
      return '<div class="summary-card"><div class="summary-label">' + item[0] + '</div><div class="summary-value ' + item[2] + '">' + item[1] + '</div></div>';
    }).join('');
  }
  if (!table) return;
  if (!positions.length) {
    table.innerHTML = '<div class="empty-state compact">No positions yet. Add trades to populate exposure statistics.</div>';
    return;
  }
  const sorted = positions.slice().sort(function(a, b) {
    return (Number(b.marketValue === null ? b.costValue : b.marketValue) || 0) -
      (Number(a.marketValue === null ? a.costValue : a.marketValue) || 0);
  }).slice(0, 8);
  table.innerHTML = '<h3>Top exposures</h3><table class="mini-table"><thead><tr><th>Code</th><th>Name</th><th>Value</th><th>P/L</th><th>Return</th></tr></thead><tbody>' +
    sorted.map(function(pos) {
      const value = pos.marketValue === null ? pos.costValue : pos.marketValue;
      return '<tr><td>' + pos.code + '</td><td>' + pos.name + '</td><td>' + fmt(value) + '</td><td class="' + pnlClass(finalPnlValue(pos)) + '">' + fmt(finalPnlValue(pos)) + '</td><td class="' + pnlClass(finalPnlRateValue(pos)) + '">' + fmt(finalPnlRateValue(pos)) + '%</td></tr>';
    }).join('') +
    '</tbody></table>';
}

function positionFor(code) {
  return (window.State.positions || []).find(item => item.code === code);
}

function stockLookup(code) {
  const State = window.State;
  return (State.allStocks || []).find(item => item.code === code) ||
    (State.watchlist || []).find(item => item.code === code) ||
    (State.recentStocks || []).find(item => item.code === code) ||
    (State.positions || []).find(item => item.code === code) ||
    { code, name: code };
}

async function runPositionAction(action, code) {
  if (action === 'view') selectPositionStock(code);
  else if (action === 'buy') openBuyTradeByCode(code);
  else if (action === 'sell') openSellTradeByCode(code);
  else if (action === 'analysis') await runHoldingAnalysis(code);
  else if (action === 'trades') viewTrades(code);
}

async function handlePositionClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const code = btn.getAttribute('data-code');
  try {
    await runPositionAction(action, code);
  } catch (error) {
    alert(error.message || '持仓操作失败');
  }
}

function positionRowCode(event) {
  const row = event.target.closest('tr[data-code]');
  return row ? row.getAttribute('data-code') : '';
}

function handlePositionDoubleClick(event) {
  const code = positionRowCode(event);
  if (code) selectPositionStock(code);
}

function hidePositionContextMenu() {
  const menu = document.getElementById('stockContextMenu');
  if (menu && menu.getAttribute('data-owner') === 'portfolio') {
    menu.style.display = 'none';
    menu.removeAttribute('data-owner');
  }
}

function showPositionContextMenu(event, code) {
  const menu = document.getElementById('stockContextMenu');
  if (!menu || !code) return;
  event.preventDefault();
  menu.setAttribute('data-owner', 'portfolio');
  menu.innerHTML =
    '<button data-action="view" data-code="' + code + '">查看行情</button>' +
    '<button data-action="buy" data-code="' + code + '">买入</button>' +
    '<button data-action="sell" data-code="' + code + '">卖出</button>' +
    '<button data-action="analysis" data-code="' + code + '">AI持仓分析</button>' +
    '<button data-action="trades" data-code="' + code + '">交易记录</button>';
  const left = Math.min(event.clientX, window.innerWidth - 190);
  const top = Math.min(event.clientY, window.innerHeight - 220);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.display = 'block';
  setTimeout(function() {
    document.addEventListener('click', hidePositionContextMenu, { once: true });
  }, 0);
  menu.onclick = async function(clickEvent) {
    const btn = clickEvent.target.closest('[data-action]');
    if (!btn) return;
    hidePositionContextMenu();
    try {
      await runPositionAction(btn.getAttribute('data-action'), btn.getAttribute('data-code'));
    } catch (error) {
      alert(error.message || '持仓操作失败');
    }
  };
}

function handlePositionContextMenu(event) {
  const code = positionRowCode(event);
  if (code) showPositionContextMenu(event, code);
}

function handlePositionKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const code = positionRowCode(event);
  if (!code) return;
  event.preventDefault();
  selectPositionStock(code);
}

function openBuyTrade(stock) {
  window.Trades.openTradeModal('new', null, Object.assign({}, stock || {}, {
    side: 'buy',
    tradeDate: todayStr(),
    name: stock && (stock.name || stock.code),
    price: stock ? (stock.price || stock.currentPrice || stock.lastPrice || stock.observePrice || '') : '',
    currentPrice: stock ? (stock.price || stock.currentPrice || stock.lastPrice || stock.observePrice || '') : ''
  }));
}

function openSellTrade(position) {
  window.Trades.openTradeModal('new', null, {
    code: position.code,
    name: position.name,
    side: 'sell',
    price: position.currentPrice || position.avgCost,
    quantity: position.quantity
  });
}

function openBuyTradeByCode(code) {
  const position = positionFor(code) || stockLookup(code);
  openBuyTrade(position);
}

function openSellTradeByCode(code) {
  const position = positionFor(code);
  if (position) {
    openSellTrade(position);
    return;
  }
  alert('No position found for ' + code);
}

async function refreshPortfolio() {
  await loadPortfolio();
}

function selectPositionStock(code) {
  const stock = stockLookup(code);
  if (stock && window.StockList) {
    window.switchMainView('market');
    window.StockList.selectStock(stock).catch(function(error) {
      alert(error.message || 'Load stock failed');
    });
  }
}

function viewTrades(code) {
  window.switchMainView('trades');
  const input = document.getElementById('tradeCodeFilter');
  if (input) input.value = code;
  window.Trades.loadTrades();
}

async function runAIAnalysis() {
  try {
    const data = await portfolioApi('/ai-analysis', { method: 'POST' });
    const overlay = document.getElementById('analysisOverlay');
    const body = document.getElementById('analysisPanelBody');
    const badge = document.getElementById('aiStatusBadge');
    overlay.style.display = 'flex';
    body.innerHTML = '<div class="md-body">' + window.Analysis.simpleMarkdown(data.report) + '</div>';
    if (window.AIAssistant && window.AIAssistant.saveHistoryRecord) {
      window.AIAssistant.saveHistoryRecord({
        title: '组合诊断 AI 分析',
        summary: 'AI API 直接返回的持仓组合诊断。',
        prompt: '组合数据：' + JSON.stringify(window.State.positions || [], null, 2),
        result: data.report,
        kind: 'portfolio',
        context: { view: 'portfolio' }
      });
    }
    if (badge) badge.textContent = 'AI 组合诊断';
  } catch (error) {
    if (window.AIAssistant) {
      const promptText = [
        '请对我的投资组合做风险诊断。要求：不承诺收益，不给真实下单指令，仅输出持仓结构、风险、观察点和免责声明。',
        '持仓数据：' + JSON.stringify(window.State.positions || [], null, 2),
        '',
        '请在回答最后输出一个可直接复制回 WebStock 的结果块。不要把边界标记放进代码块；边界标记必须单独占一行。',
        'WEBSTOCK_RESULT_START',
        '# 组合诊断结果',
        '- 组合结论：仓位、集中度、收益来源和主要问题。',
        '- 持仓拆解：每个重点持仓的风险、观察点和处理优先级。',
        '- 结构建议：只给研究型仓位结构建议，不给下单指令。',
        '- 下一步验证：需要跟踪的价格、量能、板块和交易记录。',
        '- 免责声明：仅供研究复盘，不构成投资建议。',
        'WEBSTOCK_RESULT_END'
      ].join('\n');
      window.AIAssistant.open({
        title: '组合分析 ChatGPT 交接',
        summary: 'AI API 不可用，已生成组合分析提示方向。请复制到 ChatGPT。',
        prompt: promptText,
        kind: 'portfolio',
        context: { view: 'portfolio' }
      });
    } else {
      alert(error.message);
    }
  }
}

async function runHoldingAnalysis(code) {
  const stock = stockLookup(code);
  if (!stock || !window.Analysis || !window.StockList) {
    alert('Analysis is not available for ' + code);
    return;
  }
  window.switchMainView('market');
  await window.StockList.selectStock(stock);
  window.Analysis.openAnalysisPanel(stock);
}

window.Portfolio = {
  loadPortfolio,
  loadSummary,
  loadPositions,
  renderSummary,
  renderPositions,
  loadClosedPositions,
  renderClosedPositions,
  exportPositionsCsv,
  exportClosedPositionsCsv,
  renderStatsOverview,
  visiblePositions,
  openBuyTrade,
  openSellTrade,
  openBuyTradeByCode,
  openSellTradeByCode,
  refreshPortfolio,
  selectPositionStock,
  viewTrades,
  runAIAnalysis,
  runHoldingAnalysis
};
