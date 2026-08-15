const MIN_ANALYSIS_BARS = 20;
const MIN_MACD_BARS = 35;
const RULES_VERSION = 'webstock-chart-rules/1.0.0';
const DECISION_RULES_VERSION = 'webstock-decision-observation/1.0.0';
const CHART_ANNOTATION_RULES_VERSION = 'webstock-chart-annotations/1.0.0';
const KEY_LEVEL_RULES_VERSION = 'webstock-key-levels/1.0.0';

const RULE_DEFINITIONS = [
  {
    ruleId: 'trend.ma-stack.v1',
    category: 'trend',
    label: '均线结构',
    trigger: '以最新收盘与 MA5、MA10、MA20 的严格大小顺序区分上行排列、下行排列和混合结构。',
    assumptions: ['至少 20 根同周期有效收盘价，均线采用简单算术平均。'],
    limitations: ['均线只描述历史平均关系，具有滞后性；复权口径未知时结果可能变化。'],
    knowledgeReferenceIds: [],
    predictiveClaim: false
  },
  {
    ruleId: 'price-volume.avg5-vs20.v1',
    category: 'price-volume',
    label: '量价关系',
    trigger: '比较近 5 根与近 20 根平均成交量：比值不低于 1.2 时结合近 5 根收盘变化方向，比值不高于 0.8 时记为量能收缩，其余为常态区间。',
    assumptions: ['最近 20 根成交量有效且单位一致；价格方向用最新收盘相对 5 根前收盘计算。'],
    limitations: ['未校验成交量单位、异常成交、复权或停牌影响；量价组合不是未来方向判断。'],
    knowledgeReferenceIds: [],
    predictiveClaim: false
  },
  {
    ruleId: 'momentum.macd-12-26-9.v1',
    category: 'macd',
    label: 'MACD 动量',
    trigger: '按 EMA(12)、EMA(26) 得到 DIF，以 EMA(9) 得到 DEA，并以 2×(DIF-DEA) 为柱值；DIF 与柱值的正负组合决定当前状态。',
    assumptions: ['至少 35 根同周期有效收盘价；EMA 从首根有效收盘初始化。'],
    limitations: ['与 TA-Lib 的标准直方图口径不同，本规则柱值为标准差值的 2 倍；不用于推断后续方向。'],
    knowledgeReferenceIds: ['talib-macd'],
    predictiveClaim: false
  },
  {
    ruleId: 'momentum.rsi-14.v1',
    category: 'rsi',
    label: 'RSI 相对强弱',
    trigger: '对最近 14 个相邻收盘变化直接汇总涨幅与跌幅，结果不低于 70、或不高于 30 时分别标记相对高位、相对低位。',
    assumptions: ['至少 15 根同周期有效收盘价；采用当前实现的 14 期简单窗口口径。'],
    limitations: ['该口径未采用 Wilder 递推平滑；阈值只描述样本位置，不是反转判断。'],
    knowledgeReferenceIds: [],
    predictiveClaim: false
  },
  {
    ruleId: 'momentum.kdj-9-3-3.v1',
    category: 'kdj',
    label: 'KDJ 区间位置',
    trigger: '以 9 根高低区间计算 RSV，K、D 从 50 起按 1/3 递推并逐步保留两位，J=3K-2D；K、D 同时不低于 80 或不高于 20 时标记区间位置。',
    assumptions: ['所有有效根均有一致口径的最高价、最低价和收盘价，且收盘位于对应高低区间内。'],
    limitations: ['这是 WebStock KDJ 口径，不等同于 TA-Lib STOCH 默认输出；对窗口和短期波动敏感。'],
    knowledgeReferenceIds: ['talib-stoch'],
    predictiveClaim: false
  },
  {
    ruleId: 'structure.close-breakout-20.v1',
    category: 'breakout',
    label: '20 根区间突破',
    trigger: '最新收盘严格高于此前 20 根最高价时记为向上突破，严格低于此前 20 根最低价时记为向下突破；相等不算突破。',
    assumptions: ['至少有最新一根及此前 20 根同周期有效高低价；阈值不包含最新一根。'],
    limitations: ['固定窗口会影响阈值；复权、停牌和异常价格可能制造表面突破；不提供后续方向结论。'],
    knowledgeReferenceIds: [],
    predictiveClaim: false
  },
  {
    ruleId: 'structure.full-gap-adjacent.v1',
    category: 'gap',
    label: '完整跳空缺口',
    trigger: '仅当最新最低价严格高于前一根最高价，或最新最高价严格低于前一根最低价时，识别相邻两根完整区间缺口。',
    assumptions: ['最近两根同周期最高价和最低价有效且口径一致。'],
    limitations: ['复权方式、除权除息、停牌和数据异常可能形成表面缺口；不推断缺口是否回补。'],
    knowledgeReferenceIds: [],
    predictiveClaim: false
  }
].map(function(rule) { return Object.assign({ rulesVersion: RULES_VERSION }, rule); });

const KNOWLEDGE_REFERENCES = [
  {
    id: 'talib-stoch',
    title: 'TA-Lib STOCH — Stochastic',
    url: 'https://ta-lib.org/functions/stoch.html',
    sourceType: 'official-function-documentation',
    usage: 'indicator-definition-reference',
    implementedInChartAnalysis: true,
    notes: 'WebStock 的 KDJ 使用 J=3K-2D、50 初值和逐步两位舍入，不等同于 TA-Lib STOCH 默认输出。'
  },
  {
    id: 'talib-macd',
    title: 'TA-Lib MACD — Moving Average Convergence/Divergence',
    url: 'https://ta-lib.org/functions/macd.html',
    sourceType: 'official-function-documentation',
    usage: 'indicator-definition-reference',
    implementedInChartAnalysis: true,
    notes: 'WebStock 的 MACD 柱为 DIF 与 DEA 差值的 2倍，TA-Lib 标准直方图为两者差值。'
  },
  {
    id: 'talib-atr',
    title: 'TA-Lib ATR — Average True Range',
    url: 'https://ta-lib.org/functions/atr.html',
    sourceType: 'official-function-documentation',
    usage: 'key-level-tolerance-reference',
    implementedInChartAnalysis: true,
    notes: 'ATR 是无方向的波动度指标；关键位聚类仅用 ATR(14) 调整价格容差，不把 ATR 解释为方向信号。'
  },
  {
    id: 'talib-obv',
    title: 'TA-Lib OBV — On Balance Volume',
    url: 'https://ta-lib.org/functions/obv.html',
    sourceType: 'official-function-documentation',
    usage: 'knowledge-reference-only',
    implementedInChartAnalysis: false,
    notes: 'OBV 是方向累计量指标；本期量价规则使用 5/20 平均成交量比，不等同于 OBV。'
  },
  {
    id: 'lightweight-charts-realtime-update',
    title: 'Lightweight Charts — Updating data in a series',
    url: 'https://tradingview.github.io/lightweight-charts/docs/5.0#updating-the-data-in-a-series',
    sourceType: 'official-implementation-documentation',
    usage: 'implementation-reference-only',
    implementedInChartAnalysis: false,
    notes: '仅用于曲线增量刷新实现参考，不是技术指标、策略规则或有效性证据。'
  },
  {
    id: 'tradingview-technical-ratings',
    title: 'TradingView — Technical Ratings',
    url: 'https://www.tradingview.com/support/solutions/43000614331-technical-ratings/',
    sourceType: 'official-product-methodology',
    usage: 'composite-method-reference-only',
    implementedInChartAnalysis: false,
    notes: '仅参考多指标合成与分档展示思路；WebStock 使用更少的确定性规则、自有权重和观察型标签，不复刻其评级。'
  }
];

function copyRuleDefinitions() {
  return RULE_DEFINITIONS.map(function(rule) {
    return Object.assign({}, rule, {
      assumptions: rule.assumptions.slice(),
      limitations: rule.limitations.slice(),
      knowledgeReferenceIds: rule.knowledgeReferenceIds.slice()
    });
  });
}

function copyKnowledgeReferences() {
  return KNOWLEDGE_REFERENCES.map(function(reference) { return Object.assign({}, reference); });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function average(values) {
  if (!values.length) return null;
  return values.reduce(function(sum, value) { return sum + value; }, 0) / values.length;
}

function parseAsOf(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new TypeError('asOf is required');
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? Date.parse(text + 'T23:59:59.999Z')
    : Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new TypeError('asOf must be a valid date or timestamp');
  return { text, timestamp };
}

function validateInput(input) {
  const source = input && typeof input === 'object' ? input : {};
  const code = String(source.code == null ? '' : source.code).trim();
  const period = String(source.period == null ? '' : source.period).trim();
  if (!code) throw new TypeError('code is required');
  if (!period) throw new TypeError('period is required');
  const asOf = parseAsOf(source.asOf);
  if (!Array.isArray(source.bars)) throw new TypeError('bars must be an array');
  return { code, period, asOf, bars: source.bars };
}

function normalizeBars(rows, cutoff) {
  const valid = [];
  let invalidBars = 0;
  let excludedFutureBars = 0;

  rows.forEach(function(row, index) {
    if (!row || typeof row !== 'object') {
      invalidBars++;
      return;
    }
    const dateText = String(row.date || row.time || row.datetime || '').trim();
    const timestamp = Date.parse(dateText);
    const close = finiteNumber(row.close == null ? row.price : row.close);
    if (!dateText || !Number.isFinite(timestamp) || close == null || close <= 0) {
      invalidBars++;
      return;
    }
    if (timestamp > cutoff) {
      excludedFutureBars++;
      return;
    }
    valid.push({
      index,
      date: dateText,
      timestamp,
      open: finiteNumber(row.open),
      high: finiteNumber(row.high),
      low: finiteNumber(row.low),
      close,
      volume: finiteNumber(row.volume)
    });
  });

  valid.sort(function(left, right) {
    return left.timestamp - right.timestamp || left.index - right.index;
  });
  return { bars: valid, invalidBars, excludedFutureBars };
}

function uniquePush(target, values) {
  (values || []).forEach(function(value) {
    const text = String(value || '').trim();
    if (text && !target.includes(text)) target.push(text);
  });
}

function createResult(input, normalized) {
  const bars = normalized.bars;
  return {
    schema: 'webstock.chart-analysis/v1',
    rulesVersion: RULES_VERSION,
    knowledgeScope: 'phase-one-deterministic-rule-dictionary',
    strategyValidation: 'not-backtested',
    rules: copyRuleDefinitions(),
    knowledgeReferences: copyKnowledgeReferences(),
    assumptions: [
      '所有观察只使用不晚于 asOf 的同周期 bars，并假定输入字段单位在样本内一致。',
      '输入未声明复权、停牌、交易日历和异常值清洗口径，使用者需要结合数据源复核。'
    ],
    status: bars.length >= MIN_ANALYSIS_BARS ? 'ok' : 'insufficient',
    code: input.code,
    period: input.period,
    asOf: input.asOf.text,
    coverage: {
      providedBars: input.bars.length,
      eligibleBars: bars.length,
      invalidBars: normalized.invalidBars,
      excludedFutureBars: normalized.excludedFutureBars,
      minimumBars: MIN_ANALYSIS_BARS,
      firstBarAt: bars.length ? bars[0].date : '',
      lastBarAt: bars.length ? bars[bars.length - 1].date : ''
    },
    observations: [],
    evidence: [],
    plainMeaning: [],
    confirmations: [],
    invalidation: [],
    limitations: [
      '仅解释传入 bars 中不晚于 asOf 的数据，不补充任何外部行情或资讯。',
      '技术指标是对当前样本的描述，不判断未来涨跌，也不生成交易动作。',
      '输入未声明复权方式、停牌处理和数据源质量，这些因素可能改变指标含义。'
    ]
  };
}

function addEvidence(result, observationId, metric, label, value, range, unit) {
  const evidence = {
    id: 'E' + String(result.evidence.length + 1).padStart(3, '0'),
    observationId,
    metric,
    label,
    value,
    unit: unit || '',
    period: result.period,
    asOf: result.asOf,
    firstBarAt: range[0].date,
    lastBarAt: range[range.length - 1].date
  };
  result.evidence.push(evidence);
  return evidence.id;
}

function addObservation(result, input) {
  const observation = {
    id: input.id,
    ruleId: input.ruleId,
    rulesVersion: RULES_VERSION,
    category: input.category,
    label: input.label,
    state: input.state,
    evidenceIds: input.evidenceIds,
    plainMeaning: input.plainMeaning,
    confirmations: input.confirmations || [],
    invalidation: input.invalidation || [],
    limitations: input.limitations || []
  };
  result.observations.push(observation);
  result.plainMeaning.push(observation.plainMeaning);
  uniquePush(result.confirmations, observation.confirmations);
  uniquePush(result.invalidation, observation.invalidation);
  uniquePush(result.limitations, observation.limitations);
}

function addTrendObservation(result, bars) {
  const recent = bars.slice(-20);
  const closes = bars.map(function(bar) { return bar.close; });
  const latest = bars[bars.length - 1];
  const ma5 = average(closes.slice(-5));
  const ma10 = average(closes.slice(-10));
  const ma20 = average(closes.slice(-20));
  let state = 'mixed';
  let meaning = '当前收盘价与短中期均线交错，样本内没有形成一致的均线顺序。';
  if (latest.close > ma5 && ma5 > ma10 && ma10 > ma20) {
    state = 'aligned-up';
    meaning = '截至截止时间，收盘价位于 MA5、MA10、MA20 上方，且短期均线高于中期均线；这是当前样本内的上行排列。';
  } else if (latest.close < ma5 && ma5 < ma10 && ma10 < ma20) {
    state = 'aligned-down';
    meaning = '截至截止时间，收盘价位于 MA5、MA10、MA20 下方，且短期均线低于中期均线；这是当前样本内的下行排列。';
  } else if (latest.close >= ma20) {
    state = 'mixed-above-ma20';
    meaning = '当前均线顺序交错，但收盘价仍位于 MA20 上方，应把它理解为混合结构而非单一趋势结论。';
  } else {
    state = 'mixed-below-ma20';
    meaning = '当前均线顺序交错，且收盘价位于 MA20 下方，应把它理解为混合偏弱结构。';
  }

  const id = 'trend-ma-stack';
  const evidenceIds = [
    addEvidence(result, id, 'latest_close', '最新收盘', round(latest.close), [latest]),
    addEvidence(result, id, 'ma5', 'MA5', round(ma5), bars.slice(-5)),
    addEvidence(result, id, 'ma10', 'MA10', round(ma10), bars.slice(-10)),
    addEvidence(result, id, 'ma20', 'MA20', round(ma20), recent)
  ];
  addObservation(result, {
    id,
    ruleId: 'trend.ma-stack.v1',
    category: 'trend',
    label: '均线结构',
    state,
    evidenceIds,
    plainMeaning: meaning,
    confirmations: ['继续核对同一周期收盘价与 MA5、MA10、MA20 的相对顺序是否保持。'],
    invalidation: ['收盘价或均线顺序改变时，本条均线结构观察即失效。'],
    limitations: ['均线具有滞后性，只描述已发生价格的平均关系。']
  });
}

function addPriceVolumeObservation(result, bars) {
  const recent = bars.slice(-20);
  if (recent.some(function(bar) { return bar.volume == null || bar.volume < 0; }) ||
      recent.every(function(bar) { return bar.volume === 0; })) {
    uniquePush(result.limitations, ['最近 20 根数据缺少有效成交量，未生成量价观察。']);
    return;
  }
  const volumes = recent.map(function(bar) { return bar.volume; });
  const avgVolume5 = average(volumes.slice(-5));
  const avgVolume20 = average(volumes);
  const volumeRatio = avgVolume20 > 0 ? avgVolume5 / avgVolume20 : null;
  const anchor = bars[bars.length - 6].close;
  const change5 = anchor > 0 ? (bars[bars.length - 1].close - anchor) / anchor * 100 : 0;
  let state = 'volume-balanced';
  let meaning = '近 5 根平均成交量与近 20 根均量接近，量能处于样本内常态区间。';
  if (volumeRatio >= 1.2 && change5 >= 0) {
    state = 'price-up-volume-expanding';
    meaning = '近 5 根价格变化为正且平均成交量高于近 20 根均量，当前样本呈现价升量增组合。';
  } else if (volumeRatio >= 1.2 && change5 < 0) {
    state = 'price-down-volume-expanding';
    meaning = '近 5 根价格变化为负且平均成交量高于近 20 根均量，当前样本呈现价降量增组合。';
  } else if (volumeRatio <= 0.8) {
    state = 'volume-contracting';
    meaning = '近 5 根平均成交量低于近 20 根均量，当前样本处于量能收缩状态。';
  }

  const id = 'price-volume-5-20';
  const evidenceIds = [
    addEvidence(result, id, 'avg_volume_5', '近5根平均成交量', round(avgVolume5, 0), recent.slice(-5)),
    addEvidence(result, id, 'avg_volume_20', '近20根平均成交量', round(avgVolume20, 0), recent),
    addEvidence(result, id, 'volume_ratio_5_20', '5/20量能比', round(volumeRatio, 3), recent, 'x'),
    addEvidence(result, id, 'close_change_5', '近5根收盘变化', round(change5), bars.slice(-6), '%')
  ];
  addObservation(result, {
    id,
    ruleId: 'price-volume.avg5-vs20.v1',
    category: 'price-volume',
    label: '量价关系',
    state,
    evidenceIds,
    plainMeaning: meaning,
    confirmations: ['继续核对后续同周期成交量相对近 20 根均量的比例，以及价格变化方向是否仍一致。'],
    invalidation: ['5/20 量能比跨回常态区间或价格变化方向反转时，本条量价观察失效。'],
    limitations: ['成交量口径由输入数据决定，未校验单位、复权或异常成交。']
  });
}

function calculateMacd(closes) {
  const shortAlpha = 2 / 13;
  const longAlpha = 2 / 27;
  const signalAlpha = 2 / 10;
  let emaShort = closes[0];
  let emaLong = closes[0];
  let dea = 0;
  let latest = { dif: 0, dea: 0, bar: 0 };
  for (let index = 1; index < closes.length; index++) {
    emaShort = closes[index] * shortAlpha + emaShort * (1 - shortAlpha);
    emaLong = closes[index] * longAlpha + emaLong * (1 - longAlpha);
    const dif = emaShort - emaLong;
    dea = dif * signalAlpha + dea * (1 - signalAlpha);
    latest = { dif, dea, bar: (dif - dea) * 2 };
  }
  return latest;
}

function addMacdObservation(result, bars) {
  if (bars.length < MIN_MACD_BARS) {
    uniquePush(result.limitations, ['MACD 至少需要 35 根有效收盘数据，当前未生成 MACD 观察。']);
    return;
  }
  const macd = calculateMacd(bars.map(function(bar) { return bar.close; }));
  let state = 'mixed';
  let meaning = 'DIF、DEA 与柱值方向不一致，MACD 当前处于混合状态。';
  if (macd.dif >= 0 && macd.bar >= 0) {
    state = 'above-zero-positive';
    meaning = 'DIF 位于零轴上方且柱值为正，表示当前样本中的中短期动量差为正。';
  } else if (macd.dif < 0 && macd.bar < 0) {
    state = 'below-zero-negative';
    meaning = 'DIF 位于零轴下方且柱值为负，表示当前样本中的中短期动量差为负。';
  }
  const id = 'indicator-macd';
  const range = bars;
  const evidenceIds = [
    addEvidence(result, id, 'macd_dif', 'DIF', round(macd.dif, 4), range),
    addEvidence(result, id, 'macd_dea', 'DEA', round(macd.dea, 4), range),
    addEvidence(result, id, 'macd_bar', 'MACD柱', round(macd.bar, 4), range)
  ];
  addObservation(result, {
    id,
    ruleId: 'momentum.macd-12-26-9.v1',
    category: 'macd',
    label: 'MACD 动量',
    state,
    evidenceIds,
    plainMeaning: meaning,
    confirmations: ['继续核对 DIF 相对零轴的位置，以及柱值方向是否保持。'],
    invalidation: ['DIF 跨越零轴或柱值改变正负时，本条 MACD 状态观察失效。'],
    limitations: ['MACD 是价格派生的滞后指标，不能单独代表后续方向。']
  });
}

function calculateRsi(closes, period) {
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (gains + losses === 0) return 50;
  return gains / (gains + losses) * 100;
}

function addRsiObservation(result, bars) {
  const period = 14;
  const rsi = calculateRsi(bars.map(function(bar) { return bar.close; }), period);
  let state = 'middle-range';
  let meaning = 'RSI(14) 位于中间区间，当前样本的单边动量不突出。';
  if (rsi >= 70) {
    state = 'upper-range';
    meaning = 'RSI(14) 位于相对高位区间，表示最近上涨幅度在样本窗口内占比较高；它不等同于反转结论。';
  } else if (rsi <= 30) {
    state = 'lower-range';
    meaning = 'RSI(14) 位于相对低位区间，表示最近下跌幅度在样本窗口内占比较高；它不等同于反转结论。';
  }
  const id = 'indicator-rsi-14';
  const evidenceIds = [addEvidence(result, id, 'rsi_14', 'RSI(14)', round(rsi), bars.slice(-(period + 1)))];
  addObservation(result, {
    id,
    ruleId: 'momentum.rsi-14.v1',
    category: 'rsi',
    label: 'RSI 相对强弱',
    state,
    evidenceIds,
    plainMeaning: meaning,
    confirmations: ['继续核对 RSI 是否仍处于同一区间，并结合价格与成交量共同复核。'],
    invalidation: ['RSI 离开当前区间时，本条 RSI 状态观察失效。'],
    limitations: ['RSI 阈值只用于描述样本内相对位置，不是反转信号。']
  });
}

function calculateKdj(bars, period) {
  let k = 50;
  let d = 50;
  bars.forEach(function(bar, index) {
    const start = Math.max(0, index - period + 1);
    const window = bars.slice(start, index + 1);
    const low = Math.min.apply(null, window.map(function(item) { return item.low; }));
    const high = Math.max.apply(null, window.map(function(item) { return item.high; }));
    const rsv = index < period - 1
      ? 50
      : high === low ? 50 : round((bar.close - low) / (high - low) * 100);
    if (index > 0) {
      k = round(rsv / 3 + k * 2 / 3);
      d = round(k / 3 + d * 2 / 3);
    }
  });
  return { k, d, j: round(3 * k - 2 * d) };
}

function addKdjObservation(result, bars) {
  if (bars.some(function(bar) {
    return bar.high == null || bar.low == null || bar.high < bar.low || bar.close > bar.high || bar.close < bar.low;
  })) {
    uniquePush(result.limitations, ['有效最高价和最低价不足，未生成 KDJ 观察。']);
    return;
  }
  const kdj = calculateKdj(bars, 9);
  let state = 'balanced';
  let meaning = 'K、D、J 位于中间区域，当前样本的随机位置较为均衡。';
  if (kdj.k >= 80 && kdj.d >= 80) {
    state = 'upper-range';
    meaning = 'K 与 D 位于相对高位区域，表示最新收盘在近期高低区间中的位置偏高。';
  } else if (kdj.k <= 20 && kdj.d <= 20) {
    state = 'lower-range';
    meaning = 'K 与 D 位于相对低位区域，表示最新收盘在近期高低区间中的位置偏低。';
  }
  const id = 'indicator-kdj-9';
  const range = bars;
  const evidenceIds = [
    addEvidence(result, id, 'kdj_k', 'K', round(kdj.k), range),
    addEvidence(result, id, 'kdj_d', 'D', round(kdj.d), range),
    addEvidence(result, id, 'kdj_j', 'J', round(kdj.j), range)
  ];
  addObservation(result, {
    id,
    ruleId: 'momentum.kdj-9-3-3.v1',
    category: 'kdj',
    label: 'KDJ 区间位置',
    state,
    evidenceIds,
    plainMeaning: meaning,
    confirmations: ['继续核对 K、D 的区间位置及相对顺序是否保持。'],
    invalidation: ['K 或 D 离开当前区间时，本条 KDJ 状态观察失效。'],
    limitations: ['KDJ 对窗口与短期波动较敏感，不能脱离价格结构单独解释。']
  });
}

function hasValidRange(bar) {
  return bar && bar.high != null && bar.low != null && bar.high >= bar.low;
}

function addBreakoutObservation(result, bars) {
  const latest = bars[bars.length - 1];
  const prior = bars.slice(-21, -1);
  if (prior.length < 20 || !hasValidRange(latest) || prior.some(function(bar) { return !hasValidRange(bar); })) {
    uniquePush(result.limitations, ['突破观察至少需要最新一根及此前 20 根有效最高价和最低价。']);
    return;
  }

  const priorHigh = Math.max.apply(null, prior.map(function(bar) { return bar.high; }));
  const priorLow = Math.min.apply(null, prior.map(function(bar) { return bar.low; }));
  let state = 'inside-prior-range';
  let distance = priorHigh > 0 ? (latest.close - priorHigh) / priorHigh * 100 : 0;
  let meaning = '最新收盘仍位于此前 20 根的高低区间内，当前样本没有形成收盘价突破。';
  let invalidation = '最新收盘离开此前 20 根高低区间时，本条区间内观察失效。';
  if (latest.close > priorHigh) {
    state = 'upward-breakout';
    meaning = '最新收盘高于此前 20 根最高价，当前样本形成向上突破观察；这只描述已发生的价格位置。';
    invalidation = '收盘重新回到此前 20 根最高价之下时，本条向上突破观察失效。';
  } else if (latest.close < priorLow) {
    state = 'downward-breakout';
    distance = priorLow > 0 ? (latest.close - priorLow) / priorLow * 100 : 0;
    meaning = '最新收盘低于此前 20 根最低价，当前样本形成向下突破观察；这只描述已发生的价格位置。';
    invalidation = '收盘重新回到此前 20 根最低价之上时，本条向下突破观察失效。';
  }

  const id = 'structure-breakout-20';
  const evidenceIds = [
    addEvidence(result, id, 'latest_close', '最新收盘', round(latest.close), [latest]),
    addEvidence(result, id, 'prior_high_20', '此前20根最高价', round(priorHigh), prior),
    addEvidence(result, id, 'prior_low_20', '此前20根最低价', round(priorLow), prior),
    addEvidence(result, id, 'breakout_distance_pct', '相对突破阈值距离', round(distance), prior.concat(latest), '%')
  ];
  addObservation(result, {
    id,
    ruleId: 'structure.close-breakout-20.v1',
    category: 'breakout',
    label: '20 根区间突破',
    state,
    evidenceIds,
    plainMeaning: meaning,
    confirmations: ['继续核对后续同周期收盘相对本次突破阈值的位置，以及成交量是否同步变化。'],
    invalidation: [invalidation],
    limitations: ['突破窗口固定为此前 20 根，窗口选择会影响阈值；本观察不提供后续方向结论。']
  });
}

function addGapObservation(result, bars) {
  const previous = bars[bars.length - 2];
  const latest = bars[bars.length - 1];
  if (!hasValidRange(previous) || !hasValidRange(latest)) {
    uniquePush(result.limitations, ['缺口观察需要最近两根有效最高价和最低价。']);
    return;
  }

  let state = 'no-full-gap';
  let gapSize = 0;
  let meaning = '最近两根价格区间有重叠，当前样本没有形成完整跳空缺口。';
  let invalidation = '最近两根高低区间不再重叠时，本条无完整缺口观察失效。';
  if (latest.low > previous.high) {
    state = 'up-gap';
    gapSize = previous.high > 0 ? (latest.low - previous.high) / previous.high * 100 : 0;
    meaning = '最新一根最低价高于前一根最高价，当前样本存在完整向上跳空缺口。';
    invalidation = '后续价格进入或低于前一根最高价时，本条向上缺口观察失效。';
  } else if (latest.high < previous.low) {
    state = 'down-gap';
    gapSize = previous.low > 0 ? (previous.low - latest.high) / previous.low * 100 : 0;
    meaning = '最新一根最高价低于前一根最低价，当前样本存在完整向下跳空缺口。';
    invalidation = '后续价格进入或高于前一根最低价时，本条向下缺口观察失效。';
  }

  const id = 'structure-full-gap';
  const range = [previous, latest];
  const evidenceIds = [
    addEvidence(result, id, 'previous_high', '前一根最高价', round(previous.high), [previous]),
    addEvidence(result, id, 'previous_low', '前一根最低价', round(previous.low), [previous]),
    addEvidence(result, id, 'latest_high', '最新最高价', round(latest.high), [latest]),
    addEvidence(result, id, 'latest_low', '最新最低价', round(latest.low), [latest]),
    addEvidence(result, id, 'gap_size_pct', '完整缺口幅度', round(gapSize), range, '%')
  ];
  addObservation(result, {
    id,
    ruleId: 'structure.full-gap-adjacent.v1',
    category: 'gap',
    label: '完整跳空缺口',
    state,
    evidenceIds,
    plainMeaning: meaning,
    confirmations: ['继续核对后续同周期高低价是否进入缺口区间。'],
    invalidation: [invalidation],
    limitations: ['这里只识别相邻两根高低区间完全不重叠的缺口，不推断缺口一定回补。']
  });
}

const DECISION_WEIGHTS = {
  trend: {
    'aligned-up': 25,
    'mixed-above-ma20': 8,
    'mixed-below-ma20': -8,
    'aligned-down': -25
  },
  'price-volume': {
    'price-up-volume-expanding': 15,
    'price-down-volume-expanding': -15
  },
  macd: {
    'above-zero-positive': 15,
    'below-zero-negative': -15
  },
  breakout: {
    'upward-breakout': 25,
    'downward-breakout': -25
  },
  gap: {
    'up-gap': 5,
    'down-gap': -5
  }
};

function decisionLabel(score, positiveCount, negativeCount) {
  if (score >= 55 && positiveCount >= 3) return { key: 'entry-watch', label: '入场观察' };
  if (score <= -55 && negativeCount >= 3) return { key: 'exit-warning', label: '离场警示' };
  if (score >= 20) return { key: 'positive-watch', label: '偏强观察' };
  if (score <= -20) return { key: 'defensive-watch', label: '防守观察' };
  return { key: 'wait-confirmation', label: '等待确认' };
}

function decisionSummary(key) {
  if (key === 'entry-watch') return '趋势、动量、量能或突破已有多项同向证据；先观察确认条件是否继续成立。';
  if (key === 'exit-warning') return '弱势结构已有多项同向证据；优先核对破位是否延续及失效条件是否出现。';
  if (key === 'positive-watch') return '样本结构偏强，但同向证据尚未达到高等级观察门槛。';
  if (key === 'defensive-watch') return '样本结构偏弱，应把风险确认与失效条件放在前面。';
  return '多项证据尚未形成一致方向，等待价格、量能或动量进一步确认。';
}

function buildDecisionGuide(result) {
  const base = {
    schema: 'webstock.decision-observation/v1',
    rulesVersion: DECISION_RULES_VERSION,
    strategyValidation: 'not-backtested',
    notInvestmentAdvice: true,
    score: null,
    key: 'insufficient',
    label: '数据不足',
    summary: '有效样本不足，暂不生成入场或离场观察。',
    positiveEvidenceCount: 0,
    negativeEvidenceCount: 0,
    evidence: [],
    confirmations: [],
    invalidation: [],
    limitations: [
      '这是基于历史价格与成交量的确定性观察分档，不是收益预测或自动交易指令。',
      '规则尚未按个股、板块和市场阶段完成正式回测。'
    ]
  };
  if (!result || result.status !== 'ok') return base;

  const evidence = [];
  (result.observations || []).forEach(function(observation) {
    const categoryWeights = DECISION_WEIGHTS[observation.category] || {};
    const weight = Number(categoryWeights[observation.state]) || 0;
    if (!weight) return;
    evidence.push({
      observationId: observation.id,
      ruleId: observation.ruleId,
      category: observation.category,
      label: observation.label,
      state: observation.state,
      direction: weight > 0 ? 'positive' : 'negative',
      weight,
      plainMeaning: observation.plainMeaning,
      confirmations: (observation.confirmations || []).slice(),
      invalidation: (observation.invalidation || []).slice()
    });
  });
  const rawScore = evidence.reduce(function(sum, item) { return sum + item.weight; }, 0);
  const score = Math.max(-100, Math.min(100, rawScore));
  const positiveCount = evidence.filter(function(item) { return item.weight > 0; }).length;
  const negativeCount = evidence.filter(function(item) { return item.weight < 0; }).length;
  const level = decisionLabel(score, positiveCount, negativeCount);
  const directional = level.key === 'entry-watch' || level.key === 'positive-watch'
    ? evidence.filter(function(item) { return item.weight > 0; })
    : level.key === 'exit-warning' || level.key === 'defensive-watch'
    ? evidence.filter(function(item) { return item.weight < 0; })
    : evidence;
  const confirmations = [];
  const invalidation = [];
  directional.forEach(function(item) {
    uniquePush(confirmations, item.confirmations);
    uniquePush(invalidation, item.invalidation);
  });

  return Object.assign(base, {
    score,
    key: level.key,
    label: level.label,
    summary: decisionSummary(level.key),
    positiveEvidenceCount: positiveCount,
    negativeEvidenceCount: negativeCount,
    evidence,
    confirmations: confirmations.slice(0, 3),
    invalidation: invalidation.slice(0, 3)
  });
}

function annotationBars(rows) {
  return (Array.isArray(rows) ? rows : []).map(function(row, index) {
    const date = String(row && (row.date || row.time || row.datetime) || '').trim();
    const timestamp = Date.parse(date);
    const open = finiteNumber(row && row.open);
    const high = finiteNumber(row && row.high);
    const low = finiteNumber(row && row.low);
    const close = finiteNumber(row && (row.close == null ? row.price : row.close));
    const volume = finiteNumber(row && row.volume);
    if (!date || !Number.isFinite(timestamp) || open == null || high == null || low == null ||
        close == null || open <= 0 || close <= 0 || high < low) return null;
    return { index, date, timestamp, open, high, low, close, volume };
  }).filter(Boolean).sort(function(left, right) {
    return left.timestamp - right.timestamp || left.index - right.index;
  });
}

function historicalValidation(bars, index) {
  const trigger = bars[index];
  const future = bars.slice(index + 1, index + 6);
  if (!future.length) {
    return {
      status: 'pending',
      bars: 0,
      forwardClosePct: null,
      maxPct: null,
      minPct: null
    };
  }
  const latest = future[future.length - 1];
  return {
    status: future.length >= 5 ? 'available' : 'partial',
    bars: future.length,
    forwardClosePct: round((latest.close - trigger.close) / trigger.close * 100),
    maxPct: round((Math.max.apply(null, future.map(function(bar) { return bar.high; })) - trigger.close) / trigger.close * 100),
    minPct: round((Math.min.apply(null, future.map(function(bar) { return bar.low; })) - trigger.close) / trigger.close * 100)
  };
}

function averageTrueRange(bars, period) {
  const source = (bars || []).slice(-Math.max(Number(period) || 14, 1));
  if (!source.length) return null;
  const ranges = source.map(function(bar, index) {
    if (!hasValidRange(bar)) return null;
    const previous = bars[bars.length - source.length + index - 1];
    if (!previous || previous.close == null) return bar.high - bar.low;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previous.close),
      Math.abs(bar.low - previous.close)
    );
  }).filter(function(value) { return Number.isFinite(value) && value >= 0; });
  return ranges.length === source.length ? average(ranges) : null;
}

function isLocalPivot(bars, index, field, direction) {
  const radius = 2;
  if (index < radius || index >= bars.length - radius) return false;
  const value = bars[index][field];
  if (!Number.isFinite(value)) return false;
  const neighbors = bars.slice(index - radius, index + radius + 1)
    .filter(function(_, neighborIndex) { return neighborIndex !== radius; })
    .map(function(bar) { return bar[field]; });
  if (neighbors.some(function(item) { return !Number.isFinite(item); })) return false;
  if (direction === 'low') {
    return neighbors.every(function(item) { return value < item; });
  }
  return neighbors.every(function(item) { return value > item; });
}

function volumeConfirmedAt(bars, index) {
  const current = bars[index];
  if (!current || current.volume == null || current.volume < 0) return false;
  const prior = bars.slice(Math.max(0, index - 20), index)
    .map(function(bar) { return bar.volume; })
    .filter(function(value) { return value != null && value >= 0; });
  if (prior.length < 5) return false;
  const baseline = average(prior);
  return baseline > 0 && current.volume >= baseline * 1.2;
}

function clusterPivots(points, tolerance) {
  const clusters = [];
  points.slice().sort(function(left, right) { return left.price - right.price; }).forEach(function(point) {
    let cluster = clusters.find(function(item) {
      return Math.abs(item.price - point.price) <= tolerance;
    });
    if (!cluster) {
      cluster = { price: point.price, points: [] };
      clusters.push(cluster);
    }
    cluster.points.push(point);
    cluster.price = average(cluster.points.map(function(item) { return item.price; }));
  });
  return clusters;
}

function strengthForCluster(cluster) {
  const touchCount = cluster.points.length;
  const rejectionCount = cluster.points.filter(function(point) { return point.rejected; }).length;
  if (touchCount >= 3 && rejectionCount >= 2) return { key: 'strong', label: '强' };
  if (touchCount >= 2) return { key: 'moderate', label: '中' };
  return { key: 'weak', label: '弱' };
}

function describeKeyLevel(cluster, type, latest, tolerance, lookbackBars) {
  if (!cluster) return null;
  const strength = strengthForCluster(cluster);
  const price = round(cluster.price);
  const distancePct = latest.close > 0 ? round((price - latest.close) / latest.close * 100) : null;
  const isSupport = type === 'support';
  let status = isSupport ? 'holding-above' : 'holding-below';
  let statusLabel = isSupport ? '价格位于支撑上方' : '价格位于压力下方';
  if (Math.abs(latest.close - price) <= tolerance) {
    status = 'testing';
    statusLabel = '正在容差区内测试';
  } else if (isSupport && latest.close < price - tolerance) {
    status = 'broken-down';
    statusLabel = '收盘已低于支撑容差区';
  } else if (!isSupport && latest.close > price + tolerance) {
    status = 'broken-up';
    statusLabel = '收盘已高于压力容差区';
  }
  const touchDates = cluster.points.map(function(point) { return point.date; });
  return {
    type,
    price,
    label: isSupport ? '关键支撑' : '关键压力',
    shortLabel: strength.label + (isSupport ? '支' : '压'),
    strengthKey: strength.key,
    strengthLabel: strength.label,
    touchCount: cluster.points.length,
    rejectionCount: cluster.points.filter(function(point) { return point.rejected; }).length,
    volumeConfirmedTouches: cluster.points.filter(function(point) { return point.volumeConfirmed; }).length,
    touchDates,
    lastTouchAt: touchDates[touchDates.length - 1] || '',
    distancePct,
    tolerance: round(tolerance, 4),
    status,
    statusLabel,
    basis: '过去' + lookbackBars + '根局部' + (isSupport ? '低点' : '高点') + '聚类',
    confirmations: [
      '继续核对同周期价格在该容差区的收盘位置、触碰后的反向收盘以及成交量是否同步变化。'
    ],
    invalidation: [
      isSupport
        ? '收盘持续低于支撑价减去容差时，原支撑观察失效并可能发生角色反转。'
        : '收盘持续高于压力价加上容差时，原压力观察失效并可能发生角色反转。'
    ],
    calculationUsesFutureData: false
  };
}

function buildKeyLevels(rawBars, period) {
  const bars = annotationBars(rawBars);
  const latest = bars[bars.length - 1];
  const history = bars.slice(0, -1).slice(-120);
  const result = {
    schema: 'webstock.key-levels/v1',
    rulesVersion: KEY_LEVEL_RULES_VERSION,
    period: String(period || ''),
    lookbackBars: history.length,
    tolerance: null,
    tolerancePct: null,
    calculationUsesFutureData: false,
    method: {
      lookbackLimit: 120,
      pivotRadius: 2,
      toleranceRule: 'max(latestClose*0.5%, ATR14*35%)',
      rejectionRule: '支撑触碰后收盘位于当根区间上半部；压力触碰后收盘位于当根区间下半部',
      volumeConfirmationRule: '触碰当根成交量不低于此前最多20根有效均量的1.2倍，且至少需要5根基线',
      strengthRule: '强=至少3次触碰且至少2次反向收盘；中=至少2次触碰；弱=1次触碰'
    },
    support: null,
    resistance: null,
    methodReferences: [
      {
        title: 'Fidelity — Support and resistance',
        url: 'https://www.fidelity.com/learning-center/trading-investing/technical-analysis/support-and-resistance?print=true',
        usage: 'concept-reference'
      },
      {
        title: 'Fidelity — Volume Oscillator',
        url: 'https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/volume-oscillator',
        usage: 'volume-confirmation-reference'
      },
      {
        title: 'TA-Lib — Average True Range',
        url: 'https://ta-lib.org/functions/atr.html',
        usage: 'volatility-tolerance-reference'
      }
    ],
    limitations: [
      '关键位来自历史局部高低点聚类，是证据区而不是价格预测或交易指令。',
      '强弱只表示样本内触碰和反向收盘的重复程度；复权、停牌、异常成交和周期选择会改变结果。',
      '成交量只作为触碰证据的补充字段，不会单独把一个价位升级为强支撑或强压力。'
    ]
  };
  if (!latest || history.length < 10) return result;

  const atr = averageTrueRange(history, 14);
  const tolerance = Math.max(latest.close * 0.005, Number.isFinite(atr) ? atr * 0.35 : 0);
  result.tolerance = round(tolerance, 4);
  result.tolerancePct = latest.close > 0 ? round(tolerance / latest.close * 100, 3) : null;

  const lows = [];
  const highs = [];
  history.forEach(function(bar, index) {
    if (isLocalPivot(history, index, 'low', 'low')) {
      lows.push({
        price: bar.low,
        date: bar.date,
        rejected: bar.close >= bar.low + (bar.high - bar.low) * 0.5,
        volumeConfirmed: volumeConfirmedAt(history, index)
      });
    }
    if (isLocalPivot(history, index, 'high', 'high')) {
      highs.push({
        price: bar.high,
        date: bar.date,
        rejected: bar.close <= bar.high - (bar.high - bar.low) * 0.5,
        volumeConfirmed: volumeConfirmedAt(history, index)
      });
    }
  });

  const supportClusters = clusterPivots(lows, tolerance)
    .filter(function(cluster) { return cluster.price <= latest.close + tolerance; })
    .sort(function(left, right) {
      return Math.abs(latest.close - left.price) - Math.abs(latest.close - right.price) ||
        right.points.length - left.points.length;
    });
  const resistanceClusters = clusterPivots(highs, tolerance)
    .filter(function(cluster) { return cluster.price >= latest.close - tolerance; })
    .sort(function(left, right) {
      return Math.abs(left.price - latest.close) - Math.abs(right.price - latest.close) ||
        right.points.length - left.points.length;
    });

  result.support = describeKeyLevel(supportClusters[0], 'support', latest, tolerance, history.length);
  result.resistance = describeKeyLevel(resistanceClusters[0], 'resistance', latest, tolerance, history.length);
  return result;
}

function chartEvent(bars, index) {
  const current = bars[index];
  const previous = bars[index - 1];
  const prior = bars.slice(index - 20, index);
  if (!current || !previous || prior.length < 20) return null;
  const priorHigh = Math.max.apply(null, prior.map(function(bar) { return bar.high; }));
  const priorLow = Math.min.apply(null, prior.map(function(bar) { return bar.low; }));
  const validVolumes = prior.map(function(bar) { return bar.volume; }).filter(function(value) {
    return value != null && value >= 0;
  });
  const averageVolume = validVolumes.length === prior.length ? average(validVolumes) : null;
  const volumeRatio = averageVolume > 0 && current.volume != null ? current.volume / averageVolume : null;
  const priceChangePct = previous.close > 0 ? (current.close - previous.close) / previous.close * 100 : null;
  let event = null;

  if (current.close > priorHigh) {
    event = { type: 'breakout-up', marker: '突', label: '20周期向上突破', direction: 'positive', threshold: priorHigh };
  } else if (current.close < priorLow) {
    event = { type: 'breakout-down', marker: '破', label: '20周期向下跌破', direction: 'negative', threshold: priorLow };
  } else if (current.low > previous.high) {
    event = { type: 'gap-up', marker: '缺', label: '向上完整缺口', direction: 'positive', threshold: previous.high };
  } else if (current.high < previous.low) {
    event = { type: 'gap-down', marker: '缺', label: '向下完整缺口', direction: 'negative', threshold: previous.low };
  } else if (volumeRatio != null && volumeRatio >= 1.8 && priceChangePct != null && Math.abs(priceChangePct) >= 1) {
    event = {
      type: priceChangePct >= 0 ? 'volume-expansion-up' : 'volume-expansion-down',
      marker: '量',
      label: priceChangePct >= 0 ? '上涨放量' : '下跌放量',
      direction: priceChangePct >= 0 ? 'positive' : 'negative',
      threshold: averageVolume
    };
  }
  if (!event) return null;

  return Object.assign(event, {
    date: current.date,
    price: event.direction === 'positive' ? current.low : current.high,
    triggerUsesFutureData: false,
    validationUsesFutureData: true,
    triggerEvidence: {
      close: round(current.close),
      threshold: round(event.threshold),
      priorWindowBars: 20,
      volumeRatio: volumeRatio == null ? null : round(volumeRatio, 2),
      priceChangePct: priceChangePct == null ? null : round(priceChangePct)
    },
    validation: historicalValidation(bars, index),
    limitations: [
      '触发标识只使用当根及此前20根数据；后续回看仅用于历史验证，不参与触发。',
      '复权、停牌、异常成交和数据源差异可能改变标识结果。'
    ]
  });
}

function buildChartAnnotations(rawBars, period) {
  const bars = annotationBars(rawBars);
  const result = {
    schema: 'webstock.chart-annotations/v1',
    rulesVersion: CHART_ANNOTATION_RULES_VERSION,
    period: String(period || ''),
    methodReference: {
      title: 'TradingView Pivot Points Standard',
      url: 'https://www.tradingview.com/support/solutions/43000521824-pivot-points-standard/',
      usage: 'traditional-pivot-formula-reference'
    },
    currentLevels: null,
    keyLevels: buildKeyLevels(bars, period),
    events: [],
    limitations: [
      '压力与支撑采用前一完整周期的传统枢轴点 R1/S1，仅描述参考价位，不是价格预测。',
      '历史事件的触发不使用未来数据；回看结果会明确标为后验验证。'
    ]
  };
  if (bars.length >= 2) {
    const previous = bars[bars.length - 2];
    const latest = bars[bars.length - 1];
    const pivot = (previous.high + previous.low + previous.close) / 3;
    const resistance = 2 * pivot - previous.low;
    const support = 2 * pivot - previous.high;
    result.currentLevels = {
      pivot: round(pivot),
      resistance: {
        price: round(resistance),
        label: 'R1 压力',
        shortLabel: '压',
        basis: '前一完整周期 OHLC 传统枢轴点',
        distancePct: round((resistance - latest.close) / latest.close * 100),
        sourceDate: previous.date,
        triggerUsesFutureData: false
      },
      support: {
        price: round(support),
        label: 'S1 支撑',
        shortLabel: '撑',
        basis: '前一完整周期 OHLC 传统枢轴点',
        distancePct: round((support - latest.close) / latest.close * 100),
        sourceDate: previous.date,
        triggerUsesFutureData: false
      }
    };
  }
  for (let index = 20; index < bars.length; index += 1) {
    const event = chartEvent(bars, index);
    if (event) result.events.push(event);
  }
  result.events = result.events.slice(-16);
  return result;
}

function analyzeChart(rawInput) {
  const input = validateInput(rawInput);
  const normalized = normalizeBars(input.bars, input.asOf.timestamp);
  const result = createResult(input, normalized);
  result.chartAnnotations = buildChartAnnotations(normalized.bars, input.period);

  if (normalized.invalidBars) {
    uniquePush(result.limitations, ['已排除 ' + normalized.invalidBars + ' 根日期或收盘价无效的数据。']);
  }
  if (normalized.excludedFutureBars) {
    uniquePush(result.limitations, ['已排除 ' + normalized.excludedFutureBars + ' 根晚于 asOf 的数据，避免使用截止时间之后的信息。']);
  }
  if (result.status === 'insufficient') {
    uniquePush(result.limitations, [
      '有效数据不足：至少需要 ' + MIN_ANALYSIS_BARS + ' 根收盘数据，当前只有 ' + normalized.bars.length + ' 根。'
    ]);
    result.decisionGuide = buildDecisionGuide(result);
    return result;
  }

  addTrendObservation(result, normalized.bars);
  addPriceVolumeObservation(result, normalized.bars);
  addMacdObservation(result, normalized.bars);
  addRsiObservation(result, normalized.bars);
  addKdjObservation(result, normalized.bars);
  addBreakoutObservation(result, normalized.bars);
  addGapObservation(result, normalized.bars);
  result.decisionGuide = buildDecisionGuide(result);
  return result;
}

module.exports = {
  analyzeChart,
  buildDecisionGuide,
  buildChartAnnotations,
  buildKeyLevels,
  MIN_ANALYSIS_BARS,
  MIN_MACD_BARS,
  DECISION_RULES_VERSION,
  CHART_ANNOTATION_RULES_VERSION,
  KEY_LEVEL_RULES_VERSION
};
