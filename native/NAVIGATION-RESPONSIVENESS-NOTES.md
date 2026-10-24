# Windows 切页响应性专项（2026-10-24）

## 范围与原因

本轮只修桌面切页与应用级股票采集引发的 GUI 阻塞，不重写 Qt、不降低数据完整性校验、不迁移数据库日志模式、不停止已授权的应用内公开行情采集。不是整个应用或安卓性能验收。

三条已复现的同步路径：

- `marketComparisonView` 每次热切仍在显示页面前读取、校验两份板块目录。
- 隐藏期间报价变化后，`home` 补刷绕过已有分组目录快照，再次等待分组库。
- `PublicMarketRuntime::collectStock` 在 GUI 定时回调中 `observe → hydrate`，读取各历史周期，遇行情写锁会阻塞界面。

修复前同机 Release/Qt 离屏测试：1000 条隔离板块目录，30 次普通热切 p50/p95/max 为 94.847/106.068/109.253ms；目录排他锁时 449.842ms；真实备份副本（123 个证券、所选分组 3 个）在分组锁下返回看盘 2511.175ms；900ms 行情写锁下采集派发 945.703ms。后两种锁均只作用于临时库，不影响用户数据。这些数字是确定性复现，不是所有页面的体感或网络行情验收。

## 改动约束

1. 对比页先显示原实例，复用 `PageSnapshotReader` 的单活动/单待执行及代次保护后台读目录。读取和原 SHA/身份/完整性校验在线程内完成，控件更新回 GUI。相同完整结果不重复过滤/重算；失败保留已有目录和选择，后续进入可重试。
2. `home` 仅在待补报价时复用已核验分组目录；原分组编辑、名册改变路径仍完整重读。不改变数据库内容、分组身份或选中证券。
3. `MarketFeed::observe(item, loadSavedHistory=true)` 默认保留互动打开时的原行为。独立应用内采集器使用 `false`：验证证券身份，复用宿主已验证的日线/资金内存字段，不同步重读存储，不保存名册。主 feed 回传只合并已观察身份，不因后台采集登记指数或触发分组重读；资金列表独立读取采集器内存快照（已观察身份优先），正常点击仍 hydrate 所有保存周期。传入的是内部宿主记录，不是新的未校验网络响应。网络解析、持久化合并/校验及失败标志仍走原流程，旧时间不会改成当前时间。

审查补验：先记录两个真实失败（`red-review-guards.txt`）：重载按钮丢失未选板块、未加载历史的后台指数失败时覆盖宿主日线。修复为目录重建复用已验证快照；回传合并检查完整身份，失败仅更新诊断并保留原行、来源、数据日期和检查时间，非空成功数据仍正常更新。

## 验证入口

复用 `heavy_entry_responsiveness_tests`，不新增构建目标：

- `warmComparisonDoesNotWaitForCatalogWriter`
- `warmHomeAfterQuoteChangeDoesNotRereadGroups`
- `backgroundCollectionDoesNotReadHistoryOnGui`
- `comparisonCatalogReloadRetainsStateOnFailureAndAcceptsNewRows`
- `emptyBackgroundIndexDoesNotClearRetainedHistory`
- `backgroundIndexFundsDoNotRegisterOrSkipSavedPeriods`

构建根 `output/b28`，现有 Qt/MinGW 环境，单一构建 `-j1`。原始日志及发布回执放在 `output/navigation-performance-20261024/`；RED 日志保留不覆盖。本轮不重跑无关已通过的 ETF、期货和安卓验收。

构建与定向验证：2026-10-24 04:45 完成，6 个场景均已有 PASS。保持已通过的 4 项记录，只补跑 2 项失败检查。正式候选 SHA256：`18B786EC1790AD1A50ABD2367FC3D2ADEFBB614983BA6ED2966F6DF099E0A6F0`。部署状态见独立 `DEPLOYMENT.json`，不以编译成功代替已打开确认。

| 相同隔离复现场景 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 普通对比页热切 30 次 p95 | 106.068ms | 3.875ms |
| 目录写锁下对比页进入 | 449.842ms | 1.137ms |
| 分组写锁下返回看盘 | 2511.175ms | 4.501ms |
| 900ms 行情写锁下采集派发 | 945.703ms | 复测 0.6425 / 0.824ms |

性能限制：首次组合验证中采集派发出现 145.513ms 波动，超过该项 50ms 目标；未改生产代码的单项复测和最终补验分别为 0.6425ms、0.824ms。原始失败保存在 `focused-attempt-1.txt`，原因未进一步定性，不声称所有环境都低于50ms或全应用零卡顿。另一失败是测试预期未含存储适配器自动补入的 `availableAt:null`，只修正了该测试输入，未为通过断言改生产数据语义。保存历史、目录选择与资金上表的守护检查均已通过。

验证回执与日志：`output/navigation-performance-20261024/VALIDATION.json`、`red.txt`、`red-review-guards.txt`、`focused-attempt-1.txt`、`background-recheck.txt`、`green.txt`。`git diff --check` 通过；只有既有三字符警告，未处理无关文件。未进行全应用长时压力测试、真实外部行情更新验收或安卓性能验收。

## 交付边界

不写 `G:/Stock`，不恢复旧定时任务；数据根继续使用批准的隔离 profile。替换前核对精确路径，正常关闭、备份旧程序及持仓/分组数据，再核验候选哈希与数据根。不得将本专项结果更新为旧 P07/P08 全应用压力测试通过。

04:49 已替换并打开既有 preview 入口，进程 `55004`，标题 `Stock · 原生看盘与研究 - Stock`，窗口存在且 Responding=true；安装哈希与验收候选一致。旧 EXE、配置及9个保护文件备份在 `output/navigation-performance-20261024/replace-backup-20261024-044851/`，替换过程9个文件哈希未变；启动后另核验持仓库、持仓镜像、分组库和自选清单，见 `post-launch-check.json`。没有使用鼠标、强杀或改动旧备份。
