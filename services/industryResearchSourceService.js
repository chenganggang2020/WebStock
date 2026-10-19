'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');

const MAX_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10000;
const ROUND_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 3;
const EXTRACTOR_VERSION = 'industry-research-source-v1';

class SourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
  }
}

function canonicalizeUrl(input) {
  let parsed;
  try {
    parsed = new URL(String(input));
  } catch (_) {
    throw new SourceError('SOURCE_URL_INVALID', 'Invalid source URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new SourceError('SOURCE_URL_UNSAFE', 'Only HTTPS source URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new SourceError('SOURCE_URL_UNSAFE', 'Source URL userinfo is not allowed');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new SourceError('SOURCE_URL_UNSAFE', 'Only HTTPS port 443 is allowed');
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || !host.includes('.') || net.isIP(host)) {
    throw new SourceError('SOURCE_URL_UNSAFE', 'Source hostname is not a public DNS hostname');
  }

  parsed.hash = '';
  return parsed.toString();
}

function isPrivateAddress(address) {
  let value = String(address || '').toLowerCase();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  const family = net.isIP(value);
  if (family === 4) {
    const p = value.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && (p[1] === 0 || p[1] === 168)) return true;
    if (p[0] === 198 && p[1] >= 18 && p[1] <= 19) return true;
    if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true;
    if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true;
    if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true;
    return false;
  }

  if (family === 6) {
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('fc') || value.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(value)) return true;
    if (value.startsWith('ff')) return true;
    if (value.startsWith('100:')) return true;
    if (value.startsWith('2001:db8:') || value.startsWith('2002:')) return true;
    if (value.startsWith('::ffff:')) return true;
    return false;
  }

  return true;
}

function withTimeout(task, timeoutMs, code, message) {
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new SourceError(code, message)), timeoutMs);
    Promise.resolve()
      .then(task)
      .then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        }
      );
  });
}

function parseStrictDatePart(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
    return { status: 'invalid', source: `${match[1]}-${match[2]}-${match[3]}` };
  }
  return { status: 'parsed', value: probe.toISOString(), precision: 'day', source: `${match[1]}-${match[2]}-${match[3]}` };
}

function parseStrictInstant(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+\-]\d{2}:?\d{2})$/i);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  const millisecond = Number(String(match[7] || '0').padEnd(3, '0'));
  const zone = String(match[8] || '').toUpperCase();
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(-2)) > 59)) return { status: 'invalid', source: String(value || '').trim() };
  const offsetMinutes = zone === 'Z'
    ? 0
    : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
  const localMillis = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const probe = new Date(localMillis - offsetMinutes * 60000);
  const verify = new Date(localMillis);
  if (
    verify.getUTCFullYear() !== year ||
    verify.getUTCMonth() + 1 !== month ||
    verify.getUTCDate() !== day ||
    verify.getUTCHours() !== hour ||
    verify.getUTCMinutes() !== minute ||
    verify.getUTCSeconds() !== second ||
    verify.getUTCMilliseconds() !== millisecond
  ) {
    return { status: 'invalid', source: String(value || '').trim() };
  }
  return { status: 'parsed', value: probe.toISOString(), precision: 'instant', source: String(value || '').trim() };
}

async function resolvePublicAddresses(hostname, lookup) {
  let records;
  try {
    if (lookup.length >= 3) {
      records = await new Promise((resolve, reject) =>
        lookup(hostname, { all: true, verbatim: true }, (error, value) => error ? reject(error) : resolve(value))
      );
    } else {
      records = await lookup(hostname, { all: true, verbatim: true });
    }
  } catch (_) {
    throw new SourceError('SOURCE_DNS_FAILED', 'Source hostname could not be resolved');
  }

  const list = (Array.isArray(records) ? records : [records]).map((item) => {
    if (!item || !item.address) return null;
    return {
      address: String(item.address),
      family: Number(item.family) || net.isIP(item.address)
    };
  }).filter(Boolean);

  if (!list.length) {
    throw new SourceError('SOURCE_DNS_FAILED', 'Source hostname has no address');
  }
  if (list.some(item => isPrivateAddress(item.address))) {
    throw new SourceError('SOURCE_DNS_PRIVATE', 'Source hostname resolved to a non-public address');
  }

  const ipv4 = list.find(item => item.family === 4);
  if (!ipv4) {
    throw new SourceError('SOURCE_DNS_UNSUPPORTED', 'IPv6 source addresses are not supported');
  }

  return { address: ipv4.address, family: ipv4.family, all: list };
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseDate(raw) {
  const value = normalizeWhitespace(raw);
  if (!value) return null;

  const dateOnly = parseStrictDatePart(value);
  if (dateOnly) return dateOnly;

  const instant = parseStrictInstant(value);
  if (instant) return instant;

  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
    return {
      status: 'unknown',
      value: null,
      precision: 'unknown',
      source: value
    };
  }

  return null;
}

function parsePublished(raw) {
  const supportedNames = new Set(['article:published_time', 'datepublished', 'pubdate', 'publish_date', 'publishedat']);
  const metaTags = String(raw || '').match(/<meta\b[^>]*>/gi) || [];

  for (const tag of metaTags) {
    const attributes = {};
    for (const match of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key = String(match[1] || '').toLowerCase();
      const value = decodeEntities(match[2] != null ? match[2] : match[3]);
      attributes[key] = value;
    }
    const key = String(attributes.property || attributes.name || attributes.itemprop || '').toLowerCase();
    if (!supportedNames.has(key)) continue;
    const parsed = parseDate(attributes.content);
    if (!parsed) {
      return { publishedAt: null, publishedTimePrecision: 'unknown', publishedAtSource: normalizeWhitespace(attributes.content), errorCode: 'SOURCE_PUBLISHED_DATE_INVALID' };
    }
    if (parsed.status === 'invalid') {
      return { publishedAt: null, publishedTimePrecision: 'unknown', publishedAtSource: parsed.source, errorCode: 'SOURCE_PUBLISHED_DATE_INVALID' };
    }
    return {
      publishedAt: parsed.status === 'unknown' ? null : parsed.value,
      publishedTimePrecision: parsed.precision,
      publishedAtSource: parsed.source,
      errorCode: parsed.status === 'unknown' ? null : null
    };
  }

  return {
    publishedAt: null,
    publishedTimePrecision: 'unknown',
    publishedAtSource: null,
    errorCode: 'SOURCE_DATE_UNKNOWN'
  };
}

function extractDocument(html) {
  const raw = String(html || '');
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const parsedMeta = parsePublished(raw);
  const withoutNoise = raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');
  const text = decodeEntities(withoutNoise.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (!text) {
    throw new SourceError('SOURCE_EMPTY', 'Source document contains no extractable text');
  }

  return {
    title: titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim()).slice(0, 300) : null,
    publishedAt: parsedMeta.publishedAt,
    publishedTimePrecision: parsedMeta.publishedTimePrecision,
    publishedAtSource: parsedMeta.publishedAtSource,
    extractorVersion: EXTRACTOR_VERSION,
    errorCode: parsedMeta.errorCode,
    text,
    snippet: text.slice(0, 500),
    locator: titleMatch
      ? `title: ${titleMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 200)}`
      : `text:0-${Math.min(text.length, 500)}`
  };
}

function nativeRequest(url, address, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS;
    const signal = options.signal;
    let settled = false;
    let timer;
    let req;
    const chunks = [];
    let length = 0;

    const cleanup = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal && signal.removeEventListener) {
        signal.removeEventListener('abort', onAbort);
      }
      if (error) reject(error instanceof SourceError ? error : new SourceError('SOURCE_NETWORK_FAILED', error.message || String(error)));
    };

    const onAbort = () => {
      const error = signal.reason instanceof Error ? signal.reason : new SourceError('SOURCE_TIMEOUT', 'Source request was cancelled');
      if (req) req.destroy(error);
      cleanup(error);
    };

    const onFailure = (error) => {
      if (req && !req.destroyed) req.destroy();
      cleanup(error);
    };

    req = https.request({
      protocol: 'https:',
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      servername: parsed.hostname,
      method: 'GET',
      rejectUnauthorized: true,
      headers: {
        Accept: 'text/html, text/plain;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': 'WebStock-IndustryResearch/1.0'
      },
      lookup: (_host, opts, callback) => {
        if (opts && opts.all) {
          callback(null, [{ address: address.address, family: address.family }]);
          return;
        }
        callback(null, address.address, address.family);
      }
    }, response => {
      response.on('data', chunk => {
        if (settled) return;
        length += chunk.length;
        if (length > MAX_BYTES) {
          onFailure(new SourceError('SOURCE_TOO_LARGE', 'Source response exceeds size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        cleanup();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
          finalUrl: url
        });
      });
      response.on('error', onFailure);
    });

    timer = setTimeout(() => onFailure(new SourceError('SOURCE_TIMEOUT', 'Source request timed out')), timeoutMs);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    req.on('error', onFailure);
    req.end();
  });
}

function createIndustryResearchSourceService(options = {}) {
  const lookup = options.lookup || dns.lookup.bind(dns);
  const request = options.request || options.transport || nativeRequest;
  const now = options.now || (() => new Date().toISOString());

  async function fetch(url, state = {}) {
    const requestedUrl = String(state.requestedUrl || url);
    const canonicalUrl = canonicalizeUrl(url);
  const deadline = Number.isFinite(state.roundDeadline)
      ? Math.max(Date.now(), Number(state.roundDeadline))
      : Date.now() + ROUND_TIMEOUT_MS;
    if (Date.now() >= deadline) {
      throw new SourceError('SOURCE_ROUND_TIMEOUT', 'Research round timed out');
    }

    const hostname = new URL(canonicalUrl).hostname;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new SourceError('SOURCE_ROUND_TIMEOUT', 'Research round timed out');
    }
    const address = await withTimeout(
      () => resolvePublicAddresses(hostname, lookup),
      Math.min(REQUEST_TIMEOUT_MS, remainingMs),
      'SOURCE_DNS_TIMEOUT',
      'Source DNS lookup timed out'
    );

    const requestAbort = new AbortController();
    const requestRemainingMs = deadline - Date.now();
    if (requestRemainingMs <= 0) {
      throw new SourceError('SOURCE_ROUND_TIMEOUT', 'Research round timed out');
    }
    const requestTimeoutMs = Math.min(REQUEST_TIMEOUT_MS, requestRemainingMs);
    const roundTimeoutMs = Math.max(1, requestRemainingMs);
    const requestDeadline = setTimeout(() => requestAbort.abort(new SourceError('SOURCE_TIMEOUT', 'Source request timed out')), requestTimeoutMs);
    const roundDeadlineTimer = setTimeout(() => requestAbort.abort(new SourceError('SOURCE_ROUND_TIMEOUT', 'Research round timed out')), roundTimeoutMs);
    const release = () => {
      clearTimeout(requestDeadline);
      clearTimeout(roundDeadlineTimer);
    };

    try {
      const response = await request(canonicalUrl, address, { timeoutMs: requestTimeoutMs, signal: requestAbort.signal });

      const statusCode = Number(response && response.statusCode);
      if (statusCode >= 300 && statusCode < 400 && response.headers && response.headers.location) {
        if ((state.redirects || 0) >= MAX_REDIRECTS) {
          throw new SourceError('SOURCE_REDIRECT_LIMIT', 'Too many source redirects');
        }
        const next = new URL(response.headers.location, canonicalUrl);
        if (next.protocol !== 'https:') {
          throw new SourceError('SOURCE_REDIRECT_UNSAFE', 'Redirect must remain HTTPS');
        }
        return fetch(next.toString(), {
          requestedUrl,
          redirects: (state.redirects || 0) + 1,
          roundDeadline: deadline
        });
      }

      if (statusCode < 200 || statusCode >= 300) {
        throw new SourceError('SOURCE_HTTP_' + (statusCode || 'ERROR'), 'Source returned an unsuccessful HTTP status');
      }

      const headers = response.headers || {};
      const type = String(headers['content-type'] || '').toLowerCase();
      const encoding = String(headers['content-encoding'] || '').toLowerCase();
      if (encoding && encoding !== 'identity') {
        throw new SourceError('SOURCE_ENCODING_UNSUPPORTED', 'Compressed source responses are not supported');
      }
      const mime = type.split(';', 1)[0].trim();
      if (!mime || !new Set(['text/html', 'text/plain']).has(mime)) {
        throw new SourceError('SOURCE_CONTENT_TYPE_UNSUPPORTED', 'Only HTML and plaintext sources are supported');
      }
      const charsetMatch = type.match(/charset\s*=\s*["']?([^;\"'\s]+)/i);
      if (charsetMatch && !['utf-8', 'utf8', 'us-ascii'].includes(charsetMatch[1].toLowerCase())) {
        throw new SourceError('SOURCE_CHARSET_UNSUPPORTED', 'Only UTF-8 source responses are supported');
      }

      const body = Buffer.isBuffer(response.body)
        ? response.body
        : Buffer.from(String(response.body || ''), 'utf8');
      if (body.length > MAX_BYTES) throw new SourceError('SOURCE_TOO_LARGE', 'Source response exceeds size limit');

      const document = extractDocument(body.toString('utf8'));

      return {
        status: 'fetched',
        requestedUrl,
        finalUrl: response.finalUrl || canonicalUrl,
        canonicalUrl: canonicalizeUrl(response.finalUrl || canonicalUrl),
        title: document.title,
        publisher: new URL(response.finalUrl || canonicalUrl).hostname,
        publishedAt: document.publishedAt,
        publishedTimePrecision: document.publishedTimePrecision,
        publishedAtSource: document.publishedAtSource,
        extractorVersion: EXTRACTOR_VERSION,
        errorCode: document.errorCode || null,
        fetchedAt: now(),
        contentSha256: crypto.createHash('sha256').update(document.text).digest('hex'),
        snippet: document.snippet,
        locator: document.locator,
        text: document.text,
        metrics: []
      };
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (error && error.name === 'AbortError') {
        throw new SourceError('SOURCE_TIMEOUT', 'Source request timed out');
      }
      throw new SourceError('SOURCE_NETWORK_FAILED', error.message || 'Source request failed');
    } finally {
      release();
      requestAbort.abort(new SourceError('SOURCE_TIMEOUT', 'Source request completed'));
    }
  }

  return {
    fetch,
    fetchSource: fetch,
    canonicalizeUrl,
    resolvePublicAddresses,
    isPrivateAddress
  };
}

module.exports = {
  MAX_BYTES,
  REQUEST_TIMEOUT_MS,
  MAX_REDIRECTS,
  SourceError,
  canonicalizeUrl,
  isPrivateAddress,
  resolvePublicAddresses,
  extractDocument,
  createIndustryResearchSourceService,
  nativeRequest
};
