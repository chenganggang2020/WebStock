(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QuoteSnapshotClientModel = api;
})(typeof window !== 'undefined' ? window : null, function() {
  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function round(value, digits) {
    const number = finite(value);
    if (number === null) return null;
    const scale = Math.pow(10, digits == null ? 2 : digits);
    return Math.round((number + Number.EPSILON) * scale) / scale;
  }

  function quoteMap(quotes) {
    return new Map((Array.isArray(quotes) ? quotes : []).filter(function(quote) {
      return quote && /^\d{6}$/.test(String(quote.code || ''));
    }).map(function(quote) { return [String(quote.code), quote]; }));
  }

  function quoteEvidence(quote) {
    return {
      quoteStatus: quote.quoteStatus || 'unavailable',
      quoteFetchedAt: quote.fetchedAt || null,
      quoteChangedAt: quote.changedAt || null,
      quoteProviderObservedAt: quote.providerObservedAt || null,
      quoteSource: quote.source || null,
      quoteStale: quote.stale === true,
      quoteReason: quote.reason || null
    };
  }

  function usableQuote(quote) {
    return quote && quote.quoteStatus !== 'unavailable' && finite(quote.price) !== null && Number(quote.price) > 0;
  }

  function applyWatchlistQuotes(items, quotes) {
    const byCode = quoteMap(quotes);
    return (Array.isArray(items) ? items : []).map(function(item) {
      const quote = byCode.get(String(item.code || ''));
      if (!quote) return item;
      const evidence = quoteEvidence(quote);
      if (!usableQuote(quote)) return Object.assign({}, item, evidence);
      return Object.assign({}, item, quote, evidence);
    });
  }

  function applyPositionQuotes(positions, quotes) {
    const byCode = quoteMap(quotes);
    return (Array.isArray(positions) ? positions : []).map(function(position) {
      const quote = byCode.get(String(position.code || ''));
      if (!quote) return position;
      const evidence = quoteEvidence(quote);
      if (!usableQuote(quote)) return Object.assign({}, position, evidence, {
        currentPrice: null, price: null, marketValue: null, grossUnrealizedPnl: null,
        unrealizedPnl: null, unrealizedPnlRate: null, netPnl: null, netPnlRate: null,
        symbolTotalPnl: null, symbolTotalPnlRate: null, todayPnl: null, todayReferencePnl: null,
        open: null, high: null, low: null, prevClose: null, change: null, todayChange: null,
        quoteStatus: 'unavailable', quoteDate: String(quote.tradeDate || ''), quoteTime: String(quote.tradeTime || '')
      });

      const price = Number(quote.price);
      const quantity = finite(position.quantity) || 0;
      const costValue = finite(position.costValue) || 0;
      const marketValue = price * quantity;
      const grossUnrealizedPnl = marketValue - costValue;
      const estimatedExitFee = finite(position.estimatedExitFee) || 0;
      const estimatedExitTax = finite(position.estimatedExitTax) || 0;
      const unrealizedPnl = grossUnrealizedPnl - estimatedExitFee - estimatedExitTax;
      const realizedPnl = finite(position.realizedPnl) || 0;
      const investedCapital = finite(position.investedCapital) || 0;
      const symbolTotalPnl = realizedPnl + unrealizedPnl;
      const quoteDate = String(quote.tradeDate || position.quoteDate || '');
      const dailyCurrent = ['live', 'auction', 'latest-close'].includes(evidence.quoteStatus) && !evidence.quoteStale &&
        (!position.todayPnlDate || !quoteDate || position.todayPnlDate === quoteDate);

      return Object.assign({}, position, {
        currentPrice: round(price, 3),
        price: round(price, 3),
        open: finite(quote.open),
        high: finite(quote.high),
        low: finite(quote.low),
        prevClose: finite(quote.prevClose),
        change: finite(quote.change),
        todayChange: finite(quote.change),
        marketValue: round(marketValue, 2),
        grossUnrealizedPnl: round(grossUnrealizedPnl, 2),
        unrealizedPnl: round(unrealizedPnl, 2),
        unrealizedPnlRate: costValue > 0 ? round(unrealizedPnl / costValue * 100, 2) : null,
        netPnl: round(unrealizedPnl, 2),
        netPnlRate: costValue > 0 ? round(unrealizedPnl / costValue * 100, 2) : null,
        symbolTotalPnl: round(symbolTotalPnl, 2),
        symbolTotalPnlRate: investedCapital > 0 ? round(symbolTotalPnl / investedCapital * 100, 2) : null,
        todayPnl: dailyCurrent ? finite(position.todayPnl === undefined ? position.todayReferencePnl : position.todayPnl) : null,
        todayReferencePnl: dailyCurrent ? finite(position.todayPnl === undefined ? position.todayReferencePnl : position.todayPnl) : null,
        quoteDate,
        quoteTime: String(quote.tradeTime || position.quoteTime || '')
      }, evidence);
    });
  }

  function summarizePortfolio(prior, positions) {
    const summary = Object.assign({}, prior || {});
    const rows = Array.isArray(positions) ? positions : [];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const priced = rows.filter(position => finite(position.marketValue) !== null && position.quoteStatus !== 'unavailable');
    const live = priced.filter(position => ['live', 'auction'].includes(position.quoteStatus || 'live') && !position.quoteStale && (!position.quoteDate || position.quoteDate === today));
    const quoteCoverage = { total: rows.length, priced: priced.length, live: live.length, stale: priced.length - live.length, missing: rows.length - priced.length };
    const valuationStatus = !quoteCoverage.total ? 'empty' : !quoteCoverage.priced ? 'unavailable' : quoteCoverage.missing ? 'partial' : quoteCoverage.stale ? 'stale' : 'live';
    const quoteTimes = priced.filter(position => position.quoteDate).map(position => position.quoteDate + 'T' + (position.quoteTime || '')).sort();
    const earliestQuote = quoteTimes[0] || '';
    const totalMarketValue = quoteCoverage.missing ? null : priced.reduce((total, position) => total + Number(position.marketValue), 0);
    const totalCost = rows.reduce(function(total, position) {
      return total + (finite(position.costValue) || 0);
    }, 0);
    const unrealizedPnl = quoteCoverage.missing || rows.some(position => finite(position.unrealizedPnl) === null)
      ? null : rows.reduce((total, position) => total + Number(position.unrealizedPnl), 0);
    const dailyValues = rows.map(position => finite(position.todayPnl === undefined ? position.todayReferencePnl : position.todayPnl));
    const dailyEligible = rows.every(function(position) {
      return ['live', 'auction', 'latest-close'].includes(position.quoteStatus || 'live') && !position.quoteStale;
    });
    const todayPnl = quoteCoverage.missing || !dailyEligible || dailyValues.includes(null)
      ? null : dailyValues.reduce((total, value) => total + value, 0);
    const pnlDates = Array.from(new Set(rows.map(function(position) { return position.todayPnlDate; }).filter(Boolean)));
    const todayPnlDate = todayPnl === null || pnlDates.length !== 1 ? null : pnlDates[0];
    const todayPnlStatus = todayPnl === null ? 'unavailable'
      : rows.some(function(position) { return position.quoteStatus === 'latest-close'; }) ? 'latest-close' : 'live';
    const realizedPnl = finite(summary.realizedPnl) || 0;
    const totalPnl = unrealizedPnl === null ? null : realizedPnl + unrealizedPnl;
    const lifetimeBuyCost = finite(summary.lifetimeBuyCost) || 0;
    const cashBalance = finite(summary.cashBalance);

    return Object.assign(summary, {
      valuationStatus,
      quoteCoverage,
      quoteDate: earliestQuote.slice(0, 10),
      quoteTime: earliestQuote.slice(11),
      totalAssets: cashBalance === null || totalMarketValue === null ? null : round(cashBalance + totalMarketValue, 2),
      totalMarketValue: round(totalMarketValue, 2),
      totalCost: round(totalCost, 2),
      unrealizedPnl: round(unrealizedPnl, 2),
      todayPnl: round(todayPnl, 2),
      todayReferencePnl: round(todayPnl, 2),
      todayPnlDate,
      todayPnlStatus,
      totalPnl: round(totalPnl, 2),
      totalPnlRate: totalPnl === null ? null : lifetimeBuyCost > 0 ? round(totalPnl / lifetimeBuyCost * 100, 2) : totalPnl === 0 ? 0 : null,
      positionCount: rows.length,
      winCount: rows.filter(function(position) { return (finite(position.unrealizedPnl) || 0) > 0; }).length,
      lossCount: rows.filter(function(position) { return (finite(position.unrealizedPnl) || 0) < 0; }).length
    });
  }

  function allocation(positions) {
    const rows = Array.isArray(positions) ? positions : [];
    const values = rows.map(function(position) {
      return position.quoteStatus === 'unavailable' ? null : finite(position.marketValue);
    });
    const total = values.includes(null) ? null : values.reduce(function(sum, value) { return sum + value; }, 0);
    return rows.map(function(position, index) {
      return {
        code: position.code,
        name: position.name,
        marketValue: round(values[index], 2),
        ratio: total === null ? null : total > 0 ? round(values[index] / total * 100, 2) : 0
      };
    });
  }

  function signature(quotes) {
    return JSON.stringify((Array.isArray(quotes) ? quotes : []).map(function(quote) {
      return [
        quote && quote.code,
        quote && quote.price,
        quote && quote.change,
        quote && quote.quoteStatus,
        quote && quote.changedAt,
        quote && quote.stale,
        quote && quote.reason
      ];
    }));
  }

  return {
    applyWatchlistQuotes,
    applyPositionQuotes,
    summarizePortfolio,
    allocation,
    signature
  };
});
