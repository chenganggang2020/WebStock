function watchlistApi(path, options) {
  return window.apiFetch('/api/portfolio' + path, options);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function watchlistAlertStatus(item) {
  const price = Number(item.price);
  const high = Number(item.alertHigh);
  const low = Number(item.alertLow);
  if (!Number.isFinite(price)) return { className: 'status-ok', label: 'Alert pending' };
  if (Number.isFinite(low) && low > 0 && price <= low) return { className: 'status-danger', label: 'Alert low' };
  if (Number.isFinite(high) && high > 0 && price >= high) return { className: 'status-warn', label: 'Alert high' };
  if ((Number.isFinite(low) && low > 0) || (Number.isFinite(high) && high > 0)) {
    return { className: 'status-ok', label: 'Alert normal' };
  }
  return { className: 'muted', label: 'No alert' };
}

function watchlistCsvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function watchlistLevelCell(item) {
  const values = [item.autoD1Low, item.autoD1High, item.autoD2, item.autoR1, item.autoConfirm].map(function(value) {
    const number = Number(value);
    return value !== null && value !== '' && Number.isFinite(number) && number > 0 ? number : null;
  });
  const d1Low = values[0];
  const d1High = values[1];
  const d2 = values[2];
  const r1 = values[3];
  const confirm = values[4];
  if (values.every(function(value) { return value !== null; })) {
    const date = item.autoLevelsDate ? '<small>日线 ' + watchlistTabEscape(item.autoLevelsDate) + '</small>' : '';
    return '<div class="watchlist-levels" title="' + watchlistTabEscape(item.autoLevelsMethod || '历史日线自动点位') + '">' +
      '<span>D1 ' + money(d1Low) + '–' + money(d1High) + '</span>' +
      '<span>D2 ' + money(d2) + ' · R1 ' + money(r1) + ' · 确认 ' + money(confirm) + '</span>' + date + '</div>';
  }
  if (item.autoLevelError) {
    return '<div class="watchlist-levels watchlist-level-error"><span>自动点位暂不可用</span><small>' +
      watchlistTabEscape(item.autoLevelError) + '</small></div>';
  }
  return '<div class="watchlist-levels muted"><span>预警 ' + watchlistTabEscape(item.alertLow || '--') + ' / ' + watchlistTabEscape(item.alertHigh || '--') + '</span><small>等待自动点位</small></div>';
}

let selectedWatchlistGroupKey = '';
let morningMaintenanceTimer = null;
let watchlistQuoteByCode = {};
let watchlistLevelsByCode = {};
let watchlistLevelErrorsByCode = {};
let watchlistLocatedCode = '';
let watchlistLocatePending = false;
let watchlistAddQueue = Promise.resolve();
const watchlistAddRequests = new Map();
let watchlistLoadSequence = 0;

function runtimeLevelPatch(code) {
  const level = watchlistLevelsByCode[code];
  const error = watchlistLevelErrorsByCode[code];
  if (!level && !error) return {};
  return level ? {
    autoD1Low: level.d1Low,
    autoD1High: level.d1High,
    autoD2: level.d2,
    autoR1: level.r1,
    autoConfirm: level.confirm,
    autoLevelsDate: level.sourceDate,
    autoLevelsMethod: level.method,
    autoLevelError: ''
  } : { autoLevelError: error };
}

function setWatchlistSyncStatus(text, state) {
  const element = document.getElementById('watchlistSyncStatus');
  if (!element) return;
  element.textContent = text;
  element.dataset.state = state || 'idle';
}

async function loadTonghuashunCatalog() {
  try {
    const catalog = await watchlistApi('/tonghuashun-watchlist/catalog');
    window.State.tonghuashunCatalog = catalog;
    const groupCount = Array.isArray(catalog.groups) ? Math.max(0, catalog.groups.length - 1) : 0;
    setWatchlistSyncStatus('同花顺本地 · ' + (catalog.supportedCount || 0) + '只 · ' + groupCount + '个分组', 'ok');
    return catalog;
  } catch (error) {
    window.State.tonghuashunCatalog = null;
    setWatchlistSyncStatus('同花顺本地 · ' + error.message, 'error');
    return null;
  }
}

async function syncTonghuashunWatchlist(options) {
  options = options || {};
  setWatchlistSyncStatus('同花顺自选 · 正在同步', 'loading');
  try {
    const result = await watchlistApi('/tonghuashun-watchlist/sync', { method: 'POST' });
    setWatchlistSyncStatus('同花顺自选 · 新增 ' + result.addedCount + '，已有 ' + result.existingCount, 'ok');
    await loadWatchlist({ skipQuotes: !!options.skipQuotes });
    return result;
  } catch (error) {
    setWatchlistSyncStatus('同花顺自选 · ' + error.message, 'error');
    throw error;
  }
}

async function refreshAutomaticLevels(options) {
  options = options || {};
  setWatchlistSyncStatus('自动点位 · 正在更新', 'loading');
  try {
    const codes = (Array.isArray(options.codes) ? options.codes : visibleWatchlistItems().map(function(item) { return item.code; }))
      .filter(function(code, index, list) { return /^\d{6}$/.test(String(code || '')) && list.indexOf(code) === index; });
    const result = await watchlistApi('/watchlist/refresh-levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, includeSaved: options.includeSaved !== false }),
      timeoutMs: 120000
    });
    watchlistLevelsByCode = Object.assign({}, watchlistLevelsByCode, result.levelsByCode || {});
    (result.failures || []).forEach(function(failure) {
      if (failure && failure.code) watchlistLevelErrorsByCode[failure.code] = failure.error || '日线数据不足';
    });
    Object.keys(result.levelsByCode || {}).forEach(function(code) { delete watchlistLevelErrorsByCode[code]; });
    setWatchlistSyncStatus('自动点位 · 更新 ' + result.updatedCount + '，失败 ' + result.failedCount, result.failedCount ? 'warn' : 'ok');
    await loadWatchlist({ skipQuotes: true });
    return result;
  } catch (error) {
    setWatchlistSyncStatus('自动点位 · ' + error.message, 'error');
    if (!options.silent) throw error;
    return null;
  }
}

function hasAutomaticLevels(item) {
  return [item.autoD1Low, item.autoD1High, item.autoD2, item.autoR1, item.autoConfirm].every(function(value) {
    return value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
  });
}

function refreshMissingVisibleLevels() {
  const codes = visibleWatchlistItems().filter(function(item) {
    return !hasAutomaticLevels(item) && !item.autoLevelError;
  }).map(function(item) { return item.code; });
  if (!codes.length) return Promise.resolve(null);
  return refreshAutomaticLevels({ silent: true, codes, includeSaved: false });
}

function beijingClock(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now || new Date()).reduce(function(result, part) {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const date = parts.year + '-' + parts.month + '-' + parts.day;
  const pseudoLocal = new Date(date + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second);
  return { date, pseudoLocal, weekday: pseudoLocal.getDay() };
}

function nextMorningDelay(now) {
  const clock = beijingClock(now);
  const target = new Date(clock.date + 'T09:05:00');
  if (clock.weekday === 0 || clock.weekday === 6 || clock.pseudoLocal >= target) target.setDate(target.getDate() + 1);
  while (target.getDay() === 0 || target.getDay() === 6) target.setDate(target.getDate() + 1);
  return Math.max(1000, target.getTime() - clock.pseudoLocal.getTime());
}

async function runMorningMaintenance() {
  const clock = beijingClock(new Date());
  if (clock.weekday === 0 || clock.weekday === 6 || clock.pseudoLocal < new Date(clock.date + 'T09:05:00')) return false;
  const storageKey = 'webstock.watchlistMorningMaintenanceDate';
  try { if (localStorage.getItem(storageKey) === clock.date) return false; } catch (error) {}
  try {
    await syncTonghuashunWatchlist({ skipQuotes: true });
    if (window.Portfolio && window.Portfolio.syncTonghuashunHoldings) {
      await window.Portfolio.syncTonghuashunHoldings({ silent: true, localOnly: true, automatic: true }).catch(function(error) {
        console.warn('同花顺持仓文件自动同步失败:', error.message || error);
      });
    }
    const levels = await refreshAutomaticLevels({ silent: true });
    if (!levels) return false;
    try { localStorage.setItem(storageKey, clock.date); } catch (error) {}
    return true;
  } catch (error) {
    console.warn('自选早间同步失败:', error.message || error);
    return false;
  }
}

function scheduleMorningMaintenance() {
  if (morningMaintenanceTimer) clearTimeout(morningMaintenanceTimer);
  runMorningMaintenance().finally(function() {
    morningMaintenanceTimer = setTimeout(scheduleMorningMaintenance, nextMorningDelay(new Date()));
  });
}

function watchlistGroups() {
  const State = window.State;
  const catalogGroups = State.tonghuashunCatalog && Array.isArray(State.tonghuashunCatalog.groups)
    ? State.tonghuashunCatalog.groups : [];
  const groups = catalogGroups.map(function(group, index) {
    const name = String(group && group.name || '').trim();
    if (!name) return null;
    const id = String(group && group.id || name || ('group-' + index)).trim();
    return {
      key: 'ths:' + id,
      id,
      name,
      source: 'ths',
      readOnly: true,
      catalogGroup: group
    };
  }).filter(Boolean);
  const savedNames = Array.from(new Set((State.watchlist || []).map(function(item) {
    return String(item.groupName || '默认分组').trim() || '默认分组';
  })));
  savedNames.forEach(function(name) {
    groups.push({
      key: 'local:' + name,
      id: name,
      name,
      source: 'local',
      readOnly: false,
      catalogGroup: null
    });
  });
  return groups;
}

function resolveWatchlistGroup(requested, groups) {
  const value = String(requested || '');
  const available = groups || watchlistGroups();
  return available.find(function(group) { return group.key === value; }) ||
    available.find(function(group) { return group.name === value; }) ||
    available[0] || null;
}

function selectedWatchlistGroup(groups) {
  const available = groups || watchlistGroups();
  return available.find(function(group) { return group.key === selectedWatchlistGroupKey; }) || null;
}

function getGroupItems(groupKey) {
  const State = window.State;
  const selectedGroup = groupKey === undefined ? selectedWatchlistGroup() : watchlistGroups().find(group => group.key === groupKey);
  const catalogGroup = selectedGroup && selectedGroup.source === 'ths'
    ? selectedGroup.catalogGroup : null;
  const savedByCode = new Map((State.watchlist || []).map(function(item) { return [item.code, item]; }));
  let items = catalogGroup
    ? (catalogGroup.items || []).map(function(sourceItem) {
      return Object.assign({}, savedByCode.get(sourceItem.code) || {}, sourceItem, {
        groupName: catalogGroup.name,
        tonghuashunReadOnly: true
      }, runtimeLevelPatch(sourceItem.code), watchlistQuoteByCode[sourceItem.code] || {});
    })
    : (State.watchlist || []).map(function(item) {
      return Object.assign({}, item, runtimeLevelPatch(item.code), watchlistQuoteByCode[item.code] || {});
    });
  if (!catalogGroup && selectedGroup) {
    items = items.filter(function(item) {
      return (item.groupName || '默认分组') === selectedGroup.name;
    });
  }
  return items;
}

function visibleWatchlistItems() {
  let items = getGroupItems();
  const keyword = document.getElementById('watchlistSearchInput') ? document.getElementById('watchlistSearchInput').value.trim() : '';
  if (keyword) {
    const normalized = keyword.toLowerCase();
    items = items.filter(function(item) {
      const alertStatus = watchlistAlertStatus(item);
      return [
        item.code,
        item.name,
        item.groupName,
        item.note,
        item.alertHigh,
        item.alertLow,
        alertStatus.label,
        item.quoteStatus
      ].filter(value => value !== undefined && value !== null).join(' ').toLowerCase().includes(normalized);
    });
  }
  const sort = document.getElementById('watchlistSortSelect') ? document.getElementById('watchlistSortSelect').value : '';
  if (sort === 'change_desc') items.sort((a, b) => (Number(b.change) || -999) - (Number(a.change) || -999));
  if (sort === 'change_asc') items.sort((a, b) => (Number(a.change) || 999) - (Number(b.change) || 999));
  return items;
}

function getMiniChartStock(code) {
  const visible = visibleWatchlistItems().find(function(item) { return item.code === code; });
  if (visible) return visible;
  const saved = (window.State.watchlist || []).find(function(item) { return item.code === code; });
  return saved ? Object.assign({}, saved, runtimeLevelPatch(code), watchlistQuoteByCode[code] || {}) : null;
}

async function loadWatchlist(options) {
  options = options || {};
  const requestSequence = ++watchlistLoadSequence;
  const State = window.State;
  const previousByCode = new Map((State.watchlist || []).map(function(item) { return [item.code, item]; }));
  const results = await Promise.all([watchlistApi('/watchlist'), loadTonghuashunCatalog()]);
  if (requestSequence !== watchlistLoadSequence) return State.watchlist;
  State.watchlist = results[0].map(function(item) {
    const previous = previousByCode.get(item.code) || {};
    ['price', 'change', 'amount', 'quoteStatus', 'open', 'high', 'low', 'prevClose'].forEach(function(field) {
      if ((item[field] === undefined || item[field] === null) && previous[field] !== undefined) item[field] = previous[field];
    });
    return item;
  });
  const groups = watchlistGroups();
  if (!groups.some(function(group) { return group.key === selectedWatchlistGroupKey; })) {
    selectedWatchlistGroupKey = groups.length ? groups[0].key : '';
  }
  renderWatchlist();
  if (!options.skipQuotes && visibleWatchlistItems().length) await refreshWatchlistQuotes();
  if (window.StockList) window.StockList.renderStockTable(State.filteredStocks);
  if (window.Dashboard) window.Dashboard.refreshCards();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  return State.watchlist;
}

function setSelectedGroup(group) {
  watchlistLocatedCode = '';
  watchlistLocatePending = false;
  const groups = watchlistGroups();
  const selected = resolveWatchlistGroup(group, groups);
  selectedWatchlistGroupKey = selected ? selected.key : '';
  const groupFilter = document.getElementById('watchlistGroupFilter');
  if (groupFilter) groupFilter.value = selectedWatchlistGroupKey;
  renderWatchlist();
  refreshMissingVisibleLevels();
}

function watchlistGroupNames() {
  return watchlistGroups().map(function(group) { return group.name; });
}

function watchlistTabEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPortfolioWatchlistTabs(groups) {
  const box = document.getElementById('watchlistGroupTabs');
  if (!box) return;
  const search = document.getElementById('watchlistGroupSearch');
  const query = String(search && search.value || '').trim().toLowerCase();
  const openSections = new Map(Array.from(box.querySelectorAll('details[data-group-source]')).map(function(section) {
    return [section.dataset.groupSource, section.open];
  }));
  const filtered = (groups || []).filter(function(group) { return group.name.toLowerCase().includes(query); });
  function groupButton(group) {
    const sourceLabel = group.source === 'ths' ? '同花顺只读' : '本地可编辑';
    const title = group.source === 'ths' ? '同花顺本地只读分组：' : '本地可编辑分组：';
    const count = group.source === 'ths' ? (group.catalogGroup.items || []).length :
      (window.State.watchlist || []).filter(function(item) { return (item.groupName || '默认分组') === group.name; }).length;
    return '<button type="button" class="portfolio-watchlist-tab" data-portfolio-watchlist-tab="watchlist" data-group="' +
      watchlistTabEscape(group.key) + '" data-group-name="' + watchlistTabEscape(group.name) + '" role="tab" aria-label="' +
      watchlistTabEscape(group.name + ' · ' + count + '只 · ' + sourceLabel) + '" title="' +
      title + watchlistTabEscape(group.name) + '"><span>' + watchlistTabEscape(group.name) +
      '</span><b class="watchlist-group-count">' + count + '</b><small class="watchlist-tab-source">' + sourceLabel + '</small></button>';
  }
  box.innerHTML = ['local', 'ths'].map(function(source) {
    const matches = filtered.filter(function(group) { return group.source === source; });
    if (query && !matches.length) return '';
    const expanded = query || (watchlistLocatePending && selectedWatchlistGroupKey.startsWith(source + ':')) ||
      !openSections.has(source) || openSections.get(source);
    return '<details data-group-source="' + source + '"' + (expanded ? ' open' : '') + '><summary>' +
      (source === 'local' ? '本地自选 · 可编辑' : '同花顺分组 · 只读') + '</summary>' +
      (matches.length ? matches.map(groupButton).join('') : '<p class="muted">尚无分组；添加股票时可新建。</p>') + '</details>';
  }).join('') || '<p class="muted">没有匹配的分组</p>';
  if (window.refreshPortfolioWatchlistTabState) window.refreshPortfolioWatchlistTabState();
}

function watchlistQuoteStatusHtml(item) {
  const alertStatus = watchlistAlertStatus(item);
  const quoteStatus = item.quoteStatus === 'unavailable'
    ? '<span class="status-danger">行情不可用</span>'
    : item.quoteStatus === 'stale'
      ? '<span class="status-warn">行情保留</span>'
      : '<span class="status-ok">正常</span>';
  return '<div class="status-stack">' + quoteStatus + '<span class="' + alertStatus.className + '">' + alertStatus.label + '</span></div>';
}

function watchlistTrend(item) {
  const change = Number(item.change);
  return {
    change,
    colorClass: Number.isFinite(change) && change > 0 ? 'pnl-up' : Number.isFinite(change) && change < 0 ? 'pnl-down' : '',
    direction: Number.isFinite(change) && change > 0 ? 'up' : Number.isFinite(change) && change < 0 ? 'down' : 'flat',
    color: window.MarketVisualModel
      ? window.MarketVisualModel.trendColor(change, document.body.classList.contains('dark'))
      : Number.isFinite(change) && change >= 0 ? '#ff2d2d' : '#00b050'
  };
}

async function addCurrentStock() {
  const State = window.State;
  if (!State.currentStock) { alert('请先选择一只股票'); return; }
  await addStock(State.currentStock);
}

function setWatchlistActionStatus(message, state) {
  const status = document.getElementById('watchlistActionStatus');
  if (status) {
    status.textContent = message;
    status.dataset.state = state || 'ok';
  }
}

function openWatchlistAddDialog(stock) {
  const dialog = document.getElementById('watchlistAddDialog');
  if (!dialog || !dialog.showModal) { alert('添加窗口不可用，请重新打开新版程序。'); return Promise.resolve(null); }
  if (dialog.open) return Promise.resolve(null);
  const input = document.getElementById('watchlistAddGroup');
  const error = document.getElementById('watchlistAddError');
  const submit = document.getElementById('watchlistAddSubmit');
  const cancel = document.getElementById('watchlistAddCancel');
  const selected = selectedWatchlistGroup();
  input.value = selected && selected.source === 'local' ? selected.name : '默认分组';
  document.getElementById('watchlistAddStockLabel').textContent = (stock.name || stock.code) + '（' + stock.code + '）';
  document.getElementById('watchlistAddGroups').innerHTML = Array.from(new Set(['默认分组'].concat(
    watchlistGroups().filter(function(group) { return group.source === 'local'; }).map(function(group) { return group.name; })
  ))).map(function(name) { return '<option value="' + watchlistTabEscape(name) + '"></option>'; }).join('');
  error.textContent = '';
  submit.disabled = false;
  cancel.disabled = false;
  let saved = null;
  return new Promise(function(resolve) {
    dialog.onclose = function() {
      const tbody = document.getElementById('watchlistTbody');
      const row = saved && tbody && tbody.querySelector && tbody.querySelector('.watchlist-located');
      if (row && row.focus) row.focus({ preventScroll: true });
      resolve(saved);
    };
    dialog.oncancel = function(event) { if (submit.disabled) event.preventDefault(); };
    cancel.onclick = function() { dialog.close(); };
    document.getElementById('watchlistAddForm').onsubmit = async function(event) {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      cancel.disabled = true;
      saved = await addStock(stock, { groupName: input.value, reveal: true });
      submit.disabled = false;
      cancel.disabled = false;
      if (saved) dialog.close();
      else error.textContent = document.getElementById('watchlistActionStatus').textContent;
    };
    dialog.showModal();
    input.focus();
    input.select();
  });
}

async function saveWatchlistStock(stock, options) {
  try {
    if (!stock || !/^\d{6}$/.test(String(stock.code || ''))) throw new Error('请选择有效的六位股票代码');
    const groupName = String(options.groupName || '').trim();
    if (!groupName || groupName.length > 60) throw new Error('分组名称不能为空，且不能超过 60 个字');
    setWatchlistActionStatus('正在核对并保存本地自选…', 'loading');
    let rows = await watchlistApi('/watchlist');
    if (!Array.isArray(rows)) throw new Error('自选列表读取失败，请重试');
    let item = rows.find(function(row) { return row.code === stock.code; });
    let existing = Boolean(item);
    if (!item) {
      try {
        item = await watchlistApi('/watchlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: stock.code, name: stock.name || stock.code, groupName })
        });
        rows = rows.concat(item);
      } catch (writeError) {
        // Another window may have added it, or the response may have been lost.
        const latest = await watchlistApi('/watchlist').catch(function() { return null; });
        item = Array.isArray(latest) && latest.find(function(row) { return row.code === stock.code; });
        if (!item) throw writeError;
        rows = latest;
        existing = true;
      }
    }
    const previous = new Map((window.State.watchlist || []).map(function(row) { return [row.code, row]; }));
    watchlistLoadSequence += 1;
    window.State.watchlist = rows.map(function(row) { return Object.assign({}, previous.get(row.code) || {}, row); });
    const actualGroup = item.groupName || '默认分组';
    if (options.reveal !== false) {
      selectedWatchlistGroupKey = 'local:' + actualGroup;
      watchlistLocatedCode = item.code;
      watchlistLocatePending = true;
      ['watchlistSearchInput', 'watchlistGroupSearch'].forEach(function(id) {
        const input = document.getElementById(id);
        if (input) input.value = '';
      });
    }
    renderWatchlist();
    setWatchlistActionStatus((item.name || stock.name || stock.code) + (existing ? ' 已存在于【' : ' 已加入【') +
      actualGroup + '】· 本地自选，未写回同花顺', 'ok');
    if (options.reveal !== false && window.switchMainView) window.switchMainView('watchlist');
    if (window.StockList && window.StockList.renderStockTable) window.StockList.renderStockTable(window.State.filteredStocks);
    return item;
  } catch (error) {
    setWatchlistActionStatus('添加未完成：' + (error.message || '请重试'), 'error');
    return null;
  }
}

async function addStock(stock, options) {
  if (!options || !Object.prototype.hasOwnProperty.call(options, 'groupName')) return openWatchlistAddDialog(stock);
  const key = String(stock && stock.code || '');
  if (watchlistAddRequests.has(key)) return watchlistAddRequests.get(key);
  const pending = watchlistAddQueue.then(function() { return saveWatchlistStock(stock, options); });
  watchlistAddQueue = pending.catch(function() {});
  watchlistAddRequests.set(key, pending);
  try { return await pending; } finally { watchlistAddRequests.delete(key); }
}

async function removeByCode(code) {
  await watchlistApi('/watchlist/code/' + encodeURIComponent(code), { method: 'DELETE' });
  await loadWatchlist();
}

async function removeById(id) {
  if (!confirm('确定删除这只自选股吗？')) return;
  await watchlistApi('/watchlist/' + id, { method: 'DELETE' });
  await loadWatchlist();
}

async function updateWatchlistItem(id, payload) {
  await watchlistApi('/watchlist/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (payload && String(payload.groupName || '').trim()) {
    selectedWatchlistGroupKey = 'local:' + String(payload.groupName).trim();
  }
  await loadWatchlist();
}

async function editWatchlistItem(id) {
  const State = window.State;
  const item = State.watchlist.find(row => row.id === id);
  if (!item) return;
  const groupName = prompt('分组', item.groupName || '默认分组');
  if (groupName === null) return;
  const note = prompt('备注', item.note || '');
  if (note === null) return;
  const alertHigh = prompt('预警高价（可留空）', item.alertHigh || '');
  if (alertHigh === null) return;
  const alertLow = prompt('预警低价（可留空）', item.alertLow || '');
  if (alertLow === null) return;
  await updateWatchlistItem(id, { groupName, note, alertHigh, alertLow });
}

async function bulkSetVisibleGroup() {
  const items = visibleWatchlistItems();
  if (!items.length) {
    alert('当前没有可批量分组的自选股');
    return;
  }
  if (items.some(function(item) { return item.tonghuashunReadOnly; })) {
    alert('当前同花顺本地分组为只读，不能从本程序批量移动；请在同花顺客户端修改后重新同步。');
    return;
  }
  if (items.some(function(item) { return !Number.isInteger(Number(item.id)) || Number(item.id) <= 0; })) {
    alert('当前列表含有未写入本程序的项目，已取消批量修改以避免部分成功。');
    return;
  }
  const groupName = prompt('将当前可见自选股移动到分组', items[0].groupName || '默认分组');
  if (groupName === null) return;
  const cleanGroup = groupName.trim();
  if (!cleanGroup) {
    alert('分组名称不能为空');
    return;
  }
  await Promise.all(items.map(item => watchlistApi('/watchlist/' + item.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupName: cleanGroup })
  })));
  selectedWatchlistGroupKey = 'local:' + cleanGroup;
  await loadWatchlist();
}

function renderWatchlist() {
  const State = window.State;
  const tbody = document.getElementById('watchlistTbody');
  const empty = document.getElementById('watchlistEmpty');
  const table = document.getElementById('watchlistTable');
  const groupFilter = document.getElementById('watchlistGroupFilter');
  if (!tbody) return;

  const groups = watchlistGroups();
  if (!groups.some(function(group) { return group.key === selectedWatchlistGroupKey; })) {
    selectedWatchlistGroupKey = groups.length ? groups[0].key : '';
  }
  if (groupFilter) {
    const current = selectedWatchlistGroupKey;
    groupFilter.innerHTML = groups.map(function(group) {
      const sourceLabel = group.source === 'ths' ? '同花顺只读' : '本地可编辑';
      return '<option value="' + watchlistTabEscape(group.key) + '">' + watchlistTabEscape(group.name) +
        ' · ' + sourceLabel + '</option>';
    }).join('');
    groupFilter.value = current;
  }
  renderPortfolioWatchlistTabs(groups);

  const items = visibleWatchlistItems();
  const selectionMeta = document.getElementById('watchlistSelectionMeta');
  const selected = selectedWatchlistGroup(groups);
  if (selectionMeta) selectionMeta.textContent = selected ? selected.name + ' · ' +
    (selected.source === 'ths' ? '同花顺只读' : '本地可编辑') + ' · 当前显示 ' + items.length + ' 只' : '请选择分组';
  empty.style.display = items.length ? 'none' : '';
  table.style.display = items.length ? 'table' : 'none';
  if (window.StockList && window.StockList.releaseMinuteRows) {
    window.StockList.releaseMinuteRows(tbody);
  }
  tbody.innerHTML = items.map(item => {
    const trend = watchlistTrend(item);
    const safeCode = watchlistTabEscape(item.code);
    const safeName = watchlistTabEscape(item.name || item.code);
    const safeGroup = watchlistTabEscape(item.groupName || '默认分组');
    const safeNote = watchlistTabEscape(item.note || '');
    const safeId = Number.isInteger(Number(item.id)) && Number(item.id) > 0 ? String(Number(item.id)) : '';
    const miniChart = window.StockList && window.StockList.miniChart
      ? window.StockList.miniChart(item, trend.color)
      : '';
    const localActions = item.tonghuashunReadOnly
      ? '<span class="watchlist-source-badge" title="只读取同花顺本地分组，不会反向修改同花顺">同花顺只读</span>'
      : '<button class="small-btn" data-action="edit" data-id="' + safeId + '">备注</button>' +
        '<button class="small-btn danger" data-action="delete" data-id="' + safeId + '">删除</button>';
    return '<tr data-code="' + safeCode + '" class="' + (item.code === watchlistLocatedCode ? 'watchlist-located' : '') + '" data-trend-direction="' + trend.direction + '" tabindex="0" title="双击查看行情">' +
      '<td><button class="link-btn" data-action="view" data-code="' + safeCode + '">' + safeCode + '</button></td>' +
      '<td><div class="holding-name-cell"><span>' + safeName + '</span><span data-mini-chart-code="' + safeCode + '">' + miniChart + '</span></div></td>' +
      '<td data-watchlist-field="price">' + money(item.price) + '</td>' +
      '<td data-watchlist-field="change" class="' + trend.colorClass + '">' + (Number.isFinite(trend.change) ? (trend.change >= 0 ? '+' : '') + trend.change.toFixed(2) + '%' : '--') + '</td>' +
      '<td>' + (window.EastmoneyDarkStocks ? window.EastmoneyDarkStocks.cell(item) : '--') + '</td>' +
      '<td>' + safeGroup + '</td>' +
      '<td>' + watchlistLevelCell(item) + '</td>' +
      '<td data-watchlist-field="status">' + watchlistQuoteStatusHtml(item) + '</td>' +
      '<td>' + safeNote + '</td>' +
      '<td><div class="stock-actions">' +
      '<button class="small-btn primary" data-action="view" data-code="' + safeCode + '">查看</button>' +
      '<button class="small-btn" data-action="analysis" data-code="' + safeCode + '">分析</button>' +
      '<button class="small-btn" data-action="trade" data-code="' + safeCode + '">持仓</button>' +
      localActions +
      '</div></td>' +
      '</tr>';
  }).join('');
  tbody.onclick = handleWatchlistClick;
  tbody.ondblclick = handleWatchlistDoubleClick;
  if (watchlistLocatePending && tbody.querySelector) {
    const located = tbody.querySelector('.watchlist-located');
    if (located && located.scrollIntoView && (!located.getClientRects || located.getClientRects().length)) {
      located.scrollIntoView({ block: 'nearest' });
      watchlistLocatePending = false;
    }
  }
  if (window.EastmoneyDarkStocks) window.EastmoneyDarkStocks.sync();
  if (window.StockList && window.StockList.observeMinuteRows) {
    window.StockList.observeMinuteRows(tbody);
  }
}

function patchWatchlistQuoteRows() {
  const tbody = document.getElementById('watchlistTbody');
  const search = document.getElementById('watchlistSearchInput');
  const sort = document.getElementById('watchlistSortSelect');
  if (!tbody || (search && search.value.trim()) || (sort && /^change_/.test(sort.value))) {
    renderWatchlist();
    return;
  }

  const items = visibleWatchlistItems();
  const rows = Array.from(tbody.querySelectorAll('tr[data-code]'));
  if (rows.length !== items.length || rows.some(function(row, index) {
    return row.getAttribute('data-code') !== items[index].code;
  })) {
    renderWatchlist();
    return;
  }

  rows.forEach(function(row, index) {
    const item = items[index];
    const trend = watchlistTrend(item);
    const priceCell = row.querySelector('[data-watchlist-field="price"]');
    const changeCell = row.querySelector('[data-watchlist-field="change"]');
    const statusCell = row.querySelector('[data-watchlist-field="status"]');
    if (priceCell) priceCell.textContent = money(item.price);
    if (changeCell) {
      changeCell.className = trend.colorClass;
      changeCell.textContent = Number.isFinite(trend.change)
        ? (trend.change >= 0 ? '+' : '') + trend.change.toFixed(2) + '%'
        : '--';
    }
    if (statusCell) statusCell.innerHTML = watchlistQuoteStatusHtml(item);
    if (row.getAttribute('data-trend-direction') !== trend.direction) {
      row.setAttribute('data-trend-direction', trend.direction);
      const chartCell = row.querySelector('[data-mini-chart-code]');
      if (chartCell && window.StockList && window.StockList.miniChart) {
        chartCell.innerHTML = window.StockList.miniChart(item, trend.color);
      }
    }
  });
}

function handleWatchlistDoubleClick(event) {
  if (event.target.closest('button')) return;
  const row = event.target.closest('tr[data-code]');
  if (row) selectStock(row.getAttribute('data-code'));
}

async function handleWatchlistClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  event.stopPropagation();
  const action = btn.getAttribute('data-action');
  try {
    if (action === 'view') selectStock(btn.getAttribute('data-code'));
    else if (action === 'analysis') analyzeStock(btn.getAttribute('data-code'));
    else if (action === 'trade') openTradeByCode(btn.getAttribute('data-code'));
    else if (action === 'edit') await editWatchlistItem(Number(btn.getAttribute('data-id')));
    else if (action === 'delete') await removeById(Number(btn.getAttribute('data-id')));
  } catch (error) {
    alert(error.message || '自选操作失败');
  }
}

async function refreshWatchlistQuotes() {
  const State = window.State;
  const currentItems = visibleWatchlistItems();
  if (!currentItems.length) return { ok: true, count: 0 };
  try {
    const quotes = await window.ApiClient.fetchJsonData('/api/quote?codes=' + currentItems.map(item => item.code).join(','));
    const map = {};
    if (Array.isArray(quotes)) quotes.forEach(q => { map[q.code] = q; });
    watchlistQuoteByCode = Object.assign({}, watchlistQuoteByCode, map);
    State.watchlist = State.watchlist.map(function(item) {
      const quote = map[item.code];
      const usable = quote && quote.quoteStatus !== 'unavailable' && Number(quote.price) > 0;
      return Object.assign({}, item, usable ? quote : {}, {
        quoteStatus: usable ? quote.quoteStatus || 'live' : quote ? 'unavailable' : 'stale'
      });
    });
    renderWatchlist();
    if (window.Dashboard) window.Dashboard.refreshCards();
    if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
    const usableQuotes = (Array.isArray(quotes) ? quotes : []).filter(function(quote) {
      return quote && quote.quoteStatus !== 'unavailable' && Number(quote.price) > 0;
    });
    const observedAt = usableQuotes.map(function(quote) {
      return [quote.tradeDate, quote.tradeTime].filter(Boolean).join(' ');
    }).filter(Boolean).sort().pop();
    return { ok: usableQuotes.length > 0, count: usableQuotes.length, observedAt };
  } catch (error) {
    console.error(error);
    State.watchlist = State.watchlist.map(item => Object.assign({}, item, { quoteStatus: 'stale' }));
    renderWatchlist();
    if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
    return { ok: false, error };
  }
}

function applyQuoteSnapshot(quotes, meta) {
  const State = window.State;
  const model = window.QuoteSnapshotClientModel;
  if (!model || !Array.isArray(State.watchlist)) return { ok: false, count: 0 };
  (Array.isArray(quotes) ? quotes : []).forEach(function(quote) {
    if (quote && quote.code) watchlistQuoteByCode[quote.code] = quote;
  });
  State.watchlist = model.applyWatchlistQuotes(State.watchlist, quotes);
  patchWatchlistQuoteRows();
  if (window.Dashboard) window.Dashboard.refreshCards();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  return {
    ok: true,
    count: Array.isArray(quotes) ? quotes.length : 0,
    observedAt: meta && meta.fetchedAt || null,
    stale: !!(meta && meta.stale)
  };
}

function exportVisibleWatchlistCsv() {
  const rows = [[
    'code',
    'name',
    'price',
    'change',
    'group_name',
    'alert_low',
    'alert_high',
    'auto_d1_low',
    'auto_d1_high',
    'auto_d2',
    'auto_r1',
    'auto_confirm',
    'auto_levels_date',
    'alert_status',
    'quote_status',
    'note'
  ]];
  visibleWatchlistItems().forEach(function(item) {
    const alertStatus = watchlistAlertStatus(item);
    rows.push([
      item.code,
      item.name || '',
      item.price == null ? '' : item.price,
      item.change == null ? '' : item.change,
      item.groupName || '',
      item.alertLow == null ? '' : item.alertLow,
      item.alertHigh == null ? '' : item.alertHigh,
      item.autoD1Low == null ? '' : item.autoD1Low,
      item.autoD1High == null ? '' : item.autoD1High,
      item.autoD2 == null ? '' : item.autoD2,
      item.autoR1 == null ? '' : item.autoR1,
      item.autoConfirm == null ? '' : item.autoConfirm,
      item.autoLevelsDate || '',
      alertStatus.label,
      item.quoteStatus || 'ok',
      item.note || ''
    ]);
  });
  const csv = rows.map(row => row.map(watchlistCsvCell).join(',')).join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'webstock-watchlist-' + (window.WebStockTime ? window.WebStockTime.filenameDate() : new Date().toISOString().slice(0, 10)) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stockFor(code) {
  return (window.State.allStocks || []).find(item => item.code === code) ||
    (window.State.watchlist || []).find(item => item.code === code) ||
    (window.State.recentStocks || []).find(item => item.code === code) ||
    (window.State.positions || []).find(item => item.code === code) ||
    { code, name: code };
}

function selectStock(code) {
  const stock = stockFor(code);
  if (stock && window.StockList) {
    const group = watchlistGroups().find(item => item.key === selectedWatchlistGroupKey);
    const navigation = { items: visibleWatchlistItems(), label: '自选 · ' + (group ? group.name : '全部') };
    window.switchMainView('market');
    window.StockList.selectStock(stock, { navigation }).catch(function(error) { alert(error.message || 'Load stock failed'); });
  }
}

function analyzeStock(code) {
  const stock = stockFor(code);
  if (stock && window.StockList && window.Analysis) {
    window.switchMainView('market');
    window.StockList.selectStock(stock).then(function() { window.Analysis.openAnalysisPanel(stock); }).catch(function(error) { alert(error.message || 'Analysis failed'); });
  }
}

function openTradeByCode(code) {
  const stock = stockFor(code);
  if (stock && window.Portfolio) window.Portfolio.openBuyTrade(stock);
  else if (stock && window.Trades) window.Trades.openTradeModal('new', null, Object.assign({ side: 'buy' }, stock));
}

window.Watchlist = {
  getGroupItems,
  loadWatchlist,
  addCurrentStock,
  addStock,
  removeByCode,
  removeById,
  updateWatchlistItem,
  editWatchlistItem,
  renderWatchlist,
  refreshWatchlistQuotes,
  applyQuoteSnapshot,
  exportVisibleWatchlistCsv,
  bulkSetVisibleGroup,
  setSelectedGroup,
  watchlistGroups,
  renderPortfolioWatchlistTabs,
  getSelectedGroup: function() { return selectedWatchlistGroupKey; },
  selectStock,
  analyzeStock,
  openTradeByCode,
  syncTonghuashunWatchlist,
  refreshAutomaticLevels,
  scheduleMorningMaintenance,
  getMiniChartStock
};
