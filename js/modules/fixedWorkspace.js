/* Compact V2 production composition. Moves existing nodes; never clones business controls. */
(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FixedWorkspace = api;
})(typeof window !== 'undefined' ? window : null, function(root) {
  const decks = new Map();
  let ready = false;
  let auctionNodes = [];
  let newsCard = null;
  let creatorConfiguration = null;
  let creatorConfigurationMarker = null;
  const doc = () => root.document;
  const find = selector => doc().querySelector(selector);
  function element(tag, className, text) {
    const node = doc().createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function resize() {
    root.requestAnimationFrame(() => {
      root.dispatchEvent(new Event('resize'));
      if (!root.echarts) return;
      doc().querySelectorAll('[_echarts_instance_]').forEach(node => {
        if (node.clientWidth && node.clientHeight && node.getClientRects().length) {
          const chart = root.echarts.getInstanceByDom(node);
          if (chart && !chart.isDisposed()) chart.resize();
        }
      });
    });
  }
  function deck(key, host, items, vertical) {
    if (!host) return null;
    const frame = element('section', 'fixed-deck' + (vertical ? ' fixed-deck-vertical' : ''));
    frame.dataset.deck = key;
    const nav = element('nav', 'fixed-panel-nav');
    nav.setAttribute('aria-label', '功能分区');
    const content = element('div', 'fixed-panel-content');
    const entries = items.filter(item => item.node).map(item => {
      const panel = element('div', 'fixed-page-panel');
      panel.id = 'workspace-' + key + '-' + item.key;
      const button = element('button', '', item.title);
      button.type = 'button';
      button.dataset.panelKey = item.key;
      button.setAttribute('aria-controls', panel.id);
      panel.appendChild(item.node);
      if (item.node.id === 'desktopLanAccessCard' || item.node.id === 'desktopIosAccessCard') {
        panel.appendChild(element('p','fixed-desktop-capability','此设置需要在桌面程序中使用；浏览器验收不修改桌面访问权限。'));
      }
      content.appendChild(panel);
      nav.appendChild(button);
      // Canonical pages already have a top-level tab; never render a second one.
      button.hidden = Boolean(item.page);
      button.addEventListener('click', () => {
        if (item.page && root.CompactTerminal) root.CompactTerminal.open(item.page);
        else select(item.key);
      });
      return Object.assign({}, item, {panel, button});
    });
    function select(id) {
      if (!entries.some(entry => entry.key === id)) return false;
      entries.forEach(entry => {
        const active = entry.key === id;
        entry.panel.hidden = !active;
        entry.button.setAttribute('aria-current', active ? 'true' : 'false');
        if (active && entry.node.tagName === 'DETAILS') entry.node.open = true;
      });
      frame.dataset.activePanel = id;
      resize();
      return true;
    }
    frame.append(nav, content);
    nav.hidden = entries.every(entry => Boolean(entry.page));
    host.appendChild(frame);
    if (entries.length) select(entries[0].key);
    const api = {frame, select, entries};
    decks.set(key, api);
    return api;
  }
  function item(key, title, selector, page) { return {key, title, node:find(selector), page}; }
  function group(className, nodes) {
    const box = element('div', className);
    nodes.filter(Boolean).forEach(node => box.appendChild(node));
    return box;
  }
  function setupResearch() {
    const industry = find('#industryChainView');
    if (root.IndustryWorkspace) root.IndustryWorkspace.mount(industry);
    else {
    const region = element('div', 'fixed-industry-main');
    const radar = find('.industry-concept-radar');
    const controls = find('.industry-chain-map-card');
    const classification = group('fixed-classification', [controls,find('#industryChainEvidenceState'),find('.industry-chain-results')]);
    industry.appendChild(region);
    deck('industry', region, [
      item('evidence', '关系图 / 原文证据', '#industryResearchPanel'),
      {key:'classification',title:'环节 / 公司线索',node:classification},
      {key:'radar',title:'概念发现',node:radar},
      item('external', '外部研究', '#externalIndustryChainResearch')
    ]);
    }
    deck('research', find('#aiResearchView'), [
      item('decision', '证据与研究报告', '.research-decision-band'),
      item('quant', '量化研究', '.quant-research-band'),
      item('import', '候选导入', '.gpt-pick-import-band'),
      item('people', '人物与方法', '.expert-tracker-band')
    ], true);
    const settings = find('.settings-grid');
    const models = find('.ai-model-band');
    if (models) { models.classList.add('settings-card'); settings.appendChild(models); }
    const cards = Array.from(settings.children);
    deck('settings', settings, cards.map((node,index) => ({key:node === models ? 'models' : node.querySelector('#settingsLevel2Status') ? 'health' : 'settings-'+index,
      title:node.querySelector('h3')?.textContent || '设置项 '+(index+1),node})), true);
  }
  function setupCreator() {
    const host = find('.creator-task-page');
    const controls = find('.creator-task-control-card');
    const panel = element('div', 'fixed-creator-main');
    host.appendChild(panel);
    controls.classList.add('fixed-creator-controls');
    const batch = find('.creator-batch-controls');
    const global = group('creator-global-panel',[find('.creator-global-settings'),find('#openCreatorAsrSetupBtn')]);
    const jobs = group('fixed-creator-jobs', [find('.creator-collection-queue'),find('.creator-task-progress-card')]);
    creatorConfiguration = find('#creatorConfiguration');
    creatorConfigurationMarker = doc().createComment('current author configuration location');
    creatorConfiguration.before(creatorConfigurationMarker);
    const management = element('section', 'creator-management-panel');
    management.append(element('h3', '', '作者资料与采集配置'), element('p', 'muted', '在上方切换作者；这里管理主页、采集范围、转写模型与自动采集。视频和本轮进度请前往采集任务。'));
    deck('creator', panel, [
      item('videos', '视频与逐字稿', '#expertCreatorWorkbench'),
      {key:'management',title:'作者管理',page:'authors',node:management},
      {key:'jobs',title:'队列 / 本轮进度',node:jobs},
      {key:'batch',title:'批量采集 · 多作者',node:batch},
      {key:'global',title:'全局设置 / 转写环境',node:global},
      item('runs', '历史运行记录', '#creatorTaskRunAudit'),
      item('packet', '分析材料', '#expertAnalysisPacketCard')
    ]);
  }
  function setupAuction() {
    const host = element('section', 'fixed-auction');
    host.id = 'auctionWorkspace'; host.hidden = true;
    const heading = element('header', 'fixed-auction-heading');
    heading.append(element('strong', '', '集合竞价 · 当前选中证券'),element('span','fixed-auction-stock'));
    const back = element('button','small-btn','查看个股主图');
    back.type = 'button'; back.onclick = () => root.CompactTerminal.open('market');
    heading.appendChild(back);
    host.appendChild(heading);
    const columns = element('div','fixed-auction-columns');
    host.appendChild(columns);
    ['#openingAuctionSummary','#closingAuctionSummary','.auction-knowledge'].forEach(selector => {
      const node = find(selector)?.closest(selector === '.auction-knowledge' ? 'details' : 'article');
      if (!node) return;
      const marker = doc().createComment('auction original location');
      node.before(marker);
      auctionNodes.push({node,marker,host:selector === '.auction-knowledge' ? host : columns});
    });
    find('#marketView').appendChild(host);
  }
  function setupOtherViews() {
    const sectors = find('#sectorsView');
    const observed = group('fixed-sector-observed',[find('#sectorsView .mode-tabs'),find('#sectorDashboard')]);
    deck('sectors',sectors,[item('hot','板块热度','#hotMarketBoard'),{key:'leaders',title:'龙头观察',node:observed},item('research','外部研究','#externalHotspotResearch'),item('analysis','AI复核','#hotMarketAnalysisCard')]);
    const stats = find('#statsView');
    deck('stats',stats,[item('exposure','持仓结构 / 归因','#statsExposureTable'),item('charts','资产分布 / 盈亏','.stats-charts')]);
    // Comment workbench owns tab selection and hidden state. Keep its original
    // controls instead of wrapping them in a second, independent tab system.
    const news = find('#newsView');
    const newsBody = element('div','fixed-news-workspace');
    const reader = element('article','fixed-news-reader'); reader.id='newsInlineReader';
    reader.appendChild(element('p','fixed-reader-empty','选择左侧资讯，在这里阅读正文与来源。'));
    newsBody.append(find('#newsList'),reader); news.appendChild(newsBody);
    newsCard = find('.news-detail-modal');
    const screener = find('#screenerView');
    const filter = group('fixed-screener-filter',[find('.screener-panel'),find('#screenerView .disclaimer'),find('#screenerHistory')]);
    const result = group('fixed-screener-result',[find('.screener-result-tools'),find('#screenerResults')]);
    screener.appendChild(group('fixed-screener-workspace',[filter,result]));
  }
  function prepare() {
    if (ready || !root) return;
    ready = true;
    doc().body.classList.add('fixed-terminal');
    deck('home', find('#dashboardView'), [
      item('trading', '行情工作台', '.home-terminal'),
      item('rankings', '板块与风险榜单', '#homeRankings'),
      item('panorama', '市场全景', '#homeMarketMore'),
      item('stock', '个股研究', '#homeStockMore')
    ]);
    find('#etfView').appendChild(find('.institutional-intraday-panel'));
    deck('capital', find('.capital-flow-shell'), [
      item('overview', '个股资金观测', '.capital-flow-intraday-query', 'capitalFlow'),
      item('dark', '明盘 / 暗盘', '.dark-rank-panel', 'darkFlow'),
      item('rotation', '板块轮动', '.rotation-panel', 'rotation'),
      item('replay', '资金快照回放（导入）', '.flow-replay-panel', 'replay'),
      {key:'daily',title:'ETF / 期货日终',page:'capitalDaily',node:group('fixed-institutional-workspace',[
        find('[aria-labelledby="institutionalFlowTitle"]'),find('#eastmoneyEtfDailyReport')])}
    ]);
    setupResearch();
    setupCreator();
    setupAuction();
    setupOtherViews();
  }
  function canShow(page) {
    return Boolean(page && (!page.target || doc().getElementById(page.target)) && doc().getElementById(page.view + 'View'));
  }
  function show(page) {
    if (!canShow(page)) return false;
    prepare();
    if (page.view === 'dashboard') decks.get('home').select('trading');
    if (page.view === 'capitalFlow') decks.get('capital').select({capitalFlow:'overview',darkFlow:'dark',rotation:'rotation',replay:'replay',capitalIntraday:'daily',capitalDaily:'daily'}[page.id]);
    if (page.view === 'aiResearch') decks.get('research').select('decision');
    if (page.view === 'settings' && page.id === 'health') decks.get('settings').select('health');
    if (page.view === 'creatorTasks') {
      find('.creator-task-page').classList.toggle('fixed-author-management',page.id === 'authors');
      find('.creator-task-hero h2').textContent = page.id === 'authors' ? '作者管理' : '采集任务与视频记录';
      find('.creator-task-hero p').textContent = page.id === 'authors'
        ? '管理当前作者的资料、主页与采集规则；视频和任务进度在采集任务中查看。'
        : '查看登录会话、采集流程、转写队列和每条视频的可核对记录。';
      if (page.id === 'authors') {
        find('.creator-management-panel').appendChild(creatorConfiguration);
        creatorConfiguration.open = true;
      } else if (creatorConfiguration.parentElement === find('.creator-management-panel')) {
        creatorConfigurationMarker.after(creatorConfiguration);
        creatorConfiguration.open = false;
      }
      decks.get('creator').frame.querySelector('.fixed-panel-nav').hidden = page.id === 'authors';
      decks.get('creator').select(page.id === 'authors' ? 'management' : 'videos');
    }
    const auction = page.id === 'auction';
    find('#auctionWorkspace').hidden = !auction;
    find('#marketView').classList.toggle('fixed-auction-active',auction);
    auctionNodes.forEach(entry => {
      if (auction) entry.host.appendChild(entry.node);
      else entry.marker.after(entry.node);
    });
    if (auction) {
      const stock = root.State.currentStock || {};
      find('.fixed-auction-stock').textContent = (stock.name || '请先通过顶部搜索选择证券') + ' ' + (stock.code || '');
      if (root.RealtimeChart && (root.State.currentView !== 'kline' || root.State.currentPeriod !== 'day')) root.RealtimeChart.showKlineView('day');
      if (root.setMarketDrawerOpen) root.setMarketDrawerOpen(false);
    }
    resize();
    return true;
  }
  function placeNewsDetail() {
    if (!newsCard) return false;
    const inline = root.State.currentMainView === 'news';
    const host = find(inline ? '#newsInlineReader' : '#newsDetailOverlay');
    if (inline) { const hint = host.querySelector('.fixed-reader-empty'); if (hint) hint.remove(); }
    host.appendChild(newsCard);
    return inline;
  }
  function reportError(view, message) {
    const host = doc().getElementById((view === 'portfolio' ? 'watchlist' : view)+'View');
    if (!host) return;
    let banner = host.querySelector('.fixed-view-error');
    if (!banner) {
      banner = element('div','fixed-view-error'); banner.setAttribute('role','status');
      banner.appendChild(element('span',''));
      const close = element('button','small-btn','关闭提示'); close.onclick=()=>banner.remove(); banner.appendChild(close);
      host.appendChild(banner);
    }
    banner.querySelector('span').textContent = '读取未完成，保留已有内容：'+String(message || '数据暂不可用');
  }
  function selectSetting(key) { return decks.get('settings')?.select(key); }
  return { prepare, show, canShow, placeNewsDetail, reportError, selectSetting };
});
