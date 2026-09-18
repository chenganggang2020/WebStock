const iconv = require('iconv-lite');
const marketData = require('./marketDataService');

const INDEX_DEFINITIONS = [
  { key: 'sse', code: '000001', symbol: 's_sh000001', name: '上证指数' },
  { key: 'szse', code: '399001', symbol: 's_sz399001', name: '深证成指' },
  { key: 'chinext', code: '399006', symbol: 's_sz399006', name: '创业板指' },
  { key: 'star50', code: '000688', symbol: 's_sh000688', name: '科创50' },
  { key: 'csi300', code: '000300', symbol: 's_sh000300', name: '沪深300' },
  { key: 'csi500', code: '000905', symbol: 's_sh000905', name: '中证500' },
  { key: 'csi1000', code: '000852', symbol: 's_sh000852', name: '中证1000' },
  { key: 'sse50', code: '000016', symbol: 's_sh000016', name: '上证50' }
];

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseSinaIndexQuotes(raw, definitions = INDEX_DEFINITIONS) {
  const bySymbol = new Map((definitions || []).map(item => [item.symbol, item]));
  const rows = [];
  String(raw || '').split(/\r?\n/).forEach(function(line) {
    const match = line.match(/hq_str_(s_(?:sh|sz)\d+)="([^"]*)"/i);
    if (!match || !bySymbol.has(match[1])) return;
    const definition = bySymbol.get(match[1]);
    const fields = match[2].split(',');
    const price = finiteNumber(fields[1]);
    if (price === null || price <= 0) return;
    const amountWan = finiteNumber(fields[5]);
    rows.push({
      key: definition.key,
      code: definition.code,
      symbol: definition.symbol.replace(/^s_/, ''),
      name: fields[0] || definition.name,
      price,
      changeAmount: finiteNumber(fields[2]),
      changePct: finiteNumber(fields[3]),
      volume: finiteNumber(fields[4]),
      amount: amountWan === null ? null : amountWan * 10000
    });
  });
  return rows.sort(function(a, b) {
    return definitions.findIndex(item => item.key === a.key) - definitions.findIndex(item => item.key === b.key);
  });
}

function buildTurnoverSummary(indices) {
  const lookup = new Map((indices || []).map(item => [item.key, item]));
  const shanghai = finiteNumber(lookup.get('sse') && lookup.get('sse').amount);
  const shenzhen = finiteNumber(lookup.get('szse') && lookup.get('szse').amount);
  return {
    shanghai,
    shenzhen,
    total: shanghai === null || shenzhen === null ? null : shanghai + shenzhen
  };
}

async function fetchIndexOverview() {
  const symbols = INDEX_DEFINITIONS.map(item => item.symbol).join(',');
  const response = await marketData.get(
    'market-overview-indices:' + symbols,
    'https://hq.sinajs.cn/list=' + symbols,
    {
      headers: { Referer: 'https://finance.sina.com.cn' },
      responseType: 'arraybuffer'
    }
  );
  const raw = iconv.decode(Buffer.from(response.data), 'gbk');
  const indices = parseSinaIndexQuotes(raw);
  if (!indices.length) throw new Error('公开指数行情暂不可用');
  return {
    indices,
    turnover: buildTurnoverSummary(indices),
    fetchedAt: new Date().toISOString(),
    source: {
      id: 'sina-public-index',
      label: '新浪公开指数行情',
      note: '指数成交额按公开简版行情字段换算；抓取时间不等于交易所逐笔时间。'
    }
  };
}

module.exports = {
  INDEX_DEFINITIONS,
  parseSinaIndexQuotes,
  buildTurnoverSummary,
  fetchIndexOverview
};
