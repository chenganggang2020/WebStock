function watchlistApi(path, options) {
  return window.apiFetch('/api/portfolio' + path, options);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function watchlistAlertStatus(item) {
  const price = Number(item.price);
  const high = Number(item.alertHigh);
  const low = Number(item.alertLow);
  if (!Number.isFinite(price)) return { className: 'status-ok', label: 'Alert pending' };
  if (Number.isFinite(low) && low > 0 && price <= low) return { className: 'status-danger', label: 'Alert low' };
  if (Number.isFinite(high) && high > 0 && price >= high) return { className: 'status-warn', label: 'Alert high' };
  if ((Number.isFinite(low) && low > 0) || (Number.isFinite(high) && high > 0)) {
    return { className: 'status-ok', label: 'Alert normal' };
  }
  return { className: 'muted', label: 'No alert' };
}

function watchlistCsvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function visibleWatchlistItems() {
  let items = (window.State.watchlist || []).slice();
  const keyword = document.getElementById('watchlistSearchInput') ? document.getElementById('watchlistSearchInput').value.trim() : '';
  if (keyword) {
    const normalized = keyword.toLowerCase();
    items = items.filter(function(item) {
      const alertStatus = watchlistAlertStatus(item);
      return [
        item.code,
        item.name,
        item.groupName,
        item.note,
        item.alertHigh,
        item.alertLow,
        alertStatus.label,
        item.quoteStatus
      ].filter(value => value !== undefined && value !== null).join(' ').toLowerCase().includes(normalized);
    });
  }
  const sort = document.getElementById('watchlistSortSelect') ? document.getElementById('watchlistSortSelect').value : '';
  if (sort === 'change_desc') items.sort((a, b) => (Number(b.change) || -999) - (Number(a.change) || -999));
  if (sort === 'change_asc') items.sort((a, b) => (Number(a.change) || 999) - (Number(b.change) || 999));
  return items;
}

async function loadWatchlist() {
  const State = window.State;
  const group = document.getElementById('watchlistGroupFilter') ? document.getElementById('watchlistGroupFilter').value : '';
  State.watchlist = await watchlistApi('/watchlist' + (group ? '?group=' + encodeURIComponent(group) : ''));
  renderWatchlist();
  if (State.watchlist.length) await refreshWatchlistQuotes();
  if (window.StockList) window.StockList.renderStockTable(State.filteredStocks);
  if (window.Dashboard) window.Dashboard.refreshCards();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  return State.watchlist;
}

async function addCurrentStock() {
  const State = window.State;
  if (!State.currentStock) { alert('请先选择一只股票'); return; }
  await addStock(State.currentStock);
}

async function addStock(stock) {
  try {
    await watchlistApi('/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: stock.code,
        name: stock.name || stock.code,
        groupName: '默认分组'
      })
    });
    await loadWatchlist();
  } catch (error) {
    if (!String(error.message).includes('已')) alert(error.message);
  }
}

async function removeByCode(code) {
  await watchlistApi('/watchlist/code/' + encodeURIComponent(code), { method: 'DELETE' });
  await loadWatchlist();
}

async function removeById(id) {
  if (!confirm('确定删除这只自选股吗？')) return;
  await watchlistApi('/watchlist/' + id, { method: 'DELETE' });
  await loadWatchlist();
}

async function updateWatchlistItem(id, payload) {
  await watchlistApi('/watchlist/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await loadWatchlist();
}

async function editWatchlistItem(id) {
  const State = window.State;
  const item = State.watchlist.find(row => row.id === id);
  if (!item) return;
  const groupName = prompt('分组', item.groupName || '默认分组');
  if (groupName === null) return;
  const note = prompt('备注', item.note || '');
  if (note === null) return;
  const alertHigh = prompt('预警高价（可留空）', item.alertHigh || '');
  if (alertHigh === null) return;
  const alertLow = prompt('预警低价（可留空）', item.alertLow || '');
  if (alertLow === null) return;
  await updateWatchlistItem(id, { groupName, note, alertHigh, alertLow });
}

async function bulkSetVisibleGroup() {
  const items = visibleWatchlistItems();
  if (!items.length) {
    alert('当前没有可批量分组的自选股');
    return;
  }
  const groupName = prompt('将当前可见自选股移动到分组', items[0].groupName || '默认分组');
  if (groupName === null) return;
  const cleanGroup = groupName.trim();
  if (!cleanGroup) {
    alert('分组名称不能为空');
    return;
  }
  await Promise.all(items.map(item => watchlistApi('/watchlist/' + item.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupName: cleanGroup })
  })));
  await loadWatchlist();
}

function renderWatchlist() {
  const State = window.State;
  const tbody = document.getElementById('watchlistTbody');
  const empty = document.getElementById('watchlistEmpty');
  const table = document.getElementById('watchlistTable');
  const groupFilter = document.getElementById('watchlistGroupFilter');
  if (!tbody) return;

  const groups = Array.from(new Set(State.watchlist.map(item => item.groupName || '默认分组')));
  if (groupFilter) {
    const current = groupFilter.value;
    groupFilter.innerHTML = '<option value="">全部分组</option>' + groups.map(group => '<option value="' + group + '">' + group + '</option>').join('');
    groupFilter.value = current;
  }

  const items = visibleWatchlistItems();
  empty.style.display = items.length ? 'none' : '';
  table.style.display = items.length ? 'table' : 'none';
  tbody.innerHTML = items.map(item => {
    const change = Number(item.change);
    const colorClass = Number.isFinite(change) && change >= 0 ? 'pnl-up' : 'pnl-down';
    const alertStatus = watchlistAlertStatus(item);
    const quoteStatus = item.quoteStatus === 'stale'
      ? '<span class="status-warn">行情保留</span>'
      : '<span class="status-ok">正常</span>';
    return '<tr>' +
      '<td><button class="link-btn" data-action="view" data-code="' + item.code + '">' + item.code + '</button></td>' +
      '<td>' + item.name + '</td>' +
      '<td>' + money(item.price) + '</td>' +
      '<td class="' + colorClass + '">' + (Number.isFinite(change) ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '--') + '</td>' +
      '<td>' + (item.groupName || '默认分组') + '</td>' +
      '<td>' + (item.alertLow || '--') + ' / ' + (item.alertHigh || '--') + '</td>' +
      '<td><div class="status-stack">' + quoteStatus + '<span class="' + alertStatus.className + '">' + alertStatus.label + '</span></div></td>' +
      '<td>' + (item.note || '') + '</td>' +
      '<td><div class="stock-actions">' +
      '<button class="small-btn primary" data-action="view" data-code="' + item.code + '">查看</button>' +
      '<button class="small-btn" data-action="analysis" data-code="' + item.code + '">分析</button>' +
      '<button class="small-btn" data-action="trade" data-code="' + item.code + '">持仓</button>' +
      '<button class="small-btn" data-action="edit" data-id="' + item.id + '">备注</button>' +
      '<button class="small-btn danger" data-action="delete" data-id="' + item.id + '">删除</button>' +
      '</div></td>' +
      '</tr>';
  }).join('');
  tbody.onclick = handleWatchlistClick;
}

async function handleWatchlistClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  event.stopPropagation();
  const action = btn.getAttribute('data-action');
  try {
    if (action === 'view') selectStock(btn.getAttribute('data-code'));
    else if (action === 'analysis') analyzeStock(btn.getAttribute('data-code'));
    else if (action === 'trade') openTradeByCode(btn.getAttribute('data-code'));
    else if (action === 'edit') await editWatchlistItem(Number(btn.getAttribute('data-id')));
    else if (action === 'delete') await removeById(Number(btn.getAttribute('data-id')));
  } catch (error) {
    alert(error.message || '自选操作失败');
  }
}

async function refreshWatchlistQuotes() {
  const State = window.State;
  if (!State.watchlist.length) return;
  try {
    const quotes = await window.ApiClient.fetchJsonData('/api/quote?codes=' + State.watchlist.map(item => item.code).join(','));
    const map = {};
    if (Array.isArray(quotes)) quotes.forEach(q => { map[q.code] = q; });
    State.watchlist = State.watchlist.map(item => Object.assign({}, item, map[item.code] || {}, { quoteStatus: map[item.code] ? 'ok' : 'stale' }));
    renderWatchlist();
    if (window.Dashboard) window.Dashboard.refreshCards();
    if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  } catch (error) {
    console.error(error);
    State.watchlist = State.watchlist.map(item => Object.assign({}, item, { quoteStatus: 'stale' }));
    renderWatchlist();
    if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  }
}

function exportVisibleWatchlistCsv() {
  const rows = [[
    'code',
    'name',
    'price',
    'change',
    'group_name',
    'alert_low',
    'alert_high',
    'alert_status',
    'quote_status',
    'note'
  ]];
  visibleWatchlistItems().forEach(function(item) {
    const alertStatus = watchlistAlertStatus(item);
    rows.push([
      item.code,
      item.name || '',
      item.price == null ? '' : item.price,
      item.change == null ? '' : item.change,
      item.groupName || '',
      item.alertLow == null ? '' : item.alertLow,
      item.alertHigh == null ? '' : item.alertHigh,
      alertStatus.label,
      item.quoteStatus || 'ok',
      item.note || ''
    ]);
  });
  const csv = rows.map(row => row.map(watchlistCsvCell).join(',')).join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'webstock-watchlist-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stockFor(code) {
  return (window.State.allStocks || []).find(item => item.code === code) ||
    (window.State.watchlist || []).find(item => item.code === code) ||
    (window.State.recentStocks || []).find(item => item.code === code) ||
    (window.State.positions || []).find(item => item.code === code) ||
    { code, name: code };
}

function selectStock(code) {
  const stock = stockFor(code);
  if (stock && window.StockList) {
    window.switchMainView('market');
    window.StockList.selectStock(stock).catch(function(error) { alert(error.message || 'Load stock failed'); });
  }
}

function analyzeStock(code) {
  const stock = stockFor(code);
  if (stock && window.StockList && window.Analysis) {
    window.switchMainView('market');
    window.StockList.selectStock(stock).then(function() { window.Analysis.openAnalysisPanel(stock); }).catch(function(error) { alert(error.message || 'Analysis failed'); });
  }
}

function openTradeByCode(code) {
  const stock = stockFor(code);
  if (stock && window.Portfolio) window.Portfolio.openBuyTrade(stock);
  else if (stock && window.Trades) window.Trades.openTradeModal('new', null, Object.assign({ side: 'buy' }, stock));
}

window.Watchlist = {
  loadWatchlist,
  addCurrentStock,
  addStock,
  removeByCode,
  removeById,
  updateWatchlistItem,
  editWatchlistItem,
  renderWatchlist,
  refreshWatchlistQuotes,
  exportVisibleWatchlistCsv,
  bulkSetVisibleGroup,
  selectStock,
  analyzeStock,
  openTradeByCode
};
