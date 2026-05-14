let currentHandoff = null;
const AI_HANDOFF_RESULTS_KEY = 'webstock_ai_handoff_results';

function aiAssistantOpen(options) {
  currentHandoff = options || {};
  const overlay = document.getElementById('handoffModalOverlay');
  if (!overlay) return;
  document.getElementById('handoffModalTitle').textContent = currentHandoff.title || 'ChatGPT 交接';
  document.getElementById('handoffModalSummary').textContent = currentHandoff.summary || '复制提示词到 ChatGPT，或导入返回结果保存到当前任务。';
  document.getElementById('handoffPromptText').value = currentHandoff.prompt || '';
  document.getElementById('handoffResultText').value = currentHandoff.result || '';
  aiAssistantSetStatus('提示词已生成。建议点“复制并内嵌打开 ChatGPT”，登录状态会保存在软件内置窗口。');
  overlay.style.display = 'flex';
}

function aiAssistantClose() {
  const overlay = document.getElementById('handoffModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

function aiAssistantClipboardWrite(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

function aiAssistantSetStatus(text, isOk) {
  const target = document.getElementById('handoffStatus');
  if (!target) return;
  target.textContent = text;
  target.className = 'handoff-status' + (isOk ? ' ok' : '');
}

function aiAssistantExtractResultBlock(text) {
  const raw = String(text || '').trim();
  if (!raw) return { text: '', extracted: false };
  const standard = raw.match(/WEBSTOCK_RESULT_START\s*([\s\S]*?)\s*WEBSTOCK_RESULT_END/i);
  if (standard) return { text: standard[1].trim(), extracted: true };
  const typed = raw.match(/WEBSTOCK_([A-Z0-9_]+)_START\s*([\s\S]*?)\s*WEBSTOCK_\1_END/i);
  if (typed) return { text: typed[2].trim(), extracted: true };
  return { text: raw, extracted: false };
}

function aiAssistantCopyPrompt() {
  const text = document.getElementById('handoffPromptText').value;
  if (!text) return Promise.resolve();
  return aiAssistantClipboardWrite(text).then(function() {
    const btn = document.getElementById('handoffCopyBtn');
    const old = btn.textContent;
    btn.textContent = '已复制';
    aiAssistantSetStatus('提示词已复制到剪贴板。内嵌 ChatGPT 打开后按 Ctrl+V 粘贴发送。', true);
    setTimeout(function() { btn.textContent = old; }, 1600);
  }).catch(function() {
    alert('复制失败，请手动复制提示词。');
  });
}

function aiAssistantOpenChatGPT() {
  window.open('https://chatgpt.com/', '_blank');
}

function aiAssistantCopyAndOpenChatGPT() {
  aiAssistantCopyPrompt().finally(function() {
    aiAssistantOpenChatGPT();
    aiAssistantSetStatus('已打开软件内置 ChatGPT。若要临时对话，请在 ChatGPT 内切换 Temporary Chat/临时聊天后再粘贴。', true);
  });
}

async function aiAssistantImportClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    alert('当前浏览器不允许读取剪贴板，请手动粘贴 ChatGPT 返回结果。');
    return;
  }
  const text = (await navigator.clipboard.readText()).trim();
  if (!text) {
    alert('剪贴板为空。');
    return;
  }
  const parsed = aiAssistantExtractResultBlock(text);
  document.getElementById('handoffResultText').value = parsed.text;
  aiAssistantSetStatus(parsed.extracted ? '已从剪贴板识别并提取 WebStock 结果块。' : '已从剪贴板导入文本。', true);
}

function aiAssistantSaveHistoryRecord(record) {
  const saved = JSON.parse(localStorage.getItem(AI_HANDOFF_RESULTS_KEY) || '[]');
  const item = {
    title: record.title || 'ChatGPT 交接结果',
    summary: record.summary || '',
    prompt: record.prompt || '',
    result: record.result || '',
    kind: record.kind || 'general',
    context: record.context || null,
    savedAt: record.savedAt || (window.WebStockTime && window.WebStockTime.formatDateTime ? window.WebStockTime.formatDateTime(new Date()) : new Date().toISOString())
  };
  saved.unshift(item);
  localStorage.setItem(AI_HANDOFF_RESULTS_KEY, JSON.stringify(saved.slice(0, 80)));
  if (window.AIHistory) window.AIHistory.render();
  if (window.Settings) window.Settings.renderSavedResults();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  return item;
}

async function aiAssistantSaveResult() {
  if (!currentHandoff) return;
  const parsed = aiAssistantExtractResultBlock(document.getElementById('handoffResultText').value);
  currentHandoff.result = parsed.text;
  if (!currentHandoff.result) {
    alert('请先粘贴 ChatGPT 返回结果。');
    return;
  }
  document.getElementById('handoffResultText').value = currentHandoff.result;
  aiAssistantSaveHistoryRecord({
    title: currentHandoff.title || 'ChatGPT 交接结果',
    summary: currentHandoff.summary || '',
    prompt: currentHandoff.prompt || '',
    result: currentHandoff.result,
    kind: currentHandoff.kind || 'general',
    context: currentHandoff.context || null
  });
  if (typeof currentHandoff.onSave === 'function') {
    try {
      await currentHandoff.onSave(currentHandoff.result);
    } catch (error) {
      console.warn('Failed to link handoff result:', error.message);
    }
  }
  alert('分析结果已保存到本地软件，并已关联到支持关联的当前任务。');
  aiAssistantClose();
}

function bindAIAssistant() {
  const copy = document.getElementById('handoffCopyBtn');
  if (copy) copy.addEventListener('click', aiAssistantCopyPrompt);
  const openBtn = document.getElementById('handoffOpenChatBtn');
  if (openBtn) openBtn.addEventListener('click', aiAssistantOpenChatGPT);
  const copyOpenBtn = document.getElementById('handoffCopyOpenBtn');
  if (copyOpenBtn) copyOpenBtn.addEventListener('click', aiAssistantCopyAndOpenChatGPT);
  const importBtn = document.getElementById('handoffImportClipboardBtn');
  if (importBtn) importBtn.addEventListener('click', function() {
    aiAssistantImportClipboard().catch(function(error) { alert(error.message || '剪贴板导入失败'); });
  });
  const save = document.getElementById('handoffSaveBtn');
  if (save) save.addEventListener('click', aiAssistantSaveResult);
  const closeBtn = document.getElementById('handoffCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', aiAssistantClose);
  const overlay = document.getElementById('handoffModalOverlay');
  if (overlay) overlay.addEventListener('click', function(event) {
    if (event.target === overlay) aiAssistantClose();
  });
}

window.AIAssistant = {
  open: aiAssistantOpen,
  close: aiAssistantClose,
  copyPrompt: aiAssistantCopyPrompt,
  openChatGPT: aiAssistantOpenChatGPT,
  saveResult: aiAssistantSaveResult,
  copyAndOpenChatGPT: aiAssistantCopyAndOpenChatGPT,
  importClipboard: aiAssistantImportClipboard,
  extractResultBlock: aiAssistantExtractResultBlock,
  saveHistoryRecord: aiAssistantSaveHistoryRecord,
  getSavedResults: function() {
    return JSON.parse(localStorage.getItem(AI_HANDOFF_RESULTS_KEY) || '[]');
  },
  bind: bindAIAssistant
};
