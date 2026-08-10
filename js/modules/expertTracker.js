let expertChannels = [];
let expertObservations = [];
let expertBacktests = [];
let expertCurveCharts = [];
let expertTrackerBound = false;

const EXPERT_SUBJECT_LABELS = { creator: '创作者', person: '人物', book: '书籍', method: '方法' };
const EXPERT_MEDIA_LABELS = {
  text: '文本', video: '视频', audio: '音频', image: '图片', chart: '曲线 / 图形',
  book: '书籍', pdf: 'PDF', article: '文章', note: '笔记'
};
const EXPERT_ARCHIVE_LABELS = {
  linked: '公开链接', local_reference: '本地副本', downloaded: '平台下载',
  blocked: '平台限制', failed: '归档失败', not_applicable: '无需归档'
};

const EXPERT_EVIDENCE_LABELS = {
  primary: '原始来源 / 本人公开',
  archive: '公开存档',
  secondary_quote: '第三方转述',
  commentary: '第三方评论'
};

const EXPERT_AVAILABILITY_LABELS = {
  available: '可访问',
  unavailable: '不可访问',
  deleted_trace: '删除 / 隐藏痕迹',
  unknown: '未核实'
};

function expertEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function expertApi(path, options) {
  const request = Object.assign({}, options || {});
  if (request.body && typeof request.body !== 'string') {
    request.headers = Object.assign({ 'Content-Type': 'application/json' }, request.headers || {});
    request.body = JSON.stringify(request.body);
  }
  return window.apiFetch(path, request);
}

function expertSetStatus(message, isError) {
  const target = document.getElementById('expertTrackerStatus');
  if (!target) return;
  target.textContent = message || '';
  target.classList.toggle('error', !!isError);
}

function expertSelectedChannelId() {
  return Number(document.getElementById('expertChannelSelect').value) || 0;
}

function expertRenderChannelOptions() {
  const select = document.getElementById('expertChannelSelect');
  const previous = select.value;
  select.innerHTML = '<option value="">选择研究对象</option>' + expertChannels.map(function(channel) {
    return '<option value="' + channel.id + '">[' +
      expertEscape(EXPERT_SUBJECT_LABELS[channel.subjectType] || channel.subjectType || '创作者') + '] ' +
      expertEscape(channel.displayName) + ' · ' + expertEscape(channel.platform) +
      ' (' + channel.observationCount + ')</option>';
  }).join('');
  if (expertChannels.some(function(channel) { return String(channel.id) === previous; })) select.value = previous;
  else if (expertChannels.length) select.value = String(expertChannels[0].id);
}

function expertFormatTime(value) {
  if (!value) return '时间未核实';
  if (window.WebStockTime && window.WebStockTime.formatDateTime) {
    try { return window.WebStockTime.formatDateTime(value); } catch (error) {}
  }
  return String(value);
}

function expertRenderTimeline() {
  const target = document.getElementById('expertTimeline');
  if (!target) return;
  expertCurveCharts.forEach(function(chart) { try { chart.dispose(); } catch (error) {} });
  expertCurveCharts = [];
  if (!expertSelectedChannelId()) {
    target.innerHTML = '<div class="empty-state compact">请先建立或选择研究对象。</div>';
    return;
  }
  if (!expertObservations.length) {
    target.innerHTML = '<div class="empty-state compact">该研究对象尚无资料记录。</div>';
    return;
  }
  target.innerHTML = expertObservations.map(function(item) {
    const associations = (item.stockCodes || []).concat(item.sectors || [], item.topics || [])
      .filter(function(value, index, values) { return value && values.indexOf(value) === index; })
      .slice(0, 12);
    const body = item.content || item.summary || '仅保留来源痕迹，暂无可核对正文。';
    const hasCurve = Array.isArray(item.curveData) && item.curveData.length > 1;
    return '<article class="expert-timeline-row ' + expertEscape(item.availabilityStatus) + '">' +
      '<div class="expert-timeline-meta">' +
        '<span class="expert-evidence-badge ' + expertEscape(item.evidenceLevel) + '">' +
          expertEscape(EXPERT_EVIDENCE_LABELS[item.evidenceLevel] || item.evidenceLevel) + '</span>' +
        '<span>' + expertEscape(EXPERT_AVAILABILITY_LABELS[item.availabilityStatus] || item.availabilityStatus) + '</span>' +
        '<span>' + expertEscape(EXPERT_MEDIA_LABELS[item.mediaType] || item.mediaType || '文本') + '</span>' +
        '<span>' + expertEscape(EXPERT_ARCHIVE_LABELS[item.archiveStatus] || item.archiveStatus || '公开链接') + '</span>' +
        '<span>' + expertEscape(expertFormatTime(item.publishedAt || item.firstSeenAt)) + '</span>' +
        '<span>置信度 ' + Math.round(Number(item.confidence || 0) * 100) + '%</span>' +
      '</div>' +
      '<strong>' + expertEscape(item.title) + '</strong>' +
      '<p>' + expertEscape(body) + '</p>' +
      (item.analysisNotes ? '<p class="expert-analysis-note"><strong>图形 / 方法记录</strong>' +
        expertEscape(item.analysisNotes) + '</p>' : '') +
      (item.localAssetPath ? '<div class="expert-local-reference">本地资料：' + expertEscape(item.localAssetPath) + '</div>' : '') +
      (hasCurve ? '<div id="expertCurveChart' + item.id + '" class="expert-curve-chart" aria-label="' +
        expertEscape(item.title) + '曲线图"></div>' : '') +
      (associations.length ? '<div class="tag-row">' + associations.map(function(tag) {
        return '<span class="factor-tag">' + expertEscape(tag) + '</span>';
      }).join('') + '</div>' : '') +
      '<div class="expert-row-actions">' +
        (item.sourceUrl ? '<a href="' + expertEscape(item.sourceUrl) + '" target="_blank" rel="noopener">打开公开来源</a>' : '') +
        '<button class="small-btn danger expert-delete-observation" data-observation-id="' + item.id + '">删除资料</button>' +
      '</div>' +
    '</article>';
  }).join('');
  if (!window.echarts) return;
  expertObservations.forEach(function(item) {
    if (!Array.isArray(item.curveData) || item.curveData.length < 2) return;
    const element = document.getElementById('expertCurveChart' + item.id);
    if (!element) return;
    const values = item.curveData.map(function(point) { return Number(point.y); });
    const chart = window.echarts.init(element);
    chart.setOption({
      animation: false,
      grid: { left: 44, right: 14, top: 12, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', boundaryGap: false, data: item.curveData.map(function(point) { return point.x; }) },
      yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { type: 'dashed', opacity: 0.35 } } },
      series: [{ type: 'line', data: values, showSymbol: values.length <= 30, symbolSize: 5,
        lineStyle: { width: 2, color: values[values.length - 1] >= values[0] ? '#dc2626' : '#059669' },
        itemStyle: { color: values[values.length - 1] >= values[0] ? '#dc2626' : '#059669' } }]
    });
    expertCurveCharts.push(chart);
  });
}

function expertPercent(value) {
  return Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(2) + '%' : '--';
}

function expertRenderBacktests() {
  const target = document.getElementById('expertBacktestSummary');
  if (!target) return;
  if (!expertBacktests.length) {
    target.innerHTML = '<span class="muted">暂无语录事件回测。只有精确时间、合格来源、明确方向并映射股票的记录会进入严格子样本。</span>';
    return;
  }
  const latest = expertBacktests[0];
  const result = latest.result || {};
  const coverage = result.coverage || {};
  const fiveDay = result.metrics && result.metrics['5'] ? result.metrics['5'] : {};
  target.innerHTML = '<strong>最近回测 · ' + expertEscape(latest.datasetId || '--') + '</strong>' +
    '<span>严格记录 ' + Number(coverage.strictEligibleObservations || 0) + ' / ' + Number(coverage.totalObservations || 0) + '</span>' +
    '<span>5日净收益均值 ' + expertEscape(expertPercent(fiveDay.netReturn && fiveDay.netReturn.mean)) + '</span>' +
    '<span>5日超额均值 ' + expertEscape(expertPercent(fiveDay.excessReturn && fiveDay.excessReturn.mean)) + '</span>' +
    '<span class="expert-exploratory-badge">探索性</span>';
}

async function expertLoadChannels() {
  expertChannels = await expertApi('/api/expert/channels');
  expertRenderChannelOptions();
  await expertLoadTimeline();
}

async function expertLoadTimeline() {
  const channelId = expertSelectedChannelId();
  if (!channelId) {
    expertObservations = [];
    expertBacktests = [];
    expertRenderTimeline();
    expertRenderBacktests();
    expertSetStatus(expertChannels.length ? '请选择创作者频道' : '尚未建立频道');
    return;
  }
  expertObservations = await expertApi('/api/expert/channels/' + channelId + '/observations?limit=500');
  expertBacktests = await expertApi('/api/expert/channels/' + channelId + '/backtests?limit=20');
  expertRenderTimeline();
  expertRenderBacktests();
  const channel = expertChannels.find(function(item) { return item.id === channelId; });
  expertSetStatus((channel ? channel.displayName : '当前对象') + ' · ' + expertObservations.length + ' 条资料');
}

async function expertSaveSubject() {
  const button = document.getElementById('saveExpertSubjectBtn');
  button.disabled = true;
  try {
    const subject = await expertApi('/api/expert/channels', {
      method: 'POST',
      body: {
        subjectType: document.getElementById('expertSubjectTypeSelect').value,
        displayName: document.getElementById('expertSubjectNameInput').value.trim(),
        platform: document.getElementById('expertSubjectPlatformInput').value.trim(),
        profileUrl: document.getElementById('expertSubjectUrlInput').value.trim(),
        aliases: document.getElementById('expertSubjectAliasesInput').value,
        description: document.getElementById('expertSubjectDescriptionInput').value.trim()
      }
    });
    await expertLoadChannels();
    document.getElementById('expertChannelSelect').value = String(subject.id);
    await expertLoadTimeline();
    ['expertSubjectNameInput', 'expertSubjectPlatformInput', 'expertSubjectUrlInput',
      'expertSubjectAliasesInput', 'expertSubjectDescriptionInput'].forEach(function(id) {
      document.getElementById(id).value = '';
    });
    expertSetStatus(subject.displayName + '已加入研究库。');
  } catch (error) {
    expertSetStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function expertDeleteSubject() {
  const channelId = expertSelectedChannelId();
  if (!channelId) return alert('请先选择研究对象。');
  const channel = expertChannels.find(function(item) { return item.id === channelId; });
  if (!confirm('删除“' + (channel ? channel.displayName : '该研究对象') + '”及其全部资料和回测记录？')) return;
  try {
    await expertApi('/api/expert/channels/' + channelId, { method: 'DELETE' });
    await expertLoadChannels();
    expertSetStatus('研究对象已删除。');
  } catch (error) {
    expertSetStatus(error.message, true);
  }
}

async function expertDeleteObservation(observationId) {
  const channelId = expertSelectedChannelId();
  if (!channelId || !observationId) return;
  const observation = expertObservations.find(function(item) { return item.id === observationId; });
  if (!confirm('删除资料“' + (observation ? observation.title : observationId) + '”？')) return;
  try {
    await expertApi('/api/expert/channels/' + channelId + '/observations/' + observationId, { method: 'DELETE' });
    await expertLoadChannels();
    document.getElementById('expertChannelSelect').value = String(channelId);
    await expertLoadTimeline();
    if (window.AIResearch && typeof window.AIResearch.reload === 'function') await window.AIResearch.reload();
    expertSetStatus('资料及其知识索引已删除。');
  } catch (error) {
    expertSetStatus(error.message, true);
  }
}

async function expertSeedModelMr() {
  const button = document.getElementById('seedModelMrBtn');
  button.disabled = true;
  try {
    const channel = await expertApi('/api/expert/channels', {
      method: 'POST',
      body: {
        channelKey: 'douyin-model-mr',
        displayName: '模型先生',
        subjectType: 'creator',
        platform: 'douyin',
        description: '抖音财经创作者研究档案。当前仅确认公开视频 7533142185677114684 与公开第三方讨论；主页 URL 尚未核验，不把同名雪球账号视为本人。',
        aliases: ['模型先生', '抖音模型先生'],
        discoveryQueries: [
          'site:douyin.com/video 模型先生 股票',
          '模型先生 抖音 股票',
          '模型先生 语录 股市'
        ]
      }
    });
    const seedObservations = [{
        externalContentId: '7533142185677114684',
        sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
        title: '科创芯片与港股创新药（公开页面）',
        publishedAt: '2025-07-31T15:19:00+08:00',
        evidenceLevel: 'primary',
        availabilityStatus: 'available',
        contentRole: 'fact_summary',
        mediaType: 'video',
        archiveStatus: 'linked',
        rightsBasis: 'quotation_only',
        summary: '公开页面涉及科创芯片、砺算及港股创新药进入收获期等观点。',
        sectors: ['科创芯片', '港股创新药'],
        topics: ['产业趋势'],
        stance: 'conditional',
        confidence: 0.8
      }, {
        sourceUrl: 'https://www.xueqiu.com/6387579554/383224297/402336752',
        title: '第三方讨论：东芯观察观点',
        publishedAt: '2026-04-09T22:19:00+08:00',
        evidenceLevel: 'secondary_quote',
        availabilityStatus: 'available',
        contentRole: 'secondary_quote',
        mediaType: 'article',
        archiveStatus: 'linked',
        rightsBasis: 'quotation_only',
        summary: '雪球用户转述其当日视频涉及东芯进展较慢、暂宜观察等观点；该页面不是本人原始视频。',
        sectors: ['芯片'],
        topics: ['东芯', '第三方转述'],
        stance: 'unknown',
        confidence: 0.45
      }, {
        sourceUrl: 'https://xueqiu.com/9437762706/393709860/411211227',
        title: '账号身份与删除痕迹（第三方评论）',
        publishedAt: '2026-07-14T15:11:00+08:00',
        evidenceLevel: 'commentary',
        availabilityStatus: 'deleted_trace',
        contentRole: 'fact_summary',
        mediaType: 'article',
        archiveStatus: 'linked',
        rightsBasis: 'quotation_only',
        summary: '第三方评论声称其先前雪球账号已删除，并质疑当前同名账号身份；仅作为待核验身份线索。',
        topics: ['账号身份', '删除痕迹', '疑似冒名'],
        stance: 'unknown',
        confidence: 0.3
      }, {
        sourceUrl: 'https://www.157110.cn/pdf/4147.html',
        title: '付费合集页面声称包含隐藏视频（未核验）',
        publishedAt: '2026-03-06T08:09:29+08:00',
        evidenceLevel: 'commentary',
        availabilityStatus: 'unknown',
        contentRole: 'fact_summary',
        mediaType: 'article',
        archiveStatus: 'blocked',
        rightsBasis: 'unknown',
        summary: '付费页面声称整理了约八万字语录和隐藏视频内容；系统未购买、未绕过会员墙，也未核验其身份、完整性或版权。',
        topics: ['付费合集', '隐藏视频声称', '未核验'],
        stance: 'unknown',
        confidence: 0.2
      }, {
        sourceUrl: 'https://xueqiu.com/9367316655/355813009',
        title: '第三方转述：科创芯片主线判断',
        publishedAt: '2025-10-09T16:19:00+08:00',
        evidenceLevel: 'secondary_quote',
        availabilityStatus: 'available',
        contentRole: 'secondary_quote',
        mediaType: 'article',
        archiveStatus: 'linked',
        rightsBasis: 'quotation_only',
        summary: '雪球用户声称模型先生在更早阶段提出科创芯片主线逻辑；该内容是第三方回忆，缺少对应原始视频时间戳。',
        stockCodes: ['688981', '588200'],
        sectors: ['科创芯片'],
        topics: ['主线判断', '第三方回忆'],
        stance: 'bullish',
        confidence: 0.35
      }, {
        sourceUrl: 'https://caifuhao.eastmoney.com/news/20260314110200339990560',
        title: '第三方持仓复盘：东芯股份早期关注',
        publishedAt: '2026-03-14T11:02:00+08:00',
        evidenceLevel: 'secondary_quote',
        availabilityStatus: 'available',
        contentRole: 'secondary_quote',
        mediaType: 'article',
        archiveStatus: 'linked',
        rightsBasis: 'quotation_only',
        summary: '东方财富用户称其因模型先生较早讨论东芯股份而介入，并记录了个人持仓变化；仅证明第三方受其影响，不证明原始观点全文。',
        stockCodes: ['688110'],
        sectors: ['存储芯片'],
        topics: ['东芯股份', '第三方持仓复盘'],
        stance: 'unknown',
        confidence: 0.35
      }, {
        sourceUrl: 'https://xueqiu.com/5931224701/385894203',
        title: '第三方评价：东芯、科创芯片、有色与航天观点表现',
        publishedAt: '2026-04-26T22:37:00+08:00',
        evidenceLevel: 'commentary',
        availabilityStatus: 'available',
        contentRole: 'fact_summary',
        mediaType: 'article',
        archiveStatus: 'linked',
        rightsBasis: 'quotation_only',
        summary: '雪球讨论同时包含正面和负面评价，提到东芯、科创芯片、有色铜与商业航天等主题；属于事后评论，不能直接作为本人信号回测。',
        stockCodes: ['688110'],
        sectors: ['科创芯片', '有色金属', '商业航天'],
        topics: ['第三方评价', '事后偏差'],
        stance: 'unknown',
        confidence: 0.25
      }, {
        sourceUrl: 'https://www.sina.cn/news/detail/5318588006924866.html',
        title: '微博转述：商业航天关注要点',
        publishedAt: '2026-07-09T02:00:00+08:00',
        evidenceLevel: 'secondary_quote',
        availabilityStatus: 'available',
        contentRole: 'secondary_quote',
        mediaType: 'article',
        archiveStatus: 'linked',
        rightsBasis: 'quotation_only',
        summary: '微博内容称受模型先生提及商业航天启发并自行总结行业要点；总结内容属于该微博作者，不得归为模型先生原话。',
        sectors: ['商业航天'],
        topics: ['行业要点', '第三方延伸'],
        stance: 'conditional',
        confidence: 0.3
      }, {
        sourceUrl: 'https://www.newrank.cn/rankfans/douyin/4/2025-10-29',
        title: '第三方榜单：抖音财经涨粉榜记录',
        publishedAt: '2025-10-29',
        evidenceLevel: 'commentary',
        availabilityStatus: 'available',
        contentRole: 'fact_summary',
        mediaType: 'article',
        archiveStatus: 'linked',
        rightsBasis: 'quotation_only',
        summary: '新榜公开页面在当日财经涨粉榜中列出“模型先生”；仅作为账号活跃度和同名身份辅助线索。',
        topics: ['账号活跃度', '第三方榜单'],
        stance: 'unknown',
        confidence: 0.4
      }];
    for (const observation of seedObservations) {
      await expertApi('/api/expert/channels/' + channel.id + '/observations', {
        method: 'POST', body: observation
      });
    }
    await expertLoadChannels();
    document.getElementById('expertChannelSelect').value = String(channel.id);
    await expertLoadTimeline();
    if (window.AIResearch && typeof window.AIResearch.reload === 'function') await window.AIResearch.reload();
    expertSetStatus('“模型先生”频道已建立，并加入分级公开线索。');
  } catch (error) {
    expertSetStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function expertDiscoveryItems(text) {
  const match = String(text || '').match(/WEBSTOCK_DISCOVERY_START\s*([\s\S]*?)\s*WEBSTOCK_DISCOVERY_END/i);
  if (!match) throw new Error('返回结果缺少公开线索数据块，请让 ChatGPT 按提示词原样输出。');
  const payload = match[1].replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const items = JSON.parse(payload);
  if (!Array.isArray(items)) throw new Error('公开线索数据块必须是 JSON 数组。');
  return items.slice(0, 50);
}

async function expertDiscoverUpdates() {
  const channelId = expertSelectedChannelId();
  if (!channelId) return alert('请先建立或选择研究对象。');
  const channel = expertChannels.find(function(item) { return item.id === channelId; });
  const existingUrls = expertObservations.map(function(item) { return item.sourceUrl; }).filter(Boolean);
  const prompt = [
    '请使用 ChatGPT Deep Research 搜索“' + (channel ? channel.displayName : '该研究对象') + '”的新增公开内容、版本信息和公开第三方引用。',
    '只访问无需绕过登录、验证码、反爬、付费墙或权限控制的页面；不要尝试恢复私有或已删除原文。',
    '重点检索本人公开页面、公开视频索引、合法公开存档、新闻/论坛中的明确引用。',
    '遇到同名账号、疑似冒名账号、付费合集或仅声称掌握隐藏视频的页面，必须标记 identityStatus=unverified。',
    '不得把第三方转述改写为本人原话。每条必须给出直接来源 URL、页面标题、公开时间（不确定可为空）、简短摘要和证据类型。',
    '已经入库的 URL，请不要重复：',
    existingUrls.length ? existingUrls.join('\n') : '（暂无）',
    '',
    '最终只输出以下数据块；不要在数据块内使用 Markdown：',
    'WEBSTOCK_DISCOVERY_START',
    '[{"sourceUrl":"https://...","title":"...","publishedAt":"YYYY-MM-DD 或 ISO 时间","summary":"...","sourceType":"primary_page|public_archive|third_party_quote|commentary","identityStatus":"matched|unverified","topics":["..."]}]',
    'WEBSTOCK_DISCOVERY_END'
  ].join('\n');
  window.AIAssistant.open({
    title: (channel ? channel.displayName : '研究对象') + '新增公开线索检索',
    summary: '返回内容先作为低置信度待核验线索保存，不会直接进入严格回测。',
    prompt,
    promptStyle: 'deep-research',
    kind: 'expert-public-discovery',
    context: { channelId },
    onSave: async function(savedResult) {
      const items = expertDiscoveryItems(savedResult);
      let imported = 0;
      for (const item of items) {
        if (!item || !/^https?:\/\//i.test(String(item.sourceUrl || '')) || !String(item.title || '').trim()) continue;
        await expertApi('/api/expert/channels/' + channelId + '/observations', {
          method: 'POST',
          body: {
            sourceUrl: item.sourceUrl,
            title: '[待核验] ' + String(item.title).trim(),
            publishedAt: item.publishedAt || '',
            evidenceLevel: item.sourceType === 'third_party_quote' ? 'secondary_quote' : 'commentary',
            availabilityStatus: 'unknown',
            contentRole: 'fact_summary',
            mediaType: item.sourceType === 'primary_page' ? 'video' : 'article',
            archiveStatus: 'linked',
            rightsBasis: 'quotation_only',
            summary: String(item.summary || '自动检索到的公开线索，尚未人工核验身份与原文。'),
            topics: Array.isArray(item.topics) ? item.topics : [],
            stance: 'unknown',
            confidence: item.identityStatus === 'matched' ? 0.3 : 0.15
          }
        });
        imported += 1;
      }
      await expertLoadChannels();
      document.getElementById('expertChannelSelect').value = String(channelId);
      await expertLoadTimeline();
      if (window.AIResearch && typeof window.AIResearch.reload === 'function') await window.AIResearch.reload();
      expertSetStatus('已导入 ' + imported + ' 条待核验公开线索；未进入严格回测。');
    }
  });
}

async function expertWaitForJob(jobId) {
  for (;;) {
    const job = await expertApi('/api/quant/jobs/' + encodeURIComponent(jobId), { timeoutMs: 30000, dedupe: false });
    expertSetStatus(job.progress && job.progress.message ? job.progress.message : '语录事件回测运行中...');
    if (job.status === 'completed') return job;
    if (['failed', 'cancelled', 'interrupted'].includes(job.status)) throw new Error(job.error || '语录事件回测未完成。');
    await new Promise(function(resolve) { setTimeout(resolve, 1500); });
  }
}

async function expertBacktestSignals() {
  const channelId = expertSelectedChannelId();
  if (!channelId) return alert('请先建立或选择研究对象。');
  const button = document.getElementById('backtestExpertSignalsBtn');
  button.disabled = true;
  try {
    expertSetStatus('正在选择最新的完整历史数据集...');
    const datasets = await expertApi('/api/quant/datasets?limit=30');
    const selectedDatasetId = document.getElementById('quantDatasetSelect')?.value || '';
    const selected = datasets.find(function(item) {
      return item.valid && item.manifest && item.manifest.datasetId === selectedDatasetId;
    }) || datasets.find(function(item) { return item.valid && item.manifest; });
    if (!selected) throw new Error('没有可用的完整历史数据集，请先在量化工作台完成数据同步。');
    const job = await expertApi('/api/quant/expert-backtests', {
      method: 'POST',
      body: { channelId, datasetId: selected.manifest.datasetId, horizons: [1, 5, 20, 60], costBps: 8 }
    });
    await expertWaitForJob(job.id);
    await expertLoadTimeline();
    expertSetStatus('语录事件回测完成；结果已保存，当前仅作探索性验证。');
  } catch (error) {
    expertSetStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function expertObservationBody() {
  const topics = document.getElementById('expertObservationTopicsInput').value;
  return {
    mediaType: document.getElementById('expertMediaTypeSelect').value,
    archiveStatus: document.getElementById('expertArchiveStatusSelect').value,
    rightsBasis: document.getElementById('expertRightsBasisSelect').value,
    evidenceLevel: document.getElementById('expertEvidenceLevelSelect').value,
    availabilityStatus: document.getElementById('expertAvailabilitySelect').value,
    contentRole: document.getElementById('expertContentRoleSelect').value,
    publishedAt: document.getElementById('expertPublishedAtInput').value,
    title: document.getElementById('expertObservationTitleInput').value.trim(),
    sourceUrl: document.getElementById('expertObservationUrlInput').value.trim(),
    localAssetPath: document.getElementById('expertLocalAssetPathInput').value.trim(),
    stockCodes: document.getElementById('expertObservationStocksInput').value,
    sectors: topics,
    topics,
    stance: document.getElementById('expertStanceSelect').value,
    confidence: Number(document.getElementById('expertConfidenceInput').value),
    content: document.getElementById('expertObservationContentInput').value.trim(),
    summary: document.getElementById('expertObservationSummaryInput').value.trim(),
    curveData: document.getElementById('expertCurveDataInput').value.trim(),
    analysisNotes: document.getElementById('expertAnalysisNotesInput').value.trim()
  };
}

function expertClearObservationForm() {
  ['expertPublishedAtInput', 'expertObservationTitleInput', 'expertObservationUrlInput',
    'expertObservationStocksInput', 'expertObservationTopicsInput', 'expertObservationContentInput',
    'expertObservationSummaryInput', 'expertLocalAssetPathInput', 'expertCurveDataInput',
    'expertAnalysisNotesInput'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('expertMediaTypeSelect').value = 'video';
  document.getElementById('expertArchiveStatusSelect').value = 'linked';
  document.getElementById('expertRightsBasisSelect').value = 'quotation_only';
  document.getElementById('expertEvidenceLevelSelect').value = 'primary';
  document.getElementById('expertAvailabilitySelect').value = 'available';
  document.getElementById('expertContentRoleSelect').value = 'direct_quote';
  document.getElementById('expertStanceSelect').value = 'unknown';
  document.getElementById('expertConfidenceInput').value = '0.8';
}

async function expertSaveObservation() {
  const channelId = expertSelectedChannelId();
  if (!channelId) return alert('请先建立或选择研究对象。');
  const button = document.getElementById('saveExpertObservationBtn');
  button.disabled = true;
  expertSetStatus('正在保存并建立证据索引...');
  try {
    await expertApi('/api/expert/channels/' + channelId + '/observations', {
      method: 'POST',
      body: expertObservationBody()
    });
    expertClearObservationForm();
    await expertLoadChannels();
    document.getElementById('expertChannelSelect').value = String(channelId);
    await expertLoadTimeline();
    if (window.AIResearch && typeof window.AIResearch.reload === 'function') await window.AIResearch.reload();
    expertSetStatus('公开内容已保存并进入证据库。');
  } catch (error) {
    expertSetStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function expertAnalyzeIntent() {
  const channelId = expertSelectedChannelId();
  if (!channelId) return alert('请先建立或选择研究对象。');
  expertSetStatus('正在整理原话、转述和时间线证据...');
  try {
    const result = await expertApi('/api/expert/channels/' + channelId + '/intent-analysis', {
      method: 'POST',
      body: {},
      timeoutMs: 120000
    });
    const title = result.channel.displayName + '观点与意图分析';
    if (!result.handoffMode) {
      window.AIAssistant.saveHistoryRecord({
        title,
        result: result.report || '',
        kind: 'expert-intent-analysis',
        context: { channelId }
      });
      expertSetStatus('AI 分析已保存。');
      return;
    }
    window.AIAssistant.open({
      title,
      summary: result.observationCount + ' 条观察已按证据等级整理；保存返回结果后进入研究记录。',
      prompt: result.prompt,
      promptStyle: 'deep-research',
      kind: 'expert-intent-analysis',
      context: { channelId, channelName: result.channel.displayName },
      onSave: async function(savedResult) {
        await expertApi('/api/research-runs', {
          method: 'POST',
          body: {
            runType: 'expert-intent-analysis',
            modelId: 'chatgpt-handoff',
            status: 'completed',
            title,
            question: result.question,
            prompt: result.prompt,
            result: savedResult,
            evidence: result.evidence,
            request: { channelId, observationCount: result.observationCount }
          }
        });
        expertSetStatus('观点与意图分析已保存。');
      }
    });
  } catch (error) {
    expertSetStatus(error.message, true);
  }
}

function expertSyncEvidenceDefaults() {
  const level = document.getElementById('expertEvidenceLevelSelect').value;
  const role = document.getElementById('expertContentRoleSelect');
  const confidence = document.getElementById('expertConfidenceInput');
  if (level === 'primary') {
    if (role.value === 'secondary_quote') role.value = 'direct_quote';
    confidence.value = '0.8';
  } else {
    role.value = level === 'archive' ? 'transcript' : 'secondary_quote';
    confidence.value = level === 'archive' ? '0.65' : '0.35';
  }
}

function bindExpertTracker() {
  if (expertTrackerBound) return;
  expertTrackerBound = true;
  document.getElementById('seedModelMrBtn').addEventListener('click', expertSeedModelMr);
  document.getElementById('saveExpertSubjectBtn').addEventListener('click', expertSaveSubject);
  document.getElementById('deleteExpertChannelBtn').addEventListener('click', expertDeleteSubject);
  document.getElementById('refreshExpertTimelineBtn').addEventListener('click', function() {
    expertLoadChannels().catch(function(error) { expertSetStatus(error.message, true); });
  });
  document.getElementById('expertChannelSelect').addEventListener('change', function() {
    expertLoadTimeline().catch(function(error) { expertSetStatus(error.message, true); });
  });
  document.getElementById('expertEvidenceLevelSelect').addEventListener('change', expertSyncEvidenceDefaults);
  document.getElementById('saveExpertObservationBtn').addEventListener('click', expertSaveObservation);
  document.getElementById('analyzeExpertIntentBtn').addEventListener('click', expertAnalyzeIntent);
  document.getElementById('discoverExpertUpdatesBtn').addEventListener('click', expertDiscoverUpdates);
  document.getElementById('backtestExpertSignalsBtn').addEventListener('click', expertBacktestSignals);
  document.getElementById('expertTimeline').addEventListener('click', function(event) {
    const button = event.target.closest('.expert-delete-observation');
    if (button) expertDeleteObservation(Number(button.dataset.observationId));
  });
  expertLoadChannels().catch(function(error) { expertSetStatus(error.message, true); });
}

window.ExpertTracker = {
  bind: bindExpertTracker,
  reload: expertLoadChannels
};
