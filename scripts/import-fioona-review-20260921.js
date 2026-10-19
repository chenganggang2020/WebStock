const fs = require('node:fs/promises');
const path = require('node:path');
const { documentHash, documentBody } = require('../services/creatorIndustryService');
async function main() {
  const directory = path.resolve(__dirname, '../output/verification/capital-creator-chain-20260921');
  const files = process.argv.includes('--partial') ? ['fioona-analysis-part1.json'] : ['fioona-analysis-part1.json', 'fioona-analysis-part2.json'];
  const base = process.argv.includes('--production') ? 'http://127.0.0.1:3000' : 'http://127.0.0.1:43931';
  const source = JSON.parse(await fs.readFile(path.join(directory, 'author-4-observations.json'), 'utf8'));
  const rows = Array.isArray(source) ? source : source.data;
  const items = [];
  for (const file of files) {
    const data = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
    if (data.schema !== 'webstock.creator-industry-review/v1') throw new Error('Unexpected analysis schema');
    for (const item of data.items) {
      const row = rows.find(row => row.id === item.observationId);
      if (!row || items.some(old => old.observationId === item.observationId)) throw new Error('Unknown/duplicate observation ' + item.observationId);
      for (const relation of item.relations) {
        if (!documentBody(row).includes(relation.quote)) throw new Error('Quote mismatch: '+row.id);
        if (![relation.from, relation.to].every(value => relation.quote.toLowerCase().includes(value.toLowerCase()))) throw new Error('Entity mismatch: '+row.id);
      }
      items.push({ ...item, bodyHash: documentHash(row) });
    }
  }
  if (!process.argv.includes('--partial') && items.length !== 42) throw new Error('Expected exactly 42 reviewed documents');
  const summary = { documents: items.length, relations: items.reduce((sum,item)=>sum+item.relations.length,0), empty: items.filter(item=>!item.relations.length).length };
  console.log(JSON.stringify({ validated: summary, destination: base, apply: process.argv.includes('--apply') }));
  if (!process.argv.includes('--apply')) return;
  const response = await fetch(base + '/api/industry-chain/creators/4/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({schema:'webstock.creator-industry-review/v1',items,model:'ChatGPT existing conversation 6aa79528 / message 1e295441'}) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(JSON.stringify(result.error));
  console.log(JSON.stringify({ analyzed:result.data.analyzedCount, relations:result.data.relations.length, pending:result.data.pendingCount }));
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
