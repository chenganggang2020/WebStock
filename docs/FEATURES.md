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

## AI 研究中心

- 支持书籍、博主文章、视频转写、研报和个人笔记的本地资料库。
- 资料会拆分为稳定证据块，并通过 SQLite FTS5 支持中文模糊检索；分析结论可引用稳定证据编号。
- 支持观点还原、时间线、个股匹配、反证检查和候选股复核五种模式。
- 智能选股结果可直接进入专家知识库复核，候选数据与来源证据会同时写入 ChatGPT 交接提示词。
- 人物、书籍与方法研究库支持公开创作者时间线、视频/图片/PDF/笔记归档状态、结构化曲线预览、资料增删、证据分级和语录事件回测；抖音频道可按时间范围检索新增线索、批量导入公开分享链接、按视频 ID 去重、统计直接来源并打开官方播放器。
- 模型注册表区分“本地可用、已配置、未配置、规划中和不可用”，不把外部项目名称伪装成已部署模型。
- 专家资料和研究记录随 JSON 工作站备份导出、预览和恢复。
- 可复现量化基线支持检测独立 Qlib/LightGBM 环境、采集有哈希清单的数据集、启动/停止后台任务和查看研究结果。
- Windows x64 可在页面安装或修复独立量化环境；支持官方 PyPI/国内镜像、进度显示、停止、失败回滚和安装回执，不修改系统 Python。
- 可通过桌面文件选择器复用本机已有的 Python 3.12 量化环境；只有 Qlib、LightGBM、PyTorch 等依赖健康检查通过后才保存路径，不重复安装依赖。
- 量化结果展示 Rank IC、ICIR、年化收益、基准、最大回撤、Sharpe、换手和调仓次数，并始终展示数据覆盖率与限制。
- 候选股票同时显示行情截止日和模型训练截止日；双击可进入现有股票详情。
- 公开未复权日线只能生成“探索性”结果，不能在界面或接口中提升为“已验证”。
