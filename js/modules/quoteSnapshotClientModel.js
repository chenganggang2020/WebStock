(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QuoteSnapshotClientModel = api;
})(typeof window !== 'undefined' ? window : null, function() {
  function finite(value) {
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
      if (!usableQuote(quote)) return Object.assign({}, position, evidence);

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
        quoteDate: String(quote.tradeDate || position.quoteDate || ''),
        quoteTime: String(quote.tradeTime || position.quoteTime || '')
      }, evidence);
    });
  }

  function summarizePortfolio(prior, positions) {
    const summary = Object.assign({}, prior || {});
    const rows = Array.isArray(positions) ? positions : [];
    const totalMarketValue = rows.reduce(function(total, position) {
      const marketValue = finite(position.marketValue);
      const costValue = finite(position.costValue) || 0;
      return total + (marketValue === null ? costValue : marketValue);
    }, 0);
    const totalCost = rows.reduce(function(total, position) {
      return total + (finite(position.costValue) || 0);
    }, 0);
    const unrealizedPnl = rows.reduce(function(total, position) {
      return total + (finite(position.unrealizedPnl) || 0);
    }, 0);
    const realizedPnl = finite(summary.realizedPnl) || 0;
    const totalPnl = realizedPnl + unrealizedPnl;
    const lifetimeBuyCost = finite(summary.lifetimeBuyCost) || 0;
    const cashBalance = finite(summary.cashBalance) || 0;

    return Object.assign(summary, {
      totalAssets: round(cashBalance + totalMarketValue, 2),
      totalMarketValue: round(totalMarketValue, 2),
      totalCost: round(totalCost, 2),
      unrealizedPnl: round(unrealizedPnl, 2),
      totalPnl: round(totalPnl, 2),
      totalPnlRate: lifetimeBuyCost > 0 ? round(totalPnl / lifetimeBuyCost * 100, 2) : summary.totalPnlRate,
      positionCount: rows.length,
      winCount: rows.filter(function(position) { return (finite(position.unrealizedPnl) || 0) > 0; }).length,
      lossCount: rows.filter(function(position) { return (finite(position.unrealizedPnl) || 0) < 0; }).length
    });
  }

  function allocation(positions) {
    const rows = Array.isArray(positions) ? positions : [];
    const values = rows.map(function(position) {
      const marketValue = finite(position.marketValue);
      return marketValue === null ? (finite(position.costValue) || 0) : marketValue;
    });
    const total = values.reduce(function(sum, value) { return sum + value; }, 0);
    return rows.map(function(position, index) {
      return {
        code: position.code,
        name: position.name,
        marketValue: round(values[index], 2),
        ratio: total > 0 ? round(values[index] / total * 100, 2) : 0
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
