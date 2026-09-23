const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parseCatalog, parseArticle, createEastmoneyEtfDailyService, buildCatalogUrl, articleUrl } = require('../services/eastmoneyEtfDailyService');
const html = fs.readFileSync(path.join(__dirname, 'fixtures/eastmoney-etf-daily-20260910.html'), 'utf8');
const item = { code: '202609103869906865', title: 'ETF追踪丨9月9日股票型ETF净赎回20亿元', stime: '2026-09-10 08:00:59', source: '东方财富Choice数据' };
const catalog = { success: 1, data: { elements: [{ type: 'NewsList', data: [item] }] } };
const at = new Date('2026-09-10T01:30:00Z');
function setup(t, options = {}) {
  const db = new Database(':memory:'); t.after(() => db.close());
  return { db, service: createEastmoneyEtfDailyService({ db, fetchCatalog: async () => catalog, fetchArticle: async () => html, now: () => at, ...options }) };
}
test('public source URLs are fixed and catalog ignores unrelated news', () => {
  assert.match(buildCatalogUrl(() => 123), /trace=123/);
  assert.equal(articleUrl(item.code), 'https://wap.eastmoney.com/a/' + item.code + '.html');
  assert.throws(() => articleUrl('https://evil.test'));
  assert.deepEqual(parseCatalog(catalog), [item]);
  assert.deepEqual(parseCatalog({ success: 1, data: { elements: [{ type: 'NewsList', data: [{ ...item, title: '公司ETF新品发行' }] }] } }), []);
});
test('real source extracts signed amounts and codes from both market link prefixes', () => {
  const r = parseArticle(html, item, at);
  assert.equal(r.asOf, '2026-09-09');
  assert.equal(r.totalNetFlow, 33.83);
  assert.equal(r.stockEtfNetFlow, -19.87);
  assert.deepEqual(r.subscriptions.map(x => x.code), ['588000', '515880', '159259']);
  assert.deepEqual(r.redemptions.map(x => x.value), [-13.14, -9.41, -5.41]);
});
test('missing source metrics and missing ranking members are rejected', () => {
  assert.throws(() => parseArticle(html.replace('整体净流入33.83亿元', '整体暂无数据'), item, at));
  assert.throws(() => parseArticle(html.replace('净申购3.02亿元', '净申购待披露'), item, at));
  assert.throws(() => parseArticle(html.replace('id="articleContent"', 'id="other"'), item, at));
});
test('direction changes follow source wording and invalid amounts do not become zero', () => {
  const r = parseArticle(html.replace('整体净流入33.83', '整体净流出33.83').replace('股票型净流出19.87', '股票型净流入19.87'), item, at);
  assert.equal(r.totalNetFlow, -33.83); assert.equal(r.stockEtfNetFlow, 19.87);
  assert.throws(() => parseArticle(html.replace('33.83亿元', '3..83亿元'), item, at));
});
test('only January to December can roll back a publication year', () => {
  const crossed = html.replaceAll('9月9日', '12月31日').replaceAll('2026-09-10', '2027-01-02');
  assert.equal(parseArticle(crossed, { ...item, title: item.title.replace('9月9日', '12月31日'), stime: '2027-01-02 08:00:59' }, new Date('2027-01-02T02:00:00Z')).asOf, '2026-12-31');
  assert.throws(() => parseArticle(html.replaceAll('9月9日', '9月12日'), item, at));
  assert.throws(() => parseArticle(html.replaceAll('9月9日', '2月30日'), item, at));
});
test('same semantic article is idempotent, changed metrics update the same row', async t => {
  let body = html, clock = at;
  const { service, db } = setup(t, { fetchArticle: async () => body, now: () => clock });
  assert.equal((await service.refresh()).status, 'succeeded');
  const firstTime = service.latest().succeededAt;
  body = html.replace('1小时前', '2小时前'); clock = new Date(at.getTime() + 3600000);
  assert.equal((await service.refresh()).status, 'no-change');
  assert.equal(service.latest().succeededAt, firstTime);
  body = html.replace('整体净流入33.83', '整体净流入34.83');
  assert.equal((await service.refresh()).totalNetFlow, 34.83);
  assert.equal(db.prepare('SELECT count(*) AS n FROM eastmoney_etf_daily_reports').get().n, 1);
});
test('failed updates preserve data and expose failure without moving the data date', async t => {
  let fail = false;
  const { service } = setup(t, { fetchCatalog: async () => { if (fail) throw new Error('source unavailable'); return catalog; } });
  await service.refresh(); fail = true;
  await assert.rejects(service.refresh(), /source unavailable/);
  const cached = service.latest();
  assert.equal(cached.asOf, '2026-09-09'); assert.equal(cached.totalNetFlow, 33.83);
  assert.equal(cached.status, 'stale'); assert.match(cached.lastError, /source unavailable/);
});
test('currentness changes at the next trading day even without a refresh', async t => {
  let clock = at;
  const { service } = setup(t, { now: () => clock });
  await service.refresh(); assert.equal(service.latest().isCurrent, true);
  clock = new Date('2026-09-11T00:50:00Z');
  assert.equal(service.latest().isCurrent, false); assert.equal(service.latest().expectedAsOf, '2026-09-10');
  const r = await service.refresh(); assert.equal(r.status, 'pending-source');
  assert.notEqual(service.getState().lastSuccessTargetDate, '2026-09-11');
});
test('concurrent refreshes share the same provider work', async t => {
  let calls = 0;
  const { service } = setup(t, { fetchCatalog: async () => { calls++; await Promise.resolve(); return catalog; } });
  await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
  assert.equal(calls, 1);
});
test('attempt state survives service recreation and never pollutes reports', t => {
  const { service, db } = setup(t);
  service.saveLastAttempt('2026-09-10@catchup');
  const restarted = createEastmoneyEtfDailyService({ db, now: () => at });
  assert.equal(restarted.getLastAttempt(), '2026-09-10@catchup');
  assert.equal(restarted.latest().availability, 'unavailable');
  assert.equal(db.prepare('SELECT count(*) AS n FROM eastmoney_etf_daily_reports').get().n, 0);
});
test('a non-Choice or conflicting source cannot be relabelled as Choice', () => {
  assert.throws(() => parseArticle(html.replaceAll('东方财富Choice数据', '证券之星'), { ...item, source: '证券之星' }, at));
  assert.throws(() => parseArticle(html, { ...item, source: '证券之星' }, at));
  assert.throws(() => parseArticle(html.replace('文章来源：东方财富Choice数据', '文章来源：其他来源'), item, at));
});
test('an existing article cannot replace a valid date with an earlier data day', async t => {
  let body = html, entry = item;
  const { service } = setup(t, { fetchCatalog: async () => ({ success: 1, data: { elements: [{ type: 'NewsList', data: [entry] }] } }), fetchArticle: async () => body });
  await service.refresh();
  body = html.replaceAll('9月9日', '9月8日'); entry = { ...item, title: item.title.replace('9月9日', '9月8日') };
  await assert.rejects(service.refresh(), /日期/);
  assert.equal(service.latest().asOf, '2026-09-09');
});
