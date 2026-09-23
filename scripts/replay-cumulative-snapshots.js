// Offline-only reader: no database, network, holdings or trading imports.
const fs = require('node:fs');
const {replayDocument, MAX_BYTES} = require('../services/capitalFlow/replayDocument');

async function main(args) {
  if (![2, 4].includes(args.length) || args[0] !== '--input' || !args[1] ||
    (args.length === 4 && args[2] !== '--max-gap-ms')) {
    throw new TypeError('Usage: node scripts/replay-cumulative-snapshots.js --input <file.json|-> [--max-gap-ms <positive integer>]');
  }
  const options = {};
  if (args.length === 4) {
    options.maxTradingGapMs = Number(args[3]);
    if (!/^\d+$/.test(args[3]) || !Number.isSafeInteger(options.maxTradingGapMs) || options.maxTradingGapMs <= 0) {
      throw new TypeError('max-gap-ms must be a positive safe integer');
    }
  }
  const stream = args[1] === '-' ? process.stdin : fs.createReadStream(args[1]);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new TypeError('input exceeds 2 MiB');
      chunks.push(chunk);
    }
  } finally {
    stream.destroy();
  }
  // Validate the whole batch before emitting anything. Never persist partial imports.
  process.stdout.write(JSON.stringify(replayDocument(Buffer.concat(chunks), options), null, 2) + '\n');
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write('Replay rejected: ' + error.message + '\n');
  process.exitCode = 1;
});

module.exports = {replayDocument};
