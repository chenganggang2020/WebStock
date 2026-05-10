# WebStock 项目 OpenAI API 迁移、测试与部署开发文档

> 适用仓库：`xujh1969/WebStock`  
> 目标：把当前 DeepSeek 接入迁移为 OpenAI API 接入，补齐可自动化测试与部署能力，并保持现有前端 AI 流式分析体验可用。

---

## 1. 项目现状判断

### 1.1 技术栈

当前项目是一个单仓 Node.js + Express + 静态前端项目：

- 后端入口：`server.js`
- 路由汇总：`routes/index.js`
- AI 路由和分析逻辑：`routes/analysis.js`
- AI API 调用封装：`routes/ai.js`
- 前端 AI 面板：`js/modules/analysis.js`
- AI 配置文件：`ai-config.json`
- 启动脚本：`npm start` / `npm run dev`，均执行 `node server.js`

### 1.2 当前 AI 接入方式

当前 AI 接入是“类 OpenAI Chat Completions 协议”的 HTTP 接入，但默认配置指向 DeepSeek：

```json
{
  "apiUrl": "https://api.deepseek.com/v1/chat/completions",
  "apiKey": "sk-你的APIKey",
  "model": "deepseek-v4-pro",
  "maxTokens": 4096,
  "temperature": 0.3,
  "enabled": true
}
```

`routes/ai.js` 当前逻辑：

- 从 `./ai-config.json` 读取 `apiUrl`、`apiKey`、`model`、`maxTokens`、`temperature`。
- 使用 `axios.post(apiUrl, body, ...)` 调用聊天补全接口。
- 流式接口设置 `stream: true` 和 `responseType: 'stream'`。
- 非流式接口读取 `resp.data.choices[0].message.content`。
- `isValidApiKey()` 使用正则 `/^sk-[A-Za-z0-9]{15,}$/`，这会误拒绝部分 OpenAI 项目级 key，例如包含短横线的 `sk-proj-...`。

`routes/analysis.js` 当前逻辑：

- `/api/analysis`：非流式生成分析报告。
- `/api/analysis-stream`：SSE 流式输出 AI 分析。
- 当 API Key 无效时，进入模拟模式，返回完整 prompt 供用户手动复制。
- 该文件解析上游流式数据时使用 Chat Completions 的 SSE 格式：`choices[0].delta.content`。

`js/modules/analysis.js` 当前前端逻辑：

- 调用 `/api/analysis-stream?code=...&name=...`。
- 解析后端 SSE 输出的 `{ type: 'start' | 'chunk' | 'done' | 'simulated' | 'error' }`。
- 模拟模式提示文案仍然指向 DeepSeek 平台和 DeepSeek 对话窗口。

---

## 2. 迁移目标

### 2.1 核心目标

把项目从 DeepSeek 默认接入迁移为 OpenAI API 默认接入，同时保留现有体验：

1. 保持前端 `/api/analysis-stream` 流式输出不变。
2. 不在仓库内保存真实 API Key。
3. 使用环境变量优先配置 OpenAI。
4. 默认模型可用、成本可控。
5. 增加自动化测试，避免修改后无法判断是否成功。
6. 增加 Docker / PM2 / 云平台部署说明与部署产物。

### 2.2 推荐默认模型

建议默认使用：

```bash
OPENAI_MODEL=gpt-5-mini
```

原因：股票分析 prompt 比较长，`gpt-5-mini` 更适合作为成本与速度平衡的默认值。高质量模式可通过环境变量改为：

```bash
OPENAI_MODEL=gpt-5.5
```

注意：OpenAI GPT-5 系列对部分参数有兼容性要求。为了减少报错，默认不要向 GPT-5 系列发送 `temperature`；只在配置显式允许并确认模型支持时发送。

### 2.3 推荐 API 方式

本项目优先使用 OpenAI Chat Completions API，而不是立刻改为 Responses API。

原因：

- 现有 DeepSeek 调用代码已经是 Chat Completions 兼容结构。
- 现有流式解析逻辑已经按 `choices[0].delta.content` 处理。
- OpenAI Chat Completions 支持 SSE 流式输出。
- 迁移风险低，可以在后续版本再重构为 Responses API。

目标 OpenAI endpoint：

```text
https://api.openai.com/v1/chat/completions
```

---

## 3. Codex 执行要求

请 Codex 在仓库根目录执行以下任务。不得提交真实 API Key，不得把 `.env` 提交到版本库。

### 3.1 修改配置体系

#### 3.1.1 新增 `.env.example`

在仓库根目录新增：

```bash
# OpenAI
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5-mini
OPENAI_MAX_COMPLETION_TOKENS=4096
OPENAI_TIMEOUT_MS=120000
OPENAI_ENABLED=true

# Optional. For most GPT-5 family models keep this unset.
# OPENAI_TEMPERATURE=0.3

# Server
PORT=3000
NODE_ENV=development
```

#### 3.1.2 更新 `.gitignore`

确保包含：

```gitignore
.env
.env.*
!.env.example
analysis.md
node_modules/
npm-debug.log*
.DS_Store
```

如果仓库已有 `.gitignore`，合并而不是覆盖。

#### 3.1.3 更新 `ai-config.json`

不要继续在 `ai-config.json` 中放 API Key。建议把它改为非敏感默认值：

```json
{
  "comment": "AI 配置默认值。真实 OpenAI API Key 请使用环境变量 OPENAI_API_KEY，不要写入仓库。",
  "provider": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-5-mini",
  "maxCompletionTokens": 4096,
  "enabled": true
}
```

也可以新增 `ai-config.example.json`，但必须保证真实 key 不进入仓库。

### 3.2 更新依赖与脚本

修改 `package.json`：

1. 增加 `dotenv`。
2. 增加测试脚本。
3. 保留原有 `npm start`。
4. 增加可选 smoke test 脚本。

建议结果：

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "test": "node --test",
    "smoke:openai": "node scripts/smoke-openai.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.18.2",
    "iconv-lite": "^0.7.2",
    "tiny-pinyin": "^1.3.2"
  }
}
```

版本号可由 Codex 使用 `npm install dotenv` 自动生成，以实际 lockfile 为准。

### 3.3 重构 `routes/ai.js`

目标：让 AI 调用模块 OpenAI 化、可测试、可配置、可兼容流式与非流式。

#### 3.3.1 必须实现的行为

`routes/ai.js` 应做到：

1. `require('dotenv').config()`，支持 `.env`。
2. 优先读取环境变量，其次读取 `ai-config.json` 作为非敏感默认值。
3. 生成最终配置：
   - `provider: 'openai'`
   - `baseUrl: process.env.OPENAI_BASE_URL || aiConfig.baseUrl || 'https://api.openai.com/v1'`
   - `apiUrl: normalizedBaseUrl + '/chat/completions'`
   - `apiKey: process.env.OPENAI_API_KEY || ''`
   - `model: process.env.OPENAI_MODEL || aiConfig.model || 'gpt-5-mini'`
   - `maxCompletionTokens: Number(process.env.OPENAI_MAX_COMPLETION_TOKENS || aiConfig.maxCompletionTokens || aiConfig.maxTokens || 4096)`
   - `timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 120000)`
   - `enabled: OPENAI_ENABLED !== 'false' && aiConfig.enabled !== false`
4. `isValidApiKey()` 不再使用只允许字母数字的正则。应接受 `sk-` 开头且长度合理的 key，并拒绝空字符串、`sk-你的APIKey`、`sk-your-api-key` 等占位值。
5. 构建请求体时使用：
   - `model`
   - `messages: [{ role: 'user', content: prompt }]`
   - `max_completion_tokens`
   - `stream: true/false`
6. 对 GPT-5 系列默认不要发送 `temperature`，避免参数兼容问题。若后续确实要发送，必须通过显式环境变量开关，例如 `OPENAI_SEND_TEMPERATURE=true`。
7. `createAIModelStream(prompt)` 继续返回上游 `resp.data` stream。
8. `callAIModel(prompt)` 继续返回 `choices[0].message.content`。
9. 上游错误应尽可能把 `response.data.error.message` 暴露到后端错误日志与返回错误中，方便定位。
10. 导出纯函数，便于测试：
    - `isValidApiKey`
    - `loadAIConfig`
    - `getAIConfig`
    - `getAIEnabled`
    - `buildChatCompletionPayload`
    - `buildHeaders`
    - `createAIModelStream`
    - `callAIModel`

#### 3.3.2 建议实现骨架

Codex 可自行实现，但需要满足下面等价行为：

```js
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
  if (lower.includes('你的apikey') || lower.includes('your_api_key') || lower.includes('your-api-key')) return false;
  return true;
}

function loadAIConfig() {
  const fileConfig = readJsonConfig();
  const baseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL || fileConfig.baseUrl || fileConfig.apiBaseUrl || 'https://api.openai.com/v1');
  const maxCompletionTokens = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS || fileConfig.maxCompletionTokens || fileConfig.maxTokens || 4096);
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || fileConfig.timeoutMs || 120000);

  aiConfig = {
    provider: 'openai',
    baseUrl,
    apiUrl: process.env.OPENAI_API_URL || fileConfig.apiUrl || `${baseUrl}/chat/completions`,
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || fileConfig.model || 'gpt-5-mini',
    maxCompletionTokens: Number.isFinite(maxCompletionTokens) ? maxCompletionTokens : 4096,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 120000,
    temperature: process.env.OPENAI_TEMPERATURE !== undefined ? Number(process.env.OPENAI_TEMPERATURE) : fileConfig.temperature,
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

async function createAIModelStream(prompt) {
  assertReady();
  const body = buildChatCompletionPayload(prompt, { stream: true });
  try {
    const resp = await axios.post(aiConfig.apiUrl, body, {
      headers: buildHeaders(aiConfig),
      timeout: aiConfig.timeoutMs,
      responseType: 'stream'
    });
    return resp.data;
  } catch (error) {
    throw new Error(`OpenAI 流式调用失败：${getAxiosErrorMessage(error)}`);
  }
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
```

Codex 可以优化该实现，但不能改变上述外部行为。

### 3.4 更新 `routes/analysis.js`

保留现有 `/api/analysis` 和 `/api/analysis-stream` 路由。

必须修改：

1. 所有 “DeepSeek” 文案改为 “OpenAI”。
2. 错误提示从 `AI 配置未加载，请检查 ai-config.json 是否存在` 改为更准确：
   - `OpenAI 配置未加载，请检查 OPENAI_API_KEY / ai-config.json`。
3. 当 API Key 无效时，模拟模式仍然返回 prompt，但提示文案必须指向 OpenAI，而不是 DeepSeek。
4. `generateAIAnalysis()` 中的模拟模式判断继续使用 `isValidApiKey(aiConfig && aiConfig.apiKey)`。
5. `analysis.md` 继续只记录 prompt，不记录 API Key。
6. SSE 解析上游 Chat Completions 事件的逻辑可以保留，但需增强健壮性：
   - 如果 `parsed.choices` 为空，忽略。
   - 如果 `delta.content` 不存在，忽略。
   - 收到 `[DONE]` 时发送 `{ type: 'done' }` 后不要继续写 chunk。

### 3.5 更新前端 `js/modules/analysis.js`

必须修改模拟模式提示：

- “AI 模拟模式 - API Key 缺失或无效” 保留。
- “DeepSeek 对话窗口” 改为 “OpenAI / ChatGPT 对话窗口”。
- “DeepSeek 开放平台” 改为 “OpenAI Platform”。
- `ai-config.json` 配置提示改为 `.env` 环境变量提示。

推荐替换文案：

```html
<div style="font-weight:bold;margin-bottom:10px;font-size:15px;">⚠️ AI 模拟模式 - OpenAI API Key 缺失或无效</div>
<div style="margin-bottom:8px;">由于 OpenAI API Key 配置缺失或错误，系统无法调用 OpenAI API 进行分析。</div>
<div style="margin-bottom:8px;">下方已生成完整的分析提示词，您可以复制到 ChatGPT 或其他 OpenAI 兼容界面中手动分析。</div>
<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ffeeba;">
  <div style="font-weight:bold;margin-bottom:6px;">💡 如何配置 API Key？</div>
  <div>在部署环境中设置 <code>OPENAI_API_KEY</code>，本地开发可复制 <code>.env.example</code> 为 <code>.env</code> 后填写。</div>
</div>
```

### 3.6 更新 `server.js`

目标：支持部署平台动态端口，且便于测试。

建议改为：

```js
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { getAIEnabled, getAIConfig } = require('./routes/ai');

const app = express();
app.use(cors());
app.use(express.static(__dirname));
app.use(routes);

app.get('/ai-status', function (req, res) {
  const config = getAIConfig();
  res.json({
    enabled: getAIEnabled(),
    provider: config ? config.provider : null,
    model: config ? config.model : null,
    hasApiKey: !!(config && config.apiKey)
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, function () {
    console.log('Server started: http://localhost:' + PORT);
  });
}

module.exports = app;
```

注意：`/ai-status` 绝不能返回 API Key 原文。

---

## 4. 自动化测试要求

当前项目没有测试。Codex 必须新增最小测试集，且 `npm test` 必须通过。

### 4.1 新增 `test/ai.test.js`

使用 Node 内置测试框架：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
```

建议覆盖：

1. `isValidApiKey()`：
   - 接受 `sk-proj-abcdefghijklmnopqrstuvwxyz1234567890`。
   - 接受 `sk-abcdefghijklmnopqrstuvwxyz1234567890`。
   - 拒绝空字符串。
   - 拒绝 `sk-你的APIKey`。
   - 拒绝 `sk-your-api-key`。
2. `buildChatCompletionPayload()`：
   - `stream: true` 时包含 `stream: true`。
   - 使用 `max_completion_tokens`，不是 `max_tokens`。
   - 默认不发送 `temperature`。
   - `messages[0].role === 'user'`。
3. `buildHeaders()`：
   - Authorization 格式为 `Bearer ${key}`。
4. `callAIModel()`：
   - mock `axios.post` 返回 `{ choices: [{ message: { content: 'ok' } }] }`。
   - 断言请求 URL 为 `https://api.openai.com/v1/chat/completions`。
   - 断言请求 body 包含正确模型。
   - 断言返回 `ok`。
5. 错误处理：
   - mock `axios.post` 抛出 `{ response: { data: { error: { message: 'bad key' } } } }`。
   - 断言错误消息包含 `bad key`。

### 4.2 新增 `test/server.test.js`

测试 `/ai-status`：

- 启动 app 到随机端口。
- 请求 `/ai-status`。
- 断言状态码 200。
- 断言返回 JSON 包含 `enabled`、`provider`、`model`、`hasApiKey`。
- 断言响应体不包含 `OPENAI_API_KEY` 的真实值。

可以不用 `supertest`，直接使用 Node 内置 `http` 模块。

### 4.3 新增可选 smoke test

新增 `scripts/smoke-openai.js`：

- 如果没有 `OPENAI_API_KEY`，打印 `OPENAI_API_KEY is not set, skip smoke test.` 并退出 0。
- 如果有 key，调用 `callAIModel('请用一句中文回复：WebStock OpenAI smoke test passed')`。
- 打印模型响应。

该脚本用于真实部署前人工验证，不应作为普通 `npm test` 的必需项。

---

## 5. 部署产物要求

### 5.1 修改端口配置

`server.js` 必须使用：

```js
const PORT = process.env.PORT || 3000;
```

### 5.2 新增 Dockerfile

新增 `Dockerfile`：

```Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
```

### 5.3 新增 `.dockerignore`

```dockerignore
node_modules
npm-debug.log
.env
.env.*
.git
.gitignore
analysis.md
coverage
.DS_Store
```

### 5.4 新增 `docker-compose.example.yml`

```yaml
services:
  webstock:
    build: .
    container_name: webstock
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      OPENAI_BASE_URL: https://api.openai.com/v1
      OPENAI_MODEL: gpt-5-mini
      OPENAI_MAX_COMPLETION_TOKENS: 4096
      OPENAI_TIMEOUT_MS: 120000
      OPENAI_ENABLED: "true"
    restart: unless-stopped
```

### 5.5 新增部署 README

新增 `docs/deployment.md`，包含以下内容。

#### 本地启动

```bash
git clone https://github.com/xujh1969/WebStock.git
cd WebStock
npm install
cp .env.example .env
# 编辑 .env，填写 OPENAI_API_KEY
npm test
npm start
```

访问：

```text
http://localhost:3000
```

#### Docker 启动

```bash
cp .env.example .env
# 编辑 .env，填写 OPENAI_API_KEY
docker compose -f docker-compose.example.yml --env-file .env up -d --build
```

#### PM2 启动

```bash
npm install -g pm2
cp .env.example .env
set -a && source .env && set +a
pm2 start server.js --name webstock --update-env
pm2 save
```

#### Nginx 反向代理注意事项

因为 `/api/analysis-stream` 是 SSE 流式接口，Nginx 必须关闭代理缓冲：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
}
```

---

## 6. 验收标准

Codex 完成后必须满足以下标准。

### 6.1 静态验收

- [ ] 仓库内没有真实 OpenAI API Key。
- [ ] `.env` 被 `.gitignore` 排除。
- [ ] `.env.example` 存在且字段完整。
- [ ] `ai-config.json` 不含真实 key，也不再默认指向 DeepSeek。
- [ ] 前端模拟模式文案不再出现 DeepSeek。
- [ ] 后端错误提示不再出现 DeepSeek。
- [ ] `server.js` 支持 `process.env.PORT`。
- [ ] `Dockerfile` 和 `.dockerignore` 存在。
- [ ] `docs/deployment.md` 存在。

### 6.2 自动化测试验收

必须执行并通过：

```bash
npm install
npm test
```

### 6.3 本地功能验收

设置真实 key 后：

```bash
cp .env.example .env
# 填写 OPENAI_API_KEY
npm start
```

访问：

```text
http://localhost:3000
```

检查：

- [ ] 页面能正常打开。
- [ ] 搜索股票可用。
- [ ] 点击 AI 分析后，`/api/analysis-stream` 返回流式内容。
- [ ] 浏览器中能逐步看到分析报告输出。
- [ ] `/ai-status` 返回模型名，但不返回 API Key。

### 6.4 无 key 模拟模式验收

删除或清空 `OPENAI_API_KEY` 后：

- [ ] 点击 AI 分析进入模拟模式。
- [ ] 页面显示 OpenAI API Key 缺失或无效。
- [ ] 可以复制完整 prompt。
- [ ] 页面不再出现 DeepSeek 链接或文案。

### 6.5 Docker 验收

```bash
docker compose -f docker-compose.example.yml --env-file .env up -d --build
curl http://localhost:3000/ai-status
```

检查：

- [ ] 容器正常启动。
- [ ] `/ai-status` 正常返回。
- [ ] 页面可访问。
- [ ] AI 分析可流式输出。

---

## 7. Codex 执行顺序建议

请按以下顺序执行，避免一次性修改过多导致定位困难。

1. 阅读并确认当前文件：
   - `package.json`
   - `server.js`
   - `routes/ai.js`
   - `routes/analysis.js`
   - `js/modules/analysis.js`
   - `.gitignore`
2. 修改配置和依赖：
   - `.env.example`
   - `.gitignore`
   - `package.json`
   - `ai-config.json`
3. 重构 `routes/ai.js`。
4. 更新 `routes/analysis.js` 文案和错误处理。
5. 更新 `js/modules/analysis.js` 模拟模式文案。
6. 更新 `server.js` 支持动态端口和 app export。
7. 新增测试：
   - `test/ai.test.js`
   - `test/server.test.js`
8. 新增 smoke test：
   - `scripts/smoke-openai.js`
9. 新增部署产物：
   - `Dockerfile`
   - `.dockerignore`
   - `docker-compose.example.yml`
   - `docs/deployment.md`
10. 执行：
    ```bash
    npm install
    npm test
    npm run smoke:openai
    ```
11. 若没有真实 key，`npm run smoke:openai` 应跳过并退出 0。
12. 最后输出修改摘要、测试结果和部署步骤。

---

## 8. 交付物清单

Codex 最终应交付以下文件变更：

```text
modified  package.json
modified  package-lock.json
modified  server.js
modified  routes/ai.js
modified  routes/analysis.js
modified  js/modules/analysis.js
modified  ai-config.json
modified  .gitignore
added     .env.example
added     test/ai.test.js
added     test/server.test.js
added     scripts/smoke-openai.js
added     Dockerfile
added     .dockerignore
added     docker-compose.example.yml
added     docs/deployment.md
```

如果仓库原本没有 `package-lock.json` 或 Codex 的包管理器行为不同，以实际结果为准，但必须保证 `npm install && npm test` 可通过。

---

## 9. 可直接复制给 Codex 的总提示词

下面这段可以直接作为 Codex 任务输入：

```text
你正在 xujh1969/WebStock 仓库中工作。目标是把项目从 DeepSeek 默认接入迁移为 OpenAI API 默认接入，并补齐自动化测试和部署产物。

请完成以下任务：

1. 不要提交任何真实 API Key。新增 .env.example，使用 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL、OPENAI_MAX_COMPLETION_TOKENS、OPENAI_TIMEOUT_MS、OPENAI_ENABLED、PORT 等环境变量。确保 .env 被 .gitignore 排除。
2. 更新 ai-config.json，使其只保留非敏感默认配置，默认 provider=openai，baseUrl=https://api.openai.com/v1，model=gpt-5-mini，maxCompletionTokens=4096，enabled=true，不再指向 DeepSeek。
3. 重构 routes/ai.js：使用 dotenv；优先读取环境变量，其次读取 ai-config.json；默认 endpoint 为 https://api.openai.com/v1/chat/completions；请求体使用 Chat Completions 格式，使用 max_completion_tokens；默认不要发送 temperature；支持 stream=true；支持非流式返回 choices[0].message.content；增强 OpenAI 错误信息提取；导出 isValidApiKey、loadAIConfig、getAIConfig、getAIEnabled、buildChatCompletionPayload、buildHeaders、createAIModelStream、callAIModel，便于测试。isValidApiKey 必须接受 sk-proj-... 形式，拒绝占位 key。
4. 保留 routes/analysis.js 的 /api/analysis 和 /api/analysis-stream 现有行为，但把所有 DeepSeek 文案改为 OpenAI，模拟模式仍返回完整 prompt，analysis.md 不能记录 API Key。增强流式解析健壮性。
5. 更新 js/modules/analysis.js，把模拟模式中 DeepSeek 对话窗口、DeepSeek 开放平台等文案改为 OpenAI / ChatGPT / OPENAI_API_KEY / .env 相关说明。
6. 更新 server.js：支持 process.env.PORT || 3000；导出 app；只有 require.main === module 时才 listen；/ai-status 返回 enabled、provider、model、hasApiKey，但绝不返回 key 原文。
7. package.json 新增 dotenv，新增 scripts：test=node --test，smoke:openai=node scripts/smoke-openai.js。保留 start/dev。
8. 新增 Node 内置测试：test/ai.test.js 和 test/server.test.js。测试 key 校验、payload、headers、mock axios 调用、OpenAI 错误提取、/ai-status 不泄漏 key。npm test 必须通过，不依赖真实 OpenAI API Key。
9. 新增 scripts/smoke-openai.js：没有 OPENAI_API_KEY 时跳过并退出 0；有 key 时发起一次极小 OpenAI 调用验证。
10. 新增 Dockerfile、.dockerignore、docker-compose.example.yml、docs/deployment.md。Docker 使用 node:20-alpine，npm ci --omit=dev，暴露 3000，通过环境变量注入 OPENAI_API_KEY。
11. 执行 npm install、npm test，并在最后报告测试结果、主要修改点、如何本地部署、如何 Docker 部署。

验收标准：仓库内没有真实 key；页面和接口不再出现 DeepSeek 默认接入文案；npm test 通过；没有 key 时进入 OpenAI 模拟模式；有 key 时 /api/analysis-stream 能流式输出；/ai-status 不泄露 key；Docker 可构建运行。
```

---

## 10. 风险与注意事项

1. 该项目股票行情依赖新浪财经、东方财富等公开接口；这些接口可能有反爬、限流或字段变化，测试不要依赖真实行情网络请求。
2. AI 分析报告包含投资相关内容，页面和 prompt 中应保留“不构成投资建议”的免责声明。
3. OpenAI API Key 必须只放在环境变量或部署平台 Secret 中。
4. SSE 流式接口部署到 Nginx、Cloudflare、部分 PaaS 时可能被缓冲；需要关闭 proxy buffering，或选支持 SSE 的部署平台。
5. GPT-5 系列参数兼容性要谨慎：默认不要发送 `temperature`，优先使用 `max_completion_tokens`。
6. 若未来要迁移到 Responses API，应作为第二阶段重构，并同步改造上游流式事件解析，不要和本次低风险迁移混在一起。
```
