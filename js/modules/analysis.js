function copyAnalysisData() {
  const text = window.currentPromptText || '';
  if (!text) {
    alert('暂无提示词内容可复制，请先执行 AI 分析。');
    return;
  }
  navigator.clipboard.writeText(text).then(function() {
    const btn = document.querySelector('button[onclick="copyAnalysisData()"]');
    if (btn) {
      btn.textContent = '✅ 已复制提示词到剪贴板';
      setTimeout(function() { btn.textContent = '📋 一键复制分析提示词'; }, 2000);
    }
  }).catch(function() {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const btn = document.querySelector('button[onclick="copyAnalysisData()"]');
    if (btn) {
      btn.textContent = '✅ 已复制提示词到剪贴板';
      setTimeout(function() { btn.textContent = '📋 一键复制分析提示词'; }, 2000);
    }
  });
}

function simpleMarkdown(md) {
  let html = md
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

function openAnalysisPanel(stock, forceRefresh) {
  const overlay = document.getElementById('analysisOverlay');
  const body = document.getElementById('analysisPanelBody');
  const badge = document.getElementById('aiStatusBadge');
  const refreshBtn = document.getElementById('analysisRefreshBtn');
  overlay.style.display = 'flex';
  body.innerHTML = '<div class="analysis-loading"><div class="analysis-spinner"></div><span>正在获取数据并生成分析报告，请稍候…</span></div>';
  refreshBtn.disabled = true;
  refreshBtn.style.display = '';

  fetch('/api/analysis-stream?code=' + stock.code + '&name=' + encodeURIComponent(stock.name))
    .then(function(r) {
      if (!r.ok) throw new Error('请求失败: ' + r.status);
      return r.body;
    })
    .then(function(stream) {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let streaming = false;
      let simulatedMode = false;

      function showLoading(icon) {
        body.innerHTML = '<div class="analysis-loading"><div class="analysis-spinner"></div><span>' + icon + '…</span></div>';
      }

      function renderMarkdown(text) {
        body.innerHTML = '<div class="md-body">' + simpleMarkdown(text) + '</div>';
      }

      function read() {
        reader.read().then(function(result) {
          if (result.done) return;

          const text = decoder.decode(result.value, { stream: true });
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.startsWith('data: ')) continue;
            const rawData = line.slice(6).trim();
            if (!rawData) continue;
            try {
              const ev = JSON.parse(rawData);
              if (ev.type === 'start') {
                streaming = true;
                showLoading('🤖 AI 正在深度分析');
                if (badge) badge.textContent = '🟢 AI 大模型分析中…';
              } else if (ev.type === 'chunk') {
                if (!simulatedMode) {
                  fullText += ev.content;
                  renderMarkdown(fullText);
                }
              } else if (ev.type === 'simulated') {
                simulatedMode = true;
                window.currentPromptText = ev.prompt || '';
                const infoHtml = '<div style="background:#fff3cd;color:#856404;padding:16px 18px;border-radius:8px;margin-bottom:16px;font-size:14px;line-height:1.8;border:1px solid #ffeeba;">' +
                  '<div style="font-weight:bold;margin-bottom:10px;font-size:15px;">⚠️ AI 模拟模式 - API Key 缺失或无效</div>' +
                  '<div style="margin-bottom:8px;">由于 API Key 配置缺失或错误，系统无法调用 AI 大模型进行分析。</div>' +
                  '<div style="margin-bottom:8px;">下方已生成完整的分析提示词，您可以：</div>' +
                  '<ol style="margin:8px 0;padding-left:20px;">' +
                  '<li>点击【一键复制提示词】按钮</li>' +
                  '<li>粘贴到 <a href="https://chat.deepseek.com/" target="_blank" style="color:#0c63b7;font-weight:bold;">DeepSeek 对话窗口</a> 中进行详细分析</li>' +
                  '</ol>' +
                  '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ffeeba;">' +
                  '<div style="font-weight:bold;margin-bottom:6px;">💡 如何获取 API Key？</div>' +
                  '<div>访问 <a href="https://platform.deepseek.com" target="_blank" style="color:#0c63b7;">DeepSeek 开放平台</a> 注册账号并申请 API Key，然后将 Key 配置到 <code>ai-config.json</code> 文件中，即可启用 AI 大模型分析功能。</div>' +
                  '</div>' +
                  '<button onclick="copyAnalysisData()" style="background:#0c63b7;color:#fff;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;font-size:14px;margin-top:14px;font-weight:bold;">📋 一键复制分析提示词</button>' +
                  '</div>';
                body.innerHTML = infoHtml + '<div class="md-body" style="background:#f8f9fa;padding:16px;border-radius:8px;border:1px solid #dee2e6;">' + simpleMarkdown(ev.prompt) + '</div>';
                refreshBtn.style.display = 'none';
                if (badge) badge.textContent = '🟡 AI 模拟模式';
              } else if (ev.type === 'error') {
                body.innerHTML = '<div style="color:#ef4444;padding:20px">生成失败: ' + ev.error + '</div>';
                if (badge) badge.textContent = '';
                refreshBtn.style.display = '';
              } else if (ev.type === 'done') {
                if (badge) badge.textContent = '🟢 AI 大模型分析';
                refreshBtn.style.display = '';
                refreshBtn.disabled = false;
              }
            } catch (e) {
            }
          }
          read();
        });
      }

      read();
    })
    .catch(function(e) {
      body.innerHTML = '<div style="color:#ef4444;padding:20px">请求失败: ' + e.message + '</div>';
      if (badge) badge.textContent = '';
      refreshBtn.style.display = '';
      refreshBtn.disabled = false;
    });
}

function closeAnalysisPanel() {
  document.getElementById('analysisOverlay').style.display = 'none';
}

window.Analysis = {
  copyAnalysisData,
  simpleMarkdown,
  openAnalysisPanel,
  closeAnalysisPanel
};
