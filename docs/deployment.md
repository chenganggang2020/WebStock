# WebStock 部署文档

本文档说明 WebStock 迁移到 OpenAI API 后的本地、PM2、Docker 和反向代理部署方式。真实 API Key 只能放在 `.env`、系统环境变量或部署平台 Secret 中，不要写入仓库。

## 环境变量

参考仓库根目录的 `.env.example`：

```bash
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5-mini
OPENAI_MAX_COMPLETION_TOKENS=4096
OPENAI_TIMEOUT_MS=120000
OPENAI_ENABLED=true
PORT=3000
NODE_ENV=development
```

Optional news provider:

```bash
NEWS_JSON_URL=https://example.com/webstock-news.json
```

`NEWS_JSON_URL` is optional. When it is set, WebStock registers an async JSON news provider before the built-in fallback provider. The endpoint may return a JSON array, `{ "items": [...] }`, or `{ "data": [...] }`. Each item can include `title`, `source`, `time`, `summary`, `link`, `type`, `relatedStocks`, and `relatedSectors`. If the endpoint is unavailable or returns invalid data, `/api/news` keeps serving fallback news and reports the provider failure in `GET /api/news?withMeta=1` metadata.

新增可选变量：

```bash
WEBSTOCK_DB_PATH=
```

`WEBSTOCK_DB_PATH` 未配置时默认使用 `data/webstock.db`。

默认不发送 `OPENAI_TEMPERATURE`。如果确认当前模型支持并确实需要设置温度，再同时配置 `OPENAI_SEND_TEMPERATURE=true` 和 `OPENAI_TEMPERATURE=0.3`。

## 本地启动

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

状态检查：

```bash
curl http://localhost:3000/ai-status
```

`/ai-status` 会返回 `enabled`、`provider`、`model`、`hasApiKey`，不会返回 API Key 原文。

## 测试命令

```bash
npm test
npm run test:portfolio
npm run test:frontend
```

## 数据库

服务启动时会自动执行 `db/init.sql` 并创建缺失表。当前工作台新增表包括：

- `recent_stocks`
- `sectors`
- `sector_leaders`
- `ai_screener_results`

## 无 Key 模拟模式

如果未设置 `OPENAI_API_KEY`，点击 AI 分析会进入 ChatGPT 交接模式。页面会显示 OpenAI API Key 缺失或无效，并展示完整 prompt，用户可以复制到 ChatGPT 或其他 OpenAI 兼容界面中手动分析。

## Smoke Test

```bash
npm run smoke:openai
```

未设置 `OPENAI_API_KEY` 时脚本会跳过并返回 0；设置真实 key 后会发起一次最小 OpenAI 调用，用于部署前人工验证。

## Docker 启动

```bash
cp .env.example .env
# 编辑 .env，填写 OPENAI_API_KEY
docker compose -f docker-compose.example.yml --env-file .env up -d --build
curl http://localhost:3000/ai-status
```

停止服务：

```bash
docker compose -f docker-compose.example.yml down
```

## PM2 启动

```bash
npm install -g pm2
cp .env.example .env
set -a && source .env && set +a
pm2 start server.js --name webstock --update-env
pm2 save
```

Windows PowerShell 可改用：

```powershell
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:OPENAI_MODEL="gpt-5-mini"
$env:PORT="3000"
pm2 start server.js --name webstock --update-env
pm2 save
```

## Nginx 反向代理

`/api/analysis-stream` 是 SSE 流式接口，反向代理需要关闭缓冲：

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

## 注意事项

- 系统不接入真实券商交易。
- 系统不保存证券账户密码。
- 所有 AI 和智能选股结果仅供研究学习，不构成投资建议。
- 外部行情和资讯失败时，前端会显示兜底状态或保留本地数据。

## 验收清单

- `.env` 被 `.gitignore` 排除。
- `ai-config.json` 不包含真实 key，默认指向 OpenAI。
- `npm test` 通过。
- `npm run test:portfolio` 通过。
- `npm run test:frontend` 通过。
- 无 key 时 AI 分析进入 ChatGPT 交接模式。
- 有 key 时 `/api/analysis-stream` 能流式输出。
- `/ai-status` 不泄露 API Key。
- Docker 容器能启动并访问 `/ai-status`。
