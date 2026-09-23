let hotMarketOverview = null;
let selectedHotBoardIndex = 0;
let hotSectorFocused = false;
let pendingHotPaste = false;
let hotFullRefreshScheduled = false;
let hotReadingMode = 'day';
let hotReadingSort = 'dailyChangePct';
let hotAllBoards = null;
let hotUseAllBoards = false;
let hotTrendChart = null;
let hotTrendSequence = 0;
let hotSelectedTrendCode = '';

function hotEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hotFmtPct(value) {
  if (value == null || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function hotFmtYi(value) {
  if (value == null || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return Math.abs(n)<1e8 ? (n/1e4).toFixed(1)+'万' : (n / 100000000).toFixed(2) + '亿';
}

function hotPnlClass(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 0 ? 'pnl-up' : 'pnl-down';
}

function hotOriginalUrl(item) {
  const url = item && (item.link || item.url || item.originalUrl);
  return /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
}

function hotStockLookup(stock) {
  if (!stock) return null;
  const code = stock.code || '';
  return (window.State.allStocks || []).find(item => item.code === code) || stock;
}

function hotBoards() {
  const rows = hotUseAllBoards && hotAllBoards ? hotAllBoards : hotMarketOverview && hotMarketOverview.boards && Array.isArray(hotMarketOverview.boards.day)
    ? hotMarketOverview.boards.day
    : [];
  const key = hotReadingMode === 'month' ? 'monthChangePct' : hotReadingSort;
  return rows.slice().sort((a,b) => (b[key] == null ? -Infinity : Number(b[key])) - (a[key] == null ? -Infinity : Number(a[key])));
}

function hotRankLabel(board, index) {
  const key = hotReadingMode === 'month' ? 'monthChangePct' : hotReadingSort;
  return board[key] == null ? '— ' : (index + 1) + '. ';
}

function hotMetric(board) {
  const amount = Math.max(0, Number(board.amount) || 0) / 100000000;
  const flow = Math.abs(Number(board.mainNetInflow) || 0) / 100000000;
  const change = Math.abs(Number(board.dailyChangePct) || 0);
  const heat = Math.max(0, Number(board.heatScore) || 0);
  return Math.max(1, change * 14 + Math.log10(amount + 1) * 12 + Math.log10(flow + 1) * 8 + heat);
}

function renderHotHeatmap(boards, limit) {
  const items = (boards || []).slice(0, limit || 6);
  if (!items.length) return '<div class="empty-state compact">暂无热点板块数据。</div>';
  const maxMetric = items.reduce(function(max, board) {
    return Math.max(max, hotMetric(board));
  }, 1);
  return '<div class="hot-heatmap">' + items.map(function(board, index) {
    const change = Number(board.dailyChangePct);
    const metric = hotMetric(board);
    const flex = Math.max(0.74, Math.min(1.45, metric / maxMetric + 0.45));
    const className = change >= 0 ? 'heat-up' : 'heat-down';
    return '<button type="button" class="hot-heat-tile ' + className + (index === selectedHotBoardIndex ? ' active' : '') +
      '" style="flex:' + flex.toFixed(2) + ' 1 30%" data-hot-sector-index="' + index + '">' +
      '<strong>' + hotEscape(board.name) + '</strong>' +
      '<span class="' + hotPnlClass(board.dailyChangePct) + '">' + hotFmtPct(board.dailyChangePct) + '</span>' +
      '<em>额 ' + hotFmtYi(board.amount) + ' / 热 ' + (Number.isFinite(Number(board.heatScore)) ? Number(board.heatScore).toFixed(1) : '--') + '</em>' +
      '</button>';
  }).join('') + '</div>';
}

function hotSyncSearchMode() {
  const input = document.getElementById('searchInput');
  const wrap = document.querySelector('.stock-table-wrap');
  const newsPanel = document.getElementById('hotSidebarPanel');
  const marketPanel = document.getElementById('marketSidebarPanel');
  if (!wrap || !newsPanel) return;
  const searching = Boolean(input && input.value.trim());
  const currentView = window.State && window.State.currentMainView || 'dashboard';
  const hasSidebarNews = newsPanel.dataset.sidebarNewsReady === '1' || newsPanel.dataset.sidebarNewsLoading === '1';
  const showNews = currentView === 'dashboard' && hasSidebarNews && !searching;
  const showMarket = currentView === 'market' && Boolean(marketPanel) && !searching;
  wrap.classList.toggle('hot-hidden-default', showNews || showMarket);
  newsPanel.hidden = !showNews;
  newsPanel.style.display = showNews ? '' : 'none';
  if (marketPanel) marketPanel.hidden = !showMarket;
}

function renderHotStatus(target, text, isError) {
  const box = document.getElementById(target);
  if (!box) return;
  box.innerHTML = '<div class="empty-state compact ' + (isError ? 'error-state' : '') + '">' + hotEscape(text) + '</div>';
}

function hotUnavailableMessage(overview) {
  const names = (overview && overview.localWatchBoards || []).map(function(board) {
    return board && board.name;
  }).filter(Boolean);
  return '市场热点数据暂不可用。' + (names.length
    ? '本地观察板块：' + names.join('、') + '；这些仅是关注清单，不代表当前市场热点。'
    : '当前没有可验证的外部板块行情，请稍后刷新。');
}

async function hotLoad(options) {
  options = options || {};
  if (!options.silent) {
    renderHotStatus('hotMarketBoard', '正在刷新热点板块...');
  }
  const params = new URLSearchParams();
  if (options.refresh) params.set('refresh', '1');
  if (options.fast) params.set('fast', '1');
  const previousCode = hotBoards()[selectedHotBoardIndex]?.code;
  const previousFocused = hotSectorFocused;
  hotMarketOverview = await window.ApiClient.fetchJsonData('/api/hot-market/overview' + (params.toString() ? '?' + params.toString() : ''),{timeoutMs:60000});
  if(hotUseAllBoards && options.refresh)await hotLoadAllBoards(true);
  const nextBoards = hotBoards();
  selectedHotBoardIndex = options.silent ? Math.max(0,nextBoards.findIndex(board=>board.code===previousCode)) : 0;
  hotSectorFocused = options.silent ? previousFocused : false;
  renderHotSidebar();
  renderHotBoard();
  hotSyncSearchMode();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  if(hotSelectedTrendCode && hotBoards()[selectedHotBoardIndex]?.stocks?.some(stock=>stock.code===hotSelectedTrendCode))hotLoadTrend(hotSelectedTrendCode);
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
  const tags = (stock.tags || []).slice(0, 3).map(function(tag) {
    return '<span class="stock-tag">' + hotEscape(tag) + '</span>';
  }).join('');
  return '<button class="hot-stock-line" data-hot-stock="' + hotEscape(stock.code) + '">' +
    '<span class="hot-stock-main"><strong>' + hotEscape(stock.name || stock.code) + '</strong><em>' + hotEscape(stock.code || '') + '</em><span class="stock-tags">' + tags + '</span></span>' +
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
      '<span>' + hotEscape(item.source || '') + ' · ' + hotEscape(window.WebStockTime && window.WebStockTime.formatDate ? window.WebStockTime.formatDate(item.time) : (item.time || '').slice(0, 10)) + '</span>' +
      '</button>';
  }).join('');
}

function renderThemeSearchBox() {
  return '<div class="theme-search-box">' +
    '<div class="theme-search-row">' +
      '<input id="themeSearchInput" type="search" placeholder="搜索板块/主营业务，如 CPO / 半导体 / 先进封装">' +
      '<button class="small-btn" data-hot-action="themeSearch">搜索</button>' +
    '</div>' +
    '<div class="theme-quick-row">' +
      ['CPO', '半导体', '先进封装', '商业航天', '科创芯片', '工业母机'].map(function(name) {
        return '<button type="button" data-theme-query="' + hotEscape(name) + '">' + hotEscape(name) + '</button>';
      }).join('') +
    '</div>' +
    '<div id="themeSearchResults" class="theme-search-results"></div>' +
  '</div>';
}

function renderThemeResults(themes) {
  if (!themes || !themes.length) {
    return '<div class="empty-state compact">没有找到匹配产业，可换一个关键词。</div>';
  }
  return themes.slice(0, 4).map(function(theme) {
    const leaders = (theme.leaders || []).slice(0, 6).map(function(stock) {
      return '<button type="button" class="theme-leader-chip" data-hot-stock="' + hotEscape(stock.code) + '">' +
        '<strong>' + hotEscape(stock.name || stock.code) + '</strong><span>' + hotEscape(stock.role || stock.marketLabel || '') + '</span>' +
      '</button>';
    }).join('');
    return '<article class="theme-result-card">' +
      '<header><strong>' + hotEscape(theme.name) + '</strong><span>' + hotEscape((theme.aliases || []).slice(0, 3).join(' / ')) + '</span></header>' +
      '<div class="theme-leader-grid">' + leaders + '</div>' +
    '</article>';
  }).join('');
}

async function runThemeSearch(query) {
  const input = document.getElementById('themeSearchInput');
  const target = document.getElementById('themeSearchResults');
  const keyword = String(query || (input && input.value) || '').trim();
  if (input && query) input.value = keyword;
  if (!target || !keyword) return;
  target.innerHTML = '<div class="empty-state compact">正在查询产业龙头...</div>';
  const data = await window.ApiClient.fetchJsonData('/api/themes/search?q=' + encodeURIComponent(keyword));
  target.innerHTML = renderThemeResults(data || []);
}

function renderHotSidebar() {
  if (window.News && window.News.renderSidebarNews) window.News.renderSidebarNews();
  hotSyncSearchMode();
}

function renderHotBoard() {
  const box = document.getElementById('hotMarketBoard');
  if (!box) return;
  const boards = hotBoards();
  if (!boards.length) {
    box.innerHTML = '<div class="hot-board-head"><div><h3>市场热点</h3><p>仅展示可验证的外部市场数据。</p></div>' +
      '<div class="hot-board-actions"><button class="small-btn" data-hot-action="refresh">刷新数据</button></div></div>' +
      '<div class="empty-state compact error-state">' + hotEscape(hotUnavailableMessage(hotMarketOverview)) + '</div>';
    bindHotContainer(box);
    return;
  }
  const selected = boards[Math.min(selectedHotBoardIndex, boards.length - 1)] || boards[0];
  const selectedStocks = selected.stocks || [];
  hotTrendSequence++;
  if(hotTrendChart){hotTrendChart.dispose();hotTrendChart=null;}
  const errorLine = hotMarketOverview.degraded
    ? '<div class="provider-status">部分行情源暂不可用，以下仅展示当前仍可核验的数据。</div>'
    : '';
  box.innerHTML = '<div class="hot-board-head">' +
    '<div><h3>板块观察</h3><p>读取时间 '+hotEscape(window.WebStockTime?.formatDateTime(hotMarketOverview.generatedAt) || '未提供')+' · 当前 '+boards.length+' 个板块 · '+(hotUseAllBoards?'来源可用目录':'热点候选范围')+'</p></div>' +
    '<div class="hot-board-actions">' +
      '<button class="small-btn" data-hot-action="refresh">刷新数据</button>' +
      '<button class="small-btn primary" data-hot-action="ai">复制 GPT 提示词</button>' +
    '</div>' +
    '</div>' + errorLine +
    '<div class="reading-toolbar"><button data-hot-mode="day" aria-pressed="'+(hotReadingMode==='day')+'">当日增强</button><button data-hot-mode="month" aria-pressed="'+(hotReadingMode==='month')+'">多日持续</button>'+
    '<button data-hot-action="allBoards">'+(hotUseAllBoards?'返回热点候选':'全部板块')+'</button>'+
    '<label>当日排序 <select id="hotReadingSort">'+[['dailyChangePct','涨幅'],['mainNetInflow','资金净流入'],['amount','成交额']].map(([key,label])=>'<option value="'+key+'"'+(hotReadingSort===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label><span id="hotReadingStatus" role="status"></span></div>'+
    '<div class="hot-reading-grid">' +
      '<section><div class="reading-table-scroll"><table class="hot-board-table"><thead><tr><th>板块 / 排名</th><th>当日涨幅</th><th>资金净额</th><th>成交额</th><th>多日表现</th></tr></thead><tbody>'+
      boards.map((board,index)=>'<tr data-active="'+(index===selectedHotBoardIndex)+'"><td><button data-hot-sector-index="'+index+'">'+hotRankLabel(board,index)+hotEscape(board.name)+'</button><small>'+hotEscape(board.provider || board.kind || board.taxonomy || '')+'</small></td><td class="'+hotPnlClass(board.dailyChangePct)+'">'+hotFmtPct(board.dailyChangePct)+'</td><td class="'+hotPnlClass(board.mainNetInflow)+'">'+hotFmtYi(board.mainNetInflow)+'</td><td>'+hotFmtYi(board.amount)+'</td><td class="'+hotPnlClass(board.monthChangePct)+'">'+hotFmtPct(board.monthChangePct)+'<small>'+(board.sampleDays ? board.sampleDays+' 个日样本':'尚无日序列')+'</small></td></tr>').join('')+
      '</tbody></table></div><p class="hot-detail-reason">当日增强按所选指标排序；多日持续按已取得日样本的区间涨幅排序。缺失资金不记为零。</p></section>'+
      '<section><div class="reading-toolbar"><strong>'+hotEscape(selected.name)+' · 成分股</strong><button data-hot-action="members">读取更多成分股</button></div>'+
      '<p class="hot-detail-reason">'+hotEscape((selected.rankReason || '涨幅、资金、成交额分别展示').replace(/\bnull\b/g,'—'))+(selected.sampleDays?' · '+hotEscape(selected.monthStart || '')+' 至 '+hotEscape(selected.monthEnd || '')+' · 上涨 '+(selected.upDays ?? '—')+'/'+selected.sampleDays+' 个日样本':'')+'</p>'+
      '<div class="reading-table-scroll hot-members-scroll"><table class="hot-board-table"><thead><tr><th>股票</th><th>涨跌幅</th><th>资金净额</th><th>成交额</th><th>查看</th></tr></thead><tbody>'+
      selectedStocks.map(stock=>'<tr><td><button data-hot-trend="'+hotEscape(stock.code)+'">'+hotEscape(stock.name || stock.code)+'</button><small>'+hotEscape(stock.code)+'</small></td><td class="'+hotPnlClass(stock.changePct)+'">'+hotFmtPct(stock.changePct)+'</td><td class="'+hotPnlClass(stock.mainNetInflow)+'">'+hotFmtYi(stock.mainNetInflow)+'</td><td>'+hotFmtYi(stock.amount)+'</td><td><button data-hot-stock="'+hotEscape(stock.code)+'">详情</button></td></tr>').join('')+
      '</tbody></table>'+(selectedStocks.length?'':'<p class="reading-empty">尚未取得该板块成分股。点击读取，不使用其他板块股票替代。</p>')+'</div>'+
      '<p id="hotTrendStatus" class="hot-detail-reason">点击股票名称，在此查看分时走势。</p><div id="hotSelectedTrend" class="hot-mini-trend"></div></section>'+
    '</div>';
  bindHotContainer(box);
  const sort=document.getElementById('hotReadingSort');
  if(sort)sort.onchange=()=>{hotReadingSort=sort.value;selectedHotBoardIndex=0;renderHotBoard();};
}

async function hotLoadAllBoards(refreshOnly=false) {
  if(hotUseAllBoards && !refreshOnly){hotUseAllBoards=false;selectedHotBoardIndex=0;renderHotBoard();return;}
  const status=document.getElementById('hotReadingStatus');if(status)status.textContent='正在读取行业与概念目录…';
  const groups=await Promise.all(['industry','concept'].map(taxonomy=>window.ApiClient.fetchJsonData('/api/market/boards/snapshot?taxonomy='+taxonomy+(refreshOnly?'&refresh=1':''),{timeoutMs:60000})));
  const existing=new Map((hotMarketOverview.boards?.day || []).concat(hotAllBoards || []).map(board=>[board.code,board]));
  hotAllBoards=groups.flatMap(group=>group.items || []).map(board=>Object.assign({},existing.get(board.code),board,{dailyChangePct:board.changePct}));
  if(!hotAllBoards.length)throw Error('板块目录暂不可用，保留热点候选');
  hotUseAllBoards=true;if(!refreshOnly){selectedHotBoardIndex=0;renderHotBoard();}
}

async function hotLoadMembers() {
  const board=hotBoards()[selectedHotBoardIndex];if(!board)return;
  document.getElementById('hotReadingStatus').textContent='正在读取 '+board.name+' 成分股…';
  const taxonomy=board.taxonomy || board.kind || 'industry';
  const result=await window.ApiClient.fetchJsonData('/api/market/boards/constituents?'+new URLSearchParams({code:board.code,taxonomy}));
  if (!result.items?.length) {
    if (hotBoards()[selectedHotBoardIndex]?.code === board.code) {
      document.getElementById('hotReadingStatus').textContent = '本次未取得成分股，保留已有结果。';
    }
    return;
  }
  board.stocks=result.items || [];
  if(hotBoards()[selectedHotBoardIndex]?.code===board.code)renderHotBoard();
}

async function hotLoadTrend(code) {
  const ticket=++hotTrendSequence;hotSelectedTrendCode=code;
  const status=document.getElementById('hotTrendStatus');if(!status)return;
  status.textContent=code+' · 正在读取分钟行情…';
  if(hotTrendChart){hotTrendChart.dispose();hotTrendChart=null;}
  try {
    const envelope=await window.ApiClient.fetchApiEnvelope('/api/minute?code='+encodeURIComponent(code));
    if(ticket!==hotTrendSequence)return;
    const rows=Array.isArray(envelope.data)?envelope.data:[], target=document.getElementById('hotSelectedTrend');
    if(!target || !rows.length){status.textContent=code+' · 暂无分钟数据';return;}
    const model=window.RealtimeChartModel,axis=model.buildCompressedTradingAxis(rows),series=model.buildMinuteSeries(axis.times,rows);
    hotTrendChart=window.echarts.init(target);
    const option={animation:false,grid:{left:48,right:12,top:8,bottom:22},tooltip:{trigger:'axis'},xAxis:{type:'category',data:axis.times,boundaryGap:false,axisLabel:{fontSize:10,interval:(_,value)=>/:00$|:30$/.test(value)}},yAxis:{type:'value',scale:true,splitNumber:3,axisLabel:{fontSize:10}},series:[{type:'line',data:series.prices,showSymbol:false,connectNulls:false,lineStyle:{width:1.2,color:'#52a7ff'}}]};
    hotTrendChart.setOption(window.ChartTheme ? window.ChartTheme.applyToOption(option) : option);
    status.textContent=code+' · 分钟数据 '+(envelope.meta?.tradeDate || String(rows.at(-1).time).slice(0,10))+' · '+rows.length+' 个观测点';
  }catch(error){if(ticket===hotTrendSequence)status.textContent=code+' · '+error.message;}
}

function bindHotContainer(container) {
  container.onclick = async function(event) {
    const action = event.target.closest('[data-hot-action]');
    const stockBtn = event.target.closest('[data-hot-stock]');
    const sector = event.target.closest('[data-hot-sector-index]');
    const newsBtn = event.target.closest('[data-hot-news-index]');
    const themeQuery = event.target.closest('[data-theme-query]');
    try {
      const mode=event.target.closest('[data-hot-mode]');
      if(mode){
        hotReadingMode=mode.dataset.hotMode;selectedHotBoardIndex=0;renderHotBoard();
        if(hotReadingMode==='month' && !hotBoards().some(board=>board.sampleDays>0)) {
          document.getElementById('hotReadingStatus').textContent='正在补读多日日线样本…';
          await hotLoad({refresh:true,silent:true});
          if(!hotBoards().some(board=>board.sampleDays>0))document.getElementById('hotReadingStatus').textContent='日序列来源暂不可用，未生成多日排名。';
        }
        return;
      }
      const trend=event.target.closest('[data-hot-trend]');
      if(trend){await hotLoadTrend(trend.dataset.hotTrend);return;}
      if (action) {
        const name = action.getAttribute('data-hot-action');
        if (name === 'refresh') await hotLoad({ refresh: true, silent:true });
        if (name === 'allBoards') await hotLoadAllBoards();
        if (name === 'members') await hotLoadMembers();
        if (name === 'ai') await openHotAIHandoff(true);
        if (name === 'themeSearch') await runThemeSearch();
        if (name === 'clearFocus') {
          hotSectorFocused = false;
          renderHotSidebar();
          renderHotBoard();
        }
        return;
      }
      if (themeQuery) {
        await runThemeSearch(themeQuery.getAttribute('data-theme-query'));
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
        hotSectorFocused = true;
        if (window.switchMainView) window.switchMainView('sectors');
        renderHotSidebar();
        renderHotBoard();
      }
    } catch (error) {
      const status=document.getElementById('hotReadingStatus');
      if(status)status.textContent=error.message || '热点操作失败';
      else console.warn(error.message);
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
      '<button id="hotNewsModalOriginal" class="primary" type="button">打开原文</button>' +
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
  overlay.querySelector('#hotNewsModalMeta').textContent = (item.source || '来源未注明') + ' · ' + (
    window.WebStockTime && window.WebStockTime.formatDateTime ? window.WebStockTime.formatDateTime(item.time) : (item.time || '')
  );
  overlay.querySelector('#hotNewsModalSummary').textContent = item.summary || '该资讯没有摘要。';
  const tags = []
    .concat(item.relatedStocks || [])
    .concat(item.relatedSectors || [])
    .filter(Boolean);
  overlay.querySelector('#hotNewsModalTags').innerHTML = tags.map(function(tag) {
    return '<span class="tag">' + hotEscape(tag) + '</span>';
  }).join('');
  const originalBtn = overlay.querySelector('#hotNewsModalOriginal');
  const url = hotOriginalUrl(item);
  if (originalBtn) {
    originalBtn.style.display = url ? '' : 'none';
    originalBtn.onclick = url ? function() { window.open(url, '_blank'); } : null;
  }
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
    if (pendingHotPaste) showHotPasteHint('已回到工作台。若已复制 GPT 回答，按 Enter 导入并整理。');
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
