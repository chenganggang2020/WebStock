const test = require('node:test');
const assert = require('node:assert/strict');
const workspace = require('../js/modules/industryWorkspace');

test('automatic matches remain unverified and do not expose a confidence probability', () => {
  const rows = workspace.classificationRows({confirmed:[{stock:{code:'000001',name:'甲'},stage:'materials',confidence:.95}],candidates:[{stock:{code:'000002',name:'乙'},stage:'unknown'}]});
  assert.equal(rows[0].status, 'matched');
  assert.equal(rows[1].status, 'candidate');
  assert.equal(rows[0].confidence, undefined);
  assert.equal(rows[0].company, '甲');
});

test('source grouping removes repeated chunks but preserves distinct quotes and provenance', () => {
  const sources = workspace.groupEvidence([
    {sourceUrl:'https://example.com/a',title:'原文',matchReason:'第一段',evidenceId:'a'},
    {sourceUrl:'https://example.com/a',title:'原文',matchReason:'第一段',evidenceId:'a'},
    {sourceUrl:'https://example.com/a',title:'原文',matchReason:'第二段',evidenceId:'b'},
    {sourceUrl:'javascript:alert(1)',title:'不安全链接',evidenceId:'c'}
  ]);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].fragments.length, 2);
  assert.equal(sources[0].fragments[1].evidenceId, 'b');
  assert.equal(sources[1].url, '');
});

test('version relations keep manual review status and resolve original source quotes', () => {
  const rows = workspace.researchRows({id:'v1',relations:[{id:'r1',stage:'components',product:'器件',status:'verified',company:{name:'甲',stockCode:'000001'},evidenceRefs:[{evidenceId:'e1',quote:'原文片段'}]}],evidence:[{id:'e1',title:'原文',finalUrl:'https://example.com/1',contentSha256:'hash'}]});
  assert.equal(rows[0].status, 'verified');
  assert.equal(rows[0].key, 'r1');
  assert.equal(rows[0].evidence[0].fragments[0].quote, '原文片段');
  assert.equal(rows[0].evidence[0].fragments[0].contentSha256, 'hash');
});

test('stage diagram uses all records, retains unknown stages and invents no supplier edges', () => {
  const rows = Array.from({length:51}, (_,i) => ({key:String(i),stage:i===50?'unknown':i%2?'materials':'applications'}));
  const lanes = workspace.stageLanes(rows);
  assert.equal(lanes.flatMap(l=>l.rows).length,51);
  assert.equal(lanes.find(l=>l.id==='unclassified').rows.length,1);
  assert.deepEqual(workspace.stageLanes([]).flatMap(l=>l.rows),[]);
  assert.equal(lanes.some(l=>l.links),false);
});

test('topic namespace prevents catalog and research ids colliding', () => {
  const entries = workspace.directoryEntries([{id:'same',name:'行业'}],[{id:'same',name:'研究',enabled:false}]);
  assert.equal(new Set(entries.map(e=>e.key)).size,2);
  assert.equal(entries[1].kind,'research');
});
test('creator relations keep directed endpoints, quotation and author without invented stock identities', () => {
  const rows = workspace.creatorRows({relations:[{key:'4-1',from:'保偏光纤',to:'光引擎',relation:'使用',topic:'CPO',author:'Fioona',quote:'保偏光纤用于光引擎',publishedAt:'2026-09-18',sourceUrl:'https://www.douyin.com/video/1',bodyHash:'hash'}]});
  assert.equal(rows[0].from,'保偏光纤'); assert.equal(rows[0].to,'光引擎');
  assert.equal(rows[0].status,'author_claim'); assert.equal(rows[0].code,'');
  assert.equal(rows[0].evidence[0].fragments[0].quote,'保偏光纤用于光引擎');
});

test('creator review list exposes blocked source documents without treating them as graph relations', () => {
  const rows=workspace.creatorReviewRows({reviewQueue:[
    {observationId:1,title:'待复核视频',mediaType:'video',status:'asr_review_required',publishedAt:'2026-09-20'},
    {observationId:2,title:'未提取图文',mediaType:'note',status:'note_ocr_required',publishedAt:'2026-09-21'}
  ]});
  assert.equal(rows.length,2);
  assert.equal(rows[0].observationId,2);
  assert.equal(rows[0].status,'note_ocr_required');
  assert.equal(rows[1].status,'asr_review_required');
});

test('creator review request carries exact source identity and edited note pages, not an industry verdict', () => {
  const document={mediaType:'note',bodyHash:'a'.repeat(64),note:{pages:[{index:1,sha256:'b'.repeat(64)}]}};
  assert.deepEqual(workspace.creatorReviewRequest(document,{confirmed:true,pages:[{index:1,text:'人工校对文字'}]}),{
    bodyHash:document.bodyHash,confirmed:true,pages:[{index:1,sha256:'b'.repeat(64),text:'人工校对文字'}]
  });
  assert.equal(workspace.creatorReviewRequest({mediaType:'video',bodyHash:'c'.repeat(64),asr:{mediaSha256:'d'.repeat(64)}},
    {confirmed:true,text:'校对口播'}).mediaSha256,'d'.repeat(64));
});

test('creator attempt labels distinguish retry cooldown from completed source review', () => {
  assert.match(workspace.creatorAttemptLabel({status:'ready',analysis:{status:'failed',nextRetryAt:'2026-09-23T04:00:00Z'}}),/重试/);
  assert.equal(workspace.creatorAttemptLabel({status:'note_ocr_required',analysis:{status:'pending'}}),'待补原文');
  assert.equal(workspace.creatorAttemptLabel({status:'ready',analysis:{status:'complete'}}),'候选已提取');
});

test('company facts expose only sourced business and dated quote fields', () => {
  const view=workspace.companyFactView('600584',{
    code:'600584',source:'Eastmoney F10',businessSummary:'集成电路封装测试',
    boards:['半导体','先进封装'],mainBusinessItems:[{name:'封测',ratio:80,reportDate:'2026-06-30'}],
    fetchedAt:'2026-09-20T01:00:00.000Z'
  },{code:'600584',price:50,prevClose:48,quoteStatus:'latest-close',tradeDate:'2026-09-22',fetchedAt:'2026-09-22T07:00:00.000Z'});
  assert.equal(view.businessSummary,'集成电路封装测试');
  assert.ok(Math.abs(view.changePct-4.166666666666667)<1e-10);
  assert.equal(view.marketCap,null);
  assert.equal(view.profileCoverage,'partial-f10');
  assert.equal(view.quoteStatus,'latest-close');
  assert.deepEqual(view.boards,['半导体','先进封装']);
  const missing=workspace.companyFactView('600584',{code:'600584',name:'长电科技'},
    {code:'600584',price:0,prevClose:0,quoteStatus:'unavailable'});
  assert.equal(missing.businessSummary,'');
  assert.equal(missing.changePct,null);
  assert.equal(missing.profileCoverage,'unavailable');
});
