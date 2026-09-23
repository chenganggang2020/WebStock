const test=require('node:test');
const assert=require('node:assert/strict');
test('global daily trend preserves null gaps, verified identity, date and source',()=>{
  const {parseIndexChart}=require('../services/globalIndexTrendService');
  const definition={key:'nikkei225',symbol:'^N225',name:'日经225',zone:'Asia/Tokyo'};
  const input={chart:{result:[{meta:{symbol:'^N225'},timestamp:[1789516800,1789603200,1789689600],indicators:{quote:[{close:[100,null,103]}]}}]}};
  const result=parseIndexChart(input,definition);
  assert.equal(result.trend.length,3);assert.equal(result.trend[1].close,null);
  assert.equal(result.value,103);assert.equal(result.changePct,null,'missing previous close must not become a multi-day daily change');
  assert.match(result.observedAt,/2026-09-18/);assert.equal(result.source,'Yahoo Finance · 日线');
  input.chart.result[0].meta.symbol='WRONG';assert.throws(()=>parseIndexChart(input,definition));
});
