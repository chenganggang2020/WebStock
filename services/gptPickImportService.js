const db = require('../db');
const researchRuns = require('./researchRunService');

const RUN_TYPE = 'manual-chatgpt-stock-picks';
const MODEL_ID = 'chatgpt-manual';
const SOURCE = 'manual-chatgpt';
const MAX_CANDIDATES = 20;
const MAX_INPUT_LENGTH = 250000;
const CODE_PATTERN = /(?<!\d)(\d{6})(?!\d)/g;
const A_SHARE_CODE_PATTERN = /^(?:(?:000|001|002|003|300|301|302|600|601|603|605|688|689|920)\d{3})$/;

function cleanText(value, maxLength = 4000) {
  const source = Array.isArray(value) ? value.join('；') : String(value == null ? '' : value);
  return source
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function getOriginalText(content) {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') return JSON.stringify(content, null, 2);
  throw new Error('请粘贴 ChatGPT 返回的文本、Markdown 或 JSON');
}

function normalizeCode(value) {
  const match = String(value == null ? '' : value).match(/(?<!\d)(\d{6})(?!\d)/);
  return match && A_SHARE_CODE_PATTERN.test(match[1]) ? match[1] : '';
}

function readFirst(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return '';
}

function normalizeCandidate(input = {}) {
  return {
    code: normalizeCode(readFirst(input, ['code', 'stockCode', 'stock_code', 'symbol', 'ticker'])),
    name: cleanText(readFirst(input, ['name', 'stockName', 'stock_name', 'company']), 80),
    reason: cleanText(readFirst(input, ['reason', 'rationale', 'logic', 'thesis', 'recommendationReason']), 2000),
    risk: cleanText(readFirst(input, ['risk', 'risks', 'riskFactors', 'risk_factors']), 2000),
    originalAnalysis: cleanText(readFirst(input, ['originalAnalysis', 'analysis', 'explanation', 'commentary', 'originalText']), 8000)
  };
}

function findJsonCandidates(content) {
  if (Array.isArray(content)) return content;
  if (!content || typeof content !== 'object') return [];
  const value = readFirst(content, ['candidates', 'picks', 'stocks', 'items', 'selections']);
  return Array.isArray(value) ? value : [];
}

function parseMarkdownTable(lines) {
  const candidates = [];
  const tableLines = new Set();
  let headers = null;

  lines.forEach(function(line, index) {
    if (!line.includes('|')) return;
    const cells = line.split('|').map(cell => cell.trim()).filter((cell, cellIndex, all) => {
      return cell || (cellIndex > 0 && cellIndex < all.length - 1);
    });
    if (!cells.length) return;
    tableLines.add(index);
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) return;

    const codeIndex = cells.findIndex(cell => /^(代码|股票代码|code|symbol)$/i.test(cleanText(cell, 40)));
    if (codeIndex >= 0) {
      headers = cells.map(cell => cleanText(cell, 40).toLowerCase());
      return;
    }

    const fallbackCodeIndex = cells.findIndex(cell => Boolean(normalizeCode(cleanText(cell, 100))));
    if (fallbackCodeIndex < 0) return;
    const indexFor = function(names, fallback) {
      if (!headers) return fallback;
      const found = headers.findIndex(header => names.includes(header));
      return found >= 0 ? found : fallback;
    };
    const candidate = normalizeCandidate({
      code: cells[fallbackCodeIndex],
      name: cells[indexFor(['名称', '股票名称', 'name'], fallbackCodeIndex + 1)],
      reason: cells[indexFor(['理由', '入选理由', '逻辑', '看点', 'reason', 'rationale'], fallbackCodeIndex + 2)],
      risk: cells[indexFor(['风险', '主要风险', 'risk', 'risks'], fallbackCodeIndex + 3)],
      originalAnalysis: cells[indexFor(['原分析', '分析', '点评', 'analysis', 'explanation'], fallbackCodeIndex + 4)]
    });
    if (candidate.code) candidates.push(candidate);
  });

  return { candidates, tableLines };
}

function readInlineFields(value) {
  const fields = {};
  const pattern = /(理由|入选理由|逻辑|看点|风险|主要风险|分析|原分析|点评)\s*[:：]\s*(.*?)(?=\s*(?:理由|入选理由|逻辑|看点|风险|主要风险|分析|原分析|点评)\s*[:：]|$)/gi;
  for (const match of String(value || '').matchAll(pattern)) {
    const label = match[1];
    const text = match[2];
    if (/风险/.test(label)) fields.risk = text;
    else if (/分析|点评/.test(label)) fields.originalAnalysis = text;
    else fields.reason = text;
  }
  return fields;
}

function readNameAroundCode(line, match, tail) {
  const tailBeforeFields = tail.split(/(?:理由|入选理由|逻辑|看点|风险|主要风险|分析|原分析|点评)\s*[:：]/i)[0]
    .replace(/^[\s|,，;；:：()（）\[\]【】._\-—]+/, '')
    .replace(/[\s|,，;；:：()（）\[\]【】._\-—]+$/, '')
    .trim();
  if (tailBeforeFields) return tailBeforeFields;

  const prefix = line.slice(0, match.index)
    .replace(/[\s（(【\[]+$/, '')
    .replace(/^\s*(?:[-*]\s*)?(?:\d+[.、)）]\s*)?/, '');
  return (prefix.split(/[|,，;；:：\-—]/).pop() || '')
    .replace(/^(?:股票|候选|标的)\s*/, '')
    .trim();
}

function parsePlainText(lines, tableLines) {
  const candidates = [];
  let current = null;

  function finishCurrent() {
    if (current && current.code) candidates.push(normalizeCandidate(current));
    current = null;
  }

  lines.forEach(function(rawLine, index) {
    if (tableLines.has(index)) return;
    const line = cleanText(rawLine, 12000);
    if (!line) return;
    const matches = Array.from(line.matchAll(CODE_PATTERN));
    if (matches.length) {
      finishCurrent();
      matches.forEach(function(match, matchIndex) {
        const next = matches[matchIndex + 1];
        const tail = line.slice(match.index + match[0].length, next ? next.index : undefined);
        const candidate = Object.assign({
          code: match[1],
          name: readNameAroundCode(line, match, tail)
        }, readInlineFields(tail));
        if (matchIndex < matches.length - 1) candidates.push(normalizeCandidate(candidate));
        else current = candidate;
      });
      return;
    }
    if (!current) return;
    const fieldMatch = line.match(/^(?:[-*]\s*)?(理由|入选理由|逻辑|看点|风险|主要风险|分析|原分析|点评)\s*[:：]\s*(.*)$/i);
    if (!fieldMatch) return;
    const label = fieldMatch[1];
    const value = fieldMatch[2];
    if (/风险/.test(label)) current.risk = value;
    else if (/分析|点评/.test(label)) current.originalAnalysis = value;
    else current.reason = value;
  });
  finishCurrent();
  return candidates;
}

function findOverallAnalysis(content, originalText) {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return cleanText(readFirst(content, ['overallAnalysis', 'overall_analysis', 'analysis', 'summary', 'report']), 20000);
  }
  const match = String(originalText || '').match(/(?:^|\n)(?:#{1,4}\s*)?(?:总体分析|整体分析|综合判断|总结)\s*[:：]?\s*([^\n]+(?:\n(?!\s*(?:#{1,4}|\d+[.、]|(?:0|3|4|6|8|9)\d{5})).*)*)/i);
  return match ? cleanText(match[1], 20000) : '';
}

function finalizeCandidates(rawCandidates) {
  const unique = [];
  const byCode = new Map();
  let duplicateCount = 0;
  rawCandidates.forEach(function(rawCandidate) {
    const candidate = normalizeCandidate(rawCandidate);
    if (!candidate.code) return;
    if (byCode.has(candidate.code)) {
      duplicateCount += 1;
      const existing = byCode.get(candidate.code);
      ['name', 'reason', 'risk', 'originalAnalysis'].forEach(function(field) {
        if (!existing[field] && candidate[field]) existing[field] = candidate[field];
      });
      return;
    }
    byCode.set(candidate.code, candidate);
    unique.push(candidate);
  });
  return {
    candidates: unique.slice(0, MAX_CANDIDATES),
    duplicateCount,
    truncated: unique.length > MAX_CANDIDATES
  };
}

function buildWarnings(candidates, truncated) {
  const warnings = [];
  candidates.forEach(function(candidate) {
    if (!candidate.name) warnings.push(candidate.code + ' 缺少股票名称');
    if (!candidate.reason) warnings.push(candidate.code + ' 缺少入选理由');
    if (!candidate.risk) warnings.push(candidate.code + ' 缺少风险说明');
    if (!candidate.originalAnalysis) warnings.push(candidate.code + ' 缺少逐股原分析');
  });
  if (truncated) warnings.push('候选超过 20 只，仅保留前 20 只');
  return warnings;
}

function parseManualPickContent(content, options = {}) {
  const originalText = getOriginalText(content);
  if (!originalText.trim()) throw new Error('请粘贴 ChatGPT 返回的选股内容');
  if (originalText.length > MAX_INPUT_LENGTH) throw new Error('粘贴内容过长，请控制在 250000 个字符以内');

  let structuredContent = content;
  const trimmed = originalText.trim();
  if (typeof content === 'string' && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      structuredContent = JSON.parse(trimmed);
    } catch (error) {
      throw new Error('JSON 格式无效，请检查括号、引号和逗号后重新粘贴');
    }
  }
  const isJson = structuredContent && typeof structuredContent === 'object';
  let rawCandidates;
  if (isJson) {
    rawCandidates = findJsonCandidates(structuredContent);
  } else {
    const lines = originalText.split(/\r?\n/);
    const markdown = parseMarkdownTable(lines);
    rawCandidates = markdown.candidates.concat(parsePlainText(lines, markdown.tableLines));
  }
  const finalized = finalizeCandidates(rawCandidates);
  if (!finalized.candidates.length) {
    throw new Error('没有识别到有效的 A股 6位代码，请按“代码、名称、理由、风险、分析”重新粘贴');
  }
  const analysis = cleanText(options.analysis, 20000) || findOverallAnalysis(structuredContent, originalText);
  return {
    candidates: finalized.candidates,
    analysis,
    originalText,
    format: isJson ? 'json' : (originalText.includes('|') ? 'markdown' : 'text'),
    duplicateCount: finalized.duplicateCount,
    truncated: finalized.truncated,
    warnings: buildWarnings(finalized.candidates, finalized.truncated),
    security: { trustedHtml: false, executable: false }
  };
}

function runToItem(run) {
  if (!run) return null;
  const request = run.request || {};
  if (run.runType !== RUN_TYPE || run.modelId !== MODEL_ID || request.source !== SOURCE) return null;
  const candidates = Array.isArray(request.candidates)
    ? finalizeCandidates(request.candidates).candidates.slice(0, MAX_CANDIDATES)
    : [];
  return {
    id: run.id,
    source: SOURCE,
    importedAt: request.importedAt || run.createdAt,
    title: run.title || '',
    runType: run.runType,
    modelId: run.modelId,
    candidateCount: candidates.length,
    candidates,
    analysis: cleanText(request.analysis, 20000),
    originalText: typeof request.originalText === 'string' ? request.originalText : (run.result || ''),
    format: request.format || 'text',
    duplicateCount: Number(request.duplicateCount) || 0,
    truncated: Boolean(request.truncated),
    warnings: Array.isArray(request.warnings) ? request.warnings.map(item => cleanText(item, 500)) : [],
    security: { trustedHtml: false, executable: false },
    automaticTrading: false
  };
}

function importManualPicks(input = {}) {
  const content = input.content !== undefined ? input.content : input.text;
  const parsed = parseManualPickContent(content, { analysis: input.analysis });
  const importedAt = new Date().toISOString();
  const title = cleanText(input.title, 200) || ('ChatGPT 手动选股 ' + importedAt.slice(0, 10));
  const run = researchRuns.createRun({
    runType: RUN_TYPE,
    modelId: MODEL_ID,
    status: 'completed',
    title,
    result: parsed.originalText,
    evidence: [],
    request: {
      source: SOURCE,
      importedAt,
      candidates: parsed.candidates,
      analysis: parsed.analysis,
      originalText: parsed.originalText,
      format: parsed.format,
      duplicateCount: parsed.duplicateCount,
      truncated: parsed.truncated,
      warnings: parsed.warnings,
      security: parsed.security,
      automaticTrading: false
    },
    metrics: { candidateCount: parsed.candidates.length, duplicateCount: parsed.duplicateCount },
    createdAt: importedAt
  });
  return runToItem(run);
}

function listManualPickImports(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const items = researchRuns.listRuns({ runType: RUN_TYPE, modelId: MODEL_ID, limit: Math.min(limit * 3, 500) })
    .map(runToItem)
    .filter(Boolean)
    .slice(0, limit);
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM ai_research_runs
    WHERE run_type = ? AND model_id = ? AND json_extract(request_json, '$.source') = ?
  `).get(RUN_TYPE, MODEL_ID, SOURCE);
  return { items, total: Number(row && row.count) || 0 };
}

function getLatestManualPickImport() {
  return listManualPickImports({ limit: 1 }).items[0] || null;
}

function listManualPickCandidateHistory(code, options = {}) {
  const requestedCode = String(code == null ? '' : code).trim();
  const normalizedCode = /^\d{6}$/.test(requestedCode) && A_SHARE_CODE_PATTERN.test(requestedCode) ? requestedCode : '';
  if (!normalizedCode) throw new Error('请输入有效的 A股 6位代码');
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const imports = listManualPickImports({ limit: 100 });
  const matches = [];
  imports.items.forEach(function(item) {
    (item.candidates || []).forEach(function(candidate) {
      if (candidate.code !== normalizedCode) return;
      matches.push({
        importId: item.id,
        importedAt: item.importedAt,
        title: item.title,
        analysis: item.analysis,
        candidate: Object.assign({}, candidate),
        source: SOURCE,
        verifiedByWebStock: false
      });
    });
  });
  return {
    schema: 'webstock.manual-gpt-pick-history/v1',
    code: normalizedCode,
    source: SOURCE,
    items: matches.slice(0, limit),
    totalOccurrences: matches.length,
    scannedImports: imports.items.length,
    historyTruncated: imports.total > imports.items.length,
    totalIsPartial: imports.total > imports.items.length,
    latestAt: matches[0] ? matches[0].importedAt : null,
    automaticTrading: false,
    limitations: [
      '这些内容来自用户手动粘贴的 ChatGPT 对话，内容尚未验证，WebStock 不核定其事实、时效或适用性。',
      '入选理由和风险只作为每日研究记录，不会自动加入持仓、生成订单或改变图形规则。'
    ]
  };
}

module.exports = {
  RUN_TYPE,
  MODEL_ID,
  SOURCE,
  MAX_CANDIDATES,
  parseManualPickContent,
  importManualPicks,
  listManualPickImports,
  getLatestManualPickImport,
  listManualPickCandidateHistory
};
