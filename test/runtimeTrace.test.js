const test=require('node:test');const assert=require('node:assert/strict');const diag=require('../services/runtimeDiagnostics');
test('database instrumentation preserves native statement chaining and values without logging SQL',()=>{
  const Database=require('better-sqlite3'),db=new Database(':memory:'),events=[];
  diag.install(event=>events.push(event));
  try {
    diag.instrumentDatabase(db);db.exec('CREATE TABLE sample(value TEXT)');
    const insert=db.prepare('INSERT INTO sample VALUES (?)');assert.equal(insert.run('PRIVATE_VALUE').changes,1);
    assert.deepEqual(db.prepare('SELECT value FROM sample').pluck().all(),['PRIVATE_VALUE']);
    assert.equal(db.prepare('SELECT value FROM sample').get().value,'PRIVATE_VALUE');
    assert.ok(events.some(e=>e.label?.startsWith('db.get.')));
    assert.ok(!JSON.stringify(events).includes('PRIVATE_VALUE'));assert.ok(!JSON.stringify(events).includes('SELECT'));
  }finally{diag.install(null);db.close();}
});
test('trace closes on throw and rejected promise without swallowing either error',async()=>{
  const events=[];diag.install(e=>events.push(e));
  try{assert.throws(()=>diag.trace('sync',()=>{throw Error('test');}),/test/);await assert.rejects(diag.trace('async',()=>Promise.reject(Error('test'))),/test/);assert.equal(events.filter(e=>e.type==='end').length,2);}
  finally{diag.install(null);}
});
test('HTTP labels exclude query values and numeric identifiers',()=>{
  assert.equal(diag.routeLabel({method:'GET',path:'/api/experts/123?token=PRIVATE'}),'GET /api/experts/:id');
});

test('native invocation span ends immediately and preserves the exact promise',async()=>{
  const events=[];diag.install(e=>events.push(e));
  try {
    const pending=Promise.resolve('ok');
    assert.equal(diag.traceSync('native.invoke',()=>pending),pending);
    assert.equal(events.at(-1).type,'end');
    assert.throws(()=>diag.traceSync('native.fail',()=>{throw Error('test');}),/test/);
    assert.equal(events.filter(e=>e.type==='end').length,2);
  }finally{diag.install(null);}
});
