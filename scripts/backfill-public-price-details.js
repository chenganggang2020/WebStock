// Explicit bounded download only; does not load the app, a DB or any scheduler.
const path = require('node:path');
const fs = require('node:fs/promises');
const { createPublicPriceDetailService } = require('../services/publicPriceDetailService');

async function main() {
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1];
  if (!args.includes('--codes') || !args.includes('--output')) throw new Error('Usage: --codes 600519,000001 --output <cache-directory> [--date YYYY-MM-DD]');
  const codes = Array.from(new Set(value('--codes').split(',')));
  if (!codes.length || codes.length > 10 || codes.some(code => !/^[0356]\d{5}$/.test(code))) throw new Error('Use 1–10 supported six-digit codes');
  const cacheDir = path.resolve(value('--output'));
  const service = createPublicPriceDetailService({ cacheDir });
  const results = [];
  for (const code of codes) {
    try {
      const snapshot = await service.refresh(code, { tradingDate: args.includes('--date') ? value('--date') : undefined });
      const view = await service.list(code, { tradingDate: snapshot.tradingDate });
      const result = { code, tradingDate: snapshot.tradingDate, rawRecords: snapshot.records.length,
        pages: snapshot.rawPages.length, modalIntervalSeconds: snapshot.modalIntervalSeconds,
        paginationComplete: snapshot.paginationComplete, observedFiveSecondBars: view.rows.length,
        file: path.join(cacheDir, code, snapshot.tradingDate + '.json'), fetchedAt: snapshot.fetchedAt };
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      results.push({ code, error: error.message });
      console.error(code + ': ' + error.message);
      process.exitCode = 1;
    }
  }
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, 'download-' + Date.now() + '.json'), JSON.stringify(results, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
