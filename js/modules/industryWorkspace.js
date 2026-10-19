/* One selection drives the diagram, company table and original evidence reader. */
(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IndustryWorkspace = api;
})(typeof window === 'undefined' ? null : window, function(root) {
  const STAGES = {materials:'原材料与耗材',equipment:'生产与检测设备',components:'核心器件与零部件',manufacturing:'制造、封装与集成',applications:'下游应用'};
  const STATUS = {matched:'资料匹配 · 待核验',candidate:'待核验',verified:'人工核验',disputed:'有争议',author_claim:'作者观点 · AI提取'};
  const REVIEW_STATUS = {missing_text:'缺少可用正文',note_ocr_required:'图文正文待识别/核验',suspected_prompt_echo:'疑似提示词污染',asr_review_required:'转写待复核',pending:'待分析',legacy:'旧规则待重审',complete_with_relations:'已分析 · 有关系',complete_empty:'已分析 · 无产业关系'};
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => /^https?:\/\/[^\s]+$/i.test(String(value || '').trim()) ? String(value).trim() : '';
  const countLabel = (value,unit='篇') => Number.isSafeInteger(value) && value>=0 ? value+' '+unit : '未提供';
  const creatorCounts = data => '历史已分析 '+countLabel(data?.historicalAnalyzedCount)+' / 当前合格 '+countLabel(data?.currentAnalyzedCount)+
    ' / 已有正文 '+countLabel(data?.readyCount)+' / 质检准入 '+countLabel(data?.eligibleCount);
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
  function directoryEntries(catalog,topics,creators) {
    return (creators || []).map(item=>({key:'creator:'+item.id,id:item.id,name:item.displayName+' · 文稿关系',kind:'creator'}))
      .concat((catalog || []).map(item=>({key:'chain:'+item.id,id:item.id,name:item.name,kind:'chain'})))
      .concat((topics || []).map(item=>({key:'research:'+item.id,id:item.id,name:item.name,kind:'research',enabled:item.enabled})));
  }
  const state = {mounted:false,catalog:[],topics:[],creators:[],entry:null,view:'graph',rows:[],selected:'',graphFocus:'',document:null,documentLoading:false,detail:null,result:null,loading:false,error:'',stage:'',management:false,sequence:0,drafts:new Map()};
  let creatorChart = null;
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
      '<section id="industryResearchPanel" class="iw-workspace"><div class="iw-toolbar"><nav aria-label="主题视图"><button type="button" data-iw-view="graph">关系图</button><button type="button" data-iw-view="table">公司清单</button><button type="button" data-iw-view="review">待核验</button><button type="button" data-iw-view="quality" hidden>文稿质检</button></nav><span id="iwCount"></span><select id="iwStage" aria-label="筛选产业链环节"><option value="">全部环节</option>' + Object.entries(STAGES).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('') + '<option value="unknown">环节待核验</option></select></div>' +
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
      else if (button.dataset.iwDocument) selectDocument(button.dataset.iwDocument).catch(showError);
      else if (button.dataset.iwRow) selectRow(button.dataset.iwRow);
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
        if (button.dataset.iwAction === 'focus-creator') { state.graphFocus=el('iwGraphFocus')?.value.trim() || '';renderCenter();return; }
        if (button.dataset.iwAction === 'unclassified') { state.stage='unknown';el('iwStage').value='unknown';setView('review');return; }
        if (state.view==='radar' || state.view==='external') setView('graph');
        state.management = button.dataset.iwAction === 'manage'; renderReader();
      }
    });
    el('iwDirectorySearch').addEventListener('input',renderDirectory);
    el('iwStage').addEventListener('change',event=>{state.stage=event.target.value;renderCenter();renderReader();});
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
    state.entry=entry;state.rows=[];state.selected='';state.graphFocus='';state.document=null;state.detail=null;state.result=null;state.loading=true;state.error='';state.stage='';
    if (state.view==='radar' || state.view==='external' || (state.view==='quality' && entry.kind!=='creator')) state.view='graph';
    el('iwStage').value='';
    el('industryResearchStatus').textContent='正在读取 '+entry.name+'…';
    renderDirectory();renderCenter();renderReader();
    try {
      if (entry.kind==='creator') {
        const data=await root.apiFetch('/api/industry-chain/creators/'+entry.id);
        if(sequence!==state.sequence) return;
        state.detail=data;state.rows=creatorRows(data);state.selected=state.rows[0]?.key || '';state.graphFocus=state.rows[0]?.from || '';state.loading=false;
        const legacy=(data.documents || []).filter(item=>item.needsReanalysis).length;
        el('industryResearchStatus').textContent=creatorCounts(data)+' / 作品 '+countLabel(data.totalCount)+'；待重审或新增 '+countLabel(data.pendingCount)+'，文稿需复核 '+countLabel(data.blockedCount)+(legacy?'，旧规则结果 '+legacy+' 篇':'')+'；'+(data.aiConfigured?'AI 接口已配置': 'AI 接口未配置，自动分析待配置')+(data.lastRun?'；'+({running:'后台分析中',failed:'上次分析失败，原文与已有关系保留',complete:'上次分析完成',idle:'本轮没有可分析正文',stopped:'分析已停止',ai_not_configured:'等待配置AI'}[data.lastRun.status] || data.lastRun.status):'');
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
    if(creatorChart) {creatorChart.dispose();creatorChart=null;}
    const auxiliary=['radar','external'].includes(state.view);
    el('industryResearchDetail').hidden=auxiliary;el('iwAuxiliary').hidden=!auxiliary;
    el('iwRadar').hidden=state.view!=='radar';el('iwExternal').hidden=state.view!=='external';
    el('industryChainView').querySelectorAll('[data-iw-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.iwView===state.view)));
    el('industryChainView').querySelector('[data-iw-view="quality"]').hidden=state.entry?.kind!=='creator';
    el('iwContext').textContent=state.entry?.name || '选择主题';
    el('industryChainView').querySelector('[data-iw-view="table"]').textContent=state.entry?.kind==='creator'?'关系列表':'公司清单';
    el('iwSearch').hidden=state.entry?.kind!=='chain' || auxiliary;
    const rows=visibleRows();
    el('iwContent').classList.toggle('iw-graph-mode',state.view==='graph' && rows.length>0);
    el('iwCount').textContent=state.view==='quality' && state.entry?.kind==='creator'
      ? (state.detail?.reviewQueue || []).length+' 条作品' : rows.length+' 条 / 已载入 '+state.rows.length+' 条';
    el('iwStage').hidden=state.view==='quality';
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
    if(state.entry?.kind==='creator' && state.view==='quality') {
      const items=state.detail?.reviewQueue || [];
      const documents=new Map((state.detail?.documents || []).map(item=>[item.observationId,item]));
      el('iwContent').innerHTML='<div class="iw-graph-caption">逐作品文稿质量与提取状态 · 图文与视频分别看待；点击查看原文（只读）。历史分析记录仍保留；不符合当前准入的结果不进入图谱。</div>'+
        '<table class="iw-table"><thead><tr><th>作品</th><th>媒介 / 模型</th><th>正文</th><th>处理状态 / 图谱准入</th><th>发布日期</th></tr></thead><tbody>'+
        items.map(item=>{
          const document=documents.get(item.observationId);
          const admission=document?.currentEligible===true?'当前合格':document?.currentEligible===false?'暂不入图：'+(REVIEW_STATUS[document.exclusionReason] || document.exclusionReason || '原因未提供'):!document && item.currentRelationCount===0?'暂无当前正文分析':'图谱准入状态未提供';
          return '<tr data-iw-selected="'+(state.document?.observationId===item.observationId)+'"><td><button type="button" data-iw-document="'+escape(item.observationId)+'"><strong>'+escape(item.title || '未命名作品')+'</strong><small>#'+escape(item.observationId)+'</small></button></td><td>'+escape(item.mediaType==='video'?'视频':'图文')+'<small>'+escape(item.asrModel || '—')+'</small></td><td>'+escape(item.textLength)+' 字</td><td>'+escape(REVIEW_STATUS[item.status] || item.status)+'<small>'+escape(admission)+'</small><small>当前入图关系 '+countLabel(item.currentRelationCount,'条')+' / 当前正文留存关系 '+countLabel(item.relationCount,'条')+'</small></td><td>'+escape(time(item.publishedAt))+'</td></tr>';
        }).join('')+'</tbody></table>';
    } else if(state.entry?.kind==='creator' && state.view!=='graph' && rows.length) {
      el('iwContent').innerHTML='<table class="iw-table"><thead><tr><th>实体关系</th><th>主题</th><th>发布日期</th><th>状态</th></tr></thead><tbody>'+rows.map(row=>'<tr data-iw-selected="'+(row.key===state.selected)+'"><td><button type="button" data-iw-row="'+escape(row.key)+'"><strong>'+escape(row.from)+' → '+escape(row.to)+'</strong><small>'+escape(row.relation)+'</small></button></td><td>'+escape(row.topic)+'</td><td>'+escape(time(row.publishedAt))+'</td><td>'+escape(row.polarity==='contradicts'?'相反观点':'作者观点')+'</td></tr>').join('')+'</tbody></table>';
    } else if(state.entry?.kind==='creator') {
      const graph=root.IndustryResearchGraph?.buildCreatorGraph(rows,state.graphFocus);
      el('iwContent').innerHTML='<div class="iw-graph-caption"><span>作者观点局部关系图 · 连线可点证据，不代表公司供货已核验</span><button type="button" data-iw-action="analyze-creator">分析下一篇文稿</button></div>'+
        (rows.length?'<div class="iw-creator-controls"><label>定位实体 <input id="iwGraphFocus" aria-label="定位文稿中的实体" value="'+escape(graph?.focus || '')+'" list="iwGraphEntities"></label><datalist id="iwGraphEntities">'+Array.from(new Set(rows.flatMap(row=>[row.from,row.to]))).map(name=>'<option value="'+escape(name)+'"></option>').join('')+'</datalist><button type="button" data-iw-action="focus-creator">定位</button><small>拖动节点 · 滚轮缩放 · 点击连线看原文</small></div><div id="iwCreatorGraph" role="img" aria-label="作者观点关系图"></div><p class="iw-graph-coverage">当前焦点显示 '+(graph?.shown || 0)+' / '+(graph?.focusTotal || 0)+' 条相邻关系；当前筛选共有 '+rows.length+' 条。完整记录见关系列表。</p>':'<div class="iw-empty"><h3>当前筛选没有可绘制的合格关系</h3><p>'+creatorCounts(state.detail)+'。</p><p>历史分析记录与文稿仍保留。当前合格须正文一致、采用 V2 规则且通过文稿质检；不代表外部核验。当前合格作品也可能没有产业关系。</p><p>可切换主题筛选或查看文稿质检；正文变更、旧规则及质检待复核的结果暂不进入当前图。配置 AI 后可处理符合准入条件的文稿，也可导入带原文引用的分析。</p></div>');
      if(graph?.shown && root.echarts) {
        creatorChart=root.echarts.init(el('iwCreatorGraph'));
        creatorChart.setOption({animation:false,tooltip:{formatter:params=>params.dataType==='edge'?escape(params.data.value || '作者观点'):escape(params.data.name)},series:[{type:'graph',layout:'none',roam:true,draggable:true,edgeSymbol:['none','arrow'],edgeSymbolSize:[0,7],data:graph.nodes,links:graph.links,emphasis:{focus:'adjacency'}}]});
        creatorChart.on('click',params=>{if(params.dataType==='edge') selectRow(params.data.relationKey);else if(params.dataType==='node'){state.graphFocus=params.data.id;renderCenter();}});
      } else if(rows.length) el('iwCreatorGraph').textContent=graph?.shown?'关系图组件未加载，请切换关系列表。':'当前实体没有相邻关系，请定位其他实体或切换关系列表。';
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
    state.selected=key;state.management=false;
    // Do not rebuild the graph/list on evidence selection: scroll and focus stay put.
    el('iwContent').querySelectorAll('[data-iw-row]').forEach(button=>{
      const selected=button.dataset.iwRow===key;button.setAttribute('aria-pressed',String(selected));
      const row=button.closest('tr');if(row) row.dataset.iwSelected=String(selected);
    });
    renderReader();
  }
  async function selectDocument(id) {
    if(state.entry?.kind!=='creator') return;
    const entryKey=state.entry.key, sequence=state.sequence;
    state.document=null;state.documentLoading=true;renderReader();
    try {
      const document=await root.apiFetch('/api/industry-chain/creators/'+state.entry.id+'/observations/'+encodeURIComponent(id));
      if(state.entry?.key!==entryKey || state.sequence!==sequence) return;
      state.document=document;state.documentLoading=false;renderCenter();renderReader();
    } catch(error) {state.documentLoading=false;renderReader();throw error;}
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
    if(state.error) {el('iwEvidence').innerHTML='<div class="iw-empty">资料尚未读入，暂不能核对证据。</div>';el('iwManagementHint').textContent='当前主题读取失败，请重新读取后编辑来源。';return;}
    if(state.entry?.kind==='creator' && state.view==='quality' && !state.management) {
      const document=state.document;
      const documentState=document?.documentState, asr=document?.asr || {}, isNote=document?.mediaType==='note';
      const qualityReasons=documentState?documentState.qualityReasons:!isNote?asr.quality?.reasons:null;
      const reasons=Array.isArray(qualityReasons)?qualityReasons.filter(reason=>typeof reason==='string').map(reason=>
        ({prompt_echo:'疑似提示词污染',timestamp_out_of_range:'时间片段超出音频范围'}[reason] || reason)):[];
      const extraction=({complete:'已完成',partial:'部分完成',empty:'无正文',error:'提取失败',missing:'提取记录缺失'}[documentState?.extraction] || documentState?.extraction || '未提供');
      const machineQuality=({review_required:'待复核',pass:'自动质检未标异常',not_evaluated:'尚未评估'}[documentState?.machineQuality] || documentState?.machineQuality || '未提供');
      const blockReason=documentState?.analysisBlockReason;
      const analysis=blockReason?'分析阻断：'+(REVIEW_STATUS[blockReason] || (blockReason==='text_too_short'?'正文过短，未达到分析门槛':blockReason)):
        documentState?.eligibleForAnalysis===true?'分析准入：可进入自动分析；不代表关系已核验':documentState?.eligibleForAnalysis===false?'分析准入：暂不允许；阻断原因未提供':'分析准入：未提供';
      const segments=!isNote && Array.isArray(asr.segments)?asr.segments.filter(segment=>segment && typeof segment==='object'):[];
      el('iwReaderTitle').textContent='文稿质检 · 原文';
      el('iwEvidence').innerHTML=state.documentLoading?'<p>正在读取文稿…</p>':!document?'<p class="iw-empty">选择左侧作品查看原始正文与 ASR / OCR 质检状态。</p>':
        '<h3>'+escape(document.title)+'</h3><p>'+escape(isNote?'图文':'视频')+' · '+escape(time(document.publishedAt))+'</p><p>'+ (isNote?'OCR 提取：':'ASR 提取：')+escape(extraction)+'</p>'+
        (!isNote?'<p>原始 ASR 状态：'+escape(asr.status || '未提供')+' · 模型：'+escape(asr.model || '未提供')+'；原始状态不等于质检通过。</p>':'')+
        (!documentState?'<p>统一质检状态未提供；旧版提取状态不等于质检通过。</p>':'')+
        '<p>机器质检：'+escape(machineQuality)+' · 人工复核：'+(documentState?.humanReview==='unreviewed'?'未核验':'未提供')+'</p>'+
        '<p>质量提示：'+escape(reasons.join('、') || (Array.isArray(qualityReasons)?'未列出自动异常原因；不代表人工已核验':'质量原因未提供'))+'</p><p>'+escape(analysis)+'</p><blockquote>'+escape(document.text || '暂无可用正文')+'</blockquote>'+
        (segments.length?'<details><summary>ASR 时间片段（'+segments.length+'）</summary>'+segments.map(segment=>'<p>'+escape(segment.start)+'–'+escape(segment.end)+' 秒：'+escape(segment.text || '')+'</p>').join('')+'</details>':'')+
        (safeUrl(document.sourceUrl)?'<a href="'+escape(document.sourceUrl)+'" target="_blank" rel="noopener noreferrer">打开作品来源 ↗</a>':'<p>未提供可用来源地址</p>');
      return;
    }
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
  return {classificationRows,researchRows,creatorRows,groupEvidence,stageLanes,directoryEntries,mount,setCatalog,setTopics,setResult,setDetail,setLoadError,loadSelected,
    isMounted:()=>state.mounted, selectedKind:()=>state.entry?.kind,selectEntry};
});
