function newsEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function humanizeAge(ageMs) {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs)) return '';
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
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
  box.innerHTML = newsStatusHtml(meta) + items.map(function(item) {
    const tags = []
      .concat(item.relatedStocks || [])
      .concat(item.relatedSectors || [])
      .filter(Boolean)
      .map(tag => '<span class="tag">' + newsEscapeHtml(tag) + '</span>')
      .join('');
    return '<article class="news-item">' +
      '<div class="news-meta"><span>' + newsEscapeHtml(item.source || 'WebStock') + '</span><span>' + newsEscapeHtml(item.time || '') + '</span></div>' +
      '<h3>' + newsEscapeHtml(item.title) + '</h3>' +
      '<p>' + newsEscapeHtml(item.summary || '') + '</p>' +
      '<div class="tag-row">' + tags + '</div>' +
      (item.link && item.link !== '#' ? '<a target="_blank" rel="noopener" href="' + newsEscapeHtml(item.link) + '">Open source</a>' : '') +
      '</article>';
  }).join('');
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
  const result = await newsApi(collectNewsQuery(options));
  renderNews(result, 'newsList');
  renderNewsProviderStatus(result.meta);
  return result.items;
}

async function loadDashboardNews() {
  const result = await newsApi('');
  const box = document.getElementById('dashboardNewsList');
  if (!box) return result.items;
  if (!result.items.length) {
    box.innerHTML = '<div class="empty-state compact">No news.</div>';
    return result.items;
  }
  box.innerHTML = newsStatusHtml(result.meta) + result.items.slice(0, 4).map(function(item) {
    return '<div class="mini-news"><strong>' + newsEscapeHtml(item.title) + '</strong><p>' + newsEscapeHtml(item.summary || '') + '</p></div>';
  }).join('');
  return result.items;
}

async function loadStockNews(stock, containerId) {
  const query = new URLSearchParams({ type: 'stock', code: stock.code, name: stock.name || stock.code }).toString();
  const result = await newsApi(query);
  renderNews(result, containerId);
  return result.items;
}

window.News = {
  load,
  loadDashboardNews,
  loadStockNews,
  renderNews
};
