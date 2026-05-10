const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

let aiConfig = null;
let aiEnabled = false;

function normalizeBaseUrl(url) {
  return String(url || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function readJsonConfig() {
  try {
    const raw = fs.readFileSync('./ai-config.json', 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function isValidApiKey(key) {
  if (typeof key !== 'string') return false;
  const value = key.trim();
  if (!value || value.length < 20) return false;
  if (!value.startsWith('sk-')) return false;
  const lower = value.toLowerCase();
  if (
    lower.includes('你的apikey') ||
    lower.includes('your_api_key') ||
    lower.includes('your-api-key') ||
    lower.includes('your api key')
  ) {
    return false;
  }
  return true;
}

function loadAIConfig() {
  const fileConfig = readJsonConfig();
  const baseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL || fileConfig.baseUrl || fileConfig.apiBaseUrl || 'https://api.openai.com/v1');
  const maxCompletionTokens = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS || fileConfig.maxCompletionTokens || fileConfig.maxTokens || 4096);
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || fileConfig.timeoutMs || 120000);
  const temperature = process.env.OPENAI_TEMPERATURE !== undefined ? Number(process.env.OPENAI_TEMPERATURE) : fileConfig.temperature;

  aiConfig = {
    provider: 'openai',
    baseUrl,
    apiUrl: process.env.OPENAI_API_URL || fileConfig.apiUrl || `${baseUrl}/chat/completions`,
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || fileConfig.model || 'gpt-5-mini',
    maxCompletionTokens: Number.isFinite(maxCompletionTokens) ? maxCompletionTokens : 4096,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 120000,
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    sendTemperature: parseBool(process.env.OPENAI_SEND_TEMPERATURE, false),
    enabled: parseBool(process.env.OPENAI_ENABLED, fileConfig.enabled !== false)
  };

  aiEnabled = aiConfig.enabled;
  console.log(`[AI] OpenAI 配置已加载，模型：${aiConfig.model}，enabled=${aiEnabled}`);
  return aiConfig;
}
loadAIConfig();

function getAIConfig() {
  return aiConfig;
}

function getAIEnabled() {
  return aiEnabled;
}

function buildHeaders(config = aiConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (config && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function shouldSendTemperature(config) {
  if (!config || !config.sendTemperature) return false;
  return typeof config.temperature === 'number' && Number.isFinite(config.temperature);
}

function buildChatCompletionPayload(prompt, options = {}) {
  const config = options.config || aiConfig;
  if (!config) throw new Error('AI 配置未加载');

  const body = {
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: config.maxCompletionTokens || 4096,
    stream: !!options.stream
  };

  if (shouldSendTemperature(config)) {
    body.temperature = config.temperature;
  }

  return body;
}

function getAxiosErrorMessage(error) {
  const data = error && error.response && error.response.data;
  if (data && data.error && data.error.message) return data.error.message;
  if (typeof data === 'string') return data;
  return error && error.message ? error.message : '未知 AI 调用错误';
}

function assertReady() {
  if (!aiConfig) throw new Error('AI 配置未加载');
  if (!aiConfig.enabled) throw new Error('AI 功能未启用');
  if (!aiConfig.apiUrl) throw new Error('OpenAI API 地址未配置');
  if (!isValidApiKey(aiConfig.apiKey)) throw new Error('OpenAI API Key 缺失或无效');
}

function createAIModelStream(prompt) {
  assertReady();
  const body = buildChatCompletionPayload(prompt, { stream: true });

  return axios.post(aiConfig.apiUrl, body, {
    headers: buildHeaders(aiConfig),
    timeout: aiConfig.timeoutMs,
    responseType: 'stream'
  }).then(resp => resp.data).catch(error => {
    throw new Error(`OpenAI 流式调用失败：${getAxiosErrorMessage(error)}`);
  });
}

async function callAIModel(prompt) {
  assertReady();
  const body = buildChatCompletionPayload(prompt, { stream: false });

  try {
    const resp = await axios.post(aiConfig.apiUrl, body, {
      headers: buildHeaders(aiConfig),
      timeout: aiConfig.timeoutMs
    });
    const content = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message && resp.data.choices[0].message.content;
    if (content) return content;
    throw new Error('OpenAI 返回数据格式异常：' + JSON.stringify(resp.data));
  } catch (error) {
    if (error.message && error.message.startsWith('OpenAI 返回数据格式异常')) throw error;
    throw new Error(`OpenAI 调用失败：${getAxiosErrorMessage(error)}`);
  }
}

module.exports = {
  isValidApiKey,
  loadAIConfig,
  getAIConfig,
  getAIEnabled,
  buildChatCompletionPayload,
  buildHeaders,
  createAIModelStream,
  callAIModel
};
