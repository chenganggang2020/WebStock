/* One selection drives the diagram, company table and original evidence reader. */
(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IndustryWorkspace = api;
})(typeof window === 'undefined' ? null : window, function(root) {
  const STAGES = {materials:'原材料与耗材',equipment:'生产与检测设备',components:'核心器件与零部件',manufacturing:'制造、封装与集成',applications:'下游应用'};
  const STATUS = {matched:'资料匹配 · 待核验',candidate:'待核验',verified:'人工核验',disputed:'有争议',author_claim:'作者观点 · AI提取'};
  const CREATOR_STATUS = {ready:'仅供候选提取 · 非事实核验',missing_text:'缺少正文',suspected_prompt_echo:'疑似转写提示词',asr_review_required:'音频转写待复核',note_ocr_required:'图文 OCR 待完成',note_review_required:'图文 OCR 待校对'};
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => /^https?:\/\/[^\s]+$/i.test(String(value || '').trim()) ? String(value).trim() : '';
  function groupEvidence(items) {
    const groups = new Map();
    (items || []).forEach((item,index) => {
      const url = safeUrl(item.finalUrl || item.sourceUrl || item.requestedUrl || item.canonicalUrl || item.url);
      const key = url || item.id || item.evidenceId || 'missing-'+index;
      if (!groups.has(key)) groups.set(key,{url,title:item.title || '原文证据',fragments:[]});
      const group = groups.get(key);
      // Keep distinct excerpts/hashes/timestamps; only exact duplicates are removed.
      if (!group.fragments.some(fragment => JSON.stringify(fragment) === JSON.stringify(item))) group.fragments.push(item);
    });
    return Array.from(groups.values());
  }
  function classificationRows(result) {
    return ['confirmed','candidates'].flatMap(kind => (result?.[kind] || []).map((item,index) => ({
      key:kind+'-'+index, stage:item.stage, company:item.stock?.name || item.stockName || '公司未绑定',
      code:item.stock?.code || item.stockCode || '', product:'',
      status:kind === 'confirmed' ? 'matched' : 'candidate', observedAt:item.observedAt,
      reason:item.reasonCode, evidence:groupEvidence(item.evidence), original:item
    })));
  }
  function researchRows(version) {
    const evidence = new Map((version?.evidence || []).map(item=>[item.id,item]));
    return (version?.relations || []).map((item,index) => ({
      key:item.id || 'relation-'+index,stage:item.stage,product:item.product || '',
      company:item.company?.name || '公司未绑定',code:item.company?.stockCode || '',
      status:['verified','disputed'].includes(item.status) ? item.status : 'candidate',
      claim:item.claim,observedAt:version.createdAt,original:item,
      evidence:groupEvidence((item.evidenceRefs || []).map(ref => Object.assign({},evidence.get(ref.evidenceId) || (item.evidence || []).find(e=>e.id===ref.evidenceId) || {},ref)))
    }));
  }
  function stageLanes(rows) {
    const lanes = [
      {id:'upstream',label:'上游 · 材料与设备',stages:['materials','equipment']},
      {id:'midstream',label:'中游 · 器件与制造',stages:['components','manufacturing']},
      {id:'downstream',label:'下游 · 应用',stages:['applications']}
    ].map(lane => Object.assign(lane,{rows:rows.filter(row=>lane.stages.includes(row.stage))}));
    const unknown = rows.filter(row=>!STAGES[row.stage]);
    if (unknown.length) lanes.push({id:'unclassified',label:'环节待核验',rows:unknown});
    return lanes;
  }
  function creatorRows(data) {
    return (data?.relations || []).map(item => ({ ...item, company:item.from, product:item.to, code:'',
      status:'author_claim', observedAt:item.publishedAt, claim:item.relation + (item.polarity==='contradicts'?' · 相反/否定观点':'') + (item.uncertainty?' · '+item.uncertainty:''),
      original:item, evidence:groupEvidence([{...item,source:item.author+' · 视频/图文原稿',contentSha256:item.bodyHash}]) }));
  }
  function creatorReviewRows(data) {
    return (data?.reviewQueue || []).slice().sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
  }
  function directoryEntries(catalog,topics,creators) {
    return (creators || []).map(item=>({key:'creator:'+item.id,id:item.id,name:item.displayName+' · 文稿关系',kind:'creator'}))
      .concat((catalog || []).map(item=>({key:'chain:'+item.id,id:item.id,name:item.name,kind:'chain'})))
      .concat((topics || []).map(item=>({key:'research:'+item.id,id:item.id,name:item.name,kind:'research',enabled:item.enabled})));
  }
  const state = {mounted:false,catalog:[],topics:[],creators:[],entry:null,view:'graph',rows:[],selected:'',document:null,creatorChart:null,detail:null,result:null,loading:false,error:'',stage:'',management:false,sequence:0,drafts:new Map()};
  const el = id => root?.document.getElementById(id);
  const time = value => {
    if (!value) return '时间未提供';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  };
  function mount(host) {
    if (!host || state.mounted) return;
    const take = selector => host.querySelector(selector);
    const nodes = {
      search:take('.industry-chain-search'), refresh:take('#refreshIndustryChainBtn'),
      urls:take('#industryResearchSourceUrls'), proposal:take('.industry-research-json-details'),
      actions:take('.industry-research-actions'), file:take('.industry-chain-import'),
      radar:take('.industry-concept-radar'), external:take('#externalIndustryChainResearch')
    };
    host.classList.add('industry-workspace');
    host.innerHTML = '<header class="iw-heading"><strong>产业链研究</strong><span id="iwContext">选择主题后查看关系与证据</span><div id="iwActions"></div><button type="button" data-iw-action="manage">资料管理</button><button type="button" data-iw-view="radar">概念发现</button><button type="button" data-iw-view="external">外部研究</button></header>' +
      '<aside class="iw-directory"><header><strong>研究主题</strong><span id="iwDirectoryCount"></span></header><input id="iwDirectorySearch" aria-label="筛选研究主题" placeholder="搜索主题"><nav id="iwDirectory" aria-label="研究主题目录"></nav></aside>' +
      '<section id="industryResearchPanel" class="iw-workspace"><div class="iw-toolbar"><nav aria-label="主题视图"><button type="button" data-iw-view="graph">关系图</button><button type="button" data-iw-view="table">公司清单</button><button type="button" data-iw-view="review">待核验</button></nav><span id="iwCount"></span><select id="iwStage" aria-label="筛选产业链环节"><option value="">全部环节</option>' + Object.entries(STAGES).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('') + '<option value="unknown">环节待核验</option></select></div>' +
      '<div class="iw-query" id="iwSearch"></div><div class="iw-status" id="industryResearchStatus" role="status"></div>' +
      '<div id="industryResearchDetail" class="iw-body"><main id="iwContent" aria-label="主题关系与公司"></main><aside class="iw-reader" aria-label="选中项原文与证据"><header><strong id="iwReaderTitle">原文与证据</strong><button type="button" data-iw-action="close-manage" id="iwCloseManage" hidden>返回证据</button></header><div id="iwEvidence"></div><div id="iwManagement" hidden><p id="iwManagementHint"></p><div id="iwManagementFields"><label for="industryResearchSourceUrls">来源地址 · 每行一个 HTTPS 地址</label></div><div id="iwImport"></div></div></aside></div>' +
      '<section id="iwAuxiliary" hidden><div id="iwRadar" hidden></div><div id="iwExternal" hidden></div></section>' +
      '<footer id="iwFooter"></footer></section>';
    function place(id,node) { if (node) el(id).appendChild(node); }
    place('iwActions',nodes.refresh); place('iwSearch',nodes.search);
    place('iwManagementFields',nodes.urls); place('iwManagementFields',nodes.actions); place('iwManagementFields',nodes.proposal);
    place('iwImport',nodes.file); place('iwRadar',nodes.radar); place('iwExternal',nodes.external);
    state.mounted = true;
    host.addEventListener('click',event=>{
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.iwEntry) selectEntry(button.dataset.iwEntry).catch(showError);
      else if (button.dataset.iwRow) selectRow(button.dataset.iwRow);
      else if (button.dataset.iwObservation) selectObservation(button.dataset.iwObservation).catch(showError);
      else if (button.dataset.iwView) setView(button.dataset.iwView);
      else if (button.dataset.iwAction) {
        if (button.dataset.iwAction === 'analyze-creator') {
          const key = state.entry.key;
          button.disabled = true;
          root.apiFetch('/api/industry-chain/creators/'+state.entry.id+'/analyze',{method:'POST'}).then(result=>{
            if (state.entry?.key !== key) return;
            if (result.status==='ai_not_configured') showError(new Error('未配置 AI 接口；已有分析仍可查看，请在设置配置后启用自动分析。'));
            else if (result.status==='queued') el('industryResearchStatus').textContent='已交给后台分析，可以切换页面；稍后刷新查看关系与处理状态。';
            else selectEntry(key).catch(showError);
          }).catch(showError).finally(()=>{button.disabled=false;}); return;
        }
        if (button.dataset.iwAction === 'retry') { (state.entry ? selectEntry(state.entry.key) : root.IndustryChain.load()).catch(showError);return; }
        if (button.dataset.iwAction === 'unclassified') { state.stage='unknown';el('iwStage').value='unknown';setView('review');return; }
        if (state.view==='radar' || state.view==='external') setView('graph');
        state.management = button.dataset.iwAction === 'manage'; renderReader();
      }
    });
    el('iwDirectorySearch').addEventListener('input',renderDirectory);
    el('iwStage').addEventListener('change',event=>{state.stage=event.target.value;renderCenter();renderReader();});
    root.addEventListener('resize',()=>state.creatorChart?.resize());
    renderDirectory(); renderCenter(); renderReader();
  }
  function setCatalog(catalog) { state.catalog=catalog; if(state.mounted) renderDirectory(); }
  function setTopics(topics) { state.topics=topics; if(state.mounted) renderDirectory(); }
  function renderDirectory() {
    const entries=directoryEntries(state.catalog,state.topics,state.creators);
    const query=el('iwDirectorySearch').value.trim().toLowerCase();
    el('iwDirectoryCount').textContent=entries.length;
    el('iwDirectory').innerHTML=entries.filter(e=>e.name.toLowerCase().includes(query)).map(e=>
      '<button type="button" data-iw-entry="'+escape(e.key)+'" aria-pressed="'+(state.entry?.key===e.key)+'"><strong>'+escape(e.name)+'</strong><small>'+ (e.kind==='creator'?'作者文稿 · 按发布日期更新':e.kind==='chain'?'行业线索':e.enabled?'原文研究 · 自动更新':'原文研究 · 手动更新')+'</small></button>').join('') || '<p class="iw-empty">没有匹配主题</p>';
  }
  function rememberDraft() {
    if (state.entry?.kind !== 'research' || state.loading || state.error) return;
    const fields=['industryResearchSourceUrls','industryResearchProposalInput','industryResearchInterval','industryResearchEnabled','industryResearchUseAi'];
    state.drafts.set(state.entry.key,fields.map(id=>({id,value:el(id)?.value,checked:el(id)?.checked})));
  }
  async function selectEntry(key) {
    const entry=directoryEntries(state.catalog,state.topics,state.creators).find(e=>e.key===key);
    if (!entry) return;
    rememberDraft();
    const sequence=++state.sequence;
    root.IndustryChain.cancelPendingSelection();
    state.entry=entry;state.rows=[];state.selected='';state.document=null;state.detail=null;state.result=null;state.loading=true;state.error='';state.stage='';
    if (state.view==='radar' || state.view==='external') state.view='graph';
    el('iwStage').value='';
    el('industryResearchStatus').textContent='正在读取 '+entry.name+'…';
    renderDirectory();renderCenter();renderReader();
    try {
      if (entry.kind==='creator') {
        const data=await root.apiFetch('/api/industry-chain/creators/'+entry.id);
        if(sequence!==state.sequence) return;
        state.detail=data;state.rows=creatorRows(data);state.selected=state.rows[0]?.key || '';state.loading=false;
        el('industryResearchStatus').textContent='新流程已分析 '+data.analyzedCount+' / 可提取候选文稿 '+data.readyCount+' / 待复核 '+data.blockedCount+' / 作品 '+data.totalCount+'；旧记录 '+data.legacyCount+' 篇保留待重审；'+(data.aiConfigured?'AI 接口已配置': 'AI 接口未配置，自动分析待配置')+(data.lastRun?'；'+({running:'后台分析中',failed:'上次分析失败，原文与已有关系保留',complete:'上次分析完成',idle:'本轮没有待处理正文',stopped:'分析已停止',ai_not_configured:'等待配置AI'}[data.lastRun.status] || data.lastRun.status):'');
      }
      else if (entry.kind==='research') await root.IndustryChain.selectResearchTopic(entry.id);
      else {
        root.IndustryChain.setSelection(entry.id,'');
        await root.IndustryChain.discover('');
      }
      if (sequence!==state.sequence) return;
      el('iwStage').innerHTML=entry.kind==='creator'?'<option value="">全部文稿主题</option>'+Array.from(new Set(state.rows.map(row=>row.topic))).map(topic=>'<option value="'+escape(topic)+'">'+escape(topic)+'</option>').join(''):'<option value="">全部环节</option>'+Object.entries(STAGES).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'<option value="unknown">环节待核验</option>';
      if(entry.kind==='creator') {renderCenter();renderReader();}
      const draft=state.drafts.get(entry.key);
      if(draft) draft.forEach(field=>{ if(el(field.id)) {el(field.id).value=field.value;el(field.id).checked=field.checked;} });
      // setResult/setDetail already painted the accepted response. A second paint
      // here would close evidence/history just opened while the promise settled.
      state.loading=false;
    } catch(error) { if(sequence===state.sequence) {state.loading=false;state.error=error?.message || '读取失败';el('industryResearchPanel').setAttribute('aria-busy','false');showError(error);renderCenter();renderReader();throw error;} }
  }
  function setResult(result) {
    if (!state.mounted || state.entry?.kind!=='chain') return;
    state.result=result;state.rows=classificationRows(result);state.loading=false;
    state.error=result.availability==='unavailable'?'资料读取失败，请刷新重试':'';
    if (!state.rows.some(row=>row.key===state.selected)) state.selected=state.rows[0]?.key || '';
    el('industryResearchStatus').textContent=result.availability==='unavailable'?'资料读取失败，请重试':result.availability==='degraded'?'部分来源暂不可用，保留可用线索':'资料匹配与人工核验分开显示';
    renderCenter();renderReader();
  }
  function setDetail(detail) {
    if (!state.mounted || state.entry?.kind!=='research') return;
    state.detail=detail;state.loading=false;state.error='';state.rows=researchRows(detail?.currentVersion);
    if(!state.rows.some(row=>row.key===state.selected)) state.selected=state.rows[0]?.key || '';
    renderCenter();renderReader();
  }
  function showError(error) { if(el('industryResearchStatus')) el('industryResearchStatus').textContent=error?.message || '读取失败，请重试'; }
  function setLoadError(error) {
    if(!state.mounted) return;
    state.loading=false;state.error=error?.message || '目录读取失败';
    showError(error);renderCenter();renderReader();
  }
  function visibleRows() {
    return state.rows.filter(row=>(!state.stage || (state.entry?.kind==='creator'?row.topic===state.stage:state.stage==='unknown'?!STAGES[row.stage]:row.stage===state.stage)) && (state.view!=='review' || row.status!=='verified'));
  }
  function setView(view) {
    state.view=view;renderCenter();renderReader();
    if (view==='radar') root.IndustryChain.loadConceptDiscovery().catch(showError);
    if (view==='external' && root.ExternalResearch) root.ExternalResearch.load().catch(showError);
  }
  function rowButton(row) {
    return '<button type="button" class="iw-node" data-iw-row="'+escape(row.key)+'" aria-pressed="'+(state.selected===row.key)+'"><strong>'+escape(row.product || row.company)+'</strong><span>'+escape(row.product ? row.company : row.code || '证券未绑定')+'</span><small>'+escape(STAGES[row.stage] || '环节待核验')+'</small><em class="iw-state '+row.status+'">'+STATUS[row.status]+'</em></button>';
  }
  function renderCenter() {
    if(!state.mounted) return;
    if(state.creatorChart) {state.creatorChart.dispose();state.creatorChart=null;}
    const auxiliary=['radar','external'].includes(state.view);
    el('industryResearchDetail').hidden=auxiliary;el('iwAuxiliary').hidden=!auxiliary;
    el('iwRadar').hidden=state.view!=='radar';el('iwExternal').hidden=state.view!=='external';
    el('industryChainView').querySelectorAll('[data-iw-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.iwView===state.view)));
    el('iwContext').textContent=state.entry?.name || '选择主题';
    el('industryChainView').querySelector('[data-iw-view="table"]').textContent=state.entry?.kind==='creator'?'关系列表':'公司清单';
    el('industryChainView').querySelector('[data-iw-view="review"]').textContent=state.entry?.kind==='creator'?'文稿状态':'待核验';
    el('iwStage').hidden=state.entry?.kind==='creator' && state.view==='review';
    el('iwSearch').hidden=state.entry?.kind!=='chain' || auxiliary;
    const rows=visibleRows();
    el('iwContent').classList.toggle('iw-graph-mode',state.view==='graph' && rows.length>0);
    el('iwCount').textContent=state.entry?.kind==='creator' && state.view==='review' ? creatorReviewRows(state.detail).length+' 篇文稿' : rows.length+' 条 / 已载入 '+state.rows.length+' 条';
    if(state.selected && !rows.some(row=>row.key===state.selected)) state.selected=rows[0]?.key || '';
    const version=state.detail?.currentVersion;
    const cover=state.result?.coverage;
    el('iwFooter').textContent=state.entry?.kind==='research'
      ? (version?'研究版本 '+version.sequence+' · '+time(version.createdAt):'尚未形成研究版本 · 已登记来源 '+(state.detail?.topic?.sourceUrls || []).length+' 个')
      : '来源：本地资料归类 · '+(cover?.truncated?'匹配 '+(state.result.confirmed || []).length+'/'+cover.totalConfirmedRelationCount+' · 候选 '+(state.result.candidates || []).length+'/'+cover.totalCandidateRelationCount+' · 可缩小关键词范围 · ':'')+time(state.result?.generatedAt);
    if(state.entry?.kind==='creator') el('iwFooter').textContent='按视频/图文发布日期倒序；保留旧观点与相反证据。关系均可定位原文，尚未外部核验。';
    if(state.error) {
      el('iwCount').textContent='读取未完成';el('iwFooter').textContent='当前主题数据状态未确认';
      el('iwContent').innerHTML='<div class="iw-empty"><h3>读取失败，请重试</h3><p>'+escape(state.error)+'</p><button type="button" data-iw-action="retry">重新读取主题</button></div>';return;
    }
    if(state.loading) {el('iwContent').innerHTML='<div class="iw-empty">正在读取当前主题…</div>';return;}
    if(state.entry?.kind==='creator' && state.view==='review') {
      const documents=creatorReviewRows(state.detail);
      el('iwContent').innerHTML=documents.length?'<table class="iw-table"><thead><tr><th>作品 / 日期</th><th>媒介</th><th>准入状态</th></tr></thead><tbody>'+documents.map(item=>'<tr><td><button type="button" data-iw-observation="'+escape(item.observationId)+'"><strong>'+escape(item.title || '未命名作品')+'</strong><small>'+escape(time(item.publishedAt))+'</small></button></td><td>'+escape(item.mediaType==='note'?'图文':'视频')+'</td><td>'+escape(CREATOR_STATUS[item.status] || item.status)+'</td></tr>').join('')+'</tbody></table>':'<div class="iw-empty">尚无已采集作品</div>';
    } else if(state.entry?.kind==='creator' && state.view!=='graph' && rows.length) {
      el('iwContent').innerHTML='<table class="iw-table"><thead><tr><th>实体关系</th><th>主题</th><th>发布日期</th><th>状态</th></tr></thead><tbody>'+rows.map(row=>'<tr data-iw-selected="'+(row.key===state.selected)+'"><td><button type="button" data-iw-row="'+escape(row.key)+'"><strong>'+escape(row.from)+' → '+escape(row.to)+'</strong><small>'+escape(row.relation)+'</small></button></td><td>'+escape(row.topic)+'</td><td>'+escape(time(row.publishedAt))+'</td><td>'+escape(row.polarity==='contradicts'?'相反观点':'作者观点')+'</td></tr>').join('')+'</tbody></table>';
    } else if(state.entry?.kind==='creator') {
      el('iwContent').innerHTML='<div class="iw-graph-caption">作者观点候选关系 · 拖动节点、滚轮缩放；点击实体或关系线查看原文。实体不等于公司，也不代表供货或产业地位。 <button type="button" data-iw-action="analyze-creator">分析下一篇文稿</button></div>'+
        (rows.length?'<div id="iwCreatorGraph" class="iw-creator-graph" role="img" aria-label="作者文稿候选关系图"></div>':'<div class="iw-empty">尚无新流程关系。已分析 '+(state.detail?.analyzedCount || 0)+' 篇；可提取候选文稿 '+(state.detail?.readyCount || 0)+' 篇；旧记录 '+(state.detail?.legacyCount || 0)+' 篇待重审。可切换“文稿状态”查看原因。</div>');
      if(rows.length && root.echarts && root.IndustryResearchGraph) {
        const graph=root.IndustryResearchGraph.buildCreatorGraph(rows);
        el('iwCreatorGraph').style.height=Math.min(graph.height,4800)+'px';
        state.creatorChart=root.echarts.init(el('iwCreatorGraph'));
        state.creatorChart.setOption({animation:false,tooltip:{trigger:'item',formatter:params=>escape(params.data?.name || params.data?.label?.formatter || '')},
          series:[{type:'graph',layout:'none',roam:true,draggable:true,symbol:'roundRect',edgeSymbol:['none','arrow'],edgeSymbolSize:8,
            data:graph.nodes,links:graph.links,label:{show:true,color:'#fff',fontSize:11,overflow:'truncate',width:145},
            lineStyle:{color:'#8aa1bb',width:1.3},edgeLabel:{show:true,color:'#596e83',fontSize:10},emphasis:{focus:'adjacency'}}]});
        state.creatorChart.on('click',event=>{if(event.data?.relationKey) selectRow(event.data.relationKey);});
        if(graph.shown<graph.total) el('iwCount').textContent+=' · 图中显示前 '+graph.shown+' 条，筛选主题可继续查看';
      } else if(rows.length) el('iwCreatorGraph').textContent='关系图暂不可用，请切换关系列表查看原文。';
    } else if(!rows.length) {
      const emptyResearch=state.entry?.kind==='research' && !version;
      el('iwContent').innerHTML='<div class="iw-empty"><h3>'+ (emptyResearch?'还没有可绘制的研究关系':state.view==='review'?'当前没有待核验项':'当前范围没有关系记录')+'</h3><p>'+(emptyResearch?'登记可信来源 → 保存配置 → 取证更新 → 查看版本与关系':'可以切换主题、调整筛选或刷新资料。')+'</p>'+(emptyResearch?'<button type="button" data-iw-action="manage">登记来源</button>':'')+'</div>';
    } else if(state.view==='graph') {
      const lanes=stageLanes(rows),unknown=lanes.find(lane=>lane.id==='unclassified');
      const displayed=state.stage==='unknown'?lanes.filter(lane=>lane.id==='unclassified'):lanes.filter(lane=>lane.id!=='unclassified');
      el('iwContent').innerHTML='<div class="iw-graph-caption">环节归属图 · 当前数据未提供公司间供货边'+(unknown && state.stage!=='unknown'?'<button type="button" data-iw-action="unclassified">'+unknown.rows.length+' 条环节待核验 →</button>':'')+'</div><div class="iw-lanes">'+displayed.map(lane=>'<section class="iw-lane"><header>'+lane.label+' <small>'+lane.rows.length+'</small></header><div>'+ (lane.rows.map(rowButton).join('') || '<p class="iw-empty">暂无关系记录</p>')+'</div></section>').join('')+'</div>';
    } else {
      el('iwContent').innerHTML='<table class="iw-table"><thead><tr><th>公司 / 产品</th><th>环节</th><th>状态</th><th>来源</th></tr></thead><tbody>'+rows.map(row=>'<tr data-iw-selected="'+(row.key===state.selected)+'"><td><button type="button" data-iw-row="'+escape(row.key)+'"><strong>'+escape(row.company)+'</strong><small>'+escape([row.code,row.product].filter(Boolean).join(' · '))+'</small></button></td><td>'+escape(STAGES[row.stage] || '环节待核验')+'</td><td><span class="iw-state '+row.status+'">'+STATUS[row.status]+'</span></td><td>'+row.evidence.length+'</td></tr>').join('')+'</tbody></table>';
    }
  }
  function selectRow(key) {
    if(!state.rows.some(row=>row.key===key)) return;
    state.selected=key;state.document=null;state.management=false;
    // Do not rebuild the graph/list on evidence selection: scroll and focus stay put.
    el('iwContent').querySelectorAll('[data-iw-row]').forEach(button=>{
      const selected=button.dataset.iwRow===key;button.setAttribute('aria-pressed',String(selected));
      const row=button.closest('tr');if(row) row.dataset.iwSelected=String(selected);
    });
    renderReader();
  }
  async function selectObservation(observationId) {
    if(state.entry?.kind!=='creator') return;
    const sequence=state.sequence, channelId=state.entry.id;
    state.selected='';state.document=null;
    el('iwEvidence').innerHTML='<div class="iw-empty">正在读取完整原文…</div>';
    try {
      const document=await root.apiFetch('/api/industry-chain/creators/'+channelId+'/observations/'+encodeURIComponent(observationId));
      if(sequence!==state.sequence || state.entry?.id!==channelId) return;
      state.document=document;renderReader();
    } catch(error) {
      if(sequence!==state.sequence) return;
      el('iwEvidence').innerHTML='<div class="iw-empty">文稿读取失败，请重试。</div>';
      throw error;
    }
  }
  function sourceHtml(group) {
    const excerpts=new Map();
    group.fragments.forEach(fragment=>{
      const kind=fragment.quote?'原文片段':fragment.matchReason?'匹配依据':'来源摘要';
      const text=fragment.quote || fragment.matchReason || fragment.snippet || '未提供可定位片段';
      excerpts.set(kind+'|'+text,{kind,text});
    });
    const first=group.fragments[0] || {};
    const title=group.title.replace(/^\[原始来源\s*\/\s*本人公开\]\s*/,'').replace(/\s*#[^#]+/g,'').trim() || '原文证据';
    return '<details class="iw-source" open><summary><strong>'+escape(title)+'</strong><small>'+group.fragments.length+' 条引用 · '+excerpts.size+' 个不同片段</small></summary>'+Array.from(excerpts.values()).map(item=>'<small>'+item.kind+'</small><blockquote>'+escape(item.text)+'</blockquote>').join('')+
      '<small>'+escape(first.source || first.sourceType || '原文来源')+' · '+escape(time(first.publishedAt || first.observedAt))+'</small>'+
      '<details><summary>完整来源与引用详情</summary><p>'+escape(group.title)+'</p>'+group.fragments.map(fragment=>'<p>证据：'+escape(fragment.evidenceId || fragment.id || '未提供')+'<br>发布：'+escape(time(fragment.publishedAt || fragment.observedAt))+'<br>取回：'+escape(time(fragment.fetchedAt))+'<br>哈希：'+escape(fragment.contentSha256 || '未提供')+'</p>').join('')+
      (group.url?'<a href="'+escape(group.url)+'" target="_blank" rel="noopener noreferrer">打开来源原文 ↗</a>':'<p>未提供可用原文地址</p>')+'</details></details>';
  }
  function renderReader() {
    if(!state.mounted) return;
    el('iwEvidence').hidden=state.management;el('iwManagement').hidden=!state.management;el('iwCloseManage').hidden=!state.management;
    el('iwReaderTitle').textContent=state.management?'资料管理':'原文与证据';
    const research=state.entry?.kind==='research';
    el('iwManagementFields').hidden=!research;
    el('iwManagementFields').querySelectorAll('input,textarea,button').forEach(control=>{control.disabled=state.loading || !research || !state.detail?.topic;});
    el('iwManagementHint').textContent=research?'当前主题：'+state.entry.name+'。仅点击保存或取证更新才会提交。':'行业线索来自现有资料归类；选择“原文研究”主题可登记来源。也可从概念发现加入研究。';
    if(state.entry?.kind==='creator' && state.document) {
      const document=state.document;
      const url=safeUrl(document.sourceUrl);
      el('iwEvidence').innerHTML='<h3>'+escape(document.title || '完整文稿')+'</h3><p>'+escape(CREATOR_STATUS[document.status] || document.status)+' · '+escape(time(document.publishedAt))+'</p><p>文稿哈希：'+escape(document.bodyHash)+'</p>'+
        (document.asr?'<p>转写：'+escape(document.asr.model || '模型未记录')+' · '+escape(time(document.asr.transcribedAt))+'；自动转写不等于人工听校。</p>':'')+
        (url?'<p><a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">打开作品原页 ↗</a></p>':'')+
        '<pre class="iw-full-transcript">'+escape(document.transcript || '暂无可读正文')+'</pre>';
      return;
    }
    if(state.error) {el('iwEvidence').innerHTML='<div class="iw-empty">资料尚未读入，暂不能核对证据。</div>';el('iwManagementHint').textContent='当前主题读取失败，请重新读取后编辑来源。';return;}
    const row=state.rows.find(item=>item.key===state.selected);
    const version=state.detail?.currentVersion;
    const versions=state.detail?.versions || [];
    const history=research?'<details class="iw-history"><summary>版本与资料记录</summary>'+(versions.length?'<label>历史版本 <select id="industryResearchVersionSelect">'+versions.map(v=>'<option value="'+escape(v.id)+'"'+(v.id===version?.id?' selected':'')+'>V'+escape(v.sequence)+' · '+escape(time(v.createdAt))+'</option>').join('')+'</select></label>':'<p>暂无历史版本</p>')+
      '<p>自动更新：'+(state.detail?.topic?.enabled?'开启':'关闭')+'</p><p>最近运行：'+escape(state.detail?.lastRun?.status || '未运行')+'</p>'+
      (state.detail?.lastRun?.errors || []).map(error=>'<p>'+escape(error.code || 'RUN_FAILED')+'</p>').join('')+
      (version?.changes?'<p>版本变化：新增 '+(version.changes.added || []).length+' · 变更 '+(version.changes.changed || []).length+' · 争议 '+(version.changes.disputed || []).length+'</p>':'')+
      (version?.analysis?'<details><summary>独立 AI 分析</summary><p>'+escape(version.analysis.kind==='ai_inference'?version.analysis.text || '候选推断':version.analysis.status==='failed'?'未完成，已保留原文证据':'未启用')+'</p></details>':'')+
      (version?.gaps || []).map(g=>'<p>'+escape(typeof g==='string'?g:g.reason || g.kind)+'</p>').join('')+
      groupEvidence(version?.evidence).map(sourceHtml).join('')+'</details>':'';
    if(!row) {el('iwEvidence').innerHTML='<div class="iw-empty">'+(state.loading?'正在读取当前主题…':'选择节点或公司后查看证据')+'</div>'+history;return;}
    const original=row.original;
    const review=research && ['candidate','verified'].includes(row.status)?'<div class="industry-research-review"><label><input type="checkbox" data-research-read="'+escape(row.key)+'"> 我已阅读原文</label><textarea data-research-note="'+escape(row.key)+'" aria-label="核验说明" placeholder="核验说明（必填）"></textarea>'+(row.status==='candidate'?'<button type="button" data-research-review="'+escape(row.key)+'" data-research-decision="verify">通过核验</button>':'')+'<button type="button" data-research-review="'+escape(row.key)+'" data-research-decision="dispute">标记争议</button></div>':'';
    const metrics=(original.metrics || []).map(m=>'<p>'+escape(m.name)+'：'+escape(m.value==null?'待补充':m.value)+' '+escape(m.unit || '')+' · '+escape(m.scope || '范围未提供')+'</p>').join('');
    el('iwEvidence').innerHTML='<h3>'+escape(state.entry?.kind==='creator'?row.from+' → '+row.to:row.product || row.company)+'</h3><p>'+escape(state.entry?.kind==='creator'?row.author:row.company+' '+row.code)+'</p><span class="iw-state '+row.status+'">'+STATUS[row.status]+'</span><p>'+escape(state.entry?.kind==='creator'?row.topic:STAGES[row.stage] || '环节待核验')+' · '+escape(time(row.observedAt))+'</p>'+
      (row.claim?'<p>'+escape(row.claim)+'</p>':'')+metrics+
      (row.reason?'<p>'+escape(root.IndustryChain.reasonLabel(row.reason))+'</p>':'')+
      (row.evidence.length?row.evidence.map(sourceHtml).join(''):'<p class="iw-empty">尚无可定位原文</p>')+
      (state.entry?.kind==='creator'?'<button type="button" data-iw-observation="'+escape(row.observationId)+'">查看完整文稿与转写状态</button>':'')+
      (original.review?'<p>核验记录：'+escape(original.review.note)+' · '+escape(time(original.review.reviewedAt))+' · '+(original.review.source==='imported_review'?'导入核验，仅作审计':original.review.source==='local_manual'?'本机人工核验':'人工核验')+'</p>':'')+review+history+
      (!research?'<details><summary>来源覆盖与缺口</summary>'+['stockMetadata','knowledge','news'].map(k=>{const s=state.result?.sourceMeta?.[k];return s?'<p>'+escape(({stockMetadata:'股票资料',knowledge:'本地研究',news:'公开资讯'})[k])+'：'+escape(({available:'可用',degraded:'部分可用',empty:'暂无资料',fallback:'本地缓存',unavailable:'暂不可用'})[s.status] || '状态未知')+' · '+escape(s.count)+' 条</p>':'';}).join('')+(state.result?.dataGaps || []).map(g=>'<p>'+escape(g)+'</p>').join('')+'</details>':'');
  }
  async function loadSelected() {
    try {state.creators=(await root.apiFetch('/api/expert/channels')).filter(item=>item.platform==='douyin');renderDirectory();}
    catch(error) {showError(new Error('作者目录读取失败；原研究目录仍可使用。'));}
    const entries=directoryEntries(state.catalog,state.topics,state.creators);
    const key=state.entry?.key || entries.find(e=>e.name===el('industryChainSearchInput')?.value)?.key || entries[0]?.key;
    if(key) await selectEntry(key);
  }
  return {classificationRows,researchRows,creatorRows,creatorReviewRows,groupEvidence,stageLanes,directoryEntries,mount,setCatalog,setTopics,setResult,setDetail,setLoadError,loadSelected,
    isMounted:()=>state.mounted, selectedKind:()=>state.entry?.kind,selectEntry};
});
