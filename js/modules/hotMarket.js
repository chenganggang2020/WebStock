let hotMarketOverview = null;
let selectedHotBoardIndex = 0;
let pendingHotPaste = false;
let hotFullRefreshScheduled = false;

function hotEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hotFmtPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function hotFmtYi(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return (n / 100000000).toFixed(2) + '亿';
}

function hotPnlClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 0 ? 'pnl-up' : 'pnl-down';
}

function hotStockLookup(stock) {
  if (!stock) return null;
  const code = stock.code || '';
  return (window.State.allStocks || []).find(item => item.code === code) || stock;
}

function hotBoards() {
  return hotMarketOverview && hotMarketOverview.boards && Array.isArray(hotMarketOverview.boards.day)
    ? hotMarketOverview.boards.day
    : [];
}

function hotSyncSearchMode() {
  const input = document.getElementById('searchInput');
  const wrap = document.querySelector('.stock-table-wrap');
  const panel = document.getElementById('hotSidebarPanel');
  if (!wrap || !panel) return;
  const searching = Boolean(input && input.value.trim());
  const hasHot = Boolean(hotMarketOverview && hotBoards().length);
  wrap.classList.toggle('hot-hidden-default', hasHot && !searching);
  panel.style.display = hasHot && !searching ? '' : 'none';
}

function renderHotStatus(target, text, isError) {
  const box = document.getElementById(target);
  if (!box) return;
  box.innerHTML = '<div class="empty-state compact ' + (isError ? 'error-state' : '') + '">' + hotEscape(text) + '</div>';
}

async function hotLoad(options) {
  options = options || {};
  if (!options.silent) {
    renderHotStatus('hotSidebarPanel', '正在刷新热点板块...');
    renderHotStatus('hotMarketBoard', '正在刷新热点板块...');
  }
  const params = new URLSearchParams();
  if (options.refresh) params.set('refresh', '1');
  if (options.fast) params.set('fast', '1');
  hotMarketOverview = await window.ApiClient.fetchJsonData('/api/hot-market/overview' + (params.toString() ? '?' + params.toString() : ''));
  selectedHotBoardIndex = 0;
  renderHotSidebar();
  renderHotBoard();
  hotSyncSearchMode();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  if (options.backgroundFull && options.fast && !hotFullRefreshScheduled) {
    hotFullRefreshScheduled = true;
    setTimeout(function() {
      hotLoad({ refresh: true, silent: true }).catch(function(error) { console.warn(error.message); });
    }, 1200);
  }
  return hotMarketOverview;
}

function renderHotSectorCard(board, index, compact) {
  const active = index === selectedHotBoardIndex ? ' active' : '';
  const stocks = (board.stocks || []).slice(0, compact ? 3 : 5).map(function(stock) {
    return '<button class="hot-chip" data-hot-stock="' + hotEscape(stock.code) + '">' +
      hotEscape(stock.name || stock.code) +
      '</button>';
  }).join('');
  return '<article class="hot-sector-card' + active + '" data-hot-sector-index="' + index + '">' +
    '<div class="hot-sector-top">' +
      '<strong>' + hotEscape(board.name) + '</strong>' +
      '<span class="' + hotPnlClass(board.dailyChangePct) + '">' + hotFmtPct(board.dailyChangePct) + '</span>' +
    '</div>' +
    '<div class="hot-sector-meta">' +
      '<span>月 ' + hotFmtPct(board.monthChangePct) + '</span>' +
      '<span>额 ' + hotFmtYi(board.amount) + '</span>' +
      '<span>分 ' + (Number.isFinite(Number(board.heatScore)) ? Number(board.heatScore).toFixed(1) : '--') + '</span>' +
    '</div>' +
    '<div class="hot-rank-reason">' + hotEscape(board.rankReason || '按日涨幅、成交额和活跃股综合排序') + '</div>' +
    '<div class="hot-chip-row">' + stocks + '</div>' +
    '</article>';
}

function renderHotStockLine(stock) {
  return '<button class="hot-stock-line" data-hot-stock="' + hotEscape(stock.code) + '">' +
    '<span><strong>' + hotEscape(stock.name || stock.code) + '</strong><em>' + hotEscape(stock.code || '') + '</em></span>' +
    '<span class="' + hotPnlClass(stock.changePct) + '">' + hotFmtPct(stock.changePct) + '</span>' +
    '<span>' + hotFmtYi(stock.amount) + '</span>' +
    '</button>';
}

function renderHotNews(items, limit) {
  const news = (items || []).slice(0, limit || 4);
  if (!news.length) return '<div class="empty-state compact">暂无最新资讯。</div>';
  return news.map(function(item, index) {
    return '<button class="hot-news-item" type="button" data-hot-news-index="' + index + '">' +
      '<div><strong>' + hotEscape(item.title) + '</strong><p>' + hotEscape(item.summary || '') + '</p></div>' +
      '<span>' + hotEscape(item.source || '') + ' · ' + hotEscape((item.time || '').slice(0, 10)) + '</span>' +
      '</button>';
  }).join('');
}

function renderHotSidebar() {
  const panel = document.getElementById('hotSidebarPanel');
  if (!panel) return;
  const boards = hotBoards();
  if (!boards.length) {
    panel.innerHTML = '<div class="empty-state compact">暂无热点板块数据。</div>';
    hotSyncSearchMode();
    return;
  }
  const selected = boards[Math.min(selectedHotBoardIndex, boards.length - 1)] || boards[0];
  const stocks = (selected.stocks && selected.stocks.length ? selected.stocks : hotMarketOverview.hotStocks || []).slice(0, 8);
  panel.innerHTML = '<div class="hot-sidebar-head">' +
    '<div><strong>今日热点</strong><span>' + hotEscape(hotMarketOverview.tradeDate || '') + '</span></div>' +
    '<button class="small-btn" data-hot-action="refresh">刷新</button>' +
    '</div>' +
    '<div class="hot-sidebar-grid">' + boards.slice(0, 6).map(function(board, index) {
      return renderHotSectorCard(board, index, true);
    }).join('') + '</div>' +
    '<div class="hot-sidebar-section"><div class="hot-sidebar-title">' + hotEscape(selected.name) + ' 核心股</div>' +
    '<div class="hot-stock-lines">' + stocks.map(renderHotStockLine).join('') + '</div></div>' +
    '<div class="hot-sidebar-section hot-news-scroll"><div class="hot-sidebar-title">近7天财经资讯</div>' +
    renderHotNews(hotMarketOverview.news || [], 20) + '</div>';
  bindHotContainer(panel);
  hotSyncSearchMode();
}

function renderHotBoard() {
  const box = document.getElementById('hotMarketBoard');
  if (!box) return;
  const boards = hotBoards();
  if (!boards.length) {
    box.innerHTML = '<div class="empty-state compact">暂无热点板块数据。</div>';
    return;
  }
  const monthBoards = (hotMarketOverview.boards && hotMarketOverview.boards.month) || [];
  const hotStocks = hotMarketOverview.hotStocks || [];
  const errorLine = hotMarketOverview.degraded
    ? '<div class="provider-status">部分外部接口降级：' + hotEscape((hotMarketOverview.errors || []).join(' | ') || '请人工复核数据') + '</div>'
    : '';
  box.innerHTML = '<div class="hot-board-head">' +
    '<div><h3>实时热点板块</h3><p>按热度分排序：日涨幅、成交额、活跃股数量、大涨股数量、可用资金流共同计算。</p></div>' +
    '<div class="hot-board-actions">' +
      '<button class="small-btn" data-hot-action="refresh">刷新数据</button>' +
      '<button class="small-btn primary" data-hot-action="ai">复制 GPT 提示词</button>' +
    '</div>' +
    '</div>' + errorLine +
    '<div class="hot-sector-grid">' + boards.slice(0, 12).map(function(board, index) {
      return renderHotSectorCard(board, index, false);
    }).join('') + '</div>' +
    '<div class="hot-market-columns">' +
      '<section><h3>当月持续性</h3><div class="hot-rank-list">' +
      monthBoards.slice(0, 8).map(function(board, index) {
        return '<div class="hot-rank-row"><strong>' + (index + 1) + '. ' + hotEscape(board.name) + '</strong>' +
          '<span class="' + hotPnlClass(board.monthChangePct) + '">' + hotFmtPct(board.monthChangePct) + '</span>' +
          '<span>' + (board.sampleDays || 0) + '天样本</span></div>';
      }).join('') + '</div></section>' +
      '<section><h3>热门个股</h3><div class="hot-stock-lines">' + hotStocks.slice(0, 12).map(renderHotStockLine).join('') + '</div></section>' +
    '</div>' +
    '<section class="hot-news-block"><h3>近7天资讯</h3>' + renderHotNews(hotMarketOverview.news || [], 60) + '</section>';
  bindHotContainer(box);
}

function bindHotContainer(container) {
  container.onclick = async function(event) {
    const action = event.target.closest('[data-hot-action]');
    const stockBtn = event.target.closest('[data-hot-stock]');
    const sector = event.target.closest('[data-hot-sector-index]');
    const newsBtn = event.target.closest('[data-hot-news-index]');
    try {
      if (action) {
        const name = action.getAttribute('data-hot-action');
        if (name === 'refresh') await hotLoad({ refresh: true });
        if (name === 'ai') await openHotAIHandoff(true);
        return;
      }
      if (stockBtn) {
        await openHotStock(stockBtn.getAttribute('data-hot-stock'));
        return;
      }
      if (newsBtn) {
        openHotNews(Number(newsBtn.getAttribute('data-hot-news-index')) || 0);
        return;
      }
      if (sector) {
        selectedHotBoardIndex = Number(sector.getAttribute('data-hot-sector-index')) || 0;
        renderHotSidebar();
        renderHotBoard();
      }
    } catch (error) {
      alert(error.message || '热点操作失败');
    }
  };
}

function ensureHotNewsModal() {
  let overlay = document.getElementById('hotNewsModalOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'hotNewsModalOverlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = '<div class="modal hot-news-modal">' +
    '<h3 id="hotNewsModalTitle"></h3>' +
    '<div id="hotNewsModalMeta" class="news-meta"></div>' +
    '<p id="hotNewsModalSummary"></p>' +
    '<div id="hotNewsModalTags" class="tag-row"></div>' +
    '<div class="modal-actions">' +
      '<a id="hotNewsModalLink" class="small-btn primary" target="_blank" rel="noopener">打开原文</a>' +
      '<button id="hotNewsModalClose" type="button">关闭</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(event) {
    if (event.target === overlay) overlay.style.display = 'none';
  });
  overlay.querySelector('#hotNewsModalClose').addEventListener('click', function() {
    overlay.style.display = 'none';
  });
  return overlay;
}

function openHotNews(index) {
  const item = (hotMarketOverview && hotMarketOverview.news && hotMarketOverview.news[index]) || null;
  if (!item) return;
  const overlay = ensureHotNewsModal();
  overlay.querySelector('#hotNewsModalTitle').textContent = item.title || '资讯详情';
  overlay.querySelector('#hotNewsModalMeta').textContent = (item.source || 'WebStock') + ' · ' + (item.time || '');
  overlay.querySelector('#hotNewsModalSummary').textContent = item.summary || '该资讯没有摘要，可打开原文查看。';
  const tags = []
    .concat(item.relatedStocks || [])
    .concat(item.relatedSectors || [])
    .filter(Boolean);
  overlay.querySelector('#hotNewsModalTags').innerHTML = tags.map(function(tag) {
    return '<span class="tag">' + hotEscape(tag) + '</span>';
  }).join('');
  const link = overlay.querySelector('#hotNewsModalLink');
  link.href = item.link && item.link !== '#' ? item.link : 'https://finance.sina.com.cn/';
  overlay.style.display = 'flex';
}

async function openHotStock(code) {
  const boards = hotBoards();
  const found = boards.flatMap(board => board.stocks || []).concat(hotMarketOverview.hotStocks || [])
    .find(item => item.code === code);
  const stock = hotStockLookup(found || { code, name: code });
  if (window.switchMainView) window.switchMainView('market');
  await window.StockList.selectStock(stock);
  hotSyncSearchMode();
}

function extractHotResult(raw) {
  const text = String(raw || '').trim();
  const start = 'WEBSTOCK_HOT_MARKET_ANALYSIS_START';
  const end = 'WEBSTOCK_HOT_MARKET_ANALYSIS_END';
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return text;
  const bodyStart = startIndex + start.length;
  const endIndex = text.indexOf(end, bodyStart);
  return text.slice(bodyStart, endIndex < 0 ? undefined : endIndex).trim();
}

async function saveHotResult(rawText, options) {
  options = options || {};
  const body = extractHotResult(rawText);
  if (!body) throw new Error('没有可保存的热点分析内容');
  if (!options.skipHistory && window.AIAssistant && window.AIAssistant.saveHistoryRecord) {
    window.AIAssistant.saveHistoryRecord({
      title: '热点板块 GPT 分析',
      summary: '基于当日热点板块、热门股和新浪财经资讯整理。',
      prompt: hotMarketOverview ? hotMarketOverview.prompt : '',
      result: body,
      kind: 'hot-market',
      context: { snapshotId: hotMarketOverview && hotMarketOverview.snapshotId }
    });
  }
  await window.ApiClient.fetchJsonData('/api/hot-market/ai-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshotId: hotMarketOverview && hotMarketOverview.snapshotId,
      resultText: body,
      parsed: { importedAt: new Date().toISOString() }
    })
  }).catch(function(error) { console.warn(error.message); });
  renderHotAnalysis(body);
  pendingHotPaste = false;
  hideHotPasteHint();
}

function renderHotAnalysis(markdown) {
  const card = document.getElementById('hotMarketAnalysisCard');
  if (!card) return;
  const html = window.Analysis && window.Analysis.simpleMarkdown
    ? window.Analysis.simpleMarkdown(markdown)
    : hotEscape(markdown).replace(/\n/g, '<br>');
  card.style.display = '';
  card.innerHTML = '<header><h3>GPT整理结果</h3><button class="small-btn" data-hot-analysis-copy>复制结果</button></header>' +
    '<div class="md-body">' + html + '</div>';
  const btn = card.querySelector('[data-hot-analysis-copy]');
  if (btn) btn.onclick = function() {
    navigator.clipboard.writeText(markdown).catch(function() {});
  };
}

async function openHotAIHandoff(copyNow) {
  if (!hotMarketOverview) await hotLoad({ refresh: false, silent: true });
  if (!hotMarketOverview || !hotMarketOverview.prompt) throw new Error('热点提示词尚未生成');
  pendingHotPaste = true;
  if (window.AIAssistant) {
    window.AIAssistant.open({
      title: '热点板块 ChatGPT 交接',
      summary: '复制提示词到 GPT，返回后复制 GPT 回答，按 Enter 可从剪贴板导入并整理。',
      prompt: hotMarketOverview.prompt,
      kind: 'hot-market',
      context: { snapshotId: hotMarketOverview.snapshotId },
      onSave: function(result) { return saveHotResult(result, { skipHistory: true }); }
    });
    if (copyNow && window.AIAssistant.copyPrompt) {
      setTimeout(function() { window.AIAssistant.copyPrompt(); }, 50);
    }
  }
  showHotPasteHint('已生成热点分析提示词。返回本页后按 Enter 可导入剪贴板中的 GPT 结果。');
}

function ensureHotPasteHint() {
  let hint = document.getElementById('hotPasteHint');
  if (hint) return hint;
  hint = document.createElement('div');
  hint.id = 'hotPasteHint';
  hint.className = 'hot-paste-hint';
  hint.innerHTML = '<span></span><button type="button">导入</button>';
  document.body.appendChild(hint);
  hint.querySelector('button').addEventListener('click', function() {
    importHotClipboardResult().catch(function(error) { alert(error.message || '导入失败'); });
  });
  return hint;
}

function showHotPasteHint(text) {
  const hint = ensureHotPasteHint();
  hint.querySelector('span').textContent = text || '检测到热点分析交接任务，按 Enter 导入剪贴板结果。';
  hint.classList.add('visible');
}

function hideHotPasteHint() {
  const hint = document.getElementById('hotPasteHint');
  if (hint) hint.classList.remove('visible');
}

async function importHotClipboardResult() {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    throw new Error('浏览器未允许读取剪贴板，请在交接弹窗里手动粘贴。');
  }
  const text = (await navigator.clipboard.readText()).trim();
  if (!text) throw new Error('剪贴板为空');
  await saveHotResult(text);
}

function bindHotMarket() {
  const refresh = document.getElementById('refreshHotMarketBtn');
  if (refresh) refresh.addEventListener('click', function() {
    hotLoad({ refresh: true }).catch(function(error) { alert(error.message || '热点刷新失败'); });
  });
  const ai = document.getElementById('hotMarketAiBtn');
  if (ai) ai.addEventListener('click', function() {
    openHotAIHandoff(true).catch(function(error) { alert(error.message || '提示词生成失败'); });
  });
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.addEventListener('input', hotSyncSearchMode);
  window.addEventListener('focus', function() {
    if (pendingHotPaste) showHotPasteHint('回到 WebStock 了。若已复制 GPT 回答，按 Enter 导入并整理。');
  });
  document.addEventListener('keydown', function(event) {
    const hint = document.getElementById('hotPasteHint');
    if (!pendingHotPaste || !hint || !hint.classList.contains('visible')) return;
    if (event.key !== 'Enter') return;
    if (event.target && ['TEXTAREA', 'INPUT'].includes(event.target.tagName)) return;
    event.preventDefault();
    importHotClipboardResult().catch(function(error) { alert(error.message || '导入失败'); });
  });
}

window.HotMarket = {
  bind: bindHotMarket,
  load: hotLoad,
  renderSidebar: renderHotSidebar,
  renderBoard: renderHotBoard,
  syncSearchMode: hotSyncSearchMode,
  openAIHandoff: openHotAIHandoff,
  importClipboardResult: importHotClipboardResult,
  getOverview: function() { return hotMarketOverview; }
};
