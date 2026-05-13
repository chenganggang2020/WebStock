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

function aiAssistantCopyPrompt() {
  const text = document.getElementById('handoffPromptText').value;
  if (!text) return Promise.resolve();
  return aiAssistantClipboardWrite(text).then(function() {
    const btn = document.getElementById('handoffCopyBtn');
    const old = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(function() { btn.textContent = old; }, 1600);
  }).catch(function() {
    alert('复制失败，请手动复制提示词。');
  });
}

function aiAssistantOpenChatGPT() {
  window.open('https://chatgpt.com/', '_blank');
}

function aiAssistantCopyAndOpenChatGPT() {
  aiAssistantCopyPrompt().finally(aiAssistantOpenChatGPT);
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
  document.getElementById('handoffResultText').value = text;
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
    savedAt: record.savedAt || new Date().toISOString()
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
  currentHandoff.result = document.getElementById('handoffResultText').value.trim();
  if (!currentHandoff.result) {
    alert('请先粘贴 ChatGPT 返回结果。');
    return;
  }
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
  alert('分析结果已保存到本地浏览器，并已关联到支持关联的当前任务。');
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
  saveHistoryRecord: aiAssistantSaveHistoryRecord,
  getSavedResults: function() {
    return JSON.parse(localStorage.getItem(AI_HANDOFF_RESULTS_KEY) || '[]');
  },
  bind: bindAIAssistant
};
