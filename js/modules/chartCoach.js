(function() {
  let bound = false;
  let requestSequence = 0;
  let marksVisible = false;
  let lastMarks = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function periodLabel(period) {
    return { day: '日线', week: '周线', month: '月线' }[period] || period;
  }

  function barDate(bar) {
    return String((bar && (bar.date || bar.time || bar.datetime)) || '').trim();
  }

  function snapshotBars(rows) {
    return rows.map(function(bar) {
      return {
        date: barDate(bar),
        open: bar && bar.open,
        close: bar && bar.close,
        high: bar && bar.high,
        low: bar && bar.low,
        volume: bar && bar.volume
      };
    });
  }

  function visibleLastDate(bars, chart) {
    if (!bars.length) return '';
    let index = bars.length - 1;
    if (chart && typeof chart.getOption === 'function') {
      const option = chart.getOption() || {};
      const zoom = Array.isArray(option.dataZoom) ? option.dataZoom[0] : null;
      if (zoom && zoom.endValue !== undefined && zoom.endValue !== null) {
        if (typeof zoom.endValue === 'number') index = Math.round(zoom.endValue);
        else {
          const matched = bars.findIndex(function(bar) { return barDate(bar) === String(zoom.endValue); });
          if (matched >= 0) index = matched;
        }
      } else if (zoom && Number.isFinite(Number(zoom.end))) {
        index = Math.ceil(bars.length * Number(zoom.end) / 100) - 1;
      }
    }
    index = Math.max(0, Math.min(bars.length - 1, index));
    return barDate(bars[index]);
  }

  function listSection(title, values, emptyText) {
    const items = (values || []).filter(Boolean);
    return '<section class="chart-coach-section"><h4>' + escapeHtml(title) + '</h4>' +
      (items.length
        ? '<ul>' + items.map(function(item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>'
        : '<p class="chart-coach-empty">' + escapeHtml(emptyText) + '</p>') +
      '</section>';
  }

  function observationSection(result) {
    const observations = result.observations || [];
    if (!observations.length) return listSection('看到什么', [], '当前数据不足，尚不能形成结构观察。');
    return '<section class="chart-coach-section"><h4>看到什么</h4><div class="chart-coach-observations">' +
      observations.map(function(item) {
        return '<article><div><strong>' + escapeHtml(item.label) + '</strong><span>' + escapeHtml(item.state) +
          '</span></div><code>' + escapeHtml(item.ruleId || '未声明 ruleId') + '</code><small>' +
          escapeHtml(item.rulesVersion || result.rulesVersion || '未声明规则版本') + '</small></article>';
      }).join('') + '</div></section>';
  }

  function ruleDictionarySection(result) {
    const rules = Array.isArray(result.rules) ? result.rules : [];
    const observations = Array.isArray(result.observations) ? result.observations : [];
    if (!rules.length) return '';
    const observationByRule = {};
    observations.forEach(function(item) {
      if (item && item.ruleId) observationByRule[item.ruleId] = item;
    });
    return '<section class="chart-coach-section chart-coach-rules"><h4>确定性规则口径</h4>' +
      '<div class="chart-coach-rule-list">' + rules.map(function(rule) {
        const observation = observationByRule[rule.ruleId] || {};
        const invalidation = (observation.invalidation || []).filter(Boolean);
        const limitations = (rule.limitations || []).concat(observation.limitations || []).filter(Boolean);
        return '<article class="chart-coach-rule-card"><header><strong>' + escapeHtml(rule.label || rule.ruleId) +
          '</strong><code>' + escapeHtml(rule.ruleId) + '</code></header><small>规则版本 ' +
          escapeHtml(rule.rulesVersion || result.rulesVersion || '未声明') + '</small>' +
          '<dl><dt>触发口径</dt><dd>' + escapeHtml(rule.trigger || '未声明') + '</dd>' +
          '<dt>前提假设</dt><dd>' + escapeHtml((rule.assumptions || []).join('；') || '未声明') + '</dd>' +
          '<dt>失效条件</dt><dd>' + escapeHtml(invalidation.join('；') || '当前观察未单独声明') + '</dd>' +
          '<dt>局限</dt><dd>' + escapeHtml(limitations.join('；') || '未声明') + '</dd></dl></article>';
      }).join('') + '</div></section>';
  }

  function referenceUsageLabel(reference) {
    if (reference.implementedInChartAnalysis === true) return '当前规则参考';
    if (reference.usage === 'implementation-reference-only') return '仅作曲线实现参考';
    return '知识参考，本期未实现';
  }

  function safeReferenceUrl(value) {
    const url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function knowledgeSection(result) {
    const references = Array.isArray(result.knowledgeReferences) ? result.knowledgeReferences : [];
    const scopeText = result.knowledgeScope === 'phase-one-deterministic-rule-dictionary'
      ? '一期确定性规则词典' : (result.knowledgeScope || '知识范围未声明');
    const validationText = result.strategyValidation === 'not-backtested'
      ? '未经回测，不是经验证的投资策略库' : (result.strategyValidation || '有效性状态未声明');
    return '<section class="chart-coach-section chart-coach-knowledge"><h4>知识范围说明</h4>' +
      '<p><strong>' + escapeHtml(scopeText) + '</strong> · ' + escapeHtml(validationText) +
      '；只解释输入样本中已经发生的关系，不用于预测或给出买卖建议。</p>' +
      (references.length ? '<div class="chart-coach-reference-list">' + references.map(function(reference) {
        const url = safeReferenceUrl(reference.url);
        const title = escapeHtml(reference.title || reference.id || '未命名参考');
        return '<article><div>' + (url
          ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + title + '</a>'
          : '<strong>' + title + '</strong>') + '<span>' + escapeHtml(referenceUsageLabel(reference)) +
          '</span></div><small>' + escapeHtml(reference.notes || '') + '</small></article>';
      }).join('') + '</div>' : '<p class="chart-coach-empty">当前响应没有列出知识参考。</p>') + '</section>';
  }

  function evidenceSection(result) {
    const evidence = result.evidence || [];
    if (!evidence.length) return listSection('数值与日期证据', [], '没有足够的数值证据。');
    return '<section class="chart-coach-section"><h4>数值与日期证据</h4><div class="chart-coach-evidence">' +
      evidence.map(function(item) {
        const dates = item.firstBarAt === item.lastBarAt
          ? item.lastBarAt
          : item.firstBarAt + ' 至 ' + item.lastBarAt;
        return '<article><div><strong>' + escapeHtml(item.label) + '</strong><b>' +
          escapeHtml(item.value) + escapeHtml(item.unit || '') + '</b></div><small>' +
          escapeHtml(periodLabel(item.period)) + ' · ' + escapeHtml(dates) + '</small></article>';
      }).join('') + '</div></section>';
  }

  function keyLevelCard(level) {
    if (!level) return '';
    const typeLabel = level.type === 'support' ? '支撑' : '压力';
    const strengthLabel = level.strengthLabel || '未分级';
    return '<article class="chart-coach-key-level" data-strength="' + escapeHtml(level.strengthKey || 'unknown') + '">' +
      '<header><span><strong>' + escapeHtml(strengthLabel + typeLabel) + '</strong><small>' +
      escapeHtml(level.statusLabel || '') + '</small></span><b>' + escapeHtml(Number(level.price).toFixed(2)) + '</b></header>' +
      '<div class="chart-coach-key-level-facts"><span>触碰 ' + escapeHtml(level.touchCount || 0) + ' 次</span>' +
      '<span>反向收盘 ' + escapeHtml(level.rejectionCount || 0) + ' 次</span>' +
      '<span>量能确认 ' + escapeHtml(level.volumeConfirmedTouches || 0) + ' 次</span>' +
      '<span>距最新价 ' + escapeHtml(Number(level.distancePct || 0).toFixed(2)) + '%</span></div>' +
      '<p>' + escapeHtml(level.basis || '') + (level.lastTouchAt ? ' · 最近触碰 ' + escapeHtml(level.lastTouchAt) : '') + '</p>' +
      '</article>';
  }

  function keyLevelSection(result) {
    const keyLevels = result && result.chartAnnotations && result.chartAnnotations.keyLevels;
    if (!keyLevels || (!keyLevels.support && !keyLevels.resistance)) return '';
    const limitations = Array.isArray(keyLevels.limitations) ? keyLevels.limitations : [];
    return '<section class="chart-coach-section chart-coach-key-levels"><h4>关键价位强度</h4>' +
      '<div class="chart-coach-key-level-grid">' + keyLevelCard(keyLevels.support) + keyLevelCard(keyLevels.resistance) + '</div>' +
      '<p class="chart-coach-key-level-note">容差 ' + escapeHtml(keyLevels.tolerance == null ? '--' : keyLevels.tolerance) +
      ' · 规则版本 ' + escapeHtml(keyLevels.rulesVersion || '未声明') + '</p>' +
      (limitations.length ? '<p class="chart-coach-key-level-note">' + escapeHtml(limitations.join('；')) + '</p>' : '') +
      '</section>';
  }

  function compactKeyLevel(level) {
    if (!level) return '<article><span>关键位</span><strong>样本不足</strong><small>等待更多有效高低价</small></article>';
    const typeLabel = level.type === 'support' ? '关键支撑' : '关键压力';
    return '<article data-strength="' + escapeHtml(level.strengthKey || 'unknown') + '"><span>' + escapeHtml(typeLabel) + '</span>' +
      '<strong>' + escapeHtml(Number(level.price).toFixed(2)) + '</strong><small>' +
      escapeHtml((level.strengthLabel || '未分级') + ' · ' + (level.touchCount || 0) + '次触碰 · ' + (level.statusLabel || '状态未声明')) + '</small></article>';
  }

  function renderEvidenceStrip(result) {
    const keyLevels = result && result.chartAnnotations && result.chartAnnotations.keyLevels || {};
    const method = keyLevels.method || {};
    return '<div class="chart-coach-strip-heading"><div><strong>关键位与多源证据</strong>' +
      '<span>历史价位、资讯、资金、GPT 分开核对，不合成交易分数</span></div>' +
      '<small>' + escapeHtml(keyLevels.rulesVersion || '关键位规则未声明') + '</small></div>' +
      (method.strengthRule || method.toleranceRule
        ? '<details class="chart-coach-strip-method"><summary>怎么判断强弱</summary><p>' +
          escapeHtml([method.strengthRule, method.toleranceRule].filter(Boolean).join('；')) + '</p></details>' : '') +
      '<div class="chart-coach-strip-levels">' + compactKeyLevel(keyLevels.support) + compactKeyLevel(keyLevels.resistance) + '</div>' +
      '<div class="chart-coach-strip-sources"><div id="chartCoachFlowEvidence"><section class="chart-coach-source-card"><h5>资金动量</h5><p class="chart-coach-empty">正在读取，过期或不可用时不参与判断。</p></section></div>' +
      '<div id="chartCoachNewsEvidence"><section class="chart-coach-source-card"><h5>重点资讯</h5><p class="chart-coach-empty">正在读取来源与本地重要性。</p></section></div>' +
      '<div id="chartCoachGptEvidence"><section class="chart-coach-source-card"><h5>手动 GPT 研究记录</h5><p class="chart-coach-empty">正在匹配当前股票的每日记录。</p></section></div></div>';
  }

  function renderGptPickHistory(history) {
    const items = history && Array.isArray(history.items) ? history.items : [];
    if (!items.length) {
      return '<section class="chart-coach-source-card"><h5>手动 GPT 研究记录</h5><p class="chart-coach-empty">最近导入中没有这只股票。</p></section>';
    }
    return '<section class="chart-coach-source-card"><h5>手动 GPT 研究记录 <span>' + escapeHtml(items.length) + ' 条</span></h5>' +
      '<div class="chart-coach-gpt-history">' + items.map(function(item) {
        const candidate = item.candidate || {};
        return '<article><header><strong>' + escapeHtml(item.title || 'ChatGPT 手动选股') + '</strong><time>' +
          escapeHtml(String(item.importedAt || '').replace('T', ' ').slice(0, 16)) + '</time></header>' +
          '<p><b>理由</b>' + escapeHtml(candidate.reason || '未提供') + '</p>' +
          '<p><b>风险</b>' + escapeHtml(candidate.risk || '未提供') + '</p>' +
          (candidate.originalAnalysis ? '<p><b>原分析</b>' + escapeHtml(candidate.originalAnalysis) + '</p>' : '') + '</article>';
      }).join('') + '</div><small>来源为用户粘贴的 ChatGPT 对话，未由 WebStock 验证；仅作人工研究记录，不触发任何交易操作。</small></section>';
  }

  function renderNewsEvidence(result) {
    const items = result && Array.isArray(result.items) ? result.items : [];
    if (!items.length) {
      return '<section class="chart-coach-source-card"><h5>重点资讯</h5><p class="chart-coach-empty">近 3 日没有匹配且可展示的资讯证据。</p></section>';
    }
    return '<section class="chart-coach-source-card"><h5>重点资讯 <span>' + escapeHtml(items.length) + ' 条</span></h5>' +
      '<div class="chart-coach-news-evidence">' + items.slice(0, 5).map(function(item) {
        const importance = item.importance || item.localPriority || {};
        const label = importance.label || (Number(importance.score) >= 60 ? '重点' : '一般');
        const reasons = importance.reasons || importance.reason || [];
        return '<article><header><strong>' + escapeHtml(item.title || '未命名资讯') + '</strong><span>' +
          escapeHtml(label) + '</span></header><small>' + escapeHtml(item.source || item.provider || '来源未声明') + ' · ' +
          escapeHtml(item.publishedAt || item.time || '') + '</small>' +
          (reasons && (Array.isArray(reasons) ? reasons.length : String(reasons).trim())
            ? '<p>本地重要性：' + escapeHtml(Array.isArray(reasons) ? reasons.join('；') : reasons) + '</p>' : '') + '</article>';
      }).join('') + '</div><small>“重点”是本地可解释规则，不代表全网热度或消息必然影响价格。</small></section>';
  }

  function buildChartMarks(result, bars) {
    const evidence = Array.isArray(result && result.evidence) ? result.evidence : [];
    const observations = Array.isArray(result && result.observations) ? result.observations : [];
    const byId = {};
    evidence.forEach(function(item) { if (item && item.id) byId[item.id] = item; });
    const marks = { markLine: { silent: true, symbol: 'none', data: [] }, markPoint: { data: [] }, markArea: { silent: true, data: [] } };
    const annotations = result && result.chartAnnotations;
    const keyLevels = annotations && annotations.keyLevels;
    const pivotLevels = annotations && annotations.currentLevels;
    const levels = keyLevels && (keyLevels.support || keyLevels.resistance) ? keyLevels : pivotLevels;
    if (levels) {
      [levels.resistance, levels.support].forEach(function(level, index) {
        if (!level || !Number.isFinite(Number(level.price))) return;
        const resistance = index === 0;
        marks.markLine.data.push({
          yAxis: Number(level.price),
          name: level.label,
          signal: level,
          lineStyle: { color: resistance ? '#dc2626' : '#059669', type: 'dashed', width: keyLevels ? 1.5 : 2, opacity: 0.9 },
          label: {
            formatter: level.shortLabel + ' ' + Number(level.price).toFixed(2),
            color: resistance ? '#b91c1c' : '#047857',
            backgroundColor: resistance ? 'rgba(254,226,226,0.94)' : 'rgba(209,250,229,0.94)',
            borderRadius: 3,
            padding: [4, 7],
            fontWeight: 700,
            fontSize: 13
          }
        });
        if (keyLevels && level.lastTouchAt) {
          marks.markPoint.data.push({
            name: level.label + '最近触碰',
            coord: [level.lastTouchAt, Number(level.price)],
            value: resistance ? '压' : '撑',
            signal: level,
            symbol: 'circle',
            symbolSize: level.strengthKey === 'strong' ? 34 : 28,
            itemStyle: { color: resistance ? '#dc2626' : '#059669', borderColor: '#ffffff', borderWidth: 1 },
            label: { color: '#ffffff', fontWeight: 700, fontSize: 11 }
          });
        }
      });
    }
    (annotations && Array.isArray(annotations.events) ? annotations.events : []).forEach(function(event) {
      if (!event || !event.date || !Number.isFinite(Number(event.price))) return;
      const positive = event.direction === 'positive';
      marks.markPoint.data.push({
        name: event.label,
        coord: [event.date, Number(event.price)],
        value: event.marker,
        signal: event,
        symbol: 'pin',
        symbolSize: 42,
        symbolOffset: [0, positive ? '-45%' : '45%'],
        itemStyle: { color: positive ? '#dc2626' : '#059669', borderColor: '#ffffff', borderWidth: 1 },
        label: { color: '#ffffff', fontWeight: 700, fontSize: 12 }
      });
    });
    if (!annotations) observations.forEach(function(observation) {
      const items = (observation.evidenceIds || []).map(function(id) { return byId[id]; }).filter(Boolean);
      if (observation.category === 'breakout') {
        const threshold = items.find(function(item) { return /prior_(high|low)_20/.test(item.metric || ''); });
        const latest = items.find(function(item) { return item.metric === 'latest_close'; });
        if (threshold && Number.isFinite(Number(threshold.value))) {
          marks.markLine.data.push({
            yAxis: Number(threshold.value),
            name: observation.label,
            lineStyle: { color: '#f59e0b', type: 'dashed', width: 1 },
            label: { formatter: observation.label + ' ' + Number(threshold.value).toFixed(2), color: '#92400e', fontSize: 10 }
          });
        }
        if (latest && latest.lastBarAt && Number.isFinite(Number(latest.value))) {
          marks.markPoint.data.push({
            name: observation.label,
            coord: [latest.lastBarAt, Number(latest.value)],
            value: observation.label,
            symbol: 'pin',
            symbolSize: 34,
            itemStyle: { color: '#dc2626' },
            label: { fontSize: 9 }
          });
        }
      }
      if (observation.category === 'gap' && /gap/.test(observation.state || '') && observation.state !== 'no-full-gap') {
        const previous = items.find(function(item) { return /^previous_(high|low)$/.test(item.metric || ''); });
        const latest = items.find(function(item) { return /^latest_(high|low)$/.test(item.metric || ''); });
        if (previous && latest && previous.lastBarAt && latest.lastBarAt &&
            Number.isFinite(Number(previous.value)) && Number.isFinite(Number(latest.value))) {
          const low = Math.min(Number(previous.value), Number(latest.value));
          const high = Math.max(Number(previous.value), Number(latest.value));
          marks.markArea.data.push([
            { name: observation.label, xAxis: previous.lastBarAt, yAxis: low, itemStyle: { color: 'rgba(245,158,11,0.12)' }, label: { color: '#92400e', fontSize: 9 } },
            { xAxis: latest.lastBarAt, yAxis: high }
          ]);
        }
      }
    });
    return marks;
  }

  function formatMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '--';
    if (Math.abs(amount) >= 100000000) return (amount / 100000000).toFixed(2) + '亿';
    if (Math.abs(amount) >= 10000) return (amount / 10000).toFixed(0) + '万';
    return amount.toFixed(0) + '元';
  }

  function renderCapitalFlowEvidence(result) {
    const source = result && result.source || {};
    const observation = result && result.observation || {};
    const latest = result && result.latest || {};
    if (!result || result.availability !== 'available' || observation.state !== 'fresh') {
      return '<section class="chart-coach-source-card"><h5>资金动量</h5><p class="chart-coach-empty">当前资金证据不可用或已过期，不参与强弱判断。</p></section>';
    }
    const sourceLabel = source.sourceClass === 'authorized-level2' ? '授权 Level-2' :
      source.sourceClass === 'vendor-classified' ? '供应商分类' : '本地估算';
    const speed = Number.isFinite(Number(latest.netFlowSpeed)) ? formatMoney(latest.netFlowSpeed) + '/分钟' : '--';
    const acceleration = Number.isFinite(Number(latest.netFlowAcceleration)) ? formatMoney(latest.netFlowAcceleration) + '/分钟²' : '--';
    return '<section class="chart-coach-source-card"><h5>资金动量 <span>' + escapeHtml(latest.flowState && latest.flowState.label || '状态未分类') + '</span></h5>' +
      '<dl><div><dt>累计净额</dt><dd>' + escapeHtml(formatMoney(latest.netAmount)) + '</dd></div>' +
      '<div><dt>速度</dt><dd>' + escapeHtml(speed) + '</dd></div><div><dt>加速度</dt><dd>' + escapeHtml(acceleration) + '</dd></div></dl>' +
      '<small>' + escapeHtml(sourceLabel) + ' · ' + escapeHtml(source.provider || '来源未声明') + ' · 观测 ' +
      escapeHtml(observation.observedAt || '--') + '；' + escapeHtml((result.limitations || []).slice(0, 2).join('；')) + '</small></section>';
  }

  function buildCapitalFlowMark(result, bars) {
    const source = result && result.source || {};
    const observation = result && result.observation || {};
    const latest = result && result.latest || {};
    const lastBar = bars && bars[bars.length - 1];
    const amount = Number(latest.netAmount);
    if (!lastBar || !result || result.availability !== 'available' || observation.state !== 'fresh' ||
        !Number.isFinite(amount) || !['vendor-classified', 'authorized-level2'].includes(source.sourceClass)) return null;
    const sourceLabel = source.sourceClass === 'authorized-level2' ? '授权 Level-2' : '供应商分类';
    return {
      name: '资金流',
      coord: [barDate(lastBar), Number(lastBar.close)],
      value: '资',
      symbol: 'pin',
      symbolSize: 44,
      symbolOffset: [0, amount >= 0 ? '-55%' : '55%'],
      itemStyle: { color: amount >= 0 ? '#dc2626' : '#059669', borderColor: '#ffffff', borderWidth: 1 },
      label: { color: '#ffffff', fontWeight: 700, fontSize: 12 },
      signal: {
        label: '最新资金流',
        detail: sourceLabel + ' · ' + (source.provider || '来源未知') + ' · 净额 ' + formatMoney(amount) +
          ' · ' + (latest.flowState && latest.flowState.label || '状态未分类') +
          ' · 观测 ' + (observation.observedAt || '--'),
        sourceClass: source.sourceClass,
        observedAt: observation.observedAt || null,
        limitations: result.limitations || []
      }
    };
  }

  function signalTooltip(signal) {
    if (!signal || typeof signal !== 'object') return '';
    const validation = signal.validation || null;
    const lines = [
      '<strong style="font-size:14px">' + escapeHtml(signal.label || '图上标识') + '</strong>',
      signal.detail ? '<div>' + escapeHtml(signal.detail) + '</div>' : '',
      signal.basis ? '<div>依据：' + escapeHtml(signal.basis) + '</div>' : '',
      signal.strengthLabel ? '<div>强度：' + escapeHtml(signal.strengthLabel) + ' · 触碰 ' +
        escapeHtml(signal.touchCount || 0) + ' 次 · 反向收盘 ' + escapeHtml(signal.rejectionCount || 0) +
        ' 次 · 量能确认 ' + escapeHtml(signal.volumeConfirmedTouches || 0) + ' 次</div>' : '',
      Number.isFinite(Number(signal.distancePct))
        ? '<div>距最新价：' + escapeHtml(Number(signal.distancePct).toFixed(2)) + '%</div>' : '',
      signal.triggerEvidence
        ? '<div>触发：收盘 ' + escapeHtml(signal.triggerEvidence.close) +
          ' · 阈值 ' + escapeHtml(signal.triggerEvidence.threshold) +
          (signal.triggerEvidence.volumeRatio == null ? '' : ' · 量比 ' + escapeHtml(signal.triggerEvidence.volumeRatio) + 'x') + '</div>' : '',
      validation && validation.status !== 'pending'
        ? '<div>后验回看 ' + escapeHtml(validation.bars) + ' 根：收盘 ' +
          escapeHtml(validation.forwardClosePct) + '% · 最高 ' + escapeHtml(validation.maxPct) +
          '% · 最低 ' + escapeHtml(validation.minPct) + '%</div>' : '',
      validation && validation.status === 'pending' ? '<div>后验回看：等待后续K线</div>' : '',
      signal.triggerUsesFutureData === false ? '<small>触发未使用未来数据；回看不参与触发</small>' : ''
    ];
    return lines.filter(Boolean).join('<br>');
  }

  function applyMarks(marks) {
    const chart = window.State && window.State.klineChart;
    if (!chart || typeof chart.setOption !== 'function') return false;
    chart.setOption({ series: [{
      name: 'K线',
      markLine: marksVisible && marks ? marks.markLine : { data: [] },
      markPoint: marksVisible && marks ? marks.markPoint : { data: [] },
      markArea: marksVisible && marks ? marks.markArea : { data: [] }
    }] });
    return true;
  }

  function clearMarks() {
    marksVisible = false;
    const button = document.getElementById('chartCoachBtn');
    if (button) {
      button.setAttribute('aria-pressed', 'false');
      button.textContent = '显示图上提示';
    }
    const evidenceStrip = document.getElementById('chartCoachEvidenceStrip');
    if (evidenceStrip) {
      evidenceStrip.hidden = true;
      evidenceStrip.innerHTML = '';
    }
    applyMarks(null);
  }

  function renderResult(result) {
    const coverage = result.coverage || {};
    const statusText = result.status === 'insufficient'
      ? '数据不足：有效 ' + (coverage.eligibleBars || 0) + ' 根，至少需要 ' + (coverage.minimumBars || 0) + ' 根'
      : '已解释 ' + (coverage.eligibleBars || 0) + ' 根有效数据';
    return '<div class="chart-coach-meta"><strong>' + escapeHtml(result.code) + ' · ' +
      escapeHtml(periodLabel(result.period)) + '</strong><span>可见截止 ' + escapeHtml(result.asOf) + '</span><small>' +
      escapeHtml(statusText) + '</small><small>规则版本 ' + escapeHtml(result.rulesVersion || '未声明') + '</small></div>' +
      observationSection(result) +
      keyLevelSection(result) +
      ruleDictionarySection(result) +
      evidenceSection(result) +
      listSection('通俗解释', result.plainMeaning, '暂无可解释结论。') +
      listSection('待确认', result.confirmations, '等待更多同周期数据后再确认。') +
      listSection('失效条件', result.invalidation, '当前没有可判断的失效条件。') +
      listSection('局限', result.limitations, '没有额外局限说明。') +
      knowledgeSection(result);
  }

  function updateEvidenceTarget(id, html, guard) {
    if (guard && !guard()) return;
    const target = document.getElementById(id);
    if (target) target.innerHTML = html;
  }

  function setOpen(open) {
    const overlay = document.getElementById('chartCoachOverlay');
    if (!overlay) return;
    overlay.style.display = open ? 'flex' : 'none';
    if (open) document.body.classList.add('chart-coach-open');
    else document.body.classList.remove('chart-coach-open');
  }

  function close() {
    setOpen(false);
    const button = document.getElementById('chartCoachBtn');
    if (button) button.focus();
  }

  async function open() {
    const requestId = ++requestSequence;
    const body = document.getElementById('chartCoachBody');
    const button = document.getElementById('chartCoachBtn');
    const state = window.State || {};
    const bars = Array.isArray(state.currentRawData) ? snapshotBars(state.currentRawData) : [];
    const stock = state.currentStock || {};
    const asOf = visibleLastDate(bars, state.klineChart);
    const requestIdentity = {
      code: String(stock.code || ''),
      period: String(state.currentPeriod || ''),
      asOf: String(asOf || '')
    };
    function isCurrentIdentity() {
      const currentState = window.State || {};
      const currentBars = Array.isArray(currentState.currentRawData)
        ? snapshotBars(currentState.currentRawData)
        : [];
      return requestId === requestSequence &&
        String((currentState.currentStock || {}).code || '') === requestIdentity.code &&
        String(currentState.currentPeriod || '') === requestIdentity.period &&
        String(visibleLastDate(currentBars, currentState.klineChart) || '') === requestIdentity.asOf;
    }
    if (marksVisible) {
      clearMarks();
      return;
    }

    if (!stock.code || !bars.length || !asOf) {
      alert('请先切换到日线、周线或月线，并等待K线加载完成。');
      return;
    }

    body.innerHTML = '<div class="chart-coach-loading"><span></span>正在解释当前图形…</div>';
    button.textContent = '分析并标注中...';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const result = await window.ApiClient.apiFetch('/api/chart-coach/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: stock.code,
          period: state.currentPeriod,
          asOf,
          bars
        })
      });
      if (!isCurrentIdentity()) return;
      const responseMatches = String(result.code || '') === requestIdentity.code &&
        String(result.period || '') === requestIdentity.period &&
        String(result.asOf || '') === requestIdentity.asOf;
      if (!responseMatches) return;
      body.innerHTML = renderResult(result);
      const evidenceStrip = document.getElementById('chartCoachEvidenceStrip');
      if (evidenceStrip) {
        evidenceStrip.innerHTML = renderEvidenceStrip(result);
        evidenceStrip.hidden = false;
      }
      lastMarks = buildChartMarks(result, bars);
      marksVisible = true;
      applyMarks(lastMarks);
      button.setAttribute('aria-pressed', 'true');
      button.textContent = '隐藏图上提示';
      button.title = '再次点击可隐藏图上的确定性证据标识';
      if (state.currentPeriod === 'day') {
        window.ApiClient.apiFetch('/api/capital-flow/series?scope=stock&code=' +
          encodeURIComponent(stock.code) + '&source=vendor-classified', {
            timeoutMs: 5000,
            maxRetries: 0,
            dedupe: false
          }).then(function(flowResult) {
            if (!isCurrentIdentity()) return;
            updateEvidenceTarget('chartCoachFlowEvidence', renderCapitalFlowEvidence(flowResult), isCurrentIdentity);
            if (!marksVisible || !lastMarks) return;
            const capitalFlowMark = buildCapitalFlowMark(flowResult, bars);
            if (!capitalFlowMark) return;
            lastMarks.markPoint.data = lastMarks.markPoint.data.filter(function(item) {
              return item.name !== '资金流';
            });
            lastMarks.markPoint.data.push(capitalFlowMark);
            applyMarks(lastMarks);
          }).catch(function() {
            updateEvidenceTarget('chartCoachFlowEvidence', renderCapitalFlowEvidence(null), isCurrentIdentity);
          });
      } else {
        updateEvidenceTarget('chartCoachFlowEvidence', renderCapitalFlowEvidence(null), isCurrentIdentity);
      }
      Promise.resolve().then(function() { return window.ApiClient.apiFetch('/api/news/discovery?codes=' + encodeURIComponent(stock.code) +
        '&timeRange=3d&sort=relevance&limit=5', { timeoutMs: 7000, maxRetries: 0, dedupe: false }); })
        .then(function(newsResult) {
          updateEvidenceTarget('chartCoachNewsEvidence', renderNewsEvidence(newsResult), isCurrentIdentity);
        }).catch(function() {
          updateEvidenceTarget('chartCoachNewsEvidence', renderNewsEvidence(null), isCurrentIdentity);
        });
      Promise.resolve().then(function() { return window.ApiClient.apiFetch('/api/research-picks/stock/' + encodeURIComponent(stock.code) + '?limit=10', {
        timeoutMs: 5000,
        maxRetries: 0,
        dedupe: false
      }); }).then(function(history) {
        updateEvidenceTarget('chartCoachGptEvidence', renderGptPickHistory(history), isCurrentIdentity);
      }).catch(function() {
        updateEvidenceTarget('chartCoachGptEvidence', renderGptPickHistory(null), isCurrentIdentity);
      });
    } catch (error) {
      if (isCurrentIdentity()) {
        alert('图形解释失败：' + (error.message || error));
      }
    } finally {
      if (requestId === requestSequence) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        if (!marksVisible) button.textContent = '显示图上提示';
      }
    }
  }

  function bind() {
    if (bound) return;
    const button = document.getElementById('chartCoachBtn');
    const closeButton = document.getElementById('chartCoachCloseBtn');
    const overlay = document.getElementById('chartCoachOverlay');
    if (!button || !closeButton || !overlay) return;
    bound = true;
    button.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', function(event) {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && overlay.style.display !== 'none') close();
    });
  }

  function refreshMarks() {
    if (marksVisible && lastMarks) applyMarks(lastMarks);
  }

  window.ChartCoach = {
    bind,
    open,
    close,
    clearMarks,
    buildChartMarks,
    buildCapitalFlowMark,
    renderGptPickHistory,
    renderNewsEvidence,
    renderCapitalFlowEvidence,
    renderEvidenceStrip,
    signalTooltip,
    applyMarks,
    refreshMarks,
    visibleLastDate,
    renderResult
  };
  bind();
})();
