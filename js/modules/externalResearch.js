(function(root) {
  let loading = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(value) {
    const url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function evidenceHtml(refs) {
    const links = (Array.isArray(refs) ? refs : []).map(function(ref, index) {
      const url = safeUrl(ref);
      return url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">证据 ' + (index + 1) + '</a>' : '';
    }).filter(Boolean);
    return links.length ? '<div class="external-research-evidence">' + links.join(' · ') + '</div>' : '<div class="external-research-evidence">来源链接不可用</div>';
  }

  function metaHtml(artifact) {
    const model = artifact && artifact.source && artifact.source.model || '未标注模型';
    return '<div class="external-research-meta">' + escapeHtml(artifact && artifact.marketDate || '--') + ' · ' +
      escapeHtml(model) + ' · 外部 AI 研究，未由本程序独立验证</div>';
  }

  function listText(label, values) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    return items.length ? '<p><strong>' + escapeHtml(label) + '</strong>' + escapeHtml(items.join('；')) + '</p>' : '';
  }

  function tagList(label, values, className) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length) return '';
    return '<section class="external-research-tags ' + escapeHtml(className || '') + '"><strong>' + escapeHtml(label) + '</strong><div>' +
      items.map(function(item) { return '<span>' + escapeHtml(item) + '</span>'; }).join('') + '</div></section>';
  }

  function renderHotspots(artifact) {
    const box = typeof document !== 'undefined' && document.getElementById('externalHotspotResearch');
    if (!box) return;
    if (!artifact || !artifact.payload) {
      box.innerHTML = '<div class="external-research-empty">尚未导入每日 AI 热点研究；这里不会用占位热点冒充实时结果。</div>';
      return;
    }
    const payload = artifact.payload;
    const items = Array.isArray(payload.items) ? payload.items : [];
    box.innerHTML = '<header><div><span>DAILY AI RESEARCH</span><h3>外部 AI 热点跟踪</h3></div>' + metaHtml(artifact) + '</header>' +
      (payload.summary ? '<p class="external-research-summary">' + escapeHtml(payload.summary) + '</p>' : '') +
      '<div class="external-research-grid">' + items.map(function(item) {
        return '<article><div><strong>' + escapeHtml(item.name) + '</strong><em>' + escapeHtml(item.state || '观察') + '</em></div>' +
          '<p>' + escapeHtml(item.thesis) + '</p>' + listText('驱动：', item.drivers) + listText('风险：', item.risks) + evidenceHtml(item.evidenceRefs) + '</article>';
      }).join('') + '</div>';
  }

  function renderIndustryChains(artifact) {
    const box = typeof document !== 'undefined' && document.getElementById('externalIndustryChainResearch');
    if (!box) return;
    if (!artifact || !artifact.payload) {
      box.innerHTML = '<div class="external-research-empty">尚未导入每日 AI 产业链更新；本地证据归纳仍可独立使用。</div>';
      return;
    }
    const payload = artifact.payload;
    const chains = Array.isArray(payload.chains) ? payload.chains : [];
    const catalystCount = chains.reduce(function(total, item) {
      return total + (Array.isArray(item.catalysts) ? item.catalysts.length : 0);
    }, 0);
    box.innerHTML = '<header><div><span>DAILY AI RESEARCH</span><h3>外部 AI 产业链更新</h3></div>' + metaHtml(artifact) + '</header>' +
      '<div class="external-industry-kpis"><article><span>跟踪产业链</span><strong>' + chains.length + '</strong></article>' +
      '<article><span>催化线索</span><strong>' + catalystCount + '</strong></article>' +
      '<article><span>研究日期</span><strong>' + escapeHtml(artifact.marketDate || '--') + '</strong></article></div>' +
      (payload.summary ? '<p class="external-research-summary">' + escapeHtml(payload.summary) + '</p>' : '') +
      '<div class="external-research-grid external-industry-grid">' + chains.map(function(item) {
        return '<article><div><strong>' + escapeHtml(item.name) + '</strong><em>' + escapeHtml(item.state || '跟踪') + '</em></div>' +
          '<p class="external-industry-thesis">' + escapeHtml(item.thesis) + '</p>' +
          tagList('产业链环节', item.stages, 'stages') + tagList('催化线索', item.catalysts, 'catalysts') +
          tagList('风险反证', item.risks, 'risks') + tagList('研究队列', item.relatedCodes, 'codes') +
          evidenceHtml(item.evidenceRefs) + '</article>';
      }).join('') + '</div>';
  }

  function render(payload) {
    payload = payload || {};
    renderHotspots(payload.hotspots);
    renderIndustryChains(payload.industryChains);
  }

  function load() {
    if (loading) return loading;
    if (!root.ApiClient || typeof root.ApiClient.fetchJsonData !== 'function') return Promise.resolve(null);
    loading = root.ApiClient.fetchJsonData('/api/external-research-batches/latest-artifacts')
      .then(function(payload) { render(payload); return payload; })
      .catch(function(error) { render({}); throw error; })
      .finally(function() { loading = null; });
    return loading;
  }

  const api = { load, render, renderHotspots, renderIndustryChains };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExternalResearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
