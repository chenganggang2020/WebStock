function copyAnalysisData() {
  const text = window.currentPromptText || '';
  if (!text) {
    alert('暂无提示词内容可复制，请先执行 AI 分析。');
    return;
  }
  navigator.clipboard.writeText(text).then(function() {
    const btn = document.querySelector('button[data-copy-analysis], button[onclick="copyAnalysisData()"]');
    if (btn) {
      const oldText = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function() { btn.textContent = oldText; }, 2000);
    }
  }).catch(function() {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('已复制到剪贴板');
  });
}

function simpleMarkdown(md) {
  let html = String(md || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  html = html.replace(/((?:^[^\n]+\|[^\n]+\n)+)/gm, function(block) {
    const rows = block.trim().split('\n');
    if (rows.length < 2) return block;
    let tbl = '<table>';
    rows.forEach(function(row, i) {
      if (/^\|[\s\-:|]+\|/.test(row) || /^[\s\-:|]+\|/.test(row)) return;
      const cells = row.replace(/^\||\|$/g, '').split('|').map(function(c) { return c.trim(); });
      const tag = i === 0 ? 'th' : 'td';
      tbl += '<tr>' + cells.map(function(c) { return '<' + tag + '>' + c + '</' + tag + '>'; }).join('') + '</tr>';
    });
    tbl += '</table>';
    return tbl;
  });

  html = html.replace(/((?:^- .+\n?)+)/gm, function(block) {
    const items = block.trim().split('\n').map(function(l) { return '<li>' + l.replace(/^- /, '') + '</li>'; }).join('');
    return '<ul>' + items + '</ul>';
  });

  html = html.split(/\n{2,}/).map(function(p) {
    p = p.trim();
    if (!p) return '';
    if (/^<(h[1-3]|ul|table|hr|blockquote)/.test(p)) return p;
    return '<p>' + p.replace(/\n/g, '<br/>') + '</p>';
  }).join('\n');

  return html;
}

function setAnalysisStatus(text) {
  const badge = document.getElementById('aiStatusBadge');
  if (badge) badge.textContent = text || '';
}

function renderPromptHandoff(body, prompt) {
  window.currentPromptText = prompt || '';
  body.innerHTML = '<div class="analysis-handoff">' +
    '<h3>ChatGPT 交接模式</h3>' +
    '<p>当前未配置可用 OpenAI API Key，系统已生成完整提示词。复制后可在 ChatGPT 中继续分析，返回内容可手动保存到当前任务。</p>' +
    '<div class="handoff-actions">' +
    '<button class="small-btn primary" onclick="window.Analysis.openPromptHandoff(true)">复制并打开 ChatGPT</button>' +
    '<button class="small-btn" data-copy-analysis onclick="copyAnalysisData()">仅复制提示词</button>' +
    '<button class="small-btn" onclick="window.Analysis.openPromptHandoff()">保存返回结果</button>' +
    '</div>' +
    '</div>' +
    '<div class="md-body prompt-preview">' + simpleMarkdown(prompt) + '</div>';
}

function openPromptHandoff(copyAndOpen) {
  if (!window.AIAssistant) return;
  const stock = window.State && window.State.currentStock ? window.State.currentStock : {};
  window.AIAssistant.open({
    title: '个股分析 ChatGPT 交接',
    summary: '保存 ChatGPT 返回的个股分析结果，便于后续回看。',
    prompt: window.currentPromptText || '',
    promptStyle: 'technical',
    kind: 'stock',
    context: { view: 'market', code: stock.code || '', name: stock.name || '' }
  });
  if (copyAndOpen && window.AIAssistant.copyAndOpenChatGPT) {
    setTimeout(window.AIAssistant.copyAndOpenChatGPT, 0);
  }
}

function openAnalysisPanel(stock) {
  const overlay = document.getElementById('analysisOverlay');
  const body = document.getElementById('analysisPanelBody');
  const refreshBtn = document.getElementById('analysisRefreshBtn');
  if (!overlay || !body) return;

  if (window.currentAnalysisSource) {
    window.currentAnalysisSource.close();
    window.currentAnalysisSource = null;
  }

  overlay.style.display = 'flex';
  body.innerHTML = '<div class="analysis-loading"><div class="analysis-spinner"></div><span>正在获取数据并生成分析报告，请稍候...</span></div>';
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.style.display = '';
  }
  setAnalysisStatus('AI 分析准备中');

  const url = '/api/analysis-stream?code=' + encodeURIComponent(stock.code) + '&name=' + encodeURIComponent(stock.name || stock.code);
  const source = new EventSource(url);
  window.currentAnalysisSource = source;
  let fullText = '';
  let hasEvent = false;

  source.onmessage = function(message) {
    hasEvent = true;
    let ev;
    try {
      ev = JSON.parse(message.data);
    } catch (error) {
      console.warn('分析流解析失败', error);
      return;
    }

    if (ev.type === 'start') {
      setAnalysisStatus('AI 大模型分析中');
      body.innerHTML = '<div class="analysis-loading"><div class="analysis-spinner"></div><span>AI 正在分析...</span></div>';
      return;
    }
    if (ev.type === 'chunk') {
      fullText += ev.content || '';
      body.innerHTML = '<div class="md-body">' + simpleMarkdown(fullText) + '</div>';
      return;
    }
    if (ev.type === 'simulated') {
      renderPromptHandoff(body, ev.prompt || ev.promptText || '');
      setAnalysisStatus('ChatGPT 交接模式');
      if (refreshBtn) refreshBtn.style.display = 'none';
      source.close();
      window.currentAnalysisSource = null;
      return;
    }
    if (ev.type === 'error') {
      body.innerHTML = '<div class="error-state">生成失败：' + (ev.error || '分析服务异常') + '<br>可以稍后重试，或使用 ChatGPT 交接模式。</div>';
      setAnalysisStatus('');
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.style.display = '';
      }
      source.close();
      window.currentAnalysisSource = null;
      return;
    }
    if (ev.type === 'done') {
      if (!fullText) body.innerHTML = '<div class="empty-state">分析完成，但没有收到有效内容。</div>';
      if (fullText && window.AIAssistant && window.AIAssistant.saveHistoryRecord) {
        window.AIAssistant.saveHistoryRecord({
          title: '个股 AI 分析 ' + (stock.name || stock.code),
          summary: stock.code || '',
          prompt: window.currentPromptText || '',
          result: fullText,
          kind: 'stock',
          context: { view: 'market', code: stock.code, name: stock.name || stock.code }
        });
      }
      setAnalysisStatus('AI 分析完成');
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.style.display = '';
      }
      source.close();
      window.currentAnalysisSource = null;
    }
  };

  source.onerror = function() {
    if (!hasEvent) {
      body.innerHTML = '<div class="error-state">分析服务连接失败，请检查后端接口或网络状态。</div>';
      setAnalysisStatus('');
    }
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.style.display = '';
    }
    source.close();
    window.currentAnalysisSource = null;
  };
}

function closeAnalysisPanel() {
  if (window.currentAnalysisSource) {
    window.currentAnalysisSource.close();
    window.currentAnalysisSource = null;
  }
  const overlay = document.getElementById('analysisOverlay');
  if (overlay) overlay.style.display = 'none';
}

window.copyAnalysisData = copyAnalysisData;
window.Analysis = {
  copyAnalysisData,
  simpleMarkdown,
  openPromptHandoff,
  openAnalysisPanel,
  closeAnalysisPanel
};
