function aiHistoryEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function aiHistoryKindLabel(kind) {
  const labels = {
    stock: '个股分析',
    screener: '智能选股',
    sector: '板块龙头',
    portfolio: '组合诊断'
  };
  return labels[kind] || 'AI记录';
}

function aiHistoryItems() {
  try {
    return window.AIAssistant && window.AIAssistant.getSavedResults
      ? window.AIAssistant.getSavedResults()
      : JSON.parse(localStorage.getItem('webstock_ai_handoff_results') || '[]');
  } catch (error) {
    return [];
  }
}

function aiHistoryRender() {
  const target = document.getElementById('aiHistoryList');
  if (!target) return;
  const filter = document.getElementById('aiHistoryKindFilter') ? document.getElementById('aiHistoryKindFilter').value : '';
  const items = aiHistoryItems().filter(function(item) {
    return !filter || item.kind === filter;
  });
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  if (!items.length) {
    target.innerHTML = '<div class="empty-state compact">暂无 AI 对话记录。运行智能选股、板块龙头或组合诊断后，可以把 ChatGPT 返回内容保存到这里。</div>';
    return;
  }
  target.innerHTML = items.slice(0, 60).map(function(item) {
    const savedAt = item.savedAt ? new Date(item.savedAt).toLocaleString() : '--';
    const result = item.result || '';
    const prompt = item.prompt || '';
    return '<article class="ai-history-card">' +
      '<header>' +
        '<div><h3>' + aiHistoryEscape(item.title || 'ChatGPT 交接结果') + '</h3>' +
        '<div class="handoff-result-meta">' + aiHistoryEscape(savedAt) + ' / ' + aiHistoryEscape(aiHistoryKindLabel(item.kind)) + '</div></div>' +
        '<span class="status-pill">' + aiHistoryEscape(aiHistoryKindLabel(item.kind)) + '</span>' +
      '</header>' +
      (item.summary ? '<p>' + aiHistoryEscape(item.summary) + '</p>' : '') +
      '<pre>' + aiHistoryEscape(result).slice(0, 1600) + '</pre>' +
      (prompt ? '<details><summary>查看提示词</summary><pre>' + aiHistoryEscape(prompt).slice(0, 3000) + '</pre></details>' : '') +
      '</article>';
  }).join('');
}

function aiHistoryClear() {
  if (!confirm('清空本地 AI 对话记录？')) return;
  localStorage.removeItem('webstock_ai_handoff_results');
  aiHistoryRender();
  if (window.Settings) window.Settings.renderSavedResults();
}

function aiHistoryBind() {
  const filter = document.getElementById('aiHistoryKindFilter');
  if (filter && !filter.dataset.bound) {
    filter.dataset.bound = '1';
    filter.addEventListener('change', aiHistoryRender);
  }
  const refresh = document.getElementById('refreshAiHistoryBtn');
  if (refresh && !refresh.dataset.bound) {
    refresh.dataset.bound = '1';
    refresh.addEventListener('click', aiHistoryRender);
  }
  const clear = document.getElementById('clearAiHistoryBtn');
  if (clear && !clear.dataset.bound) {
    clear.dataset.bound = '1';
    clear.addEventListener('click', aiHistoryClear);
  }
}

window.AIHistory = {
  bind: aiHistoryBind,
  render: aiHistoryRender,
  clear: aiHistoryClear,
  items: aiHistoryItems
};
