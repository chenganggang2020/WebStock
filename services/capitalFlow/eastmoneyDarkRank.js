// Experimental read-only adapter for the public GrayMarketRank page, not an official API contract.
const ENDPOINT = 'https://quotederivates.eastmoney.com/datacenter/darktrade';
const PAGE_URL = 'https://emrnweb.eastmoney.com/graymarket/';
function check(ok, message) { if (!ok) throw new Error(message); }

function buildQuery({date, scope = 'stock', page = 1, pageSize = 30} = {}) {
  check(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date, 'Invalid date');
  check(['stock','industry','concept'].includes(scope), 'Invalid scope');
  check(Number.isSafeInteger(page) && page >= 1 && page <= 1000, 'Invalid page');
  check([30,100].includes(pageSize), 'Invalid page size');
  return {version:101, cver:100, date:date.replace(/-/g,''), StartPage:page, NumPerPage:pageSize,
    sortflag:6, desc:1, market:scope === 'stock' ? '' : '90',
    datetype:scope === 'stock' ? '' : scope === 'industry' ? '2' : '3'};
}

function cents(value) {
  if (value === undefined || value === null) return null;
  check(Number.isSafeInteger(value), 'Invalid or imprecise provider amount');
  return (BigInt(value) * 100n).toString();
}

function numeric(value, name) {
  if (value === undefined || value === null) return null;
  check(typeof value === 'number' && Number.isFinite(value), 'Invalid ' + name);
  return value;
}

function normalizeDarkRank(raw, input, receivedAt) {
  const query = buildQuery(input), scope = input.scope || 'stock';
  check(typeof receivedAt === 'string' && Number.isFinite(Date.parse(receivedAt)), 'Invalid receivedAt');
  check(raw && raw.errid === 0, 'Provider rejected dark-rank request');
  check(String(raw[1]) === query.date, 'Provider date does not match requested date');
  check(Array.isArray(raw.data) && raw.data.length <= query.NumPerPage, 'Invalid provider data');
  check(Number.isSafeInteger(raw[2]) && raw[2] >= raw.data.length, 'Invalid provider total');
  const seen = new Set();
  const rows = raw.data.map(row => {
    check(row && typeof row === 'object', 'Invalid provider row');
    const code = row[4], market = row[3], name = row[16];
    check(typeof code === 'string' && (scope === 'stock' ? /^\d{6}$/ : /^BK\d{4}$/).test(code), 'Invalid code');
    check(Number.isSafeInteger(market) && (scope === 'stock' ? market !== 90 : market === 90), 'Invalid market');
    check(typeof name === 'string' && name.trim().length > 0 && name.length <= 120, 'Invalid name');
    const key = market + ':' + code;
    check(!seen.has(key), 'Duplicate provider key'); seen.add(key);
    const darkNetCents = cents(row[6]), visibleNetCents = cents(row[7]), combinedNetCents = cents(row[8]);
    const completeMoney = [darkNetCents,visibleNetCents,combinedNetCents].every(x => x !== null);
    const priceRaw = numeric(row[13], 'price');
    return {code, name, providerMarket:market,
      venue:scope === 'stock' ? ({0:'SZ',1:'SH'}[market] || null) : null,
      darkNetCents, visibleNetCents, combinedNetCents,
      reconciled:completeMoney ? BigInt(darkNetCents) + BigInt(visibleNetCents) === BigInt(combinedNetCents) : null,
      price:scope === 'stock' && priceRaw !== null ? priceRaw / 1000 : null,
      changeRatio:numeric(row[14], 'change ratio'), darkActivityRatio:numeric(row[11], 'dark activity ratio'),
      darkInflowStockRatio:scope === 'stock' ? null : numeric(row[12], 'inflow stock ratio'),
      // Field 5 looks like HHmmss but its semantic clock is not documented. Never invent a quote time.
      sourceTimeRaw:row[5] ?? null, sourceObservedAt:null,
      leaderName:scope === 'stock' ? null : String(row[15] || ''),
      leaderCode:scope === 'stock' ? null : String(row[20] || '')};
  });
  return {version:'webstock.eastmoney-dark-rank/v1', automaticTrading:false,
    source:{id:'eastmoney-darktrade-rank', provider:'Eastmoney', url:PAGE_URL, endpoint:ENDPOINT,
      classification:'provider-model-estimate', documentedPublicApi:false, licenseVerified:false,
      methodologyVersion:null, fieldMapping:'GrayMarketRank web build main.79b98a58; observed 2026-09-17'},
    requestedDate:input.date, tradingDay:input.date, receivedAt, scope,
    coverage:{page:query.StartPage,pageSize:query.NumPerPage,receivedRows:rows.length,
      totalReported:raw[2],complete:query.StartPage === 1 && rows.length === raw[2],
      paginationSnapshotConsistent:false},
    quality:{missingCoreRows:rows.filter(r=>r.reconciled === null).length,
      reconciliationFailures:rows.filter(r=>r.reconciled === false).length,
      freshness:'unknown-source-clock'},
    limitations:['供应商模型估算，不是逐笔成交或已确认机构持仓。',
      '一次仅请求一页；全市场覆盖、历史范围与长期接口稳定性未验证。',
      '抓取时间不是行情时间；不将快照差额解释为逐笔买卖。',
      '板块可能重叠，不应把板块净额相加为全市场净额。'],rows};
}

async function fetchDarkRank(input, options = {}) {
  const params = buildQuery(input);
  const httpClient = options.httpClient || require('axios');
  const response = await httpClient.get(ENDPOINT, {params, timeout:10000, maxRedirects:0,
    maxContentLength:2*1024*1024,
    headers:{Referer:PAGE_URL, rnProjectId:'emrn.GrayMarketRank'}});
  const receivedAt = (options.now ? options.now() : new Date()).toISOString();
  return {...normalizeDarkRank(response.data,input,receivedAt),raw:response.data};
}

module.exports = {ENDPOINT, PAGE_URL, buildQuery, normalizeDarkRank, fetchDarkRank};
