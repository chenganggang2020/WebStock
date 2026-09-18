const test=require('node:test'),assert=require('node:assert/strict');
const {buildGraph}=require('../js/modules/industryResearchGraph');
test('research graph bounds expansion and never invents company supplier edges',()=>{
 const relations=Array.from({length:50},(_,i)=>({id:'r'+i,product:'器件'+i,stage:'components',company:{name:'公司'+i},status:i?'candidate':'verified'}));
 const g=buildGraph('主题',relations);
 assert.equal(g.shown,16);assert.equal(g.total,50);
 assert.equal(g.nodes.filter(n=>n.relationIndex!==undefined).length,16);
 assert.equal(g.links.some(l=>String(l.source).startsWith('relation-')),false);
 assert.equal(g.nodes.find(n=>n.id==='relation-0').reviewStatus,'verified');
 assert.equal(g.nodes.find(n=>n.id==='relation-1').reviewStatus,'candidate');
});
test('empty evidence graph contains no fictitious company nodes',()=>{
 const g=buildGraph('暂无原文',[]);assert.equal(g.shown,0);assert.equal(g.links.length,0);
});
