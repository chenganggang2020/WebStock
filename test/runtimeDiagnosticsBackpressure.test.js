const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const diagnostics=require('../services/runtimeDiagnostics');
const {createWatchdogState}=require('../electron/runtimeWatchdogState');

// Keep the real transport and watchdog state. Only the child IPC boundary and
// timers are fake: IPC completion callbacks cannot run during a synchronous burst.
function startHarness(t) {
  let now=0;const callbacks=[],intervals=[],delivered=[];
  const state=createWatchdogState({now:()=>now,stallMs:5000,graceMs:0});
  const child=new EventEmitter();child.connected=true;
  child.send=(message,callback)=>{
    delivered.push(message);
    if(message.type==='init'){callback?.();return true;}
    state.accept(message);if(callback)callbacks.push(callback);return true;
  };
  const filename=path.join(__dirname,'../electron/runtimeDiagnostics.js');
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    module,exports:module.exports,__dirname:path.dirname(filename),process,
    require:id=>id==='node:child_process'?{fork:()=>child}:
      id==='../services/runtimeDiagnostics'?diagnostics:require(id),
    setInterval:callback=>{intervals.push(callback);return {unref(){}};},
    clearInterval(){},setTimeout:()=>({unref(){}}),clearTimeout(){}
  },{filename});
  const observer=module.exports.startRuntimeDiagnostics({directory:'unused-test-directory',nativeCapture:false});
  t.after(()=>{observer.stop();diagnostics.install(null);});
  return {
    state,delivered,setNow:value=>{now=value;},pulse:()=>intervals[0](),
    flushCallbacks:()=>{while(callbacks.length)callbacks.shift()(null);}
  };
}

function completeBurstAtTransportBoundary() {
  // 254 paired events plus one breadcrumb leave one slot: begin fits, end does not.
  for(let i=0;i<127;i++)diagnostics.trace('db.get.completed-before-stall',()=>i);
  diagnostics.emit({type:'interaction',label:'chart.open'});
  return diagnostics.trace('db.get.completed-at-capacity',()=>42);
}

test('paired completed operations are not blamed for a later main stall',t=>{
  const harness=startHarness(t);
  assert.equal(diagnostics.trace('db.get.finished',()=>42),42);
  harness.setNow(6000);
  const incident=harness.state.tick();
  assert.equal(incident.kind,'main-stall');
  assert.deepEqual(incident.active,[]);
});

test('IPC saturation cannot attribute a main stall to an SQL span already completed before the next pulse',t=>{
  const harness=startHarness(t);
  assert.equal(completeBurstAtTransportBoundary(),42);
  // The traced query has returned. A separate native block can now prevent the
  // main's next timer/callback; the observer still ticks independently.
  harness.setNow(6000);
  const incident=harness.state.tick();
  assert.equal(incident.kind,'main-stall');
  assert.equal(incident.active.some(span=>span.label==='db.get.completed-at-capacity'),false,
    'A dropped end event must not turn a completed SQL query into active hang evidence');
});

test('loss notice survives a full IPC queue and invalidates stale spans after the queue drains',t=>{
  const harness=startHarness(t);
  assert.equal(completeBurstAtTransportBoundary(),42);
  harness.setNow(500);harness.pulse();
  harness.flushCallbacks();
  harness.setNow(1000);harness.pulse();harness.flushCallbacks();
  // An unrelated later stall must not inherit a query completed in the burst.
  harness.setNow(7000);
  const incident=harness.state.tick();
  assert.equal(incident.kind,'main-stall');
  assert.equal(incident.active.some(span=>span.label==='db.get.completed-at-capacity'),false,
    'The dropped-event counter was cleared before the observer received its loss notice');
});

test('SQL saturation leaves room for a later native span without repeated loss notices',t=>{
  const harness=startHarness(t);
  for(let i=0;i<1000;i++)diagnostics.trace('db.get.completed',()=>i);
  diagnostics.trace('native.wait',()=>{
    harness.setNow(6000);
    assert.ok(harness.state.tick().active.some(span=>span.label==='native.wait'));
  });
  assert.equal(harness.delivered.filter(message=>message.type==='dropped').length,1);
});

test('paired SQL backpressure retains the surrounding still-active transaction',t=>{
  const harness=startHarness(t);
  diagnostics.trace('douyin.capture.persist-batch',()=>{
    for(let i=0;i<1000;i++)diagnostics.trace('db.get.completed',()=>i);
    harness.setNow(6000);
    assert.deepEqual(harness.state.tick().active.map(span=>span.label),['douyin.capture.persist-batch']);
  });
});
