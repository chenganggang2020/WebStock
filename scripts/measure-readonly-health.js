'use strict';
// Read-only baseline probe. Does NOT measure server SQL or event-loop time.
// Only explicit loopback addresses, GET / and GET /api/health, no redirects,
// no cookies, no response bodies in the report, no database access.
const {performance} = require('node:perf_hooks');
const {setTimeout: sleep} = require('node:timers/promises');
function validate(options = {}) {
  const base = new URL(options.baseUrl || 'http://127.0.0.1:3000');
  if (!['http:','https:'].includes(base.protocol) || !['127.0.0.1','[::1]'].includes(base.hostname) ||
      base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw Error('Use an explicit loopback origin without credentials, path or query.');
  }
  const samples = Number(options.samples ?? 30), delayMs = Number(options.delayMs ?? 250),
    timeoutMs = Number(options.timeoutMs ?? 5000);
  if (!Number.isInteger(samples) || samples < 2 || samples > 500 ||
      !Number.isInteger(delayMs) || delayMs < 100 || delayMs > 60000 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw Error('samples=2..500, delayMs=100..60000, timeoutMs=100..30000 required.');
  }
  return {baseUrl:base.origin,samples,delayMs,timeoutMs};
}
function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.max(0, Math.ceil(sorted.length*q)-1)];
}
async function measure(input = {}, dependencies = {}) {
  const options = validate(input), fetcher = dependencies.fetch || fetch, wait = dependencies.sleep || sleep;
  const rows = [], startedAt = new Date().toISOString();
  for (let index=0; index<options.samples; index++) {
    // Alternate endpoint order so one route is not always measured first.
    for (const route of index%2 ? ['/', '/api/health'] : ['/api/health', '/']) {
      const started = performance.now();
      try {
        const response = await fetcher(options.baseUrl+route, {
          method:'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(options.timeoutMs)
        });
        // Drain a bounded stream so total duration includes body delivery.
        let bytes=0;
        for await (const chunk of response.body || []) {
          bytes += chunk.byteLength;
          if (bytes > 2*1024*1024) throw Error('response-too-large');
        }
        rows.push({sample:index+1,route,status:response.status,ok:response.ok,
          durationMs:Number((performance.now()-started).toFixed(3)),bytes});
      } catch(error) {
        rows.push({sample:index+1,route,status:null,ok:false,durationMs:Number((performance.now()-started).toFixed(3)),
          error: ['TimeoutError','AbortError'].includes(error.name) ? 'timeout' : 'request-failed'});
      }
      await wait(options.delayMs);
    }
  }
  const summary = Object.fromEntries(['/', '/api/health'].map(route=>{
    const selected=rows.filter(r=>r.route===route), successful=selected.filter(r=>r.ok).map(r=>r.durationMs);
    return [route,{count:selected.length,successCount:successful.length,errorCount:selected.length-successful.length,
      p50Ms:percentile(successful,.5),p95Ms:percentile(successful,.95),maxMs:successful.length?Math.max(...successful):null}];
  }));
  return {schema:'webstock.readonly-health-probe/v1',startedAt,endedAt:new Date().toISOString(),
    options,summary,rows,
    limits:'HTTP client-side timings only. No production workload diagnosis; no SQL, provider wait or renderer timing. Run outside full-suite load; record warm/cold and idle/loaded conditions separately.'};
}
if (require.main === module) {
  const options={};
  for (const argument of process.argv.slice(2)) {
    const match=/^--(baseUrl|samples|delayMs|timeoutMs)=(.+)$/.exec(argument);
    if (!match) {console.error('Unknown argument; use --name=value.');process.exitCode=1;return;}
    options[match[1]]=match[2];
  }
  measure(options).then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={validate,percentile,measure};
