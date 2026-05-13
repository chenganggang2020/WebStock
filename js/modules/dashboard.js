function dashboardMiniChangeClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 0 ? 'pnl-up' : 'pnl-down';
}

function dashboardMiniFmt(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits === undefined ? 2 : digits) : '--';
}

function dashboardWatchlistAlertLabel(item) {
  const price = Number(item.price);
  const high = Number(item.alertHigh);
  const low = Number(item.alertLow);
  if (!Number.isFinite(price)) return '';
  if (Number.isFinite(low) && low > 0 && price <= low) return '<span class="status-danger">Alert low</span>';
  if (Number.isFinite(high) && high > 0 && price >= high) return '<span class="status-warn">Alert high</span>';
  if ((Number.isFinite(low) && low > 0) || (Number.isFinite(high) && high > 0)) return '<span class="status-ok">Alert normal</span>';
  return '';
}

const DASHBOARD_DISMISSED_RISKS_KEY = 'webstock_dismissed_risks';
let dashboardShowDismissedRisks = false;

function dashboardTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dashboardRiskStorage() {
  try {
    return JSON.parse(localStorage.getItem(DASHBOARD_DISMISSED_RISKS_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function dashboardDismissedRiskKeys() {
  const data = dashboardRiskStorage();
  return new Set(data[dashboardTodayKey()] || []);
}

function dashboardDismissRisk(key) {
  const data = dashboardRiskStorage();
  const today = dashboardTodayKey();
  const set = new Set(data[today] || []);
  set.add(key);
  data[today] = Array.from(set);
  localStorage.setItem(DASHBOARD_DISMISSED_RISKS_KEY, JSON.stringify(data));
}

function dashboardRestoreRisk(key) {
  const data = dashboardRiskStorage();
  const today = dashboardTodayKey();
  const set = new Set(data[today] || []);
  set.delete(key);
  data[today] = Array.from(set);
  localStorage.setItem(DASHBOARD_DISMISSED_RISKS_KEY, JSON.stringify(data));
}

async function dashboardLoad() {
  await Promise.all([
    window.RecentStocks ? window.RecentStocks.load(20).catch(function() {}) : Promise.resolve(),
    window.Watchlist ? window.Watchlist.loadWatchlist().catch(function() {}) : Promise.resolve(),
    window.Portfolio ? window.Portfolio.loadPortfolio().catch(function() {}) : Promise.resolve(),
    window.News ? window.News.loadDashboardNews().catch(function() {}) : Promise.resolve(),
    window.SectorLeaders ? window.SectorLeaders.loadDashboardSummary().catch(function() {}) : Promise.resolve(),
    dashboardLoadScreenerReviewSummary().catch(function() {})
  ]);
  dashboardSetUpdatedAt();
  dashboardRefreshCards();
}

function dashboardSetUpdatedAt() {
  const target = document.getElementById('dashboardUpdatedAt');
  if (!target) return;
  target.className = 'muted';
  target.textContent = 'Last refreshed: ' + new Date().toLocaleString();
}

function dashboardSetRefreshStatus(message, isError) {
  const target = document.getElementById('dashboardUpdatedAt');
  if (!target) return;
  target.className = isError ? 'status-danger' : 'muted';
  target.textContent = message;
}

function dashboardRefreshCards() {
  dashboardRenderWatchlist();
  dashboardRenderPortfolio();
  dashboardRenderScreenerReview();
  dashboardRenderRisks();
  if (window.RecentStocks) window.RecentStocks.renderDashboard();
}

async function dashboardLoadScreenerReviewSummary() {
  window.State.screenerReviewSummary = await window.apiFetch('/api/screener/review-summary?limit=5');
}

function dashboardRenderWatchlist() {
  const box = document.getElementById('dashboardWatchlistList');
  if (!box) return;
  const items = (window.State.watchlist || []).slice(0, 6);
  if (!items.length) {
    box.innerHTML = '<div class="empty-state compact">No watchlist items yet. Use the star button in the stock list to add one.</div>';
    return;
  }
  box.innerHTML = '<table class="mini-table"><tbody>' + items.map(function(item) {
    const change = Number(item.change);
    const changeText = Number.isFinite(change) ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '--';
    return '<tr><td>' + item.code + '</td><td>' + item.name + '</td><td class="' + dashboardMiniChangeClass(change) + '">' + changeText + '</td><td>' + dashboardWatchlistAlertLabel(item) + '</td><td><button class="small-btn" data-code="' + item.code + '">View</button></td></tr>';
  }).join('') + '</tbody></table>';
  box.onclick = function(event) {
    const btn = event.target.closest('[data-code]');
    if (!btn) return;
    window.Watchlist.selectStock(btn.getAttribute('data-code'));
  };
}

function dashboardRenderPortfolio() {
  const box = document.getElementById('dashboardPortfolioList');
  if (!box) return;
  const positions = (window.State.positions || []).slice(0, 6);
  const summary = window.State.portfolioSummary || {};
  if (!positions.length) {
    box.innerHTML = '<div class="empty-state compact">No positions yet. Add a trade to calculate P/L.</div>';
    return;
  }
  box.innerHTML = '<div class="dashboard-kpis"><span>Market value ' + dashboardMiniFmt(summary.totalMarketValue) + '</span><span class="' + dashboardMiniChangeClass(summary.totalPnl) + '">P/L ' + dashboardMiniFmt(summary.totalPnl) + '</span></div>' +
    '<table class="mini-table"><tbody>' + positions.map(function(pos) {
      return '<tr><td>' + pos.code + '</td><td>' + pos.name + '</td><td>' + pos.quantity + '</td><td class="' + dashboardMiniChangeClass(pos.unrealizedPnl) + '">' + dashboardMiniFmt(pos.unrealizedPnl) + '</td><td><button class="small-btn" data-code="' + pos.code + '">View</button></td></tr>';
    }).join('') + '</tbody></table>';
  box.onclick = function(event) {
    const btn = event.target.closest('[data-code]');
    if (!btn) return;
    window.Portfolio.selectPositionStock(btn.getAttribute('data-code'));
  };
}

function dashboardRenderScreenerReview() {
  const box = document.getElementById('dashboardScreenerReviewList');
  if (!box) return;
  const items = (window.State.screenerReviewSummary || []).slice(0, 5);
  if (!items.length) {
    box.innerHTML = '<div class="empty-state compact">No saved candidate reviews yet. Run and save a screener task to start tracking.</div>';
    return;
  }
  box.innerHTML = '<table class="mini-table"><tbody>' + items.map(function(item) {
    const counts = item.counts || {};
    return '<tr>' +
      '<td><strong>' + item.taskName + '</strong><div class="muted">' + item.strategy + ' / ' + item.candidateCount + ' candidates</div></td>' +
      '<td><span class="review-status">priority ' + (counts.priority || 0) + '</span></td>' +
      '<td><span class="review-status">risk ' + (counts.risk || 0) + '</span></td>' +
      '<td><span class="review-status">todo ' + item.unreviewed + '</span></td>' +
      '<td><button class="small-btn" data-screener-id="' + item.id + '">Open</button></td>' +
      '</tr>';
  }).join('') + '</tbody></table>';
  box.onclick = function(event) {
    const btn = event.target.closest('[data-screener-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-screener-id');
    window.switchMainView('screener');
    if (window.StockScreener) window.StockScreener.openSavedResult(id, 'details').catch(function(error) { alert(error.message); });
  };
}

function dashboardCollectRisks() {
  const risks = [];
  const settings = window.Settings && window.Settings.getRiskSettings
    ? window.Settings.getRiskSettings()
    : { drawdown: 8, dailyDrop: 3, leaderDrop: 3 };
  const drawdownLimit = -Math.abs(Number(settings.drawdown) || 8);
  const dailyDropLimit = -Math.abs(Number(settings.dailyDrop) || 3);
  const leaderDropLimit = -Math.abs(Number(settings.leaderDrop) || 3);

  (window.State.positions || []).forEach(function(pos) {
    const pnlRate = Number(pos.unrealizedPnlRate);
    const todayChange = Number(pos.todayChange);
    if (Number.isFinite(pnlRate) && pnlRate <= drawdownLimit) {
      risks.push({
        key: 'position-drawdown:' + pos.code,
        severity: pnlRate <= drawdownLimit * 1.8 ? 'high' : 'medium',
        code: pos.code,
        title: pos.code + ' position drawdown',
        detail: 'Unrealized P/L rate is ' + dashboardMiniFmt(pnlRate) + '%. Review size, thesis, and exit criteria.'
      });
    }
    if (Number.isFinite(todayChange) && todayChange <= dailyDropLimit) {
      risks.push({
        key: 'daily-drop:' + pos.code,
        severity: todayChange <= dailyDropLimit * 1.6 ? 'high' : 'medium',
        code: pos.code,
        title: pos.code + ' weak today',
        detail: 'Today change is ' + dashboardMiniFmt(todayChange) + '%. Check whether the move is stock-specific or sector-wide.'
      });
    }
  });

  (window.State.watchlist || []).forEach(function(item) {
    const price = Number(item.price);
    const high = Number(item.alertHigh);
    const low = Number(item.alertLow);
    if (Number.isFinite(price) && Number.isFinite(high) && high > 0 && price >= high) {
      risks.push({
        key: 'watchlist-high:' + item.code,
        severity: 'medium',
        code: item.code,
        title: item.code + ' alert high reached',
        detail: 'Current price ' + dashboardMiniFmt(price) + ' is above alert high ' + dashboardMiniFmt(high) + '.'
      });
    }
    if (Number.isFinite(price) && Number.isFinite(low) && low > 0 && price <= low) {
      risks.push({
        key: 'watchlist-low:' + item.code,
        severity: 'high',
        code: item.code,
        title: item.code + ' alert low reached',
        detail: 'Current price ' + dashboardMiniFmt(price) + ' is below alert low ' + dashboardMiniFmt(low) + '.'
      });
    }
    if (item.quoteStatus === 'stale') {
      risks.push({
        key: 'quote-stale:' + item.code,
        severity: 'low',
        code: item.code,
        title: item.code + ' quote retained',
        detail: 'Latest refresh failed for this watchlist item. Existing quote data is retained.'
      });
    }
  });

  const sectorDashboard = window.SectorLeaders && window.SectorLeaders.getDashboard ? window.SectorLeaders.getDashboard() : null;
  ((sectorDashboard && sectorDashboard.overview) || []).forEach(function(item) {
    const change = Number(item.change);
    if (Number.isFinite(change) && change <= leaderDropLimit) {
      risks.push({
        key: 'leader-drop:' + item.code + ':' + (item.sectorName || ''),
        severity: change <= leaderDropLimit * 1.6 ? 'high' : 'medium',
        code: item.code,
        title: (item.sectorName || 'Sector') + ' leader weakening',
        detail: item.code + ' ' + item.name + ' is down ' + dashboardMiniFmt(change) + '%. Compare with other leaders before acting.'
      });
    }
  });

  const severityRank = { high: 0, medium: 1, low: 2 };
  return risks.sort(function(a, b) {
    return (severityRank[a.severity] || 9) - (severityRank[b.severity] || 9);
  });
}

function dashboardBuildRisks(options) {
  const dismissed = dashboardDismissedRiskKeys();
  const includeDismissed = options && options.includeDismissed;
  return dashboardCollectRisks().map(function(item) {
    item.dismissed = dismissed.has(item.key);
    return item;
  }).filter(function(item) {
    if (includeDismissed) return true;
    return !dismissed.has(item.key);
  });
}

function dashboardRenderRisks() {
  const box = document.getElementById('dashboardRiskList');
  if (!box) return;
  const allRisks = dashboardBuildRisks({ includeDismissed: true });
  const activeRisks = allRisks.filter(function(item) { return !item.dismissed; });
  const dismissedRisks = allRisks.filter(function(item) { return item.dismissed; });
  const toolbar = dismissedRisks.length
    ? '<div class="risk-toolbar"><span>' + dismissedRisks.length + ' dismissed today</span><button class="small-btn" data-risk-toggle="dismissed">' + (dashboardShowDismissedRisks ? 'Hide dismissed' : 'Show dismissed today') + '</button></div>'
    : '';
  box.onclick = function(event) {
    const toggle = event.target.closest('[data-risk-toggle]');
    if (toggle) {
      dashboardShowDismissedRisks = !dashboardShowDismissedRisks;
      dashboardRenderRisks();
      return;
    }
    const restore = event.target.closest('[data-risk-restore]');
    if (restore) {
      dashboardRestoreRisk(decodeURIComponent(restore.getAttribute('data-risk-restore')));
      dashboardRenderRisks();
      return;
    }
    const dismiss = event.target.closest('[data-risk-key]');
    if (dismiss) {
      dashboardDismissRisk(decodeURIComponent(dismiss.getAttribute('data-risk-key')));
      dashboardRenderRisks();
      return;
    }
    const btn = event.target.closest('[data-code]');
    if (!btn) return;
    const code = btn.getAttribute('data-code');
    const stock = window.State.allStocks.find(item => item.code === code) ||
      (window.State.watchlist || []).find(item => item.code === code) ||
      (window.State.positions || []).find(item => item.code === code) ||
      { code, name: code };
    window.switchMainView('market');
    window.StockList.selectStock(stock);
  };
  if (!activeRisks.length && !dismissedRisks.length) {
    box.innerHTML = '<div class="empty-state compact">No obvious risk alerts right now.</div>';
    return;
  }
  if (!activeRisks.length && dismissedRisks.length && !dashboardShowDismissedRisks) {
    box.innerHTML = toolbar + '<div class="empty-state compact">No active risk alerts. Dismissed items can still be reviewed today.</div>';
    return;
  }
  const visibleRisks = dashboardShowDismissedRisks ? activeRisks.concat(dismissedRisks) : activeRisks;
  box.innerHTML = toolbar + '<ul class="risk-list detailed">' + visibleRisks.slice(0, 10).map(function(item) {
    return '<li class="risk-item ' + item.severity + (item.dismissed ? ' dismissed' : '') + '">' +
      '<div><strong>' + item.title + '</strong><p>' + item.detail + '</p></div>' +
      '<div class="risk-actions">' +
      (item.code ? '<button class="small-btn" data-code="' + item.code + '">View</button>' : '') +
      (item.dismissed
        ? '<button class="small-btn" data-risk-restore="' + encodeURIComponent(item.key) + '">Restore</button>'
        : '<button class="small-btn" data-risk-key="' + encodeURIComponent(item.key) + '">Dismiss today</button>') +
      '</div>' +
      '</li>';
  }).join('') + '</ul>';
}

window.Dashboard = {
  load: dashboardLoad,
  refreshCards: dashboardRefreshCards,
  renderWatchlist: dashboardRenderWatchlist,
  renderPortfolio: dashboardRenderPortfolio,
  renderScreenerReview: dashboardRenderScreenerReview,
  renderRisks: dashboardRenderRisks,
  buildRisks: dashboardBuildRisks,
  dismissRisk: dashboardDismissRisk,
  restoreRisk: dashboardRestoreRisk,
  setUpdatedAt: dashboardSetUpdatedAt,
  setRefreshStatus: dashboardSetRefreshStatus
};
