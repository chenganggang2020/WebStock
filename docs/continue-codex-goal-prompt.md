# Continue Codex Goal Prompt

Latest continuation note:
- Final Goal audit passed at about 28,834 seconds of observed runtime. The original 8-hour Goal is complete; use this file only if future follow-up work starts from the current implementation.
- Previous below-8-hour checkpoint notes are historical; the current final audit supersedes them.
- First commands on resume: `npm test`, `npm run test:frontend`, then continue with `docs/TODO_NEXT.md`.
- Settings tab has been added and tested.
- User data backup export/import has been added and tested.
- News Provider metadata, dedupe, cache status, and degraded-state UI have been added and tested.
- Dashboard risk alerts now include watchlist alert-price hits, stale quote warnings, holding drawdowns, weak daily moves, and sector leader weakness.
- Risk thresholds are configurable in Settings and persisted in browser localStorage.
- Dashboard risk rows support "Dismiss today" with per-day localStorage state.
- Smart screener results can now be explicitly saved and reopened from a history strip backed by `ai_screener_results`.
- Saved screener tasks can now be renamed and deleted from the UI and API.
- ChatGPT handoff/AI explanation output now links back to the active saved screener task as `ai_result`.
- Saved smart-screener AI explanations now render below the active candidate table.
- JSON backup/export now includes saved smart-screener tasks and linked AI explanations.
- JSON import now supports `/api/user/import-preview` and Settings shows incoming/current counts before replace restore.
- Saved screener comparison API exists at `/api/screener/results/compare?baseId=&headId=`.
- The screener saved-history strip now exposes `Compare latest two`; Playwright verifies saving two tasks, comparing them, ChatGPT handoff linkage, and cleanup.
- Screener history also supports selected base/head comparison and a saved-task detail preview; Playwright verifies both paths.
- Smart-screener candidates now include factor tags, and the active result can be exported as CSV. Playwright verifies the download event.
- Smart-screener candidates now include `factorBreakdown` contribution chips in the table, saved-task details, and CSV export.
- Saved screener candidates now support manual review status and notes through `screener_candidate_notes` plus notes APIs; Playwright verifies Review editing.
- JSON backup/export/import/preview now includes `screenerCandidateNotes` and maps old saved-result IDs to new imported IDs.
- Saved-task details now show review-status counts and support status filtering.
- `/api/screener/review-summary` and the dashboard "候选复核" card surface priority/risk/todo counts for recent saved screener tasks.
- The dashboard "候选复核" Open action now deep-links to the exact saved screener task detail.
- Saved-task details now support `Bulk mark filtered`, backed by `PUT /api/screener/results/:id/notes`.
- Sector leaders now record snapshots in `sector_leader_snapshots`, expose `GET /api/sector-leaders/snapshots`, and show a History action in the sector panel.
- JSON backup/export/import/preview now includes `sectorLeaderSnapshots`.
- Sector leaders now expose `GET /api/sector-leaders/trends` and a Trend view based on snapshot deltas.
- Playwright now covers sector leader History and Back interactions.
- Sector leader snapshots can be pruned with `DELETE /api/sector-leaders/snapshots?keepLatest=` and the `Prune snapshots` control.
- Sector leader snapshots can be exported through `Export snapshots CSV`; Playwright covers the download event.
- Mobile dark-mode Playwright coverage now includes sector leaders and portfolio views.
- Core controls have visible `focus-visible` styling using the theme focus token.
- Icon-only controls have ARIA labels/titles; Playwright checks theme and clear labels.
- Core keyboard flows are covered in Playwright for search clear, theme toggle, main navigation, stock view, AI analysis, and analysis close.
- Dashboard risk reminders support showing and restoring risks dismissed today.
- Settings can download watchlist and trades CSV templates; Playwright verifies both downloads.
- Watchlist and dashboard watchlist rows now show alert status after refreshing quotes.
- Stock detail shows watchlist notes and alert state, with escaped detail news rendering.
- Watchlist page exports the currently visible rows to CSV with alert and quote status.
- Portfolio page exports trade records through the existing CSV endpoint; test DB files are cleaned before initialization.
- Playwright covers row-level oversell validation from the portfolio page.
- Playwright covers adding a sector leader from a sector card.
- Recent Stocks page exports the current recent list to CSV.
- Stats page includes summary cards and a top exposure table in addition to charts.
- Latest quality sweep: `node --check` passed for 47 JS files; `git diff --check` passed with only LF-to-CRLF warnings.
- Smart Screener strategy dropdown now shows explanatory guidance and updates on change.
- Sector Leaders can be filtered by leader role.
- News supports optional async JSON URL providers through `NEWS_JSON_URL`; fallback remains default. `.env.example`, `docs/deployment.md`, and `docs/FEATURES.md` document the accepted JSON shapes and fields.
- News page/API supports keyword filtering with a tested no-match empty state.
- Watchlist visible rows can be moved to a new group through `批量分组`.
- Portfolio has a closed-position review panel backed by `GET /api/portfolio/closed-positions`.
- Trade modal shows a live estimated amount preview.
- Smart Screener active results can be filtered by minimum score and keyword; CSV export uses visible candidates.
- Sector Leaders can be filtered by role and keyword together.
- Watchlist search matches visible context fields beyond code/name.
- Recent Stocks supports local search/sort and visible-row CSV export.
- Portfolio positions support local search/sort with a filter-specific empty state.
- News manual refresh passes `cacheBust` so it bypasses cached provider results.
- Settings can reset risk thresholds to defaults.
- Smart Screener result filters have a reset button.
- Dashboard has a manual `刷新工作台` action.
- Dashboard refresh now shows a visible `Last refreshed` timestamp.
- Dashboard refresh now disables repeat clicks while loading, sets `aria-busy`, and restores the button after completion.
- Portfolio current positions can be exported as a dated CSV from the portfolio action bar.
- Portfolio closed-position review now exports closed rows as a dated CSV, and Playwright verifies the download after a complete temporary buy/sell cycle.
- Playwright now reads positions and closed-position CSV downloads to verify headers and expected stock codes.
- Portfolio CSV cells with spreadsheet formula-like prefixes are guarded with an apostrophe; Playwright verifies guarded `=...` names in downloads.
- Portfolio closed-position review now shows count, total realized P/L, win rate, and wins/losses.
- Trades now include `Reset filters`, clearing code/side/date filters and reloading the full list.
- Trades now show `No trades match current filters.` for filtered empty results.
- Trades now show a result summary with current count or filtered-empty text.
- Mobile dark-mode coverage now opens Trades and verifies the reset filter control.
- `npm run test:portfolio` passes. `npm audit --omit=dev --registry=https://registry.npmjs.org/` reports 0 vulnerabilities; the configured npmmirror audit endpoint is unsupported.
- Latest quality sweep: 47 JS files pass `node --check`; duplicate top-level frontend function audit found 0 duplicates; OpenAI smoke skipped cleanly without an API key; startup smoke returned `/ai-status` 200.
- Latest quality sweep: 47 JS files pass `node --check`; duplicate top-level function audit found 0 duplicates; startup smoke returned `/ai-status` 200.
- Latest frontend global-scope audit found 0 duplicate top-level function names; 43 JS files pass `node --check`.
- `npm run test:frontend` currently passes 3 Playwright tests.
- `npm test` currently passes 14 Node tests.
- Do not restart from scratch; continue from the existing implementation and keep the 8-hour requirement explicit.

你是 WebStock 当前仓库的长期开发代理。继续上一次 Goal 模式任务，不要从头重做。

当前状态：
- 已修复“查看/分析”点击无效。
- 已新增工作台首页、最近查看、自选增强、持仓/交易入口增强、股票详情侧栏、资讯 fallback、板块龙头控制面板、智能选股、ChatGPT 交接弹窗。
- 已新增测试：`npm test`、`npm run test:portfolio`、`npm run test:frontend`。
- 进度日志见 `docs/goal-run-log.md`。
- 未完成事项见 `docs/TODO_NEXT.md`。

下一轮目标：
1. 先运行 `npm test`、`npm run test:portfolio`、`npm run test:frontend` 确认基线。
2. 增强智能选股因子：K 线均线、MACD、成交量、波动率、5/20/60 日走势。
3. 增强板块龙头：龙头编辑/删除 UI、导入导出、强弱历史快照。
4. 增强资讯 Provider：真实 Provider + 缓存 + 去重 + 失败状态。
5. 扩展 Playwright 测试，覆盖自选、交易、板块、智能选股交接弹窗。
6. 更新 `docs/goal-run-log.md`、`docs/TEST_REPORT.md`、`docs/GOAL_SUMMARY.md`。

执行要求：
- 每轮仍遵循：观察现状 → 制定小目标 → 修改代码 → 运行测试 → 复盘问题 → 写入日志 → 自动进入下一轮。
- 不接入真实券商交易，不保存真实 API Key，不承诺收益。
- 保持 Express + 原生 JavaScript + ECharts，不引入 React/Vue。
