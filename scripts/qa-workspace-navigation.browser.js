// Run via playwright-cli against preview-compact-terminal.js; no production data.
async page => {
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:43832');
  await page.waitForSelector('#terminalWorkspaces [data-workspace]');
  const keys = ['market', 'watch', 'capital', 'research', 'collect', 'paper', 'settings'];
  const direct = await page.locator('#terminalWorkspaces > button').evaluateAll(nodes => nodes.map(node => node.dataset.workspace));
  if (JSON.stringify(direct) !== JSON.stringify(keys)) throw new Error('Workspace entries must be directly visible horizontal buttons: ' + JSON.stringify(direct));
  checks.push('seven-direct-workspace-buttons');
  for (const width of [1920, 1366, 1024, 800, 640]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
      const layout = await page.evaluate(() => {
        const nav = document.getElementById('terminalWorkspaces');
        const rects = [...nav.children].map(node => node.getBoundingClientRect());
        const header = document.querySelector('.terminal-topbar').getBoundingClientRect();
        const tabs = document.getElementById('mainTabs').getBoundingClientRect();
        const search = document.querySelector('.terminal-search').getBoundingClientRect();
        const theme = document.getElementById('themeToggle').getBoundingClientRect();
        const navBox = nav.getBoundingClientRect();
        const intersects = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        return {
          sameRow: rects.every(rect => Math.abs(rect.top - rects[0].top) < 1),
          withinHeader: rects.every(rect => rect.top >= header.top && rect.bottom <= header.bottom + 1),
          notObscured: [...nav.children].every(node => {
            const r = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }),
          noPopup: !nav.querySelector('details'),
          noOverlap: !intersects(navBox, search) && !intersects(navBox, theme),
          belowHeader: tabs.top >= header.bottom - 1,
          contained: header.right <= innerWidth + 1 && navBox.right <= innerWidth + 1,
          searchWidth: search.width
        };
      });
      if (!layout.sameRow || !layout.withinHeader || !layout.notObscured || !layout.noPopup || !layout.noOverlap || !layout.belowHeader || !layout.contained || layout.searchWidth < 160) {
        throw new Error('Navigation layout ' + width + '/' + dark + ': ' + JSON.stringify(layout));
      }
      checks.push('layout-' + width + (dark ? '-dark' : '-light'));
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => document.body.classList.remove('dark'));
  for (const key of keys) {
    const button = page.locator('#terminalWorkspaces > [data-workspace="' + key + '"]');
    await button.click();
    if (await button.getAttribute('aria-pressed') !== 'true') throw new Error('Workspace selection did not activate: ' + key);
    const selected = await page.locator('#terminalWorkspaces > [aria-pressed=true]').count();
    if (selected !== 1) throw new Error('Multiple selected workspaces: ' + key);
    checks.push('click-' + key);
  }
  await page.locator('#terminalWorkspaces > [data-workspace=market]').click();
  await page.locator('#terminalWorkspaces > [data-workspace=market]').click();
  if (await page.evaluate(() => State.currentMainView) !== 'dashboard') throw new Error('Home must not restore page history');
  checks.push('repeated-home-stays-home');
  await page.screenshot({path:'output/playwright/workspace-horizontal-after.png'});
  await page.locator('.terminal-topbar').screenshot({path:'output/playwright/workspace-horizontal-header.png'});
  if (errors.length) throw new Error('JS errors: ' + JSON.stringify(errors));
  checks.push('no-js-errors');
  return { fixture:true, checks, passed:checks.length };
}
