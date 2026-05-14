async function refresh(stock) {
  if (!stock) return;
  renderProfile(stock);
  renderWatchlistStatus(stock);
  renderPositionStatus(stock);
  if (window.StockList && stock.code && !stock.tagDetailFetched) {
    window.StockList.enrichStockTags([stock.code], { limit: 1 }).catch(function(error) { console.warn(error.message || error); });
  }
  if (window.News) {
    try {
      const items = await window.News.loadStockNews(stock, 'detailNewsList');
      const box = document.getElementById('detailNewsList');
      if (box && items.length) {
        box.innerHTML = items.slice(0, 2).map(item => '<div class="mini-news"><strong>' + detailEscapeHtml(item.title) + '</strong><p>' + detailEscapeHtml(item.summary) + '</p></div>').join('');
      }
    } catch (error) {
      const box = document.getElementById('detailNewsList');
      if (box) box.innerHTML = '<div class="empty-state compact">News failed: ' + detailEscapeHtml(error.message) + '</div>';
    }
  }
}

function detailEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function detailAlertStatus(item, stock) {
  const price = Number(stock.price !== undefined ? stock.price : item.price);
  const high = Number(item.alertHigh);
  const low = Number(item.alertLow);
  if (!Number.isFinite(price)) return { className: 'muted', label: 'Alert pending' };
  if (Number.isFinite(low) && low > 0 && price <= low) return { className: 'status-danger', label: 'Alert low' };
  if (Number.isFinite(high) && high > 0 && price >= high) return { className: 'status-warn', label: 'Alert high' };
  if ((Number.isFinite(low) && low > 0) || (Number.isFinite(high) && high > 0)) return { className: 'status-ok', label: 'Alert normal' };
  return { className: 'muted', label: 'No alert' };
}

function renderWatchlistStatus(stock) {
  const el = document.getElementById('detailWatchlistStatus');
  if (!el) return;
  el.className = 'detail-status';
  const item = (window.State.watchlist || []).find(row => row.code === stock.code);
  if (!item) {
    el.textContent = 'Watchlist: not added';
    return;
  }
  const alertStatus = detailAlertStatus(item, stock);
  el.innerHTML = '<div>Watchlist: added' + (item.note ? ', note: ' + detailEscapeHtml(item.note) : '') + '</div>' +
    '<div class="' + alertStatus.className + '">' + alertStatus.label + '</div>';
}

function renderPositionStatus(stock) {
  const el = document.getElementById('detailPositionStatus');
  if (!el) return;
  el.className = 'detail-status';
  const pos = (window.State.positions || []).find(row => row.code === stock.code);
  if (!pos) {
    el.textContent = 'Position: not held';
    return;
  }
  el.textContent = 'Position: ' + pos.quantity + ' shares, cost ' + pos.avgCost + ', floating P/L ' + (pos.unrealizedPnl === null ? '--' : pos.unrealizedPnl);
  el.className = 'detail-status ' + (Number(pos.unrealizedPnl) >= 0 ? 'pnl-up' : 'pnl-down');
}

function renderProfile(stock) {
  const box = document.getElementById('detailProfileBox');
  if (!box) return;
  const tags = (stock.tags || []).slice(0, 10).map(function(tag) {
    return '<span class="stock-tag">' + detailEscapeHtml(tag) + '</span>';
  }).join('');
  const mainItems = (stock.mainBusinessItems || []).slice(0, 4).map(function(item) {
    return '<span>' + detailEscapeHtml(item.name) + (Number.isFinite(Number(item.ratio)) ? ' ' + Number(item.ratio).toFixed(1) + '%' : '') + '</span>';
  }).join('');
  const source = stock.sourceUrl
    ? '<a target="_blank" rel="noopener" href="' + detailEscapeHtml(stock.sourceUrl) + '">' + detailEscapeHtml(stock.source || '来源') + '</a>'
    : detailEscapeHtml(stock.source || '');
  box.innerHTML = '<div class="detail-profile-tags">' + tags + '</div>' +
    (stock.industry || stock.csrcIndustry ? '<div class="detail-profile-line"><strong>行业</strong><span>' + detailEscapeHtml(stock.industry || stock.csrcIndustry) + '</span></div>' : '') +
    (mainItems ? '<div class="detail-profile-line"><strong>主营</strong><span class="detail-main-items">' + mainItems + '</span></div>' : '') +
    (stock.businessSummary ? '<div class="detail-profile-summary">' + detailEscapeHtml(stock.businessSummary) + '</div>' : '') +
    (source ? '<div class="detail-profile-source">数据：' + source + (stock.cached ? '（缓存）' : '') + '</div>' : '<div class="detail-profile-source">正在补充主营业务和板块标签...</div>');
}

function bindStockDetail() {
  const watch = document.getElementById('detailWatchlistBtn');
  if (watch) watch.addEventListener('click', async function() {
    if (!window.State.currentStock) return alert('Please select a stock first');
    await window.Watchlist.addStock(window.State.currentStock);
    refresh(window.State.currentStock);
  });
  const trade = document.getElementById('detailTradeBtn');
  if (trade) trade.addEventListener('click', function() {
    if (!window.State.currentStock) return alert('Please select a stock first');
    if (window.Portfolio) window.Portfolio.openBuyTrade(window.State.currentStock);
    else window.Trades.openTradeModal('new', null, Object.assign({ side: 'buy' }, window.State.currentStock));
  });
  const analysis = document.getElementById('detailAnalysisBtn');
  if (analysis) analysis.addEventListener('click', function() {
    if (!window.State.currentStock) return alert('Please select a stock first');
    window.Analysis.openAnalysisPanel(window.State.currentStock);
  });
  const news = document.getElementById('detailNewsBtn');
  if (news) news.addEventListener('click', async function() {
    if (!window.State.currentStock) return alert('Please select a stock first');
    window.switchMainView('news');
    document.getElementById('newsTypeFilter').value = 'stock';
    document.getElementById('newsKeywordInput').value = window.State.currentStock.code;
    await window.News.load();
  });
}

window.StockDetail = {
  refresh,
  renderProfile,
  bind: bindStockDetail
};
