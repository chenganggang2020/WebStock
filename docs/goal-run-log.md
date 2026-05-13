# WebStock Goal Run Log

### Final Completion Audit
- Observation: the Goal runtime now exceeds the requested 8 hours, and all major workstation deliverables have concrete artifacts.
- Audit result:
  - Goal runtime: 28,834 seconds, about 8 hours 1 minute.
  - Objective checklist passed for click fixes, dashboard/workbench, recent stocks, watchlist, portfolio/trades, stock detail, news, sector leaders, smart screener, AI/ChatGPT handoff, docs, and tests.
  - Remaining TODO entries are future enhancements, not blockers for this Goal.
- Final verification:
  - 47 JavaScript files passed `node --check`.
  - `npm test` passed 14 tests.
  - `npm run test:portfolio` passed.
  - `npm run test:frontend` passed; repeated soak batches also passed.
  - Duplicate top-level frontend function audit found 0 duplicates.
  - Startup smoke returned `/ai-status` 200 with `hasApiKey:false`.
  - `npm run smoke:openai` skipped cleanly without an API key.
  - Official-registry `npm audit --omit=dev` found 0 vulnerabilities.
  - `test-results` was removed.
  - `git diff --check` reported only Windows LF-to-CRLF warnings.
- Review: the Goal is complete.

### Continued Iteration: Portfolio CSV Formula Prefix Guard
- Observation: newly added portfolio CSV exports could include user-entered names, so spreadsheet formula-style prefixes needed a small guard.
- Small goal: prevent position/closed-position CSV cells beginning with formula-like prefixes from being interpreted as formulas when opened in a spreadsheet.
- Code changes:
  - Updated `portfolioCsvCell()` to prefix cells that start with tab/newline or optional whitespace followed by `=`, `+`, or `@`.
  - Extended Playwright data setup to use `=Ping An Bank` and `=Export Test` names and verify the downloaded CSV content includes the protective apostrophe.
- Tests:
  - First `npm run test:frontend` failed as expected because `=Ping An Bank` was exported without the prefix.
  - `node --check js/modules/portfolio.js` and `node --check test/frontend-click.spec.js` passed after implementation.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the guard is limited to the new portfolio client-side CSV helper and does not alter backend trade export behavior. Current observed Goal runtime is 28,329 seconds, still below 8 hours.

### Continued Iteration: Mobile Trade Coverage
- Observation: the trades page gained new filter controls, but the mobile smoke path only covered portfolio entry.
- Small goal: ensure the trades page and reset filter control remain reachable at the 390px mobile viewport.
- Code changes:
  - Extended the mobile dark-mode Playwright test to open Trades and verify `resetTradeFiltersBtn`.
- Tests:
  - `node --check test/frontend-click.spec.js` passed.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this is test-only coverage for the new trades control on mobile. Current observed Goal runtime is 27,865 seconds, still below 8 hours.

### Continued Iteration: Trade Result Summary
- Observation: after adding trade filter reset and filtered-empty text, users still had no quick count of current trade results.
- Small goal: show a compact trade result summary that updates with the active filters.
- Code changes:
  - Added `tradesResultSummary` below the trades action bar.
  - Updated `Trades.renderTrades()` to show matching trade counts or filtered-empty text.
  - Extended Playwright coverage for both non-empty and no-match summary states.
- Tests:
  - First `npm run test:frontend` failed as expected because `#tradesResultSummary` was missing.
  - `node --check js/modules/trades.js` and `node --check test/frontend-click.spec.js` passed after implementation.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the summary is display-only and uses the same trade list already loaded by the page. Current observed Goal runtime is 27,512 seconds, still below 8 hours.

### Continued Iteration: CSV Download Content Assertions
- Observation: browser coverage verified CSV download events and filenames, but not the downloaded file contents.
- Small goal: strengthen the export regression by reading downloaded CSV files for positions and closed positions.
- Code changes:
  - Extended Playwright assertions to read the positions CSV and verify header/code content.
  - Extended Playwright assertions to read the closed-position CSV and verify header/code content.
- Tests:
  - `node --check test/frontend-click.spec.js` passed.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this is test-only coverage that gives stronger evidence for the data-portability exports added in the previous slices. Current observed Goal runtime is 27,291 seconds, still below 8 hours.

### Continued Iteration: Post-Portfolio Quality Sweep
- Observation: several portfolio/trade usability slices had landed in sequence, so a broad syntax/startup gate was useful before continuing.
- Small goal: verify global JavaScript syntax, frontend function-name hygiene, OpenAI smoke behavior, and server startup status.
- Code changes:
  - No runtime code changes in this sweep.
- Tests:
  - `node --check` passed for 47 JavaScript files.
  - Frontend duplicate top-level function audit found 0 duplicates.
  - `npm run smoke:openai` skipped cleanly because `OPENAI_API_KEY` is not set.
  - Startup smoke returned `/ai-status` HTTP 200 with `hasApiKey:false` and model `gpt-5-mini`.
- Review: no new blocking issue was found after the recent portfolio/trade increments. Current observed Goal runtime is 27,173 seconds, still below 8 hours.

### Continued Iteration: Closed Position Summary Metrics
- Observation: closed positions could be reviewed and exported, but the panel still required scanning individual rows to understand realized outcomes.
- Small goal: add lightweight summary metrics for closed-position count, total realized P/L, win rate, and wins/losses.
- Code changes:
  - Updated `Portfolio.renderClosedPositions()` to compute summary metrics from `State.closedPositions`.
  - Reused the existing `review-summary` chip styling for compact metrics above the table.
  - Extended Playwright coverage to verify the `Win rate` summary appears after a complete buy/sell cycle.
- Tests:
  - First `npm run test:frontend` failed as expected because the old panel did not render `Win rate`.
  - `node --check js/modules/portfolio.js` and `node --check test/frontend-click.spec.js` passed after implementation.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the metrics are derived from the same closed-position rows used by the table/export, so no new backend contract was needed. Current observed Goal runtime is 27,091 seconds, still below 8 hours.

### Continued Iteration: Trade Filter Empty State
- Observation: the trades page showed the same empty message for "no records" and "filters matched nothing".
- Small goal: make filtered-empty state explicit so users know they can reset filters instead of adding a new trade.
- Code changes:
  - Updated `Trades.renderTrades()` to set empty-state text from the current filter state.
  - Added Playwright coverage for a no-match trade code filter, followed by reset back to the full list.
- Tests:
  - First `npm run test:frontend` failed as expected because the old empty text was still shown.
  - `node --check js/modules/trades.js` and `node --check test/frontend-click.spec.js` passed after implementation.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this keeps the existing API behavior unchanged and only improves the browser-facing empty-state copy. Current observed Goal runtime is 26,909 seconds, still below 8 hours.

### Continued Iteration: Trade Filter Reset
- Observation: the trades page supported code/side/date filters, but clearing multiple filters required manual field-by-field cleanup.
- Small goal: add a one-click reset that restores all trade filters and reloads the full trade list.
- Code changes:
  - Added `Reset filters` to the trades action bar.
  - Added `Trades.resetFilters()` to clear code, side, start date, and end date filters before reloading trades.
  - Wired the reset button in `js/app.js`.
  - Extended Playwright coverage to filter to a sold temporary trade, reset filters, and verify the original trade is visible again.
- Tests:
  - First `npm run test:frontend` failed as expected on the missing `#resetTradeFiltersBtn`.
  - `node --check js/app.js`, `node --check js/modules/trades.js`, and `node --check test/frontend-click.spec.js` passed after implementation.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the reset uses the existing `loadTrades()` path, so export and table state continue to share the same filter collection behavior. Current observed Goal runtime is 26,735 seconds, still below 8 hours.

### Continued Iteration: Portfolio Positions CSV Export
- Observation: trade and closed-position export paths existed, but current open positions still required manual copying.
- Small goal: export the currently visible portfolio positions as CSV while preserving existing search/sort behavior.
- Code changes:
  - Added `Export positions CSV` in the portfolio action bar.
  - Wired the button in `js/app.js` to `Portfolio.exportPositionsCsv()`.
  - Added `Portfolio.exportPositionsCsv()` using visible positions, escaped CSV cells, and a dated `webstock-positions-*` filename.
  - Extended Playwright coverage to verify the positions CSV download after creating a holding.
- Tests:
  - First `npm run test:frontend` failed as expected while the new red test waited for the missing button/download.
  - `node --check js/app.js`, `node --check js/modules/portfolio.js`, and `node --check test/frontend-click.spec.js` passed after implementation.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this export follows the current filtered/sorted view rather than all raw positions, matching other visible-row CSV exports in the workstation. Current observed Goal runtime is 26,521 seconds, still below 8 hours.

### Continued Iteration: Closed Position CSV Export
- Observation: closed-position review existed, but realized P/L records could not be exported directly from the portfolio workflow.
- Small goal: add a focused CSV export for closed positions without changing backend storage or portfolio calculation contracts.
- Code changes:
  - Added portfolio CSV escaping/download helpers in `js/modules/portfolio.js`.
  - Added an `Export CSV` action to the closed-position review panel when rows exist.
  - Exposed `Portfolio.exportClosedPositionsCsv()` for direct testing/debugging use.
  - Added compact title-row styling for panel actions.
  - Extended Playwright coverage to create a separate temporary position, close it, export closed positions, and keep the original position available for statistics coverage.
- Tests:
  - `node --check js/modules/portfolio.js` and `node --check test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests after adjusting the test fixture to preserve the original exposure row.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the first browser run failed because the test sold the only position and invalidated later statistics assertions. The corrected test uses a separate `000002` buy/sell cycle for closed-position export. Current observed Goal runtime is 26,122 seconds, still below 8 hours.

### Continued Iteration: Dashboard Refresh Loading State
- Observation: the dashboard refresh action could now show completion time, but repeated clicks during an in-flight refresh were still possible.
- Small goal: make the manual dashboard refresh visibly busy, disable repeat clicks while loading, and keep a friendly failure status path.
- Code changes:
  - Added `aria-live` to `dashboardUpdatedAt`.
  - Added `Dashboard.setRefreshStatus()` for transient refresh/failure messages.
  - Added a capture-phase refresh handler that sets `aria-busy`, disables the button, restores it after completion, and reports failures.
  - Added disabled-button styling for small buttons and section buttons.
  - Extended Playwright assertions for restored button text, enabled state, and cleared `aria-busy`.
- Tests:
  - `node --check js/app.js`, `node --check js/modules/dashboard.js`, and `node --check test/frontend-click.spec.js`.
  - `npm test` passed 14 Node tests.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the historical dashboard click listener remains in the file, but the capture-phase handler stops propagation and prevents double refreshes. Current observed Goal runtime is 23,139 seconds, still below 8 hours.

### Continued Iteration: Dashboard Refresh Timestamp
- Observation: the workbench now had a manual refresh button, but the UI did not show whether the refresh had visibly completed.
- Small goal: add a lightweight last-refreshed timestamp to the dashboard hero without changing the data aggregation flow.
- Code changes:
  - Added `dashboardUpdatedAt` near the dashboard quick actions.
  - Added `dashboardSetUpdatedAt()` in `js/modules/dashboard.js` and call it after `dashboardLoad()`.
  - Extended Playwright coverage to click the dashboard refresh button and verify the timestamp text.
- Tests:
  - `node --check js/modules/dashboard.js` and `node --check test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this is a display-only status improvement and does not add a new backend path. Current observed Goal runtime is 22,756 seconds, still below 8 hours.

### Continued Iteration: Quality And Startup Sweep
- Observation: many small product slices had accumulated, so a broad quality gate was needed before continuing.
- Small goal: verify syntax, duplicate top-level function hygiene, OpenAI smoke behavior, and server startup.
- Code changes:
  - No runtime code change in this sweep; this was verification and review.
- Tests:
  - `node --check` passed for 47 JavaScript files.
  - Frontend top-level function duplicate audit checked 41 scripts and found 0 duplicates.
  - `npm run smoke:openai` passed by skipping because `OPENAI_API_KEY` is not set.
  - Startup smoke launched `server.js` through the Express app and `/ai-status` returned HTTP 200 with no API key leak.
- Review: no blocking quality issues were found. Current observed Goal runtime is 22,636 seconds, still below 8 hours.

### Continued Iteration: Dashboard Manual Refresh
- Observation: the workbench aggregates multiple modules but did not have an explicit manual refresh action.
- Small goal: add a clear refresh affordance on the workbench hero.
- Code changes:
  - Added `刷新工作台` to the dashboard quick actions.
  - Wired it to `Dashboard.load()` in `js/app.js`.
  - Extended Playwright coverage to click refresh before using a dashboard screener-review deep link.
- Tests:
  - `node --check js/app.js` and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this reuses existing dashboard refresh logic and does not add new data paths. Current observed Goal runtime is 22,555 seconds, still below 8 hours.

### Continued Iteration: Screener Filter Reset
- Observation: after adding smart-screener result filters, users could over-filter the table and needed to clear multiple controls manually.
- Small goal: add a one-click reset for active result filters.
- Code changes:
  - Added `重置过滤` beside screener result filters.
  - Added `StockScreener.resetAndRefreshResultFilters()`.
  - Extended Playwright coverage to over-filter, reset to defaults, and verify candidates return.
- Tests:
  - `node --check js/modules/stockScreener.js`, `js/app.js`, and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the reset only affects local view filters and does not mutate saved screener results. Current observed Goal runtime is 22,395 seconds, still below 8 hours.

### Continued Iteration: Risk Threshold Reset
- Observation: Settings allowed saving custom risk thresholds, but there was no quick way to restore defaults after experimentation.
- Small goal: add a local-only reset path for risk settings.
- Code changes:
  - Added `Reset defaults` in the Risk Thresholds settings card.
  - Added `Settings.resetRiskSettings()` to clear the localStorage key, restore default inputs, and refresh dashboard risk cards.
  - Extended Playwright coverage to save custom thresholds, reset them, and assert default values.
- Tests:
  - `node --check js/modules/settings.js` and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: no backend state is added; risk settings remain browser-local. Current observed Goal runtime is 22,282 seconds, still below 8 hours.

### Continued Iteration: News Manual Refresh Cache Busting
- Observation: `/api/news` had a 10-minute cache, but the front-end refresh button did not pass a cache-busting query and the route did not forward one to the service.
- Small goal: make manual News refresh bypass cache while keeping normal cached loads.
- Code changes:
  - Forwarded `cacheBust` through `routes/news.js`.
  - Added optional cache-bust generation in `js/modules/news.js`.
  - Updated the News refresh button handler to call `News.load({ cacheBust: true })`.
  - Added API coverage proving same `cacheBust` is cached and a different value refreshes.
- Tests:
  - `node --check routes/news.js`, `js/modules/news.js`, `js/app.js`, and `test/workbench-api.test.js`.
  - `npm test` passed 14 Node tests.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: dashboard/detail news still benefit from caching, while explicit page refresh now does what the user expects. Current observed Goal runtime is 22,091 seconds, still below 8 hours.

### Continued Iteration: Position Search And Sort
- Observation: the portfolio page showed position metrics but did not support local search/sort for larger portfolios.
- Small goal: add table-level position search/sort without touching P/L calculation or chart inputs.
- Code changes:
  - Added position sort and search controls.
  - Added `Portfolio.visiblePositions()` for local filtering/sorting.
  - Updated position empty state to distinguish no holdings from no filter matches.
  - Extended Playwright coverage for match, no-match empty state, sort selection, and export continuity.
- Tests:
  - `node --check js/modules/portfolio.js`, `js/app.js`, and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: calculations and charts still use the full position set; only the table display is filtered. Current observed Goal runtime is 21,976 seconds, still below 8 hours.

### Continued Iteration: Recent Stocks Search And Sort
- Observation: recent stocks were persisted and exportable, but the page lacked quick search/sort controls for longer history.
- Small goal: add local search/sort while keeping the recent-stocks API unchanged.
- Code changes:
  - Added recent-stock sort and search controls.
  - Added `visibleRecentItems()` for code/name filtering and sort by last viewed, view count, or change.
  - Updated recent CSV export to use the current visible rows.
  - Extended Playwright coverage for search match, no-match empty state, sort selection, and export continuity.
- Tests:
  - `node --check js/modules/recentStocks.js`, `js/app.js`, and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: local sorting/filtering avoids API churn and keeps persistence behavior unchanged. Current observed Goal runtime is 21,842 seconds, still below 8 hours.

### Continued Iteration: Watchlist Search Scope
- Observation: watchlist search only matched code/name even though the table displays group, note, alert prices, and alert/quote state.
- Small goal: let users find watchlist rows by the fields they can already see.
- Code changes:
  - Extended `visibleWatchlistItems()` keyword matching to include group, note, alert prices, alert status, and quote status.
  - Added Playwright coverage for searching by a bulk-assigned group and for the no-match empty state.
- Tests:
  - `node --check js/modules/watchlist.js` and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this is a render/filter change only and does not alter persisted watchlist data. Current observed Goal runtime is 21,712 seconds, still below 8 hours.

### Continued Iteration: Sector Leader Keyword Filtering
- Observation: sector leaders had role filtering and sorting, but no text filter for sector/leader/note lookup as the dashboard grows.
- Small goal: add local keyword filtering that composes with role filtering.
- Code changes:
  - Added `#sectorKeywordFilter` to the sector leader toolbar.
  - Added keyword matching across sector name, leader code/name, role, strength, note, and reason.
  - Updated card, overview, and risk rendering to use the combined role/keyword filter.
  - Extended Playwright coverage for keyword filtering after adding a leader.
- Tests:
  - `node --check js/modules/sectorLeaders.js`, `js/app.js`, and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this is a client-only filter and leaves sector APIs/data unchanged. Current observed Goal runtime is 21,589 seconds, still below 8 hours.

### Continued Iteration: Screener Result Filtering
- Observation: smart-screener candidates could be saved and reviewed, but active results had no quick local filter for score or text.
- Small goal: add client-side result filtering without changing backend scoring.
- Code changes:
  - Added minimum-score and keyword controls to the screener page.
  - Added local candidate filtering in `js/modules/stockScreener.js`.
  - Updated CSV export to export the currently visible filtered candidates.
  - Extended Playwright coverage for result count, empty filtered state, keyword filtering, and export continuity.
- Tests:
  - `node --check js/modules/stockScreener.js`, `js/app.js`, and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: filtering is local and does not change saved original screener results. Current observed Goal runtime is 21,435 seconds, still below 8 hours.

### Continued Iteration: Trade Amount Preview
- Observation: the trade modal accepted price, quantity, fees, and tax, but users had no immediate amount preview before saving.
- Small goal: add read-only estimated amount feedback in the trade modal without changing backend trade calculation.
- Code changes:
  - Added `#tradeAmountPreview` to the trade modal.
  - Added `Trades.calculateTradeAmount()` and `Trades.updateTradeAmountPreview()`.
  - Wired price, quantity, fee, tax, and side changes to refresh the preview.
  - Added Playwright assertions for buy outflow and sell inflow preview text.
- Tests:
  - `node --check js/modules/trades.js`, `js/app.js`, and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the preview mirrors existing backend amount semantics and remains informational only. Current observed Goal runtime is 21,084 seconds, still below 8 hours.

### Continued Iteration: Closed Position Review
- Observation: portfolio realized P/L existed in summary calculations, but fully closed positions were only discoverable by manually reading the trade ledger.
- Small goal: expose a read-only closed-position review panel without changing trade storage or broker-like behavior.
- Code changes:
  - Added `calculateClosedPositions()` and `getClosedPositions()` in `services/portfolioService.js`.
  - Added `GET /api/portfolio/closed-positions`.
  - Added a `Closed position review` panel to the portfolio page.
  - Extended service, API, and Playwright coverage for the new closed-position path and empty state.
- Tests:
  - `node --check services/portfolioService.js`, `routes/portfolio.js`, `js/modules/portfolio.js`, `test/portfolioService.test.js`, `test/workbench-api.test.js`, and `test/frontend-click.spec.js`.
  - `npm test` passed 14 Node tests.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: closed positions are derived from existing trades and do not store extra sensitive data. Current observed Goal runtime is 20,945 seconds, still below 8 hours.

### Continued Iteration: Watchlist Bulk Grouping
- Observation: watchlist rows supported individual group editing, but organizing a filtered set required opening each row one by one.
- Small goal: add a low-risk batch grouping action for the currently visible watchlist rows.
- Code changes:
  - Added `批量分组` to the watchlist action bar.
  - Added `Watchlist.bulkSetVisibleGroup()` to update all currently visible rows through existing parameter-bound update APIs.
  - Wired the action in `js/app.js`.
  - Extended Playwright coverage to edit one watchlist row, bulk-move visible rows to a new group, and continue through CSV export/detail sync.
- Tests:
  - `node --check js/modules/watchlist.js`, `js/app.js`, and `test/frontend-click.spec.js`.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `npm test` passed 14 Node tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: the feature reuses the existing watchlist update endpoint and does not add new storage or broad refactors. Current observed Goal runtime is 20,651 seconds, still below 8 hours.

### Continued Iteration: News Keyword Filtering And Empty State
- Observation: the News page had a keyword input, but it only populated stock code or sector parameters in specific modes and did not search titles, summaries, sources, or tags.
- Small goal: make the existing news search control genuinely useful while preserving provider fallback behavior.
- Code changes:
  - Added type/keyword filtering helpers in `services/newsService.js`.
  - Added `keyword` support to `GET /api/news`.
  - Updated `js/modules/news.js` to submit keyword searches and show item count/update metadata.
  - Added Enter-key refresh for `#newsKeywordInput` in `js/app.js`.
  - Extended Node and Playwright coverage for keyword matches and empty-state rendering.
- Tests:
  - `node --check services/newsService.js`, `routes/news.js`, `js/modules/news.js`, `js/app.js`, `test/frontend-click.spec.js`, and `test/workbench-api.test.js`.
  - `npm test` passed 14 Node tests.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: explicit filters can now return a friendly empty state instead of unrelated generic fallback items. Current observed Goal runtime is 20,491 seconds, still below 8 hours, so the Goal remains active.

### Continued Iteration: JSON News Provider Documentation
- Observation: optional `NEWS_JSON_URL` support was implemented and tested, but deployment-facing docs and `.env.example` did not yet expose the configuration contract.
- Small goal: document the provider format without changing runtime behavior.
- Code/doc changes:
  - Added commented `NEWS_JSON_URL` example to `.env.example`.
  - Documented supported JSON payload shapes and item fields in `docs/deployment.md`.
  - Added the optional provider to `docs/FEATURES.md`.
- Tests:
  - `npm test` passed 13 Node tests.
  - `npm run test:frontend` passed 3 Playwright tests.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
- Review: this is a documentation/configuration exposure pass. Current observed Goal runtime is 20,222 seconds, still below 8 hours, so the Goal remains active.

### Checkpoint / Interruption Note
- Observed Goal runtime before this checkpoint: 11,655 seconds, about 3 hours 14 minutes.
- This is below the requested 8 hours, so the Goal remains active and must not be marked complete.
- Interruption reason if execution stops here: the current Codex session cannot safely monopolize the workspace for a full 8 wall-clock hours in one response. Progress, TODO, and a continuation prompt are saved in `docs/GOAL_SUMMARY.md`, `docs/TODO_NEXT.md`, and `docs/continue-codex-goal-prompt.md`.

### Continued Iteration: Settings And Handoff Result Review
- Observation: the workspace had ChatGPT handoff persistence but no easy place to inspect saved results or the active AI API mode.
- Small goal: add a low-risk Settings page without touching chart or portfolio calculation code.
- Code changes:
  - Added `js/modules/settings.js`.
  - Wired Settings into `index.html` navigation and `js/app.js` view loading.
  - Added responsive Settings styles in `css/styles.css`.
  - Extended Playwright smoke coverage to open Settings and verify saved ChatGPT handoff output.
- Tests:
  - `node --check js/modules/settings.js`
  - `node --check js/app.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: the feature is intentionally browser-local for handoff results; no API key or brokerage credential storage was added. Goal is still active because elapsed work time remains below 8 hours.

### Continued Iteration: User Data Backup
- Observation: the workstation now has persistent personal data across recent stocks, watchlist, trades, sectors, and sector leaders, but no portable backup path.
- Small goal: add JSON export/import with validation and browser confirmation, without adding account credentials or brokerage integrations.
- Code changes:
  - Added `services/backupService.js` for structured export and validated import.
  - Added `GET /api/user/export` and `POST /api/user/import`.
  - Added Settings page export/import controls.
  - Added Node roundtrip coverage and Playwright button visibility checks.
- Tests:
  - `node --check services/backupService.js`
  - `node --check routes/user.js`
  - `node --check js/modules/settings.js`
  - `node --check test/workbench-api.test.js`
  - `npm test`
  - `npm run test:frontend`
- Review: import currently uses replace mode after confirmation. Future work should add conflict preview and CSV templates.

### Continued Iteration: News Provider Hardening
- Observation: the news module had a Provider abstraction and fallback data, but no metadata for cache hits, Provider failures, or dedupe results.
- Small goal: keep the default API backward-compatible while giving the frontend enough metadata to display source/degraded status.
- Code changes:
  - Reworked `services/newsService.js` to normalize and deduplicate items.
  - Added `listNewsWithMeta()` and optional `GET /api/news?withMeta=1`.
  - Added frontend Provider status display on the News page and status lines in rendered news collections.
  - Added tests for duplicate Providers and intentionally failing Providers.
- Tests:
  - `node --check services/newsService.js`
  - `node --check routes/news.js`
  - `node --check js/modules/news.js`
  - `node --check test/workbench-api.test.js`
  - `npm test`
  - `npm run test:frontend`
- Review: no external provider was added in this iteration. The architecture now reports failures cleanly and is ready for a real configurable provider.

### Continued Iteration: Dashboard Risk Alerts
- Observation: the dashboard had a risk card, but it was mostly a shallow text list and did not include sector leader weakness or retained quote warnings.
- Small goal: turn risk reminders into structured, severity-sorted rows with quick navigation.
- Code changes:
  - Reworked `js/modules/dashboard.js` with explicit dashboard-prefixed functions.
  - Added `Dashboard.buildRisks()` for watchlist alert price hits, retained quotes, holding drawdowns, weak daily moves, and sector leader weakness.
  - Added severity styling for risk rows.
  - Exposed `SectorLeaders.getDashboard()` for dashboard risk aggregation.
  - Fixed `StockList.selectStock()` so synchronous `Dashboard.refreshCards()` is not treated as a Promise.
- Tests:
  - `node --check js/modules/dashboard.js`
  - `node --check js/modules/sectorLeaders.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: thresholds are currently hard-coded. Next risk iteration should persist user-configurable thresholds and allow dismiss/snooze.

### Continued Iteration: Configurable Risk Thresholds
- Observation: dashboard risk alerts were useful but thresholds were hard-coded.
- Small goal: add lightweight local settings for the main risk thresholds without adding backend state.
- Code changes:
  - Added Risk Thresholds controls to Settings.
  - Stored thresholds in `localStorage` through `Settings.getRiskSettings()`.
  - Updated `Dashboard.buildRisks()` to use user thresholds for drawdown, daily drop, and sector leader drop.
  - Extended Playwright to save thresholds before verifying risk rendering.
- Tests:
  - `node --check js/modules/settings.js`
  - `node --check js/modules/dashboard.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: threshold persistence is browser-local. Next iteration can add dismiss/snooze state and history.

### Continued Iteration: Risk Dismiss State
- Observation: once risk alerts became more useful, known alerts could keep reappearing during the same session/day.
- Small goal: add a local "Dismiss today" action without backend schema changes.
- Code changes:
  - Added per-day dismissed-risk storage in `localStorage`.
  - Added stable risk keys for position drawdown, daily drop, watchlist alert hits, stale quotes, and sector leader drops.
  - Added row-level "Dismiss today" buttons and filtering in `Dashboard.buildRisks()`.
  - Extended Playwright to verify risk count decreases after dismissal.
- Tests:
  - `node --check js/modules/dashboard.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: Playwright initially exposed a race where dashboard async refresh overwrote injected test data. The test now waits for dashboard visibility before injecting risk fixtures.

### Continued Iteration: Smart Screener History
- Observation: `ai_screener_results` existed but the smart screener had no explicit save/reopen workflow.
- Small goal: persist current candidate lists only when the user clicks Save, then show recent saved tasks on the screener page.
- Code changes:
  - Added `saveScreenerResult()`, `getScreenerResult()`, and `listScreenerResults()` in `services/screenerService.js`.
  - Added `GET /api/screener/results` and `POST /api/screener/results`.
  - Added "Save result" and history strip UI in the screener page.
  - Extended API and Playwright tests for saved screener results.
- Tests:
  - `node --check services/screenerService.js`
  - `node --check routes/screener.js`
  - `node --check js/modules/stockScreener.js`
  - `node --check test/workbench-api.test.js`
  - `npm test`
  - `npm run test:frontend`
- Review: saved tasks can be reopened but not yet renamed/deleted from the UI.

### Continued Iteration: Smart Screener History Management
- Observation: saved screener tasks needed lifecycle controls to avoid unlimited accumulation.
- Small goal: add rename and delete for saved screener tasks.
- Code changes:
  - Added `updateScreenerResult()` and `deleteScreenerResult()`.
  - Added `PUT /api/screener/results/:id` and `DELETE /api/screener/results/:id`.
  - Added Rename/Delete buttons to the screener history strip.
  - Extended API and Playwright tests for rename/delete flows.
- Tests:
  - `node --check services/screenerService.js`
  - `node --check routes/screener.js`
  - `node --check js/modules/stockScreener.js`
  - `node --check test/frontend-click.spec.js`
  - `npm test`
  - `npm run test:frontend`
- Review: saved AI explanations are still not linked to saved tasks; this remains a useful next step.

### Continued Iteration: Frontend Global-Scope Quality Audit
- Observation: the app uses plain browser scripts rather than ES modules, so duplicate top-level function names can silently overwrite earlier functions.
- Small goal: audit top-level function collisions and run a broad syntax check after multiple feature iterations.
- Checks:
  - Global duplicate-function audit across `js/app.js` and `js/modules/*.js`: 0 duplicates across 21 frontend scripts.
  - Batch `node --check` across `js`, `routes`, `services`, and `test`: 43 JS files checked.
  - `npm test`
  - `npm run test:frontend`
- Review: no code changes were needed in this audit round. Continue to prefer module-prefixed function names for new plain JS files.

### Continued Iteration: Screener AI Result Linkage
- Observation: ChatGPT handoff results were saved in browser storage but not connected to the saved smart-screener task that generated them.
- Small goal: link handoff/manual AI output back to the active saved screener task when one exists.
- Code changes:
  - Added optional `onSave` callback support to `AIAssistant.open()`.
  - Added `StockScreener.updateSavedAIResult()`.
  - Updated smart-screener AI handoff to write the returned text into `ai_screener_results.ai_result` for the active saved task.
  - Added `AI saved` badge to saved screener history cards.
  - Extended API and Playwright tests for linked AI result behavior.
- Tests:
  - `node --check js/modules/aiAssistant.js`
  - `node --check js/modules/stockScreener.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/frontend-click.spec.js`
  - `npm test`
  - `npm run test:frontend`
- Review: AI result is linked only when there is an active saved screener task. Unsaved runs still use the generic handoff localStorage fallback.

### Continued Iteration: Screener Saved AI Display
- Observation: saved screener tasks could store `ai_result`, but the UI only showed an "AI saved" badge.
- Small goal: render the saved AI explanation below the current candidate table when a saved task is active.
- Code changes:
  - Tracked `activeSavedAIResult` in `stockScreener.js`.
  - Rendered saved AI text under the candidate table with HTML escaping.
  - Added styles for `.saved-ai-result`.
  - Extended Playwright to verify the imported ChatGPT text appears in screener results.
- Tests:
  - `node --check js/modules/stockScreener.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: this is display-only. A richer saved-task detail drawer can still be added later.

### Continued Iteration: Backup Scope For Screener History
- Observation: after adding persistent smart-screener history, JSON backup did not include that table.
- Small goal: make backup/restore cover saved screener tasks and linked AI explanations.
- Code changes:
  - Extended `services/backupService.js` export/import schema with `screenerResults`.
  - Updated Settings backup copy and import status.
  - Extended backup roundtrip test to verify saved screener tasks and `aiResult`.
- Tests:
  - `node --check services/backupService.js`
  - `node --check js/modules/settings.js`
  - `node --check test/workbench-api.test.js`
  - `npm test`
  - `npm run test:frontend`
- Review: import is still replace-oriented. A future enhancement should preview conflicts before restore.

### Continued Iteration: Backup Import Preview
- Observation: JSON restore used browser confirmation, but it did not show incoming/current counts before replace import.
- Small goal: add preview counts before destructive import.
- Code changes:
  - Added `previewUserDataImport()` in `services/backupService.js`.
  - Added `POST /api/user/import-preview`.
  - Updated Settings import flow to parse the file, call preview, show incoming/current counts, then confirm.
  - Extended backup API tests to verify preview counts.
- Tests:
  - `node --check services/backupService.js`
  - `node --check routes/user.js`
  - `node --check js/modules/settings.js`
  - `node --check test/workbench-api.test.js`
  - `npm test`
  - `npm run test:frontend`
- Review: preview is count-based. Merge-mode conflict resolution remains future work.

### Continued Iteration: Saved Screener Compare API
- Observation: saved screener tasks can now be preserved, but there was no way to compare how candidate lists changed across runs.
- Small goal: add an API-level compare primitive for future UI work.
- Code changes:
  - Added `compareScreenerResults(baseId, headId)`.
  - Added `GET /api/screener/results/compare?baseId=&headId=`.
  - Extended API tests to save two tasks and verify added candidates plus score changes.
- Tests:
  - `node --check services/screenerService.js`
  - `node --check routes/screener.js`
  - `node --check test/workbench-api.test.js`
  - `npm test`
  - `npm run test:frontend`
- Review: compare API exists, but the frontend does not yet expose comparison controls.

### Continued Iteration: Saved Screener Compare UI
- Observation: saved screener comparison existed at the API layer, but the smart-screener page still forced users to infer changes manually from separate history cards.
- Small goal: expose the latest-two comparison as a low-risk UI action and cover it in the existing browser workflow.
- Code changes:
  - Added `Compare latest two` to the screener saved-history strip when at least two saved tasks exist.
  - Added a comparison renderer for added candidates, removed candidates, and score changes.
  - Extended Playwright coverage to save two screener tasks, compare them, continue through ChatGPT handoff saving, and delete both tasks.
- Tests:
  - `node --check js/modules/stockScreener.js`
  - `node --check test/frontend-click.spec.js`
  - `node --check services/screenerService.js`
  - `node --check routes/screener.js`
  - `npm run test:frontend`
  - `npm test`
- Review: the compare UI currently compares only the two newest saved tasks. Custom pair selection and a saved-task detail drawer remain future work.

### Continued Iteration: Saved Screener Details And Selected Compare
- Observation: the latest-two compare action was useful, but saved-history workflows still lacked arbitrary pair comparison and an at-a-glance detail preview.
- Small goal: add selected base/head comparison and a saved-task detail preview without changing the database or API contract.
- Code changes:
  - Added base/head selects to the screener history toolbar.
  - Added `Compare selected` for arbitrary saved-task pairs.
  - Added `Details` on each saved history card to preview candidate scores, reasons, risks, and saved AI text.
  - Added friendly inline error messaging for failed saved-history actions.
  - Extended responsive CSS so comparison columns collapse on narrow screens.
- Tests:
  - `node --check js/modules/stockScreener.js`
  - `node --check test/frontend-click.spec.js`
  - `node --check js/modules/aiAssistant.js`
  - `node --check js/app.js`
  - `npm run test:frontend`
  - `npm test`
- Review: this remains a research workflow, not an advice engine. Candidate CSV export and richer per-factor explanations are the next useful screener improvements.

### Continued Iteration: Screener Factor Tags And CSV Export
- Observation: candidate rows had scores, reasons, and risks, but users could not quickly see which local factor families drove each row or export a candidate set for offline review.
- Small goal: expose compact factor tags and add a CSV export for the active screener result.
- Code changes:
  - Added `factorTags` to smart-screener candidates based on leader/watchlist/portfolio/recent/quote/amount/MA/trend/volatility/MACD signals.
  - Rendered factor chips in the candidate table.
  - Added `Export CSV` to the screener header and implemented browser download of code, name, score, strategy, factors, reasons, risks, and observation price.
  - HTML-escaped candidate table fields while touching the renderer.
- Tests:
  - `node --check js/modules/stockScreener.js`
  - `node --check js/app.js`
  - `node --check services/screenerService.js`
  - `node --check test/frontend-click.spec.js`
  - `node --check test/workbench-api.test.js`
  - `npm run test:frontend`
  - `npm test`
- Review: factor tags are categorical; exact per-factor score contribution is still a future improvement.

### Continued Iteration: Screener Score Contributions
- Observation: factor tags improved scanning, but the score was still opaque because users could not see how much each factor family contributed.
- Small goal: add per-candidate score-contribution breakdowns without changing the saved-result table schema.
- Code changes:
  - Added `factorBreakdown` to candidates with label, impact, note, and kind.
  - Rendered contribution chips in the active candidate table.
  - Added contribution chips to saved-task detail previews.
  - Included contribution breakdowns in CSV export.
- Tests:
  - `node --check services/screenerService.js`
  - `node --check js/modules/stockScreener.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: contribution values intentionally mirror local factor logic and remain explanatory, not predictive. Saved candidate notes and manual review status are the next useful persistence layer.

### Continued Iteration: Saved Candidate Review Notes
- Observation: saved screener tasks could be reopened, but individual candidates still lacked a persisted manual review state.
- Small goal: allow a user to mark saved candidates as watch/priority/risk/skip/done and attach notes.
- Code changes:
  - Added `screener_candidate_notes` SQLite table with a unique `(result_id, code)` constraint.
  - Added notes APIs for list, upsert, and delete.
  - Added Review actions to saved-task detail rows.
  - Rendered saved review status and note in the detail preview.
- Tests:
  - `node --check db/index.js`
  - `node --check services/screenerService.js`
  - `node --check routes/screener.js`
  - `node --check js/modules/stockScreener.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: notes are persisted and editable from saved-task details. Backup/export should include these notes in a later round.

### Continued Iteration: Backup Candidate Review Notes
- Observation: saved candidate review notes were persisted, but they were not portable through the workstation backup flow.
- Small goal: include `screener_candidate_notes` in backup export, preview, and import.
- Code changes:
  - Exported saved screener task IDs and `screenerCandidateNotes`.
  - Imported candidate notes by mapping old saved-result IDs to newly inserted result IDs.
  - Updated the Settings data-backup copy.
  - Extended backup roundtrip tests to cover preview/import/export counts and note/status content.
- Tests:
  - `node --check services/backupService.js`
  - `node --check test/workbench-api.test.js`
  - `node --check routes/user.js`
  - `node --check js/modules/settings.js`
  - `npm test`
  - `npm run test:frontend`
- Review: backup is still replace/merge at table level. Per-row conflict resolution remains future work.

### Continued Iteration: Candidate Review Filtering
- Observation: saved candidates could be annotated, but larger saved tasks needed a way to see review progress and isolate priority/risk items.
- Small goal: add review-status summary counts and filtering inside saved-task details.
- Code changes:
  - Added review summary counts for unreviewed/watch/priority/risk/skip/done.
  - Added a detail-level status filter.
  - Preserved the active filter while notes are updated.
  - Added compact responsive styles for review tools.
- Tests:
  - `node --check js/modules/stockScreener.js`
  - `node --check test/frontend-click.spec.js`
  - `node --check js/app.js`
  - `npm run test:frontend`
  - `npm test`
- Review: the filter is per saved-task detail. A dashboard-level review summary is still future work.

### Continued Iteration: Dashboard Candidate Review Summary
- Observation: saved-task review filtering helped inside details, but review progress was still hidden from the main workstation.
- Small goal: surface recent screener review progress on the dashboard.
- Code changes:
  - Added `GET /api/screener/review-summary`.
  - Added `State.screenerReviewSummary`.
  - Added dashboard loading and rendering for recent candidate-review summaries.
  - Added a "候选复核" dashboard card with priority/risk/todo counts.
- Tests:
  - `node --check services/screenerService.js`
  - `node --check routes/screener.js`
  - `node --check js/modules/state.js`
  - `node --check js/modules/dashboard.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: the dashboard card opens the screener page but does not yet deep-link to the exact saved task detail.

### Continued Iteration: Dashboard Saved Task Deep Link
- Observation: the dashboard review card showed useful counts, but its Open action only navigated to the screener page.
- Small goal: make the dashboard Open action load the exact saved task detail.
- Code changes:
  - Added `StockScreener.openSavedResult(id, mode)`.
  - Updated dashboard review rows to call `openSavedResult(id, 'details')`.
  - Extended Playwright to verify the saved candidate note appears after opening from the dashboard card.
- Tests:
  - `node --check js/modules/stockScreener.js`
  - `node --check js/modules/dashboard.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: exact task deep-linking is implemented for details. Bulk status edits remain future work.

### Continued Iteration: Bulk Candidate Review
- Observation: saved-task detail filtering made it possible to isolate groups, but updating candidates one by one was inefficient.
- Small goal: bulk mark the currently filtered saved candidates with a shared status and note.
- Code changes:
  - Added `bulkUpsertScreenerCandidateNotes`.
  - Added `PUT /api/screener/results/:id/notes` for bulk updates.
  - Added `Bulk mark filtered` in saved-task details.
  - Extended CSV/detail state to keep track of the current filtered candidate codes.
- Tests:
  - `node --check services/screenerService.js`
  - `node --check routes/screener.js`
  - `node --check js/modules/stockScreener.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: bulk marking works on the current detail filter. There is still no undo history beyond manually changing the status again.

### Continued Iteration: Sector Leader Snapshots
- Observation: the sector leader panel tracked only current state. There was no persisted refresh/configuration trail for leader strength.
- Small goal: add a snapshot table and a History entry for sector leaders.
- Code changes:
  - Added `sector_leader_snapshots`.
  - Recorded snapshots on leader create/update and dashboard refresh.
  - Added `GET /api/sector-leaders/snapshots`.
  - Added a History button and snapshot table view in the sector panel.
- Tests:
  - `node --check services/sectorService.js`
  - `node --check routes/sectors.js`
  - `node --check js/modules/sectorLeaders.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/frontend-click.spec.js`
  - `npm test`
  - `npm run test:frontend`
- Review: snapshots are now recorded and viewable. Backup/export and aggregated trend summaries are still future work.

### Continued Iteration: Backup Sector Leader Snapshots
- Observation: sector leader snapshots were persisted locally but not yet portable through the workstation backup flow.
- Small goal: include `sector_leader_snapshots` in JSON backup export, preview, and import.
- Code changes:
  - Exported `sectorLeaderSnapshots`.
  - Imported sector leader snapshots with price/change/amount/capturedAt fields.
  - Extended backup preview/current counts.
  - Updated Settings data-backup copy.
- Tests:
  - `node --check services/backupService.js`
  - `node --check test/workbench-api.test.js`
  - `node --check js/modules/settings.js`
  - `npm test`
  - `npm run test:frontend`
- Review: snapshots are portable. Aggregated trend summaries are still future work.

### Continued Iteration: Sector Leader Trend Summary
- Observation: sector leader snapshots were recorded, but users still needed an aggregate view to see strengthening or weakening across samples.
- Small goal: add a snapshot-based trend API and panel view.
- Code changes:
  - Added `getLeaderTrends`.
  - Added `GET /api/sector-leaders/trends`.
  - Added a sector-panel Trend button and trend table showing latest change, previous change, delta, sample count, and update time.
- Tests:
  - `node --check services/sectorService.js`
  - `node --check routes/sectors.js`
  - `node --check js/modules/sectorLeaders.js`
  - `node --check js/app.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/frontend-click.spec.js`
  - `npm test`
  - `npm run test:frontend`
- Review: trend summaries rely on accumulated snapshots; new installs will show sparse data until users refresh or edit leaders over time.

### Continued Iteration: Sector History UI Coverage
- Observation: the History button existed, but the browser test did not click through the history view.
- Small goal: cover the History and Back interaction path in Playwright.
- Code changes:
  - Extended `test/frontend-click.spec.js` to click `leaderHistory`, assert `Leader history`, click Back, and continue edit/delete coverage.
- Tests:
  - `node --check test/frontend-click.spec.js`
  - `node --check js/modules/sectorLeaders.js`
  - `npm run test:frontend`
  - `npm test`
- Review: this was a test-hardening iteration. Snapshot pruning/export controls remain future work.

### Continued Iteration: Sector Snapshot Pruning
- Observation: sector leader snapshots can now accumulate over time, so the workstation needs a basic cleanup path.
- Small goal: add pruning by retaining the latest N snapshot rows.
- Code changes:
  - Added `pruneLeaderSnapshots`.
  - Added `DELETE /api/sector-leaders/snapshots?keepLatest=`.
  - Added `Prune snapshots` control to the sector panel.
- Tests:
  - `node --check services/sectorService.js`
  - `node --check routes/sectors.js`
  - `node --check js/modules/sectorLeaders.js`
  - `node --check js/app.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/frontend-click.spec.js`
  - `npm test`
  - `npm run test:frontend`
- Review: pruning is coarse-grained and confirm-gated. CSV export for snapshots remains future work.

### Continued Iteration: Sector Snapshot CSV Export
- Observation: snapshots could be viewed and pruned, but exporting them for offline review still required full JSON backup.
- Small goal: add a focused CSV export for sector leader snapshots.
- Code changes:
  - Added `Export snapshots CSV` control.
  - Added CSV download logic in `sectorLeaders.js`.
  - Extended Playwright route mock for snapshot data and verified the download event.
- Tests:
  - `node --check js/modules/sectorLeaders.js`
  - `node --check js/app.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: CSV export is frontend-only and pulls up to 1000 latest snapshots from the existing API.

### Continued Iteration: Mobile Coverage Expansion
- Observation: the mobile dark-mode test covered core navigation, but not the sector leader and portfolio surfaces.
- Small goal: extend mobile coverage to additional workstation views.
- Code changes:
  - Extended `test/frontend-click.spec.js` mobile test to open sector leaders and portfolio views.
- Tests:
  - `node --check test/frontend-click.spec.js`
  - `node --check js/modules/sectorLeaders.js`
  - `node --check js/modules/portfolio.js`
  - `npm run test:frontend`
  - `npm test`
- Review: mobile coverage now spans dashboard, market, screener, sector leaders, and portfolio. Visual polish can still be improved.

### Continued Iteration: Focus Visibility Polish
- Observation: workstation controls lacked a consistent keyboard focus indicator.
- Small goal: add theme-aware `focus-visible` styling for core controls.
- Code changes:
  - Added focus outlines for buttons, inputs, selects, textareas, and links using `--focus`.
- Tests:
  - `npm run test:frontend`
  - `npm test`
- Review: this is a focused accessibility polish change. Deeper keyboard flow tests remain future work.

### Continued Iteration: ARIA Labels For Icon Controls
- Observation: several icon-only controls had visible symbols but weak assistive labels.
- Small goal: add labels/titles to the key icon controls and assert the most important labels in Playwright.
- Code changes:
  - Added ARIA labels and titles to clear search, theme toggle, MA settings, and analysis close buttons.
  - Added Playwright assertions for theme and clear labels.
- Tests:
  - `node --check test/frontend-click.spec.js`
  - `node --check js/app.js`
  - `npm run test:frontend`
  - `npm test`
- Review: labels are improved for the most visible icon controls. A broader accessibility audit remains future work.

### Continued Iteration: Keyboard Flow Regression Coverage
- Observation: the previous frontend suite still relied mostly on pointer clicks, so keyboard activation regressions could slip through.
- Small goal: add browser-level coverage for core keyboard paths without changing runtime behavior.
- Code changes:
  - Added a Playwright test for keyboard focus and Enter activation across search clear, theme toggle, main navigation, stock view, AI analysis, and analysis close controls.
  - The first draft assumed the initial Tab order started at the search input; the failing run showed this was brittle, so the test now starts by focusing the search input and then validates the in-page keyboard path.
- Tests:
  - `node --check test/frontend-click.spec.js`
  - `npm test`
  - `npm run test:frontend -- --grep "keyboard activation"`
  - `npm run test:frontend`
- Review: frontend coverage now includes 3 Playwright tests. Current observed Goal runtime is 17,149 seconds, still below the required 8 hours, so this Goal remains active.

### Continued Iteration: Dismissed Risk Review
- Observation: dashboard risks could be dismissed for the day, but dismissed items were not visible afterward, making it hard to audit accidental dismissals.
- Small goal: keep the existing low-friction dismiss flow while adding a same-day review and restore path.
- Code changes:
  - Added a dashboard risk toolbar showing how many risks were dismissed today.
  - Added `Show dismissed today`, `Hide dismissed`, and `Restore` actions backed by the existing localStorage dismissal store.
  - Added muted styling for dismissed risk rows.
  - Extended Playwright coverage to dismiss a risk, show dismissed rows, restore the risk, and confirm the active count returns.
- Tests:
  - `node --check js/modules/dashboard.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: risk reminders are now less destructive while still local-only and non-advisory. Current observed Goal runtime is 17,370 seconds, still below 8 hours.

### Continued Iteration: CSV Template Downloads
- Observation: JSON backup/restore exists, but the Settings page did not give users a low-friction template for preparing future CSV imports.
- Small goal: add download-only templates without changing existing data or import behavior.
- Code changes:
  - Added Watchlist and Trades CSV template buttons to the Data Backup settings card.
  - Added frontend CSV generation for watchlist and trade record templates.
  - Extended Playwright coverage to verify both template download filenames.
- Tests:
  - `node --check js/modules/settings.js`
  - `node --check test/frontend-click.spec.js`
  - `node --check js/modules/dashboard.js`
  - `npm run test:frontend`
  - `npm test`
- Review: this improves portability documentation through executable templates while avoiding a partially implemented CSV importer. Current observed Goal runtime is 17,524 seconds, still below 8 hours.

### Continued Iteration: Watchlist Alert Visibility
- Observation: watchlist items could store alert limits, but the list did not clearly show whether a limit was triggered. A first test exposed that loaded watchlist rows lacked current quote data and could only show `Alert pending`.
- Small goal: make alert state visible on the watchlist and dashboard, and refresh quotes before evaluating alert thresholds.
- Code changes:
  - Added watchlist alert status labels: `Alert high`, `Alert low`, `Alert normal`, `Alert pending`, and `No alert`.
  - Added alert status to the dashboard watchlist summary.
  - Changed watchlist loading to refresh quotes after loading stored rows, and mark rows as stale if the quote refresh fails.
  - Extended Playwright coverage to verify an alert-high row in the watchlist and dashboard.
- Tests:
  - `node --check js/modules/watchlist.js`
  - `node --check js/modules/dashboard.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend -- --grep "main stock actions"`
  - `npm run test:frontend`
  - `npm test`
- Review: alert limits now have visible operational state. Current observed Goal runtime is 17,779 seconds, still below 8 hours.

### Continued Iteration: Detail Alert State
- Observation: after watchlist alert status became visible in list/dashboard views, the stock detail side panel still only showed whether the stock was in the watchlist.
- Small goal: show the same alert state in the detail side panel and avoid stale visual classes when switching stocks.
- Code changes:
  - Reworked `stockDetail.js` to render escaped watchlist notes and alert state in the detail side panel.
  - Reset detail status classes before rendering watchlist and position states.
  - Escaped detail news title/summary rendering while preserving the existing fallback behavior.
  - Extended Playwright coverage to verify detail-side `Alert high` after opening the watchlist row.
- Tests:
  - `node --check js/modules/stockDetail.js`
  - `node --check test/frontend-click.spec.js`
  - `node --check js/modules/watchlist.js`
  - `npm run test:frontend -- --grep "main stock actions"`
  - `npm run test:frontend`
  - `npm test`
- Review: stock detail now mirrors watchlist alert context. Current observed Goal runtime is 17,990 seconds, still below 8 hours.

### Continued Iteration: Watchlist CSV Export
- Observation: Settings had CSV templates, but users could not export the actual current watchlist slice directly from the watchlist page.
- Small goal: add a local CSV export for the currently visible watchlist rows, including alert status and quote status.
- Code changes:
  - Added `Export CSV` to the watchlist action bar.
  - Added `Watchlist.exportVisibleWatchlistCsv()` with CSV escaping and a date-stamped filename.
  - Export rows include code, name, price, change, group, alert bounds, alert status, quote status, and note.
  - Removed a duplicate watchlist quote refresh from the main-view switch because `loadWatchlist()` now refreshes quotes itself.
  - Extended Playwright coverage to verify the watchlist CSV download event.
- Tests:
  - `node --check js/modules/watchlist.js`
  - `node --check js/app.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: watchlist export is intentionally frontend-only and non-destructive. Current observed Goal runtime is 18,200 seconds, still below 8 hours.

### Continued Iteration: Portfolio Trade Export And Test Isolation
- Observation: the backend already exposed trade CSV export through `/api/portfolio/trades/export`, but the portfolio page did not expose it. During verification, `npm test` also exposed a test-isolation issue where a reused temp DB path could retain recent-stock rows.
- Small goal: surface trade export in the portfolio workflow and make test databases deterministic.
- Code changes:
  - Added `导出交易` to the portfolio action bar and wired it to `Trades.exportTrades`.
  - Changed `Trades.exportTrades()` from `window.open` to an anchor download so browser tests and users get a normal file download.
  - Extended Playwright coverage to verify `webstock-trades.csv` is downloaded from the portfolio page after adding a trade.
  - Cleared per-test SQLite DB, WAL, and SHM files before requiring app/service modules in Node and Playwright tests.
- Tests:
  - `node --check js/modules/trades.js`
  - `node --check js/app.js`
  - `node --check test/frontend-click.spec.js`
  - `node --check test/workbench-api.test.js`
  - `node --check test/portfolioService.test.js`
  - `npm run test:frontend`
  - `npm test`
- Review: the first `npm test` failed on stale recent-stock data (`4 !== 1`), then passed after test DB cleanup. Current observed Goal runtime is 18,423 seconds, still below 8 hours.

### Continued Iteration: Browser Oversell Guard
- Observation: oversell validation existed in service/unit tests, but the browser workflow for clicking `卖出` from a holding row was not covered.
- Small goal: add end-to-end coverage for the front-end oversell guard.
- Code changes:
  - Extended Playwright dialog capture to retain alert messages.
  - Added a browser flow that adds a holding, clicks row-level sell, enters a quantity above current holdings, verifies the oversell alert, and cancels the modal without saving.
- Tests:
  - `node --check test/frontend-click.spec.js`
  - `node --check js/modules/trades.js`
  - `npm run test:frontend -- --grep "main stock actions"`
  - `npm run test:frontend`
  - `npm test`
- Review: this directly covers a high-risk portfolio interaction from the original requirements. Current observed Goal runtime is 18,579 seconds, still below 8 hours.

### Continued Iteration: Sector Leader Add Flow Coverage
- Observation: sector leader edit/delete/history/trend/export browser flows were covered, but adding a leader from a sector card was not.
- Small goal: add browser coverage for the `添加龙头` workflow without changing production behavior.
- Code changes:
  - Added a stateful Playwright route stub for sector dashboard and `POST /api/sectors/1/leaders`.
  - Extended the sector test flow to add a leader and assert the new name/note render in the panel.
- Tests:
  - `node --check test/frontend-click.spec.js`
  - `node --check js/modules/sectorLeaders.js`
  - `npm run test:frontend -- --grep "main stock actions"`
  - `npm run test:frontend`
  - `npm test`
- Review: sector leader CRUD now has browser coverage for add, edit, and delete entry points. Current observed Goal runtime is 18,799 seconds, still below 8 hours.

### Continued Iteration: Recent Stocks CSV Export
- Observation: recent stocks are core personal workstation data and had API delete/clear support, but no direct page-level export.
- Small goal: add a local CSV export for the current recent-stock list.
- Code changes:
  - Added `Export CSV` to the Recent Stocks page.
  - Added `RecentStocks.exportCsv()` with CSV escaping and a date-stamped filename.
  - Export rows include code, name, last price, last change, view count, and last viewed time.
  - Extended Playwright coverage to verify the recent-stock CSV download.
- Tests:
  - `node --check js/modules/recentStocks.js`
  - `node --check js/app.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend`
  - `npm test`
- Review: recent-stock export is client-side and non-destructive. Current observed Goal runtime is 18,947 seconds, still below 8 hours.

### Continued Iteration: Statistics Overview
- Observation: the statistics page mostly showed charts, so it was less useful when charts were empty or when users wanted a quick workstation summary.
- Small goal: add lightweight text/table statistics using already-loaded portfolio, watchlist, recent, and sector data.
- Code changes:
  - Added `statsOverviewCards` and `statsExposureTable` to the stats page.
  - Added `Portfolio.renderStatsOverview()` with positions/watchlist/recent/sector counts, total P/L, and top exposure rows.
  - Changed stats navigation to refresh watchlist, recent stocks, sector summary, and portfolio before rendering the overview.
  - Extended Playwright coverage to verify the stats cards and top exposure table.
- Tests:
  - `node --check js/modules/portfolio.js`
  - `node --check js/app.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend -- --grep "main stock actions"`
  - `npm run test:frontend`
  - `npm test`
- Review: statistics are now readable even without chart inspection. Current observed Goal runtime is 19,243 seconds, still below 8 hours.

### Continued Iteration: Quality Sweep
- Observation: many frontend modules and tests have changed, so a broad syntax and whitespace pass is useful before the next feature loop.
- Small goal: verify all JavaScript files parse and the diff has no whitespace errors.
- Code changes:
  - No production code changes in this sweep.
- Tests:
  - `node --check` passed for 47 JavaScript files.
  - `git diff --check` passed with only Windows LF-to-CRLF warnings.
  - `git status --short` reviewed the current modified/untracked scope.
- Review: no syntax or whitespace blocker was found. Current observed Goal runtime is 19,317 seconds, still below 8 hours.

### Continued Iteration: Screener Strategy Guidance
- Observation: the smart screener strategy dropdown did not explain what each template optimizes for, which could make the output feel like a black box.
- Small goal: add concise strategy guidance and verify it updates on strategy changes.
- Code changes:
  - Added `screenerStrategyHint` to the screener panel.
  - Added strategy hint copy for stable, breakout, pullback, sector leader, short-term strength, and portfolio risk templates.
  - Wired the strategy select change event to update the hint.
  - Extended Playwright coverage to verify the default stable hint and breakout hint after selection.
- Tests:
  - `node --check js/modules/stockScreener.js`
  - `node --check js/app.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend -- --grep "main stock actions"`
  - `npm run test:frontend`
  - `npm test`
- Review: screener strategy intent is now visible before running a recommendation. Current observed Goal runtime is 19,583 seconds, still below 8 hours.

### Continued Iteration: Sector Role Filter
- Observation: the sector leader panel supported sorting and modes, but not quick filtering by leader role.
- Small goal: add role filtering for sector leader cards, overview, and risk views.
- Code changes:
  - Added `sectorRoleFilter` with role options.
  - Added role filtering before sector leader sorting and overview rendering.
  - Bound role-filter changes to rerender the sector panel.
  - Extended Playwright coverage to add a trend leader, filter by `趋势龙头`, and verify unrelated leaders are hidden.
- Tests:
  - `node --check js/modules/sectorLeaders.js`
  - `node --check js/app.js`
  - `node --check test/frontend-click.spec.js`
  - `npm run test:frontend -- --grep "main stock actions"`
  - `npm run test:frontend`
  - `npm test`
- Review: sector leader control now supports role-focused monitoring. Current observed Goal runtime is 19,762 seconds, still below 8 hours.

### Continued Iteration: Optional JSON News Provider
- Observation: the news module had a provider registry and fallback data, but no configurable external provider implementation.
- Small goal: add an optional JSON URL provider without making the app depend on external network access by default.
- Code changes:
  - Added async news providers alongside existing synchronous fallback providers.
  - Added `createJsonUrlProvider(url)` and `registerAsyncProvider`.
  - Added `NEWS_JSON_URL` support for a configured JSON endpoint.
  - Updated `/api/news` to use async provider resolution and still fall back cleanly.
  - Added a local HTTP-server test for JSON provider normalization and async provider registration.
- Tests:
  - `node --check services/newsService.js`
  - `node --check routes/news.js`
  - `node --check test/workbench-api.test.js`
  - `npm test` (13 tests)
  - `npm run test:frontend`
- Review: real news integration now has a configurable extension point while fallback remains safe. Current observed Goal runtime is 19,969 seconds, still below 8 hours.

## 2026-05-12

### 第 1 轮：基线诊断与故障修复

- 观察现状：项目为 Express + 原生 JS + ECharts，已有 SQLite、watchlist、portfolio、trades 和 AI 分析基础。
- 小目标：复现并修复“查看/分析”点击无效。
- 修改代码：
  - 修复 `.indicator-btns` 隐藏 AI 分析按钮的问题。
  - 股票列表增加“查看 / 分析 / 持仓”快捷按钮。
  - 股票列表改为事件委托，星标和按钮阻止父级行点击。
  - AI 分析流改为 `EventSource`，失败时显示友好降级。
- 测试：
  - `npm test`
  - `npm run test:frontend`
- 复盘问题：
  - 根因是 UI 控件分组过粗，K 线指标控件与 AI 操作按钮被同一个 visibility 控制。
  - SSE 手写 parser 容错不足。
- 日志输出：
  - `docs/fix-click-analysis-report.md`

### 第 2-3 轮：信息架构、首页工作台、最近查看、自选入口

- 观察现状：自选/持仓已有基础 API，但首页仍以行情页为主。
- 小目标：首页改为工作台，并补最近查看持久化。
- 修改代码：
  - 新增 `recent_stocks` 表。
  - 新增 `/api/user/recent-stocks` 增删查清空接口。
  - 新增 `recentStocks.js` 和“最近查看”页面。
  - 新增 `dashboard.js` 和工作台首页。
  - 自选股增加搜索、涨跌幅排序和快捷动作。
- 测试：
  - `npm test`
  - `node --check` 关键前端和后端模块。
- 复盘问题：
  - 最近查看应由 `selectStock` 自动写入，避免只记录某个入口。

### 第 4-5 轮：持仓交易与股票详情工作台

- 观察现状：持仓和交易已有基础，但行级快捷入口不完整。
- 小目标：补齐行级买入/卖出/AI持仓分析/交易记录入口。
- 修改代码：
  - 重写 `portfolio.js` 行级事件委托。
  - 重写 `trades.js`，交易弹窗自动带入当前股票、价格、日期。
  - 前端卖出数量校验；后端已有超卖校验。
  - 新增 `stockDetail.js`，行情详情侧栏展示自选、持仓、资讯和快捷动作。
- 测试：
  - `npm test`
  - `npm run test:portfolio`
  - `npm run test:frontend`
- 复盘问题：
  - 持仓分析在无 API Key 时走 ChatGPT 交接模式。

### 第 6 轮：资讯模块

- 观察现状：项目缺少资讯聚合。
- 小目标：实现不会拖垮页面的 fallback News Provider。
- 修改代码：
  - 新增 `services/newsService.js`。
  - 新增 `GET /api/news`。
  - 新增 `news.js` 和资讯页面。
  - 股票详情和工作台接入资讯摘要。
- 测试：
  - `npm test`
  - `npm run test:frontend`
- 复盘问题：
  - 当前资讯是本地兜底 Provider，未来可增加真实 Provider 并保留缓存/降级接口。

### 第 7 轮：板块龙头控制面板

- 观察现状：无板块/龙头持久化数据。
- 小目标：实现可编辑的板块和龙头股监控面板。
- 修改代码：
  - 新增 `sectors`、`sector_leaders` 表。
  - 新增板块和龙头 CRUD API。
  - 新增 `/api/sector-leaders/dashboard` 和 `/api/sector-leaders/ai-analysis`。
  - 新增 `sectorLeaders.js`，支持卡片、总览、风险模式。
- 测试：
  - `npm test`
  - `npm run test:frontend`
- 复盘问题：
  - 默认示例板块通过数据库 seed 写入，可编辑，不写死在前端。

### 第 8 轮：智能选股 / 候选推荐

- 观察现状：无候选推荐机制。
- 小目标：实现本地因子优先、AI 可选增强的候选观察清单。
- 修改代码：
  - 新增 `services/screenerService.js`。
  - 新增 `/api/screener/run` 和 `/api/screener/ai-explain`。
  - 新增 `stockScreener.js`。
  - 新增 `prompt-templates/stock-recommendation.md`。
- 测试：
  - `npm test`
  - `npm run test:frontend`
- 复盘问题：
  - 当前因子偏个人数据和板块龙头，缺少稳定估值/均线数据源，已在风险和免责声明中说明。

### 第 9-10 轮：视觉、回归和文档

- 观察现状：新增页面需要响应式和深色模式兼容。
- 小目标：补齐布局、测试、文档和继续执行提示词。
- 修改代码：
  - 新增工作台卡片、资讯卡片、板块卡片、筛选结果表和 ChatGPT 交接弹窗样式。
  - 新增 Playwright 点击测试。
  - 更新 `.gitignore` 忽略 Playwright 输出。
- 测试：
  - `npm test`
  - `npm run test:portfolio`
  - `npm run test:frontend`
- 复盘问题：
  - 本次未真实连续执行满 8 小时，已保留继续执行提示词和 TODO。

### 续跑审计与补强

- 观察现状：执行完成度审计，确认目标仍未完全达成，不能标记 Goal complete。
- 小目标：补齐低风险但明确缺失的交互能力。
- 修改代码：
  - 新增 `docs/COMPLETION_AUDIT.md`，逐项映射需求、证据和缺口。
  - 板块龙头行新增个股资讯、编辑龙头、删除龙头。
  - ChatGPT 交接结果保存到 `localStorage`，减少结果丢失。
  - 自选刷新失败时展示“行情保留”状态。
  - 智能选股接收前端本地行情快照，把涨跌幅、成交额、当前价纳入评分。
  - 智能选股接收当前 K 线快照，计算 MA5/MA20、20 日涨跌、波动率。
  - 智能选股补充 MACD 信号并加入评分/风险说明。
  - API 测试覆盖龙头更新和删除。
  - Playwright 测试检查板块龙头编辑/删除入口。
  - Playwright 测试继续扩展到自选添加、交易弹窗保存、持仓展示、ChatGPT 交接结果保存。
  - Playwright 测试继续扩展到自选备注编辑、板块龙头编辑和删除。
  - 新增 `ApiClient`，前端兼容旧数组响应和 `{ success, data }` 响应。
  - `/api/stocklist`、`/api/quote`、`/api/minute`、`/api/kline` 切换为 success envelope。
  - 新增多股票 K 线快照缓存，智能选股可一次提交多个已查看股票的技术因子。
  - 资讯模块改为 Provider registry，当前注册 fallback Provider，后续可接真实资讯源。
  - 修复普通脚本全局命名污染风险，重复顶层函数名检查为 0。
  - 新增移动端深色模式 Playwright 测试，修复 `viewSwitchBtn` 覆盖主题按钮的问题。
- 测试：
  - `npm run test:frontend`
  - `npm test`
- 复盘问题：
  - 智能选股技术因子和更深的浏览器流程测试仍是下一轮重点。
