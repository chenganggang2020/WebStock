const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const c=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/modules/darkRankBoardView.js'),'utf8'),c);
test('summaries sum signed observed net amounts exactly, without deriving gross purchases or sales',()=>{
  const result=c.window.DarkRankBoard.summarize([{combinedNetCents:'10000000000000001'},{combinedNetCents:'-300'},{combinedNetCents:null}]);
  assert.equal(result.inflow,'10000000000000001');
  assert.equal(result.outflow,'-300');
  assert.equal(result.net,'9999999999999701');
  assert.equal(result.missing,1);
  assert.equal(result.grossBuy,undefined);
});
