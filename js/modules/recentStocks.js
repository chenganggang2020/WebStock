function recentApi(path, options) {
  return window.apiFetch('/api/recent' + path, options);
}

function recentFmt(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits === undefined ? 2 : digits) : '--';
}

function recentChangeClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 0 ? 'pnl-up' : 'pnl-down';
}

function recentCsvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function recentTime(value) {
  if (!value) return '--';
  return window.WebStockTime && window.WebStockTime.formatDateTime
    ? window.WebStockTime.formatDateTime(value)
    : value;
}

function visibleRecentItems() {
  let items = (window.State.recentStocks || []).slice();
  const keyword = document.getElementById('recentSearchInput') ? document.getElementById('recentSearchInput').value.trim().toLowerCase() : '';
  const sort = document.getElementById('recentSortSelect') ? document.getElementById('recentSortSelect').value : 'last_viewed';
  if (keyword) {
    items = items.filter(function(item) {
      return [item.code, item.name].filter(Boolean).join(' ').toLowerCase().includes(keyword);
    });
  }
  items.sort(function(a, b) {
    if (sort === 'view_count') return (Number(b.viewCount) || 0) - (Number(a.viewCount) || 0);
    if (sort === 'change_desc') return (Number(b.lastChange) || -999) - (Number(a.lastChange) || -999);
    if (sort === 'change_asc') return (Number(a.lastChange) || 999) - (Number(b.lastChange) || 999);
    return String(b.lastViewedAt || '').localeCompare(String(a.lastViewedAt || ''));
  });
  return items;
}

async function load(limit) {
  window.State.recentStocks = await recentApi(limit ? '?limit=' + encodeURIComponent(limit) : '');
  renderRecentStocks();
  renderRecentDashboard();
  return window.State.recentStocks;
}

async function record(stock) {
  if (!stock || !stock.code) return;
  await recentApi('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: stock.code,
      name: stock.name || stock.code,
      lastPrice: stock.price,
      lastChange: stock.change
    })
  });
  await load(20);
}

async function remove(code) {
  await recentApi('/' + encodeURIComponent(code), { method: 'DELETE' });
  await load(20);
}

async function clear() {
  if (!confirm('确定清空最近查看记录吗？')) return;
  await recentApi('', { method: 'DELETE' });
  await load(20);
}

function recentStockFor(code) {
  return (window.State.allStocks || []).find(item => item.code === code) ||
    (window.State.recentStocks || []).find(item => item.code === code) ||
    (window.State.watchlist || []).find(item => item.code === code) ||
    (window.State.positions || []).find(item => item.code === code) ||
    { code, name: code };
}

async function runAction(action, code) {
  const item = recentStockFor(code);
  if (!item) return;
  if (action === 'view') {
    window.switchMainView('market');
    await window.StockList.selectStock(item);
  } else if (action === 'analysis') {
    window.switchMainView('market');
    await window.StockList.selectStock(item);
    window.Analysis.openAnalysisPanel(item);
  } else if (action === 'watchlist') {
    await window.Watchlist.addStock(item);
  } else if (action === 'trade') {
    if (window.Portfolio) window.Portfolio.openBuyTrade(item);
    else window.Trades.openTradeModal('new', null, Object.assign({ side: 'buy' }, item));
  } else if (action === 'delete') {
    await remove(code);
  }
}

function recentRowHtml(item) {
  const change = Number(item.lastChange);
  const changeText = Number.isFinite(change) ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '--';
  return '<tr data-code="' + item.code + '">' +
    '<td><button class="link-btn" data-action="view" data-code="' + item.code + '">' + item.code + '</button></td>' +
    '<td>' + (item.name || item.code) + '</td>' +
    '<td>' + recentFmt(item.lastPrice) + '</td>' +
    '<td class="' + recentChangeClass(item.lastChange) + '">' + changeText + '</td>' +
    '<td>' + (item.viewCount || 1) + '</td>' +
    '<td>' + recentTime(item.lastViewedAt) + '</td>' +
    '<td><div class="stock-actions">' +
    '<button class="small-btn primary" data-action="view" data-code="' + item.code + '">查看</button>' +
    '<button class="small-btn" data-action="analysis" data-code="' + item.code + '">分析</button>' +
    '<button class="small-btn" data-action="watchlist" data-code="' + item.code + '">自选</button>' +
    '<button class="small-btn" data-action="trade" data-code="' + item.code + '">持仓</button>' +
    '<button class="small-btn danger" data-action="delete" data-code="' + item.code + '">删除</button>' +
    '</div></td>' +
    '</tr>';
}

function bindRecentTable(tbody) {
  if (!tbody) return;
  tbody.onclick = async function(event) {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    event.stopPropagation();
    try {
      await runAction(btn.getAttribute('data-action'), btn.getAttribute('data-code'));
    } catch (error) {
      alert(error.message || '最近查看操作失败');
    }
  };
}

function renderRecentStocks() {
  const tbody = document.getElementById('recentStocksTbody');
  const empty = document.getElementById('recentStocksEmpty');
  const table = document.getElementById('recentStocksTable');
  if (!tbody) return;
  const items = visibleRecentItems();
  if (empty) empty.style.display = items.length ? 'none' : '';
  if (table) table.style.display = items.length ? 'table' : 'none';
  tbody.innerHTML = items.map(recentRowHtml).join('');
  bindRecentTable(tbody);
}

function renderRecentDashboard() {
  const box = document.getElementById('dashboardRecentList');
  if (!box) return;
  const items = (window.State.recentStocks || []).slice(0, 6);
  if (!items.length) {
    box.innerHTML = '<div class="empty-state compact">暂无最近查看，点击左侧股票行开始记录。</div>';
    return;
  }
  box.innerHTML = '<table class="mini-table"><tbody>' + items.map(item => {
    return '<tr><td>' + item.code + '</td><td>' + (item.name || '') + '</td><td class="' + recentChangeClass(item.lastChange) + '">' + recentFmt(item.lastChange) + '%</td><td><button class="small-btn" data-action="view" data-code="' + item.code + '">查看</button></td></tr>';
  }).join('') + '</tbody></table>';
  box.onclick = async function(event) {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    await runAction(btn.getAttribute('data-action'), btn.getAttribute('data-code'));
  };
}

function exportRecentCsv() {
  const rows = [[
    'code',
    'name',
    'last_price',
    'last_change',
    'view_count',
    'last_viewed_at'
  ]];
  visibleRecentItems().forEach(function(item) {
    rows.push([
      item.code,
      item.name || '',
      item.lastPrice == null ? '' : item.lastPrice,
      item.lastChange == null ? '' : item.lastChange,
      item.viewCount || 1,
      item.lastViewedAt || ''
    ]);
  });
  const csv = rows.map(row => row.map(recentCsvCell).join(',')).join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'webstock-recent-stocks-' + (window.WebStockTime ? window.WebStockTime.filenameDate() : new Date().toISOString().slice(0, 10)) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.RecentStocks = {
  load,
  record,
  remove,
  clear,
  render: renderRecentStocks,
  renderDashboard: renderRecentDashboard,
  exportCsv: exportRecentCsv,
  visibleRecentItems,
  runAction
};
