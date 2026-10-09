const test=require('node:test'),assert=require('node:assert/strict');
const {validate,percentile,measure}=require('../scripts/measure-readonly-health');
test('probe rejects remote hosts, credentials, state-changing paths, bad counts and rapid polling',()=>{
  for(const baseUrl of ['https://example.com','http://user:pass@127.0.0.1','http://127.0.0.1/api/refresh','http://127.0.0.1?refresh=1'])
    assert.throws(()=>validate({baseUrl}));
  for(const options of [{samples:0},{samples:501},{delayMs:0},{timeoutMs:99999}]) assert.throws(()=>validate(options));
  assert.equal(validate({}).baseUrl,'http://127.0.0.1:3000');
});
test('nearest-rank percentiles preserve missing results rather than reporting zero',()=>{
  assert.equal(percentile([], .95),null);assert.equal(percentile([3,1,2],.5),2);
  assert.equal(percentile(Array.from({length:100},(_,i)=>i+1),.95),95);
});
test('probe only reads bounded allowlisted endpoints and separates HTTP failures',async()=>{
  const calls=[];
  const result=await measure({samples:2},{sleep:async()=>{},fetch:async(url,options)=>{
    calls.push({url,options});return {status:url.endsWith('/health')?503:200,ok:!url.endsWith('/health'),
      body:(async function*(){yield Buffer.from('private body not retained');})()};
  }});
  assert.equal(calls.length,4);
  assert.ok(calls.every(c=>c.options.method==='GET' && c.options.redirect==='error'));
  assert.equal(result.summary['/api/health'].errorCount,2);
  assert.equal(result.summary['/api/health'].p95Ms,null);
  assert.doesNotMatch(JSON.stringify(result),/private body/);
});
