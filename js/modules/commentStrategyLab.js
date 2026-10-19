(function() {
  const RULE_CARD_KEY = 'webstock.commentStrategy.ruleCards';
  const EVIDENCE_LABEL_KEY = 'webstock.commentStrategy.evidenceLabels';
  const SELECTION_KEY = 'webstock.commentStrategy.selection';
  const RULE_FIELDS = {
    title: 'commentRuleTitle',
    universe: 'commentRuleUniverse',
    timeframe: 'commentRuleTimeframe',
    signalTiming: 'commentRuleSignalTiming',
    entryRule: 'commentRuleEntry',
    exitRule: 'commentRuleExit',
    stopRule: 'commentRuleStop',
    positionRule: 'commentRulePosition',
    costRule: 'commentRuleCost'
  };
  const CREATOR_LABELS = {
    verified: '作者本人 · 主页一致',
    platform_marked: '平台标注作者',
    suspected: '同名疑似 · 未确认'
  };
  const EVIDENCE_LABELS = {
    support: '支持证据',
    counter: '反证／失效反馈',
    question: '待核问题'
  };

  let bound = false;
  let loadedAt = 0;
  let loadGeneration = 0;
  let activeTab = 'evidence';
  let currentRuleId = '';
  let currentRuleSource = null;
  const state = {
    channels: [],
    observations: [],
    evidence: null
  };

  function api(path) {
    return window.apiFetch(path);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '');
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) {}
  }

  function selection() {
    const saved = readJson(SELECTION_KEY, {});
    return saved && typeof saved === 'object' ? saved : {};
  }

  function currentChannelId() {
    const select = document.getElementById('commentStrategyChannelSelect');
    return select ? Number(select.value) || 0 : 0;
  }

  function currentObservationId() {
    const select = document.getElementById('commentStrategyObservationSelect');
    return select ? Number(select.value) || 0 : 0;
  }

  function currentObservation() {
    const id = currentObservationId();
    return state.observations.find(function(item) { return Number(item.id) === id; }) || null;
  }

  function rememberSelection() {
    writeJson(SELECTION_KEY, { channelId: currentChannelId(), observationId: currentObservationId() });
  }

  function setStatus(message, kind) {
    const target = document.getElementById('commentStrategyStatus');
    if (!target) return;
    target.textContent = message;
    target.className = 'comment-strategy-status' + (kind ? ' ' + kind : '');
  }

  function setError(error) {
    const target = document.getElementById('commentStrategyError');
    if (!target) return;
    if (!error) {
      target.hidden = true;
      target.textContent = '';
      return;
    }
    target.hidden = false;
    target.textContent = error.message || String(error);
  }

  function formatTime(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    return new Date(time).toLocaleString('zh-CN', { hour12: false });
  }

  function renderChannelSelect() {
    const select = document.getElementById('commentStrategyChannelSelect');
    if (!select) return;
    const saved = selection();
    const current = Number(select.value) || Number(saved.channelId);
    select.innerHTML = state.channels.map(function(channel) {
      return '<option value="' + Number(channel.id) + '">' + escapeHtml(channel.displayName || '未命名研究对象') + '</option>';
    }).join('');
    if (state.channels.some(function(channel) { return Number(channel.id) === current; })) select.value = String(current);
  }

  function observationLabel(item) {
    const date = formatTime(item.publishedAt || item.firstSeenAt);
    return (date ? date.split(' ')[0] + ' · ' : '') + (item.title || '未命名观察记录');
  }

  function renderObservationSelect() {
    const select = document.getElementById('commentStrategyObservationSelect');
    if (!select) return;
    const saved = selection();
    const current = Number(select.value) || Number(saved.observationId);
    select.innerHTML = state.observations.map(function(item) {
      return '<option value="' + Number(item.id) + '">' + escapeHtml(observationLabel(item)) + '</option>';
    }).join('');
    if (state.observations.some(function(item) { return Number(item.id) === current; })) select.value = String(current);
  }

  function coverageText() {
    const evidence = state.evidence;
    if (!evidence) return '尚未读取评论资料。';
    const coverage = evidence.coverage;
    const parts = [coverage.message];
    if (coverage.observedAt) parts.push('采集于 ' + formatTime(coverage.observedAt));
    parts.push('当前保存 ' + evidence.counts.total + ' 条');
    if (coverage.visibleCount !== evidence.counts.total) parts.push('采集记录可见数 ' + coverage.visibleCount + ' 条');
    parts.push('作者发言 ' + evidence.counts.verifiedCreatorComments + ' 条（回复 ' + evidence.counts.verifiedCreatorReplies + ' 条）');
    if (evidence.counts.suspectedCreatorReplies) parts.push('同名待核 ' + evidence.counts.suspectedCreatorReplies + ' 条');
    return parts.filter(Boolean).join(' · ');
  }

  function creatorBadge(comment) {
    const label = CREATOR_LABELS[comment.creatorStatus];
    return label ? '<span class="comment-strategy-identity ' + escapeHtml(comment.creatorStatus) + '">' + escapeHtml(label) + '</span>' : '';
  }

  function commentSourceKey(commentId) {
    return currentChannelId() + ':' + currentObservationId() + ':' + String(commentId || '');
  }

  function evidenceLabelsForCurrent() {
    const stored = readJson(EVIDENCE_LABEL_KEY, {});
    const labels = stored && typeof stored === 'object' ? stored : {};
    const result = {};
    const prefix = currentChannelId() + ':' + currentObservationId() + ':';
    Object.keys(labels).forEach(function(key) {
      if (key.indexOf(prefix) === 0) result[key.slice(prefix.length)] = labels[key];
    });
    return result;
  }

  function evidenceSelect(comment, labels) {
    const selected = (labels || evidenceLabelsForCurrent())[comment.commentId] || '';
    return '<label class="comment-strategy-classify">人工分类<select data-comment-evidence-label="' + escapeHtml(comment.commentId) + '">' +
      '<option value=""' + (!selected ? ' selected' : '') + '>未分类</option>' +
      Object.keys(EVIDENCE_LABELS).map(function(value) {
        return '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' + escapeHtml(EVIDENCE_LABELS[value]) + '</option>';
      }).join('') + '</select></label>';
  }

  function commentHtml(comment, options) {
    options = options || {};
    return '<article class="comment-strategy-comment' + (comment.isVerifiedCreator ? ' creator' : '') + '">' +
      '<header><strong>' + escapeHtml(comment.authorName) + '</strong>' + creatorBadge(comment) +
      (comment.publishedAt ? '<time>' + escapeHtml(formatTime(comment.publishedAt)) + '</time>' : '') +
      (comment.likes == null ? '' : '<span>赞 ' + escapeHtml(comment.likes) + '</span>') + '</header>' +
      (comment.parentText ? '<div class="comment-strategy-parent">回复 ' + escapeHtml(comment.parentAuthorName || '上级评论') + '：' + escapeHtml(comment.parentText) + '</div>' : '') +
      '<p>' + escapeHtml(comment.text) + '</p>' +
      (options.actions ? '<footer><button class="small-btn" type="button" data-comment-rule-source="' + escapeHtml(comment.commentId) + '">设为规则来源</button>' + evidenceSelect(comment, options.evidenceLabels) + '</footer>' : '') +
      '</article>';
  }

  function emptyHtml(title, message) {
    return '<div class="comment-strategy-empty"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(message) + '</span></div>';
  }

  function renderEvidence() {
    const coverage = document.getElementById('commentStrategyCoverage');
    const target = document.getElementById('commentStrategyEvidenceList');
    if (!coverage || !target) return;
    coverage.textContent = coverageText();
    if (!state.evidence || !state.evidence.comments.length) {
      target.innerHTML = emptyHtml('当前没有已保存的评论正文', '这表示当前详情快照未落库评论，不能据此判断视频没有评论。请先在采集任务中打开对应视频并刷新详情。');
      return;
    }
    const search = String((document.getElementById('commentStrategyEvidenceSearch') || {}).value || '').trim().toLowerCase();
    const filter = String((document.getElementById('commentStrategyEvidenceFilter') || {}).value || 'all');
    const comments = state.evidence.comments.filter(function(comment) {
      if (filter === 'creator' && !comment.isVerifiedCreator) return false;
      if (filter === 'suspected' && comment.creatorStatus !== 'suspected') return false;
      if (!search) return true;
      return (comment.text + ' ' + comment.authorName + ' ' + comment.parentText).toLowerCase().includes(search);
    });
    const labels = evidenceLabelsForCurrent();
    target.innerHTML = comments.length ? comments.map(function(comment) { return commentHtml(comment, { actions: true, evidenceLabels: labels }); }).join('')
      : emptyHtml('没有匹配的评论', '请调整搜索词或身份筛选。');
  }

  function renderCreatorReplies() {
    const target = document.getElementById('commentStrategyCreatorList');
    if (!target) return;
    const comments = state.evidence ? state.evidence.creatorComments : [];
    const labels = evidenceLabelsForCurrent();
    target.innerHTML = comments.length ? comments.map(function(comment) { return commentHtml(comment, { actions: true, evidenceLabels: labels }); }).join('')
      : emptyHtml('当前没有已核验作者发言', '只有主页一致或平台明确标注的评论、回复才会显示；同名疑似账号不会被算作作者。');
  }

  function readRuleCards() {
    const cards = readJson(RULE_CARD_KEY, []);
    return Array.isArray(cards) ? cards.slice(0, 100).map(function(item) {
      return window.CommentStrategyModel.assessRuleCard(item).card;
    }) : [];
  }

  function writeRuleCards(cards) {
    writeJson(RULE_CARD_KEY, cards.slice(0, 100));
  }

  function ruleFormValue(id) {
    const input = document.getElementById(id);
    return input ? String(input.value || '').trim() : '';
  }

  function ruleFromForm() {
    const value = { id: currentRuleId };
    Object.keys(RULE_FIELDS).forEach(function(key) { value[key] = ruleFormValue(RULE_FIELDS[key]); });
    if (currentRuleSource) Object.assign(value, currentRuleSource);
    return value;
  }

  function renderRuleSelect() {
    const select = document.getElementById('commentRuleCardSelect');
    if (!select) return;
    const cards = readRuleCards();
    select.innerHTML = '<option value="">当前草稿</option>' + cards.map(function(card) {
      return '<option value="' + escapeHtml(card.id) + '">' + escapeHtml(card.title || '未命名规则卡') + '</option>';
    }).join('');
    select.value = cards.some(function(card) { return card.id === currentRuleId; }) ? currentRuleId : '';
  }

  function fillRuleForm(card) {
    const normalized = window.CommentStrategyModel.assessRuleCard(card || {}).card;
    currentRuleId = normalized.id;
    currentRuleSource = normalized.sourceCommentId ? {
      sourceChannelId: normalized.sourceChannelId,
      sourceObservationId: normalized.sourceObservationId,
      sourceCommentId: normalized.sourceCommentId
    } : null;
    Object.keys(RULE_FIELDS).forEach(function(key) {
      const input = document.getElementById(RULE_FIELDS[key]);
      if (input) input.value = normalized[key] || '';
    });
    renderRuleSelect();
    renderRuleStatus();
  }

  function renderRuleStatus() {
    const target = document.getElementById('commentRuleStatus');
    const source = document.getElementById('commentRuleSource');
    if (!target || !source) return;
    const assessment = window.CommentStrategyModel.assessRuleCard(ruleFromForm());
    target.className = 'comment-rule-status ' + (assessment.complete ? 'complete' : 'draft');
    target.innerHTML = assessment.complete
      ? '<strong>规则字段完整，但尚未验证。</strong><span>下一步仍需检查样本外、费用、偏差和执行语义。</span>'
      : '<strong>草稿 · 还缺 ' + assessment.missingLabels.length + ' 项</strong><span>' + escapeHtml(assessment.missingLabels.join('、')) + '</span>';
    source.textContent = currentRuleSource
      ? '来源：频道 ' + currentRuleSource.sourceChannelId + ' · 观察记录 ' + currentRuleSource.sourceObservationId + ' · 评论 ' + currentRuleSource.sourceCommentId
      : '尚未绑定评论来源。';
  }

  function saveRuleCard() {
    const cards = readRuleCards();
    const draft = ruleFromForm();
    if (!draft.id) draft.id = 'rule-' + Date.now();
    if (!draft.title) draft.title = '未命名规则卡';
    draft.updatedAt = new Date().toISOString();
    const assessment = window.CommentStrategyModel.assessRuleCard(draft);
    const index = cards.findIndex(function(card) { return card.id === assessment.card.id; });
    if (index >= 0) cards[index] = assessment.card;
    else cards.unshift(assessment.card);
    writeRuleCards(cards);
    fillRuleForm(assessment.card);
    setStatus('规则卡已保存到本机 · ' + (assessment.complete ? '字段完整但未验证' : '仍是草稿'), 'ready');
  }

  function deleteRuleCard() {
    if (!currentRuleId) return;
    if (window.confirm && !window.confirm('删除当前本机规则卡？此操作不会删除原评论。')) return;
    writeRuleCards(readRuleCards().filter(function(card) { return card.id !== currentRuleId; }));
    fillRuleForm({});
    setStatus('已删除本机规则卡；原评论资料未改变。', 'ready');
  }

  function loadRuleCard() {
    const select = document.getElementById('commentRuleCardSelect');
    const id = select ? String(select.value || '') : '';
    const card = readRuleCards().find(function(item) { return item.id === id; });
    fillRuleForm(card || {});
  }

  function useCommentAsRuleSource(commentId) {
    const comment = state.evidence && state.evidence.comments.find(function(item) { return item.commentId === commentId; });
    if (!comment) return;
    currentRuleSource = {
      sourceChannelId: String(currentChannelId()),
      sourceObservationId: String(currentObservationId()),
      sourceCommentId: comment.commentId
    };
    const title = document.getElementById('commentRuleTitle');
    const observation = currentObservation();
    if (title && !title.value) title.value = (observation && observation.title ? observation.title : '评论方法') + ' · 规则草稿';
    switchTab('rules');
    renderRuleStatus();
  }

  function saveEvidenceLabel(commentId, label) {
    const stored = readJson(EVIDENCE_LABEL_KEY, {});
    const labels = stored && typeof stored === 'object' ? stored : {};
    const key = commentSourceKey(commentId);
    if (Object.prototype.hasOwnProperty.call(EVIDENCE_LABELS, label)) labels[key] = label;
    else delete labels[key];
    const keys = Object.keys(labels);
    if (keys.length > 5000) keys.slice(0, keys.length - 5000).forEach(function(item) { delete labels[item]; });
    writeJson(EVIDENCE_LABEL_KEY, labels);
    renderEvidenceMap();
    renderEvidence();
  }

  function renderEvidenceMap() {
    const summary = document.getElementById('commentEvidenceMapSummary');
    const target = document.getElementById('commentEvidenceMapList');
    if (!summary || !target) return;
    const comments = state.evidence ? state.evidence.comments : [];
    const labels = evidenceLabelsForCurrent();
    const grouped = window.CommentStrategyModel.groupEvidence(comments, labels);
    summary.innerHTML = ['support', 'counter', 'question', 'unclassified'].map(function(key) {
      const labels = { support: '支持', counter: '反证', question: '待核', unclassified: '未分类' };
      return '<article><span>' + labels[key] + '</span><strong>' + grouped[key].length + '</strong></article>';
    }).join('');
    if (!comments.length) {
      target.innerHTML = emptyHtml('当前没有可分类的评论', '先保存评论原文，再由你逐条标记支持、反证或待核问题。');
      return;
    }
    target.innerHTML = comments.map(function(comment) {
      return '<div class="comment-evidence-map-row">' + commentHtml(comment) + evidenceSelect(comment, labels) + '</div>';
    }).join('');
  }

  function renderAll() {
    renderEvidence();
    renderCreatorReplies();
    renderEvidenceMap();
    renderRuleSelect();
    renderRuleStatus();
  }

  function clearCommentState(message) {
    state.evidence = window.CommentStrategyModel.buildCommentEvidence({
      coverage: { status: 'not_loaded', message: message || '尚未读取评论资料。', complete: false },
      comments: []
    });
    renderAll();
  }

  async function loadComments(generation) {
    const channelId = currentChannelId();
    const observationId = currentObservationId();
    rememberSelection();
    if (!channelId || !observationId) {
      clearCommentState('当前没有可读取的观察记录，不能据此断言没有评论。');
      setStatus('没有可读取的观察记录', 'empty');
      return;
    }
    setStatus('正在读取当前观察记录的已保存评论...', 'loading');
    const data = await api('/api/expert/channels/' + channelId + '/observations/' + observationId + '/comments');
    if (generation !== loadGeneration) return;
    state.evidence = window.CommentStrategyModel.buildCommentEvidence(data);
    loadedAt = Date.now();
    renderAll();
    setStatus('已加载 · ' + state.evidence.counts.total + ' 条已保存评论 · ' + state.evidence.counts.verifiedCreatorComments + ' 条作者发言', 'ready');
  }

  async function loadObservations(generation) {
    const channelId = currentChannelId();
    if (!channelId) {
      state.observations = [];
      renderObservationSelect();
      clearCommentState('当前没有研究对象。');
      return;
    }
    const observations = await api('/api/expert/channels/' + channelId + '/observations?limit=200');
    if (generation !== loadGeneration) return;
    state.observations = Array.isArray(observations) ? observations : [];
    renderObservationSelect();
    await loadComments(generation);
  }

  async function load(force) {
    if (!force && loadedAt && Date.now() - loadedAt < 60000) {
      renderAll();
      return;
    }
    const generation = ++loadGeneration;
    setError(null);
    setStatus('正在读取研究对象...', 'loading');
    try {
      const channels = await api('/api/expert/channels');
      if (generation !== loadGeneration) return;
      state.channels = Array.isArray(channels) ? channels : [];
      renderChannelSelect();
      await loadObservations(generation);
    } catch (error) {
      if (generation !== loadGeneration) return;
      loadedAt = 0;
      setError(error);
      clearCommentState('资料加载失败，不能据此断言没有评论。');
      setStatus('加载失败', 'error');
    }
  }

  async function reloadChannel() {
    const generation = ++loadGeneration;
    setError(null);
    try {
      await loadObservations(generation);
    } catch (error) {
      if (generation !== loadGeneration) return;
      setError(error);
      clearCommentState('观察记录加载失败，不能据此断言没有评论。');
      setStatus('加载失败', 'error');
    }
  }

  async function reloadComments() {
    const generation = ++loadGeneration;
    setError(null);
    try {
      await loadComments(generation);
    } catch (error) {
      if (generation !== loadGeneration) return;
      setError(error);
      clearCommentState('评论资料加载失败，不能据此断言没有评论。');
      setStatus('加载失败', 'error');
    }
  }

  function switchTab(tab) {
    activeTab = ['evidence', 'creator', 'rules', 'map'].includes(tab) ? tab : 'evidence';
    document.querySelectorAll('[data-comment-strategy-tab]').forEach(function(button) {
      const active = button.getAttribute('data-comment-strategy-tab') === activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-comment-strategy-panel]').forEach(function(panel) {
      const active = panel.getAttribute('data-comment-strategy-panel') === activeTab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    if (activeTab === 'map') renderEvidenceMap();
    if (activeTab === 'rules') renderRuleStatus();
  }

  function bind() {
    if (bound) return;
    bound = true;
    const tabs = document.querySelector('.comment-strategy-tabs');
    if (tabs) tabs.addEventListener('click', function(event) {
      const button = event.target.closest('[data-comment-strategy-tab]');
      if (button) switchTab(button.getAttribute('data-comment-strategy-tab'));
    });
    if (tabs) tabs.addEventListener('keydown', function(event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(tabs.querySelectorAll('[data-comment-strategy-tab]'));
      const current = buttons.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      let next = current;
      if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
      if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      switchTab(buttons[next].getAttribute('data-comment-strategy-tab'));
      buttons[next].focus();
    });
    const channelSelect = document.getElementById('commentStrategyChannelSelect');
    if (channelSelect) channelSelect.addEventListener('change', function() { reloadChannel(); });
    const observationSelect = document.getElementById('commentStrategyObservationSelect');
    if (observationSelect) observationSelect.addEventListener('change', function() { reloadComments(); });
    const refresh = document.getElementById('commentStrategyRefreshBtn');
    if (refresh) refresh.addEventListener('click', function() { load(true); });
    const openCollector = document.getElementById('commentStrategyOpenCollectorBtn');
    if (openCollector) openCollector.addEventListener('click', function() { window.switchMainView('creatorTasks'); });
    ['commentStrategyEvidenceSearch', 'commentStrategyEvidenceFilter'].forEach(function(id) {
      const input = document.getElementById(id);
      if (input) input.addEventListener(id.indexOf('Search') >= 0 ? 'input' : 'change', renderEvidence);
    });
    const page = document.getElementById('commentStrategyView');
    if (page) page.addEventListener('click', function(event) {
      const source = event.target.closest('[data-comment-rule-source]');
      if (source) useCommentAsRuleSource(source.getAttribute('data-comment-rule-source'));
    });
    if (page) page.addEventListener('change', function(event) {
      const select = event.target.closest('[data-comment-evidence-label]');
      if (select) saveEvidenceLabel(select.getAttribute('data-comment-evidence-label'), select.value);
    });
    Object.keys(RULE_FIELDS).forEach(function(key) {
      const input = document.getElementById(RULE_FIELDS[key]);
      if (input) input.addEventListener('input', renderRuleStatus);
    });
    const cardSelect = document.getElementById('commentRuleCardSelect');
    if (cardSelect) cardSelect.addEventListener('change', loadRuleCard);
    const newButton = document.getElementById('commentRuleNewBtn');
    if (newButton) newButton.addEventListener('click', function() { fillRuleForm({}); });
    const deleteButton = document.getElementById('commentRuleDeleteBtn');
    if (deleteButton) deleteButton.addEventListener('click', deleteRuleCard);
    const saveButton = document.getElementById('commentRuleSaveBtn');
    if (saveButton) saveButton.addEventListener('click', saveRuleCard);
    switchTab(activeTab);
    fillRuleForm({});
  }

  function ensureLoaded() {
    bind();
    return load(false);
  }

  window.CommentStrategyLab = { bind, ensureLoaded, load };
})();
