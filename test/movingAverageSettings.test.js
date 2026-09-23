const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function model(saved) {
  const memory=new Map(saved ? [['webstock.maPeriods',JSON.stringify(saved)]] : []);
  const localStorage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  const c=vm.createContext({window:{},localStorage,console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/state.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/klineChart.js'),'utf8'),c);
  return c.window;
}
test('MA settings accept custom and year periods, deduplicate, reject partial or invalid numbers',()=>{
  const k=model().KlineChart;
  assert.deepEqual(Array.from(k.parseMAPeriods('20，60,250,20')),[20,60,250]);
  for(const value of ['0,20','20x,60','1.5','-10','1001','1,2,3,4,5,6,7,8,9',''])assert.throws(()=>k.parseMAPeriods(value));
});
test('previous MA periods are restored on load',()=>{
  assert.deepEqual(Array.from(model([20,60,250]).State.maPeriods),[20,60,250]);
});
