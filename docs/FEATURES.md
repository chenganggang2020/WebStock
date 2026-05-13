# WebStock Features

## Settings And AI Status

- Added a Settings tab for AI API status, data/security notes, disclaimers, and saved ChatGPT handoff results.
- Saved handoff results stay in browser `localStorage`; no API keys or brokerage credentials are stored in the repository.
- The tab is covered by the Playwright front-end smoke test.
- Keyboard focus states are visible across buttons, inputs, selects, textareas, and links.
- Icon-only controls include ARIA labels and titles for assistive technology.
- Data backup supports JSON export/import for recent stocks, watchlist, trades, sectors, and sector leaders. Import replaces local workstation data only after browser confirmation.
- Backup export/import also includes leader snapshots, saved smart-screener tasks, linked AI explanations, and saved candidate review notes.

## User Backup API

- `GET /api/user/export`
- `POST /api/user/import`
- `POST /api/user/import-preview`

## News Reliability

- `GET /api/news?withMeta=1` returns items plus cache/provider/degraded metadata for frontend status display.
- News items are normalized and deduplicated before rendering.
- Provider failures are recorded in metadata and do not break the news page, dashboard, or stock-detail news panel.
- Optional `NEWS_JSON_URL` registers an async JSON provider. It accepts an array payload, `{ "items": [...] }`, or `{ "data": [...] }`, then normalizes `title`, `source`, `time`, `summary`, `link`, `type`, `relatedStocks`, and `relatedSectors`.

## Dashboard Risk Alerts

- The dashboard risk card now aggregates watchlist alert-price hits, retained quote warnings, holding drawdowns, weak daily moves, and weakening sector leaders.
- Risk rows are severity-sorted and include quick "View" actions back into the market view.
- Risk thresholds for position drawdown, daily drop, and sector leader drop are configurable from Settings and saved in browser `localStorage`.
- Risk rows support "Dismiss today"; dismissed keys are stored in browser `localStorage` for the current date.
- The dashboard also includes a saved-candidate review summary card with priority/risk/todo counts for recent screener tasks.
- Dashboard candidate-review rows can open the exact saved screener task detail.

## Screener History

- Users can explicitly save the current smart-screener result into `ai_screener_results`.
- Saved screener APIs: `GET /api/screener/results`, `POST /api/screener/results`, `PUT /api/screener/results/:id`, `DELETE /api/screener/results/:id`.
- Saved screener comparison API: `GET /api/screener/results/compare?baseId=&headId=`.
- The screener page renders recent saved tasks and can reopen, rename, or delete a saved candidate list.
- The screener history strip exposes `Compare latest two` and renders added candidates, removed candidates, and score changes.
- Users can also compare a selected base/head pair and open a saved-task detail preview with candidate reasons and risks.
- Smart-screener candidates include local factor tags such as watchlist/holding/recent/leader/MA/MACD context, and the active result can be exported as CSV.
- Candidate rows include score-contribution chips (`factorBreakdown`) so users can see which factor families added points or raised risk flags.
- Saved screener candidates can be marked with manual review status (`watch`, `priority`, `risk`, `skip`, `done`) and notes from the saved-task detail view.
- Saved-task details show review-status counts and can filter candidates by review status.
- Saved-task details can bulk mark the currently filtered candidates with a shared status and note.
- ChatGPT handoff saves can link the returned explanation back to the active saved screener task as `ai_result`; history cards show an `AI saved` badge.
- Saved AI explanations render below the candidate table when the saved task is active.

## 工作台首页

- 顶部导航：工作台、行情、自选、持仓、最近查看、资讯、板块龙头、智能选股、交易记录、统计。
- 工作台卡片：最近查看、自选、持仓、资讯、板块龙头、风险提醒。
- 空状态和快捷入口可直接引导用户添加自选、交易或运行智能选股。

## 股票行快捷动作

- 行情列表支持星标、自选状态、查看、AI 分析、加持仓。
- 动态按钮使用事件委托，避免重复绑定和渲染后失效。

## 最近查看

- 自动记录每次查看的股票。
- 字段：代码、名称、最后查看时间、查看次数、最后价格、最后涨跌幅。
- API：
  - `GET /api/user/recent-stocks`
  - `POST /api/user/recent-stocks`
  - `DELETE /api/user/recent-stocks/:code`
  - `DELETE /api/user/recent-stocks`

## 自选股

- 支持分组、备注、预警上限、预警下限。
- 支持分组筛选、名称/代码搜索、涨跌幅排序。
- 每行支持查看、分析、加持仓、编辑备注、删除。

## 持仓和交易

- 支持买入、卖出、分红、费用。
- 前后端都校验卖出数量不能超过当前持仓。
- 持仓页显示总市值、总成本、浮动盈亏、已实现盈亏、总收益率。
- 持仓行支持查看、买入、卖出、AI 持仓分析、查看交易。

## 股票详情工作台

- 行情视图右侧显示快捷动作、自选状态、持仓状态、最近资讯。
- 支持加自选、加持仓、AI 分析、看资讯。

## 资讯模块

- `services/newsService.js` 提供模块化 fallback Provider。
- API：`GET /api/news`
- 支持市场、个股、板块、自选、持仓类型。
- 外部资讯不可用时不影响页面，可显示本地兜底资讯。

## 板块龙头

- 数据表：`sectors`、`sector_leaders`。
- 历史快照表：`sector_leader_snapshots`，用于记录龙头创建/编辑和 dashboard 刷新时的价量快照。
- 支持板块和龙头股增删改查 API。
- 控制面板支持卡片模式、总览模式、风险模式。
- 龙头股支持查看、AI 分析、加自选、加持仓、查看资讯。
- 龙头股支持 History 入口查看最近快照。
- 板块控制面板支持 Trend 入口，按快照展示最新涨跌、前次涨跌和变化幅度。
- 板块控制面板支持 Prune snapshots，用于保留最近 N 条快照并清理旧记录。
- 板块控制面板支持 Export snapshots CSV，用于导出龙头快照复盘数据。

## 智能选股

- API：
  - `POST /api/screener/run`
  - `POST /api/screener/ai-explain`
- 支持策略：稳健观察、趋势突破、回调观察、板块龙头、短线强势、持仓风险排查。
- 输出候选观察清单、评分、理由、风险、观察价位和免责声明。
- 优先使用本地因子；没有 API Key 时提供 ChatGPT 交接模式。

## AI / ChatGPT 交接

- 使用环境变量 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`。
- 未配置 API Key 时不模拟登录 ChatGPT，不自动提交网页。
- 提供复制提示词、打开 ChatGPT、导入返回结果、保存当前会话结果。
