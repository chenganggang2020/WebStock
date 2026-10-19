// Isolated reproduction: only writes a fresh copy of the offline backup.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const directory = fs.mkdtempSync(path.join(process.argv.includes('--same-volume') ? path.resolve('output') : os.tmpdir(), 'webstock-capture-repro-'));
const filename = path.join(directory, 'webstock.db');
fs.copyFileSync(path.resolve('output/backups/pre-research-restart-20260921-2257/webstock.db'), filename);
process.env.WEBSTOCK_DB_PATH = filename;
const db = require('../db');
const channels = require('../services/expertChannelService');
const sources = require('../services/douyinSourceService');
const timings = new Map();
const prepare = db.prepare;
db.prepare = function(sql) {
  const statement = prepare.call(this, sql);
  for (const method of ['get', 'all', 'run']) {
    const original = statement[method];
    statement[method] = function(...args) {
      const start = performance.now();
      try { return original.apply(this, args); }
      finally {
        const key = method + ' ' + sql.replace(/\s+/g, ' ').slice(0, 95);
        const entry = timings.get(key) || { key, count: 0, totalMs: 0, maxMs: 0 };
        const elapsed = performance.now() - start;
        entry.count++; entry.totalMs += elapsed; entry.maxMs = Math.max(entry.maxMs, elapsed);
        timings.set(key, entry);
      }
    };
  }
  return statement;
};
(async () => { for (const id of [1, 4, 5]) {
  const channel = channels.getChannel(id), rows = channels.listCollectionObservations(id);
  const capture = { pageType: 'profile', pageUrl: channel.profileUrl, loggedIn: true,
    capturedAt: new Date().toISOString(), profile: { displayName: channel.displayName, profileUrl: channel.profileUrl, workCount: rows.length },
    items: rows.filter(row => row.externalContentId).map(row => ({ contentId: row.externalContentId,
      sourceUrl: row.sourceUrl, title: row.title, mediaType: row.mediaType, publishedAt: row.publishedAt })) };
  const start = performance.now(), cpu = process.cpuUsage();
  let ticks = 0, longestGapMs = 0, previous = performance.now();
  const pulse = setInterval(() => { const now = performance.now(); longestGapMs = Math.max(longestGapMs, now-previous); previous = now; ticks++; }, 20);
  const result = process.argv.includes('--async') ? await sources.importCapturedPageAsync(id, capture)
    : sources.importCapturedPage(id, capture);
  clearInterval(pulse);
  console.log(JSON.stringify({ id, ms: performance.now() - start, cpu: process.cpuUsage(cpu),
    count: result.capturedCount, changed: result.updatedCount, ticks, longestGapMs }));
}
console.log(JSON.stringify({ directory, sql: [...timings.values()].sort((a,b) => b.totalMs-a.totalMs).slice(0, 12) }, null, 2));
db.close();
})().catch(error => { console.error(error); process.exitCode=1; db.close(); });
