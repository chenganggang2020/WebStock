# Project Context

Last reviewed: 2026-08-09 21:25 Asia/Shanghai

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
| AI research | `services/knowledgeService.js`, `services/decisionPacketService.js`, `routes/aiResearch.js`, `routes/researchDecision.js` | Expert sources, evidence retrieval, comparable-source decision packets, honest model registry and research runs | External agent frameworks remain planned until deployed and verified |
| Quant sidecar | `quant/`, `services/quantService.js`, `services/quantRuntimeInstaller.js`, `routes/quant.js` | Hashed datasets, isolated runtime installation, LightGBM/MASTER jobs, factor gates, rolling evaluation and verified result import | Public Sina adapter is exploratory only |
| Paper portfolio | `services/paperPortfolioService.js`, `services/quoteService.js`, `routes/researchDecision.js` | Constraint-capped weights, lot-rounded simulated entries, valuation/PnL snapshots and draft/active/archived states | No broker connection or real orders |
| Frontend | `index.html`, `js/modules/`, `css/styles.css` | Vanilla JS desktop UI | Views are switched by `switchMainView` |
| Tests | `test/` | Node unit/API and Playwright flows | Tests use isolated temporary SQLite files |

## Core Flows

- Stock research: search -> stock selection -> quote/kline -> detail/AI/news.
- Local screening: scope + market/kline snapshots -> `screenerService` -> explainable candidates -> save/review/compare.
- AI handoff: server builds prompt -> `AIAssistant` copies/opens ChatGPT -> result block import -> local history/task linkage.
- Expert review: source text -> stable FTS evidence -> local screener candidates -> evidence-bearing AI handoff -> saved research run.
- Quant baseline: explicit universe -> hashed daily dataset -> purged rolling Qlib/LightGBM run -> artifact verification -> candidates/metrics/research run.
- Model comparison: one immutable dataset -> identical folds/labels/costs -> LightGBM and MASTER -> honest same-data comparison.
- Factor gate: validation-only direction/weight selection -> untouched sample-out metrics -> stability/duplication/admission reasons -> eligible research candidates only.
- Evidence decision: comparable model ranks + local screener + expert/news evidence -> explicit data gaps -> ChatGPT Pro review handoff -> paper portfolio draft.
- Portfolio: trade records -> `portfolioService` accounting -> positions/PnL -> dashboard and exports.
- Backup: personal, knowledge, research and paper-portfolio tables -> versioned JSON -> import preview -> replace/merge transaction.

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
- Qlib + LightGBM, a same-contract MASTER reimplementation and the local factor gate are connected as exploratory research runtimes. Windows x64 can install or repair the pinned runtime from the AI Research view. AlphaAgent, RD-Agent(Q), TradingAgents and FinRL-X remain planned; valid model claims still require licensed or terms-verified point-in-time data.
- Real brokerage execution remains out of scope.

## Verification Notes

- Fast check: `npm test`
- UI regression: `npm run test:frontend`
- Desktop data path safety: included in `npm test`
- Packaging checks must inspect both installer and portable outputs and must not delete `WebStockData`.
