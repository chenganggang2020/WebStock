(function() {
  let bound = false;
  let loading = false;
  let loadGeneration = 0;
  let activeLoadPromise = null;
  let loadingAccountId = 0;
  let loadedAt = 0;
  let targetChart = null;
  let activeModule = 'target';
  let activeCategory = 'goal';
  const MODULE_GROUPS = {
    goal: ['target', 'recovery', 'cashBuffer', 'stagedAverage', 'breakEven'],
    portfolio: ['risk', 'drawdown', 'rebalance', 'stress', 'stopExposure'],
    trade: ['ledger', 'cost', 'positionSize', 'riskReward', 'expectancy'],
    research: ['readiness', 'lossPath', 'lossRun', 'pnlDistribution', 'equityPath']
  };
  const MODULE_ORDER = Object.keys(MODULE_GROUPS).reduce(function(items, group) {
    return items.concat(MODULE_GROUPS[group]);
  }, []);
  const dirtyModules = new Set(MODULE_ORDER);
  const state = {
    accounts: [],
    positions: [],
    closedPositions: [],
    trades: [],
    snapshots: [],
    watchlist: [],
    account: null
  };
  const COMMENT_METHOD_EVIDENCE = {
    observedAt: '2026-08-24',
    coverage: '已登录只读抽样：120 条顶层评论 + 52 条回复；不是全部 1463 条评论。',
    items: [
      { method: 'BOLL + MACD + RSI 组合', evidence: '自报胜率 79%、一年仅 1–2 次；评论者补充三年回测后不能跨股票通用。', gate: '规则必须显式化，并做跨股票样本外验证。' },
      { method: '胜率 + 盈亏比', evidence: '自报胜率 54.7%、盈亏比 3.8:1、十年回测，但没有可核对记录。', gate: '同时检查频率、费用、回撤和原始交易清单。' },
      { method: '偏差审计', evidence: '评论明确指出前视偏差、幸存者偏差和实盘过拟合。', gate: '采用滚动训练/验证/测试，禁止未来数据进入信号。' },
      { method: '跨市场状态验证', evidence: '提出应覆盖牛市、熊市和震荡市。', gate: '分市场阶段报告，不用单一总胜率掩盖失效区间。' },
      { method: '分钟筛选与提醒', evidence: '有人因分时 K 线回测、自动筛选和五分钟反应窗口不足而放弃。', gate: '首期只做提醒；分钟历史覆盖不足时不做长期结论。' },
      { method: '模拟盘对照', evidence: '有日内系统每天跑模拟，并带消息推送。', gate: '模拟与实盘分账，记录滑点、未成交和信号延迟。' },
      { method: 'Codex / GPT 策略助手', evidence: '用于把个人想法写成选股规则和优化代码，不是让 GPT 无数据直接炒股。', gate: 'AI 只生成可审查规则，真实数据与回测负责验证。' },
      { method: '退出语义与风控', evidence: '评论提出收盘价止损与影线止损会造成回测/实盘差异。', gate: '入场、退出、止损、仓位和撮合规则必须逐项固定。' }
    ]
  };

  function api(path, options) {
    return window.apiFetch(path, options);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function numberFrom(id, fallback) {
    const element = document.getElementById(id);
    if (!element) return fallback;
    const raw = String(element.value == null ? '' : element.value).trim();
    if (!raw) return NaN;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function textFrom(id, fallback) {
    const element = document.getElementById(id);
    return element ? String(element.value || '') : (fallback || '');
  }

  function numberListFrom(id) {
    const raw = textFrom(id, '').trim();
    if (!raw) return [];
    return raw.split(/[\s,，;；]+/).filter(Boolean).map(function(value) { return Number(value); });
  }

  function setValue(id, value) {
    const input = document.getElementById(id);
    if (input && value !== undefined && value !== null) input.value = String(value);
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function percent(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return number.toFixed(digits === undefined ? 2 : digits) + '%';
  }

  function metric(label, value, note, tone) {
    return '<article class="compound-metric-card' + (tone ? ' ' + tone : '') + '"><span>' + escapeHtml(label) + '</span>' +
      '<strong>' + escapeHtml(value) + '</strong>' + (note ? '<small>' + escapeHtml(note) + '</small>' : '') + '</article>';
  }

  function currentAccountId() {
    const select = document.getElementById('compoundLabAccountSelect');
    const selected = select ? Number(select.value) : 0;
    if (selected > 0) return selected;
    return Number(window.State && window.State.activePortfolioAccountId) || (state.accounts[0] && state.accounts[0].id) || 1;
  }

  function accountQuery(path, accountId) {
    return path + (path.includes('?') ? '&' : '?') + 'accountId=' + encodeURIComponent(accountId);
  }

  function selectedOverview() {
    return state.accounts.find(function(account) { return Number(account.id) === Number(currentAccountId()); }) || state.account;
  }

  function selectedSummary() {
    const account = selectedOverview();
    return account && account.summary ? account.summary : {};
  }

  function setStatus(text, kind) {
    const target = document.getElementById('compoundLabStatus');
    if (!target) return;
    target.textContent = text;
    target.className = 'compound-lab-status' + (kind ? ' ' + kind : '');
  }

  function setError(error) {
    const target = document.getElementById('compoundLabError');
    if (!target) return;
    if (!error) {
      target.hidden = true;
      target.textContent = '';
      return;
    }
    target.hidden = false;
    target.textContent = error.message || String(error);
  }

  function settingsKey() {
    return 'webstock.compoundLab.settings';
  }

  function readSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(settingsKey()) || '{}');
      if (!parsed || typeof parsed !== 'object') return {};
      Object.keys(parsed).forEach(function(key) {
        if (parsed[key] === null || parsed[key] === '') delete parsed[key];
      });
      return parsed;
    } catch (error) {
      return {};
    }
  }

  function saveSettings() {
    const settings = {
      accountId: currentAccountId(),
      initialCapital: numberFrom('compoundInitialInput', 0),
      targetCapital: numberFrom('compoundTargetInput', 0),
      years: numberFrom('compoundYearsInput', 5),
      monthlyContribution: numberFrom('compoundMonthlyInput', 2000),
      maxWeightPercent: numberFrom('compoundMaxWeightInput', 30),
      costCapital: numberFrom('compoundCostCapitalInput', 0),
      annualTurnoverPercent: numberFrom('compoundTurnoverInput', 200),
      effectiveFeeRatePercent: numberFrom('compoundFeeRateInput', 0.1),
      costYears: numberFrom('compoundCostYearsInput', 5),
      recoveryDrawdownPercent: numberFrom('compoundRecoveryDrawdownInput', 20),
      recoveryAnnualRatePercent: numberFrom('compoundRecoveryRateInput', 12),
      confirmedCash: numberFrom('compoundCashInput', NaN),
      monthlyEssential: numberFrom('compoundMonthlyEssentialInput', 6000),
      reserveMonths: numberFrom('compoundReserveMonthsInput', 6),
      stagedCash: numberFrom('compoundStagedCashInput', 0),
      stagedPrices: textFrom('compoundStagedPricesInput', '10,8'),
      stagedWeights: textFrom('compoundStagedWeightsInput', '50,50'),
      breakEvenCost: numberFrom('compoundBreakEvenCostInput', 10005),
      breakEvenQuantity: numberFrom('compoundBreakEvenQuantityInput', 1000),
      breakEvenFixedCost: numberFrom('compoundBreakEvenFixedCostInput', 5),
      breakEvenRatePercent: numberFrom('compoundBreakEvenRateInput', 0.05),
      positionEquity: numberFrom('compoundPositionEquityInput', 0),
      positionCash: numberFrom('compoundPositionCashInput', 0),
      positionRiskPercent: numberFrom('compoundPositionRiskInput', 1),
      positionEntry: numberFrom('compoundPositionEntryInput', 20),
      positionStop: numberFrom('compoundPositionStopInput', 18),
      positionMaxWeightPercent: numberFrom('compoundPositionMaxWeightInput', 20),
      riskRewardEntry: numberFrom('compoundRiskRewardEntryInput', 20),
      riskRewardStop: numberFrom('compoundRiskRewardStopInput', 18),
      riskRewardTarget: numberFrom('compoundRiskRewardTargetInput', 26),
      riskRewardCost: numberFrom('compoundRiskRewardCostInput', 0.1),
      expectancyWinRate: numberFrom('compoundExpectancyWinRateInput', 40),
      expectancyLossRate: numberFrom('compoundExpectancyLossRateInput', 60),
      expectancyAverageWin: numberFrom('compoundExpectancyAverageWinInput', 300),
      expectancyAverageLoss: numberFrom('compoundExpectancyAverageLossInput', 100),
      lossPathEquity: numberFrom('compoundLossPathEquityInput', 0),
      lossPathRiskPercent: numberFrom('compoundLossPathRiskInput', 2),
      lossPathCount: numberFrom('compoundLossPathCountInput', 5),
      lossRunWinRate: numberFrom('compoundLossRunWinRateInput', 50),
      lossRunTrials: numberFrom('compoundLossRunTrialsInput', 5),
      lossRunLength: numberFrom('compoundLossRunLengthInput', 2),
      pnlSeries: textFrom('compoundPnlSeriesInput', ''),
      equityInitial: numberFrom('compoundEquityInitialInput', 0),
      equityPnlSeries: textFrom('compoundEquityPnlSeriesInput', ''),
      activeModule
    };
    Object.keys(settings).forEach(function(key) {
      if (typeof settings[key] === 'number' && !Number.isFinite(settings[key])) delete settings[key];
    });
    try { localStorage.setItem(settingsKey(), JSON.stringify(settings)); } catch (error) {}
  }

  function fillInputsForAccount() {
    const settings = readSettings();
    const totalAssets = Number(selectedSummary().totalAssets) || 0;
    const cashBalance = Number(selectedSummary().cashBalance) || 0;
    const firstPosition = state.positions[0] || {};
    const firstQuantity = Number(firstPosition.quantity) || 1000;
    const firstCostPerShare = Number(firstPosition.avgCost) || 10;
    const firstCost = firstQuantity * firstCostPerShare;
    const sameAccount = Number(settings.accountId) === Number(currentAccountId());
    const hasConfirmedCash = sameAccount && settings.confirmedCash !== null && settings.confirmedCash !== undefined &&
      settings.confirmedCash !== '' && Number.isFinite(Number(settings.confirmedCash));
    const defaultYears = Number(settings.years) > 0 ? Number(settings.years) : 5;
    const defaultMonthly = Number(settings.monthlyContribution) >= 0 ? Number(settings.monthlyContribution) : 2000;
    const contributionPath = totalAssets + defaultMonthly * Math.round(defaultYears * 12);
    const values = {
      compoundInitialInput: sameAccount && Number.isFinite(Number(settings.initialCapital)) ? Number(settings.initialCapital) : totalAssets,
      compoundTargetInput: sameAccount && Number(settings.targetCapital) > 0 ? Number(settings.targetCapital) : Math.max(100000, totalAssets * 2, contributionPath * 1.25),
      compoundYearsInput: defaultYears,
      compoundMonthlyInput: defaultMonthly,
      compoundMaxWeightInput: Number(settings.maxWeightPercent) > 0 ? Number(settings.maxWeightPercent) : 30,
      compoundCostCapitalInput: sameAccount && Number.isFinite(Number(settings.costCapital)) ? Number(settings.costCapital) : totalAssets,
      compoundTurnoverInput: Number(settings.annualTurnoverPercent) >= 0 ? Number(settings.annualTurnoverPercent) : 200,
      compoundFeeRateInput: Number(settings.effectiveFeeRatePercent) >= 0 ? Number(settings.effectiveFeeRatePercent) : 0.1,
      compoundCostYearsInput: Number(settings.costYears) > 0 ? Number(settings.costYears) : 5,
      compoundRecoveryDrawdownInput: Number(settings.recoveryDrawdownPercent) >= 0 ? Number(settings.recoveryDrawdownPercent) : 20,
      compoundRecoveryRateInput: Number(settings.recoveryAnnualRatePercent) > -100 ? Number(settings.recoveryAnnualRatePercent) : 12,
      compoundMonthlyEssentialInput: Number(settings.monthlyEssential) > 0 ? Number(settings.monthlyEssential) : 6000,
      compoundReserveMonthsInput: Number(settings.reserveMonths) >= 0 ? Number(settings.reserveMonths) : 6,
      compoundStagedCashInput: sameAccount && Number(settings.stagedCash) > 0 ? Number(settings.stagedCash) : (cashBalance > 0 ? cashBalance : (totalAssets > 0 ? totalAssets : 100000)),
      compoundBreakEvenCostInput: sameAccount && Number(settings.breakEvenCost) > 0 ? Number(settings.breakEvenCost) : (state.positions.length ? firstCost : 10005),
      compoundBreakEvenQuantityInput: sameAccount && Number(settings.breakEvenQuantity) > 0 ? Number(settings.breakEvenQuantity) : firstQuantity,
      compoundBreakEvenFixedCostInput: Number(settings.breakEvenFixedCost) >= 0 ? Number(settings.breakEvenFixedCost) : 5,
      compoundBreakEvenRateInput: Number(settings.breakEvenRatePercent) >= 0 ? Number(settings.breakEvenRatePercent) : 0.05,
      compoundPositionEquityInput: sameAccount && Number(settings.positionEquity) > 0 ? Number(settings.positionEquity) : (totalAssets > 0 ? totalAssets : 100000),
      compoundPositionCashInput: sameAccount && Number(settings.positionCash) >= 0 ? Number(settings.positionCash) : cashBalance,
      compoundPositionRiskInput: Number(settings.positionRiskPercent) > 0 ? Number(settings.positionRiskPercent) : 1,
      compoundPositionEntryInput: Number(settings.positionEntry) > 0 ? Number(settings.positionEntry) : 20,
      compoundPositionStopInput: Number(settings.positionStop) > 0 ? Number(settings.positionStop) : 18,
      compoundPositionMaxWeightInput: Number(settings.positionMaxWeightPercent) > 0 ? Number(settings.positionMaxWeightPercent) : 20,
      compoundRiskRewardEntryInput: Number(settings.riskRewardEntry) > 0 ? Number(settings.riskRewardEntry) : 20,
      compoundRiskRewardStopInput: Number(settings.riskRewardStop) > 0 ? Number(settings.riskRewardStop) : 18,
      compoundRiskRewardTargetInput: Number(settings.riskRewardTarget) > 0 ? Number(settings.riskRewardTarget) : 26,
      compoundRiskRewardCostInput: Number(settings.riskRewardCost) >= 0 ? Number(settings.riskRewardCost) : 0.1,
      compoundExpectancyWinRateInput: Number(settings.expectancyWinRate) >= 0 ? Number(settings.expectancyWinRate) : 40,
      compoundExpectancyLossRateInput: Number(settings.expectancyLossRate) >= 0 ? Number(settings.expectancyLossRate) : 60,
      compoundExpectancyAverageWinInput: Number(settings.expectancyAverageWin) >= 0 ? Number(settings.expectancyAverageWin) : 300,
      compoundExpectancyAverageLossInput: Number(settings.expectancyAverageLoss) >= 0 ? Number(settings.expectancyAverageLoss) : 100,
      compoundLossPathEquityInput: sameAccount && Number(settings.lossPathEquity) > 0 ? Number(settings.lossPathEquity) : (totalAssets > 0 ? totalAssets : 100000),
      compoundLossPathRiskInput: Number(settings.lossPathRiskPercent) > 0 ? Number(settings.lossPathRiskPercent) : 2,
      compoundLossPathCountInput: Number(settings.lossPathCount) >= 0 ? Number(settings.lossPathCount) : 5,
      compoundLossRunWinRateInput: Number(settings.lossRunWinRate) >= 0 ? Number(settings.lossRunWinRate) : 50,
      compoundLossRunTrialsInput: Number(settings.lossRunTrials) > 0 ? Number(settings.lossRunTrials) : 5,
      compoundLossRunLengthInput: Number(settings.lossRunLength) > 0 ? Number(settings.lossRunLength) : 2,
      compoundEquityInitialInput: sameAccount && Number(settings.equityInitial) > 0 ? Number(settings.equityInitial) : (totalAssets > 0 ? totalAssets : 10000)
    };
    Object.keys(values).forEach(function(id) {
      const input = document.getElementById(id);
      if (input) input.value = String(Math.round(values[id] * 100) / 100);
    });
    setValue('compoundCashInput', hasConfirmedCash ? Number(settings.confirmedCash) : '');
    setValue('compoundStagedPricesInput', settings.stagedPrices || '10,8');
    setValue('compoundStagedWeightsInput', settings.stagedWeights || '50,50');
    setValue('compoundPnlSeriesInput', settings.pnlSeries || '');
    setValue('compoundEquityPnlSeriesInput', settings.equityPnlSeries || '');
    if (settings.activeModule) switchModule(settings.activeModule, false);
  }

  function renderAccountSelect() {
    const select = document.getElementById('compoundLabAccountSelect');
    if (!select) return;
    const preferred = Number(window.State && window.State.activePortfolioAccountId) || Number(readSettings().accountId);
    const selectedId = state.accounts.some(function(account) { return Number(account.id) === preferred; })
      ? preferred : (state.accounts[0] && state.accounts[0].id);
    select.innerHTML = state.accounts.map(function(account) {
      const suffix = [account.broker, account.maskedNumber].filter(Boolean).join(' · ');
      return '<option value="' + Number(account.id) + '">' + escapeHtml(account.name || '账户') +
        (suffix ? ' · ' + escapeHtml(suffix) : '') + '</option>';
    }).join('');
    if (selectedId) select.value = String(selectedId);
  }

  function clearResults(message, kind) {
    const text = message || '正在读取本地账户数据...';
    const className = kind === 'error' ? 'compound-empty warning' : 'compound-loading';
    ['compoundTargetSummary', 'compoundRiskContent', 'compoundDrawdownContent', 'compoundLedgerContent',
      'compoundRebalanceContent', 'compoundCostContent', 'compoundStressContent', 'compoundReadinessContent',
      'compoundRecoveryContent', 'compoundCashBufferContent', 'compoundStagedAverageContent', 'compoundBreakEvenContent',
      'compoundStopExposureContent', 'compoundPositionSizeContent', 'compoundRiskRewardContent', 'compoundExpectancyContent',
      'compoundLossPathContent', 'compoundLossRunContent', 'compoundPnlDistributionContent', 'compoundEquityPathContent']
      .forEach(function(id) {
        const target = document.getElementById(id);
        if (target) target.innerHTML = '<div class="' + className + '">' + escapeHtml(text) + '</div>';
      });
    if (targetChart) targetChart.clear();
  }

  function rememberActiveAccount(accountId) {
    if (window.State) window.State.activePortfolioAccountId = Number(accountId) || 1;
    try { localStorage.setItem('webstock.activePortfolioAccountId', String(accountId)); } catch (error) {}
  }

  function projectionDates(points) {
    const today = new Date();
    const startDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const dates = window.CompoundLabModel.buildMonthlyDateSeries(startDate, points.length - 1);
    return points.map(function(point, index) {
      return [Date.parse(dates[index] + 'T00:00:00'), point.assets];
    });
  }

  function contributionDates(points) {
    const today = new Date();
    const startDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const dates = window.CompoundLabModel.buildMonthlyDateSeries(startDate, points.length - 1);
    return points.map(function(point, index) {
      return [Date.parse(dates[index] + 'T00:00:00'), point.contributions];
    });
  }

  function actualDates(snapshots) {
    return window.CompoundLabModel.normalizeSnapshots(snapshots).map(function(snapshot) {
      return [Date.parse(snapshot.snapshotDate + 'T00:00:00'), snapshot.totalAssets];
    });
  }

  function renderTargetChart(projection) {
    const element = document.getElementById('compoundTargetChart');
    if (!element || !window.echarts) return;
    if (!targetChart) targetChart = window.echarts.init(element);
    const dark = document.body.classList.contains('dark');
    const text = dark ? '#cbd5e1' : '#475569';
    const grid = dark ? '#334155' : '#e2e8f0';
    const actual = actualDates(state.snapshots);
    targetChart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', valueFormatter: function(value) { return money(value) + ' 元'; } },
      legend: { data: ['目标资产', '累计投入', '账户快照'], textStyle: { color: text } },
      grid: { left: 70, right: 28, top: 50, bottom: 48 },
      xAxis: { type: 'time', axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'value', name: '元', nameTextStyle: { color: text }, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } },
      series: [
        { name: '目标资产', type: 'line', showSymbol: false, smooth: true, data: projectionDates(projection.points), lineStyle: { color: '#2563eb', width: 3 } },
        { name: '累计投入', type: 'line', showSymbol: false, data: contributionDates(projection.points), lineStyle: { color: '#f59e0b', type: 'dashed' } },
        { name: '账户快照', type: 'line', showSymbol: true, connectNulls: false, data: actual, lineStyle: { color: '#dc2626', width: 2 } }
      ]
    }, true);
  }

  function renderTarget() {
    const target = document.getElementById('compoundTargetSummary');
    if (!target || !window.CompoundLabModel) return;
    try {
      const input = {
        initialCapital: numberFrom('compoundInitialInput', 0),
        targetCapital: numberFrom('compoundTargetInput', 0),
        years: numberFrom('compoundYearsInput', 5),
        monthlyContribution: numberFrom('compoundMonthlyInput', 0)
      };
      const annualRate = window.CompoundLabModel.solveRequiredAnnualRate(input);
      const projection = window.CompoundLabModel.projectCompoundPlan(Object.assign({}, input, { annualRatePercent: annualRate }));
      target.innerHTML = metric('所需年化收益率', percent(annualRate), '有效年化；不是承诺', Math.abs(annualRate) > 20 ? 'warning' : '') +
        metric('对应月收益率', percent(projection.monthlyRatePercent, 3), '按复利折算') +
        metric('累计投入', money(projection.totalContributions) + ' 元', '含当前资产与月度投入') +
        metric('收益贡献', money(projection.investmentGain) + ' 元', '目标资产减累计投入');
      renderTargetChart(projection);
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
      if (targetChart) targetChart.clear();
    }
  }

  function renderRecovery() {
    const target = document.getElementById('compoundRecoveryContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.calculateRecoveryTime({
        drawdownPercent: numberFrom('compoundRecoveryDrawdownInput', NaN),
        annualRatePercent: numberFrom('compoundRecoveryRateInput', NaN)
      });
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('回到原点所需倍数', result.requiredMultiplier.toFixed(4) + ' 倍', '纯数学关系') +
        metric('情景月收益率', result.monthlyRatePercent == null ? '--' : percent(result.monthlyRatePercent, 4), '由有效年化折算') +
        metric('情景所需整月数', result.reachable ? result.wholeMonths + ' 个月' : '无法修复', result.reachable ? '按固定收益率情景' : '年情景收益率不为正', result.reachable ? '' : 'warning') +
        metric('精确月数', result.exactMonths == null ? '--' : result.exactMonths.toFixed(2), '不含追加投入') + '</div>' +
        '<p class="compound-boundary">固定收益率只是用户输入的情景，不是收益预测；实际收益会波动，也可能长期无法修复。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderCashBuffer() {
    const target = document.getElementById('compoundCashBufferContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.analyzeCashBuffer({
        cash: numberFrom('compoundCashInput', NaN),
        monthlyEssential: numberFrom('compoundMonthlyEssentialInput', NaN),
        reserveMonths: numberFrom('compoundReserveMonthsInput', NaN)
      });
      const shortfall = result.shortfall > 0;
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('现金覆盖月数', result.coverageMonths.toFixed(2) + ' 个月', '按必要月支出') +
        metric('目标储备', money(result.requiredReserve) + ' 元', '月支出 × 目标月数') +
        metric(shortfall ? '储备缺口' : '储备余量', money(Math.abs(result.reserveGap)) + ' 元', shortfall ? '尚未达到输入的目标' : '达到目标后的余额', shortfall ? 'warning' : '') +
        metric('情景可部署现金', money(result.deployableCash) + ' 元', '不代表应投入市场') + '</div>' +
        '<p class="compound-boundary">账户现金不等同于家庭全部流动资产；请用你确认的现金和必要支出覆盖这里的默认值。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderStagedAverage() {
    const target = document.getElementById('compoundStagedAverageContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.calculateStagedAverage({
        cash: numberFrom('compoundStagedCashInput', NaN),
        prices: numberListFrom('compoundStagedPricesInput'),
        weights: numberListFrom('compoundStagedWeightsInput'),
        lotSize: 100
      });
      const rows = result.stages.map(function(stage) {
        return '<tr><td>' + stage.index + '</td><td>' + money(stage.price) + '</td><td>' + percent(stage.weightPercent) + '</td><td>' + money(stage.allocatedCash) + '</td><td>' + stage.quantity + ' 股</td><td>' + money(stage.spent) + '</td></tr>';
      }).join('');
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('总数量', result.totalQuantity + ' 股', '按 100 股向下取整') +
        metric('计划均价', result.averagePrice == null ? '--' : money(result.averagePrice) + ' 元', '总支出 ÷ 总股数') +
        metric('计划支出', money(result.totalSpent) + ' 元', '不含费用和滑点') +
        metric('剩余现金', money(result.remainingCash) + ' 元', '含各阶段零头') + '</div>' +
        '<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>阶段</th><th>假设价格</th><th>权重</th><th>分配资金</th><th>数量</th><th>支出</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="compound-boundary">这是预算与均价纸面计算，不判断价格是否会到达，也不会提交委托。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderBreakEven() {
    const target = document.getElementById('compoundBreakEvenContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.calculateBreakEvenExit({
        costBasis: numberFrom('compoundBreakEvenCostInput', NaN),
        quantity: numberFrom('compoundBreakEvenQuantityInput', NaN),
        fixedExitCost: numberFrom('compoundBreakEvenFixedCostInput', NaN),
        exitRatePercent: numberFrom('compoundBreakEvenRateInput', NaN)
      });
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('持仓每股成本', money(result.costBasisPerShare) + ' 元', '总成本 ÷ 数量') +
        metric('保本退出价', money(result.breakEvenPrice) + ' 元', '覆盖输入的退出费用') +
        metric('较成本需上涨', percent(result.requiredRisePercent, 4), '费用造成的门槛') +
        metric('退出费率', percent(result.exitRatePercent, 4), '按成交金额输入') + '</div>' +
        '<p class="compound-boundary">只计已输入的成本。最低佣金、印花税、过户费和滑点如未包含，结果会偏低。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderRisk() {
    const target = document.getElementById('compoundRiskContent');
    if (!target) return;
    const summary = selectedSummary();
    const result = window.CompoundLabModel.analyzeConcentration(state.positions, summary.cashBalance);
    const label = result.level === 'high' ? '股票内集中度偏高' : result.level === 'medium' ? '股票内集中度中等' : result.level === 'unavailable' ? '暂无股票持仓' : '股票内相对分散';
    const tone = result.level === 'high' ? 'warning' : '';
    const cards = '<div class="compound-metric-grid">' +
      metric('组合资产', money(result.totalAssets) + ' 元', result.positionCount + ' 只持仓') +
      metric('现金比例', percent(result.cashPercent), money(result.cashBalance) + ' 元') +
      metric('Top1 / Top3', percent(result.top1Percent) + ' / ' + percent(result.top3Percent), '占总资产') +
      metric('股票 HHI', result.hhi == null ? '--' : String(result.hhi), label, tone) + '</div>';
    const rows = result.positions.map(function(position) {
      return '<tr><td>' + escapeHtml(position.code) + '</td><td>' + escapeHtml(position.name) + '</td><td>' + money(position.value) + '</td><td>' + percent(position.weightPercent) + '</td></tr>';
    }).join('');
    target.innerHTML = cards + (rows ? '<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>代码</th><th>名称</th><th>估值</th><th>占总资产</th></tr></thead><tbody>' + rows + '</tbody></table></div>' :
      '<div class="compound-empty">没有当前持仓，暂不能计算集中度。</div>') +
      '<p class="compound-boundary">股票 HHI 只按股票市值归一化计算，现金比例单独展示；行情缺失的持仓使用已有成本值，只用于结构观察。</p>';
  }

  function renderDrawdown() {
    const target = document.getElementById('compoundDrawdownContent');
    if (!target) return;
    const result = window.CompoundLabModel.analyzeSnapshotDrawdown(state.snapshots);
    const actual = result.ready
      ? '<div class="compound-metric-grid">' + metric('总资产峰谷降幅', percent(result.maximumDrawdownPercent), '未剔除入金/出金') +
        metric('回到高水位所需', percent(result.recoveryPercent), '仅算术关系') +
        metric('快照覆盖', result.snapshotCount + ' 个', result.spanDays + ' 天') +
        metric('当前 / 高水位', money(result.currentAssets) + ' / ' + money(result.highWaterAssets), '元') + '</div>'
      : '<div class="compound-empty warning"><strong>样本不足，不输出总资产峰谷降幅结论。</strong><span>' + escapeHtml(result.reason) +
        '；当前仅有 ' + result.snapshotCount + ' 个不同日期快照，跨度 ' + result.spanDays + ' 天。</span></div>';
    const matrix = [5, 10, 15, 20, 30, 40, 50].map(function(value) {
      return '<tr><td>-' + value + '%</td><td>+' + window.CompoundLabModel.drawdownRecovery(value).toFixed(2) + '%</td></tr>';
    }).join('');
    target.innerHTML = actual + '<p class="compound-boundary">账户快照未记录外部入金和出金，因此这里是总资产峰谷变化，不等同于资金流调整后的投资回撤。</p>' +
      '<div class="table-scroll narrow-table"><table class="data-table compact-table"><thead><tr><th>资产回撤</th><th>回本所需涨幅</th></tr></thead><tbody>' + matrix + '</tbody></table></div>';
  }

  function renderLedger() {
    const target = document.getElementById('compoundLedgerContent');
    if (!target) return;
    const result = window.CompoundLabModel.analyzeClosedPositions(state.closedPositions, state.trades);
    if (!result.ready) {
      target.innerHTML = '<div class="compound-metric-grid">' + metric('已记录费用税费', money(result.recordedCosts) + ' 元', '来自本地交易记录') + '</div>' +
        '<div class="compound-empty warning">' + escapeHtml(result.reason) + '，因此不显示胜率、盈亏比或 Profit Factor。</div>';
      return;
    }
    target.innerHTML = '<div class="compound-metric-grid">' +
      metric('样本 / 胜率', result.sampleCount + ' / ' + percent(result.winRatePercent), result.sampleUnit, result.sampleCount < 20 ? 'warning' : '') +
      metric('平均盈利 / 亏损', money(result.averageWin) + ' / ' + money(result.averageLoss), '元') +
      metric('盈亏比 / Profit Factor', (result.payoffRatio == null ? '--' : result.payoffRatio) + ' / ' + (result.profitFactor == null ? '--' : result.profitFactor), '总盈利 ÷ 总亏损') +
      metric('平均持有 / 期望', (result.averageHoldingDays == null ? '--' : result.averageHoldingDays + ' 天') + ' / ' + money(result.expectancy), '元/样本') +
      metric('已记录费用税费', money(result.recordedCosts) + ' 元', '不含未记录滑点') + '</div>' +
      (result.reason ? '<div class="compound-empty warning">' + escapeHtml(result.reason) + '</div>' : '') +
      '<p class="compound-boundary">当前“已关闭”按股票全历史汇总；同一股票多次开平仓尚未拆成独立持仓周期。</p>';
  }

  function renderRebalance() {
    const target = document.getElementById('compoundRebalanceContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.buildRebalanceDraft(
        state.positions,
        selectedSummary().cashBalance,
        numberFrom('compoundMaxWeightInput', 30)
      );
      if (!result.items.length) {
        target.innerHTML = '<div class="compound-empty success">按当前估值，没有持仓超过 ' + percent(result.maxWeightPercent) + ' 的单股上限。</div>';
        saveSettings();
        return;
      }
      const rows = result.items.map(function(item) {
        return '<tr><td>' + escapeHtml(item.code) + '</td><td>' + escapeHtml(item.name) + '</td><td>' + percent(item.currentWeightPercent) + '</td>' +
          '<td>' + money(item.excessValue) + ' 元</td><td>' + (item.actionable ? item.paperQuantity + ' 股' : '--') + '</td><td>' + escapeHtml(item.note) + '</td></tr>';
      }).join('');
      target.innerHTML = '<div class="compound-empty warning"><strong>仅为集中度沙盘，不是卖出建议。</strong><span>计算基数 ' + money(result.totalAssets) + ' 元；按 100 股向下取整。</span></div>' +
        '<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>代码</th><th>名称</th><th>当前占比</th><th>超限金额</th><th>纸面数量</th><th>边界</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderCost() {
    const target = document.getElementById('compoundCostContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.estimateCostDrag({
        initialCapital: numberFrom('compoundCostCapitalInput', 0),
        annualTurnoverPercent: numberFrom('compoundTurnoverInput', 200),
        effectiveFeeRatePercent: numberFrom('compoundFeeRateInput', 0.1),
        years: numberFrom('compoundCostYearsInput', 5)
      });
      const ledger = window.CompoundLabModel.analyzeClosedPositions(state.closedPositions, state.trades);
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('估算年费用拖累', percent(result.annualDragPercent, 4), '全年成交额/本金 × 综合费率') +
        metric('多年累计侵蚀', money(result.cumulativeCost) + ' 元', '固定本金简化路径') +
        metric('费用后剩余本金', money(result.remainingCapital) + ' 元', '未计任何投资收益') +
        metric('账本已记录费用', money(ledger.recordedCosts) + ' 元', '真实记录，不等于模型估算') + '</div>' +
        '<p class="compound-boundary">' + escapeHtml(result.assumption) + '</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function bindingLabel(value) {
    if (value === 'risk-budget') return '风险预算';
    if (value === 'available-cash') return '可用资金';
    if (value === 'position-cap') return '仓位上限';
    return '多项约束同时命中';
  }

  function renderPositionSize() {
    const target = document.getElementById('compoundPositionSizeContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.calculatePositionSize({
        equity: numberFrom('compoundPositionEquityInput', NaN),
        availableCash: numberFrom('compoundPositionCashInput', NaN),
        riskPercent: numberFrom('compoundPositionRiskInput', NaN),
        entryPrice: numberFrom('compoundPositionEntryInput', NaN),
        stopPrice: numberFrom('compoundPositionStopInput', NaN),
        maxPositionPercent: numberFrom('compoundPositionMaxWeightInput', NaN),
        lotSize: 100
      });
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('风险预算', money(result.riskBudget) + ' 元', '账户权益 × 风险比例') +
        metric('每股风险', money(result.riskPerShare) + ' 元', '入场价 - 止损价') +
        metric('纸面数量', result.quantity + ' 股', '按 100 股向下取整', result.quantity === 0 ? 'warning' : '') +
        metric('纸面仓位', money(result.positionValue) + ' 元', percent(result.positionWeightPercent) + ' · 约束：' + bindingLabel(result.bindingConstraint)) +
        metric('止损情景损失', money(result.actualRisk) + ' 元', '不含跳空和滑点') + '</div>' +
        '<p class="compound-boundary">仓位计算依赖你输入的止损价；涨跌停、跳空、流动性和实际成交会使损失超过预算。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderRiskReward() {
    const target = document.getElementById('compoundRiskRewardContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.analyzeRiskReward({
        entryPrice: numberFrom('compoundRiskRewardEntryInput', NaN),
        stopPrice: numberFrom('compoundRiskRewardStopInput', NaN),
        targetPrice: numberFrom('compoundRiskRewardTargetInput', NaN),
        roundTripCostPerShare: numberFrom('compoundRiskRewardCostInput', NaN)
      });
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('净风险 / 股', money(result.netRiskPerShare) + ' 元', '含输入的往返成本') +
        metric('净回报 / 股', money(result.netRewardPerShare) + ' 元', '目标价情景') +
        metric('回报风险比', result.rewardRiskRatio.toFixed(2) + ' : 1', '净回报 ÷ 净风险') +
        metric('理论保本胜率', percent(result.breakEvenWinRatePercent), '忽略结果相关性') +
        metric('止损 / 目标幅度', percent(result.stopLossPercent) + ' / ' + percent(result.targetGainPercent), '相对入场价') + '</div>' +
        '<p class="compound-boundary">目标价和止损价只是情景输入；该比值不表示策略有正收益，也不替代样本验证。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderExpectancy() {
    const target = document.getElementById('compoundExpectancyContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.analyzeExpectancy({
        winRatePercent: numberFrom('compoundExpectancyWinRateInput', NaN),
        lossRatePercent: numberFrom('compoundExpectancyLossRateInput', NaN),
        averageWin: numberFrom('compoundExpectancyAverageWinInput', NaN),
        averageLoss: numberFrom('compoundExpectancyAverageLossInput', NaN)
      });
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('每样本期望', money(result.expectedValue) + ' 元', '按输入概率加权', result.expectedValue < 0 ? 'warning' : '') +
        metric('Profit Factor', result.profitFactor == null ? '--' : result.profitFactor.toFixed(3), '概率加权盈利 ÷ 亏损') +
        metric('绝对保本胜率', percent(result.breakEvenWinRatePercent), '固定 ' + percent(result.flatRatePercent) + ' 持平结果') +
        metric('未计结果比例', percent(result.flatRatePercent), '100% - 胜率 - 负率') + '</div>' +
        '<p class="compound-boundary">全部参数由用户输入；如果样本不足、有幸存者偏差或费用遗漏，期望值没有外推意义。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderStress() {
    const target = document.getElementById('compoundStressContent');
    if (!target) return;
    const scenarios = window.CompoundLabModel.runStressScenarios(state.positions, selectedSummary().cashBalance, [-5, -10, -20]);
    const rows = scenarios.map(function(item) {
      return '<tr><td>' + percent(item.shockPercent) + '</td><td>' + money(item.equityValue) + ' 元</td><td>' + money(item.totalAssets) + ' 元</td><td class="pnl-down">' + money(item.lossAmount) + ' 元</td><td class="pnl-down">' + percent(item.lossPercent) + '</td></tr>';
    }).join('');
    target.innerHTML = state.positions.length
      ? '<div class="table-scroll"><table class="data-table"><thead><tr><th>股票同步冲击</th><th>冲击后股票市值</th><th>冲击后总资产</th><th>资产变化</th><th>组合变化率</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="compound-boundary">假设现金不变、所有股票等比例变动；未建模个股相关性、流动性、涨跌停或盘中路径。</p>'
      : '<div class="compound-empty warning">没有当前持仓，无法运行组合压力测试。</div>';
  }

  function stopSourceLabel(source) {
    if (source === 'position-input') return '持仓止损';
    if (source === 'auto-d2') return '自选 D2';
    if (source === 'alert-low') return '自选下破预警';
    return '未知';
  }

  function renderStopExposure() {
    const target = document.getElementById('compoundStopExposureContent');
    if (!target) return;
    if (!state.positions.length) {
      target.innerHTML = '<div class="compound-empty warning">没有当前持仓，无法计算止损风险暴露。</div>';
      return;
    }
    try {
      const result = window.CompoundLabModel.analyzeStopExposure(
        state.positions,
        state.watchlist,
        selectedSummary().totalAssets
      );
      const rows = result.rows.map(function(item) {
        return '<tr><td>' + escapeHtml(item.code) + '</td><td>' + escapeHtml(item.name) + '</td><td>' + money(item.currentPrice) + '</td><td>' + money(item.stopPrice) + '</td><td>' + escapeHtml(stopSourceLabel(item.source)) + '</td><td>' + money(item.riskAmount) + ' 元</td><td>' + percent(item.riskPercent, 3) + '</td></tr>';
      }).join('');
      const warnings = [];
      if (result.missingCodes.length) warnings.push('缺少有效现价、数量或止损：' + result.missingCodes.join('、'));
      if (result.breachedCodes.length) warnings.push('止损已不低于当前价，需人工复核：' + result.breachedCodes.join('、'));
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('已知止损风险', money(result.knownRiskAmount) + ' 元', percent(result.knownRiskPercent, 3) + ' 占账户权益', warnings.length ? 'warning' : '') +
        metric('持仓覆盖', result.coveredCount + ' / ' + result.totalPositionCount, percent(result.positionCoveragePercent) + ' 按只数') +
        metric('市值覆盖', percent(result.valueCoveragePercent), '只统计可计算止损的持仓') + '</div>' +
        (warnings.length ? '<div class="compound-empty warning"><strong>未覆盖部分没有被当作零风险。</strong><span>' + escapeHtml(warnings.join('；')) + '</span></div>' : '') +
        (rows ? '<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>代码</th><th>名称</th><th>现价</th><th>止损价</th><th>来源</th><th>情景损失</th><th>占权益</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
        '<p class="compound-boundary">按“现价跌至止损价”计算，不含跳空、跌停、滑点和无法成交风险；D2/预警价不是自动委托。</p>';
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function readinessLabel(status) {
    if (status === 'ready') return '可用';
    if (status === 'limited') return '样本较少';
    if (status === 'validation-required') return '需要验证';
    return '样本不足';
  }

  function renderReadiness() {
    const target = document.getElementById('compoundReadinessContent');
    if (!target) return;
    const result = window.CompoundLabModel.assessDataReadiness(state);
    const rows = [
      ['目标复利数学', result.targetPath],
      ['总资产峰谷历史', result.snapshotHistory],
      ['交易胜率与盈亏比', result.tradeLedger],
      ['当前持仓风险', result.currentPortfolio],
      ['评论区方法', result.commentMethods]
    ].map(function(row) {
      return '<tr><td><strong>' + escapeHtml(row[0]) + '</strong></td><td><span class="compound-readiness-state ' + escapeHtml(row[1].status) + '">' +
        escapeHtml(readinessLabel(row[1].status)) + '</span></td><td>' + escapeHtml(row[1].detail) + '</td></tr>';
    }).join('');
    const evidenceRows = COMMENT_METHOD_EVIDENCE.items.map(function(item) {
      return '<tr><td><strong>' + escapeHtml(item.method) + '</strong></td><td>' + escapeHtml(item.evidence) + '</td><td>' + escapeHtml(item.gate) + '</td></tr>';
    }).join('');
    target.innerHTML = '<div class="table-scroll"><table class="data-table"><thead><tr><th>方法</th><th>状态</th><th>当前证据</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="compound-empty"><strong>评论处理规则</strong><span>只纳入采集时页面可见评论；只有平台标记或已核验身份才称为作者回复。无法形式化的交流不会进入回测。</span></div>' +
      '<section class="compound-comment-evidence"><div class="compound-lab-panel-title"><div><h4>评论区方法线索</h4><p>' + escapeHtml(COMMENT_METHOD_EVIDENCE.observedAt + ' · ' + COMMENT_METHOD_EVIDENCE.coverage) + '</p></div><span class="compound-method-badge">线索，不是已验证模型</span></div>' +
      '<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>方法线索</th><th>评论证据与反证</th><th>进入程序前的门禁</th></tr></thead><tbody>' + evidenceRows + '</tbody></table></div></section>';
  }

  function renderLossPath() {
    const target = document.getElementById('compoundLossPathContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.calculateLossPath({
        initialEquity: numberFrom('compoundLossPathEquityInput', NaN),
        riskPercent: numberFrom('compoundLossPathRiskInput', NaN),
        consecutiveLosses: numberFrom('compoundLossPathCountInput', NaN)
      });
      const visiblePoints = result.points.slice(-20);
      const rows = visiblePoints.map(function(point) {
        return '<tr><td>' + point.step + '</td><td>' + money(point.lossAmount) + ' 元</td><td>' + money(point.equity) + ' 元</td></tr>';
      }).join('');
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('亏损后权益', money(result.finalEquity) + ' 元', '每次按当时权益计风险') +
        metric('累计回撤', percent(result.drawdownPercent), '连续亏损情景', result.drawdownPercent >= 20 ? 'warning' : '') +
        metric('回到原点所需', percent(result.recoveryPercent), '不含新增投入') +
        metric('路径步数', String(result.points.length - 1), result.points.length > 21 ? '表格仅显示最后 20 步' : '完整显示') + '</div>' +
        '<div class="table-scroll narrow-table"><table class="data-table compact-table"><thead><tr><th>第几次亏损</th><th>本次损失</th><th>剩余权益</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="compound-boundary">这是固定风险比例的机械路径，不代表真实交易会独立发生或严格止损成交。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderLossRun() {
    const target = document.getElementById('compoundLossRunContent');
    if (!target) return;
    try {
      const result = window.CompoundLabModel.calculateLossRunExperiment({
        winRatePercent: numberFrom('compoundLossRunWinRateInput', NaN),
        trialCount: numberFrom('compoundLossRunTrialsInput', NaN),
        streakLength: numberFrom('compoundLossRunLengthInput', NaN)
      });
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('下一段全亏（IID）', percent(result.nextStreakProbabilityPercent, 4), result.streakLength + ' 次独立同分布试验') +
        metric('样本内至少出现一次', percent(result.atLeastOneStreakProbabilityPercent, 4), result.trialCount + ' 次独立试验中') +
        metric('试验次数 / 连亏长度', result.trialCount + ' / ' + result.streakLength, '整数输入') + '</div>' +
        '<div class="compound-empty warning"><strong>这不是对真实策略的预测。</strong><span>公式明确假设每次结果独立同分布且胜率恒定；真实市场通常不满足这些条件。</span></div>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderPnlDistribution() {
    const target = document.getElementById('compoundPnlDistributionContent');
    if (!target) return;
    const values = numberListFrom('compoundPnlSeriesInput');
    if (!values.length) {
      target.innerHTML = '<div class="compound-empty"><strong>请粘贴真实盈亏序列。</strong><span>支持空格、逗号或分号分隔，最多 500 项；程序不会用示例数据冒充你的交易记录。</span></div>';
      saveSettings();
      return;
    }
    try {
      const result = window.CompoundLabModel.analyzePnlDistribution(values);
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('样本数', String(result.sampleCount), result.winCount + ' 盈 / ' + result.lossCount + ' 亏 / ' + result.flatCount + ' 平', result.sampleCount < 20 ? 'warning' : '') +
        metric('均值 / 中位数', money(result.mean) + ' / ' + money(result.median), '元/样本') +
        metric('Q1 / Q3', money(result.q1) + ' / ' + money(result.q3), 'R7 分位数') +
        metric('四分位距', money(result.iqr), 'Q3 - Q1') +
        metric('样本标准差', result.sampleStandardDeviation == null ? '--' : money(result.sampleStandardDeviation), 'n - 1 分母') +
        metric('最小 / 最大', money(result.minimum) + ' / ' + money(result.maximum), '仅描述输入样本') + '</div>' +
        '<p class="compound-boundary">描述统计只总结输入样本，不推断未来分布；小样本、筛选偏差和漏记费用会改变结论。</p>';
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function renderEquityPath() {
    const target = document.getElementById('compoundEquityPathContent');
    if (!target) return;
    const values = numberListFrom('compoundEquityPnlSeriesInput');
    if (!values.length) {
      target.innerHTML = '<div class="compound-empty"><strong>请粘贴按时间排序的真实盈亏序列。</strong><span>最多 500 项；它会按输入顺序重建样本权益路径，不会随机生成未来路径。</span></div>';
      saveSettings();
      return;
    }
    try {
      const result = window.CompoundLabModel.buildSampleEquityPath({
        initialCapital: numberFrom('compoundEquityInitialInput', NaN),
        pnlValues: values
      });
      const visiblePoints = result.points.slice(-30);
      const rows = visiblePoints.map(function(point) {
        const tone = point.drawdownPercent > 0 ? ' class="pnl-down"' : '';
        return '<tr><td>' + point.step + '</td><td>' + money(point.pnl) + '</td><td>' + money(point.equity) + '</td><td' + tone + '>' + percent(point.drawdownPercent, 3) + '</td></tr>';
      }).join('');
      target.innerHTML = '<div class="compound-metric-grid">' +
        metric('期末权益', money(result.finalCapital) + ' 元', '按输入顺序累计', result.capitalDepleted ? 'warning' : '') +
        metric('样本净盈亏', money(result.netPnl) + ' 元', values.length + ' 个样本') +
        metric('样本最大回撤', percent(result.maximumDrawdownPercent, 3), '高水位法') +
        metric('最长水下跨度', result.longestUnderwaterSpan + ' 步', result.underwaterObservationCount + ' 个水下观测') + '</div>' +
        (result.capitalDepleted ? '<div class="compound-empty warning">输入路径中的权益已耗尽或为负，请核对数据和本金口径。</div>' : '') +
        '<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>步骤</th><th>本步盈亏</th><th>权益</th><th>距高水位</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        (result.points.length > 31 ? '<p class="compound-boundary">为保持页面流畅，表格只显示最后 30 步；统计使用全部输入样本。</p>' : '<p class="compound-boundary">只重建已发生的样本路径，不生成未来收益预测。</p>');
      saveSettings();
    } catch (error) {
      target.innerHTML = '<div class="compound-empty warning">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  const renderers = {
    target: renderTarget,
    recovery: renderRecovery,
    cashBuffer: renderCashBuffer,
    stagedAverage: renderStagedAverage,
    breakEven: renderBreakEven,
    risk: renderRisk,
    drawdown: renderDrawdown,
    rebalance: renderRebalance,
    stress: renderStress,
    stopExposure: renderStopExposure,
    ledger: renderLedger,
    cost: renderCost,
    positionSize: renderPositionSize,
    riskReward: renderRiskReward,
    expectancy: renderExpectancy,
    readiness: renderReadiness,
    lossPath: renderLossPath,
    lossRun: renderLossRun,
    pnlDistribution: renderPnlDistribution,
    equityPath: renderEquityPath
  };

  function markAllModulesDirty() {
    MODULE_ORDER.forEach(function(key) { dirtyModules.add(key); });
  }

  function renderActiveModule(force) {
    const renderer = renderers[activeModule];
    if (!renderer || (!force && !dirtyModules.has(activeModule))) return;
    renderer();
    dirtyModules.delete(activeModule);
  }

  async function load(force) {
    const requestedAccountId = currentAccountId();
    if (loading && Number(loadingAccountId) === Number(requestedAccountId)) return activeLoadPromise;
    if (!force && loadedAt && Date.now() - loadedAt < 60000) {
      renderActiveModule(true);
      return;
    }
    const generation = ++loadGeneration;
    loading = true;
    loadingAccountId = requestedAccountId;
    loadedAt = 0;
    setError(null);
    setStatus('正在读取本地账户...', 'loading');
    state.accounts = [];
    state.positions = [];
    state.closedPositions = [];
    state.trades = [];
    state.snapshots = [];
    state.watchlist = [];
    state.account = null;
    markAllModulesDirty();
    clearResults();
    const request = (async function() {
      const accounts = await api('/api/portfolio/accounts/overview');
      if (generation !== loadGeneration) return;
      state.accounts = Array.isArray(accounts) ? accounts : [];
      renderAccountSelect();
      const accountId = currentAccountId();
      rememberActiveAccount(accountId);
      state.account = state.accounts.find(function(account) { return Number(account.id) === Number(accountId); }) || null;
      const results = await Promise.all([
        api(accountQuery('/api/portfolio/positions', accountId)),
        api(accountQuery('/api/portfolio/closed-positions', accountId)),
        api(accountQuery('/api/portfolio/trades', accountId)),
        api(accountQuery('/api/portfolio/snapshots?limit=120', accountId)),
        api('/api/portfolio/watchlist')
      ]);
      if (generation !== loadGeneration) return;
      state.positions = Array.isArray(results[0]) ? results[0] : [];
      state.closedPositions = Array.isArray(results[1]) ? results[1] : [];
      state.trades = Array.isArray(results[2]) ? results[2] : [];
      state.snapshots = Array.isArray(results[3]) ? results[3] : [];
      state.watchlist = Array.isArray(results[4]) ? results[4] : [];
      fillInputsForAccount();
      loadedAt = Date.now();
      markAllModulesDirty();
      renderActiveModule(true);
      setStatus('已加载 · ' + state.positions.length + ' 只持仓 · ' + state.snapshots.length + ' 个快照', 'ready');
    })();
    activeLoadPromise = request;
    try {
      await request;
    } catch (error) {
      if (generation !== loadGeneration) return;
      loadedAt = 0;
      setError(error);
      setStatus('加载失败', 'error');
      clearResults('加载失败，请查看上方原因并重试。', 'error');
    } finally {
      if (generation === loadGeneration) {
        loading = false;
        loadingAccountId = 0;
        activeLoadPromise = null;
      }
    }
  }

  function switchModule(key, persist) {
    activeModule = MODULE_ORDER.includes(key) ? key : 'target';
    const group = Object.keys(MODULE_GROUPS).find(function(groupKey) {
      return MODULE_GROUPS[groupKey].includes(activeModule);
    }) || 'goal';
    applyCategory(group);
    document.querySelectorAll('.compound-lab-tabs [data-compound-module]').forEach(function(button) {
      const active = button.getAttribute('data-compound-module') === activeModule;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-compound-panel]').forEach(function(panel) {
      const active = panel.getAttribute('data-compound-panel') === activeModule;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    const picker = document.getElementById('compoundModuleSelect');
    if (picker) picker.value = activeModule;
    const position = document.getElementById('compoundModulePosition');
    if (position) position.textContent = String(MODULE_ORDER.indexOf(activeModule) + 1).padStart(2, '0') + ' / ' + MODULE_ORDER.length;
    if (activeModule === 'target') setTimeout(resize, 0);
    if (loadedAt) renderActiveModule(false);
    if (persist !== false) saveSettings();
  }

  function applyCategory(group) {
    activeCategory = MODULE_GROUPS[group] ? group : 'goal';
    document.querySelectorAll('[data-compound-category]').forEach(function(button) {
      const active = button.getAttribute('data-compound-category') === activeCategory;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('.compound-lab-tabs [data-compound-module]').forEach(function(button) {
      button.hidden = button.getAttribute('data-compound-group') !== activeCategory;
    });
  }

  function switchCategory(group) {
    const modules = MODULE_GROUPS[group] || MODULE_GROUPS.goal;
    const nextModule = modules.includes(activeModule) ? activeModule : modules[0];
    switchModule(nextModule);
  }

  function bindInput(ids, moduleKey) {
    ids.forEach(function(id) {
      const input = document.getElementById(id);
      if (!input) return;
      const update = function() {
        dirtyModules.add(moduleKey);
        if (activeModule === moduleKey) renderActiveModule(true);
      };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    });
  }

  function bind() {
    if (bound) return;
    bound = true;
    const tabs = document.querySelector('.compound-lab-tabs');
    if (tabs) tabs.addEventListener('click', function(event) {
      const button = event.target.closest('[data-compound-module]');
      if (button) switchModule(button.getAttribute('data-compound-module'));
    });
    if (tabs) tabs.addEventListener('keydown', function(event) {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(tabs.querySelectorAll('[data-compound-module]:not([hidden])'));
      const current = buttons.indexOf(document.activeElement);
      if (current < 0 || !buttons.length) return;
      event.preventDefault();
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      const button = buttons[next];
      switchModule(button.getAttribute('data-compound-module'));
      button.focus();
    });
    const categories = document.querySelector('.compound-lab-category-bar, .compound-category-toolbar');
    if (categories) categories.addEventListener('click', function(event) {
      const button = event.target.closest('[data-compound-category]');
      if (button) switchCategory(button.getAttribute('data-compound-category'));
    });
    const moduleSelect = document.getElementById('compoundModuleSelect');
    if (moduleSelect) moduleSelect.addEventListener('change', function() {
      switchModule(moduleSelect.value);
    });
    const refresh = document.getElementById('refreshCompoundLabBtn');
    if (refresh) refresh.addEventListener('click', function() { load(true); });
    const accountSelect = document.getElementById('compoundLabAccountSelect');
    if (accountSelect) accountSelect.addEventListener('change', function() {
      rememberActiveAccount(Number(accountSelect.value));
      loadedAt = 0;
      load(true);
    });
    bindInput(['compoundInitialInput', 'compoundTargetInput', 'compoundYearsInput', 'compoundMonthlyInput'], 'target');
    bindInput(['compoundRecoveryDrawdownInput', 'compoundRecoveryRateInput'], 'recovery');
    bindInput(['compoundCashInput', 'compoundMonthlyEssentialInput', 'compoundReserveMonthsInput'], 'cashBuffer');
    bindInput(['compoundStagedCashInput', 'compoundStagedPricesInput', 'compoundStagedWeightsInput'], 'stagedAverage');
    bindInput(['compoundBreakEvenCostInput', 'compoundBreakEvenQuantityInput', 'compoundBreakEvenFixedCostInput', 'compoundBreakEvenRateInput'], 'breakEven');
    bindInput(['compoundMaxWeightInput'], 'rebalance');
    bindInput(['compoundCostCapitalInput', 'compoundTurnoverInput', 'compoundFeeRateInput', 'compoundCostYearsInput'], 'cost');
    bindInput(['compoundPositionEquityInput', 'compoundPositionCashInput', 'compoundPositionRiskInput', 'compoundPositionEntryInput', 'compoundPositionStopInput', 'compoundPositionMaxWeightInput'], 'positionSize');
    bindInput(['compoundRiskRewardEntryInput', 'compoundRiskRewardStopInput', 'compoundRiskRewardTargetInput', 'compoundRiskRewardCostInput'], 'riskReward');
    bindInput(['compoundExpectancyWinRateInput', 'compoundExpectancyLossRateInput', 'compoundExpectancyAverageWinInput', 'compoundExpectancyAverageLossInput'], 'expectancy');
    bindInput(['compoundLossPathEquityInput', 'compoundLossPathRiskInput', 'compoundLossPathCountInput'], 'lossPath');
    bindInput(['compoundLossRunWinRateInput', 'compoundLossRunTrialsInput', 'compoundLossRunLengthInput'], 'lossRun');
    bindInput(['compoundPnlSeriesInput'], 'pnlDistribution');
    bindInput(['compoundEquityInitialInput', 'compoundEquityPnlSeriesInput'], 'equityPath');
    const openResearch = document.getElementById('compoundOpenAiResearchBtn');
    if (openResearch) openResearch.addEventListener('click', function() { window.switchMainView('aiResearch'); });
    const openScreener = document.getElementById('compoundOpenScreenerBtn');
    if (openScreener) openScreener.addEventListener('click', function() { window.switchMainView('screener'); });
    switchModule(readSettings().activeModule || 'target', false);
  }

  function ensureLoaded() {
    bind();
    return load(false);
  }

  function resize() {
    if (targetChart) targetChart.resize();
  }

  function rerender() {
    if (loadedAt) {
      dirtyModules.add(activeModule);
      renderActiveModule(true);
    }
  }

  window.CompoundLab = { bind, ensureLoaded, load, resize, rerender };
})();
