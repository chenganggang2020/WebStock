# 午休与刷新优化：本地接管及首批验收

日期：2026-10-09（北京时间）。本轮是本地代码接入与验证，不是部署验收。

## 范围与版本

- 维护目录：`D:/CodexData/CodexHome-Final/worktrees/runtime-lifecycle-cleanup/Webstock`。
- 维护分支：`codex/runtime-lifecycle-cleanup-20260926`；原基线 `aac38bc77be3614a6cb6d49ee8390603394e4ca5`。
- 已快进接入外部审查分支的 `576ad4b`、`39d9ec0`：板块交易时间窗口与挂件分区刷新。
- 本地修改：`99705e4` 午休历史采样边界；`73585d1` 首页分区发布及失败保留；`ff8df59` 跨市场控件/图表稳定刷新；`8eb4bec` 当前可见首页错误提示。
- 没有合并 main、推送远端、修改生产数据库、增加业务采集频率、重启运行版或制作安装包。

此前的 `Trading_Clock_Progressive_Validation_20261009.md` 是外部审查环境的历史记录；以下是新增本机证据，不覆盖其测试边界。

## 实际改变

### 板块午休

午休手动采样仍归档并计入归档数量，但不作为连续交易窗口端点、不增加交易时长、不画成额外交易点。前后完整的 5/15/30 交易分钟窗口跨午休计算。历史回放选择端点时同样排除午休观测，避免误退回上午最后一个端点。

真实缺采、来源变化（包括午休换源后又换回）、覆盖集合变化、金额不可用仍会阻断有效窗口。下午批次带午休旧时间的行不能假装正常午休记录。未修改采样间隔容忍，不用插值、补零或 connectNulls=true 掩盖缺口。

### 首页与挂件

- 指数、情绪、板块、指数历史分别发布，不再让已取得的情绪/板块等待慢历史；挂件的行情、账户、持仓分区更新。
- 单区请求失败保留原数据和原时间，显示失败字段；初次失败无缓存仍显示缺失，不生成数值。
- 保留请求序号和用户新选历史窗口的优先级，迟到响应不能覆盖新选择。失败不算作新的 60 秒成功缓存。
- 去掉首页整轮 Promise.all 结束后的重复绘制。检查完成时间与各来源数据时间分开命名。
- 当前首页 `homeSources` 与兼容驾驶舱页脚都显示刷新失败；不只把提示放进隐藏区域。

### 跨市场行情

- 工具栏/设置容器保留，只有改变的 HTML 输入才写入对应区域。使用 WeakMap 记录输入，避免浏览器把 checked 等 HTML 标准化后造成误判和反复重建控件。
- 图表按标的、周期、来源、交易日、主题及实际序列判断；相同序列或仅报价变化不调用 setOption，保留缩放。真正的数据、周期、主题变化仍会重画。
- 同来源、同交易日的临时空响应保留已展示图表，标明缓存；不同来源/交易日不能套用旧序列。
- 隐藏文档的计时器不再绕过可见性判断。此项仅针对前端轮询，不停止后台持久采样；未提高原轮询频率。

## 验证

### 先失败后修复

新增测试先复现午休历史端点、整轮结束重复绘图、慢辅助请求阻塞情绪、失败丢缓存、相同序列重画、空响应清曲线、隐藏页继续轮询等失败，再修改实现。浏览器补充发现 checked 属性标准化导致控件仍被替换，修复后增加模拟标准化回归。

### 定向测试：105/105

```powershell
node --test --test-reporter=spec test/marketBoardFrontend.test.js test/marketBoardPreferences.test.js test/homeTerminal.test.js test/marketOverviewProgressive.test.js test/marketOverviewView.test.js test/marketOverviewModel.test.js test/dashboardMarketCockpit.test.js test/desktopWidgetProgressive.test.js test/readonlyHealthProbe.test.js test/sectorRotationContinuity.test.js test/sectorRotationModel.test.js test/sectorRotationClockView.test.js test/sectorRotationService.test.js test/sectorRotationView.test.js
```

### 独立浏览器：11 项通过

使用静态 QA 服务 `test/qa/desktop-ux-server.cjs` 与 `test/qa/progressive-refresh.html`，真实项目 ECharts、ChartTheme、分时/日 K 构建器，合成数据。页面 API 全部夹具化，不接生产服务或数据库；驾驶舱比较绘制在夹具中计数，不代表整首页真实行情 E2E。

验证：情绪先显示、慢请求结束不额外重画、失败保留及提示、相同序列不重画、设置展开/控件身份/焦点保留、局部缩放保留、空响应保留曲线、null 缺点保留、日 K、返回分时、无页面脚本异常。截图：`output/playwright/progressive-refresh-20261009.png`。

应用内浏览器因 native bridge 不可用未能连接，改用独立 Edge 测试会话；没有操控用户运行中的窗口。测试浏览器和静态测试服务均在验收后关闭。

### 桌面全量：2285 项，2279 通过，6 失败

使用 Node 自带测试器、并发 8、单测试上限 30 秒，默认数据库环境为 `WEBSTOCK_DB_PATH=:memory:`；自带独立数据库的测试沿用其隔离路径。耗时约 21.5 秒，无取消。日志：`output/diagnostics/progressive-full-tests-20261009.log`。

6 项失败在原固定基线 aac38bc 的隔离源码副本中重新执行也复现（该六文件共 37 项，31 通过/6 失败）。失败位置集合相同，不是凭文件名推断旧问题：

| 测试位置 | 当前失败范围 |
| --- | --- |
| expertChannelApi.test.js:479 | 完成文案预期与当前“机器处理完成、未人工校对”的文案不同 |
| industryResearchStage2.test.js:96 | 调度器生命周期源码断言 |
| moduleOwnership.test.js:37 | 作者管理/页面组成断言 |
| paperMonitorScheduler.test.js:101 | 调度器生命周期源码断言 |
| tonghuashunHoldingScheduler.test.js:86 | 调度器生命周期源码断言 |
| volumePaceView.test.js:28 | 旧首页元素顺序断言 |

基线日志：`output/diagnostics/progressive-baseline-six-20261009.log`。本轮不改这些无关行为或放宽断言来制造全绿。基线导出时两个安卓中文文档文件名解包失败；上述桌面源码/测试可执行，不能把这次副本称为完整安卓基线或真机验证。

## 运行版只读延迟观察

实际监听 3000 的 PID 9772 核对为安装版 `D:/Program Files/WebStock/WebStock.exe` 的 `desktopBackendProcess.js`，不是测试服务。未在全量测试负载下测量；当时程序自身后台负载未知。

| 北京时间 / 样本 | 静态首页 | health |
| --- | --- | --- |
| 14:49:29—14:49:42，各20次 | 19成功/1失败；p50 2.993ms，p95 358.911ms | 20成功；p50 2.170ms，p95 198.301ms，max 503.113ms |
| 14:50:26—14:50:31，各5次复查 | 5成功；p50 2.175ms，max 4.071ms | 5成功；p50 2.886ms，max 40.417ms |

请求超时上限 2 秒；分位数仅统计成功请求，第一组失败不能忽略，也没有证据认定失败原因。这些是安装版短样本，只说明存在波动；不是新版前后对比，也不能证明数据库是/不是卡顿根因。未完成真实操作到缓存/新行情的 p95、上游耗时、慢 SQL、事件循环与绘图长任务的同条件联测。

## 明确未完成的后续项

1. 五分钟量能窗口、国内指数 bar-end 13:00、港日/跨午夜会话、明暗资金十分钟断档统一；本轮只落地板块午休部分，不声称“所有线均已修好”。
2. 全局导航来源列表/筛选/焦点/滚动恢复，以及所有图表追加数据时按绝对时间保持可视区。当前只保证跨市场无变化刷新不重画，并保留已有 ChartTheme 行为。
3. 跨窗口请求共享的实测、可见标的优先、完整端到端性能指标及持续交易时段验收。
4. 打包、安装、生产行情与独立安卓验收。本轮无新安装包，不应把代码通过测试解释为运行版已经更新。
