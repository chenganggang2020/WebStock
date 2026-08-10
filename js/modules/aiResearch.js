let aiResearchSources = [];
let aiResearchModels = [];
let aiResearchRuns = [];
let aiResearchEditingSourceId = null;
let aiResearchLoaded = false;
let aiResearchLoading = null;
let aiResearchBound = false;
let quantRuntime = null;
let quantDatasets = [];
let quantResults = [];
let quantFactorResults = [];
let quantJobs = [];
let quantPollTimer = null;
let decisionPacket = null;
let paperPortfolios = [];

const AI_RESEARCH_STATUS_LABELS = {
  available: '可用',
  configured: '已配置',
  not_configured: '未配置',
  planned: '规划中',
  unavailable: '不可用'
};

const AI_RESEARCH_SOURCE_LABELS = {
  book: '书籍',
  blog: '博主 / 博客',
  article: '文章',
  video: '视频',
  transcript: '访谈 / 直播转录',
  research: '研报',
  note: '个人笔记'
};

const QUANT_JOB_KIND_LABELS = {
  'runtime-install': '量化环境安装',
  pilot: '小样本试跑',
  collect: '市场数据采集',
  run: '数据集训练',
  'factor-lab': '因子样本外体检',
  'research-suite': '完整研究流水线'
};

const QUANT_JOB_STATUS_LABELS = {
  queued: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  interrupted: '已中断'
};

const AI_RESEARCH_COST_LABELS = {
  'local-free': '本地免费',
  'existing-subscription': '使用现有订阅',
  'provider-billed': '服务商计费',
  'local-compute': '本机算力',
  'data-and-llm-dependent': '取决于数据与模型调用',
  'llm-and-compute': '模型调用与本机算力',
  'multi-llm-calls': '多次模型调用'
};

function aiResearchEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function aiResearchApi(path, options) {
  const requestOptions = Object.assign({}, options || {});
  if (requestOptions.body && typeof requestOptions.body !== 'string') {
    requestOptions.headers = Object.assign({ 'Content-Type': 'application/json' }, requestOptions.headers || {});
    requestOptions.body = JSON.stringify(requestOptions.body);
  }
  return window.apiFetch(path, requestOptions);
}

function aiResearchSetStatus(id, message, isError) {
  const target = document.getElementById(id);
  if (!target) return;
  target.textContent = message || '';
  target.classList.toggle('error', !!isError);
}

function aiResearchDate(value) {
  if (!value) return '';
  if (window.WebStockTime && window.WebStockTime.formatDateTime) {
    try { return window.WebStockTime.formatDateTime(value); } catch (error) {}
  }
  return String(value);
}

function aiResearchRenderModels() {
  const target = document.getElementById('aiModelRegistry');
  if (!target) return;
  if (!aiResearchModels.length) {
    target.innerHTML = '<div class="empty-state compact">没有模型状态数据。</div>';
    return;
  }
  target.innerHTML = '<div class="table-scroll compact-scroll"><table class="data-table ai-model-table"><thead><tr>' +
    '<th>能力</th><th>状态</th><th>运行环境</th><th>成本</th><th>当前说明</th>' +
    '</tr></thead><tbody>' + aiResearchModels.map(function(model) {
      const label = AI_RESEARCH_STATUS_LABELS[model.status] || model.status;
      return '<tr>' +
        '<td><strong>' + aiResearchEscape(model.name) + '</strong><div class="muted">' + aiResearchEscape((model.capabilities || []).join(' / ')) + '</div></td>' +
        '<td><span class="model-status ' + aiResearchEscape(model.status) + '">' + aiResearchEscape(label) + '</span></td>' +
        '<td>' + aiResearchEscape(model.runtime || '-') + '</td>' +
        '<td>' + aiResearchEscape(AI_RESEARCH_COST_LABELS[model.costMode] || model.costMode || '-') + '</td>' +
        '<td><span>' + aiResearchEscape(model.note || '') + '</span>' +
          ((model.requirements || []).length ? '<div class="muted">条件：' + aiResearchEscape(model.requirements.join('；')) + '</div>' : '') + '</td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>';
  const available = aiResearchModels.filter(function(model) { return model.status === 'available'; }).length;
  aiResearchSetStatus('aiModelRegistryStatus', available + ' 项当前可用 / ' + aiResearchModels.length + ' 项已登记');
}

function quantPercent(value, digits) {
  const number = Number(value);
  return Number.isFinite(number) ? (number * 100).toFixed(digits == null ? 2 : digits) + '%' : '--';
}

function quantNumber(value, digits) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits == null ? 3 : digits) : '--';
}

function quantMetricClass(value) {
  const number = Number(value);
  return number > 0 ? 'pnl-up' : number < 0 ? 'pnl-down' : '';
}

function aiResearchRenderQuantRuntime() {
  const target = document.getElementById('quantRuntimeStatus');
  if (!target) return;
  if (!quantRuntime) {
    target.textContent = '--';
    return;
  }
  const label = AI_RESEARCH_STATUS_LABELS[quantRuntime.status] || quantRuntime.status;
  const versions = quantRuntime.versions || {};
  const installer = quantRuntime.installer || {};
  const linkButton = document.getElementById('linkQuantRuntimeBtn');
  const installButton = document.getElementById('installQuantRuntimeBtn');
  const repairButton = document.getElementById('repairQuantRuntimeBtn');
  const hasRuntime = quantRuntime.status === 'available' || quantRuntime.status === 'configured';
  const linkedRuntime = quantRuntime.runtimeSource === 'linked';
  if (linkButton) linkButton.style.display = hasRuntime ? 'none' : '';
  if (installButton) installButton.style.display = !hasRuntime && installer.available ? '' : 'none';
  if (repairButton) repairButton.style.display = hasRuntime && !linkedRuntime && installer.available ? '' : 'none';
  target.title = quantRuntime.python || '';
  target.innerHTML = '<span class="model-status ' + aiResearchEscape(quantRuntime.status) + '">' + aiResearchEscape(label) + '</span>' +
    (versions.qlib ? ' <span>Python ' + aiResearchEscape(versions.python) + ' / Qlib ' + aiResearchEscape(versions.qlib) + ' / LightGBM ' + aiResearchEscape(versions.lightgbm) +
      (versions.torch ? ' / PyTorch ' + aiResearchEscape(versions.torch) : '') + '</span>' : '') +
    '<span class="quant-runtime-reason">' + aiResearchEscape(quantRuntime.reason || '') + '</span>';
}

async function aiResearchLinkQuantRuntime(button) {
  let pythonPath = '';
  if (window.webstockDesktop && typeof window.webstockDesktop.selectQuantPython === 'function') {
    pythonPath = await window.webstockDesktop.selectQuantPython();
  } else {
    pythonPath = prompt('请输入已有量化环境中 python.exe 的完整路径：') || '';
  }
  if (!pythonPath) return;
  button.disabled = true;
  try {
    quantRuntime = await aiResearchApi('/api/quant/runtime/link', {
      method: 'POST',
      body: { pythonPath },
      timeoutMs: 120000
    });
    aiResearchRenderQuantRuntime();
    await aiResearchLoadModels();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

function quantModelChoice(modelId) {
  return String(modelId || '').indexOf('master') >= 0 ? 'master' : 'lightgbm';
}

function quantModelLabel(modelId) {
  return quantModelChoice(modelId) === 'master' ? 'MASTER 市场引导时序模型' : 'Qlib + LightGBM';
}

function quantComparisonKey(result) {
  const parameters = result && result.parameters || {};
  const comparedParameters = [
    'trainDays', 'validationDays', 'testDays', 'stepDays', 'labelHorizon',
    'maxFolds', 'topK', 'costBps', 'costModel', 'seed'
  ].map(function(name) { return parameters[name] == null ? '' : parameters[name]; });
  return JSON.stringify([
    result && result.dataManifest && result.dataManifest.sha256 || '',
    comparedParameters,
    result && result.folds || []
  ]);
}

function quantWarningText(value) {
  const translations = {
    'Exploratory MASTER comparison on the same public, unadjusted daily dataset and rolling folds as LightGBM.': 'MASTER 与 LightGBM 使用同一公开未复权日线、标签和滚动窗口，本结果仅为探索性对照。',
    'Validation inference keeps all feature-valid stocks; missing labels are filtered only when metrics are computed.': '验证和预测保留全部特征有效股票，仅在计算损失或指标时过滤空标签。',
    'This implementation follows the official MASTER architecture concepts under its MIT license; it is not an official pretrained checkpoint.': '本实现依据官方 MASTER 架构与 MIT 许可证重新实现，不是官方预训练检查点。',
    'Each fold selects a bounded liquid universe using training-period coverage and volume only.': '每个滚动窗口只使用训练期覆盖率和成交量选择受控股票池，测试期不参与选池。',
    'Factor directions and ensemble weights are selected from each validation window only.': '每个滚动窗口的因子方向和复合权重只使用验证期确定。',
    'Admission labels are exploratory gates, not evidence of future profitability.': '通过、观察和拒绝仅是探索性研究门禁，不代表未来可以盈利。',
    'Public unadjusted daily data cannot support production factor approval.': '公开未复权日线不足以支持生产级因子批准。'
  };
  return translations[String(value || '')] || String(value || '');
}

function aiResearchRenderQuantDatasets() {
  const select = document.getElementById('quantDatasetSelect');
  if (!select) return;
  const previous = select.value;
  const valid = quantDatasets.filter(function(entry) { return entry.valid && entry.manifest; });
  select.innerHTML = valid.length ? valid.map(function(entry) {
    const manifest = entry.manifest;
    return '<option value="' + aiResearchEscape(manifest.datasetId) + '">' +
      aiResearchEscape(manifest.datasetId + ' · ' + manifest.coverage.succeeded + '只 · 截止' + manifest.asOf) + '</option>';
  }).join('') : '<option value="">暂无数据集</option>';
  if (valid.some(function(entry) { return entry.manifest.datasetId === previous; })) select.value = previous;
}

function aiResearchActiveQuantJob() {
  return quantJobs.find(function(job) { return job.status === 'queued' || job.status === 'running'; }) || null;
}

function aiResearchRenderQuantJob() {
  const target = document.getElementById('quantJobStatus');
  const cancel = document.getElementById('cancelQuantJobBtn');
  const active = aiResearchActiveQuantJob();
  if (cancel) cancel.style.display = active ? '' : 'none';
  ['installQuantRuntimeBtn', 'repairQuantRuntimeBtn'].forEach(function(id) {
    const button = document.getElementById(id);
    if (button) button.disabled = !!active;
  });
  if (!target) return;
  const job = active || quantJobs[0];
  if (!job) {
    target.innerHTML = '<span class="muted">尚未启动量化任务。</span>';
    return;
  }
  const progress = job.progress || {};
  const current = Number(progress.current || 0);
  const total = Number(progress.total || 0);
  const percent = total > 0 ? Math.min(Math.max(current / total * 100, 0), 100) : (job.status === 'completed' ? 100 : 0);
  const kindLabel = QUANT_JOB_KIND_LABELS[job.kind] || job.kind;
  const statusLabel = QUANT_JOB_STATUS_LABELS[job.status] || job.status;
  target.innerHTML = '<div class="quant-job-line"><strong>' + aiResearchEscape(kindLabel + ' · ' + statusLabel) + '</strong>' +
    '<span>' + aiResearchEscape(progress.message || job.error || '') + '</span><time>' + aiResearchEscape(aiResearchDate(job.updatedAt)) + '</time></div>' +
    '<div class="quant-progress-track"><span style="width:' + percent.toFixed(1) + '%"></span></div>' +
    (job.error ? '<div class="quant-job-error">' + aiResearchEscape(job.error) + '</div>' : '');
}

function aiResearchRenderQuantResult() {
  const target = document.getElementById('quantResultPanel');
  if (!target) return;
  const modelSelect = document.getElementById('quantModelSelect');
  const selectedModel = modelSelect ? modelSelect.value : 'lightgbm';
  const selectedEntries = quantResults.filter(function(item) {
    return item.valid && item.result && quantModelChoice(item.result.modelId) === selectedModel;
  });
  const entry = selectedEntries.find(function(item) {
    const key = quantComparisonKey(item.result);
    return quantResults.some(function(other) {
      return other.valid && other.result && quantModelChoice(other.result.modelId) !== selectedModel && quantComparisonKey(other.result) === key;
    });
  }) || selectedEntries[0] || quantResults.find(function(item) { return item.valid && item.result; });
  if (!entry) {
    target.innerHTML = '<div class="empty-state compact">尚无通过契约校验的量化结果。</div>';
    return;
  }
  const result = entry.result;
  const metrics = result.metrics || {};
  const candidates = result.candidates || [];
  const dataset = quantDatasets.find(function(item) {
    return item.manifest && item.manifest.datasetId === result.dataManifest.datasetId;
  });
  const manifest = dataset && dataset.manifest;
  const coverage = manifest && manifest.coverage || {};
  const warnings = result.warnings || [];
  const comparable = [];
  quantResults.forEach(function(item) {
    if (!item.valid || !item.result || !item.result.dataManifest) return;
    if (quantComparisonKey(item.result) !== quantComparisonKey(result)) return;
    const choice = quantModelChoice(item.result.modelId);
    if (!comparable.some(function(existing) { return quantModelChoice(existing.modelId) === choice; })) comparable.push(item.result);
  });
  const metricItems = [
    ['Rank IC', quantNumber(metrics.rankIc, 3), metrics.rankIc],
    ['ICIR', quantNumber(metrics.icir, 2), metrics.icir],
    ['年化收益', quantPercent(metrics.annualizedReturn), metrics.annualizedReturn],
    ['基准年化', quantPercent(metrics.benchmarkAnnualizedReturn), metrics.benchmarkAnnualizedReturn],
    ['最大回撤', quantPercent(metrics.maxDrawdown), metrics.maxDrawdown],
    ['Sharpe', quantNumber(metrics.sharpe, 2), metrics.sharpe],
    ['平均换手', quantPercent(metrics.turnover), -Math.abs(Number(metrics.turnover || 0))],
    ['累计成本', quantPercent(metrics.totalCost), -Math.abs(Number(metrics.totalCost || 0))],
    ['交易笔数', String(metrics.tradeCount == null ? '--' : metrics.tradeCount), 0],
    ['调仓次数', String(metrics.rebalanceCount == null ? '--' : metrics.rebalanceCount), 0]
  ];
  target.innerHTML = '<div class="quant-result-head"><div><strong>' + aiResearchEscape(quantModelLabel(result.modelId)) + '</strong>' +
      '<span class="model-status ' + (result.validationStatus === 'validated' ? 'available' : 'planned') + '">' +
      aiResearchEscape(result.validationStatus === 'validated' ? '已验证' : '探索性') + '</span></div>' +
      '<div class="muted">截止 ' + aiResearchEscape(result.asOf) + ' · ' + result.folds.length + ' 个滚动窗口 · ' +
      aiResearchEscape(result.dataManifest.datasetId) + '</div></div>' +
    '<div class="quant-coverage-line"><span>成功 <strong>' + aiResearchEscape(coverage.succeeded == null ? '--' : coverage.succeeded) + '</strong> 只</span>' +
      '<span>失败 <strong>' + aiResearchEscape(coverage.failed == null ? '--' : coverage.failed) + '</strong> 只</span>' +
      '<span>样本 <strong>' + aiResearchEscape(coverage.rows == null ? '--' : coverage.rows) + '</strong> 行</span>' +
      '<span>成本 <strong>' + aiResearchEscape(result.parameters.costBps) + ' bp</strong></span></div>' +
    (comparable.length > 1 ? '<div class="table-scroll compact-scroll"><table class="data-table quant-comparison-table"><thead><tr><th>同数据模型</th><th>Rank IC</th><th>年化</th><th>最大回撤</th><th>Sharpe</th></tr></thead><tbody>' +
      comparable.map(function(other) { return '<tr><td>' + aiResearchEscape(quantModelLabel(other.modelId)) + '</td>' +
        '<td class="' + quantMetricClass(other.metrics.rankIc) + '">' + aiResearchEscape(quantNumber(other.metrics.rankIc, 3)) + '</td>' +
        '<td class="' + quantMetricClass(other.metrics.annualizedReturn) + '">' + aiResearchEscape(quantPercent(other.metrics.annualizedReturn)) + '</td>' +
        '<td class="' + quantMetricClass(other.metrics.maxDrawdown) + '">' + aiResearchEscape(quantPercent(other.metrics.maxDrawdown)) + '</td>' +
        '<td class="' + quantMetricClass(other.metrics.sharpe) + '">' + aiResearchEscape(quantNumber(other.metrics.sharpe, 2)) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : '') +
    '<div class="quant-metric-grid">' + metricItems.map(function(item) {
      return '<div><span>' + item[0] + '</span><strong class="' + quantMetricClass(item[2]) + '">' + aiResearchEscape(item[1]) + '</strong></div>';
    }).join('') + '</div>' +
    '<details class="quant-warning-block"' + (result.validationStatus !== 'validated' ? ' open' : '') + '><summary>数据与结论限制（' + warnings.length + '）</summary><ul>' +
      warnings.map(function(warning) { return '<li>' + aiResearchEscape(quantWarningText(warning)) + '</li>'; }).join('') + '</ul></details>' +
    '<div class="panel-title-row quant-candidate-title"><h3>最新候选</h3><span class="muted">模型分数只用于排序</span></div>' +
    '<div class="table-scroll compact-scroll"><table class="data-table quant-candidate-table"><thead><tr><th>代码</th><th>名称</th><th>分数</th><th>行情截止</th><th>模型训练截止</th></tr></thead><tbody>' +
      candidates.map(function(candidate) { return '<tr data-quant-code="' + aiResearchEscape(candidate.code) + '" data-quant-name="' + aiResearchEscape(candidate.name) + '">' +
        '<td><button class="stock-link-btn" type="button">' + aiResearchEscape(candidate.code) + '</button></td><td>' + aiResearchEscape(candidate.name) + '</td>' +
        '<td>' + aiResearchEscape(quantNumber(candidate.score, 5)) + '</td><td>' + aiResearchEscape(candidate.asOf || result.asOf) + '</td>' +
        '<td>' + aiResearchEscape(candidate.modelTrainedThrough || '--') + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
}

function factorAdmissionLabel(value) {
  return { candidate: '候选', watch: '观察', rejected: '拒绝' }[value] || value;
}

function factorAdmissionClass(value) {
  return value === 'candidate' ? 'available' : value === 'watch' ? 'planned' : 'unavailable';
}

function aiResearchRenderFactorLab() {
  const target = document.getElementById('factorLabPanel');
  if (!target) return;
  const datasetSelect = document.getElementById('quantDatasetSelect');
  const datasetId = datasetSelect ? datasetSelect.value : '';
  const entry = quantFactorResults.find(function(item) {
    return item.valid && item.result && (!datasetId || item.result.dataManifest.datasetId === datasetId);
  }) || quantFactorResults.find(function(item) { return item.valid && item.result; });
  if (!entry) {
    target.innerHTML = '<div class="panel-title-row"><h3>因子样本外体检</h3><span class="muted">选择数据集后运行，不会修改模型结果</span></div>' +
      '<div class="empty-state compact">尚无通过契约校验的因子实验。</div>';
    return;
  }
  const result = entry.result;
  const composite = result.composite || {};
  const metrics = composite.metrics || {};
  const factors = result.factors || [];
  const warnings = result.warnings || [];
  const candidateCount = factors.filter(function(factor) { return factor.admission === 'candidate'; }).length;
  const watchCount = factors.filter(function(factor) { return factor.admission === 'watch'; }).length;
  target.innerHTML = '<div class="panel-title-row"><h3>因子样本外体检</h3><span class="muted">' +
      aiResearchEscape(result.dataManifest.datasetId) + ' · 截止 ' + aiResearchEscape(result.asOf) + ' · ' + result.folds.length + ' 个滚动窗口</span></div>' +
    '<div class="factor-lab-summary"><span>候选 <strong>' + candidateCount + '</strong></span><span>观察 <strong>' + watchCount + '</strong></span>' +
      '<span>复合 Rank IC <strong class="' + quantMetricClass(metrics.rankIc) + '">' + aiResearchEscape(quantNumber(metrics.rankIc, 3)) + '</strong></span>' +
      '<span>复合年化 <strong class="' + quantMetricClass(metrics.annualizedReturn) + '">' + aiResearchEscape(quantPercent(metrics.annualizedReturn)) + '</strong></span>' +
      '<span>复合回撤 <strong class="' + quantMetricClass(metrics.maxDrawdown) + '">' + aiResearchEscape(quantPercent(metrics.maxDrawdown)) + '</strong></span></div>' +
    '<div class="table-scroll compact-scroll"><table class="data-table factor-lab-table"><thead><tr>' +
      '<th>因子</th><th>方向</th><th>验证 IC</th><th>样本外 IC</th><th>正向窗口</th><th>扣费年化</th><th>最大回撤</th><th>最高重复度</th><th>门禁</th><th>原因</th>' +
      '</tr></thead><tbody>' + factors.map(function(factor) {
        const direction = Number(factor.dominantOrientation) >= 0 ? '正向' : '反向';
        const duplicate = factor.closestFactor ? quantPercent(factor.maxAbsCorrelation, 1) + ' · ' + factor.closestFactor : quantPercent(factor.maxAbsCorrelation, 1);
        return '<tr><td><strong>' + aiResearchEscape(factor.displayName || factor.factorId) + '</strong><div class="muted">' + aiResearchEscape(factor.factorId) + '</div></td>' +
          '<td>' + direction + '<div class="muted">一致 ' + aiResearchEscape(quantPercent(factor.orientationAgreement, 0)) + '</div></td>' +
          '<td class="' + quantMetricClass(factor.validationRankIc) + '">' + aiResearchEscape(quantNumber(factor.validationRankIc, 3)) + '</td>' +
          '<td class="' + quantMetricClass(factor.testRankIc) + '">' + aiResearchEscape(quantNumber(factor.testRankIc, 3)) + '</td>' +
          '<td>' + aiResearchEscape(quantPercent(factor.positiveFoldRate, 0)) + '</td>' +
          '<td class="' + quantMetricClass(factor.metrics && factor.metrics.annualizedReturn) + '">' + aiResearchEscape(quantPercent(factor.metrics && factor.metrics.annualizedReturn)) + '</td>' +
          '<td class="' + quantMetricClass(factor.metrics && factor.metrics.maxDrawdown) + '">' + aiResearchEscape(quantPercent(factor.metrics && factor.metrics.maxDrawdown)) + '</td>' +
          '<td>' + aiResearchEscape(duplicate) + '</td>' +
          '<td><span class="model-status ' + factorAdmissionClass(factor.admission) + '">' + aiResearchEscape(factorAdmissionLabel(factor.admission)) + '</span></td>' +
          '<td class="factor-lab-reasons">' + aiResearchEscape((factor.reasons || []).join('；') || '通过当前门槛') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
    ((composite.candidates || []).length ? '<div class="factor-candidate-line"><span class="muted">复合因子最新候选：</span>' +
      composite.candidates.slice(0, 8).map(function(candidate) { return '<button type="button" class="stock-link-btn" data-quant-code="' + aiResearchEscape(candidate.code) + '" data-quant-name="' + aiResearchEscape(candidate.name) + '">' + aiResearchEscape(candidate.code + ' ' + candidate.name) + '</button>'; }).join('') + '</div>' : '') +
    '<details class="quant-warning-block"' + (result.validationStatus !== 'validated' ? ' open' : '') + '><summary>因子结论限制（' + warnings.length + '）</summary><ul>' +
      warnings.map(function(warning) { return '<li>' + aiResearchEscape(quantWarningText(warning)) + '</li>'; }).join('') + '</ul></details>';
}

function decisionRiskLabel(value) {
  return { conservative: '保守', balanced: '均衡', aggressive: '积极' }[value] || value;
}

function paperStatusLabel(value) {
  return { draft: '草稿', active: '观察中', archived: '已归档' }[value] || value;
}

function aiResearchRenderDecisionPacket() {
  const target = document.getElementById('decisionPacketPanel');
  const analyze = document.getElementById('analyzeDecisionPacketBtn');
  const createPaper = document.getElementById('createPaperPortfolioBtn');
  if (analyze) analyze.disabled = !decisionPacket;
  if (createPaper) createPaper.disabled = !decisionPacket;
  if (!target) return;
  if (!decisionPacket) {
    target.innerHTML = '<div class="empty-state compact">决策包会合并最新模型、因子、本地筛选、专家证据和带来源资讯；缺失项会单独列出。</div>';
    return;
  }
  const sources = decisionPacket.dataSources || [];
  const candidates = decisionPacket.candidates || [];
  const gaps = decisionPacket.dataGaps || [];
  target.innerHTML = '<div class="decision-source-line"><span>来源 <strong>' + sources.length + '</strong></span>' +
      '<span>候选 <strong>' + candidates.length + '</strong></span><span>证据 <strong>' + (decisionPacket.evidence || []).length + '</strong></span>' +
      '<span>风险档位 <strong>' + aiResearchEscape(decisionRiskLabel(decisionPacket.riskProfile)) + '</strong></span>' +
      '<span>生成时间 <strong>' + aiResearchEscape(aiResearchDate(decisionPacket.generatedAt)) + '</strong></span></div>' +
    '<div class="decision-source-list">' + sources.map(function(source) {
      return '<span class="factor-tag">' + aiResearchEscape(source.sourceLabel) + ' · ' + aiResearchEscape(source.validationStatus || 'context') +
        (source.asOf ? ' · ' + aiResearchEscape(String(source.asOf).slice(0, 10)) : '') + '</span>';
    }).join('') + '</div>' +
    '<div class="table-scroll compact-scroll"><table class="data-table decision-candidate-table"><thead><tr>' +
      '<th>代码</th><th>名称</th><th>共识分</th><th>来源数</th><th>来源内排名</th><th>行业 / 主题</th><th>模型分歧</th><th>个人上下文</th>' +
      '</tr></thead><tbody>' + candidates.map(function(candidate) {
        return '<tr data-quant-code="' + aiResearchEscape(candidate.code) + '" data-quant-name="' + aiResearchEscape(candidate.name) + '">' +
          '<td><button type="button" class="stock-link-btn">' + aiResearchEscape(candidate.code) + '</button></td><td>' + aiResearchEscape(candidate.name) + '</td>' +
          '<td><strong>' + aiResearchEscape(quantNumber(candidate.consensusScore, 1)) + '</strong></td><td>' + aiResearchEscape(candidate.signalCount) + '</td>' +
          '<td class="decision-signal-cell">' + (candidate.signals || []).map(function(signal) { return aiResearchEscape(signal.sourceLabel + ' #' + signal.rank); }).join('<br>') + '</td>' +
          '<td>' + aiResearchEscape([candidate.industry].concat(candidate.themes || []).filter(Boolean).slice(0, 5).join(' / ') || '--') + '</td>' +
          '<td class="' + (Number(candidate.modelDisagreement) >= 50 ? 'pnl-down' : '') + '">' + aiResearchEscape(quantNumber(candidate.modelDisagreement, 1)) + '</td>' +
          '<td>' + aiResearchEscape([candidate.inPortfolio ? '持仓' : '', candidate.inWatchlist ? '自选' : ''].filter(Boolean).join(' / ') || '--') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
    '<details class="decision-gap-block"' + (gaps.length ? ' open' : '') + '><summary>待补数据（' + gaps.length + '）</summary><ul>' +
      gaps.map(function(gap) { return '<li>' + aiResearchEscape(gap) + '</li>'; }).join('') + '</ul></details>';
}

function aiResearchRenderPaperPortfolios() {
  const target = document.getElementById('paperPortfolioPanel');
  if (!target) return;
  if (!paperPortfolios.length) {
    target.innerHTML = '<div class="panel-title-row paper-heading"><h3>纸面组合</h3><span class="muted">尚无草稿</span></div>';
    return;
  }
  target.innerHTML = '<div class="panel-title-row paper-heading"><h3>纸面组合</h3><span class="muted">仅记录研究权重，不连接券商</span></div>' +
    paperPortfolios.map(function(paper) {
      const invested = (paper.items || []).reduce(function(sum, item) { return sum + Number(item.targetWeight || 0); }, 0);
      const latest = paper.latestSnapshot;
      const tracking = latest
        ? '<div class="paper-performance"><span>净值 <strong>' + aiResearchEscape(Number(latest.totalValue).toLocaleString('zh-CN', { maximumFractionDigits: 2 })) + '</strong></span>' +
          '<span class="' + quantMetricClass(latest.dailyPnl) + '">当日 ' + aiResearchEscape(quantNumber(latest.dailyPnl, 2)) + '</span>' +
          '<span class="' + quantMetricClass(latest.totalPnl) + '">累计 ' + aiResearchEscape(quantNumber(latest.totalPnl, 2)) + ' / ' + aiResearchEscape(quantPercent(latest.totalReturn, 2)) + '</span>' +
          '<span class="muted">' + aiResearchEscape((latest.marketDate || aiResearchDate(latest.snapshotAt)) + (latest.marketTime ? ' ' + latest.marketTime : '')) + '</span>' +
          ((latest.warnings || []).length ? '<span class="paper-warning" title="' + aiResearchEscape(latest.warnings.join('；')) + '">部分价格沿用上次记录</span>' : '') + '</div>'
        : '<div class="paper-performance"><span class="muted">' + (paper.status === 'active' ? '点击刷新建立首次模拟持仓' : '转为观察中后可建立模拟持仓') + '</span></div>';
      return '<section class="paper-row" data-paper-id="' + paper.id + '"><div class="paper-row-head"><div><strong>' + aiResearchEscape(paper.name) + '</strong>' +
          '<span class="muted">' + aiResearchEscape(decisionRiskLabel(paper.riskProfile)) + ' · 资金 ' + aiResearchEscape(Number(paper.capital).toLocaleString('zh-CN')) +
          ' · 股票 ' + aiResearchEscape(quantPercent(invested, 0)) + ' · 现金 ' + aiResearchEscape(quantPercent(paper.cashWeight, 0)) + '</span></div>' +
          '<div class="paper-row-actions"><button type="button" class="small-btn" data-paper-refresh title="用当前行情刷新纸面组合净值"' + (paper.status === 'active' ? '' : ' disabled') + '>刷新净值</button>' +
          '<select class="paper-status-select" data-paper-status aria-label="纸面组合状态"><option value="draft"' + (paper.status === 'draft' ? ' selected' : '') + '>草稿</option>' +
          '<option value="active"' + (paper.status === 'active' ? ' selected' : '') + '>观察中</option><option value="archived"' + (paper.status === 'archived' ? ' selected' : '') + '>已归档</option></select></div></div>' + tracking +
        '<div class="paper-item-grid">' + (paper.items || []).map(function(item) {
          return '<button type="button" class="paper-item" data-quant-code="' + aiResearchEscape(item.code) + '" data-quant-name="' + aiResearchEscape(item.name) + '">' +
            '<span><strong>' + aiResearchEscape(item.name) + '</strong><small>' + aiResearchEscape(item.code) + '</small></span><b>' + aiResearchEscape(quantPercent(item.targetWeight, 1)) + '</b></button>';
        }).join('') + '</div></section>';
    }).join('');
}

async function aiResearchLoadPaperPortfolios() {
  paperPortfolios = await aiResearchApi('/api/paper-portfolios?limit=20');
  aiResearchRenderPaperPortfolios();
}

async function aiResearchBuildDecisionPacket() {
  const button = document.getElementById('buildDecisionPacketBtn');
  const question = document.getElementById('decisionQuestionInput').value.trim();
  button.disabled = true;
  aiResearchSetStatus('decisionPacketStatus', '正在合并模型、筛选和证据...');
  try {
    decisionPacket = await aiResearchApi('/api/decision-packets', {
      method: 'POST',
      body: {
        question: question || undefined,
        riskProfile: document.getElementById('decisionRiskProfileSelect').value,
        maxCandidates: Number(document.getElementById('decisionCandidateLimitInput').value || 12),
        datasetId: document.getElementById('quantDatasetSelect').value,
        sourceIds: aiResearchSelectedSourceIds()
      },
      timeoutMs: 60000
    });
    aiResearchSetStatus('decisionPacketStatus', '已生成：' + decisionPacket.candidates.length + ' 个候选 / ' + decisionPacket.evidence.length + ' 条证据');
    aiResearchRenderDecisionPacket();
  } catch (error) {
    aiResearchSetStatus('decisionPacketStatus', error.message, true);
  } finally {
    button.disabled = false;
  }
}

function aiResearchAnalyzeDecisionPacket() {
  if (!decisionPacket) return;
  window.AIAssistant.open({
    title: 'AI 研究决策包复核',
    summary: decisionPacket.candidates.length + ' 个候选、' + decisionPacket.evidence.length + ' 条证据已整理；保存返回结果后进入研究记录。',
    prompt: decisionPacket.prompt,
    promptStyle: 'default',
    kind: 'decision-packet',
    context: { view: 'aiResearch', researchRunId: decisionPacket.researchRunId },
    onSave: async function(savedResult) {
      await aiResearchApi('/api/research-runs', {
        method: 'POST',
        body: {
          runType: 'decision-analysis',
          modelId: 'chatgpt-handoff',
          status: 'completed',
          title: decisionPacket.question,
          question: decisionPacket.question,
          prompt: decisionPacket.prompt,
          result: savedResult,
          evidence: decisionPacket.evidence,
          request: { packetRunId: decisionPacket.researchRunId, riskProfile: decisionPacket.riskProfile }
        }
      });
      const target = document.getElementById('decisionPacketAnalysis');
      target.style.display = '';
      target.innerHTML = '<h3>ChatGPT 复核结果</h3><pre>' + aiResearchEscape(savedResult) + '</pre>';
    }
  });
}

async function aiResearchCreatePaperPortfolio() {
  if (!decisionPacket) return;
  const button = document.getElementById('createPaperPortfolioBtn');
  button.disabled = true;
  try {
    const paper = await aiResearchApi('/api/paper-portfolios', {
      method: 'POST',
      body: {
        packet: decisionPacket,
        riskProfile: document.getElementById('decisionRiskProfileSelect').value,
        capital: Number(document.getElementById('paperCapitalInput').value || 100000),
        constraints: {
          maxPositions: Number(document.getElementById('paperMaxPositionsInput').value || 8),
          maxSingleWeight: Number(document.getElementById('paperMaxWeightInput').value || 15) / 100,
          cashReserve: Number(document.getElementById('paperCashReserveInput').value || 20) / 100,
          minSignalCount: 1
        }
      }
    });
    await aiResearchLoadPaperPortfolios();
    aiResearchSetStatus('decisionPacketStatus', '纸面组合“' + paper.name + '”已建立为草稿。');
  } catch (error) {
    aiResearchSetStatus('decisionPacketStatus', error.message, true);
  } finally {
    button.disabled = false;
  }
}

function aiResearchRenderQuant() {
  aiResearchRenderQuantRuntime();
  aiResearchRenderQuantDatasets();
  aiResearchRenderQuantJob();
  aiResearchRenderQuantResult();
  aiResearchRenderFactorLab();
}

async function aiResearchLoadQuant() {
  const values = await Promise.all([
    aiResearchApi('/api/quant/runtime'),
    aiResearchApi('/api/quant/datasets?limit=30'),
    aiResearchApi('/api/quant/results?limit=20'),
    aiResearchApi('/api/quant/factor-labs?limit=20'),
    aiResearchApi('/api/quant/jobs?limit=30')
  ]);
  quantRuntime = values[0];
  quantDatasets = values[1];
  quantResults = values[2];
  quantFactorResults = values[3];
  quantJobs = values[4];
  aiResearchRenderQuant();
  const active = aiResearchActiveQuantJob();
  if (active) aiResearchScheduleQuantPoll();
}

function aiResearchScheduleQuantPoll() {
  if (quantPollTimer) clearTimeout(quantPollTimer);
  quantPollTimer = setTimeout(async function poll() {
    try {
      await aiResearchLoadQuant();
      if (!aiResearchActiveQuantJob()) await aiResearchLoadModels();
    } catch (error) {
      aiResearchSetStatus('quantJobStatus', error.message, true);
    }
  }, 1800);
}

async function aiResearchStartQuant(path, body) {
  const job = await aiResearchApi(path, { method: 'POST', body: body || {}, timeoutMs: 30000 });
  quantJobs.unshift(job);
  aiResearchRenderQuantJob();
  aiResearchScheduleQuantPoll();
}

function aiResearchRenderSourceOptions() {
  const select = document.getElementById('knowledgeSourceFilter');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '<option value="">全部来源</option>' + aiResearchSources.map(function(source) {
    return '<option value="' + source.id + '">' + aiResearchEscape(source.title) + (source.author ? ' · ' + aiResearchEscape(source.author) : '') + '</option>';
  }).join('');
  if (aiResearchSources.some(function(source) { return String(source.id) === previous; })) select.value = previous;
}

function aiResearchRenderSources() {
  const target = document.getElementById('knowledgeSourceList');
  if (!target) return;
  document.getElementById('knowledgeSourceCount').textContent = aiResearchSources.length + ' 个来源';
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  aiResearchRenderSourceOptions();
  if (!aiResearchSources.length) {
    target.innerHTML = '<div class="empty-state compact">尚未录入专家资料。</div>';
    return;
  }
  target.innerHTML = aiResearchSources.map(function(source) {
    const tags = (source.tags || []).concat(source.sectors || []).slice(0, 8);
    const meta = [AI_RESEARCH_SOURCE_LABELS[source.sourceType] || source.sourceType, source.author, source.publishedAt].filter(Boolean).join(' · ');
    return '<article class="knowledge-source-row" data-source-id="' + source.id + '">' +
      '<div class="knowledge-source-main"><strong>' + aiResearchEscape(source.title) + '</strong>' +
        '<div class="muted">' + aiResearchEscape(meta) + '</div>' +
        '<div class="knowledge-source-metrics">' + source.chunkCount + ' 个证据块 · ' + source.characterCount + ' 字</div>' +
        (tags.length ? '<div class="tag-row">' + tags.map(function(tag) { return '<span class="factor-tag">' + aiResearchEscape(tag) + '</span>'; }).join('') + '</div>' : '') +
      '</div>' +
      '<div class="knowledge-source-actions">' +
        '<button class="small-btn" data-knowledge-action="use">限定</button>' +
        '<button class="small-btn" data-knowledge-action="edit">编辑</button>' +
        '<button class="small-btn danger" data-knowledge-action="delete">删除</button>' +
      '</div>' +
    '</article>';
  }).join('');
}

function aiResearchClearSourceForm() {
  aiResearchEditingSourceId = null;
  document.getElementById('knowledgeSourceType').value = 'blog';
  ['knowledgeSourceTitle', 'knowledgeSourceAuthor', 'knowledgeSourcePublishedAt', 'knowledgeSourceUrl',
    'knowledgeSourceTags', 'knowledgeSourceStocks', 'knowledgeSourceSectors', 'knowledgeSourceContent']
    .forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('saveKnowledgeSourceBtn').textContent = '保存来源';
  aiResearchSetStatus('knowledgeSourceStatus', '');
}

function aiResearchSourceBody() {
  return {
    sourceType: document.getElementById('knowledgeSourceType').value,
    title: document.getElementById('knowledgeSourceTitle').value.trim(),
    author: document.getElementById('knowledgeSourceAuthor').value.trim(),
    publishedAt: document.getElementById('knowledgeSourcePublishedAt').value,
    sourceUrl: document.getElementById('knowledgeSourceUrl').value.trim(),
    tags: document.getElementById('knowledgeSourceTags').value,
    stockCodes: document.getElementById('knowledgeSourceStocks').value,
    sectors: document.getElementById('knowledgeSourceSectors').value,
    content: document.getElementById('knowledgeSourceContent').value
  };
}

async function aiResearchSaveSource() {
  const button = document.getElementById('saveKnowledgeSourceBtn');
  const editing = aiResearchEditingSourceId;
  button.disabled = true;
  aiResearchSetStatus('knowledgeSourceStatus', editing ? '正在更新...' : '正在建立索引...');
  try {
    const saved = await aiResearchApi('/api/knowledge/sources' + (editing ? '/' + editing : ''), {
      method: editing ? 'PUT' : 'POST',
      body: aiResearchSourceBody(),
      timeoutMs: 30000
    });
    aiResearchSetStatus('knowledgeSourceStatus', saved.duplicate ? '相同正文已经存在，未重复导入。' : '已保存并建立 ' + saved.chunkCount + ' 个证据块。');
    aiResearchClearSourceForm();
    await aiResearchLoadSources();
  } catch (error) {
    aiResearchSetStatus('knowledgeSourceStatus', error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function aiResearchEditSource(id) {
  const source = await aiResearchApi('/api/knowledge/sources/' + id);
  aiResearchEditingSourceId = source.id;
  document.getElementById('knowledgeSourceType').value = source.sourceType;
  document.getElementById('knowledgeSourceTitle').value = source.title || '';
  document.getElementById('knowledgeSourceAuthor').value = source.author || '';
  document.getElementById('knowledgeSourcePublishedAt').value = String(source.publishedAt || '').slice(0, 10);
  document.getElementById('knowledgeSourceUrl').value = source.sourceUrl || '';
  document.getElementById('knowledgeSourceTags').value = (source.tags || []).join(', ');
  document.getElementById('knowledgeSourceStocks').value = (source.stockCodes || []).join(', ');
  document.getElementById('knowledgeSourceSectors').value = (source.sectors || []).join(', ');
  document.getElementById('knowledgeSourceContent').value = source.content || '';
  document.getElementById('saveKnowledgeSourceBtn').textContent = '更新来源';
  aiResearchSetStatus('knowledgeSourceStatus', '正在编辑：' + source.title);
  document.getElementById('knowledgeSourceTitle').focus();
}

async function aiResearchDeleteSource(id) {
  const source = aiResearchSources.find(function(item) { return item.id === Number(id); });
  if (!confirm('删除知识来源“' + (source ? source.title : id) + '”及其全部证据块？')) return;
  await aiResearchApi('/api/knowledge/sources/' + id, { method: 'DELETE' });
  if (aiResearchEditingSourceId === Number(id)) aiResearchClearSourceForm();
  await aiResearchLoadSources();
  aiResearchSetStatus('knowledgeSourceStatus', '知识来源已删除。');
}

function aiResearchRenderEvidence(result) {
  const target = document.getElementById('knowledgeEvidenceResults');
  if (!target) return;
  const items = result && Array.isArray(result.items) ? result.items : [];
  aiResearchSetStatus('knowledgeSearchStatus', items.length ? items.length + ' 个证据块 · ' + (result.engine || '') : '没有匹配证据');
  if (!items.length) {
    target.innerHTML = '<div class="empty-state compact">没有匹配证据。</div>';
    return;
  }
  target.innerHTML = items.map(function(item) {
    const meta = [item.title, item.author, item.publishedAt].filter(Boolean).join(' · ');
    return '<article class="knowledge-evidence-row">' +
      '<div class="knowledge-evidence-id">' + aiResearchEscape(item.evidenceId) + '</div>' +
      '<div><strong>' + aiResearchEscape(meta) + '</strong><p>' + aiResearchEscape(item.content) + '</p>' +
        (item.sourceUrl ? '<a href="' + aiResearchEscape(item.sourceUrl) + '" target="_blank" rel="noopener">打开来源</a>' : '') + '</div>' +
    '</article>';
  }).join('');
}

function aiResearchSelectedSourceIds() {
  const value = document.getElementById('knowledgeSourceFilter').value;
  return value ? [Number(value)] : [];
}

async function aiResearchSearchEvidence() {
  const query = document.getElementById('knowledgeQuestionInput').value.trim();
  if (!query) {
    aiResearchSetStatus('knowledgeSearchStatus', '请先输入研究问题。', true);
    return null;
  }
  aiResearchSetStatus('knowledgeSearchStatus', '正在检索...');
  try {
    const result = await aiResearchApi('/api/knowledge/search', {
      method: 'POST',
      body: { query, sourceIds: aiResearchSelectedSourceIds(), limit: 12 }
    });
    aiResearchRenderEvidence(result);
    return result;
  } catch (error) {
    aiResearchSetStatus('knowledgeSearchStatus', error.message, true);
    return null;
  }
}

function aiResearchRenderDirectResult(result) {
  const target = document.getElementById('knowledgeDirectResult');
  if (!target) return;
  target.style.display = result ? '' : 'none';
  target.innerHTML = result ? '<h3>AI 分析结果</h3><pre>' + aiResearchEscape(result) + '</pre>' : '';
}

async function aiResearchAnalyze(requestOverride, displayOptions) {
  const button = document.getElementById('analyzeKnowledgeBtn');
  const hasOverride = requestOverride && typeof requestOverride === 'object' && !requestOverride.preventDefault;
  const question = hasOverride
    ? String(requestOverride.question || '').trim()
    : document.getElementById('knowledgeQuestionInput').value.trim();
  if (!question) {
    aiResearchSetStatus('knowledgeSearchStatus', '请先输入研究问题。', true);
    return;
  }
  const request = hasOverride ? requestOverride : {
    question,
    mode: document.getElementById('knowledgeAnalysisMode').value,
    sourceIds: aiResearchSelectedSourceIds(),
    limit: 10
  };
  const display = displayOptions || {};
  if (button) button.disabled = true;
  aiResearchSetStatus('knowledgeSearchStatus', '正在整理证据...');
  try {
    const result = await aiResearchApi('/api/knowledge/analyze', {
      method: 'POST',
      body: request,
      timeoutMs: 120000
    });
    aiResearchRenderEvidence({ items: result.evidence, engine: result.engine });
    if (!result.handoffMode) {
      aiResearchRenderDirectResult(result.report || '');
      await aiResearchLoadRuns();
      return;
    }
    window.AIAssistant.open({
      title: display.title || '专家知识库分析',
      summary: display.summary || result.evidence.length + ' 个证据块已写入提示词；保存返回结果后会进入研究记录。',
      prompt: result.prompt,
      promptStyle: 'default',
      kind: 'knowledge-analysis',
      context: { view: 'aiResearch', question, mode: result.mode, origin: display.origin || 'knowledge' },
      onSave: async function(savedResult) {
        await aiResearchApi('/api/research-runs', {
          method: 'POST',
          body: {
            runType: 'knowledge-analysis',
            modelId: 'chatgpt-handoff',
            status: 'completed',
            title: question,
            question,
            prompt: result.prompt,
            result: savedResult,
            evidence: result.evidence,
            request: {
              mode: result.mode,
              query: result.query,
              engine: result.engine,
              origin: display.origin || 'knowledge',
              candidateCount: Array.isArray(request.candidateContext) ? request.candidateContext.length : 0
            }
          },
          timeoutMs: 30000
        });
        aiResearchRenderDirectResult(savedResult);
        await aiResearchLoadRuns();
      }
    });
  } catch (error) {
    aiResearchSetStatus('knowledgeSearchStatus', error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function aiResearchReviewScreener(result, candidates) {
  window.switchMainView('aiResearch');
  await aiResearchEnsureLoaded();
  if (!aiResearchSources.length) {
    aiResearchSetStatus('knowledgeSearchStatus', '请先导入至少一份书籍、博主文章、研报或笔记，再运行专家库复核。', true);
    document.getElementById('knowledgeSourceTitle').focus();
    return null;
  }

  const selected = (candidates || []).slice(0, 20);
  if (!selected.length) {
    aiResearchSetStatus('knowledgeSearchStatus', '当前没有可复核的候选股。', true);
    return null;
  }

  const strategy = String(result && result.strategy || 'local-factor').trim();
  const demand = String(result && result.demand || '').trim();
  const question = '请按照专家知识库中的选股框架，复核当前 WebStock 候选股，给出优先观察、等待确认和暂时剔除三组，并逐项引用证据。' +
    (demand ? ' 当前需求：' + demand : '') + ' 策略：' + strategy + '。';
  const searchQuery = [demand, strategy].concat(selected.flatMap(function(item) {
    return [item.code, item.name, item.industry].concat(item.themes || [], item.factorTags || []);
  })).filter(Boolean).join(' ').slice(0, 1000);

  document.getElementById('knowledgeQuestionInput').value = question;
  document.getElementById('knowledgeAnalysisMode').value = 'selection';
  aiResearchRenderDirectResult('');
  return aiResearchAnalyze({
    question,
    searchQuery,
    mode: 'selection',
    sourceIds: aiResearchSelectedSourceIds(),
    candidateContext: selected,
    limit: 10
  }, {
    title: '专家知识库选股复核',
    summary: selected.length + ' 个候选已与知识库证据合并；保存返回结果后会进入研究记录。',
    origin: 'screener'
  });
}

function aiResearchRenderRuns() {
  const target = document.getElementById('knowledgeResearchRuns');
  if (!target) return;
  document.getElementById('knowledgeRunCount').textContent = aiResearchRuns.length + ' 条';
  if (!aiResearchRuns.length) {
    target.innerHTML = '<div class="empty-state compact">尚无专家知识分析记录。</div>';
    return;
  }
  target.innerHTML = aiResearchRuns.map(function(run) {
    const evidenceIds = (run.evidence || []).map(function(item) { return item.evidenceId; }).filter(Boolean).slice(0, 8);
    return '<details class="knowledge-run-row" data-run-id="' + run.id + '">' +
      '<summary><span><strong>' + aiResearchEscape(run.title || run.question || '知识分析') + '</strong>' +
        '<span class="muted">' + aiResearchEscape(run.modelId) + ' · ' + aiResearchEscape(aiResearchDate(run.createdAt)) + '</span></span>' +
        '<button class="small-btn danger" data-run-action="delete" type="button">删除</button></summary>' +
      (evidenceIds.length ? '<div class="knowledge-run-evidence">证据：' + aiResearchEscape(evidenceIds.join(' / ')) + '</div>' : '') +
      '<pre>' + aiResearchEscape(run.result || '尚无结果') + '</pre>' +
    '</details>';
  }).join('');
}

async function aiResearchLoadModels() {
  aiResearchModels = await aiResearchApi('/api/ai-models');
  aiResearchRenderModels();
}

async function aiResearchLoadSources() {
  const input = document.getElementById('knowledgeSourceSearchInput');
  const query = input ? input.value.trim() : '';
  aiResearchSources = await aiResearchApi('/api/knowledge/sources' + (query ? '?query=' + encodeURIComponent(query) : ''));
  aiResearchRenderSources();
}

async function aiResearchLoadRuns() {
  aiResearchRuns = await aiResearchApi('/api/research-runs?runType=knowledge-analysis&limit=30');
  aiResearchRenderRuns();
}

function aiResearchEnsureLoaded(force) {
  if (aiResearchLoading) return aiResearchLoading;
  if (aiResearchLoaded && !force) return Promise.resolve();
  aiResearchLoading = Promise.all([aiResearchLoadModels(), aiResearchLoadSources(), aiResearchLoadRuns(), aiResearchLoadQuant(), aiResearchLoadPaperPortfolios()])
    .then(function() { aiResearchLoaded = true; })
    .finally(function() { aiResearchLoading = null; });
  return aiResearchLoading;
}

function aiResearchBind() {
  if (aiResearchBound) return;
  aiResearchBound = true;
  document.getElementById('refreshAiResearchBtn').addEventListener('click', function() {
    aiResearchEnsureLoaded(true).catch(function(error) { alert(error.message); });
  });
  document.getElementById('buildDecisionPacketBtn').addEventListener('click', aiResearchBuildDecisionPacket);
  document.getElementById('analyzeDecisionPacketBtn').addEventListener('click', aiResearchAnalyzeDecisionPacket);
  document.getElementById('createPaperPortfolioBtn').addEventListener('click', aiResearchCreatePaperPortfolio);
  document.getElementById('decisionRiskProfileSelect').addEventListener('change', function() {
    const defaults = {
      conservative: [8, 10, 30],
      balanced: [8, 15, 20],
      aggressive: [10, 20, 10]
    }[this.value] || [8, 15, 20];
    document.getElementById('paperMaxPositionsInput').value = defaults[0];
    document.getElementById('paperMaxWeightInput').value = defaults[1];
    document.getElementById('paperCashReserveInput').value = defaults[2];
  });
  document.getElementById('decisionPacketPanel').addEventListener('dblclick', function(event) {
    const row = event.target.closest('[data-quant-code]');
    if (!row || !window.StockList || !window.StockList.selectStock) return;
    window.StockList.selectStock({ code: row.getAttribute('data-quant-code'), name: row.getAttribute('data-quant-name') })
      .catch(function(error) { alert(error.message); });
  });
  document.getElementById('paperPortfolioPanel').addEventListener('change', function(event) {
    const select = event.target.closest('[data-paper-status]');
    const row = event.target.closest('[data-paper-id]');
    if (!select || !row) return;
    aiResearchApi('/api/paper-portfolios/' + row.getAttribute('data-paper-id') + '/status', {
      method: 'PUT', body: { status: select.value }
    }).then(aiResearchLoadPaperPortfolios).catch(function(error) { alert(error.message); });
  });
  document.getElementById('paperPortfolioPanel').addEventListener('click', function(event) {
    const button = event.target.closest('[data-paper-refresh]');
    const row = event.target.closest('[data-paper-id]');
    if (!button || !row) return;
    button.disabled = true;
    aiResearchApi('/api/paper-portfolios/' + row.getAttribute('data-paper-id') + '/refresh', {
      method: 'POST', timeoutMs: 20000
    }).then(function() {
      return aiResearchLoadPaperPortfolios();
    }).catch(function(error) {
      alert(error.message);
      button.disabled = false;
    });
  });
  document.getElementById('paperPortfolioPanel').addEventListener('dblclick', function(event) {
    const item = event.target.closest('[data-quant-code]');
    if (!item || !window.StockList || !window.StockList.selectStock) return;
    window.StockList.selectStock({ code: item.getAttribute('data-quant-code'), name: item.getAttribute('data-quant-name') })
      .catch(function(error) { alert(error.message); });
  });
  document.getElementById('saveKnowledgeSourceBtn').addEventListener('click', aiResearchSaveSource);
  document.getElementById('verifyQuantRuntimeBtn').addEventListener('click', async function() {
    this.disabled = true;
    try {
      quantRuntime = await aiResearchApi('/api/quant/runtime?verify=1', { timeoutMs: 120000 });
      aiResearchRenderQuantRuntime();
      await aiResearchLoadModels();
    } catch (error) {
      alert(error.message);
    } finally {
      this.disabled = false;
    }
  });
  document.getElementById('linkQuantRuntimeBtn').addEventListener('click', function() {
    aiResearchLinkQuantRuntime(this).catch(function(error) { alert(error.message); });
  });
  document.getElementById('installQuantRuntimeBtn').addEventListener('click', function() {
    const bytes = quantRuntime && quantRuntime.installer && Number(quantRuntime.installer.estimatedBytes || 0);
    const size = bytes > 0 ? (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB' : '较大';
    if (!confirm('将下载并安装约 ' + size + ' 的独立量化环境。安装目录位于 WebStock 数据目录，不修改系统 Python。继续？')) return;
    aiResearchStartQuant('/api/quant/runtime/install', {
      indexMode: document.getElementById('quantIndexModeSelect').value,
      force: false
    }).catch(function(error) { alert(error.message); });
  });
  document.getElementById('repairQuantRuntimeBtn').addEventListener('click', function() {
    if (!confirm('修复会先完整验证新环境，再替换现有量化环境。当前数据集和模型结果不会删除。继续？')) return;
    aiResearchStartQuant('/api/quant/runtime/install', {
      indexMode: document.getElementById('quantIndexModeSelect').value,
      force: true
    }).catch(function(error) { alert(error.message); });
  });
  document.getElementById('runQuantPilotBtn').addEventListener('click', function() {
    aiResearchStartQuant('/api/quant/pilot', {
      startDate: document.getElementById('quantStartDateInput').value,
      limit: Number(document.getElementById('quantPilotLimitInput').value || 30),
      model: document.getElementById('quantModelSelect').value
    }).catch(function(error) { alert(error.message); });
  });
  document.getElementById('collectQuantMarketBtn').addEventListener('click', function() {
    if (!confirm('全市场公开日线同步可能持续较长时间并产生较大的本地数据文件，继续启动？')) return;
    aiResearchStartQuant('/api/quant/datasets/collect', {
      startDate: document.getElementById('quantStartDateInput').value,
      limit: 5510
    }).catch(function(error) { alert(error.message); });
  });
  document.getElementById('runQuantDatasetBtn').addEventListener('click', function() {
    const datasetId = document.getElementById('quantDatasetSelect').value;
    if (!datasetId) return alert('请先选择一个数据集。');
    aiResearchStartQuant('/api/quant/runs', {
      datasetId: datasetId,
      model: document.getElementById('quantModelSelect').value
    }).catch(function(error) { alert(error.message); });
  });
  document.getElementById('runFactorLabBtn').addEventListener('click', function() {
    const datasetId = document.getElementById('quantDatasetSelect').value;
    if (!datasetId) return alert('请先选择一个数据集。');
    aiResearchStartQuant('/api/quant/factor-labs', { datasetId: datasetId })
      .catch(function(error) { alert(error.message); });
  });
  document.getElementById('runResearchSuiteBtn').addEventListener('click', function() {
    const datasetId = document.getElementById('quantDatasetSelect').value;
    if (!datasetId) return alert('请先同步或选择一个全市场数据集。');
    if (!confirm('将依次运行 LightGBM、因子样本外门禁和受控股票池 MASTER。任务可能持续数小时，继续？')) return;
    aiResearchStartQuant('/api/quant/research-suite', { datasetId: datasetId })
      .catch(function(error) { alert(error.message); });
  });
  document.getElementById('quantDatasetSelect').addEventListener('change', aiResearchRenderFactorLab);
  document.getElementById('quantModelSelect').addEventListener('change', aiResearchRenderQuantResult);
  document.getElementById('cancelQuantJobBtn').addEventListener('click', async function() {
    const active = aiResearchActiveQuantJob();
    if (!active || !confirm('停止当前量化任务？已写入的数据文件会保留用于排查。')) return;
    await aiResearchApi('/api/quant/jobs/' + encodeURIComponent(active.id), { method: 'DELETE' });
    await aiResearchLoadQuant();
  });
  document.getElementById('quantResultPanel').addEventListener('dblclick', function(event) {
    const row = event.target.closest('[data-quant-code]');
    if (!row || !window.StockList || !window.StockList.selectStock) return;
    window.StockList.selectStock({
      code: row.getAttribute('data-quant-code'),
      name: row.getAttribute('data-quant-name')
    }).catch(function(error) { alert(error.message); });
  });
  document.getElementById('factorLabPanel').addEventListener('dblclick', function(event) {
    const row = event.target.closest('[data-quant-code]');
    if (!row || !window.StockList || !window.StockList.selectStock) return;
    window.StockList.selectStock({ code: row.getAttribute('data-quant-code'), name: row.getAttribute('data-quant-name') })
      .catch(function(error) { alert(error.message); });
  });
  document.getElementById('clearKnowledgeSourceBtn').addEventListener('click', aiResearchClearSourceForm);
  document.getElementById('importKnowledgeTextBtn').addEventListener('click', function() {
    document.getElementById('knowledgeTextFileInput').click();
  });
  document.getElementById('knowledgeTextFileInput').addEventListener('change', async function() {
    const file = this.files && this.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      aiResearchSetStatus('knowledgeSourceStatus', '文本文件不能超过 5 MB。', true);
      this.value = '';
      return;
    }
    const content = await file.text();
    document.getElementById('knowledgeSourceContent').value = content;
    const title = document.getElementById('knowledgeSourceTitle');
    if (!title.value.trim()) title.value = file.name.replace(/\.(txt|md)$/i, '');
    aiResearchSetStatus('knowledgeSourceStatus', '已读取 ' + file.name + '，确认来源信息后保存。');
    this.value = '';
  });
  let sourceSearchTimer = null;
  document.getElementById('knowledgeSourceSearchInput').addEventListener('input', function() {
    if (sourceSearchTimer) clearTimeout(sourceSearchTimer);
    sourceSearchTimer = setTimeout(function() {
      aiResearchLoadSources().catch(function(error) { aiResearchSetStatus('knowledgeSourceStatus', error.message, true); });
    }, 180);
  });
  document.getElementById('knowledgeSourceList').addEventListener('click', function(event) {
    const button = event.target.closest('[data-knowledge-action]');
    const row = event.target.closest('[data-source-id]');
    if (!button || !row) return;
    const id = Number(row.getAttribute('data-source-id'));
    const action = button.getAttribute('data-knowledge-action');
    if (action === 'use') {
      document.getElementById('knowledgeSourceFilter').value = String(id);
      document.getElementById('knowledgeQuestionInput').focus();
    }
    if (action === 'edit') aiResearchEditSource(id).catch(function(error) { aiResearchSetStatus('knowledgeSourceStatus', error.message, true); });
    if (action === 'delete') aiResearchDeleteSource(id).catch(function(error) { aiResearchSetStatus('knowledgeSourceStatus', error.message, true); });
  });
  document.getElementById('searchKnowledgeBtn').addEventListener('click', aiResearchSearchEvidence);
  document.getElementById('analyzeKnowledgeBtn').addEventListener('click', aiResearchAnalyze);
  document.getElementById('knowledgeResearchRuns').addEventListener('click', function(event) {
    const button = event.target.closest('[data-run-action="delete"]');
    if (!button) return;
    event.preventDefault();
    const row = button.closest('[data-run-id]');
    if (!row || !confirm('删除这条研究记录？')) return;
    aiResearchApi('/api/research-runs/' + row.getAttribute('data-run-id'), { method: 'DELETE' })
      .then(aiResearchLoadRuns)
      .catch(function(error) { alert(error.message); });
  });
}

window.AIResearch = {
  bind: aiResearchBind,
  ensureLoaded: aiResearchEnsureLoaded,
  reload: function() { return aiResearchEnsureLoaded(true); },
  reviewScreener: aiResearchReviewScreener,
  getSourceCount: function() { return aiResearchSources.length; }
};
