(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MarketInstitutionalFlow = api.createModule();
})(typeof window !== 'undefined' ? window : null, function() {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function selectRepresentativeContracts(items) {
    const selected = new Map();
    (items || []).forEach(function(item) {
      const product = String(item.product || '');
      const weight = Number(item.disclosedLong || 0) + Number(item.disclosedShort || 0);
      const current = selected.get(product);
      const currentWeight = current
        ? Number(current.disclosedLong || 0) + Number(current.disclosedShort || 0)
        : -1;
      if (product && weight > currentWeight) selected.set(product, item);
    });
    return Array.from(selected.values()).sort(function(a, b) {
      return String(a.product).localeCompare(String(b.product));
    });
  }

  function summarizeCiticComparableContracts(items) {
    const products = new Map();
    let disclosedLong = 0;
    let disclosedShort = 0;
    let rankedMemberImbalance = 0;
    let rankedMemberImbalanceChange = 0;
    let comparableContracts = 0;

    (Array.isArray(items) ? items : []).forEach(function(item) {
      (Array.isArray(item && item.focusMembers) ? item.focusMembers : []).forEach(function(member) {
        if (!member || member.member !== '中信期货') return;
        const product = String(item.product || '其他');
        const longValue = Number(member.disclosedLong);
        const shortValue = Number(member.disclosedShort);
        const imbalance = Number(member.rankedMemberImbalance);
        const imbalanceChange = Number(member.rankedMemberImbalanceChange);
        const productSummary = products.get(product) || {
          product,
          disclosedLong: 0,
          disclosedShort: 0,
          rankedMemberImbalance: 0,
          rankedMemberImbalanceChange: 0,
          comparableContracts: 0
        };
        if (Number.isFinite(longValue)) {
          disclosedLong += longValue;
          productSummary.disclosedLong += longValue;
        }
        if (Number.isFinite(shortValue)) {
          disclosedShort += shortValue;
          productSummary.disclosedShort += shortValue;
        }
        if (Number.isFinite(imbalance)) {
          rankedMemberImbalance += imbalance;
          productSummary.rankedMemberImbalance += imbalance;
        }
        if (Number.isFinite(imbalanceChange)) {
          rankedMemberImbalanceChange += imbalanceChange;
          productSummary.rankedMemberImbalanceChange += imbalanceChange;
        }
        comparableContracts += 1;
        productSummary.comparableContracts += 1;
        products.set(product, productSummary);
      });
    });

    return {
      disclosedLong,
      disclosedShort,
      rankedMemberImbalance,
      rankedMemberImbalanceChange,
      comparableContracts,
      products: Array.from(products.values()).sort(function(left, right) {
        return left.product.localeCompare(right.product);
      })
    };
  }

  function summarizeDisclosedRankedContracts(items) {
    const products = new Map();
    const summary = {
      disclosedLong: 0,
      disclosedShort: 0,
      rankedMemberImbalance: 0,
      rankedMemberImbalanceChange: 0,
      contractCount: 0
    };
    (Array.isArray(items) ? items : []).forEach(function(item) {
      const product = String(item && item.product || '其他');
      const productSummary = products.get(product) || {
        product,
        disclosedLong: 0,
        disclosedShort: 0,
        rankedMemberImbalance: 0,
        rankedMemberImbalanceChange: 0,
        contractCount: 0
      };
      ['disclosedLong', 'disclosedShort', 'rankedMemberImbalance', 'rankedMemberImbalanceChange'].forEach(function(key) {
        const value = Number(item && item[key]);
        if (!Number.isFinite(value)) return;
        summary[key] += value;
        productSummary[key] += value;
      });
      summary.contractCount += 1;
      productSummary.contractCount += 1;
      products.set(product, productSummary);
    });
    summary.products = Array.from(products.values()).sort(function(left, right) {
      return left.product.localeCompare(right.product);
    });
    return summary;
  }

  function buildDashboardSummary(data) {
    const etf = data && data.etf || {};
    const futures = data && data.futures || {};
    const etfItems = etf.availability === 'available' && Array.isArray(etf.items) ? etf.items : [];
    const inflows = etfItems.filter(item => item.direction === 'inflow').sort(function(a, b) {
      return Number(b.estimatedNetFlowHundredMillion || 0) - Number(a.estimatedNetFlowHundredMillion || 0);
    });
    const outflows = etfItems.filter(item => item.direction === 'outflow').sort(function(a, b) {
      return Number(a.estimatedNetFlowHundredMillion || 0) - Number(b.estimatedNetFlowHundredMillion || 0);
    });
    const representativeFutures = futures.availability === 'available'
      ? selectRepresentativeContracts(futures.items)
      : [];
    const citicAggregate = futures.availability === 'available'
      ? summarizeCiticComparableContracts(futures.items)
      : summarizeCiticComparableContracts([]);
    const disclosedAggregate = futures.availability === 'available'
      ? summarizeDisclosedRankedContracts(futures.items)
      : summarizeDisclosedRankedContracts([]);
    const citicFutures = representativeFutures.flatMap(function(item) {
      return (Array.isArray(item.focusMembers) ? item.focusMembers : []).filter(function(member) {
        return member && member.member === '中信期货';
      }).map(function(member) {
        return {
          product: item.product,
          contract: item.contract,
          member: member.member,
          rankedMemberImbalance: member.rankedMemberImbalance,
          rankedMemberImbalanceChange: member.rankedMemberImbalanceChange
        };
      });
    });
    return {
      asOf: etf.asOf || futures.asOf || null,
      topInflow: inflows[0] || null,
      topOutflow: outflows[0] || null,
      futures: representativeFutures,
      citicFutures,
      citicAggregate,
      disclosedAggregate,
      etfAvailable: etf.availability === 'available',
      futuresAvailable: futures.availability === 'available'
    };
  }

  function signed(value, suffix) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return (number > 0 ? '+' : '') + number.toLocaleString('zh-CN') + (suffix || '');
  }

  function formatNumber(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return number.toLocaleString('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits == null ? 2 : digits
    });
  }

  function amountHundredMillion(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return (number > 0 ? '+' : '') + number.toFixed(2) + ' 亿';
  }

  function turnoverStateLabel(value) {
    return value === 'expanding' ? '近5分钟放量' : value === 'contracting' ? '近5分钟缩量' :
      value === 'stable' ? '近5分钟平稳' : '动量不可用';
  }

  function positioningStateLabel(value) {
    return ({
      'price-up-oi-up': '上涨增仓',
      'price-up-oi-down': '上涨减仓',
      'price-down-oi-up': '下跌增仓',
      'price-down-oi-down': '下跌减仓'
    })[value] || '价量仓不可用';
  }

  function money(value) {
    if (value === null || value === undefined || value === '') return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    if (Math.abs(number) >= 100000000) return (number / 100000000).toFixed(2) + '亿';
    if (Math.abs(number) >= 10000) return (number / 10000).toFixed(0) + '万';
    return number.toFixed(0);
  }

  function percent(value) {
    if (value === null || value === undefined || value === '') return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return (number > 0 ? '+' : '') + number.toFixed(2) + '%';
  }

  function setText(documentObject, id, value) {
    const element = documentObject && documentObject.getElementById(id);
    if (element) element.textContent = value;
  }

  function flowDirectionText(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '变化不可用';
    return number > 0 ? '净差向多方变化' : number < 0 ? '净差向空方变化' : '净差无变化';
  }

  function dailyChangeText(value) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '今日变化不可用';
    const number = Number(value);
    return number === 0 ? '今日净多空无变化' : '今日净增' + (number > 0 ? '多 ' : '空 ') + formatNumber(Math.abs(number), 0) + ' 手';
  }

  function renderAggregateTotal(aggregate, label) {
    const current = Number(aggregate && aggregate.rankedMemberImbalance);
    const change = Number(aggregate && aggregate.rankedMemberImbalanceChange);
    const direction = change < 0 ? 'net-short' : change > 0 ? 'net-long' : 'balanced';
    const position = current < 0 ? '净空 ' + formatNumber(Math.abs(current), 0)
      : current > 0 ? '净多 ' + formatNumber(current, 0) : '持平 0';
    return '<article class="citic-aggregate-total ' + direction + '"><span>' + escapeHtml(label) + '</span>' +
      '<strong class="aggregate-daily-change">' + dailyChangeText(change) + '</strong>' +
      '<b class="aggregate-position">日终' + position + ' 手</b>' +
      '<small>披露持买 ' + formatNumber(aggregate.disclosedLong, 0) + ' · 持卖 ' + formatNumber(aggregate.disclosedShort, 0) + '</small></article>';
  }

  function renderEtf(section, documentObject) {
    const inList = documentObject.getElementById('etfFlowInList');
    const outList = documentObject.getElementById('etfFlowOutList');
    if (!inList || !outList) return;
    if (!section || section.availability !== 'available') {
      const message = section && section.error && section.error.message || 'ETF日度估算当前不可用';
      const empty = '<div class="institutional-empty">' + escapeHtml(message) + '<br><small>未使用成交额或历史旧值替代</small></div>';
      inList.innerHTML = empty;
      outList.innerHTML = empty;
      setText(documentObject, 'etfFlowMeta', '数据不可用 · 检查时间 ' + (section && section.checkedAt ? new Date(section.checkedAt).toLocaleString('zh-CN') : '--'));
      return;
    }
    function row(item) {
      const directionClass = item.direction === 'inflow' ? 'positive' : 'negative';
      return '<div class="etf-flow-row">' +
        '<span class="etf-flow-rank"></span>' +
        '<div><strong>' + escapeHtml(item.name || item.code) + '</strong><small>' + escapeHtml(item.code) + '</small></div>' +
        '<b class="' + directionClass + '">' + amountHundredMillion(item.estimatedNetFlowHundredMillion) + '</b>' +
        '</div>';
    }
    const inflows = section.items.filter(item => item.direction === 'inflow').slice(0, 10);
    const outflows = section.items.filter(item => item.direction === 'outflow').slice(0, 10);
    inList.innerHTML = inflows.length ? inflows.map(row).join('') : '<div class="institutional-empty">没有可用流入记录</div>';
    outList.innerHTML = outflows.length ? outflows.map(row).join('') : '<div class="institutional-empty">没有可用流出记录</div>';
    setText(documentObject, 'etfFlowMeta', section.asOf + ' 收盘后 · ' + section.source.provider);
    setText(documentObject, 'etfFlowMethod', section.methodology);
  }

  function renderFutures(section, documentObject) {
    const grid = documentObject.getElementById('cffexPositionGrid');
    const citicFocus = documentObject.getElementById('cffexCiticFocus');
    const aggregateBox = documentObject.getElementById('cffexAggregate');
    if (!grid) return;
    if (!section || section.availability !== 'available') {
      const message = section && section.error && section.error.message || '中金所排名持仓当前不可用';
      grid.innerHTML = '<div class="institutional-empty">' + escapeHtml(message) + '<br><small>未使用第三方估算或旧值替代</small></div>';
      if (citicFocus) citicFocus.innerHTML = '<div class="institutional-empty compact">中信期货披露席位当前不可用</div>';
      if (aggregateBox) aggregateBox.innerHTML = '<div class="institutional-empty compact">全部前20名披露合约汇总当前不可用</div>';
      setText(documentObject, 'cffexPositionMeta', '数据不可用 · 检查时间 ' + (section && section.checkedAt ? new Date(section.checkedAt).toLocaleString('zh-CN') : '--'));
      return;
    }
    const items = selectRepresentativeContracts(section.items);
    const disclosedAggregate = summarizeDisclosedRankedContracts(section.items);
    const citicAggregate = summarizeCiticComparableContracts(section.items);
    const citicItems = items.flatMap(function(item) {
      return (Array.isArray(item.focusMembers) ? item.focusMembers : []).filter(function(member) {
        return member && member.member === '中信期货';
      }).map(function(member) {
        return { ...member, product: item.product, contract: item.contract };
      });
    });
    if (citicFocus) {
      const citicTotal = !documentObject.getElementById('dashboardCiticAggregate') && citicAggregate.comparableContracts ? renderAggregateTotal(citicAggregate, '中信全部可比合约') : '';
      citicFocus.innerHTML = citicTotal + (citicItems.length ? citicItems.map(function(item) {
        const direction = Number(item.rankedMemberImbalanceChange) < 0 ? 'net-short' : Number(item.rankedMemberImbalanceChange) > 0 ? 'net-long' : 'balanced';
        return '<article class="citic-futures-item ' + direction + '"><header><span>' + escapeHtml(item.product) + '</span><strong>' + escapeHtml(item.contract) + '</strong></header>' +
          '<b>' + dailyChangeText(item.rankedMemberImbalanceChange) + '</b><small>日终净持仓差 ' + signed(item.rankedMemberImbalance, ' 手') + '</small></article>';
      }).join('') : '<div class="institutional-empty compact">代表合约中暂无中信期货双边前20名披露；不代表零仓位。</div>');
    }
    if (aggregateBox) aggregateBox.innerHTML = renderAggregateTotal(disclosedAggregate, '全部前20名披露合约');
    grid.innerHTML = items.map(function(item) {
      const netShort = Number(item.rankedMemberImbalance) < 0;
      const state = netShort ? '披露席位偏空' : Number(item.rankedMemberImbalance) > 0 ? '披露席位偏多' : '披露席位均衡';
      return '<section class="cffex-position-item ' + (netShort ? 'net-short' : 'net-long') + '">' +
        '<div class="cffex-position-title"><span>' + escapeHtml(item.product) + '</span><div><strong>' + escapeHtml(item.productName || item.product) + '</strong><small>代表合约 ' + escapeHtml(item.contract) + '</small></div></div>' +
        '<b>' + state + ' ' + signed(item.rankedMemberImbalance, ' 手') + '</b>' +
        '<div class="cffex-position-bars"><span>持买 ' + signed(item.disclosedLong, '') + '</span><span>持卖 ' + signed(item.disclosedShort, '') + '</span></div>' +
        '<small>持仓差日变动 ' + signed(item.rankedMemberImbalanceChange, ' 手') + '</small>' +
        '</section>';
    }).join('') || '<div class="institutional-empty">没有满足披露条件的合约</div>';
    setText(documentObject, 'cffexPositionMeta', section.asOf + ' 收盘后 · 官方交易所披露');
    setText(documentObject, 'cffexPositionMethod', section.methodology + ' ' + section.truthStatement);
  }

  function renderDashboard(data, documentObject) {
    const etfBox = documentObject.getElementById('dashboardEtfFlowLeaders');
    const futuresBox = documentObject.getElementById('dashboardFuturesPositions');
    const citicBox = documentObject.getElementById('dashboardCiticFuturesFocus');
    const citicAggregateBox = documentObject.getElementById('dashboardCiticAggregate');
    const disclosedAggregateBox = documentObject.getElementById('dashboardCffexAggregate');
    if (!etfBox && !futuresBox && !citicAggregateBox) return;
    const summary = buildDashboardSummary(data);
    setText(documentObject, 'dashboardInstitutionalDailyAsOf', summary.asOf ? summary.asOf + ' 收盘后' : '日终数据不可用');
    setText(documentObject, 'dashboardCiticFuturesAsOf', summary.futuresAvailable
      ? ((data.futures.asOf || '--') + ' 日终 · ' + summary.citicAggregate.comparableContracts + ' 个可比合约')
      : '中金所日终披露不可用');

    function etfLeader(item, label, className) {
      if (!item) return '<article class="dashboard-etf-leader unavailable"><span>' + label + '</span><strong>不可用</strong><small>未使用替代值</small></article>';
      return '<article class="dashboard-etf-leader ' + className + '"><span>' + label + '</span>' +
        '<strong>' + escapeHtml(item.name || item.code) + '</strong><b>' + amountHundredMillion(item.estimatedNetFlowHundredMillion) + '</b>' +
        '<small>' + escapeHtml(item.code) + '</small></article>';
    }
    if (etfBox) etfBox.innerHTML = etfLeader(summary.topInflow, 'ETF净流入首位', 'inflow') +
      etfLeader(summary.topOutflow, 'ETF净流出首位', 'outflow');

    if (citicAggregateBox) {
      const aggregate = summary.citicAggregate;
      if (!summary.futuresAvailable || !aggregate.comparableContracts) {
        citicAggregateBox.innerHTML = '<div class="empty-state compact">暂无中信期货双边前20名可比合约；不代表零仓位。</div>';
      } else {
        const total = renderAggregateTotal(aggregate, '中信全部可比合约');
        const products = aggregate.products.map(function(item) {
          const direction = item.rankedMemberImbalanceChange < 0 ? 'net-short' : item.rankedMemberImbalanceChange > 0 ? 'net-long' : 'balanced';
          return '<article class="citic-aggregate-product ' + direction + '"><span>' + escapeHtml(item.product) + ' · ' + item.comparableContracts + ' 合约</span>' +
            '<strong class="aggregate-daily-change">' + dailyChangeText(item.rankedMemberImbalanceChange) + '</strong><b class="aggregate-position">日终净持仓差 ' + signed(item.rankedMemberImbalance, ' 手') + '</b><small>持买 ' + formatNumber(item.disclosedLong, 0) + ' · 持卖 ' + formatNumber(item.disclosedShort, 0) + '</small></article>';
        }).join('');
        citicAggregateBox.innerHTML = total + products;
      }
    }

    if (disclosedAggregateBox) {
      disclosedAggregateBox.innerHTML = summary.futuresAvailable && summary.disclosedAggregate.contractCount
        ? renderAggregateTotal(summary.disclosedAggregate, '全部前20名披露合约')
        : '<div class="empty-state compact">全部前20名披露合约汇总当前不可用。</div>';
    }

    if (citicBox) {
      citicBox.innerHTML = summary.citicFutures.length ? summary.citicFutures.map(function(item) {
        const value = Number(item.rankedMemberImbalance);
        const direction = item.rankedMemberImbalanceChange < 0 ? 'net-short' : item.rankedMemberImbalanceChange > 0 ? 'net-long' : 'balanced';
        return '<article class="citic-futures-item ' + direction + '"><header><span>' + escapeHtml(item.product) + '代表</span><strong>' + escapeHtml(item.contract) + '</strong></header>' +
          '<b>' + dailyChangeText(item.rankedMemberImbalanceChange) + '</b><small>日终净持仓差 ' + signed(value, ' 手') + '</small></article>';
      }).join('') : '<div class="empty-state compact">暂无中信期货双边前20名披露；不代表零仓位。</div>';
    }

    if (futuresBox) futuresBox.innerHTML = summary.futures.length ? summary.futures.map(function(item) {
      const value = Number(item.rankedMemberImbalance);
      const direction = value < 0 ? 'net-short' : value > 0 ? 'net-long' : 'balanced';
      return '<article class="dashboard-futures-item ' + direction + '"><div><span>' + escapeHtml(item.product) + '</span>' +
        '<strong>' + escapeHtml(item.contract) + '</strong></div><b>' + signed(value, ' 手') + '</b>' +
        '<small>' + (value < 0 ? '披露席位偏空' : value > 0 ? '披露席位偏多' : '披露席位均衡') + '</small></article>';
    }).join('') : '<div class="empty-state compact">中金所排名持仓当前不可用，未使用第三方值替代。</div>';
  }

  function renderIntraday(data, documentObject) {
    const etfs = data && Array.isArray(data.etfs) ? data.etfs : [];
    const futures = data && Array.isArray(data.futures) ? data.futures : [];
    const availableEtfs = etfs.filter(function(item) { return item.availability === 'available'; });
    const availableFutures = futures.filter(function(item) { return item.availability === 'available'; });
    const observedAt = data && data.observedAt || null;
    const displayTime = observedAt ? observedAt.slice(0, 16) : '--';
    const status = data && (data.stale || data.marketState === 'delayed' || data.marketState === 'stale-cache')
      ? '行情延迟或旧缓存 · 请核对各品种时间'
      : data && data.marketState === 'live' ? '盘中一分钟监控 · 每60秒检查'
        : data && data.marketState === 'partial' ? '一分钟行情部分可用'
          : data && data.marketState === 'latest-close' ? '最近完成时段的一分钟数据' : '一分钟行情当前不可用';
    setText(documentObject, 'dashboardInstitutionalFlowAsOf', displayTime);
    setText(documentObject, 'dashboardInstitutionalFlowStatus', status);
    setText(documentObject, 'institutionalIntradayAsOf', displayTime);
    setText(documentObject, 'institutionalIntradayStatus', status + ' · ETF ' + availableEtfs.length + '/4 · 期货 ' + availableFutures.length + '/4');

    function observationNote(item) {
      return '<footer>数据时间 ' + escapeHtml(item.observedAt || '--') +
        (item.stale ? ' · 延迟/旧缓存：' + escapeHtml(item.staleReason || '时效不足') : '') +
        (item.reason ? ' · ' + escapeHtml(item.reason) : '') + '</footer>';
    }

    function etfRows() {
      if (!availableEtfs.length) return '<div class="institutional-empty">一分钟ETF行情当前不可用，未使用5分钟数据替代。</div>';
      return availableEtfs.map(function(item) {
        const state = item.turnoverState || 'unavailable';
        return '<article class="institutional-intraday-item ' + escapeHtml(state) + '">' +
          '<header><span>' + escapeHtml(item.product) + '</span><div><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.code) + '</small></div><b>' + percent(item.changePct) + '</b></header>' +
          '<div class="institutional-intraday-focus"><span>近5分钟成交</span><strong>' + money(item.rolling5AmountYuan) + '</strong>' +
          '<b>' + turnoverStateLabel(state) + ' ' + percent(item.rolling5ChangePct) + '</b></div>' +
          '<footer>最新1分 ' + money(item.latestMinuteAmountYuan) + ' · 前5分 ' + money(item.previous5AmountYuan) + '</footer>' +
          observationNote(item) +
          '</article>';
      }).join('');
    }

    function futuresRows() {
      if (!availableFutures.length) return '<div class="institutional-empty">一分钟股指期货行情当前不可用，未使用日终持仓替代。</div>';
      return availableFutures.map(function(item) {
        const state = item.positioningState || 'unavailable';
        return '<article class="institutional-intraday-item ' + escapeHtml(state) + '">' +
          '<header><span>' + escapeHtml(item.product) + '</span><div><strong>' + escapeHtml(item.symbol) + '</strong><small>' + escapeHtml(item.name) + '</small></div><b>' + percent(item.sessionChangePct) + '</b></header>' +
          '<div><strong>' + positioningStateLabel(state) + '</strong><span>' + formatNumber(item.price, 1) + ' · 1分 ' + signed(item.minutePriceChange, '点') + '</span></div>' +
          '<footer>成交 ' + signed(item.minuteVolume, '手') + ' · 持仓变化 ' + signed(item.openInterestChange, '手') + '</footer>' +
          observationNote(item) +
          '</article>';
      }).join('');
    }

    ['dashboardEtfIntraday', 'marketEtfIntraday'].forEach(function(id) {
      const target = documentObject.getElementById(id);
      if (target) target.innerHTML = etfRows();
    });
    ['dashboardFuturesIntraday', 'marketFuturesIntraday'].forEach(function(id) {
      const target = documentObject.getElementById(id);
      if (target) target.innerHTML = futuresRows();
    });
  }

  function createModule(options) {
    options = options || {};
    const documentObject = options.document || (typeof document !== 'undefined' ? document : null);
    const timerWindow = options.window || (typeof window !== 'undefined' ? window : null);
    const fetchData = options.fetchData || function(path) {
      if (typeof window !== 'undefined' && window.ApiClient && window.ApiClient.fetchJsonData) {
        return window.ApiClient.fetchJsonData(path);
      }
      return window.fetch(path).then(function(response) {
        return response.json().then(function(payload) {
          if (!response.ok || payload.success === false) throw new Error(payload.error && payload.error.message || '日度资金请求失败');
          return payload.data === undefined ? payload : payload.data;
        });
      });
    };
    let dailyLoaded = false;
    let dailyLoadedAt = 0;
    const now = options.now || Date.now;
    let intradayLoaded = false;
    let dailyLoading = null;
    let intradayLoading = null;
    let intradayTimer = null;
    let activePage = null;
    let lastIntradayData = null;
    let timerGeneration = 0;

    function render(data) {
      if (!documentObject) return;
      renderEtf(data && data.etf, documentObject);
      renderFutures(data && data.futures, documentObject);
      renderDashboard(data, documentObject);
      const etfOk = data && data.etf && data.etf.availability === 'available';
      const futuresOk = data && data.futures && data.futures.availability === 'available';
      setText(documentObject, 'institutionalFlowStatus',
        etfOk && futuresOk ? 'ETF与中金所数据均已核对' : etfOk || futuresOk ? '部分来源可用；不可用部分未替代' : '两类来源当前均不可用');
    }

    function loadDaily(force) {
      if (dailyLoading) return dailyLoading;
      setText(documentObject, 'institutionalFlowStatus', '正在读取日度公开数据…');
      dailyLoading = fetchData('/api/market/institutional-flow' + (force ? '?refresh=1' : ''))
        .then(function(data) {
          dailyLoaded = true;
          dailyLoadedAt = now();
          render(data);
          return data;
        })
        .catch(function(error) {
          setText(documentObject, 'institutionalFlowStatus', '读取失败：' + (error.message || String(error)));
          throw error;
        })
        .finally(function() { dailyLoading = null; });
      return dailyLoading;
    }

    function scheduleIntraday(data) {
      if (!timerWindow || activePage !== 'etf') return;
      if (intradayTimer !== null) timerWindow.clearTimeout(intradayTimer);
      const generation = ++timerGeneration;
      const requested = Number(data && data.refreshIntervalMs);
      const delay = Number.isFinite(requested) ? Math.max(requested, 60 * 1000) : 60 * 1000;
      intradayTimer = timerWindow.setTimeout(function() {
        if (activePage !== 'etf' || generation !== timerGeneration) return;
        intradayTimer = null;
        if (documentObject && documentObject.hidden) {
          scheduleIntraday(data);
          return;
        }
        loadIntraday(true).catch(function() {});
      }, delay);
    }

    function loadIntraday(force) {
      if (intradayLoading) return intradayLoading;
      setText(documentObject, 'dashboardInstitutionalFlowStatus', '正在读取一分钟行情…');
      setText(documentObject, 'institutionalIntradayStatus', '正在读取一分钟公开行情…');
      intradayLoading = fetchData('/api/market/institutional-flow/intraday' + (force ? '?refresh=1' : ''))
        .then(function(data) {
          intradayLoaded = true;
          lastIntradayData = data;
          renderIntraday(data, documentObject);
          scheduleIntraday(data);
          return data;
        })
        .catch(function(error) {
          setText(documentObject, 'dashboardInstitutionalFlowStatus', '一分钟行情不可用');
          setText(documentObject, 'institutionalIntradayStatus', '读取失败：' + (error.message || String(error)));
          scheduleIntraday(lastIntradayData);
          throw error;
        })
        .finally(function() { intradayLoading = null; });
      return intradayLoading;
    }

    function setActivePage(pageId) {
      activePage = pageId;
      if (pageId === 'etf') {
        if (intradayLoaded && intradayTimer === null) scheduleIntraday(lastIntradayData);
      } else {
        ++timerGeneration;
        if (intradayTimer !== null && timerWindow) timerWindow.clearTimeout(intradayTimer);
        intradayTimer = null;
      }
    }

    function load(force, scope) {
      if (scope === 'daily') return loadDaily(force);
      if (scope === 'intraday') return loadIntraday(force);
      return Promise.all([loadDaily(force), loadIntraday(force)]);
    }

    function bind() {
      if (!documentObject) return;
      [['institutionalFlowRefreshBtn', 'daily'], ['institutionalIntradayRefreshBtn', 'intraday']].forEach(function(entry) {
      const button = documentObject.getElementById(entry[0]);
      if (button && button.dataset.bound !== '1') {
        button.dataset.bound = '1';
        button.addEventListener('click', function() {
          button.disabled = true;
          load(true, entry[1]).catch(function() {}).finally(function() { button.disabled = false; });
        });
      }
      });
    }

    return {
      bind,
      load,
      setActivePage,
      ensureLoaded: function(scope) {
        const tasks = [];
        if (scope !== 'intraday' && (!dailyLoaded || now() - dailyLoadedAt >= 300000)) tasks.push(loadDaily(false));
        if (scope !== 'daily' && !intradayLoaded) tasks.push(loadIntraday(false));
        return Promise.all(tasks);
      },
      render,
      renderIntraday
    };
  }

  return {
    selectRepresentativeContracts,
    summarizeCiticComparableContracts,
    summarizeDisclosedRankedContracts,
    buildDashboardSummary,
    turnoverStateLabel,
    positioningStateLabel,
    createModule
  };
});
