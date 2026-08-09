# Project Context

Last reviewed: 2026-08-09 18:20 Asia/Shanghai

## Purpose

WebStock is a Windows-first A-share research workstation. It combines market views, watchlists, portfolio accounting, news, themes, local factor screening, ChatGPT handoff, optional OpenAI-compatible analysis, and Electron packaging.

The AI research direction is defined in `docs/ai-research/AI_PLATFORM_DESIGN.md`. WebStock remains the desktop orchestration layer; heavyweight Python/Linux research frameworks are optional sidecars rather than application startup dependencies.

## How To Run And Verify

- Install: `npm install`
- Web run: `npm start`
- Desktop run: `npm run desktop`
- Unit/API tests: `npm test`
- Browser tests: `npm run test:frontend`
- Quant tests: `npm run test:quant`
- Installer: `npm run dist:win`
- Portable package: `npm run dist:win:portable`

## Architecture Map

| Area | Path | Responsibility | Notes |
| --- | --- | --- | --- |
| Server entry | `server.js` | Local Express server and static assets | Mutating cross-origin requests are rejected |
| Desktop entry | `electron/main.js` | Electron window, runtime port, user data path | Installed and portable paths differ intentionally |
| Database | `db/index.js`, `db/init.sql` | SQLite initialization and schema | `WEBSTOCK_DB_PATH` overrides runtime database |
| API routes | `routes/` | HTTP boundary | Most new routes use `{ success, data/error }` envelopes |
| Domain services | `services/` | Portfolio, screener, news, themes, backup | Keep model/data logic outside route handlers |
| AI research | `services/knowledgeService.js`, `routes/aiResearch.js` | Expert sources, evidence retrieval, honest model registry and research runs | External model names remain planned until verified |
| Quant sidecar | `quant/`, `services/quantService.js`, `routes/quant.js` | Hashed datasets, isolated Qlib/LightGBM jobs, rolling evaluation and verified result import | Public Sina adapter is exploratory only |
| Frontend | `index.html`, `js/modules/`, `css/styles.css` | Vanilla JS desktop UI | Views are switched by `switchMainView` |
| Tests | `test/` | Node unit/API and Playwright flows | Tests use isolated temporary SQLite files |

## Core Flows

- Stock research: search -> stock selection -> quote/kline -> detail/AI/news.
- Local screening: scope + market/kline snapshots -> `screenerService` -> explainable candidates -> save/review/compare.
- AI handoff: server builds prompt -> `AIAssistant` copies/opens ChatGPT -> result block import -> local history/task linkage.
- Expert review: source text -> stable FTS evidence -> local screener candidates -> evidence-bearing AI handoff -> saved research run.
- Quant baseline: explicit universe -> hashed daily dataset -> purged rolling Qlib/LightGBM run -> artifact verification -> candidates/metrics/research run.
- Portfolio: trade records -> `portfolioService` accounting -> positions/PnL -> dashboard and exports.
- Backup: selected personal tables -> versioned JSON -> import preview -> replace/merge transaction.

## Algorithms And Domain Logic

- Portfolio accounting counts fees and taxes from each trade record. Overselling is rejected against chronological holdings.
- Screener missing data stays `null` and is reported through coverage; missing quotes must not be interpreted as zero movement.
- The all-market screener uses the local stock catalog plus personal/context records and excludes ST names.
- AI output is decision support. Direct API and ChatGPT handoff must share the same evidence-bearing prompt where practical.
- Quant results are net of configured turnover costs, preserve failed-symbol coverage, and cannot become `validated` when the dataset is marked `exploratory_only`.

## Data, Configuration, And External Systems

- SQLite: runtime user data, stock profiles, screener history and snapshots.
- Static catalogs: `stocks.json`, `funds.json`.
- AI: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`; API use is optional.
- Market/news data are external and may degrade; UI must expose source and availability instead of inventing values.
- Authorized Level-2 is optional and must use an official/local gateway.

## Current Risks And Assumptions

- External public data may be incomplete, rate-limited or delayed.
- A ChatGPT Pro subscription is not an API entitlement; handoff remains the no-extra-API-cost path.
- Qlib + LightGBM is connected as an isolated exploratory runtime. MASTER and agent frameworks remain planned; valid model claims still require licensed or terms-verified point-in-time data.
- Real brokerage execution remains out of scope.

## Verification Notes

- Fast check: `npm test`
- UI regression: `npm run test:frontend`
- Desktop data path safety: included in `npm test`
- Packaging checks must inspect both installer and portable outputs and must not delete `WebStockData`.
