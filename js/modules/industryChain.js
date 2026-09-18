(function(root) {
  const STAGES = [
    { id: 'materials', label: '原材料与耗材' },
    { id: 'equipment', label: '生产与检测设备' },
    { id: 'components', label: '核心器件与零部件' },
    { id: 'manufacturing', label: '制造、封装与集成' },
    { id: 'applications', label: '下游应用' }
  ];
  const DEFAULT_ENDPOINTS = {
    catalog: '/api/industry-chain/taxonomy',
    discover: '/api/industry-chain'
  };
  const SOURCE_META_FIELDS = [
    { key: 'stockMetadata', label: '股票基础资料' },
    { key: 'knowledge', label: '本地研究资料' },
    { key: 'news', label: '公开资讯证据' }
  ];
  const SOURCE_STATUS_LABELS = {
    available: '可用',
    degraded: '部分可用',
    empty: '暂无数据',
    fallback: '仅本地兜底',
    unavailable: '暂不可用'
  };
  const state = {
    endpoints: Object.assign({}, DEFAULT_ENDPOINTS),
    catalog: [],
    selectedChain: '',
    selectedStage: '',
    lastQuery: '',
    lastResult: null,
    requestSequence: 0,
    catalogPromise: null,
    selectionTimer: null,
    researchTopics: [],
    researchTopicId: '',
    researchRequestSequence: 0,
    researchVersionSequence: 0,
    researchVersionId: '',
    conceptItems: [],
    conceptPage: 0,
    researchDetail: null,
    researchSelectedRelation: 0,
    researchView: 'graph',
    researchChart: null,
    conceptDiscovery: null,
    selectedConcept: null,
    conceptDetail: null,
    conceptRequestSequence: 0,
    conceptDetailSequence: 0,
    bound: false
  };

  function element(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeExternalUrl(value) {
    const url = String(value || '').trim();
    return /^https?:\/\/[^\s]+$/i.test(url) ? url : '';
  }

  function normalizeCatalog(payload) {
    const items = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.chains) ? payload.chains : [];
    return items.filter(function(item) {
      return item && item.id && item.name;
    });
  }

  function chainLabel(chainId) {
    if (chainId && typeof chainId === 'object') {
      return chainId.name || chainId.id || '未标明产业链';
    }
    const item = state.catalog.find(function(chain) { return chain.id === chainId; });
    return item && item.name ? item.name : chainId || '未标明产业链';
  }

  function stageLabel(stageId) {
    const item = STAGES.find(function(stage) { return stage.id === stageId; });
    return item ? item.label : stageId || '环节待核验';
  }

  function researchStatusLabel(status) {
    return { candidate: '候选', verified: '人工核验', disputed: '有争议', partial: '部分成功', failed: '失败', complete: '已完成', succeeded: '成功', running: '运行中', no_change: '无变化' }[status] || status || '候选';
  }

  function relationStock(item) {
    const stock = item && item.stock || {};
    return {
      code: stock.code || item && item.stockCode || '',
      name: stock.name || item && item.stockName || ''
    };
  }

  function formatConfidence(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '置信度未量化';
    const percentage = number <= 1 ? number * 100 : number;
    return '证据置信度 ' + Math.max(0, Math.min(100, percentage)).toFixed(0) + '%';
  }

  function formatTime(value) {
    const text = String(value || '').trim();
    return text ? text.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : '时间未提供';
  }

  function reasonLabel(reasonCode) {
    const labels = {
      'source-metadata-incomplete': '来源元数据不完整',
      'needs-stage-evidence': '缺少具体产业链环节证据',
      'needs-stock-binding': '资料尚未明确绑定股票代码',
      'stock-metadata-missing': '本地股票资料缺失',
      'classification-only': '仅命中行业、概念或程序标签',
      'association-not-verified': '股票关联来自程序推断，尚未核验',
      'negative-evidence': '资料为否定或澄清表述',
      'weak-theme-match': '主题关联较弱，需人工复核'
    };
    return labels[reasonCode] || reasonCode || '仍需补充证据';
  }

  function evidenceHtml(evidence) {
    const title = evidence && (evidence.title || evidence.evidenceId) || '未命名证据';
    const url = safeExternalUrl(evidence && (evidence.sourceUrl || evidence.url));
    const titleHtml = url
      ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(title) + '</a>'
      : '<strong>' + escapeHtml(title) + '</strong>';
    return '<li>' + titleHtml +
      '<span>' + escapeHtml(evidence && (evidence.source || evidence.sourceType) || '来源未标明') + '</span>' +
      '<small>' + escapeHtml(formatTime(evidence && (evidence.observedAt || evidence.publishedAt))) + '</small>' +
      (evidence && evidence.matchReason ? '<p>' + escapeHtml(evidence.matchReason) + '</p>' : '') +
    '</li>';
  }

  function relationHtml(item, kind) {
    const stock = relationStock(item || {});
    const evidence = Array.isArray(item && item.evidence) ? item.evidence : [];
    const kindLabel = kind === 'confirmed' ? '证据已确认' : '待核验';
    const detail = kind === 'confirmed'
      ? formatConfidence(item && item.confidence)
      : reasonLabel(item && item.reasonCode);
    return '<article class="industry-chain-relation ' + kind + '">' +
      '<header><div><strong>' + escapeHtml(stock.name || stock.code || '未命名股票') + '</strong>' +
      '<span>' + escapeHtml(stock.code) + '</span></div><em>' + kindLabel + '</em></header>' +
      '<p class="industry-chain-path">' + escapeHtml(chainLabel(item && item.chain)) + ' · ' + escapeHtml(stageLabel(item && item.stage)) + '</p>' +
      '<p class="industry-chain-confidence">' + escapeHtml(detail) + '</p>' +
      (evidence.length
        ? '<ul class="industry-chain-evidence-list">' + evidence.map(evidenceHtml).join('') + '</ul>'
        : '<p class="industry-chain-no-evidence">当前没有可展开的来源证据。</p>') +
      '<small>关系观察时间：' + escapeHtml(formatTime(item && item.observedAt)) + '</small>' +
    '</article>';
  }

  function renderCatalog(payload) {
    state.catalog = normalizeCatalog(payload);
    const box = element('industryChainCatalog');
    if (!box) return;
    if (!state.catalog.length) {
      box.innerHTML = '<div class="industry-chain-empty">产业链目录暂不可用。</div>';
      return;
    }
    box.innerHTML = '<button type="button" data-industry-chain-id="" class="' + (!state.selectedChain ? 'active' : '') + '">全部产业链</button>' +
      state.catalog.map(function(item) {
        const selected = item.id === state.selectedChain ? ' active' : '';
        return '<button type="button" class="' + selected.trim() + '" data-industry-chain-id="' + escapeHtml(item.id) + '">' +
          escapeHtml(item.name) + '</button>';
      }).join('');
  }

  function selectedChainCatalogItem() {
    return state.catalog.find(function(item) { return item.id === state.selectedChain; }) || null;
  }

  function renderStageMap() {
    const box = element('industryChainStageMap');
    if (!box) return;
    const selectedChain = selectedChainCatalogItem();
    const keywords = selectedChain && selectedChain.stages || {};
    box.innerHTML = '<button type="button" data-industry-chain-stage="" class="industry-chain-stage-all' + (!state.selectedStage ? ' active' : '') + '">全部环节</button>' +
      STAGES.map(function(stage) {
        const samples = Array.isArray(keywords[stage.id]) ? keywords[stage.id].slice(0, 3) : [];
        return '<button type="button" data-industry-chain-stage="' + stage.id + '" class="industry-chain-stage' + (state.selectedStage === stage.id ? ' active' : '') + '">' +
          '<strong>' + escapeHtml(stage.label) + '</strong>' +
          (samples.length ? '<small>' + samples.map(escapeHtml).join(' · ') + '</small>' : '') +
        '</button>';
      }).join('');
  }

  function emptyMessage(availability, kind) {
    if (availability === 'unavailable' && kind === 'confirmed') return '证据源暂不可用，未生成已确认关联。';
    if (kind === 'confirmed') return '暂无已确认关联；可换一个关键词，或补充公司主营与来源资料。';
    return '没有待核验候选。';
  }

  function safeSourceTime(meta) {
    const value = meta && (meta.updatedAt || meta.fetchedAt || meta.observedAt || meta.timestamp || meta.lastUpdatedAt);
    return value ? formatTime(value) : '更新时间未提供';
  }

  function sourceMetaHtml(result) {
    const sourceMeta = result && result.sourceMeta;
    if (!sourceMeta || typeof sourceMeta !== 'object') return '';
    const rows = SOURCE_META_FIELDS.map(function(source) {
      const meta = sourceMeta[source.key];
      if (!meta || typeof meta !== 'object') return '';
      const status = meta.degraded && meta.status === 'available' ? 'degraded' : meta.status;
      const statusText = SOURCE_STATUS_LABELS[status] || '状态未提供';
      const count = Number(meta.count);
      const countText = Number.isFinite(count) ? Math.max(0, count) + ' 条' : '计数未提供';
      return '<li><strong>' + escapeHtml(source.label) + '</strong><span>' +
        escapeHtml(statusText + ' · ' + countText + ' · ' + safeSourceTime(meta)) + '</span></li>';
    }).filter(Boolean);
    if (!rows.length) return '';
    return '<div class="industry-chain-gaps industry-chain-source-meta"><span>数据来源</span><ul>' + rows.join('') + '</ul></div>';
  }

  function safeDataGaps(result, availability) {
    const gaps = result && Array.isArray(result.dataGaps) ? result.dataGaps : [];
    if (availability !== 'degraded') return gaps;
    const errors = result && result.sourceMeta && Array.isArray(result.sourceMeta.errors)
      ? result.sourceMeta.errors
      : [];
    const rawMessages = errors.map(function(error) {
      return String(error && error.message || '').trim();
    }).filter(Boolean);
    return gaps.filter(function(gap) {
      const text = String(gap || '');
      if (/数据不可用\s*[:：]/.test(text)) return false;
      return !rawMessages.some(function(message) { return text.includes(message); });
    });
  }

  function renderRelations(items, kind, availability) {
    const id = kind === 'confirmed' ? 'industryChainConfirmed' : 'industryChainCandidates';
    const box = element(id);
    if (!box) return;
    const rows = Array.isArray(items) ? items : [];
    box.innerHTML = rows.length
      ? rows.map(function(item) { return relationHtml(item, kind); }).join('')
      : '<div class="industry-chain-empty">' + emptyMessage(availability, kind) + '</div>';
  }

  function renderEvidenceState(result) {
    const box = element('industryChainEvidenceState');
    if (!box) return;
    const confirmedCount = result && Array.isArray(result.confirmed) ? result.confirmed.length : 0;
    const candidateCount = result && Array.isArray(result.candidates) ? result.candidates.length : 0;
    const coverage = result && result.coverage || {};
    const totalConfirmed = Number.isFinite(Number(coverage.totalConfirmedRelationCount))
      ? Math.max(confirmedCount, Number(coverage.totalConfirmedRelationCount)) : confirmedCount;
    const totalCandidates = Number.isFinite(Number(coverage.totalCandidateRelationCount))
      ? Math.max(candidateCount, Number(coverage.totalCandidateRelationCount)) : candidateCount;
    const truncated = Boolean(coverage.truncated) && (totalConfirmed > confirmedCount || totalCandidates > candidateCount);
    const availability = result && result.availability || 'empty';
    const gaps = safeDataGaps(result, availability);
    let stateText = truncated
      ? '当前展示：已确认 ' + confirmedCount + ' / ' + totalConfirmed + ' 条，待核验 ' + candidateCount + ' / ' + totalCandidates + ' 条。可缩小产业链或环节继续查看。'
      : '已确认 ' + confirmedCount + ' 条，待核验 ' + candidateCount + ' 条。';
    if (availability === 'unavailable') stateText = '本地证据源暂不可用；没有用 0 或猜测结果代替。';
    else if (availability === 'empty') stateText = truncated
      ? '当前证据不足，未形成已确认关系。' + stateText
      : '当前证据不足，未形成已确认关系。';
    else if (availability === 'degraded') stateText = '部分数据源暂不可用；仍展示可用来源结果。' + stateText;
    box.innerHTML = '<p class="industry-chain-boundary"><strong>研究候选，不是荐股。</strong> ' + escapeHtml(stateText) + '</p>' +
      sourceMetaHtml(result) +
      (gaps.length
        ? '<div class="industry-chain-gaps"><span>仍缺资料</span><ul>' + gaps.map(function(gap) {
          return '<li>' + escapeHtml(gap) + '</li>';
        }).join('') + '</ul></div>'
        : '<small>每条已确认关系都应能展开来源证据。</small>');
  }

  function renderResult(result) {
    const normalized = result && typeof result === 'object' ? result : {};
    state.lastResult = normalized;
    renderRelations(normalized.confirmed, 'confirmed', normalized.availability);
    renderRelations(normalized.candidates, 'candidate', normalized.availability);
    renderEvidenceState(normalized);
  }

  function configureEndpoints(next) {
    next = next || {};
    if (next.catalog) state.endpoints.catalog = String(next.catalog);
    if (next.discover) state.endpoints.discover = String(next.discover);
    return Object.assign({}, state.endpoints);
  }

  function setSelection(chain, stage) {
    state.selectedChain = String(chain || '');
    state.selectedStage = String(stage || '');
    renderCatalog(state.catalog);
    renderStageMap();
  }

  function buildDiscoverUrl(query) {
    const params = new URLSearchParams();
    const text = String(query || '').trim();
    if (text) params.set('q', text);
    if (state.selectedChain) params.set('chain', state.selectedChain);
    if (state.selectedStage) params.set('stage', state.selectedStage);
    params.set('limit', '30');
    return state.endpoints.discover + (params.toString() ? '?' + params.toString() : '');
  }

  function setLoading(loading) {
    const button = element('industryChainSearchBtn');
    if (button) {
      button.disabled = Boolean(loading);
      button.textContent = loading ? '正在归纳…' : '自动归纳';
    }
  }

  function setRefreshStatus(text, status) {
    const target = element('industryChainRefreshStatus');
    if (!target) return;
    target.textContent = text;
    target.dataset.state = status || 'idle';
  }

  function showError(error) {
    renderResult({
      availability: 'unavailable',
      confirmed: [],
      candidates: [],
      dataGaps: [error && error.message ? error.message : '产业链证据加载失败。']
    });
  }

  function responseData(payload) {
    return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  }

  function researchEndpoint(path) {
    return '/api/industry-chain/research' + path;
  }

  function conceptProviderLabel(provider) {
    const labels = {
      'sina-public-concept': '新浪公开概念目录',
      'eastmoney-public-board': '东方财富公开板块目录',
      'mixed-public': '混合公开目录'
    };
    return labels[provider] || provider || '来源未提供';
  }

  function renderConceptDiscovery(data) {
    const list = element('industryConceptRadarList');
    const status = element('industryConceptRadarStatus');
    state.conceptDiscovery = data || {};
    const summary = state.conceptDiscovery.summary || {};
    const source = state.conceptDiscovery.source || {};
    state.conceptItems = Array.isArray(state.conceptDiscovery.items) ? state.conceptDiscovery.items : [];
    if (status) {
      const sourceState = source.status === 'available' ? '目录完整' : source.status === 'partial' ? '目录部分可用' : '目录暂不可用';
      const baseline = summary.baselineInitialized ? ' · 已建立首次基线，后续新增才标记为新发现' : '';
      status.textContent = '共 ' + (summary.total || 0) + ' 项 · 本次显示 ' + (summary.shown || 0) + ' · 新发现 ' + (summary.newCount || 0) + ' · 已跟踪 ' + (summary.trackedCount || 0) + ' · ' + sourceState + ' · ' + conceptProviderLabel(source.provider) + baseline;
    }
    if (!list) return;
    const pageCount = Math.max(1, Math.ceil(state.conceptItems.length / 24));
    state.conceptPage = Math.min(state.conceptPage, pageCount - 1);
    const paging = element('industryConceptPagination');
    if (paging) paging.innerHTML = '<button type="button" data-concept-page="-1"' + (!state.conceptPage ? ' disabled' : '') + '>上一页</button><span>' + (state.conceptPage + 1) + ' / ' + pageCount + ' 页 · 每页24项</span><button type="button" data-concept-page="1"' + (state.conceptPage >= pageCount - 1 ? ' disabled' : '') + '>下一页</button>';
    list.innerHTML = state.conceptItems.length ? state.conceptItems.slice(state.conceptPage * 24, state.conceptPage * 24 + 24).map(function(item) {
      const sourceItem = item.source || {};
      const active = state.selectedConcept && state.selectedConcept.provider === sourceItem.provider && state.selectedConcept.providerId === sourceItem.providerId ? ' active' : '';
      const badges = (item.isNew ? '<em>新发现</em>' : '') + (item.trackedTopicId ? '<em class="tracked">已跟踪</em>' : '');
      return '<button type="button" class="industry-concept-item' + active + '" data-concept-provider="' + escapeHtml(sourceItem.provider || '') + '" data-concept-provider-id="' + escapeHtml(sourceItem.providerId || '') + '" data-concept-name="' + escapeHtml(item.name || '') + '"><span><strong>' + escapeHtml(item.name || '未命名概念') + '</strong>' + badges + '</span><small>' + escapeHtml(item.classification || '概念板块') + ' · 首次记录 ' + escapeHtml(formatTime(item.firstSeenAt)) + '</small></button>';
    }).join('') : '<div class="industry-chain-empty">没有匹配的概念；若目录源不可用，会保留最近一次成功目录并明确标注。</div>';
  }

  async function loadConceptDiscovery(options) {
    options = options || {};
    const input = element('industryConceptSearchInput');
    const query = Object.prototype.hasOwnProperty.call(options, 'query') ? String(options.query || '') : String(input && input.value || '');
    if (input && Object.prototype.hasOwnProperty.call(options, 'query')) input.value = query;
    state.conceptPage = 0;
    const params = new URLSearchParams({ q: query, limit: String(options.limit || 1000) });
    if (options.refresh) params.set('refresh', '1');
    const requestId = ++state.conceptRequestSequence;
    const status = element('industryConceptRadarStatus');
    if (status) status.textContent = options.refresh ? '正在刷新概念目录…' : '正在读取概念目录…';
    const payload = await root.ApiClient.fetchJsonData(researchEndpoint('/concepts') + '?' + params.toString());
    const data = responseData(payload) || {};
    if (requestId === state.conceptRequestSequence) renderConceptDiscovery(data);
    return data;
  }

  function renderConceptDetail(concept, data) {
    const box = element('industryConceptRadarDetail');
    if (!box) return;
    const matching = state.conceptItems.find(function(item) {
      return item.source && item.source.provider === concept.provider && item.source.providerId === concept.providerId;
    });
    const tracked = matching && matching.trackedTopicId;
    const items = data && Array.isArray(data.items) ? data.items.filter(function(item) { return item && item.status !== 'unavailable'; }) : [];
    const members = items.slice(0, 30).map(function(item) {
      return '<span><b>' + escapeHtml(item.name || '未命名公司') + '</b> ' + escapeHtml(item.code || '') + '</span>';
    }).join('');
    const availability = data && data.status === 'unavailable'
      ? '<p class="industry-concept-gap">成分股本次不可用，未用猜测名单替代。</p>'
      : data && data.coverageComplete === false
        ? '<p class="industry-concept-gap">成分股仅部分覆盖，当前显示 ' + items.length + ' 项。</p>'
        : '<p>来源返回 ' + items.length + ' 只成分股，最多展示前 30 只。</p>';
    box.innerHTML = '<div class="industry-concept-detail-head"><div><strong>' + escapeHtml(concept.name || '概念详情') + '</strong><small>' + escapeHtml(conceptProviderLabel(concept.provider)) + ' · ' + escapeHtml(concept.providerId) + '</small></div>' +
      '<button type="button" class="small-btn primary" data-concept-track="1" data-concept-provider="' + escapeHtml(concept.provider) + '" data-concept-provider-id="' + escapeHtml(concept.providerId) + '"' + (tracked ? ' disabled' : '') + '>' + (tracked ? '已加入研究' : '加入持续研究') + '</button></div>' +
      availability + '<div class="industry-concept-members">' + (members || '<span>暂无可显示成分股</span>') + '</div>' +
      '<small class="industry-concept-boundary">概念目录与成分股只用于发现线索；公司是否属于产业链具体环节，仍需公告、年报或官网原文核验。</small>';
  }

  async function selectConcept(provider, providerId, name) {
    const concept = { provider: String(provider || ''), providerId: String(providerId || ''), name: String(name || '') };
    state.selectedConcept = concept;
    state.conceptDetail = null;
    renderConceptDiscovery(state.conceptDiscovery || { items: state.conceptItems, summary: {}, source: {} });
    const box = element('industryConceptRadarDetail');
    if (box) box.innerHTML = '<div class="industry-chain-empty">正在读取成分股…</div>';
    const requestId = ++state.conceptDetailSequence;
    const params = new URLSearchParams({ taxonomy: 'concept', code: concept.providerId });
    const payload = await root.ApiClient.fetchJsonData('/api/market/boards/constituents?' + params.toString());
    const data = responseData(payload) || {};
    if (requestId === state.conceptDetailSequence && state.selectedConcept && state.selectedConcept.providerId === concept.providerId) {
      state.conceptDetail = data;
      renderConceptDetail(concept, data);
    }
    return data;
  }

  async function trackConcept(provider, providerId) {
    const payload = await root.ApiClient.fetchJsonData(researchEndpoint('/concepts/track'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: String(provider || ''), providerId: String(providerId || '') })
    });
    const data = responseData(payload);
    if (data && data.topic) {
      state.conceptItems = state.conceptItems.map(function(item) {
        return item.source && item.source.provider === provider && item.source.providerId === providerId
          ? Object.assign({}, item, { trackedTopicId: data.topic.id }) : item;
      });
      if (state.conceptDiscovery) {
        state.conceptDiscovery = Object.assign({}, state.conceptDiscovery, {
          items: state.conceptItems,
          summary: Object.assign({}, state.conceptDiscovery.summary || {}, {
            trackedCount: state.conceptItems.filter(function(item) { return item.trackedTopicId; }).length
          })
        });
      }
      await loadResearchTopics();
      if (state.selectedConcept) renderConceptDetail(state.selectedConcept, state.conceptDetail || {});
      const status = element('industryConceptRadarStatus');
      if (status) status.textContent = data.created ? '已加入研究主题；自动更新保持关闭，请先补充可信来源。' : '该概念已经在研究主题中。';
    }
    return data;
  }

  function renderResearchTopics(topics) {
    const box = element('industryResearchTopics');
    state.researchTopics = Array.isArray(topics) ? topics : [];
    if (!box) return;
    box.innerHTML = state.researchTopics.length ? state.researchTopics.map(function(topic) {
      const active = topic.id === state.researchTopicId ? ' active' : '';
      const schedule = topic.enabled ? '已启用 · 下次 ' + formatTime(topic.nextDueAt) : '默认关闭';
      return '<button type="button" aria-pressed="' + (topic.id === state.researchTopicId ? 'true' : 'false') + '" class="industry-research-topic' + active + '" data-research-topic-id="' + escapeHtml(topic.id) + '"><strong>' + escapeHtml(topic.name) + '</strong><small>' + escapeHtml(schedule) + '</small></button>';
    }).join('') : '<div class="industry-chain-empty">暂无研究主题。</div>';
  }

  function setResearchLoading(loading) {
    const panel = element('industryResearchPanel');
    if (panel && typeof panel.setAttribute === 'function') panel.setAttribute('aria-busy', loading ? 'true' : 'false');
    ['industryResearchSourceUrls', 'industryResearchProposalInput', 'industryResearchEnabled', 'industryResearchInterval', 'industryResearchUseAi', 'industryResearchConfigSaveBtn', 'industryResearchUpdateBtn', 'industryResearchTopicsRefreshBtn'].forEach(function(id) {
      const control = element(id);
      if (control) control.disabled = Boolean(loading);
    });
    const detail = element('industryResearchDetail');
    if (detail && detail.querySelectorAll) detail.querySelectorAll('[data-research-review], [data-research-read], [data-research-note], select').forEach(function(control) { control.disabled = Boolean(loading); });
  }

  function researchEvidenceHtml(evidence, quote) {
    const finalUrl = /^https:\/\/[^\s]+$/i.test(String(evidence && (evidence.finalUrl || evidence.requestedUrl || evidence.canonicalUrl) || '').trim()) ? String(evidence.finalUrl || evidence.requestedUrl || evidence.canonicalUrl).trim() : '';
    const title = evidence && evidence.title || '原文证据';
    return '<li class="industry-research-evidence"><div>' + (finalUrl ? '<a href="' + escapeHtml(finalUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(title) + '</a>' : '<strong>' + escapeHtml(title) + '</strong>') + '</div>' +
      (quote ? '<small>原文片段：' + escapeHtml(quote) + '</small>' : '') +
      '<small>发布时间：' + escapeHtml(evidence && evidence.publishedAt ? formatTime(evidence.publishedAt) : '发布时间未知') + ' · 取回时间：' + escapeHtml(formatTime(evidence && evidence.fetchedAt)) + '</small>' +
      '<small>内容哈希：' + escapeHtml(evidence && evidence.contentSha256 || '未提供') + '</small></li>';
  }

  function renderResearchDetail(detail, preserveForm) {
    const box = element('industryResearchDetail');
    if (!box) return;
    if (state.researchChart) { state.researchChart.dispose(); state.researchChart = null; }
    if (state.researchDetail?.currentVersion?.id !== detail?.currentVersion?.id) state.researchSelectedRelation = 0;
    state.researchDetail = detail;
    const topic = detail && detail.topic || {};
    const version = detail && detail.currentVersion;
    const enabled = element('industryResearchEnabled');
    const interval = element('industryResearchInterval');
    const sourceUrls = element('industryResearchSourceUrls');
    if (!preserveForm) {
      if (enabled) enabled.checked = Boolean(topic.enabled);
      if (interval && topic.intervalMinutes != null) interval.value = topic.intervalMinutes;
      if (sourceUrls) sourceUrls.value = Array.isArray(topic.sourceUrls) ? topic.sourceUrls.join('\n') : '';
    }
    const evidenceById = new Map((version && Array.isArray(version.evidence) ? version.evidence : []).map(function(item) { return [item.id, item]; }));
    if (!version) {
      state.researchVersionId = '';
      const run = detail && detail.lastRun;
      box.innerHTML = '<div class="industry-research-detail-head"><h4>' + escapeHtml(topic.name || '研究主题') + '</h4><span>尚未形成版本，来源取证后显示。</span></div><p>自动更新：' + (topic.enabled ? '已开启' : '未开启') + ' · 已登记来源：' + (topic.sourceUrls || []).length + ' 个。请先保存可信来源，再点击“取证更新”；没有原文时不生成虚构关系图。</p>' + (run ? '<div class="industry-research-last-run">最近运行：' + escapeHtml(researchStatusLabel(run.status)) + (run.errors && run.errors.length ? ' · ' + escapeHtml(run.errors.map(function(item) { return item.code || 'RUN_FAILED'; }).join(', ')) : '') + '</div>' : '');
      return;
    }
    state.researchVersionId = version.id || '';
    const relations = Array.isArray(version.relations) ? version.relations : [];
    state.researchSelectedRelation = Math.min(state.researchSelectedRelation, Math.max(0, relations.length - 1));
    const relationHtml = relations.length ? relations.slice(state.researchSelectedRelation, state.researchSelectedRelation + 1).map(function(relation) {
      const evidenceRefs = Array.isArray(relation.evidenceRefs) ? relation.evidenceRefs : [];
      const metrics = Array.isArray(relation.metrics) ? relation.metrics : [];
      const evidence = evidenceRefs.map(function(ref) { return researchEvidenceHtml(evidenceById.get(ref.evidenceId), ref.quote); }).join('');
      const company = relation.company && relation.company.name ? relation.company.name + (relation.company.stockCode ? ' · ' + relation.company.stockCode : ' · 证券身份未核对') : '证券身份未核对';
      const review = relation.review ? '<div class="industry-research-review-audit">核验记录：' + escapeHtml(relation.review.note || '未填写说明') + ' · ' + escapeHtml(formatTime(relation.review.reviewedAt)) + ' · ' + escapeHtml(relation.review.source === 'imported_review' ? '导入核验，仅作审计' : relation.review.source === 'local_manual' ? '本机人工核验' : '人工核验') + '</div>' : '';
      return '<article class="industry-research-relation status-' + escapeHtml(relation.status || 'candidate') + '"><header><div><strong>' + escapeHtml(relation.product || '具体产品未提供') + '</strong><span>' + escapeHtml(company) + '</span></div><em>' + escapeHtml(researchStatusLabel(relation.status)) + '</em></header><p>' + escapeHtml(stageLabel(relation.stage)) + ' · ' + escapeHtml(relation.claim || '') + '</p>' +
        (metrics.length ? '<div class="industry-research-metrics">' + metrics.map(function(metric) { return '<span>' + escapeHtml(metric.name || '指标') + '：' + (metric.value == null ? '<b>缺口</b>' : escapeHtml(metric.value)) + ' ' + escapeHtml(metric.unit || '单位未知') + ' · ' + escapeHtml(metric.scope || 'scope未知') + '</span>'; }).join('') + '</div>' : '') +
        (evidence ? '<ul class="industry-research-evidence-list">' + evidence + '</ul>' : '<small>没有可用证据引用。</small>') +
        review + ((relation.status === 'candidate' || relation.status === 'verified') ? '<div class="industry-research-review"><label><input type="checkbox" data-research-read="' + escapeHtml(relation.id) + '"> 我已阅读原文</label><input data-research-note="' + escapeHtml(relation.id) + '" placeholder="核验说明（必填）">' + (relation.status === 'candidate' ? '<button type="button" data-research-review="' + escapeHtml(relation.id) + '" data-research-decision="verify">通过核验</button>' : '') + '<button type="button" data-research-review="' + escapeHtml(relation.id) + '" data-research-decision="dispute">标记争议</button></div>' : '') + '</article>';
    }).join('') : '<div class="industry-chain-empty">已取回资料，尚未建立产品或公司关联。</div>';
    const analysis = version.analysis || { kind: 'none' };
    const sourceEvidence = Array.isArray(version.evidence) ? version.evidence : [];
    const sourceBlock = '<section class="industry-research-sources"><strong>已取回原文来源</strong>' + (sourceEvidence.length ? '<ul class="industry-research-evidence-list">' + sourceEvidence.map(function(item) { return researchEvidenceHtml(item, item.snippet || ''); }).join('') + '</ul>' : '<p>暂无成功取回来源。</p>') + '</section>';
    const table = '<table><thead><tr><th>环节</th><th>产品 / 公司</th><th>证据状态</th></tr></thead><tbody>' + relations.map(function(relation, index) {
      return '<tr><td>' + escapeHtml(stageLabel(relation.stage)) + '</td><td><button type="button" class="small-btn" data-research-relation-index="' + index + '">' + escapeHtml(relation.product || '未命名产品') + '<br>' + escapeHtml(relation.company?.name || '公司未绑定') + '</button></td><td>' + escapeHtml(researchStatusLabel(relation.status)) + '</td></tr>';
    }).join('') + '</tbody></table>';
    const useGraph = state.researchView === 'graph' && root.IndustryResearchGraph && root.echarts && relations.length;
    const workbench = '<div class="industry-research-view-actions"><button type="button" data-research-view="graph">关系图</button><button type="button" data-research-view="table">紧凑表格</button><small>点击关系看右侧证据。连线表示环节归类，不是已确认供应合同或股价相关性；图最多展开16条，表格可看全部。</small></div><div class="industry-research-workbench"><div>' + (useGraph ? '<div id="industryResearchGraph" class="industry-research-graph"></div>' : table) + '</div><aside aria-label="选中关系的原文与核验">' + relationHtml + '</aside></div>';
    const changes = version.changes ? '<div class="industry-research-changes"><strong>变化</strong> 新增 ' + escapeHtml((version.changes.added || []).length) + ' · 变更 ' + escapeHtml((version.changes.changed || []).length) + ' · 争议 ' + escapeHtml((version.changes.disputed || []).length) + '</div>' : '';
    const lastRun = detail.lastRun ? '<div class="industry-research-last-run">最近运行：' + escapeHtml(researchStatusLabel(detail.lastRun.status)) + ' · 失败数 ' + escapeHtml(detail.lastRun.failedCount == null ? 0 : detail.lastRun.failedCount) + (detail.lastRun.errors && detail.lastRun.errors.length ? ' · ' + escapeHtml(detail.lastRun.errors.map(function(item) { return item.code || 'RUN_FAILED'; }).join(', ')) : '') + '</div>' : '';
    const gaps = Array.isArray(version.gaps) && version.gaps.length ? '<div class="industry-research-gaps"><strong>缺口</strong><ul>' + version.gaps.map(function(gap) { return '<li>' + escapeHtml(typeof gap === 'string' ? gap : gap.reason || gap.kind || '待补资料') + '</li>'; }).join('') + '</ul></div>' : '';
    const versionOptions = Array.isArray(detail.versions) ? detail.versions.map(function(item) { return '<option value="' + escapeHtml(item.id) + '"' + (item.id === version.id ? ' selected' : '') + '>版本 ' + escapeHtml(item.sequence) + ' · ' + escapeHtml(formatTime(item.createdAt)) + '</option>'; }).join('') : '';
    box.innerHTML = '<div class="industry-research-detail-head"><div><h4>' + escapeHtml(topic.name || '研究主题') + '</h4><span>版本 ' + escapeHtml(version.sequence) + ' · ' + escapeHtml(researchStatusLabel(version.status || 'complete')) + ' · 更新 ' + escapeHtml(formatTime(version.createdAt)) + '</span></div><div><label class="industry-research-version">历史版本 <select id="industryResearchVersionSelect">' + versionOptions + '</select></label><span>AI：' + escapeHtml(analysis.kind === 'ai_inference' ? '候选推断' : analysis.status === 'failed' ? '失败' : '未启用') + '</span></div></div>' +
      '<div class="industry-research-analysis">独立 AI 判断：' + escapeHtml(analysis.kind === 'ai_inference' ? analysis.text || '已生成候选，仍需人工核对。' : analysis.status === 'failed' ? 'AI 未完成，不影响原文证据保存。' : '未启用') + '</div>' + workbench + '<details><summary>全部原文与版本变化</summary>' + sourceBlock + changes + lastRun + gaps + '</details>';
    const graphBox = element('industryResearchGraph');
    if (useGraph && graphBox) {
      const graph = root.IndustryResearchGraph.buildGraph(topic.name, relations);
      graphBox.style.height = Math.max(380, graph.shown * 62) + 'px';
      state.researchChart = root.echarts.init(graphBox);
      state.researchChart.setOption({ animation: false, series: [{ type: 'graph', layout: 'none', roam: false, symbol: 'roundRect',
        left: 85, right: 125, top: 40, bottom: 40, data: graph.nodes, links: graph.links, edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 5,
        label: { show: true, color: '#fff', fontSize: 12, lineHeight: 17, overflow: 'break', width: 190 },
        edgeLabel: { color: '#64748b', fontSize: 10 }, lineStyle: { color: '#8795ad', width: 1.5 }, emphasis: { focus: 'adjacency' } }] });
      state.researchChart.on('click', function(event) {
        if (Number.isInteger(event.data?.relationIndex)) { state.researchSelectedRelation = event.data.relationIndex; renderResearchDetail(state.researchDetail, true); }
      });
    }
  }

  async function loadResearchTopics(options) {
    options = options || {};
    const payload = await root.ApiClient.fetchJsonData(researchEndpoint('/topics'));
    const data = responseData(payload);
    renderResearchTopics(data);
    if (options.selectFirst && state.researchTopics[0]) return selectResearchTopic(state.researchTopics[0].id);
    return state.researchTopics;
  }

  async function selectResearchTopic(topicId) {
    const requestId = ++state.researchRequestSequence;
    state.researchTopicId = String(topicId || '');
    state.researchVersionSequence += 1;
    setResearchLoading(true);
    const proposalInput = element('industryResearchProposalInput');
    if (proposalInput) proposalInput.value = '';
    renderResearchTopics(state.researchTopics);
    try {
      const payload = await root.ApiClient.fetchJsonData(researchEndpoint('/topics/' + encodeURIComponent(state.researchTopicId)));
      const detail = responseData(payload);
      if (requestId === state.researchRequestSequence && state.researchTopicId === String(topicId || '')) {
        state.researchVersions = Array.isArray(detail.versions) ? detail.versions : [];
        renderResearchDetail(detail);
        const status = element('industryResearchStatus');
        if (status) status.textContent = '已加载研究主题：' + (detail.topic && detail.topic.name || '当前主题');
        setResearchLoading(false);
      }
      return detail;
    } catch (error) {
      if (requestId === state.researchRequestSequence && state.researchTopicId === String(topicId || '')) {
        const status = element('industryResearchStatus');
        if (status) status.textContent = '主题读取失败，暂不可编辑';
      }
      throw error;
    }
  }

  async function loadResearchVersion(versionId) {
    const requestId = ++state.researchVersionSequence;
    const topicId = state.researchTopicId;
    const topicRequestId = state.researchRequestSequence;
    const payload = await root.ApiClient.fetchJsonData(researchEndpoint('/topics/' + encodeURIComponent(topicId) + '/versions/' + encodeURIComponent(versionId)));
    const detail = responseData(payload);
    if (requestId === state.researchVersionSequence && topicRequestId === state.researchRequestSequence && topicId === state.researchTopicId) renderResearchDetail({ topic: state.researchTopics.find(function(item) { return item.id === topicId; }), currentVersion: detail, versions: state.researchVersions });
    return detail;
  }

  async function saveResearchConfig(topicId, config) {
    const target = topicId || state.researchTopicId;
    const sourceInput = element('industryResearchSourceUrls');
    const nextConfig = Object.assign({}, config || {});
    if (sourceInput) nextConfig.sourceUrls = String(sourceInput.value || '').split(/\r?\n/).map(function(item) { return item.trim(); }).filter(Boolean);
    const payload = await root.ApiClient.fetchJsonData(researchEndpoint('/topics/' + encodeURIComponent(target)), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nextConfig) });
    const data = responseData(payload);
    renderResearchTopics(state.researchTopics.map(function(topic) { return topic.id === target ? data : topic; }));
    const status = element('industryResearchStatus');
    if (status) status.textContent = '配置已保存';
    return data;
  }

  async function updateResearchTopic() {
    const topicId = state.researchTopicId;
    const requestId = ++state.researchRequestSequence;
    const versionRequestId = ++state.researchVersionSequence;
    const proposalInput = element('industryResearchProposalInput');
    const sourceInput = element('industryResearchSourceUrls');
    if (!sourceInput || !String(sourceInput.value || '').split(/\r?\n/).some(function(item) { return item.trim(); })) {
      const emptyStatus = element('industryResearchStatus');
      if (emptyStatus) emptyStatus.textContent = '请先登记并保存至少一个来源 URL。';
      throw new Error('请先登记并保存至少一个来源 URL。');
    }
    const useAi = Boolean(element('industryResearchUseAi') && element('industryResearchUseAi').checked);
    let proposals = [];
    if (proposalInput && String(proposalInput.value || '').trim()) proposals = JSON.parse(proposalInput.value);
    const status = element('industryResearchStatus');
    if (status) status.textContent = '正在取证…';
    const sourceUrls = String(sourceInput.value || '').split(/\r?\n/).map(function(item) { return item.trim(); }).filter(Boolean);
    const payload = await root.ApiClient.fetchJsonData(researchEndpoint('/topics/' + encodeURIComponent(state.researchTopicId) + '/update'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposals, useAi, sourceUrls }) });
    const data = responseData(payload);
    if (requestId !== state.researchRequestSequence || versionRequestId !== state.researchVersionSequence || topicId !== state.researchTopicId) return data;
    const runStatus = data.run && data.run.status;
    renderResearchDetail({ topic: state.researchTopics.find(function(item) { return item.id === topicId; }), currentVersion: data.currentVersion, lastRun: data.run, versions: state.researchVersions });
    if (data.run && data.run.status !== 'failed' && topicId === state.researchTopicId) {
      const refresh = selectResearchTopic(topicId);
      const refreshRequestId = state.researchRequestSequence;
      await refresh;
      if (topicId !== state.researchTopicId || refreshRequestId !== state.researchRequestSequence) return data;
    }
    if (status) status.textContent = (runStatus === 'failed' ? (data.currentVersion ? '更新失败，已保留旧版' : '更新失败，尚未形成版本') : runStatus === 'partial' ? '部分成功，已合并可用证据' : '取证更新已完成') + '；本次按填写的来源取证，持续更新需保存来源配置并启用。';
    return data;
  }

  async function reviewResearchRelation(relationId, note, decision) {
    const read = element('industryResearchDetail') && element('industryResearchDetail').querySelector ? element('industryResearchDetail').querySelector('[data-research-read="' + relationId + '"]') : null;
    if (!read || !read.checked || !String(note || '').trim()) throw new Error('请先阅读原文并填写核验说明。');
    return root.ApiClient.fetchJsonData(researchEndpoint('/topics/' + encodeURIComponent(state.researchTopicId) + '/review'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersionId: state.researchVersionId, relationIds: [relationId], decision: decision === 'dispute' ? 'dispute' : 'verify', note: String(note).trim() }) });
  }

  function bindResearch() {
    const topics = element('industryResearchTopics');
    if (topics) topics.addEventListener('click', function(event) { const target = closestWithAttribute(event.target, 'data-research-topic-id'); if (target) selectResearchTopic(target.getAttribute('data-research-topic-id')).catch(function() {}); });
    const refreshButton = element('industryResearchTopicsRefreshBtn');
    if (refreshButton) refreshButton.addEventListener('click', function() { loadResearchTopics({ force: true }).catch(function() {}); });
    const updateButton = element('industryResearchUpdateBtn');
    if (updateButton) updateButton.addEventListener('click', function() { updateResearchTopic().catch(function(error) { const status = element('industryResearchStatus'); if (status) status.textContent = error.message || '更新失败'; }); });
    const configButton = element('industryResearchConfigSaveBtn');
    if (configButton) configButton.addEventListener('click', function() { saveResearchConfig(state.researchTopicId, { enabled: Boolean(element('industryResearchEnabled') && element('industryResearchEnabled').checked), intervalMinutes: Number(element('industryResearchInterval') && element('industryResearchInterval').value) }).catch(function(error) { const status = element('industryResearchStatus'); if (status) status.textContent = error.message || '配置保存失败'; }); });
    const detail = element('industryResearchDetail');
    if (detail) detail.addEventListener('click', function(event) {
      const mode = closestWithAttribute(event.target, 'data-research-view');
      const relation = closestWithAttribute(event.target, 'data-research-relation-index');
      if (mode) state.researchView = mode.getAttribute('data-research-view') === 'table' ? 'table' : 'graph';
      else if (relation) state.researchSelectedRelation = Number(relation.getAttribute('data-research-relation-index')) || 0;
      else return;
      renderResearchDetail(state.researchDetail, true);
    });
    if (detail) detail.addEventListener('change', function(event) { if (event.target && event.target.id === 'industryResearchVersionSelect') loadResearchVersion(event.target.value).catch(function() {}); });
    if (detail) detail.addEventListener('click', function(event) { const target = closestWithAttribute(event.target, 'data-research-review'); if (!target) return; const relationId = target.getAttribute('data-research-review'); const decision = target.getAttribute('data-research-decision'); const note = detail.querySelector('[data-research-note="' + relationId + '"]'); reviewResearchRelation(relationId, note && note.value, decision).then(function() { return selectResearchTopic(state.researchTopicId); }).then(function() { const status = element('industryResearchStatus'); if (status) status.textContent = decision === 'dispute' ? '争议标记已保存' : '人工核验已保存'; }).catch(function(error) { const status = element('industryResearchStatus'); if (status) status.textContent = error.message || '核验失败'; }); });
    const conceptInput = element('industryConceptSearchInput');
    const conceptRefresh = element('industryConceptRefreshBtn');
    const conceptList = element('industryConceptRadarList');
    const paging = element('industryConceptPagination');
    if (paging) paging.addEventListener('click', function(event) {
      const button = closestWithAttribute(event.target, 'data-concept-page');
      if (button) { state.conceptPage = Math.max(0, state.conceptPage + Number(button.getAttribute('data-concept-page'))); renderConceptDiscovery(state.conceptDiscovery); }
    });
    const conceptDetail = element('industryConceptRadarDetail');
    if (conceptInput) conceptInput.addEventListener('keydown', function(event) { if (event.key === 'Enter') loadConceptDiscovery({ query: conceptInput.value }).catch(function() {}); });
    if (conceptRefresh) conceptRefresh.addEventListener('click', function() { loadConceptDiscovery({ query: conceptInput && conceptInput.value, refresh: true }).catch(function(error) { const status = element('industryConceptRadarStatus'); if (status) status.textContent = error.message || '概念目录刷新失败'; }); });
    if (conceptList) conceptList.addEventListener('click', function(event) {
      const target = closestWithAttribute(event.target, 'data-concept-provider-id');
      if (!target) return;
      selectConcept(target.getAttribute('data-concept-provider'), target.getAttribute('data-concept-provider-id'), target.getAttribute('data-concept-name')).catch(function(error) { if (conceptDetail) conceptDetail.innerHTML = '<div class="industry-chain-empty">' + escapeHtml(error.message || '成分股读取失败') + '</div>'; });
    });
    if (conceptDetail) conceptDetail.addEventListener('click', function(event) {
      const target = closestWithAttribute(event.target, 'data-concept-track');
      if (!target) return;
      trackConcept(target.getAttribute('data-concept-provider'), target.getAttribute('data-concept-provider-id')).catch(function(error) { const status = element('industryConceptRadarStatus'); if (status) status.textContent = error.message || '加入研究失败'; });
    });
  }

  async function loadCatalog(options) {
    options = options || {};
    if (!root.ApiClient || typeof root.ApiClient.fetchJsonData !== 'function') {
      throw new Error('数据接口尚未就绪。');
    }
    if (options.force) state.catalog = [];
    if (state.catalog.length) return state.catalog;
    if (!state.catalogPromise) {
      state.catalogPromise = root.ApiClient.fetchJsonData(state.endpoints.catalog).then(function(payload) {
        renderCatalog(payload);
        renderStageMap();
        return state.catalog;
      }).finally(function() {
        state.catalogPromise = null;
      });
    }
    return state.catalogPromise;
  }

  async function refresh() {
    setRefreshStatus('正在更新本地证据与外部研究…', 'loading');
    const results = await Promise.allSettled([
      loadCatalog({ force: true }),
      root.ExternalResearch && typeof root.ExternalResearch.load === 'function'
        ? root.ExternalResearch.load() : Promise.resolve(null)
    ]);
    const rejected = results.find(function(item) { return item.status === 'rejected'; });
    if (rejected) {
      setRefreshStatus('部分更新失败：' + (rejected.reason && rejected.reason.message || '数据源不可用'), 'warn');
    } else {
      setRefreshStatus('已更新目录、证据与最近研究', 'ok');
    }
    if (state.lastQuery || state.selectedChain) await discover(state.lastQuery).catch(function() {});
    return results;
  }

  async function importResearchFile(file) {
    if (!file || typeof file.text !== 'function') throw new Error('请选择有效的 JSON 文件。');
    setRefreshStatus('正在校验并导入研究更新…', 'loading');
    const payload = JSON.parse(await file.text());
    await root.ApiClient.fetchJsonData('/api/external-research-batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (root.ExternalResearch && typeof root.ExternalResearch.load === 'function') await root.ExternalResearch.load();
    setRefreshStatus('研究更新已导入并重新展示', 'ok');
    return payload;
  }

  async function discover(query) {
    if (!root.ApiClient || typeof root.ApiClient.fetchJsonData !== 'function') {
      throw new Error('数据接口尚未就绪。');
    }
    const input = element('industryChainSearchInput');
    const text = String(query == null ? input && input.value || '' : query).trim();
    state.lastQuery = text;
    if (input && query != null) input.value = text;
    if (!text && !state.selectedChain) {
      state.requestSequence += 1;
      const empty = {
        availability: 'empty',
        confirmed: [],
        candidates: [],
        dataGaps: ['请先输入产业链、原材料、设备或零部件关键词。']
      };
      renderResult(empty);
      return empty;
    }
    const requestId = ++state.requestSequence;
    setLoading(true);
    try {
      const result = await root.ApiClient.fetchJsonData(buildDiscoverUrl(text));
      if (requestId === state.requestSequence) renderResult(result);
      return result;
    } catch (error) {
      if (requestId === state.requestSequence) showError(error);
      throw error;
    } finally {
      if (requestId === state.requestSequence) setLoading(false);
    }
  }

  function closestWithAttribute(target, attribute) {
    if (!target) return null;
    if (typeof target.closest === 'function') return target.closest('[' + attribute + ']');
    return Object.prototype.hasOwnProperty.call(target, attribute) ? target : null;
  }

  function scheduleDiscover() {
    if (state.selectionTimer) clearTimeout(state.selectionTimer);
    state.selectionTimer = setTimeout(function() {
      state.selectionTimer = null;
      discover().catch(function(error) { console.warn(error.message); });
    }, 100);
  }

  function bind() {
    if (state.bound || typeof document === 'undefined') return;
    state.bound = true;
    bindResearch();
    const input = element('industryChainSearchInput');
    const button = element('industryChainSearchBtn');
    const catalog = element('industryChainCatalog');
    const stages = element('industryChainStageMap');
    const refreshButton = element('refreshIndustryChainBtn');
    const researchFile = element('industryChainResearchFile');
    if (button) button.addEventListener('click', function() {
      discover().catch(function(error) { console.warn(error.message); });
    });
    if (input) input.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') discover().catch(function(error) { console.warn(error.message); });
    });
    if (catalog) catalog.addEventListener('click', function(event) {
      const target = closestWithAttribute(event.target, 'data-industry-chain-id');
      if (!target) return;
      const chain = target.getAttribute ? target.getAttribute('data-industry-chain-id') : target['data-industry-chain-id'];
      setSelection(chain, '');
      const selected = selectedChainCatalogItem();
      if (input && !String(input.value || '').trim() && selected) input.value = selected.name;
      scheduleDiscover();
    });
    if (stages) stages.addEventListener('click', function(event) {
      const target = closestWithAttribute(event.target, 'data-industry-chain-stage');
      if (!target) return;
      const stage = target.getAttribute ? target.getAttribute('data-industry-chain-stage') : target['data-industry-chain-stage'];
      setSelection(state.selectedChain, stage);
      scheduleDiscover();
    });
    if (refreshButton) refreshButton.addEventListener('click', function() {
      refresh().catch(function(error) { setRefreshStatus(error.message || '更新失败', 'error'); });
    });
    if (researchFile) researchFile.addEventListener('change', function() {
      const file = researchFile.files && researchFile.files[0];
      importResearchFile(file).catch(function(error) { setRefreshStatus(error.message || '导入失败', 'error'); });
      researchFile.value = '';
    });
  }

  async function load() {
    bind();
    try {
      const catalog = await loadCatalog();
      if (element('industryResearchTopics')) await loadResearchTopics();
      if (element('industryConceptRadarList')) await loadConceptDiscovery();
      return catalog;
    } catch (error) {
      const catalog = element('industryChainCatalog');
      if (catalog) catalog.innerHTML = '<div class="industry-chain-empty">' + escapeHtml(error.message || '产业链目录加载失败。') + '</div>';
      showError(error);
      throw error;
    }
  }

  const api = {
    STAGES,
    DEFAULT_ENDPOINTS,
    configureEndpoints,
    setSelection,
    buildDiscoverUrl,
    renderCatalog,
    renderStageMap,
    renderRelations,
    renderEvidenceState,
    renderResult,
    loadCatalog,
    discover,
    refresh,
    importResearchFile,
    loadResearchTopics,
    selectResearchTopic,
    loadResearchVersion,
    renderConceptDiscovery,
    loadConceptDiscovery,
    selectConcept,
    trackConcept,
    saveResearchConfig,
    updateResearchTopic,
    reviewResearchRelation,
    bind,
    load
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.IndustryChain = api;
})(typeof window !== 'undefined' ? window : globalThis);
