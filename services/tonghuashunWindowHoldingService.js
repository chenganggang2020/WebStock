const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const holdingsService = require('./tonghuashunHoldingService');
const { loadSecurityCatalog } = require('./tonghuashunWatchlistService');

const execFileAsync = promisify(execFile);
const CAPTURE_ERRORS = {
  THS_WINDOW_NOT_FOUND: '同花顺交易窗口未打开',
  THS_HOLDING_PAGE_NOT_SELECTED: '请在同花顺交易窗口停留在“资金股票”页面',
  THS_GRID_NOT_FOUND: '同花顺持仓表格不可见',
  THS_GRID_LAYOUT_UNSUPPORTED: '同花顺持仓表格布局无法安全识别',
  THS_OCR_UNAVAILABLE: 'Windows 中文/英文 OCR 组件不可用',
  THS_CAPTURE_FAILED: '同花顺持仓窗口截图失败'
};


function number(value) {
  const cleaned = String(value == null ? '' : value).replace(/[^0-9.\-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  const factor = Math.pow(10, digits);
  return Math.round(Number(value) * factor) / factor;
}

function shanghaiDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value instanceof Date ? value : new Date(value));
}

function normalizeCapturePayload(payload, options = {}) {
  if (!payload || payload.available !== true) throw new Error(payload && payload.error || '同花顺持仓窗口不可用');
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const observedAt = new Date(payload.observedAt);
  if (!Number.isFinite(observedAt.getTime())) throw new Error('同花顺窗口采集时间无效');
  const maxAgeMs = Number(options.maxAgeMs) > 0 ? Number(options.maxAgeMs) : 2 * 60 * 1000;
  if (now.getTime() - observedAt.getTime() > maxAgeMs || shanghaiDate(observedAt) !== shanghaiDate(now)) {
    throw new Error('同花顺窗口持仓不是本交易日的新鲜数据');
  }

  const catalog = options.catalog || loadSecurityCatalog(options.rootDir);
  const seen = new Set();
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (payload.visibleRowsComplete === false) {
    throw new Error('同花顺持仓表可能还有未显示持仓行，已拒绝同步');
  }
  const holdings = rows.map(function(row) {
    const code = String(row && row.code || '').replace(/\D/g, '');
    const quantity = Math.trunc(number(row && row.quantity));
    const avgCost = number(row && row.avgCost);
    const currentPrice = number(row && row.currentPrice);
    if (!/^\d{6}$/.test(code) || !catalog.has(code)) throw new Error('窗口 OCR 证券代码无法验证：' + code);
    if (seen.has(code)) throw new Error('窗口 OCR 证券代码重复：' + code);
    if (!(quantity > 0) || !(avgCost > 0) || !(currentPrice > 0)) throw new Error(code + ' 的数量、成本价或市价无效');
    seen.add(code);
    return {
      code,
      name: catalog.get(code),
      quantity,
      avgCost: round(avgCost, 4),
      currentPrice: round(currentPrice, 3)
    };
  });
  const cashBalance = number(payload.cashBalance);
  const displayedMarketValue = number(payload.displayedMarketValue);
  if (!holdings.length) {
    if (!Array.isArray(payload.rows) || payload.visibleRowsComplete !== true || payload.emptyHoldingsConfirmed !== true) {
      throw new Error('同花顺空仓窗口缺少完整表格及明确空仓证据，不能把未识别到持仓当作清仓');
    }
    const totalAssets = number(payload.displayedTotalAssets);
    const emptySnapshot = { holdings: [], holdingsComplete: true, cashBalance, totalMarketValue: displayedMarketValue, totalAssets };
    require('./portfolioService').validateEmptyHoldingSnapshot(emptySnapshot);
    return Object.assign(emptySnapshot, { observedAt: observedAt.toISOString(), snapshotDate: shanghaiDate(observedAt), summaryMarketValueMismatch: false });
  }
  if (cashBalance === null || cashBalance < 0 || !(displayedMarketValue > 0)) {
    throw new Error('同花顺窗口资金或股票市值无效');
  }
  const totalMarketValue = round(holdings.reduce(function(sum, holding) {
    return sum + holding.quantity * holding.currentPrice;
  }, 0), 2);
  const totalCost = round(holdings.reduce(function(sum, holding) {
    return sum + holding.quantity * holding.avgCost;
  }, 0), 2);
  const tolerance = Math.max(5, displayedMarketValue * 0.005);
  const summaryMarketValueMismatch = Math.abs(totalMarketValue - displayedMarketValue) > tolerance;
  if (summaryMarketValueMismatch) {
    const displayedHoldingPnl = number(payload.displayedHoldingPnl);
    const calculatedPnl = round(totalMarketValue - totalCost, 2);
    const pnlTolerance = Math.max(50, totalCost * 0.001);
    if (displayedHoldingPnl === null || Math.abs(calculatedPnl - displayedHoldingPnl) > pnlTolerance) {
      throw new Error('窗口可见持仓市值合计与同花顺股票市值不一致，可能有未显示行或 OCR 误差');
    }
  }

  return {
    observedAt: observedAt.toISOString(),
    snapshotDate: shanghaiDate(observedAt),
    cashBalance: round(cashBalance, 2),
    totalMarketValue,
    totalAssets: round(totalMarketValue + cashBalance, 2),
    summaryMarketValueMismatch,
    holdings
  };
}

async function runWindowsCapture(options = {}) {
  if (process.platform !== 'win32') {
    return { available: false, ready: false, method: 'windows-ocr', error: '只读窗口采集仅支持 Windows' };
  }
  const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // A full encoded script exceeds Windows' 32767-character command-line limit.
  const script = path.join(__dirname, '..', 'quant', 'tonghuashun_holdings_capture.ps1')
    .replace('app.asar', 'app.asar.unpacked');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-File', script];
  try {
    const execution = options.execFile
      ? await options.execFile(powershell, args)
      : await execFileAsync(powershell, args, {
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8'
      });
    const stdout = String(execution && execution.stdout != null ? execution.stdout : execution || '').trim();
    const jsonLine = stdout.split(/\r?\n/).reverse().find(function(line) { return /^\s*\{/.test(line); });
    if (!jsonLine) throw new Error('THS_CAPTURE_FAILED');
    const payload = JSON.parse(jsonLine);
    if (payload.available !== true) {
      return {
        available: false,
        ready: false,
        method: 'windows-ocr',
        error: CAPTURE_ERRORS[payload.errorCode] || CAPTURE_ERRORS.THS_CAPTURE_FAILED
      };
    }
    return payload;
  } catch (error) {
    const errorCode = Object.keys(CAPTURE_ERRORS).find(function(code) {
      return String(error && (error.message || error)).includes(code);
    });
    return {
      available: false,
      ready: false,
      method: 'windows-ocr',
      error: CAPTURE_ERRORS[errorCode] || CAPTURE_ERRORS.THS_CAPTURE_FAILED
    };
  }
}

function createTonghuashunWindowHoldingService(options = {}) {
  const runCapture = options.runCapture || runWindowsCapture;
  const holdings = options.holdings || holdingsService;
  const catalog = options.catalog || function() { return loadSecurityCatalog(); };

  async function captureAndSync(input = {}) {
    try {
      const captured = await runCapture(input);
      if (!captured || captured.available !== true) return captured || { available: false, error: '同花顺窗口不可用' };
      const normalized = normalizeCapturePayload(captured, {
        now: input.now,
        maxAgeMs: input.maxAgeMs,
        catalog: catalog()
      });
      const payload = {
        snapshotDate: normalized.snapshotDate,
        cashBalance: normalized.cashBalance,
        totalMarketValue: normalized.totalMarketValue,
        totalAssets: normalized.totalAssets,
        holdings: normalized.holdings,
        holdingsComplete: normalized.holdingsComplete === true
      };
      const freshnessBucket = Math.floor(new Date(normalized.observedAt).getTime() / (5 * 60 * 1000));
      const dedupePayload = {
        snapshotDate: normalized.snapshotDate,
        cashBalance: normalized.cashBalance,
        freshnessBucket,
        holdings: normalized.holdings.map(function(holding) {
          return { code: holding.code, quantity: holding.quantity, avgCost: holding.avgCost };
        })
      };
      const dedupeKey = crypto.createHash('sha256').update(JSON.stringify(dedupePayload)).digest('hex');
      const synced = holdings.syncHoldingText(JSON.stringify(payload), {
        snapshotDate: normalized.snapshotDate,
        sourceLabel: '同花顺窗口只读采集',
        dedupeKey
      });
      return {
        available: true,
        ready: true,
        method: 'windows-ocr',
        source: 'tonghuashun-window-ocr',
        observedAt: normalized.observedAt,
        snapshotDate: normalized.snapshotDate,
        holdingCount: normalized.holdings.length,
        holdings: normalized.holdings,
        account: synced.account,
        snapshot: synced.snapshot,
        automaticSource: true,
        unchanged: synced.unchanged
      };
    } catch (error) {
      return { available: false, ready: false, method: 'windows-ocr', error: error.message || String(error) };
    }
  }

  return { captureAndSync };
}

module.exports = {
  runWindowsCapture,
  normalizeCapturePayload,
  createTonghuashunWindowHoldingService,
  getTonghuashunWindowHoldingService: function() { return createTonghuashunWindowHoldingService(); }
};
