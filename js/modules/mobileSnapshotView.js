(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WebStockMobileView = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function finite(value) {
    const number = Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number;
  }

  function numberText(value, digits) {
    const number = finite(value);
    if (number === null) return '--';
    return number.toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function money(value) {
    return numberText(value, 2);
  }

  function percent(value) {
    const number = finite(value);
    return number === null ? '--' : (number > 0 ? '+' : '') + numberText(number, 2) + '%';
  }

  function signedMoney(value) {
    const number = finite(value);
    return number === null ? '--' : (number > 0 ? '+' : '') + money(number);
  }

  function compactMoney(value) {
    const number = finite(value);
    if (number === null) return '--';
    const absolute = Math.abs(number);
    const prefix = number > 0 ? '+' : number < 0 ? '-' : '';
    if (absolute >= 100000000) return prefix + numberText(absolute / 100000000, 2) + '亿';
    if (absolute >= 10000) return prefix + numberText(absolute / 10000, 2) + '万';
    return prefix + numberText(absolute, 2);
  }

  function dateTimeText(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function valueClass(value) {
    const number = finite(value);
    if (number === null || number === 0) return '';
    return number > 0 ? 'positive' : 'negative';
  }

  function sourceState(account) {
    const status = String(account.valuationStatus || 'unavailable');
    const label = account.source && account.source.label || '数据不可用';
    return {
      label,
      stale: status !== 'live' && status !== 'cash-only'
    };
  }

  function renderAccounts(accounts, selectedId) {
    if (accounts.length < 2) return '';
    return '<nav class="account-tabs" aria-label="账户切换">' + accounts.map(function(account) {
      const active = Number(account.id) === Number(selectedId);
      return '<button class="account-tab' + (active ? ' active' : '') + '" type="button" data-account-id="' +
        escapeHtml(account.id) + '" aria-pressed="' + active + '">' + escapeHtml(account.name || '未命名账户') + '</button>';
    }).join('') + '</nav>';
  }

  function renderPositions(account) {
    const positions = Array.isArray(account.positions) ? account.positions : [];
    return '<section class="position-section"><div class="section-title"><h2>持仓</h2><span>' +
      positions.length + ' 只</span></div><ul class="position-list">' + (positions.length ? positions.map(function(position) {
        return '<li class="position-row" data-position-code="' + escapeHtml(position.code) + '">' +
          '<div class="position-name"><strong>' + escapeHtml(position.name || position.code) + '</strong><span>' + escapeHtml(position.code) + ' · ' + escapeHtml(numberText(position.quantity, 0)) + '股</span></div>' +
          '<div class="position-cell"><strong data-position-field="change" class="' + valueClass(position.change) + '">' + escapeHtml(percent(position.change)) + '</strong><span data-position-field="currentPrice">' + escapeHtml(money(position.currentPrice)) + '</span></div>' +
          '<div class="position-cell"><strong data-position-field="unrealizedPnl" class="' + valueClass(position.unrealizedPnl) + '">' + escapeHtml(signedMoney(position.unrealizedPnl)) + '</strong><span>浮动盈亏</span></div>' +
          '</li>';
      }).join('') : '<li class="empty-row">当前账户没有持仓记录</li>') + '</ul></section>';
  }

  function renderResearch(research) {
    const totals = research && research.totals || {};
    return '<section class="research-band"><div class="research-head"><h2>研究资料</h2></div><div class="research-counts">' +
      '<div><strong>' + escapeHtml(numberText(totals.observationCount, 0)) + '</strong><span>观察</span></div>' +
      '<div><strong>' + escapeHtml(numberText(totals.videoCount, 0)) + '</strong><span>视频</span></div>' +
      '<div><strong>' + escapeHtml(numberText(totals.transcriptCount, 0)) + '</strong><span>转写</span></div>' +
      '<div><strong>' + escapeHtml(numberText(totals.archiveCount, 0)) + '</strong><span>存档</span></div>' +
      '</div></section>';
  }

  function renderWatchlist(watchlist) {
    const data = watchlist || {};
    const items = Array.isArray(data.items) ? data.items : [];
    return '<section class="mobile-panel watchlist-panel"><div class="section-title"><div><h2>自选行情</h2><p>自选与智能候选分开显示</p></div><span>' +
      items.length + ' 只</span></div>' + (items.length ? '<div class="quote-grid">' + items.map(function(item) {
        return '<article class="quote-card" data-watch-code="' + escapeHtml(item.code) + '"><div><strong>' + escapeHtml(item.name || item.code) + '</strong><span>' +
          escapeHtml(item.code) + (item.groupName ? ' · ' + escapeHtml(item.groupName) : '') + '</span></div><div class="quote-value"><strong>' +
          '<span data-watch-field="currentPrice">' + escapeHtml(money(item.currentPrice)) + '</span></strong><span data-watch-field="change" class="' + valueClass(item.change) + '">' + escapeHtml(percent(item.change)) +
          '</span></div>' + (item.note ? '<p>' + escapeHtml(item.note) + '</p>' : '') + '</article>';
      }).join('') + '</div>' : '<div class="empty-row">暂无自选股</div>') + '</section>';
  }

  function renderCapitalMomentum(momentum) {
    const data = momentum || { status: 'unavailable' };
    const latest = data.latest;
    const target = data.target || {};
    const statusLabel = data.status === 'available' ? '可用' : data.status === 'degraded' ? '已降级' : '不可用';
    const statusClass = data.status === 'available' ? 'available' : data.status === 'degraded' ? 'degraded' : 'unavailable';
    const points = (Array.isArray(data.points) ? data.points : []).map(function(point) { return finite(point && point.netAmount); }).filter(function(value) { return value !== null; });
    let sparkline = '';
    if (points.length > 1) {
      const minimum = Math.min.apply(Math, points);
      const maximum = Math.max.apply(Math, points);
      const spread = maximum - minimum || 1;
      const coordinates = points.map(function(value, index) {
        const x = points.length === 1 ? 0 : index / (points.length - 1) * 100;
        const y = 30 - (value - minimum) / spread * 26;
        return x.toFixed(2) + ',' + y.toFixed(2);
      }).join(' ');
      sparkline = '<div class="capital-sparkline"><svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="最近资金净额变化"><line x1="0" y1="30" x2="100" y2="30"></line><polyline points="' + coordinates + '"></polyline></svg><span>最近 ' + points.length + ' 个观测点</span></div>';
    }
    return '<section class="mobile-panel capital-panel"><div class="section-title"><div><h2>资金动量</h2><p>' +
      escapeHtml([target.name, target.code].filter(Boolean).join(' · ') || '优先展示持仓或自选目标') + '</p></div><span class="data-state ' +
      statusClass + '">' + statusLabel + '</span></div>' + (latest ? '<div class="capital-metrics">' +
      '<div><span>累计净额</span><strong class="' + valueClass(latest.netAmount) + '">' + escapeHtml(compactMoney(latest.netAmount)) + '</strong></div>' +
      '<div><span>流入速度/分</span><strong class="' + valueClass(latest.netFlowSpeed) + '">' + escapeHtml(compactMoney(latest.netFlowSpeed)) + '</strong></div>' +
      '<div><span>速度变化/分²</span><strong class="' + valueClass(latest.netFlowAcceleration) + '">' + escapeHtml(compactMoney(latest.netFlowAcceleration)) + '</strong></div>' +
      '</div>' + sparkline + '<div class="momentum-foot"><strong>' + escapeHtml(latest.flowState && latest.flowState.label || '状态不足') + '</strong><span>' +
      escapeHtml(dateTimeText(latest.timestamp || data.observation && data.observation.observedAt)) + '</span></div>' :
      '<div class="panel-state-message">' + escapeHtml(data.message || '暂无可展示的资金动量') + '</div>') +
      (data.source && data.source.provider ? '<p class="source-note">来源：' + escapeHtml(data.source.provider) + ' · ' +
        escapeHtml(data.source.truthStatement || '该数据不等于交易所事实。') + '</p>' : '') + '</section>';
  }

  function renderCandidateRows(candidates, scoreLabel) {
    return '<div class="candidate-list">' + candidates.map(function(candidate, index) {
      const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
      const risks = Array.isArray(candidate.risks) ? candidate.risks : [];
      return '<article class="candidate-row"><span class="candidate-rank">' + (index + 1) + '</span><div class="candidate-main"><div><strong>' +
        escapeHtml(candidate.name || candidate.code) + '</strong><span>' + escapeHtml(candidate.code) +
        (candidate.sectorName ? ' · ' + escapeHtml(candidate.sectorName) : '') + '</span></div>' +
        (reasons[0] ? '<p>' + escapeHtml(reasons[0]) + '</p>' : '') + (risks[0] ? '<p class="risk-text">风险：' + escapeHtml(risks[0]) + '</p>' : '') +
        (candidate.originalAnalysis ? '<p class="analysis-line">原分析：' + escapeHtml(candidate.originalAnalysis) + '</p>' : '') + '</div>' +
        (finite(candidate.score) === null ? '' : '<div class="candidate-score"><strong>' + escapeHtml(numberText(candidate.score, 1)) + '</strong><span>' + escapeHtml(scoreLabel) + '</span></div>') + '</article>';
    }).join('') + '</div>';
  }

  function renderScreener(screener) {
    const data = screener || {};
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    return '<section class="mobile-panel screener-panel"><div class="section-title"><div><h2>本地候选筛选</h2><p>' +
      escapeHtml(data.taskName || '只展示已保存的真实筛选结果') + '</p></div><span>' + candidates.length + ' 只</span></div>' +
      (data.status === 'available' && candidates.length ? renderCandidateRows(candidates, '候选分') :
        '<div class="panel-state-message">暂无已保存的本地候选结果；不会用自选股代替，也不冒充全市场实时选股。</div>') +
      (data.analysisExcerpt ? '<div class="analysis-excerpt"><strong>已保存分析</strong><p>' + escapeHtml(data.analysisExcerpt) + '</p></div>' : '') + '</section>';
  }

  function renderGptPicks(latestGptPicks) {
    const data = latestGptPicks || {};
    const picks = Array.isArray(data.picks) ? data.picks : [];
    return '<section class="mobile-panel gpt-picks-panel"><div class="section-title"><div><h2>ChatGPT 每日选股</h2><p>' +
      escapeHtml(data.title || '同步人工 ChatGPT 对话中保存的股票') + '</p></div><span>' + picks.length + ' 只</span></div>' +
      (data.status === 'available' && picks.length ? renderCandidateRows(picks, '分析分') :
        '<div class="panel-state-message">暂无已同步的 ChatGPT 每日选股；保存后将在这里独立展示。</div>') +
      (data.analysisExcerpt ? '<div class="analysis-excerpt"><strong>GPT 分析摘要</strong><p>' + escapeHtml(data.analysisExcerpt) + '</p></div>' : '') + '</section>';
  }

  function renderNews(news) {
    const data = news || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const statusText = data.status === 'degraded' ? '部分来源降级' : data.status === 'unavailable' ? '不可用' : items.length + ' 条';
    return '<section class="mobile-panel news-panel"><div class="section-title"><div><h2>连续资讯</h2><p>按发布时间排列，重点为本地研究优先级</p></div><span>' +
      escapeHtml(statusText) + '</span></div>' + (data.message ? '<div class="feed-notice">' + escapeHtml(data.message) + '</div>' : '') +
      (items.length ? '<div class="news-stream">' + items.map(function(item) {
        const importance = item.importance || {};
        const important = importance.level === 'high';
        const explainPriority = important || importance.level === 'medium';
        const association = (item.relatedStocks || []).concat(item.relatedSectors || []).slice(0, 4);
        const content = '<article class="news-row' + (important ? ' important' : '') + '">' +
          (item.imageUrl ? '<img class="news-thumbnail" src="' + escapeHtml(item.imageUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
          '<div class="news-copy"><div class="news-meta-line"><span class="importance-tag ' +
          escapeHtml(importance.level || 'low') + '">' + escapeHtml(importance.label || '一般') +
          (finite(importance.score) === null ? '' : ' ' + escapeHtml(numberText(importance.score, 0))) + '</span><span>' + escapeHtml(item.source || 'WebStock') +
          '</span><time>' + escapeHtml(dateTimeText(item.time)) + '</time></div><h3>' + escapeHtml(item.title) + '</h3>' +
          (item.summary ? '<p>' + escapeHtml(item.summary) + '</p>' : '') + (association.length ? '<div class="association-line">关联：' +
            association.map(escapeHtml).join(' · ') + '</div>' : '') + (important ? '<div class="importance-reason">标识原因：' +
            escapeHtml(importance.reason || '暂无可验证原因') + '</div>' : explainPriority ? '<div class="importance-reason secondary">关注原因：' +
            escapeHtml(importance.reason || '暂无可验证原因') + '</div>' : '') + '</div></article>';
        return item.link && item.link !== '#' ? '<a class="news-link" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener noreferrer">' + content + '</a>' : content;
      }).join('') + '</div>' : '<div class="panel-state-message">暂无资讯</div>') +
      (data.pagination && data.pagination.hasMore ? '<div class="feed-tail">移动快照已按服务端上限展示 ' + escapeHtml(data.pagination.returned || items.length) +
        ' 条；刷新可获取最新一批。</div>' : '<div class="feed-tail">已展示当前快照全部资讯</div>') + '</section>';
  }

  function renderSnapshot(snapshot, selectedId) {
    if (!snapshot || snapshot.schema !== 'webstock.mobile-snapshot/v1') {
      return '<div class="mobile-error">没有可显示的移动快照</div>';
    }
    const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    let accountContent = '';
    if (accounts.length) {
      const account = accounts.find(item => Number(item.id) === Number(selectedId)) ||
        accounts.find(item => item.isDefault) || accounts[0];
      const summary = account.summary || {};
      const source = sourceState(account);
      accountContent = renderAccounts(accounts, account.id) +
      '<section class="account-band">' +
      '<div class="account-head"><div><h1>' + escapeHtml(account.name || '账户') + '</h1><p>' +
      escapeHtml(account.observedAt || snapshot.generatedAt || '') + '</p></div><span class="source-state' +
      (source.stale ? ' stale' : '') + '">' + escapeHtml(source.label) + '</span></div>' +
      '<div class="metric-grid">' +
      '<div class="metric"><span>总资产</span><strong data-summary-field="totalAssets">' + escapeHtml(money(summary.totalAssets)) + '</strong></div>' +
      '<div class="metric"><span>总市值</span><strong data-summary-field="totalMarketValue">' + escapeHtml(money(summary.totalMarketValue)) + '</strong></div>' +
      '<div class="metric"><span>最终收益</span><strong data-summary-field="totalPnl" class="' + valueClass(summary.totalPnl) + '">' + escapeHtml(signedMoney(summary.totalPnl)) + '</strong></div>' +
      '<div class="metric"><span>当日参考盈亏</span><strong data-summary-field="todayPnl" class="' + valueClass(summary.todayPnl) + '">' + escapeHtml(signedMoney(summary.todayPnl)) + '</strong></div>' +
      '</div></section>' + renderPositions(account);
    }
    return accountContent + renderWatchlist(snapshot.watchlist) + renderScreener(snapshot.screener) +
      renderGptPicks(snapshot.latestGptPicks) + renderCapitalMomentum(snapshot.capitalMomentum) +
      renderNews(snapshot.news) + renderResearch(snapshot.research);
  }

  function updateSignedElement(target, value, formatter) {
    if (!target) return;
    target.textContent = formatter(value);
    target.classList.remove('positive', 'negative');
    const className = valueClass(value);
    if (className) target.classList.add(className);
  }

  function patchQuotes(root, snapshot, selectedId) {
    if (!root || !snapshot) return;
    const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    const account = accounts.find(item => Number(item.id) === Number(selectedId)) || accounts.find(item => item.isDefault) || accounts[0];
    if (account) {
      const summary = account.summary || {};
      ['totalAssets', 'totalMarketValue'].forEach(function(field) {
        const target = root.querySelector('[data-summary-field="' + field + '"]');
        if (target) target.textContent = money(summary[field]);
      });
      updateSignedElement(root.querySelector('[data-summary-field="totalPnl"]'), summary.totalPnl, signedMoney);
      updateSignedElement(root.querySelector('[data-summary-field="todayPnl"]'), summary.todayPnl, signedMoney);
      (account.positions || []).forEach(function(position) {
        const row = root.querySelector('[data-position-code="' + CSS.escape(String(position.code || '')) + '"]');
        if (!row) return;
        const price = row.querySelector('[data-position-field="currentPrice"]');
        if (price) price.textContent = money(position.currentPrice);
        updateSignedElement(row.querySelector('[data-position-field="change"]'), position.change, percent);
        updateSignedElement(row.querySelector('[data-position-field="unrealizedPnl"]'), position.unrealizedPnl, signedMoney);
      });
    }
    const watchlist = snapshot.watchlist && snapshot.watchlist.items || [];
    watchlist.forEach(function(item) {
      const row = root.querySelector('[data-watch-code="' + CSS.escape(String(item.code || '')) + '"]');
      if (!row) return;
      const price = row.querySelector('[data-watch-field="currentPrice"]');
      if (price) price.textContent = money(item.currentPrice);
      updateSignedElement(row.querySelector('[data-watch-field="change"]'), item.change, percent);
    });
  }

  return { escapeHtml, money, percent, valueClass, renderSnapshot, patchQuotes };
});
