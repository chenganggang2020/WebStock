function newsEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let newsDiscoveryLoadSequence = 0;
let sidebarNewsResult = null;
let sidebarNewsLoading = false;
const SIDEBAR_NEWS_CACHE_KEY = 'webstock.sidebar-news.v1';
const pendingDiscoveryRequests = new Map();

function newsAppendMeta(query) {
  const params = new URLSearchParams(query || '');
  params.set('withMeta', '1');
  return params.toString();
}

function newsApi(query) {
  return window.ApiClient.fetchJsonData('/api/news' + (query ? '?' + newsAppendMeta(query) : '?withMeta=1'))
    .then(function(data) {
      if (Array.isArray(data)) return { items: data, meta: null };
      return { items: data.items || [], meta: data.meta || null };
    });
}

function newsDiscoveryApi(query) {
  const key = String(query || '');
  if (pendingDiscoveryRequests.has(key)) return pendingDiscoveryRequests.get(key);
  const request = window.ApiClient.fetchJsonData('/api/news/discovery' + (key ? '?' + key : ''))
    .finally(function() { pendingDiscoveryRequests.delete(key); });
  pendingDiscoveryRequests.set(key, request);
  return request;
}

function humanizeAge(ageMs) {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs)) return '';
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
}

function newsFormatTime(value) {
  if (!value) return '';
  return window.WebStockTime && window.WebStockTime.formatDateTime
    ? window.WebStockTime.formatDateTime(value)
    : String(value);
}

function newsRelativeTime(value, now) {
  const parsed = Date.parse(value);
  const nowMs = now && typeof now.getTime === 'function' ? now.getTime() : Date.now();
  if (!Number.isFinite(parsed) || parsed > nowMs + 60000) return '时间待核验';
  const minutes = Math.max(0, Math.floor((nowMs - parsed) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + '分钟前';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + '小时前';
  const days = Math.floor(hours / 24);
  return days + '天前';
}

function newsSourceLabel(item) {
  const source = item && item.source ? String(item.source) : 'WebStock';
  const provider = item && item.provider ? String(item.provider) : '';
  return provider && provider !== source ? source + ' · 经 ' + provider : source;
}

function newsOriginalUrl(item) {
  const url = item && (item.link || item.url || item.originalUrl);
  return /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
}

function updateNewsOriginalButton(item) {
  const btn = document.getElementById('newsDetailOriginalBtn');
  if (!btn) return;
  const url = newsOriginalUrl(item);
  btn.style.display = url ? '' : 'none';
  btn.onclick = url ? function() {
    window.open(url, '_blank', 'noopener');
  } : null;
}

function showNewsDetail(item) {
  const overlay = document.getElementById('newsDetailOverlay');
  if (!overlay || !item) return;
  document.getElementById('newsDetailTitle').textContent = item.title || '资讯详情';
  document.getElementById('newsDetailMeta').textContent = [item.source || 'WebStock', newsFormatTime(item.time)].filter(Boolean).join(' | ');
  document.getElementById('newsDetailSummary').textContent = item.summary || '该资讯没有摘要。';
  const tags = []
    .concat(item.relatedStocks || [])
    .concat(item.relatedSectors || [])
    .filter(Boolean)
    .map(tag => '<span class="tag">' + newsEscapeHtml(tag) + '</span>')
    .join('');
  document.getElementById('newsDetailTags').innerHTML = tags;
  updateNewsOriginalButton(item);
  overlay.style.display = 'flex';
}

function bindNewsLinks(box, items) {
  if (!box) return;
  box.onclick = function(event) {
    if (event.target.closest('details')) return;
    const card = event.target.closest('[data-news-index]');
    if (!card) return;
    showNewsDetail((items || [])[Number(card.getAttribute('data-news-index'))]);
  };
}

function updateNewsSourceFilter(sources) {
  const select = document.getElementById('newsSourceFilter');
  if (!select) return;
  const current = select.value;
  const nextSources = Array.from(new Set((sources || []).filter(Boolean))).sort();
  select.innerHTML = '<option value="">全部来源</option>';
  nextSources.forEach(function(source) {
    const option = document.createElement('option');
    option.value = source;
    option.textContent = source;
    select.appendChild(option);
  });
  if (current && nextSources.indexOf(current) >= 0) {
    select.value = current;
    return;
  }
  select.value = '';
}

function collectNewsQuery(options) {
  const type = document.getElementById('newsTypeFilter') ? document.getElementById('newsTypeFilter').value : '';
  const keyword = document.getElementById('newsKeywordInput') ? document.getElementById('newsKeywordInput').value.trim() : '';
  const source = document.getElementById('newsSourceFilter') ? document.getElementById('newsSourceFilter').value : '';
  const query = new URLSearchParams();
  if (type) query.set('type', type);
  if (keyword) query.set('keyword', keyword);
  if (source) query.set('source', source);
  if (keyword && type === 'stock') query.set('code', keyword);
  if (keyword && type === 'sector') query.set('sector', keyword);
  if (options && options.cacheBust) query.set('cacheBust', String(Date.now()));
  return query.toString();
}

function buildDiscoveryQuery(filters, options) {
  const query = new URLSearchParams();
  filters = filters || {};
  if (filters.type) query.set('type', filters.type);
  if (filters.source) query.set('source', filters.source);
  if (filters.code || filters.codes) query.set('codes', filters.code || filters.codes);
  if (filters.sector || filters.sectors) query.set('sectors', filters.sector || filters.sectors);
  if (filters.keyword || filters.keywords) query.set('keywords', filters.keyword || filters.keywords);
  if (filters.keyword || filters.keywords) query.set('keyword', filters.keyword || filters.keywords);
  if (filters.timeRange) query.set('timeRange', filters.timeRange);
  if (filters.withImage) query.set('withImage', '1');
  if (filters.sort) query.set('sort', filters.sort);
  if (filters.days) query.set('days', filters.days);
  if (filters.pages) query.set('pages', filters.pages);
  if (filters.num) query.set('num', filters.num);
  if (filters.limit) query.set('limit', filters.limit);
  if (options && options.cacheBust) {
    query.set('cacheBust', options.cacheBust === true ? String(Date.now()) : String(options.cacheBust));
  }
  return query.toString();
}

function collectDiscoveryQuery(options) {
  const type = document.getElementById('newsTypeFilter') ? document.getElementById('newsTypeFilter').value : '';
  const keyword = document.getElementById('newsKeywordInput') ? document.getElementById('newsKeywordInput').value.trim() : '';
  const source = document.getElementById('newsSourceFilter') ? document.getElementById('newsSourceFilter').value : '';
  const timeRange = document.getElementById('newsDiscoveryTimeFilter') ? document.getElementById('newsDiscoveryTimeFilter').value : '7d';
  const withImage = document.getElementById('newsDiscoveryImageFilter') ? document.getElementById('newsDiscoveryImageFilter').checked : false;
  const sort = document.getElementById('newsDiscoverySort') ? document.getElementById('newsDiscoverySort').value : 'latest';
  return buildDiscoveryQuery({
    type,
    source,
    code: type === 'stock' ? keyword : '',
    sector: type === 'sector' ? keyword : '',
    keyword,
    timeRange,
    withImage,
    sort
  }, options);
}

function discoveryScoreText(signal, label) {
  if (!signal || signal.score == null) return label + '：未评分';
  return label + '：' + Number(signal.score).toFixed(0) + '/100';
}

function discoveryReasons(signal) {
  if (!signal || !Array.isArray(signal.reasons) || !signal.reasons.length) return '暂无评分依据';
  return signal.reasons.join(' ');
}

function sidebarNewsImportant(item) {
  const importance = item && item.importance;
  return Boolean(
    importance &&
    importance.method === 'local-research-priority-v1' &&
    Number(importance.score) >= 60 &&
    (!importance.level || importance.level === 'high')
  );
}

function renderSidebarNewsItem(item, index, now) {
  const importance = item && item.importance ? item.importance : {};
  const important = sidebarNewsImportant(item);
  const exactTime = newsFormatTime(item && item.time);
  const relativeTime = newsRelativeTime(item && item.time, now);
  const explanation = [
    '本地重点评分 ' + (Number.isFinite(Number(importance.score)) ? Number(importance.score).toFixed(0) + '/100' : '未评分'),
    importance.method || '',
    discoveryReasons(importance),
    exactTime
  ].filter(Boolean).join(' | ');
  return '<button type="button" class="sidebar-news-item' + (important ? ' is-important' : '') + '" ' +
    'data-sidebar-news-item data-news-index="' + index + '" title="' + newsEscapeHtml(explanation) + '">' +
    '<span class="sidebar-news-title-row"><strong>' + newsEscapeHtml(item && item.title ? item.title : '未命名资讯') + '</strong>' +
    (important ? '<em>本地重点 ' + newsEscapeHtml(Number(importance.score).toFixed(0)) + '</em>' : '') + '</span>' +
    '<span class="sidebar-news-meta"><span>' + newsEscapeHtml(newsSourceLabel(item)) + '</span>' +
    '<time datetime="' + newsEscapeHtml(item && item.time ? item.time : '') + '" title="' + newsEscapeHtml(exactTime) + '">' + newsEscapeHtml(relativeTime) + '</time></span>' +
    '</button>';
}

function readSidebarNewsCache() {
  try {
    if (!window.localStorage) return null;
    const cached = JSON.parse(window.localStorage.getItem(SIDEBAR_NEWS_CACHE_KEY) || 'null');
    if (!cached || !Array.isArray(cached.items) || !cached.items.length) return null;
    const ageMs = Date.now() - Number(cached.savedAt || 0);
    if (!Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60 * 1000) return null;
    return cached;
  } catch (error) {
    return null;
  }
}

function writeSidebarNewsCache(result) {
  try {
    if (!window.localStorage || !result || !Array.isArray(result.items)) return;
    window.localStorage.setItem(SIDEBAR_NEWS_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      items: result.items.slice(0, 18),
      sourceMeta: result.sourceMeta || null,
      methodology: result.methodology || null,
      degraded: Boolean(result.degraded)
    }));
  } catch (error) {}
}

function bindSidebarNews(box, items) {
  if (!box) return;
  box.onclick = function(event) {
    const action = event.target.closest('[data-sidebar-news-action]');
    if (action) {
      if (action.getAttribute('data-sidebar-news-action') === 'refresh') {
        loadSidebarNews({ refresh: true }).catch(function(error) { console.warn(error.message); });
      }
      return;
    }
    if (event.target.closest('details')) return;
    const card = event.target.closest('[data-sidebar-news-item]');
    if (!card) return;
    showNewsDetail((items || [])[Number(card.getAttribute('data-news-index'))]);
  };
}

function renderSidebarNews(result, options) {
  const box = document.getElementById('hotSidebarPanel');
  if (!box) return;
  result = result || sidebarNewsResult;
  if (!result) return;
  options = options || {};
  const items = result && Array.isArray(result.items) ? result.items.slice(0, 18) : [];
  const meta = result && result.sourceMeta ? result.sourceMeta : {};
  const status = options.localCache ? '本机缓存' : (meta.cached ? '服务缓存' : '已更新');
  box.dataset.sidebarNewsReady = '1';
  box.dataset.sidebarNewsLoading = '0';
  box.innerHTML = '<div class="sidebar-news-head">' +
    '<div><strong>重点资讯</strong><span>近 7 日 · ' + newsEscapeHtml(status) + '</span></div>' +
    '<div class="sidebar-news-actions"><button type="button" data-sidebar-news-action="refresh" aria-label="刷新重点资讯" title="刷新重点资讯">↻</button></div>' +
    '</div>' +
    '<details class="sidebar-news-method"><summary>本地重点评分</summary>' +
    '<p>依据可验证发布时间、来源与原文可追溯性、明确股票/板块关联、事件词及源站明确重点字段计算；不代表新浪官方重点或全网热度。</p></details>' +
    (items.length ? '<div class="sidebar-news-list">' + items.map(function(item, index) {
      return renderSidebarNewsItem(item, index);
    }).join('') + '</div>' : '<div class="empty-state compact">暂无可展示资讯。</div>');
  bindSidebarNews(box, items);
  if (window.HotMarket && window.HotMarket.syncSearchMode) window.HotMarket.syncSearchMode();
}

async function loadSidebarNews(options) {
  options = options || {};
  const box = document.getElementById('hotSidebarPanel');
  if (!box) return [];
  if (!options.refresh && !sidebarNewsResult) {
    const cached = readSidebarNewsCache();
    if (cached) {
      sidebarNewsResult = cached;
      renderSidebarNews(cached, { localCache: true });
    }
  }
  if (!sidebarNewsResult) {
    box.dataset.sidebarNewsLoading = '1';
    box.innerHTML = '<div class="empty-state compact">正在加载重点资讯...</div>';
  }
  if (sidebarNewsLoading) return sidebarNewsResult ? sidebarNewsResult.items : [];
  sidebarNewsLoading = true;
  try {
    const query = buildDiscoveryQuery({ timeRange: '7d', sort: 'latest' }, {
      cacheBust: options.refresh ? true : false
    });
    const result = await newsDiscoveryApi(query);
    sidebarNewsResult = result;
    writeSidebarNewsCache(result);
    renderSidebarNews(result);
    return result.items || [];
  } catch (error) {
    if (sidebarNewsResult) {
      renderSidebarNews(sidebarNewsResult, { localCache: true });
      return sidebarNewsResult.items || [];
    }
    box.dataset.sidebarNewsLoading = '0';
    box.innerHTML = '<div class="empty-state compact error-state">重点资讯暂不可用。</div>';
    throw error;
  } finally {
    sidebarNewsLoading = false;
  }
}

function renderDiscoveryImage(item) {
  const image = item && item.image;
  const provenance = item && item.imageProvenance;
  if (!image || !image.url || !provenance || !provenance.sourceField || !image.upstreamProvided || !provenance.upstreamProvided) return '';
  if (!/^https?:\/\//i.test(String(image.url))) return '';
  const provenanceText = [provenance.provider || item.source || 'upstream', provenance.sourceField].join(' / ');
  return '<figure data-news-image>' +
    '<img src="' + newsEscapeHtml(image.url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest(\'figure\').hidden=true">' +
    '<figcaption data-image-provenance>图片来源字段：' + newsEscapeHtml(provenanceText) + '</figcaption>' +
    '</figure>';
}

function renderDiscoveryCard(item, index, context) {
  const tags = []
    .concat(item.relatedStocks || [])
    .concat(item.relatedSectors || [])
    .filter(Boolean)
    .map(function(tag) { return '<span class="tag">' + newsEscapeHtml(tag) + '</span>'; })
    .join('');
  const stateLabels = [];
  stateLabels.push(item.evidenceKind === 'local-fallback' ? '本地兜底' : '外部来源');
  if (context && context.degraded) stateLabels.push('数据源降级');
  const stateHtml = stateLabels.map(function(label) {
    return '<span class="status-pill">' + newsEscapeHtml(label) + '</span>';
  }).join('');
  const importanceTitle = [item.importance && item.importance.method, discoveryReasons(item.importance)].filter(Boolean).join(' | ');
  const relevanceTitle = [item.relevance && item.relevance.method, discoveryReasons(item.relevance)].filter(Boolean).join(' | ');
  return '<article class="news-item clickable" data-news-discovery-card data-news-index="' + index + '" tabindex="0">' +
    renderDiscoveryImage(item) +
    '<div class="news-meta"><span>' + newsEscapeHtml(item.source || 'WebStock') + stateHtml + '</span><span>' + newsEscapeHtml(newsFormatTime(item.time)) + '</span></div>' +
    '<h3>' + newsEscapeHtml(item.title) + '</h3>' +
    '<p>' + newsEscapeHtml(item.summary || '') + '</p>' +
    '<div class="tag-row">' + tags + '</div>' +
    '<div class="news-meta"><span data-importance-score title="' + newsEscapeHtml(importanceTitle) + '">' + newsEscapeHtml(discoveryScoreText(item.importance, '本地研究优先级')) + '</span>' +
    '<span data-relevance-score title="' + newsEscapeHtml(relevanceTitle) + '">' + newsEscapeHtml(discoveryScoreText(item.relevance, '与你相关')) + '</span></div>' +
    '<details><summary>评分依据</summary><p><strong>本地研究优先级：</strong>' + newsEscapeHtml(discoveryReasons(item.importance)) + '</p>' +
    '<p><strong>与你相关：</strong>' + newsEscapeHtml(discoveryReasons(item.relevance)) + '</p></details>' +
    '</article>';
}

function renderDiscoveryCoverage(coverage) {
  if (!coverage) return '';
  const metrics = [
    ['上游图片', coverage.upstreamImageCount, coverage.itemCount, coverage.upstreamImageRate],
    ['有效发布时间', coverage.validTimestampCount, coverage.itemCount, coverage.validTimestampRate],
    ['明确关联', coverage.explicitAssociationItemCount, coverage.itemCount, coverage.explicitAssociationRate],
    ['相关匹配', coverage.relevanceMatchedCount, coverage.relevanceEvaluatedCount, coverage.relevanceMatchedRate]
  ];
  return '<section class="news-status-line" data-discovery-coverage aria-label="资讯证据覆盖">' + metrics.map(function(metric) {
    const value = Math.max(0, Math.min(Number(metric[3]) || 0, 100));
    return '<span><strong>' + newsEscapeHtml(metric[0]) + ' ' + newsEscapeHtml(metric[1] || 0) + '/' + newsEscapeHtml(metric[2] || 0) + '</strong> ' +
      '<meter min="0" max="100" value="' + newsEscapeHtml(value) + '">' + newsEscapeHtml(value) + '%</meter> ' + newsEscapeHtml(value.toFixed(2)) + '%</span>';
  }).join(' ') + '</section>';
}

function renderDiscovery(result, containerId) {
  const box = document.getElementById(containerId || 'newsList');
  if (!box) return;
  const items = result && Array.isArray(result.items) ? result.items : [];
  const meta = result && result.sourceMeta;
  if (meta && (containerId || 'newsList') === 'newsList') updateNewsSourceFilter(meta.sources || []);
  const coverage = renderDiscoveryCoverage(result && result.coverage);
  if (!items.length) {
    box.innerHTML = newsStatusHtml(meta) + coverage + '<div class="empty-state">No news is available. If external providers fail, WebStock keeps the page usable with a friendly empty state.</div>';
    return;
  }
  box.innerHTML = newsStatusHtml(meta) + coverage + items.map(function(item, index) {
    return renderDiscoveryCard(item, index, { degraded: Boolean(result.degraded || (meta && meta.degraded)) });
  }).join('');
  bindNewsLinks(box, items);
}

function newsStatusHtml(meta) {
  if (!meta) return '';
  const providers = (meta.providers || []).map(function(provider) {
    if (provider.ok) return provider.name + ': ' + provider.count;
    const reason = provider.error ? provider.error : 'failed';
    return provider.name + ': ' + reason;
  }).join(' | ');
  const sourceList = (meta.sources || []);
  const sourceText = sourceList.length ? '来源: ' + sourceList.join(', ') : '';
  const cacheText = meta.cached ? '命中缓存 (' + humanizeAge(meta.cacheAgeMs) + ')' : '';
  const flags = [];
  if (typeof meta.itemCount === 'number') flags.push(meta.itemCount + ' items');
  if (cacheText) flags.push(cacheText);
  if (meta.degraded) flags.push('存在降级');
  if (meta.generatedAt) flags.push('更新于 ' + meta.generatedAt);
  if (providers) flags.push('providers: ' + providers);
  if (sourceText) flags.push(sourceText);
  return '<div class="news-status-line">' +
    '<span>' + newsEscapeHtml(flags.filter(Boolean).join(' | ')) + '</span>' +
    '</div>';
}

function renderNews(result, containerId) {
  const box = document.getElementById(containerId || 'newsList');
  if (!box) return;
  const items = Array.isArray(result) ? result : (result.items || []);
  const meta = Array.isArray(result) ? null : result.meta;
  if (meta && (containerId || 'newsList') === 'newsList') {
    updateNewsSourceFilter(meta.sources || []);
  }
  if (!items.length) {
    box.innerHTML = newsStatusHtml(meta) + '<div class="empty-state">No news is available. If external providers fail, WebStock keeps the page usable with a friendly empty state.</div>';
    return;
  }
  box.innerHTML = newsStatusHtml(meta) + items.map(function(item, index) {
    const tags = []
      .concat(item.relatedStocks || [])
      .concat(item.relatedSectors || [])
      .filter(Boolean)
      .map(tag => '<span class="tag">' + newsEscapeHtml(tag) + '</span>')
      .join('');
    return '<article class="news-item clickable" data-news-index="' + index + '" tabindex="0">' +
      '<div class="news-meta"><span>' + newsEscapeHtml(item.source || 'WebStock') + '</span><span>' + newsEscapeHtml(newsFormatTime(item.time)) + '</span></div>' +
      '<h3>' + newsEscapeHtml(item.title) + '</h3>' +
      '<p>' + newsEscapeHtml(item.summary || '') + '</p>' +
      '<div class="tag-row">' + tags + '</div>' +
      '</article>';
  }).join('');
  bindNewsLinks(box, items);
}

function renderNewsProviderStatus(meta) {
  const status = document.getElementById('newsProviderStatus');
  if (!status || !meta) return;
  const failed = (meta.providers || []).filter(function(provider) { return !provider.ok; });
  const active = (meta.providers || []).find(function(provider) { return provider.ok && provider.count > 0; });
  status.textContent = failed.length
    ? '新闻加载回退，失败源: ' + failed.map(function(provider) {
      return provider.name + (provider.error ? ' (' + provider.error + ')' : '');
    }).join(' | ')
    : '新闻来源: ' + (active ? active.name : 'none') + (meta.cached ? '（缓存）' : '');
}

async function load(options) {
  const requestId = ++newsDiscoveryLoadSequence;
  const result = await newsDiscoveryApi(collectDiscoveryQuery(options));
  if (requestId !== newsDiscoveryLoadSequence) return result.items;
  renderDiscovery(result, 'newsList');
  renderNewsProviderStatus(result.sourceMeta);
  return result.items;
}

async function loadDashboardNews() {
  const result = await newsApi(new URLSearchParams({ days: '7', pages: '2', num: '20' }).toString());
  const box = document.getElementById('dashboardNewsList');
  if (!box) return result.items;
  if (!result.items.length) {
    box.innerHTML = '<div class="empty-state compact">No news.</div>';
    return result.items;
  }
  const visible = result.items.slice(0, 4);
  box.innerHTML = newsStatusHtml(result.meta) + visible.map(function(item, index) {
    return '<div class="mini-news clickable" data-news-index="' + index + '" tabindex="0"><strong>' +
      newsEscapeHtml(item.title) + '</strong><p>' + newsEscapeHtml(item.summary || '') + '</p></div>';
  }).join('');
  bindNewsLinks(box, visible);
  return result.items;
}

async function loadStockNews(stock, containerId) {
  const query = new URLSearchParams({
    type: 'stock',
    code: stock.code,
    name: stock.name || stock.code,
    days: '7',
    pages: '2',
    num: '20'
  }).toString();
  const result = await newsApi(query);
  renderNews(result, containerId);
  return result.items;
}

window.News = {
  load,
  loadDashboardNews,
  loadStockNews,
  renderNews,
  renderDiscovery,
  renderDiscoveryCard,
  renderDiscoveryCoverage,
  loadSidebarNews,
  renderSidebarNews,
  renderSidebarNewsItem,
  buildDiscoveryQuery,
  bindNewsLinks,
  showNewsDetail
};
