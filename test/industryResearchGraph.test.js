const test=require('node:test'),assert=require('node:assert/strict');
const {buildGraph,buildCreatorGraph}=require('../js/modules/industryResearchGraph');
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
test('creator graph keeps only cited directed relations and every edge opens its original evidence',()=>{
 const rows=[
  {key:'r1',topic:'光互联',from:'保偏光纤',to:'光引擎',relation:'使用',publishedAt:'2026-09-20'},
  {key:'r2',topic:'光互联',from:'光引擎',to:'光模块',relation:'组成',publishedAt:'2026-09-19'}
 ];
 const graph=buildCreatorGraph(rows);
 assert.equal(graph.relationCount,2);
 assert.deepEqual(graph.links.filter(link=>link.relationKey).map(link=>link.relationKey),['r1','r2']);
 assert.equal(graph.nodes.some(node=>node.name==='公司第一梯队'),false);
 assert.equal(graph.links.some(link=>link.label?.formatter==='供货'),false);
 assert.ok(graph.nodes.every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)));
});
