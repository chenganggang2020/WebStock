'use strict';
const https = require('https');
const crypto = require('crypto');
const calendar = require('./marketTradingCalendar');

const CATALOG = 'https://np-topic.eastmoney.com/v4/api/follow/single';
function buildCatalogUrl(clock = Date.now) {
  return CATALOG + '?trace=' + clock() + '&client=wap&biz=sec_follow_detail&code=etfzz2026&count=10&timestamp=0';
}
function articleUrl(id) {
  if (!/^\d{10,20}$/.test(String(id))) throw new Error('Invalid Eastmoney article id');
  return 'https://wap.eastmoney.com/a/' + id + '.html';
}
function stripHtml(value) {
  return String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
function validDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) &&
    new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
}
function publicationDate(value) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!m || !validDay(m[1]) || m[2] > '23:59:59' || Number(m[2].slice(3,5)) > 59 || Number(m[2].slice(6)) > 59) return null;
  return m[1] + 'T' + m[2] + '+08:00';
}
function parseCatalog(payload) {
  if (!payload || payload.success !== 1 || !Array.isArray(payload.data && payload.data.elements)) throw new Error('东方财富栏目格式不可用');
  return payload.data.elements.slice(0, 20)
    .flatMap(x => x && x.type === 'NewsList' && Array.isArray(x.data) ? x.data.slice(0, 10) : [])
    .filter(x => /^\d{10,20}$/.test(String(x.code || '')) && /ETF追踪/.test(String(x.title || '')) && publicationDate(x.stime))
    .sort((a, b) => Date.parse(publicationDate(b.stime)) - Date.parse(publicationDate(a.stime))).slice(0, 10);
}
function dataDay(text, publishedAt) {
  const m = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) throw new Error('日报缺少数据交易日期');
  let year = Number(publishedAt.slice(0, 4));
  const month = Number(m[1]), day = Number(m[2]);
  if (Number(publishedAt.slice(5, 7)) === 1 && month === 12) year--;
  const value = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  if (!validDay(value) || value >= publishedAt.slice(0, 10)) throw new Error('日报数据日期与发布时间不一致');
  return value;
}
function signedMoney(text, prefix) {
  const match = text.match(new RegExp(prefix + '\\s*(净流入|净流出|净申购|净赎回)\\s*(\\d+(?:\\.\\d+)?)\\s*亿元'));
  if (!match) throw new Error('日报核心净申赎数字缺失');
  return (/出|赎回/.test(match[1]) ? -1 : 1) * Number(match[2]);
}
function ranking(body, label, sign) {
  const paragraphs = Array.from(body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map(x => x[1]);
  const section = paragraphs.find(x => new RegExp('股票型ETF.*' + label + '前\\s*3').test(stripHtml(x)));
  if (!section) throw new Error('日报缺少股票型ETF' + label + '前三名');
  const pattern = new RegExp('<a\\b[^>]*href=["\\x27]https:\\/\\/wap\\.eastmoney\\.com\\/quote\\/stock\\/[01]\\.(\\d{6})\\.html["\\x27][^>]*>([\\s\\S]*?)<\\/a>\\s*[，,]\\s*' + label + '\\s*(\\d+(?:\\.\\d+)?)\\s*亿元', 'gi');
  const rows = Array.from(section.matchAll(pattern)).map(m => ({
    code: m[1], name: stripHtml(m[2]), value: sign * Number(m[3]), unit: '亿元'
  }));
  if (rows.length !== 3 || rows.some(x => !x.name || x.name.length > 80) || new Set(rows.map(x => x.code)).size !== 3) {
    throw new Error('日报前三名格式变化或不完整，未补造数据');
  }
  return rows;
}
function parseArticle(html, item, now = new Date()) {
  html = String(html || '');
  const start = /<div\b[^>]*\bid=["']articleContent["'][^>]*>/i.exec(html);
  const tail = start ? html.slice(start.index + start[0].length) : '';
  const end = /<div\b[^>]*\bclass=["'][^"']*\bend_source\b[^"']*["']/i.exec(tail);
  if (!start || !end) throw new Error('日报正文区不可用');
  const sourceFooter = /^<div\b[^>]*>([\s\S]*?)<\/div>/i.exec(tail.slice(end.index));
  if (String(item.source || '').trim() !== '东方财富Choice数据' || !sourceFooter ||
      !/^文章来源[：:]\s*东方财富Choice数据$/.test(stripHtml(sourceFooter[1]))) {
    throw new Error('日报来源缺失或冲突，未认定为Choice数据');
  }
  const body = tail.slice(0, end.index).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const text = stripHtml(body);
  const publishedAt = publicationDate((html.match(/data-showtime\s*=\s*["']([^"']+)/i) || [])[1]) || publicationDate(item.stime);
  if (!publishedAt || Date.parse(publishedAt) > now.getTime()) throw new Error('日报发布时间缺失或晚于当前时间');
  if (!/ETF追踪/.test(item.title || '')) throw new Error('不是ETF追踪日报');
  const asOf = dataDay(text, publishedAt);
  if (dataDay(item.title, publishedAt) !== asOf) throw new Error('日报标题与正文的数据日期不一致');
  if (calendar.tradingDay(publishedAt.slice(0, 10)).known && calendar.previousTradingDay(publishedAt.slice(0, 10)) !== asOf) {
    throw new Error('日报数据日期不是发布日前一交易日');
  }
  const imageUrls = Array.from(body.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)).map(x => x[1]);
  const originalImageUrl = imageUrls.find(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'np-newspic.dfcfw.com' && !url.port && !url.username && !url.password &&
        /^\/download\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) && !url.search && !url.hash;
    } catch (_) { return false; }
  }) || null;
  return {
    schema: 'webstock.eastmoney-etf-daily.v1', articleId: String(item.code),
    title: stripHtml(item.title), provider: 'eastmoney-choice-public-article',
    source: '东方财富Choice数据 · 公开日报', sourceUrl: articleUrl(item.code),
    originalImageUrl, publishedAt, asOf, unit: '亿元',
    totalNetFlow: signedMoney(text, 'ETF资金整体'),
    stockEtfNetFlow: signedMoney(text, '股票型(?:ETF)?'),
    subscriptions: ranking(body, '净申购', 1), redemptions: ranking(body, '净赎回', -1),
    coverage: { body: 'TOP3', image: originalImageUrl ? '原文图表（未结构化提取）' : null },
    methodology: '东方财富Choice公开发布的ETF日度净申购赎回数据；未取得其逐只基金计算明细，未独立复算。',
    truthStatement: 'ETF一级市场申购赎回口径，不是全A主力资金，也不是二级市场成交额。'
  };
}
function getText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['np-topic.eastmoney.com', 'wap.eastmoney.com'].includes(target.hostname) || target.username || target.password || target.port) return reject(new Error('拒绝非指定东方财富来源'));
    const request = https.get(target, { headers: { 'User-Agent': 'WebStock/1.0' } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('东方财富 HTTP ' + response.statusCode)); return; }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > (options.maxBytes || 3 * 1024 * 1024)) request.destroy(new Error('日报响应超过大小限制'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    const timer = setTimeout(() => request.destroy(new Error('东方财富读取超时')), options.timeoutMs || 12000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
function createEastmoneyEtfDailyService(options = {}) {
  const db = options.db || require('../db');
  const now = options.now || (() => new Date());
  const fetchCatalog = options.fetchCatalog || (async () => JSON.parse(await getText(buildCatalogUrl(), { maxBytes: 512 * 1024 })));
  const fetchArticle = options.fetchArticle || (id => getText(articleUrl(id)));
  db.exec('CREATE TABLE IF NOT EXISTS eastmoney_etf_daily_reports (article_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, content_sha256 TEXT NOT NULL, as_of TEXT, published_at TEXT, checked_at TEXT, succeeded_at TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS eastmoney_etf_daily_state (id INTEGER PRIMARY KEY CHECK(id=1), value_json TEXT NOT NULL)');
  function getState() {
    const row = db.prepare('SELECT value_json FROM eastmoney_etf_daily_state WHERE id=1').get();
    return row ? JSON.parse(row.value_json) : {};
  }
  function updateState(patch) {
    const value = { ...getState(), ...patch };
    db.prepare('INSERT INTO eastmoney_etf_daily_state(id,value_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json').run(JSON.stringify(value));
    return value;
  }
  function latest() {
    const row = db.prepare("SELECT payload_json FROM eastmoney_etf_daily_reports WHERE article_id <> '__scheduler__' ORDER BY as_of DESC,published_at DESC LIMIT 1").get();
    const report = row ? JSON.parse(row.payload_json) : null;
    const state = getState(), today = calendar.clock(now()).date;
    const expectedAsOf = calendar.previousTradingDay(today);
    const isCurrent = Boolean(report && expectedAsOf && report.asOf === expectedAsOf);
    return {
      ...(report || { subscriptions: [], redemptions: [], totalNetFlow: null, stockEtfNetFlow: null }),
      availability: report ? 'available' : 'unavailable', expectedAsOf, isCurrent,
      status: !report ? 'empty' : state.lastError || !isCurrent ? 'stale' : 'current',
      checkedAt: state.checkedAt || null, lastAttemptAt: state.lastAttemptAt || null,
      lastSuccessAt: state.lastSuccessAt || null, lastError: state.lastError || null
    };
  }
  let inFlight = null;
  function refresh() {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(async () => {
      const started = now(), checkedAt = started.toISOString(), targetDate = calendar.clock(started).date;
      updateState({ checkedAt, lastAttemptAt: checkedAt });
      try {
        const item = parseCatalog(await fetchCatalog())[0];
        if (!item) throw new Error('栏目中没有可核验ETF日报');
        const report = parseArticle(await fetchArticle(item.code), item, started);
        const hash = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
        const old = db.prepare('SELECT * FROM eastmoney_etf_daily_reports WHERE article_id=?').get(report.articleId);
        if (old && old.as_of !== report.asOf) throw new Error('同一篇日报的数据日期发生变化，保留上次有效数据');
        const same = Boolean(old && old.content_sha256 === hash);
        const succeededAt = same ? old.succeeded_at : now().toISOString();
        report.succeededAt = succeededAt; report.contentSha256 = hash;
        db.prepare('INSERT INTO eastmoney_etf_daily_reports(article_id,payload_json,content_sha256,as_of,published_at,checked_at,succeeded_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(article_id) DO UPDATE SET payload_json=excluded.payload_json,content_sha256=excluded.content_sha256,as_of=excluded.as_of,published_at=excluded.published_at,checked_at=excluded.checked_at,succeeded_at=excluded.succeeded_at')
          .run(report.articleId, JSON.stringify(report), hash, report.asOf, report.publishedAt, checkedAt, succeededAt);
        const current = calendar.tradingDay(targetDate).open && report.asOf === calendar.previousTradingDay(targetDate);
        updateState({
          lastError: null, lastSuccessAt: succeededAt,
          ...(current ? { lastSuccessTargetDate: targetDate } : {})
        });
        return { ...latest(), status: current ? same ? 'no-change' : 'succeeded' : 'pending-source' };
      } catch (error) {
        updateState({ lastError: String(error.message || error).slice(0, 240) });
        throw error;
      }
    }).finally(() => { inFlight = null; });
    return inFlight;
  }
  return {
    latest, refresh, getState, updateState,
    getLastAttempt: () => getState().lastScheduledAttempt || '',
    saveLastAttempt: value => updateState({ lastScheduledAttempt: value, lastScheduledAttemptAt: now().toISOString() })
  };
}
let sharedService;
function getEastmoneyEtfDailyService() {
  if (!sharedService) sharedService = createEastmoneyEtfDailyService();
  return sharedService;
}
module.exports = { buildCatalogUrl, articleUrl, parseCatalog, parseArticle, createEastmoneyEtfDailyService, getEastmoneyEtfDailyService };
