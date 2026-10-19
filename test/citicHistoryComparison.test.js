const test=require('node:test'),assert=require('node:assert/strict');
const {compareHistory}=require('../services/citicHistoryComparison');
const rows=(date,long,short)=>[{product:'IF',contract:'IF2609',tradingDay:date,member:'中信期货(代客)',positionType:'long',volume:long,rank:1},{product:'IF',contract:'IF2609',tradingDay:date,member:'中信期货(代客)',positionType:'short',volume:short,rank:1}];
const daily=[{day:'2026-09-10',close:100,open:99},{day:'2026-09-11',close:102,open:101},{day:'2026-09-14',close:101,open:103}];
test('pairs the next real session, shows separate return baselines and matched contract changes',()=>{
 const r=compareHistory([{tradingDate:'2026-09-10',rows:rows('2026-09-10',10,15)},{tradingDate:'2026-09-11',rows:rows('2026-09-11',12,14)}],{index:daily});
 assert.equal(r.length,2);assert.equal(r[0].netLong,-5);assert.equal(r[1].comparableChange,3);assert.equal(r[1].nextTradingDay,'2026-09-14');
 assert.ok(Math.abs(r[0].returns.index.closeToClosePercent-2)<1e-8);
 assert.ok(Math.abs(r[0].returns.index.openToClosePercent-(102/101-1)*100)<1e-8);
});
test('missing one side is unknown, never zero or a fake large net position',()=>{
 const r=compareHistory([{tradingDate:'2026-09-11',rows:rows('2026-09-11',12,14).slice(0,1)}],{index:daily});
 assert.equal(r[0].netLong,null);assert.equal(r[0].missingSideContracts,1);
});
test('missing immediate next day does not jump forward to another observed day',()=>{
 const r=compareHistory([{tradingDate:'2026-09-10',rows:rows('2026-09-10',10,15)}],{index:daily.filter(x=>x.day!=='2026-09-11')});
 assert.equal(r[0].nextTradingDay,'2026-09-11');assert.equal(r[0].returns.index,null);
});
