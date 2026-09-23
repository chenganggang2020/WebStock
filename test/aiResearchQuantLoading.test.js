const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'aiResearch.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const registrySource = fs.readFileSync(path.join(__dirname, '..', 'services', 'modelRegistryService.js'), 'utf8');

function functionSource(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('AI research first load requests bounded metadata listings without full hash verification', () => {
  const loadQuant = functionSource('aiResearchLoadQuant');
  assert.match(loadQuant, /\/api\/quant\/results\?limit=20/);
  assert.match(loadQuant, /\/api\/quant\/factor-labs\?limit=20/);
  assert.match(loadQuant, /\/api\/quant\/strategy-labs\?limit=20/);
  assert.doesNotMatch(loadQuant, /verification=full/);
  assert.doesNotMatch(registrySource, /verification\s*:\s*['"]full['"]/);
});

test('the application prefetches only the lightweight AI model registry before the stock-list wait', () => {
  const prefetch = functionSource('aiResearchPrefetchModels');
  const prefetchCall = appSource.indexOf('AIResearch.prefetchModels');
  const stockListWait = appSource.indexOf("fetchJsonData('/api/stocklist')");
  assert.match(prefetch, /aiResearchLoadModels/);
  assert.doesNotMatch(prefetch, /aiResearchLoadQuant/);
  assert.ok(prefetchCall >= 0, 'the initial application load should start the model registry prefetch');
  assert.ok(prefetchCall < stockListWait, 'model prefetch should start before the first stock-list wait');
});

test('AI research distinguishes metadata checks from full content hash verification', () => {
  const verificationText = functionSource('quantVerificationText');
  const renderResult = functionSource('aiResearchRenderQuantResult');
  const renderFactor = functionSource('aiResearchRenderFactorLab');
  const renderStrategy = functionSource('aiResearchRenderStrategyLab');
  assert.match(verificationText, /完整内容哈希校验通过/);
  assert.match(verificationText, /未读取数据集文件，也未重算内容哈希/);
  assert.match(renderResult, /quantVerificationText\(entry\)/);
  assert.match(renderFactor, /quantVerificationText\(entry\)/);
  assert.match(renderStrategy, /quantVerificationText\(entry\)/);
  assert.match(renderStrategy, /aiResearchEscape/);
});

test('AI research exposes an explicit read-only strategy rule card', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="strategyShortWindowsInput"/);
  assert.match(html, /id="strategyLongWindowsInput"/);
  assert.match(html, /id="strategyMaxFoldsInput"/);
  assert.match(html, /id="runStrategyLabBtn"/);
  assert.match(html, /id="strategyLabPanel"/);
  assert.match(html, /只做研究/);
});

test('AI research previews controlled Chinese rules and renders generic strategy parameters', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const bind = functionSource('aiResearchBind');
  const renderStrategy = functionSource('aiResearchRenderStrategyLab');
  assert.match(html, /id="strategyNaturalLanguageInput"/);
  assert.match(html, /id="parseStrategyRuleBtn"/);
  assert.match(html, /id="strategyRulePreview"/);
  assert.match(html, /id="strategyFamilySelect"/);
  assert.match(html, /id="strategyMacdSignalWindowsInput"/);
  assert.match(html, /id="strategyRsiPeriodsInput"/);
  assert.match(html, /id="strategyBreakoutWindowsInput"/);
  assert.match(bind, /\/api\/quant\/strategy-rules\/parse/);
  assert.match(bind, /strategyFamily/);
  assert.match(renderStrategy, /parameter\.label/);
});

test('AI research renders a scheduled same-source strategy comparison and daily candidate pool', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const loadQuant = functionSource('aiResearchLoadQuant');
  const renderDaily = functionSource('aiResearchRenderStrategyDaily');
  const scheduleDaily = functionSource('aiResearchScheduleStrategyDaily');
  const bind = functionSource('aiResearchBind');
  const verificationLabel = functionSource('strategyDailyVerificationLabel');
  assert.match(html, /id="runStrategyDailyBtn"/);
  assert.match(html, /id="strategyDailyScheduleStatus"/);
  assert.match(html, /id="strategyDailyPanel"/);
  assert.match(loadQuant, /\/api\/quant\/strategy-daily/);
  assert.match(loadQuant, /\/api\/quant\/strategy-daily\/schedule/);
  assert.match(renderDaily, /comparisons/);
  assert.match(renderDaily, /candidates/);
  assert.match(renderDaily, /aiResearchEscape/);
  assert.match(renderDaily, /comparison\.verification/);
  assert.match(renderDaily, /strategyDailyVerificationLabel/);
  assert.match(verificationLabel, /完整哈希/);
  assert.match(verificationLabel, /元数据/);
  assert.doesNotMatch(renderDaily, /heat|热度/i);
  assert.match(functionSource('aiResearchRenderStrategyDailySchedule'), /status\.reason/);
  assert.match(scheduleDaily, /\/api\/quant\/strategy-daily\/schedule/);
  assert.match(bind, /runStrategyDailyBtn/);
  assert.match(bind, /aiResearchScheduleStrategyDaily/);
});

test('AI research exposes the one-click Tonghuashun watchlist research loop', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const loadQuant = functionSource('aiResearchLoadQuant');
  const renderGroups = functionSource('aiResearchRenderWatchlistGroups');
  const renderReport = functionSource('aiResearchRenderWatchlistResearch');
  const bind = functionSource('aiResearchBind');
  assert.match(html, /id="quantWatchlistGroupSelect"/);
  assert.match(html, /id="runWatchlistResearchBtn"/);
  assert.match(html, /id="watchlistResearchPanel"/);
  assert.match(html, /id="analyzeWatchlistResearchBtn"/);
  assert.match(loadQuant, /\/api\/quant\/watchlist-groups/);
  assert.match(renderGroups, /sourcePath/);
  assert.match(renderReport, /localSummary/);
  assert.match(renderReport, /recommendationPreview/);
  assert.match(renderReport, /data-quant-code/);
  assert.match(bind, /\/api\/quant\/watchlist-research/);
  assert.match(bind, /automaticTrading:\s*false/);
  assert.match(bind, /handoffPrompt/);
});

test('AI research exposes gated full-market signal scans with raw evidence and explicit watchlist handoff', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  const loadQuant = functionSource('aiResearchLoadQuant');
  const renderScan = functionSource('aiResearchRenderSignalScan');
  const payload = functionSource('aiResearchSignalScanPayload');
  const addCandidate = functionSource('aiResearchAddSignalCandidate');
  const bind = functionSource('aiResearchBind');
  assert.match(html, /id="signalScanFamilySelect"/);
  assert.match(html, /id="runSignalScanBtn"/);
  assert.match(html, /id="runSignalBacktestBtn"/);
  assert.match(html, /id="signalScanPanel"/);
  assert.match(loadQuant, /\/api\/quant\/signal-scans\/readiness/);
  assert.match(loadQuant, /\/api\/quant\/signal-scans\?limit=20/);
  assert.match(renderScan, /rawEvidence/);
  assert.match(renderScan, /confirmationRule/);
  assert.match(renderScan, /invalidationRule/);
  assert.match(renderScan, /rule-match|未确认/);
  assert.match(payload, /low-position-volume-stagnation/);
  assert.match(payload, /volume-breakout/);
  assert.match(bind, /\/api\/quant\/signal-scans/);
  assert.match(bind, /\/api\/quant\/full-market-sync/);
  assert.match(addCandidate, /\/api\/portfolio\/watchlist/);
  assert.match(addCandidate, /alertHigh/);
  assert.match(addCandidate, /alertLow/);
  assert.match(css, /\.signal-scan-panel[\s\S]*?overflow:\s*auto/);
});

test('re-entering AI research refreshes externally completed quant jobs', () => {
  const viewBranch = appSource.slice(
    appSource.indexOf("if (view === 'aiResearch')"),
    appSource.indexOf("if (view === 'creatorTasks')")
  );
  assert.match(viewBranch, /ensureLoaded\(true\)/);
});

test('double-clicking a quant candidate switches to market detail before loading the stock', () => {
  const openCandidate = functionSource('aiResearchOpenQuantCandidate');
  const bind = functionSource('aiResearchBind');
  assert.match(openCandidate, /switchMainView\('market'\)/);
  assert.match(openCandidate, /StockList\.selectStock/);
  assert.match(bind, /watchlistResearchPanel/);
  assert.match(bind, /aiResearchOpenQuantCandidate/);
});

test('watchlist research stays contained in the main pane on narrower desktop windows', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  const renderReport = functionSource('aiResearchRenderWatchlistResearch');
  assert.match(renderReport, /table-scroll compact-scroll/);
  assert.match(css, /\.table-scroll[^}]*overflow-x:\s*auto/s);
  assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.watchlist-research-controls\s*\{[^}]*grid-template-columns:\s*1fr/s);
});
