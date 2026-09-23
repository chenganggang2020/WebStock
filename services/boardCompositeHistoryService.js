const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

const SINA_COUNT_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount';
const SINA_DATA_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';

function defaultResolveDataset() {
  const root = path.resolve(__dirname, '..', 'quant', 'workspace', 'datasets');
  if (!fs.existsSync(root)) return null;
  const candidates = fs.readdirSync(root, { withFileTypes: true }).filter(function(entry) { return entry.isDirectory(); })
    .map(function(entry) {
      const datasetDir = path.join(root, entry.name);
      const manifestPath = path.join(datasetDir, 'manifest.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.adjustmentMode !== 'forward-adjusted' || !fs.existsSync(path.join(datasetDir, 'raw'))) return null;
        return { datasetId: manifest.datasetId || entry.name, datasetDir, asOf: manifest.asOf || null };
      } catch (error) {
        return null;
      }
    }).filter(Boolean).sort(function(left, right) { return String(right.asOf || '').localeCompare(String(left.asOf || '')); });
  return candidates[0] || null;
}

function unwrap(payload) {
  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

async function defaultConstituentLoader(definition) {
  const node = String(definition && definition.providerId || definition && definition.code || '');
  if (!node) throw new Error('板块缺少新浪目录节点');
  const headers = { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0 WebStock' };
  const countResponse = await axios.get(SINA_COUNT_URL, { timeout: 8000, params: { node }, headers });
  const expectedCount = Number(unwrap(countResponse));
  if (!Number.isInteger(expectedCount) || expectedCount <= 0 || expectedCount > 10000) {
    throw new Error('板块成分数量无效');
  }
  const pageSize = 80;
  const codes = [];
  for (let page = 1; page <= Math.ceil(expectedCount / pageSize); page += 1) {
    const response = await axios.get(SINA_DATA_URL, {
      timeout: 8000,
      params: { page, num: pageSize, sort: 'symbol', asc: 1, node, symbol: '', _s_r_a: 'page' },
      headers
    });
    const rows = unwrap(response);
    (Array.isArray(rows) ? rows : []).forEach(function(row) {
      const match = String(row && (row.code || row.symbol) || '').match(/(\d{6})$/);
      if (match) codes.push(match[1]);
    });
  }
  const unique = Array.from(new Set(codes));
  if (unique.length !== expectedCount) {
    throw new Error('板块成分列表不完整：声明 ' + expectedCount + '，实际 ' + unique.length);
  }
  return { expectedCount, codes: unique };
}

function defaultCompositeRunner(input) {
  const venvPython = path.resolve(__dirname, '..', 'quant', '.venv', 'Scripts', 'python.exe');
  const command = fs.existsSync(venvPython) ? venvPython : 'python';
  const script = path.resolve(__dirname, '..', 'quant', 'webstock_quant', 'board_composite.py');
  return new Promise(function(resolve, reject) {
    const child = spawn(command, [script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', function(chunk) { stdout += chunk; });
    child.stderr.on('data', function(chunk) { stderr += chunk; });
    child.on('error', reject);
    child.on('close', function(code) {
      if (code !== 0) return reject(new Error(stderr.trim() || '板块等权估算进程失败'));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(new Error('板块等权估算输出无法解析')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function createBoardCompositeHistoryService(options) {
  options = options || {};
  const resolveDataset = options.resolveDataset || defaultResolveDataset;
  const constituentLoader = options.constituentLoader || defaultConstituentLoader;
  const compositeRunner = options.compositeRunner || defaultCompositeRunner;
  const cache = new Map();

  function isAvailable() {
    return Boolean(resolveDataset());
  }

  async function fetchHistory(definition, rawDays) {
    const dataset = resolveDataset();
    if (!dataset) throw new Error('本地前复权基线数据不可用');
    const cacheKey = dataset.datasetId + '|' + definition.key + '|' + rawDays;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const constituents = await constituentLoader(definition);
    if (!constituents || !Array.isArray(constituents.codes) || constituents.codes.length !== constituents.expectedCount) {
      throw new Error('当前板块成分列表不完整，停止估算');
    }
    const result = await compositeRunner({
      datasetDir: dataset.datasetDir,
      codes: constituents.codes,
      rawDays: Number(rawDays) || 60
    });
    const missing = Math.max(0, Number(result.requestedConstituents) - Number(result.includedConstituents));
    const value = Object.assign({}, result, {
      dataset,
      source: {
        id: 'local-current-constituent-equal-weight',
        label: '本地前复权 · 当前完整成分等权估算',
        note: '使用当前完整成分列表的可用本地前复权收盘收益等权合成。'
      },
      warnings: [
        '这是当前成分等权估算，不是供应商板块指数，也不是同花顺原始指数。',
        '当前成分口径存在幸存者偏差，不能用于证明历史时点真实成分表现。'
      ].concat(missing ? ['本地基线缺少 ' + missing + ' 只当前成分，已按每日覆盖阈值计算。'] : [])
    });
    cache.set(cacheKey, value);
    return value;
  }

  return { isAvailable, fetchHistory };
}

const defaultService = createBoardCompositeHistoryService();

module.exports = {
  createBoardCompositeHistoryService,
  isAvailable: defaultService.isAvailable,
  fetchHistory: defaultService.fetchHistory
};
