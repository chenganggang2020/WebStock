const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const ai = require('../routes/ai');

const originalEnv = { ...process.env };
const originalPost = axios.post;

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
}

test.afterEach(() => {
  restoreEnv();
  axios.post = originalPost;
  ai.loadAIConfig();
});

test('isValidApiKey accepts OpenAI key formats and rejects placeholders', () => {
  assert.equal(ai.isValidApiKey('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890'), true);
  assert.equal(ai.isValidApiKey('sk-abcdefghijklmnopqrstuvwxyz1234567890'), true);
  assert.equal(ai.isValidApiKey(''), false);
  assert.equal(ai.isValidApiKey('sk-你的APIKey'), false);
  assert.equal(ai.isValidApiKey('sk-your-api-key'), false);
});

test('buildChatCompletionPayload uses OpenAI Chat Completions fields', () => {
  const payload = ai.buildChatCompletionPayload('hello', {
    stream: true,
    config: {
      model: 'gpt-5-mini',
      maxCompletionTokens: 123
    }
  });

  assert.equal(payload.model, 'gpt-5-mini');
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(payload.max_completion_tokens, 123);
  assert.equal(payload.stream, true);
  assert.equal('max_tokens' in payload, false);
  assert.equal('temperature' in payload, false);
});

test('buildHeaders returns bearer authorization when a key is configured', () => {
  const headers = ai.buildHeaders({ apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890' });

  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers.Authorization, 'Bearer sk-proj-abcdefghijklmnopqrstuvwxyz1234567890');
});

test('callAIModel posts to OpenAI chat completions and returns message content', async () => {
  process.env.OPENAI_API_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.OPENAI_MODEL = 'gpt-5-mini';
  process.env.OPENAI_MAX_COMPLETION_TOKENS = '32';
  ai.loadAIConfig();

  let captured = null;
  axios.post = async (url, body, options) => {
    captured = { url, body, options };
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  };

  const result = await ai.callAIModel('ping');

  assert.equal(result, 'ok');
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.body.model, 'gpt-5-mini');
  assert.equal(captured.body.messages[0].content, 'ping');
  assert.equal(captured.body.max_completion_tokens, 32);
  assert.equal(captured.options.headers.Authorization, 'Bearer sk-proj-abcdefghijklmnopqrstuvwxyz1234567890');
});

test('callAIModel surfaces OpenAI error messages', async () => {
  process.env.OPENAI_API_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
  ai.loadAIConfig();

  axios.post = async () => {
    throw { response: { data: { error: { message: 'bad key' } } } };
  };

  await assert.rejects(
    () => ai.callAIModel('ping'),
    /bad key/
  );
});
