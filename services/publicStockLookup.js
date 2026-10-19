const axios = require('axios');
const iconv = require('iconv-lite');

function parseSuggestions(payload) {
  const text = Buffer.isBuffer(payload) ? iconv.decode(payload, 'gb18030') : String(payload || '');
  const body = text.match(/^\s*var\s+suggestdata\s*=\s*"([^"\r\n]*)"\s*;?\s*$/)?.[1] || '';
  const seen = new Set();
  return body.split(';').flatMap(row => {
    const fields = row.split(','), code = fields[2], name = fields[4];
    let symbol = fields[3] || '';
    // The fund suggestion feed uses of159915/of510300 instead of exchange
    // symbols. Convert only exchange ETF codes, never ordinary OTC funds.
    if (fields[1] === '22' && symbol === 'of' + code && /ETF/i.test(name || '') &&
        /^(159|510|511|512|513|515|516|517|518|519|560|561|562|563|588|589)\d{3}$/.test(code)) {
      symbol = (code.startsWith('1') ? 'sz' : 'sh') + code;
    }
    // Suggestions also include indices with colliding six-digit codes (e.g.
    // sh000001 versus sz000001); this stock picker must not merge them.
    const supported = fields[1] === '11'
      ? /^(sh(?:60|68)\d{4}|sz(?:00|30)\d{4}|bj(?:[48]\d{5}|92\d{4}))$/.test(symbol)
      : fields[1] === '22' && /^(sh5\d{5}|sz1\d{5})$/.test(symbol);
    if (!['11', '22'].includes(fields[1]) || !/^(sh|sz|bj)\d{6}$/.test(symbol) ||
        !supported || symbol.slice(2) !== code || !name || name.length > 80 || seen.has(code)) return [];
    seen.add(code);
    return [{code, name, market:symbol.slice(0,2), type:fields[1] === '22' ? 'fund' : 'stock',
      source:'新浪公开证券检索', matchReason:'公开证券名称/代码匹配', score:100}];
  }).slice(0, 40);
}

function createPublicStockLookup(options = {}) {
  const http = options.http || axios, cache = new Map();
  async function search(query) {
    const keyword = String(query || '').trim().slice(0, 60);
    if (keyword.length < 2) return {stocks:[], status:'not-requested'};
    const previous = cache.get(keyword);
    if (previous && Date.now() - previous.at < 60000) return previous.result;
    let result;
    try {
      const response = await http.get('https://suggest3.sinajs.cn/suggest/type=11,22&key=' + encodeURIComponent(keyword) + '&name=suggestdata',
        {timeout:4000, responseType:'arraybuffer', maxContentLength:100000, headers:{Referer:'https://finance.sina.com.cn', 'User-Agent':'Mozilla/5.0'}});
      const stocks = parseSuggestions(response.data);
      result = {stocks, status:stocks.length ? 'available' : 'empty', source:'新浪公开证券检索'};
    } catch (_) { result = {stocks:[], status:'unavailable', source:'新浪公开证券检索'}; }
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(keyword, {at:Date.now(), result});
    return result;
  }
  return {search};
}
module.exports = {parseSuggestions, createPublicStockLookup, search:createPublicStockLookup().search};
