const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const calendar = require('./marketTradingCalendar');

const VAPID_FILE = 'mobile-push-vapid.json';
const CHECK_INTERVAL_MS = 60 * 1000;

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function accountMap(snapshot) {
  return new Map((Array.isArray(snapshot && snapshot.accounts) ? snapshot.accounts : []).map(function(account) {
    return [String(account.id), {
      totalAssets: finite(account.summary && account.summary.totalAssets),
      positionCount: finite(account.summary && account.summary.positionCount),
      positionSignature: account.positionSignature || ''
    }];
  }));
}

function researchCount(snapshot) {
  return finite(snapshot && snapshot.research && snapshot.research.totals && snapshot.research.totals.observationCount) || 0;
}

function detectSnapshotChange(previous, next) {
  if (!previous || !next) return null;
  const previousAlerts = new Map((previous.priceAlerts || []).map(item => [item.key, item.active]));
  if ((next.priceAlerts || []).some(item => item.active && !previousAlerts.get(item.key))) return { kind: 'price-alert' };
  if (researchCount(next) > researchCount(previous)) return { kind: 'research' };

  const before = accountMap(previous);
  const after = accountMap(next);
  if (before.size !== after.size) return { kind: 'portfolio' };
  for (const [id, account] of after.entries()) {
    const old = before.get(id);
    if (!old || old.positionCount !== account.positionCount) return { kind: 'portfolio' };
    if (old.positionSignature && account.positionSignature && old.positionSignature !== account.positionSignature) return { kind: 'portfolio' };
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
    body: change && change.kind === 'research' ? '研究资料有更新，打开应用查看。' : change && change.kind === 'price-alert' ? '关注标的触发预警点位，打开应用查看。' : '工作台状态有明显变化，打开应用查看。',
    url: '/mobile.html'
  };
}

function priceAlertStates(snapshot, previous) {
  if (!snapshot.watchlist) return snapshot.priceAlerts || [];
  const old = new Map((previous && previous.priceAlerts || []).map(item => [item.key, item]));
  const result = new Map();
  const now = new Date(snapshot.generatedAt);
  for (const item of (snapshot.watchlist.items || []).slice(0, 1000)) {
    const observed = Date.parse(item.quoteDate + 'T' + item.quoteTime + '+08:00');
    const price = finite(item.currentPrice);
    const fresh = calendar.isContinuousSession(now) && item.quoteStatus === 'live' && price > 0 && Number.isFinite(observed) && observed <= now.getTime() + 5000 && now.getTime() - observed <= 5 * 60000;
    for (const [side, level] of [['high', finite(item.alertHigh)], ['low', finite(item.alertLow)]]) {
      if (!(level > 0)) continue;
      const key = item.code + ':' + side + ':' + level;
      if (fresh) result.set(key, { key, active: side === 'high' ? price >= level : price <= level });
      else if (old.has(key)) result.set(key, old.get(key));
    }
  }
  return Array.from(result.values());
}

function comparisonSnapshot(snapshot, previous) {
  const old = accountMap(previous);
  return {
    accounts: (Array.isArray(snapshot && snapshot.accounts) ? snapshot.accounts : []).map(function(account) {
      let positionSignature = account.positionSignature || old.get(String(account.id))?.positionSignature || '';
      if (Array.isArray(account.positions) && !['saved-snapshot', 'unavailable'].includes(account.valuationStatus)) {
        const holdings = account.positions.map(item => [String(item.code), finite(item.quantity)]).sort((a, b) => a[0].localeCompare(b[0]));
        positionSignature = crypto.createHash('sha256').update(JSON.stringify(holdings)).digest('hex');
      }
      return {
        id: account.id,
        positionSignature,
        summary: {
          totalAssets: finite(account.summary && account.summary.totalAssets),
          positionCount: finite(account.summary && account.summary.positionCount)
        }
      };
    }),
    priceAlerts: priceAlertStates(snapshot || {}, previous),
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
      if (!listSubscriptions().length) return { skipped: true, reason: 'no-subscribers' };
      const snapshot = await loadSnapshot();
      const previous = readPrevious();
      const next = comparisonSnapshot(snapshot, previous);
      const change = detectSnapshotChange(previous, next);
      const delivery = change ? await broadcast(change) : { attempted: 0, delivered: 0 };
      if (!change || delivery.delivered > 0 || delivery.attempted === 0) savePrevious(next);
      return { change, ...delivery };
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
