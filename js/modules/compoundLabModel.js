(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CompoundLabModel = api;
})(typeof window !== 'undefined' ? window : null, function() {
  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback === undefined ? 0 : fallback);
  }

  function round(value, digits) {
    const places = digits === undefined ? 2 : digits;
    const factor = Math.pow(10, places);
    return Math.round((number(value) + Number.EPSILON) * factor) / factor;
  }

  function monthsFromYears(years) {
    const value = number(years, NaN);
    if (!Number.isFinite(value) || value <= 0) throw new Error('期限必须大于 0 年');
    if (value > 50) throw new Error('期限不能超过 50 年');
    return Math.max(1, Math.round(value * 12));
  }

  function monthlyRateFromAnnualPercent(annualRatePercent) {
    const annualRate = number(annualRatePercent, NaN) / 100;
    if (!Number.isFinite(annualRate) || annualRate <= -1) throw new Error('年化收益率必须大于 -100%');
    return Math.pow(1 + annualRate, 1 / 12) - 1;
  }

  function futureValueRaw(input) {
    const months = monthsFromYears(input.years);
    const initialCapital = number(input.initialCapital, NaN);
    const monthlyContribution = number(input.monthlyContribution, NaN);
    if (!Number.isFinite(initialCapital) || initialCapital < 0) throw new Error('当前资产不能小于 0');
    if (!Number.isFinite(monthlyContribution) || monthlyContribution < 0) throw new Error('月度投入不能小于 0');
    const monthlyRate = monthlyRateFromAnnualPercent(input.annualRatePercent);
    let assets = initialCapital;
    for (let month = 1; month <= months; month += 1) {
      assets = assets * (1 + monthlyRate) + monthlyContribution;
    }
    return assets;
  }

  function projectCompoundPlan(input) {
    input = input || {};
    const months = monthsFromYears(input.years);
    const initialCapital = number(input.initialCapital, NaN);
    const monthlyContribution = number(input.monthlyContribution, NaN);
    if (!Number.isFinite(initialCapital) || initialCapital < 0) throw new Error('当前资产不能小于 0');
    if (!Number.isFinite(monthlyContribution) || monthlyContribution < 0) throw new Error('月度投入不能小于 0');
    const annualRatePercent = number(input.annualRatePercent, NaN);
    const monthlyRate = monthlyRateFromAnnualPercent(annualRatePercent);
    let assets = initialCapital;
    const points = [{
      month: 0,
      assets: round(assets, 2),
      contributions: round(initialCapital, 2),
      investmentGain: 0
    }];
    for (let month = 1; month <= months; month += 1) {
      assets = assets * (1 + monthlyRate) + monthlyContribution;
      const contributions = initialCapital + monthlyContribution * month;
      points.push({
        month,
        assets: round(assets, 2),
        contributions: round(contributions, 2),
        investmentGain: round(assets - contributions, 2)
      });
    }
    const totalContributions = initialCapital + monthlyContribution * months;
    return {
      months,
      annualRatePercent: round(annualRatePercent, 6),
      monthlyRatePercent: round(monthlyRate * 100, 6),
      totalContributions: round(totalContributions, 2),
      finalAssets: round(assets, 2),
      investmentGain: round(assets - totalContributions, 2),
      points
    };
  }

  function solveRequiredAnnualRate(input) {
    input = input || {};
    const targetCapital = number(input.targetCapital, NaN);
    if (!Number.isFinite(targetCapital) || targetCapital <= 0) throw new Error('目标资产必须大于 0');
    monthsFromYears(input.years);
    const base = {
      initialCapital: input.initialCapital,
      monthlyContribution: input.monthlyContribution,
      years: input.years
    };
    let lower = -0.999999;
    let upper = 1;
    const valueAt = function(rate) {
      return futureValueRaw(Object.assign({}, base, { annualRatePercent: rate * 100 }));
    };
    if (targetCapital < valueAt(lower)) throw new Error('目标低于当前投入路径可求解范围');
    while (valueAt(upper) < targetCapital && upper < 1024) upper = upper * 2 + 1;
    if (valueAt(upper) < targetCapital) throw new Error('目标资产超出当前求解范围');
    for (let index = 0; index < 120; index += 1) {
      const mid = (lower + upper) / 2;
      if (valueAt(mid) < targetCapital) lower = mid;
      else upper = mid;
    }
    return round(((lower + upper) / 2) * 100, 6);
  }

  function positionValue(position) {
    if (!position) return 0;
    const marketValueMissing = position.marketValue === null || position.marketValue === undefined || position.marketValue === '';
    if (!marketValueMissing) {
      const marketValue = Number(position.marketValue);
      if (Number.isFinite(marketValue) && marketValue >= 0) return marketValue;
    }
    const costValueMissing = position.costValue === null || position.costValue === undefined || position.costValue === '';
    if (!costValueMissing) {
      const costValue = Number(position.costValue);
      if (Number.isFinite(costValue) && costValue >= 0) return costValue;
    }
    return 0;
  }

  function analyzeConcentration(positions, cashBalance) {
    const cash = Math.max(0, number(cashBalance));
    const normalized = (positions || []).map(function(position) {
      return Object.assign({}, position, { value: positionValue(position) });
    }).filter(function(position) { return position.value > 0; });
    const equityValue = normalized.reduce(function(sum, position) { return sum + position.value; }, 0);
    const totalAssets = equityValue + cash;
    const weighted = normalized.map(function(position) {
      return Object.assign({}, position, {
        weightPercent: totalAssets > 0 ? position.value / totalAssets * 100 : 0,
        equityWeightPercent: equityValue > 0 ? position.value / equityValue * 100 : 0
      });
    }).sort(function(a, b) { return b.weightPercent - a.weightPercent; });
    const cashPercent = totalAssets > 0 ? cash / totalAssets * 100 : 0;
    const hhi = equityValue > 0 ? weighted.reduce(function(sum, position) {
      return sum + Math.pow(position.equityWeightPercent, 2);
    }, 0) : null;
    const top1Percent = weighted.length ? weighted[0].weightPercent : 0;
    const top3Percent = weighted.slice(0, 3).reduce(function(sum, position) { return sum + position.weightPercent; }, 0);
    let level = equityValue > 0 ? 'balanced' : 'unavailable';
    if (equityValue > 0 && (top1Percent > 35 || hhi > 2500)) level = 'high';
    else if (equityValue > 0 && (top1Percent > 20 || hhi > 1500)) level = 'medium';
    return {
      totalAssets: round(totalAssets, 2),
      equityValue: round(equityValue, 2),
      cashBalance: round(cash, 2),
      cashPercent: round(cashPercent, 2),
      top1Percent: round(top1Percent, 2),
      top3Percent: round(top3Percent, 2),
      hhi: hhi === null ? null : round(hhi, 2),
      positionCount: weighted.length,
      level,
      positions: weighted.map(function(position) {
        return Object.assign({}, position, {
          weightPercent: round(position.weightPercent, 2),
          equityWeightPercent: round(position.equityWeightPercent, 2)
        });
      })
    };
  }

  function buildMonthlyDateSeries(startDate, months) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startDate || ''));
    const count = Number(months);
    if (!match) throw new Error('开始日期格式必须为 YYYY-MM-DD');
    if (!Number.isInteger(count) || count < 0) throw new Error('月份数量必须是非负整数');
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, monthIndex, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== monthIndex || parsed.getUTCDate() !== day) {
      throw new Error('开始日期无效');
    }
    const format = function(date) {
      return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
    };
    const dates = [format(parsed)];
    for (let offset = 1; offset <= count; offset += 1) {
      dates.push(format(new Date(Date.UTC(year, monthIndex + offset + 1, 0))));
    }
    return dates;
  }

  function drawdownRecovery(drawdownPercent) {
    const drawdown = Math.abs(number(drawdownPercent, NaN));
    if (!Number.isFinite(drawdown) || drawdown < 0 || drawdown >= 100) throw new Error('回撤必须在 0% 到 100% 之间');
    if (drawdown === 0) return 0;
    return round(drawdown / (100 - drawdown) * 100, 2);
  }

  function normalizeSnapshots(snapshots) {
    const byDate = new Map();
    (snapshots || []).forEach(function(snapshot) {
      const date = String(snapshot.snapshotDate || snapshot.snapshotAt || '').slice(0, 10);
      const assets = number(snapshot.totalAssets !== undefined ? snapshot.totalAssets : snapshot.totalValue, NaN);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(assets) || assets <= 0) return;
      byDate.set(date, { snapshotDate: date, totalAssets: assets });
    });
    return Array.from(byDate.values()).sort(function(a, b) { return a.snapshotDate.localeCompare(b.snapshotDate); });
  }

  function daysBetween(start, end) {
    const startTime = Date.parse(start + 'T00:00:00Z');
    const endTime = Date.parse(end + 'T00:00:00Z');
    return Math.max(0, Math.round((endTime - startTime) / 86400000));
  }

  function analyzeSnapshotDrawdown(snapshots) {
    const normalized = normalizeSnapshots(snapshots);
    let highWater = null;
    let maximumDrawdownPercent = 0;
    normalized.forEach(function(snapshot) {
      highWater = highWater === null ? snapshot.totalAssets : Math.max(highWater, snapshot.totalAssets);
      const drawdown = highWater > 0 ? (highWater - snapshot.totalAssets) / highWater * 100 : 0;
      maximumDrawdownPercent = Math.max(maximumDrawdownPercent, drawdown);
    });
    const spanDays = normalized.length > 1
      ? daysBetween(normalized[0].snapshotDate, normalized[normalized.length - 1].snapshotDate)
      : 0;
    const ready = normalized.length >= 3 && spanDays >= 30;
    let reason = '';
    if (normalized.length < 3) reason = '至少需要 3 个不同日期的账户快照';
    else if (spanDays < 30) reason = '快照跨度不足 30 天';
    return {
      ready,
      reason,
      cashFlowAdjusted: false,
      metricLabel: '总资产峰谷降幅（未剔除外部资金流）',
      snapshotCount: normalized.length,
      spanDays,
      maximumDrawdownPercent: normalized.length ? round(maximumDrawdownPercent, 2) : null,
      recoveryPercent: normalized.length ? drawdownRecovery(maximumDrawdownPercent) : null,
      currentAssets: normalized.length ? round(normalized[normalized.length - 1].totalAssets, 2) : null,
      highWaterAssets: highWater === null ? null : round(highWater, 2),
      snapshots: normalized
    };
  }

  function holdingDays(position) {
    if (!position || !position.firstTradeDate || !position.lastTradeDate) return null;
    return daysBetween(String(position.firstTradeDate).slice(0, 10), String(position.lastTradeDate).slice(0, 10));
  }

  function analyzeClosedPositions(closedPositions, trades) {
    const closed = (closedPositions || []).filter(function(position) {
      if (!position || position.realizedPnl === null || position.realizedPnl === undefined || position.realizedPnl === '') return false;
      return Number.isFinite(Number(position.realizedPnl));
    });
    const costs = (trades || []).reduce(function(sum, trade) {
      return sum + Math.max(0, number(trade.fee)) + Math.max(0, number(trade.tax));
    }, 0);
    if (!closed.length) {
      return {
        ready: false,
        reason: '尚无已关闭股票样本',
        sampleCount: 0,
        winRatePercent: null,
        averageWin: null,
        averageLoss: null,
        payoffRatio: null,
        profitFactor: null,
        expectancy: null,
        averageHoldingDays: null,
        recordedCosts: round(costs, 2),
        sampleUnit: '按股票全历史汇总'
      };
    }
    const wins = closed.filter(function(position) { return number(position.realizedPnl) > 0; });
    const losses = closed.filter(function(position) { return number(position.realizedPnl) < 0; });
    const grossProfit = wins.reduce(function(sum, position) { return sum + number(position.realizedPnl); }, 0);
    const grossLoss = Math.abs(losses.reduce(function(sum, position) { return sum + number(position.realizedPnl); }, 0));
    const averageWin = wins.length ? grossProfit / wins.length : null;
    const averageLoss = losses.length ? grossLoss / losses.length : null;
    const durations = closed.map(holdingDays).filter(function(value) { return value !== null; });
    return {
      ready: true,
      reason: closed.length < 20 ? '样本较少，仅用于描述，不代表稳定胜率' : '',
      sampleCount: closed.length,
      winCount: wins.length,
      lossCount: losses.length,
      breakEvenCount: closed.length - wins.length - losses.length,
      winRatePercent: round(wins.length / closed.length * 100, 2),
      averageWin: averageWin === null ? null : round(averageWin, 2),
      averageLoss: averageLoss === null ? null : round(averageLoss, 2),
      payoffRatio: averageWin === null || !averageLoss ? null : round(averageWin / averageLoss, 2),
      profitFactor: grossLoss ? round(grossProfit / grossLoss, 2) : null,
      expectancy: round(closed.reduce(function(sum, position) { return sum + number(position.realizedPnl); }, 0) / closed.length, 2),
      averageHoldingDays: durations.length ? round(durations.reduce(function(sum, value) { return sum + value; }, 0) / durations.length, 2) : null,
      recordedCosts: round(costs, 2),
      sampleUnit: '按股票全历史汇总'
    };
  }

  function buildRebalanceDraft(positions, cashBalance, maxWeightPercent, lotSize) {
    const maxWeight = number(maxWeightPercent, NaN);
    const lot = Math.max(1, Math.trunc(number(lotSize, 100)));
    if (!Number.isFinite(maxWeight) || maxWeight <= 0 || maxWeight >= 100) throw new Error('单股上限必须在 0% 到 100% 之间');
    const concentration = analyzeConcentration(positions, cashBalance);
    const maximumValue = concentration.totalAssets * maxWeight / 100;
    const items = concentration.positions.filter(function(position) {
      return position.value > maximumValue + 0.01;
    }).map(function(position) {
      const price = number(position.currentPrice, NaN);
      const excessValue = position.value - maximumValue;
      const quantity = Math.max(0, Math.trunc(number(position.quantity)));
      const paperQuantity = Number.isFinite(price) && price > 0
        ? Math.min(quantity, Math.floor(excessValue / price / lot) * lot)
        : 0;
      return {
        code: position.code || '',
        name: position.name || '',
        currentWeightPercent: round(position.weightPercent, 2),
        maximumWeightPercent: round(maxWeight, 2),
        excessValue: round(excessValue, 2),
        referencePrice: Number.isFinite(price) && price > 0 ? round(price, 3) : null,
        paperQuantity,
        actionable: paperQuantity >= lot,
        note: paperQuantity >= lot ? '纸面测算，不会提交订单' : '不足一手或缺少有效价格，不生成数量'
      };
    });
    return {
      totalAssets: concentration.totalAssets,
      maxWeightPercent: round(maxWeight, 2),
      lotSize: lot,
      items
    };
  }

  function estimateCostDrag(input) {
    input = input || {};
    const initialCapital = number(input.initialCapital, NaN);
    const annualTurnoverPercent = number(input.annualTurnoverPercent, NaN);
    const effectiveFeeRatePercent = number(input.effectiveFeeRatePercent, NaN);
    const years = number(input.years, NaN);
    if (!Number.isFinite(initialCapital) || initialCapital < 0) throw new Error('本金不能小于 0');
    if (!Number.isFinite(annualTurnoverPercent) || annualTurnoverPercent < 0) throw new Error('年换手率不能小于 0');
    if (!Number.isFinite(effectiveFeeRatePercent) || effectiveFeeRatePercent < 0) throw new Error('综合费率不能小于 0');
    if (!Number.isFinite(years) || years <= 0) throw new Error('期限必须大于 0 年');
    const annualDrag = annualTurnoverPercent / 100 * effectiveFeeRatePercent / 100;
    if (annualDrag >= 1) throw new Error('换手与费率组合导致年费用率达到或超过 100%');
    const remainingCapital = initialCapital * Math.pow(1 - annualDrag, years);
    return {
      annualDragPercent: round(annualDrag * 100, 4),
      remainingCapital: round(remainingCapital, 2),
      cumulativeCost: round(initialCapital - remainingCapital, 2),
      assumption: '固定本金路径下的简化换手费用估算，不含收益、滑点与税制变化'
    };
  }

  function runStressScenarios(positions, cashBalance, shocks) {
    const cash = Math.max(0, number(cashBalance));
    const equityValue = (positions || []).reduce(function(sum, position) { return sum + positionValue(position); }, 0);
    const startingAssets = equityValue + cash;
    return (shocks || [-5, -10, -20]).map(function(shockValue) {
      const shockPercent = number(shockValue);
      const shockedEquity = equityValue * (1 + shockPercent / 100);
      const totalAssets = cash + shockedEquity;
      return {
        shockPercent: round(shockPercent, 2),
        equityValue: round(shockedEquity, 2),
        totalAssets: round(totalAssets, 2),
        lossAmount: round(totalAssets - startingAssets, 2),
        lossPercent: startingAssets > 0 ? round((totalAssets - startingAssets) / startingAssets * 100, 2) : 0
      };
    });
  }

  function assessDataReadiness(input) {
    input = input || {};
    const drawdown = analyzeSnapshotDrawdown(input.snapshots || []);
    const closedCount = (input.closedPositions || []).length;
    const positionCount = (input.positions || []).length;
    const tradeCount = (input.trades || []).length;
    return {
      targetPath: { status: 'ready', detail: '确定性数学计算，可立即使用；不是收益预测' },
      snapshotHistory: {
        status: drawdown.ready ? 'ready' : 'insufficient',
        detail: drawdown.ready
          ? drawdown.snapshotCount + ' 个快照，跨度 ' + drawdown.spanDays + ' 天；未剔除外部资金流'
          : drawdown.reason
      },
      tradeLedger: {
        status: closedCount >= 20 ? 'ready' : (closedCount > 0 ? 'limited' : 'insufficient'),
        detail: closedCount + ' 个已关闭股票汇总 · ' + tradeCount + ' 条交易记录'
      },
      currentPortfolio: {
        status: positionCount > 0 ? 'ready' : 'insufficient',
        detail: positionCount > 0 ? positionCount + ' 只当前持仓' : '没有当前持仓，无法计算结构风险'
      },
      commentMethods: {
        status: 'validation-required',
        detail: '评论只作为方法线索；需明确标的、方向、时间与退出规则后才能回测'
      }
    };
  }

  function requiredFinite(value, label) {
    if (value === null || value === undefined || value === '' || (typeof value === 'string' && !value.trim())) {
      throw new Error(label + '不能为空');
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(label + '必须是有效数字');
    return parsed;
  }

  function strictNumberList(values, label, maxItems) {
    if (!Array.isArray(values) || !values.length) throw new Error(label + '不能为空');
    if (values.length > maxItems) throw new Error(label + '最多允许 ' + maxItems + ' 项');
    return values.map(function(value, index) {
      return requiredFinite(value, label + '第 ' + (index + 1) + ' 项');
    });
  }

  function calculatePositionSize(input) {
    input = input || {};
    const equity = requiredFinite(input.equity, '账户权益');
    const availableCash = requiredFinite(input.availableCash, '可用资金');
    const riskPercent = requiredFinite(input.riskPercent, '风险比例');
    const entryPrice = requiredFinite(input.entryPrice, '入场价');
    const stopPrice = requiredFinite(input.stopPrice, '止损价');
    const maxPositionPercent = requiredFinite(input.maxPositionPercent, '仓位上限');
    const riskBufferPerShare = input.riskBufferPerShare === undefined
      ? 0 : requiredFinite(input.riskBufferPerShare, '每股风险缓冲');
    const lotSize = input.lotSize === undefined ? 100 : requiredFinite(input.lotSize, '每手股数');
    if (equity <= 0) throw new Error('账户权益必须大于 0');
    if (availableCash < 0) throw new Error('可用资金不能小于 0');
    if (riskPercent <= 0 || riskPercent > 100) throw new Error('风险比例必须在 0% 到 100% 之间');
    if (entryPrice <= 0) throw new Error('入场价必须大于 0');
    if (stopPrice <= 0 || stopPrice >= entryPrice) throw new Error('止损价必须大于 0 且低于入场价');
    if (maxPositionPercent <= 0 || maxPositionPercent > 100) throw new Error('仓位上限必须在 0% 到 100% 之间');
    if (riskBufferPerShare < 0) throw new Error('每股风险缓冲不能小于 0');
    if (!Number.isInteger(lotSize) || lotSize <= 0) throw new Error('每手股数必须是正整数');
    const riskBudget = equity * riskPercent / 100;
    const riskPerShare = entryPrice - stopPrice + riskBufferPerShare;
    const capitalBudget = Math.min(availableCash, equity * maxPositionPercent / 100);
    const riskQuantity = Math.floor(riskBudget / riskPerShare / lotSize) * lotSize;
    const capitalQuantity = Math.floor(capitalBudget / entryPrice / lotSize) * lotSize;
    const quantity = Math.max(0, Math.min(riskQuantity, capitalQuantity));
    let bindingConstraint = 'both';
    if (riskQuantity < capitalQuantity) bindingConstraint = 'risk-budget';
    else if (capitalQuantity < riskQuantity) bindingConstraint = availableCash < equity * maxPositionPercent / 100 ? 'available-cash' : 'position-cap';
    return {
      riskBudget: round(riskBudget, 2),
      riskPerShare: round(riskPerShare, 4),
      capitalBudget: round(capitalBudget, 2),
      riskLimitedQuantity: riskQuantity,
      capitalLimitedQuantity: capitalQuantity,
      quantity,
      positionValue: round(quantity * entryPrice, 2),
      actualRisk: round(quantity * riskPerShare, 2),
      positionWeightPercent: round(quantity * entryPrice / equity * 100, 2),
      bindingConstraint
    };
  }

  function calculateBreakEvenExit(input) {
    input = input || {};
    const costBasis = requiredFinite(input.costBasis, '持仓成本');
    const quantity = requiredFinite(input.quantity, '持仓数量');
    const fixedExitCost = requiredFinite(input.fixedExitCost, '固定退出费用');
    const exitRatePercent = requiredFinite(input.exitRatePercent, '退出费率');
    if (costBasis <= 0) throw new Error('持仓成本必须大于 0');
    if (quantity <= 0) throw new Error('持仓数量必须大于 0');
    if (fixedExitCost < 0) throw new Error('固定退出费用不能小于 0');
    if (exitRatePercent < 0 || exitRatePercent >= 100) throw new Error('退出费率必须在 0% 到 100% 之间');
    const exitFactor = 1 - exitRatePercent / 100;
    const breakEvenPrice = (costBasis + fixedExitCost) / (quantity * exitFactor);
    const costBasisPerShare = costBasis / quantity;
    return {
      breakEvenPrice: round(breakEvenPrice, 6),
      costBasisPerShare: round(costBasisPerShare, 6),
      requiredRisePercent: round((breakEvenPrice - costBasisPerShare) / costBasisPerShare * 100, 6),
      exitRatePercent: round(exitRatePercent, 6)
    };
  }

  function analyzeRiskReward(input) {
    input = input || {};
    const entryPrice = requiredFinite(input.entryPrice, '入场价');
    const stopPrice = requiredFinite(input.stopPrice, '止损价');
    const targetPrice = requiredFinite(input.targetPrice, '目标价');
    const roundTripCostPerShare = requiredFinite(input.roundTripCostPerShare, '每股往返成本');
    if (entryPrice <= 0) throw new Error('入场价必须大于 0');
    if (stopPrice <= 0 || stopPrice >= entryPrice) throw new Error('止损价必须大于 0 且低于入场价');
    if (targetPrice <= entryPrice) throw new Error('目标价必须高于入场价');
    if (roundTripCostPerShare < 0) throw new Error('每股往返成本不能小于 0');
    const netRiskPerShare = entryPrice - stopPrice + roundTripCostPerShare;
    const netRewardPerShare = targetPrice - entryPrice - roundTripCostPerShare;
    if (netRewardPerShare <= 0) throw new Error('扣除往返成本后净回报必须大于 0');
    return {
      netRiskPerShare: round(netRiskPerShare, 6),
      netRewardPerShare: round(netRewardPerShare, 6),
      rewardRiskRatio: round(netRewardPerShare / netRiskPerShare, 6),
      breakEvenWinRatePercent: round(netRiskPerShare / (netRiskPerShare + netRewardPerShare) * 100, 6),
      stopLossPercent: round((entryPrice - stopPrice) / entryPrice * 100, 4),
      targetGainPercent: round((targetPrice - entryPrice) / entryPrice * 100, 4)
    };
  }

  function analyzeExpectancy(input) {
    input = input || {};
    const winRatePercent = requiredFinite(input.winRatePercent, '胜率');
    const lossRatePercent = requiredFinite(input.lossRatePercent, '负率');
    const averageWin = requiredFinite(input.averageWin, '平均盈利');
    const averageLoss = requiredFinite(input.averageLoss, '平均亏损');
    if (winRatePercent < 0 || winRatePercent > 100) throw new Error('胜率必须在 0% 到 100% 之间');
    if (lossRatePercent < 0 || lossRatePercent > 100) throw new Error('负率必须在 0% 到 100% 之间');
    if (winRatePercent + lossRatePercent > 100) throw new Error('胜率与负率合计不能超过 100%');
    if (winRatePercent + lossRatePercent <= 0) throw new Error('胜率与负率至少一项必须大于 0%');
    if (averageWin < 0 || averageLoss < 0) throw new Error('平均盈利和平均亏损不能小于 0');
    if (averageWin + averageLoss <= 0) throw new Error('平均盈利和平均亏损不能同时为 0');
    const winProbability = winRatePercent / 100;
    const lossProbability = lossRatePercent / 100;
    const grossProfitContribution = winProbability * averageWin;
    const grossLossContribution = lossProbability * averageLoss;
    const conditionalBreakEvenWinRatePercent = averageLoss / (averageWin + averageLoss) * 100;
    const activeOutcomeRate = (winRatePercent + lossRatePercent) / 100;
    return {
      expectedValue: round(grossProfitContribution - grossLossContribution, 6),
      profitFactor: grossLossContribution > 0 ? round(grossProfitContribution / grossLossContribution, 6) : null,
      breakEvenWinRatePercent: round(conditionalBreakEvenWinRatePercent * activeOutcomeRate, 6),
      conditionalBreakEvenWinRatePercent: round(conditionalBreakEvenWinRatePercent, 6),
      flatRatePercent: round(100 - winRatePercent - lossRatePercent, 6),
      assumption: 'user-entered-outcome-rates'
    };
  }

  function calculateLossPath(input) {
    input = input || {};
    const initialEquity = requiredFinite(input.initialEquity, '初始权益');
    const riskPercent = requiredFinite(input.riskPercent, '每次风险比例');
    const consecutiveLosses = requiredFinite(input.consecutiveLosses, '连续亏损次数');
    if (initialEquity <= 0) throw new Error('初始权益必须大于 0');
    if (riskPercent <= 0 || riskPercent >= 100) throw new Error('每次风险比例必须在 0% 到 100% 之间');
    if (!Number.isInteger(consecutiveLosses) || consecutiveLosses < 0 || consecutiveLosses > 1000) {
      throw new Error('连续亏损次数必须是 0 到 1000 的整数');
    }
    let equity = initialEquity;
    const points = [{ step: 0, equity: round(equity, 2), lossAmount: 0 }];
    for (let step = 1; step <= consecutiveLosses; step += 1) {
      const lossAmount = equity * riskPercent / 100;
      equity -= lossAmount;
      points.push({ step, equity: round(equity, 2), lossAmount: round(lossAmount, 2) });
    }
    const drawdownPercent = (initialEquity - equity) / initialEquity * 100;
    return {
      initialEquity: round(initialEquity, 2),
      finalEquity: round(equity, 2),
      drawdownPercent: round(drawdownPercent, 2),
      recoveryPercent: drawdownRecovery(drawdownPercent),
      points
    };
  }

  function calculateLossRunExperiment(input) {
    input = input || {};
    const winRatePercent = requiredFinite(input.winRatePercent, '假设胜率');
    const trialCount = requiredFinite(input.trialCount, '试验次数');
    const streakLength = requiredFinite(input.streakLength, '连亏长度');
    if (winRatePercent < 0 || winRatePercent > 100) throw new Error('假设胜率必须在 0% 到 100% 之间');
    if (!Number.isInteger(trialCount) || trialCount < 1 || trialCount > 5000) throw new Error('试验次数必须是 1 到 5000 的整数');
    if (!Number.isInteger(streakLength) || streakLength < 1 || streakLength > 100) throw new Error('连亏长度必须是 1 到 100 的整数');
    const winProbability = winRatePercent / 100;
    const lossProbability = 1 - winProbability;
    let atLeastOneProbability = 0;
    if (streakLength <= trialCount) {
      let states = new Array(streakLength).fill(0);
      states[0] = 1;
      for (let trial = 0; trial < trialCount; trial += 1) {
        const next = new Array(streakLength).fill(0);
        const noRunProbability = states.reduce(function(sum, value) { return sum + value; }, 0);
        next[0] += noRunProbability * winProbability;
        for (let run = 0; run < streakLength - 1; run += 1) {
          next[run + 1] += states[run] * lossProbability;
        }
        states = next;
      }
      atLeastOneProbability = Math.max(0, Math.min(1, 1 - states.reduce(function(sum, value) { return sum + value; }, 0)));
    }
    return {
      nextStreakProbabilityPercent: round(Math.pow(lossProbability, streakLength) * 100, 6),
      atLeastOneStreakProbabilityPercent: round(atLeastOneProbability * 100, 6),
      assumption: 'independent-identically-distributed',
      trialCount,
      streakLength
    };
  }

  function calculateStagedAverage(input) {
    input = input || {};
    const cash = requiredFinite(input.cash, '总预算');
    const prices = strictNumberList(input.prices, '价格序列', 10);
    const weights = strictNumberList(input.weights, '资金权重', 10);
    const lotSize = input.lotSize === undefined ? 100 : requiredFinite(input.lotSize, '每手股数');
    if (cash <= 0) throw new Error('总预算必须大于 0');
    if (prices.length !== weights.length) throw new Error('价格序列与资金权重数量必须一致');
    if (prices.length < 2) throw new Error('分批计划至少需要 2 个阶段');
    if (prices.some(function(value) { return value <= 0; })) throw new Error('价格必须大于 0');
    if (weights.some(function(value) { return value <= 0; })) throw new Error('资金权重必须大于 0');
    if (!Number.isInteger(lotSize) || lotSize <= 0) throw new Error('每手股数必须是正整数');
    const weightTotal = weights.reduce(function(sum, value) { return sum + value; }, 0);
    if (Math.abs(weightTotal - 100) > 0.000001) throw new Error('资金权重合计必须等于 100%');
    const stages = prices.map(function(price, index) {
      const allocatedCash = cash * weights[index] / 100;
      const quantity = Math.floor(allocatedCash / price / lotSize) * lotSize;
      const spent = quantity * price;
      return {
        index: index + 1,
        price: round(price, 4),
        weightPercent: round(weights[index], 4),
        allocatedCash: round(allocatedCash, 2),
        quantity,
        spent: round(spent, 2),
        unspentAllocation: round(allocatedCash - spent, 2)
      };
    });
    const totalQuantity = stages.reduce(function(sum, stage) { return sum + stage.quantity; }, 0);
    const totalSpent = stages.reduce(function(sum, stage) { return sum + stage.spent; }, 0);
    return {
      stages,
      totalQuantity,
      totalSpent: round(totalSpent, 2),
      averagePrice: totalQuantity > 0 ? round(totalSpent / totalQuantity, 6) : null,
      remainingCash: round(cash - totalSpent, 2),
      lotSize
    };
  }

  function analyzeCashBuffer(input) {
    input = input || {};
    const cash = requiredFinite(input.cash, '可确认现金');
    const monthlyEssential = requiredFinite(input.monthlyEssential, '必要月支出');
    const reserveMonths = requiredFinite(input.reserveMonths, '目标储备月数');
    if (cash < 0) throw new Error('可确认现金不能小于 0');
    if (monthlyEssential <= 0) throw new Error('必要月支出必须大于 0');
    if (reserveMonths < 0 || reserveMonths > 120) throw new Error('目标储备月数必须在 0 到 120 之间');
    const requiredReserve = monthlyEssential * reserveMonths;
    const reserveGap = cash - requiredReserve;
    return {
      coverageMonths: round(cash / monthlyEssential, 2),
      requiredReserve: round(requiredReserve, 2),
      reserveGap: round(reserveGap, 2),
      shortfall: round(Math.max(0, -reserveGap), 2),
      deployableCash: round(Math.max(0, reserveGap), 2),
      assumption: 'user-confirmed-cash-and-essential-spending'
    };
  }

  function calculateRecoveryTime(input) {
    input = input || {};
    const drawdownPercent = requiredFinite(input.drawdownPercent, '回撤比例');
    const annualRatePercent = requiredFinite(input.annualRatePercent, '年情景收益率');
    if (drawdownPercent < 0 || drawdownPercent >= 100) throw new Error('回撤比例必须在 0% 到 100% 之间');
    if (annualRatePercent <= -100) throw new Error('年情景收益率必须大于 -100%');
    const requiredMultiplier = drawdownPercent === 0 ? 1 : 1 / (1 - drawdownPercent / 100);
    if (drawdownPercent === 0) {
      return { reachable: true, exactMonths: 0, wholeMonths: 0, requiredMultiplier: 1, assumption: 'constant-effective-annual-rate' };
    }
    if (annualRatePercent <= 0) {
      return { reachable: false, exactMonths: null, wholeMonths: null, requiredMultiplier: round(requiredMultiplier, 6), assumption: 'constant-effective-annual-rate' };
    }
    const monthlyRate = Math.pow(1 + annualRatePercent / 100, 1 / 12) - 1;
    const exactMonths = Math.log(requiredMultiplier) / Math.log(1 + monthlyRate);
    return {
      reachable: true,
      exactMonths: round(exactMonths, 6),
      wholeMonths: Math.ceil(exactMonths - Number.EPSILON),
      requiredMultiplier: round(requiredMultiplier, 6),
      monthlyRatePercent: round(monthlyRate * 100, 6),
      assumption: 'constant-effective-annual-rate'
    };
  }

  function r7Quantile(sortedValues, probability) {
    if (!sortedValues.length) return null;
    if (sortedValues.length === 1) return sortedValues[0];
    const position = (sortedValues.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const fraction = position - lower;
    return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * fraction;
  }

  function analyzePnlDistribution(values) {
    const normalized = strictNumberList(values, '盈亏序列', 500);
    const sorted = normalized.slice().sort(function(a, b) { return a - b; });
    const mean = normalized.reduce(function(sum, value) { return sum + value; }, 0) / normalized.length;
    const q1 = r7Quantile(sorted, 0.25);
    const median = r7Quantile(sorted, 0.5);
    const q3 = r7Quantile(sorted, 0.75);
    const variance = normalized.length > 1
      ? normalized.reduce(function(sum, value) { return sum + Math.pow(value - mean, 2); }, 0) / (normalized.length - 1)
      : null;
    return {
      sampleCount: normalized.length,
      mean: round(mean, 6),
      median: round(median, 6),
      q1: round(q1, 6),
      q3: round(q3, 6),
      iqr: round(q3 - q1, 6),
      sampleStandardDeviation: variance === null ? null : round(Math.sqrt(variance), 6),
      winCount: normalized.filter(function(value) { return value > 0; }).length,
      lossCount: normalized.filter(function(value) { return value < 0; }).length,
      flatCount: normalized.filter(function(value) { return value === 0; }).length,
      minimum: round(sorted[0], 6),
      maximum: round(sorted[sorted.length - 1], 6),
      quantileMethod: 'R7'
    };
  }

  function buildSampleEquityPath(input) {
    input = input || {};
    const initialCapital = requiredFinite(input.initialCapital, '初始资本');
    const pnlValues = strictNumberList(input.pnlValues, '盈亏序列', 500);
    if (initialCapital <= 0) throw new Error('初始资本必须大于 0');
    let equity = initialCapital;
    let highWater = initialCapital;
    let maximumDrawdownPercent = 0;
    let underwaterStart = null;
    let longestUnderwaterSpan = 0;
    let underwaterObservationCount = 0;
    const points = [{ step: 0, pnl: 0, equity: round(equity, 2), drawdownPercent: 0 }];
    pnlValues.forEach(function(pnl, index) {
      equity += pnl;
      const step = index + 1;
      if (equity >= highWater) {
        if (underwaterStart !== null) longestUnderwaterSpan = Math.max(longestUnderwaterSpan, step - underwaterStart + 1);
        highWater = equity;
        underwaterStart = null;
      } else {
        underwaterObservationCount += 1;
        if (underwaterStart === null) underwaterStart = step;
      }
      const drawdownPercent = highWater > 0 ? (highWater - equity) / highWater * 100 : 0;
      maximumDrawdownPercent = Math.max(maximumDrawdownPercent, drawdownPercent);
      points.push({ step, pnl: round(pnl, 2), equity: round(equity, 2), drawdownPercent: round(drawdownPercent, 6) });
    });
    if (underwaterStart !== null) {
      longestUnderwaterSpan = Math.max(longestUnderwaterSpan, pnlValues.length - underwaterStart + 1);
    }
    return {
      initialCapital: round(initialCapital, 2),
      finalCapital: round(equity, 2),
      netPnl: round(equity - initialCapital, 2),
      maximumDrawdownPercent: round(maximumDrawdownPercent, 6),
      longestUnderwaterSpan,
      underwaterObservationCount,
      capitalDepleted: equity <= 0,
      points
    };
  }

  function analyzeStopExposure(positions, levels, totalAssetsInput) {
    const totalAssets = requiredFinite(totalAssetsInput, '账户权益');
    if (totalAssets <= 0) throw new Error('账户权益必须大于 0');
    const levelMap = new Map();
    (Array.isArray(levels) ? levels : []).forEach(function(item) {
      if (item && item.code) levelMap.set(String(item.code), item);
    });
    const normalized = Array.isArray(positions) ? positions.filter(Boolean) : [];
    const totalPositionValue = normalized.reduce(function(sum, position) { return sum + positionValue(position); }, 0);
    const rows = [];
    const missingCodes = [];
    const breachedCodes = [];
    let coveredValue = 0;
    let knownRiskAmount = 0;
    normalized.forEach(function(position) {
      const code = String(position.code || '');
      const level = levelMap.get(code) || {};
      const currentPrice = position.currentPrice === null || position.currentPrice === undefined || position.currentPrice === ''
        ? null : Number(position.currentPrice);
      const quantity = position.quantity === null || position.quantity === undefined || position.quantity === ''
        ? null : Number(position.quantity);
      const candidates = [
        { value: position.stopPrice, source: 'position-input' },
        { value: level.autoD2, source: 'auto-d2' },
        { value: level.alertLow, source: 'alert-low' }
      ];
      const selected = candidates.find(function(candidate) {
        if (candidate.value === null || candidate.value === undefined || candidate.value === '') return false;
        const parsed = Number(candidate.value);
        return Number.isFinite(parsed) && parsed > 0;
      });
      const stopPrice = selected ? Number(selected.value) : null;
      if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(quantity) || quantity <= 0 || stopPrice === null) {
        missingCodes.push(code);
        return;
      }
      if (stopPrice >= currentPrice) {
        breachedCodes.push(code);
        return;
      }
      const riskAmount = (currentPrice - stopPrice) * quantity;
      const value = positionValue(position);
      coveredValue += value;
      knownRiskAmount += riskAmount;
      rows.push({
        code,
        name: position.name || '',
        currentPrice: round(currentPrice, 4),
        stopPrice: round(stopPrice, 4),
        source: selected.source,
        quantity: Math.trunc(quantity),
        riskAmount: round(riskAmount, 2),
        riskPercent: round(riskAmount / totalAssets * 100, 4)
      });
    });
    return {
      knownRiskAmount: round(knownRiskAmount, 2),
      knownRiskPercent: round(knownRiskAmount / totalAssets * 100, 4),
      positionCoveragePercent: normalized.length ? round(rows.length / normalized.length * 100, 2) : 0,
      valueCoveragePercent: totalPositionValue > 0 ? round(coveredValue / totalPositionValue * 100, 2) : 0,
      coveredCount: rows.length,
      totalPositionCount: normalized.length,
      missingCodes,
      breachedCodes,
      rows
    };
  }

  return {
    projectCompoundPlan,
    solveRequiredAnnualRate,
    analyzeConcentration,
    drawdownRecovery,
    analyzeSnapshotDrawdown,
    analyzeClosedPositions,
    buildRebalanceDraft,
    estimateCostDrag,
    runStressScenarios,
    assessDataReadiness,
    normalizeSnapshots,
    buildMonthlyDateSeries,
    calculatePositionSize,
    calculateBreakEvenExit,
    analyzeRiskReward,
    analyzeExpectancy,
    calculateLossPath,
    calculateLossRunExperiment,
    calculateStagedAverage,
    analyzeCashBuffer,
    calculateRecoveryTime,
    analyzePnlDistribution,
    buildSampleEquityPath,
    analyzeStopExposure
  };
});
