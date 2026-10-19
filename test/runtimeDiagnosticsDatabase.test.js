const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const diagnostics = require('../services/runtimeDiagnostics');

function harness(t) {
  const events = [];
  const db = new Database(':memory:');
  diagnostics.install(event => events.push(event));
  diagnostics.instrumentDatabase(db);
  t.after(() => { diagnostics.install(null); db.close(); });
  return { db, events };
}

test('database batch diagnostics bound event traffic and cover the entire transaction', t => {
  const { db, events } = harness(t);
  db.exec('CREATE TABLE sample (value INTEGER)');
  const insert = db.prepare('INSERT INTO sample VALUES (?)');
  const write = db.transaction(() => {
    for (let index = 0; index < 1000; index++) insert.run(index);
  });
  events.length = 0;
  write();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample').get().n, 1000);
  assert.ok(events.some(event => event.type === 'begin' && event.label === 'db.transaction'));
  assert.ok(events.length < 12, 'A batch must not send thousands of per-row diagnostic events');
});

test('transaction diagnostics remain active until native transaction wrapper returns', t => {
  const events = [];
  let activeDuringCommit = false;
  const fake = {
    prepare() { return {}; }, exec() {},
    transaction(work) {
      return function(...args) {
        const result = work.apply(this, args);
        const ended = new Set(events.filter(e => e.type === 'end').map(e => e.id));
        activeDuringCommit = events.some(e => e.label === 'db.transaction' && !ended.has(e.id));
        return result;
      };
    }
  };
  diagnostics.install(e => events.push(e));
  t.after(() => diagnostics.install(null));
  diagnostics.instrumentDatabase(fake);
  assert.equal(fake.transaction(value => value + 1)(4), 5);
  assert.equal(activeDuringCommit, true);
  assert.equal(events.filter(e => e.type === 'begin').length, events.filter(e => e.type === 'end').length);
});

test('transaction variants, receiver, nested rollback and subsequent standalone query are preserved', t => {
  const { db, events } = harness(t);
  db.exec('CREATE TABLE sample (value INTEGER)');
  const insert = db.prepare('INSERT INTO sample VALUES (?)');
  const inner = db.transaction(value => insert.run(value));
  const outer = db.transaction(function(value) { inner(value); return this.tag; });
  assert.equal(outer.database, db);
  assert.equal(outer.default, outer);
  for (const name of ['default', 'deferred', 'immediate', 'exclusive']) {
    assert.equal(outer[name].call({ tag: name }, 1), name);
    assert.equal(outer[name].immediate, outer.immediate);
  }
  const failing = db.transaction(() => { inner(99); throw new Error('rollback fixture'); });
  events.length = 0;
  assert.throws(() => failing(), /rollback fixture/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample').get().n, 4);
  const begun = events.filter(e => e.type === 'begin');
  const ended = new Set(events.filter(e => e.type === 'end').map(e => e.id));
  assert.ok(begun.every(e => ended.has(e.id)));
  assert.ok(begun.some(e => e.label.startsWith('db.get.')), 'Rollback must restore standalone diagnostics');
});

test('database instrumentation is idempotent and diagnostic failures cannot break a commit', t => {
  const { db, events } = harness(t);
  diagnostics.instrumentDatabase(db);
  const run = db.transaction(() => 42);
  events.length = 0;
  assert.equal(run(), 42);
  assert.equal(events.filter(e => e.type === 'begin').length, 1);
  diagnostics.install(() => { throw new Error('unavailable observer'); });
  assert.equal(run(), 42);
});

test('native commit failure rolls back nested writes and restores diagnostics for a successful retry', t => {
  const { db, events } = harness(t);
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE parent (id INTEGER PRIMARY KEY);
    CREATE TABLE child (parent_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)`);
  const insert = db.prepare('INSERT INTO child VALUES (?)');
  const nested = db.transaction(id => insert.run(id));
  let callbackFinished = false;
  const write = db.transaction(id => { nested.immediate(id); callbackFinished = true; });
  events.length = 0;
  assert.throws(() => write.exclusive(7), /FOREIGN KEY constraint failed/);
  assert.equal(callbackFinished, true, 'The error must occur at COMMIT, after the callback completed');
  assert.equal(db.inTransaction, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM child').get().n, 0);
  db.prepare('INSERT INTO parent VALUES (?)').run(7);
  write.deferred(7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM child').get().n, 1);
  const begun = events.filter(event => event.type === 'begin');
  const ended = new Set(events.filter(event => event.type === 'end').map(event => event.id));
  assert.equal(begun.filter(event => event.label === 'db.transaction').length, 2);
  assert.ok(begun.every(event => ended.has(event.id)));
  assert.ok(begun.some(event => event.label.startsWith('db.get.')));
});

test('instrumented transactions still reject promises, roll back, and allow the next synchronous transaction', t => {
  const { db, events } = harness(t);
  db.exec('CREATE TABLE sample (value INTEGER)');
  const insert = db.prepare('INSERT INTO sample VALUES (?)');
  const asyncWrite = db.transaction(async () => { insert.run(1); return 1; });
  events.length = 0;
  assert.throws(() => asyncWrite(), /Transaction function cannot return a promise/);
  assert.equal(db.inTransaction, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample').get().n, 0);
  db.transaction(() => insert.run(2))();
  assert.deepEqual(db.prepare('SELECT value FROM sample').all(), [{ value: 2 }]);
  const begun = events.filter(event => event.type === 'begin');
  const ended = new Set(events.filter(event => event.type === 'end').map(event => event.id));
  assert.ok(begun.every(event => ended.has(event.id)));
});
