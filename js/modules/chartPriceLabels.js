(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChartPriceLabels = api;
})(typeof window !== 'undefined' ? window : null, function() {
  const priceNumber = value => (typeof value === 'number' || typeof value === 'string') &&
    Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

  function layout(input, top, bottom, spacing) {
    const items = input.filter(item => Number.isFinite(item.y)).map(item => ({ ...item }))
      .sort((a, b) => a.y - b.y);
    const scroll = items.length * spacing > bottom - top;
    items.forEach((item, i) => {
      item.labelY = scroll ? top + spacing * (i + 0.5)
        : Math.max(top + spacing / 2, item.y, i ? items[i-1].labelY + spacing : top);
    });
    if (!scroll && items.length) {
      items.at(-1).labelY = Math.min(items.at(-1).labelY, bottom - spacing / 2);
      for (let i = items.length - 2; i >= 0; i--) items[i].labelY = Math.min(items[i].labelY, items[i+1].labelY - spacing);
    }
    return { items, scroll };
  }

  function describe(mark, bar) {
    const signal = mark.signal || {};
    const price = priceNumber(mark.yAxis);
    const tolerance = priceNumber(signal.tolerance) || 0;
    const low = priceNumber(mark.from) || Math.max(0, price - tolerance);
    const high = priceNumber(mark.to) || price + tolerance;
    const close = priceNumber(bar && bar.close);
    const provisional = Boolean(bar && bar.incomplete);
    const distance = close ? (price - close) / close * 100 : null;
    const status = close == null ? '比较价格不可用' :
      (provisional ? '现价' : '收盘') + (close > high ? '在区上' : close < low ? '在区下' : '区内测试') +
      (provisional ? ' · 待收盘' : '');
    const evidence = signal.strengthLabel ? signal.strengthLabel + '级历史证据 · ' +
      signal.touchCount + '次触碰 / ' + signal.rejectionCount + '次反向收盘 / ' +
      signal.volumeConfirmedTouches + '次量能确认' : '强弱未分级';
    const detail = [mark.name, '价位 ' + price.toFixed(2) + (high > low ? ' · 观察区 ' + low.toFixed(2) + '–' + high.toFixed(2) : ''),
      status + (close == null ? '' : ' · 比较价 ' + close.toFixed(2) + ' · 距该位 ' + (distance >= 0 ? '+' : '') + distance.toFixed(2) + '%'),
      bar && bar.date ? '比较行情截至 ' + bar.date : '',
      signal.sourceDate ? '日线参考截至 ' + signal.sourceDate : '',
      '依据：' + (signal.basis || '依据未提供；自选备注或预警点位不等于已验证压力'), evidence,
      signal.strengthLabel ? '分级规则：强=至少3次触碰且至少2次反向收盘；中=至少2次触碰；弱=1次触碰。量能不单独提升等级。' : '',
      ...(signal.confirmations || []), ...(signal.invalidation || []),
      '在区上/区下只表示相对位置，不等于有效突破或跌破；关键位不是价格预测或交易指令。'
    ].filter(Boolean).join('\n');
    return { name: (signal.strengthLabel ? signal.strengthLabel + '·' : '') + mark.name,
      price, valueText: mark.from ? low.toFixed(2) + '–' + high.toFixed(2) : price.toFixed(2),
      color: mark.lineStyle && mark.lineStyle.color || '#5682ad', status, detail };
  }

  function entries(series, bar) {
    const lines = (series.markLine && series.markLine.data || []).filter(mark => !Array.isArray(mark) && priceNumber(mark.yAxis));
    const areas = (series.markArea && series.markArea.data || []).filter(area => Array.isArray(area) &&
      area[0] && area[1] && priceNumber(area[0].yAxis) && priceNumber(area[1].yAxis)).map(area => ({
        ...area[0], yAxis: (Number(area[0].yAxis) + Number(area[1].yAxis)) / 2,
        from: Math.min(Number(area[0].yAxis), Number(area[1].yAxis)),
        to: Math.max(Number(area[0].yAxis), Number(area[1].yAxis))
      }));
    return lines.concat(areas).map(mark => describe(mark, bar));
  }

  function bind(chart, bar) {
    if (!chart || !chart.getDom || !chart.on || !chart.convertToPixel) return;
    if (chart.__priceLabels) chart.__priceLabels.dispose();
    const host = chart.getDom();
    const doc = host.ownerDocument;
    const overlay = doc.createElement('div');
    overlay.className = 'chart-price-labels';
    host.appendChild(overlay);
    let size = '';
    function draw() {
      if (chart.isDisposed && chart.isDisposed()) return;
      const width = chart.getWidth(), height = chart.getHeight();
      size = width + ':' + height;
      const option = chart.getOption();
      const series = (option.series || []).find(item => item.name === 'K线') || {};
      const grid = (option.grid || [])[0];
      overlay.replaceChildren();
      if (!grid || !width || !height) return;
      const pixels = (value, full) => typeof value === 'string' && value.endsWith('%') ? parseFloat(value) / 100 * full : Number(value) || 0;
      const top = pixels(grid.top, height), bottom = top + pixels(grid.height, height);
      const edge = width - pixels(grid.right, width), left = edge + 18;
      const arranged = layout(entries(series, bar).map(item => ({ ...item,
        y: chart.convertToPixel({ yAxisIndex: 0 }, item.price) })), top, bottom, 38);
      if (!arranged.items.length) return;
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', width); svg.setAttribute('height', height);
      overlay.appendChild(svg);
      const rail = doc.createElement('div'); rail.className = 'chart-price-rail';
      Object.assign(rail.style, { left: left + 'px', top: top + 'px', width: Math.max(60, width - left - 4) + 'px', height: (bottom-top) + 'px' });
      rail.setAttribute('aria-label', arranged.scroll ? '价位列表，可滚动查看全部' : '价位与判断依据');
      rail.classList.toggle('scrollable', arranged.scroll);
      overlay.appendChild(rail);
      const detail = doc.createElement('div'); detail.className = 'chart-price-detail'; detail.hidden = true;
      detail.setAttribute('role', 'status');
      Object.assign(detail.style, { right: (width-edge+8) + 'px', top: top + 'px', maxHeight: (bottom-top) + 'px' });
      overlay.appendChild(detail);
      arranged.items.forEach(item => {
        const button = doc.createElement('button'); button.type = 'button';
        button.className = 'chart-price-label';
        button.style.top = (item.labelY - top - 17) + 'px';
        button.style.borderLeftColor = item.color;
        button.setAttribute('aria-expanded', 'false');
        const title = doc.createElement('strong'); title.textContent = item.name + ' ' + item.valueText;
        const state = doc.createElement('small'); state.textContent = item.status;
        button.append(title, state); button.title = item.detail;
        button.onclick = () => {
          const close = button.getAttribute('aria-expanded') === 'true';
          rail.querySelectorAll('button').forEach(node => node.setAttribute('aria-expanded', 'false'));
          detail.hidden = close;
          button.setAttribute('aria-expanded', String(!close));
          detail.textContent = item.detail + '\n再次点击标签或按 Esc 收起';
        };
        rail.appendChild(button);
        if (!arranged.scroll && item.y >= top && item.y <= bottom) {
          const line = doc.createElementNS(svg.namespaceURI, 'polyline');
          line.setAttribute('points', edge + ',' + item.y + ' ' + (edge+8) + ',' + item.y + ' ' + left + ',' + item.labelY);
          line.setAttribute('stroke', item.color); line.setAttribute('fill', 'none');
          svg.appendChild(line);
        }
      });
      overlay.onkeydown = event => { if (event.key === 'Escape') {
        detail.hidden = true;
        rail.querySelectorAll('button').forEach(node => node.setAttribute('aria-expanded', 'false'));
      } };
    }
    // Only reflow on zoom/resize, not on every crosshair/readout repaint.
    const resize = () => { if (size !== chart.getWidth() + ':' + chart.getHeight()) draw(); };
    chart.on('datazoom', draw); chart.on('rendered', resize);
    chart.__priceLabels = { dispose() { chart.off('datazoom', draw); chart.off('rendered', resize); overlay.remove(); } };
    draw();
  }
  return { layout, describe, entries, bind };
});
