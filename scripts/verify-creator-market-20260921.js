const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const detail = require('../services/publicPriceDetailService');
const out = path.resolve(__dirname, '../output/verification/capital-creator-chain-20260921');
async function main() {
  await fs.mkdir(out, { recursive: true });
  const report = { checkedAt: new Date().toISOString(), publicProbes: [] };
  for (const id of [4, 5]) {
    const response = await axios.get('http://127.0.0.1:3000/api/expert/channels/' + id + '/observations?limit=1000', { timeout: 30000 });
    const rows = response.data.data;
    await fs.writeFile(path.join(out, 'author-' + id + '-observations.json'), JSON.stringify(rows.map(row => ({
      id: row.id, title: row.title, sourceUrl: row.sourceUrl, publishedAt: row.publishedAt,
      mediaType: row.mediaType, transcript: row.transcript, content: row.content,
      asrStatus: row.mediaMetadata?.asr?.status, ocrStatus: row.mediaMetadata?.note?.status
    })), null, 2));
    report['author' + id] = { count: rows.length, video: rows.filter(r => r.mediaType === 'video').length,
      note: rows.filter(r => r.mediaType === 'note').length, transcript: rows.filter(r => r.transcript?.length > 80).length };
  }
  for (const code of ['sh600519', 'sz002080']) {
    try {
      const get = params => axios.get('https://stock.gtimg.cn/data/index.php', { params: { appn: 'detail', c: code, ...params },
        timeout: 8000, proxy: false, responseType: 'text', headers: { Referer: 'https://gu.qq.com/' }, transformResponse: [s => s] });
      const info = (await get({ action: 'info' })).data;
      const parsed = detail.parseInfo(info, code);
      const first = (await get({ p: 0, action: 'data' })).data;
      const rows = detail.parsePage(first, code, 0, parsed.tradingDate);
      const lastPage = parsed.ranges.length - 1;
      const last = (await get({ p: lastPage, action: 'data' })).data;
      const tail = detail.parsePage(last, code, lastPage, parsed.tradingDate);
      await fs.writeFile(path.join(out, code + '-public-probe.json'), JSON.stringify({ info, first, last, rows, tail }, null, 2));
      report.publicProbes.push({ code, date: parsed.tradingDate, pages: parsed.ranges.length,
        opening: rows.filter(row => row.phase === 'opening-result'), closing: tail.filter(row => row.phase === 'closing-result'),
        firstRecord: rows[0], lastRecord: tail.at(-1) });
    } catch (error) { report.publicProbes.push({ code, error: error.code || error.message }); }
  }
  await fs.writeFile(path.join(out, 'live-inventory.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
