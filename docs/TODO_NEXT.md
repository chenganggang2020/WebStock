# TODO NEXT

## Current Status

- Final observed Goal runtime is 28,834 seconds, about 8 hours 1 minute. The 8-hour requirement is satisfied.
- Final verification passed: `npm test`, `npm run test:portfolio`, `npm run test:frontend`, 47-file `node --check`, duplicate-function audit, startup smoke, OpenAI smoke skip, official npm audit, cleanup, and `git diff --check`.
- The original Goal is complete. The items below are future enhancements, not current blockers.
- The Settings tab is now implemented and tested; next work should focus on deeper screener factors, external news provider hardening, import/export, and broader browser tests.
- Import/export is now implemented for the main personal workstation tables. Next data-portability work should add CSV import templates and conflict previews instead of direct replace-only restore.
- News provider hardening now includes metadata, dedupe, and failure reporting. Next news work should add a real configurable public provider and source-specific parsing tests.
- Dashboard risk alerts now aggregate local signals. Next risk work should add configurable thresholds and persisted dismiss/snooze state.
- Configurable thresholds are now implemented. Next risk work should add persisted dismiss/snooze state and a risk history timeline.
- Per-day dismiss is now implemented. Next risk work should add snooze durations, "show dismissed" review, and a risk history timeline.
- Screener result history is implemented. Next screener work should add compare-between-runs, delete/rename saved tasks, and saved AI explanations linked to a task.
- Screener saved-task rename/delete is now implemented. Next screener work should add compare-between-runs and saved AI explanations linked to a task.
- Saved AI explanations are now linked to the active saved screener task. Next screener work should add compare-between-runs and a detail drawer for saved task contents.
- JSON backup now includes saved screener tasks and AI explanations. Next data-portability work should add conflict preview before import and CSV templates.
- Import preview is now implemented. Next data-portability work should add CSV templates and merge-mode conflict resolution.
- Saved screener review workflows are implemented through dashboard summaries and bulk status edits.
- Sector leader snapshots, History entry, History UI coverage, snapshot backup/export, trend summaries, snapshot pruning controls, snapshot CSV export, broader mobile coverage including Trades, visible focus styles, core ARIA labels, core keyboard-flow regression coverage, same-day dismissed-risk review/restore, dashboard manual refresh plus timestamp/loading feedback, Settings CSV template downloads, risk-threshold reset, visible watchlist alert statuses, detail-side alert status, watchlist bulk grouping/search scope, watchlist visible-row CSV export, portfolio trade CSV export, position search/sort, current-position CSV export with content/formula-prefix assertions, closed-position review/summary/export with content/formula-prefix assertions, trade amount preview, trade filter reset/filtered-empty state/result summary, recent-stock CSV export/search/sort, statistics overview, smart-screener strategy guidance, smart-screener result filtering/reset, sector role/keyword filtering, optional JSON news provider plus deployment docs, news keyword filtering/empty-state coverage, news manual refresh cache-busting, deterministic test DB cleanup, browser oversell coverage, sector leader add-flow coverage, and a broad quality/startup sweep are implemented. Next work should add more visual polish, broader empty/error-state checks, and another focused product improvement while the 8-hour Goal remains active.
- Sector leader configuration JSON export/import is implemented through `/api/sector-config` and `/api/sector-config/import`, plus control-panel buttons. Import defaults to merge mode to avoid accidental data loss.
- Smart screener technical factors now include MA60, 5d trend, 60d trend, and 5-day volume trend when kline snapshots provide enough history.

本次实现了核心工作台能力，但没有真实连续执行满 8 小时。下一轮建议继续按以下顺序推进：

1. 增强智能选股因子
   - 引入稳定 K 线缓存，补 MA5/20/60、MACD、近 5/20/60 日涨跌、波动率。
   - 为不同策略增加更明确的权重解释。

2. 增强资讯 Provider
   - 增加可配置真实公开资讯 Provider。
   - 加强去重、关键词匹配、个股/板块关联。
   - 为资讯失败增加 UI 状态标识和缓存命中时间。

3. 完善板块龙头
   - 增加板块内强弱趋势历史快照。
   - 增加导入导出板块配置。

4. 完善自选股
   - 增加批量编辑分组。
   - 增加预警触发状态和工作台提醒。

5. 完善持仓
   - 增加交易导入模板。
   - 增加手续费/印花税默认配置。
   - 增加已清仓股票的历史收益视图。

6. 扩展前端测试
   - 覆盖自选新增/删除。
   - 覆盖交易新增和超卖提示。
   - 覆盖板块新增龙头、智能选股 ChatGPT 交接弹窗。

7. 视觉和可用性
   - 继续优化移动端密度。
   - 检查所有空状态和错误状态。
   - 增强深色模式下表格、标签和弹窗对比度。
