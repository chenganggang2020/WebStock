(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CompactTerminal = api;
})(typeof window !== 'undefined' ? window : null, function(root) {
  const groups = { market: '盯盘', watch: '自选与账户', capital: '资金', research: '研究', collect: '采集', paper: '模拟', settings: '设置' };
  const pages = [
    ['dashboard', '市场总览', 'market'], ['market', '个股详情', 'market'], ['sectors', '板块观察', 'market'],
    ['auction', '集合竞价', 'market', 'market', 'openingAuctionSummary'], ['etf', 'ETF / 期货盘中', 'market'],
    ['watchlist', '自选工作台', 'watch'], ['portfolio', '持仓镜像', 'watch'], ['recent', '最近查看', 'watch'],
    ['trades', '账户交易记录', 'watch'], ['stats', '账户持仓统计', 'watch'],
    ['capitalFlow', '个股资金', 'capital'], ['darkFlow', '明盘 / 暗盘', 'capital', 'capitalFlow', 'darkRankTitle'],
    ['rotation', '板块轮动', 'capital', 'capitalFlow', 'rotationTitle'], ['replay', '资金快照回放（导入）', 'capital', 'capitalFlow', 'flowReplayTitle'],
    ['capitalDaily', 'ETF / 期货日终', 'capital', 'capitalFlow', 'institutionalFlowTitle'],
    ['industryChain', '产业链研究', 'research'], ['screener', '本地候选', 'research'], ['news', '资讯与公告', 'research'],
    ['aiResearch', 'AI研究', 'research'], ['evidence', '证据库', 'research'],
    ['commentStrategy', '评论工坊', 'research'], ['aiHistory', 'AI交接记录', 'research'],
    ['creatorTasks', '采集任务', 'collect'], ['authors', '作者管理', 'collect', 'creatorTasks', 'creatorTaskChannelSelect'],
    ['compoundLab', '情景测算', 'paper'], ['paperPortfolio', '纸面组合 / 前向模拟', 'paper'],
    ['settings', '设置中心', 'settings'], ['health', '行情接口 / Level-2', 'settings', 'settings', 'settingsLevel2Status']
  ].map(function(row) { return Object.freeze({ id: row[0], label: row[1], workspace: row[2], view: row[3] || row[0], target: row[4] || null }); });
  let bound = false;
  const lastPages = {};
  function resolve(id) { return pages.find(function(page) { return page.id === (id === 'capitalIntraday' ? 'capitalDaily' : id); }) || null; }

  function sync(view, pageId) {
    if (!root) return;
    const page = resolve(pageId) || resolve(view);
    if (!page) return;
    if (root.FixedWorkspace && root.FixedWorkspace.show(page) === false) return false;
    lastPages[page.workspace] = page.id;
    const doc = root.document;
    doc.body.dataset.workspace = page.workspace;
    doc.body.dataset.terminalPage = page.id;
    doc.querySelectorAll('#terminalWorkspaces [data-workspace]').forEach(function(button) {
      button.setAttribute('aria-pressed', String(button.dataset.workspace === page.workspace));
    });
    doc.querySelectorAll('#mainTabs button').forEach(function(button) {
      const entry = resolve(button.dataset.terminalPage || button.dataset.mainView);
      if (!entry) return;
      button.hidden = entry.workspace !== page.workspace;
      button.classList.toggle('active', entry.id === page.id);
      button.setAttribute('aria-current', entry.id === page.id ? 'page' : 'false');
    });
    const title = doc.getElementById('terminalContextTitle');
    if (title) title.textContent = page.label;
    const picker = doc.getElementById('terminalPageSelect');
    if (picker) picker.value = page.id;
    doc.title = page.label + ' · 行情与研究';
    return true;
  }

  function open(id) {
    const page = resolve(id);
    if (!page || !root) return;
    if (root.FixedWorkspace && !root.FixedWorkspace.canShow(page)) return;
    if (page.view === 'market' && root.MarketOverview) root.MarketOverview.showDetail();
    root.switchMainView(page.view, { terminalPage: page.id });
  }

  function bind() {
    if (bound || !root) return;
    bound = true;
    const doc = root.document;
    if (root.FixedWorkspace) root.FixedWorkspace.prepare();
    const nav = doc.getElementById('terminalWorkspaces');
    const tabs = doc.getElementById('mainTabs');
    const picker = doc.getElementById('terminalPageSelect');
    Object.keys(groups).forEach(function(key) {
      const button = doc.createElement('button');
      button.type = 'button'; button.dataset.workspace = key; button.textContent = groups[key];
      button.addEventListener('click', function() { open(lastPages[key] || pages.find(function(page) { return page.workspace === key; }).id); });
      nav.appendChild(button);
    });
    pages.forEach(function(page) {
      let button = tabs.querySelector('[data-main-view="' + page.id + '"]');
      if (!button) {
        button = doc.createElement('button'); button.type = 'button'; button.className = 'terminal-subpage';
        tabs.appendChild(button);
        button.addEventListener('click', function() { open(page.id); });
      }
      button.dataset.terminalPage = page.id; button.textContent = page.label;
      tabs.appendChild(button);
      const option = doc.createElement('option'); option.value = page.id;
      option.textContent = groups[page.workspace] + ' / ' + page.label; picker.appendChild(option);
    });
    picker.addEventListener('change', function() { open(picker.value); });
    doc.addEventListener('click', function(event) {
      const link = event.target.closest('[data-terminal-link]');
      if (!link) return;
      event.preventDefault();
      open(link.dataset.terminalLink);
      if (link.dataset.settingsPanel && root.FixedWorkspace) root.FixedWorkspace.selectSetting(link.dataset.settingsPanel);
    });
    const density = doc.getElementById('terminalDensityToggle');
    let saved = 'compact';
    try { saved = root.localStorage.getItem('webstock-terminal-density') || 'compact'; } catch (_) {}
    function setDensity(value) {
      const readable = value === 'readable';
      doc.body.dataset.density = readable ? 'readable' : 'compact';
      density.setAttribute('aria-pressed', String(readable));
      density.textContent = readable ? '易读' : '紧凑';
      root.dispatchEvent(new Event('resize'));
    }
    setDensity(saved);
    density.addEventListener('click', function() {
      setDensity(doc.body.dataset.density === 'compact' ? 'readable' : 'compact');
      try { root.localStorage.setItem('webstock-terminal-density', doc.body.dataset.density); } catch (_) {}
    });
    sync(root.State.currentMainView || 'dashboard');
  }
  return { pages: Object.freeze(pages), resolve: resolve, bind: bind, sync: sync, open: open };
});
