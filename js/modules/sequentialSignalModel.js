(function(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.SequentialSignalModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const ruleset = 'sequential-public-rules-v1';
  const rule = '九转扩展规则 v1：严格价格翻转后连续比较前4根收盘，计1–9；检验8/9对6/7的完善条件。9后按收盘与前2根高/低比较非连续计1–13，13须通过对8的检验；含TDST、取消和循环重计。未收盘仅预览，不是买卖指令或商业版等价认证。';
  const limitations = [
    '公开规则的独立实现，未与授权商业版逐根对账，不声明完整商业版等价。',
    '未实现可选8对5检验、Intersection、Combo、商业版突破资格或风险价；循环范围采用100%–200%而非其他版本的161.8%。',
    '不推断交易日历或补造缺失K线；调用方须保留缺口、统一复权口径并提供真实周期。'
  ];

  function positive(value) {
    return (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number(value) > 0 && Number.isFinite(Number(value))
      ? Number(value) : null;
  }

  function timestamp(value) {
    const text = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(text + 'T00:00:00+08:00');
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text)) return Date.parse(text.replace(' ', 'T') + (text.length === 16 ? ':00' : '') + '+08:00');
    return Date.parse(text);
  }

  function normalize(row, options) {
    if (!row || row.gap || row.missing || row.synthetic) return { valid: false, reason: 'missing-bar' };
    const date = String(row.date || row.time || '');
    const start = timestamp(date);
    const values = { open: positive(row.open), high: positive(row.high), low: positive(row.low), close: positive(row.close) };
    if (!Number.isFinite(start) || Object.values(values).some(value => value === null) ||
      values.high < Math.max(values.open, values.close, values.low) || values.low > Math.min(values.open, values.close)) {
      return { valid: false, reason: 'invalid-ohlc-or-time', date };
    }
    const asOf = timestamp(options.asOf);
    if (Number.isFinite(asOf) && start > asOf) return { valid: false, reason: 'future-bar', date };
    let confirmation = 'unknown';
    let end = timestamp(row.endTime || row.closedAt);
    const timeframe = options.timeframe || 'day';
    if (!Number.isFinite(end)) {
      const local = new Date(start + 8 * 3600000);
      const day = local.toISOString().slice(0, 10);
      if (timeframe === 'day' || timeframe === 'daily') end = timestamp(day + ' 15:00:00');
      else if (timeframe === 'week' || timeframe === 'weekly') {
        const weekday = local.getUTCDay() || 7;
        local.setUTCDate(local.getUTCDate() + 5 - weekday);
        end = timestamp(local.toISOString().slice(0, 10) + ' 15:00:00');
      } else if (timeframe === 'month' || timeframe === 'monthly') {
        local.setUTCMonth(local.getUTCMonth() + 1, 0);
        end = timestamp(local.toISOString().slice(0, 10) + ' 15:00:00');
      } else if (/^(1|5|15|30|60)m$/.test(timeframe)) {
        end = start + (options.timestampMeaning === 'bar-end' ? 0 : parseInt(timeframe, 10) * 60000);
      }
    }
    if (row.incomplete === true || row.closed === false) confirmation = 'provisional';
    else if (row.incomplete === false || row.closed === true) confirmation = 'confirmed';
    else if (Number.isFinite(asOf) && Number.isFinite(end)) confirmation = asOf >= end ? 'confirmed' : 'provisional';
    return Object.assign(values, { valid: true, date, start, confirmation, provisional: confirmation !== 'confirmed' });
  }

  function emptyState() {
    return { setup: null, countdown: null, perfection: { buy: null, sell: null }, levels: { support: null, resistance: null } };
  }

  function calculateSeries(input, options) {
    const rows = Array.isArray(input) ? input : [];
    const settings = options || {};
    const bars = rows.map(row => normalize(row, settings));
    let state = emptyState();
    let lastTimestamp = null;
    let contiguous = 0;
    return bars.map(function(bar, index) {
      const confirmed = bar.valid && !bar.provisional;
      const events = [];
      const marks = [];
      const out = { index, date: String(bar.date || rows[index] && (rows[index].date || rows[index].time) || ''),
        available: false, confirmed: Boolean(confirmed), provisional: Boolean(bar.provisional),
        confirmation: bar.confirmation || 'unavailable', reason: bar.reason || '',
        setup: { direction: null, count: 0, runLength: 0, completed: false, perfected: false, triggered: false },
        countdown: { direction: null, count: 0, qualified: false, deferred: false, triggered: false },
        marks, events, levels: { support: null, resistance: null }, label: '数据不足', rule, ruleset };
      if (!bar.valid || lastTimestamp !== null && bar.start <= lastTimestamp) {
        out.reason = bar.reason || 'non-increasing-time';
        out.confirmed = false;
        out.confirmation = 'unavailable';
        if (state.countdown) events.push({ type: 'countdown-cancelled', reason: 'data-gap', direction: state.countdown.direction,
          index, sequenceId: state.countdown.id, confirmed: false });
        state = emptyState(); contiguous = 0;
        if (bar.valid && (lastTimestamp === null || bar.start > lastTimestamp)) lastTimestamp = bar.start;
        return out;
      }
      lastTimestamp = bar.start;
      const previous = bars[index - 1];
      const trueHigh = Math.max(bar.high, contiguous ? previous.close : bar.high);
      const trueLow = Math.min(bar.low, contiguous ? previous.close : bar.low);
      out.available = contiguous >= 5;
      out.reason = out.available ? '' : 'insufficient-contiguous-history';

      function event(type, direction, detail) {
        const value = Object.assign({ type, direction, index, date: bar.date, confirmed: Boolean(confirmed) }, detail || {});
        events.push(value);
        return value;
      }
      function mark(type, direction, label, sequenceId, detail) {
        marks.push(Object.assign({ type, direction, label: String(label), sequenceId, index, date: bar.date,
          price: direction === 'buy' ? bar.low : bar.high, confirmed: Boolean(confirmed), provisional: !confirmed,
          explanation: type === 'setup' ? '连续比较前4根收盘的第' + label + '根，不是反转保证'
            : type === 'countdown' ? '非连续衰竭计数' + label + '，比较前2根高低' : '查看规则与当根事件' }, detail || {}));
      }
      function cancel(reason) {
        if (!state.countdown) return;
        event('countdown-cancelled', state.countdown.direction, { reason, sequenceId: state.countdown.id });
        state.countdown = null;
      }
      function startCountdown(setup, reason) {
        const old = state.countdown;
        if (old && reason) {
          event('countdown-recycled', setup.direction, { reason, sequenceId: old.id });
          mark('recycle', setup.direction, 'R', old.id);
        }
        state.countdown = { direction: setup.direction, count: 0, close8: null,
          id: setup.direction + '-countdown-' + index, setupId: setup.id,
          range: setup.high - setup.low, tdst: setup.direction === 'buy' ? setup.high : setup.low };
      }

      ['support', 'resistance'].forEach(function(key) {
        const level = state.levels[key];
        if (level && level.active && (key === 'resistance' ? trueLow > level.price : trueHigh < level.price)) {
          state.levels[key] = Object.assign({}, level, { active: false, breachedAt: index });
          event('tdst-breached', key === 'resistance' ? 'buy' : 'sell', { level: level.price });
        }
      });
      if (state.countdown && (state.countdown.direction === 'buy' ? trueLow > state.countdown.tdst : trueHigh < state.countdown.tdst)) cancel('tdst-breach');

      if (contiguous >= 5) {
        const comparison = bar.close - bars[index - 4].close;
        const priorComparison = previous.close - bars[index - 5].close;
        const direction = comparison < 0 ? 'buy' : comparison > 0 ? 'sell' : null;
        const flip = direction && (direction === 'buy' ? priorComparison > 0 : priorComparison < 0);
        if (state.setup && state.setup.direction === direction) {
          state.setup.count += 1;
          state.setup.high = Math.max(state.setup.high, trueHigh);
          state.setup.low = Math.min(state.setup.low, trueLow);
        } else if (flip) {
          state.setup = { direction, count: 1, startIndex: index, id: direction + '-setup-' + index,
            high: trueHigh, low: trueLow, perfected: false };
          event('price-flip', direction);
        } else state.setup = null;
      } else state.setup = null;

      const setup = state.setup;
      if (setup) {
        if (setup.count <= 9) mark('setup', setup.direction, setup.count, setup.id);
        if (setup.count === 9) {
          const sixth = bars[setup.startIndex + 5];
          const seventh = bars[setup.startIndex + 6];
          const eighth = bars[index - 1];
          const threshold = setup.direction === 'buy' ? Math.min(sixth.low, seventh.low) : Math.max(sixth.high, seventh.high);
          setup.perfected = setup.direction === 'buy' ? Math.min(eighth.low, bar.low) < threshold : Math.max(eighth.high, bar.high) > threshold;
          const levelKey = setup.direction === 'buy' ? 'resistance' : 'support';
          state.levels[levelKey] = { price: setup.direction === 'buy' ? setup.high : setup.low,
            originIndex: index, sequenceId: setup.id, active: true, confirmed: Boolean(confirmed) };
          state.perfection[setup.direction] = setup.perfected ? null : { threshold, sequenceId: setup.id };
          state.perfection[setup.direction === 'buy' ? 'sell' : 'buy'] = null;
          event('setup-complete', setup.direction, { sequenceId: setup.id, perfected: setup.perfected });
          if (state.countdown && state.countdown.direction !== setup.direction) cancel('opposite-setup');
          if (!state.countdown) startCountdown(setup);
          else {
            const ratio = state.countdown.range > 0 ? (setup.high - setup.low) / state.countdown.range : 0;
            if (ratio >= 1 && ratio <= 2) startCountdown(setup, 'setup-range');
          }
        }
        if (setup.count === 22 && state.countdown && state.countdown.direction === setup.direction) startCountdown(setup, 'setup-22');
        out.setup = { direction: setup.direction, count: Math.min(9, setup.count), runLength: setup.count,
          completed: setup.count >= 9, perfected: setup.perfected,
          triggered: setup.count === 9 && Boolean(confirmed), sequenceId: setup.id };
      }

      ['buy', 'sell'].forEach(function(direction) {
        const pending = state.perfection[direction];
        if (pending && (direction === 'buy' ? bar.low < pending.threshold : bar.high > pending.threshold)) {
          event('setup-perfected', direction, { sequenceId: pending.sequenceId });
          mark('perfection', direction, '✓', pending.sequenceId);
          if (setup && setup.id === pending.sequenceId) { setup.perfected = true; out.setup.perfected = true; }
          state.perfection[direction] = null;
        }
      });

      const countdown = state.countdown;
      if (countdown && contiguous >= 2) {
        const reference = bars[index - 2];
        const qualified = countdown.direction === 'buy' ? bar.close <= reference.low : bar.close >= reference.high;
        const deferred = qualified && countdown.count === 12 &&
          (countdown.direction === 'buy' ? bar.low > countdown.close8 : bar.high < countdown.close8);
        if (qualified && !deferred) {
          countdown.count += 1;
          if (countdown.count === 8) countdown.close8 = bar.close;
          mark('countdown', countdown.direction, countdown.count, countdown.id);
        } else if (deferred) mark('countdown-deferred', countdown.direction, '+', countdown.id,
          { explanation: '本根满足计数条件，但13对8检验未通过，保留12并继续等待' });
        out.countdown = { direction: countdown.direction, count: countdown.count, qualified, deferred,
          triggered: countdown.count === 13 && Boolean(confirmed), sequenceId: countdown.id };
        if (countdown.count === 13) {
          event('countdown-complete', countdown.direction, { sequenceId: countdown.id });
          state.countdown = null;
        }
      }

      out.levels = { support: state.levels.support && Object.assign({}, state.levels.support),
        resistance: state.levels.resistance && Object.assign({}, state.levels.resistance) };
      out.label = out.countdown.direction ? (out.countdown.direction === 'buy' ? '低位' : '高位') + '计数 ' + out.countdown.count + (out.countdown.deferred ? '+' : '')
        : setup ? (setup.direction === 'buy' ? '下行' : '上行') + '准备 ' + Math.min(9, setup.count) : out.available ? '等待价格翻转' : '连续样本不足';
      if (bar.provisional) {
        out.label += bar.confirmation === 'unknown' ? '·收盘状态未知' : '·未收盘预览';
        // A provisional bar is not carried into future confirmed bars, including malformed historical feeds.
        state = emptyState(); contiguous = 0;
      } else contiguous += 1;
      return out;
    });
  }

  function evaluateHistory(input, options) {
    const rows = Array.isArray(input) ? input : [];
    const settings = options || {};
    const horizons = [...new Set((settings.horizons || [1, 5, 20]).filter(value => Number.isInteger(value) && value > 0 && value <= 1000))];
    const bars = rows.map(row => normalize(row, settings));
    const series = calculateSeries(rows, settings);
    const events = [];
    series.forEach(function(item) {
      item.events.filter(event => event.confirmed && ['setup-complete', 'countdown-complete'].includes(event.type)).forEach(function(event) {
        const close = bars[item.index].close;
        const outcomes = {};
        horizons.forEach(function(horizon) {
          const following = bars.slice(item.index + 1, item.index + 1 + horizon);
          const invalid = following.some((bar, offset) => !bar.valid && bar.reason !== 'future-bar' || series[item.index + offset + 1].reason === 'non-increasing-time');
          const pending = following.length < horizon || following.some(bar => bar.provisional || bar.reason === 'future-bar');
          const status = invalid ? 'invalid' : pending ? 'pending' : 'available';
          const last = following[following.length - 1];
          outcomes[horizon] = { status, returnPct: status === 'available' ? Math.round((last.close / close - 1) * 10000) / 100 : null,
            endDate: status === 'available' ? last.date : null };
        });
        events.push(Object.assign({}, event, { close, outcomes }));
      });
    });
    return { ruleset, events, barCount: rows.length, confirmedBarCount: series.filter(item => item.confirmed).length,
      from: String(bars[0] && bars[0].date || ''), to: String(bars.at(-1) && bars.at(-1).date || ''), horizons,
      triggerUsesFutureData: false, validationUsesFutureData: true, isTradingBacktest: false,
      limitation: '仅核对已加载且已收盘K线的事件后收益；不含交易成本、滑点、可成交性、停牌或复权变化，不证明投资有效性。' };
  }

  return { ruleset, rule, limitations, calculateSeries, evaluateHistory };
});
