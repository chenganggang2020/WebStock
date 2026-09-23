const crypto = require('node:crypto');
const db = require('../db');

const STAGE_DEFINITIONS = {
  materials: { name: '原材料与关键耗材', aliases: ['材料', '原材料', '上游', 'material', 'materials'] },
  equipment: { name: '生产与检测设备', aliases: ['设备', '装备', 'equipment', 'machinery'] },
  components: { name: '核心器件与零部件', aliases: ['零部件', '部件', '器件', '元件', 'component', 'components'] },
  manufacturing: { name: '制造、封装与系统集成', aliases: ['制造', '生产', '代工', '封装', 'manufacturing'] },
  applications: { name: '下游应用与需求侧', aliases: ['应用', '下游', '终端', 'application', 'applications'] }
};

// Templates define how evidence is classified. They deliberately contain no stock codes or names.
const INDUSTRY_CHAIN_TAXONOMY = [
  {
    id: 'semiconductor',
    name: '半导体',
    aliases: ['半导体', '芯片', '集成电路', '晶圆', 'wafer'],
    stages: {
      materials: ['光刻胶', '电子特气', '湿电子化学品', '硅片', '大硅片', '靶材', 'cmp抛光液', '抛光垫', '环氧塑封料', '引线框架'],
      equipment: ['半导体设备', '光刻机', '刻蚀设备', '刻蚀机', '薄膜沉积', '清洗设备', '离子注入', '涂胶显影', '量测设备', '封装设备'],
      components: ['eda', 'ip核', '模拟芯片', '存储芯片', '功率半导体', 'gpu', 'cpu', 'mcu', '芯片设计'],
      manufacturing: ['晶圆代工', '晶圆制造', '封装测试', '先进封装', 'chiplet', 'cowos'],
      applications: ['汽车芯片', 'ai芯片', '消费电子芯片', '数据中心芯片']
    }
  },
  {
    id: 'ai-compute-cpo',
    name: 'AI算力与CPO',
    aliases: ['ai算力', '算力', 'cpo', '光模块', '光通信', '数据中心', 'ai服务器', '智算'],
    stages: {
      materials: ['光纤预制棒', '光纤材料', '磷化铟', '砷化镓', '光芯片材料', '液冷介质', '高速铜缆材料'],
      equipment: ['光模块测试设备', '光器件设备', '液冷设备', '散热设备', '服务器电源设备'],
      components: ['光模块', '光芯片', '光引擎', 'dsp', '交换芯片', '高速连接器', '铜连接', '电源模块'],
      manufacturing: ['ai服务器', '服务器整机', '服务器代工', '机柜', 'odm'],
      applications: ['算力中心', '数据中心', '云计算', '大模型', '智算中心']
    }
  },
  {
    id: 'pcb-advanced-packaging',
    name: 'PCB与先进封装',
    aliases: ['pcb', '印制电路板', '先进封装', '封装基板', 'ic载板', 'hdi', 'fpc'],
    stages: {
      materials: ['覆铜板', '铜箔', '电子布', '玻纤布', '电子树脂', 'pcb油墨', '钻针'],
      equipment: ['pcb设备', '曝光机', '钻孔机', '电镀设备', 'pcb检测设备', '激光直接成像', 'ldi'],
      components: ['印制电路板', 'pcb', 'hdi', 'fpc', 'ic载板', '封装基板'],
      manufacturing: ['pcb制造', '封装测试', '先进封装', 'chiplet', 'cowos'],
      applications: ['服务器主板', '通信设备主板', '汽车电子', '消费电子']
    }
  },
  {
    id: 'robotics',
    name: '机器人',
    aliases: ['机器人', '人形机器人', '具身智能', '工业机器人'],
    stages: {
      materials: ['永磁材料', '稀土永磁', '碳纤维', '机器人铝合金', '工程塑料'],
      equipment: ['机器人本体', '工业机器人', '数控机床', '机器人加工设备'],
      components: ['减速器', '伺服电机', '机器人控制器', '丝杠', '滚柱丝杠', '传感器', '编码器', '谐波减速器', 'rv减速器'],
      manufacturing: ['机器人整机', '机器人制造', '机器人系统集成'],
      applications: ['工业自动化', '物流机器人', '汽车制造机器人', '医疗机器人', '服务机器人']
    }
  },
  {
    id: 'new-energy-battery',
    name: '新能源电池',
    aliases: ['新能源电池', '锂电池', '动力电池', '储能电池', '固态电池', '锂电'],
    stages: {
      materials: ['锂资源', '钴资源', '镍资源', '正极材料', '负极材料', '电池隔膜', '电解液', '六氟磷酸锂', '锂电铜箔', '电池铝箔'],
      equipment: ['锂电设备', '涂布机', '卷绕机', '叠片机', '注液机', '化成分容', '电池设备'],
      components: ['电芯', 'bms', '电池管理系统', '电池结构件', '电池热管理'],
      manufacturing: ['动力电池', '电池包', 'pack', '电池制造'],
      applications: ['新能源汽车', '储能系统', '消费电池', '低空经济电池']
    }
  },
  {
    id: 'power-grid-storage',
    name: '电网设备与新型储能',
    aliases: ['电网设备', '智能电网', '特高压', '新型储能', '电力设备', '虚拟电厂'],
    stages: {
      materials: ['电工钢', '铜材', '绝缘材料', '储能材料', '电力电子材料'],
      equipment: ['变压器', '组合电器', '特高压设备', '配电设备', '储能变流器', '储能温控', '电网检测设备'],
      components: ['igbt', '功率模块', '继电保护', '智能电表', '电网传感器', '电力电容器'],
      manufacturing: ['输变电设备', '配网自动化', '储能系统集成', '电力电子设备'],
      applications: ['新能源消纳', '源网荷储', '虚拟电厂', '数据中心供电', '工商业储能']
    }
  },
  {
    id: 'smart-vehicle',
    name: '智能汽车与自动驾驶',
    aliases: ['智能汽车', '智能驾驶', '自动驾驶', '汽车电子', '车联网'],
    stages: {
      materials: ['汽车铝材', '汽车钢', '碳纤维车身', '车规级材料'],
      equipment: ['汽车制造设备', '一体化压铸设备', '汽车检测设备', '线控底盘测试设备'],
      components: ['激光雷达', '毫米波雷达', '车载摄像头', '域控制器', '车规芯片', '线控底盘', '汽车连接器'],
      manufacturing: ['整车制造', '汽车零部件制造', '智能座舱', '辅助驾驶系统'],
      applications: ['乘用车', '商用车', '无人驾驶', 'Robotaxi', '车路云一体化']
    }
  },
  {
    id: 'innovative-medicine',
    name: '创新药与生物医药',
    aliases: ['创新药', '生物医药', '医药研发', '抗体药', '多肽药', '核药'],
    stages: {
      materials: ['医药中间体', '培养基', '药用辅料', '生物试剂', '合成生物材料'],
      equipment: ['制药设备', '生物反应器', '医药检测设备', '实验室设备', '冻干设备'],
      components: ['原料药', '抗体', '疫苗', '多肽', '小核酸', 'adc', '创新制剂'],
      manufacturing: ['创新药研发', '生物药生产', 'cro', 'cmo', 'cdmo'],
      applications: ['肿瘤治疗', '慢病治疗', '罕见病治疗', '医疗服务', '海外授权']
    }
  },
  {
    id: 'consumer-electronics',
    name: '消费电子与端侧AI',
    aliases: ['消费电子', '端侧ai', 'ai手机', 'ai pc', '智能终端', '可穿戴设备'],
    stages: {
      materials: ['电子玻璃', '盖板玻璃', '散热材料', '磁性材料', '结构件材料'],
      equipment: ['精密加工设备', '自动化组装设备', '显示检测设备', '声学检测设备'],
      components: ['摄像头模组', '声学器件', '显示模组', '触控模组', '连接器', '散热模组', '端侧芯片'],
      manufacturing: ['手机代工', '电脑代工', '可穿戴设备制造', '精密结构件制造'],
      applications: ['ai手机', 'ai pc', '智能眼镜', '智能穿戴', '智能家居']
    }
  },
  {
    id: 'low-altitude-economy',
    name: '低空经济与无人机',
    aliases: ['低空经济', '无人机', '飞行汽车', 'eVTOL', '通航'],
    stages: {
      materials: ['航空铝材', '航空钛材', '碳纤维复材', '航空树脂', '高温合金'],
      equipment: ['航空制造设备', '复材设备', '适航检测设备', '低空通信设备'],
      components: ['航空发动机', '电机电控', '飞控系统', '航电系统', '空管雷达', '无人机电池'],
      manufacturing: ['无人机整机', 'evtol整机', '通用航空制造', '航空零部件制造'],
      applications: ['低空物流', '应急救援', '城市空中交通', '巡检测绘', '低空旅游']
    }
  },
  {
    id: 'commercial-space',
    name: '商业航天与卫星互联网',
    aliases: ['商业航天', '卫星互联网', '低轨卫星', '火箭', '卫星通信'],
    stages: {
      materials: ['航天复合材料', '高温合金', '钛合金', '特种陶瓷', '电子特气'],
      equipment: ['卫星制造设备', '火箭制造设备', '航天测试设备', '地面站设备'],
      components: ['卫星载荷', '相控阵天线', '星载芯片', '惯性导航', '连接器', '航天电源'],
      manufacturing: ['卫星制造', '运载火箭', '卫星总装', '地面终端制造'],
      applications: ['卫星通信', '卫星遥感', '卫星导航', '商业发射', '天地一体网络']
    }
  }
];

const ALL_QUERY_ALIASES = new Set(['全部', 'all', '*']);
const NEGATION_PREFIXES = [
  '没有', '暂无', '尚未', '从未', '未涉及', '不涉及', '并无', '不生产',
  '不从事', '未布局', '不具备', '未开展', '不包含', '不含', '无相关',
  '不存在', '尚无', '目前无', '当前无', '现阶段无', '现无', '未有',
  '未曾涉及', '未曾开展', '并未有', '不做', '不拥有', '否认有', '否认拥有',
  '否认存在', '澄清无', '澄清没有', '澄清称没有'
];
const NEGATION_SUFFIXES = ['不存在', '无关', '未开展', '不属于', '没有', '为假', '不实'];
const DISCOVERY_CACHE_TTL_MS = 30 * 1000;
const discoveryCache = new Map();

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[·・]/g, '');
}

function unique(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter(function(value) {
    const key = normalized(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function validDate(value) {
  return text(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
}

function matchedTerms(value, terms) {
  const searchable = normalized(value);
  return unique((terms || []).filter(function(term) {
    const needle = normalized(term);
    return needle && searchable.includes(needle);
  }));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sentenceAround(value, index, length) {
  const source = normalized(value);
  const boundaries = /[。！？；.!?;\n]/;
  let start = index;
  let end = index + length;
  while (start > 0 && !boundaries.test(source[start - 1])) start -= 1;
  while (end < source.length && !boundaries.test(source[end])) end += 1;
  return { source, sentence: source.slice(start, end), offset: index - start };
}

function mentionIsNegated(value, term, index) {
  const needle = normalized(term);
  const context = sentenceAround(value, index, needle.length);
  const before = context.sentence.slice(Math.max(0, context.offset - 32), context.offset);
  const after = context.sentence.slice(context.offset + needle.length, context.offset + needle.length + 32);
  const prefixPattern = new RegExp('(?:' + NEGATION_PREFIXES.map(escapeRegExp).join('|') + ')[^。！？；.!?;]{0,24}$');
  const suffixPattern = new RegExp('^(?:[^。！？；.!?;]{0,24})(?:' + NEGATION_SUFFIXES.map(escapeRegExp).join('|') + ')');
  return prefixPattern.test(before) || suffixPattern.test(after);
}

function positiveMatchedTerms(value, terms) {
  const searchable = normalized(value);
  return unique((terms || []).filter(function(term) {
    const needle = normalized(term);
    if (!needle) return false;
    let index = searchable.indexOf(needle);
    while (index >= 0) {
      if (!mentionIsNegated(searchable, needle, index)) return true;
      index = searchable.indexOf(needle, index + needle.length);
    }
    return false;
  }));
}

function normalizeStockCode(value) {
  const raw = text(value).toUpperCase();
  let match = raw.match(/^(\d{6})$/);
  if (match) return match[1];
  match = raw.match(/^(SH|SZ|BJ)[.\-_: ]?(\d{6})$/);
  if (!match) {
    const suffixMatch = raw.match(/^(\d{6})[.\-_: ]?(SH|SZ|BJ)$/);
    if (suffixMatch) match = [suffixMatch[0], suffixMatch[2], suffixMatch[1]];
  }
  if (!match) return '';
  const market = match[1];
  const code = match[2];
  const expected = /^(?:4|8|92)/.test(code) ? 'BJ' : /^(?:6|9)/.test(code) ? 'SH' : /^(?:0|3)/.test(code) ? 'SZ' : '';
  return market === expected ? code : '';
}

function validEvidenceLocator(value) {
  const raw = text(value);
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol)
      && parsed.hostname.length > 1
      && parsed.hostname.includes('.')
      && !parsed.hostname.startsWith('.')
      && !parsed.hostname.endsWith('.');
  } catch (error) {
    return false;
  }
}

function chainSignalTerms(chain) {
  // A stage term can be shared by unrelated chains (for example, photovoltaic
  // and semiconductor companies both use “硅片”).  Confirmation therefore
  // needs a separate chain/theme hit instead of reusing the stage hit twice.
  return unique(chain.aliases);
}

function eastmoneyProfileUrl(code) {
  const normalizedCode = normalizeStockCode(code);
  if (!/^\d{6}$/.test(normalizedCode)) return '';
  const market = /^(8|4|92)/.test(normalizedCode) ? 'BJ'
    : /^(6|5|9)/.test(normalizedCode) ? 'SH' : 'SZ';
  return 'https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/Index?code=' + market + normalizedCode + '&type=web';
}

function resolveIndustryChainQuery(query, options = {}) {
  const raw = text(query);
  const rawNormalized = normalized(raw);
  const chainFilter = normalized(options.chain);
  const stageFilter = normalized(options.stage);
  const allRequested = ALL_QUERY_ALIASES.has(rawNormalized)
    || ALL_QUERY_ALIASES.has(chainFilter)
    || ALL_QUERY_ALIASES.has(stageFilter);
  const knownChain = INDUSTRY_CHAIN_TAXONOMY.find(function(chain) { return normalized(chain.id) === chainFilter; });
  const knownStage = Object.keys(STAGE_DEFINITIONS).find(function(stage) { return stage === stageFilter; });
  const naturalChainIds = INDUSTRY_CHAIN_TAXONOMY.filter(function(chain) {
    return matchedTerms(rawNormalized, chain.aliases).length > 0;
  }).map(function(chain) { return chain.id; });
  const naturalStages = Object.keys(STAGE_DEFINITIONS).filter(function(stage) {
    return matchedTerms(rawNormalized, STAGE_DEFINITIONS[stage].aliases).length > 0;
  });

  let chainIds = knownChain ? [knownChain.id] : naturalChainIds;
  let stages = knownStage ? [knownStage] : naturalStages;
  if (!chainIds.length && (allRequested || stages.length)) {
    chainIds = INDUSTRY_CHAIN_TAXONOMY.map(function(chain) { return chain.id; });
  }
  if (!stages.length && (allRequested || chainIds.length)) stages = Object.keys(STAGE_DEFINITIONS);

  return {
    raw,
    chainIds,
    stages,
    recognized: chainIds.length > 0 && stages.length > 0,
    allRequested
  };
}

function validateIndustryChainFilters(options = {}) {
  const chain = normalized(options.chain);
  const stage = normalized(options.stage);
  if (chain && !ALL_QUERY_ALIASES.has(chain) && !INDUSTRY_CHAIN_TAXONOMY.some(function(item) { return item.id === chain; })) {
    return { valid: false, field: 'chain', code: 'INVALID_INDUSTRY_CHAIN_FILTER' };
  }
  if (stage && !ALL_QUERY_ALIASES.has(stage) && !Object.prototype.hasOwnProperty.call(STAGE_DEFINITIONS, stage)) {
    return { valid: false, field: 'stage', code: 'INVALID_INDUSTRY_STAGE_FILTER' };
  }
  return { valid: true };
}

function metadataText(stock) {
  const mainBusiness = Array.isArray(stock.mainBusinessItems) ? stock.mainBusinessItems
    : parseJson(stock.mainBusinessJson || stock.main_business_json, []);
  return [
    stock.name,
    stock.industry,
    stock.boardsText || stock.boards_text,
    stock.businessScope || stock.business_scope,
    stock.businessSummary || stock.business_summary,
    stock.tagsText || stock.tags_text,
    mainBusiness.map(function(item) { return item && item.name; }).filter(Boolean).join(' ')
  ].filter(Boolean).join(' ');
}

function metadataConfirmationText(stock) {
  const mainBusiness = Array.isArray(stock.mainBusinessItems) ? stock.mainBusinessItems
    : parseJson(stock.mainBusinessJson || stock.main_business_json, []);
  return [
    stock.businessScope || stock.business_scope,
    stock.businessSummary || stock.business_summary,
    mainBusiness.map(function(item) { return item && item.name; }).filter(Boolean).join(' ')
  ].filter(Boolean).join(' ');
}

function stockIdentity(stock) {
  const code = normalizeStockCode(stock && (stock.code || stock.stockCode));
  return {
    code,
    name: text(stock && (stock.name || stock.stockName)) || code,
    industry: text(stock && stock.industry)
  };
}

function isCompanyStockCode(code) {
  return /^(?:0|3|4|6|8|9)\d{5}$/.test(text(code));
}

function evidenceSnippet(value, terms) {
  const source = text(value);
  if (!source) return '';
  const positions = (terms || []).map(function(term) { return normalized(source).indexOf(normalized(term)); }).filter(function(index) { return index >= 0; });
  const start = positions.length ? Math.max(Math.min.apply(Math, positions) - 55, 0) : 0;
  return source.slice(start, start + 220);
}

function stableEvidenceId(prefix, values) {
  return prefix + '-' + crypto.createHash('sha256').update(values.map(text).join('|')).digest('hex').slice(0, 16);
}

function stockMetadataDocuments(stocks) {
  return (stocks || []).map(function(stock) {
    const identity = stockIdentity(stock);
    const content = metadataText(stock);
    const confirmationContent = metadataConfirmationText(stock);
    const source = text(stock.source);
    return {
      kind: 'stock-metadata',
      evidenceId: text(stock.evidenceId) || stableEvidenceId('PROFILE', [identity.code, stock.observedAt || stock.updatedAt || stock.updated_at, content]),
      title: identity.name + ' 本地股票资料',
      source,
      sourceUrl: text(stock.sourceUrl) || (/eastmoney f10/i.test(source) ? eastmoneyProfileUrl(identity.code) : ''),
      observedAt: validDate(stock.observedAt || stock.updatedAt || stock.updated_at),
      stockCodes: identity.code ? [identity.code] : [],
      explicitStockAssociation: Boolean(identity.code),
      content,
      confirmationContent,
      stock: identity
    };
  }).filter(function(document) { return isCompanyStockCode(document.stock.code) && document.content; });
}

function normalizeExternalEvidence(item, kind) {
  const stockCodes = unique((item.stockCodes || item.relatedStocks || []).map(function(code) {
    return normalizeStockCode(code);
  }).filter(isCompanyStockCode));
  const confirmationContent = [item.title, item.summary, item.content]
    .filter(Boolean).join(' ');
  const content = [confirmationContent, ...(item.tags || []), ...(item.sectors || item.relatedSectors || [])]
    .filter(Boolean).join(' ');
  const fallback = kind === 'news' && (/fallback/i.test(text(item.evidenceKind)) || /WebStock Fallback/i.test(text(item.source)));
  return {
    kind,
    evidenceId: text(item.evidenceId || item.id) || stableEvidenceId(kind === 'news' ? 'NEWS' : 'KNOWLEDGE', [item.source, item.title, item.observedAt || item.publishedAt || item.time, content]),
    title: text(item.title) || (kind === 'news' ? '资讯证据' : '知识库证据'),
    source: text(item.source || item.provider),
    sourceUrl: text(item.sourceUrl || item.link),
    observedAt: validDate(item.observedAt || item.publishedAt || item.time || item.updatedAt),
    stockCodes,
    explicitStockAssociation: stockCodes.length > 0,
    associationProvenance: text(item.associationProvenance && item.associationProvenance.relatedStocks)
      || text(item.stockAssociationProvenance)
      || 'unknown',
    content,
    confirmationContent,
    fallback
  };
}

function associationIsConfirmationEligible(document) {
  if (document.kind === 'stock-metadata') return true;
  return ['upstream-field', 'manual-evidence-field', 'manual-verified', 'company-disclosure']
    .includes(normalized(document.associationProvenance));
}

function traceable(document) {
  return Boolean(document.evidenceId
    && document.source
    && document.observedAt
    && validEvidenceLocator(document.sourceUrl)
    && !document.fallback);
}

function relationConfidence(evidence) {
  let score = 0.58;
  const kinds = new Set();
  let termCount = 0;
  evidence.forEach(function(item) {
    kinds.add(item.sourceType);
    termCount += item.matchedTerms.length;
    if (item.sourceType === 'knowledge') score += 0.12;
    else if (item.sourceType === 'news') score += 0.09;
    else score += 0.06;
  });
  score += Math.min(termCount, 6) * 0.02;
  if (kinds.size > 1) score += 0.05;
  return Number(Math.min(score, 0.95).toFixed(2));
}

function publicEvidence(document, chainTerms, stageTerms) {
  const terms = unique(chainTerms.concat(stageTerms));
  return {
    evidenceId: document.evidenceId,
    sourceType: document.kind,
    title: document.title,
    source: document.source,
    sourceUrl: document.sourceUrl || '',
    observedAt: document.observedAt,
    matchedTerms: terms,
    matchReason: '证据同时命中主题词（' + chainTerms.join('、') + '）和环节词（' + stageTerms.join('、') + '）。',
    snippet: evidenceSnippet(document.content, terms)
  };
}

function themeOnlyEvidence(document, chainTerms) {
  return {
    evidenceId: document.evidenceId,
    sourceType: document.kind,
    title: document.title,
    source: document.source,
    sourceUrl: document.sourceUrl || '',
    observedAt: document.observedAt,
    matchedTerms: chainTerms,
    matchReason: '证据命中产业链主题词（' + chainTerms.join('、') + '），但未命中标准环节词。',
    snippet: evidenceSnippet(document.content, chainTerms)
  };
}

function negativeEvidence(document, chainTerms, stageTerms) {
  const terms = unique(chainTerms.concat(stageTerms));
  return {
    evidenceId: document.evidenceId,
    sourceType: document.kind,
    title: document.title,
    source: document.source,
    sourceUrl: document.sourceUrl || '',
    observedAt: document.observedAt,
    matchedTerms: terms,
    matchReason: '文本中的主题或环节词处于“没有、未涉及、不生产”等否定语境，不能作为确认依据。',
    snippet: evidenceSnippet(document.content, terms)
  };
}

function createCandidate(options) {
  return {
    status: 'candidate',
    chain: { id: options.chain.id, name: options.chain.name },
    stage: options.stage || null,
    stageName: options.stage ? STAGE_DEFINITIONS[options.stage].name : '',
    stockCode: options.code,
    stockName: options.stock.name || options.code,
    stock: options.stock,
    confidence: options.confidence,
    observedAt: options.document.observedAt || null,
    reasonCode: options.reasonCode,
    reason: options.reason,
    evidence: []
  };
}

function buildIndustryChainMap(input = {}) {
  const resolved = resolveIndustryChainQuery(input.query, { chain: input.chain, stage: input.stage });
  const selectedChains = INDUSTRY_CHAIN_TAXONOMY.filter(function(chain) { return resolved.chainIds.includes(chain.id); });
  const stockMap = new Map((input.stocks || []).map(function(stock) {
    const identity = stockIdentity(stock);
    return [identity.code, identity];
  }).filter(function(entry) { return isCompanyStockCode(entry[0]); }));
  const metadataDocuments = stockMetadataDocuments(input.stocks || []);
  const knowledgeDocuments = (input.knowledgeEvidence || []).map(function(item) { return normalizeExternalEvidence(item, 'knowledge'); });
  const newsDocuments = (input.newsEvidence || []).map(function(item) { return normalizeExternalEvidence(item, 'news'); });
  const documents = metadataDocuments.concat(knowledgeDocuments, newsDocuments);
  const relations = new Map();
  const candidates = new Map();
  const negativeRelationKeys = new Set();
  let matchedDocumentCount = 0;
  let unassociatedEvidenceCount = 0;

  function addCandidate(key, definition, evidence) {
    const current = candidates.get(key) || definition;
    if (!current.evidence.some(function(item) { return item.evidenceId === evidence.evidenceId; })) {
      current.evidence.push(evidence);
    }
    candidates.set(key, current);
  }

  documents.forEach(function(document) {
    if (!document.explicitStockAssociation) {
      if (selectedChains.some(function(chain) { return positiveMatchedTerms(document.content, chainSignalTerms(chain)).length; })) {
        unassociatedEvidenceCount += 1;
      }
      return;
    }
    document.stockCodes.forEach(function(code) {
      const stock = document.stock || stockMap.get(code) || { code, name: code, industry: '' };
      selectedChains.forEach(function(chain) {
        const rawChainMatches = matchedTerms(document.content, chainSignalTerms(chain));
        if (!rawChainMatches.length) return;
        const chainMatches = positiveMatchedTerms(document.content, chainSignalTerms(chain));
        const confirmationChainMatches = positiveMatchedTerms(document.confirmationContent || document.content, chainSignalTerms(chain));
        matchedDocumentCount += 1;
        const rawStages = resolved.stages.filter(function(stage) {
          return matchedTerms(document.content, chain.stages[stage]).length > 0;
        });
        const matchedStages = resolved.stages.filter(function(stage) {
          return positiveMatchedTerms(document.content, chain.stages[stage]).length > 0;
        });
        const negatedStages = rawStages.filter(function(stage) { return !matchedStages.includes(stage); });

        negatedStages.forEach(function(stage) {
          negativeRelationKeys.add([chain.id, stage, code].join('|'));
          const rawStageMatches = matchedTerms(document.content, chain.stages[stage]);
          const key = [chain.id, stage, code, 'negative-evidence'].join('|');
          addCandidate(key, createCandidate({
            chain,
            stage,
            code,
            stock,
            document,
            confidence: 0.05,
            reasonCode: 'negative-evidence',
            reason: '资料明确使用否定或澄清语句，当前不能确认该股票属于这一产业链环节。'
          }), negativeEvidence(document, rawChainMatches, rawStageMatches));
        });

        if (!chainMatches.length) {
          if (!negatedStages.length && rawStages.length) {
            rawStages.forEach(function(stage) {
              negativeRelationKeys.add([chain.id, stage, code].join('|'));
              const key = [chain.id, stage, code, 'negative-evidence'].join('|');
              addCandidate(key, createCandidate({
                chain,
                stage,
                code,
                stock,
                document,
                confidence: 0.05,
                reasonCode: 'negative-evidence',
                reason: '产业链主题词处于否定或澄清语境，不能据此确认公司关系。'
              }), negativeEvidence(document, rawChainMatches, matchedTerms(document.content, chain.stages[stage])));
            });
          }
          return;
        }
        if (!matchedStages.length) {
          const key = [chain.id, code, 'needs-stage-evidence'].join('|');
          const evidence = themeOnlyEvidence(document, chainMatches);
          addCandidate(key, createCandidate({
            chain,
            stage: null,
            code,
            stock,
            document,
            confidence: traceable(document) ? 0.35 : 0.15,
            reasonCode: 'needs-stage-evidence',
            reason: '已有证据命中产业链主题，但没有命中可复核的标准环节。'
          }), evidence);
          return;
        }
        matchedStages.forEach(function(stage) {
          const stageMatches = positiveMatchedTerms(document.content, chain.stages[stage]);
          const evidence = publicEvidence(document, chainMatches, stageMatches);
          const confirmationStageMatches = positiveMatchedTerms(document.confirmationContent || document.content, chain.stages[stage]);
          const classificationOnly = !confirmationChainMatches.length || !confirmationStageMatches.length;
          const associationEligible = associationIsConfirmationEligible(document);
          if (classificationOnly || !associationEligible || !traceable(document) || !stockMap.has(code)) {
            const reasonCode = classificationOnly ? 'classification-only'
              : !associationEligible ? 'association-not-verified'
                : !stockMap.has(code) ? 'stock-metadata-missing' : 'source-metadata-incomplete';
            const key = [chain.id, stage, code, reasonCode].join('|');
            const reason = reasonCode === 'classification-only'
              ? '仅由行业、概念板块或程序标签命中；主营、公告或原始正文尚未同时确认主题和环节。'
              : reasonCode === 'association-not-verified'
                ? '股票代码来自程序文本推断或请求上下文，不是上游明确字段或人工核验绑定。'
                : reasonCode === 'stock-metadata-missing'
                  ? '证据明确关联股票代码，但本地股票资料缺失，暂不能确认公司身份和暴露路径。'
                  : '主题与环节已命中，但原始链接、来源或观察时间不完整。';
            addCandidate(key, createCandidate({
              chain,
              stage,
              code,
              stock,
              document,
              confidence: traceable(document) ? 0.35 : 0.2,
              reasonCode,
              reason
            }), evidence);
            return;
          }
          const key = [chain.id, stage, code].join('|');
          const current = relations.get(key) || {
            status: 'confirmed',
            chain: { id: chain.id, name: chain.name },
            stage,
            stageName: STAGE_DEFINITIONS[stage].name,
            stockCode: code,
            stockName: stock.name || code,
            stock,
            confidence: 0,
            observedAt: document.observedAt,
            evidence: []
          };
          if (!current.evidence.some(function(item) { return item.evidenceId === evidence.evidenceId; })) current.evidence.push(evidence);
          if (Date.parse(document.observedAt) > Date.parse(current.observedAt)) current.observedAt = document.observedAt;
          current.confidence = relationConfidence(current.evidence);
          relations.set(key, current);
        });
      });
    });
  });

  const limit = Math.min(Math.max(Number(input.limit) || 120, 1), 300);
  const allConfirmed = Array.from(relations.entries()).filter(function(entry) {
    return !negativeRelationKeys.has(entry[0]);
  }).map(function(entry) { return entry[1]; }).sort(function(a, b) {
    return b.confidence - a.confidence || a.chain.name.localeCompare(b.chain.name) || a.stage.localeCompare(b.stage) || a.stockCode.localeCompare(b.stockCode);
  });
  const confirmed = allConfirmed.slice(0, limit);
  const allCandidateItems = Array.from(candidates.values()).filter(function(candidate) {
    return !allConfirmed.some(function(item) {
      return item.chain.id === candidate.chain.id
        && item.stockCode === candidate.stockCode
        && (!candidate.stage || item.stage === candidate.stage);
    });
  }).sort(function(a, b) {
    const aRisk = /(?:\*?st|退)/i.test(a.stockName || '') ? 1 : 0;
    const bRisk = /(?:\*?st|退)/i.test(b.stockName || '') ? 1 : 0;
    return b.confidence - a.confidence
      || aRisk - bRisk
      || a.chain.name.localeCompare(b.chain.name)
      || a.stockCode.localeCompare(b.stockCode);
  });
  const candidateItems = allCandidateItems.slice(0, limit);
  const hasAnySource = documents.length > 0;
  const availability = confirmed.length ? 'available' : hasAnySource ? 'empty' : 'unavailable';
  const dataGaps = [];
  if (!resolved.recognized) dataGaps.push('未识别该查询对应的产业链或标准环节，未自动扩展到其他产业链。');
  if (!metadataDocuments.length) dataGaps.push('没有可用的本地股票元数据，无法确认股票身份和主营暴露。');
  if (!knowledgeDocuments.length) dataGaps.push('本地知识库没有可用于本次归纳的证据。');
  if (!newsDocuments.length) dataGaps.push('当前没有可用于本次归纳的资讯证据。');
  if (unassociatedEvidenceCount) dataGaps.push('有 ' + unassociatedEvidenceCount + ' 条主题证据未明确绑定股票代码，未用于确认股票关系。');
  if (candidateItems.some(function(item) { return item.reasonCode === 'needs-stage-evidence'; })) {
    dataGaps.push('部分股票只命中主题，仍需公告、定期报告或公司资料确认具体产业链环节。');
  }

  const groupedChains = selectedChains.map(function(chain) {
    const chainCandidates = candidateItems.filter(function(item) { return item.chain.id === chain.id; });
    return {
      id: chain.id,
      name: chain.name,
      candidates: chainCandidates.filter(function(item) { return !item.stage; }),
      stages: resolved.stages.map(function(stage) {
        return {
          id: stage,
          name: STAGE_DEFINITIONS[stage].name,
          confirmed: confirmed.filter(function(item) { return item.chain.id === chain.id && item.stage === stage; }),
          candidates: chainCandidates.filter(function(item) { return item.stage === stage; })
        };
      })
    };
  });

  return {
    schema: 'webstock.industry-chain/v1',
    generatedAt: new Date(input.now || Date.now()).toISOString(),
    availability,
    query: resolved,
    chains: groupedChains,
    confirmed,
    candidates: candidateItems,
    coverage: {
      stockMetadataCount: metadataDocuments.length,
      knowledgeEvidenceCount: knowledgeDocuments.length,
      newsEvidenceCount: newsDocuments.length,
      matchedDocumentCount,
      unassociatedEvidenceCount,
      confirmedRelationCount: confirmed.length,
      candidateRelationCount: candidateItems.length,
      totalConfirmedRelationCount: allConfirmed.length,
      totalCandidateRelationCount: allCandidateItems.length,
      truncated: allConfirmed.length > confirmed.length || allCandidateItems.length > candidateItems.length
    },
    methodology: {
      method: 'evidence-bound-industry-chain-classification-v1',
      hardcodedStockMembership: false,
      investmentRecommendation: false,
      confirmationRule: 'A relation is confirmed only when non-negated primary evidence is explicitly bound to a valid stock code, matches both a chain and a stage, and includes a traceable source URL plus observation time.'
    },
    dataGaps,
    limitations: [
      '结果是本地证据支持的研究候选池，不是投资建议或完整市场覆盖。',
      '词典匹配不能证明收入占比、订单增量或估值吸引力；这些需要后续公司级核验。',
      '未明确绑定股票代码的行业资料不会自动推断成公司关系。'
    ]
  };
}

function loadStockMetadata(limit) {
  return db.prepare(`
    SELECT code, name, industry, boards_text AS boardsText,
      business_scope AS businessScope, business_summary AS businessSummary,
      main_business_json AS mainBusinessJson, tags_text AS tagsText,
      source, updated_at AS observedAt
    FROM stock_search_index
    WHERE length(code) = 6
      AND substr(code, 1, 1) IN ('0', '3', '4', '6', '8', '9')
      AND name <> ''
    ORDER BY datetime(updated_at) DESC, code ASC
    LIMIT ?
  `).all(Math.min(Math.max(Number(limit) || 8000, 1), 10000));
}

function loadKnowledgeEvidence(limit) {
  return db.prepare(`
    SELECT chunk.evidence_id AS evidenceId, source.title, source.source_type AS sourceType,
      source.source_url AS sourceUrl, source.published_at AS publishedAt,
      source.updated_at AS updatedAt, source.stock_codes_json AS stockCodesJson,
      source.tags_json AS tagsJson, source.sectors_json AS sectorsJson, chunk.content
    FROM knowledge_chunks AS chunk
    JOIN knowledge_sources AS source ON source.id = chunk.source_id
    ORDER BY datetime(source.updated_at) DESC, chunk.id DESC
    LIMIT ?
  `).all(Math.min(Math.max(Number(limit) || 500, 1), 1000)).map(function(row) {
    return {
      evidenceId: row.evidenceId,
      title: row.title,
      source: row.sourceType ? '本地知识库 / ' + row.sourceType : '本地知识库',
      sourceUrl: row.sourceUrl,
      observedAt: validDate(row.publishedAt) || validDate(row.updatedAt),
      stockCodes: parseJson(row.stockCodesJson, []),
      stockAssociationProvenance: 'manual-evidence-field',
      tags: parseJson(row.tagsJson, []),
      sectors: parseJson(row.sectorsJson, []),
      content: row.content
    };
  });
}

function newsAsEvidence(items) {
  return (items || []).map(function(item) {
    return {
      id: item.id,
      evidenceId: item.id,
      title: item.title,
      source: item.provider || item.source,
      sourceUrl: item.link,
      observedAt: item.time,
      relatedStocks: item.relatedStocks,
      relatedSectors: item.relatedSectors,
      associationProvenance: item.associationProvenance,
      summary: item.summary,
      evidenceKind: item.evidenceKind
    };
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function newestTimestamp(items, fields) {
  let newest = '';
  (items || []).forEach(function(item) {
    const value = fields.map(function(field) { return validDate(item && item[field]); }).find(Boolean);
    if (value && (!newest || Date.parse(value) > Date.parse(newest))) newest = value;
  });
  return newest || null;
}

function cacheKeyFor(options) {
  return JSON.stringify({
    query: text(options.query),
    chain: text(options.chain),
    stage: text(options.stage),
    limit: Math.min(Math.max(Number(options.limit) || 120, 1), 300)
  });
}

async function discoverIndustryChains(options = {}) {
  const sources = options.sources || {};
  const useCache = !options.sources && !options.cacheBust;
  const cacheKey = useCache ? cacheKeyFor(options) : '';
  if (useCache) {
    const cached = discoveryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const result = cloneJson(cached.value);
      result.sourceMeta.cache = { hit: true, ttlMs: DISCOVERY_CACHE_TTL_MS };
      return result;
    }
    if (cached) discoveryCache.delete(cacheKey);
  }
  const errors = [];
  let stocks = [];
  let knowledgeEvidence = [];
  let newsEvidence = [];
  let newsMeta = null;

  try {
    stocks = sources.stocks ? await sources.stocks(options) : loadStockMetadata(options.stockLimit);
  } catch (error) {
    errors.push({ source: 'stock-metadata', code: 'SOURCE_UNAVAILABLE' });
    console.warn('[industry-chain] stock metadata unavailable:', error.message || String(error));
  }
  try {
    knowledgeEvidence = sources.knowledge ? await sources.knowledge(options) : loadKnowledgeEvidence(options.knowledgeLimit);
  } catch (error) {
    errors.push({ source: 'knowledge', code: 'SOURCE_UNAVAILABLE' });
    console.warn('[industry-chain] knowledge unavailable:', error.message || String(error));
  }
  try {
    if (sources.news) {
      const result = await sources.news(options);
      newsEvidence = Array.isArray(result) ? result : (result.items || []);
      newsMeta = Array.isArray(result) ? null : (result.meta || null);
    } else {
      const newsService = require('./newsService');
      const result = await newsService.listNewsWithMetaAsync({ pages: 1, num: 200, cacheBust: options.cacheBust });
      newsEvidence = newsAsEvidence(result.items);
      newsMeta = result.meta;
    }
  } catch (error) {
    errors.push({ source: 'news', code: 'SOURCE_UNAVAILABLE' });
    console.warn('[industry-chain] news unavailable:', error.message || String(error));
  }

  const result = buildIndustryChainMap(Object.assign({}, options, { stocks, knowledgeEvidence, newsEvidence }));
  const usableNewsCount = newsEvidence.filter(function(item) {
    return !normalizeExternalEvidence(item, 'news').fallback;
  }).length;
  result.sourceMeta = {
    stockMetadata: {
      status: stocks.length ? 'available' : 'unavailable',
      count: stocks.length,
      observedAt: newestTimestamp(stocks, ['observedAt', 'updatedAt', 'updated_at'])
    },
    knowledge: {
      status: knowledgeEvidence.length ? 'available' : 'empty',
      count: knowledgeEvidence.length,
      observedAt: newestTimestamp(knowledgeEvidence, ['observedAt', 'publishedAt', 'updatedAt'])
    },
    news: {
      status: usableNewsCount ? 'available' : newsEvidence.length ? 'fallback' : 'empty',
      count: newsEvidence.length,
      usableEvidenceCount: usableNewsCount,
      degraded: Boolean(newsMeta && newsMeta.degraded),
      observedAt: newestTimestamp(newsEvidence, ['observedAt', 'time', 'publishedAt', 'updatedAt'])
    },
    errors,
    cache: { hit: false, ttlMs: DISCOVERY_CACHE_TTL_MS }
  };
  if (newsEvidence.length && !usableNewsCount) {
    result.dataGaps.push('当前只有本地兜底资讯，未作为可确认产业链关系的外部证据。');
  }
  if (errors.length && result.availability !== 'unavailable') result.availability = 'degraded';
  errors.forEach(function(error) {
    result.dataGaps.push(error.source + ' 数据暂不可用。');
  });
  if (useCache) {
    if (discoveryCache.size >= 50) discoveryCache.delete(discoveryCache.keys().next().value);
    discoveryCache.set(cacheKey, { expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS, value: cloneJson(result) });
  }
  return result;
}

function getIndustryChainTaxonomy() {
  return INDUSTRY_CHAIN_TAXONOMY.map(function(chain) {
    return {
      id: chain.id,
      name: chain.name,
      aliases: chain.aliases.slice(),
      stages: Object.fromEntries(Object.entries(chain.stages).map(function(entry) { return [entry[0], entry[1].slice()]; }))
    };
  });
}

module.exports = {
  STAGE_DEFINITIONS,
  INDUSTRY_CHAIN_TAXONOMY,
  resolveIndustryChainQuery,
  validateIndustryChainFilters,
  buildIndustryChainMap,
  discoverIndustryChains,
  getIndustryChainTaxonomy,
  loadStockMetadata,
  loadKnowledgeEvidence,
  newsAsEvidence
};
