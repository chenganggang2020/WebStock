const fs = require('node:fs');
const path = require('node:path');

const VAPID_FILE = 'mobile-push-vapid.json';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function accountMap(snapshot) {
  return new Map((Array.isArray(snapshot && snapshot.accounts) ? snapshot.accounts : []).map(function(account) {
    return [String(account.id), {
      totalAssets: finite(account.summary && account.summary.totalAssets),
      positionCount: finite(account.summary && account.summary.positionCount)
    }];
  }));
}

function researchCount(snapshot) {
  return finite(snapshot && snapshot.research && snapshot.research.totals && snapshot.research.totals.observationCount) || 0;
}

function detectSnapshotChange(previous, next) {
  if (!previous || !next) return null;
  if (researchCount(next) > researchCount(previous)) return { kind: 'research' };

  const before = accountMap(previous);
  const after = accountMap(next);
  if (before.size !== after.size) return { kind: 'portfolio' };
  for (const [id, account] of after.entries()) {
    const old = before.get(id);
    if (!old || old.positionCount !== account.positionCount) return { kind: 'portfolio' };
    if (old.totalAssets !== null && old.totalAssets > 0 && account.totalAssets !== null) {
      if (Math.abs(account.totalAssets - old.totalAssets) / old.totalAssets >= 0.03) return { kind: 'portfolio' };
    }
  }
  return null;
}

function buildPrivateNotification(change) {
  if (change && change.kind === 'test') {
    return { title: 'WebStock 通知已开启', body: '以后有重要数据变化时会在这里提醒。', url: '/mobile.html' };
  }
  return {
    title: 'WebStock 有新的数据变化',
    body: change && change.kind === 'research' ? '研究资料有更新，打开应用查看。' : '工作台状态有明显变化，打开应用查看。',
    url: '/mobile.html'
  };
}

function comparisonSnapshot(snapshot) {
  return {
    accounts: (Array.isArray(snapshot && snapshot.accounts) ? snapshot.accounts : []).map(function(account) {
      return {
        id: account.id,
        summary: {
          totalAssets: finite(account.summary && account.summary.totalAssets),
          positionCount: finite(account.summary && account.summary.positionCount)
        }
      };
    }),
    research: { totals: { observationCount: researchCount(snapshot) } }
  };
}

function validSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return false;
  try {
    const endpoint = new URL(String(subscription.endpoint || ''));
    if (endpoint.protocol !== 'https:') return false;
  } catch (_) {
    return false;
  }
  const keys = subscription.keys || {};
  return String(keys.p256dh || '').length >= 40 && String(keys.auth || '').length >= 8;
}

function createMobilePushService(options = {}) {
  const database = options.database || require('../db');
  const webPush = options.webPush || require('web-push');
  const loadSnapshot = options.loadSnapshot || require('./mobileSnapshotService').loadMobileSnapshot;
  const dataDir = options.dataDir || path.dirname(database.dbPath || require('../db').dbPath);
  const intervalMs = Number(options.intervalMs) || CHECK_INTERVAL_MS;
  let timer = null;
  let running = false;
  let vapid = null;

  function ensureVapid() {
    if (vapid) return vapid;
    const target = path.join(dataDir, VAPID_FILE);
    try {
      const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (saved.publicKey && saved.privateKey) vapid = saved;
    } catch (_) {}
    if (!vapid) {
      fs.mkdirSync(dataDir, { recursive: true });
      vapid = webPush.generateVAPIDKeys();
      const temporary = target + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(vapid, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, target);
    }
    webPush.setVapidDetails('mailto:webstock@local.invalid', vapid.publicKey, vapid.privateKey);
    return vapid;
  }

  function subscribe(subscription, userAgent) {
    if (!validSubscription(subscription)) throw new Error('无效的网页通知订阅。');
    const json = JSON.stringify(subscription);
    if (Buffer.byteLength(json, 'utf8') > 16 * 1024) throw new Error('网页通知订阅过大。');
    database.prepare(`
      INSERT INTO mobile_push_subscriptions(endpoint, subscription_json, user_agent, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(endpoint) DO UPDATE SET
        subscription_json = excluded.subscription_json,
        user_agent = excluded.user_agent,
        updated_at = datetime('now')
    `).run(String(subscription.endpoint), json, String(userAgent || '').slice(0, 300));
    return { subscribed: true };
  }

  function unsubscribe(endpoint) {
    const value = String(endpoint || '');
    if (!value) return { subscribed: false };
    database.prepare('DELETE FROM mobile_push_subscriptions WHERE endpoint = ?').run(value);
    return { subscribed: false };
  }

  function listSubscriptions() {
    return database.prepare('SELECT endpoint, subscription_json FROM mobile_push_subscriptions ORDER BY id').all().flatMap(function(row) {
      try { return [{ endpoint: row.endpoint, subscription: JSON.parse(row.subscription_json) }]; } catch (_) { return []; }
    });
  }

  async function sendToSubscription(subscription, payload) {
    ensureVapid();
    try {
      await webPush.sendNotification(subscription, JSON.stringify(payload), { TTL: 300, urgency: 'normal' });
      return true;
    } catch (error) {
      if (error && (error.statusCode === 404 || error.statusCode === 410)) unsubscribe(subscription.endpoint);
      return false;
    }
  }

  async function broadcast(change) {
    const payload = buildPrivateNotification(change);
    const subscriptions = listSubscriptions();
    const results = await Promise.all(subscriptions.map(item => sendToSubscription(item.subscription, payload)));
    return { attempted: subscriptions.length, delivered: results.filter(Boolean).length };
  }

  function readPrevious() {
    const row = database.prepare('SELECT snapshot_json FROM mobile_push_state WHERE id = 1').get();
    if (!row) return null;
    try { return JSON.parse(row.snapshot_json); } catch (_) { return null; }
  }

  function savePrevious(snapshot) {
    database.prepare(`
      INSERT INTO mobile_push_state(id, snapshot_json, updated_at)
      VALUES (1, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = datetime('now')
    `).run(JSON.stringify(comparisonSnapshot(snapshot)));
  }

  async function checkNow() {
    if (running) return { skipped: true };
    running = true;
    try {
      const snapshot = await loadSnapshot();
      const previous = readPrevious();
      const next = comparisonSnapshot(snapshot);
      savePrevious(next);
      const change = detectSnapshotChange(previous, next);
      return change ? { change, ...(await broadcast(change)) } : { change: null, attempted: 0, delivered: 0 };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(function() { checkNow().catch(function() {}); }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    setTimeout(function() { checkNow().catch(function() {}); }, 15000).unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function publicStatus() {
    const keys = ensureVapid();
    const row = database.prepare('SELECT COUNT(*) AS count FROM mobile_push_subscriptions').get();
    return { supported: true, publicKey: keys.publicKey, subscriptionCount: Number(row && row.count || 0) };
  }

  async function sendTest(endpoint) {
    const row = database.prepare('SELECT subscription_json FROM mobile_push_subscriptions WHERE endpoint = ?').get(String(endpoint || ''));
    if (!row) throw new Error('该设备尚未订阅通知。');
    const delivered = await sendToSubscription(JSON.parse(row.subscription_json), buildPrivateNotification({ kind: 'test' }));
    return { delivered };
  }

  return { publicStatus, subscribe, unsubscribe, sendTest, checkNow, start, stop };
}

let defaultService = null;
function getMobilePushService() {
  if (!defaultService) defaultService = createMobilePushService();
  return defaultService;
}

module.exports = {
  VAPID_FILE,
  CHECK_INTERVAL_MS,
  detectSnapshotChange,
  buildPrivateNotification,
  comparisonSnapshot,
  validSubscription,
  createMobilePushService,
  getMobilePushService
};
