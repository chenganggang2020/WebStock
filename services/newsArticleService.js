'use strict';

const dns = require('node:dns').promises;
const iconv = require('iconv-lite');
const axios = require('axios');
const { canonicalizeUrl, resolvePublicAddresses, nativeRequest, MAX_BYTES } = require('./industryResearchSourceService');
const HOSTS = new Set(['finance.sina.com.cn', 'news.sina.com.cn', 'cj.sina.com.cn', 'finance.eastmoney.com', 'stock.eastmoney.com', 'wap.eastmoney.com']);
const addressCache = new Map();

async function resolveArticleAddress(hostname, options = {}) {
  const lookup = options.lookup || dns.lookup.bind(dns);
  let records = await lookup(hostname, {all:true,verbatim:true});
  // TUN fake-IP DNS uses the reserved 198.18/15 range. Resolve this exact
  // condition through authenticated HTTPS DNS, then still validate and pin the
  // resulting public address. Never connect directly to a private/fake address.
  if (records.length && records.every(record => /^198\.(18|19)\./.test(record.address))) {
    const cached = addressCache.get(hostname);
    if (!options.resolveHttps && cached && cached.expires > Date.now()) records = cached.records;
    else {
      const resolver = options.resolveHttps || (async name => {
        const response = await axios.get('https://cloudflare-dns.com/dns-query', {
          params:{name,type:'A'}, headers:{Accept:'application/dns-json'}, timeout:4000,
          maxRedirects:0, maxContentLength:32768, signal:options.signal
        });
        return (response.data.Answer || []).filter(answer => answer.type === 1).map(answer => ({address:answer.data,family:4}));
      });
      records = await resolver(hostname);
    }
    const validated = await resolvePublicAddresses(hostname, async () => records);
    if (!options.resolveHttps) addressCache.set(hostname,{records,expires:Date.now()+30000});
    return validated;
  }
  return resolvePublicAddresses(hostname, async () => records);
}

function articleUrl(value) {
  const url = canonicalizeUrl(value);
  if (!HOSTS.has(new URL(url).hostname)) throw new Error('该来源暂不支持应用内正文阅读');
  return url;
}

function decodeEntities(text) {
  const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’',mdash:'—',hellip:'…'};
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] || all;
    const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2),16) : parseInt(name.slice(1),10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}

function extractArticle(html) {
  // Only recognized article containers; never promote a whole page/menu or a
  // metadata description into an article. Output is plain text, not trusted HTML.
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|iframe|aside|nav|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const start = /<(div|article)\b[^>]*\bid\s*=\s*["'](?:artibody|article|ContentBody|article_content)["'][^>]*>/i.exec(clean);
  if (!start) return [];
  const tags = new RegExp('<\\/?' + start[1] + '\\b[^>]*>', 'gi');
  tags.lastIndex = start.index + start[0].length;
  let depth = 1, end = clean.length, match;
  while ((match = tags.exec(clean))) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (!depth) { end = match.index; break; }
  }
  if (depth) return [];
  const content = clean.slice(start.index + start[0].length, end);
  return Array.from(content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi), entry =>
    decodeEntities(entry[1].replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'')).replace(/[\t \u00a0]+/g,' ').trim()
  ).filter(text => text && !/^(责任编辑|海量资讯|新浪声明|打开APP|广告|原标题[:：]?$)/.test(text));
}

async function fetchPublicPage(input, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 12000;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('读取正文超时，请稍后重试')); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      let url = articleUrl(input);
      for (let redirects = 0; redirects <= 3; redirects++) {
        const address = await resolveArticleAddress(new URL(url).hostname, {...options,signal:controller.signal});
        if (controller.signal.aborted) throw new Error('读取正文超时');
        const response = await (options.request || nativeRequest)(url, address, {timeoutMs,signal:controller.signal});
        const headers = response.headers || {};
        if (response.statusCode >= 300 && response.statusCode < 400 && headers.location) {
          url = articleUrl(new URL(headers.location, url).href);
          continue;
        }
        if (response.statusCode !== 200) throw new Error('源站暂不可读（HTTP ' + response.statusCode + '）');
        if (!/^text\/html\b/i.test(headers['content-type'] || '')) throw new Error('源站未返回新闻网页');
        if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') throw new Error('源站编码暂不支持');
        const body = Buffer.from(response.body);
        if (body.length > MAX_BYTES) throw new Error('新闻网页超过读取大小限制');
        const charset = ((headers['content-type'] || '').match(/charset\s*=\s*["']?([\w-]+)/i) || body.toString('ascii',0,4096).match(/charset\s*=\s*["']?([\w-]+)/i) || [,'utf-8'])[1];
        if (!/^(utf-?8|gbk|gb2312|gb18030|us-ascii)$/i.test(charset)) throw new Error('新闻字符编码暂不支持');
        return {html:iconv.decode(body,charset),finalUrl:url};
      }
      throw new Error('新闻页面重定向次数过多');
    })()]);
  } finally { clearTimeout(timer); controller.abort(); }
}

function createNewsArticleService(options = {}) {
  const cache = new Map(), pending = new Map();
  const fetchPage = options.fetchPage || fetchPublicPage;
  const now = options.now || Date.now;
  async function read(input) {
    let url;
    try { url = articleUrl(input); }
    catch (error) { return {status:'unavailable', paragraphs:[], message:error.message}; }
    const hit = cache.get(url);
    if (hit && hit.expires > now()) return {...hit.data,cached:true};
    if (pending.has(url)) return pending.get(url);
    if (pending.size >= 4) return {status:'unavailable',paragraphs:[],message:'正在读取其他正文，请稍后重试'};
    const task = (async () => {
      let data;
      try {
        const page = await fetchPage(url);
        const finalUrl = articleUrl(page.finalUrl);
        const paragraphs = extractArticle(page.html);
        data = paragraphs.join('').length >= 40
          ? {status:'available', paragraphs, sourceUrl:url, finalUrl, fetchedAt:new Date(now()).toISOString(), extractor:'public-article-v1', message:'公开正文 · 页面提取'}
          : {status:'unavailable',paragraphs:[],sourceUrl:url,message:'未取得可读正文：页面可能需要登录、已下线或不支持提取。以下仅为资讯摘要。'};
      } catch (error) {
        data = {status:'unavailable',paragraphs:[],sourceUrl:url,message:'正文暂不可用；保留摘要。' + (error.code ? '（' + error.code + '）' : ' ' + error.message)};
      }
      if (cache.size >= 80) cache.delete(cache.keys().next().value);
      cache.set(url,{data,expires:now()+(data.status === 'available' ? 30*60000 : 30000)});
      return {...data,cached:false};
    })();
    pending.set(url,task);
    try { return await task; } finally { pending.delete(url); }
  }
  return {read};
}
module.exports = { articleUrl, extractArticle, fetchPublicPage, resolveArticleAddress, createNewsArticleService };
