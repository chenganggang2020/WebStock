const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('../js/modules/evidenceLibrary');
test('human source metadata does not present internal tags as user categories', () => {
  const raw = {id:1,title:'[原始来源 / 本人公开] Fioona：光模块',author:'Fioona',sourceType:'video',tags:['subject:creator','status:available','archive:downloaded','role:transcript','CPO'],sectors:['半导体']};
  const result = library.presentation(raw);
  assert.equal(result.title, '光模块');
  assert.deepEqual(result.topics, ['CPO','半导体']);
  assert.equal(result.kind, '视频');
  assert.equal(result.contentKind, '逐字稿');
  assert.match(result.archive, /媒体已下载/);
  assert.equal(raw.title, '[原始来源 / 本人公开] Fioona：光模块');
});
test('available or primary evidence tags never imply verified truth', () => {
  const result = library.presentation({title:'观点',tags:['status:available','evidence:primary','archive:linked']});
  assert.doesNotMatch(JSON.stringify(result), /已核验|事实确认/);
  assert.equal(result.archive, '仅来源链接');
});
test('invalid publication time is not made current', () => {
  assert.equal(library.formatTime('bad'), '发布时间未知');
  assert.match(library.formatTime('2026-09-18T16:05:00Z'), /2026.09.19.*00:05/);
});
test('late source detail never replaces another selection and stored HTML stays text', async () => {
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const nodes=Object.fromEntries(['knowledgeSourceReader','knowledgeAnalysisPanel','knowledgeEditorPanel'].map(id=>[id,{innerHTML:'',hidden:false}]));
  const requests=[];
  const window={document:{getElementById:id=>nodes[id],querySelectorAll:()=>[]},ApiClient:{fetchJsonData:url=>new Promise(resolve=>requests.push({url,resolve}))}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/modules/evidenceLibrary.js'),'utf8'),{window});
  const first=window.EvidenceLibrary.select(1),second=window.EvidenceLibrary.select(2);
  requests[1].resolve({id:2,title:'新资料',content:'<img src=x onerror=alert(1)>',sourceUrl:'javascript:alert(1)',tags:[]});await second;
  requests[0].resolve({id:1,title:'旧资料',content:'迟到内容',tags:[]});await first;
  assert.match(nodes.knowledgeSourceReader.innerHTML,/新资料/);
  assert.doesNotMatch(nodes.knowledgeSourceReader.innerHTML,/<img|迟到内容|href="javascript/);
  assert.match(nodes.knowledgeSourceReader.innerHTML,/&lt;img/);
});
