const db = require('../db');

const SECTOR_TERMS = [
  '半导体', '先进封装', '科创芯片', 'CPO', '光模块', '算力', '人工智能', 'AI',
  '商业航天', '低空经济', '机器人', '工业母机', '新能源', '储能', '光伏', '锂电池',
  '创新药', '医疗器械', '消费电子', '通信设备', '军工', '稀土', '有色金属',
  '银行', '证券', '保险', '房地产', '农业', '电力', '煤炭'
];
const SECTOR_ALIASES = [
  ['有色', '有色金属'], ['芯片', '半导体'], ['光模块', 'CPO'], ['航天', '商业航天'],
  ['算力', '算力'], ['创新药', '创新药'], ['机器人', '机器人']
];
const BULLISH_TERMS = ['看好', '机会', '受益', '景气', '向上', '增长', '突破', '主升', '强势', '有望'];
const BEARISH_TERMS = ['看空', '回避', '下行', '走弱', '恶化', '下跌', '见顶', '减仓'];
const CONDITIONAL_TERMS = ['如果', '若', '前提', '取决于', '但', '需要', '等待', '确认', '兑现'];
const RISK_TERMS = ['风险', '警惕', '不及预期', '不要追高', '回撤', '估值过高', '减值', '利空'];

let cachedCatalog = null;

function cleanText(value, maxLength = 200000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(item => cleanText(item, 100)).filter(Boolean);
  const raw = cleanText(value, 5000);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(item => cleanText(item, 100)).filter(Boolean);
  } catch (error) {}
  return raw.split(/[,，;；|/]/).map(item => item.trim()).filter(Boolean);
}

function loadCatalog() {
  if (cachedCatalog) return cachedCatalog;
  cachedCatalog = db.prepare(`SELECT code, name, industry, boards_text, tags_text
    FROM stock_search_index WHERE code <> '' AND name <> ''`).all().map(function(row) {
    return {
      code: String(row.code),
      name: cleanText(row.name, 40),
      industry: cleanText(row.industry, 100),
      boards: parseList(row.boards_text).concat(parseList(row.tags_text))
    };
  });
  return cachedCatalog;
}

function unique(values, limit = 100) {
  return values.filter(Boolean).filter(function(value, index, items) {
    return items.indexOf(value) === index;
  }).slice(0, limit);
}

function includesAny(text, terms) {
  return terms.some(term => text.includes(term));
}

function sentences(text) {
  return unique(String(text || '').split(/[。！？!?；;\n]/).map(value => cleanText(value, 500))
    .filter(value => value.length >= 4), 30);
}

function detectHorizon(text) {
  if (/(长期|长线|未来几年|产业周期)/.test(text)) return 'long';
  if (/(中期|中线|未来几个月|季度)/.test(text)) return 'medium';
  if (/(短期|短线|近日|本周|几天|明天)/.test(text)) return 'short';
  return 'unspecified';
}

function detectStance(text) {
  const bullish = includesAny(text, BULLISH_TERMS);
  const bearish = includesAny(text, BEARISH_TERMS);
  const conditional = includesAny(text, CONDITIONAL_TERMS) || includesAny(text, RISK_TERMS);
  if ((bullish || bearish) && conditional) return 'conditional';
  if (bullish && !bearish) return 'bullish';
  if (bearish && !bullish) return 'bearish';
  if (bullish && bearish) return 'neutral';
  return 'unknown';
}

function analyzeInvestmentText(input = {}, options = {}) {
  const title = cleanText(input.title, 2000);
  const description = cleanText(input.description, 20000);
  const transcript = cleanText(input.transcript || input.content, 200000);
  const summary = cleanText(input.summary, 20000);
  const text = [title, description, transcript, summary].filter(Boolean).join('。');
  const catalog = Array.isArray(options.catalog) ? options.catalog : loadCatalog();
  const directCodes = text.match(/(?<!\d)[0368]\d{5}(?!\d)/g) || [];
  const stockMentions = [];
  catalog.forEach(function(item) {
    const code = String(item.code || '');
    const name = cleanText(item.name, 40).replace(/^\*?ST/i, '');
    if (!/^\d{6}$/.test(code) || name.length < 3) return;
    if (directCodes.includes(code) || text.includes(name)) stockMentions.push({ code, name });
  });
  directCodes.forEach(function(code) {
    if (!stockMentions.some(item => item.code === code)) stockMentions.push({ code, name: '' });
  });
  const stockCodes = unique(stockMentions.map(item => item.code));
  const matchedCatalog = catalog.filter(item => stockCodes.includes(String(item.code || '')));
  const sectors = [];
  matchedCatalog.forEach(function(item) {
    if (item.industry) sectors.push(cleanText(item.industry, 100));
    sectors.push.apply(sectors, parseList(item.boards));
  });
  SECTOR_TERMS.forEach(function(term) { if (text.includes(term)) sectors.push(term); });
  SECTOR_ALIASES.forEach(function(item) { if (text.includes(item[0])) sectors.push(item[1]); });
  const allSentences = sentences(text);
  const keyPoints = allSentences.filter(sentence =>
    includesAny(sentence, BULLISH_TERMS.concat(BEARISH_TERMS, CONDITIONAL_TERMS, RISK_TERMS)) ||
    stockMentions.some(item => item.name && sentence.includes(item.name)) ||
    SECTOR_TERMS.some(term => sentence.includes(term))
  ).slice(0, 8);
  const riskFlags = allSentences.filter(sentence => includesAny(sentence, RISK_TERMS)).slice(0, 6);
  const detectedSectors = unique(sectors, 30);
  return {
    analysisMethod: 'rule-v2',
    stockCodes,
    stockMentions: stockMentions.slice(0, 30),
    sectors: detectedSectors,
    topics: unique(detectedSectors.concat(parseList(input.hashtags)), 30),
    stance: detectStance(text),
    horizon: detectHorizon(text),
    keyPoints,
    riskFlags,
    sourceCompleteness: {
      hasDescription: Boolean(description),
      hasTranscript: Boolean(transcript),
      hasSummary: Boolean(summary)
    }
  };
}

module.exports = { analyzeInvestmentText };
