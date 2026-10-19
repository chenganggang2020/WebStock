const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchdogState } = require('../electron/runtimeWatchdogState');

test('independent state detects missing main heartbeat with last operation and recovers once', () => {
  let now=0;const state=createWatchdogState({now:()=>now,stallMs:5000,graceMs:0});
  state.accept({type:'pulse'});state.accept({type:'begin',id:1,label:'douyin.hide',stack:'at capture (douyinSessionManager.js:20:4)'});
  now=5001;const event=state.tick();assert.equal(event.kind,'main-stall');
  assert.equal(event.active[0].label,'douyin.hide');assert.match(event.active[0].stack,/capture/);
  assert.equal(state.tick(),null);
  now=6500;state.accept({type:'pulse'});assert.equal(state.tick().kind,'recovered');assert.equal(state.tick(),null);
});
test('hidden renderers are not reported and visible renderer misses are distinct', () => {
  let now=0;const state=createWatchdogState({now:()=>now,stallMs:5000,graceMs:0});
  state.accept({type:'renderer',visible:false,page:'creatorTasks'});now=6000;state.accept({type:'pulse'});assert.equal(state.tick(),null);
  state.accept({type:'renderer',visible:true,page:'creatorTasks'});now=12000;state.accept({type:'pulse'});
  assert.equal(state.tick().kind,'renderer-stall');
});
test('watchdog sleep or scheduling gap is labelled a coverage gap, not an app freeze', () => {
  let now=0;const state=createWatchdogState({now:()=>now,stallMs:5000,graceMs:0});
  state.accept({type:'pulse'});now=60000;assert.equal(state.tick().kind,'observation-gap');assert.equal(state.tick(),null);
});
test('breadcrumbs and pending operations are bounded and arbitrary payload is discarded', () => {
  let now=0;const state=createWatchdogState({now:()=>now,graceMs:0});
  for(let i=0;i<500;i++)state.accept({type:'begin',id:i,label:'db.read',cookie:'SECRET',body:'PRIVATE',stack:'x'.repeat(10000)});
  now=6000;const event=state.tick();assert.ok(event.active.length<=20);assert.ok(event.recent.length<=60);
  assert.ok(!JSON.stringify(event).includes('SECRET'));assert.ok(!JSON.stringify(event).includes('PRIVATE'));
  assert.ok(JSON.stringify(event).length<64000);
});

test('dropped diagnostics clear incomplete pending spans rather than blaming stale operations',()=>{
  let now=0;const state=createWatchdogState({now:()=>now,graceMs:0});
  state.accept({type:'begin',id:1,label:'db.get'});state.accept({type:'dropped',count:3});
  now=6000;const event=state.tick();assert.deepEqual(event.active,[]);
  assert.equal(event.recent[0].type,'diagnostic-events-dropped');
});

test('slow requests are recorded separately, and an aging main pulse is not blamed on renderer',()=>{
  let now=0;const state=createWatchdogState({now:()=>now,graceMs:0});
  state.accept({type:'renderer',visible:true});state.accept({type:'begin',id:1,label:'GET /api/capital-flow'});
  now=100;state.accept({type:'pulse'});now=5050;assert.equal(state.tick(),null);
  now=5200;assert.equal(state.tick().kind,'main-stall');
  const result=state.accept({type:'end',id:1});assert.equal(result.kind,'slow-request');assert.equal(result.elapsedMs,5200);
});
