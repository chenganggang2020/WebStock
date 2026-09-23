const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('saving a source returns to the saved document instead of leaving an old reader snapshot',async()=>{
  const selected=[],authors=[],button={disabled:false};
  const context=vm.createContext({window:{EvidenceLibrary:{select:async id=>selected.push(id)}},document:{getElementById:()=>button},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/aiResearch.js'),'utf8'),context);
  context.aiResearchApi=async()=>({id:123,chunkCount:2,author:'新作者'});
  context.aiResearchSourceBody=()=>({title:'编辑后的资料'});
  context.aiResearchSetStatus=()=>{};
  context.aiResearchClearSourceForm=()=>{};
  context.aiResearchLoadSources=async author=>authors.push(author);
  await context.aiResearchSaveSource();
  assert.deepEqual(selected,[123]);
  assert.deepEqual(authors,['新作者']);
  assert.equal(button.disabled,false);
});
