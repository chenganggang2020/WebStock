(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.EvidenceLibrary = api;
})(typeof window !== 'undefined' ? window : null, function(root) {
  const kinds = {blog:'博主',book:'书籍',article:'文章',video:'视频',transcript:'转录',research:'研报',note:'笔记'};
  const technical = /^(subject|media|evidence|status|archive|role):/;
  let sources = [], selectedId = null, sequence = 0, bound = false, actions = {}, authorsReady = false;
  const el = id => root.document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function formatTime(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '发布时间未知';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value + '（仅日期）';
    return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  }
  function presentation(source) {
    const tags = source.tags || [];
    let title = String(source.title || '未命名资料').replace(/^\[原始来源\s*\/\s*本人公开\]\s*/, '');
    if (source.author && title.startsWith(source.author + '：')) title = title.slice(source.author.length + 1).trim();
    let titleBasis = '来源标题';
    if (!title || /^(?:未命名资料|暂无标题|无标题)$/.test(title) || /^.{1,160}于[\d年/月日:：\s.-]{6,30}发布的作品$/.test(title)) {
      const excerpt = String(source.contentPreview || source.content || '').replace(/\s+/g, ' ').trim();
      const sentence = excerpt.split(/[。！？!?\n]/).find(part => part.trim().length >= 8) || excerpt;
      title = sentence.slice(0, 56).trim();
      titleBasis = title ? '内容摘录' : '标题缺失';
      title = title ? title + (sentence.length > 56 ? '…' : '') : '暂无可用标题';
    }
    return {title,titleBasis,kind:kinds[source.sourceType] || '资料', topics:Array.from(new Set(tags.filter(tag => !technical.test(tag) && tag !== 'douyin').concat(source.sectors || []))),
      contentKind: tags.includes('role:transcript') ? '逐字稿' : tags.includes('role:fact_summary') ? '采集整理文本' : '来源文本',
      archive:tags.includes('archive:downloaded') ? '媒体已下载（不代表内容已核验）' : tags.includes('archive:linked') ? '仅来源链接' : '未标注媒体归档状态'};
  }
  function showTab(name) {
    const mapping = {read:'knowledgeSourceReader',analysis:'knowledgeAnalysisPanel',edit:'knowledgeEditorPanel'};
    if (!mapping[name]) return;
    Object.entries(mapping).forEach(([key,id]) => { el(id).hidden = key !== name; });
    root.document.querySelectorAll('[data-evidence-tab]').forEach(button => button.setAttribute('aria-selected',String(button.dataset.evidenceTab === name)));
  }
  function setAuthors(authors, preferredAuthor) {
    const picker = el('knowledgeAuthorFilter');
    let previous = picker.value;
    if (!authorsReady) { try { previous = root.localStorage.getItem('webstock-evidence-author') ?? previous; } catch (_) {} }
    if (typeof preferredAuthor === 'string') previous = preferredAuthor;
    picker.innerHTML = authors.map(item => '<option value="' + escape(item.author) + '">' + escape(item.author || '未注明作者') + ' · ' + Number(item.count) + ' 份</option>').join('');
    if (authors.some(item => item.author === previous)) picker.value = previous;
    picker.disabled = !authors.length;
    authorsReady = true;
  }
  function beginLoading() {
    sequence++; selectedId = null; sources = [];
    el('knowledgeSourceList').innerHTML = '<div class="empty-state">正在读取所选作者资料…</div>';
    el('knowledgeSourceReader').innerHTML = '<div class="empty-state">正在读取所选作者资料…</div>';
    el('knowledgeSourceCount').textContent = '载入中';
    el('knowledgeSourceFilter').innerHTML = '';
    ['knowledgeEvidenceResults','knowledgeDirectResult','knowledgeSearchStatus'].forEach(id => { if (el(id)) el(id).innerHTML = ''; });
    showTab('read');
  }
  function renderList() {
    const type = el('knowledgeTypeFilter').value;
    const author = el('knowledgeAuthorFilter').value;
    const items = sources.filter(source => (source.author || '') === author && (!type || source.sourceType === type)).slice();
    items.sort((a,b) => (el('knowledgeOrder').value === 'earliest' ? -1 : 1) * ((Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) || b.id-a.id));
    el('knowledgeSourceCount').textContent = items.length + ' 条显示 / ' + sources.length + ' 条已载入（最多 500）';
    el('knowledgeSourceList').innerHTML = items.length ? items.map(source => {
      const view = presentation(source);
      return '<button type="button" class="evidence-source-item' + (Number(source.id) === selectedId ? ' is-selected' : '') + '" data-source-id="' + Number(source.id) + '" aria-pressed="' + (Number(source.id) === selectedId) + '">' +
        '<span class="evidence-source-text"><strong title="' + escape(view.title) + '">' + escape(view.title) + '</strong>' +
        '<span class="muted"><time>' + escape(formatTime(source.publishedAt)) + '</time>' + (view.titleBasis === '内容摘录' ? '<small>内容摘录</small>' : '') + '</span></span></button>';
    }).join('') : '<div class="empty-state">没有符合条件的资料。请调整搜索或类型。</div>';
    if (!items.some(source => Number(source.id) === selectedId)) {
      sequence++; selectedId = null;
      el('knowledgeSourceReader').innerHTML = '<div class="empty-state">选择左侧资料，查看正文和来源。</div>';
      if (items.length) select(Number(items[0].id));
    }
  }
  async function select(id) {
    selectedId = Number(id);
    const sourceFilter = el('knowledgeSourceFilter');
    if (sourceFilter) sourceFilter.value = String(selectedId);
    const requestId = ++sequence;
    const reader = el('knowledgeSourceReader');
    showTab('read');
    root.document.querySelectorAll('.evidence-source-item').forEach(row => {
      const active = Number(row.dataset.sourceId) === selectedId;
      row.classList.toggle('is-selected',active); row.setAttribute('aria-pressed',String(active));
    });
    reader.innerHTML = '<div class="empty-state">正在读取资料正文…</div>';
    try {
      const source = await root.ApiClient.fetchJsonData('/api/knowledge/sources/' + selectedId);
      if (requestId !== sequence) return;
      if (!source) throw new Error('该资料已不存在，请刷新目录');
      const view = presentation(source);
      const url = /^https?:\/\//i.test(source.sourceUrl || '') ? source.sourceUrl : '';
      reader.innerHTML = '<header class="evidence-document-head"><div class="evidence-source-meta">' + escape(view.kind + ' · ' + view.contentKind) + '</div>' +
        '<h2>' + escape(view.title) + '</h2><p class="muted">' + escape(source.author || '作者未注明') + ' · ' + escape(formatTime(source.publishedAt)) + ' 北京时间' + (view.titleBasis === '内容摘录' ? ' · 标题取自内容摘录，非作者原题' : '') + '</p>' +
        '<div class="evidence-document-actions"><button class="small-btn" data-evidence-action="use">以此资料分析</button><button class="small-btn" data-evidence-action="edit">编辑资料</button>' +
        (url ? '<a class="small-btn" href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">核对原始来源 ↗</a>' : '') + '</div></header>' +
        '<div class="evidence-document-facts"><span>' + escape(source.characterCount) + ' 字 · ' + escape(source.chunkCount) + ' 证据块</span><span>' + escape(view.archive) + '</span></div>' +
        (view.topics.length ? '<div class="tag-row">' + view.topics.map(t => '<span class="tag">' + escape(t) + '</span>').join('') + '</div>' : '') +
        '<p class="evidence-boundary">以下为保存的来源文本，不是 AI 新生成的结论；转录与作者观点仍需结合原文核对。</p>' +
        '<div class="evidence-document-body">' + escape(source.content || '该资料没有可读正文。') + '</div>' +
        '<details class="evidence-provenance"><summary>溯源信息与维护</summary><dl><dt>原始标题</dt><dd>' + escape(source.title) + '</dd><dt>来源链接</dt><dd>' + escape(source.sourceUrl || '未提供') + '</dd>' +
        '<dt>资料身份</dt><dd>' + escape(source.sourceKey || source.id) + '</dd><dt>内容校验值</dt><dd>' + escape(source.contentHash) + '</dd><dt>原始标签</dt><dd>' + escape((source.tags || []).join(' / ')) + '</dd></dl><button class="small-btn danger" data-evidence-action="delete">删除此资料…</button></details>';
      reader.scrollTop = 0;
    } catch (error) {
      if (requestId === sequence) reader.innerHTML = '<div class="empty-state">资料读取失败：' + escape(error.message) + '。重新选择可重试。</div>';
    }
  }
  function bind(callbacks) {
    if (bound) return;
    bound = true; actions = callbacks;
    root.document.querySelector('.evidence-reader-pane').appendChild(el('knowledgeEditorPanel'));
    root.document.querySelectorAll('[data-evidence-tab]').forEach(button => button.addEventListener('click',() => showTab(button.dataset.evidenceTab)));
    el('knowledgeTypeFilter').addEventListener('change',renderList);
    el('knowledgeOrder').addEventListener('change',renderList);
    el('knowledgeAuthorFilter').addEventListener('change',() => {
      try { root.localStorage.setItem('webstock-evidence-author',el('knowledgeAuthorFilter').value); } catch (_) {}
      el('knowledgeSourceSearchInput').value = '';
      actions.reload().catch(error => { el('knowledgeSourceList').innerHTML = '<div class="empty-state">载入失败：' + escape(error.message) + '</div>'; });
    });
    el('newKnowledgeSourceBtn').addEventListener('click',() => { actions.clear(); showTab('edit'); el('knowledgeSourceTitle').focus(); });
    el('knowledgeSourceList').addEventListener('click',event => {
      const row = event.target.closest('[data-source-id]');
      if (row) select(Number(row.dataset.sourceId));
    });
    el('knowledgeSourceReader').addEventListener('click',event => {
      const action = event.target.closest('[data-evidence-action]')?.dataset.evidenceAction;
      if (!action || !selectedId) return;
      if (action === 'use') { el('knowledgeSourceFilter').value = String(selectedId); showTab('analysis'); el('knowledgeQuestionInput').focus(); }
      if (action === 'edit') { showTab('edit'); actions.edit(selectedId).catch(error => actions.error(error.message)); }
      if (action === 'delete') actions.delete(selectedId).catch(error => actions.error(error.message));
    });
  }
  function render(items) { sources = items || []; renderList(); }
  return {presentation,formatTime,bind,render,select,showTab,setAuthors,beginLoading};
});
