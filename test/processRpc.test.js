const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createProcessRpc } = require('../electron/processRpc');

function pair(handlers) {
  const a = new EventEmitter(), b = new EventEmitter();
  for (const [from, to] of [[a, b], [b, a]]) {
    from.connected = true;
    from.send = (message, callback) => setImmediate(() => { to.emit('message', message); callback?.(); });
  }
  return { a, b, caller: createProcessRpc(a), receiver: createProcessRpc(b, handlers) };
}

test('private RPC returns values, forwards errors and rejects unknown/prototype methods', async t => {
  const p = pair({ add: (a, b) => a + b, fail() { throw new Error('expected failure'); } });
  t.after(() => { p.caller.close(); p.receiver.close(); });
  assert.equal(await p.caller.call('add', [2, 4]), 6);
  await assert.rejects(p.caller.call('fail'), /expected failure/);
  await assert.rejects(p.caller.call('constructor'), /Unknown/);
});

test('disconnect rejects pending calls without retrying writes', async t => {
  let calls = 0;
  const p = pair({ write() { calls++; return new Promise(() => {}); } });
  t.after(() => { p.caller.close(); p.receiver.close(); });
  const waiting = p.caller.call('write');
  const rejected = assert.rejects(waiting, /disconnect/i);
  await new Promise(r => setImmediate(r));
  p.a.emit('disconnect');
  await rejected;
  assert.equal(calls, 1);
});

test('bounded RPC timeout never repeats an operation', async t => {
  let calls = 0;
  const p = pair({ wait() { calls++; return new Promise(() => {}); } });
  t.after(() => { p.caller.close(); p.receiver.close(); });
  await assert.rejects(p.caller.call('wait', [], { timeoutMs: 30 }), /timed out/);
  assert.equal(calls, 1);
});
