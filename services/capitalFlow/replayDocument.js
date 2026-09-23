const {createHash} = require('node:crypto');
const {replaySnapshots} = require('./cumulativeSnapshot');
const MAX_BYTES = 2 * 1024 * 1024;

function replayDocument(bytes, options = {}) {
  if (bytes.length > MAX_BYTES) throw new TypeError('input exceeds 2 MiB');
  const doc = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!doc || doc.version !== 'webstock.cumulative-replay/v1') throw new TypeError('replay document version mismatch');
  const records = replaySnapshots(doc.snapshots, options);
  return {version: 'webstock.cumulative-replay-result/v1', automaticTrading: false,
    provenance: {mode: 'offline-replay', verification: 'not-verified',
      inputSha256: createHash('sha256').update(bytes).digest('hex'),
      maxTradingGapMs: options.maxTradingGapMs ?? null,
      note: 'Input source labels are unverified claims; this does not authenticate an Eastmoney dark-flow feed.'},
    records};
}

module.exports = {replayDocument, MAX_BYTES};
