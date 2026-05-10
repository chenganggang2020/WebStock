function watchlistApi(path, options) {
  return fetch('/api/portfolio' + path, options).then(function(resp) { return resp.json(); }).then(function(json) {
    if (!json.success) throw new Error(json.error || '请求失败');
    return json.data;
  });
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

async function loadWatchlist() {
  const State = window.State;
  const group = document.getElementById('watchlistGroupFilter') ? document.getElementById('watchlistGroupFilter').value : '';
  State.watchlist = await watchlistApi('/watchlist' + (group ? '?group=' + encodeURIComponent(group) : ''));
  renderWatchlist();
  if (window.StockList) window.StockList.renderStockTable(State.filteredStocks);
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
    alert(error.message);
  }
}

async function removeByCode(code) {
  try {
    await watchlistApi('/watchlist/code/' + encodeURIComponent(code), { method: 'DELETE' });
    await loadWatchlist();
  } catch (error) {
    alert(error.message);
  }
}

async function removeById(id) {
  if (!confirm('确定删除这只自选股吗？')) return;
  try {
    await watchlistApi('/watchlist/' + id, { method: 'DELETE' });
    await loadWatchlist();
  } catch (error) {
    alert(error.message);
  }
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

  empty.style.display = State.watchlist.length ? 'none' : '';
  table.style.display = State.watchlist.length ? 'table' : 'none';
  tbody.innerHTML = State.watchlist.map(item => {
    const change = Number(item.change);
    const colorClass = Number.isFinite(change) && change >= 0 ? 'pnl-up' : 'pnl-down';
    return '<tr>' +
      '<td><button class="link-btn" onclick="Watchlist.selectStock(&quot;' + item.code + '&quot;)">' + item.code + '</button></td>' +
      '<td>' + item.name + '</td>' +
      '<td>' + money(item.price) + '</td>' +
      '<td class="' + colorClass + '">' + (Number.isFinite(change) ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '--') + '</td>' +
      '<td>' + (item.groupName || '默认分组') + '</td>' +
      '<td>' + (item.alertLow || '--') + ' / ' + (item.alertHigh || '--') + '</td>' +
      '<td>' + (item.note || '') + '</td>' +
      '<td><button class="small-btn" onclick="Watchlist.editWatchlistItem(' + item.id + ')">编辑</button><button class="small-btn danger" onclick="Watchlist.removeById(' + item.id + ')">删除</button></td>' +
      '</tr>';
  }).join('');
}

async function refreshWatchlistQuotes() {
  const State = window.State;
  if (!State.watchlist.length) return;
  try {
    const resp = await fetch('/api/quote?codes=' + State.watchlist.map(item => item.code).join(','));
    const quotes = await resp.json();
    const map = {};
    quotes.forEach(q => { map[q.code] = q; });
    State.watchlist = State.watchlist.map(item => Object.assign({}, item, map[item.code] || {}));
    renderWatchlist();
  } catch (error) {
    console.error(error);
  }
}

function selectStock(code) {
  const State = window.State;
  const stock = State.allStocks.find(item => item.code === code) || State.watchlist.find(item => item.code === code);
  if (stock && window.StockList) {
    window.switchMainView('market');
    window.StockList.selectStock(stock);
  }
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
  selectStock
};
