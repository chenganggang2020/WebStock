function portfolioApi(path, options) {
  return fetch('/api/portfolio' + path, options).then(function(resp) { return resp.json(); }).then(function(json) {
    if (!json.success) throw new Error(json.error || '请求失败');
    return json.data;
  });
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

async function loadPortfolio() {
  await Promise.all([loadSummary(), loadPositions()]);
  const allocation = await portfolioApi('/allocation');
  window.State.portfolioAllocation = allocation;
  if (window.PortfolioCharts) {
    window.PortfolioCharts.renderAllocationChart(allocation);
    window.PortfolioCharts.renderPnlRankChart(window.State.positions);
    setTimeout(window.PortfolioCharts.resizePortfolioCharts, 30);
  }
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

function renderSummary() {
  const summary = window.State.portfolioSummary || {};
  document.getElementById('summaryMarketValue').textContent = fmt(summary.totalMarketValue);
  document.getElementById('summaryCost').textContent = fmt(summary.totalCost);
  const unrealized = document.getElementById('summaryUnrealizedPnl');
  unrealized.textContent = fmt(summary.unrealizedPnl);
  unrealized.className = 'summary-value ' + pnlClass(summary.unrealizedPnl);
  const realized = document.getElementById('summaryRealizedPnl');
  realized.textContent = fmt(summary.realizedPnl);
  realized.className = 'summary-value ' + pnlClass(summary.realizedPnl);
  const rate = document.getElementById('summaryPnlRate');
  rate.textContent = fmt(summary.totalPnlRate) + '%';
  rate.className = 'summary-value ' + pnlClass(summary.totalPnlRate);
}

function renderPositions() {
  const positions = window.State.positions || [];
  const tbody = document.getElementById('positionsTbody');
  const table = document.getElementById('positionsTable');
  const empty = document.getElementById('portfolioEmpty');
  if (!tbody) return;
  empty.style.display = positions.length ? 'none' : '';
  table.style.display = positions.length ? 'table' : 'none';
  tbody.innerHTML = positions.map(pos => {
    return '<tr>' +
      '<td><button class="link-btn" onclick="Portfolio.selectPositionStock(&quot;' + pos.code + '&quot;)">' + pos.code + '</button></td>' +
      '<td>' + pos.name + '</td>' +
      '<td>' + pos.quantity + '</td>' +
      '<td>' + fmt(pos.avgCost, 3) + '</td>' +
      '<td>' + fmt(pos.currentPrice, 3) + '</td>' +
      '<td>' + fmt(pos.marketValue === null ? pos.costValue : pos.marketValue) + '</td>' +
      '<td class="' + pnlClass(pos.unrealizedPnl) + '">' + fmt(pos.unrealizedPnl) + '</td>' +
      '<td class="' + pnlClass(pos.unrealizedPnlRate) + '">' + fmt(pos.unrealizedPnlRate) + '%</td>' +
      '<td class="' + pnlClass(pos.todayPnl) + '">' + fmt(pos.todayPnl) + '</td>' +
      '<td><button class="small-btn" onclick="Portfolio.openBuyTradeByCode(&quot;' + pos.code + '&quot;)">买入</button><button class="small-btn" onclick="Portfolio.openSellTradeByCode(&quot;' + pos.code + '&quot;)">卖出</button><button class="small-btn" onclick="Portfolio.viewTrades(&quot;' + pos.code + '&quot;)">交易</button></td>' +
      '</tr>';
  }).join('');
}

function openBuyTrade(stock) {
  window.Trades.openTradeModal('new', null, Object.assign({}, stock, { side: 'buy' }));
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
  const position = window.State.positions.find(item => item.code === code);
  openBuyTrade(position || { code });
}

function openSellTradeByCode(code) {
  const position = window.State.positions.find(item => item.code === code);
  if (position) openSellTrade(position);
}

async function refreshPortfolio() {
  await loadPortfolio();
}

function selectPositionStock(code) {
  const stock = window.State.allStocks.find(item => item.code === code) || window.State.positions.find(item => item.code === code);
  if (stock && window.StockList) {
    window.switchMainView('market');
    window.StockList.selectStock(stock);
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
    if (badge) badge.textContent = '🟢 AI 组合诊断';
  } catch (error) {
    alert(error.message);
  }
}

window.Portfolio = {
  loadPortfolio,
  loadSummary,
  loadPositions,
  renderSummary,
  renderPositions,
  openBuyTrade,
  openSellTrade,
  openBuyTradeByCode,
  openSellTradeByCode,
  refreshPortfolio,
  selectPositionStock,
  viewTrades,
  runAIAnalysis
};
