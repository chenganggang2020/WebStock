'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

async function run(options = {}) {
  if (options.isolated !== true) throw new Error('必须显式使用 --isolated；拒绝默认或生产数据库');
  if (require.cache[require.resolve('../db')] || require.cache[require.resolve('../services/industryResearchService')]) throw new Error('隔离 live 验证必须在数据库和研究服务首次加载前启动');
  const topic = String(options.topic || '').trim();
  const url = String(options.url || '').trim();
  if (!topic || !/^https:\/\/[^\s]+$/i.test(url)) throw new Error('必须提供 --topic 和 HTTPS --url');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-industry-research-live-'));
  const dbPath = path.join(tempRoot, 'research.db');
  process.env.WEBSTOCK_DB_PATH = dbPath;
  let db;
  try {
    db = require('../db');
    if (db.name && path.resolve(db.name) !== path.resolve(dbPath)) throw new Error('隔离数据库连接路径不匹配');
    const service = require('../services/industryResearchService');
    if (!service.listTopics().some(item => item.id === topic)) throw new Error('未知研究主题：' + topic);
    const result = await service.updateTopic(topic, { sourceUrls: [url], useAi: false });
    const evidence = result.currentVersion && Array.isArray(result.currentVersion.evidence) ? result.currentVersion.evidence : [];
    const output = {
      isolated: true,
      database: 'temporary',
      topic,
      requestedUrl: url,
      status: result.run && result.run.status,
      startedAt: result.run && result.run.startedAt,
      completedAt: result.run && result.run.completedAt,
      errors: result.run && Array.isArray(result.run.errors) ? result.run.errors : [],
      fetchedCount: evidence.length,
      blocked: result.run && result.run.status === 'failed',
      evidence: evidence.map(item => ({ requestedUrl: item.requestedUrl, finalUrl: item.finalUrl, contentSha256: item.contentSha256, status: item.status, fetchedAt: item.fetchedAt, errorCode: item.errorCode || null }))
    };
    console.log(JSON.stringify(output, null, 2));
    return output;
  } finally {
    if (db && db.open) db.close();
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(tempRoot));
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(tempRoot).startsWith('webstock-industry-research-live-')) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  run({ isolated: args.includes('--isolated'), topic: argValue(args, '--topic'), url: argValue(args, '--url') }).catch(error => {
    console.error(JSON.stringify({ isolated: args.includes('--isolated'), status: 'blocked', errors: [{ code: error.code || 'LIVE_VALIDATION_FAILED', message: error.message || String(error) }] }));
    process.exitCode = 1;
  });
}

module.exports = { run };
