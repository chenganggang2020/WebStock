const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const iconv = require('iconv-lite');

const quoteTestDbPath = path.join(os.tmpdir(), 'webstock-quote-api-' + process.pid + '.db');
process.env.WEBSTOCK_DB_PATH = quoteTestDbPath;
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(quoteTestDbPath + suffix, { force: true }); } catch (error) {}
}
process.on('exit', function() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(quoteTestDbPath + suffix, { force: true }); } catch (error) {}
  }
});

function listen(app) {
  return new Promise(function(resolve, reject) {
    const server = app.listen(0, '127.0.0.1', function() { resolve(server); });
    server.once('error', reject);
  });
}

function request(server, requestPath) {
  return new Promise(function(resolve, reject) {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path: requestPath }, function(response) {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', function() {
        resolve({ statusCode: response.statusCode, json: JSON.parse(body) });
      });
    }).on('error', reject);
  });
}

function providerPayload() {
  const fields = new Array(32).fill('0');
  fields[0] = 'Ping An Bank';
  fields[1] = '10.00';
  fields[2] = '10.00';
  fields[3] = '10.05';
  fields[4] = '10.08';
  fields[5] = '9.98';
  fields[8] = '100000';
  fields[9] = '1005000';
  fields[30] = '2026-08-14';
  fields[31] = '10:00:00';
  return iconv.encode('var hq_str_sz000001="' + fields.join(',') + '";\n', 'gbk');
}

test('quote APIs expose bounded snapshot provenance without repeating the provider request', async t => {
  const originalGet = axios.get;
  let providerCalls = 0;
  axios.get = async function() {
    providerCalls += 1;
    return { data: providerPayload() };
  };
  t.after(function() { axios.get = originalGet; });

  const app = express();
  app.use('/api', require('../routes/market'));
  const server = await listen(app);
  t.after(function() { server.close(); });

  const waited = await request(server, '/api/quote?codes=000001');
  const local = await request(server, '/api/quote/snapshot?codes=000001');

  assert.equal(waited.statusCode, 200);
  assert.equal(waited.json.data[0].price, 10.05);
  assert.equal(waited.json.data[0].source, 'sina-public-quote');
  assert.match(waited.json.data[0].fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(waited.json.data[0].changedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(waited.json.data[0].nextRefreshAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(waited.json.meta.nextRefreshAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(waited.json.meta.upstreamMinIntervalMs, 3000);
  assert.equal(waited.json.meta.realtimeGuaranteed, false);

  assert.equal(local.statusCode, 200);
  assert.equal(local.json.data[0].price, 10.05);
  assert.equal(local.json.meta.refreshMode, 'background');
  assert.equal(providerCalls, 1);
});
