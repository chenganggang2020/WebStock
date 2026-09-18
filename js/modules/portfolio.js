function portfolioApi(path, options) {
  return window.apiFetch('/api/portfolio' + path, options);
}

function portfolioEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function activeAccountId() {
  return Number(window.State.activePortfolioAccountId) || 1;
}

function accountQuery(path) {
  return path + (path.includes('?') ? '&' : '?') + 'accountId=' + encodeURIComponent(activeAccountId());
}

function rememberActiveAccount(id) {
  window.State.activePortfolioAccountId = Number(id) || 1;
  try { localStorage.setItem('webstock.activePortfolioAccountId', String(window.State.activePortfolioAccountId)); } catch (error) {}
}

function fmt(value, digits) {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits === undefined ? 2 : digits) : '--';
}

function pnlClass(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 0 ? 'pnl-up' : 'pnl-down';
}

function finalPnlValue(pos) {
  if (pos && pos.symbolTotalPnl !== undefined && pos.symbolTotalPnl !== null) return pos.symbolTotalPnl;
  return pos && pos.unrealizedPnl !== undefined && pos.unrealizedPnl !== null ? pos.unrealizedPnl : pos.netPnl;
}

function finalPnlRateValue(pos) {
  if (pos && pos.symbolTotalPnlRate !== undefined && pos.symbolTotalPnlRate !== null) return pos.symbolTotalPnlRate;
  return pos && pos.unrealizedPnlRate !== undefined && pos.unrealizedPnlRate !== null ? pos.unrealizedPnlRate : pos.netPnlRate;
}

function todayReferencePnlValue(pos) {
  return pos && pos.todayReferencePnl !== undefined && pos.todayReferencePnl !== null ? pos.todayReferencePnl : pos.todayPnl;
}

let editingPortfolioAccountId = null;

let positionMiniChartGeneration = 0;
const positionMiniChartRequests = new Map();

function positionMiniChartPlaceholder(label, color) {
  const safeColor = portfolioEscape(color || '#94a3b8');
  return '<svg class="stock-mini-chart position-mini-chart-placeholder" viewBox="0 0 168 52" aria-label="' + portfolioEscape(label) + '">' +
    '<line x1="6" y1="26" x2="162" y2="26" stroke="' + safeColor + '" stroke-width="1" stroke-dasharray="3 4"/>' +
    '<text x="84" y="30" text-anchor="middle" fill="' + safeColor + '" font-size="9">' + portfolioEscape(label) + '</text>' +
    '</svg>';
}

function fetchPositionMinuteSeries(code) {
  const cached = window.State.minuteSeriesByCode && window.State.minuteSeriesByCode[code];
  if (Array.isArray(cached) && cached.length >= 2) return Promise.resolve(cached);
  if (positionMiniChartRequests.has(code)) return positionMiniChartRequests.get(code);
  const request = window.ApiClient.fetchJsonData('/api/minute?code=' + encodeURIComponent(code))
    .then(function(series) {
      if (!Array.isArray(series) || series.length < 2) return [];
      window.State.minuteSeriesByCode[code] = series.slice();
      return series;
    })
    .catch(function(error) {
      console.warn('分时缩略图加载失败 ' + code + ':', error.message || error);
      return [];
    })
    .finally(function() { positionMiniChartRequests.delete(code); });
  positionMiniChartRequests.set(code, request);
  return request;
}

async function loadPositionMiniCharts(positions) {
  const generation = ++positionMiniChartGeneration;
  const accountId = activeAccountId();
  const queue = (positions || []).slice();
  async function worker() {
    while (queue.length) {
      const pos = queue.shift();
      const series = await fetchPositionMinuteSeries(pos.code);
      if (generation !== positionMiniChartGeneration || accountId !== activeAccountId()) return;
      const holder = document.querySelector('#positionsTbody [data-mini-chart-code="' + pos.code + '"]');
      if (!holder) continue;
      const trendColor = window.MarketVisualModel
        ? window.MarketVisualModel.trendColor(pos.todayChange, document.body.classList.contains('dark'))
        : Number(pos.todayChange) > 0 ? '#ff2d2d' : Number(pos.todayChange) < 0 ? '#00b050' : '#64748b';
      if (!series.length || !window.StockList || !window.StockList.miniChart) {
        holder.innerHTML = positionMiniChartPlaceholder('暂无分时', trendColor);
        continue;
      }
      holder.innerHTML = window.StockList.miniChart(
        Object.assign({}, pos, { price: pos.currentPrice, change: pos.todayChange, minuteSeries: series }),
        trendColor
      );
    }
  }
  const workerCount = Math.min(4, queue.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
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

function renderPortfolioValuationStatus() {
  const meta = document.getElementById('portfolioAccountMeta');
  if (!meta) return;
  const account = (window.State.portfolioAccounts || []).find(item => Number(item.id) === activeAccountId());
  const snapshot = account && account.latestSnapshot;
  const summary = window.State.portfolioSummary || {};
  const coverage = summary.quoteCoverage || {};
  const quoteCount = '报价覆盖 ' + Number(coverage.priced || 0) + '/' + Number(coverage.total || 0);
  let quality = '';
  if (summary.valuationStatus === 'unavailable') quality = '行情不可用 · ' + quoteCount + '，整仓估值暂缺';
  else if (summary.valuationStatus === 'partial') quality = '行情不完整 · ' + quoteCount + '，整仓估值暂缺';
  else if (summary.valuationStatus === 'stale') quality = '非实时估值 · 最早报价 ' + [summary.quoteDate, summary.quoteTime].filter(Boolean).join(' ') + ' · ' + quoteCount;
  else if (summary.valuationStatus === 'live') quality = quoteCount + ' · ' + [summary.quoteDate, summary.quoteTime].filter(Boolean).join(' ');
  else if (summary.valuationStatus === 'empty') quality = '当前空仓 · 无需持仓行情';
  meta.textContent = [account && account.broker, account && account.maskedNumber,
    account && '可用资金 ' + fmt(account.cashBalance),
    snapshot && snapshot.sourceLabel + ' · ' + snapshot.snapshotDate, quality].filter(Boolean).join(' · ');
}

function renderValuationCharts() {
  if (!window.PortfolioCharts) return;
  window.PortfolioCharts.renderAllocationChart(window.State.portfolioAllocation || []);
  window.PortfolioCharts.renderPnlRankChart(window.State.positions || []);
}

function renderAccountControls() {
  const accounts = window.State.portfolioAccounts || [];
  const activeId = activeAccountId();
  const options = accounts.map(function(account) {
    const suffix = account.maskedNumber && !String(account.name || '').includes(account.maskedNumber) ? ' ' + account.maskedNumber : '';
    const detail = account.name && account.broker && !account.name.includes(account.broker) ? ' · ' + account.broker + suffix : suffix;
    return '<option value="' + account.id + '">' + portfolioEscape(account.name || account.broker || '账户') + portfolioEscape(detail) + '</option>';
  }).join('');
  ['portfolioAccountSelect', 'tradeAccountSelect'].forEach(function(id) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = options;
    select.value = String(activeId);
  });
  renderPortfolioValuationStatus();
  const compare = document.getElementById('portfolioAccountCompare');
  if (compare) {
    compare.innerHTML = accounts.map(function(item) {
      const summary = item.summary || {};
      return '<button type="button" class="portfolio-account-card' + (Number(item.id) === activeId ? ' active' : '') +
        '" data-account-id="' + item.id + '"><strong>' + portfolioEscape(item.name) + '</strong>' +
        '<span>总资产 ' + fmt(summary.totalAssets) + ' · 市值 ' + fmt(summary.totalMarketValue) + '</span>' +
        '<small>' + Number(summary.positionCount || 0) + ' 只持仓</small>' +
        '<em class="' + pnlClass(summary.totalPnl) + '">' + fmt(summary.totalPnl) + '</em></button>';
    }).join('');
  }
}

async function loadAccounts() {
  const accounts = await portfolioApi('/accounts');
  const previous = new Map((window.State.portfolioAccounts || []).map(account => [Number(account.id), account]));
  window.State.portfolioAccounts = (accounts || []).map(account => Object.assign({}, previous.get(Number(account.id)) || {}, account));
  let preferred = activeAccountId();
  try { preferred = Number(localStorage.getItem('webstock.activePortfolioAccountId')) || preferred; } catch (error) {}
  if (!window.State.portfolioAccounts.some(account => Number(account.id) === preferred)) {
    const fallback = window.State.portfolioAccounts.find(account => account.isDefault) || window.State.portfolioAccounts[0];
    preferred = fallback ? fallback.id : 1;
  }
  rememberActiveAccount(preferred);
  renderAccountControls();
  return window.State.portfolioAccounts;
}

async function refreshAccountOverviews() {
  const accounts = await portfolioApi('/accounts/overview');
  window.State.portfolioAccounts = accounts || [];
  renderAccountControls();
  return window.State.portfolioAccounts;
}

async function switchAccount(id) {
  if (Number(id) === activeAccountId()) return;
  rememberActiveAccount(id);
  renderAccountControls();
  await loadPortfolio();
  if (window.Trades) await window.Trades.loadTrades();
}

function openAccountModal(accountId) {
  const account = (window.State.portfolioAccounts || []).find(item => Number(item.id) === Number(accountId));
  editingPortfolioAccountId = account ? Number(account.id) : null;
  document.getElementById('portfolioAccountModalTitle').textContent = account ? '编辑持仓账户' : '新增持仓账户';
  document.getElementById('portfolioAccountNameInput').value = account ? account.name || '' : '';
  document.getElementById('portfolioAccountBrokerInput').value = account ? account.broker || '' : '';
  document.getElementById('portfolioAccountMaskedInput').value = account ? account.maskedNumber || '' : '';
  document.getElementById('portfolioAccountCashInput').value = account ? String(account.cashBalance || 0) : '0';
  document.getElementById('portfolioAccountNoteInput').value = account ? account.note || '' : '';
  document.getElementById('portfolioAccountModalOk').textContent = account ? '保存修改' : '创建账户';
  const deleteButton = document.getElementById('portfolioAccountDelete');
  if (deleteButton) {
    deleteButton.hidden = !account || (window.State.portfolioAccounts || []).length <= 1;
    deleteButton.disabled = false;
  }
  document.getElementById('portfolioAccountModalOverlay').style.display = 'flex';
  setTimeout(function() { document.getElementById('portfolioAccountNameInput').focus(); }, 0);
}

function closeAccountModal() {
  document.getElementById('portfolioAccountModalOverlay').style.display = 'none';
}

async function createAccountFromModal() {
  const button = document.getElementById('portfolioAccountModalOk');
  const payload = {
    name: document.getElementById('portfolioAccountNameInput').value.trim(),
    broker: document.getElementById('portfolioAccountBrokerInput').value.trim(),
    maskedNumber: document.getElementById('portfolioAccountMaskedInput').value.trim(),
    cashBalance: Number(document.getElementById('portfolioAccountCashInput').value || 0),
    note: document.getElementById('portfolioAccountNoteInput').value.trim()
  };
  if (!payload.name) return alert('账户名称不能为空');
  try {
    button.disabled = true;
    const account = await portfolioApi(editingPortfolioAccountId ? '/accounts/' + editingPortfolioAccountId : '/accounts', {
      method: editingPortfolioAccountId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    window.State.portfolioAccounts = [];
    rememberActiveAccount(account.id);
    closeAccountModal();
    await loadPortfolio();
    if (window.Trades) await window.Trades.loadTrades();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

function editActiveAccount() {
  openAccountModal(activeAccountId());
}

async function deleteAccountFromModal() {
  const account = (window.State.portfolioAccounts || []).find(item => Number(item.id) === Number(editingPortfolioAccountId));
  if (!account) return;
  if (!confirm('删除“' + account.name + '”及其持仓、交易和快照记录？此操作无法撤销。')) return;
  const button = document.getElementById('portfolioAccountDelete');
  try {
    button.disabled = true;
    await portfolioApi('/accounts/' + account.id, { method: 'DELETE' });
    closeAccountModal();
    window.State.portfolioAccounts = [];
    rememberActiveAccount(1);
    await loadPortfolio();
    if (window.Trades) await window.Trades.loadTrades();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

async function loadPortfolio() {
  if (!(window.State.portfolioAccounts || []).length) await loadAccounts();
  const result = await portfolioApi('/recalculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: activeAccountId() })
  });
  window.State.positions = result.positions || [];
  window.State.portfolioSummary = result.summary || {};
  window.State.portfolioAllocation = result.allocation || [];
  const accountIndex = window.State.portfolioAccounts.findIndex(account => Number(account.id) === activeAccountId());
  if (accountIndex >= 0) {
    window.State.portfolioAccounts[accountIndex] = Object.assign({}, window.State.portfolioAccounts[accountIndex], result.account || {}, {
      summary: result.summary || {},
      latestSnapshot: result.latestSnapshot || window.State.portfolioAccounts[accountIndex].latestSnapshot
    });
  }
  renderAccountControls();
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
  refreshAccountOverviews().catch(function(error) { console.warn(error.message || error); });
}

async function loadSummary() {
  window.State.portfolioSummary = await portfolioApi(accountQuery('/summary'));
  renderSummary();
  return window.State.portfolioSummary;
}

async function loadPositions() {
  window.State.positions = await portfolioApi(accountQuery('/positions'));
  renderPositions();
  return window.State.positions;
}

async function loadClosedPositions() {
  window.State.closedPositions = await portfolioApi(accountQuery('/closed-positions'));
  renderClosedPositions();
  return window.State.closedPositions;
}

function renderSummary() {
  const summary = window.State.portfolioSummary || {};
  document.getElementById('summaryTotalAssets').textContent = fmt(summary.totalAssets);
  document.getElementById('summaryCashBalance').textContent = fmt(summary.cashBalance);
  document.getElementById('summaryMarketValue').textContent = fmt(summary.totalMarketValue);
  document.getElementById('summaryCost').textContent = fmt(summary.totalCost);
  const unrealized = document.getElementById('summaryUnrealizedPnl');
  unrealized.textContent = fmt(summary.unrealizedPnl);
  unrealized.title = '当前剩余持仓浮动收益：市值 - 剩余持仓成本。买入手续费已计入成本，不叠加已实现盈亏。';
  unrealized.className = 'summary-value ' + pnlClass(summary.unrealizedPnl);
  const todayReference = document.getElementById('summaryTodayReferencePnl');
  if (todayReference) {
    const todayPnl = summary.todayPnl !== undefined ? summary.todayPnl : summary.todayReferencePnl;
    todayReference.textContent = fmt(todayPnl);
    todayReference.title = '当日盈亏：日末市值 + 当天卖出/分红收入 - 当天买入/费用支出 - 日初市值。每条交易记录的手续费和印花税只扣一次。';
    todayReference.className = 'summary-value ' + pnlClass(todayPnl);
  }
  const pnlDate = summary.todayPnlDate || summary.quoteDate || '';
  const datedClose = summary.todayPnlStatus === 'latest-close';
  const pnlLabel = document.getElementById('summaryTodayPnlLabel');
  const pnlHeader = document.getElementById('positionTodayPnlHeader');
  const labelText = datedClose ? '最近交易日盈亏' + (pnlDate ? '（' + pnlDate + '）' : '') : '当日盈亏';
  if (pnlLabel) pnlLabel.textContent = labelText;
  if (pnlHeader) pnlHeader.textContent = labelText;
  const realized = document.getElementById('summaryRealizedPnl');
  realized.textContent = fmt(summary.realizedPnl);
  realized.title = '已实现盈亏：历史卖出、分红和独立费用记录产生的已结算盈亏。';
  realized.className = 'summary-value ' + pnlClass(summary.realizedPnl);
  const total = document.getElementById('summaryTotalPnl');
  if (total) {
    total.textContent = fmt(summary.totalPnl);
    total.title = '累计盈亏：已实现盈亏 + 当前持仓浮动盈亏。';
    total.className = 'summary-value ' + pnlClass(summary.totalPnl);
  }
  const rate = document.getElementById('summaryPnlRate');
  rate.textContent = fmt(summary.totalPnlRate) + (summary.totalPnlRate == null ? '' : '%');
  rate.title = '累计收益率：累计盈亏 ÷ 历史买入总投入。';
  rate.className = 'summary-value ' + pnlClass(summary.totalPnlRate);
  renderPortfolioValuationStatus();
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
    const bValue = Number(b.marketValue) || 0;
    const aValue = Number(a.marketValue) || 0;
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
    const todayReferencePnl = todayReferencePnlValue(pos);
    const floatingPnl = pos.unrealizedPnl;
    const realizedPnl = pos.realizedPnl;
    const minuteSeries = window.State.minuteSeriesByCode && window.State.minuteSeriesByCode[pos.code];
    const trendColor = window.MarketVisualModel
      ? window.MarketVisualModel.trendColor(pos.todayChange, document.body.classList.contains('dark'))
      : Number(pos.todayChange) > 0 ? '#ff2d2d' : Number(pos.todayChange) < 0 ? '#00b050' : '#64748b';
    const miniChart = Array.isArray(minuteSeries) && minuteSeries.length >= 2 && window.StockList && window.StockList.miniChart
      ? window.StockList.miniChart(Object.assign({}, pos, { price: pos.currentPrice, change: pos.todayChange, minuteSeries: minuteSeries }), trendColor)
      : positionMiniChartPlaceholder('加载分时...', trendColor);
    return '<tr data-code="' + pos.code + '" tabindex="0" title="双击查看行情，右键打开持仓操作">' +
      '<td><span class="position-code">' + pos.code + '</span></td>' +
      '<td><div class="holding-name-cell"><span>' + pos.name + '</span><span class="position-mini-chart" data-mini-chart-code="' + pos.code + '">' + miniChart + '</span></div></td>' +
      '<td>' + pos.quantity + '</td>' +
      '<td>' + fmt(pos.avgCost, 3) + '</td>' +
      '<td>' + fmt(pos.currentPrice, 3) + '</td>' +
      '<td>' + (window.EastmoneyDarkStocks ? window.EastmoneyDarkStocks.cell(pos) : '--') + '</td>' +
      '<td>' + fmt(pos.marketValue) + '</td>' +
      '<td class="' + pnlClass(floatingPnl) + '" title="浮动盈亏：当前市值 - 剩余持仓成本；买入手续费已计入剩余成本">' + fmt(floatingPnl) + '</td>' +
      '<td class="' + pnlClass(realizedPnl) + '" title="该股票历史卖出、分红和费用形成的已实现盈亏">' + fmt(realizedPnl) + '</td>' +
      '<td class="' + pnlClass(finalPnl) + '" title="累计盈亏：浮动盈亏 + 已实现盈亏">' + fmt(finalPnl) + '</td>' +
      '<td class="' + pnlClass(finalRate) + '" title="累计盈亏 ÷ 该股票历史买入总投入">' + fmt(finalRate) + '%</td>' +
      '<td class="' + pnlClass(todayReferencePnl) + '" title="按日初市值、日末市值和当天交易现金流计算；交易费税只扣一次">' + fmt(todayReferencePnl) + '</td>' +
      '<td><span class="position-action-hint">双击查看 · 右键操作</span></td>' +
      '</tr>';
  }).join('');
  tbody.onclick = handlePositionClick;
  tbody.ondblclick = handlePositionDoubleClick;
  tbody.oncontextmenu = handlePositionContextMenu;
  tbody.onkeydown = handlePositionKeydown;
  if (window.EastmoneyDarkStocks) window.EastmoneyDarkStocks.sync();
  loadPositionMiniCharts(positions).catch(function(error) { console.warn(error.message || error); });
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
    'floating_pnl',
    'realized_pnl',
    'cumulative_pnl',
    'cumulative_pnl_rate',
    'total_fee',
    'today_pnl'
  ]].concat(rows.map(function(pos) {
    return [
      pos.code,
      pos.name,
      pos.quantity,
      fmt(pos.avgCost, 3),
      fmt(pos.currentPrice, 3),
      fmt(pos.marketValue),
      fmt(pos.costValue),
      fmt(pos.unrealizedPnl),
      fmt(pos.realizedPnl),
      fmt(finalPnlValue(pos)),
      fmt(finalPnlRateValue(pos)),
      fmt(pos.totalFee),
      fmt(todayReferencePnlValue(pos))
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
    return (Number(b.marketValue) || 0) - (Number(a.marketValue) || 0);
  }).slice(0, 8);
  table.innerHTML = '<h3>Top exposures</h3><table class="mini-table"><thead><tr><th>Code</th><th>Name</th><th>Value</th><th>P/L</th><th>Return</th></tr></thead><tbody>' +
    sorted.map(function(pos) {
      const value = pos.marketValue;
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

async function readTonghuashunHoldingClipboard() {
  const message = '请先在同花顺电脑版持仓表中全选并复制。点击“确定”后，WebStock 只读取这一次剪贴板文本，不读取账号、密码，也不执行交易。';
  if (!confirm(message)) return '';
  if (navigator.clipboard && navigator.clipboard.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) return text;
    } catch (error) {
      console.warn('读取同花顺持仓剪贴板失败:', error.message || error);
    }
  }
  return prompt('无法自动读取剪贴板，请把同花顺持仓表粘贴到这里：') || '';
}

async function syncTonghuashunHoldings(options) {
  options = options || {};
  const button = document.getElementById('syncTonghuashunHoldingsBtn');
  const priorLabel = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = '正在检查持仓…';
  }
  try {
    const status = await portfolioApi('/tonghuashun-holdings/status');
    let preview;
    let endpoint;
    let text = '';
    if (status.available) {
      preview = await portfolioApi('/tonghuashun-holdings/preview-local');
      endpoint = '/tonghuashun-holdings/sync-local';
    } else {
      if (options.localOnly) return null;
      text = await readTonghuashunHoldingClipboard();
      if (!text.trim()) return null;
      preview = await portfolioApi('/tonghuashun-holdings/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      endpoint = '/tonghuashun-holdings/sync-text';
    }

    const sample = (preview.holdings || []).slice(0, 5).map(function(item) {
      return item.name + ' ' + item.quantity + '股';
    }).join('、');
    const targetAccount = (window.State.portfolioAccounts || []).find(function(account) {
      return Number(account.id) === activeAccountId();
    });
    if (!options.automatic && !confirm(
      '已识别 ' + preview.holdingCount + ' 只持仓：' + sample +
      (preview.holdingCount > 5 ? ' 等' : '') +
      '\n\n将用这份完整快照更新当前账户“' + (targetAccount && targetAccount.name || '当前账户') + '”，不会执行交易。是否继续？'
    )) return null;

    const body = options.automatic ? {} : { accountId: activeAccountId() };
    if (text) body.text = text;
    if (!options.automatic && (preview.cashBalance === null || preview.cashBalance === undefined)) {
      const cash = prompt('请输入同花顺账户可用资金（可留空，沿用上次值）：', '');
      if (cash !== null && cash.trim() !== '') {
        const value = Number(cash.replace(/[,，]/g, ''));
        if (!Number.isFinite(value) || value < 0) throw new Error('可用资金格式不正确');
        body.cashBalance = value;
      }
    }
    const result = await portfolioApi(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!options.automatic) {
      window.State.portfolioAccounts = [];
      rememberActiveAccount(result.account.id);
      await loadPortfolio();
      alert('已更新“' + result.account.name + '”的 ' + result.importedCount + ' 只持仓。');
    }
    return result;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = priorLabel || '更新当前账户持仓';
    }
  }
}

const holdingSnapshotChecks = new Map();
const holdingSnapshotVersions = new Map();

async function refreshHoldingSnapshot() {
  const accountId = activeAccountId();
  const now = Date.now();
  if (now - (holdingSnapshotChecks.get(accountId) || 0) < 15000) return { ok: true, changed: false };
  holdingSnapshotChecks.set(accountId, now);
  try {
    const result = await portfolioApi('/holding-snapshot?accountId=' + accountId);
    if (accountId !== activeAccountId()) return { ok: true, changed: false };
    if (holdingSnapshotVersions.get(accountId) === result.version) return { ok: true, changed: false };
    holdingSnapshotVersions.set(accountId, result.version);
    const valued = await portfolioApi('/recalculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId })
    });
    if (accountId !== activeAccountId()) return { ok: true, changed: false };
    window.State.positions = valued.positions || [];
    window.State.portfolioSummary = valued.summary || {};
    window.State.portfolioAllocation = valued.allocation || [];
    const accounts = window.State.portfolioAccounts || [];
    const index = accounts.findIndex(account => Number(account.id) === accountId);
    const account = Object.assign({}, valued.account || result.account, {
      summary: valued.summary || {}, latestSnapshot: valued.latestSnapshot || result.latestSnapshot
    });
    if (index >= 0) accounts[index] = account;
    else accounts.push(account);
    window.State.portfolioAccounts = accounts;
    renderSummary();
    renderPositions();
    renderAccountControls();
    renderStatsOverview();
    renderValuationCharts();
    if (window.Dashboard) window.Dashboard.refreshCards();
    return { ok: true, changed: true };
  } catch (error) {
    console.warn('持仓快照读取失败，保留已有持仓：', error.message || error);
    return { ok: false, changed: false };
  }
}

async function refreshLivePortfolio() {
  try {
    const priorValuationStatus = (window.State.portfolioSummary || {}).valuationStatus;
    const result = await portfolioApi('/recalculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: activeAccountId() })
    });
    window.State.positions = result.positions || [];
    window.State.portfolioSummary = result.summary || {};
    window.State.portfolioAllocation = result.allocation || [];
    renderSummary();
    renderPositions();
    renderStatsOverview();
    if (priorValuationStatus !== window.State.portfolioSummary.valuationStatus) renderValuationCharts();
    if (window.Dashboard) window.Dashboard.refreshCards();
    if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
    return {
      ok: true,
      observedAt: result.marketData && result.marketData.observedAt || null,
      source: result.marketData && result.marketData.source || 'sina-quote'
    };
  } catch (error) {
    console.warn(error.message || error);
    return { ok: false, error };
  }
}

function applyQuoteSnapshot(quotes, meta) {
  const State = window.State;
  const model = window.QuoteSnapshotClientModel;
  if (!model || !Array.isArray(State.positions)) return { ok: false, count: 0 };
  const priorValuationStatus = (State.portfolioSummary || {}).valuationStatus;
  State.positions = model.applyPositionQuotes(State.positions, quotes);
  State.portfolioSummary = model.summarizePortfolio(State.portfolioSummary, State.positions);
  State.portfolioAllocation = model.allocation(State.positions);
  const accountIndex = (State.portfolioAccounts || []).findIndex(function(account) {
    return Number(account.id) === activeAccountId();
  });
  if (accountIndex >= 0) {
    State.portfolioAccounts[accountIndex] = Object.assign({}, State.portfolioAccounts[accountIndex], {
      summary: State.portfolioSummary
    });
  }
  renderSummary();
  renderPositions();
  renderAccountControls();
  renderStatsOverview();
  if (priorValuationStatus !== State.portfolioSummary.valuationStatus) renderValuationCharts();
  if (window.Dashboard) window.Dashboard.refreshCards();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  return {
    ok: true,
    count: Array.isArray(quotes) ? quotes.length : 0,
    observedAt: meta && meta.fetchedAt || null,
    stale: !!(meta && meta.stale)
  };
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
    const data = await portfolioApi('/ai-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: activeAccountId() })
    });
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
  activeAccountId,
  loadAccounts,
  refreshAccountOverviews,
  renderAccountControls,
  switchAccount,
  openAccountModal,
  editActiveAccount,
  closeAccountModal,
  createAccountFromModal,
  deleteAccountFromModal,
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
  syncTonghuashunHoldings,
  refreshLivePortfolio,
  refreshHoldingSnapshot,
  applyQuoteSnapshot,
  selectPositionStock,
  viewTrades,
  runAIAnalysis,
  runHoldingAnalysis
};
