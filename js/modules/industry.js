/*
 * 行业简报模块
 *
 * 该模块负责从后端获取行业简报数据并渲染到弹窗中。
 * 数据格式为数组，每个元素包含：name、summary、catalysts、fundFlow。
 */

(function () {
  /**
   * 打开行业简报面板。
   * 显示加载动画，然后从 /api/industry/brief 获取数据。
   */
  function openIndustryPanel() {
    var overlay = document.getElementById('industryOverlay');
    var body = document.getElementById('industryPanelBody');
    if (!overlay || !body) return;
    overlay.style.display = 'flex';
    // 初始化加载状态
    body.innerHTML =
      '<div class="industry-loading"><div class="analysis-spinner"></div><span>正在获取产业简报，请稍候…</span></div>';
    fetch('/api/industry/brief')
      .then(function (r) {
        if (!r.ok) throw new Error('请求失败: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.length) {
          body.innerHTML = '<p>暂无产业简报数据。</p>';
          return;
        }
        var html = '';
        data.forEach(function (item) {
          html +=
            '<div class="industry-item" style="margin-bottom:20px;">' +
            '<h4 style="margin:0 0 6px;font-size:16px;color:#0c63b7;">' +
            escapeHtml(item.name) +
            '</h4>' +
            '<p style="margin:0 0 6px;">' +
            escapeHtml(item.summary) +
            '</p>' +
            '<p style="margin:0 0 6px;"><strong>催化因素：</strong>' +
            escapeHtml(item.catalysts) +
            '</p>' +
            '<p style="margin:0 0 6px;"><strong>资金关注：</strong>' +
            (typeof item.fundFlow === 'number' ? item.fundFlow.toFixed(1) : item.fundFlow) +
            ' 亿</p>' +
            '</div>';
        });
        body.innerHTML = html;
      })
      .catch(function (err) {
        body.innerHTML = '<p style="color:#ef4444;">获取数据失败：' + err.message + '</p>';
      });
  }

  /**
   * 关闭行业简报面板。
   */
  function closeIndustryPanel() {
    var overlay = document.getElementById('industryOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  // 简易的文本转义，防止 XSS
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 向全局暴露接口
  window.Industry = {
    openIndustryPanel: openIndustryPanel,
    closeIndustryPanel: closeIndustryPanel,
  };
})();
