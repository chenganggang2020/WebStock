const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-frontend-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';

const app = require('../server');

let server;
let baseURL;
let allowApiFetchNonJsonConsole = false;

test.beforeAll(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseURL = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

test.beforeEach(async ({ page }) => {
  let mockPaperPortfolios = [];
  page.on('pageerror', error => {
    throw error;
  });
  page.on('console', msg => {
    const text = msg.text();
    const isApiFetchNonJson = /Interface returned non JSON|接口返回非 JSON|鎺ュ彛杩斿洖闈?JSON/.test(text);
    if (msg.type() === 'error' && (/Unexpected token/.test(text) || (isApiFetchNonJson && !allowApiFetchNonJsonConsole))) {
      throw new Error(msg.text());
    }
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('echarts')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.echarts={init:function(){return {setOption:function(){},resize:function(){},dispose:function(){},on:function(){}}}};' });
    }
    if (url.includes('/api/quote')) {
      const codes = new URL(url).searchParams.get('codes').split(',');
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(codes.map(code => ({ code, name: code === '000001' ? '平安银行' : code, price: 11.28, change: -0.18, open: 11.29, high: 11.31, low: 11.16, prevClose: 11.3, amount: 100000000 })))
      });
    }
    if (url.includes('/api/minute')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          { time: '2026-05-11 09:30:00', price: 11.30, volume: 10000, amount: 113000 },
          { time: '2026-05-11 09:35:00', price: 11.24, volume: 8000, amount: 89920 },
          { time: '2026-05-11 09:40:00', price: 11.31, volume: 12000, amount: 135720 },
          { time: '2026-05-11 09:45:00', price: 11.28, volume: 9000, amount: 101520 }
        ])
      });
    }
    if (url.includes('/api/kline')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ date: '2026-05-11', open: 11, close: 11.28, high: 11.4, low: 10.9, volume: 10000, amount: 112800 }]) });
    }
    if (url.includes('/api/analysis-stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"simulated","prompt":"测试提示词：仅供研究，不构成投资建议。"}\n\n' });
    }
    if (url.includes('/api/level2/free-flow')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            code: '000001',
            name: '平安银行',
            provider: 'eastmoney-free-flow',
            mainNetAmount: 60000,
            superLargeNetAmount: 20000,
            largeNetAmount: 40000,
            simulatedLargeNetAmount: 60000,
            mainNetRatio: 2.5,
            timestamp: '2026-05-12T00:00:00.000Z'
          }
        })
      });
    }
    if (url.includes('/api/quant/runtime/link') && route.request().method() === 'POST') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        success: true,
        data: {
          status: 'available',
          verified: true,
          reason: '已复用本机已有量化环境，依赖导入检测通过。',
          runtimeSource: 'linked',
          versions: { python: '3.12.13', qlib: '0.9.7', lightgbm: '4.7.0', torch: '2.13.0' },
          installer: { available: true, python: '3.12.13', estimatedBytes: 3221225472 }
        }
      }) });
    }
    if (url.includes('/api/quant/runtime')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        success: true,
        data: {
          status: 'configured',
          verified: false,
          reason: '测试运行时已配置',
          versions: { python: '3.12.13', qlib: '0.9.7', lightgbm: '4.7.0', torch: '2.13.0' },
          installer: { available: true, python: '3.12.13', estimatedBytes: 3221225472 }
        }
      }) });
    }
    if (url.includes('/api/quant/datasets')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        success: true,
        data: [{ valid: true, manifest: {
          datasetId: 'test-quant-dataset', asOf: '2026-08-07', eligibility: 'exploratory_only',
          coverage: { requested: 12, succeeded: 11, failed: 1, rows: 16659 }
        } }]
      }) });
    }
    if (url.includes('/api/quant/results')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        success: true,
        data: [{ valid: true, result: {
          runId: 'test-quant-run', modelId: 'qlib-lightgbm-v1', validationStatus: 'exploratory', asOf: '2026-08-07',
          dataManifest: { datasetId: 'test-quant-dataset', sha256: 'same-data' }, folds: [{}, {}], parameters: { costBps: 8 },
            metrics: { rankIc: -0.063, icir: -1.18, annualizedReturn: -0.39, benchmarkAnnualizedReturn: -0.25, maxDrawdown: -0.12, sharpe: -1.1, turnover: 0.76, totalCost: 0.016, tradeCount: 104, rebalanceCount: 26 },
          candidates: [{ code: '000001', name: '平安银行', score: 0.012, asOf: '2026-08-07', modelTrainedThrough: '2026-04-16' }],
          warnings: ['当前名单存在幸存者偏差。']
        } }, { valid: true, result: {
          runId: 'test-master-run', modelId: 'master-market-guided-v1', validationStatus: 'exploratory', asOf: '2026-08-07',
          dataManifest: { datasetId: 'test-quant-dataset', sha256: 'same-data' }, folds: [{}, {}], parameters: { costBps: 8 },
          metrics: { rankIc: 0.021, icir: 0.31, annualizedReturn: 0.04, benchmarkAnnualizedReturn: -0.25, maxDrawdown: -0.09, sharpe: 0.22, turnover: 0.68, totalCost: 0.014, tradeCount: 98, rebalanceCount: 26 },
          candidates: [{ code: '300750', name: '宁德时代', score: 0.031, asOf: '2026-08-07', modelTrainedThrough: '2026-04-16' }],
          warnings: ['MASTER 测试结果。']
        } }]
      }) });
    }
    if (url.includes('/api/quant/factor-labs')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        success: true,
        data: [{ valid: true, result: {
          runId: 'test-factor-run', validationStatus: 'exploratory', asOf: '2026-08-07',
          dataManifest: { datasetId: 'test-quant-dataset', sha256: 'same-data' }, folds: [{}, {}],
          factors: [{
            factorId: 'feature_momentum_20', displayName: '20日动量', dominantOrientation: 1,
            orientationAgreement: 1, validationRankIc: 0.031, testRankIc: 0.018,
            positiveFoldRate: 0.5, maxAbsCorrelation: 0.42, closestFactor: 'feature_momentum_60',
            admission: 'watch', reasons: ['样本外窗口少于3个'],
            metrics: { annualizedReturn: 0.02, maxDrawdown: -0.08 }
          }],
          composite: {
            metrics: { rankIc: 0.019, annualizedReturn: 0.03, maxDrawdown: -0.07 },
            candidates: [{ code: '688981', name: '中芯国际', score: 0.15 }]
          },
          warnings: ['Admission labels are exploratory gates, not evidence of future profitability.']
        } }]
      }) });
    }
    if (url.includes('/api/quant/jobs')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    }
    if (url.includes('/api/decision-packets') && route.request().method() === 'POST') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: {
        schema: 'webstock.research.decision-packet.v1', generatedAt: '2026-08-09T13:30:00.000Z', researchRunId: 88,
        question: '测试决策问题', riskProfile: 'balanced', datasetId: 'test-quant-dataset',
        dataSources: [{ sourceId: 'test-quant-run', sourceLabel: 'Qlib + LightGBM', sourceType: 'quant-model', validationStatus: 'exploratory', asOf: '2026-08-07' }],
        candidates: [{ code: '000001', name: '平安银行', consensusScore: 92, signalCount: 2, modelDisagreement: 10, industry: '银行', themes: ['金融'], inPortfolio: true, inWatchlist: false, signals: [{ sourceLabel: 'Qlib + LightGBM', rank: 1 }] }],
        evidence: [{ evidenceId: 'KS-TEST-0001', title: '测试证据', content: '平安银行资产质量证据。' }],
        dataGaps: ['缺少完整财报点时点数据'], portfolioContext: { positions: [], watchlist: [] },
        prompt: '测试决策提示词\nWEBSTOCK_RESULT_START\n# 测试\nWEBSTOCK_RESULT_END'
      } }) });
    }
    if (/\/api\/paper-portfolios\/\d+\/status/.test(url) && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      mockPaperPortfolios = mockPaperPortfolios.map(function(item) { return Object.assign({}, item, { status: body.status }); });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: mockPaperPortfolios[0] }) });
    }
    if (/\/api\/paper-portfolios\/\d+\/refresh/.test(url) && route.request().method() === 'POST') {
      mockPaperPortfolios = mockPaperPortfolios.map(function(item) {
        return Object.assign({}, item, {
          latestSnapshot: { totalValue: 100120, dailyPnl: 120, totalPnl: 120, totalReturn: 0.0012, marketDate: '2026-08-09', marketTime: '15:00:00', warnings: [] },
          snapshots: [{ totalValue: 100120, dailyPnl: 120, totalPnl: 120, totalReturn: 0.0012, marketDate: '2026-08-09', marketTime: '15:00:00', warnings: [] }]
        });
      });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: mockPaperPortfolios[0] }) });
    }
    if (url.includes('/api/paper-portfolios') && route.request().method() === 'POST') {
      const paper = {
        id: 9, name: '测试纸面组合', status: 'draft', asOf: '2026-08-09T13:30:00.000Z', capital: 100000,
        cashWeight: 0.8, riskProfile: 'balanced', constraints: {}, items: [{ code: '000001', name: '平安银行', targetWeight: 0.2, consensusScore: 92, signalCount: 2 }],
        positions: [], snapshots: [], latestSnapshot: null
      };
      mockPaperPortfolios = [paper];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: paper }) });
    }
    if (url.includes('/api/paper-portfolios') && route.request().method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: mockPaperPortfolios }) });
    }
    if (url.includes('/api/level2/manual-trades')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            code: '000001',
            provider: 'manual-level2-paste',
            sourceType: 'manual-simulation',
            trades: [
              { sequence: 1, time: '09:30:01', price: 10.25, volume: 60000, amount: 615000, side: 'buy' },
              { sequence: 2, time: '09:30:02', price: 10.21, volume: 50000, amount: 510500, side: 'sell' }
            ],
            stats: {
              largeTradeCount: 2,
              largeBuyAmount: 615000,
              largeSellAmount: 510500,
              largeNetAmount: 104500,
              largeAmountRatio: 1
            }
          }
        })
      });
    }
    if (url.includes('/api/sector-leaders/1') && route.request().method() === 'PUT') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 1, sectorId: 1, code: '000001', name: '平安银行', role: '趋势龙头', note: '编辑测试', weight: 1 } })
      });
    }
    if (url.includes('/api/sector-leaders/1') && route.request().method() === 'DELETE') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { deleted: true } })
      });
    }
    if (url.includes('/api/sector-leaders/snapshots') && route.request().method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ code: '000001', name: '平安银行', sectorName: '测试板块', price: 11.28, change: 1.2, amount: 1000000, capturedAt: '2026-05-12T00:00:00.000Z' }]
        })
      });
    }
    if (url.includes('/api/sector-leaders/dashboard')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            sectors: [{
              id: 1,
              name: '测试板块',
              description: '测试',
              status: '偏强',
              leaders: [{
                id: 1,
                sectorId: 1,
                code: '000001',
                name: '平安银行',
                role: '观察股',
                price: 11.28,
                change: 1.2,
                amount: 100000000,
                strength: '平',
                note: '测试',
                weight: 1
              }]
            }],
            overview: [{ id: 1, sectorName: '测试板块', code: '000001', name: '平安银行', role: '观察股', price: 11.28, change: 1.2, amount: 100000000, strength: '平', note: '测试', weight: 1 }],
            risks: []
          }
        })
      });
    }
    return route.continue();
  });
});

test('AI research view creates grounded expert knowledge and saves a handoff result', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    window.webstockDesktop = {
      selectQuantPython() {
        return Promise.resolve('D:\\Webstock\\quant\\.venv\\Scripts\\python.exe');
      }
    };
  });
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.click('[data-main-view="aiResearch"]');

  await expect(page.locator('#aiResearchView')).toBeVisible();
  await expect(page.locator('#aiModelRegistry')).toContainText('本地可解释因子选股');
  await expect(page.locator('#aiModelRegistry')).toContainText('规划中');
  await expect(page.locator('#quantRuntimeStatus')).toContainText('已配置');
  await expect(page.locator('#quantRuntimeStatus')).toContainText('PyTorch 2.13.0');
  await expect(page.locator('#linkQuantRuntimeBtn')).toBeHidden();
  await expect(page.locator('#installQuantRuntimeBtn')).toBeHidden();
  await expect(page.locator('#repairQuantRuntimeBtn')).toBeVisible();
  await expect(page.locator('#quantIndexModeSelect')).toHaveValue('official');
  await expect(page.locator('#quantResultPanel')).toContainText('Rank IC');
  await expect(page.locator('#quantResultPanel')).toContainText('累计成本');
  await expect(page.locator('#quantResultPanel')).toContainText('当前名单存在幸存者偏差');
  await expect(page.locator('#quantResultPanel')).toContainText('平安银行');
  await expect(page.locator('#quantResultPanel')).toContainText('同数据模型');
  await expect(page.locator('#factorLabPanel')).toContainText('因子样本外体检');
  await expect(page.locator('#factorLabPanel')).toContainText('20日动量');
  await expect(page.locator('#factorLabPanel')).toContainText('样本外窗口少于3个');
  await expect(page.locator('#factorLabPanel')).toContainText('中芯国际');
  await page.fill('#decisionQuestionInput', '测试决策问题');
  await page.click('#buildDecisionPacketBtn');
  await expect(page.locator('#decisionPacketPanel')).toContainText('平安银行');
  await expect(page.locator('#decisionPacketPanel')).toContainText('缺少完整财报点时点数据');
  await expect(page.locator('#analyzeDecisionPacketBtn')).toBeEnabled();
  await page.click('#createPaperPortfolioBtn');
  await expect(page.locator('#decisionPacketStatus')).toContainText('测试纸面组合');
  await expect(page.locator('#paperPortfolioPanel')).toContainText('测试纸面组合');
  await page.selectOption('#paperPortfolioPanel [data-paper-status]', 'active');
  await expect(page.locator('#paperPortfolioPanel [data-paper-refresh]')).toBeEnabled();
  await page.click('#paperPortfolioPanel [data-paper-refresh]');
  await expect(page.locator('#paperPortfolioPanel')).toContainText('累计 120.00 / 0.12%');
  await page.selectOption('#quantModelSelect', 'master');
  await expect(page.locator('#quantResultPanel')).toContainText('MASTER 市场引导时序模型');
  await expect(page.locator('#quantResultPanel')).toContainText('宁德时代');

  await page.selectOption('#knowledgeSourceType', 'blog');
  await page.fill('#knowledgeSourceTitle', 'Playwright CPO 博主笔记');
  await page.fill('#knowledgeSourceAuthor', '测试博主');
  await page.fill('#knowledgeSourceTags', 'CPO, 光模块');
  await page.fill('#knowledgeSourceStocks', '300308');
  await page.fill('#knowledgeSourceContent', '光模块选股需要核对主营收入占比、客户资本开支、产品速率升级和估值。订单不及预期是重要反证。');
  await page.click('#saveKnowledgeSourceBtn');
  await expect(page.locator('#knowledgeSourceList')).toContainText('Playwright CPO 博主笔记');

  await page.fill('#knowledgeQuestionInput', '光模块选股需要核对什么？');
  await page.click('#searchKnowledgeBtn');
  await expect(page.locator('#knowledgeEvidenceResults')).toContainText('Playwright CPO 博主笔记');
  await expect(page.locator('#knowledgeEvidenceResults')).toContainText(/K[a-f0-9]+-1/i);

  await page.click('#analyzeKnowledgeBtn');
  await expect(page.locator('#handoffModalOverlay')).toBeVisible();
  await expect(page.locator('#handoffPromptText')).toHaveValue(/来源证据/);
  await page.fill('#handoffResultText', 'WEBSTOCK_RESULT_START\n# 专家知识库分析\n核对主营收入、客户资本开支与订单兑现。\nWEBSTOCK_RESULT_END');
  await page.click('#handoffSaveBtn');
  await expect(page.locator('#knowledgeResearchRuns')).toContainText('核对主营收入');

  await page.click('[data-main-view="screener"]');
  await page.fill('#screenerDemand', 'CPO 300308 专家框架复核');
  await page.click('#runScreenerBtn');
  await expect(page.locator('#screenerResults table')).toBeVisible();
  await page.click('#screenerKnowledgeBtn');
  await expect(page.locator('#aiResearchView')).toBeVisible();
  await expect(page.locator('#handoffModalOverlay')).toBeVisible();
  await expect(page.locator('#handoffPromptText')).toHaveValue(/待复核候选/);
  await expect(page.locator('#handoffPromptText')).toHaveValue(/CPO|300308/i);
});

test('research library manages people, books, methods and curve material', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/stocklist', async route => {
    await new Promise(resolve => setTimeout(resolve, 750));
    await route.continue();
  });
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.click('[data-main-view="aiResearch"]');
  await expect(page.locator('#aiResearchView')).toBeVisible();

  await page.click('#expertSubjectEditor summary');
  await page.selectOption('#expertSubjectTypeSelect', 'method');
  await page.fill('#expertSubjectPlatformInput', 'manual');
  await page.fill('#expertSubjectNameInput', 'Playwright 曲线分析方法');
  await page.fill('#expertSubjectAliasesInput', '趋势曲线, 图形方法');
  await page.fill('#expertSubjectDescriptionInput', '用于验证结构化曲线资料的新增和删除。');
  await page.click('#saveExpertSubjectBtn');
  await expect(page.locator('#expertChannelSelect')).toContainText('Playwright 曲线分析方法');

  await page.click('#expertObservationEditor summary');
  await page.selectOption('#expertMediaTypeSelect', 'chart');
  await page.selectOption('#expertArchiveStatusSelect', 'local_reference');
  await page.selectOption('#expertRightsBasisSelect', 'user_owned');
  await page.fill('#expertObservationTitleInput', '两点趋势样例');
  await page.fill('#expertObservationSummaryInput', '用户自有的曲线分析样例。');
  await page.fill('#expertCurveDataInput', '起点,10\n终点,12.5');
  await page.fill('#expertAnalysisNotesInput', '终点高于起点；真实分析还需说明窗口与反例。');
  await page.click('#saveExpertObservationBtn');
  await expect(page.locator('#expertTimeline')).toContainText('两点趋势样例');
  await expect(page.locator('#expertTimeline')).toContainText('终点高于起点');
  await expect(page.locator('.expert-curve-chart')).toHaveCount(1);

  await page.click('.expert-delete-observation');
  await expect(page.locator('#expertTrackerStatus')).toContainText('资料及其知识索引已删除');
  await page.click('#deleteExpertChannelBtn');
  await expect(page.locator('#expertChannelSelect')).not.toContainText('Playwright 曲线分析方法');
});

test('research library imports and deduplicates direct Douyin share links', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.click('[data-main-view="aiResearch"]');

  await page.click('#expertSubjectEditor summary');
  await page.selectOption('#expertSubjectTypeSelect', 'creator');
  await page.fill('#expertSubjectPlatformInput', 'douyin');
  await page.fill('#expertSubjectNameInput', 'Playwright 抖音公开作者');
  await page.click('#saveExpertSubjectBtn');

  await expect(page.locator('#openDouyinSearchBtn')).toBeVisible();
  await expect(page.locator('#expertDouyinImporter')).toBeVisible();
  await page.click('#expertDouyinImporter summary');
  await page.fill('#expertDouyinShareTextInput', [
    '测试抖音直链 https://jingxuan.douyin.com/m/video/7641362696420887025',
    '重复 https://www.douyin.com/video/7641362696420887025?from=copy',
    '无关 https://example.com/video/1'
  ].join('\n'));
  await page.click('#importDouyinLinksBtn');

  await expect(page.locator('#expertTrackerStatus')).toContainText('新增 1 条，重复 1 条，忽略 1 条');
  await expect(page.locator('#expertChannelSelect')).toContainText('抖音直链 1');
  await expect(page.locator('#expertCreatorWorkbench')).toContainText('[待核验抖音账号]');
  await expect(page.locator('#expertCreatorVideoDetail a[href="https://www.douyin.com/video/7641362696420887025"]')).toHaveText('打开来源页面');

  await page.click('#deleteExpertChannelBtn');
  await expect(page.locator('#expertChannelSelect')).not.toContainText('Playwright 抖音公开作者');
});

test('desktop research library opens a persistent Douyin session and syncs the visible page', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    window.__douyinOpenCalls = [];
    window.webstockDesktop = {
      openDouyinSession(url) {
        window.__douyinOpenCalls.push(url);
        return Promise.resolve({ supported: true, windowOpen: true, currentUrl: url });
      },
      getDouyinSessionStatus() {
        return Promise.resolve({ supported: true, windowOpen: false, currentUrl: '' });
      },
      collectDouyinPage() {
        return Promise.resolve({
          pageType: 'profile',
          pageUrl: 'https://www.douyin.com/user/playwright-desktop-author',
          loggedIn: true,
          capturedAt: '2026-08-11T10:00:00.000Z',
          profile: {
            displayName: '桌面抖音作者',
            profileUrl: 'https://www.douyin.com/user/playwright-desktop-author',
            douyinId: 'playwright-author',
            workCount: 1
          },
          items: [{
            sourceUrl: 'https://www.douyin.com/video/7512345678901234567',
            title: '桌面会话同步测试视频',
            publishedAt: '2026-08-11T09:30:00+08:00',
            summary: '从当前可见页面读取的摘要。',
            author: '桌面抖音作者'
          }]
        });
      }
    };
  });
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.click('[data-main-view="aiResearch"]');

  await page.click('#expertSubjectEditor summary');
  await page.selectOption('#expertSubjectTypeSelect', 'creator');
  await page.fill('#expertSubjectPlatformInput', 'douyin');
  await page.fill('#expertSubjectNameInput', '桌面抖音作者');
  await page.fill('#expertSubjectUrlInput', 'https://www.douyin.com/user/playwright-desktop-author');
  await page.click('#saveExpertSubjectBtn');

  await expect(page.locator('#openDouyinSessionBtn')).toBeVisible();
  await expect(page.locator('#syncDouyinSessionBtn')).toBeVisible();
  await page.click('#openDouyinSessionBtn');
  await expect.poll(() => page.evaluate(() => window.__douyinOpenCalls.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__douyinOpenCalls[0]))
    .toBe('https://www.douyin.com/user/playwright-desktop-author');

  await page.click('#syncDouyinSessionBtn');
  await expect(page.locator('#douyinDesktopSessionStatus')).toContainText('同步完成');
  await expect(page.locator('#douyinDesktopSessionStatus')).toContainText('新增 1 条');
  await expect(page.locator('#expertCreatorWorkbench')).toContainText('桌面会话同步测试视频');
  await expect(page.locator('#expertCreatorVideoDetail')).toContainText('原始来源 / 本人公开');

  const channelId = await page.locator('#expertChannelSelect').inputValue();
  await page.request.post(baseURL + '/api/expert/channels/' + channelId + '/observations', {
    data: {
      externalContentId: '7512345678901234567',
      sourceUrl: 'https://www.douyin.com/video/7512345678901234567',
      title: '桌面会话同步测试视频',
      contentRole: 'transcript',
      content: '这是本地语音识别得到的完整内容。',
      transcript: '这是本地语音识别得到的完整内容。',
      mediaMetadata: {
        asr: {
          status: 'complete', model: 'small', computeType: 'int8',
          segments: [{ start: 0.5, end: 3.2, text: '这是本地语音识别得到的完整内容。' }]
        }
      }
    }
  });
  await page.click('#refreshExpertTimelineBtn');
  await expect(page.locator('#expertCreatorVideoDetail')).toContainText('ASR 原始逐字稿');
  await expect(page.locator('.expert-asr-segments summary')).toContainText('带时间戳逐字稿');
  await page.locator('.expert-asr-segments summary').click();
  await expect(page.locator('.expert-asr-segments')).toContainText('00:00–00:03');

  await page.click('#deleteExpertChannelBtn');
  await expect(page.locator('#expertChannelSelect')).not.toContainText('桌面抖音作者');
});

test('Douyin creator workbench shows coverage, searchable videos and transcript detail', async ({ page }) => {
  const channelResponse = await page.request.post(baseURL + '/api/expert/channels', {
    data: {
      channelKey: 'playwright-douyin-workbench',
      displayName: '工作台测试作者',
      subjectType: 'creator',
      platform: 'douyin',
      profileUrl: 'https://www.douyin.com/user/playwright-workbench'
    }
  });
  const channel = (await channelResponse.json()).data;
  await page.request.post(baseURL + '/api/expert/channels/' + channel.id + '/observations', {
    data: {
      externalContentId: '7000000000000000101',
      sourceUrl: 'https://www.douyin.com/video/7000000000000000101',
      title: '已转写视频',
      mediaType: 'video',
      evidenceLevel: 'primary',
      contentRole: 'transcript',
      publishedAt: '2026-08-10T08:00:00.000Z',
      transcript: '先进封装的订单兑现和国产设备进展需要持续核对。',
      summary: '页面摘要：讨论先进封装。',
      sectors: ['先进封装'],
      mediaMetadata: { asr: { status: 'complete', model: 'small', computeType: 'int8', segments: [
        { start: 0, end: 4.2, text: '先进封装的订单兑现和国产设备进展需要持续核对。' }
      ] } }
    }
  });
  await page.request.post(baseURL + '/api/expert/channels/' + channel.id + '/observations', {
    data: {
      externalContentId: '7000000000000000102',
      sourceUrl: 'https://www.douyin.com/video/7000000000000000102',
      title: '待处理视频',
      mediaType: 'video',
      evidenceLevel: 'primary',
      contentRole: 'fact_summary',
      publishedAt: '2026-08-11T08:00:00.000Z',
      summary: '等待本地语音转写。',
      sectors: ['半导体设备']
    }
  });

  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.click('[data-main-view="aiResearch"]');
  await page.selectOption('#expertChannelSelect', String(channel.id));

  await expect(page.locator('#expertCreatorWorkbench')).toBeVisible();
  await expect(page.locator('#expertCreatorWorkbench video')).toHaveCount(0);
  await expect(page.locator('#expertCreatorStats')).toContainText('视频资料');
  await expect(page.locator('#expertCreatorStats')).toContainText('50%');
  await expect(page.locator('#expertCreatorVideoList .creator-video-row')).toHaveCount(2);
  await page.getByRole('button', { name: /已转写视频/ }).click();
  await expect(page.locator('#expertCreatorVideoDetail')).toContainText('先进封装的订单兑现');
  await expect(page.locator('#expertCreatorVideoDetail')).toContainText('00:00–00:04');
  await page.fill('#expertCreatorSearchInput', '待处理');
  await expect(page.locator('#expertCreatorVideoList .creator-video-row')).toHaveCount(1);
  await expect(page.locator('#expertCreatorVideoList')).toContainText('待处理视频');
});

test('portfolio accounts switch without mixing holdings or trades', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.click('[data-main-view="portfolio"]');
  await expect(page.locator('#portfolioAccountSelect')).toContainText('默认账户');

  await page.click('#addPortfolioAccountBtn');
  await expect(page.locator('#portfolioAccountModalOverlay')).toBeVisible();
  await page.fill('#portfolioAccountNameInput', 'Playwright 独立账户');
  await page.fill('#portfolioAccountBrokerInput', '测试券商');
  await page.fill('#portfolioAccountMaskedInput', '**9901');
  await page.fill('#portfolioAccountCashInput', '12000');
  await page.click('#portfolioAccountModalOk');
  await expect(page.locator('#portfolioAccountSelect')).toContainText('Playwright 独立账户');
  await expect(page.locator('#portfolioAccountSelect')).not.toContainText('**9901 **9901');
  await expect(page.locator('#summaryCashBalance')).toHaveText('12000.00');

  const isolatedAccountId = await page.locator('#portfolioAccountSelect').inputValue();
  await page.click('#addTradeFromPortfolioBtn');
  await page.fill('#tradeCodeInput', '601999');
  await page.fill('#tradeNameInput', '出版传媒');
  await page.selectOption('#tradeSideInput', 'buy');
  await page.fill('#tradePriceInput', '8.5');
  await page.fill('#tradeQuantityInput', '100');
  await page.click('#tradeModalOk');
  await expect(page.locator('#positionsTbody')).toContainText('601999');
  await expect(page.locator('#positionsTbody tr[data-code="601999"] .stock-mini-chart polyline')).toHaveCount(1);
  await expect(page.locator('#positionsTbody tr[data-code="601999"] .stock-mini-chart')).not.toContainText('OHLC');
  await expect(page.locator('#positionsTable').locator('..')).toHaveCSS('flex-shrink', '0');

  await page.selectOption('#portfolioAccountSelect', { label: '默认账户' });
  await expect(page.locator('#positionsTbody')).not.toContainText('601999');
  await page.selectOption('#portfolioAccountSelect', isolatedAccountId);
  await expect(page.locator('#positionsTbody')).toContainText('601999');
  await page.click('[data-main-view="trades"]');
  await expect(page.locator('#tradeAccountSelect')).toHaveValue(isolatedAccountId);
  await expect(page.locator('#tradesTbody')).toContainText('601999');
});

test('main stock actions and workspace navigation do not throw', async ({ page }) => {
  const dialogResponses = [];
  const dialogMessages = [];
  page.on('dialog', async dialog => {
    dialogMessages.push(dialog.message());
    const next = dialogResponses.length ? dialogResponses.shift() : '';
    if (dialog.type() === 'confirm') await dialog.accept();
    else await dialog.accept(next);
  });

  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#stockTbody tr');
  await expect(page.locator('#themeToggle')).toHaveAttribute('aria-label', /切换/);
  await expect(page.locator('#clearBtn')).toHaveAttribute('aria-label', /清空/);

  await expect(page.locator('#sidebarWorkspaceNav')).toBeVisible();
  await expect(page.locator('#sidebarWatchlistBtn')).toContainText('自选');
  await expect(page.locator('#stockTbody tr:first-child [data-action]')).toHaveCount(0);
  await page.fill('#searchInput', '000001');
  await page.click('#stockTbody tr:first-child');
  await expect(page.locator('#analysisBtn')).toBeVisible();
  await expect(page.locator('#chartTitle')).toContainText('平安银行');
  await expect(page.locator('#detailLevel2Panel')).toBeVisible();
  await page.click('#detailFreeFlowBtn');
  await expect(page.locator('#detailFreeFlowBox')).toContainText('6.00');
  await page.fill('#detailManualLevel2Input', '09:30:01 10.25 60000 买入\n09:30:02 10.21 50000 卖出');
  await page.click('#detailAnalyzeManualLevel2Btn');
  await expect(page.locator('#detailLevel2Result')).toContainText('104500');
  await expect.poll(() => page.evaluate(() => Object.keys(window.State.klineSnapshots || {}).length)).toBeGreaterThan(0);

  await page.click('#stockTbody tr:first-child .star-btn');
  await page.click('#sidebarWatchlistBtn');
  await expect(page.locator('#watchlistView')).toBeVisible();
  await expect(page.locator('#watchlistTbody')).toContainText('000001');
  dialogResponses.push('测试分组', '测试备注', '10', '8');
  await page.click('#watchlistTbody [data-action="edit"]');
  await expect(page.locator('#watchlistTbody')).toContainText('测试备注');
  await expect(page.locator('#watchlistTbody')).toContainText('Alert high');
  dialogResponses.push('批量测试分组');
  await page.click('#bulkWatchlistGroupBtn');
  await expect(page.locator('#watchlistTbody')).toContainText('批量测试分组');
  await page.fill('#watchlistSearchInput', '批量测试分组');
  await expect(page.locator('#watchlistTbody')).toContainText('000001');
  await page.fill('#watchlistSearchInput', 'no-watchlist-match');
  await expect(page.locator('#watchlistEmpty')).toBeVisible();
  await page.fill('#watchlistSearchInput', '');
  const watchlistExportPromise = page.waitForEvent('download');
  await page.click('#exportWatchlistCsvBtn');
  const watchlistExport = await watchlistExportPromise;
  expect(watchlistExport.suggestedFilename()).toMatch(/^webstock-watchlist-/);
  await page.click('#watchlistTbody [data-action="view"]');
  await expect(page.locator('#detailWatchlistStatus')).toContainText('Alert high');

  await page.click('#analysisBtn');
  await expect(page.locator('#analysisOverlay')).toBeVisible();
  await expect(page.locator('#analysisPanelBody')).toContainText('测试提示词');

  await page.click('#analysisCloseBtn');
  await page.click('[data-main-view="recent"]');
  await expect(page.locator('#recentView')).toBeVisible();
  await page.fill('#recentSearchInput', '000001');
  await expect(page.locator('#recentStocksTbody')).toContainText('000001');
  await page.fill('#recentSearchInput', 'no-recent-match');
  await expect(page.locator('#recentStocksEmpty')).toBeVisible();
  await page.fill('#recentSearchInput', '');
  await page.selectOption('#recentSortSelect', 'view_count');
  const recentExportPromise = page.waitForEvent('download');
  await page.click('#exportRecentStocksCsvBtn');
  const recentExport = await recentExportPromise;
  expect(recentExport.suggestedFilename()).toMatch(/^webstock-recent-stocks-/);

  await page.click('[data-main-view="news"]');
  await expect(page.locator('#newsView')).toBeVisible();
  await expect(page.locator('#newsProviderStatus')).toContainText(/News provider|fallback|新闻加载回退|新闻来源/i);
  await page.fill('#newsKeywordInput', 'definitely-no-news-match');
  await page.press('#newsKeywordInput', 'Enter');
  await expect(page.locator('#newsList')).toContainText('No news is available');
  await page.fill('#newsKeywordInput', 'Workbench');
  await page.click('#refreshNewsBtn');
  await expect(page.locator('#newsList')).toContainText('Workbench checklist');
  await expect(page.locator('#newsList')).toContainText('1 items');
  await page.fill('#newsKeywordInput', '');
  await page.click('#refreshNewsBtn');

  await page.click('[data-main-view="watchlist"]');
  await expect(page.locator('#watchlistView')).toBeVisible();

  await page.click('[data-main-view="portfolio"]');
  await expect(page.locator('#portfolioView')).toBeVisible();
  await page.click('#addTradeFromPortfolioBtn');
  await expect(page.locator('#tradeModalOverlay')).toBeVisible();
  await page.fill('#tradeCodeInput', '000001');
  await page.fill('#tradeNameInput', '=Ping An Bank');
  await page.selectOption('#tradeSideInput', 'buy');
  await page.fill('#tradePriceInput', '10');
  await page.fill('#tradeQuantityInput', '1000');
  await expect(page.locator('#tradeAmountPreview')).toContainText('10005.00');
  await page.click('#tradeModalOk');
  await expect(page.locator('#positionsTbody')).toContainText('000001', { timeout: 15000 });
  await expect(page.locator('#closedPositionsPanel')).toContainText('No closed positions yet');
  await page.fill('#positionSearchInput', '000001');
  await expect(page.locator('#positionsTbody')).toContainText('000001');
  await page.selectOption('#positionSortSelect', 'return');
  await page.fill('#positionSearchInput', 'no-position-match');
  await expect(page.locator('#portfolioEmpty')).toContainText('No positions match current filters');
  await page.fill('#positionSearchInput', '');
  const positionsDownloadPromise = page.waitForEvent('download');
  await page.click('#exportPositionsCsvBtn');
  const positionsDownload = await positionsDownloadPromise;
  expect(positionsDownload.suggestedFilename()).toMatch(/^webstock-positions-/);
  const positionsCsv = fs.readFileSync(await positionsDownload.path(), 'utf8');
  expect(positionsCsv).toContain('code,name,quantity');
  expect(positionsCsv).toContain('000001');
  expect(positionsCsv).toContain("'=Ping An Bank");
  const tradesDownloadPromise = page.waitForEvent('download');
  await page.click('#exportTradesFromPortfolioBtn');
  const tradesDownload = await tradesDownloadPromise;
  expect(tradesDownload.suggestedFilename()).toBe('webstock-trades.csv');
  await page.dblclick('#positionsTbody tr[data-code="000001"]');
  await expect(page.locator('#marketView')).toBeVisible();
  await page.click('[data-main-view="portfolio"]');
  await page.click('#positionsTbody tr[data-code="000001"]', { button: 'right' });
  await page.click('#stockContextMenu [data-action="sell"]');
  await expect(page.locator('#tradeModalOverlay')).toBeVisible();
  await expect(page.locator('#tradeAmountPreview')).toContainText('Estimated inflow');
  await page.fill('#tradeQuantityInput', '2000');
  await page.click('#tradeModalOk');
  await expect.poll(() => dialogMessages.some(message => message.includes('卖出数量不能超过当前持仓'))).toBeTruthy();
  await page.click('#tradeModalCancel');
  await expect(page.locator('#tradeModalOverlay')).toBeHidden();

  await page.click('#addTradeFromPortfolioBtn');
  await expect(page.locator('#tradeModalOverlay')).toBeVisible();
  await page.fill('#tradeCodeInput', '000002');
  await page.fill('#tradeNameInput', '=Export Test');
  await page.selectOption('#tradeSideInput', 'buy');
  await page.fill('#tradePriceInput', '8');
  await page.fill('#tradeQuantityInput', '100');
  await page.click('#tradeModalOk');
  await expect(page.locator('#positionsTbody')).toContainText('000002');
  await page.click('#positionsTbody tr[data-code="000002"]', { button: 'right' });
  await page.click('#stockContextMenu [data-action="sell"]');
  await expect(page.locator('#tradeModalOverlay')).toBeVisible();
  await page.fill('#tradeQuantityInput', '100');
  await page.click('#tradeModalOk');
  await expect(page.locator('#closedPositionsPanel')).toContainText('000002');
  await expect(page.locator('#closedPositionsPanel')).toContainText('Win rate');
  const closedDownloadPromise = page.waitForEvent('download');
  await page.click('#closedPositionsPanel [data-action="exportClosedPositions"]');
  const closedDownload = await closedDownloadPromise;
  expect(closedDownload.suggestedFilename()).toMatch(/^webstock-closed-positions-/);
  const closedCsv = fs.readFileSync(await closedDownload.path(), 'utf8');
  expect(closedCsv).toContain('code,name,realized_pnl');
  expect(closedCsv).toContain('000002');
  expect(closedCsv).toContain("'=Export Test");

  await page.click('[data-main-view="trades"]');
  await expect(page.locator('#tradesView')).toBeVisible();
  await page.fill('#tradeCodeFilter', '000002');
  await page.selectOption('#tradeSideFilter', 'sell');
  await expect(page.locator('#tradesTbody')).toContainText('000002');
  await page.click('#resetTradeFiltersBtn');
  await expect(page.locator('#tradeCodeFilter')).toHaveValue('');
  await expect(page.locator('#tradeSideFilter')).toHaveValue('');
  await expect(page.locator('#tradesTbody')).toContainText('000001');
  await expect(page.locator('#tradesResultSummary')).toContainText('Showing');
  await page.fill('#tradeCodeFilter', 'no-trade-match');
  await expect(page.locator('#tradesEmpty')).toContainText('No trades match current filters');
  await expect(page.locator('#tradesResultSummary')).toContainText('No trades match current filters');
  await page.click('#resetTradeFiltersBtn');
  await expect(page.locator('#tradesTbody')).toContainText('000001');

  await page.click('[data-main-view="screener"]');
  await expect(page.locator('#screenerView')).toBeVisible();
  await expect(page.locator('#screenerStrategyHint')).toContainText('Stable watchlist');
  await page.selectOption('#screenerStrategy', 'breakout');
  await expect(page.locator('#screenerStrategyHint')).toContainText('Trend breakout');
  await page.click('#runScreenerBtn');
  await expect(page.locator('#screenerResults')).toContainText('不构成投资建议');
  await expect(page.locator('#screenerResults .factor-tag').first()).toBeVisible();
  await expect(page.locator('#screenerResults .factor-impact').first()).toBeVisible();
  await expect(page.locator('#screenerResults .screener-result-summary')).toContainText(/Showing/);
  await page.fill('#screenerMinScoreInput', '101');
  await expect(page.locator('#screenerResults')).toContainText('No candidates match current result filters');
  await page.click('#resetScreenerFiltersBtn');
  await expect(page.locator('#screenerMinScoreInput')).toHaveValue('0');
  await expect(page.locator('#screenerResults .factor-tag').first()).toBeVisible();
  await page.fill('#screenerResultKeywordInput', '000001');
  await expect(page.locator('#screenerResults .factor-tag').first()).toBeVisible();
  await page.fill('#screenerResultKeywordInput', '');
  const csvDownloadPromise = page.waitForEvent('download');
  await page.click('#exportScreenerCsvBtn');
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/^webstock-screener-/);
  dialogResponses.push('Playwright screener save');
  await page.click('#saveScreenerResultBtn');
  await expect(page.locator('#screenerHistory')).toContainText('Playwright screener save');
  dialogResponses.push('Playwright screener renamed');
  await page.click('#screenerHistory [data-history-action="rename"]');
  await expect(page.locator('#screenerHistory')).toContainText('Playwright screener renamed');
  await page.click('#runScreenerBtn');
  dialogResponses.push('Playwright screener second');
  await page.click('#saveScreenerResultBtn');
  await expect(page.locator('#screenerHistory')).toContainText('Playwright screener second');
  await expect(page.locator('#screenerHistory')).toContainText('Compare latest two');
  await page.click('#screenerHistory [data-history-action="compare-latest"]');
  await expect(page.locator('#screenerResults')).toContainText('Saved screener comparison');
  await expect(page.locator('#screenerResults')).toContainText('Playwright screener renamed');
  await page.click('#screenerHistory [data-history-action="details"]');
  await expect(page.locator('#screenerResults')).toContainText('Saved screener task');
  await expect(page.locator('#screenerResults')).toContainText('Playwright screener second');
  dialogResponses.push('priority', 'Playwright candidate note');
  await page.click('#screenerResults [data-detail-action="review"]');
  await expect(page.locator('#screenerResults')).toContainText('priority');
  await expect(page.locator('#screenerResults')).toContainText('Playwright candidate note');
  await expect(page.locator('#screenerResults .review-summary')).toContainText('priority: 1');
  await page.selectOption('#candidateReviewFilter', 'priority');
  await expect(page.locator('#screenerResults')).toContainText('Playwright candidate note');
  await page.selectOption('#candidateReviewFilter', 'all');
  await page.click('[data-main-view="dashboard"]');
  await expect(page.locator('#dashboardScreenerReviewList')).toContainText('priority 1');
  await page.click('#refreshDashboardBtn');
  await expect(page.locator('#dashboardUpdatedAt')).toContainText('Last refreshed:');
  await expect(page.locator('#refreshDashboardBtn')).toHaveText(/工作台/);
  await expect(page.locator('#refreshDashboardBtn')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#refreshDashboardBtn')).toBeEnabled();
  await expect(page.locator('#dashboardView')).toBeVisible();
  await page.click('#dashboardScreenerReviewList [data-screener-id]');
  await expect(page.locator('#screenerView')).toBeVisible();
  await expect(page.locator('#screenerResults')).toContainText('Saved screener task');
  await expect(page.locator('#screenerResults')).toContainText('Playwright candidate note');
  dialogResponses.push('done', 'Playwright bulk note');
  await page.click('#screenerResults [data-detail-action="bulkReview"]');
  await expect(page.locator('#screenerResults')).toContainText('done');
  await expect(page.locator('#screenerResults')).toContainText('Playwright bulk note');
  await page.click('#screenerHistory [data-history-action="compare-selected"]');
  await expect(page.locator('#screenerResults')).toContainText('Saved screener comparison');
  await page.click('#screenerAiBtn');
  await expect(page.locator('#handoffModalOverlay')).toBeVisible();
  await page.fill('#handoffResultText', [
    '前置解释文字',
    'WEBSTOCK_RESULT_START',
    '# ChatGPT 返回结果测试',
    '- 优先观察：测试股票',
    'WEBSTOCK_RESULT_END',
    '后置解释文字'
  ].join('\n'));
  await page.click('#handoffSaveBtn');
  await expect(page.locator('#handoffModalOverlay')).toBeHidden();
  await expect(page.locator('#screenerHistory')).toContainText('AI saved');
  await expect(page.locator('#screenerResults')).toContainText('ChatGPT 返回结果测试');
  await expect(page.locator('#screenerResults')).not.toContainText('WEBSTOCK_RESULT_START');
  await page.click('[data-main-view="aiHistory"]');
  await expect(page.locator('#aiHistoryView')).toBeVisible();
  await expect(page.locator('#aiHistoryList')).toContainText('ChatGPT 返回结果测试');
  await expect(page.locator('#aiHistoryList')).toContainText('智能选股');
  await page.click('[data-main-view="screener"]');
  await page.click('#screenerHistory [data-history-action="delete"]');
  await expect(page.locator('#screenerHistory')).toContainText('Playwright screener renamed');
  await page.click('#screenerHistory [data-history-action="delete"]');
  await expect(page.locator('#screenerHistory')).toContainText('No saved screener tasks');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('webstock_ai_handoff_results') || '[]'));
  expect(saved[0].result).toContain('ChatGPT 返回结果测试');
  expect(saved[0].result).not.toContain('WEBSTOCK_RESULT_START');

  await page.click('[data-main-view="settings"]');
  await expect(page.locator('#settingsView')).toBeVisible();
  await expect(page.locator('#settingsAiStatus')).toContainText(/Handoff mode|Enabled/);
  await expect(page.locator('#settingsLevel2Status')).toContainText(/Not configured|Configured/);
  await expect(page.locator('#level2OfficialLoginLink')).toHaveAttribute('href', /quantapi\.10jqka\.com\.cn/);
  await page.selectOption('#level2ProviderInput', 'tonghuashun-http');
  await page.fill('#level2BaseUrlInput', 'http://127.0.0.1:18180');
  await page.fill('#level2ApiKeyInput', 'front-end-secret-token');
  await page.click('#saveLevel2ConfigBtn');
  await expect(page.locator('#settingsLevel2TestResult')).toContainText('saved');
  await expect(page.locator('#settingsLevel2Status')).toContainText('Configured');
  await expect(page.locator('#settingsLevel2Status')).not.toContainText('front-end-secret-token');
  await expect(page.locator('#testFreeFlowCurrentStockBtn')).toBeVisible();
  await page.fill('#manualLevel2PasteInput', '09:30:01 10.25 60000 买入\n09:30:02 10.21 50000 卖出');
  await page.click('#analyzeManualLevel2Btn');
  await expect(page.locator('#settingsLevel2TestResult')).toContainText('粘贴模拟');
  await expect(page.locator('#settingsLevel2TestResult')).toContainText('大单净额 104500');
  await expect(page.locator('#savedHandoffResults')).toContainText('ChatGPT');
  await expect(page.locator('#exportUserDataBtn')).toBeVisible();
  await expect(page.locator('#importUserDataBtn')).toBeVisible();
  const watchlistTemplatePromise = page.waitForEvent('download');
  await page.click('#downloadWatchlistTemplateBtn');
  const watchlistTemplate = await watchlistTemplatePromise;
  expect(watchlistTemplate.suggestedFilename()).toBe('webstock-watchlist-template.csv');
  const tradesTemplatePromise = page.waitForEvent('download');
  await page.click('#downloadTradesTemplateBtn');
  const tradesTemplate = await tradesTemplatePromise;
  expect(tradesTemplate.suggestedFilename()).toBe('webstock-trades-template.csv');
  await page.fill('#riskDrawdownInput', '5');
  await page.fill('#riskDailyDropInput', '2');
  await page.fill('#riskLeaderDropInput', '2');
  await page.click('#saveRiskSettingsBtn');
  await expect(page.locator('#settingsRiskStatus')).toContainText('saved');
  await page.click('#resetRiskSettingsBtn');
  await expect(page.locator('#settingsRiskStatus')).toContainText('reset to defaults');
  await expect(page.locator('#riskDrawdownInput')).toHaveValue('8');
  await expect(page.locator('#riskDailyDropInput')).toHaveValue('3');
  await expect(page.locator('#riskLeaderDropInput')).toHaveValue('3');

  const sectorLeaders = [{
    id: 1,
    sectorId: 1,
    code: '000001',
    name: 'Ping An Bank',
    role: 'observe',
    price: 11.28,
    change: 1.2,
    amount: 100000000,
    strength: 'flat',
    note: 'test',
    weight: 1
  }];
  await page.route('**/api/sectors/1/leaders', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = JSON.parse(route.request().postData() || '{}');
    const leader = Object.assign({
      id: 2,
      sectorId: 1,
      price: 10.1,
      change: 0.8,
      amount: 50000000,
      strength: 'flat',
      weight: 1
    }, body);
    sectorLeaders.push(leader);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: leader }) });
  });
  await page.route('**/api/sector-leaders/dashboard', route => {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          sectors: [{ id: 1, name: 'Test Sector', description: 'test', status: 'flat', leaders: sectorLeaders }],
          overview: sectorLeaders.map(item => Object.assign({ sectorName: 'Test Sector' }, item)),
          risks: []
        }
      })
    });
  });
  await page.click('[data-main-view="sectors"]');
  await expect(page.locator('#sectorsView')).toBeVisible();
  await page.evaluate(() => window.SectorLeaders.load());
  await expect(page.locator('#sectorDashboard')).toContainText('编辑');
  await expect(page.locator('#sectorDashboard')).toContainText('删除');
  await expect(page.locator('#sectorDashboard')).toContainText('History');
  dialogResponses.push('000002', 'Added Leader', '趋势龙头', 'added note');
  await page.click('#sectorDashboard [data-action="addLeader"]');
  await expect(page.locator('#sectorDashboard')).toContainText('Added Leader');
  await expect(page.locator('#sectorDashboard')).toContainText('added note');
  await page.selectOption('#sectorRoleFilter', '趋势龙头');
  await expect(page.locator('#sectorDashboard')).toContainText('Added Leader');
  await expect(page.locator('#sectorDashboard')).not.toContainText('Ping An Bank');
  await page.selectOption('#sectorRoleFilter', '');
  await page.fill('#sectorKeywordFilter', 'Added');
  await expect(page.locator('#sectorDashboard')).toContainText('Added Leader');
  await expect(page.locator('#sectorDashboard')).not.toContainText('Ping An Bank');
  await page.fill('#sectorKeywordFilter', '');
  await page.click('#sectorDashboard [data-action="leaderHistory"]');
  await expect(page.locator('#sectorDashboard')).toContainText('Leader history');
  await page.click('#sectorDashboard [data-action="backToSectors"]');
  await expect(page.locator('#sectorDashboard')).toContainText('History');
  dialogResponses.push('000001', '平安银行', '趋势龙头', '1', '编辑测试', '测试理由');
  await page.click('#sectorDashboard [data-action="editLeader"]');
  await page.click('#sectorDashboard [data-action="deleteLeader"]');
  await page.click('#sectorTrendBtn');
  await expect(page.locator('#sectorDashboard')).toContainText('Leader trends');
  const sectorDownloadPromise = page.waitForEvent('download');
  await page.click('#sectorExportSnapshotsBtn');
  const sectorDownload = await sectorDownloadPromise;
  expect(sectorDownload.suggestedFilename()).toMatch(/^webstock-sector-snapshots-/);
  const sectorConfigDownloadPromise = page.waitForEvent('download');
  await page.click('#sectorExportConfigBtn');
  const sectorConfigDownload = await sectorConfigDownloadPromise;
  expect(sectorConfigDownload.suggestedFilename()).toMatch(/^webstock-sector-config-/);
  const sectorImportPath = path.join(os.tmpdir(), 'webstock-sector-config-import-' + process.pid + '.json');
  fs.writeFileSync(sectorImportPath, JSON.stringify({
    sectors: [{
      name: 'Playwright Imported Sector',
      description: 'imported from frontend test',
      leaders: [{ code: '000003', name: 'Imported Leader', role: '观察股', note: 'frontend import' }]
    }]
  }));
  await page.setInputFiles('#sectorImportConfigFile', sectorImportPath);
  await expect.poll(() => dialogMessages.some(message => message.includes('Imported sector config'))).toBeTruthy();
  await expect(page.locator('#sectorPruneSnapshotsBtn')).toBeVisible();
  await page.click('#sectorAiBtn');
  await expect(page.locator('#handoffModalOverlay')).toBeVisible();
  await expect(page.locator('#handoffCopyOpenBtn')).toBeVisible();
  await expect(page.locator('#handoffImportClipboardBtn')).toBeVisible();
  await page.fill('#handoffResultText', '板块热股 ChatGPT 分析记录');
  await page.click('#handoffSaveBtn');
  await page.click('#sidebarAiHistoryBtn');
  await expect(page.locator('#aiHistoryView')).toBeVisible();
  await expect(page.locator('#aiHistoryList')).toContainText('板块热股 ChatGPT 分析记录');
  await expect(page.locator('#aiHistoryList')).toContainText('板块龙头');

  await page.click('[data-main-view="dashboard"]');
  await expect(page.locator('#dashboardView')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('#dashboardWatchlistList')).toContainText('Alert high');
  await page.evaluate(() => {
    window.State.watchlist = [{ code: '000001', name: 'Ping An Bank', price: 7, alertLow: 8, alertHigh: 20 }];
    window.State.positions = [{ code: '000002', name: 'Risk Position', unrealizedPnlRate: -12, todayChange: -4 }];
    window.Dashboard.renderRisks();
  });
  await expect(page.locator('#dashboardRiskList')).toContainText('触及低价提醒');
  await expect(page.locator('#dashboardRiskList')).toContainText('持仓回撤');
  const riskCount = await page.locator('#dashboardRiskList .risk-item').count();
  await page.locator('#dashboardRiskList .risk-item').first().click({ button: 'right' });
  await page.click('#stockContextMenu [data-dashboard-risk-action="dismiss"]');
  await expect.poll(() => page.locator('#dashboardRiskList .risk-item').count()).toBeLessThan(riskCount);
  await expect(page.locator('#dashboardRiskList')).toContainText('今日已忽略');
  await page.locator('#dashboardRiskList').click({ button: 'right' });
  await page.click('#stockContextMenu [data-dashboard-risk-action="toggle-dismissed"]');
  await expect(page.locator('#dashboardRiskList .risk-item.dismissed')).toHaveCount(1);
  await page.locator('#dashboardRiskList .risk-item.dismissed').click({ button: 'right' });
  await page.click('#stockContextMenu [data-dashboard-risk-action="restore"]');
  await expect.poll(() => page.locator('#dashboardRiskList .risk-item').count()).toBe(riskCount);

  await page.click('[data-main-view="stats"]');
  await expect(page.locator('#statsView')).toBeVisible();
  await expect(page.locator('#statsOverviewCards')).toContainText('Positions');
  await expect(page.locator('#statsOverviewCards')).toContainText('Watchlist');
  await expect(page.locator('#statsExposureTable')).toContainText('Top exposures');
  await expect(page.locator('#statsExposureTable')).toContainText('000001');
});

test('mobile dark mode workspace remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#stockTbody tr');

  await page.click('#themeToggle');
  await expect(page.locator('body')).toHaveClass(/dark/);
  await expect(page.locator('#dashboardView')).toBeVisible();
  await expect(page.locator('.dashboard-grid')).toBeVisible();
  await expect(page.locator('#sidebarWorkspaceNav')).toBeVisible();

  await page.fill('#searchInput', '000001');
  await expect(page.locator('#stockTbody tr:first-child')).toBeVisible();
  await page.click('#stockTbody tr:first-child');
  await expect(page.locator('#marketView')).toBeVisible();
  await expect(page.locator('#analysisBtn')).toBeVisible();

  await page.click('[data-main-view="screener"]');
  await expect(page.locator('#screenerView')).toBeVisible();
  await expect(page.locator('#screenerDemand')).toBeVisible();

  await page.click('[data-main-view="sectors"]');
  await expect(page.locator('#sectorsView')).toBeVisible();
  await expect(page.locator('#sectorSortSelect')).toBeVisible();

  await page.click('[data-main-view="portfolio"]');
  await expect(page.locator('#portfolioView')).toBeVisible();
  await expect(page.locator('#addTradeFromPortfolioBtn')).toBeVisible();
  await page.click('[data-main-view="trades"]');
  await expect(page.locator('#tradesView')).toBeVisible();
  await expect(page.locator('#resetTradeFiltersBtn')).toBeVisible();
});

test('keyboard activation works for core workspace controls', async ({ page }) => {
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#stockTbody tr');

  await page.focus('#searchInput');
  await expect(page.locator('#searchInput')).toBeFocused();
  await page.keyboard.type('000001');
  await expect(page.locator('#searchInput')).toHaveValue('000001');
  await page.keyboard.press('Tab');
  await expect(page.locator('#clearBtn')).toBeFocused();
  const clearOutline = await page.locator('#clearBtn').evaluate(el => getComputedStyle(el).outlineStyle);
  expect(clearOutline).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page.locator('#searchInput')).toHaveValue('');

  await page.focus('#themeToggle');
  await expect(page.locator('#themeToggle')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveClass(/dark/);
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).not.toHaveClass(/dark/);

  await page.focus('[data-main-view="screener"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#screenerView')).toBeVisible();

  await page.focus('[data-main-view="market"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#marketView')).toBeVisible();
  await page.focus('#stockTbody tr:first-child');
  await page.keyboard.press('Enter');
  await expect(page.locator('#analysisBtn')).toBeVisible();

  await page.focus('#analysisBtn');
  await page.keyboard.press('Enter');
  await expect(page.locator('#analysisOverlay')).toBeVisible();
  await page.focus('#analysisCloseBtn');
  await page.keyboard.press('Enter');
  await expect(page.locator('#analysisOverlay')).toBeHidden();
});

test('apiFetch reports HTML API responses without Unexpected token', async ({ page }) => {
  allowApiFetchNonJsonConsole = true;
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.route('**/api/html-regression', route => route.fulfill({
    status: 404,
    contentType: 'text/html',
    body: '<!DOCTYPE html><html><body>missing api</body></html>'
  }));

  try {
    await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
    const message = await page.evaluate(async () => {
      try {
        await window.apiFetch('/api/html-regression');
        return '';
      } catch (error) {
        return error.message;
      }
    });

    expect(message).toContain('Interface returned non JSON: /api/html-regression');
    expect(consoleErrors.some(text => text.includes('Interface returned non JSON'))).toBeTruthy();
    expect(consoleErrors.some(text => text.includes('Unexpected token'))).toBeFalsy();
  } finally {
    allowApiFetchNonJsonConsole = false;
  }
});
