function tradesApi(path, options) {
  return fetch('/api/portfolio' + path, options).then(function(resp) { return resp.json(); }).then(function(json) {
    if (!json.success) throw new Error(json.error || '请求失败');
    return json.data;
  });
}

function todayStr() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

function sideLabel(side) {
  return { buy: '买入', sell: '卖出', dividend: '分红', fee: '费用' }[side] || side;
}

function formatNumber(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits === undefined ? 2 : digits) : '--';
}

function collectFilters() {
  const code = document.getElementById('tradeCodeFilter') ? document.getElementById('tradeCodeFilter').value.trim() : '';
  const side = document.getElementById('tradeSideFilter') ? document.getElementById('tradeSideFilter').value : '';
  const startDate = document.getElementById('tradeStartDate') ? document.getElementById('tradeStartDate').value : '';
  const endDate = document.getElementById('tradeEndDate') ? document.getElementById('tradeEndDate').value : '';
  const query = new URLSearchParams();
  if (code) query.set('code', code);
  if (side) query.set('side', side);
  if (startDate) query.set('startDate', startDate);
  if (endDate) query.set('endDate', endDate);
  return query.toString();
}

async function loadTrades(filters) {
  const State = window.State;
  const query = filters ? new URLSearchParams(filters).toString() : collectFilters();
  State.trades = await tradesApi('/trades' + (query ? '?' + query : ''));
  renderTrades();
  return State.trades;
}

function renderTrades() {
  const State = window.State;
  const tbody = document.getElementById('tradesTbody');
  const table = document.getElementById('tradesTable');
  const empty = document.getElementById('tradesEmpty');
  if (!tbody) return;
  empty.style.display = State.trades.length ? 'none' : '';
  table.style.display = State.trades.length ? 'table' : 'none';
  tbody.innerHTML = State.trades.map(trade => {
    const sideClass = trade.side === 'buy' || trade.side === 'dividend' ? 'pnl-up' : 'pnl-down';
    return '<tr>' +
      '<td>' + trade.tradeDate + '</td>' +
      '<td class="' + sideClass + '">' + sideLabel(trade.side) + '</td>' +
      '<td>' + trade.code + '</td>' +
      '<td>' + trade.name + '</td>' +
      '<td>' + formatNumber(trade.price, 3) + '</td>' +
      '<td>' + trade.quantity + '</td>' +
      '<td>' + formatNumber(trade.fee) + '</td>' +
      '<td>' + formatNumber(trade.tax) + '</td>' +
      '<td>' + formatNumber(trade.amount) + '</td>' +
      '<td>' + (trade.note || '') + '</td>' +
      '<td><button class="small-btn" onclick="Trades.openTradeModal(&quot;edit&quot;,' + trade.id + ')">编辑</button><button class="small-btn danger" onclick="Trades.deleteTrade(' + trade.id + ')">删除</button></td>' +
      '</tr>';
  }).join('');
}

function openTradeModal(mode, tradeOrId, preset) {
  const State = window.State;
  const trade = typeof tradeOrId === 'number' ? State.trades.find(item => item.id === tradeOrId) : tradeOrId;
  const data = trade || preset || {};
  document.getElementById('tradeModalTitle').textContent = mode === 'edit' ? '编辑交易' : '新增交易';
  document.getElementById('tradeIdInput').value = data.id || '';
  document.getElementById('tradeCodeInput').value = data.code || (State.currentStock && State.currentStock.code) || '';
  document.getElementById('tradeNameInput').value = data.name || (State.currentStock && State.currentStock.name) || '';
  document.getElementById('tradeSideInput').value = data.side || 'buy';
  document.getElementById('tradeDateInput').value = data.tradeDate || todayStr();
  document.getElementById('tradePriceInput').value = data.price || (State.currentStock && State.currentStock.price) || '';
  document.getElementById('tradeQuantityInput').value = data.quantity || '';
  document.getElementById('tradeFeeInput').value = data.fee || 0;
  document.getElementById('tradeTaxInput').value = data.tax || 0;
  document.getElementById('tradeNoteInput').value = data.note || '';
  document.getElementById('tradeModalOverlay').style.display = 'flex';
}

function closeTradeModal() {
  document.getElementById('tradeModalOverlay').style.display = 'none';
}

function collectTradeForm() {
  return {
    code: document.getElementById('tradeCodeInput').value.trim(),
    name: document.getElementById('tradeNameInput').value.trim(),
    side: document.getElementById('tradeSideInput').value,
    tradeDate: document.getElementById('tradeDateInput').value,
    price: Number(document.getElementById('tradePriceInput').value || 0),
    quantity: Number(document.getElementById('tradeQuantityInput').value || 0),
    fee: Number(document.getElementById('tradeFeeInput').value || 0),
    tax: Number(document.getElementById('tradeTaxInput').value || 0),
    note: document.getElementById('tradeNoteInput').value.trim()
  };
}

function validateTradeForm(payload) {
  if (!/^\d{6}$/.test(payload.code)) return '股票代码必须是 6 位数字';
  if (!payload.name) return '股票名称不能为空';
  if (!payload.tradeDate) return '交易日期不能为空';
  if ((payload.side === 'buy' || payload.side === 'sell') && (payload.price <= 0 || payload.quantity <= 0)) return '买入和卖出必须填写价格和数量';
  if (payload.price < 0 || payload.quantity < 0 || payload.fee < 0 || payload.tax < 0) return '价格、数量、手续费和印花税不能为负数';
  return '';
}

async function saveTrade() {
  const id = document.getElementById('tradeIdInput').value;
  const payload = collectTradeForm();
  const validation = validateTradeForm(payload);
  if (validation) { alert(validation); return; }
  try {
    await tradesApi('/trades' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeTradeModal();
    await loadTrades();
    if (window.Portfolio) await window.Portfolio.loadPortfolio();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteTrade(id) {
  if (!confirm('确定删除这条交易记录吗？')) return;
  try {
    await tradesApi('/trades/' + id, { method: 'DELETE' });
    await loadTrades();
    if (window.Portfolio) await window.Portfolio.loadPortfolio();
  } catch (error) {
    alert(error.message);
  }
}

function exportTrades() {
  const query = collectFilters();
  window.open('/api/portfolio/trades/export' + (query ? '?' + query : ''), '_blank');
}

window.Trades = {
  loadTrades,
  renderTrades,
  openTradeModal,
  closeTradeModal,
  saveTrade,
  deleteTrade,
  collectTradeForm,
  validateTradeForm,
  exportTrades
};
