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
test('creator graph draws only cited direct claims around the focus and keeps full coverage count',()=>{
 const rows=[
  {key:'a',from:'保偏光纤',to:'光引擎',relation:'使用',topic:'CPO',status:'author_claim'},
  {key:'b',from:'激光器',to:'光引擎',relation:'组成',topic:'CPO',status:'author_claim'},
  {key:'c',from:'存储芯片',to:'服务器',relation:'组成',topic:'存储',status:'author_claim'}
 ];
 const graph=buildCreatorGraph(rows,'光引擎');
 assert.equal(graph.total,3);assert.equal(graph.shown,2);
 assert.equal(graph.focus,'光引擎');
 assert.deepEqual(graph.links.map(link=>link.relationKey),['a','b']);
 assert.ok(graph.nodes.some(node=>node.id==='光引擎'));
 assert.equal(graph.nodes.some(node=>node.id==='存储芯片'),false);
 assert.equal(graph.links.some(link=>link.source==='光引擎'&&link.target==='激光器'),false);
});
test('creator graph bounds visible edges without claiming the dataset is truncated',()=>{
 const rows=Array.from({length:100},(_,i)=>({key:String(i),from:'核心节点',to:'实体'+i,relation:'使用',status:'author_claim'}));
 const graph=buildCreatorGraph(rows,'核心节点');
 assert.equal(graph.total,100);assert.equal(graph.focusTotal,100);assert.equal(graph.shown,80);
});
