const axios = require('axios');
const fs = require('fs');

let aiConfig = null;
let aiEnabled = false;

function isValidApiKey(key) {
  return typeof key === 'string' && /^sk-[A-Za-z0-9]{15,}$/.test(key);
}

function loadAIConfig() {
  try {
    const raw = fs.readFileSync('./ai-config.json', 'utf8');
    aiConfig = JSON.parse(raw);
    aiEnabled = !!aiConfig;
    console.log('[AI] 配置已加载，模型：' + (aiConfig.model || '未指定'));
  } catch (e) {
    aiConfig = null;
    aiEnabled = false;
    console.log('[AI] 未找到 ai-config.json，AI 分析不可用');
  }
}
loadAIConfig();

function getAIConfig() {
  return aiConfig;
}

function getAIEnabled() {
  return aiEnabled;
}

function createAIModelStream(prompt) {
  if (!aiConfig) throw new Error('AI 配置未加载');
  const { apiUrl, apiKey, model, maxTokens, temperature } = aiConfig;
  if (!apiUrl) throw new Error('AI API 地址未配置');

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

  const body = {
    model: model || '',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens || 2000,
    temperature: typeof temperature === 'number' ? temperature : 0.3,
    stream: true
  };

  return axios.post(apiUrl, body, {
    headers,
    timeout: 120000,
    responseType: 'stream'
  }).then(resp => resp.data);
}

async function callAIModel(prompt) {
  if (!aiConfig) throw new Error('AI 配置未加载');
  const { apiUrl, apiKey, model, maxTokens, temperature } = aiConfig;
  if (!apiUrl) throw new Error('AI API 地址未配置');

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

  const body = {
    model: model || '',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens || 2000,
    temperature: typeof temperature === 'number' ? temperature : 0.3
  };

  const resp = await axios.post(apiUrl, body, { headers, timeout: 60000 });
  if (resp.data && resp.data.choices && resp.data.choices.length > 0) {
    return resp.data.choices[0].message.content;
  }
  throw new Error('AI 返回数据格式异常：' + JSON.stringify(resp.data));
}

module.exports = {
  isValidApiKey,
  loadAIConfig,
  getAIConfig,
  getAIEnabled,
  createAIModelStream,
  callAIModel
};
