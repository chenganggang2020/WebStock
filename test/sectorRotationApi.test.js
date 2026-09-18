const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createSectorRotationRouter}=require('../routes/sectorRotation');
async function withApi(fn) {
  let collections=0;const app=express();
  app.use('/api',createSectorRotationRouter({service:{get:async q=>q,collect:async()=>{collections++;}}}));
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
  try {await fn('http://127.0.0.1:'+s.address().port+'/api',()=>collections);}finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
}
test('rotation GET is read-only and normalized; POST collects once',()=>withApi(async(base,count)=>{
  const r=await fetch(base+'/capital-flow/rotation?scope=concept&minutes=15&metric=dark&code=BK0001');
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual((await r.json()).data,{scope:'concept',minutes:15,metric:'dark',code:'BK0001'});
  assert.equal(count(),0);assert.equal((await fetch(base+'/capital-flow/rotation/refresh',{method:'POST'})).status,200);assert.equal(count(),1);
}));
test('bad and duplicate query parameters cannot collect or access arbitrary paths',()=>withApi(async base=>{
  for(const q of ['scope=stock','minutes=1','metric=main','code=../../x','scope=industry&scope=concept','minutes=5x','url=http://example.com']) {
    assert.equal((await fetch(base+'/capital-flow/rotation?'+q)).status,400);
  }
}));

test('replay query is normalized but cannot trigger present-day collection',()=>withApi(async(base,count)=>{
  const query='date=2026-09-16&at=10:05:00';
  const response=await fetch(base+'/capital-flow/rotation?'+query);
  assert.equal(response.status,200);assert.equal((await response.json()).data.at,'10:05:00');
  assert.equal((await fetch(base+'/capital-flow/rotation/refresh?'+query,{method:'POST'})).status,400);
  assert.equal(count(),0);
}));
