const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('../web/portfolio-model.js');
const rows=[
 {id:'buy',date:'2026-08-01',code:'000001',name:'平安银行',side:'buy',fee:5,netAmount:1005,realizedPnl:null},
 {id:'sell',date:'2026-09-01',code:'000001',name:'平安银行',side:'sell',fee:2,netAmount:478,realizedPnl:76},
 {id:'other',date:'2026-09-02',code:'600000',name:'浦发银行',side:'sell',fee:1,netAmount:899,realizedPnl:-101},
 {id:'sell2',date:'2026-09-02',code:'000001',name:'平安银行',side:'sell',fee:1,netAmount:209,realizedPnl:8},
];
test('date filter retains native historical cost and aggregates selected sales only',()=>{
 const r=model.select(rows,{from:'2026-09-01',to:'2026-09-02',code:'000001'});
 assert.deepEqual(r.trades.map(t=>t.id),['sell','sell2']);assert.equal(r.realizedPnl,84);assert.equal(r.fees,3);assert.equal(r.buyAmount,0);assert.equal(r.sellProceeds,687);
 assert.deepEqual(r.series.map(t=>t.cumulative),[76,84]);assert.equal(r.symbols[0].realizedPnl,84);
});
test('full series nets all symbols by date with losses and zero buys retained',()=>{
 const r=model.select(rows,{});assert.deepEqual(r.series.map(t=>[t.date,t.cumulative]),[['2026-08-01',0],['2026-09-01',76],['2026-09-02',-17]]);
 assert.equal(r.buyCount,1);assert.equal(r.sellCount,3);assert.equal(r.fees,9);assert.equal(r.buyAmount,1005);assert.equal(r.realizedPnl,-17);
});
test('no matching data is an empty result, not a fallback to all trades',()=>{
 const r=model.select(rows,{code:'000002'});assert.equal(r.trades.length,0);assert.equal(r.series.length,0);
 assert.equal(model.select(rows,{from:'2026-09-03',to:'2026-09-01'}).invalidRange,true);
});
test('input remains unchanged, side filter is explicit, decimal cents sum correctly',()=>{
 const before=JSON.stringify(rows);assert.equal(model.select(rows,{side:'buy'}).trades.length,1);assert.equal(JSON.stringify(rows),before);
 const r=model.select([0.1,0.2].map((n,i)=>({date:'2026-09-01',id:String(i),code:'000001',side:'sell',fee:n,netAmount:n,realizedPnl:n})),{});
 assert.equal(r.realizedPnl,.3);assert.equal(r.fees,.3);
});
test('native exact decimal fields are summed before half-up display rounding',()=>{
 const trades=[1,2].map(i=>({id:String(i),date:'2026-09-01',code:'000001',side:'sell',fee:0,netAmount:2,realizedPnl:.99,realizedPnlExact:'0.986666666667'}));
 assert.equal(model.select(trades,{}).realizedPnl,1.97);
 assert.equal(model.select(trades.map(t=>({...t,realizedPnlExact:'-0.0025'})),{}).realizedPnl,-.01);
 assert.equal(model.select([{...trades[0],feeExact:'0.'+'0'.repeat(324)+'5'}],{}).fees,0);
});
