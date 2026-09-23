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

test('author management opens actual configuration and returns the same controls to tasks', async t => {
  const page = await renderToolbar(t);
  await page.evaluate(() => window.FixedWorkspace.show({ id: 'authors', view: 'creatorTasks' }));
  assert.equal(await page.locator('.creator-task-hero h2').innerText(), '作者管理');
  assert.equal(await page.locator('.creator-management-panel #creatorCurrentMode').isVisible(), true);
  assert.equal(await page.locator('#workspace-creator-jobs').isVisible(), false);
  await page.locator('#creatorCurrentMode').selectOption('archive');
  await page.evaluate(() => window.FixedWorkspace.show({ id: 'creatorTasks', view: 'creatorTasks' }));
  assert.equal(await page.locator('.creator-task-hero h2').innerText(), '采集任务与视频记录');
  assert.equal(await page.locator('#workspace-creator-videos').isVisible(), true);
  assert.equal(await page.locator('#creatorConfiguration').getAttribute('open'), null);
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
