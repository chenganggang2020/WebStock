const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

// Offline component test: render the real markup, CSS cascade and workspace
// composition. Never execute app bootstrapping, collection or production APIs.
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = [...source.matchAll(/<link\b[^>]*href="(css\/[^"?]+)[^"]*"[^>]*>/g)]
  .map(match => fs.readFileSync(path.join(root, match[1]), 'utf8')).join('\n');
const markup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '').replace('</head>', '<style>' + styles + '</style></head>');
let browser;

test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

async function renderToolbar(t, width = 1600, height = 980) {
  const page = await browser.newPage({ viewport: { width, height } });
  t.after(() => page.close());
  await page.route('**/*', route => route.abort());
  await page.setContent(markup, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ path: path.join(root, 'js/modules/fixedWorkspace.js') });
  await page.evaluate(() => {
    document.body.classList.add('compact-terminal');
    document.body.dataset.workspace = 'collect';
    document.body.dataset.terminalPage = 'creatorTasks';
    document.querySelectorAll('.main-view').forEach(node => {
      node.classList.remove('active'); node.style.display = 'none';
    });
    const view = document.getElementById('creatorTasksView');
    view.classList.add('active'); view.style.display = 'block';
    document.getElementById('creatorTaskChannelSelect').innerHTML =
      '<option value="author-a">作者甲 · 157 条视频资料</option>' +
      '<option value="author-b">作者乙 · 32 条视频资料</option>';
    document.getElementById('creatorActiveName').textContent = '作者甲';
    document.getElementById('creatorTaskStatus').textContent = '作者甲 · 157 条资料';
    document.getElementById('douyinDesktopControls').hidden = false;
    document.getElementById('douyinAutoSyncPanel').hidden = false;
    document.getElementById('douyinAutoSyncToggle').checked = true;
    document.getElementById('expertCreatorWorkbench').hidden = false;
    window.FixedWorkspace.prepare();
  });
  return page;
}

test('default author toolbar leaves the video workspace dominant at desktop sizes', async t => {
  for (const [width, height] of [[1600, 980], [1366, 768], [1024, 768]]) {
    await t.test(width + ' x ' + height, async t => {
      const page = await renderToolbar(t, width, height);
      const metrics = await page.evaluate(() => {
        const toolbar = document.querySelector('.creator-task-control-card').getBoundingClientRect();
        const main = document.querySelector('.fixed-creator-main').getBoundingClientRect();
        return { toolbarHeight: toolbar.height, mainHeight: main.height,
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth };
      });
      // Allow two compact rows on small desktop widths; never a tall settings card.
      assert.ok(metrics.toolbarHeight <= 96,
        'Collapsed toolbar must be <= 96 CSS px, got ' + JSON.stringify(metrics));
      assert.ok(metrics.mainHeight >= height * 0.6,
        'Video workspace must retain at least 60% of viewport: ' + JSON.stringify(metrics));
      assert.ok(metrics.horizontalOverflow <= 1, 'Toolbar must not overflow horizontally');
      assert.equal(await page.locator('#creatorTaskChannelSelect').isVisible(), true);
      assert.equal(await page.locator('#startCurrentCreatorBtn').isVisible(), true);
    });
  }
});

test('low-frequency author controls are collapsed by default instead of filling the toolbar', async t => {
  const page = await renderToolbar(t);
  for (const id of ['openDouyinSessionBtn', 'syncDouyinSessionBtn', 'addCreatorAccountBtn',
    'editCreatorAccountBtn', 'creatorCurrentMode', 'creatorCurrentModel',
    'douyinAutoSyncToggle', 'runDouyinArchiveScanBtn']) {
    assert.equal(await page.locator('#' + id).count(), 1, id + ' must retain its unique business ID');
    assert.equal(await page.locator('#' + id).isVisible(), false,
      id + ' is configuration and must not crowd the default reading workspace');
  }
});

test('configuration can be opened and closed without losing the current author or field values', async t => {
  const page = await renderToolbar(t);
  const config = page.locator('#creatorConfiguration');
  assert.equal(await config.count(), 1, 'Provide one discoverable current-author configuration disclosure');
  assert.equal(await config.getAttribute('open'), null, 'Configuration starts collapsed');
  const summary = config.locator(':scope > summary');
  assert.match(await summary.innerText(), /配置/);
  await page.locator('#creatorTaskChannelSelect').selectOption('author-b');
  await summary.click();
  for (const id of ['openDouyinSessionBtn', 'addCreatorAccountBtn', 'editCreatorAccountBtn',
    'creatorCurrentMode', 'creatorCurrentModel', 'douyinAutoSyncToggle']) {
    assert.equal(await page.locator('#' + id).isVisible(), true, id + ' remains accessible in configuration');
  }
  await page.locator('#creatorCurrentMode').selectOption('archive');
  await page.locator('#creatorCurrentModel').selectOption('small');
  await summary.click();
  assert.equal(await page.locator('#creatorCurrentMode').isVisible(), false);
  assert.equal(await page.locator('#creatorTaskChannelSelect').inputValue(), 'author-b');
  await summary.click();
  assert.equal(await page.locator('#creatorCurrentMode').inputValue(), 'archive');
  assert.equal(await page.locator('#creatorCurrentModel').inputValue(), 'small');
  assert.equal(await page.locator('#douyinAutoSyncToggle').isChecked(), true);
});

test('author action elements are not cloned when the workspace is prepared again', async t => {
  const page = await renderToolbar(t);
  const ids = ['creatorTaskChannelSelect', 'startCurrentCreatorBtn', 'creatorCurrentMode',
    'creatorCurrentModel', 'refreshCreatorTasksBtn', 'openDouyinSessionBtn', 'syncDouyinSessionBtn',
    'addCreatorAccountBtn', 'editCreatorAccountBtn', 'creatorAccountForm',
    'douyinAutoSyncToggle', 'runDouyinSyncNowBtn', 'runDouyinArchiveScanBtn',
    'openCreatorAsrSetupBtn', 'creatorBatchMode', 'creatorBatchModel', 'startCreatorBatchBtn'];
  await page.evaluate(() => window.FixedWorkspace.prepare());
  for (const id of ids) assert.equal(await page.locator('#' + id).count(), 1, id + ' must occur exactly once');
});

test('legacy author navigation stays in the unified workbench with one collapsed configuration', async t => {
  const page = await renderToolbar(t);
  await page.evaluate(() => window.FixedWorkspace.show({ id: 'authors', view: 'creatorTasks' }));
  assert.equal(await page.locator('.creator-task-hero h2').innerText(), '采集任务与文稿');
  assert.equal(await page.locator('.creator-management-panel').count(), 0);
  assert.equal(await page.locator('#workspace-creator-videos').isVisible(), true);
  await page.locator('#creatorConfiguration > summary').click();
  assert.equal(await page.locator('#workspace-creator-jobs').isVisible(), false);
  await page.locator('#creatorCurrentMode').selectOption('archive');
  await page.evaluate(() => window.FixedWorkspace.show({ id: 'creatorTasks', view: 'creatorTasks' }));
  assert.equal(await page.locator('.creator-task-hero h2').innerText(), '采集任务与文稿');
  assert.equal(await page.locator('#workspace-creator-videos').isVisible(), true);
  assert.notEqual(await page.locator('#creatorConfiguration').getAttribute('open'), null);
  assert.equal(await page.locator('.creator-task-control-card #creatorCurrentMode').inputValue(), 'archive');
  assert.equal(await page.locator('#creatorConfiguration').count(), 1);
});

test('daily funds panels use natural height instead of clipping content in split scroll boxes', async t => {
  const page = await renderToolbar(t, 1366, 768);
  const metrics = await page.evaluate(() => {
    document.getElementById('creatorTasksView').style.display = 'none';
    const view = document.getElementById('capitalFlowView');
    view.classList.add('active'); view.style.display = 'block';
    window.FixedWorkspace.show({ id: 'capitalDaily', view: 'capitalFlow' });
    document.getElementById('dashboardCiticAggregate').innerHTML = Array.from({length: 12}, (_, i) =>
      '<div style="height:60px">合成持仓条目 ' + i + '</div>').join('');
    const panel = document.querySelector('[aria-labelledby="institutionalFlowTitle"]');
    const report = document.getElementById('eastmoneyEtfDailyReport');
    return { client: panel.clientHeight, scroll: panel.scrollHeight,
      bottom: panel.getBoundingClientRect().bottom, reportTop: report.getBoundingClientRect().top,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.ok(metrics.client >= metrics.scroll - 1, 'Daily panel must not have a clipped inner scroll: ' + JSON.stringify(metrics));
  assert.ok(metrics.reportTop >= metrics.bottom, 'The separate Choice report must follow the complete daily panel');
  assert.ok(metrics.horizontalOverflow <= 1);
});

test('real collection controls switch works, configuration and queue together without production APIs', async t => {
  const page = await renderToolbar(t, 1366, 768);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    const channels = [
      { id: 1, platform: 'douyin', displayName: '视频作者（测试）', observationCount: 1, collectionMediaType: 'video', industryAnalysisEnabled: true },
      { id: 2, platform: 'douyin', displayName: '图文作者（测试）', observationCount: 1, collectionMediaType: 'note', industryAnalysisEnabled: false }
    ];
    const work = id => ({ id: id * 10, channelId: id, externalContentId: '7000000000000000' + id,
      sourceUrl: 'https://www.douyin.com/' + (id === 1 ? 'video/' : 'note/') + '7000000000000000' + id,
      title: id === 1 ? '视频文稿联动测试' : '图文正文联动测试', mediaType: id === 1 ? 'video' : 'note',
      publishedAt: '2026-09-26T06:00:00Z', topics: [], stockCodes: [], sectors: [],
      transcript: '仅用于界面测试，不是实际采集的数据。切换作者后，此处展示所选作者的文稿。',
      mediaMetadata: { asr: { status: 'complete' }, detailCapturedAt: '2026-09-26T06:05:00Z' }
    });
    window.State = { currentMainView: 'creatorTasks' };
    window.apiFetch = async (url, options = {}) => {
      if (options.method && options.method !== 'GET') throw new Error('This fixture must not submit collection or settings');
      if (url === '/api/expert/channels') return channels;
      if (url === '/api/expert/collection-queue') return { workerRunning: true, jobs: channels.map(channel => ({
        id: channel.id, channelId: channel.id, displayName: channel.displayName, status: 'complete', model: 'large-v3-turbo',
        mode: 'incremental', rounds: 1, message: '隔离界面测试任务', result: { discoveredCount: 1 }
      })) };
      const match = url.match(/\/channels\/(\d+)\/(.*)/);
      if (!match) throw new Error('Unexpected fixture API: ' + url);
      const id = Number(match[1]), route = match[2];
      if (route.startsWith('observations?')) {
        if (window.holdAuthorOneWorks && id === 1) return new Promise(resolve => { window.releaseAuthorOne = () => resolve([work(id)]); });
        return [work(id)];
      }
      if (route === 'sync') return { channelId: id, enabled: id === 1, status: 'idle' };
      if (route.startsWith('sync/runs?') || route.startsWith('backtests?')) return [];
      if (route.includes('/comments')) return [];
      throw new Error('Unexpected fixture API: ' + url);
    };
    window.webstockDesktop = {
      openDouyinSession() {}, collectDouyinPage() {}, getDouyinSessionStatus: async () => ({ windowOpen: false })
    };
  });
  await page.addScriptTag({ path: path.join(root, 'js/modules/compactTerminal.js') });
  await page.addScriptTag({ path: path.join(root, 'js/modules/expertTracker.js') });
  await page.evaluate(async () => { window.CompactTerminal.bind(); window.ExpertTracker.bind(); await window.ExpertTracker.showCreatorTasks(); });
  assert.equal(await page.locator('#mainTabs button[data-main-view="creatorTasks"]').count(), 1);
  assert.equal(await page.locator('#mainTabs button').filter({ hasText: '作者管理' }).count(), 0);
  assert.match(await page.locator('#expertCreatorVideoList').innerText(), /视频文稿联动测试/);
  await page.locator('#creatorTaskChannelSelect').selectOption('2');
  await page.waitForFunction(() => document.getElementById('expertCreatorVideoList').textContent.includes('图文正文联动测试'));
  assert.equal(await page.locator('#creatorMediaPreference').inputValue(), 'note');
  assert.equal(await page.locator('#creatorIndustryAutomatic').isChecked(), false);
  assert.equal(await page.locator('#douyinAutoSyncToggle').isChecked(), false);
  assert.match(await page.locator('#creatorTaskStatus').innerText(), /图文作者/);
  assert.doesNotMatch(await page.locator('#expertCreatorVideoList').innerText(), /视频文稿联动测试/);
  await page.evaluate(() => { window.holdAuthorOneWorks = true; });
  await page.locator('#creatorTaskChannelSelect').selectOption('1');
  await page.locator('#creatorTaskChannelSelect').selectOption('2');
  await page.evaluate(() => window.releaseAuthorOne());
  await page.waitForFunction(() => document.getElementById('expertCreatorVideoList').textContent.includes('图文正文联动测试'));
  assert.equal(await page.locator('#creatorMediaPreference').inputValue(), 'note');
  await page.locator('[data-deck="creator"] [data-panel-key="jobs"]').click();
  assert.match(await page.locator('#creatorQueueList').innerText(), /图文作者/);
  assert.doesNotMatch(await page.locator('#creatorQueueList').innerText(), /视频作者/);
  await page.locator('#creatorQueueScope').selectOption('all');
  assert.match(await page.locator('#creatorQueueList').innerText(), /视频作者/);
  await page.locator('[data-deck="creator"] [data-panel-key="videos"]').click();
  if (process.env.CREATOR_UI_SCREENSHOTS === '1') {
    const output = path.join(root, 'output/playwright/creator-unified-20260926');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'workbench.png') });
    await page.locator('#creatorConfiguration > summary').click();
    await page.screenshot({ path: path.join(output, 'configuration.png') });
  }
  assert.deepEqual(errors, []);
});
