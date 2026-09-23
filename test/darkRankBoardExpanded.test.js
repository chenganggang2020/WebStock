const test = require('node:test');
const assert = require('node:assert/strict');
const {createDarkRankBoard,rankDarkRows} = require('../services/capitalFlow/darkRankBoard');

test('full loaded universe is retained on each sign and amount response does not wait for market caps', async () => {
  const rows = Array.from({length:240},(_,i)=>({key:'sh'+String(600000+i),code:String(600000+i),darkNetCents:String(i%2?-i-1:i+1),visibleNetCents:'100'}));
  const board=createDarkRankBoard({darkStocks:{get:async()=>({rows,tradingDay:'2026-09-18',coverage:{receivedRows:240,totalReported:240}})},loadCaps:()=>new Promise(()=>{})});
  const result=await Promise.race([board.get({date:'2026-09-18',metric:'amount'}),new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
  assert.ok(result,'net-amount ranking must not wait for optional market cap lookup');
  assert.equal(result.inflow.length,120);
  assert.equal(result.outflow.length,120);
  assert.equal(result.rows.length,240);
  assert.equal(result.rows[0].darkMarketCapRatio,null);
});

test('visible and combined rank actual net values and missing data is not zero', () => {
  const rows=[{key:'sh600001',darkNetCents:'100',visibleNetCents:'-200',combinedNetCents:'-100'},
    {key:'sh600002',darkNetCents:'-100',visibleNetCents:'300',combinedNetCents:'200'},
    {key:'sh600003',darkNetCents:null,visibleNetCents:null,combinedNetCents:null}];
  const visible=rankDarkRows(rows,new Map(),'2026-09-18','visible');
  assert.equal(visible.inflow[0].key,'sh600002');
  assert.equal(visible.outflow[0].key,'sh600001');
  const combined=rankDarkRows(rows,new Map(),'2026-09-18','combined');
  assert.equal(combined.inflow[0].key,'sh600002');
  assert.equal(combined.outflow.length,1);
});
