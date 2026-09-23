const test = require('node:test');
const assert = require('node:assert/strict');
const { rankDarkRows, parseMarketCaps } = require('../services/capitalFlow/darkRankBoard');
test('dark lists rank both signs, ratio uses same-day total cap not activity', () => {
  const rows = [{code:'600001',venue:'SH',darkNetCents:'10000',darkActivityRatio:.9},
    {code:'600002',venue:'SH',darkNetCents:'20000'}, {code:'600003',venue:'SH',darkNetCents:'-30000'},
    {code:'600004',venue:'SH',darkNetCents:null}];
  const caps = new Map([['sh600001',{date:'2026-09-18',totalMarketValue:1000}],
    ['sh600002',{date:'2026-09-17',totalMarketValue:100}],['sh600003',{date:'2026-09-18',totalMarketValue:3000}]]);
  const result = rankDarkRows(rows,caps,'2026-09-18','ratio');
  assert.equal(result.inflow[0].code,'600001'); assert.equal(result.inflow.length,1);
  assert.equal(result.outflow[0].darkMarketCapRatio,-.1);
  assert.equal(result.ratioMissing,2);
  assert.equal(rankDarkRows(rows,caps,'2026-09-18','amount').inflow[0].code,'600002');
});
test('market cap parser retains actual quote date and refuses empty/zero denominator', () => {
  const fields=Array(46).fill(''); fields[2]='600001'; fields[30]='20260918150000'; fields[45]='100';fields[37]='200';
  const caps=parseMarketCaps('v_sh600001="'+fields.join('~')+'";');
  assert.equal(caps.get('sh600001').date,'2026-09-18');
  assert.equal(caps.get('sh600001').totalMarketValue,1e10);
  assert.equal(caps.get('sh600001').amount,2e6);
  fields[45]=''; assert.equal(parseMarketCaps('v_sh600001="'+fields.join('~')+'";').size,0);
});
