const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-workbench-api-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const app = require('../server');
const newsService = require('../services/newsService');
const { toSinaSymbol } = require('../utils/market');

function requestJson(server, options, body) {
  const address = server.address();
  const requestOptions = Object.assign({
    hostname: '127.0.0.1',
    port: address.port,
    method: 'GET',
    headers: {}
  }, typeof options === 'string' ? { path: options } : options);

  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: raw, json: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function requestRaw(server, options, body) {
  const address = server.address();
  const requestOptions = Object.assign({
    hostname: '127.0.0.1',
    port: address.port,
    method: 'GET',
    headers: {}
  }, typeof options === 'string' ? { path: options } : options);

  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (error) {}
        resolve({ statusCode: res.statusCode, body: raw, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('recent stocks API records, lists, deletes and clears', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const created = await requestJson(server, {
    path: '/api/user/recent-stocks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { code: '000001', name: '平安银行', lastPrice: 11.28, lastChange: -0.18 });

  assert.equal(created.statusCode, 200);
  assert.equal(created.json.success, true);
  assert.equal(created.json.data.code, '000001');

  const listed = await requestJson(server, '/api/user/recent-stocks');
  assert.equal(listed.json.data.length, 1);
  assert.equal(listed.json.data[0].viewCount, 1);

  const deleted = await requestJson(server, { path: '/api/user/recent-stocks/000001', method: 'DELETE' });
  assert.equal(deleted.json.data.deleted, true);

  const cleared = await requestJson(server, { path: '/api/user/recent-stocks', method: 'DELETE' });
  assert.equal(cleared.json.success, true);
});

test('API compatibility aliases and failures always return JSON', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const recent = await requestJson(server, '/api/recent');
  assert.equal(recent.statusCode, 200);
  assert.equal(recent.json.success, true);
  assert.ok(Array.isArray(recent.json.data));

  const recommendation = await requestJson(server, '/api/recommendation?limit=3');
  assert.equal(recommendation.statusCode, 200);
  assert.equal(recommendation.json.success, true);
  assert.ok(Array.isArray(recommendation.json.data.candidates));

  const missingAnalysisCode = await requestJson(server, '/api/analysis');
  assert.equal(missingAnalysisCode.statusCode, 400);
  assert.equal(missingAnalysisCode.json.success, false);
  assert.match(missingAnalysisCode.json.error, /股票代码/);

  const missing = await requestRaw(server, '/api/not-exist');
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json.success, false);
  assert.match(missing.json.error, /API not found/);
  assert.doesNotMatch(missing.body, /<!DOCTYPE/i);

  const malformed = await requestRaw(server, {
    path: '/api/portfolio/trades',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, '{"code":');
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json.success, false);
  assert.match(malformed.json.error, /Invalid JSON body/);
  assert.doesNotMatch(malformed.body, /<!DOCTYPE/i);
});

test('news, sector and screener APIs return unified success envelopes', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const news = await requestJson(server, '/api/news');
  assert.equal(news.statusCode, 200);
  assert.equal(news.json.success, true);
  assert.ok(Array.isArray(news.json.data));

  const hotMarket = await requestJson(server, '/api/hot-market/overview?refresh=1');
  assert.equal(hotMarket.statusCode, 200);
  assert.equal(hotMarket.json.success, true);
  assert.ok(Array.isArray(hotMarket.json.data.boards.day));
  assert.ok(hotMarket.json.data.boards.day.length >= 1);
  assert.match(hotMarket.json.data.prompt, /WEBSTOCK_HOT_MARKET_ANALYSIS_START/);
  assert.match(hotMarket.json.data.prompt, /当日热门板块|褰撴棩鐑棬鏉垮潡/);

  const hotSnapshots = await requestJson(server, '/api/hot-market/snapshots?limit=3');
  assert.equal(hotSnapshots.json.success, true);
  assert.ok(hotSnapshots.json.data.length >= 1);

  const cpoThemes = await requestJson(server, '/api/themes/search?q=CPO');
  assert.equal(cpoThemes.json.success, true);
  assert.ok(cpoThemes.json.data.some(item => item.leaders.some(stock => stock.code === '300308')));

  const stockTags = await requestJson(server, '/api/stock-tags?codes=300308,688981,159611');
  assert.equal(stockTags.json.success, true);
  assert.equal(stockTags.json.data.length, 3);
  assert.ok(stockTags.json.data.find(item => item.code === '300308').tags.length >= 2);
  assert.ok(stockTags.json.data.find(item => item.code === '688981').marketLabel);
  assert.ok(stockTags.json.data.find(item => item.code === '159611').marketLabel);
  const detailedTags = await requestJson(server, '/api/stock-tags?detail=1&codes=300308');
  assert.equal(detailedTags.json.success, true);
  assert.equal(detailedTags.json.data[0].code, '300308');
  assert.ok(Array.isArray(detailedTags.json.data[0].tags));

  const db = require('../db');
  db.prepare('DELETE FROM stock_search_index WHERE code = ?').run('300001');
  db.prepare('DELETE FROM stock_profiles WHERE code = ?').run('300001');
  db.prepare(`
    INSERT INTO stock_profiles (code, source, payload_json, fetched_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run('300001', 'test', JSON.stringify({
    code: '300001',
    name: '测试科技',
    industry: '电子设备',
    boards: ['半导体材料'],
    businessScope: '计算机、通信和其他电子设备制造',
    businessSummary: '主营高端控制器和工业软件',
    mainBusinessItems: [
      { name: '超高纯靶材', ratio: 61.9, reportDate: '2025-12-31' },
      { name: '内销', ratio: 65.9, reportDate: '2025-12-31' }
    ],
    tags: ['创业板', '电子设备']
  }));
  t.after(() => {
    db.prepare('DELETE FROM stock_search_index WHERE code = ?').run('300001');
    db.prepare('DELETE FROM stock_profiles WHERE code = ?').run('300001');
  });
  const unifiedSearch = await requestJson(server, '/api/stock-search?q=' + encodeURIComponent('超高靶材'));
  assert.equal(unifiedSearch.json.success, true);
  assert.equal(unifiedSearch.json.data.stocks[0].code, '300001');
  assert.equal(unifiedSearch.json.data.stocks[0].mainBusinessItems[0].ratio, 61.9);
  assert.match(unifiedSearch.json.data.stocks[0].matchReason, /主营|业务|超高纯靶材/);

  const savedHotAiResult = await requestJson(server, {
    path: '/api/hot-market/ai-result',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    snapshotId: hotMarket.json.data.snapshotId,
    resultText: 'WEBSTOCK_HOT_MARKET_ANALYSIS_START\n# Hot test\nWEBSTOCK_HOT_MARKET_ANALYSIS_END',
    parsed: { title: 'Hot test' }
  });
  assert.equal(savedHotAiResult.json.success, true);
  assert.ok(savedHotAiResult.json.data.id > 0);

  const firstNewsMeta = await requestJson(server, '/api/news?withMeta=1&cacheBust=manual-a');
  const cachedNewsMeta = await requestJson(server, '/api/news?withMeta=1&cacheBust=manual-a');
  const refreshedNewsMeta = await requestJson(server, '/api/news?withMeta=1&cacheBust=manual-b');
  assert.equal(firstNewsMeta.json.data.meta.cached, false);
  assert.equal(cachedNewsMeta.json.data.meta.cached, true);
  assert.equal(refreshedNewsMeta.json.data.meta.cached, false);

  const closedPositions = await requestJson(server, '/api/portfolio/closed-positions');
  assert.equal(closedPositions.statusCode, 200);
  assert.equal(closedPositions.json.success, true);
  assert.ok(Array.isArray(closedPositions.json.data));

  const sectors = await requestJson(server, '/api/sectors');
  assert.equal(sectors.json.success, true);
  assert.ok(sectors.json.data.length >= 1);

  const leader = await requestJson(server, {
    path: '/api/sectors/' + sectors.json.data[0].id + '/leaders',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { code: '000001', name: '平安银行', role: '观察股', note: 'test' });
  assert.equal(leader.json.success, true);
  assert.equal(leader.json.data.code, '000001');

  const updatedLeader = await requestJson(server, {
    path: '/api/sector-leaders/' + leader.json.data.id,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, { code: '000001', name: '平安银行', role: '趋势龙头', note: 'updated' });
  assert.equal(updatedLeader.json.success, true);
  assert.equal(updatedLeader.json.data.role, '趋势龙头');

  const leaderSnapshots = await requestJson(server, '/api/sector-leaders/snapshots?code=000001&limit=5');
  assert.equal(leaderSnapshots.json.success, true);
  assert.ok(leaderSnapshots.json.data.length >= 1);
  assert.equal(leaderSnapshots.json.data[0].code, '000001');

  const leaderTrends = await requestJson(server, '/api/sector-leaders/trends?limit=20');
  assert.equal(leaderTrends.json.success, true);
  assert.ok(leaderTrends.json.data.some(item => item.code === '000001'));

  const exportedSectorConfig = await requestJson(server, '/api/sector-config');
  assert.equal(exportedSectorConfig.json.success, true);
  assert.ok(exportedSectorConfig.json.data.sectors.length >= 1);
  assert.ok(exportedSectorConfig.json.data.sectors.some(item => Array.isArray(item.leaders)));

  const importedSectorConfig = await requestJson(server, {
    path: '/api/sector-config/import',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    config: {
      sectors: [{
        name: 'API Imported Sector',
        description: 'import test sector',
        sortOrder: 99,
        leaders: [{
          code: '000002',
          name: 'API Imported Leader',
          role: '观察股',
          reason: 'import test reason',
          weight: 1.1,
          note: 'imported'
        }]
      }]
    }
  });
  assert.equal(importedSectorConfig.json.success, true);
  assert.equal(importedSectorConfig.json.data.sectors, 1);
  assert.equal(importedSectorConfig.json.data.leaders, 1);
  const sectorsAfterImport = await requestJson(server, '/api/sectors');
  assert.ok(sectorsAfterImport.json.data.some(item => item.name === 'API Imported Sector'));

  const prunedSnapshots = await requestJson(server, {
    path: '/api/sector-leaders/snapshots?code=000001&keepLatest=1',
    method: 'DELETE'
  });
  assert.equal(prunedSnapshots.json.success, true);
  assert.ok(prunedSnapshots.json.data.deleted >= 0);

  const deletedLeader = await requestJson(server, {
    path: '/api/sector-leaders/' + leader.json.data.id,
    method: 'DELETE'
  });
  assert.equal(deletedLeader.json.success, true);
  assert.equal(deletedLeader.json.data.deleted, true);

  const screener = await requestJson(server, {
    path: '/api/screener/run',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    strategy: 'short-strong',
    scope: 'all',
    demand: '短线强势',
    limit: 5,
    marketSnapshot: [{ code: '000001', price: 11.28, change: 4.2, amount: 800000000 }],
    klineSnapshot: [{
      code: '000001',
      data: Array.from({ length: 80 }, (_, index) => ({
        close: 10 + index * 0.08,
        volume: index < 70 ? 10000 : 18000
      }))
    }]
  });
  assert.equal(screener.json.success, true);
  assert.ok(screener.json.data.candidates.length > 0);
  assert.match(screener.json.data.disclaimer, /不构成投资建议/);
  assert.match(JSON.stringify(screener.json.data.candidates), /本地行情|当前价/);
  assert.match(JSON.stringify(screener.json.data.candidates), /MA5|20 日/);
  assert.match(JSON.stringify(screener.json.data.candidates), /MA60|5d trend|60d trend|volume trend/);
  assert.match(JSON.stringify(screener.json.data.candidates), /MACD/);
  assert.ok(Array.isArray(screener.json.data.candidates[0].factorTags));
  assert.match(JSON.stringify(screener.json.data.candidates[0].factorTags), /涨跌幅|成交额|均线|MACD/);
  assert.ok(Array.isArray(screener.json.data.candidates[0].factorBreakdown));
  assert.ok(screener.json.data.candidates[0].factorBreakdown.some(item => Number(item.impact) > 0));

  const savedScreener = await requestJson(server, {
    path: '/api/screener/results',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { taskName: 'API saved screener', result: screener.json.data });
  assert.equal(savedScreener.json.success, true);
  assert.equal(savedScreener.json.data.candidateCount, screener.json.data.candidates.length);

  const screenerHistory = await requestJson(server, '/api/screener/results');
  assert.equal(screenerHistory.json.success, true);
  assert.ok(screenerHistory.json.data.some(item => item.taskName === 'API saved screener'));

  const firstCandidate = screener.json.data.candidates[0];
  const candidateNote = await requestJson(server, {
    path: '/api/screener/results/' + savedScreener.json.data.id + '/notes/' + firstCandidate.code,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, { status: 'priority', note: 'API candidate review note' });
  assert.equal(candidateNote.json.success, true);
  assert.equal(candidateNote.json.data.status, 'priority');
  assert.equal(candidateNote.json.data.note, 'API candidate review note');

  const candidateNotes = await requestJson(server, '/api/screener/results/' + savedScreener.json.data.id + '/notes');
  assert.equal(candidateNotes.json.success, true);
  assert.ok(candidateNotes.json.data.some(item => item.code === firstCandidate.code));

  const reviewSummary = await requestJson(server, '/api/screener/review-summary?limit=3');
  assert.equal(reviewSummary.json.success, true);
  assert.ok(reviewSummary.json.data.some(item => item.id === savedScreener.json.data.id && item.counts.priority === 1));

  const bulkCandidateNote = await requestJson(server, {
    path: '/api/screener/results/' + savedScreener.json.data.id + '/notes',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, { codes: [firstCandidate.code], status: 'done', note: 'bulk review note' });
  assert.equal(bulkCandidateNote.json.success, true);
  assert.equal(bulkCandidateNote.json.data.updated, 1);
  assert.equal(bulkCandidateNote.json.data.status, 'done');

  const secondResultPayload = Object.assign({}, screener.json.data, {
    candidates: [
      Object.assign({}, firstCandidate, { score: firstCandidate.score + 3 }),
      { code: '999999', name: 'New Candidate', score: 77, reasons: ['new'], risks: ['test'], strategy: 'stable' }
    ]
  });
  const secondSavedScreener = await requestJson(server, {
    path: '/api/screener/results',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { taskName: 'API second screener', result: secondResultPayload });
  assert.equal(secondSavedScreener.json.success, true);

  const comparedScreener = await requestJson(server, '/api/screener/results/compare?baseId=' + savedScreener.json.data.id + '&headId=' + secondSavedScreener.json.data.id);
  assert.equal(comparedScreener.json.success, true);
  assert.ok(comparedScreener.json.data.added.some(item => item.code === '999999'));
  assert.ok(comparedScreener.json.data.changed.some(item => item.code === firstCandidate.code));

  const renamedScreener = await requestJson(server, {
    path: '/api/screener/results/' + savedScreener.json.data.id,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, { taskName: 'API renamed screener' });
  assert.equal(renamedScreener.json.success, true);
  assert.equal(renamedScreener.json.data.taskName, 'API renamed screener');

  const linkedAi = await requestJson(server, {
    path: '/api/screener/results/' + savedScreener.json.data.id,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, { aiResult: 'AI explanation linked to saved task' });
  assert.equal(linkedAi.json.success, true);
  assert.match(linkedAi.json.data.aiResult, /AI explanation linked/);

  const deletedCandidateNote = await requestJson(server, {
    path: '/api/screener/results/' + savedScreener.json.data.id + '/notes/' + firstCandidate.code,
    method: 'DELETE'
  });
  assert.equal(deletedCandidateNote.json.success, true);
  assert.equal(deletedCandidateNote.json.data.deleted, true);

  const deletedScreener = await requestJson(server, {
    path: '/api/screener/results/' + savedScreener.json.data.id,
    method: 'DELETE'
  });
  assert.equal(deletedScreener.json.success, true);
  assert.equal(deletedScreener.json.data.deleted, true);
});

test('legacy market endpoints expose success envelopes for new clients', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const stocklist = await requestJson(server, '/api/stocklist');
  assert.equal(stocklist.statusCode, 200);
  assert.equal(stocklist.json.success, true);
  assert.ok(Array.isArray(stocklist.json.data));
  assert.ok(stocklist.json.data.some(item => item.code === '159667' && /工业母机ETF/.test(item.name)));
  assert.ok(stocklist.json.data.some(item => item.code === '159611' && /电力ETF/.test(item.name)));

  const missingKlineCode = await requestJson(server, '/api/kline');
  assert.equal(missingKlineCode.statusCode, 400);
  assert.equal(missingKlineCode.json.success, false);
  assert.match(missingKlineCode.json.error, /Missing code/);
});

test('market symbol mapping supports exchange-traded ETFs', () => {
  assert.equal(toSinaSymbol('159611'), 'sz159611');
  assert.equal(toSinaSymbol('159667'), 'sz159667');
  assert.equal(toSinaSymbol('561560'), 'sh561560');
  assert.equal(toSinaSymbol('512140'), 'sh512140');
});

test('user backup export and import roundtrip', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {
      recentStocks: [{ code: '000001', name: 'Ping An Bank', viewCount: 3, lastPrice: 11.28, lastChange: 1.2 }],
      watchlist: [{ code: '000001', name: 'Ping An Bank', groupName: 'Backup', note: 'roundtrip', alertHigh: 20, alertLow: 8, sortOrder: 1 }],
      trades: [{ code: '000001', name: 'Ping An Bank', side: 'buy', tradeDate: '2026-05-12', price: 10, quantity: 100, fee: 1, tax: 0, note: 'backup import' }],
      sectors: [{ id: 901, name: 'Backup Sector', description: 'Imported sector', sortOrder: 9 }],
      sectorLeaders: [{ sectorId: 901, code: '000001', name: 'Ping An Bank', role: 'Observation', reason: 'backup test', weight: 1, note: 'roundtrip' }],
      sectorLeaderSnapshots: [{ sectorId: 901, sectorName: 'Backup Sector', code: '000001', name: 'Ping An Bank', price: 11.28, change: 1.2, amount: 1000000, capturedAt: '2026-05-12T00:00:00.000Z' }],
      screenerResults: [{
        id: 902,
        taskName: 'Backup Screener',
        strategy: 'stable',
        demand: 'backup',
        result: { strategy: 'stable', demand: 'backup', scope: 'all', candidates: [{ code: '000001', name: 'Ping An Bank', score: 80 }] },
        aiResult: 'backup AI note'
      }],
      screenerCandidateNotes: [{ resultId: 902, code: '000001', status: 'priority', note: 'backup review note' }]
    }
  };

  const preview = await requestJson(server, {
    path: '/api/user/import-preview',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { backup });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json.success, true);
  assert.equal(preview.json.data.incoming.watchlist, 1);
  assert.equal(preview.json.data.incoming.screenerResults, 1);
  assert.equal(preview.json.data.incoming.screenerCandidateNotes, 1);
  assert.equal(preview.json.data.incoming.sectorLeaderSnapshots, 1);
  assert.ok(Object.prototype.hasOwnProperty.call(preview.json.data.current, 'watchlist'));

  const imported = await requestJson(server, {
    path: '/api/user/import',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { mode: 'replace', backup });

  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json.success, true);
  assert.equal(imported.json.data.watchlist, 1);
  assert.equal(imported.json.data.trades, 1);
  assert.equal(imported.json.data.screenerResults, 1);
  assert.equal(imported.json.data.screenerCandidateNotes, 1);
  assert.equal(imported.json.data.sectorLeaderSnapshots, 1);

  const exported = await requestJson(server, '/api/user/export');
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.json.success, true);
  assert.equal(exported.json.data.version, 1);
  assert.equal(exported.json.data.tables.watchlist[0].code, '000001');
  assert.equal(exported.json.data.tables.trades[0].quantity, 100);
  assert.equal(exported.json.data.tables.sectors[0].name, 'Backup Sector');
  assert.equal(exported.json.data.tables.sectorLeaders[0].code, '000001');
  assert.equal(exported.json.data.tables.sectorLeaderSnapshots[0].code, '000001');
  assert.equal(exported.json.data.tables.sectorLeaderSnapshots[0].sectorName, 'Backup Sector');
  assert.equal(exported.json.data.tables.screenerResults[0].taskName, 'Backup Screener');
  assert.equal(exported.json.data.tables.screenerResults[0].aiResult, 'backup AI note');
  assert.equal(exported.json.data.tables.screenerCandidateNotes[0].status, 'priority');
  assert.equal(exported.json.data.tables.screenerCandidateNotes[0].note, 'backup review note');
});

test('news service supports provider registration', () => {
  const before = newsService.providers.length;
  newsService.registerProvider({
    name: 'test-provider',
    list: () => []
  });
  assert.equal(newsService.providers.length, before + 1);
  const items = newsService.listNews({ type: 'market', cacheBust: String(Date.now()) });
  assert.ok(Array.isArray(items));
  assert.ok(items.length > 0);

  newsService.registerProvider({
    name: 'duplicate-provider',
    list: () => [
      { title: 'Duplicate title', source: 'Test', summary: 'one', link: '#', relatedStocks: ['000001'] },
      { title: 'Duplicate title', source: 'Test', summary: 'two', link: '#', relatedStocks: ['000001'] }
    ]
  });
  const deduped = newsService.listNewsWithMeta({ cacheBust: 'dedupe-' + Date.now() });
  assert.equal(deduped.items.length, 1);
  assert.equal(deduped.meta.providers[0].name, 'duplicate-provider');

  newsService.registerProvider({
    name: 'failing-provider',
    list: () => {
      throw new Error('planned failure');
    }
  });
  const degraded = newsService.listNewsWithMeta({ cacheBust: 'failure-' + Date.now() });
  assert.equal(degraded.meta.degraded, true);
  assert.ok(degraded.meta.providers.some(provider => provider.name === 'failing-provider' && provider.ok === false));
  assert.ok(degraded.items.length > 0);
});

test('news service filters items by type and keyword', () => {
  const items = newsService.applyNewsFilters([
    {
      title: 'Semiconductor leader update',
      source: 'Research Desk',
      summary: 'Volume expansion and sector breadth are improving.',
      type: 'sector',
      relatedSectors: ['Semiconductor']
    },
    {
      title: 'Bank holding risk note',
      source: 'Portfolio Desk',
      summary: 'Position drawdown needs review.',
      type: 'holding',
      relatedStocks: ['000001']
    }
  ], { type: 'sector', keyword: 'leader' });

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Semiconductor leader update');

  const empty = newsService.applyNewsFilters(items, { keyword: 'nonexistent' });
  assert.equal(empty.length, 0);
});

test('news service supports optional JSON URL providers', async (t) => {
  const remote = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      items: [{
        title: 'Remote JSON news',
        source: 'Remote Test',
        summary: 'remote provider summary',
        link: 'https://example.com/news',
        type: 'stock',
        relatedStocks: ['000001']
      }]
    }));
  });
  remote.listen(0);
  await new Promise(resolve => remote.once('listening', resolve));
  t.after(() => remote.close());

  const url = 'http://127.0.0.1:' + remote.address().port + '/news.json';
  const provider = newsService.createJsonUrlProvider(url, { name: 'test-json-url-provider', timeoutMs: 1000 });
  const directItems = await provider.list({ type: 'stock', code: '000001' });
  assert.equal(directItems.length, 1);
  assert.equal(directItems[0].title, 'Remote JSON news');
  assert.deepEqual(directItems[0].relatedStocks, ['000001']);

  const before = newsService.asyncProviders.length;
  newsService.registerAsyncProvider(provider);
  assert.equal(newsService.asyncProviders.length, before + 1);

  const listed = await newsService.listNewsWithMetaAsync({ type: 'stock', code: '000001', cacheBust: 'json-url-' + Date.now() });
  assert.equal(listed.items[0].title, 'Remote JSON news');
  assert.equal(listed.meta.providers[0].name, 'test-json-url-provider');
});
