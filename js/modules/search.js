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
  if (code.startsWith(q)) score = Math.max(score, 100);
  if (abbr && abbr.includes(q)) score = Math.max(score, 90);
  if (py && py.includes(q)) score = Math.max(score, 88);
  if (pinyin && pinyin.includes(q)) score = Math.max(score, 85);
  if (name.includes(q)) score = Math.max(score, 80);
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
  StockList.refreshQuotes(State.filteredStocks);
  input.focus();
}

window.Search = {
  fuzzyMatch,
  matchScore,
  searchStocks,
  toggleClearButton,
  clearSearch
};
