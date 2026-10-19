const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../js/modules/industryWorkspace'),'utf8');

async function renderCreator(data,documentResponse) {
  const nodes=new Map(),buttons=new Map();
  function node(id) {
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',hidden:false,dataset:{},listeners:{},
      classList:{add(){},toggle(){}},setAttribute(){},appendChild(){},
      addEventListener(type,fn){this.listeners[type]=fn;},querySelectorAll(){return [];},querySelector(){return null;}});
    return nodes.get(id);
  }
  const host=node('industryChainView');
  host.querySelector=selector=>{
    const match=selector.match(/^\[data-iw-view="([^"]+)"\]$/);
    if(match){if(!buttons.has(match[1]))buttons.set(match[1],{dataset:{iwView:match[1]},setAttribute(){}});return buttons.get(match[1]);}
    return selector.startsWith('#')?node(selector.slice(1)):null;
  };
  const root={document:{getElementById:node},IndustryChain:{cancelPendingSelection(){}},
    apiFetch:async url=>url==='/api/expert/channels'?[{id:4,displayName:'Fioona',platform:'douyin'}]:url.includes('/observations/')?documentResponse:data};
  vm.runInNewContext(source,{window:root,Map,Set,Date,console});
  root.IndustryWorkspace.mount(host);await root.IndustryWorkspace.loadSelected();
  return {nodes,view(name){host.listeners.click({target:{closest:()=>({dataset:{iwView:name}})}});},
    async document(id){host.listeners.click({target:{closest:()=>({dataset:{iwDocument:String(id)}})}});await new Promise(resolve=>setImmediate(resolve));}};
}
function data(overrides={}) {
  return {analyzedCount:4,readyCount:6,totalCount:7,pendingCount:2,blockedCount:1,eligibleCount:3,
    currentAnalyzedCount:1,historicalAnalyzedCount:5,aiConfigured:false,relations:[],documents:[],reviewQueue:[],...overrides};
}

test('creator counters distinguish historical analysis, current qualified analysis, body and quality admission',async()=>{
  const h=await renderCreator(data());
  const status=h.nodes.get('industryResearchStatus').textContent;
  assert.match(status,/历史已分析 5 篇/);assert.match(status,/当前合格 1 篇/);
  assert.match(status,/已有正文 6 篇/);assert.match(status,/质检准入 3 篇/);
  assert.doesNotMatch(status,/已分析 4/);
  const empty=h.nodes.get('iwContent').innerHTML;
  assert.match(empty,/当前.*没有.*合格关系/);assert.match(empty,/历史.*保留/);
  assert.match(empty,/当前合格.*也可能.*没有产业关系/);
  assert.doesNotMatch(empty,/尚无已分析关系/);
});

test('quality view shows retained current-body relations separately from admitted graph relations',async()=>{
  const h=await renderCreator(data({currentAnalyzedCount:0,historicalAnalyzedCount:1,
    documents:[{observationId:8,currentEligible:false,exclusionReason:'asr_review_required'}],
    reviewQueue:[{observationId:8,title:'待复核文稿',mediaType:'video',textLength:500,status:'asr_review_required',relationCount:6,currentRelationCount:0,publishedAt:'2026-09-20'}]}));
  h.view('quality');const html=h.nodes.get('iwContent').innerHTML;
  assert.match(html,/当前入图关系 0 条/);assert.match(html,/当前正文留存关系 6 条/);
  assert.match(html,/暂不入图：转写待复核/);assert.match(html,/历史.*保留/);
  assert.doesNotMatch(html,/删除/);
});

test('omitted admission metadata is not silently replaced with zero or the old analyzed count',async()=>{
  const h=await renderCreator({analyzedCount:9,readyCount:12,totalCount:15,pendingCount:3,relations:[],documents:[],
    reviewQueue:[{observationId:1,title:'旧接口作品',status:'complete_with_relations',textLength:200,relationCount:7}]});
  const status=h.nodes.get('industryResearchStatus').textContent;
  assert.match(status,/历史已分析 未提供/);assert.match(status,/当前合格 未提供/);
  assert.match(status,/质检准入 未提供/);assert.match(status,/已有正文 12 篇/);
  assert.doesNotMatch(status,/当前合格 (0|9)/);
  const empty=h.nodes.get('iwContent').innerHTML;assert.match(empty,/当前合格 未提供/);
  h.view('quality');const html=h.nodes.get('iwContent').innerHTML;
  assert.match(html,/当前入图关系 未提供/);assert.match(html,/当前正文留存关系 7 条/);
  assert.match(html,/图谱准入状态未提供/);
});

test('explicit zero remains zero and eligible empty analysis is not mislabeled as missing analysis',async()=>{
  const h=await renderCreator(data({currentAnalyzedCount:1,historicalAnalyzedCount:1,blockedCount:0,
    documents:[{observationId:2,currentEligible:true,exclusionReason:null}],
    reviewQueue:[{observationId:2,title:'无产业链内容',status:'complete_empty',textLength:80,relationCount:0,currentRelationCount:0}]}));
  h.view('quality');const html=h.nodes.get('iwContent').innerHTML;
  assert.match(html,/已分析 · 无产业关系/);assert.match(html,/当前合格/);
  assert.match(html,/当前入图关系 0 条/);assert.match(html,/当前正文留存关系 0 条/);
});

test('new-contract works without a matching analysis say no current-body analysis rather than missing admission metadata',async()=>{
  for(const item of [{observationId:1,title:'正文待分析',status:'pending'},
    {observationId:2,title:'缺少正文',status:'missing_text'},
    {observationId:3,title:'正文已变更',status:'pending'}]) {
    const h=await renderCreator(data({currentAnalyzedCount:0,documents:[],
      reviewQueue:[{...item,textLength:item.status==='missing_text'?0:100,relationCount:0,currentRelationCount:0}]}));
    h.view('quality');const html=h.nodes.get('iwContent').innerHTML;
    assert.match(html,/暂无当前正文分析/);
    assert.doesNotMatch(html,/图谱准入状态未提供|当前合格/);
    assert.match(html,item.status==='missing_text'?/缺少可用正文/:/待分析/);
  }
});

test('document reader uses normalized prompt-echo quality despite legacy ASR complete and empty stored quality',async()=>{
  const h=await renderCreator(data(),{observationId:35008,title:'污染文稿',mediaType:'video',text:'保留原始正文',
    asr:{status:'complete',model:'small',quality:{reasons:[]},segments:[]},
    documentState:{extraction:'complete',machineQuality:'review_required',humanReview:'unreviewed',
      qualityReasons:['prompt_echo'],eligibleForAnalysis:false,analysisBlockReason:'suspected_prompt_echo'}});
  h.view('quality');await h.document(35008);const html=h.nodes.get('iwEvidence').innerHTML;
  assert.match(html,/疑似提示词污染/);assert.match(html,/机器质检：待复核/);
  assert.match(html,/原始 ASR 状态：complete/);assert.match(html,/原始状态不等于质检通过/);
  assert.match(html,/分析阻断：疑似提示词污染/);assert.match(html,/人工复核：未核验/);
  assert.match(html,/保留原始正文/);assert.doesNotMatch(html,/无自动异常标记/);
});

test('note document reader identifies OCR extraction and blocks partial notes without using ASR model as OCR model',async()=>{
  const h=await renderCreator(data(),{observationId:9,title:'图文',mediaType:'note',text:'现有图文原文',
    asr:{status:'complete',model:'not-an-ocr-model',segments:[{start:0,end:1,text:'not-ocr'}]},
    documentState:{extraction:'partial',machineQuality:'not_evaluated',humanReview:'unreviewed',
      qualityReasons:[],eligibleForAnalysis:false,analysisBlockReason:'note_ocr_required'}});
  h.view('quality');await h.document(9);const html=h.nodes.get('iwEvidence').innerHTML;
  assert.match(html,/OCR 提取：部分完成/);assert.match(html,/机器质检：尚未评估/);
  assert.match(html,/分析阻断：图文正文待识别\/核验/);assert.match(html,/现有图文原文/);
  assert.doesNotMatch(html,/not-an-ocr-model|ASR 时间片段|转写：complete/);
});

test('legacy and incomplete document responses stay readable without inventing quality or human approval and escape source fields',async()=>{
  const h=await renderCreator(data(),{observationId:10,title:'<img src=x onerror=alert(1)>',mediaType:'video',
    text:'<script>bad()</script>',sourceUrl:'javascript:alert(1)',asr:{status:'complete',model:'<b>model</b>',
      quality:{reasons:['<svg onload=alert(1)>']}}});
  h.view('quality');await h.document(10);let html=h.nodes.get('iwEvidence').innerHTML;
  assert.match(html,/统一质检状态未提供/);assert.match(html,/人工复核：未提供/);
  assert.match(html,/&lt;svg onload=alert\(1\)&gt;/);assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<img|<svg|<script|javascript:|无自动异常|人工已审核/);
  const bare=await renderCreator(data(),{observationId:11,title:'旧图文',mediaType:'note',text:'原文'});
  bare.view('quality');await bare.document(11);html=bare.nodes.get('iwEvidence').innerHTML;
  assert.match(html,/OCR 提取：未提供/);assert.match(html,/统一质检状态未提供/);assert.match(html,/原文/);
});

test('normalized quality and block reason fields are escaped and an automatic pass is not human review',async()=>{
  const documentState={extraction:'complete',machineQuality:'pass',humanReview:'unreviewed',
    qualityReasons:['<img src=x>'],eligibleForAnalysis:false,analysisBlockReason:'<script>block</script>'};
  const h=await renderCreator(data(),{observationId:12,title:'安全文本',mediaType:'video',text:'正文',asr:{segments:[]},documentState});
  h.view('quality');await h.document(12);const html=h.nodes.get('iwEvidence').innerHTML;
  assert.match(html,/机器质检：自动质检未标异常/);assert.match(html,/人工复核：未核验/);
  assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/&lt;script&gt;block&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<img|<script|人工已审核/);
});
