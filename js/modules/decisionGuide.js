(function() {
  let requestSequence = 0;
  const cache = new Map();

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function target() {
    return document.getElementById('decisionGuideStrip');
  }

  function signed(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return (number > 0 ? '+' : '') + number;
  }

  function periodLabel(period) {
    return { day: '日线', week: '周线', month: '月线' }[period] || period;
  }

  function setLoading(stock) {
    const box = target();
    if (!box) return;
    box.hidden = false;
    box.setAttribute('data-state', 'loading');
    box.innerHTML = '<strong>决策观察</strong><span>正在核对 ' + escapeHtml(stock && (stock.name || stock.code) || '当前股票') + ' 的趋势、动量与量能…</span>';
  }

  function render(result) {
    const box = target();
    if (!box) return;
    const guide = result && result.decisionGuide;
    if (!guide) {
      box.hidden = true;
      return;
    }
    const state = guide.key || 'insufficient';
    const evidence = (guide.evidence || []).slice().sort(function(left, right) {
      return Math.abs(Number(right.weight) || 0) - Math.abs(Number(left.weight) || 0);
    }).slice(0, 4);
    const confirmation = (guide.confirmations || [])[0] || '等待更多同周期数据确认。';
    const invalidation = (guide.invalidation || [])[0] || '当前没有可量化的失效条件。';
    const coverage = result.coverage || {};
    box.hidden = false;
    box.setAttribute('data-state', state);
    box.innerHTML = '<div class="decision-guide-main">' +
      '<span class="decision-guide-label">' + escapeHtml(guide.label) + '</span>' +
      '<strong>观察分 ' + escapeHtml(signed(guide.score)) + '</strong>' +
      '<p>' + escapeHtml(guide.summary) + '</p>' +
      '<div class="decision-guide-evidence">' + evidence.map(function(item) {
        return '<span data-direction="' + escapeHtml(item.direction) + '">' + escapeHtml(item.label) + ' ' + escapeHtml(item.weight > 0 ? '+' + item.weight : item.weight) + '</span>';
      }).join('') + '</div></div>' +
      '<details class="decision-guide-detail"><summary>依据与失效条件</summary>' +
      '<dl><dt>等待确认</dt><dd>' + escapeHtml(confirmation) + '</dd>' +
      '<dt>失效条件</dt><dd>' + escapeHtml(invalidation) + '</dd>' +
      '<dt>数据口径</dt><dd>' + escapeHtml(periodLabel(result.period)) + ' · ' + escapeHtml(coverage.eligibleBars || 0) + ' 根 · 截至 ' + escapeHtml(result.asOf || '--') + '</dd></dl>' +
      '<small>确定性规则 ' + escapeHtml(guide.rulesVersion) + '，尚未正式回测，不是自动下单指令。</small></details>';
  }

  function snapshotBars(rows) {
    return (rows || []).map(function(bar) {
      return {
        date: bar.date || bar.time || bar.datetime,
        open: bar.open,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume
      };
    });
  }

  async function requestAnalysis(code, period, bars) {
    const rows = snapshotBars(bars);
    const asOf = rows.length ? String(rows[rows.length - 1].date || '') : '';
    if (!code || !period || !rows.length || !asOf) return null;
    const key = [code, period, asOf, rows.length].join('|');
    if (cache.has(key)) return cache.get(key);
    const result = await window.ApiClient.apiFetch('/api/chart-coach/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, period, asOf, bars: rows })
    });
    cache.set(key, result);
    return result;
  }

  async function refreshForStock(stock) {
    if (!stock || !stock.code) return null;
    const requestId = ++requestSequence;
    const code = stock.code;
    setLoading(stock);
    try {
      let bars = [];
      if (window.State.currentView === 'kline' && window.State.currentPeriod === 'day' &&
          window.State.currentKlineMeta && window.State.currentKlineMeta.code === code &&
          window.State.currentKlineMeta.period === 'day' &&
          Array.isArray(window.State.currentRawData) && window.State.currentRawData.length) {
        bars = window.State.currentRawData;
      } else {
        const envelope = await window.ApiClient.fetchApiEnvelope('/api/kline?code=' + encodeURIComponent(code) + '&period=day');
        bars = Array.isArray(envelope.data) ? envelope.data : [];
      }
      if (requestId !== requestSequence || !window.State.currentStock || window.State.currentStock.code !== code) return null;
      if (!bars.length) {
        render({
          period: 'day', asOf: '--', coverage: { eligibleBars: 0 },
          decisionGuide: { key: 'insufficient', label: '数据不足', score: null, summary: '日线数据暂不可用，无法生成观察等级。', evidence: [], confirmations: [], invalidation: [], rulesVersion: 'webstock-decision-observation/1.0.0' }
        });
        return null;
      }
      const result = await requestAnalysis(code, 'day', bars);
      if (requestId !== requestSequence || !window.State.currentStock || window.State.currentStock.code !== code) return null;
      render(result);
      return result;
    } catch (error) {
      if (requestId === requestSequence) {
        const box = target();
        if (box) {
          box.hidden = false;
          box.setAttribute('data-state', 'error');
          box.innerHTML = '<strong>决策观察暂不可用</strong><span>已保留行情页面，不生成替代结论。</span>';
        }
      }
      return null;
    }
  }

  window.DecisionGuide = { setLoading, render, refreshForStock };
})();
