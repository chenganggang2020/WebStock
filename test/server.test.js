const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.OPENAI_API_KEY = 'sk-proj-serversecretabcdefghijklmnopqrstuvwxyz1234567890';
process.env.OPENAI_MODEL = 'gpt-5-mini';

const app = require('../server');

function requestJson(server, path) {
  const address = server.address();
  const port = address.port;

  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body, json: JSON.parse(body) }));
    });
    req.on('error', reject);
  });
}

test('/ai-status returns public OpenAI status without leaking the key', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, '/ai-status');

  assert.equal(result.statusCode, 200);
  assert.equal(typeof result.json.enabled, 'boolean');
  assert.equal(result.json.provider, 'openai');
  assert.equal(result.json.model, 'gpt-5-mini');
  assert.equal(result.json.hasApiKey, true);
  assert.equal(result.body.includes(process.env.OPENAI_API_KEY), false);
  assert.equal(result.body.includes('sk-proj-serversecret'), false);
});
