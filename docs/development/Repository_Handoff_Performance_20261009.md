# 当前源码快照与更新流畅度交接

日期：2026-10-09，北京时间。

## 范围与状态

用户要求上传当前最新代码，并交由既有“查询仓库功能”对话继续分析图表、终端交互和更新流畅度。此次保存维护分支 `codex/runtime-lifecycle-cleanup-20260926`，不自动合并主分支，不部署，不修改生产数据。本轮只新增交接文档；其余源码修改为此前已有工作。

提交前 HEAD 为 `8d67e4d9b56f3dc4de4611b3fef4f580e04743c8`，相对已核对的远端 main `b1fffd0e365065bb4652f6bf895d488149139db0` 有 16 个尚未上传的提交。快照还包含当前桌面全球行情、悬浮挂件、九转和导航等未提交修改，以及 `android-independent/` 独立安卓源码。不能继续用 9 月 23 日主分支代表当前功能，也不能把独立安卓目录仍描述为仅依赖电脑的旧伴侣页面。

这是开发状态快照，不是全量测试通过或发布批准。源码上传不等于完成下述优化。数据库、运行日志、采集文稿、登录会话、真实密钥、模型和安装产物不属于此次提交范围。

## 1. 本轮验证

| 检查 | 结果 | 边界 |
|---|---|---|
| 桌面 Node 全量 `node --test --test-reporter=spec test/*.test.js` | 2208 项，2192 通过，16 失败，约 69 秒 | 非全绿，不可据此直接批准合并 |
| 图表、全球行情、挂件、九转、导航等 13 个文件定向测试 | 149 项全部通过 | 不代替桌面鼠标交互或实盘覆盖 |
| `node --test android-independent/qa/*.test.cjs` | 35 项全部通过 | 本轮没有重建 APK 或真机验收 |
| 对全量失败涉及的 13 个文件串行复查 | 120 秒到达上限，复查未完成 | 已输出一项 expertChannelApi 断言失败；不能声称其他失败已排除 |
| 暂存区空白检查 | 11 个安卓文件有文件末尾额外空行提示 | 保留用户当前源码，没有为此次快照做格式清理；无此项全绿声明 |

全量失败分布：

- 8 个测试文件报告 `database is locked`：investmentSignalService、paperMonitorScheduler、tonghuashunCurrentAdapterService、tonghuashunHoldingScheduler、tonghuashunSafeFileDelivery、tonghuashunWatchlistService、tonghuashunWindowHoldingService、watchlistLevelService。
- 8 项断言失败：expertChannelApi 1 项、industryResearchService 2 项、industryResearchStage2 3 项、moduleOwnership 1 项、volumePaceView 1 项。
- 部分旧布局/生命周期断言在此前回归记录中也失败，但本次没有逐项做基线对照，不能将所有失败都归为旧问题。
- 本轮测试环境没有设置 `WEBSTOCK_DB_PATH`。`db/index.js` 默认指向源码目录的 `data/webstock.db`，导入即执行初始化与迁移；并发测试共享默认开发库是锁冲突的待核查因素。这里的锁报错不是生产数据库卡顿的证据。后续应将每个测试进程的数据目录隔离，并检查未释放的服务/定时器，不要修改或清空生产库以解决测试。

定向测试文件：`globalMarketBoard`、`marketBoardFrontend`、`marketBoardPreferences`、`marketWidget`、`sequentialKlineIntegration`、`sequentialSignalModel`、`stockNavigationFlow`、`globalIndexTrend`、`marketComparisonView`、`chartCoachFrontendContract`、`homeMarketMergeNavigation`、`homeStockBrowser`、`realtimeChartIntegration`，均位于 `test/`，后缀 `.test.js`。

## 2. 更新卡顿：实测与不能下的结论

对正在运行的本机程序仅做有界只读请求，没有触发采集、行情刷新、登录或数据库写操作。

| 北京时间与条件 | `/api/health` 三次耗时 | 静态首页三次耗时 | 状态 |
|---|---|---|---|
| 13:21:59–13:22:03，本机全量测试同时运行 | 1737、1198、2430 毫秒 | 4、6、3 毫秒 | 全部 HTTP 200，健康检查数据库 ok |
| 13:25:34，测试运行结束后复查 | 186、1、1 毫秒 | 3、2、2 毫秒 | 全部 HTTP 200，健康检查数据库 ok |

前一组受测试负载干扰，后一组只是短时小样本，不是 p95、长期性能或数据库无问题的证明。`server.js` 健康检查执行 `SELECT 1`；`routes/cache.js:latestCacheTimestamp()` 遍历内存缓存，不是在健康检查里扫描历史行情数据库。静态页面快、健康检查短时变慢，只能提示继续区分后台事件循环与数据路径，不能直接断言 SQLite 或 Python 是根因。实际行情接口和绘图耗时仍需单独测量。

## 3. 已定位的优化候选

以下是源码路径和待测假设，不是已验证的唯一根因：

1. `js/modules/dashboard.js:dashboardLoad()` 汇总多个任务后 `await Promise.all(tasks)` 才执行公共更新时间与卡片刷新。需确认哪些区域已独立显示、哪些被慢任务拖延，再按区域先到先显示。
2. `js/modules/desktopWidget.js` 先等待市场与账户两个请求，再取持仓，最后统一绘制。可以拆分行情/持仓区域的加载与错误状态，让已取得的数据先呈现，不能用失败区域阻挡全部内容。
3. `js/modules/marketBoard.js:render()` 重写卡片容器 `innerHTML`；刷新后可能再次 `drawDetail()`。优先对未变化快照跳过重绘、只更新变化字段，并保留焦点、配置展开状态与图表缩放。
4. `js/modules/chartTheme.js:renderTo()` 已有缩放保护，但采用完整 `setOption(..., {notMerge: true, lazyUpdate: false})`。需测量长任务和渲染次数，再决定哪些普通刷新可以复用实例、增量更新，不能破坏换标的时的序列清理。
5. `js/modules/apiClient.js` 已存在同渲染进程 GET 去重；主窗与独立挂件是不同渲染进程，不能假定它们共享请求表。后台全球行情服务已有缓存、单次在途合并、并发限制和有界返回，不能重复设计或无脑提高轮询频率。
6. `services/globalMarketBoardService.js` 过期缓存与详情读取的返回时序可评估“先展示带时间的旧数据，再后台更新”。本地读取、上游补取、页面渲染需要分别计时；失败保留上一份有效数据，不清空为零，不把检查时间当行情时间。

建议先采集：点击到缓存首屏、点击到新行情、API p50/p95、同一标的重复请求数、后台事件循环延迟、慢查询和渲染长任务。选择当前可见标的与主要指数为优先对象，隐藏页面降频；保留正常后台采集，不让 UI 轮询反复启动采集任务。

## 4. 图表和终端交互交接

先完整阅读 [图表连续性与行情工作台交互核查](Chart_Continuity_Navigation_Audit_20261009.md)。该文包含实际源码证据、边界复现和主流产品官方资料链接；没有声称所有产品都完成实机体验。

- 正常午休应按交易时间压缩，指标沿有效交易 bar 继续计算；真实缺数必须保留缺口及解释，不能统一打开跨空值连线、插值或补零。
- 量能、板块轮动、明暗盘、国内指数与港日市场必须各自按交易日历和来源时间标签核验；个股分时及一分钟九转已具备的连续计算应保留。
- 不同入口打开个股、指数、全球品种，使用一致的详情工作区；返回恢复来源列表、筛选、滚动、标的、周期和图表缩放。
- 首页优先自选/持仓与关键指数，中心图表、相关盘口和指标；日终研究不能挤占盘中主位。默认展示与自定义选择兼容，不重做品牌或改变应用身份。
- 分阶段提交：先时间轴/指标窗口及回归，再缓存/独立刷新，再统一导航。每阶段给出代码、夹具测试、实测边界；不要把设计稿当实现，也不要把夹具通过当实时数据可得。

## 5. 执行边界

既有“查询仓库功能”对话应以此次推送后提供的固定提交 SHA 读取源码。若该对话仅有只读仓库连接器，需明确能力限制，交付文件/函数级设计和可应用补丁，不能宣称已改本地程序。需要写代码时使用独立开发分支并给出测试；不擅自合并 main、部署安装、修改生产数据库、启动交易、上传账户或文稿数据，也不恢复已删除定时任务。
