# Test Report

## AI Platform And Cross-Device Release - 2026-08-09

- Node unit/API/integration regression: 93/93 passed. LAN pairing includes a non-loopback end-to-end exchange from unauthorized 401 through protected cookie to authorized 200.
- Python quant regression: 20/20 passed for factor orientation, MASTER sequences/training contracts, rolling purge windows, transaction costs, artifacts and universe filtering.
- Playwright regression: 5/5 passed for grounded AI research, main workspace actions, mobile dark mode, keyboard access and non-JSON API handling.
- Dependency audit against the official npm registry: 0 known vulnerabilities.
- Android release: Java tests, release lint, v2 signature verification, package/permission inspection, ADB installation, first-screen UI inspection, live Windows-host pairing and same-package upgrade reconnection passed. The visible saved address contained no pairing token. No Android runtime crash was present in the checked log window.
- Portable Windows smoke: app returned HTTP 200; quant runtime and paper portfolio APIs responded; isolated data directory was created.
- Formal portable database before/after build and smoke: SHA-256 `295B4E0F6C33BE936DED9CD4D4BE17A4B0DDA5F8914B51E0A3E4678C2E1B244C`.
- Release hashes: installer `C7CB9B67481E3D5449E5AB96337CBC6DC3E8EB060A8C1ADD1DD1C2DC9F72CFB8`; portable `21CA7E9C1535AE6514A63DA09BA1E1855FEA621AF860C4369730F6006212950C`; Android APK `C7BFFE881C5ECD7CD4458CC1174B583F02366245CF9C974C6D28C56D5BDCB088`.

Acceptance boundary: these checks prove software execution, persistence, traceability and packaging. They do not prove investment return or promote exploratory public-data model results to validated strategies.

## Latest Iteration Addendum

- Final verification addendum: after the 8-hour gate was reached, final checks passed: 47 JS syntax checks, `npm test` 14 tests, `npm run test:portfolio`, `npm run test:frontend`, duplicate-function audit, startup smoke, OpenAI smoke skip, official npm audit 0 vulnerabilities, `test-results` cleanup, and `git diff --check` with only LF-to-CRLF warnings.
- Portfolio CSV formula-prefix addendum: Portfolio CSV helper now prefixes formula-like cells before export. Playwright first failed against an unguarded `=Ping An Bank` name, then passed after `portfolioCsvCell()` added the protective apostrophe for positions and closed-position downloads. Latest `node --check js/modules/portfolio.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Frontend flake-check addendum: after the latest full green run, `npm run test:frontend` was run twice consecutively and passed both times; `test-results` was removed afterward and `git diff --check` still reported only LF-to-CRLF warnings.
- Dependency and portfolio smoke addendum: `npm run test:portfolio` passed. `npm audit --omit=dev` failed against the configured npmmirror audit endpoint because it is not implemented; rerunning the same read-only audit with `--registry=https://registry.npmjs.org/` found 0 vulnerabilities.
- Mobile trade coverage addendum: Mobile dark-mode Playwright coverage now opens the Trades view and verifies `resetTradeFiltersBtn` is visible. Latest `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Trade result summary addendum: Trades now show `tradesResultSummary` with matching count or filtered-empty text. Playwright first failed against the missing element, then passed after adding the summary and updating `Trades.renderTrades()`. Latest `node --check js/modules/trades.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- CSV download content addendum: Playwright now reads downloaded positions and closed-position CSV files and verifies expected headers plus `000001`/`000002` content, not just filenames. Latest `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Post-portfolio quality sweep addendum: `node --check` passed for 47 JavaScript files; duplicate top-level frontend function audit found 0 duplicates; `npm run smoke:openai` skipped cleanly without `OPENAI_API_KEY`; startup smoke returned `/ai-status` 200 with `hasApiKey:false` and model `gpt-5-mini`.
- Closed-position summary addendum: The closed-position review panel now shows count, total realized P/L, win rate, and wins/losses above the table. Playwright first failed against the missing `Win rate` text, then passed after deriving metrics from `State.closedPositions`. Latest `node --check js/modules/portfolio.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Trade filter empty-state addendum: Trades now distinguish "no records" from "filters matched nothing" by showing `No trades match current filters.` when active filters return no rows. Playwright first failed against the old empty text, then passed after updating `Trades.renderTrades()`. Latest `node --check js/modules/trades.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Trade filter reset addendum: Trades now expose `Reset filters`, clearing code, side, start date, and end date before reloading the full list. Playwright first failed against the missing button, then passed after adding `Trades.resetFilters()` and wiring the action. Latest `node --check js/app.js`, `node --check js/modules/trades.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Portfolio positions CSV export addendum: Portfolio now exports the current visible positions with a dated `webstock-positions-*` filename. Playwright first failed against the missing button/download, then passed after adding the button, app binding, and `Portfolio.exportPositionsCsv()`. Latest `node --check js/app.js`, `node --check js/modules/portfolio.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Closed-position CSV export addendum: Portfolio closed-position review rows now expose `Export CSV`, using escaped CSV cells and a dated `webstock-closed-positions-*` filename. Playwright creates and closes a separate temporary position, verifies the panel row, and verifies the download without removing the original statistics exposure. Latest `node --check js/modules/portfolio.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Date: 2026-05-12
- Added coverage: Settings tab, AI API status card, and saved ChatGPT handoff result rendering.
- Commands run: `node --check js/modules/settings.js`, `node --check js/app.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, `npm test`.
- Result: `npm run test:frontend` passed 2 tests; `npm test` passed 11 tests.
- Follow-up addendum: added user backup import/export API coverage. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- News hardening addendum: added Provider metadata, dedupe, cache status, and provider failure coverage. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Dashboard risk addendum: added browser coverage for watchlist alert-low and position drawdown risk rendering. A regression where `Dashboard.refreshCards()` was treated as a Promise was fixed. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Risk settings addendum: added browser coverage for saving configurable risk thresholds in Settings and reusing them in dashboard risk alerts. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Risk dismiss addendum: added browser coverage for "Dismiss today" on dashboard risk rows. A test race with dashboard async refresh was fixed by waiting for the dashboard view before injecting test risk data. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener history addendum: added API and browser coverage for saving current screener results and rendering saved history. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener history management addendum: added API and browser coverage for renaming/deleting saved screener tasks. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Frontend quality audit addendum: global top-level function duplicate check reports 0 duplicates across 21 frontend scripts; `node --check` passed for 43 JS files. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener AI linkage addendum: ChatGPT handoff save can update the active saved screener task `ai_result`; history cards show `AI saved`. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener AI display addendum: saved `ai_result` is rendered under the current screener result with HTML escaping. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Backup scope addendum: JSON backup export/import now includes saved screener tasks and linked AI explanations. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Backup preview addendum: added `/api/user/import-preview` and Settings import preview confirmation. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener compare addendum: added API coverage for comparing two saved screener tasks, including added candidates and score changes. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener compare UI addendum: exposed `Compare latest two` in the saved-history strip and added Playwright coverage for saving two screener tasks, comparing them, then continuing through ChatGPT handoff and cleanup. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener history detail addendum: added selected-pair comparison controls and a saved-task detail preview. Playwright now verifies latest comparison, details preview, selected comparison, ChatGPT handoff linkage, and deletion cleanup. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener export addendum: candidates now include `factorTags`, the UI renders factor chips, and `Export CSV` downloads the active candidate list. Playwright verifies the download event; Node tests verify factor tags. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener contribution addendum: candidates now include `factorBreakdown` with impact values, the UI renders contribution chips, saved-task details show contributions, and CSV includes the breakdown. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener candidate review addendum: added `screener_candidate_notes`, note/status APIs, and saved-task detail editing. Node tests verify create/list/delete; Playwright verifies Review prompts and rendering. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Backup candidate-note addendum: JSON backup export/import/preview now includes `screenerCandidateNotes` and maps old saved-result IDs to new imported IDs. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener review filter addendum: saved-task details now show review-status counts and support filtering by status. Playwright verifies the `priority` filter after saving a candidate note. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Dashboard review summary addendum: added `/api/screener/review-summary` and a dashboard "候选复核" card with priority/risk/todo counts. Node tests verify the API; Playwright verifies dashboard rendering. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Dashboard deep-link addendum: dashboard candidate-review rows now open the exact saved screener task detail. Playwright verifies the saved note is visible after using the dashboard Open action. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Screener bulk review addendum: added bulk status/note update for filtered saved candidates. Node tests verify the bulk notes API; Playwright verifies `Bulk mark filtered`. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Sector leader snapshot addendum: added `sector_leader_snapshots`, `/api/sector-leaders/snapshots`, dashboard-refresh snapshot recording, and a sector-panel History action. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Backup sector-snapshot addendum: JSON backup export/import/preview now includes `sectorLeaderSnapshots`. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Sector trend addendum: added `/api/sector-leaders/trends` and a sector-panel Trend view based on leader snapshots. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Sector history UI addendum: Playwright now clicks a sector leader History action and returns with Back before continuing sector edit/delete coverage. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Sector snapshot pruning addendum: added `DELETE /api/sector-leaders/snapshots?keepLatest=` and a `Prune snapshots` control. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Sector snapshot CSV addendum: added `Export snapshots CSV` and Playwright download coverage for sector leader snapshots. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Mobile coverage addendum: mobile dark-mode Playwright test now also opens sector leaders and portfolio views. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Accessibility polish addendum: added unified `focus-visible` styling for controls using the theme focus color. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Accessibility label addendum: added ARIA labels/titles for icon-only controls and Playwright assertions for search clear/theme buttons. Latest `npm test` passes 12 tests; latest `npm run test:frontend` passes 2 tests.
- Keyboard-flow addendum: added Playwright coverage for keyboard focus and Enter activation across search clear, theme toggle, main navigation, stock view, AI analysis, and analysis close. Latest `node --check test/frontend-click.spec.js` passed; latest `npm test` passed 12 tests; latest `npm run test:frontend` passed 3 tests.
- Dashboard risk review addendum: dismissed dashboard risks can now be shown and restored for the current day. Latest `node --check js/modules/dashboard.js` and `node --check test/frontend-click.spec.js` passed; latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- CSV template addendum: Settings now downloads watchlist and trades CSV templates, and Playwright verifies both filenames. Latest `node --check js/modules/settings.js`, `node --check test/frontend-click.spec.js`, and `node --check js/modules/dashboard.js` passed; latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Watchlist alert visibility addendum: watchlist rows now refresh quotes before evaluating alert thresholds and show alert status labels; the dashboard watchlist summary shows the same alert state. Latest `node --check js/modules/watchlist.js`, `node --check js/modules/dashboard.js`, and `node --check test/frontend-click.spec.js` passed; latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Detail alert addendum: stock detail now shows escaped watchlist notes plus alert state, and resets status classes when switching stocks. Latest `node --check js/modules/stockDetail.js`, `node --check test/frontend-click.spec.js`, and `node --check js/modules/watchlist.js` passed; latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Watchlist CSV export addendum: watchlist page exports the visible rows with alert and quote status, and Playwright verifies the download. Latest `node --check js/modules/watchlist.js`, `node --check js/app.js`, and `node --check test/frontend-click.spec.js` passed; latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Portfolio trade export and isolation addendum: portfolio page now downloads `webstock-trades.csv`, and tests delete their temp SQLite DB/WAL/SHM files before initialization. An initial `npm test` failed from stale recent-stock rows (`4 !== 1`); after the isolation fix, latest `npm test` passed 12 tests and latest `npm run test:frontend` passed 3 tests.
- Browser oversell addendum: Playwright now verifies that selling more than the current holding from a row-level sell action shows the oversell alert and does not save. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Sector add-flow addendum: Playwright now covers adding a sector leader through the sector card and verifies the new leader renders before continuing edit/delete/history/trend checks. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Recent CSV export addendum: Recent Stocks page exports code/name/price/change/view-count/time rows, and Playwright verifies the download. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Statistics overview addendum: Stats page now renders summary cards and top exposure rows in addition to charts. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Quality sweep addendum: `node --check` passed for 47 JavaScript files, and `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Screener strategy guidance addendum: Smart Screener now explains each strategy template and Playwright verifies the stable and breakout hints. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Sector role filter addendum: Sector Leaders now filters by role across cards/overview/risk modes, and Playwright verifies a newly added trend leader remains visible while other roles hide. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 12 tests.
- Optional JSON news provider addendum: News service now supports async JSON URL providers through `NEWS_JSON_URL` and a local HTTP-server test verifies normalization. Latest `npm test` passed 13 tests; latest `npm run test:frontend` passed 3 tests.
- JSON news deployment-doc addendum: `.env.example`, `docs/deployment.md`, and `docs/FEATURES.md` now document `NEWS_JSON_URL`, accepted JSON shapes, normalized item fields, and fallback behavior. Latest `npm test` passed 13 tests; latest `npm run test:frontend` passed 3 tests; `git diff --check` reported only LF-to-CRLF warnings.
- News keyword-filter addendum: `GET /api/news` now accepts `keyword`, the news service filters by type/keyword, and the front end refreshes on Enter. Node coverage verifies filter logic; Playwright verifies no-match empty state and a one-item Workbench match. Latest `npm test` passed 14 tests; latest `npm run test:frontend` passed 3 tests.
- Watchlist bulk-group addendum: Watchlist visible rows can be moved to a new group through `批量分组`, using existing update APIs. Playwright verifies the group change before CSV export/detail sync. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Closed-position review addendum: Portfolio service now derives closed positions from trades, `GET /api/portfolio/closed-positions` returns them, and the portfolio page shows a closed-position review panel. Service tests verify realized P/L after a complete buy/sell cycle; Playwright verifies the empty state. Latest `npm test` passed 14 tests; latest `npm run test:frontend` passed 3 tests.
- Trade amount preview addendum: The trade modal now shows live estimated outflow/inflow/dividend/fee values while editing. Playwright verifies buy and sell previews. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Screener result filter addendum: Active smart-screener results can be filtered locally by minimum score and keyword, with CSV export scoped to visible candidates. Playwright verifies filtered empty state and restored keyword match. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Sector keyword-filter addendum: Sector Leaders now filters by keyword across sector names, leader code/name, role, strength, notes, and reasons, composing with role filters. Playwright verifies the Added Leader keyword path. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Watchlist search-scope addendum: Watchlist search now matches group, note, alert prices, alert status, and quote status in addition to code/name. Playwright verifies a group-name match and empty no-match state. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Recent stocks search/sort addendum: Recent Stocks now supports code/name search and sorting by last viewed, view count, or change; CSV export follows visible rows. Playwright verifies match/no-match/sort/export. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Position search/sort addendum: Portfolio positions can now be searched by code/name and sorted by value, P/L, return, or code. The empty state distinguishes filter misses from no holdings. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- News refresh cache-bust addendum: News refresh now sends `cacheBust`, and `/api/news` forwards it to the service cache key. Node tests verify same-key caching and different-key refresh. Latest `npm test` passed 14 tests; latest `npm run test:frontend` passed 3 tests.
- Risk reset addendum: Settings can reset browser-local risk thresholds back to defaults. Playwright verifies custom save, reset status, and default values. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Screener filter reset addendum: Smart Screener result filters now have a reset button. Playwright verifies over-filtering to empty, resetting, and restoring candidate rows. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Dashboard refresh addendum: The workbench hero now exposes `刷新工作台`, wired to `Dashboard.load()`. Playwright verifies the button before dashboard-to-screener deep-link flow. Latest `npm run test:frontend` passed 3 tests; latest `npm test` passed 14 tests.
- Quality/startup sweep addendum: `node --check` passed for 47 JS files; duplicate top-level function audit found 0 duplicates across 41 frontend scripts; `npm run smoke:openai` skipped cleanly without `OPENAI_API_KEY`; startup smoke returned `/ai-status` 200 without exposing an API key.
- Dashboard refresh timestamp addendum: The dashboard refresh action now updates a visible `Last refreshed` timestamp after `Dashboard.load()`. Latest `node --check js/modules/dashboard.js`, `node --check test/frontend-click.spec.js`, `npm run test:frontend`, and `npm test` passed; `git diff --check` reported only LF-to-CRLF warnings.
- Dashboard refresh loading-state addendum: Manual workbench refresh now disables the button, sets `aria-busy`, uses `Dashboard.setRefreshStatus()` for transient/failure text, and restores the control after completion. Latest `node --check js/app.js`, `node --check js/modules/dashboard.js`, `node --check test/frontend-click.spec.js`, `npm test`, and `npm run test:frontend` passed; `git diff --check` reported only LF-to-CRLF warnings.

## 测试环境

- 日期：2026-05-12
- 平台：Windows / PowerShell
- Node.js：本机 `node`
- 浏览器测试：Playwright Chromium

## 已执行命令

```bash
npm test
npm run test:portfolio
npm run test:frontend
node -e "const app=require('./server'); const s=app.listen(0, async () => { const port=s.address().port; const r=await fetch('http://127.0.0.1:'+port+'/ai-status'); const j=await r.json(); console.log(JSON.stringify({status:r.status, hasApiKey:j.hasApiKey, enabled:j.enabled})); s.close(); });"
node -e "const app=require('./server'); const s=app.listen(0, async () => { const port=s.address().port; const r=await fetch('http://127.0.0.1:'+port+'/api/screener/run', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({strategy:'short-strong', marketSnapshot:[{code:'000001',price:11.28,change:4.2,amount:800000000}], limit: 3})}); const j=await r.json(); console.log(JSON.stringify({status:r.status, success:j.success, count:j.data && j.data.candidates.length})); s.close(); });"
node --check js/app.js
node --check js/modules/dashboard.js
node --check js/modules/sectorLeaders.js
node --check services/sectorService.js
node --check routes/sectors.js
```

## 结果

- `npm test`：通过，9 个 Node 测试全部通过。
- `npm run test:portfolio`：通过，Portfolio API smoke test passed。
- `npm run test:frontend`：通过，Playwright 验证查看、分析、自选添加/备注编辑、交易保存、持仓展示、智能选股 ChatGPT 交接保存、板块入口、龙头编辑/删除。
- Playwright 同时验证查看股票后会写入 `State.klineSnapshots`，智能选股可使用已查看股票的 K 线快照。
- 启动冒烟：通过，临时端口启动后 `/ai-status` 返回 200。
- 智能选股启动冒烟：通过，`/api/screener/run` 返回候选数量；Node 测试覆盖本地行情、K 线快照和 MACD 因子。
- Legacy market envelope：Node 测试覆盖 `/api/stocklist` 成功 envelope 和 `/api/kline` 失败 envelope。
- News Provider：Node 测试覆盖资讯 Provider 注册和 fallback 返回。
- 全局命名检查：Node 脚本确认 `js/modules` 与 `js/app.js` 没有重复顶层函数名。
- 移动端深色模式：Playwright 覆盖 390px 宽度下主题切换、工作台、行情和智能选股入口。
- `node --check`：关键新增前后端模块语法检查通过。

## 覆盖范围

- AI 配置和 OpenAI 调用封装。
- 服务启动和 `/ai-status`。
- 持仓计算与超卖校验。
- 最近查看 API。
- 资讯、板块、智能选股 API 成功响应格式。
- 前端关键点击：查看、分析、最近查看、自选、持仓、智能选股。

## 已知测试缺口

- 尚未覆盖板块龙头新增/编辑/删除的浏览器级流程。
- 尚未覆盖自选备注编辑、预警价触发状态。
- 尚未覆盖交易弹窗完整新增/删除浏览器流程。
- 智能选股当前缺少 K 线技术因子单元测试。
