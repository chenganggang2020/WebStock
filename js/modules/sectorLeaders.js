let sectorDashboard = null;
let sectorMode = 'cards';

function sectorApi(path, options) {
  return window.apiFetch(path, options);
}

function sectorFmt(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits === undefined ? 2 : digits) : '--';
}

function sectorPnlClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 0 ? 'pnl-up' : 'pnl-down';
}

function sectorRoleFilterValue() {
  const filter = document.getElementById('sectorRoleFilter');
  return filter ? filter.value : '';
}

function sectorKeywordFilterValue() {
  const filter = document.getElementById('sectorKeywordFilter');
  return filter ? filter.value.trim().toLowerCase() : '';
}

function leaderMatchesKeyword(item, sectorName) {
  const keyword = sectorKeywordFilterValue();
  if (!keyword) return true;
  return [
    sectorName,
    item.sectorName,
    item.code,
    item.name,
    item.role,
    item.strength,
    item.note,
    item.reason
  ].filter(Boolean).join(' ').toLowerCase().includes(keyword);
}

function filterLeaders(leaders, sectorName) {
  const role = sectorRoleFilterValue();
  return (leaders || []).filter(function(item) {
    const roleMatch = !role || item.role === role;
    return roleMatch && leaderMatchesKeyword(item, sectorName);
  });
}

async function load() {
  sectorDashboard = await sectorApi('/api/sector-leaders/dashboard');
  renderSectorDashboard();
  renderDashboardSummary();
  if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  return sectorDashboard;
}

async function loadDashboardSummary() {
  try {
    sectorDashboard = await sectorApi('/api/sector-leaders/dashboard');
    renderDashboardSummary();
    if (window.updateSidebarWorkspace) window.updateSidebarWorkspace();
  } catch (error) {
    const box = document.getElementById('dashboardSectorList');
    if (box) box.innerHTML = '<div class="empty-state compact">板块龙头加载失败：' + error.message + '</div>';
  }
}

function sortedLeaders(leaders) {
  const sort = document.getElementById('sectorSortSelect') ? document.getElementById('sectorSortSelect').value : 'change';
  const sectorName = arguments.length > 1 ? arguments[1] : '';
  return filterLeaders(leaders, sectorName).slice().sort(function(a, b) {
    if (sort === 'amount') return (Number(b.amount) || 0) - (Number(a.amount) || 0);
    if (sort === 'weight') return (Number(b.weight) || 0) - (Number(a.weight) || 0);
    return (Number(b.change) || -999) - (Number(a.change) || -999);
  });
}

function renderLeaderRow(item) {
  const hot = Number(item.change) >= 3 ? ' hot' : Number(item.change) <= -3 ? ' risk' : '';
  return '<tr class="' + hot + '">' +
    '<td>' + item.code + '</td>' +
    '<td>' + item.name + '</td>' +
    '<td>' + item.role + '</td>' +
    '<td>' + sectorFmt(item.price) + '</td>' +
    '<td class="' + sectorPnlClass(item.change) + '">' + (Number.isFinite(Number(item.change)) ? (Number(item.change) >= 0 ? '+' : '') + sectorFmt(item.change) + '%' : '--') + '</td>' +
    '<td>' + sectorFmt(Number(item.amount) / 100000000) + '亿</td>' +
    '<td>' + (item.strength || '--') + '</td>' +
    '<td>' + (item.note || '') + '</td>' +
    '<td><div class="stock-actions">' +
    '<button class="small-btn primary" data-action="view" data-code="' + item.code + '">查看</button>' +
    '<button class="small-btn" data-action="analysis" data-code="' + item.code + '">分析</button>' +
    '<button class="small-btn" data-action="watchlist" data-code="' + item.code + '">自选</button>' +
    '<button class="small-btn" data-action="trade" data-code="' + item.code + '">持仓</button>' +
    '<button class="small-btn" data-action="stockNews" data-code="' + item.code + '">资讯</button>' +
    '<button class="small-btn" data-action="leaderHistory" data-code="' + item.code + '">History</button>' +
    '<button class="small-btn" data-action="editLeader" data-leader-id="' + item.id + '">编辑</button>' +
    '<button class="small-btn danger" data-action="deleteLeader" data-leader-id="' + item.id + '">删除</button>' +
    '</div></td>' +
    '</tr>';
}

function renderCards() {
  const box = document.getElementById('sectorDashboard');
  if (!box) return;
  const sectors = (sectorDashboard && sectorDashboard.sectors) || [];
  if (!sectors.length) {
    box.innerHTML = '<div class="empty-state">暂无板块，点击“添加板块”开始配置。</div>';
    return;
  }
  const visibleSectors = sectors.map(function(sector) {
    return Object.assign({}, sector, { leaders: sortedLeaders(sector.leaders || [], sector.name) });
  }).filter(function(sector) {
    return !sectorKeywordFilterValue() || sector.leaders.length || String(sector.name || '').toLowerCase().includes(sectorKeywordFilterValue());
  });
  if (!visibleSectors.length) {
    box.innerHTML = '<div class="empty-state">No sectors or leaders match the current filters.</div>';
    return;
  }
  box.innerHTML = '<div class="sector-grid">' + visibleSectors.map(function(sector) {
    return '<section class="sector-card">' +
      '<header><div><h3>' + sector.name + '</h3><p>' + (sector.description || '') + '</p></div><span class="status-pill">' + sector.status + '</span></header>' +
      '<div class="sector-actions">' +
      '<button class="small-btn" data-action="addLeader" data-sector-id="' + sector.id + '">添加龙头</button>' +
      '<button class="small-btn" data-action="editSector" data-sector-id="' + sector.id + '">编辑板块</button>' +
      '<button class="small-btn" data-action="sectorNews" data-sector-name="' + sector.name + '">资讯</button>' +
      '</div>' +
      '<table class="data-table compact"><thead><tr><th>代码</th><th>名称</th><th>角色</th><th>价</th><th>涨跌</th><th>额</th><th>强弱</th><th>备注</th><th>操作</th></tr></thead><tbody>' +
      sector.leaders.map(renderLeaderRow).join('') +
      '</tbody></table>' +
      '</section>';
  }).join('') + '</div>';
  bindActions(box);
}

function renderOverview(items, title) {
  const box = document.getElementById('sectorDashboard');
  if (!box) return;
  const filteredItems = filterLeaders(items);
  if (!filteredItems.length) {
    box.innerHTML = '<div class="empty-state">暂无数据。</div>';
    return;
  }
  box.innerHTML = '<section class="sector-card"><header><h3>' + title + '</h3></header><table class="data-table compact"><thead><tr><th>板块</th><th>代码</th><th>名称</th><th>角色</th><th>价</th><th>涨跌</th><th>额</th><th>强弱</th><th>备注</th><th>操作</th></tr></thead><tbody>' +
    filteredItems.map(function(item) {
      return renderLeaderRow(item).replace('<tr', '<tr data-sector="' + (item.sectorName || '') + '"').replace('<td>' + item.code + '</td>', '<td>' + (item.sectorName || '') + '</td><td>' + item.code + '</td>');
    }).join('') +
    '</tbody></table></section>';
  bindActions(box);
}

function renderSectorDashboard() {
  if (sectorMode === 'overview') renderOverview((sectorDashboard && sectorDashboard.overview) || [], '全部板块龙头涨跌排行');
  else if (sectorMode === 'risk') renderOverview((sectorDashboard && sectorDashboard.risks) || [], '风险模式：跌幅较大或强弱偏弱');
  else renderCards();
}

function setMode(mode) {
  sectorMode = mode;
  document.querySelectorAll('[data-sector-mode]').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-sector-mode') === mode);
  });
  renderSectorDashboard();
}

function stockByCode(code) {
  return (window.State.allStocks || []).find(item => item.code === code) ||
    (window.State.watchlist || []).find(item => item.code === code) ||
    (window.State.recentStocks || []).find(item => item.code === code) ||
    (window.State.positions || []).find(item => item.code === code) ||
    ((sectorDashboard && sectorDashboard.overview) || []).find(item => item.code === code) ||
    { code, name: code };
}

async function handleStockAction(action, code) {
  const stock = stockByCode(code);
  if (action === 'view') {
    window.switchMainView('market');
    await window.StockList.selectStock(stock);
  } else if (action === 'analysis') {
    window.switchMainView('market');
    await window.StockList.selectStock(stock);
    window.Analysis.openAnalysisPanel(stock);
  } else if (action === 'watchlist') {
    await window.Watchlist.addStock(stock);
  } else if (action === 'trade') {
    if (window.Portfolio) window.Portfolio.openBuyTrade(stock);
    else window.Trades.openTradeModal('new', null, Object.assign({ side: 'buy' }, stock));
  }
}

async function showLeaderHistory(code) {
  const box = document.getElementById('sectorDashboard');
  if (!box) return;
  const snapshots = await sectorApi('/api/sector-leaders/snapshots?code=' + encodeURIComponent(code) + '&limit=20');
  if (!snapshots.length) {
    box.innerHTML = '<section class="sector-card"><header><h3>Leader history</h3></header><div class="empty-state compact">No snapshots recorded yet.</div><button class="small-btn" data-action="backToSectors">Back</button></section>';
  } else {
    box.innerHTML = '<section class="sector-card"><header><h3>Leader history ' + code + '</h3><button class="small-btn" data-action="backToSectors">Back</button></header>' +
      '<table class="data-table compact"><thead><tr><th>Time</th><th>Sector</th><th>Name</th><th>Price</th><th>Change</th><th>Amount</th></tr></thead><tbody>' +
      snapshots.map(function(item) {
        return '<tr>' +
          '<td>' + item.capturedAt + '</td>' +
          '<td>' + (item.sectorName || '') + '</td>' +
          '<td>' + item.name + '</td>' +
          '<td>' + sectorFmt(item.price) + '</td>' +
          '<td class="' + sectorPnlClass(item.change) + '">' + (Number.isFinite(Number(item.change)) ? (Number(item.change) >= 0 ? '+' : '') + sectorFmt(item.change) + '%' : '--') + '</td>' +
          '<td>' + sectorFmt(Number(item.amount) / 100000000) + '亿</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></section>';
  }
  bindActions(box);
}

async function showTrends() {
  const box = document.getElementById('sectorDashboard');
  if (!box) return;
  const trends = await sectorApi('/api/sector-leaders/trends?limit=300');
  if (!trends.length) {
    box.innerHTML = '<section class="sector-card"><header><h3>Leader trends</h3></header><div class="empty-state compact">No leader snapshots yet.</div></section>';
    return;
  }
  box.innerHTML = '<section class="sector-card"><header><h3>Leader trends</h3></header>' +
    '<table class="data-table compact"><thead><tr><th>Sector</th><th>Code</th><th>Name</th><th>Latest</th><th>Previous</th><th>Delta</th><th>Samples</th><th>Updated</th></tr></thead><tbody>' +
    trends.slice(0, 50).map(function(item) {
      return '<tr>' +
        '<td>' + (item.sectorName || '') + '</td>' +
        '<td>' + item.code + '</td>' +
        '<td>' + item.name + '</td>' +
        '<td class="' + sectorPnlClass(item.latestChange) + '">' + (Number.isFinite(Number(item.latestChange)) ? sectorFmt(item.latestChange) + '%' : '--') + '</td>' +
        '<td class="' + sectorPnlClass(item.previousChange) + '">' + (Number.isFinite(Number(item.previousChange)) ? sectorFmt(item.previousChange) + '%' : '--') + '</td>' +
        '<td class="' + sectorPnlClass(item.changeDelta) + '">' + (Number.isFinite(Number(item.changeDelta)) ? (Number(item.changeDelta) >= 0 ? '+' : '') + sectorFmt(item.changeDelta) + 'pct' : '--') + '</td>' +
        '<td>' + item.samples + '</td>' +
        '<td>' + (item.latestAt || '') + '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table></section>';
}

async function pruneSnapshots() {
  const keep = prompt('Keep latest snapshot rows', '500');
  if (keep === null) return;
  const keepLatest = Math.max(Number(keep) || 0, 1);
  if (!confirm('Delete sector leader snapshots beyond the latest ' + keepLatest + ' rows?')) return;
  const result = await sectorApi('/api/sector-leaders/snapshots?keepLatest=' + keepLatest, { method: 'DELETE' });
  alert('Deleted snapshots: ' + result.deleted);
}

function sectorCsvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}

function downloadSectorCsv(filename, rows) {
  const csv = '\ufeff' + rows.map(row => row.map(sectorCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function downloadSectorJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

async function exportSnapshotsCsv() {
  const snapshots = await sectorApi('/api/sector-leaders/snapshots?limit=1000');
  if (!snapshots.length) {
    alert('No sector leader snapshots to export.');
    return;
  }
  const rows = [['capturedAt', 'sectorName', 'code', 'name', 'price', 'change', 'amount']]
    .concat(snapshots.map(function(item) {
      return [item.capturedAt, item.sectorName, item.code, item.name, item.price, item.change, item.amount];
    }));
  downloadSectorCsv('webstock-sector-snapshots-' + new Date().toISOString().slice(0, 10) + '.csv', rows);
}

async function exportConfigJson() {
  const config = await sectorApi('/api/sector-config');
  downloadSectorJson('webstock-sector-config-' + new Date().toISOString().slice(0, 10) + '.json', config);
}

async function importConfigFromFile(file) {
  if (!file) return;
  const text = await file.text();
  const config = JSON.parse(text || '{}');
  const count = Array.isArray(config.sectors) ? config.sectors.length : 0;
  if (!confirm('Import sector config will merge ' + count + ' sectors into the current board. Continue?')) return;
  const result = await sectorApi('/api/sector-config/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'merge', config })
  });
  await load();
  alert('Imported sector config: ' + result.sectors + ' sectors, ' + result.leaders + ' leaders.');
}

function bindActions(box) {
  box.onclick = async function(event) {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    try {
      if (['view', 'analysis', 'watchlist', 'trade'].includes(action)) {
        await handleStockAction(action, btn.getAttribute('data-code'));
      } else if (action === 'stockNews') {
        window.switchMainView('news');
        document.getElementById('newsTypeFilter').value = 'stock';
        document.getElementById('newsKeywordInput').value = btn.getAttribute('data-code');
        await window.News.load();
      } else if (action === 'leaderHistory') {
        await showLeaderHistory(btn.getAttribute('data-code'));
      } else if (action === 'addLeader') {
        await addLeader(Number(btn.getAttribute('data-sector-id')));
      } else if (action === 'editSector') {
        await editSector(Number(btn.getAttribute('data-sector-id')));
      } else if (action === 'editLeader') {
        await editLeader(Number(btn.getAttribute('data-leader-id')));
      } else if (action === 'deleteLeader') {
        await deleteLeader(Number(btn.getAttribute('data-leader-id')));
      } else if (action === 'sectorNews') {
        window.switchMainView('news');
        document.getElementById('newsTypeFilter').value = 'sector';
        document.getElementById('newsKeywordInput').value = btn.getAttribute('data-sector-name');
        await window.News.load();
      } else if (action === 'backToSectors') {
        renderSectorDashboard();
      }
    } catch (error) {
      alert(error.message || '板块操作失败');
    }
  };
}

async function addSector() {
  const name = prompt('板块名称');
  if (!name) return;
  const description = prompt('板块说明', '') || '';
  await sectorApi('/api/sectors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
  await load();
}

async function editSector(id) {
  const sector = ((sectorDashboard && sectorDashboard.sectors) || []).find(item => item.id === id);
  if (!sector) return;
  const name = prompt('板块名称', sector.name);
  if (!name) return;
  const description = prompt('板块说明', sector.description || '') || '';
  await sectorApi('/api/sectors/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, sortOrder: sector.sortOrder || 0 })
  });
  await load();
}

async function addLeader(sectorId) {
  const code = prompt('股票代码');
  if (!code) return;
  const name = prompt('股票名称', code) || code;
  const role = prompt('角色：总龙头/趋势龙头/容量龙头/补涨龙头/观察股', '观察股') || '观察股';
  const note = prompt('备注', '') || '';
  await sectorApi('/api/sectors/' + sectorId + '/leaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, role, note })
  });
  await load();
}

function leaderFor(id) {
  const sectors = (sectorDashboard && sectorDashboard.sectors) || [];
  for (let i = 0; i < sectors.length; i++) {
    const leader = (sectors[i].leaders || []).find(item => item.id === id);
    if (leader) return leader;
  }
  return ((sectorDashboard && sectorDashboard.overview) || []).find(item => item.id === id);
}

async function editLeader(id) {
  const leader = leaderFor(id);
  if (!leader) return;
  const code = prompt('股票代码', leader.code);
  if (!code) return;
  const name = prompt('股票名称', leader.name || code) || code;
  const role = prompt('角色：总龙头/趋势龙头/容量龙头/补涨龙头/观察股', leader.role || '观察股') || '观察股';
  const weight = prompt('权重', leader.weight || 1);
  if (weight === null) return;
  const note = prompt('备注', leader.note || '') || '';
  const reason = prompt('入选理由', leader.reason || '') || '';
  await sectorApi('/api/sector-leaders/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, role, weight, note, reason })
  });
  await load();
}

async function deleteLeader(id) {
  const leader = leaderFor(id);
  if (!leader) return;
  if (!confirm('确定删除 ' + leader.name + ' 吗？')) return;
  await sectorApi('/api/sector-leaders/' + id, { method: 'DELETE' });
  await load();
}

async function runAIAnalysis() {
  const data = await sectorApi('/api/sector-leaders/ai-analysis', { method: 'POST' });
  if (data.handoffMode && window.AIAssistant) {
    window.AIAssistant.open({
      title: '板块龙头 ChatGPT 交接',
      prompt: data.prompt,
      summary: data.report,
      kind: 'sector',
      context: { view: 'sectors' }
    });
  } else {
    if (window.AIAssistant && window.AIAssistant.saveHistoryRecord) {
      window.AIAssistant.saveHistoryRecord({
        title: '板块龙头 AI 分析',
        summary: '板块热股和龙头持续性分析。',
        prompt: data.prompt || '',
        result: data.report,
        kind: 'sector',
        context: { view: 'sectors' }
      });
    }
    const overlay = document.getElementById('analysisOverlay');
    const body = document.getElementById('analysisPanelBody');
    overlay.style.display = 'flex';
    body.innerHTML = '<div class="md-body">' + window.Analysis.simpleMarkdown(data.report) + '</div>';
  }
}

function renderDashboardSummary() {
  const box = document.getElementById('dashboardSectorList');
  if (!box) return;
  const items = ((sectorDashboard && sectorDashboard.overview) || []).slice(0, 6);
  if (!items.length) {
    box.innerHTML = '<div class="empty-state compact">暂无板块龙头数据。</div>';
    return;
  }
  box.innerHTML = '<table class="mini-table"><tbody>' + items.map(item => '<tr><td>' + item.sectorName + '</td><td>' + item.code + '</td><td>' + item.name + '</td><td class="' + sectorPnlClass(item.change) + '">' + sectorFmt(item.change) + '%</td><td><button class="small-btn" data-action="view" data-code="' + item.code + '">View</button></td></tr>').join('') + '</tbody></table>';
  box.onclick = async function(event) {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    try {
      await handleStockAction(btn.getAttribute('data-action'), btn.getAttribute('data-code'));
    } catch (error) {
      alert(error.message || 'Sector action failed');
    }
  };
}

window.SectorLeaders = {
  load,
  loadDashboardSummary,
  render: renderSectorDashboard,
  setMode,
  showTrends,
  exportSnapshotsCsv,
  exportConfigJson,
  importConfigFromFile,
  pruneSnapshots,
  addSector,
  addLeader,
  editLeader,
  deleteLeader,
  runAIAnalysis,
  renderDashboardSummary,
  getDashboard: function() { return sectorDashboard; }
};
