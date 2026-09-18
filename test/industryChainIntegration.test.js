const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const app = require('../server');

function requestJson(server, requestPath) {
  return new Promise(function(resolve, reject) {
    const request = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath
    }, function(response) {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', function(chunk) { body += chunk; });
      response.on('end', function() {
        resolve({ status: response.statusCode, json: JSON.parse(body) });
      });
    });
    request.on('error', reject);
  });
}

test('main API exposes the evidence-backed industry-chain taxonomy', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(function(resolve) { server.once('listening', resolve); });
  t.after(function() { return new Promise(function(resolve) { server.close(resolve); }); });

  const response = await requestJson(server, '/api/industry-chain/taxonomy');
  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.ok(response.json.data.some(item => item.id === 'semiconductor'));
});

test('desktop UI exposes the industry-chain research page and loads its module', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

  assert.match(html, /data-main-view="industryChain"/);
  assert.match(html, /id="industryChainView"/);
  [
    'industryChainSearchInput',
    'industryChainSearchBtn',
    'industryChainCatalog',
    'industryChainStageMap',
    'industryChainConfirmed',
    'industryChainCandidates',
    'industryChainEvidenceState'
  ].forEach(function(id) { assert.match(html, new RegExp('id="' + id + '"')); });
  assert.match(html, /js\/modules\/industryChain\.js/);
  assert.match(appSource, /view === 'industryChain'/);
  assert.match(appSource, /IndustryChain\.load/);
  assert.match(worker, /\/js\/modules\/industryChain\.js/);
});
