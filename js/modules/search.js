function fuzzyMatch(q, t) {
  if (!q) return true;
  q = q.toLowerCase().replace(/\s+/g, '');
  t = t.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0, ti = 0;
  while (qi < q.length && ti < t.length) { if (q[qi] === t[ti]) qi++; ti++; }
  return qi === q.length;
}

function matchScore(query, stock) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  let score = 0;
  const code = (stock.code || '').toLowerCase(), name = (stock.name || '').toLowerCase();
  const abbr = (stock.abbr || '').toLowerCase();
  const pinyin = (stock.pinyin || '').toLowerCase();
  const py = (stock.py || '').toLowerCase();
  const tagText = []
    .concat(stock.tags || [])
    .concat(stock.boards || [])
    .concat(stock.industry || [])
    .concat((stock.mainBusinessItems || []).map(item => item.name))
    .concat(stock.businessSummary || [])
    .concat(stock.businessScope || [])
    .concat((stock.themes || []).flatMap(theme => [theme.name, theme.role, theme.reason]))
    .join('')
    .toLowerCase();
  if (code.startsWith(q)) score = Math.max(score, 100);
  if (abbr && abbr.includes(q)) score = Math.max(score, 90);
  if (py && py.includes(q)) score = Math.max(score, 88);
  if (pinyin && pinyin.includes(q)) score = Math.max(score, 85);
  if (name.includes(q)) score = Math.max(score, 80);
  if (tagText && tagText.includes(q)) score = Math.max(score, 70);
  if (fuzzyMatch(query, stock.name) || fuzzyMatch(query, stock.code)) score = Math.max(score, 40);
  return score;
}

function searchStocks(query) {
  const State = window.State;
  if (!query.trim()) return State.allStocks;
  const res = [];
  for (const s of State.allStocks) { const sc = matchScore(query, s); if (sc > 0) res.push({ ...s, score: sc }); }
  res.sort((a, b) => b.score - a.score);
  return res;
}

let deepSearchSeq = 0;
const SEARCH_HISTORY_KEY = 'webstock_search_history';

function searchHistoryEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
  } catch (error) {
    return [];
  }
}

function saveSearchHistory(keyword, stock) {
  const text = String(keyword || '').trim();
  if (!text) return;
  const item = {
    keyword: text,
    code: stock && stock.code ? stock.code : '',
    name: stock && stock.name ? stock.name : '',
    time: Date.now()
  };
  const next = [item].concat(getSearchHistory().filter(function(entry) {
    return entry.keyword !== item.keyword;
  })).slice(0, 12);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
}

function renderSearchHistory(filter) {
  const panel = document.getElementById('searchHistoryPanel');
  if (!panel) return;
  const keyword = String(filter || '').trim().toLowerCase();
  const items = getSearchHistory().filter(function(item) {
    if (!keyword) return true;
    return String(item.keyword || '').toLowerCase().includes(keyword) ||
      String(item.code || '').includes(keyword) ||
      String(item.name || '').toLowerCase().includes(keyword);
  }).slice(0, 8);
  if (!items.length) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  panel.innerHTML = items.map(function(item) {
    const sub = [item.code, item.name].filter(Boolean).join(' ');
    return '<button class="search-history-item" type="button" data-keyword="' + searchHistoryEscape(item.keyword) + '">' +
      '<strong>' + searchHistoryEscape(item.keyword) + '</strong>' +
      '<span>' + searchHistoryEscape(sub) + '</span>' +
      '</button>';
  }).join('');
  panel.style.display = 'block';
}

function hideSearchHistory() {
  const panel = document.getElementById('searchHistoryPanel');
  if (panel) panel.style.display = 'none';
}

function mergeSearchResults(localResults, remotePayload) {
  const State = window.State;
  const byCode = new Map();
  (localResults || []).forEach(function(stock) {
    if (stock && stock.code) byCode.set(stock.code, stock);
  });
  function addRemote(stock) {
    if (!stock || !stock.code) return;
    const existing = byCode.get(stock.code) || State.allStocks.find(function(item) { return item.code === stock.code; });
    byCode.set(stock.code, Object.assign({}, existing || {}, stock, {
      score: Math.max(Number(stock.score) || 0, existing && existing.score ? existing.score : 0)
    }));
  }
  (remotePayload && remotePayload.stocks || []).forEach(addRemote);
  (remotePayload && remotePayload.themes || []).forEach(function(theme) {
    (theme.leaders || []).forEach(function(leader) {
      addRemote(Object.assign({}, leader, {
        score: Math.max(Number(leader.score) || 0, 72),
        matchReason: theme.name + '：' + (leader.role || leader.reason || '主题龙头')
      }));
    });
  });
  return Array.from(byCode.values()).sort(function(a, b) {
    return (b.score || 0) - (a.score || 0);
  });
}

async function searchStocksDeep(query, localResults) {
  const keyword = String(query || '').trim();
  const seq = ++deepSearchSeq;
  if (keyword.length < 2 || /^\d+$/.test(keyword) || !window.ApiClient) return null;
  try {
    const payload = await window.ApiClient.fetchJsonData('/api/stock-search?q=' + encodeURIComponent(keyword) + '&limit=80');
    if (seq !== deepSearchSeq) return null;
    return mergeSearchResults(localResults || [], payload || {});
  } catch (error) {
    console.warn(error.message || error);
    return localResults || [];
  }
}

function toggleClearButton() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearBtn');
  if (input.value.trim().length > 0) {
    clearBtn.classList.add('visible');
  } else {
    clearBtn.classList.remove('visible');
  }
}

function clearSearch() {
  const State = window.State;
  const StockList = window.StockList;
  const input = document.getElementById('searchInput');
  input.value = '';
  toggleClearButton();
  State.currentPage = 0;
  State.searchResults = [];
  State.filteredStocks = State.allStocks.slice(0, State.PAGE_SIZE);
  StockList.renderStockTable(State.filteredStocks);
  if (window.HotMarket) window.HotMarket.syncSearchMode();
  StockList.refreshQuotes(State.filteredStocks).catch(function(error) { console.warn(error.message || error); });
  renderSearchHistory('');
  input.focus();
}

window.Search = {
  fuzzyMatch,
  matchScore,
  searchStocks,
  searchStocksDeep,
  mergeSearchResults,
  toggleClearButton,
  clearSearch,
  getSearchHistory,
  saveSearchHistory,
  renderSearchHistory,
  hideSearchHistory
};
