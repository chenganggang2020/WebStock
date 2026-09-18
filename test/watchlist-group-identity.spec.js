const { test, expect } = require('@playwright/test');
const path = require('node:path');

test('same-name Tonghuashun and editable WebStock tabs remain independently reachable', async ({ page }) => {
  await page.setContent([
    '<select id="watchlistGroupFilter"></select>',
    '<span id="watchlistGroupTabs"></span>',
    '<input id="watchlistSearchInput">',
    '<select id="watchlistSortSelect"><option value=""></option></select>',
    '<div id="watchlistEmpty"></div>',
    '<table id="watchlistTable"><tbody id="watchlistTbody"></tbody></table>'
  ].join(''));
  await page.evaluate(() => {
    window.State = {
      tonghuashunCatalog: {
        groups: [{
          id: '42',
          name: '重名分组',
          items: [{ code: '600001', name: '同花顺样本', price: 10, change: 1 }]
        }]
      },
      watchlist: [{
        id: 7,
        code: '600002',
        name: 'WebStock样本',
        groupName: '重名分组',
        price: 20,
        change: -1,
        autoD1Low: 18,
        autoD1High: 19,
        autoD2: 17,
        autoR1: 22,
        autoConfirm: 23,
        autoLevelsDate: '<img data-watchlist-date-xss="1" src=x>'
      }]
    };
    window.apiFetch = async () => [];
  });
  await page.addScriptTag({ path: path.join(__dirname, '../js/modules/watchlist.js') });
  await page.evaluate(() => window.Watchlist.renderWatchlist());

  const tabs = page.locator('#watchlistGroupTabs .portfolio-watchlist-tab');
  await expect(tabs).toHaveCount(2);
  await expect(page.locator('[data-group="ths:42"]')).toContainText('同花顺只读');
  await expect(page.locator('[data-group="local:重名分组"]')).toContainText('WebStock可编辑');

  await page.locator('[data-group="ths:42"]').evaluate(button => {
    window.Watchlist.setSelectedGroup(button.getAttribute('data-group'));
  });
  await expect(page.locator('#watchlistTbody')).toContainText('600001');
  await expect(page.locator('#watchlistTbody')).not.toContainText('600002');
  await expect(page.locator('#watchlistTbody')).toContainText('同花顺只读');

  await page.locator('[data-group="local:重名分组"]').evaluate(button => {
    window.Watchlist.setSelectedGroup(button.getAttribute('data-group'));
  });
  await expect(page.locator('#watchlistTbody')).toContainText('600002');
  await expect(page.locator('#watchlistTbody')).not.toContainText('600001');
  await expect(page.locator('#watchlistTbody [data-action="edit"]')).toHaveCount(1);
  await expect(page.locator('#watchlistTbody')).toContainText('<img data-watchlist-date-xss="1" src=x>');
  await expect(page.locator('[data-watchlist-date-xss="1"]')).toHaveCount(0);

  await page.evaluate(() => window.Watchlist.setSelectedGroup('重名分组'));
  await expect.poll(() => page.evaluate(() => window.Watchlist.getSelectedGroup())).toBe('ths:42');
  await expect(page.locator('#watchlistTbody')).toContainText('600001');
});
