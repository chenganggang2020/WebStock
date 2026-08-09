const axios = require('axios');
const iconv = require('iconv-lite');
const { toSinaSymbol } = require('../utils/market');

function normalizeCodes(codes) {
  return Array.from(new Set((codes || []).map(value => String(value || '').replace(/\D/g, ''))
    .filter(Boolean).map(value => value.padStart(6, '0'))
    .filter(value => /^\d{6}$/.test(value)))).slice(0, 200);
}

function parseSinaQuotes(rawData) {
  const quotes = {};
  String(rawData || '').split('\n').filter(Boolean).forEach(line => {
    const match = line.match(/hq_str_(s[hz]\d+)="(.*)"/);
    if (!match) return;
    const code = match[1].replace(/^sh|^sz/, '');
    const fields = match[2].split(',');
    const price = Number(fields[3]);
    const previousClose = Number(fields[2]);
    if (!Number.isFinite(price) || price <= 0) return;
    quotes[code] = {
      code,
      name: fields[0] || code,
      price,
      previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
      tradeDate: fields[30] || '',
      tradeTime: fields[31] || ''
    };
  });
  return quotes;
}

async function fetchSinaQuotes(codes, options = {}) {
  const requestedCodes = normalizeCodes(codes);
  const fetchedAt = new Date().toISOString();
  if (!requestedCodes.length) {
    return { quotes: {}, fetchedAt, source: 'sina-public-quote', sourceMetadata: { requested: 0, received: 0 } };
  }
  const response = await axios.get('https://hq.sinajs.cn/list=' + requestedCodes.map(toSinaSymbol).join(','), {
    headers: { Referer: 'https://finance.sina.com.cn' },
    responseType: 'arraybuffer',
    timeout: Math.min(Math.max(Number(options.timeoutMs) || 6000, 1000), 15000)
  });
  const quotes = parseSinaQuotes(iconv.decode(Buffer.from(response.data), 'gbk'));
  return {
    quotes,
    fetchedAt,
    source: 'sina-public-quote',
    sourceMetadata: {
      endpoint: 'hq.sinajs.cn',
      requested: requestedCodes.length,
      received: Object.keys(quotes).length
    }
  };
}

module.exports = { normalizeCodes, parseSinaQuotes, fetchSinaQuotes };
