(function() {
  let timer = null;
  let running = null;
  let stopped = false;
  const minuteSlots = new Map();
  const snapshotSignatures = new Map();
  const LOCAL_READ_INTERVAL_MS = 1000;
  const LOCAL_SNAPSHOT_VIEWS = new Set(['dashboard', 'watchlist', 'portfolio']);

  function visible() {
    return document.visibilityState === 'visible';
  }

  function currentView() {
    return window.State && window.State.currentMainView || 'dashboard';
  }

  function delayMs(view) {
    if (LOCAL_SNAPSHOT_VIEWS.has(view)) return LOCAL_READ_INTERVAL_MS;
    const model = window.RealtimeChartModel;
    return model && model.activeViewRefreshDelayMs
      ? model.activeViewRefreshDelayMs(view, new Date())
      : 60000;
  }

  function statusElement(view) {
    return document.getElementById({
      watchlist: 'watchlistLiveStatus',
      portfolio: 'portfolioLiveStatus',
      recent: 'recentLiveStatus'
    }[view] || '');
  }

  function statusTime(value) {
    if (!value) return '';
    if (window.WebStockTime && window.WebStockTime.formatDateTime) {
      return window.WebStockTime.formatDateTime(value);
    }
    return String(value);
  }

  function setStatus(view, text, state) {
    const target = statusElement(view);
    if (!target) return;
    target.textContent = text;
    target.setAttribute('data-state', state || 'scheduled');
  }

  function scheduleStatus(view) {
    const seconds = Math.round(delayMs(view) / 1000);
    if (LOCAL_SNAPSHOT_VIEWS.has(view)) {
      setStatus(view, '本机行情快照 · 每1秒检查更新（上游最快3秒）', 'scheduled');
      return;
    }
    setStatus(view, '新浪行情快照 · ' + seconds + '秒自动刷新', 'scheduled');
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function sidebarStocksVisible() {
    const input = document.getElementById('searchInput');
    const wrap = document.querySelector('.stock-table-wrap');
    if (!wrap) return false;
    return Boolean(input && input.value.trim()) || getComputedStyle(wrap).display !== 'none';
  }

  function refreshMiniCharts(view) {
    if (!window.StockList || !window.StockList.refreshVisibleMinuteCharts) return;
    const slot = Math.floor(Date.now() / (5 * 60 * 1000));
    if (minuteSlots.get(view) === slot) return;
    minuteSlots.set(view, slot);
    let codes = [];
    if (view === 'watchlist') codes = (window.State.watchlist || []).map(function(item) { return item.code; });
    if (view === 'portfolio') codes = (window.State.positions || []).map(function(item) { return item.code; });
    if (view === 'recent') codes = (window.State.recentStocks || []).map(function(item) { return item.code; });
    if (codes.length) window.StockList.refreshVisibleMinuteCharts(codes);
  }

  function uniqueCodes(items) {
    return Array.from(new Set((items || []).map(function(item) {
      return String(item && item.code || '').trim();
    }).filter(function(code) { return /^\d{6}$/.test(code); }))).slice(0, 200);
  }

  function localSnapshotCodes(view) {
    const watchlist = window.State && window.State.watchlist || [];
    const positions = window.State && window.State.positions || [];
    if (view === 'watchlist') return uniqueCodes(watchlist);
    if (view === 'portfolio') return uniqueCodes(positions);
    if (view === 'dashboard') return uniqueCodes(watchlist.concat(positions));
    return [];
  }

  async function refreshLocalSnapshot(view) {
    const codes = localSnapshotCodes(view);
    if (!codes.length) return { ok: true, skipped: true, changed: false };
    const envelope = await window.ApiClient.fetchApiEnvelope(
      '/api/quote/snapshot?codes=' + encodeURIComponent(codes.join(',')),
      { timeoutMs: 5000, dedupe: true }
    );
    const quotes = Array.isArray(envelope.data) ? envelope.data : [];
    const meta = envelope.meta || {};
    const model = window.QuoteSnapshotClientModel;
    const key = view + ':' + codes.join(',');
    const signature = model && model.signature ? model.signature(quotes) : JSON.stringify(quotes);
    const changed = snapshotSignatures.get(key) !== signature;
    snapshotSignatures.set(key, signature);

    if (changed) {
      if ((view === 'watchlist' || view === 'dashboard') && window.Watchlist && window.Watchlist.applyQuoteSnapshot) {
        window.Watchlist.applyQuoteSnapshot(quotes, meta);
      }
      if ((view === 'portfolio' || view === 'dashboard') && window.Portfolio && window.Portfolio.applyQuoteSnapshot) {
        window.Portfolio.applyQuoteSnapshot(quotes, meta);
      }
    }

    const usable = quotes.filter(function(quote) {
      return quote && quote.quoteStatus !== 'unavailable' && Number(quote.price) > 0;
    });
    const providerObservedAt = usable.map(function(quote) {
      return quote.providerObservedAt;
    }).filter(Boolean).sort().pop() || null;
    const latestClose = usable.length > 0 && usable.every(function(quote) {
      return quote.quoteStatus === 'latest-close';
    });
    return {
      ok: true,
      changed,
      pending: quotes.length > 0 && usable.length === 0,
      stale: meta.stale === true,
      latestClose,
      observedAt: meta.fetchedAt || providerObservedAt,
      providerObservedAt,
      source: meta.source || 'sina-public-quote'
    };
  }

  async function refreshView(view) {
    if (LOCAL_SNAPSHOT_VIEWS.has(view)) return refreshLocalSnapshot(view);
    const tasks = [];
    if (view === 'watchlist' && window.Watchlist) {
      tasks.push(window.Watchlist.refreshWatchlistQuotes({ automatic: true }));
    } else if (view === 'portfolio' && window.Portfolio && window.Portfolio.refreshLivePortfolio) {
      tasks.push(window.Portfolio.refreshLivePortfolio({ automatic: true }));
    } else if (view === 'recent' && window.RecentStocks && window.RecentStocks.refreshQuotes) {
      tasks.push(window.RecentStocks.refreshQuotes({ automatic: true }));
    } else if (view === 'dashboard') {
      if (window.Watchlist) tasks.push(window.Watchlist.refreshWatchlistQuotes({ automatic: true }));
      if (window.Portfolio && window.Portfolio.refreshLivePortfolio) {
        tasks.push(window.Portfolio.refreshLivePortfolio({ automatic: true }));
      }
    }

    if (view !== 'market' && sidebarStocksVisible() && window.StockList) {
      tasks.push(window.StockList.refreshQuotes(window.State.filteredStocks || []));
    }
    if (!tasks.length) return { ok: true, skipped: true };

    const results = await Promise.all(tasks);
    const failed = results.find(function(result) { return result && result.ok === false; });
    if (failed) return failed;
    const observed = results.map(function(result) { return result && result.observedAt; }).filter(Boolean).sort().pop();
    return { ok: true, observedAt: observed || new Date().toISOString() };
  }

  function schedule() {
    clearTimer();
    if (stopped || !visible()) return;
    const view = currentView();
    timer = setTimeout(function() {
      timer = null;
      refreshNow();
    }, delayMs(view));
  }

  function refreshNow() {
    if (stopped || !visible()) return Promise.resolve({ skipped: true });
    if (running) return running;
    const view = currentView();
    if (!LOCAL_SNAPSHOT_VIEWS.has(view)) setStatus(view, '新浪行情快照 · 更新中…', 'loading');
    running = refreshView(view).then(function(result) {
      if (currentView() !== view) return result;
      if (result && result.ok === false) {
        setStatus(view, '刷新失败 · 已保留上次行情', 'error');
      } else if (LOCAL_SNAPSHOT_VIEWS.has(view) && result && result.pending) {
        setStatus(view, '本机行情快照 · 等待数据源返回', 'loading');
      } else if (LOCAL_SNAPSHOT_VIEWS.has(view) && result && result.stale) {
        setStatus(view, '本机行情快照 · 数据源波动，已保留上次有效值', 'error');
      } else {
        const observedAt = statusTime(result && result.observedAt);
        const prefix = LOCAL_SNAPSHOT_VIEWS.has(view)
          ? (result && result.latestClose ? '盘后最新收盘 · 每1秒检查' : '本机行情快照 · 每1秒检查')
          : '新浪行情快照 · 已更新';
        setStatus(view, prefix + (observedAt ? ' · 源更新 ' + observedAt : ''), 'updated');
        if (!result || result.changed !== false) refreshMiniCharts(view);
      }
      return result;
    }).catch(function(error) {
      if (currentView() === view) setStatus(view, '刷新失败 · 已保留上次行情', 'error');
      console.warn(error && error.message ? error.message : error);
      return { ok: false, error };
    }).finally(function() {
      running = null;
      schedule();
    });
    return running;
  }

  function sync(options) {
    stopped = false;
    clearTimer();
    if (!visible()) return Promise.resolve({ skipped: true });
    if (options && options.immediate) return refreshNow();
    scheduleStatus(currentView());
    schedule();
    return Promise.resolve({ scheduled: true });
  }

  function stop() {
    stopped = true;
    clearTimer();
  }

  document.addEventListener('visibilitychange', function() {
    if (visible()) sync({ immediate: true });
    else clearTimer();
  });
  window.addEventListener('beforeunload', stop);

  window.LiveRefresh = { sync, stop, refreshNow };
})();
