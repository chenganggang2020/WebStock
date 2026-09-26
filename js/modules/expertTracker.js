let expertChannels = [];
let expertObservations = [];
let expertBacktests = [];
let expertCurveCharts = [];
let expertDouyinSyncState = null;
let expertDouyinSyncRuns = [];
let expertSyncStatusTimer = null;
let expertSyncStatusPollActive = false;
let expertTrackerBound = false;
let expertSelectedVideoId = 0;
let expertCreatorSearch = '';
let expertCreatorStatus = 'all';
let expertCreatorTopic = '';
let expertInitialLoadPromise = null;
let expertAnalysisPacket = null;
let expertAnalysisPacketRequestId = 0;
let expertCreatorTaskDate = '';
let expertCreatorTaskDateMode = 'all';
let expertCreatorTaskRunsRequestId = 0;
let expertCreatorTaskRuns = [];
let expertCreatorTaskRunsKey = '';
let expertCreatorTaskRunsLoading = false;
let expertCreatorTaskRunsError = '';
let expertCreatorSelectedRunId = 0;
let expertTimelineRequestId = 0;
let expertTimelineLoading = false;
let expertTimelineError = '';
let expertAuthorSelectionId = 0;
let expertSyncSaveSelectionId = -1;
const expertCreatorQueueDrafts = new Map();
const expertCommentCache = new Map();

const MODEL_MR_DOUYIN_PROFILE_URL = 'https://www.douyin.com/user/MS4wLjABAAAAK713M9d8PGNb_WiMYf7yKhOI5y60H4uELJK2guDjJT0';

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

function expertSelectedChannel() {
  const channelId = expertSelectedChannelId();
  return expertChannels.find(function(item) { return item.id === channelId; }) || null;
}

function expertSyncAuthorConfiguration() {
  const channel = expertSelectedChannel();
  const media = document.getElementById('creatorMediaPreference');
  const industry = document.getElementById('creatorIndustryAutomatic');
  if (media && !media.disabled) media.value = channel?.collectionMediaType || 'all';
  if (industry && !industry.disabled) industry.checked = Boolean(channel?.industryAnalysisEnabled);
}

function expertSaveCreatorQueueDraft() {
  expertCreatorQueueDrafts.set(expertSelectedChannelId(), {
    mode: document.getElementById('creatorCurrentMode')?.value || 'incremental',
    model: document.getElementById('creatorCurrentModel')?.value || 'large-v3-turbo'
  });
}

function expertIsDouyinUrl(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase();
    return host === 'douyin.com' || host.endsWith('.douyin.com');
  } catch (error) {
    return false;
  }
}

function expertDouyinVideoId(value) {
  if (!expertIsDouyinUrl(value)) return '';
  try {
    const url = new URL(String(value || ''));
    const pathMatch = url.pathname.match(/\/(?:m\/)?video\/(\d{12,24})(?:\/|$)/i);
    if (pathMatch) return pathMatch[1];
    const playerId = url.hostname.toLowerCase() === 'open.douyin.com' ? String(url.searchParams.get('vid') || '') : '';
    if (/^\d{12,24}$/.test(playerId)) return playerId;
    const overlayId = String(url.searchParams.get('modal_id') || url.searchParams.get('aweme_id') || '');
    return /^\d{12,24}$/.test(overlayId) ? overlayId : '';
  } catch (error) {
    return '';
  }
}

function expertDouyinPlayerUrl(value) {
  const videoId = expertDouyinVideoId(value);
  return videoId ? 'https://open.douyin.com/player/video?vid=' + videoId + '&autoplay=0' : '';
}

function expertSyncChannelControls() {
  expertSyncAuthorConfiguration();
  const activeName = document.getElementById('creatorActiveName');
  if (activeName) activeName.textContent = expertSelectedChannel()?.displayName || '请选择作者';
  const isDouyin = Boolean(expertSelectedChannel() && expertSelectedChannel().platform === 'douyin');
  const hasDesktopSession = Boolean(window.webstockDesktop &&
    typeof window.webstockDesktop.openDouyinSession === 'function' &&
    typeof window.webstockDesktop.collectDouyinPage === 'function');
  const searchButton = document.getElementById('openDouyinSearchBtn');
  const importer = document.getElementById('expertDouyinImporter');
  const desktopControls = document.getElementById('douyinDesktopControls');
  const autoSyncPanel = document.getElementById('douyinAutoSyncPanel');
  const taskButton = document.getElementById('openCreatorTasksBtn');
  const packetCard = document.getElementById('expertAnalysisPacketCard');
  if (searchButton) searchButton.hidden = !isDouyin || hasDesktopSession;
  if (importer) importer.hidden = !isDouyin;
  if (desktopControls) desktopControls.hidden = !isDouyin || !hasDesktopSession;
  if (autoSyncPanel) autoSyncPanel.hidden = !isDouyin || !hasDesktopSession;
  if (taskButton) taskButton.hidden = !isDouyin;
  if (packetCard) packetCard.hidden = !isDouyin;
  if (isDouyin && hasDesktopSession) {
    expertRefreshDouyinSessionStatus();
  }
  expertRenderCreatorTaskPipeline();
}

function expertSetDouyinSessionStatus(message, isError) {
  const target = document.getElementById('douyinDesktopSessionStatus');
  if (!target) return;
  target.textContent = message || '';
  target.classList.toggle('error', !!isError);
}

async function expertRefreshDouyinSessionStatus() {
  if (!window.webstockDesktop || typeof window.webstockDesktop.getDouyinSessionStatus !== 'function') return;
  try {
    const status = await window.webstockDesktop.getDouyinSessionStatus();
    expertSetDouyinSessionStatus(status && status.windowOpen
      ? '登录窗口已打开；后台采集与该窗口共享登录状态。'
      : '登录状态保存在本机；自动任务会在后台使用该会话。');
  } catch (error) {
    expertSetDouyinSessionStatus(error.message, true);
  }
}

function expertRenderDouyinSyncState() {
  const target = document.getElementById('douyinAutoSyncSummary');
  const toggle = document.getElementById('douyinAutoSyncToggle');
  if (!target || !toggle) return;
  toggle.disabled = !expertDouyinSyncState || expertSyncSaveSelectionId === expertAuthorSelectionId;
  if (!expertDouyinSyncState) {
    toggle.checked = false;
    target.textContent = expertCreatorTaskRunsLoading ? '正在读取当前作者的自动采集状态…'
      : expertCreatorTaskRunsError ? '自动采集状态读取失败：' + expertCreatorTaskRunsError : '尚未读取自动同步状态。';
    expertRenderCreatorTaskPipeline();
    expertRenderCreatorRunAudit();
    return;
  }
  toggle.checked = Boolean(expertDouyinSyncState.enabled);
  const progress = expertDouyinSyncState.progress || {};
  const result = expertDouyinSyncState.lastResult || {};
  const checkOnly = progress.checkOnly === true ||
    (expertDouyinSyncState.status !== 'running' && result.checkOnly === true);
  const updateCandidateCount = progress.updateCandidateCount == null
    ? Number(result.updateCandidateCount || 0) : Number(progress.updateCandidateCount || 0);
  const statusLabel = expertDouyinSyncState.status === 'running' ? '正在采集'
    : expertDouyinSyncState.status === 'error' ? '上次失败' : expertDouyinSyncState.enabled ? '监控中' : '已暂停';
  const parts = [
    statusLabel,
    expertDouyinSyncState.lastCompletedAt ? '上次结束 ' + expertFormatTime(expertDouyinSyncState.lastCompletedAt) : '尚未完成自动同步',
    expertDouyinSyncState.nextRunAt ? '下次 ' + expertFormatTime(expertDouyinSyncState.nextRunAt) : '',
    checkOnly ? '只读检查' : '',
    checkOnly ? '更新候选 ' + updateCandidateCount + ' 条' : '',
    result.discoveredCount != null ? '发现 ' + Number(result.discoveredCount) + ' 条' : '',
    result.reanalyzedCount ? '重算历史 ' + Number(result.reanalyzedCount) + ' 条' : '',
    !checkOnly && result.detailedCount != null ? '提取详情 ' + Number(result.detailedCount) + ' 条' : '',
    !checkOnly && result.transcribedCount != null ? '语音转写 ' + Number(result.transcribedCount) + ' 条' : '',
    result.transcriptErrors && result.transcriptErrors.length ? '转写失败 ' + result.transcriptErrors.length + ' 条' : '',
    result.processingOutcome?.state === 'partial' ? '仍有待处理步骤' : '',
    result.processingOutcome?.reviewCount ? '文稿待复核 ' + Number(result.processingOutcome.reviewCount) + ' 篇' : '',
    result.addedCount != null ? '新增 ' + Number(result.addedCount) + ' 条' : ''
  ].filter(Boolean);
  target.innerHTML = '<span class="douyin-sync-state ' + expertEscape(expertDouyinSyncState.status) + '">' +
    expertEscape(parts.join(' · ')) + '</span>' +
    (expertDouyinSyncState.lastError ? '<span class="error">' + expertEscape(expertDouyinSyncState.lastError) + '</span>' : '');
  expertRenderCreatorWorkbench();
  expertRenderCreatorTaskPipeline();
  expertRenderCreatorRunAudit();
}

function expertPipelineStepState(index, activeIndex, failedIndex, completed) {
  if (completed || index < activeIndex) return 'done';
  if (index === failedIndex) return 'error';
  if (index === activeIndex) return 'active';
  return 'pending';
}

function expertRenderCreatorTaskPipeline() {
  const target = document.getElementById('creatorTaskPipeline');
  if (!target) return;
  const channel = expertSelectedChannel();
  const statusTarget = document.getElementById('creatorTaskStatus');
  const timeTarget = document.getElementById('creatorTaskProgressTime');
  if (statusTarget) statusTarget.textContent = channel && channel.platform === 'douyin'
    ? channel.displayName + ' · ' + Number(channel.observationCount || 0) + ' 条资料'
    : '选择一个抖音创作者';
  if (!channel || channel.platform !== 'douyin') {
    target.innerHTML = '<div class="empty-state compact">请先选择一个抖音创作者任务。</div>';
    if (timeTarget) timeTarget.textContent = '尚未运行';
    return;
  }
  const sync = expertDouyinSyncState || {};
  const progress = sync.progress || {};
  const result = sync.lastResult || {};
  const latestRun = expertDouyinSyncRuns[0] || {};
  const running = sync.status === 'running';
  const checkOnly = progress.checkOnly === true || (!running && result.checkOnly === true);
  const updateCandidateCount = progress.updateCandidateCount == null
    ? Number(result.updateCandidateCount || 0) : Number(progress.updateCandidateCount || 0);
  const stage = progress.stage || '';
  const processing = progress.processingOutcome || result.processingOutcome || {};
  const completed = stage === 'completed' || (!running && Boolean(sync.lastCompletedAt) && sync.status !== 'error');
  const stageIndexes = { session: 0, processing: 2, saving: 4 };
  const failedIndex = stage === 'failed' ? (stageIndexes[progress.failedStage] == null ? 0 : stageIndexes[progress.failedStage]) : -1;
  const activeIndex = stage === 'saving' ? 4 : stage === 'processing' ? 2 : running ? 0 : completed ? 5 : failedIndex >= 0 ? failedIndex : 0;
  const workCount = progress.workCount == null
    ? (result.workCount == null ? latestRun.workCount : result.workCount) : progress.workCount;
  const discovered = progress.discoveredCount == null
    ? (result.discoveredCount == null ? latestRun.discoveredCount : result.discoveredCount) : progress.discoveredCount;
  const detailTotal = progress.detailTotal == null
    ? (result.candidateCount == null ? latestRun.candidateCount : result.candidateCount) : progress.detailTotal;
  const detailed = progress.detailedCount == null
    ? (result.detailedCount == null ? latestRun.detailedCount : result.detailedCount) : progress.detailedCount;
  const detailErrors = progress.detailErrorCount == null
    ? (Array.isArray(result.detailErrors) ? result.detailErrors.length : Number(latestRun.detailErrorCount || 0))
    : Number(progress.detailErrorCount || 0);
  const transcriptionAttempts = progress.transcriptionAttemptedCount == null
    ? Number(result.transcriptionAttemptedCount == null ? latestRun.transcriptionAttemptedCount || 0 : result.transcriptionAttemptedCount)
    : Number(progress.transcriptionAttemptedCount || 0);
  const transcribed = progress.transcribedCount == null
    ? (result.transcribedCount == null ? latestRun.transcribedCount : result.transcribedCount) : progress.transcribedCount;
  const mediaMissing = progress.mediaMissingCount == null
    ? Number(result.mediaMissingCount == null ? latestRun.mediaMissingCount || 0 : result.mediaMissingCount)
    : Number(progress.mediaMissingCount || 0);
  const transcriptErrors = progress.transcriptErrorCount == null
    ? (Array.isArray(result.transcriptErrors) ? result.transcriptErrors.length : Number(latestRun.transcriptErrorCount || 0))
    : Number(progress.transcriptErrorCount || 0);
  const transcriptionDeferred = progress.transcriptionDeferredCount == null
    ? Number(result.transcriptionDeferredCount == null ? latestRun.transcriptionDeferredCount || 0 : result.transcriptionDeferredCount)
    : Number(progress.transcriptionDeferredCount || 0);
  const steps = [
    ['会话检查', running && activeIndex === 0 ? '正在核对登录状态' : '使用本机持久登录会话'],
    ['主页发现', discovered == null ? '等待读取作品列表' :
      '主页总数 ' + Number(workCount || 0) + ' · 本轮加载 ' + Number(discovered) + ' 条' +
      (checkOnly ? ' · 更新候选 ' + updateCandidateCount + ' 条' : '')],
    ['详情采集', checkOnly ? '本轮仅检查，未执行' : detailTotal == null ? '等待采集详情' :
      '成功 ' + Number(detailed || 0) + ' / 尝试 ' + Number(detailTotal || 0) + (detailErrors ? ' · 失败 ' + detailErrors : '')],
    ['文稿处理', checkOnly ? '本轮仅检查，未执行' : transcribed == null ? '等待本地 ASR/OCR' :
      '语音 ' + Number(transcribed || 0) + ' / 尝试 ' + transcriptionAttempts +
      (processing.ocrCompletedCount ? ' · 图文识别 ' + Number(processing.ocrCompletedCount) : '') +
      (processing.reviewCount ? ' · 待复核 ' + Number(processing.reviewCount) : '') +
      (transcriptionDeferred ? ' · 环境未就绪 ' + transcriptionDeferred : '') +
      (mediaMissing ? ' · 缺媒体 ' + mediaMissing : '') + (transcriptErrors ? ' · 失败 ' + transcriptErrors : '')],
    ['保存入库', checkOnly && completed ? '检查结果已记录' : completed ? '本轮结果已保存' :
      stage === 'saving' ? '正在写入研究库' : '等待前序步骤']
  ];
  target.innerHTML = '<div class="creator-pipeline-steps">' + steps.map(function(step, index) {
    let state = expertPipelineStepState(index, activeIndex, failedIndex, completed);
    if (completed && index === 2 && detailErrors) state = 'error';
    if (completed && index === 3 && ['partial','needs_review'].includes(processing.state)) {
      state = transcriptErrors || processing.archiveErrorCount ? 'error' : 'pending';
    }
    return '<div class="creator-pipeline-step ' + state + '"><span>' + (index + 1) + '</span><div><strong>' +
      expertEscape(step[0]) + '</strong><small>' + expertEscape(step[1]) + '</small></div></div>';
  }).join('') + '</div><p class="creator-pipeline-message ' + (sync.status === 'error' ? 'error' : '') + '">' +
    expertEscape(progress.message || (completed ? '本轮采集已完成' : sync.lastError || '等待下一次采集')) + '</p>';
  if (timeTarget) {
    timeTarget.textContent = running ? '开始于 ' + expertFormatTime(sync.lastStartedAt)
      : sync.lastCompletedAt ? '完成于 ' + expertFormatTime(sync.lastCompletedAt)
        : sync.nextRunAt ? '下次 ' + expertFormatTime(sync.nextRunAt) : '尚未运行';
  }
}

function expertRunStatusLabel(status, type) {
  const detailLabels = {
    pending: '等待详情', running: '正在采详情', complete: '详情完成',
    rejected: '身份不匹配', error: '详情失败'
  };
  const transcriptionLabels = {
    not_ready: '尚未进入转写', waiting_media: '正在检查媒体', downloading: '正在下载媒体',
    transcribing: '正在本地识别', complete: '转写完成', needs_review: '转写待复核', media_missing: '等待媒体地址',
    deferred_limit: '本轮顺延', runtime_missing: '等待转写环境', model_missing: '等待模型安装', error: '转写失败', archive_pending: '等待归档回填',
    archiving: '正在归档旧视频', archive_complete: '旧视频归档完成',
    archive_missing: '回填缺媒体地址', archive_error: '旧视频归档失败',
    ocr: '正在识别图片', ocr_complete: '图片文字已识别', ocr_partial: '部分图片待处理',
    ocr_error: '图片识别失败', no_speech: '未检测到口语', no_text: '图片未识别到文字', not_requested: '本轮未请求转写'
  };
  return (type === 'detail' ? detailLabels : transcriptionLabels)[status] || status || '状态未知';
}

function expertFormatMediaBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '';
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
}

function expertRunOutcome(run) {
  const items = Array.isArray(run.items) ? run.items : [];
  const pending = items.filter(item => item.detailStatus !== 'complete' || !['complete', 'needs_review', 'no_speech', 'no_text', 'archive_complete', 'ocr_complete', 'not_requested'].includes(item.transcriptionStatus));
  const missingRuntime = pending.filter(item => item.transcriptionStatus === 'runtime_missing').length;
  if (run.status === 'running') return { label: '运行中', state: 'running', explanation: run.message || '' };
  if (run.status === 'error') return { label: '运行失败', state: 'error', explanation: run.error || run.message || '' };
  const outcome = run.result?.processingOutcome || {};
  if (run.result?.checkOnly === true || outcome.state === 'checked') return {
    label: '更新检查完成', state: 'completed', explanation: '本轮只检查更新，未执行媒体采集或文稿处理。'
  };
  const pendingCount = Math.max(pending.length, Number(outcome.pendingCount) || 0);
  const reviewCount = Math.max(items.filter(item => item.transcriptionStatus === 'needs_review').length, Number(outcome.reviewCount) || 0);
  const partial = pendingCount > 0 || outcome.state === 'partial';
  return {
    label: partial ? '本轮结束 · ' + (pendingCount ? '至少 ' + pendingCount + ' 项' : '') + '待处理'
      : reviewCount ? '本轮结束 · ' + reviewCount + ' 篇文稿待复核' : '本轮机器处理完成',
    state: partial ? 'partial' : reviewCount ? 'needs_review' : 'completed',
    explanation: missingRuntime ? missingRuntime + ' 条详情已保存，但未启动语音转写：本地识别环境未就绪。请先安装或关联转写环境，再重试。'
      : partial ? '仍有未完成步骤；已取得的资料保留，请查看各作品的失败或顺延原因。' + (reviewCount ? '另有 ' + reviewCount + ' 篇文稿待复核。' : '')
        : reviewCount ? '机器已生成文字，但仍有质量风险；待复核不等于已通过，也不会自动作为可靠文稿入图。'
          : '本轮机器处理已完成，不代表人工已校对，也不代表已采集全部历史。'
  };
}

function expertDouyinWorkId(value) {
  const videoId=expertDouyinVideoId(value);
  if (videoId || !expertIsDouyinUrl(value)) return videoId;
  try { return (new URL(value).pathname.match(/^\/note\/(\d{12,24})\/?$/)||[])[1]||''; }
  catch (_) { return ''; }
}

function expertBeijingDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(parsed);
}

function expertCreatorTaskItems(run) {
  return Array.isArray(run && run.items) ? run.items : [];
}

function expertCreatorTaskScopeKey() {
  return expertSelectedChannelId() + ':' + (expertCreatorTaskDateMode === 'all' ? 'all' : expertCreatorTaskDate);
}

function expertSelectCreatorRun(runId) {
  const run = expertCreatorTaskRuns.find(function(item) { return Number(item.id) === Number(runId); });
  if (!run) return;
  ++expertCreatorTaskRunsRequestId;
  expertCreatorTaskRunsLoading = false;
  expertCreatorTaskRunsError = '';
  expertCreatorSelectedRunId = Number(run.id);
  // Runs from the all-history view must retain their real Beijing execution day.
  expertCreatorTaskDate = expertBeijingDate(run.startedAt) || expertCreatorTaskDate;
  document.getElementById('creatorTaskDate').value = expertCreatorTaskDate;
  expertCreatorTaskDateMode = 'run';
  document.getElementById('creatorTaskDateMode').value = 'run';
  expertCreatorTaskRuns = [run];
  expertCreatorTaskRunsKey = expertCreatorTaskScopeKey();
  expertResetCreatorFilters();
  expertRenderCreatorWorkbench();
  expertRenderCreatorRunAudit();
}

function expertCreatorScopeMessage() {
  if (expertCreatorTaskDateMode === 'all') return '全部本地历史；视频列表最多载入 500 条，运行记录最多 100 次。';
  if (expertCreatorTaskDateMode === 'published') return expertCreatorTaskDate + ' 发布的本地作品（北京时间）；首次采集时间不作为发布日期。未采集到不代表作者未发布。';
  if (expertCreatorTaskRunsLoading) return '正在读取所选日期的运行记录…';
  if (expertCreatorTaskRunsError) return '运行记录读取失败：' + expertCreatorTaskRunsError + '。不会用历史视频替代。';
  const label = expertCreatorSelectedRunId ? '第 ' + expertCreatorSelectedRunId + ' 次任务' : expertCreatorTaskDate + ' 启动的任务（最多 100 次）';
  return label + ' 实际处理的视频，可包含历史补采；不是当天新发布作品。仅匹配本地最近 500 条资料；无处理明细不显示历史视频。';
}

function expertRenderCreatorRunAudit() {
  const target = document.getElementById('creatorTaskRunHistory');
  const count = document.getElementById('creatorTaskRunCount');
  if (!target || !count) return;
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') {
    count.textContent = '尚未选择任务';
    target.innerHTML = '<div class="empty-state compact">选择抖音创作者后查看后台运行明细。</div>';
    return;
  }
  const runs = expertCreatorTaskRunsKey === expertCreatorTaskScopeKey() ? expertCreatorTaskRuns : [];
  count.textContent = expertCreatorTaskRunsLoading ? '正在读取…' : (expertCreatorTaskDateMode === 'all' ? '全部日期' : expertCreatorTaskDate) + ' · ' + runs.length + ' 次运行（最多 100 次）';
  if (expertCreatorTaskRunsLoading || expertCreatorTaskRunsError) {
    target.innerHTML = '<div class="empty-state compact">' + expertEscape(expertCreatorTaskRunsError || '正在读取所选日期的运行记录…') + '</div>';
    return;
  }
  if (!runs.length) {
    target.innerHTML = '<div class="empty-state compact">所选日期没有运行记录。任务按北京时间的启动日期归类，与视频发布日期不同。</div>';
    return;
  }
  const triggerLabels = { manual: '手动运行', scheduled: '定时运行', startup: '启动补采', archive: '完整清单扫描' };
  const expanded = new Map(target.querySelectorAll ? Array.from(target.querySelectorAll('details[data-audit-run-id]')).map(function(element) {
    return [String(element.dataset.auditRunId), element.open];
  }) : []);
  target.innerHTML = runs.map(function(run, index) {
    const outcome = expertRunOutcome(run);
    const items = expertCreatorTaskItems(run);
    const runResult = run.result && typeof run.result === 'object' ? run.result : {};
    const runQueue = runResult.archiveQueue || {};
    const newlyArchived = runQueue.before && runQueue.after
      ? Math.max(Number(runQueue.after.archivedCount || 0) - Number(runQueue.before.archivedCount || 0), 0)
      : Number(runResult.archivedCount || 0);
    const totals = [
      '主页总作品 ' + Number(run.workCount || 0),
      '本轮页面加载 ' + Number(run.discoveredCount || 0),
      '发现新增 ' + Number(runResult.discoveryAddedCount || 0),
      '详情 ' + Number(run.detailedCount || 0) + ' / ' + Number(run.candidateCount || 0),
      '转写 ' + Number(run.transcribedCount || 0) + ' / 尝试 ' + Number(run.transcriptionAttemptedCount || 0),
      Number(runResult.transcriptionDeferredCount || 0) ? '等待转写环境 ' + Number(runResult.transcriptionDeferredCount) : '',
      newlyArchived ? '新增永久归档记录 ' + newlyArchived : '',
      Array.isArray(runResult.archiveErrors) && runResult.archiveErrors.length
        ? '归档未完成 ' + runResult.archiveErrors.length : '',
      run.mediaMissingCount ? '缺媒体 ' + Number(run.mediaMissingCount) : '',
      run.detailErrorCount ? '详情失败 ' + Number(run.detailErrorCount) : '',
      run.transcriptErrorCount ? '转写失败 ' + Number(run.transcriptErrorCount) : ''
    ].filter(Boolean);
    const open = expanded.has(String(run.id)) ? expanded.get(String(run.id)) : index === 0;
    return '<details class="creator-task-run" data-audit-run-id="' + expertEscape(run.id) + '"' + (open ? ' open' : '') + '><summary>' +
      '<span><strong>' + expertEscape(triggerLabels[run.trigger] || run.trigger) + '</strong><time>' +
        expertEscape(expertFormatTime(run.startedAt)) + '</time></span>' +
      '<em class="creator-run-status ' + outcome.state + '">' +
        expertEscape(outcome.label) + '</em></summary>' +
      '<div class="creator-run-totals">' + totals.map(function(total) {
        return '<span>' + expertEscape(total) + '</span>';
      }).join('') + '</div>' +
      '<p class="creator-run-explanation">' + expertEscape(outcome.explanation) + '</p>' +
      '<button type="button" class="small-btn creator-run-view-btn" data-run-id="' + expertEscape(run.id) + '">查看本轮视频</button>' +
      (run.error ? '<p class="creator-run-error">' + expertEscape(run.error) + '</p>' : '') +
      (items.length ? '<div class="creator-run-items">' + items.map(function(item) {
        const saved = expertObservations.find(observation => String(observation.externalContentId || '') === String(item.contentId));
        const title = expertDisplayTitle(saved || item);
        const media = expertFormatMediaBytes(item.mediaBytes);
        const timing = item.elapsedSeconds ? Number(item.elapsedSeconds).toFixed(1) + ' 秒' : '';
        return '<article class="creator-run-item"><div><strong>' + expertEscape(title.text) +
          '</strong><small>发布于 ' + expertEscape(saved && saved.publishedAt ? expertFormatTime(saved.publishedAt) : '发布时间待核验') + ' · 首次采集于 ' + expertEscape(saved && saved.firstSeenAt ? expertFormatTime(saved.firstSeenAt) : '首次采集时间待核验') + ' · ' + expertEscape(item.contentId) + '</small></div>' +
          '<span class="creator-run-chip detail ' + expertEscape(item.detailStatus) + '">' +
            expertEscape(expertRunStatusLabel(item.detailStatus, 'detail')) + '</span>' +
          '<span class="creator-run-chip transcription ' + expertEscape(item.transcriptionStatus) + '">' +
            expertEscape(expertRunStatusLabel(item.transcriptionStatus, 'transcription')) + '</span>' +
          '<p>' + expertEscape(item.message || '暂无阶段说明') +
            (media || timing ? '<small>' + expertEscape([media, timing].filter(Boolean).join(' · ')) + '</small>' : '') + '</p></article>';
      }).join('') + '</div>' : '<div class="empty-state compact">本轮没有需要打开详情页的视频。</div>') + '</details>';
  }).join('');
}

async function expertLoadNetworkRoute() {
  const target = document.getElementById('creatorTaskNetworkRoute');
  if (!target) return;
  if (!window.webstockDesktop || typeof window.webstockDesktop.getDouyinNetworkRoute !== 'function') {
    target.className = 'creator-network-route unknown';
    target.innerHTML = '<span class="creator-route-dot"></span><div><small>抖音流量路径</small><strong>仅桌面程序可检查</strong></div>';
    return;
  }
  try {
    const route = await window.webstockDesktop.getDouyinNetworkRoute();
    const throughFastVpn = route.mode === 'proxy' && route.endpoint === '127.0.0.1:7891';
    const label = throughFastVpn ? '快车 / 系统代理' : route.label || '路径未知';
    target.className = 'creator-network-route ' + expertEscape(route.mode || 'unknown');
    target.innerHTML = '<span class="creator-route-dot"></span><div><small>抖音流量路径</small><strong>' +
      expertEscape(label) + (route.endpoint ? ' · ' + expertEscape(route.endpoint) : '') + '</strong></div>';
  } catch (error) {
    target.className = 'creator-network-route unknown';
    target.innerHTML = '<span class="creator-route-dot"></span><div><small>抖音流量路径</small><strong>' +
      expertEscape(error.message || '检查失败') + '</strong></div>';
  }
}

async function expertLoadDouyinSyncState() {
  const channel = expertSelectedChannel();
  const requestId = ++expertCreatorTaskRunsRequestId;
  if (!channel || channel.platform !== 'douyin') {
    expertDouyinSyncState = null;
    expertDouyinSyncRuns = [];
    expertCreatorTaskRuns = [];
    expertCreatorTaskRunsKey = '';
    expertCreatorTaskRunsLoading = false;
    expertRenderDouyinSyncState();
    return;
  }
  const date = document.getElementById('creatorTaskDate');
  const mode = document.getElementById('creatorTaskDateMode');
  expertCreatorTaskDate = date && date.value || expertBeijingDate(new Date());
  if (date) date.value = expertCreatorTaskDate;
  expertCreatorTaskDateMode = mode ? mode.value : 'all';
  if (date) date.disabled = expertCreatorTaskDateMode === 'all';
  const key = expertCreatorTaskScopeKey();
  const previousData = JSON.stringify([expertDouyinSyncState, expertDouyinSyncRuns, expertCreatorTaskRuns]);
  const scopeChanged = expertCreatorTaskRunsKey !== key;
  const hadError = Boolean(expertCreatorTaskRunsError);
  if (expertCreatorTaskRunsKey !== key) {
    expertCreatorTaskRuns = [];
    expertCreatorSelectedRunId = 0;
  }
  expertCreatorTaskRunsLoading = expertCreatorTaskRunsKey !== key;
  expertCreatorTaskRunsError = '';
  if (scopeChanged) {
    expertRenderCreatorRunAudit();
    expertRenderCreatorWorkbench();
  }
  const query = expertCreatorTaskDateMode === 'all' ? 'limit=100' : 'date=' + encodeURIComponent(expertCreatorTaskDate) + '&limit=100';
  try {
    const response = await Promise.all([
      expertApi('/api/expert/channels/' + channel.id + '/sync'),
      expertApi('/api/expert/channels/' + channel.id + '/sync/runs?limit=6'),
      expertApi('/api/expert/channels/' + channel.id + '/sync/runs?' + query)
    ]);
    if (requestId !== expertCreatorTaskRunsRequestId || expertSelectedChannelId() !== channel.id) return;
    expertDouyinSyncState = response[0];
    expertDouyinSyncRuns = response[1] || [];
    expertCreatorTaskRuns = response[2] || [];
    expertCreatorTaskRunsKey = key;
  } catch (error) {
    if (requestId !== expertCreatorTaskRunsRequestId || expertSelectedChannelId() !== channel.id) return;
    expertCreatorTaskRuns = [];
    expertCreatorTaskRunsError = error.message || '请求失败';
    throw error;
  } finally {
    if (requestId === expertCreatorTaskRunsRequestId && expertSelectedChannelId() === channel.id) {
      expertCreatorTaskRunsLoading = false;
      if (scopeChanged || hadError || expertCreatorTaskRunsError ||
          previousData !== JSON.stringify([expertDouyinSyncState, expertDouyinSyncRuns, expertCreatorTaskRuns])) {
        expertRenderDouyinSyncState();
      }
    }
  }
}

async function expertPollDouyinSyncState() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin' || expertSyncStatusPollActive || expertSyncSaveSelectionId === expertAuthorSelectionId) return;
  expertSyncStatusPollActive = true;
  const channelId = channel.id;
  const previousCompletedAt = expertDouyinSyncState && expertDouyinSyncState.lastCompletedAt;
  try {
    await expertLoadDouyinSyncState();
    const completedAt = expertDouyinSyncState && expertDouyinSyncState.lastCompletedAt;
    if (expertSelectedChannelId() !== channelId || expertTimelineLoading) return;
    if (!expertTimelineError && (!completedAt || completedAt === previousCompletedAt)) return;
    await expertLoadTimeline();
  } finally {
    expertSyncStatusPollActive = false;
  }
}

async function expertToggleDouyinAutoSync() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') return;
  const toggle = document.getElementById('douyinAutoSyncToggle');
  const selectionId = expertAuthorSelectionId;
  expertSyncSaveSelectionId = selectionId;
  ++expertCreatorTaskRunsRequestId;
  toggle.disabled = true;
  try {
    const state = await expertApi('/api/expert/channels/' + channel.id + '/sync', {
      method: 'PUT',
      body: { enabled: toggle.checked, intervalMinutes: 10 }
    });
    if (selectionId !== expertAuthorSelectionId) return;
    expertDouyinSyncState = state;
    expertRenderDouyinSyncState();
  } catch (error) {
    if (selectionId === expertAuthorSelectionId) expertSetDouyinSessionStatus(error.message, true);
  } finally {
    if (selectionId === expertAuthorSelectionId) {
      expertSyncSaveSelectionId = -1;
      expertRenderDouyinSyncState();
    }
  }
}

async function expertRunDouyinAutoSync() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') return;
  if (!window.webstockDesktop || typeof window.webstockDesktop.syncDouyinChannel !== 'function') {
    return alert('自动采集只在 Windows 桌面程序中运行。');
  }
  const button = document.getElementById('runDouyinSyncNowBtn');
  button.disabled = true;
  expertSetDouyinSessionStatus('正在主动采集：检查主页，并对新增或变化作品执行详情、下载和转写...');
  expertDouyinSyncState = Object.assign({}, expertDouyinSyncState || {}, {
    status: 'running',
    lastStartedAt: new Date().toISOString(),
    progress: { stage: 'session', message: '正在检查登录会话' }
  });
  expertRenderDouyinSyncState();
  let progressTimer = null;
  try {
    const syncPromise = window.webstockDesktop.syncDouyinChannel(channel.id);
    progressTimer = setInterval(function() { expertLoadDouyinSyncState().catch(function() {}); }, 1500);
    const result = await syncPromise;
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    await expertLoadChannels();
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    await expertLoadDouyinSyncState();
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    expertSetDouyinSessionStatus('主动采集完成：发现 ' + result.discoveredCount + ' 条，重算历史 ' +
      Number(result.reanalyzedCount || 0) + ' 条，提取详情 ' +
      result.detailedCount + ' 条，语音转写 ' + Number(result.transcribedCount || 0) +
      ' 条，新增 ' + result.addedCount + ' 条，更新 ' + result.updatedCount + ' 条' +
      (Number(result.transcriptionDeferredCount || 0)
        ? '，等待转写环境 ' + Number(result.transcriptionDeferredCount || 0) + ' 条'
        : '') + '。');
  } catch (error) {
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    await expertLoadDouyinSyncState().catch(function() {});
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    expertSetDouyinSessionStatus(error.message, true);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    button.disabled = false;
  }
}

async function expertRunDouyinArchiveScan() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') return;
  if (!window.webstockDesktop || typeof window.webstockDesktop.archiveDouyinChannel !== 'function') {
    return alert('完整作品清单扫描只在 Windows 桌面程序中运行。');
  }
  const button = document.getElementById('runDouyinArchiveScanBtn');
  button.disabled = true;
  expertSetDouyinSessionStatus('正在滚动主页，建立全部公开可见作品清单；详情和媒体将按队列继续处理...');
  expertDouyinSyncState = Object.assign({}, expertDouyinSyncState || {}, {
    status: 'running',
    lastStartedAt: new Date().toISOString(),
    progress: { stage: 'session', message: '正在扫描公开可见作品清单' }
  });
  expertRenderDouyinSyncState();
  let progressTimer = null;
  try {
    const archivePromise = window.webstockDesktop.archiveDouyinChannel(channel.id);
    progressTimer = setInterval(function() { expertLoadDouyinSyncState().catch(function() {}); }, 1500);
    const result = await archivePromise;
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    await expertLoadChannels();
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    await expertLoadDouyinSyncState();
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    const archive = result.archive || {};
    const archiveQueue = result.archiveQueue || {};
    const queueBefore = archiveQueue.before || null;
    const queueAfter = archiveQueue.after || null;
    const archiveErrors = Array.isArray(result.archiveErrors) ? result.archiveErrors : [];
    const detailErrors = Array.isArray(result.detailErrors) ? result.detailErrors : [];
    const newlyArchived = queueBefore && queueAfter
      ? Math.max(Number(queueAfter.archivedCount || 0) - Number(queueBefore.archivedCount || 0), 0)
      : Number(result.archivedCount || 0);
    expertSetDouyinSessionStatus('公开可见清单扫描结束：本地清单发现 ' + Number(result.discoveredCount || 0) +
      ' 条，本次新建 ' + Number(result.discoveryAddedCount || 0) + ' 条；已处理详情 ' +
      Number(result.detailedCount || 0) + ' 条；本轮新增永久归档记录 ' + newlyArchived +
      ' 条，未完成 ' + archiveErrors.length + ' 条' +
      (detailErrors.length ? '；详情失败 ' + detailErrors.length + ' 条' : '') +
      (archiveErrors.length || detailErrors.length ? '（请展开后台采集明细）' : '') +
      (queueBefore && queueAfter ? '；队列处理前待完成 ' + Number(queueBefore.pendingCount || 0) +
        ' 条、已完成 ' + Number(queueBefore.completedCount || 0) + ' 条；处理后待完成 ' +
        Number(queueAfter.pendingCount || 0) + ' 条、已完成 ' + Number(queueAfter.completedCount || 0) + ' 条' : '') +
      '。剩余记录由增量队列继续处理。' +
      (archive.complete ? ' 已覆盖主页报告的作品数。'
        : archive.stoppedReason === 'scroll_limit' ? ' 已达到本次滚动上限，可再次点击继续扫描。'
          : ' 页面已连续无新增，但尚未覆盖主页报告总数，可能受公开可见范围或页面加载限制。'),
      archiveErrors.length > 0 || detailErrors.length > 0);
  } catch (error) {
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    await expertLoadDouyinSyncState().catch(function() {});
    if (expertSelectedChannelId() !== Number(channel.id)) return;
    expertSetDouyinSessionStatus(error.message, true);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    button.disabled = false;
  }
}

function expertOpenTranscriptionSetup() {
  window.switchMainView('aiResearch');
  setTimeout(function() {
    const target = document.getElementById('quantRuntimeStatus');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

function expertUpdateAnalysisPacketControls() {
  const mode = document.getElementById('expertAnalysisPacketMode').value;
  document.getElementById('expertAnalysisPacketLimitField').hidden = mode !== 'recent';
  document.getElementById('expertAnalysisPacketFromField').hidden = mode !== 'date';
  document.getElementById('expertAnalysisPacketToField').hidden = mode !== 'date';
}

function expertResetAnalysisPacket() {
  expertAnalysisPacketRequestId += 1;
  expertAnalysisPacket = null;
  const output = document.getElementById('expertAnalysisPacketOutput');
  const generateButton = document.getElementById('generateExpertAnalysisPacketBtn');
  const copyButton = document.getElementById('copyExpertAnalysisPacketBtn');
  const status = document.getElementById('expertAnalysisPacketStatus');
  const evidence = document.getElementById('expertAnalysisPacketEvidenceSummary');
  const nextStep = document.getElementById('expertAnalysisPacketNextStep');
  if (output) {
    output.value = '';
    output.hidden = true;
  }
  if (generateButton) generateButton.disabled = false;
  if (copyButton) copyButton.disabled = true;
  if (evidence) {
    evidence.textContent = '';
    evidence.hidden = true;
  }
  if (nextStep) {
    nextStep.textContent = '';
    nextStep.hidden = true;
  }
  if (status) {
    status.textContent = '尚未生成';
    status.classList.remove('error');
  }
}

async function expertGenerateAnalysisPacket() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') return;
  const channelId = Number(channel.id);
  const button = document.getElementById('generateExpertAnalysisPacketBtn');
  const status = document.getElementById('expertAnalysisPacketStatus');
  const mode = document.getElementById('expertAnalysisPacketMode').value;
  const purpose = document.getElementById('expertAnalysisPacketPurpose');
  const body = { mode, purpose: purpose ? purpose.value : 'overview' };
  if (mode === 'recent') body.limit = Math.min(Math.max(Number(document.getElementById('expertAnalysisPacketLimit').value) || 10, 1), 1000);
  if (mode === 'date') {
    body.from = document.getElementById('expertAnalysisPacketFrom').value;
    body.to = document.getElementById('expertAnalysisPacketTo').value;
  }
  expertResetAnalysisPacket();
  const requestId = expertAnalysisPacketRequestId;
  button.disabled = true;
  status.textContent = '正在整理逐字稿和来源证据...';
  status.classList.remove('error');
  try {
    const packet = await expertApi('/api/expert/channels/' + channel.id + '/analysis-packet', {
      method: 'POST', body
    });
    const selected = expertSelectedChannel();
    if (requestId !== expertAnalysisPacketRequestId || !selected || Number(selected.id) !== channelId) return;
    expertAnalysisPacket = Object.assign({}, packet, { channelId, request: body });
    const output = document.getElementById('expertAnalysisPacketOutput');
    output.value = expertAnalysisPacket.markdown;
    output.hidden = false;
    document.getElementById('copyExpertAnalysisPacketBtn').disabled = false;
    const evidence = expertAnalysisPacket.evidenceSummary || {};
    const evidenceNode = document.getElementById('expertAnalysisPacketEvidenceSummary');
    evidenceNode.innerHTML = '<strong>文字证据概览</strong>' +
      '<span class="good">完整逐字稿 ' + Number(evidence.asrCount || 0) + '</span>' +
      '<span class="warn">页面文字 ' + Number(evidence.visibleCount || 0) + '</span>' +
      '<span class="muted">无文字 ' + Number(evidence.missingCount || 0) + '</span>';
    evidenceNode.hidden = false;
    const nextStep = document.getElementById('expertAnalysisPacketNextStep');
    nextStep.textContent = expertAnalysisPacket.recommendedAction || '检查材料后复制给 AI。';
    nextStep.hidden = false;
    status.textContent = Number(expertAnalysisPacket.itemCount || 0) + ' 条 · ' +
      Number(expertAnalysisPacket.characterCount || 0).toLocaleString('zh-CN') + ' 字符' +
      (expertAnalysisPacket.warnings && expertAnalysisPacket.warnings.length
        ? ' · ' + expertAnalysisPacket.warnings.join(' ') : ' · 全部为可核对文本');
    status.classList.remove('error');
  } catch (error) {
    if (requestId !== expertAnalysisPacketRequestId) return;
    expertResetAnalysisPacket();
    button.disabled = false;
    status.textContent = error.message;
    status.classList.add('error');
  } finally {
    if (requestId === expertAnalysisPacketRequestId) button.disabled = false;
  }
}

async function expertCopyAnalysisPacket() {
  if (!expertAnalysisPacket || !expertAnalysisPacket.markdown) return;
  const status = document.getElementById('expertAnalysisPacketStatus');
  const channel = expertSelectedChannel();
  if (!channel || Number(channel.id) !== Number(expertAnalysisPacket.channelId)) {
    expertResetAnalysisPacket();
    status.textContent = '研究对象已经切换，请重新整理分析材料。';
    status.classList.add('error');
    return;
  }
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(expertAnalysisPacket.markdown);
    } else {
      const output = document.getElementById('expertAnalysisPacketOutput');
      output.hidden = false;
      output.select();
      if (!document.execCommand('copy')) throw new Error('复制命令未被浏览器允许');
    }
    status.textContent = '已复制 ' + expertAnalysisPacket.itemCount + ' 条资料、' +
      Number(expertAnalysisPacket.characterCount || 0).toLocaleString('zh-CN') + ' 字符，可直接粘贴给 AI。';
    status.classList.remove('error');
  } catch (error) {
    status.textContent = '自动复制失败，请在下方文本框中全选复制：' + error.message;
    status.classList.add('error');
  }
}

function expertRenderChannelOptions() {
  const select = document.getElementById('expertChannelSelect');
  const previous = select.value;
  select.innerHTML = '<option value="">选择研究对象</option>' + expertChannels.map(function(channel) {
    const douyinCount = channel.platform === 'douyin' ? ' · 抖音直链 ' + Number(channel.directDouyinCount || 0) : '';
    return '<option value="' + channel.id + '">[' +
      expertEscape(EXPERT_SUBJECT_LABELS[channel.subjectType] || channel.subjectType || '创作者') + '] ' +
      expertEscape(channel.displayName) + ' · ' + expertEscape(channel.platform) +
      ' (' + channel.observationCount + douyinCount + ')</option>';
  }).join('');
  if (expertChannels.some(function(channel) { return String(channel.id) === previous; })) select.value = previous;
  else if (expertChannels.length) select.value = String(expertChannels[0].id);
  const taskSelect = document.getElementById('creatorTaskChannelSelect');
  if (taskSelect) {
    const taskPrevious = taskSelect.value;
    const douyinChannels = expertChannels.filter(function(channel) { return channel.platform === 'douyin'; });
    taskSelect.innerHTML = '<option value="">选择抖音创作者</option>' + douyinChannels.map(function(channel) {
      return '<option value="' + channel.id + '">' + expertEscape(channel.displayName) +
        ' · ' + Number(channel.observationCount || 0) + ' 条作品资料</option>';
    }).join('');
    if (douyinChannels.some(function(channel) { return String(channel.id) === select.value; })) taskSelect.value = select.value;
    else if (douyinChannels.some(function(channel) { return String(channel.id) === taskPrevious; })) taskSelect.value = taskPrevious;
    else if (douyinChannels.length) taskSelect.value = String(douyinChannels[0].id);
  }
  expertSyncChannelControls();
}

function expertFormatTime(value) {
  if (!value) return '时间未核实';
  if (window.WebStockTime && window.WebStockTime.formatDateTime) {
    try { return window.WebStockTime.formatDateTime(value); } catch (error) {}
  }
  return String(value);
}

function expertFormatMetric(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  if (number >= 10000) return (number / 10000).toFixed(number >= 100000 ? 0 : 1) + '万';
  return String(Math.round(number));
}

function expertFormatOffset(value) {
  const seconds = Math.max(Number(value) || 0, 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
}

function expertCreatorVideos() {
  return expertObservations.filter(function(item) {
    return item && (['video','note'].includes(item.mediaType) || (item.externalContentId && expertDouyinWorkId(item.sourceUrl)));
  });
}

function expertCreatorLatestRunItem(item) {
  const contentId = String(item && item.externalContentId || '');
  if (!contentId) return null;
  for (const run of expertDouyinSyncRuns) {
    const match = (run.items || []).find(function(runItem) {
      return String(runItem.contentId || '') === contentId;
    });
    if (match) return match;
  }
  return null;
}

function expertCreatorAsrStatus(item) {
  if (item && item.mediaType==='note') {
    const note=item.mediaMetadata && item.mediaMetadata.note || {};
    return note.status==='needs_review' || note.status==='complete' ? 'note_ready'
      : note.status==='no_text' ? 'note_no_text' : note.status==='partial' ? 'note_partial' : 'note_pending';
  }
  const asr = item && item.mediaMetadata && item.mediaMetadata.asr ? item.mediaMetadata.asr : {};
  const runItem = expertCreatorLatestRunItem(item) || {};
  if (asr.status === 'complete' && String(item.transcript || '').trim()) return 'complete';
  if (asr.status === 'needs_review' && String(item.transcript || '').trim()) return 'needs_review';
  if (runItem.transcriptionStatus === 'needs_review') return 'needs_review';
  if (asr.status === 'no_speech' || runItem.transcriptionStatus === 'no_speech') return 'no_speech';
  if (runItem.transcriptionStatus === 'model_missing' || asr.status === 'model_missing') return 'model_missing';
  if (runItem.transcriptionStatus === 'runtime_missing' || (!runItem.transcriptionStatus && asr.status === 'runtime_missing')) return 'runtime_missing';
  if (asr.status === 'error' || runItem.transcriptionStatus === 'error' ||
      ['error', 'rejected'].includes(runItem.detailStatus)) return 'error';
  if (asr.status === 'media_missing' || runItem.transcriptionStatus === 'media_missing') return 'media_missing';
  if (runItem.transcriptionStatus === 'complete') return 'processing';
  if (['downloading', 'transcribing', 'waiting_media'].includes(runItem.transcriptionStatus)) return 'processing';
  if (runItem.transcriptionStatus === 'deferred_limit') return 'deferred';
  if (!item.externalContentId || !expertDouyinVideoId(item.sourceUrl)) return 'manual';
  if (!runItem.detailStatus && !(item.mediaMetadata && item.mediaMetadata.detailCapturedAt)) return 'detail_pending';
  return 'unverified';
}

function expertCreatorAsrStatusLabel(status, longLabel) {
  const labels = {
    note_ready: '图片文字 · 待校对', note_no_text:'原图已保存 · 未识别到文字',
    note_partial:'图文部分完成', note_pending:'等待采集图文',
    complete: longLabel ? '逐字稿已完成' : '已转写',
    needs_review: longLabel ? '逐字稿需要人工校对' : '转写待校对',
    no_speech: longLabel ? '视频已归档，未检测到可识别语音' : '无口语',
    processing: longLabel ? '正在下载 / 本地识别' : '处理中',
    runtime_missing: longLabel ? '等待本地转写环境' : '等待环境',
    model_missing: '等待模型安装',
    media_missing: longLabel ? '等待可下载媒体地址' : '等待媒体',
    deferred: longLabel ? '本轮转写顺延' : '已顺延',
    detail_pending: longLabel ? '等待采集视频详情' : '待采详情',
    unverified: longLabel ? '转写条件待核验' : '待核验',
    manual: longLabel ? '手工录入的视频资料' : '手工资料',
    error: longLabel ? '采集 / 转写失败' : '失败'
  };
  return labels[status] || (longLabel ? '转写条件待核验' : '待核验');
}

function expertCreatorVerificationStatus(item) {
  const metadata = item && item.mediaMetadata && typeof item.mediaMetadata === 'object'
    ? item.mediaMetadata : {};
  const archive = metadata.archive && typeof metadata.archive === 'object' ? metadata.archive : {};
  const verifiedArchive = archive.status === 'complete' &&
    ['current_content_id', 'historical_sha256'].includes(String(archive.verificationMode || '')) &&
    Boolean(archive.localAssetPath) && /^[a-f0-9]{64}$/i.test(String(archive.mediaSha256 || '')) &&
    Number(archive.mediaBytes || 0) > 0;
  if (!verifiedArchive) return null;
  const remote = metadata.remote && typeof metadata.remote === 'object' ? metadata.remote : {};
  const unavailable = item.availabilityStatus === 'unavailable' || remote.status === 'unavailable';
  return unavailable
    ? { status: 'verified_unavailable', label: '已核验 · 原视频不可访问' }
    : { status: 'verified_archive', label: '已核验归档' };
}

function expertCreatorStatusMessage(item, status) {
  if (status === 'runtime_missing') return '视频详情已保存，本地语音识别环境尚未就绪。请先点击“安装 / 关联转写环境”，然后重新转写；不是视频内容损坏。';
  const asr = item && item.mediaMetadata && item.mediaMetadata.asr ? item.mediaMetadata.asr : {};
  const runItem = expertCreatorLatestRunItem(item) || {};
  if (status === 'needs_review') return '本地识别已经生成简体规范稿，但存在低置信度片段，不应直接当作完整原话。';
  if (status === 'model_missing') return runItem.message || '所选模型尚未完整安装；请改选已安装模型或完成模型安装后重试。';
  if (status === 'no_speech') return asr.message || '视频已经永久保存，本地识别未检测到可转写的口语；页面文字会作为明确标注的降级资料。';
  if (status === 'error') return asr.message || runItem.message || '详情采集或本地语音识别失败，等待下次重试。';
  if (status === 'media_missing') return '尚未取得可下载媒体地址；' +
    (asr.message || runItem.message || '本轮没有下载视频，也没有启动本地转写。');
  if (status === 'processing') return runItem.message || '正在下载临时媒体或执行本地语音识别。';
  if (status === 'deferred') return runItem.message || '本轮转写额度已满，任务已顺延到下一轮。';
  if (status === 'detail_pending') return runItem.message || '尚未完成详情页采集，因此还没有进入媒体检查。';
  if (status === 'manual') return '这是手工录入或非抖音直链视频，不属于主页自动采集队列。';
  return '当前转写条件尚未核验。';
}

function expertCreatorTopicCounts(videos) {
  const ignored = new Set(['抖音登录会话同步', '身份已匹配', 'douyin']);
  const counts = new Map();
  videos.forEach(function(item) {
    (item.sectors || []).concat(item.topics || []).forEach(function(topic) {
      const value = String(topic || '').trim();
      if (!value || ignored.has(value)) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
  });
  return Array.from(counts.entries()).map(function(entry) {
    return { topic: entry[0], count: entry[1] };
  }).sort(function(a, b) { return b.count - a.count || a.topic.localeCompare(b.topic, 'zh-CN'); }).slice(0, 10);
}

function expertCreatorFilteredVideos(videos) {
  const query = expertCreatorSearch.toLowerCase();
  const view = document.getElementById('creatorTasksView');
  const scoped = view && view.style.display !== 'none';
  const runItems = new Set(expertCreatorTaskRuns.filter(function(run) {
    return !expertCreatorSelectedRunId || Number(run.id) === expertCreatorSelectedRunId;
  }).flatMap(expertCreatorTaskItems).map(function(item) { return String(item.contentId || ''); }).filter(Boolean));
  return videos.filter(function(item) {
    const view = document.getElementById('creatorMediaView')?.value || 'preferred';
    const wanted = view === 'preferred' ? expertSelectedChannel()?.collectionMediaType || 'all' : view;
    if (wanted !== 'all' && (item.mediaType === 'note' || /\/note\//.test(item.sourceUrl || '') ? 'note' : 'video') !== wanted) return false;
    if (scoped && expertCreatorTaskDateMode === 'published' &&
        (!item.publishedAt || expertBeijingDate(item.publishedAt) !== expertCreatorTaskDate)) return false;
    if (scoped && expertCreatorTaskDateMode === 'run' &&
        (expertCreatorTaskRunsLoading || expertCreatorTaskRunsError || expertCreatorTaskRunsKey !== expertCreatorTaskScopeKey() ||
        !runItems.has(String(item.externalContentId || '')))) return false;
    if (expertCreatorStatus !== 'all' && expertCreatorAsrStatus(item) !== expertCreatorStatus) return false;
    const topics = (item.sectors || []).concat(item.topics || []);
    if (expertCreatorTopic && !topics.includes(expertCreatorTopic)) return false;
    if (!query) return true;
    const haystack = [item.title, item.transcript, item.summary, item.description]
      .concat(item.stockCodes || [], topics).join('\n').toLowerCase();
    return haystack.includes(query);
  });
}

function expertCreatorMetricLine(item) {
  const engagement = item.engagement || {};
  return [
    engagement.likes == null ? '' : '赞 ' + expertFormatMetric(engagement.likes),
    engagement.comments == null ? '' : '评 ' + expertFormatMetric(engagement.comments),
    engagement.favorites == null ? '' : '藏 ' + expertFormatMetric(engagement.favorites),
    engagement.shares == null ? '' : '转 ' + expertFormatMetric(engagement.shares)
  ].filter(Boolean);
}

function expertDisplayTitle(item) {
  const originalTitle = String(item && item.title || '').trim();
  const generic = !originalTitle || /(?:于\d{8}发布的作品|抖音视频\s*\d+|^未命名视频$)/i.test(originalTitle);
  if (!generic) return { text: originalTitle, sourceLabel: '来源标题', originalTitle };
  const sourceText = String(item && (item.transcript || item.summary || item.description || item.content) || '')
    .replace(/^\s*\[[^\]]{1,30}\]\s*/, '').replace(/\s+/g, ' ').trim();
  const firstSentence = sourceText.split(/[。！？!?\n]/)[0].replace(/[，,；;：:]$/g, '').trim();
  const extracted = firstSentence.slice(0, 36);
  return {
    text: extracted || originalTitle || '内容待提取',
    sourceLabel: extracted ? '内容提取标题' : '来源标题待完善',
    originalTitle
  };
}

function expertCreatorVideoCard(item, selected, related) {
  const status = expertCreatorAsrStatus(item);
  const verification = expertCreatorVerificationStatus(item);
  const title = expertDisplayTitle(item);
  const tags = (item.sectors || []).concat(item.topics || []).filter(Boolean).slice(0, 3);
  const metrics = expertCreatorMetricLine(item).slice(0, 2);
  const metadata = item.mediaMetadata && typeof item.mediaMetadata === 'object' ? item.mediaMetadata : {};
  const coverUrl = item.channelId && item.externalContentId
    ? '/api/expert/channels/' + item.channelId + '/observations/' + item.id + '/cover'
    : /^https:\/\//i.test(String(metadata.coverUrl || '')) ? String(metadata.coverUrl) : '';
  const cover = coverUrl
    ? '<img class="creator-video-cover" src="' + expertEscape(coverUrl) + '" alt="封面待补采" loading="lazy" referrerpolicy="no-referrer">'
    : '<span class="creator-video-cover creator-video-cover-empty">视频</span>';
  return '<button class="creator-video-row' + (selected ? ' selected' : '') + '" data-video-id="' + item.id +
    '" data-video-source="' + (related ? 'related' : 'douyin') + '">' + cover + '<span class="creator-video-body">' +
      '<span class="creator-video-row-top"><time>' + expertEscape(item.publishedAt ? expertFormatTime(item.publishedAt) : '发布时间未知') +
      '</time><span class="creator-video-statuses">' +
        (verification ? '<em class="creator-verification-status ' + verification.status + '">' + expertEscape(verification.label) + '</em>' : '') +
        (!verification || status !== 'complete' ? '<em class="creator-asr-status ' + status + '">' + expertEscape(expertCreatorAsrStatusLabel(status, false)) + '</em>' : '') +
      '</span></span>' +
    '<strong>' + expertEscape(title.text) + '</strong>' +
    '<span class="creator-title-source">' + expertEscape(title.sourceLabel) + '</span>' +
    '<span class="creator-title-source">首次采集 ' + expertEscape(item.firstSeenAt ? expertFormatTime(item.firstSeenAt) : '待核验') + '</span>' +
    '<span class="creator-video-row-meta">' + expertEscape(metrics.join(' · ') || '暂无互动数据') + '</span>' +
    (tags.length ? '<span class="creator-video-row-tags">' + tags.map(function(tag) {
      return '<i>' + expertEscape(tag) + '</i>';
    }).join('') + '</span>' : '') + '</span></button>';
}

function expertCreatorCommentsHtml(item) {
  const state = expertCommentCache.get(Number(item.id));
  if (!state || state.status === 'loading') {
    return '<section class="creator-detail-section creator-comments-section"><h5>公开评论</h5>' +
      '<p>正在读取已采集的页面可见评论…</p></section>';
  }
  if (state.status === 'error') {
    return '<section class="creator-detail-section creator-comments-section"><h5>公开评论</h5>' +
      '<p class="error">评论资料读取失败：' + expertEscape(state.message) + '</p><button class="small-btn creator-retry-comments">重试读取本地评论</button></section>';
  }
  const data = state.data || {};
  const coverage = data.coverage || {};
  const comments = Array.isArray(data.comments) ? data.comments : [];
  const byId = new Map(comments.map(function(comment) { return [String(comment.commentId || ''), comment]; }));
  const creatorLabels = {
    verified: '作者本人 · 主页一致',
    platform_marked: '平台标注作者',
    suspected: '疑似同名 · 未确认'
  };
  const creatorCount = comments.filter(function(comment) {
    return comment.creatorStatus === 'verified' || comment.creatorStatus === 'platform_marked';
  }).length;
  const summary = expertEscape(coverage.message || '不能据此断言评论区完整。') +
    (coverage.observedAt ? ' · 采集于 ' + expertEscape(expertFormatTime(coverage.observedAt)) : '') +
    ' · 本地共 ' + Number(data.total == null ? comments.length : data.total) + ' 条，已显示 ' + comments.length + ' 条' +
    (creatorCount ? ' · 作者回复 ' + creatorCount + ' 条' : '');
  const rows = comments.map(function(comment) {
    const parent = byId.get(String(comment.parentCommentId || comment.replyToCommentId || ''));
    const creatorLabel = creatorLabels[comment.creatorStatus] || '';
    const creatorClass = comment.creatorStatus === 'verified' || comment.creatorStatus === 'platform_marked'
      ? ' creator-comment-author' : '';
    return '<article class="creator-comment' + creatorClass + '">' +
      '<header><strong>' + expertEscape(comment.authorName || '未知用户') + '</strong>' +
        (creatorLabel ? '<span class="creator-comment-badge ' + expertEscape(comment.creatorStatus) + '">' +
          expertEscape(creatorLabel) + '</span>' : '') +
        (comment.publishedAt ? '<time>' + expertEscape(expertFormatTime(comment.publishedAt)) + '</time>' : '') +
        (comment.likes == null ? '' : '<span>赞 ' + expertEscape(expertFormatMetric(comment.likes)) + '</span>') +
      '</header>' +
      (parent ? '<div class="creator-comment-parent">回复 ' + expertEscape(parent.authorName || '上级评论') +
        '：' + expertEscape(parent.text) + '</div>' : '') +
      '<p>' + expertEscape(comment.text) + '</p>' +
      (comment.versions && comment.versions.length ? '<details><summary>已保留 ' + comment.versions.length + ' 个历史版本</summary>' +
        comment.versions.map(function(version) { return '<p><time>' + expertEscape(expertFormatTime(version.observedAt)) +
          '</time> ' + expertEscape(version.text) + '</p>'; }).join('') + '</details>' : '') + '</article>';
  }).join('');
  return '<section class="creator-detail-section creator-comments-section"><h5>公开评论（仅采集时页面可见范围）</h5>' +
    '<div class="creator-comment-coverage">' + summary + '</div>' +
    (rows || '<p>当前详情快照没有保存到可见评论，不能据此判断视频没有评论。</p>') +
    (data.hasMore ? '<button class="small-btn creator-more-comments">加载更多已保存评论</button>' : '') + '</section>';
}

async function expertLoadCreatorComments(item, options = {}) {
  if (!item) return;
  const previous = expertCommentCache.get(Number(item.id));
  if (previous && (previous.status === 'loading' || !options.force)) return;
  const observationId = Number(item.id);
  const channelId = expertSelectedChannelId();
  expertCommentCache.set(observationId, { status: 'loading' });
  try {
    const offset = options.more && previous && previous.data ? previous.data.comments.length : 0;
    const data = await expertApi('/api/expert/channels/' + channelId + '/observations/' + observationId + '/comments?limit=100&offset=' + offset);
    if (offset) data.comments = previous.data.comments.concat(data.comments);
    expertCommentCache.set(observationId, { status: 'complete', data });
  } catch (error) {
    expertCommentCache.set(observationId, { status: 'error', message: error.message || String(error) });
  }
  if (expertSelectedChannelId() !== channelId || expertSelectedVideoId !== observationId) return;
  const current = expertObservations.find(function(observation) { return observation.id === observationId; });
  if (current) expertRenderCreatorDetail(current);
}

function expertSetCreatorHtml(node, html) {
  if (!node || node._creatorHtml === html) return;
  node.innerHTML = html;
  node._creatorHtml = html;
}

let expertCreatorDetailTab = 'transcript';
let expertCreatorVisibleLimit = 40;
let expertCreatorSearchTimer = null;

function expertRenderCreatorDetail(item) {
  const target = document.getElementById('expertCreatorVideoDetail');
  if (!target) return;
  if (!item) {
    target._creatorObservationKey = '';
    expertSetCreatorHtml(target, '<div class="empty-state compact">当前筛选条件下没有视频。</div>');
    return;
  }
  const key = item.channelId + ':' + item.id;
  if (target._creatorObservationKey !== key) {
    target.innerHTML = '<div class="creator-header-slot"></div><div class="creator-detail-workspace">' +
      '<aside class="creator-detail-media"><div class="creator-player-slot"></div><div class="creator-media-actions"></div></aside>' +
      '<section class="creator-reading-column"><nav class="creator-detail-tabs" role="tablist" aria-label="作品资料"></nav>' +
      '<div class="creator-reading-body" role="tabpanel" id="creatorReadingPanel"></div></section></div>';
    target._creatorObservationKey = key;
    target._creatorHtml = null;
    expertCreatorDetailTab = 'transcript';
    target.scrollTop = 0;
  }
  const isNote = item.mediaType==='note';
  const note = item.mediaMetadata && item.mediaMetadata.note || {};
  const pages = Array.isArray(note.pages)?note.pages:[];
  const asr = item.mediaMetadata && item.mediaMetadata.asr || {};
  const status = expertCreatorAsrStatus(item);
  const verification = expertCreatorVerificationStatus(item);
  const evidenceLabel = EXPERT_EVIDENCE_LABELS[item.evidenceLevel] || item.evidenceLevel || '来源待核验';
  const segments = ['complete', 'needs_review'].includes(status) && Array.isArray(asr.segments) ? asr.segments : [];
  const metrics = expertCreatorMetricLine(item);
  const signal = item.signal || {};
  const keyPoints = Array.isArray(signal.keyPoints) ? signal.keyPoints.slice(0, 6) : [];
  const risks = Array.isArray(signal.riskFlags) ? signal.riskFlags.slice(0, 5) : [];
  const tags = (item.stockCodes || []).concat(item.sectors || [], item.topics || [])
    .filter(function(value, index, values) { return value && values.indexOf(value) === index; }).slice(0, 16);
  const transcript = String(item.transcript || '').trim();
  const fallback = String(item.description || item.content || '').trim();
  const title = expertDisplayTitle(item);
  expertSetCreatorHtml(target.querySelector('.creator-header-slot'), '<header class="creator-detail-header">' +
    '<div>' + (verification ? '<span class="creator-verification-status ' + verification.status + '">' + expertEscape(verification.label) + '</span>' : '') +
    '<span class="creator-asr-status ' + status + '">' + expertEscape(expertCreatorAsrStatusLabel(status, true)) + '</span>' +
    '<time>发布 ' + expertEscape(item.publishedAt ? expertFormatTime(item.publishedAt) : '时间待核验') + '</time></div>' +
    '<h4>' + expertEscape(title.text) + '</h4><div class="creator-detail-metrics">' +
    metrics.map(metric => '<span>' + expertEscape(metric) + '</span>').join('') + '</div></header>');

  // Never detach an existing video on status, comments or reader-tab updates.
  const slot = target.querySelector('.creator-player-slot');
  const mediaPath = isNote ? 'note:'+pages.map(page=>page.index+':'+page.sha256).join('|') : String(item.localAssetPath || '');
  if (slot._creatorMediaPath !== mediaPath) {
    slot._creatorMediaPath = mediaPath;
    slot.innerHTML = isNote
      ? '<div class="creator-note-gallery">'+(pages.length?pages.map(page=>'<figure><figcaption>原图 '+page.index+' / '+note.imageCount+'</figcaption>'+
        (page.localAssetPath?'<img loading="lazy" alt="图文原图 '+page.index+'" src="/api/expert/channels/'+item.channelId+
          '/observations/'+item.id+'/images/'+page.index+'">':'<p>此页图片尚未归档</p>')+'</figure>').join(''):
        '<p class="creator-media-empty">尚未保存原图，点击“补采图文”。</p>')+'</div>'
      : mediaPath
      ? '<video controls playsinline preload="metadata" data-observation-id="' + item.id +
        '" src="/api/expert/channels/' + item.channelId + '/observations/' + item.id + '/media"></video>'
      : '<p class="creator-media-empty">尚未归档视频。可下载视频，或打开来源页面查看。</p>';
    const player = slot.querySelector('video');
    if (player) player.addEventListener('error', function() {
      const message = target.querySelector('.creator-video-task-message');
      if (message) message.textContent = '本地视频不可播放：文件缺失或格式不支持。请补存视频或打开来源。';
    });
  }
  expertSetCreatorHtml(target.querySelector('.creator-media-actions'), '<div class="creator-detail-actions">' +
    (isNote ? [['capture','补采图文'],['transcribe','重新识别图片'],['comments','更新评论并保存']]
      : [['capture', '补采详情'], ['archive', '下载视频'], ['transcribe', '重新转写'], ['comments', '更新评论并保存']])
      .map(action => '<button class="small-btn creator-video-task" data-stage="' + action[0] +
        '" data-observation-id="' + item.id + '"' + (expertVideoTasks.has(item.id) ? ' disabled' : '') + '>' + action[1] + '</button>').join('') +
    '</div><p class="muted creator-video-task-message">' +
    expertEscape(expertVideoTaskMessages.get(item.id) || '仅操作当前作品；已有资料和评论历史保留。') + '</p>' +
    (item.sourceUrl ? '<a class="creator-source-link" href="' + expertEscape(item.sourceUrl) + '" target="_blank" rel="noopener">打开来源页面 ↗</a>' : ''));
  const tabs = [['transcript', isNote?'图文正文':'逐字稿'], ['signals', '观点线索'], ['comments', '评论'], ['source', '来源']];
  expertSetCreatorHtml(target.querySelector('.creator-detail-tabs'), tabs.map(tab =>
    '<button type="button" role="tab" aria-controls="creatorReadingPanel" aria-selected="' +
    (expertCreatorDetailTab === tab[0]) + '" class="creator-reader-tab" data-reader-tab="' + tab[0] + '">' + tab[1] + '</button>').join(''));
  let body = '';
  if (expertCreatorDetailTab === 'comments') body = expertCreatorCommentsHtml(item);
  else if (expertCreatorDetailTab === 'signals') {
    body = '<section class="creator-detail-section"><h5>规则摘句 · 非 AI 分析</h5><p class="muted">以下是原文线索，不是事实核验或买卖建议。</p>' +
      (tags.length ? '<div class="creator-detail-tags">' + tags.map(tag => '<span>' + expertEscape(tag) + '</span>').join('') + '</div>' : '') +
      (keyPoints.length ? '<ul>' + keyPoints.map(point => '<li>' + expertEscape(point) + '</li>').join('') + '</ul>' : '<p>尚未提取出观点线索。</p>') +
      (risks.length ? '<p>风险条件：' + expertEscape(risks.join('；')) + '</p>' : '') + '</section>';
  } else if (expertCreatorDetailTab === 'source') {
    body = '<section class="creator-detail-section"><h5>来源与采集记录</h5><p>' + expertEscape(evidenceLabel) +
      '</p><p>标题类型：' + expertEscape(title.sourceLabel) + '</p><p>原始标题：' + expertEscape(title.originalTitle || '未记录') +
      '</p><p>首次采集：' + expertEscape(item.firstSeenAt ? expertFormatTime(item.firstSeenAt) : '未记录') +
      '</p><p>' + (isNote ? '图片识别：' + expertEscape(note.engine || '未记录') : '转写模型：' + expertEscape(asr.model || '未记录') + ' / ' + expertEscape(asr.computeType || '未记录')) + '</p></section>' +
      (item.summary ? '<section class="creator-detail-section"><h5>抖音页面摘要</h5><p>' + expertEscape(item.summary) + '</p></section>' : '') +
      (fallback && fallback !== item.summary ? '<section class="creator-detail-section"><h5>页面正文</h5><p>' + expertEscape(fallback) + '</p></section>' : '') +
      '<details class="creator-record-actions"><summary>记录管理</summary><button class="small-btn danger expert-delete-observation" data-observation-id="' +
      item.id + '">移除索引（保留本地视频）</button></details>';
  } else if (isNote) {
    body = '<section class="creator-detail-section creator-reader-transcript"><h5>作者配文</h5><p>'+expertEscape(item.description||'未取得配文')+
      '</p></section><section class="creator-detail-section creator-reader-transcript"><h5>图片文字 · OCR 待校对</h5>'+ 
      (pages.length ? pages.map(page=>'<h6>图片 '+page.index+(page.preservedFromPrior?' · 使用此前保存版本':'')+'</h6><p>'+expertEscape(page.text || page.message ||
        (page.status==='no_text'?'此图未识别到文字，请查看原图。':'此页尚未完成识别。'))+'</p>').join(''):
        '<p>尚未识别图片正文，请补采图文。</p>')+'</section>';
  } else {
    body = '<section class="creator-detail-section creator-reader-transcript"><h5>' +
      (status === 'needs_review' ? 'ASR 逐字稿 · 待校对' : 'ASR 逐字稿') + '</h5><small class="muted">机器识别，可能有错字；原始含义请结合视频核对。</small><p>' +
      expertEscape(transcript || expertCreatorStatusMessage(item, status)) + '</p></section>' +
      (segments.length ? '<details class="expert-asr-segments"><summary>带时间戳逐字稿 · ' + segments.length + ' 段 · ' +
        expertEscape(asr.model || '未记录') + '</summary><ol>' + segments.map(segment =>
          '<li><time>' + expertEscape(expertFormatOffset(segment.start)) + '–' + expertEscape(expertFormatOffset(segment.end)) +
          '</time><span>' + expertEscape(segment.text) + '</span></li>').join('') + '</ol></details>' : '');
  }
  expertSetCreatorHtml(target.querySelector('.creator-reading-body'), body);
  if (expertCreatorDetailTab === 'comments') expertLoadCreatorComments(item);
}
const expertVideoTaskMessages = new Map();
const expertVideoTasks = new Set();
async function expertRunVideoTask(observationId, stage) {
  if (!window.webstockDesktop || !window.webstockDesktop.runDouyinVideoTask) return alert('请在桌面版执行单视频采集');
  if (expertVideoTasks.has(observationId)) return;
  const channelId = expertSelectedChannelId();
  expertVideoTasks.add(observationId);
  expertVideoTaskMessages.set(observationId, '已排队：' + stage + '，请勿重复提交');
  expertRenderCreatorWorkbench();
  try {
    const modelSelect = document.getElementById('creatorBatchModel');
    await window.webstockDesktop.runDouyinVideoTask(channelId, observationId, stage,
      stage === 'transcribe' && modelSelect ? {model:modelSelect.value} : {});
    expertVideoTaskMessages.set(observationId, '所选视频操作完成，已保存本地资料');
    expertCommentCache.delete(observationId);
    if (channelId === expertSelectedChannelId()) await expertLoadTimeline();
  } catch (error) { expertVideoTaskMessages.set(observationId, '失败：' + error.message + '；原有资料保留，可重试'); }
  finally {
    expertVideoTasks.delete(observationId);
    if (channelId === expertSelectedChannelId()) expertRenderCreatorWorkbench();
  }
}

function expertRenderCreatorWorkbench() {
  const target = document.getElementById('expertCreatorWorkbench');
  const channel = expertSelectedChannel();
  const visible = Boolean(target && channel && channel.platform === 'douyin');
  if (!target) return false;
  target.hidden = !visible;
  if (!visible) return false;
  expertSyncAuthorConfiguration();
  if (expertTimelineLoading || expertTimelineError) {
    document.getElementById('expertCreatorVideoCount').textContent = expertTimelineLoading ? '正在读取…' : '读取失败';
    expertSetCreatorHtml(document.getElementById('expertCreatorVideoList'), '<div class="empty-state compact">' +
      (expertTimelineLoading ? '正在读取所选作者的视频…' : '作品读取失败：' + expertEscape(expertTimelineError) + '。请稍后重试。') + '</div>');
    return true;
  }
  const videos = expertCreatorVideos();
  const directVideos = videos.filter(function(item) {
    return Boolean(item.externalContentId && expertDouyinWorkId(item.sourceUrl) &&
      (!item.evidenceLevel || item.evidenceLevel === 'primary'));
  });
  const completed = directVideos.filter(function(item) { return expertCreatorAsrStatus(item) === 'complete'; }).length;
  const failed = directVideos.filter(function(item) { return expertCreatorAsrStatus(item) === 'error'; }).length;
  const mediaMissing = directVideos.filter(function(item) { return expertCreatorAsrStatus(item) === 'media_missing'; }).length;
  const detailCaptured = directVideos.filter(function(item) {
    const runItem = expertCreatorLatestRunItem(item);
    return Boolean((item.mediaMetadata && item.mediaMetadata.detailCapturedAt) ||
      (runItem && runItem.detailStatus === 'complete'));
  }).length;
  const permanentVideoFiles = directVideos.filter(function(item) {
    const metadata = item.mediaMetadata && typeof item.mediaMetadata === 'object' ? item.mediaMetadata : {};
    const archive = metadata.archive && typeof metadata.archive === 'object' ? metadata.archive : {};
    const asr = metadata.asr && typeof metadata.asr === 'object' ? metadata.asr : {};
    return Boolean(String(item.localAssetPath || archive.localAssetPath || asr.localAssetPath || '').trim());
  }).length;
  const audioVideoCount = directVideos.filter(item=>item.mediaType!=='note').length;
  const noteCount = directVideos.length-audioVideoCount;
  const readyNoteCount = directVideos.filter(item=>['note_ready','note_no_text'].includes(expertCreatorAsrStatus(item))).length;
  const coverage = audioVideoCount ? Math.round(completed / audioVideoCount * 100) : 0;
  const sync = expertDouyinSyncState || {};
  const lastResult = sync.lastResult || {};
  const latestRun = expertDouyinSyncRuns[0] || {};
  const workCount = Number(latestRun.id ? latestRun.workCount || 0 : lastResult.workCount || 0);
  const discoveredCount = Number(latestRun.id ? latestRun.discoveredCount || 0 : lastResult.discoveredCount || 0);
  const stats = document.getElementById('expertCreatorStats');
  const datedVideos = directVideos.map(item => item.publishedAt).filter(value => Number.isFinite(Date.parse(value)));
  datedVideos.sort((a, b) => Date.parse(b) - Date.parse(a));
  expertSetCreatorHtml(stats, [
    ['本地最新发布日期', datedVideos.length ? expertFormatTime(datedVideos[0]) : '未取得发布日期', '仅代表已保存作品；有限扫描不能证明全站最新'],
    ['主页总作品', workCount || '--', '抖音主页公开计数'],
    ['本轮页面加载', discoveredCount || '--', '本轮实际读取到的卡片'],
    ['本地抖音作品', directVideos.length, videos.length > directVideos.length
      ? '另有 ' + (videos.length - directVideos.length) + ' 条手工资料' : '已保存直链'],
    ['永久视频文件', permanentVideoFiles, permanentVideoFiles + ' 条已归档'],
    ['详情已采集', detailCaptured + ' / ' + directVideos.length,
      (latestRun.detailErrorCount || failed) ? Number(latestRun.detailErrorCount || failed) + ' 条采集失败' : '可核对详情状态'],
    [noteCount && !audioVideoCount ? '图文识别' : '视频转写覆盖率', noteCount && !audioVideoCount ? readyNoteCount+' / '+noteCount : coverage + '%',
      noteCount ? '图文已处理 '+readyNoteCount+' / '+noteCount+' · 视频转写 '+completed+' 条' : completed + ' 条完成' + (mediaMissing ? ' · ' + mediaMissing + ' 条缺媒体' : '')],
    ['最近采集', sync.lastCompletedAt ? expertFormatTime(sync.lastCompletedAt) : '尚未完成', sync.enabled ? '每 ' + Number(sync.intervalMinutes || 10) + ' 分钟' : '已暂停'],
  ].map(function(stat) {
    return '<div class="creator-stat"><span>' + expertEscape(stat[0]) + '</span><strong>' + expertEscape(stat[1]) +
      '</strong><small>' + expertEscape(stat[2]) + '</small></div>';
  }).join(''));
  stats.style.setProperty('--creator-coverage', coverage + '%');

  const mediaView = document.getElementById('creatorMediaView')?.value || 'preferred';
  const wantedMedia = mediaView === 'preferred' ? channel.collectionMediaType || 'all' : mediaView;
  const topicWorks = directVideos.filter(item => wantedMedia === 'all' ||
    (item.mediaType === 'note' || /\/note\//.test(item.sourceUrl || '') ? 'note' : 'video') === wantedMedia);
  const topics = expertCreatorTopicCounts(topicWorks);
  const maxTopicCount = topics.length ? topics[0].count : 1;
  expertSetCreatorHtml(document.getElementById('expertCreatorTopics'), topics.length
    ? '<button class="creator-topic-button' + (!expertCreatorTopic ? ' active' : '') + '" data-topic="">全部主题<span>' + topicWorks.length + '</span></button>' +
      topics.map(function(topic) {
        return '<button class="creator-topic-button' + (expertCreatorTopic === topic.topic ? ' active' : '') + '" data-topic="' +
          expertEscape(topic.topic) + '"><span class="creator-topic-bar" style="width:' +
          Math.max(Math.round(topic.count / maxTopicCount * 100), 12) + '%"></span><strong>' + expertEscape(topic.topic) +
          '</strong><em>' + topic.count + '</em></button>';
      }).join('')
    : '<span class="muted">尚未从逐字稿中提取出板块或主题。</span>');

  const filtered = expertCreatorFilteredVideos(videos);
  const scope = document.getElementById('creatorTaskDateScope');
  if (scope) scope.textContent = expertCreatorScopeMessage();
  const filteredDirect = filtered.filter(function(item) { return directVideos.includes(item); });
  const filteredRelated = filtered.filter(function(item) { return !directVideos.includes(item); });
  document.getElementById('expertCreatorVideoCount').textContent = filteredDirect.length + ' 条抖音作品' +
    (filteredRelated.length ? ' · ' + filteredRelated.length + ' 条补充资料' : '');
  if (!filtered.some(function(item) { return item.id === expertSelectedVideoId; })) {
    expertSelectedVideoId = filtered.length ? filtered[0].id : 0;
  }
  const visibleVideos = filteredDirect.concat(filteredRelated).slice(0, expertCreatorVisibleLimit);
  const visibleDirect = visibleVideos.filter(item => filteredDirect.includes(item));
  const visibleRelated = visibleVideos.filter(item => filteredRelated.includes(item));
  expertSetCreatorHtml(document.getElementById('expertCreatorVideoList'), filtered.length
    ? visibleDirect.map(function(item) {
      return expertCreatorVideoCard(item, item.id === expertSelectedVideoId, false);
    }).join('') + (visibleRelated.length ? '<details class="creator-related-materials" open><summary>补充资料（' +
      filteredRelated.length + '）· 不进入抖音自动下载队列</summary>' + visibleRelated.map(function(item) {
        return expertCreatorVideoCard(item, item.id === expertSelectedVideoId, true);
      }).join('') + '</details>' : '') + (visibleVideos.length < filtered.length
      ? '<button class="small-btn creator-load-more">显示更多 · 已显示 ' + visibleVideos.length + ' / ' + filtered.length + '</button>' : '')
    : '<div class="empty-state compact">没有符合筛选条件的作品。<br>' + expertEscape(expertCreatorScopeMessage()) + '</div>');
  expertRenderCreatorDetail(filtered.find(function(item) { return item.id === expertSelectedVideoId; }) || null);
  return true;
}

function expertRenderTimeline() {
  const target = document.getElementById('expertTimeline');
  if (!target) return;
  expertCurveCharts.forEach(function(chart) { try { chart.dispose(); } catch (error) {} });
  expertCurveCharts = [];
  const creatorWorkbenchVisible = expertRenderCreatorWorkbench();
  target.hidden = creatorWorkbenchVisible;
  if (creatorWorkbenchVisible) {
    target.innerHTML = '';
    return;
  }
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
    const body = item.transcript || item.description || item.content || item.summary || '仅保留来源痕迹，暂无可核对正文。';
    const mediaMetadata = item.mediaMetadata || {};
    const asr = mediaMetadata.asr || {};
    const hasCompletedAsr = ['complete', 'needs_review'].includes(asr.status) && Boolean(item.transcript);
    const asrSegments = hasCompletedAsr && Array.isArray(asr.segments) ? asr.segments : [];
    const contentLabel = asr.status === 'needs_review' ? 'ASR 简体规范稿（待复核）' : hasCompletedAsr ? 'ASR 简体规范稿'
      : item.transcript ? '页面可见字幕 / 正文（可能不完整）'
        : item.description ? '页面描述' : '资料正文';
    const hasCurve = Array.isArray(item.curveData) && item.curveData.length > 1;
    const engagement = item.engagement || {};
    const signal = item.signal || {};
    const metricDelta = engagement.delta || {};
    function metricLabel(key, label) {
      if (engagement[key] == null) return '';
      const delta = Number(metricDelta[key]);
      return label + ' ' + expertFormatMetric(engagement[key]) +
        (Number.isFinite(delta) && delta !== 0 ? ' (' + (delta > 0 ? '+' : '') + expertFormatMetric(delta) + ')' : '');
    }
    const metrics = [
      metricLabel('likes', '赞'),
      metricLabel('comments', '评'),
      metricLabel('favorites', '藏'),
      metricLabel('shares', '转'),
      metricLabel('plays', '播')
    ].filter(Boolean);
    const keyPoints = Array.isArray(signal.keyPoints) ? signal.keyPoints.slice(0, 5) : [];
    const risks = Array.isArray(signal.riskFlags) ? signal.riskFlags.slice(0, 4) : [];
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
      (metrics.length ? '<div class="expert-engagement-row">' + metrics.map(function(metric) {
        return '<span>' + expertEscape(metric) + '</span>';
      }).join('') + '<span>采集于 ' + expertEscape(expertFormatTime(engagement.observedAt)) + '</span></div>' : '') +
      '<div class="expert-content-block"><span>' + contentLabel +
        '</span><p>' + expertEscape(body) + '</p></div>' +
      (item.summary && item.summary !== body ? '<div class="expert-content-block expert-page-summary"><span>抖音页面 AI 摘要</span><p>' +
        expertEscape(item.summary) + '</p></div>' : '') +
      (asrSegments.length ? '<details class="expert-asr-segments"><summary>带时间戳逐字稿 · ' + asrSegments.length +
        ' 段 · ' + expertEscape(asr.model || 'small') + ' / ' + expertEscape(asr.computeType || 'int8') + '</summary><ol>' +
        asrSegments.map(function(segment) {
          return '<li><time>' + expertEscape(expertFormatOffset(segment.start)) + '–' +
            expertEscape(expertFormatOffset(segment.end)) + '</time><span>' + expertEscape(segment.text) + '</span></li>';
        }).join('') + '</ol></details>' : '') +
      (asr.status === 'error' ? '<div class="expert-asr-error">本地语音识别失败：' + expertEscape(asr.message || '未知错误') + '</div>' : '') +
      (asr.status === 'needs_review' ? '<div class="expert-asr-review">本地识别存在低置信度片段，不应直接当作完整原话。</div>' : '') +
      (keyPoints.length ? '<div class="expert-signal-block"><strong>自动提取的投资信息</strong><ul>' + keyPoints.map(function(point) {
        return '<li>' + expertEscape(point) + '</li>';
      }).join('') + '</ul>' + (risks.length ? '<div class="expert-risk-line">风险条件：' + expertEscape(risks.join('；')) + '</div>' : '') + '</div>' : '') +
      (item.analysisNotes ? '<p class="expert-analysis-note"><strong>图形 / 方法记录</strong>' +
        expertEscape(item.analysisNotes) + '</p>' : '') +
      (item.localAssetPath ? '<div class="expert-local-reference">本地资料：' + expertEscape(item.localAssetPath) + '</div>' : '') +
      (hasCurve ? '<div id="expertCurveChart' + item.id + '" class="expert-curve-chart" aria-label="' +
        expertEscape(item.title) + '曲线图"></div>' : '') +
      (associations.length ? '<div class="tag-row">' + associations.map(function(tag) {
        return '<span class="factor-tag">' + expertEscape(tag) + '</span>';
      }).join('') + '</div>' : '') +
      '<div class="expert-row-actions">' +
        (item.sourceUrl ? '<a href="' + expertEscape(item.sourceUrl) + '" target="_blank" rel="noopener">来源证据</a>' : '<span></span>') +
        '<button class="small-btn danger expert-delete-observation" data-observation-id="' + item.id + '">移除索引（保留本地文件）</button>' +
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
  expertRenderBatchAuthors();
  await expertLoadTimeline();
}

const expertBatchSelected = new Set();
let expertQueueLoading = false;
let expertCollectionQueue = null;
function expertRenderBatchAuthors() {
  const target = document.getElementById('creatorBatchAuthors');
  if (!target) return;
  target.innerHTML = expertChannels.filter(item => item.platform === 'douyin' && item.enabled !== false).map(item =>
    '<label><input type="checkbox" value="' + Number(item.id) + '"' + (expertBatchSelected.has(Number(item.id)) ? ' checked' : '') + '> ' +
    expertEscape(item.displayName) + '</label>').join('') || '<small class="muted">先添加一位作者</small>';
}

function expertRenderCollectionQueue() {
  const target = document.getElementById('creatorQueueList');
  const status = document.getElementById('creatorQueueStatus');
  if (!target || !status) return;
  const result = expertCollectionQueue;
  if (!result) {
    target.innerHTML = '<p class="muted">正在读取当前作者的队列…</p>';
    status.textContent = '尚未读取';
    return;
  }
  const all = document.getElementById('creatorQueueScope')?.value === 'all';
  const jobs = (result.jobs || []).filter(job => all || Number(job.channelId) === expertSelectedChannelId());
    const labels = {queued:'排队中',running:'处理中',partial:'部分完成 · 待续跑',blocked:'受阻',complete:'本轮完成',cancelled:'已停止'};
    status.textContent = (all ? '全部作者' : (expertSelectedChannel()?.displayName || '当前作者')) + ' · ' + jobs.length + ' 个任务 · ' +
      (result.workerRunning ? '后台执行器运行中' : '后台执行器未运行 · 任务保留');
    const html = jobs.map(job => {
      const data = job.result || {}, after = data.archiveQueue && data.archiveQueue.after || {};
      const progress = job.progress || {};
      const count = value => value == null ? '—' : Number(value);
      const totals = '目录 ' + count(data.archive && data.archive.discoveredCount || progress.discoveredCount || data.discoveredCount) +
        ' · 待处理 ' + count(after.pendingCount) + ' · 已完成 ' + count(after.completedCount);
      const active = ['queued','running'].includes(job.status);
      return '<article class="creator-queue-row"><div><strong>' + expertEscape(job.displayName) + '</strong> <span>' +
        expertEscape(job.cancelRequested && active ? '停止中（等待当前小批次）' : labels[job.status] || job.status) + '</span>' +
        '<small>' + expertEscape(job.model) + ' · ' + (job.mode === 'archive' ? '全量补齐' : '增量') + ' · 第 ' + Number(job.rounds) + ' 轮 · ' + totals + '</small>' +
        '<small>' + expertEscape(progress.message || job.message) + '</small></div>' +
        '<button class="small-btn" data-queue-reader="' + Number(job.channelId) + '">查看资料</button>' +
        '<button class="small-btn" data-queue-id="' + Number(job.id) + '" data-queue-action="' + (active ? 'cancel' : 'retry') + '"' + (job.cancelRequested && active ? ' disabled' : '') + '>' + (active ? '停止' : '续跑 / 再检查') + '</button></article>';
    }).join('') || '<p class="muted">' + (all ? '全部作者暂无队列任务。' : '当前作者暂无队列任务，可点击上方“采集当前作者”。') + '</p>';
    // Preserve focus and selection when a polling response has no visible change.
    if (target.innerHTML !== html) target.innerHTML = html;
}

async function expertLoadCollectionQueue() {
  const status = document.getElementById('creatorQueueStatus');
  if (!document.getElementById('creatorQueueList') || expertQueueLoading) return;
  expertQueueLoading = true;
  try {
    expertCollectionQueue = await expertApi('/api/expert/collection-queue');
    expertRenderCollectionQueue();
  } catch (error) { status.textContent = '队列不可用：' + error.message; }
  finally { expertQueueLoading = false; }
}

async function expertEnqueueCreators(ids, mode, model, selectionId = expertAuthorSelectionId) {
  if (!ids.length) throw new Error('请先勾选需要采集的作者');
  const jobs = await expertApi('/api/expert/collection-queue', {method:'POST',body:{channelIds:ids,
    mode:mode || document.getElementById('creatorBatchMode').value, model:model || document.getElementById('creatorBatchModel').value}});
  if (selectionId === expertAuthorSelectionId) expertSetStatus(jobs.length + ' 位作者已加入或复用已有队列；视频下载与识别在后台分批进行。');
  await expertLoadCollectionQueue();
}

function expertResetCreatorFilters() {
  expertSelectedVideoId = 0;
  expertCreatorVisibleLimit = 40;
  expertCreatorSearch = '';
  expertCreatorStatus = 'all';
  expertCreatorTopic = '';
  expertCommentCache.clear();
  document.getElementById('expertCreatorSearchInput').value = '';
  document.getElementById('expertCreatorStatusFilter').value = 'all';
}

async function expertActivateChannel(channelId) {
  const selectionId = ++expertAuthorSelectionId;
  const value = String(channelId || '');
  document.getElementById('expertChannelSelect').value = value;
  const taskSelect = document.getElementById('creatorTaskChannelSelect');
  const channel = expertChannels.find(function(item) { return String(item.id) === value; });
  if (taskSelect && channel && channel.platform === 'douyin') taskSelect.value = value;
  const activeName = document.getElementById('creatorActiveName');
  if (activeName) activeName.textContent = channel?.displayName || '请选择作者';
  ++expertCreatorTaskRunsRequestId;
  expertCreatorTaskRuns = [];
  expertCreatorTaskRunsKey = '';
  expertCreatorSelectedRunId = 0;
  expertDouyinSyncState = null;
  expertDouyinSyncRuns = [];
  expertObservations = [];
  expertBacktests = [];
  expertCreatorTaskRunsError = '';
  expertCreatorTaskRunsLoading = true;
  expertTimelineLoading = true;
  expertTimelineError = '';
  ['creatorMediaPreference', 'creatorIndustryAutomatic'].forEach(function(id) {
    const control = document.getElementById(id);
    if (control) control.disabled = false;
  });
  expertSyncAuthorConfiguration();
  const draft = expertCreatorQueueDrafts.get(Number(channelId)) || { mode: 'incremental', model: 'large-v3-turbo' };
  const mode = document.getElementById('creatorCurrentMode'), model = document.getElementById('creatorCurrentModel');
  if (mode) mode.value = draft.mode;
  if (model) model.value = draft.model;
  const mediaView = document.getElementById('creatorMediaView'), queueScope = document.getElementById('creatorQueueScope');
  if (mediaView) mediaView.value = 'preferred';
  if (queueScope) queueScope.value = 'current';
  const form = document.getElementById('creatorAccountForm');
  if (form) form.hidden = true;
  expertEditingCreatorId = 0;
  expertSetStatus('正在读取 ' + (channel?.displayName || '当前作者') + ' 的资料…');
  expertSetDouyinSessionStatus('正在检查当前登录会话…');
  expertResetCreatorFilters();
  expertResetAnalysisPacket();
  // Clear the old author's visible content before the new request can fail or wait.
  document.getElementById('expertCreatorVideoList').innerHTML = '<div class="empty-state compact">正在读取所选作者的视频…</div>';
  document.getElementById('expertCreatorVideoList')._creatorHtml = null;
  document.getElementById('expertCreatorVideoDetail').innerHTML = '';
  document.getElementById('expertCreatorVideoDetail')._creatorObservationKey = '';
  document.getElementById('expertCreatorVideoDetail')._creatorHtml = null;
  expertCreatorVisibleLimit = 40;
  expertSetCreatorHtml(document.getElementById('expertCreatorStats'), '');
  expertSetCreatorHtml(document.getElementById('expertCreatorTopics'), '');
  document.getElementById('expertCreatorVideoCount').textContent = '正在读取…';
  expertRenderCreatorRunAudit();
  expertRenderCreatorTaskPipeline();
  expertRenderDouyinSyncState();
  expertRenderCollectionQueue();
  expertSyncChannelControls();
  // Works and status are independent: a slow/failed transcript request must not block configuration and task history.
  const results = await Promise.allSettled([expertLoadTimeline(), expertLoadDouyinSyncState()]);
  if (selectionId !== expertAuthorSelectionId) return;
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

async function expertShowCreatorTasks() {
  expertRefreshBackgroundStatus();
  expertLoadCollectionQueue();
  if (expertInitialLoadPromise) await expertInitialLoadPromise;
  else if (!expertChannels.length) await expertLoadChannels();
  const taskSelect = document.getElementById('creatorTaskChannelSelect');
  const current = expertSelectedChannel();
  const channelId = current && current.platform === 'douyin' ? current.id : Number(taskSelect.value) || 0;
  if (channelId) await expertActivateChannel(channelId);
  else expertRenderCreatorTaskPipeline();
  await expertLoadNetworkRoute();
}

async function expertRefreshBackgroundStatus() {
  const toggle = document.getElementById('creatorLoginStartup');
  const label = document.getElementById('creatorBackgroundStatus');
  if (!toggle || !window.webstockDesktop || !window.webstockDesktop.getLoginStartupStatus) return;
  try {
    const status = await window.webstockDesktop.getLoginStartupStatus();
    toggle.disabled = !status.supported;
    toggle.checked = status.enabled;
    label.textContent = status.message + (status.enabled ? ' · 登录自启已开启' : ' · 登录自启未开启');
  } catch (error) { label.textContent = error.message; }
}

let expertEditingCreatorId = 0;
function expertOpenCreatorForm(edit) {
  const channel = edit ? expertSelectedChannel() : null;
  if (edit && !channel) return;
  expertEditingCreatorId = channel ? channel.id : 0;
  document.getElementById('creatorAccountName').value = channel ? channel.displayName : '';
  document.getElementById('creatorAccountUrl').value = channel ? channel.profileUrl : '';
  document.getElementById('creatorAccountForm').hidden = false;
}

async function expertSaveCreatorAccount(event) {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  let selectionId = expertAuthorSelectionId;
  const editingId = expertEditingCreatorId;
  const displayName = document.getElementById('creatorAccountName').value.trim();
  const text = document.getElementById('creatorAccountUrl').value.trim();
  const saveAndScan = document.getElementById('creatorSaveAndScan').checked;
  const model = document.getElementById('creatorBatchModel').value;
  button.disabled = true;
  try {
    const resolved = await expertApi('/api/expert/resolve-profile', {method:'POST',body:{text}});
    const channel = await expertApi('/api/expert/channels' + (editingId ? '/' + editingId : ''), {
      method: editingId ? 'PUT' : 'POST', body: {
        displayName,
        profileUrl: resolved.profileUrl, platform: 'douyin', subjectType: 'creator'
      }
    });
    const channels = await expertApi('/api/expert/channels');
    if (selectionId === expertAuthorSelectionId) {
      expertChannels = channels;
      expertRenderChannelOptions();
      expertBatchSelected.add(Number(channel.id));
      expertRenderBatchAuthors();
      selectionId++;
      await expertActivateChannel(channel.id);
      if (selectionId === expertAuthorSelectionId) {
        document.getElementById('creatorAccountForm').hidden = true;
        expertSetStatus('作者已保存。自动任务将在后台检查，无需重启。');
      }
    }
    if (saveAndScan) {
      try { await expertEnqueueCreators([channel.id], 'archive', model, selectionId); }
      catch (error) { if (selectionId === expertAuthorSelectionId) expertSetStatus('作者已保存，但加入队列失败：' + error.message, true); }
    }
  } catch (error) { if (selectionId === expertAuthorSelectionId) expertSetStatus(error.message, true); }
  finally { button.disabled = false; }
}

async function expertLoadTimeline() {
  const channelId = expertSelectedChannelId();
  const requestId = ++expertTimelineRequestId;
  expertTimelineLoading = Boolean(channelId);
  expertTimelineError = '';
  if (!channelId) {
    expertTimelineLoading = false;
    expertObservations = [];
    expertBacktests = [];
    expertRenderTimeline();
    expertRenderBacktests();
    expertSetStatus(expertChannels.length ? '请选择创作者频道' : '尚未建立频道');
    return;
  }
  const backtests = expertApi('/api/expert/channels/' + channelId + '/backtests?limit=20')
    .then(function(data) { return { data }; }, function(error) { return { error }; });
  try {
    const observations = await expertApi('/api/expert/channels/' + channelId + '/observations?limit=500');
    if (requestId !== expertTimelineRequestId || channelId !== expertSelectedChannelId()) return;
    expertObservations = observations;
  } catch (error) {
    if (requestId !== expertTimelineRequestId || channelId !== expertSelectedChannelId()) return;
    expertTimelineLoading = false;
    expertTimelineError = error.message || '请求失败';
    expertRenderTimeline();
    expertSetStatus('作品读取失败：' + expertTimelineError, true);
    throw error;
  }
  expertTimelineLoading = false;
  expertCommentCache.clear();
  expertRenderTimeline();
  const channel = expertSelectedChannel();
  const douyinStatus = channel && channel.platform === 'douyin'
    ? ' · 抖音直接链接 ' + Number(channel.directDouyinCount || 0) + ' 条'
    : '';
  expertSetStatus((channel ? channel.displayName : '当前对象') + ' · ' + expertObservations.length + ' 条资料' + douyinStatus);
  expertSyncChannelControls();
  backtests.then(function(result) {
    if (requestId !== expertTimelineRequestId || channelId !== expertSelectedChannelId()) return;
    expertBacktests = result.data || [];
    expertRenderBacktests();
    if (result.error) expertSetStatus('作品已显示；回测记录读取失败：' + result.error.message, true);
  });
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
  if (!confirm('从研究索引中移除“' + (observation ? observation.title : observationId) + '”？已归档的本地视频文件不会删除。')) return;
  try {
    await expertApi('/api/expert/channels/' + channelId + '/observations/' + observationId, { method: 'DELETE' });
    await expertLoadChannels();
    document.getElementById('expertChannelSelect').value = String(channelId);
    await expertLoadTimeline();
    if (window.AIResearch && typeof window.AIResearch.reload === 'function') await window.AIResearch.reload();
    expertSetStatus('研究索引已移除；已归档的本地视频文件仍永久保留。');
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
        profileUrl: MODEL_MR_DOUYIN_PROFILE_URL,
        description: '抖音财经创作者研究档案。已核对公开主页与抖音号 moxingxiansheng；第三方论坛同名账号仍不视为本人原始来源。',
        aliases: ['模型先生', '抖音模型先生'],
        discoveryQueries: [
          'site:douyin.com/video 模型先生 股票',
          '模型先生 抖音 股票',
          '模型先生 语录 股市'
        ]
      }
    });
    await expertApi('/api/expert/channels/' + channel.id + '/sync', {
      method: 'PUT',
      body: { enabled: true, intervalMinutes: 10 }
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

function expertOpenDouyinSearch() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') return alert('请先选择抖音创作者频道。');
  expertSetStatus('已打开“' + channel.displayName + '”抖音站内搜索；可将公开分享链接粘贴回研究库。');
  window.open('https://www.douyin.com/search/' + encodeURIComponent(channel.displayName), '_blank', 'noopener');
}

function expertDouyinStartUrl(channel) {
  if (channel && expertIsDouyinUrl(channel.profileUrl)) return channel.profileUrl;
  if (channel && channel.channelKey === 'douyin-model-mr') return MODEL_MR_DOUYIN_PROFILE_URL;
  return 'https://www.douyin.com/search/' + encodeURIComponent(channel ? channel.displayName : '');
}

async function expertOpenDouyinSession() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') return alert('请先选择抖音创作者频道。');
  if (!window.webstockDesktop || typeof window.webstockDesktop.openDouyinSession !== 'function') {
    return alert('该功能只在 Windows 桌面程序中可用。');
  }
  const button = document.getElementById('openDouyinSessionBtn');
  button.disabled = true;
  try {
    await window.webstockDesktop.openDouyinSession(expertDouyinStartUrl(channel));
    expertSetDouyinSessionStatus('窗口已打开。请亲自完成登录或验证码；浏览、滚动到需要的公开内容后再点击同步。');
  } catch (error) {
    expertSetDouyinSessionStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function expertSyncDouyinSession() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') return alert('请先选择抖音创作者频道。');
  if (!window.webstockDesktop || typeof window.webstockDesktop.collectDouyinPage !== 'function') {
    return alert('该功能只在 Windows 桌面程序中可用。');
  }
  const button = document.getElementById('syncDouyinSessionBtn');
  button.disabled = true;
  expertSetDouyinSessionStatus('正在读取当前窗口中已经显示的公开页面内容...');
  try {
    if (typeof window.webstockDesktop.getDouyinSessionStatus === 'function') {
      const session = await window.webstockDesktop.getDouyinSessionStatus();
      if (!session.windowOpen) {
        expertSetDouyinSessionStatus('当前页诊断需要先点击“登录 / 检查账号”打开抖音窗口。后台自动增量采集不依赖此窗口。', true);
        return;
      }
    }
    const capture = await window.webstockDesktop.collectDouyinPage();
    const result = await expertApi('/api/expert/channels/' + channel.id + '/douyin-capture', {
      method: 'POST',
      body: capture
    });
    await expertLoadChannels();
    document.getElementById('expertChannelSelect').value = String(channel.id);
    await expertLoadTimeline();
    if (window.AIResearch && typeof window.AIResearch.reload === 'function') await window.AIResearch.reload();
    const identityText = result.identityMatched ? '身份已匹配' : '身份未匹配，已按待核验保存';
    const loginText = result.loggedIn ? '当前页面未显示登录要求' : '当前页面仍显示登录要求';
    expertSetDouyinSessionStatus('同步完成：新增 ' + result.addedCount + ' 条，更新 ' + result.updatedCount +
      ' 条，未变化 ' + result.unchangedCount + ' 条；' + identityText + '；' + loginText + '。', !result.identityMatched);
  } catch (error) {
    expertSetDouyinSessionStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function expertImportDouyinLinks() {
  const channel = expertSelectedChannel();
  if (!channel || channel.platform !== 'douyin') return alert('请先选择抖音创作者频道。');
  const input = document.getElementById('expertDouyinShareTextInput');
  const text = input.value.trim();
  if (!text) return alert('请粘贴至少一条抖音公开分享链接。');
  const button = document.getElementById('importDouyinLinksBtn');
  button.disabled = true;
  try {
    const result = await expertApi('/api/expert/channels/' + channel.id + '/douyin-links', {
      method: 'POST',
      body: { text }
    });
    input.value = '';
    await expertLoadChannels();
    document.getElementById('expertChannelSelect').value = String(channel.id);
    await expertLoadTimeline();
    if (window.AIResearch && typeof window.AIResearch.reload === 'function') await window.AIResearch.reload();
    expertSetStatus('抖音链接导入完成：新增 ' + result.importedCount + ' 条，重复 ' + result.duplicateCount +
      ' 条，忽略 ' + result.ignoredCount + ' 条；新增项均按待核验保存。');
  } catch (error) {
    expertSetStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function expertDiscoverUpdates() {
  const channelId = expertSelectedChannelId();
  if (!channelId) return alert('请先建立或选择研究对象。');
  const channel = expertSelectedChannel();
  const existingUrls = expertObservations.map(function(item) { return item.sourceUrl; }).filter(Boolean);
  const discoveryDays = Number(document.getElementById('expertDiscoveryWindowSelect').value) || 7;
  const douyinInstructions = channel && channel.platform === 'douyin' ? [
    '这是抖音创作者研究。第一优先检索 www.douyin.com/video/数字ID、jingxuan.douyin.com/m/video/数字ID 或 v.douyin.com 分享短链。',
    '将抖音直接视频页与新闻、论坛、榜单等第三方页面分开列出；没有直接抖音 URL 时必须明确说未找到，不要用第三方页面冒充抖音原始来源。',
    '按最新发布时间优先，分别检查近24小时、近7天和所选时间范围。'
  ] : [];
  const prompt = [
    '请使用 ChatGPT Deep Research 搜索“' + (channel ? channel.displayName : '该研究对象') + '”的新增公开内容、版本信息和公开第三方引用。',
    '本轮新增线索时间范围：最近 ' + discoveryDays + ' 天；超出范围的资料只在确有重要补漏时列出。',
    '只访问无需绕过登录、验证码、反爬、付费墙或权限控制的页面；不要尝试恢复私有或已删除原文。',
    '重点检索本人公开页面、公开视频索引、合法公开存档、新闻/论坛中的明确引用。',
    ...douyinInstructions,
    '遇到同名账号、疑似冒名账号、付费合集或仅声称掌握隐藏视频的页面，必须标记 identityStatus=unverified。',
    '不得把第三方转述改写为本人原话。每条必须给出直接来源 URL、页面标题、公开时间（不确定可为空）、简短摘要和证据类型。',
    '已经入库的 URL，请不要重复：',
    existingUrls.length ? existingUrls.join('\n') : '（暂无）',
    '',
    '最终只输出以下数据块；不要在数据块内使用 Markdown：',
    'WEBSTOCK_DISCOVERY_START',
    '[{"sourceUrl":"https://...","videoId":"抖音数字ID或空字符串","platformSource":"douyin_direct|public_archive|third_party","title":"...","publishedAt":"YYYY-MM-DD 或 ISO 时间","summary":"...","sourceType":"primary_page|public_archive|third_party_quote|commentary","identityStatus":"matched|unverified","topics":["..."]}]',
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
      let duplicates = 0;
      let ignored = 0;
      for (const item of items) {
        if (!item || !/^https?:\/\//i.test(String(item.sourceUrl || '')) || !String(item.title || '').trim()) {
          ignored += 1;
          continue;
        }
        if (channel && channel.platform === 'douyin' && expertIsDouyinUrl(item.sourceUrl)) {
          const directResult = await expertApi('/api/expert/channels/' + channelId + '/douyin-links', {
            method: 'POST',
            body: { text: String(item.title).trim() + '\n' + item.sourceUrl }
          });
          imported += Number(directResult.importedCount || 0);
          duplicates += Number(directResult.duplicateCount || 0);
          ignored += Number(directResult.ignoredCount || 0);
          continue;
        }
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
      expertSetStatus('已导入 ' + imported + ' 条待核验公开线索，跳过重复 ' + duplicates + ' 条，忽略 ' + ignored + ' 条；未进入严格回测。');
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
  document.getElementById('addCreatorAccountBtn').addEventListener('click', function() { expertOpenCreatorForm(false); });
  document.getElementById('editCreatorAccountBtn').addEventListener('click', function() { expertOpenCreatorForm(true); });
  document.getElementById('cancelCreatorAccountBtn').addEventListener('click', function() {
    document.getElementById('creatorAccountForm').hidden = true;
  });
  document.getElementById('creatorAccountForm').addEventListener('submit', expertSaveCreatorAccount);
  document.getElementById('creatorLoginStartup').addEventListener('change', async function(event) {
    const checked = event.target.checked;
    event.target.disabled = true;
    try { await window.webstockDesktop.setLoginStartup(checked); }
    catch (error) { expertSetStatus(error.message, true); }
    await expertRefreshBackgroundStatus();
  });
  document.getElementById('seedModelMrBtn').addEventListener('click', expertSeedModelMr);
  document.getElementById('saveExpertSubjectBtn').addEventListener('click', expertSaveSubject);
  document.getElementById('deleteExpertChannelBtn').addEventListener('click', expertDeleteSubject);
  document.getElementById('refreshExpertTimelineBtn').addEventListener('click', function() {
    expertLoadChannels().catch(function(error) { expertSetStatus(error.message, true); });
  });
  document.getElementById('expertChannelSelect').addEventListener('change', function(event) {
    expertActivateChannel(event.target.value).catch(function(error) { expertSetStatus(error.message, true); });
  });
  document.getElementById('creatorTaskChannelSelect').addEventListener('change', function(event) {
    expertActivateChannel(event.target.value).catch(function(error) { expertSetStatus(error.message, true); });
  });
  document.getElementById('creatorTaskRunHistory').addEventListener('click', function(event) {
    const button = event.target.closest('.creator-run-view-btn');
    if (!button) return;
    expertSelectCreatorRun(button.dataset.runId);
    document.getElementById('expertCreatorWorkbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const taskDate = document.getElementById('creatorTaskDate');
  const taskDateMode = document.getElementById('creatorTaskDateMode');
  if (taskDate && !taskDate.value) taskDate.value = expertBeijingDate(new Date());
  [taskDate, taskDateMode].forEach(function(control) {
    if (!control) return;
    control.addEventListener('change', function() {
      expertCreatorSelectedRunId = 0;
      expertResetCreatorFilters();
      expertCreatorTaskDate = taskDate.value || expertBeijingDate(new Date());
      expertCreatorTaskDateMode = taskDateMode.value;
      taskDate.disabled = expertCreatorTaskDateMode === 'all';
      expertRenderCreatorWorkbench();
      const channel = expertSelectedChannel();
      if (channel && channel.platform === 'douyin') expertLoadDouyinSyncState().catch(function(error) { expertSetStatus(error.message, true); });
    });
  });
  document.getElementById('expertEvidenceLevelSelect').addEventListener('change', expertSyncEvidenceDefaults);
  document.getElementById('saveExpertObservationBtn').addEventListener('click', expertSaveObservation);
  document.getElementById('analyzeExpertIntentBtn').addEventListener('click', expertAnalyzeIntent);
  document.getElementById('discoverExpertUpdatesBtn').addEventListener('click', expertDiscoverUpdates);
  document.getElementById('openDouyinSearchBtn').addEventListener('click', expertOpenDouyinSearch);
  document.getElementById('openCreatorTasksBtn').addEventListener('click', function() { window.switchMainView('creatorTasks'); });
  document.getElementById('openDouyinSessionBtn').addEventListener('click', expertOpenDouyinSession);
  document.getElementById('syncDouyinSessionBtn').addEventListener('click', expertSyncDouyinSession);
  document.getElementById('runDouyinSyncNowBtn').addEventListener('click', expertRunDouyinAutoSync);
  document.getElementById('runDouyinArchiveScanBtn').addEventListener('click', expertRunDouyinArchiveScan);
  document.getElementById('openCreatorAsrSetupBtn').addEventListener('click', expertOpenTranscriptionSetup);
  document.getElementById('douyinAutoSyncToggle').addEventListener('change', expertToggleDouyinAutoSync);
  document.getElementById('importDouyinLinksBtn').addEventListener('click', expertImportDouyinLinks);
  document.getElementById('backtestExpertSignalsBtn').addEventListener('click', expertBacktestSignals);
  document.getElementById('refreshCreatorTasksBtn').addEventListener('click', function() {
    expertLoadCollectionQueue();
    expertLoadChannels().then(expertLoadNetworkRoute).catch(function(error) { expertSetStatus(error.message, true); });
  });
  document.getElementById('creatorBatchAuthors').addEventListener('change', function(event) {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const id = Number(event.target.value);
    if (event.target.checked) expertBatchSelected.add(id); else expertBatchSelected.delete(id);
  });
  document.getElementById('startCreatorBatchBtn').addEventListener('click', async function(event) {
    const button = event.currentTarget; button.disabled = true;
    try { await expertEnqueueCreators(Array.from(expertBatchSelected)); }
    catch (error) { expertSetStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  document.getElementById('startCurrentCreatorBtn')?.addEventListener('click', async function(event) {
    const channel = expertSelectedChannel();
    if (!channel || channel.platform !== 'douyin') return expertSetStatus('请先选择作者', true);
    const button = event.currentTarget; button.disabled = true;
    try { await expertEnqueueCreators([channel.id], document.getElementById('creatorCurrentMode').value, document.getElementById('creatorCurrentModel').value); }
    catch (error) { expertSetStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  document.getElementById('creatorMediaPreference')?.addEventListener('change', async function(event) {
    const channel = expertSelectedChannel();
    if (!channel) return;
    const control = event.currentTarget;
    const value = control.value, selectionId = expertAuthorSelectionId;
    control.disabled = true;
    try {
      await expertApi('/api/expert/channels/' + channel.id, { method: 'PUT', body: { collectionMediaType: value } });
      channel.collectionMediaType = value;
      if (selectionId !== expertAuthorSelectionId) return;
      expertSetStatus('已保存当前作者采集类型；已有资料保留，下次自动和批量采集均使用此设置。');
    } catch (error) {
      if (selectionId === expertAuthorSelectionId) { control.value = channel.collectionMediaType || 'all'; expertSetStatus(error.message, true); }
    } finally {
      if (selectionId === expertAuthorSelectionId) { control.disabled = false; expertRenderCreatorWorkbench(); }
    }
  });
  ['creatorCurrentMode', 'creatorCurrentModel'].forEach(function(id) {
    document.getElementById(id)?.addEventListener('change', expertSaveCreatorQueueDraft);
  });
  document.getElementById('creatorQueueScope')?.addEventListener('change', expertRenderCollectionQueue);
  document.getElementById('creatorMediaView')?.addEventListener('change', function() { expertRenderCreatorWorkbench(); });
  document.getElementById('creatorIndustryAutomatic')?.addEventListener('change', async function(event) {
    const channel = expertSelectedChannel(), control = event.target;
    if (!channel) return;
    const checked = control.checked, selectionId = expertAuthorSelectionId;
    control.disabled = true;
    try {
      await expertApi('/api/expert/channels/' + channel.id, { method: 'PUT', body: { industryAnalysisEnabled: checked } });
      channel.industryAnalysisEnabled = checked;
      if (selectionId !== expertAuthorSelectionId) return;
      expertSetStatus(checked ? '已开启文稿产业链分析；需在设置中配置可用 AI 接口，未配置时保留待分析队列。' : '已关闭自动产业链分析；已有结果保留。');
    } catch (error) {
      if (selectionId === expertAuthorSelectionId) { control.checked = !!channel.industryAnalysisEnabled; expertSetStatus(error.message, true); }
    } finally { if (selectionId === expertAuthorSelectionId) control.disabled = false; }
  });
  document.getElementById('creatorQueueList').addEventListener('click', async function(event) {
    const reader = event.target.closest('[data-queue-reader]');
    if (reader) { expertActivateChannel(Number(reader.dataset.queueReader)).catch(error => expertSetStatus(error.message,true)); return; }
    const button = event.target.closest('[data-queue-action]');
    if (!button) return;
    button.disabled = true;
    try { await expertApi('/api/expert/collection-queue/' + button.dataset.queueId + '/' + button.dataset.queueAction,{method:'POST'}); await expertLoadCollectionQueue(); }
    catch (error) { expertSetStatus(error.message,true); }
    finally { button.disabled = false; }
  });
  document.getElementById('expertAnalysisPacketMode').addEventListener('change', expertUpdateAnalysisPacketControls);
  ['expertAnalysisPacketPurpose', 'expertAnalysisPacketLimit', 'expertAnalysisPacketFrom', 'expertAnalysisPacketTo'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', expertResetAnalysisPacket);
  });
  document.getElementById('expertAnalysisPacketMode').addEventListener('change', expertResetAnalysisPacket);
  document.getElementById('generateExpertAnalysisPacketBtn').addEventListener('click', expertGenerateAnalysisPacket);
  document.getElementById('copyExpertAnalysisPacketBtn').addEventListener('click', expertCopyAnalysisPacket);
  expertUpdateAnalysisPacketControls();
  document.getElementById('expertTimeline').addEventListener('click', function(event) {
    const button = event.target.closest('.expert-delete-observation');
    if (button) expertDeleteObservation(Number(button.dataset.observationId));
  });
  document.getElementById('expertCreatorSearchInput').addEventListener('input', function(event) {
    expertCreatorSearch = event.target.value.trim();
    expertCreatorVisibleLimit = 40;
    clearTimeout(expertCreatorSearchTimer);
    expertCreatorSearchTimer = setTimeout(expertRenderCreatorWorkbench, 180);
  });
  document.getElementById('expertCreatorStatusFilter').addEventListener('change', function(event) {
    expertCreatorStatus = event.target.value;
    expertCreatorVisibleLimit = 40;
    expertRenderCreatorWorkbench();
  });
  document.getElementById('expertCreatorWorkbench').addEventListener('click', function(event) {
    const readerTab = event.target.closest('[data-reader-tab]');
    if (readerTab) {
      expertCreatorDetailTab = readerTab.dataset.readerTab;
      expertRenderCreatorDetail(expertObservations.find(item => item.id === expertSelectedVideoId));
      return;
    }
    if (event.target.closest('.creator-load-more')) {
      expertCreatorVisibleLimit += 40;
      expertRenderCreatorWorkbench();
      return;
    }
    const taskButton = event.target.closest('.creator-video-task');
    if (taskButton) { expertRunVideoTask(Number(taskButton.dataset.observationId), taskButton.dataset.stage); return; }
    if (event.target.closest('.creator-more-comments, .creator-retry-comments')) {
      const item = expertObservations.find(item => item.id === expertSelectedVideoId);
      expertLoadCreatorComments(item, { force: true, more: Boolean(event.target.closest('.creator-more-comments')) });
      return;
    }
    const videoButton = event.target.closest('.creator-video-row');
    if (videoButton) {
      expertSelectedVideoId = Number(videoButton.dataset.videoId) || 0;
      expertRenderCreatorWorkbench();
      return;
    }
    const topicButton = event.target.closest('.creator-topic-button');
    if (topicButton) {
      expertCreatorTopic = topicButton.dataset.topic || '';
      expertCreatorVisibleLimit = 40;
      expertRenderCreatorWorkbench();
      return;
    }
    const deleteButton = event.target.closest('.expert-delete-observation');
    if (deleteButton) expertDeleteObservation(Number(deleteButton.dataset.observationId));
  });
  if (!expertSyncStatusTimer) {
    expertSyncStatusTimer = setInterval(function() {
      if (document.hidden || !document.getElementById('creatorTasksView').classList.contains('active')) return;
      expertPollDouyinSyncState().catch(function() {});
      if (document.getElementById('creatorTasksView').classList.contains('active')) expertLoadCollectionQueue();
    }, 15000);
  }
  expertInitialLoadPromise = expertLoadChannels().catch(function(error) {
    expertSetStatus(error.message, true);
    return null;
  }).finally(function() { expertInitialLoadPromise = null; });
}

window.ExpertTracker = {
  refresh: async function() { await expertLoadChannels(); await expertLoadDouyinSyncState(); await expertLoadCollectionQueue(); },
  retryFailed: function() { return expertTimelineError && !expertTimelineLoading ? expertLoadTimeline() : Promise.resolve(); },
  bind: bindExpertTracker,
  reload: expertLoadChannels,
  showCreatorTasks: expertShowCreatorTasks
};
