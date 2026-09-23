const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../js/modules/compoundLabModel');

test('required annual return reaches a target with end-of-month contributions', () => {
  const annualRate = model.solveRequiredAnnualRate({
    initialCapital: 100000,
    monthlyContribution: 2000,
    targetCapital: 300000,
    years: 5
  });
  const projection = model.projectCompoundPlan({
    initialCapital: 100000,
    monthlyContribution: 2000,
    annualRatePercent: annualRate,
    years: 5
  });

  assert.ok(annualRate > 8 && annualRate < 9);
  assert.ok(Math.abs(projection.finalAssets - 300000) < 1);
  assert.equal(projection.points.length, 61);
  assert.equal(projection.totalContributions, 220000);
});

test('compound projection handles a zero return without division formulas', () => {
  const projection = model.projectCompoundPlan({
    initialCapital: 50000,
    monthlyContribution: 1000,
    annualRatePercent: 0,
    years: 2
  });

  assert.equal(projection.finalAssets, 74000);
  assert.equal(projection.investmentGain, 0);
});

test('compound projection rejects a horizon that could block the page', () => {
  assert.throws(() => model.projectCompoundPlan({
    initialCapital: 50000,
    monthlyContribution: 1000,
    annualRatePercent: 5,
    years: 51
  }), /50/);
});

test('concentration includes cash and reports Top1 Top3 and HHI', () => {
  const result = model.analyzeConcentration([
    { code: '600001', name: '甲', marketValue: 60000, currentPrice: 60, quantity: 1000 },
    { code: '600002', name: '乙', marketValue: 30000, currentPrice: 30, quantity: 1000 }
  ], 10000);

  assert.equal(result.totalAssets, 100000);
  assert.equal(result.cashPercent, 10);
  assert.equal(result.top1Percent, 60);
  assert.equal(result.top3Percent, 90);
  assert.equal(result.hhi, 5555.56);
  assert.equal(result.level, 'high');
});

test('missing market value falls back to cost and an all-cash account is not rated as concentrated stock holdings', () => {
  const fallback = model.analyzeConcentration([
    { code: '600001', marketValue: null, costValue: 9000 }
  ], 1000);
  assert.equal(fallback.totalAssets, 10000);
  assert.equal(fallback.equityValue, 9000);
  assert.equal(fallback.positions[0].value, 9000);

  const allCash = model.analyzeConcentration([], 10000);
  assert.equal(allCash.hhi, null);
  assert.equal(allCash.level, 'unavailable');
});

test('drawdown analysis separates arithmetic from sample readiness', () => {
  assert.equal(model.drawdownRecovery(20), 25);
  const result = model.analyzeSnapshotDrawdown([
    { snapshotDate: '2026-01-01', totalAssets: 100 },
    { snapshotDate: '2026-01-02', totalAssets: 120 },
    { snapshotDate: '2026-01-03', totalAssets: 90 },
    { snapshotDate: '2026-01-04', totalAssets: 110 }
  ]);

  assert.equal(result.maximumDrawdownPercent, 25);
  assert.equal(result.ready, false);
  assert.equal(result.cashFlowAdjusted, false);
  assert.match(result.metricLabel, /总资产峰谷/);
  assert.match(result.reason, /30/);
});

test('monthly chart dates use contribution month ends without end-of-month overflow', () => {
  assert.deepEqual(model.buildMonthlyDateSeries('2026-01-31', 3), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30'
  ]);
});

test('closed-position ledger does not invent metrics without closed samples', () => {
  const empty = model.analyzeClosedPositions([], [{ fee: 5, tax: 2 }]);
  assert.equal(empty.ready, false);
  assert.equal(empty.winRatePercent, null);
  assert.equal(empty.recordedCosts, 7);

  const result = model.analyzeClosedPositions([
    { code: '1', realizedPnl: 1000, firstTradeDate: '2026-01-01', lastTradeDate: '2026-01-11' },
    { code: '2', realizedPnl: 500, firstTradeDate: '2026-01-01', lastTradeDate: '2026-01-06' },
    { code: '3', realizedPnl: -300, firstTradeDate: '2026-01-02', lastTradeDate: '2026-01-05' },
    { code: '4', realizedPnl: 0, firstTradeDate: '2026-01-02', lastTradeDate: '2026-01-02' }
  ], [{ fee: 10, tax: 5 }]);

  assert.equal(result.ready, true);
  assert.equal(result.winRatePercent, 50);
  assert.equal(result.averageWin, 750);
  assert.equal(result.averageLoss, 300);
  assert.equal(result.payoffRatio, 2.5);
  assert.equal(result.profitFactor, 5);
  assert.equal(result.averageHoldingDays, 4.5);
});

test('closed-position ledger does not turn missing realized pnl into a flat trade', () => {
  const result = model.analyzeClosedPositions([
    { code: '1', realizedPnl: null },
    { code: '2', realizedPnl: undefined },
    { code: '3', realizedPnl: '' }
  ], []);
  assert.equal(result.ready, false);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.winRatePercent, null);
});

test('rebalance sandbox rounds only excess shares down to an A-share lot', () => {
  const result = model.buildRebalanceDraft([
    { code: '600001', name: '甲', marketValue: 60000, currentPrice: 60, quantity: 1000 },
    { code: '600002', name: '乙', marketValue: 30000, currentPrice: 30, quantity: 1000 }
  ], 10000, 30);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].excessValue, 30000);
  assert.equal(result.items[0].paperQuantity, 500);
  assert.equal(result.items[0].actionable, true);
});

test('cost drag and stress scenarios use explicit simple assumptions', () => {
  const drag = model.estimateCostDrag({
    initialCapital: 100000,
    annualTurnoverPercent: 200,
    effectiveFeeRatePercent: 0.1,
    years: 5
  });
  assert.equal(drag.annualDragPercent, 0.2);
  assert.ok(Math.abs(drag.remainingCapital - 99003.99) < 0.01);
  assert.ok(Math.abs(drag.cumulativeCost - 996.01) < 0.01);

  const scenarios = model.runStressScenarios([
    { marketValue: 90000 }
  ], 10000, [-5, -10, -20]);
  assert.deepEqual(scenarios.map(item => item.totalAssets), [95500, 91000, 82000]);
  assert.deepEqual(scenarios.map(item => item.lossPercent), [-4.5, -9, -18]);
});

test('data readiness requires distinct snapshot dates and a 30-day span', () => {
  const status = model.assessDataReadiness({
    snapshots: [
      { snapshotDate: '2026-01-01', totalAssets: 100000 },
      { snapshotDate: '2026-02-01', totalAssets: 110000 },
      { snapshotDate: '2026-02-02', totalAssets: 111000 }
    ],
    closedPositions: [{ realizedPnl: 1 }],
    positions: [{ marketValue: 100 }],
    trades: [{ id: 1 }]
  });

  assert.equal(status.snapshotHistory.status, 'ready');
  assert.equal(status.tradeLedger.status, 'limited');
  assert.equal(status.currentPortfolio.status, 'ready');
  assert.equal(status.commentMethods.status, 'validation-required');
});

test('risk-budget position size is constrained by stop distance cash and position cap', () => {
  const result = model.calculatePositionSize({
    equity: 100000,
    availableCash: 100000,
    riskPercent: 1,
    entryPrice: 20,
    stopPrice: 18,
    maxPositionPercent: 20,
    lotSize: 100
  });

  assert.equal(result.riskBudget, 1000);
  assert.equal(result.riskPerShare, 2);
  assert.equal(result.quantity, 500);
  assert.equal(result.positionValue, 10000);
  assert.equal(result.actualRisk, 1000);
  assert.equal(result.positionWeightPercent, 10);
  assert.equal(result.bindingConstraint, 'risk-budget');
  assert.throws(() => model.calculatePositionSize({
    equity: null,
    availableCash: 100000,
    riskPercent: 1,
    entryPrice: 20,
    stopPrice: 18,
    maxPositionPercent: 20
  }), /权益/);
});

test('break-even exit price solves fixed and proportional exit costs without hard-coded tax', () => {
  const result = model.calculateBreakEvenExit({
    costBasis: 10005,
    quantity: 1000,
    fixedExitCost: 5,
    exitRatePercent: 0.05
  });

  assert.ok(Math.abs(result.breakEvenPrice - 10.015008) < 0.000001);
  assert.equal(result.costBasisPerShare, 10.005);
  assert.ok(result.requiredRisePercent > 0.1 && result.requiredRisePercent < 0.11);
  assert.throws(() => model.calculateBreakEvenExit({
    costBasis: '', quantity: 1000, fixedExitCost: 5, exitRatePercent: 0.05
  }), /成本/);
});

test('risk reward includes the entered round-trip cost buffer', () => {
  const result = model.analyzeRiskReward({
    entryPrice: 20,
    stopPrice: 18,
    targetPrice: 26,
    roundTripCostPerShare: 0.1
  });

  assert.equal(result.netRiskPerShare, 2.1);
  assert.equal(result.netRewardPerShare, 5.9);
  assert.equal(result.rewardRiskRatio, 2.809524);
  assert.equal(result.breakEvenWinRatePercent, 26.25);
  assert.throws(() => model.analyzeRiskReward({
    entryPrice: 20, stopPrice: 21, targetPrice: 26, roundTripCostPerShare: 0
  }), /止损价/);
});

test('expectancy is explicitly based on user-entered win loss and flat assumptions', () => {
  const result = model.analyzeExpectancy({
    winRatePercent: 40,
    lossRatePercent: 60,
    averageWin: 300,
    averageLoss: 100
  });

  assert.equal(result.expectedValue, 60);
  assert.equal(result.profitFactor, 2);
  assert.equal(result.breakEvenWinRatePercent, 25);
  assert.equal(result.flatRatePercent, 0);
  const withFlatOutcomes = model.analyzeExpectancy({
    winRatePercent: 40,
    lossRatePercent: 50,
    averageWin: 300,
    averageLoss: 100
  });
  assert.equal(withFlatOutcomes.expectedValue, 70);
  assert.equal(withFlatOutcomes.flatRatePercent, 10);
  assert.equal(withFlatOutcomes.breakEvenWinRatePercent, 22.5);
  assert.equal(withFlatOutcomes.conditionalBreakEvenWinRatePercent, 25);
  assert.throws(() => model.analyzeExpectancy({
    winRatePercent: 70, lossRatePercent: 40, averageWin: 300, averageLoss: 100
  }), /合计/);
});

test('consecutive-loss path risks the configured fraction of current equity each time', () => {
  const result = model.calculateLossPath({
    initialEquity: 100000,
    riskPercent: 2,
    consecutiveLosses: 5
  });

  assert.equal(result.finalEquity, 90392.08);
  assert.equal(result.drawdownPercent, 9.61);
  assert.equal(result.recoveryPercent, 10.63);
  assert.equal(result.points.length, 6);
});

test('IID loss-run experiment separates next-k losses from at-least-one run in N trials', () => {
  const result = model.calculateLossRunExperiment({
    winRatePercent: 50,
    trialCount: 5,
    streakLength: 2
  });

  assert.equal(result.nextStreakProbabilityPercent, 25);
  assert.equal(result.atLeastOneStreakProbabilityPercent, 59.375);
  assert.equal(result.assumption, 'independent-identically-distributed');
  assert.throws(() => model.calculateLossRunExperiment({
    winRatePercent: 50, trialCount: 5001, streakLength: 2
  }), /5000/);
});

test('staged average keeps each allocation independent and rounds down to board lots', () => {
  const result = model.calculateStagedAverage({
    cash: 100000,
    prices: [10, 8],
    weights: [50, 50],
    lotSize: 100
  });

  assert.deepEqual(result.stages.map(stage => stage.quantity), [5000, 6200]);
  assert.equal(result.totalQuantity, 11200);
  assert.equal(result.totalSpent, 99600);
  assert.equal(result.averagePrice, 8.892857);
  assert.equal(result.remainingCash, 400);
  assert.throws(() => model.calculateStagedAverage({
    cash: 100000, prices: [10, null], weights: [50, 50], lotSize: 100
  }), /价格/);
});

test('cash buffer reports coverage reserve gap and deployable cash without treating broker cash as emergency savings', () => {
  const result = model.analyzeCashBuffer({
    cash: 30000,
    monthlyEssential: 6000,
    reserveMonths: 6
  });

  assert.equal(result.coverageMonths, 5);
  assert.equal(result.requiredReserve, 36000);
  assert.equal(result.reserveGap, -6000);
  assert.equal(result.shortfall, 6000);
  assert.equal(result.deployableCash, 0);
});

test('scenario recovery time uses an effective annual rate and does not invent a date', () => {
  const result = model.calculateRecoveryTime({ drawdownPercent: 20, annualRatePercent: 12 });
  assert.equal(result.reachable, true);
  assert.ok(Math.abs(result.exactMonths - 23.627933) < 0.000001);
  assert.equal(result.wholeMonths, 24);
  assert.equal(result.requiredMultiplier, 1.25);

  const unavailable = model.calculateRecoveryTime({ drawdownPercent: 20, annualRatePercent: 0 });
  assert.equal(unavailable.reachable, false);
  assert.equal(unavailable.exactMonths, null);
});

test('manual pnl distribution fixes the percentile method to R7 and uses sample standard deviation', () => {
  const result = model.analyzePnlDistribution([-200, -100, 0, 100, 500]);

  assert.equal(result.sampleCount, 5);
  assert.equal(result.mean, 60);
  assert.equal(result.median, 0);
  assert.equal(result.q1, -100);
  assert.equal(result.q3, 100);
  assert.equal(result.iqr, 200);
  assert.ok(Math.abs(result.sampleStandardDeviation - 270.185122) < 0.000001);
  assert.deepEqual([result.winCount, result.lossCount, result.flatCount], [2, 2, 1]);
  assert.equal(result.quantileMethod, 'R7');
  assert.throws(() => model.analyzePnlDistribution([100, '']), /盈亏序列/);
});

test('manual sample equity path reports peak-to-trough decline and inclusive recovery span', () => {
  const result = model.buildSampleEquityPath({
    initialCapital: 10000,
    pnlValues: [1000, -500, -1000, 2000]
  });

  assert.deepEqual(result.points.map(point => point.equity), [10000, 11000, 10500, 9500, 11500]);
  assert.equal(result.maximumDrawdownPercent, 13.636364);
  assert.equal(result.longestUnderwaterSpan, 3);
  assert.equal(result.underwaterObservationCount, 2);
  assert.equal(result.finalCapital, 11500);
});

test('stop exposure reports known paper risk and never counts missing or breached stops as zero risk', () => {
  const covered = model.analyzeStopExposure([
    { code: '600001', currentPrice: 20, stopPrice: 18, quantity: 500, marketValue: 10000 },
    { code: '600002', currentPrice: 10, stopPrice: 9.5, quantity: 1000, marketValue: 10000 }
  ], [], 100000);

  assert.equal(covered.knownRiskAmount, 1500);
  assert.equal(covered.knownRiskPercent, 1.5);
  assert.equal(covered.positionCoveragePercent, 100);
  assert.equal(covered.valueCoveragePercent, 100);
  assert.deepEqual(covered.missingCodes, []);

  const partial = model.analyzeStopExposure([
    { code: '600001', currentPrice: 20, quantity: 500, marketValue: 10000 },
    { code: '600002', currentPrice: 10, quantity: 1000, marketValue: 10000 }
  ], [{ code: '600001', autoD2: 18 }], 100000);
  assert.equal(partial.knownRiskAmount, 1000);
  assert.equal(partial.positionCoveragePercent, 50);
  assert.deepEqual(partial.missingCodes, ['600002']);
});
