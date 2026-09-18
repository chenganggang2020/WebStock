(function(root) {
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(x) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x];
    });
  }
  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  function amount(value) {
    const n = numeric(value);
    return n === null ? '--' : (n > 0 ? '+' : '') + n.toFixed(2) + ' 亿元';
  }
  function color(value) { return numeric(value) === null || value === 0 ? 'flat' : value < 0 ? 'out' : 'in'; }
  function formatTime(value) {
    return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '--';
  }
  function safeLink(value, image) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
        (image ? url.hostname === 'np-newspic.dfcfw.com' && /^\/download\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(url.pathname)
          : url.hostname === 'wap.eastmoney.com' && /^\/a\/\d{10,20}\.html$/.test(url.pathname));
    } catch (_) { return false; }
  }
  function row(item) {
    return '<li><b>' + esc(item && item.code) + '</b><span>' + esc(item && item.name) +
      '</span><strong class="' + color(item && item.value) + '">' + amount(item && item.value) + '</strong></li>';
  }
  function render(data) {
    const box = document.getElementById('eastmoneyEtfDailyReport');
    if (!box) return;
    data = data || {};
    const find = selector => box.querySelector(selector);
    find('.eastmoney-etf-daily-date').textContent = '数据日 ' + (data.asOf || '--') +
      (!data.asOf && data.expectedAsOf ? ' · 目标日 ' + data.expectedAsOf : '') +
      ' · 发布 ' + formatTime(data.publishedAt) + ' · 最近检查 ' + formatTime(data.checkedAt);
    find('.eastmoney-etf-daily-total').innerHTML = '<b class="' + color(data.totalNetFlow) + '">' + amount(data.totalNetFlow) + '</b>';
    find('.eastmoney-etf-daily-stock').innerHTML = '<b class="' + color(data.stockEtfNetFlow) + '">' + amount(data.stockEtfNetFlow) + '</b>';
    for (const key of ['subscriptions', 'redemptions']) {
      find('.eastmoney-etf-daily-' + key).innerHTML = Array.isArray(data[key]) && data[key].length
        ? data[key].slice(0, 3).map(row).join('') : '<li>暂无已核验正文榜单</li>';
    }
    const current = data.isCurrent && !data.lastError;
    const state = current ? '来源/日期已核验' : data.availability === 'available' ? '保留历史数据，等待更新' : '暂无已核验日报';
    find('.eastmoney-etf-daily-status').textContent = state + (data.lastError ? ' · 最近失败：' + data.lastError : '') +
      (data.source ? ' · ' + data.source : '') + ' · 正文各TOP3；原图可查看完整图表，未结构化提取。';
    for (const [selector, value, image] of [
      ['.eastmoney-etf-daily-source', data.sourceUrl, false],
      ['.eastmoney-etf-daily-image', data.originalImageUrl, true]
    ]) {
      const link = find(selector), valid = safeLink(value, image);
      if (link) { link.hidden = !valid; link.href = valid ? value : '#'; }
    }
  }
  let pending = null;
  function load(refresh) {
    if (pending) return pending;
    const box = document.getElementById('eastmoneyEtfDailyReport');
    if (!box) return Promise.resolve();
    const button = box.querySelector('button');
    button.disabled = true;
    pending = (async function() {
      try {
        const result = await root.apiFetch(refresh ? '/api/market/etf-daily-report/refresh' : '/api/market/etf-daily-report',
          { method: refresh ? 'POST' : 'GET', timeoutMs: 30000, maxRetries: 0, cache: 'no-store' });
        render(result && result.success === true ? result.data : result);
      } catch (error) {
        box.querySelector('.eastmoney-etf-daily-status').textContent = '读取失败，保留已有数据：' + (error.message || error);
      } finally { button.disabled = false; }
    })().finally(function() { pending = null; });
    return pending;
  }
  function bind() {
    const box = document.getElementById('eastmoneyEtfDailyReport');
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    box.querySelector('button').addEventListener('click', function() { load(true); });
    load(false);
    // Read the local cache only; source collection belongs to the backend scheduler.
    const timer = root.setInterval(function() {
      if (document.visibilityState === 'visible' && (!root.State || root.State.currentMainView === 'dashboard')) load(false);
    }, 60000);
    root.addEventListener('pagehide', function() { root.clearInterval(timer); }, { once: true });
  }
  if (root) root.EastmoneyEtfDaily = { bind, load, render };
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', bind);
})(typeof window !== 'undefined' ? window : null);
