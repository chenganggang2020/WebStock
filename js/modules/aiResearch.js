let aiResearchSources = [];
let aiResearchModels = [];
let aiResearchRuns = [];
let aiResearchGptPickImports = [];
let aiResearchEditingSourceId = null;
let aiResearchLoaded = false;
let aiResearchLoading = null;
let aiResearchModelLoading = null;
let aiResearchBound = false;
let quantRuntime = null;
let quantWatchlistGroups = { available: false, groups: [] };
let quantDatasets = [];
let quantResults = [];
let quantFactorResults = [];
let quantStrategyResults = [];
let quantSignalReadiness = null;
let quantSignalScans = [];
let quantStrategyDailyReport = null;
let quantStrategyDailySchedule = null;
let quantJobs = [];
let quantPollTimer = null;
let strategyDailyScheduleTimer = null;
let decisionPacket = null;
let paperPortfolios = [];
let paperMonitorStates = new Map();

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
  'strategy-lab': '批量策略研究',
  'signal-scan': '全市场模型选股',
  'strategy-daily': '每日四策略研究',
  'watchlist-research': '同花顺自选量化研究',
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

const STRATEGY_FAMILY_LABELS = {
  'moving-average-crossover': '均线交叉',
  'macd-crossover': 'MACD交叉',
  'rsi-rebound': 'RSI超卖反弹',
  'volume-breakout': '放量突破',
  'low-position-volume-stagnation': '低位放量滞涨'
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

function quantVerificationText(entry) {
  const verification = entry && entry.verification;
  if (!verification) return '结果文件校验状态未提供';
  const checkedAt = verification.checkedAt ? ' · 检查于 ' + aiResearchDate(verification.checkedAt) : '';
  if (verification.status === 'hash_verified' && verification.hashesVerified === true) {
    return '结果文件：完整内容哈希校验通过' + checkedAt;
  }
  if (verification.status === 'metadata_valid' && verification.hashesVerified === false) {
    return '结果文件：结果契约、数据清单自身哈希与结果制品存在性校验通过；未读取数据集文件，也未重算内容哈希' + checkedAt;
  }
  if (verification.status === 'hash_failed') return '结果文件：完整内容哈希校验失败' + checkedAt;
  if (verification.status === 'metadata_invalid') return '结果文件：元数据校验失败' + checkedAt;
  return '结果文件校验：' + String(verification.status || '未知') + checkedAt;
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
    'Public unadjusted daily data cannot support production factor approval.': '公开未复权日线不足以支持生产级因子批准。',
    'This is an exploratory rule-card backtest and does not place or recommend orders.': '这是探索性规则卡回测，不会下单，也不构成股票推荐。',
    'Signals use close information and can execute no earlier than the next trading-day open.': '信号使用收盘信息，最早只能在下一交易日开盘执行。',
    'Price-limit, suspension, T+1, lot size, fees, tax and slippage are modeled assumptions, not broker fills.': '涨跌停、停牌、T+1、整手、佣金、税费和滑点均为模型假设，不是券商真实成交。',
    'Current-list and unadjusted public data can contain survivorship and corporate-action bias.': '当前成分列表和公开未复权数据可能含幸存者偏差与除权偏差。',
    'The highest-ranked parameter is historical sample-out evidence, not a future-profit claim.': '排名最高参数只是历史样本外证据，不代表未来盈利。'
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

function aiResearchRenderWatchlistGroups() {
  const select = document.getElementById('quantWatchlistGroupSelect');
  const meta = document.getElementById('quantWatchlistGroupMeta');
  const runButton = document.getElementById('runWatchlistResearchBtn');
  if (!select || !meta) return;
  const groups = Array.isArray(quantWatchlistGroups && quantWatchlistGroups.groups)
    ? quantWatchlistGroups.groups : [];
  const previous = select.value;
  select.innerHTML = groups.length ? groups.map(function(group) {
    const eligible = Number(group.count) >= 8 && Number(group.count) <= 120;
    return '<option value="' + aiResearchEscape(group.id) + '"' + (eligible ? '' : ' disabled') + '>' +
      aiResearchEscape(group.name + ' · ' + group.count + '只' + (eligible ? '' : '（需8—120只）')) + '</option>';
  }).join('') : '<option value="">未找到可读的同花顺分组</option>';
  if (groups.some(function(group) { return String(group.id) === previous; })) select.value = previous;
  else if (groups.some(function(group) { return group.id === 'default-self-stock'; })) select.value = 'default-self-stock';
  const selected = groups.find(function(group) { return String(group.id) === select.value; });
  const sourcePath = selected && selected.sourcePath || quantWatchlistGroups.cachePath || '';
  meta.innerHTML = selected
    ? '<strong>' + aiResearchEscape(selected.count + '只证券') + '</strong><span title="' + aiResearchEscape(sourcePath) + '">来源：' + aiResearchEscape(sourcePath) + '</span>' +
      (quantWatchlistGroups.fileUpdatedAt ? '<span>文件更新：' + aiResearchEscape(aiResearchDate(quantWatchlistGroups.fileUpdatedAt)) + '</span>' : '')
    : aiResearchEscape(quantWatchlistGroups.error || '没有符合范围的同花顺本地分组。');
  if (runButton) runButton.disabled = !selected || Number(selected.count) < 8 || Number(selected.count) > 120 || !!aiResearchActiveQuantJob();
}

function aiResearchLatestWatchlistJob() {
  return quantJobs.find(function(job) { return job.kind === 'watchlist-research'; }) || null;
}

function aiResearchOpenQuantCandidate(event) {
  const row = event.target.closest('[data-quant-code]');
  if (!row || !window.StockList || !window.StockList.selectStock) return;
  if (window.switchMainView) window.switchMainView('market');
  window.StockList.selectStock({
    code: row.getAttribute('data-quant-code'),
    name: row.getAttribute('data-quant-name')
  }).catch(function(error) { alert(error.message); });
}

function aiResearchRenderWatchlistResearch() {
  const target = document.getElementById('watchlistResearchPanel');
  const analyze = document.getElementById('analyzeWatchlistResearchBtn');
  if (!target) return;
  const job = aiResearchLatestWatchlistJob();
  const output = job && job.output;
  if (analyze) analyze.disabled = !(job && job.status === 'completed' && output && output.handoffPrompt);
  if (!job) {
    target.innerHTML = '<div class="empty-state compact">请选择同花顺分组后运行；没有合格候选时会明确显示为空。</div>';
    return;
  }
  if (!output) {
    const progress = job.progress || {};
    target.innerHTML = '<div class="watchlist-research-running"><strong>' + aiResearchEscape(
      QUANT_JOB_STATUS_LABELS[job.status] || job.status
    ) + '</strong><span>' + aiResearchEscape(progress.message || job.error || '等待任务输出。') + '</span></div>';
    return;
  }
  const manifest = output.manifest || {};
  const coverage = manifest.coverage || {};
  const report = output.report || {};
  const comparisons = Array.isArray(report.comparisons) ? report.comparisons : [];
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  const preview = output.recommendationPreview || {};
  target.innerHTML = '<div class="watchlist-research-summary">' +
      '<span>分组 <strong>' + aiResearchEscape(output.group && output.group.name || '--') + '</strong></span>' +
      '<span>截止 <strong>' + aiResearchEscape(output.asOf || manifest.asOf || '--') + '</strong></span>' +
      '<span>口径 <strong>' + aiResearchEscape(manifest.adjustmentMode === 'forward-adjusted' ? '前复权' : manifest.adjustmentMode || '--') + '</strong></span>' +
      '<span>覆盖 <strong>' + aiResearchEscape((coverage.succeeded || 0) + '/' + (coverage.requested || 0)) + '</strong></span>' +
      '<span>候选 <strong>' + aiResearchEscape(report.candidateCount || 0) + '</strong></span><span>自动交易 <strong>关闭</strong></span></div>' +
    '<div class="watchlist-local-summary">' + aiResearchEscape(output.localSummary || '').replace(/\n/g, '<br>') + '</div>' +
    '<div class="table-scroll compact-scroll"><table class="data-table watchlist-strategy-table"><thead><tr>' +
      '<th>策略</th><th>历史最佳参数</th><th>稳定参数</th><th>样本外中位数</th><th>正收益窗口</th><th>最大回撤</th><th>当前候选</th>' +
      '</tr></thead><tbody>' + comparisons.map(function(comparison) {
        const metrics = comparison.selectedWalkForward || {};
        return '<tr><td><strong>' + aiResearchEscape(comparison.label || comparison.strategyFamily) + '</strong></td>' +
          '<td>' + aiResearchEscape(comparison.bestParameterLabel || comparison.bestParameterId || '--') + '</td>' +
          '<td>' + aiResearchEscape(comparison.stableParameterCount || 0) + '</td>' +
          '<td class="' + quantMetricClass(metrics.medianOosReturn) + '">' + aiResearchEscape(quantPercent(metrics.medianOosReturn)) + '</td>' +
          '<td>' + aiResearchEscape(quantPercent(metrics.positiveFoldRate, 0)) + '</td>' +
          '<td class="' + quantMetricClass(metrics.maxDrawdown) + '">' + aiResearchEscape(quantPercent(metrics.maxDrawdown)) + '</td>' +
          '<td>' + aiResearchEscape(comparison.candidateCount || 0) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
    (candidates.length ? '<div class="watchlist-candidate-grid">' + candidates.map(function(candidate) {
      return '<button type="button" class="watchlist-candidate" data-quant-code="' + aiResearchEscape(candidate.code) + '" data-quant-name="' + aiResearchEscape(candidate.name) + '">' +
        '<strong>' + aiResearchEscape(candidate.name) + '</strong><span>' + aiResearchEscape(candidate.code) + '</span>' +
        '<small>稳定 ' + aiResearchEscape(candidate.stableFamilyCount || 0) + ' · 共识 ' + aiResearchEscape(candidate.consensusCount || 0) + '</small></button>';
    }).join('') + '</div>' : '<div class="strategy-daily-empty">本次没有满足样本外门槛并在最近收盘触发的候选；没有使用被淘汰参数补足数量。</div>') +
    '<div class="watchlist-recommendation-preview"><strong>同花顺荐股预览：</strong>' + aiResearchEscape(
      preview.groupName ? preview.groupName + ' · 精选 ' + (preview.items || []).length + '只' +
        (preview.truncated ? '（完整研究候选 ' + (preview.totalCandidateCount || candidates.length) + '只）' : '') + ' · ' + preview.reason : preview.reason || '尚无预览'
    ) + '</div>' +
    '<details class="quant-warning-block"><summary>数据限制与失败项</summary><ul>' +
      (manifest.warnings || []).concat((manifest.failures || []).map(function(failure) {
        return failure.code + '：' + failure.reason;
      })).map(function(warning) { return '<li>' + aiResearchEscape(quantWarningText(warning)) + '</li>'; }).join('') + '</ul></details>';
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
    const invalidEntry = quantResults.find(function(item) { return item && item.valid === false; });
    target.innerHTML = '<div class="empty-state compact">尚无通过契约校验的量化结果。' +
      (invalidEntry ? '<div class="muted">' + aiResearchEscape(quantVerificationText(invalidEntry) + (invalidEntry.error ? '：' + invalidEntry.error : '')) + '</div>' : '') +
      '</div>';
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
      aiResearchEscape(result.dataManifest.datasetId) + '</div>' +
      '<div class="muted quant-verification-note">' + aiResearchEscape(quantVerificationText(entry)) + '</div></div>' +
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
    const invalidEntry = quantFactorResults.find(function(item) { return item && item.valid === false; });
    target.innerHTML = '<div class="panel-title-row"><h3>因子样本外体检</h3><span class="muted">选择数据集后运行，不会修改模型结果</span></div>' +
      '<div class="empty-state compact">尚无通过契约校验的因子实验。' +
        (invalidEntry ? '<div class="muted">' + aiResearchEscape(quantVerificationText(invalidEntry) + (invalidEntry.error ? '：' + invalidEntry.error : '')) + '</div>' : '') +
      '</div>';
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
    '<div class="muted quant-verification-note">' + aiResearchEscape(quantVerificationText(entry)) + '</div>' +
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

function aiResearchSyncStrategyFamilyFields() {
  const select = document.getElementById('strategyFamilySelect');
  const family = select ? select.value : 'moving-average-crossover';
  document.querySelectorAll('[data-strategy-family-fields]').forEach(function(group) {
    group.classList.toggle('active', group.dataset.strategyFamilyFields === family);
  });
}

function aiResearchSetStrategyList(id, values) {
  const input = document.getElementById(id);
  if (input && Array.isArray(values) && values.length) input.value = values.join(',');
}

function aiResearchRenderStrategyRulePreview(rule, error) {
  const target = document.getElementById('strategyRulePreview');
  if (!target) return;
  target.classList.toggle('is-error', !!error);
  if (error) {
    target.textContent = error;
    return;
  }
  if (!rule) {
    target.textContent = '尚未解析；也可以直接选择下方规则卡。';
    return;
  }
  const defaults = (rule.defaultedFields || []).length
    ? ' · 默认参数：' + rule.defaultedFields.join('、')
    : ' · 参数均来自原描述';
  target.innerHTML = '<strong>' + aiResearchEscape(rule.label || STRATEGY_FAMILY_LABELS[rule.strategyFamily] || rule.strategyFamily) + '</strong>' +
    ' · ' + aiResearchEscape(rule.parameterCombinationCount) + ' 组参数' + aiResearchEscape(defaults) +
    '<div>入场：' + aiResearchEscape(rule.entryRule) + '</div>' +
    '<div>退出：' + aiResearchEscape(rule.exitRule) + '</div>' +
    '<div class="muted">本地白名单解析 · 自动交易关闭</div>';
}

function aiResearchApplyStrategyRule(rule) {
  const familySelect = document.getElementById('strategyFamilySelect');
  if (familySelect) familySelect.value = rule.strategyFamily;
  const parameters = rule.parameters || {};
  aiResearchSetStrategyList('strategyShortWindowsInput', parameters.shortWindows);
  aiResearchSetStrategyList('strategyLongWindowsInput', parameters.longWindows);
  aiResearchSetStrategyList('strategyMacdFastWindowsInput', parameters.fastWindows);
  aiResearchSetStrategyList('strategyMacdSlowWindowsInput', parameters.slowWindows);
  aiResearchSetStrategyList('strategyMacdSignalWindowsInput', parameters.signalWindows);
  aiResearchSetStrategyList('strategyRsiPeriodsInput', parameters.rsiPeriods);
  aiResearchSetStrategyList('strategyRsiEntryThresholdsInput', parameters.entryThresholds);
  aiResearchSetStrategyList('strategyRsiExitThresholdsInput', parameters.exitThresholds);
  aiResearchSetStrategyList('strategyBreakoutWindowsInput', parameters.breakoutWindows);
  aiResearchSetStrategyList('strategyVolumeMultipliersInput', parameters.volumeMultipliers);
  aiResearchSetStrategyList('strategyBreakoutMarginsInput', parameters.breakoutMargins);
  aiResearchSetStrategyList('strategyBreakoutCloseLocationsInput', parameters.breakoutMinCloseLocations);
  aiResearchSetStrategyList('strategyPositionLookbackWindowsInput', parameters.positionLookbackWindows);
  aiResearchSetStrategyList('strategyMaxRangePositionsInput', parameters.maxRangePositions);
  aiResearchSetStrategyList('strategyVolumeWindowsInput', parameters.volumeWindows);
  aiResearchSetStrategyList('strategyStagnationVolumeMultipliersInput', parameters.volumeMultipliers);
  aiResearchSetStrategyList('strategyMaxAbsReturnsInput', parameters.maxAbsReturns);
  aiResearchSetStrategyList('strategyMaxIntradayRangesInput', parameters.maxIntradayRanges);
  aiResearchSetStrategyList('strategyMinCloseLocationsInput', parameters.minCloseLocations);
  aiResearchSyncStrategyFamilyFields();
  aiResearchRenderStrategyRulePreview(rule);
}

function aiResearchStrategyPayload() {
  const family = document.getElementById('strategyFamilySelect').value;
  const payload = { strategyFamily: family, automaticTrading: false };
  if (family === 'moving-average-crossover') {
    payload.shortWindows = document.getElementById('strategyShortWindowsInput').value;
    payload.longWindows = document.getElementById('strategyLongWindowsInput').value;
  } else if (family === 'macd-crossover') {
    payload.fastWindows = document.getElementById('strategyMacdFastWindowsInput').value;
    payload.slowWindows = document.getElementById('strategyMacdSlowWindowsInput').value;
    payload.signalWindows = document.getElementById('strategyMacdSignalWindowsInput').value;
  } else if (family === 'rsi-rebound') {
    payload.rsiPeriods = document.getElementById('strategyRsiPeriodsInput').value;
    payload.entryThresholds = document.getElementById('strategyRsiEntryThresholdsInput').value;
    payload.exitThresholds = document.getElementById('strategyRsiExitThresholdsInput').value;
  } else if (family === 'volume-breakout') {
    payload.breakoutWindows = document.getElementById('strategyBreakoutWindowsInput').value;
    payload.volumeMultipliers = document.getElementById('strategyVolumeMultipliersInput').value;
    payload.breakoutMargins = document.getElementById('strategyBreakoutMarginsInput').value;
    payload.breakoutMinCloseLocations = document.getElementById('strategyBreakoutCloseLocationsInput').value;
  } else {
    payload.positionLookbackWindows = document.getElementById('strategyPositionLookbackWindowsInput').value;
    payload.maxRangePositions = document.getElementById('strategyMaxRangePositionsInput').value;
    payload.volumeWindows = document.getElementById('strategyVolumeWindowsInput').value;
    payload.volumeMultipliers = document.getElementById('strategyStagnationVolumeMultipliersInput').value;
    payload.maxAbsReturns = document.getElementById('strategyMaxAbsReturnsInput').value;
    payload.maxIntradayRanges = document.getElementById('strategyMaxIntradayRangesInput').value;
    payload.minCloseLocations = document.getElementById('strategyMinCloseLocationsInput').value;
  }
  return payload;
}

function aiResearchSyncSignalScanFields() {
  const select = document.getElementById('signalScanFamilySelect');
  const family = select ? select.value : 'low-position-volume-stagnation';
  document.querySelectorAll('[data-signal-scan-family-fields]').forEach(function(group) {
    group.classList.toggle('active', group.dataset.signalScanFamilyFields === family);
  });
  aiResearchRenderSignalScan();
}

function aiResearchSignalScanPayload() {
  const family = document.getElementById('signalScanFamilySelect').value;
  const percentage = function(id) { return Number(document.getElementById(id).value || 0) / 100; };
  const payload = {
    strategyFamily: family,
    validationMode: quantSignalReadiness && quantSignalReadiness.defaultValidationMode || 'exploratory',
    maxCandidates: 500,
    automaticTrading: false
  };
  if (family === 'low-position-volume-stagnation') {
    payload.positionLookbackWindows = [Number(document.getElementById('signalPositionLookbackInput').value || 120)];
    payload.maxRangePositions = [percentage('signalMaxPositionInput')];
    payload.volumeWindows = [Number(document.getElementById('signalVolumeWindowInput').value || 20)];
    payload.volumeMultipliers = [Number(document.getElementById('signalStagnationVolumeInput').value || 1.8)];
    payload.maxAbsReturns = [percentage('signalMaxReturnInput')];
    payload.maxIntradayRanges = [percentage('signalMaxRangeInput')];
    payload.minCloseLocations = [percentage('signalMinCloseInput')];
  } else if (family === 'volume-breakout') {
    payload.breakoutWindows = [Number(document.getElementById('signalBreakoutWindowInput').value || 20)];
    payload.volumeMultipliers = [Number(document.getElementById('signalBreakoutVolumeInput').value || 1.5)];
    payload.breakoutMargins = [percentage('signalBreakoutMarginInput')];
    payload.breakoutMinCloseLocations = [percentage('signalBreakoutCloseInput')];
  } else {
    throw new Error('当前扫描模型不受支持。');
  }
  return payload;
}

function aiResearchSignalEvidenceText(candidate) {
  const evidence = candidate.rawEvidence || {};
  const percent = function(value, digits) {
    return Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(digits == null ? 2 : digits) + '%' : '--';
  };
  if (candidate.strategyFamily === 'low-position-volume-stagnation') {
    return '区间位置 ' + percent(evidence.rangePosition, 1) + ' · 量比 ' + quantNumber(evidence.volumeRatio, 2) +
      ' · 涨跌 ' + percent(evidence.dailyReturn, 2) + ' · 振幅 ' + percent(evidence.intradayRange, 2) +
      ' · 收盘位置 ' + percent(evidence.closeLocation, 1);
  }
  return '前高 ' + quantNumber(evidence.priorHigh, 2) + ' · 突破 ' + percent(evidence.breakoutPercent, 2) +
    ' · 量比 ' + quantNumber(evidence.volumeRatio, 2) + ' · 收盘位置 ' + percent(evidence.closeLocation, 1);
}

function aiResearchRenderSignalScan() {
  const badge = document.getElementById('signalScanReadiness');
  const target = document.getElementById('signalScanPanel');
  const runButton = document.getElementById('runSignalScanBtn');
  if (!badge || !target) return;
  const readiness = quantSignalReadiness || {};
  const ready = readiness.exploratoryAllowed === true;
  badge.textContent = ready
    ? (readiness.formalAllowed ? '正式数据可用' : '探索数据可用') + ' · ' + (readiness.asOf || '--')
    : '数据门禁阻塞';
  badge.title = readiness.reason || '';
  if (runButton) runButton.disabled = !ready || !!aiResearchActiveQuantJob();
  const family = document.getElementById('signalScanFamilySelect')
    ? document.getElementById('signalScanFamilySelect').value
    : 'low-position-volume-stagnation';
  const entry = quantSignalScans.find(function(item) {
    return item.valid && item.result && item.result.ruleCard && item.result.ruleCard.strategyFamily === family;
  });
  const readinessHtml = '<div class="signal-scan-readiness-detail"><span>门禁 <strong>' +
    aiResearchEscape(ready ? (readiness.formalAllowed ? '正式可用' : '仅探索') : '阻塞') + '</strong></span>' +
    '<span>要求截止 <strong>' + aiResearchEscape(readiness.expectedAsOf || '--') + '</strong></span>' +
    '<span>实际截止 <strong>' + aiResearchEscape(readiness.asOf || '--') + '</strong></span>' +
    '<span>成功覆盖 <strong>' + aiResearchEscape(readiness.coverage && readiness.coverage.succeeded || 0) + '/' +
      aiResearchEscape(readiness.minimumCoverage || 5000) + '</strong></span>' +
    '<span>' + aiResearchEscape(readiness.reason || '等待数据检查') + '</span></div>';
  if (!entry) {
    target.innerHTML = readinessHtml + '<div class="empty-state compact">' + aiResearchEscape(
      ready ? '当前模型尚无扫描结果。点击“扫描全市场”后，候选会显示原始数值和失效条件。' : '请先建立全市场前复权基线；旧的未复权数据不会被当作最新模型选股数据。'
    ) + '</div>';
    return;
  }
  const result = entry.result;
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  target.innerHTML = readinessHtml + '<div class="signal-scan-summary"><span>模型 <strong>' +
      aiResearchEscape(result.ruleCard.label || STRATEGY_FAMILY_LABELS[family]) + '</strong></span>' +
      '<span>结果截止 <strong>' + aiResearchEscape(result.asOf) + '</strong></span>' +
      '<span>扫描主板 <strong>' + aiResearchEscape(result.universe && result.universe.included || 0) + '</strong></span>' +
      '<span>规则匹配 <strong>' + aiResearchEscape(result.candidateCount || 0) + '</strong></span>' +
      '<span>状态 <strong>' + aiResearchEscape(result.validationMode === 'formal' ? '正式' : '探索') + '</strong></span></div>' +
    (candidates.length ? '<div class="table-scroll compact-scroll"><table class="data-table signal-scan-table"><thead><tr>' +
      '<th>候选</th><th>强度</th><th>原始证据</th><th>为什么命中</th><th>确认 / 失效</th><th>人工操作</th>' +
      '</tr></thead><tbody>' + candidates.map(function(candidate) {
        const raw = candidate.rawEvidence || {};
        return '<tr data-quant-code="' + aiResearchEscape(candidate.code) + '" data-quant-name="' + aiResearchEscape(candidate.name) +
          '" data-signal-high="' + aiResearchEscape(raw.high || '') + '" data-signal-low="' + aiResearchEscape(raw.low || '') +
          '" data-signal-date="' + aiResearchEscape(candidate.signalDate) + '" data-signal-strength="' + aiResearchEscape(candidate.matchStrength) + '">' +
          '<td><button type="button" class="stock-link-btn" data-signal-action="open">' + aiResearchEscape(candidate.code) + '</button><div>' + aiResearchEscape(candidate.name) + '</div>' +
            '<small class="muted">未确认规则匹配</small></td>' +
          '<td><strong>' + aiResearchEscape(quantNumber(candidate.matchStrength, 1)) + '</strong><div class="muted">仅用于排序</div></td>' +
          '<td>' + aiResearchEscape(aiResearchSignalEvidenceText(candidate)) + '</td>' +
          '<td class="signal-match-reasons">' + (candidate.whyMatched || []).map(function(reason) { return '<div>✓ ' + aiResearchEscape(reason) + '</div>'; }).join('') + '</td>' +
          '<td><div class="signal-condition-stack"><span><strong>确认：</strong>' + aiResearchEscape(candidate.confirmationRule) + '</span>' +
            '<span><strong>失效：</strong>' + aiResearchEscape(candidate.invalidationRule) + '</span><small>' + aiResearchEscape(candidate.earliestActionTiming) + '</small></div></td>' +
          '<td><div class="signal-scan-row-actions"><button type="button" class="small-btn" data-signal-action="open">看K线</button>' +
            '<button type="button" class="small-btn primary" data-signal-action="watch">加入自选并设提醒</button></div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty-state compact">本次没有股票同时满足全部阈值；程序不会用接近条件的股票补足数量。</div>') +
    '<details class="quant-warning-block" open><summary>结果边界与数据限制（' + aiResearchEscape((result.warnings || []).length) + '）</summary><ul>' +
      (result.warnings || []).map(function(warning) { return '<li>' + aiResearchEscape(quantWarningText(warning)) + '</li>'; }).join('') + '</ul></details>';
}

async function aiResearchAddSignalCandidate(row) {
  const code = row.getAttribute('data-quant-code');
  const name = row.getAttribute('data-quant-name');
  const high = Number(row.getAttribute('data-signal-high'));
  const low = Number(row.getAttribute('data-signal-low'));
  const signalDate = row.getAttribute('data-signal-date');
  const family = document.getElementById('signalScanFamilySelect').value;
  const noteLine = '[模型选股 ' + signalDate + '] ' + (STRATEGY_FAMILY_LABELS[family] || family) +
    '，规则匹配强度 ' + row.getAttribute('data-signal-strength') + '；提醒价来自信号日高/低点，不是委托。';
  const existingRows = await aiResearchApi('/api/portfolio/watchlist');
  const existing = (existingRows || []).find(function(item) { return item.code === code; });
  const payload = {
    note: existing && existing.note ? existing.note + '\n' + noteLine : noteLine
  };
  if (Number.isFinite(high) && high > 0) payload.alertHigh = high;
  if (Number.isFinite(low) && low > 0) payload.alertLow = low;
  if (existing) {
    await aiResearchApi('/api/portfolio/watchlist/' + existing.id, { method: 'PUT', body: payload });
  } else {
    await aiResearchApi('/api/portfolio/watchlist', {
      method: 'POST',
      body: Object.assign({ code: code, name: name, groupName: '模型信号观察' }, payload)
    });
  }
  if (window.Watchlist && window.Watchlist.loadWatchlist) await window.Watchlist.loadWatchlist();
  alert(name + ' 已' + (existing ? '更新' : '加入') + '自选；信号日高低点已写入提醒。');
}

function strategyAdmissionLabel(value) {
  return { stable: '稳定区', watch: '观察', rejected: '淘汰' }[value] || value;
}

function strategyAdmissionClass(value) {
  return value === 'stable' ? 'available' : value === 'watch' ? 'planned' : 'unavailable';
}

function aiResearchRenderStrategyLab() {
  const target = document.getElementById('strategyLabPanel');
  if (!target) return;
  const datasetSelect = document.getElementById('quantDatasetSelect');
  const datasetId = datasetSelect ? datasetSelect.value : '';
  const entry = quantStrategyResults.find(function(item) {
    return item.valid && item.result && (!datasetId || item.result.dataManifest.datasetId === datasetId);
  }) || quantStrategyResults.find(function(item) { return item.valid && item.result; });
  if (!entry) {
    const invalidEntry = quantStrategyResults.find(function(item) { return item && item.valid === false; });
    target.innerHTML = '<div class="panel-title-row"><h3>批量策略稳定性</h3><span class="muted">主板规则卡 · 只读研究</span></div>' +
      '<div class="empty-state compact">尚无通过契约校验的批量策略结果。' +
        (invalidEntry ? '<div class="muted">' + aiResearchEscape(quantVerificationText(invalidEntry) + (invalidEntry.error ? '：' + invalidEntry.error : '')) + '</div>' : '') +
      '</div>';
    return;
  }
  const result = entry.result;
  const parameters = (result.parameters || []).slice().sort(function(left, right) {
    const order = { stable: 0, watch: 1, rejected: 2 };
    return (order[left.admission] - order[right.admission]) ||
      Number((right.metrics || {}).medianOosReturn || 0) - Number((left.metrics || {}).medianOosReturn || 0);
  });
  const universe = result.universe || {};
  const execution = result.executionAssumptions || {};
  const walkForward = result.selectedWalkForward || {};
  const warnings = result.warnings || [];
  const bestId = result.bestParameter && result.bestParameter.parameterId || '--';
  const worstId = result.worstParameter && result.worstParameter.parameterId || '--';
  const stableCount = (result.stableParameterIds || []).length;
  const familyLabel = result.ruleCard && (result.ruleCard.label || STRATEGY_FAMILY_LABELS[result.ruleCard.strategyFamily]) || '受控策略';
  target.innerHTML = '<div class="panel-title-row"><div><h3>批量策略稳定性 · ' + aiResearchEscape(familyLabel) + '</h3>' +
      '<p class="muted">' + aiResearchEscape(result.dataManifest.datasetId) + ' · 截止 ' + aiResearchEscape(result.asOf) + ' · ' +
        aiResearchEscape((result.folds || []).length) + ' 个滚动样本外窗口</p></div>' +
      '<span class="research-source-badge">探索性 · 自动交易关闭</span></div>' +
    '<div class="muted quant-verification-note">' + aiResearchEscape(quantVerificationText(entry)) + '</div>' +
    '<div class="strategy-result-summary"><span>主板样本 <strong>' + aiResearchEscape(universe.included == null ? '--' : universe.included) + '</strong></span>' +
      '<span>流动性上限排除 <strong>' + aiResearchEscape(universe.excludedByLiquidityCap == null ? 0 : universe.excludedByLiquidityCap) + '</strong></span>' +
      '<span>稳定参数 <strong>' + aiResearchEscape(stableCount) + '</strong></span>' +
      '<span>历史最佳 <strong>' + aiResearchEscape(bestId) + '</strong></span>' +
      '<span>历史最差 <strong>' + aiResearchEscape(worstId) + '</strong></span>' +
      '<span>滚动选择均值 <strong class="' + quantMetricClass(walkForward.meanOosReturn) + '">' + aiResearchEscape(quantPercent(walkForward.meanOosReturn)) + '</strong></span>' +
      '<span>正收益窗口 <strong>' + aiResearchEscape(quantPercent(walkForward.positiveFoldRate, 0)) + '</strong></span></div>' +
    (stableCount ? '' : '<div class="strategy-no-stable">当前数据中没有参数通过稳定区门槛；不应改用“历史最佳”替代稳定性。</div>') +
    '<div class="strategy-assumption-line"><span>收盘信号 → 次日开盘</span><span>T+1</span><span>涨跌停不可成交</span>' +
      '<span>佣金 ' + aiResearchEscape(execution.commissionBps) + ' bp</span><span>印花税 ' + aiResearchEscape(execution.stampDutyBps) + ' bp</span>' +
      '<span>滑点 ' + aiResearchEscape(execution.slippageBps) + ' bp</span></div>' +
    '<div class="table-scroll compact-scroll"><table class="data-table strategy-lab-table"><thead><tr>' +
      '<th>参数</th><th>样本外折数</th><th>平均收益</th><th>收益中位数</th><th>最差窗口</th><th>正收益窗口</th><th>最大回撤</th><th>成交</th><th>结论</th><th>原因</th>' +
      '</tr></thead><tbody>' + parameters.map(function(parameter) {
        const metrics = parameter.metrics || {};
        const marker = parameter.parameterId === bestId ? '历史最佳' : parameter.parameterId === worstId ? '历史最差' : '';
        const parameterLabel = parameter.label || ('MA' + parameter.shortWindow + ' / MA' + parameter.longWindow);
        return '<tr><td><strong>' + aiResearchEscape(parameterLabel) + '</strong>' +
          '<div class="muted">' + aiResearchEscape(parameter.parameterId) + (marker ? ' · ' + aiResearchEscape(marker) : '') + '</div></td>' +
          '<td>' + aiResearchEscape(metrics.foldCount) + '</td>' +
          '<td class="' + quantMetricClass(metrics.meanOosReturn) + '">' + aiResearchEscape(quantPercent(metrics.meanOosReturn)) + '</td>' +
          '<td class="' + quantMetricClass(metrics.medianOosReturn) + '">' + aiResearchEscape(quantPercent(metrics.medianOosReturn)) + '</td>' +
          '<td class="' + quantMetricClass(metrics.worstOosReturn) + '">' + aiResearchEscape(quantPercent(metrics.worstOosReturn)) + '</td>' +
          '<td>' + aiResearchEscape(quantPercent(metrics.positiveFoldRate, 0)) + '</td>' +
          '<td class="' + quantMetricClass(metrics.maxDrawdown) + '">' + aiResearchEscape(quantPercent(metrics.maxDrawdown)) + '</td>' +
          '<td>' + aiResearchEscape(metrics.tradeCount) + '</td>' +
          '<td><span class="model-status ' + strategyAdmissionClass(parameter.admission) + '">' + aiResearchEscape(strategyAdmissionLabel(parameter.admission)) + '</span></td>' +
          '<td class="factor-lab-reasons">' + aiResearchEscape((parameter.reasons || []).join('；') || '无') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
    '<details class="quant-warning-block" open><summary>研究边界（' + warnings.length + '）</summary><ul>' +
      warnings.map(function(warning) { return '<li>' + aiResearchEscape(quantWarningText(warning)) + '</li>'; }).join('') + '</ul></details>';
}

function aiResearchRenderStrategyDailySchedule() {
  const target = document.getElementById('strategyDailyScheduleStatus');
  if (!target) return;
  const status = quantStrategyDailySchedule || {};
  const labels = {
    run: '今日等待自动运行',
    started: '今日自动研究已启动',
    skip: '今日已运行或正在运行',
    wait: '工作日 09:05 自动检查',
    blocked: '自动运行已阻塞'
  };
  target.textContent = (labels[status.action] || '正在检查定时任务') +
    (status.asOf ? ' · 数据 ' + status.asOf : '') +
    (status.reason ? ' · ' + status.reason : '');
  target.title = status.reason || '';
}

function strategyDailyVerificationLabel(verification) {
  if (verification && verification.hashesVerified === true && verification.status === 'hash_verified') return '完整哈希';
  if (verification && verification.status === 'metadata_valid') return '元数据';
  if (verification && /failed|invalid/.test(String(verification.status || ''))) return '校验失败';
  return '未校验';
}

function aiResearchRenderStrategyDaily() {
  const target = document.getElementById('strategyDailyPanel');
  if (!target) return;
  const report = quantStrategyDailyReport;
  if (!report || report.status === 'blocked') {
    target.innerHTML = '<div class="strategy-daily-empty">' + aiResearchEscape(
      report && report.warnings && report.warnings[0] || '尚无可比较的同源策略结果。运行四策略后生成每日候选池。'
    ) + '</div>';
    return;
  }
  const comparisons = Array.isArray(report.comparisons) ? report.comparisons : [];
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  const missing = Array.isArray(report.missingFamilies) ? report.missingFamilies : [];
  target.innerHTML = '<div class="strategy-daily-summary">' +
      '<span>状态 <strong>' + aiResearchEscape(report.status === 'complete' ? '四策略完整' : '部分结果') + '</strong></span>' +
      '<span>数据集 <strong>' + aiResearchEscape(report.datasetId || '--') + '</strong></span>' +
      '<span>截止 <strong>' + aiResearchEscape(report.asOf || '--') + '</strong></span>' +
      '<span>策略 <strong>' + aiResearchEscape(comparisons.length) + '/4</strong></span>' +
      '<span>触发候选 <strong>' + aiResearchEscape(report.candidateCount || 0) + '</strong></span>' +
      '<span>自动交易 <strong>关闭</strong></span></div>' +
    (missing.length ? '<div class="strategy-daily-warning">缺少：' + aiResearchEscape(missing.map(function(family) {
      return STRATEGY_FAMILY_LABELS[family] || family;
    }).join('、')) + '。这些策略不计入共识。</div>' : '') +
    '<div class="table-scroll compact-scroll"><table class="data-table strategy-daily-comparison-table"><thead><tr>' +
      '<th>策略</th><th>历史最佳参数</th><th>稳定参数</th><th>滚动均值</th><th>收益中位数</th><th>最差窗口</th><th>正收益窗口</th><th>最大回撤</th><th>当日候选</th><th>扫描范围</th><th>结果校验</th>' +
      '</tr></thead><tbody>' + comparisons.map(function(comparison) {
        const metrics = comparison.selectedWalkForward || {};
        return '<tr><td><strong>' + aiResearchEscape(comparison.label || STRATEGY_FAMILY_LABELS[comparison.strategyFamily] || comparison.strategyFamily) + '</strong>' +
          '<div class="muted">' + aiResearchEscape(comparison.runId || '') + '</div></td>' +
          '<td>' + aiResearchEscape(comparison.bestParameterLabel || comparison.bestParameterId || '--') + '</td>' +
          '<td>' + aiResearchEscape(comparison.stableParameterCount || 0) + '</td>' +
          '<td class="' + quantMetricClass(metrics.meanOosReturn) + '">' + aiResearchEscape(quantPercent(metrics.meanOosReturn)) + '</td>' +
          '<td class="' + quantMetricClass(metrics.medianOosReturn) + '">' + aiResearchEscape(quantPercent(metrics.medianOosReturn)) + '</td>' +
          '<td class="' + quantMetricClass(metrics.worstOosReturn) + '">' + aiResearchEscape(quantPercent(metrics.worstOosReturn)) + '</td>' +
          '<td>' + aiResearchEscape(quantPercent(metrics.positiveFoldRate, 0)) + '</td>' +
          '<td class="' + quantMetricClass(metrics.maxDrawdown) + '">' + aiResearchEscape(quantPercent(metrics.maxDrawdown)) + '</td>' +
          '<td>' + aiResearchEscape(comparison.candidateCount || 0) + '</td><td>' + aiResearchEscape(comparison.universeScanned || 0) + '</td>' +
          '<td><span title="' + aiResearchEscape(quantVerificationText({ verification: comparison.verification })) + '">' +
            aiResearchEscape(strategyDailyVerificationLabel(comparison.verification)) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>' +
    (candidates.length ? '<div class="table-scroll compact-scroll"><table class="data-table strategy-daily-candidate-table"><thead><tr>' +
      '<th>候选</th><th>稳定家族</th><th>观察家族</th><th>共识家族</th><th>触发证据</th><th>信号日期</th><th>最早观察</th>' +
      '</tr></thead><tbody>' + candidates.map(function(candidate) {
        const families = Array.isArray(candidate.families) ? candidate.families : [];
        return '<tr data-quant-code="' + aiResearchEscape(candidate.code) + '" data-quant-name="' + aiResearchEscape(candidate.name) + '">' +
          '<td><button type="button" class="stock-link-btn">' + aiResearchEscape(candidate.code) + '</button><div>' + aiResearchEscape(candidate.name) + '</div></td>' +
          '<td><strong>' + aiResearchEscape(candidate.stableFamilyCount || 0) + '</strong></td>' +
          '<td>' + aiResearchEscape(candidate.watchFamilyCount || 0) + '</td><td>' + aiResearchEscape(candidate.consensusCount || 0) + '</td>' +
          '<td><div class="strategy-daily-family-list">' + families.map(function(family) {
            const evidence = family.evidence && family.evidence[0] || {};
            return '<span title="' + aiResearchEscape((family.parameterIds || []).join('、')) + '">' +
              aiResearchEscape(family.label || STRATEGY_FAMILY_LABELS[family.strategyFamily] || family.strategyFamily) + ' · ' +
              aiResearchEscape(strategyAdmissionLabel(family.candidateStatus)) + ' · 正窗 ' +
              aiResearchEscape(quantPercent(evidence.positiveFoldRate, 0)) + '</span>';
          }).join('') + '</div></td>' +
          '<td>' + aiResearchEscape(candidate.signalDate || report.asOf) + '</td><td>下一可成交开盘</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="strategy-daily-empty">当前通过稳定／观察门槛的参数没有触发最近收盘信号；不使用被淘汰参数补足候选。</div>') +
    '<details class="quant-warning-block" open><summary>数据与研究边界（' + aiResearchEscape((report.warnings || []).length) + '）</summary><ul>' +
      (report.warnings || []).map(function(warning) { return '<li>' + aiResearchEscape(warning) + '</li>'; }).join('') + '</ul></details>';
}

function aiResearchNextStrategyDailyDelay(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now || new Date()).reduce(function(result, part) {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const date = parts.year + '-' + parts.month + '-' + parts.day;
  const current = new Date(date + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second);
  const target = new Date(date + 'T09:05:00');
  if (current.getDay() === 0 || current.getDay() === 6 || current >= target) target.setDate(target.getDate() + 1);
  while (target.getDay() === 0 || target.getDay() === 6) target.setDate(target.getDate() + 1);
  return Math.max(1000, target.getTime() - current.getTime());
}

async function aiResearchScheduleStrategyDaily() {
  if (strategyDailyScheduleTimer) clearTimeout(strategyDailyScheduleTimer);
  try {
    quantStrategyDailySchedule = await aiResearchApi('/api/quant/strategy-daily/schedule');
    if (quantStrategyDailySchedule.action === 'run') {
      quantStrategyDailySchedule = await aiResearchApi('/api/quant/strategy-daily/schedule', { method: 'POST', body: {} });
      if (quantStrategyDailySchedule.job) {
        quantJobs.unshift(quantStrategyDailySchedule.job);
        aiResearchRenderQuantJob();
        aiResearchScheduleQuantPoll();
      }
    }
    aiResearchRenderStrategyDailySchedule();
  } catch (error) {
    quantStrategyDailySchedule = { action: 'blocked', reason: error.message };
    aiResearchRenderStrategyDailySchedule();
  } finally {
    strategyDailyScheduleTimer = setTimeout(aiResearchScheduleStrategyDaily, aiResearchNextStrategyDailyDelay(new Date()));
  }
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

function paperMonitorMoney(value) {
  if (value == null || value === '') return '--';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
}

function paperMonitorEquitySparkline(snapshots) {
  const values = (snapshots || []).filter(function(item) { return !(item.warnings || []).length && !(item.sourceMetadata && item.sourceMetadata.coverageComplete === false); }).slice().reverse().map(function(item) { return Number(item.totalValue); })
    .filter(Number.isFinite);
  if (values.length < 2) return '<span class="muted">权益曲线等待至少两个净值点</span>';
  const min = Math.min.apply(Math, values);
  const max = Math.max.apply(Math, values);
  const range = max - min || 1;
  const points = values.map(function(value, index) {
    const x = values.length === 1 ? 0 : index / (values.length - 1) * 100;
    const y = 32 - (value - min) / range * 28;
    return x.toFixed(2) + ',' + y.toFixed(2);
  }).join(' ');
  const rising = values[values.length - 1] >= values[0];
  return '<svg class="paper-monitor-equity" viewBox="0 0 100 36" role="img" aria-label="纸面账户权益曲线">' +
    '<polyline points="' + points + '" fill="none" stroke="' + (rising ? '#dc2626' : '#059669') + '" stroke-width="2" vector-effect="non-scaling-stroke"></polyline></svg>';
}

function paperMonitorOrderLabel(order) {
  const action = { buy: '买入', sell: '卖出', hold: '保持' }[order.action] || order.action;
  const status = { pending: '待成交', filled: '已成交', rejected: '已拒绝', held: '保持', cancelled: '已取消' }[order.status] || order.status;
  return action + ' ' + order.code + ' → ' + Number(order.targetPositionPercent).toFixed(1) + '% · ' + status;
}

function aiResearchRenderPaperMonitor(paper) {
  const state = paperMonitorStates.get(Number(paper.id));
  if (!state) return '<div class="paper-monitor-card loading">正在读取模型盯盘账户...</div>';
  if (state.error) return '<div class="paper-monitor-card error">模型盯盘状态读取失败：' + aiResearchEscape(state.error) + '</div>';
  const settings = state.settings || {};
  const independent = settings.holdingsSyncRequired === false;
  const performance = state.performance || {};
  const performanceLabel = { 'not-started': '尚未开始判断', recording: '模拟记录中', stale: '估值过期', partial: '部分缺价' }[performance.status] || '等待核验';
  const monitoredPaper = state.paper || paper;
  const latest = monitoredPaper.latestSnapshot;
  const tonghuashun = state.tonghuashunStatus || {};
  const schedule = settings.schedule && settings.schedule.length ? settings.schedule : ['09:35', '10:30', '14:50'];
  const pendingCount = (state.orders || []).filter(function(order) { return order.status === 'pending'; }).length;
  const rejectedCount = (state.orders || []).filter(function(order) { return order.status === 'rejected'; }).length;
  const latestOrders = (state.orders || []).slice(0, 20);
  const decisions = (state.decisions || []).slice(0, 20);
  const holdingMethodLabel = tonghuashun.method === 'export-file'
    ? '当天持仓导出可读 · '
    : /^windows-ocr/.test(String(tonghuashun.method || ''))
      ? '同花顺窗口持仓已自动采集 · '
      : '当天手动快照已就绪 · ';
  const holdingStatus = independent ? '独立模拟：不读取、不发送真实持仓；不会因同花顺未登录而阻塞。' : tonghuashun.available
    ? holdingMethodLabel +
      aiResearchEscape(aiResearchDate(tonghuashun.fileUpdatedAt || tonghuashun.observedAt || ''))
    : '同花顺持仓同步不可用 · ' + aiResearchEscape(tonghuashun.error || '请保持已登录的资金股票页面可读');
  const paperCash = latest ? latest.cashValue : monitoredPaper.capital;
  const paperEquity = latest ? latest.totalValue : monitoredPaper.capital;
  const totalPnl = latest ? latest.totalPnl : 0;
  const dailyPnl = latest ? latest.dailyPnl : 0;
  const statusNote = settings.lastError
    ? '<div class="paper-monitor-alert">最近一次未运行：' + aiResearchEscape(settings.lastError) + '</div>'
    : '<div class="paper-monitor-source">最近持仓同步：' + aiResearchEscape(settings.lastHoldingsSource || '尚未成功') +
      (settings.lastHoldingsSyncAt ? ' · ' + aiResearchEscape(aiResearchDate(settings.lastHoldingsSyncAt)) : '') + '</div>';
  return '<div class="paper-monitor-card"><div class="paper-monitor-head"><div><strong>ChatGPT 盯盘模拟</strong>' +
      '<span class="research-source-badge ' + (performance.status === 'recording' ? 'available' : 'planned') + '">' + performanceLabel + '</span></div>' +
      '<div class="paper-monitor-controls"><label class="paper-monitor-switch"><input type="checkbox" data-paper-monitor-toggle' + (settings.enabled ? ' checked' : '') + '>自动</label>' +
      '<select data-paper-monitor-mode aria-label="真实持仓参考模式"><option value="reference"' + (!independent ? ' selected' : '') + '>参考真实持仓</option><option value="independent"' + (independent ? ' selected' : '') + '>独立模拟</option></select>' +
      '<select data-paper-monitor-start aria-label="模拟开始方式"><option value="today"' + (settings.startMode === 'today' ? ' selected' : '') + '>今日起</option>' +
      '<option value="next-trading-day"' + (settings.startMode === 'next-trading-day' ? ' selected' : '') + '>下一交易日起</option></select>' +
      '<button type="button" class="small-btn primary" data-paper-monitor-run' + (paper.status === 'active' ? '' : ' disabled title="先把组合状态改为观察中"') + '>立即判断</button>' +
      '<button type="button" class="small-btn" data-paper-monitor-execute>检查成交</button></div></div>' +
    '<div class="paper-monitor-schedule"><span>前向模拟 · 自动' + (settings.enabled ? '已启用' : '已暂停') + '</span><strong>' + aiResearchEscape(schedule.join(' / ')) + '</strong><span>按交易日运行；同一时点只记录一次建议</span></div>' +
    '<div class="paper-monitor-holding ' + (independent || tonghuashun.available ? 'ready' : 'blocked') + '"><span>' + holdingStatus + '</span>' +
      '<button type="button" class="small-btn" data-paper-monitor-sync>同步同花顺持仓</button></div>' +
    aiResearchRenderMonitorReadiness(state.readiness) +
    (state.pendingHandoff ? '<div class="paper-monitor-holding"><span>有模型提示词等待回填 · 有效至 ' + aiResearchEscape(aiResearchDate(state.pendingHandoff.expiresAt)) + '</span><button type="button" class="small-btn primary" data-paper-monitor-handoff>继续待回填</button></div>' : '') +
    '<details class="paper-monitor-candidates"><summary>候选股票池 · ' + (monitoredPaper.items || []).length + ' 只（只供模型判断，不会直接买入）</summary>' +
      '<p>明确添加六位股票代码，以空格或逗号分隔，最多 50 只。已有候选和模拟持仓保留。</p>' +
      '<textarea data-paper-monitor-candidates rows="2" aria-label="添加模拟候选股票代码" placeholder="请输入需要评估的六位股票代码"></textarea>' +
      '<button type="button" class="small-btn" data-paper-monitor-add-candidates>添加候选</button></details>' +
    '<div class="paper-monitor-grid"><div><span>可用现金</span><strong>' + paperMonitorMoney(paperCash) + '</strong></div>' +
      '<div><span>账户权益</span><strong>' + paperMonitorMoney(paperEquity) + '</strong></div>' +
      '<div><span>当日盈亏</span><strong class="' + quantMetricClass(dailyPnl) + '">' + paperMonitorMoney(dailyPnl) + '</strong></div>' +
      '<div><span>累计盈亏</span><strong class="' + quantMetricClass(totalPnl) + '">' + paperMonitorMoney(totalPnl) + '</strong></div>' +
      '<div><span>累计收益率</span><strong class="' + quantMetricClass(performance.totalReturn) + '">' + aiResearchEscape(quantPercent(performance.totalReturn, 2)) + '</strong></div>' +
      '<div><span>已观察最大回撤</span><strong class="' + quantMetricClass(performance.observedMaxDrawdown) + '">' + aiResearchEscape(quantPercent(performance.observedMaxDrawdown, 2)) + '</strong></div>' +
      '<div><span>费用与滑点（已计入盈亏）</span><strong>' + paperMonitorMoney(performance.totalCosts) + '</strong></div>' +
      '<div><span>账本</span><strong>' + Number(performance.fillCount || 0) + ' 成交 / ' + pendingCount + ' 待成交 / ' + rejectedCount + ' 拒绝</strong></div></div>' +
    '<p class="paper-monitor-source">净值时间：' + aiResearchEscape(aiResearchDate(performance.valuationAt)) + ' · ' + Number(performance.tradingDays || 0) + ' 个有记录交易日 / ' + Number(performance.validSnapshotCount || 0) + ' 个有效净值点。' + aiResearchEscape(performance.limitation || '公开分钟价模拟，不代表真实可成交。') + '</p>' +
    '<div class="paper-monitor-chart">' + paperMonitorEquitySparkline(monitoredPaper.snapshots) + '</div>' + statusNote +
    '<details class="paper-monitor-ledger"><summary>自动运行记录（失败 / 重试 / 漏跑）</summary>' + ((state.runs || []).slice(0, 12).map(function(run) {
      const label = { succeeded: '判断已记录', invalid: '建议未通过校验', failed: '失败', missed: '漏跑', retrying: '等待重试', running: '运行中', handoff: '等待模型回传' }[run.status] || run.status;
      return '<div class="paper-monitor-order"><strong>' + aiResearchEscape(run.slot + ' · ' + label) + '</strong><span>' + aiResearchEscape(run.error || '尝试 ' + run.attempts + ' 次') + (run.nextRetryAt ? ' · 下次重试 ' + aiResearchEscape(aiResearchDate(run.nextRetryAt)) : '') + '</span></div>';
    }).join('') || '<p class="muted">尚无自动运行记录。</p>') + '</details>' +
    '<details class="paper-monitor-ledger"><summary>模型对话与订单账本（共 ' + Number(performance.decisionCount || 0) + ' 次判断，展示最近 20 条）</summary>' +
      (decisions.length ? decisions.map(function(decision) { return '<div class="paper-monitor-decision"><strong>实际收到建议 ' + aiResearchEscape(aiResearchDate(decision.advisedAt)) + ' · ' + aiResearchEscape(decision.modelId) +
        ' · ' + aiResearchEscape(decision.validationStatus === 'valid' ? '结构校验通过' : '结构校验失败') + '</strong><p>输入行情截止 ' + aiResearchEscape(aiResearchDate(decision.marketAsOf)) + '</p><p>' +
        aiResearchEscape(decision.decision && decision.decision.marketView || decision.validationErrors && decision.validationErrors.join('；') || '--') + '</p><details><summary>原始模型回复</summary><pre>' + aiResearchEscape(String(decision.rawResponse || '').slice(0, 20000)) + '</pre></details></div>'; }).join('') : '<p class="muted">尚无模型判断。</p>') +
      '<div class="paper-monitor-order-list">' + (latestOrders.length ? latestOrders.map(function(order) {
        return '<div class="paper-monitor-order ' + aiResearchEscape(order.status) + '"><strong>' + aiResearchEscape(paperMonitorOrderLabel(order)) + '</strong><span>' +
          aiResearchEscape(order.statusReason || order.reason) + '</span></div>';
      }).join('') : '<span class="muted">尚无订单。</span>') + '</div></details></div>';
}

function aiResearchRenderMonitorReadiness(readiness) {
  const result = readiness || { checks: [] };
  const labels = { ready: '已检查', blocked: '需处理', waiting: '等待', 'not-required': '不需要', unchecked: '未检查', handoff: '需回填' };
  return '<section class="paper-monitor-readiness" aria-label="运行准备检查"><div class="paper-monitor-head"><strong>运行准备检查</strong>' +
    '<button type="button" class="small-btn" data-paper-monitor-check>检查运行条件</button></div><div class="paper-readiness-grid">' +
    result.checks.map(function(item) { return '<div class="paper-readiness-item ' + aiResearchEscape(item.status) + '"><strong>' + aiResearchEscape(item.label) +
      '<span>' + aiResearchEscape(labels[item.status] || item.status) + '</span></strong><p>' + aiResearchEscape(item.detail) + '</p></div>'; }).join('') +
    '</div><p class="paper-monitor-source">检查时间：' + aiResearchEscape(aiResearchDate(result.checkedAt)) + '。仅检查运行条件，不生成模型建议或模拟成交；实际运行前会重新校验行情。</p></section>';
}

function aiResearchRenderPaperPortfolios() {
  const target = document.getElementById('paperPortfolioPanel');
  if (!target) return;
  if (!paperPortfolios.length) {
    target.innerHTML = '<div class="panel-title-row paper-heading"><div><h3>ChatGPT 盯盘模拟</h3>' +
      '<span class="muted">从启用后的行情开始，真实持仓只作只读参考，不连接券商。</span></div>' +
      '<button id="enableDefaultPaperMonitorBtn" type="button" class="small-btn primary">启用10万元模拟</button></div>';
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
        aiResearchRenderPaperMonitor(paper) + '<div class="paper-item-grid">' + (paper.items || []).map(function(item) {
          return '<button type="button" class="paper-item" data-quant-code="' + aiResearchEscape(item.code) + '" data-quant-name="' + aiResearchEscape(item.name) + '">' +
            '<span><strong>' + aiResearchEscape(item.name) + '</strong><small>' + aiResearchEscape(item.code) + '</small></span><b>' + aiResearchEscape(quantPercent(item.targetWeight, 1)) + '</b></button>';
        }).join('') + '</div></section>';
    }).join('');
}

async function aiResearchLoadPaperPortfolios() {
  paperPortfolios = await aiResearchApi('/api/paper-portfolios?limit=20');
  aiResearchRenderPaperPortfolios();
  const results = await Promise.allSettled(paperPortfolios.map(function(paper) {
    return aiResearchApi('/api/paper-portfolios/' + paper.id + '/monitor').then(function(state) {
      paperMonitorStates.set(Number(paper.id), state);
    });
  }));
  results.forEach(function(result, index) {
    if (result.status === 'rejected') paperMonitorStates.set(Number(paperPortfolios[index].id), { error: result.reason.message });
  });
  aiResearchRenderPaperPortfolios();
}

async function aiResearchRunPaperMonitor(paperId, button, resumeHandoff) {
  if (button) button.disabled = true;
  try {
    const result = await aiResearchApi('/api/paper-portfolios/' + paperId + (resumeHandoff ? '/monitor/handoff' : '/monitor/run'), {
      method: resumeHandoff ? 'GET' : 'POST', body: resumeHandoff ? undefined : {}, timeoutMs: 180000
    });
    if (result.handoffMode) {
      window.AIAssistant.open({
        title: '纸面账户 ChatGPT 盯盘判断',
        summary: (result.context.holdingsSyncRequired === false ? '独立模拟，未纳入真实持仓。' : '同花顺只读持仓与点时行情已纳入。') +
          '输入截止 ' + aiResearchDate(result.asOf) + '；有效至 ' + aiResearchDate(result.expiresAt) + '。只接受严格 JSON，过期需重新判断。',
        prompt: result.prompt,
        promptStyle: 'risk-control',
        kind: 'paper-monitor',
        context: { view: 'aiResearch', paperPortfolioId: paperId, asOf: result.asOf },
        onSave: async function(savedResult) {
          const accepted = await aiResearchApi('/api/paper-portfolios/' + paperId + '/monitor/manual', {
            method: 'POST',
            body: { prepared: result, rawResponse: savedResult },
            timeoutMs: 30000
          });
          await aiResearchLoadPaperPortfolios();
          if (accepted.decision && accepted.decision.validationStatus !== 'valid') throw new Error('建议未通过校验，未生成订单：' + accepted.decision.validationErrors.join('；') + '。失败原文已记入账本，可在提示词有效期内更正后重新保存；过期则重新判断。');
        }
      });
      await aiResearchLoadPaperPortfolios();
    } else {
      await aiResearchLoadPaperPortfolios();
    }
  } catch (error) {
    alert(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function aiResearchCheckPaperMonitor(paperId, button) {
  const state = paperMonitorStates.get(Number(paperId));
  button.disabled = true;
  try {
    const readiness = await aiResearchApi('/api/paper-portfolios/' + paperId + '/monitor/check', { method: 'POST', body: {}, timeoutMs: 30000 });
    if (!state || paperMonitorStates.get(Number(paperId)) !== state) return;
    state.readiness = readiness;
    aiResearchRenderPaperPortfolios();
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
}

async function aiResearchAddMonitorCandidates(paperId, row, button) {
  const input = row.querySelector('[data-paper-monitor-candidates]');
  const codes = String(input && input.value || '').trim().split(/[\s,，;；]+/).filter(Boolean);
  if (!codes.length) return alert('请先填写候选股票代码。');
  if (!confirm('添加候选会使当前待回填提示词及待成交意图失效，需要重新判断；历史成交和净值保留。继续？')) return;
  button.disabled = true;
  try {
    await aiResearchApi('/api/paper-portfolios/' + paperId + '/monitor/candidates', { method: 'POST', body: { codes } });
    await aiResearchLoadPaperPortfolios();
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
}

async function aiResearchExecutePaperMonitor(paperId, button) {
  if (button) button.disabled = true;
  try {
    await aiResearchApi('/api/paper-portfolios/' + paperId + '/monitor/execute', {
      method: 'POST', body: {}, timeoutMs: 60000
    });
    await aiResearchLoadPaperPortfolios();
  } catch (error) {
    alert(error.message);
  } finally {
    if (button) button.disabled = false;
  }
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
  aiResearchRenderWatchlistGroups();
  aiResearchRenderWatchlistResearch();
  aiResearchRenderQuantDatasets();
  aiResearchRenderQuantJob();
  aiResearchRenderQuantResult();
  aiResearchRenderFactorLab();
  aiResearchRenderStrategyLab();
  aiResearchRenderSignalScan();
  aiResearchRenderStrategyDailySchedule();
  aiResearchRenderStrategyDaily();
}

async function aiResearchLoadQuant() {
  const values = await Promise.all([
    aiResearchApi('/api/quant/runtime'),
    aiResearchApi('/api/quant/watchlist-groups'),
    aiResearchApi('/api/quant/datasets?limit=30'),
    aiResearchApi('/api/quant/results?limit=20'),
    aiResearchApi('/api/quant/factor-labs?limit=20'),
    aiResearchApi('/api/quant/strategy-labs?limit=20'),
    aiResearchApi('/api/quant/signal-scans/readiness'),
    aiResearchApi('/api/quant/signal-scans?limit=20'),
    aiResearchApi('/api/quant/strategy-daily'),
    aiResearchApi('/api/quant/strategy-daily/schedule'),
    aiResearchApi('/api/quant/jobs?limit=30')
  ]);
  quantRuntime = values[0];
  quantWatchlistGroups = values[1];
  quantDatasets = values[2];
  quantResults = values[3];
  quantFactorResults = values[4];
  quantStrategyResults = values[5];
  quantSignalReadiness = values[6];
  quantSignalScans = values[7];
  quantStrategyDailyReport = values[8];
  quantStrategyDailySchedule = values[9];
  quantJobs = values[10];
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
  const response = await aiResearchApi(path, { method: 'POST', body: body || {}, timeoutMs: 30000 });
  if (response && response.id && response.status) {
    quantJobs.unshift(response);
    aiResearchRenderQuantJob();
    aiResearchScheduleQuantPoll();
  } else {
    await aiResearchLoadQuant();
  }
  return response;
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
  const runStatusLabels = { pending: '运行中', completed: '已完成', failed: '失败' };
  target.innerHTML = aiResearchRuns.map(function(run) {
    const evidenceIds = (run.evidence || []).map(function(item) { return item.evidenceId; }).filter(Boolean).slice(0, 8);
    const failure = run.metrics && run.metrics.failure ? run.metrics.failure : null;
    return '<details class="knowledge-run-row" data-run-id="' + run.id + '">' +
      '<summary><span><strong>' + aiResearchEscape(run.title || run.question || '知识分析') + '</strong>' +
        '<span class="muted">' + aiResearchEscape(runStatusLabels[run.status] || run.status) + ' · ' +
          aiResearchEscape(run.modelId) + ' · ' + aiResearchEscape(aiResearchDate(run.createdAt)) + '</span></span>' +
        '<button class="small-btn danger" data-run-action="delete" type="button">删除</button></summary>' +
      (evidenceIds.length ? '<div class="knowledge-run-evidence">证据：' + aiResearchEscape(evidenceIds.join(' / ')) + '</div>' : '') +
      (failure ? '<div class="expert-asr-error">失败阶段：' + aiResearchEscape(failure.stage || 'unknown') +
        ' · ' + aiResearchEscape(failure.message || '未提供错误信息') + '</div>' : '') +
      '<pre>' + aiResearchEscape(run.result || (run.status === 'pending' ? '模型调用仍在运行或上次运行未正常结束。' : '尚无结果')) + '</pre>' +
    '</details>';
  }).join('');
}

function aiResearchRenderGptPickImports() {
  const target = document.getElementById('gptPickImportList');
  const summary = document.getElementById('gptPickImportSummary');
  if (!target || !summary) return;
  const items = Array.isArray(aiResearchGptPickImports) ? aiResearchGptPickImports : [];
  const candidateTotal = items.reduce(function(total, item) {
    return total + Number(item && item.candidateCount || 0);
  }, 0);
  summary.textContent = items.length ? items.length + ' 次导入 · ' + candidateTotal + ' 只候选' : '尚无记录';
  if (!items.length) {
    target.innerHTML = '<div class="empty-state compact">尚未导入 ChatGPT 选股材料。</div>';
    return;
  }
  target.innerHTML = items.map(function(item, itemIndex) {
    const candidates = Array.isArray(item.candidates) ? item.candidates : [];
    const warnings = Array.isArray(item.warnings) ? item.warnings : [];
    const importLabel = item.source === 'external-chatgpt-batch'
      ? '自动批次导入，WebStock 未独立验证，不自动交易'
      : '手动导入，不自动交易';
    return '<details class="gpt-pick-import-row"' + (itemIndex === 0 ? ' open' : '') + '>' +
      '<summary><span><strong>' + aiResearchEscape(item.title || 'ChatGPT 手动选股') + '</strong>' +
        '<small>' + aiResearchEscape(aiResearchDate(item.importedAt)) + ' · ' + candidates.length + ' 只 · ' + importLabel + '</small></span></summary>' +
      (item.analysis ? '<p class="gpt-pick-overall"><b>总体分析：</b>' + aiResearchEscape(item.analysis) + '</p>' : '') +
      '<div class="gpt-pick-candidate-grid">' + candidates.map(function(candidate) {
        return '<article class="gpt-pick-candidate" data-gpt-pick-code="' + aiResearchEscape(candidate.code) + '">' +
          '<div class="gpt-pick-code"><strong>' + aiResearchEscape(candidate.code) + '</strong><span>' + aiResearchEscape(candidate.name || '名称未提供') + '</span></div>' +
          '<p><b>入选理由</b>' + aiResearchEscape(candidate.reason || '未提供') + '</p>' +
          '<p><b>风险</b>' + aiResearchEscape(candidate.risk || '未提供') + '</p>' +
          (candidate.originalAnalysis ? '<p><b>GPT 原分析</b>' + aiResearchEscape(candidate.originalAnalysis) + '</p>' : '') +
        '</article>';
      }).join('') + '</div>' +
      (warnings.length ? '<div class="gpt-pick-warnings">信息缺口：' + aiResearchEscape(warnings.slice(0, 8).join('；')) + '</div>' : '') +
      '<div class="muted gpt-pick-boundary">来源：ChatGPT 对话手动粘贴 · 未由 WebStock 验证 · 仅作研究材料</div>' +
    '</details>';
  }).join('');
}

async function aiResearchLoadModels() {
  aiResearchModels = await aiResearchApi('/api/ai-models');
  aiResearchRenderModels();
  return aiResearchModels;
}

function aiResearchPrefetchModels(force) {
  if (aiResearchModelLoading) return aiResearchModelLoading;
  if (aiResearchModels.length && !force) return Promise.resolve(aiResearchModels);
  aiResearchModelLoading = aiResearchLoadModels()
    .finally(function() { aiResearchModelLoading = null; });
  return aiResearchModelLoading;
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

async function aiResearchLoadGptPickImports() {
  const result = await aiResearchApi('/api/research-picks?limit=20');
  aiResearchGptPickImports = result && Array.isArray(result.items) ? result.items : [];
  aiResearchRenderGptPickImports();
  return aiResearchGptPickImports;
}

async function aiResearchImportGptPicks() {
  const button = document.getElementById('importGptPicksBtn');
  const content = document.getElementById('gptPickImportText').value;
  const title = document.getElementById('gptPickImportTitle').value.trim();
  const analysis = document.getElementById('gptPickOverallAnalysis').value.trim();
  if (!content.trim()) {
    aiResearchSetStatus('gptPickImportStatus', '请先粘贴 ChatGPT 的候选与原分析。', true);
    return;
  }
  button.disabled = true;
  aiResearchSetStatus('gptPickImportStatus', '正在识别并保存…');
  try {
    const imported = await aiResearchApi('/api/research-picks/import', {
      method: 'POST',
      body: { title, content, analysis },
      timeoutMs: 30000
    });
    await aiResearchLoadGptPickImports();
    document.getElementById('gptPickImportText').value = '';
    document.getElementById('gptPickImportTitle').value = '';
    document.getElementById('gptPickOverallAnalysis').value = '';
    const warningText = imported.warnings && imported.warnings.length ? '，有 ' + imported.warnings.length + ' 项信息缺口' : '';
    aiResearchSetStatus('gptPickImportStatus', '已导入 ' + imported.candidateCount + ' 只候选' + warningText + '。');
  } catch (error) {
    aiResearchSetStatus('gptPickImportStatus', error.message, true);
  } finally {
    button.disabled = false;
  }
}

function aiResearchEnsureLoaded(force) {
  if (aiResearchLoading) return aiResearchLoading;
  if (aiResearchLoaded && !force) return Promise.resolve();
  aiResearchLoading = aiResearchPrefetchModels(force)
    .then(function() {
      return Promise.all([aiResearchLoadSources(), aiResearchLoadRuns(), aiResearchLoadGptPickImports(), aiResearchLoadQuant(), aiResearchLoadPaperPortfolios()]);
    })
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
  document.getElementById('importGptPicksBtn').addEventListener('click', aiResearchImportGptPicks);
  document.getElementById('clearGptPicksBtn').addEventListener('click', function() {
    document.getElementById('gptPickImportText').value = '';
    document.getElementById('gptPickImportTitle').value = '';
    document.getElementById('gptPickOverallAnalysis').value = '';
    aiResearchSetStatus('gptPickImportStatus', '输入已清空，已保存记录不受影响。');
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
  document.getElementById('paperPortfolioPanel').addEventListener('change', function(event) {
    const row = event.target.closest('[data-paper-id]');
    const toggle = event.target.closest('[data-paper-monitor-toggle]');
    const start = event.target.closest('[data-paper-monitor-start]');
    const mode = event.target.closest('[data-paper-monitor-mode]');
    if (!row || (!toggle && !start && !mode)) return;
    const paperId = row.getAttribute('data-paper-id');
    const current = paperMonitorStates.get(Number(paperId));
    if (mode && !confirm('切换模式会取消待成交意图并使未回填提示词失效；历史成交、净值及真实持仓保持不变。继续？')) {
      mode.value = current && current.settings.holdingsSyncRequired === false ? 'independent' : 'reference';
      return;
    }
    const control = mode || toggle || start;
    const body = mode ? { holdingsSyncRequired: mode.value === 'reference' } :
      toggle ? { enabled: toggle.checked } : { startMode: start.value };
    control.disabled = true;
    aiResearchApi('/api/paper-portfolios/' + paperId + '/monitor/settings', {
      method: 'PUT',
      body: body
    }).then(aiResearchLoadPaperPortfolios).catch(function(error) {
      alert(error.message);
      return aiResearchLoadPaperPortfolios().catch(function(refreshError) { alert(refreshError.message); });
    }).finally(function() { control.disabled = false; });
  });
  document.getElementById('paperPortfolioPanel').addEventListener('click', function(event) {
    const enable = event.target.closest('#enableDefaultPaperMonitorBtn');
    if (enable) {
      enable.disabled = true;
      aiResearchApi('/api/paper-portfolios/default-monitor', {
        method: 'POST', body: { capital: 100000, startMode: 'today' }
      }).then(aiResearchLoadPaperPortfolios).catch(function(error) {
        alert(error.message);
        enable.disabled = false;
      });
      return;
    }
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
  document.getElementById('paperPortfolioPanel').addEventListener('click', function(event) {
    const row = event.target.closest('[data-paper-id]');
    if (!row) return;
    const paperId = row.getAttribute('data-paper-id');
    const run = event.target.closest('[data-paper-monitor-run]');
    const execute = event.target.closest('[data-paper-monitor-execute]');
    const sync = event.target.closest('[data-paper-monitor-sync]');
    const check = event.target.closest('[data-paper-monitor-check]');
    const add = event.target.closest('[data-paper-monitor-add-candidates]');
    const handoff = event.target.closest('[data-paper-monitor-handoff]');
    if (check) {
      aiResearchCheckPaperMonitor(paperId, check);
    } else if (add) {
      aiResearchAddMonitorCandidates(paperId, row, add);
    } else if (handoff) {
      aiResearchRunPaperMonitor(paperId, handoff, true);
    } else if (run) {
      aiResearchRunPaperMonitor(paperId, run);
    } else if (execute) {
      aiResearchExecutePaperMonitor(paperId, execute);
    } else if (sync && window.Portfolio && window.Portfolio.syncTonghuashunHoldings) {
      sync.disabled = true;
      Promise.resolve(window.Portfolio.syncTonghuashunHoldings())
        .then(aiResearchLoadPaperPortfolios)
        .catch(function(error) { alert(error.message); })
        .finally(function() { sync.disabled = false; });
    }
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
  document.getElementById('quantWatchlistGroupSelect').addEventListener('change', function() {
    aiResearchRenderWatchlistGroups();
  });
  document.getElementById('runWatchlistResearchBtn').addEventListener('click', function() {
    const groupId = document.getElementById('quantWatchlistGroupSelect').value;
    if (!groupId) return alert('请先选择一个包含 8—120 只证券的同花顺分组。');
    aiResearchStartQuant('/api/quant/watchlist-research', {
      groupId: groupId,
      maxFolds: Number(document.getElementById('strategyMaxFoldsInput').value || 4),
      validationDays: Number(document.getElementById('strategyValidationDaysInput').value || 63),
      testDays: Number(document.getElementById('strategyTestDaysInput').value || 63),
      stepDays: Number(document.getElementById('strategyTestDaysInput').value || 63),
      commissionBps: Number(document.getElementById('strategyCommissionBpsInput').value || 2.5),
      stampDutyBps: Number(document.getElementById('strategyStampDutyBpsInput').value || 5),
      slippageBps: Number(document.getElementById('strategySlippageBpsInput').value || 2),
      automaticTrading: false
    }).catch(function(error) { alert(error.message); });
  });
  document.getElementById('analyzeWatchlistResearchBtn').addEventListener('click', function() {
    const job = aiResearchLatestWatchlistJob();
    const output = job && job.output;
    if (!output || !output.handoffPrompt) return;
    window.AIAssistant.open({
      title: (output.group && output.group.name || '同花顺自选') + '量化证据复核',
      summary: (output.report && output.report.candidateCount || 0) + ' 个研究候选；前复权数据与四策略样本外结果已附带。',
      prompt: output.handoffPrompt,
      promptStyle: 'default',
      kind: 'watchlist-quant-research',
      context: { view: 'aiResearch', quantJobId: job.id, automaticTrading: false }
    });
  });
  document.getElementById('collectQuantMarketBtn').addEventListener('click', function() {
    if (!confirm('将建立或增量更新全市场前复权日线基线。首次同步可能持续较长时间并产生较大的本地数据文件，继续？')) return;
    aiResearchStartQuant('/api/quant/full-market-sync', {
      automaticTrading: false,
      repairIncomplete: true
    })
      .catch(function(error) { alert(error.message); });
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
  document.getElementById('parseStrategyRuleBtn').addEventListener('click', async function() {
    const text = document.getElementById('strategyNaturalLanguageInput').value.trim();
    try {
      const rule = await aiResearchApi('/api/quant/strategy-rules/parse', {
        method: 'POST',
        body: { text: text }
      });
      if (!rule || !rule.strategyFamily || rule.automaticTrading !== false) throw new Error('解析结果缺少受控研究边界。');
      aiResearchApplyStrategyRule(rule);
    } catch (error) {
      aiResearchRenderStrategyRulePreview(null, error.message);
    }
  });
  document.getElementById('strategyFamilySelect').addEventListener('change', function() {
    aiResearchSyncStrategyFamilyFields();
    aiResearchRenderStrategyRulePreview(null);
  });
  aiResearchSyncStrategyFamilyFields();
  document.getElementById('signalScanFamilySelect').addEventListener('change', aiResearchSyncSignalScanFields);
  aiResearchSyncSignalScanFields();
  document.getElementById('syncSignalDatasetBtn').addEventListener('click', function() {
    document.getElementById('collectQuantMarketBtn').click();
  });
  document.getElementById('runSignalScanBtn').addEventListener('click', function() {
    if (!quantSignalReadiness || !quantSignalReadiness.exploratoryAllowed) {
      return alert(quantSignalReadiness && quantSignalReadiness.reason || '全市场前复权数据尚未就绪。');
    }
    aiResearchStartQuant('/api/quant/signal-scans', aiResearchSignalScanPayload())
      .catch(function(error) { alert(error.message); });
  });
  document.getElementById('runSignalBacktestBtn').addEventListener('click', function() {
    const datasetId = quantSignalReadiness && quantSignalReadiness.datasetId;
    if (!datasetId) return alert('请先建立全市场前复权基线。');
    const testDays = Number(document.getElementById('strategyTestDaysInput').value || 63);
    const payload = Object.assign(aiResearchSignalScanPayload(), {
      datasetId: datasetId,
      maxFolds: Number(document.getElementById('strategyMaxFoldsInput').value || 4),
      validationDays: Number(document.getElementById('strategyValidationDaysInput').value || 63),
      testDays: testDays,
      stepDays: testDays,
      commissionBps: Number(document.getElementById('strategyCommissionBpsInput').value || 0),
      stampDutyBps: Number(document.getElementById('strategyStampDutyBpsInput').value || 0),
      slippageBps: Number(document.getElementById('strategySlippageBpsInput').value || 0),
      automaticTrading: false
    });
    delete payload.validationMode;
    delete payload.maxCandidates;
    aiResearchStartQuant('/api/quant/strategy-labs', payload).catch(function(error) { alert(error.message); });
  });
  document.getElementById('runStrategyLabBtn').addEventListener('click', function() {
    const datasetId = document.getElementById('quantDatasetSelect').value;
    if (!datasetId) return alert('请先选择一个包含足够历史日线的数据集。');
    const testDays = Number(document.getElementById('strategyTestDaysInput').value || 63);
    const payload = Object.assign(aiResearchStrategyPayload(), {
      datasetId: datasetId,
      maxFolds: Number(document.getElementById('strategyMaxFoldsInput').value || 4),
      validationDays: Number(document.getElementById('strategyValidationDaysInput').value || 63),
      testDays: testDays,
      stepDays: testDays,
      commissionBps: Number(document.getElementById('strategyCommissionBpsInput').value || 0),
      stampDutyBps: Number(document.getElementById('strategyStampDutyBpsInput').value || 0),
      slippageBps: Number(document.getElementById('strategySlippageBpsInput').value || 0),
      automaticTrading: false
    });
    aiResearchStartQuant('/api/quant/strategy-labs', payload).catch(function(error) { alert(error.message); });
  });
  document.getElementById('runStrategyDailyBtn').addEventListener('click', function() {
    const datasetId = document.getElementById('quantDatasetSelect').value;
    if (!datasetId) return alert('请先选择一个包含足够历史日线的数据集。');
    if (!confirm('将依次运行均线、MACD、RSI和放量突破四类研究。候选只做下一交易日人工观察，继续？')) return;
    const testDays = Number(document.getElementById('strategyTestDaysInput').value || 63);
    aiResearchStartQuant('/api/quant/strategy-daily', {
      datasetId: datasetId,
      maxFolds: Number(document.getElementById('strategyMaxFoldsInput').value || 4),
      validationDays: Number(document.getElementById('strategyValidationDaysInput').value || 63),
      testDays: testDays,
      stepDays: testDays,
      commissionBps: Number(document.getElementById('strategyCommissionBpsInput').value || 0),
      stampDutyBps: Number(document.getElementById('strategyStampDutyBpsInput').value || 0),
      slippageBps: Number(document.getElementById('strategySlippageBpsInput').value || 0),
      automaticTrading: false,
      trigger: 'manual'
    }).catch(function(error) { alert(error.message); });
  });
  document.getElementById('runResearchSuiteBtn').addEventListener('click', function() {
    const datasetId = document.getElementById('quantDatasetSelect').value;
    if (!datasetId) return alert('请先同步或选择一个全市场数据集。');
    if (!confirm('将依次运行 LightGBM、因子样本外门禁和受控股票池 MASTER。任务可能持续数小时，继续？')) return;
    aiResearchStartQuant('/api/quant/research-suite', { datasetId: datasetId })
      .catch(function(error) { alert(error.message); });
  });
  document.getElementById('quantDatasetSelect').addEventListener('change', function() {
    aiResearchRenderFactorLab();
    aiResearchRenderStrategyLab();
    aiResearchRenderStrategyDaily();
  });
  document.getElementById('quantModelSelect').addEventListener('change', aiResearchRenderQuantResult);
  document.getElementById('cancelQuantJobBtn').addEventListener('click', async function() {
    const active = aiResearchActiveQuantJob();
    if (!active || !confirm('停止当前量化任务？已写入的数据文件会保留用于排查。')) return;
    await aiResearchApi('/api/quant/jobs/' + encodeURIComponent(active.id), { method: 'DELETE' });
    await aiResearchLoadQuant();
  });
  document.getElementById('quantResultPanel').addEventListener('dblclick', aiResearchOpenQuantCandidate);
  document.getElementById('factorLabPanel').addEventListener('dblclick', aiResearchOpenQuantCandidate);
  document.getElementById('strategyDailyPanel').addEventListener('dblclick', aiResearchOpenQuantCandidate);
  document.getElementById('signalScanPanel').addEventListener('click', function(event) {
    const action = event.target.closest('[data-signal-action]');
    const row = event.target.closest('[data-quant-code]');
    if (!action || !row) return;
    if (action.getAttribute('data-signal-action') === 'watch') {
      action.disabled = true;
      aiResearchAddSignalCandidate(row).catch(function(error) {
        alert(error.message);
        action.disabled = false;
      });
      return;
    }
    aiResearchOpenQuantCandidate(event);
  });
  document.getElementById('signalScanPanel').addEventListener('dblclick', aiResearchOpenQuantCandidate);
  document.getElementById('watchlistResearchPanel').addEventListener('dblclick', aiResearchOpenQuantCandidate);
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
  aiResearchScheduleStrategyDaily();
}

window.AIResearch = {
  bind: aiResearchBind,
  prefetchModels: aiResearchPrefetchModels,
  ensureLoaded: aiResearchEnsureLoaded,
  reload: function() { return aiResearchEnsureLoaded(true); },
  reviewScreener: aiResearchReviewScreener,
  getSourceCount: function() { return aiResearchSources.length; }
};
