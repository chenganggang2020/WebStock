// Private parent/child IPC only. No HTTP endpoint or arbitrary module dispatch.
function createProcessRpc(channel, handlers = {}) {
  let sequence = 0, closed = false;
  const pending = new Map();

  function send(message) {
    return new Promise((resolve, reject) => {
      if (closed || channel.connected === false) return reject(new Error('Backend disconnected'));
      try { channel.send(message, error => error ? reject(error) : resolve()); }
      catch (error) { reject(error); }
    });
  }

  async function receive(message) {
    if (!message || message.protocol !== 'desktop-backend-v1' || !Number.isSafeInteger(message.id)) return;
    if (message.type === 'reply') {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else item.resolve(message.value);
      return;
    }
    if (message.type !== 'call' || closed) return;
    const reply = { protocol: 'desktop-backend-v1', type: 'reply', id: message.id };
    try {
      if (!Object.hasOwn(handlers, message.method) || typeof handlers[message.method] !== 'function') {
        throw new Error('Unknown backend method');
      }
      if (!Array.isArray(message.args)) throw new Error('Invalid backend arguments');
      reply.value = await handlers[message.method](...message.args);
    } catch (error) {
      reply.error = { message: String(error.message || error).slice(0, 2000), code: error.code };
    }
    try { await send(reply); } catch (_) { /* Disconnect rejects the caller's pending operations. */ }
  }

  function close(error = new Error('Backend disconnected')) {
    if (closed) return;
    closed = true;
    channel.removeListener('message', receive);
    channel.removeListener('disconnect', disconnected);
    channel.removeListener('exit', disconnected);
    channel.removeListener('error', close);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  function disconnected() { close(); }
  channel.on('message', receive);
  channel.on('disconnect', disconnected);
  channel.on('exit', disconnected);
  channel.on('error', close);

  function call(method, args = [], options = {}) {
    if (closed || channel.connected === false) return Promise.reject(new Error('Backend disconnected'));
    if (pending.size >= 64) return Promise.reject(new Error('Backend request queue is full'));
    const id = ++sequence;
    const timeoutMs = options.timeoutMs === undefined ? 30000 : options.timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        pending.delete(id);
        reject(new Error('Backend request timed out; operation was not retried'));
      }, timeoutMs) : null;
      pending.set(id, { resolve, reject, timer });
      send({ protocol: 'desktop-backend-v1', type: 'call', id, method, args }).catch(error => {
        const item = pending.get(id);
        if (item) { pending.delete(id); clearTimeout(item.timer); item.reject(error); }
      });
    });
  }
  return { call, close };
}

module.exports = { createProcessRpc };
