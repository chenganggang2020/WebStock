let lastResult = null;
let savedHistory = [];
let activeSavedTaskId = null;
let activeSavedAIResult = '';
let activeDetailItem = null;
let activeDetailNotes = {};
let activeDetailStatusFilter = 'all';
let activeDetailFilteredCodes = [];
const STRATEGY_HINTS = {
  stable: 'Stable watchlist: prioritizes lower volatility, tracked names, and portfolio context.',
  breakout: 'Trend breakout: looks for price strength, volume context, and confirmation risk.',
  pullback: 'Pullback watch: starts from tracked names near technical reset zones, not a buy signal.',
  'sector-leader': 'Sector leader: favors configured leaders and sector context for follow-up research.',
  'short-strong': 'Short-term strength: emphasizes recent momentum and liquidity; risk can rise quickly.',
  'portfolio-risk': 'Portfolio risk: scans current holdings for drawdown, weak daily moves, and concentration.'
};

function screenerApi(path, options) {
  return window.apiFetch(path, options);
}

function screenerEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectInput() {
  const marketSnapshot = (window.State.allStocks || [])
    .filter(item => item.price !== undefined || item.change !== undefined || item.amount !== undefined)
    .slice(0, 800)
    .map(item => ({
      code: item.code,
      price: item.price,
      change: item.change,
      amount: item.amount,
      volume: item.volume
    }));
  const snapshots = window.State.klineSnapshots || {};
  const klineSnapshot = Object.keys(snapshots).slice(0, 50).map(code => ({
    code,
    data: Array.isArray(snapshots[code]) ? snapshots[code].slice(-80) : []
  })).filter(item => item.data.length > 0);
  if (window.State.currentStock && Array.isArray(window.State.currentRawData) && !klineSnapshot.some(item => item.code === window.State.currentStock.code)) {
    klineSnapshot.push({
      code: window.State.currentStock.code,
      data: window.State.currentRawData.slice(-80)
    });
  }
  return {
    strategy: document.getElementById('screenerStrategy').value,
    scope: document.getElementById('screenerScope').value,
    demand: document.getElementById('screenerDemand').value.trim(),
    marketSnapshot,
    klineSnapshot,
    limit: 20
  };
}

function getResultFilters() {
  const minScoreInput = document.getElementById('screenerMinScoreInput');
  const keywordInput = document.getElementById('screenerResultKeywordInput');
  const minScore = Number(minScoreInput && minScoreInput.value !== '' ? minScoreInput.value : 0);
  return {
    minScore: Number.isFinite(minScore) ? minScore : 0,
    keyword: String(keywordInput ? keywordInput.value : '').trim().toLowerCase()
  };
}

function resetResultFilters() {
  const minScoreInput = document.getElementById('screenerMinScoreInput');
  const keywordInput = document.getElementById('screenerResultKeywordInput');
  if (minScoreInput) minScoreInput.value = '0';
  if (keywordInput) keywordInput.value = '';
}

function candidateSearchText(candidate) {
  return [
    candidate.code,
    candidate.name,
    candidate.strategy,
    candidate.observePrice,
    ...(candidate.factorTags || []),
    ...(candidate.reasons || []),
    ...(candidate.risks || [])
  ].join(' ').toLowerCase();
}

function filterResultCandidates(candidates) {
  const filters = getResultFilters();
  return (candidates || []).filter(function(candidate) {
    const score = Number(candidate.score);
    if (Number.isFinite(score) && score < filters.minScore) return false;
    if (!Number.isFinite(score) && filters.minScore > 0) return false;
    if (filters.keyword && !candidateSearchText(candidate).includes(filters.keyword)) return false;
    return true;
  });
}

function refreshResultFilters() {
  if (lastResult) renderScreenerResults(lastResult);
}

function resetAndRefreshResultFilters() {
  resetResultFilters();
  refreshResultFilters();
}

async function ensureLoaded() {
  renderStrategyHint();
  if (!lastResult) await run();
  await loadHistory().catch(function() {});
}

function renderStrategyHint() {
  const target = document.getElementById('screenerStrategyHint');
  const select = document.getElementById('screenerStrategy');
  if (!target || !select) return;
  target.textContent = STRATEGY_HINTS[select.value] || 'Candidates are for research only and are not investment advice.';
}

async function run() {
  const box = document.getElementById('screenerResults');
  if (box) box.innerHTML = '<div class="loading">正在运行本地因子筛选...</div>';
  lastResult = await screenerApi('/api/screener/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectInput())
  });
  resetResultFilters();
  activeSavedTaskId = null;
  activeSavedAIResult = '';
  renderScreenerResults(lastResult);
  await loadHistory().catch(function() {});
  return lastResult;
}

async function loadHistory() {
  savedHistory = await screenerApi('/api/screener/results?limit=8');
  renderHistory(savedHistory);
  return savedHistory;
}

async function openSavedResult(id, mode) {
  let item = savedHistory.find(function(entry) { return String(entry.id) === String(id); });
  if (!item) {
    savedHistory = await screenerApi('/api/screener/results?limit=50');
    renderHistory(savedHistory);
    item = savedHistory.find(function(entry) { return String(entry.id) === String(id); });
  }
  if (!item) {
    renderScreenerMessage('Saved screener task was not found.');
    return null;
  }
  if (mode === 'details') {
    await showSavedTaskDetail(item);
  } else {
    lastResult = item.result;
    activeSavedTaskId = item.id;
    activeSavedAIResult = item.aiResult || '';
    renderScreenerResults(lastResult);
  }
  return item;
}

function renderHistory(items) {
  const box = document.getElementById('screenerHistory');
  if (!box) return;
  if (!items || !items.length) {
    box.innerHTML = '<div class="empty-state compact">No saved screener tasks yet.</div>';
    return;
  }
  const compareToolbar = items.length >= 2 ? '<div class="history-toolbar">' +
    '<button class="small-btn" data-history-action="compare-latest">Compare latest two</button>' +
    '<label>Base <select id="screenerCompareBase">' + renderHistoryOptions(items, items[1].id) + '</select></label>' +
    '<label>Head <select id="screenerCompareHead">' + renderHistoryOptions(items, items[0].id) + '</select></label>' +
    '<button class="small-btn" data-history-action="compare-selected">Compare selected</button>' +
    '</div>' : '';
  box.innerHTML = compareToolbar +
    '<div class="screener-history-list">' + items.map(function(item, index) {
    return '<div class="history-chip" data-history-index="' + index + '">' +
      '<button class="history-open" data-history-action="open" data-history-index="' + index + '">' +
      '<strong>' + screenerEscapeHtml(item.taskName) + '</strong>' +
      '<span>' + screenerEscapeHtml(item.strategy) + ' / ' + item.candidateCount + ' candidates</span>' +
      (item.aiResult ? '<span class="history-ai-badge">AI saved</span>' : '') +
      '</button>' +
      '<div class="history-actions">' +
      '<button class="small-btn" data-history-action="details" data-history-index="' + index + '">Details</button>' +
      '<button class="small-btn" data-history-action="rename" data-history-index="' + index + '">Rename</button>' +
      '<button class="small-btn danger" data-history-action="delete" data-history-index="' + index + '">Delete</button>' +
      '</div>' +
      '</div>';
  }).join('') + '</div>';
  box.onclick = async function(event) {
    const btn = event.target.closest('[data-history-action]');
    if (!btn) return;
    try {
      const action = btn.getAttribute('data-history-action');
      if (action === 'compare-latest') {
        await compareLatestSavedResults();
        return;
      }
      if (action === 'compare-selected') {
        await compareSelectedSavedResults();
        return;
      }
      const item = savedHistory[Number(btn.getAttribute('data-history-index'))];
      if (!item) return;
      if (action === 'open') {
        if (!item.result) return;
        lastResult = item.result;
        activeSavedTaskId = item.id;
        activeSavedAIResult = item.aiResult || '';
        renderScreenerResults(lastResult);
    } else if (action === 'details') {
      await showSavedTaskDetail(item);
      } else if (action === 'rename') {
        await renameSavedResult(item);
      } else if (action === 'delete') {
        await deleteSavedResult(item);
      }
    } catch (error) {
      renderScreenerMessage(error.message || 'Screener history action failed.');
    }
  };
}

function renderHistoryOptions(items, selectedId) {
  return items.map(function(item) {
    const selected = String(item.id) === String(selectedId) ? ' selected' : '';
    return '<option value="' + item.id + '"' + selected + '>' +
      screenerEscapeHtml(item.taskName) + ' #' + item.id +
      '</option>';
  }).join('');
}

async function compareLatestSavedResults() {
  if (savedHistory.length < 2) return;
  const head = savedHistory[0];
  const base = savedHistory[1];
  await compareSavedResults(base.id, head.id);
}

async function compareSelectedSavedResults() {
  const base = document.getElementById('screenerCompareBase');
  const head = document.getElementById('screenerCompareHead');
  if (!base || !head) return;
  if (base.value === head.value) {
    renderScreenerMessage('Choose two different saved tasks to compare.');
    return;
  }
  await compareSavedResults(base.value, head.value);
}

async function compareSavedResults(baseId, headId) {
  const result = await screenerApi('/api/screener/results/compare?baseId=' + baseId + '&headId=' + headId);
  renderCompareResult(result);
}

function renderScreenerMessage(message) {
  const box = document.getElementById('screenerResults');
  if (box) box.innerHTML = '<div class="empty-state compact">' + screenerEscapeHtml(message) + '</div>';
}

function renderFactorTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return '<span class="muted">-</span>';
  return tags.slice(0, 6).map(function(tag) {
    return '<span class="factor-tag">' + screenerEscapeHtml(tag) + '</span>';
  }).join('');
}

function renderFactorBreakdown(items) {
  if (!Array.isArray(items) || !items.length) return '<span class="muted">-</span>';
  return items.slice(0, 5).map(function(item) {
    const impact = Number(item.impact || 0);
    const impactText = impact > 0 ? '+' + impact : String(impact);
    const kind = item.kind === 'risk' ? ' risk' : '';
    return '<span class="factor-impact' + kind + '" title="' + screenerEscapeHtml(item.note || '') + '">' +
      impactText + ' ' + screenerEscapeHtml(item.label) +
      '</span>';
  }).join('');
}

function renderTextList(items) {
  return screenerEscapeHtml((items || []).join('\n')).replace(/\n/g, '<br>');
}

function renderCompareResult(result) {
  const box = document.getElementById('screenerResults');
  if (!box) return;
  function list(items, emptyText, mapper) {
    if (!items || !items.length) return '<p class="muted">' + emptyText + '</p>';
    return '<ul>' + items.slice(0, 12).map(mapper).join('') + '</ul>';
  }
  box.innerHTML = '<section class="screener-compare">' +
    '<h3>Saved screener comparison</h3>' +
    '<p class="muted">' + screenerEscapeHtml(result.base.taskName) + ' -> ' + screenerEscapeHtml(result.head.taskName) + '</p>' +
    '<div class="compare-grid">' +
    '<div><h4>Added</h4>' + list(result.added, 'No added candidates.', function(item) { return '<li>' + screenerEscapeHtml(item.code) + ' ' + screenerEscapeHtml(item.name || '') + '</li>'; }) + '</div>' +
    '<div><h4>Removed</h4>' + list(result.removed, 'No removed candidates.', function(item) { return '<li>' + screenerEscapeHtml(item.code) + ' ' + screenerEscapeHtml(item.name || '') + '</li>'; }) + '</div>' +
    '<div><h4>Score changes</h4>' + list(result.changed, 'No score changes.', function(item) { return '<li>' + screenerEscapeHtml(item.code) + ' ' + screenerEscapeHtml(item.name || '') + ': ' + item.previousScore + ' -> ' + item.currentScore + ' (' + (item.delta >= 0 ? '+' : '') + item.delta + ')</li>'; }) + '</div>' +
    '</div>' +
    '</section>';
}

async function showSavedTaskDetail(item) {
  if (!activeDetailItem || activeDetailItem.id !== item.id) activeDetailStatusFilter = 'all';
  activeDetailItem = item;
  const notes = await screenerApi('/api/screener/results/' + item.id + '/notes');
  activeDetailNotes = {};
  notes.forEach(function(note) {
    activeDetailNotes[note.code] = note;
  });
  renderSavedTaskDetail(item, activeDetailNotes);
}

async function reviewSavedCandidate(code) {
  if (!activeDetailItem) return;
  const current = activeDetailNotes[code] || {};
  const status = prompt('Review status: watch, priority, risk, skip, done', current.status || 'watch');
  if (status === null) return;
  const note = prompt('Review note', current.note || '');
  if (note === null) return;
  await screenerApi('/api/screener/results/' + activeDetailItem.id + '/notes/' + encodeURIComponent(code), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note })
  });
  await showSavedTaskDetail(activeDetailItem);
}

async function clearSavedCandidateReview(code) {
  if (!activeDetailItem) return;
  await screenerApi('/api/screener/results/' + activeDetailItem.id + '/notes/' + encodeURIComponent(code), { method: 'DELETE' });
  await showSavedTaskDetail(activeDetailItem);
}

async function bulkReviewFilteredCandidates() {
  if (!activeDetailItem || !activeDetailFilteredCodes.length) return;
  const status = prompt('Bulk review status: watch, priority, risk, skip, done', 'watch');
  if (status === null) return;
  const note = prompt('Bulk review note', '');
  if (note === null) return;
  await screenerApi('/api/screener/results/' + activeDetailItem.id + '/notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes: activeDetailFilteredCodes, status, note })
  });
  await showSavedTaskDetail(activeDetailItem);
}

function reviewStatusFor(candidate, notesByCode) {
  const note = notesByCode && notesByCode[candidate.code] ? notesByCode[candidate.code] : null;
  return note ? note.status : 'unreviewed';
}

function renderReviewSummary(candidates, notesByCode) {
  const counts = { unreviewed: 0, watch: 0, priority: 0, risk: 0, skip: 0, done: 0 };
  candidates.forEach(function(candidate) {
    const status = reviewStatusFor(candidate, notesByCode);
    counts[status] = (counts[status] || 0) + 1;
  });
  return '<div class="review-summary">' +
    Object.keys(counts).map(function(status) {
      return '<span>' + status + ': ' + counts[status] + '</span>';
    }).join('') +
    '</div>';
}

function renderReviewFilter(selected) {
  const options = [
    ['all', 'All'],
    ['unreviewed', 'Unreviewed'],
    ['watch', 'Watch'],
    ['priority', 'Priority'],
    ['risk', 'Risk'],
    ['skip', 'Skip'],
    ['done', 'Done']
  ];
  return '<label class="review-filter">Status <select id="candidateReviewFilter" data-detail-filter="status">' +
    options.map(function(option) {
      return '<option value="' + option[0] + '"' + (selected === option[0] ? ' selected' : '') + '>' + option[1] + '</option>';
    }).join('') +
    '</select></label>';
}

function renderSavedTaskDetail(item, notesByCode) {
  const box = document.getElementById('screenerResults');
  if (!box) return;
  const result = item.result || {};
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const filteredCandidates = candidates.filter(function(candidate) {
    if (activeDetailStatusFilter === 'all') return true;
    return reviewStatusFor(candidate, notesByCode) === activeDetailStatusFilter;
  });
  activeDetailFilteredCodes = filteredCandidates.map(function(candidate) { return candidate.code; });
  const rows = filteredCandidates.slice(0, 20).map(function(candidate) {
    const note = notesByCode && notesByCode[candidate.code] ? notesByCode[candidate.code] : null;
    return '<tr>' +
      '<td>' + screenerEscapeHtml(candidate.code) + '</td>' +
      '<td>' + screenerEscapeHtml(candidate.name || '') + '</td>' +
      '<td><span class="score-pill">' + screenerEscapeHtml(candidate.score) + '</span></td>' +
      '<td>' + screenerEscapeHtml(candidate.strategy || '') + '</td>' +
      '<td>' + renderFactorBreakdown(candidate.factorBreakdown) + '</td>' +
      '<td>' + (note ? '<span class="review-status">' + screenerEscapeHtml(note.status) + '</span><div class="muted">' + screenerEscapeHtml(note.note) + '</div>' : '<span class="muted">-</span>') + '</td>' +
      '<td>' + screenerEscapeHtml((candidate.reasons || []).join('; ')) + '</td>' +
      '<td>' + screenerEscapeHtml((candidate.risks || []).join('; ')) + '</td>' +
      '<td><div class="stock-actions">' +
      '<button class="small-btn" data-detail-action="review" data-code="' + screenerEscapeHtml(candidate.code) + '">Review</button>' +
      (note ? '<button class="small-btn danger" data-detail-action="clearReview" data-code="' + screenerEscapeHtml(candidate.code) + '">Clear</button>' : '') +
      '</div></td>' +
      '</tr>';
  }).join('');
  box.innerHTML = '<section class="saved-task-detail">' +
    '<h3>Saved screener task</h3>' +
    '<p class="muted">' + screenerEscapeHtml(item.taskName) + ' / ' + screenerEscapeHtml(item.strategy) + ' / ' + item.candidateCount + ' candidates</p>' +
    '<div class="review-tools">' + renderReviewSummary(candidates, notesByCode) + renderReviewFilter(activeDetailStatusFilter) + '<button class="small-btn" data-detail-action="bulkReview">Bulk mark filtered</button></div>' +
    (rows ? '<table class="data-table"><thead><tr><th>Code</th><th>Name</th><th>Score</th><th>Strategy</th><th>Contributions</th><th>Review</th><th>Reasons</th><th>Risks</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="empty-state compact">No candidates match the review filter.</div>') +
    (item.aiResult ? '<section class="saved-ai-result"><h3>Saved AI explanation</h3><pre>' + screenerEscapeHtml(item.aiResult) + '</pre></section>' : '') +
    '</section>';
  box.onchange = function(event) {
    const select = event.target.closest('[data-detail-filter="status"]');
    if (!select) return;
    activeDetailStatusFilter = select.value;
    renderSavedTaskDetail(activeDetailItem, activeDetailNotes);
  };
  box.onclick = async function(event) {
    const btn = event.target.closest('[data-detail-action]');
    if (!btn) return;
    const code = btn.getAttribute('data-code');
    try {
      if (btn.getAttribute('data-detail-action') === 'review') await reviewSavedCandidate(code);
      else if (btn.getAttribute('data-detail-action') === 'clearReview') await clearSavedCandidateReview(code);
      else if (btn.getAttribute('data-detail-action') === 'bulkReview') await bulkReviewFilteredCandidates();
    } catch (error) {
      renderScreenerMessage(error.message || 'Candidate review update failed.');
    }
  };
}

async function saveCurrent() {
  if (!lastResult) await run();
  const taskName = prompt('保存任务名称', lastResult.demand || lastResult.strategy || 'Screener task');
  if (taskName === null) return null;
  const saved = await screenerApi('/api/screener/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskName, result: lastResult })
  });
  activeSavedTaskId = saved.id;
  activeSavedAIResult = saved.aiResult || '';
  await loadHistory();
  return saved;
}

function csvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}

function buildCandidatesCsv(result) {
  const header = ['code', 'name', 'score', 'strategy', 'factorTags', 'factorBreakdown', 'reasons', 'risks', 'observePrice'];
  const rows = (result.candidates || []).map(function(item) {
    return [
      item.code,
      item.name,
      item.score,
      item.strategy,
      (item.factorTags || []).join('; '),
      (item.factorBreakdown || []).map(function(factor) {
        const impact = Number(factor.impact || 0);
        return (impact > 0 ? '+' + impact : String(impact)) + ' ' + factor.label;
      }).join('; '),
      (item.reasons || []).join('; '),
      (item.risks || []).join('; '),
      item.observePrice
    ].map(csvCell).join(',');
  });
  return header.map(csvCell).join(',') + '\n' + rows.join('\n');
}

async function exportCurrentCsv() {
  if (!lastResult) await run();
  const visibleCandidates = filterResultCandidates(lastResult.candidates || []);
  if (!visibleCandidates.length) {
    renderScreenerMessage('No filtered screener candidates to export.');
    return;
  }
  const csv = '\ufeff' + buildCandidatesCsv(Object.assign({}, lastResult, { candidates: visibleCandidates }));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = window.WebStockTime ? window.WebStockTime.filenameDate() : new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = 'webstock-screener-' + stamp + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

async function updateSavedAIResult(id, aiResult) {
  if (!id || !aiResult) return null;
  const saved = await screenerApi('/api/screener/results/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiResult })
  });
  activeSavedAIResult = saved.aiResult || '';
  if (lastResult) renderScreenerResults(lastResult);
  await loadHistory();
  return saved;
}

async function renameSavedResult(item) {
  const taskName = prompt('新任务名称', item.taskName || 'Screener task');
  if (taskName === null) return;
  await screenerApi('/api/screener/results/' + item.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskName })
  });
  await loadHistory();
}

async function deleteSavedResult(item) {
  if (!confirm('Delete saved screener task "' + item.taskName + '"?')) return;
  await screenerApi('/api/screener/results/' + item.id, { method: 'DELETE' });
  await loadHistory();
}

function renderScreenerResults(result) {
  const box = document.getElementById('screenerResults');
  if (!box) return;
  if (!result.candidates || !result.candidates.length) {
    box.innerHTML = '<div class="empty-state">暂无候选结果，请调整策略或范围。</div>';
    return;
  }
  box.innerHTML = '<table class="data-table screener-table"><thead><tr><th>代码</th><th>名称</th><th>得分</th><th>策略</th><th>因子</th><th>贡献</th><th>入选理由</th><th>风险点</th><th>观察价位</th><th>操作</th></tr></thead><tbody>' +
    result.candidates.map(function(item) {
      return '<tr>' +
        '<td>' + screenerEscapeHtml(item.code) + '</td>' +
        '<td>' + screenerEscapeHtml(item.name) + '</td>' +
        '<td><span class="score-pill">' + screenerEscapeHtml(item.score) + '</span></td>' +
        '<td>' + screenerEscapeHtml(item.strategy) + '</td>' +
        '<td>' + renderFactorTags(item.factorTags) + '</td>' +
        '<td>' + renderFactorBreakdown(item.factorBreakdown) + '</td>' +
        '<td>' + renderTextList(item.reasons) + '</td>' +
        '<td>' + renderTextList(item.risks) + '</td>' +
        '<td>' + screenerEscapeHtml(item.observePrice) + '</td>' +
        '<td><div class="stock-actions">' +
        '<button class="small-btn primary" data-action="view" data-code="' + screenerEscapeHtml(item.code) + '">查看</button>' +
        '<button class="small-btn" data-action="watchlist" data-code="' + screenerEscapeHtml(item.code) + '">自选</button>' +
        '<button class="small-btn" data-action="trade" data-code="' + screenerEscapeHtml(item.code) + '">持仓</button>' +
        '<button class="small-btn" data-action="sector" data-code="' + screenerEscapeHtml(item.code) + '">板块监控</button>' +
        '<button class="small-btn" data-action="analysis" data-code="' + screenerEscapeHtml(item.code) + '">AI分析</button>' +
        '</div></td>' +
        '</tr>';
    }).join('') + '</tbody></table>' +
    '<div class="disclaimer">' + result.disclaimer + '</div>' +
    (activeSavedAIResult ? '<section class="saved-ai-result"><h3>Saved AI explanation</h3><pre>' + screenerEscapeHtml(activeSavedAIResult) + '</pre></section>' : '');
  bindScreenerActions(box);
}

function renderFilteredScreenerResults(result) {
  const box = document.getElementById('screenerResults');
  if (!box) return;
  const allCandidates = (result && Array.isArray(result.candidates)) ? result.candidates : [];
  if (!allCandidates.length) {
    box.innerHTML = '<div class="empty-state">No screener candidates. Adjust the strategy or scope and run again.</div>';
    return;
  }
  const candidates = filterResultCandidates(allCandidates);
  const summary = '<div class="screener-result-summary">Showing ' + candidates.length + ' of ' + allCandidates.length + ' candidates after local filters.</div>';
  if (!candidates.length) {
    box.innerHTML = summary + '<div class="empty-state compact">No candidates match current result filters.</div>' +
      '<div class="disclaimer">' + screenerEscapeHtml(result.disclaimer || '') + '</div>';
    return;
  }
  box.innerHTML = summary +
    '<table class="data-table screener-table"><thead><tr><th>Code</th><th>Name</th><th>Score</th><th>Strategy</th><th>Factors</th><th>Contributions</th><th>Reasons</th><th>Risks</th><th>Observe</th><th>Actions</th></tr></thead><tbody>' +
    candidates.map(function(item) {
      return '<tr>' +
        '<td>' + screenerEscapeHtml(item.code) + '</td>' +
        '<td>' + screenerEscapeHtml(item.name) + '</td>' +
        '<td><span class="score-pill">' + screenerEscapeHtml(item.score) + '</span></td>' +
        '<td>' + screenerEscapeHtml(item.strategy) + '</td>' +
        '<td>' + renderFactorTags(item.factorTags) + '</td>' +
        '<td>' + renderFactorBreakdown(item.factorBreakdown) + '</td>' +
        '<td>' + renderTextList(item.reasons) + '</td>' +
        '<td>' + renderTextList(item.risks) + '</td>' +
        '<td>' + screenerEscapeHtml(item.observePrice) + '</td>' +
        '<td><div class="stock-actions">' +
        '<button class="small-btn primary" data-action="view" data-code="' + screenerEscapeHtml(item.code) + '">查看</button>' +
        '<button class="small-btn" data-action="watchlist" data-code="' + screenerEscapeHtml(item.code) + '">自选</button>' +
        '<button class="small-btn" data-action="trade" data-code="' + screenerEscapeHtml(item.code) + '">持仓</button>' +
        '<button class="small-btn" data-action="sector" data-code="' + screenerEscapeHtml(item.code) + '">板块监控</button>' +
        '<button class="small-btn" data-action="analysis" data-code="' + screenerEscapeHtml(item.code) + '">AI分析</button>' +
        '</div></td>' +
        '</tr>';
    }).join('') + '</tbody></table>' +
    '<div class="disclaimer">' + screenerEscapeHtml(result.disclaimer || '') + '</div>' +
    (activeSavedAIResult ? '<section class="saved-ai-result"><h3>Saved AI explanation</h3><pre>' + screenerEscapeHtml(activeSavedAIResult) + '</pre></section>' : '');
  bindScreenerActions(box);
}

renderScreenerResults = renderFilteredScreenerResults;

function screenerStockByCode(code) {
  const candidate = lastResult && lastResult.candidates.find(item => item.code === code);
  return (window.State.allStocks || []).find(item => item.code === code) ||
    (window.State.watchlist || []).find(item => item.code === code) ||
    (window.State.recentStocks || []).find(item => item.code === code) ||
    (window.State.positions || []).find(item => item.code === code) ||
    candidate ||
    { code, name: code };
}

function bindScreenerActions(box) {
  box.onclick = async function(event) {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const code = btn.getAttribute('data-code');
    const stock = screenerStockByCode(code);
    try {
      if (action === 'view') {
        window.switchMainView('market');
        await window.StockList.selectStock(stock);
      } else if (action === 'watchlist') {
        await window.Watchlist.addStock(stock);
      } else if (action === 'sector') {
        window.switchMainView('sectors');
        await window.SectorLeaders.load();
      } else if (action === 'analysis') {
        window.switchMainView('market');
        await window.StockList.selectStock(stock);
        window.Analysis.openAnalysisPanel(stock);
      } else if (action === 'trade') {
        if (window.Portfolio) window.Portfolio.openBuyTrade(stock);
        else window.Trades.openTradeModal('new', null, Object.assign({ side: 'buy' }, stock));
      }
    } catch (error) {
      alert(error.message || '候选操作失败');
    }
  };
}

async function runAI() {
  if (!lastResult) await run();
  const data = await screenerApi('/api/screener/ai-explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lastResult)
  });
  if (data.handoffMode && window.AIAssistant) {
    window.AIAssistant.open({
      title: '智能选股 ChatGPT 交接',
      prompt: data.prompt,
      summary: '已生成更严格的 GPT 二次筛选提示词。请复制到 ChatGPT，让它按“优先观察 / 等待确认 / 暂时剔除”重新整理候选股。',
      kind: 'screener',
      context: { view: 'screener', taskId: activeSavedTaskId || null },
      onSave: async function(result) {
        if (activeSavedTaskId) await updateSavedAIResult(activeSavedTaskId, result);
      }
    });
  } else {
    if (activeSavedTaskId) await updateSavedAIResult(activeSavedTaskId, data.report);
    if (window.AIAssistant && window.AIAssistant.saveHistoryRecord) {
      window.AIAssistant.saveHistoryRecord({
        title: '智能选股 AI 分析',
        summary: 'AI API 直接返回的智能选股解释。',
        prompt: data.prompt || '',
        result: data.report,
        kind: 'screener',
        context: { view: 'screener', taskId: activeSavedTaskId || null }
      });
    }
    const overlay = document.getElementById('analysisOverlay');
    const body = document.getElementById('analysisPanelBody');
    overlay.style.display = 'flex';
    body.innerHTML = '<div class="md-body">' + window.Analysis.simpleMarkdown(data.report) + '</div>';
  }
}

window.StockScreener = {
  run,
  runAI,
  ensureLoaded,
  renderStrategyHint,
  refreshResultFilters,
  resetAndRefreshResultFilters,
  render: renderScreenerResults,
  saveCurrent,
  exportCurrentCsv,
  loadHistory,
  openSavedResult,
  renameSavedResult,
  deleteSavedResult,
  updateSavedAIResult,
  compareLatestSavedResults,
  compareSelectedSavedResults,
  showSavedTaskDetail,
  renderSavedTaskDetail
};
