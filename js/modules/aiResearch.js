let aiResearchSources = [];
let aiResearchModels = [];
let aiResearchRuns = [];
let aiResearchEditingSourceId = null;
let aiResearchLoaded = false;
let aiResearchLoading = null;
let aiResearchBound = false;

const AI_RESEARCH_STATUS_LABELS = {
  available: '可用',
  configured: '已配置',
  not_configured: '未配置',
  planned: '规划中',
  unavailable: '不可用'
};

const AI_RESEARCH_SOURCE_LABELS = {
  book: '书籍',
  blog: '博主 / 博客',
  article: '文章',
  video: '视频',
  transcript: '访谈 / 直播转录',
  research: '研报',
  note: '个人笔记'
};

function aiResearchEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function aiResearchApi(path, options) {
  const requestOptions = Object.assign({}, options || {});
  if (requestOptions.body && typeof requestOptions.body !== 'string') {
    requestOptions.headers = Object.assign({ 'Content-Type': 'application/json' }, requestOptions.headers || {});
    requestOptions.body = JSON.stringify(requestOptions.body);
  }
  return window.apiFetch(path, requestOptions);
}

function aiResearchSetStatus(id, message, isError) {
  const target = document.getElementById(id);
  if (!target) return;
  target.textContent = message || '';
  target.classList.toggle('error', !!isError);
}

function aiResearchDate(value) {
  if (!value) return '';
  if (window.WebStockTime && window.WebStockTime.formatDateTime) {
    try { return window.WebStockTime.formatDateTime(value); } catch (error) {}
  }
  return String(value);
}

function aiResearchRenderModels() {
  const target = document.getElementById('aiModelRegistry');
  if (!target) return;
  if (!aiResearchModels.length) {
    target.innerHTML = '<div class="empty-state compact">没有模型状态数据。</div>';
    return;
  }
  target.innerHTML = '<div class="table-scroll compact-scroll"><table class="data-table ai-model-table"><thead><tr>' +
    '<th>能力</th><th>状态</th><th>运行环境</th><th>成本</th><th>当前说明</th>' +
    '</tr></thead><tbody>' + aiResearchModels.map(function(model) {
      const label = AI_RESEARCH_STATUS_LABELS[model.status] || model.status;
      return '<tr>' +
        '<td><strong>' + aiResearchEscape(model.name) + '</strong><div class="muted">' + aiResearchEscape((model.capabilities || []).join(' / ')) + '</div></td>' +
        '<td><span class="model-status ' + aiResearchEscape(model.status) + '">' + aiResearchEscape(label) + '</span></td>' +
        '<td>' + aiResearchEscape(model.runtime || '-') + '</td>' +
        '<td>' + aiResearchEscape(model.costMode || '-') + '</td>' +
        '<td><span>' + aiResearchEscape(model.note || '') + '</span>' +
          ((model.requirements || []).length ? '<div class="muted">条件：' + aiResearchEscape(model.requirements.join('；')) + '</div>' : '') + '</td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>';
  const available = aiResearchModels.filter(function(model) { return model.status === 'available'; }).length;
  aiResearchSetStatus('aiModelRegistryStatus', available + ' 项当前可用 / ' + aiResearchModels.length + ' 项已登记');
}

function aiResearchRenderSourceOptions() {
  const select = document.getElementById('knowledgeSourceFilter');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '<option value="">全部来源</option>' + aiResearchSources.map(function(source) {
    return '<option value="' + source.id + '">' + aiResearchEscape(source.title) + (source.author ? ' · ' + aiResearchEscape(source.author) : '') + '</option>';
  }).join('');
  if (aiResearchSources.some(function(source) { return String(source.id) === previous; })) select.value = previous;
}

function aiResearchRenderSources() {
  const target = document.getElementById('knowledgeSourceList');
  if (!target) return;
  document.getElementById('knowledgeSourceCount').textContent = aiResearchSources.length + ' 个来源';
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  aiResearchRenderSourceOptions();
  if (!aiResearchSources.length) {
    target.innerHTML = '<div class="empty-state compact">尚未录入专家资料。</div>';
    return;
  }
  target.innerHTML = aiResearchSources.map(function(source) {
    const tags = (source.tags || []).concat(source.sectors || []).slice(0, 8);
    const meta = [AI_RESEARCH_SOURCE_LABELS[source.sourceType] || source.sourceType, source.author, source.publishedAt].filter(Boolean).join(' · ');
    return '<article class="knowledge-source-row" data-source-id="' + source.id + '">' +
      '<div class="knowledge-source-main"><strong>' + aiResearchEscape(source.title) + '</strong>' +
        '<div class="muted">' + aiResearchEscape(meta) + '</div>' +
        '<div class="knowledge-source-metrics">' + source.chunkCount + ' 个证据块 · ' + source.characterCount + ' 字</div>' +
        (tags.length ? '<div class="tag-row">' + tags.map(function(tag) { return '<span class="factor-tag">' + aiResearchEscape(tag) + '</span>'; }).join('') + '</div>' : '') +
      '</div>' +
      '<div class="knowledge-source-actions">' +
        '<button class="small-btn" data-knowledge-action="use">限定</button>' +
        '<button class="small-btn" data-knowledge-action="edit">编辑</button>' +
        '<button class="small-btn danger" data-knowledge-action="delete">删除</button>' +
      '</div>' +
    '</article>';
  }).join('');
}

function aiResearchClearSourceForm() {
  aiResearchEditingSourceId = null;
  document.getElementById('knowledgeSourceType').value = 'blog';
  ['knowledgeSourceTitle', 'knowledgeSourceAuthor', 'knowledgeSourcePublishedAt', 'knowledgeSourceUrl',
    'knowledgeSourceTags', 'knowledgeSourceStocks', 'knowledgeSourceSectors', 'knowledgeSourceContent']
    .forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('saveKnowledgeSourceBtn').textContent = '保存来源';
  aiResearchSetStatus('knowledgeSourceStatus', '');
}

function aiResearchSourceBody() {
  return {
    sourceType: document.getElementById('knowledgeSourceType').value,
    title: document.getElementById('knowledgeSourceTitle').value.trim(),
    author: document.getElementById('knowledgeSourceAuthor').value.trim(),
    publishedAt: document.getElementById('knowledgeSourcePublishedAt').value,
    sourceUrl: document.getElementById('knowledgeSourceUrl').value.trim(),
    tags: document.getElementById('knowledgeSourceTags').value,
    stockCodes: document.getElementById('knowledgeSourceStocks').value,
    sectors: document.getElementById('knowledgeSourceSectors').value,
    content: document.getElementById('knowledgeSourceContent').value
  };
}

async function aiResearchSaveSource() {
  const button = document.getElementById('saveKnowledgeSourceBtn');
  const editing = aiResearchEditingSourceId;
  button.disabled = true;
  aiResearchSetStatus('knowledgeSourceStatus', editing ? '正在更新...' : '正在建立索引...');
  try {
    const saved = await aiResearchApi('/api/knowledge/sources' + (editing ? '/' + editing : ''), {
      method: editing ? 'PUT' : 'POST',
      body: aiResearchSourceBody(),
      timeoutMs: 30000
    });
    aiResearchSetStatus('knowledgeSourceStatus', saved.duplicate ? '相同正文已经存在，未重复导入。' : '已保存并建立 ' + saved.chunkCount + ' 个证据块。');
    aiResearchClearSourceForm();
    await aiResearchLoadSources();
  } catch (error) {
    aiResearchSetStatus('knowledgeSourceStatus', error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function aiResearchEditSource(id) {
  const source = await aiResearchApi('/api/knowledge/sources/' + id);
  aiResearchEditingSourceId = source.id;
  document.getElementById('knowledgeSourceType').value = source.sourceType;
  document.getElementById('knowledgeSourceTitle').value = source.title || '';
  document.getElementById('knowledgeSourceAuthor').value = source.author || '';
  document.getElementById('knowledgeSourcePublishedAt').value = String(source.publishedAt || '').slice(0, 10);
  document.getElementById('knowledgeSourceUrl').value = source.sourceUrl || '';
  document.getElementById('knowledgeSourceTags').value = (source.tags || []).join(', ');
  document.getElementById('knowledgeSourceStocks').value = (source.stockCodes || []).join(', ');
  document.getElementById('knowledgeSourceSectors').value = (source.sectors || []).join(', ');
  document.getElementById('knowledgeSourceContent').value = source.content || '';
  document.getElementById('saveKnowledgeSourceBtn').textContent = '更新来源';
  aiResearchSetStatus('knowledgeSourceStatus', '正在编辑：' + source.title);
  document.getElementById('knowledgeSourceTitle').focus();
}

async function aiResearchDeleteSource(id) {
  const source = aiResearchSources.find(function(item) { return item.id === Number(id); });
  if (!confirm('删除知识来源“' + (source ? source.title : id) + '”及其全部证据块？')) return;
  await aiResearchApi('/api/knowledge/sources/' + id, { method: 'DELETE' });
  if (aiResearchEditingSourceId === Number(id)) aiResearchClearSourceForm();
  await aiResearchLoadSources();
  aiResearchSetStatus('knowledgeSourceStatus', '知识来源已删除。');
}

function aiResearchRenderEvidence(result) {
  const target = document.getElementById('knowledgeEvidenceResults');
  if (!target) return;
  const items = result && Array.isArray(result.items) ? result.items : [];
  aiResearchSetStatus('knowledgeSearchStatus', items.length ? items.length + ' 个证据块 · ' + (result.engine || '') : '没有匹配证据');
  if (!items.length) {
    target.innerHTML = '<div class="empty-state compact">没有匹配证据。</div>';
    return;
  }
  target.innerHTML = items.map(function(item) {
    const meta = [item.title, item.author, item.publishedAt].filter(Boolean).join(' · ');
    return '<article class="knowledge-evidence-row">' +
      '<div class="knowledge-evidence-id">' + aiResearchEscape(item.evidenceId) + '</div>' +
      '<div><strong>' + aiResearchEscape(meta) + '</strong><p>' + aiResearchEscape(item.content) + '</p>' +
        (item.sourceUrl ? '<a href="' + aiResearchEscape(item.sourceUrl) + '" target="_blank" rel="noopener">打开来源</a>' : '') + '</div>' +
    '</article>';
  }).join('');
}

function aiResearchSelectedSourceIds() {
  const value = document.getElementById('knowledgeSourceFilter').value;
  return value ? [Number(value)] : [];
}

async function aiResearchSearchEvidence() {
  const query = document.getElementById('knowledgeQuestionInput').value.trim();
  if (!query) {
    aiResearchSetStatus('knowledgeSearchStatus', '请先输入研究问题。', true);
    return null;
  }
  aiResearchSetStatus('knowledgeSearchStatus', '正在检索...');
  try {
    const result = await aiResearchApi('/api/knowledge/search', {
      method: 'POST',
      body: { query, sourceIds: aiResearchSelectedSourceIds(), limit: 12 }
    });
    aiResearchRenderEvidence(result);
    return result;
  } catch (error) {
    aiResearchSetStatus('knowledgeSearchStatus', error.message, true);
    return null;
  }
}

function aiResearchRenderDirectResult(result) {
  const target = document.getElementById('knowledgeDirectResult');
  if (!target) return;
  target.style.display = result ? '' : 'none';
  target.innerHTML = result ? '<h3>AI 分析结果</h3><pre>' + aiResearchEscape(result) + '</pre>' : '';
}

async function aiResearchAnalyze(requestOverride, displayOptions) {
  const button = document.getElementById('analyzeKnowledgeBtn');
  const hasOverride = requestOverride && typeof requestOverride === 'object' && !requestOverride.preventDefault;
  const question = hasOverride
    ? String(requestOverride.question || '').trim()
    : document.getElementById('knowledgeQuestionInput').value.trim();
  if (!question) {
    aiResearchSetStatus('knowledgeSearchStatus', '请先输入研究问题。', true);
    return;
  }
  const request = hasOverride ? requestOverride : {
    question,
    mode: document.getElementById('knowledgeAnalysisMode').value,
    sourceIds: aiResearchSelectedSourceIds(),
    limit: 10
  };
  const display = displayOptions || {};
  if (button) button.disabled = true;
  aiResearchSetStatus('knowledgeSearchStatus', '正在整理证据...');
  try {
    const result = await aiResearchApi('/api/knowledge/analyze', {
      method: 'POST',
      body: request,
      timeoutMs: 120000
    });
    aiResearchRenderEvidence({ items: result.evidence, engine: result.engine });
    if (!result.handoffMode) {
      aiResearchRenderDirectResult(result.report || '');
      await aiResearchLoadRuns();
      return;
    }
    window.AIAssistant.open({
      title: display.title || '专家知识库分析',
      summary: display.summary || result.evidence.length + ' 个证据块已写入提示词；保存返回结果后会进入研究记录。',
      prompt: result.prompt,
      promptStyle: 'default',
      kind: 'knowledge-analysis',
      context: { view: 'aiResearch', question, mode: result.mode, origin: display.origin || 'knowledge' },
      onSave: async function(savedResult) {
        await aiResearchApi('/api/research-runs', {
          method: 'POST',
          body: {
            runType: 'knowledge-analysis',
            modelId: 'chatgpt-handoff',
            status: 'completed',
            title: question,
            question,
            prompt: result.prompt,
            result: savedResult,
            evidence: result.evidence,
            request: {
              mode: result.mode,
              query: result.query,
              engine: result.engine,
              origin: display.origin || 'knowledge',
              candidateCount: Array.isArray(request.candidateContext) ? request.candidateContext.length : 0
            }
          },
          timeoutMs: 30000
        });
        aiResearchRenderDirectResult(savedResult);
        await aiResearchLoadRuns();
      }
    });
  } catch (error) {
    aiResearchSetStatus('knowledgeSearchStatus', error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function aiResearchReviewScreener(result, candidates) {
  window.switchMainView('aiResearch');
  await aiResearchEnsureLoaded();
  if (!aiResearchSources.length) {
    aiResearchSetStatus('knowledgeSearchStatus', '请先导入至少一份书籍、博主文章、研报或笔记，再运行专家库复核。', true);
    document.getElementById('knowledgeSourceTitle').focus();
    return null;
  }

  const selected = (candidates || []).slice(0, 20);
  if (!selected.length) {
    aiResearchSetStatus('knowledgeSearchStatus', '当前没有可复核的候选股。', true);
    return null;
  }

  const strategy = String(result && result.strategy || 'local-factor').trim();
  const demand = String(result && result.demand || '').trim();
  const question = '请按照专家知识库中的选股框架，复核当前 WebStock 候选股，给出优先观察、等待确认和暂时剔除三组，并逐项引用证据。' +
    (demand ? ' 当前需求：' + demand : '') + ' 策略：' + strategy + '。';
  const searchQuery = [demand, strategy].concat(selected.flatMap(function(item) {
    return [item.code, item.name, item.industry].concat(item.themes || [], item.factorTags || []);
  })).filter(Boolean).join(' ').slice(0, 1000);

  document.getElementById('knowledgeQuestionInput').value = question;
  document.getElementById('knowledgeAnalysisMode').value = 'selection';
  aiResearchRenderDirectResult('');
  return aiResearchAnalyze({
    question,
    searchQuery,
    mode: 'selection',
    sourceIds: aiResearchSelectedSourceIds(),
    candidateContext: selected,
    limit: 10
  }, {
    title: '专家知识库选股复核',
    summary: selected.length + ' 个候选已与知识库证据合并；保存返回结果后会进入研究记录。',
    origin: 'screener'
  });
}

function aiResearchRenderRuns() {
  const target = document.getElementById('knowledgeResearchRuns');
  if (!target) return;
  document.getElementById('knowledgeRunCount').textContent = aiResearchRuns.length + ' 条';
  if (!aiResearchRuns.length) {
    target.innerHTML = '<div class="empty-state compact">尚无专家知识分析记录。</div>';
    return;
  }
  target.innerHTML = aiResearchRuns.map(function(run) {
    const evidenceIds = (run.evidence || []).map(function(item) { return item.evidenceId; }).filter(Boolean).slice(0, 8);
    return '<details class="knowledge-run-row" data-run-id="' + run.id + '">' +
      '<summary><span><strong>' + aiResearchEscape(run.title || run.question || '知识分析') + '</strong>' +
        '<span class="muted">' + aiResearchEscape(run.modelId) + ' · ' + aiResearchEscape(aiResearchDate(run.createdAt)) + '</span></span>' +
        '<button class="small-btn danger" data-run-action="delete" type="button">删除</button></summary>' +
      (evidenceIds.length ? '<div class="knowledge-run-evidence">证据：' + aiResearchEscape(evidenceIds.join(' / ')) + '</div>' : '') +
      '<pre>' + aiResearchEscape(run.result || '尚无结果') + '</pre>' +
    '</details>';
  }).join('');
}

async function aiResearchLoadModels() {
  aiResearchModels = await aiResearchApi('/api/ai-models');
  aiResearchRenderModels();
}

async function aiResearchLoadSources() {
  const input = document.getElementById('knowledgeSourceSearchInput');
  const query = input ? input.value.trim() : '';
  aiResearchSources = await aiResearchApi('/api/knowledge/sources' + (query ? '?query=' + encodeURIComponent(query) : ''));
  aiResearchRenderSources();
}

async function aiResearchLoadRuns() {
  aiResearchRuns = await aiResearchApi('/api/research-runs?runType=knowledge-analysis&limit=30');
  aiResearchRenderRuns();
}

function aiResearchEnsureLoaded(force) {
  if (aiResearchLoading) return aiResearchLoading;
  if (aiResearchLoaded && !force) return Promise.resolve();
  aiResearchLoading = Promise.all([aiResearchLoadModels(), aiResearchLoadSources(), aiResearchLoadRuns()])
    .then(function() { aiResearchLoaded = true; })
    .finally(function() { aiResearchLoading = null; });
  return aiResearchLoading;
}

function aiResearchBind() {
  if (aiResearchBound) return;
  aiResearchBound = true;
  document.getElementById('refreshAiResearchBtn').addEventListener('click', function() {
    aiResearchEnsureLoaded(true).catch(function(error) { alert(error.message); });
  });
  document.getElementById('saveKnowledgeSourceBtn').addEventListener('click', aiResearchSaveSource);
  document.getElementById('clearKnowledgeSourceBtn').addEventListener('click', aiResearchClearSourceForm);
  document.getElementById('importKnowledgeTextBtn').addEventListener('click', function() {
    document.getElementById('knowledgeTextFileInput').click();
  });
  document.getElementById('knowledgeTextFileInput').addEventListener('change', async function() {
    const file = this.files && this.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      aiResearchSetStatus('knowledgeSourceStatus', '文本文件不能超过 5 MB。', true);
      this.value = '';
      return;
    }
    const content = await file.text();
    document.getElementById('knowledgeSourceContent').value = content;
    const title = document.getElementById('knowledgeSourceTitle');
    if (!title.value.trim()) title.value = file.name.replace(/\.(txt|md)$/i, '');
    aiResearchSetStatus('knowledgeSourceStatus', '已读取 ' + file.name + '，确认来源信息后保存。');
    this.value = '';
  });
  let sourceSearchTimer = null;
  document.getElementById('knowledgeSourceSearchInput').addEventListener('input', function() {
    if (sourceSearchTimer) clearTimeout(sourceSearchTimer);
    sourceSearchTimer = setTimeout(function() {
      aiResearchLoadSources().catch(function(error) { aiResearchSetStatus('knowledgeSourceStatus', error.message, true); });
    }, 180);
  });
  document.getElementById('knowledgeSourceList').addEventListener('click', function(event) {
    const button = event.target.closest('[data-knowledge-action]');
    const row = event.target.closest('[data-source-id]');
    if (!button || !row) return;
    const id = Number(row.getAttribute('data-source-id'));
    const action = button.getAttribute('data-knowledge-action');
    if (action === 'use') {
      document.getElementById('knowledgeSourceFilter').value = String(id);
      document.getElementById('knowledgeQuestionInput').focus();
    }
    if (action === 'edit') aiResearchEditSource(id).catch(function(error) { aiResearchSetStatus('knowledgeSourceStatus', error.message, true); });
    if (action === 'delete') aiResearchDeleteSource(id).catch(function(error) { aiResearchSetStatus('knowledgeSourceStatus', error.message, true); });
  });
  document.getElementById('searchKnowledgeBtn').addEventListener('click', aiResearchSearchEvidence);
  document.getElementById('analyzeKnowledgeBtn').addEventListener('click', aiResearchAnalyze);
  document.getElementById('knowledgeResearchRuns').addEventListener('click', function(event) {
    const button = event.target.closest('[data-run-action="delete"]');
    if (!button) return;
    event.preventDefault();
    const row = button.closest('[data-run-id]');
    if (!row || !confirm('删除这条研究记录？')) return;
    aiResearchApi('/api/research-runs/' + row.getAttribute('data-run-id'), { method: 'DELETE' })
      .then(aiResearchLoadRuns)
      .catch(function(error) { alert(error.message); });
  });
}

window.AIResearch = {
  bind: aiResearchBind,
  ensureLoaded: aiResearchEnsureLoaded,
  reviewScreener: aiResearchReviewScreener,
  getSourceCount: function() { return aiResearchSources.length; }
};
