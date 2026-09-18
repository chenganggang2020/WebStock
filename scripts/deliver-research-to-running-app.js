'use strict';

// Local delivery bridge: production records are written only through the running app API.
const fs = require('node:fs');

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('必须指定本机 WebStock 的 http 地址，不能传入远程地址或凭据');
  }
  return url.origin;
}

async function jsonRequest(origin, endpoint, body) {
  const response = await fetch(origin + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) throw new Error(data.error || 'WebStock 请求失败：' + response.status);
  return data;
}

async function deliver(options, dependencies) {
  const origin = localOrigin(options.baseUrl);
  const request = dependencies.request || jsonRequest;
  const validated = dependencies.validateBatch(options.input);
  if (!validated.wantsTonghuashun) throw new Error('此入口需要同时投递 WebStock 和同花顺');
  const plan = dependencies.plan(validated);
  await request(origin, '/api/health');
  const result = { origin, batchKey: validated.batchKey, marketDate: validated.normalized.asOf.marketDate,
    groupName: plan.targetName, candidateCount: plan.picks.length, automaticTrading: false };
  if (!options.apply) return { ...result, applied: false, mode: 'preview' };
  const imported = (await request(origin, '/api/external-research-batches', options.input)).data;
  if (!imported || imported.batchKey !== validated.batchKey || imported.payloadHash !== validated.payloadHash) {
    throw new Error('运行程序返回的批次身份不匹配，已停止同花顺写入');
  }
  const endpoint = '/api/external-research-batches/' + validated.batchKey + '/deliveries/tonghuashun-watchlist';
  let delivery;
  try {
    delivery = dependencies.apply(validated);
  } catch (error) {
    // Failure details are kept in the app; the caller can retry the same immutable batch.
    await request(origin, endpoint, { status: 'failed', details: {
      adapter: 'ths-safe-file-v1', localApplied: false, nativeSyncVerified: false,
      error: String(error.message || error).slice(0, 1000)
    } });
    throw error;
  }
  // Local files cannot prove native cloud upload. Never overwrite that distinction with success.
  await request(origin, endpoint, { status: 'pending', details: {
    ...delivery, localApplied: delivery.applied === true || delivery.noChange === true,
    nativeSyncRequested: false, nativeSyncVerified: false, cloudSync: 'pending'
  } });
  return { ...result, mode: 'apply', webstockReplayed: imported.replayed === true,
    localDelivery: delivery, cloudSync: 'pending', applied: delivery.applied === true };
}

async function main() {
  const args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : '';
  if (!value('--input') || !value('--base-url') || !value('--ths-config')) {
    throw new Error('需要 --input 批次JSON --base-url 本机程序地址 --ths-config 同花顺配置；默认预演，--apply 执行');
  }
  // The existing validator imports db. Confine that dependency to an in-memory database.
  // This process never selects or opens any production database file.
  process.env.WEBSTOCK_DB_PATH = ':memory:';
  const batchService = require('../services/externalResearchBatchService');
  const adapter = require('../services/tonghuashunCurrentAdapterService');
  const safeFiles = require('../services/tonghuashunSafeFileDeliveryService');
  const { loadSecurityCatalog } = require('../services/tonghuashunWatchlistService');
  const config = adapter.loadConfig(value('--ths-config'));
  const catalog = loadSecurityCatalog();
  const securityResolver = code => {
    const name = catalog.get(code);
    const market = /^(600|601|603|605|688|689)\d{3}$/.test(code) ? '17' :
      /^(000|001|002|003|300|301|302)\d{3}$/.test(code) ? '33' : null;
    return name && market ? { name, market } : null;
  };
  const result = await deliver({ input: JSON.parse(fs.readFileSync(value('--input'), 'utf8').replace(/^\uFEFF/, '')),
    baseUrl: value('--base-url'), apply: args.includes('--apply') }, {
    validateBatch: batchService.validateBatch,
    plan: validated => safeFiles.buildPlan(validated, config, { securityResolver }),
    apply: validated => adapter.applyCurrentDelivery(validated, config, { mode: 'safe-file', securityResolver })
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { deliver, localOrigin };
