function tradesApi(path, options) {
  return window.apiFetch('/api/portfolio' + path, options);
}

const TRADE_LOT_SIZE = 100;
const TRADE_FEE_PER_LOT = 5;
const DEFAULT_TRADE_TAX = 0;
const TRADE_ENTER_FLOW = ['tradeDateInput', 'tradePriceInput', 'tradeQuantityInput', 'tradeFeeInput'];

function todayStr() {
  if (window.WebStockTime && window.WebStockTime.todayDate) return window.WebStockTime.todayDate();
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

function calculateDefaultTradeFee(side, quantity) {
  if (side !== 'buy' && side !== 'sell') return 0;
  const q = Math.trunc(Number(quantity) || 0);
  if (q <= 0) return TRADE_FEE_PER_LOT;
  return Math.ceil(q / TRADE_LOT_SIZE) * TRADE_FEE_PER_LOT;
}

function syncTradeFeeInput(event) {
  const sideEl = document.getElementById('tradeSideInput');
  const quantityEl = document.getElementById('tradeQuantityInput');
  const feeEl = document.getElementById('tradeFeeInput');
  if (!sideEl || !quantityEl || !feeEl) return;
  if (event && event.target && !['tradeSideInput', 'tradeQuantityInput'].includes(event.target.id)) return;
  feeEl.value = calculateDefaultTradeFee(sideEl.value, quantityEl.value);
}

function normalizeTradePayloadFee(payload) {
  const expected = calculateDefaultTradeFee(payload.side, payload.quantity);
  return Math.max(Number(payload.fee) || 0, expected);
}

function calculateTradeAmount(payload) {
  const price = Number(payload.price);
  const quantity = Number(payload.quantity);
  const fee = Number(payload.fee) || 0;
  const tax = Number(payload.tax) || 0;
  if (payload.side === 'buy') {
    if (price <= 0 || quantity <= 0) return null;
    return price * quantity + fee;
  }
  if (payload.side === 'sell') {
    if (price <= 0 || quantity <= 0) return null;
    return price * quantity - fee - tax;
  }
  if (payload.side === 'dividend') {
    if (price < 0 || quantity < 0) return null;
    return price * quantity;
  }
  if (payload.side === 'fee') return fee;
  return null;
}

function updateTradeAmountPreview(event) {
  const box = document.getElementById('tradeAmountPreview');
  if (!box) return;
  syncTradeFeeInput(event);
  const payload = collectTradeForm();
  const amount = calculateTradeAmount(payload);
  const labels = {
    buy: 'Estimated outflow',
    sell: 'Estimated inflow',
    dividend: 'Estimated dividend',
    fee: 'Estimated fee'
  };
  const sideClass = payload.side === 'buy' || payload.side === 'fee' ? 'pnl-down' : 'pnl-up';
  box.className = 'trade-amount-preview ' + sideClass;
  box.textContent = (labels[payload.side] || 'Estimated amount') + ': ' + (amount === null ? '--' : formatNumber(amount));
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

function currentTradeFilters() {
  return {
    code: document.getElementById('tradeCodeFilter') ? document.getElementById('tradeCodeFilter').value.trim() : '',
    side: document.getElementById('tradeSideFilter') ? document.getElementById('tradeSideFilter').value : '',
    startDate: document.getElementById('tradeStartDate') ? document.getElementById('tradeStartDate').value : '',
    endDate: document.getElementById('tradeEndDate') ? document.getElementById('tradeEndDate').value : ''
  };
}

function tradeMatchesCurrentFilters(trade) {
  const filters = currentTradeFilters();
  if (filters.code) {
    const keyword = filters.code.toLowerCase();
    const code = String(trade.code || '').toLowerCase();
    const name = String(trade.name || '').toLowerCase();
    if (code !== keyword && !name.includes(keyword)) return false;
  }
  if (filters.side && trade.side !== filters.side) return false;
  if (filters.startDate && String(trade.tradeDate || '') < filters.startDate) return false;
  if (filters.endDate && String(trade.tradeDate || '') > filters.endDate) return false;
  return true;
}

function sortTradesForDisplay(trades) {
  return trades.slice().sort(function(a, b) {
    const dateCompare = String(b.tradeDate || '').localeCompare(String(a.tradeDate || ''));
    if (dateCompare) return dateCompare;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

function upsertTradeInState(trade, oldId) {
  const State = window.State;
  const removeId = Number(oldId || trade.id);
  const nextTrades = (State.trades || []).filter(function(item) {
    return Number(item.id) !== removeId && Number(item.id) !== Number(trade.id);
  });
  if (tradeMatchesCurrentFilters(trade)) nextTrades.push(trade);
  State.trades = sortTradesForDisplay(nextTrades);
  renderTrades();
}

function removeTradeFromState(id) {
  const State = window.State;
  State.trades = (State.trades || []).filter(function(item) {
    return Number(item.id) !== Number(id);
  });
  renderTrades();
}

function refreshAfterTradeChange() {
  loadTrades().catch(function(error) { console.warn(error.message || error); });
  if (window.Portfolio) window.Portfolio.loadPortfolio().catch(function(error) { console.warn(error.message || error); });
  if (window.StockDetail && window.State.currentStock) {
    window.StockDetail.refresh(window.State.currentStock).catch(function(error) { console.warn(error.message || error); });
  }
}

async function loadTrades(filters) {
  const State = window.State;
  const query = filters ? new URLSearchParams(filters).toString() : collectFilters();
  State.trades = await tradesApi('/trades' + (query ? '?' + query : ''));
  renderTrades();
  return State.trades;
}

function resetFilters() {
  ['tradeCodeFilter', 'tradeSideFilter', 'tradeStartDate', 'tradeEndDate'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  return loadTrades();
}

function renderTrades() {
  const State = window.State;
  const tbody = document.getElementById('tradesTbody');
  const table = document.getElementById('tradesTable');
  const empty = document.getElementById('tradesEmpty');
  const summary = document.getElementById('tradesResultSummary');
  if (!tbody) return;
  const hasFilters = Boolean(collectFilters());
  if (summary) {
    summary.textContent = State.trades.length
      ? 'Showing ' + State.trades.length + ' trade' + (State.trades.length === 1 ? '' : 's') + (hasFilters ? ' for current filters.' : '.')
      : (hasFilters ? 'No trades match current filters.' : 'No trades yet.');
  }
  if (empty) {
    empty.textContent = hasFilters
      ? 'No trades match current filters.'
      : 'No trades yet. Add a trade to start tracking your portfolio.';
    empty.style.display = State.trades.length ? 'none' : '';
  }
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
      '<td><button class="small-btn" data-action="edit" data-id="' + trade.id + '">编辑</button><button class="small-btn danger" data-action="delete" data-id="' + trade.id + '">删除</button></td>' +
      '</tr>';
  }).join('');
  tbody.onclick = async function(event) {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.getAttribute('data-id'));
    try {
      if (btn.getAttribute('data-action') === 'edit') openTradeModal('edit', id);
      else {
        btn.disabled = true;
        const deleted = await deleteTrade(id);
        if (!deleted) btn.disabled = false;
      }
    } catch (error) {
      btn.disabled = false;
      alert(error.message || '交易操作失败');
    }
  };
}

function openTradeModal(mode, tradeOrId, preset) {
  const State = window.State;
  const trade = typeof tradeOrId === 'number' ? State.trades.find(item => item.id === tradeOrId) : tradeOrId;
  const data = trade || preset || {};
  const isEdit = mode === 'edit';
  const side = data.side || 'buy';
  const defaultPrice = isEdit || side !== 'buy'
    ? (data.price || data.currentPrice || (State.currentStock && State.currentStock.price) || '')
    : '';
  document.getElementById('tradeModalTitle').textContent = mode === 'edit' ? '编辑交易' : '新增交易';
  document.getElementById('tradeIdInput').value = data.id || '';
  document.getElementById('tradeCodeInput').value = data.code || (State.currentStock && State.currentStock.code) || '';
  document.getElementById('tradeNameInput').value = data.name || (State.currentStock && State.currentStock.name) || '';
  document.getElementById('tradeSideInput').value = side;
  document.getElementById('tradeDateInput').value = data.tradeDate || todayStr();
  document.getElementById('tradePriceInput').value = defaultPrice;
  document.getElementById('tradeQuantityInput').value = data.quantity || '';
  document.getElementById('tradeFeeInput').value = data.fee !== undefined ? data.fee : calculateDefaultTradeFee(side, data.quantity);
  document.getElementById('tradeTaxInput').value = data.tax !== undefined ? data.tax : DEFAULT_TRADE_TAX;
  document.getElementById('tradeNoteInput').value = data.note || '';
  updateTradeAmountPreview();
  document.getElementById('tradeModalOverlay').style.display = 'flex';
  setTimeout(function() {
    const target = document.getElementById('tradePriceInput');
    if (target) target.focus();
  }, 0);
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
    fee: normalizeTradePayloadFee({
      side: document.getElementById('tradeSideInput').value,
      quantity: Number(document.getElementById('tradeQuantityInput').value || 0),
      fee: Number(document.getElementById('tradeFeeInput').value || 0)
    }),
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
  if (payload.side === 'sell') {
    const position = (window.State.positions || []).find(item => item.code === payload.code);
    const editingId = document.getElementById('tradeIdInput').value;
    if (!editingId && position && payload.quantity > Number(position.quantity)) return '卖出数量不能超过当前持仓';
  }
  return '';
}

async function saveTrade() {
  const id = document.getElementById('tradeIdInput').value;
  const okBtn = document.getElementById('tradeModalOk');
  const payload = collectTradeForm();
  const validation = validateTradeForm(payload);
  if (validation) { alert(validation); return; }
  try {
    if (okBtn) okBtn.disabled = true;
    const savedTrade = await tradesApi('/trades' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeTradeModal();
    upsertTradeInState(savedTrade, id);
    refreshAfterTradeChange();
  } catch (error) {
    alert(error.message);
  } finally {
    if (okBtn) okBtn.disabled = false;
  }
}

async function deleteTrade(id) {
  if (!confirm('确定删除这条交易记录吗？')) return;
  await tradesApi('/trades/' + id, { method: 'DELETE' });
  removeTradeFromState(id);
  refreshAfterTradeChange();
  return true;
}

function handleTradeFormKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  if (event.target && event.target.tagName === 'TEXTAREA') return;
  const index = TRADE_ENTER_FLOW.indexOf(event.target && event.target.id);
  if (index === -1 && event.target.id !== 'tradeTaxInput') return;
  event.preventDefault();
  if (index >= 0 && index < TRADE_ENTER_FLOW.length - 1) {
    const next = document.getElementById(TRADE_ENTER_FLOW[index + 1]);
    if (next) {
      next.focus();
      if (typeof next.select === 'function') next.select();
    }
    return;
  }
  saveTrade();
}

function bindTradeModalShortcuts() {
  const modal = document.querySelector('.trade-modal');
  if (!modal || modal.dataset.shortcutsBound === 'true') return;
  modal.dataset.shortcutsBound = 'true';
  modal.addEventListener('keydown', handleTradeFormKeydown);
}

function exportTrades() {
  const query = collectFilters();
  const a = document.createElement('a');
  a.href = '/api/portfolio/trades/export' + (query ? '?' + query : '');
  a.download = 'webstock-trades.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  calculateTradeAmount,
  calculateDefaultTradeFee,
  updateTradeAmountPreview,
  resetFilters,
  exportTrades,
  bindTradeModalShortcuts
};
