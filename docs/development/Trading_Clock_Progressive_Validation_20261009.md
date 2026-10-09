# 交易时间与分区刷新：隔离验证记录（2026-10-09）

## 基线与边界

固定基线：`aac38bc77be3614a6cb6d49ee8390603394e4ca5`。独立分支：`codex/trading-clock-progressive-refresh-20261009`。不合并维护分支或 main，不部署、不打包、不运行生产数据库或交易。

已完整读取 Chart_Continuity_Navigation_Audit_20261009.md、Repository_Handoff_Performance_20261009.md，并对照相关源码。执行环境无法连接用户本机工作区，也无法完整克隆仓库；对选定的完整文件逐个核对 Git blob SHA 后，在隔离目录执行真实函数与夹具。不能把这些结果写成用户本机或完整应用验收。

独立安卓的 StandaloneBackend 直接调用公开行情 HTTP 并使用 StandaloneStore；不是必须连接 Windows 3000 端口的旧伴侣。Java 包名沿用 companion 不改变这一源码事实。本轮未修改、打包或真机验证安卓。

## 本轮代码

1. sectorRotationModel：以同日交易时间计算 5/15/30 分钟窗口，午休不再进入时间分母；不增加观测点。保留来源、报告集合数量、金额、合计核验、日期与实际断采限制。沿用 150 秒采样间隔容忍和 75 秒端点容忍，不冒充严格一分钟 OHLC 完整度。行级时间重新核对，不再无条件继承批次会话。
2. sectorRotation.chartOption：只消费明确版本的同日交易时钟；午休压缩，提示仍使用原始采样时间；真实缺口保留 null。旧或混合时钟载荷保守回退。不修改 connectNulls=false。
3. desktopWidget：行情与账户链独立显示，账户摘要先于持仓结果显示；错误分区，不丢弃其他区成功结果；相同 HTML 不重建 DOM；隐藏时不发起轮询；保留已有 30 秒常规/2 秒 loading 检查节奏、超时和 generation 过期响应保护。
4. measure-readonly-health：只 GET 显式回环地址的 /api/health 和 /，不带账户凭据、不跟随跳转、不保存响应正文、不访问数据库。仅测客户端 HTTP 总耗时，不能归因为 SQL、上游或绘图。

## 已执行验证

Node 22.16.0。原有板块模型 11 项通过；新增模型 6 项、图表选项契约 5 项、挂件受控异步/模拟 DOM 7 项、只读脚本 3 项，合计 32/32。没有真正运行 ECharts 渲染器或 Electron 窗口。

```powershell
node --test test/sectorRotationModel.test.js test/sectorRotationContinuity.test.js test/sectorRotationClockView.test.js test/desktopWidgetProgressive.test.js test/readonlyHealthProbe.test.js
```

健康基线采样命令（由本机操作者在无全量测试负载时执行，输出仍留本机）：

```powershell
node scripts/measure-readonly-health.js --baseUrl=http://127.0.0.1:3000 --samples=100 --delayMs=1000 > health-baseline.json
```

该脚本没有在用户运行中的服务执行。自身夹具通过不代表已经取得真实 p50/p95。

原交接报告：桌面全量 2208 中 2192 通过、16 失败；8 个文件锁冲突和 8 项断言失败均未在本轮消除。失败文件串行复查达到 120 秒上限未完成。原定向 149/149、独立安卓 Node 35/35 是之前的结果，本轮未重跑。不得把上述数目与本轮 32 项相加作为覆盖率。

## 三阶段后续验收

### 一、补齐时间轴与指标窗口

保留 realtimeChartModel 的交易轴与 bar-end 规则，以及现有一分钟九转。marketVolumePaceService.windowSum 仍需去掉午前/午后隔离，但须先统一每个来源的快照/分钟开始/分钟结束标签；13:00 快照不是额外成交分钟。marketComparison 的完整分钟轴须根据来源标签语义排除不存在的 13:00 柱。globalMarketBoardService.fillMinuteGaps 须按标的、时区、交易日期、会话日历区分正常休市与缺采，不套用统一 A 股午休；指数、现货、CFD 和外汇不能混用时段。eastmoneyDarkStocks 的十分钟墙钟断采须改交易时间判定，同时保留来源变化、真实断采和不可用数据。缩略图不能先过滤缺失再连接。

验收至少包括：正常午休、午休前后缺采、真实停牌、跨日、不同来源、bar-end 13:01 首柱、实际存在的 13:00 快照、只有五分钟源、未授权、当前未收盘柱、港日会话、跨午夜及夏令时。不能用日榜填分钟历史。

### 二、性能与刷新

现有 services/runtimeDiagnostics 已有 API/SQL 指纹/事务区间；electron/runtimeDiagnostics 和 runtimeWatchdog 已有独立看门狗与心跳、HTTP 证据。desktopBackendProcess 启动后端诊断。优先读取本机卡顿时的诊断，而不是重造架构；本轮未读取这些本机日志。

dashboardLoadMarketCockpit 已先渲染，再被 dashboardLoad 的公共刷新重复绘制；不能说整个首页只能等待 Promise.all。优化应是单区缓存先显示、单区数据版本更新；统一最后更新时间不得冒充每个来源都新鲜。
marketBoard 仍重建 innerHTML 并重复 drawDetail；ChartTheme.renderTo 虽保留百分比缩放/图例，但完整 notMerge=true 更新，追加数据后百分比不等于固定历史时间范围。应保存时间边界、稳定 series id、只更新变化区，按标的/交易日/周期/复权/来源区分视图。
保留服务已有缓存、在途请求合并与并发上限；跨窗口在共享后端复用，隐藏界面降频不停止必须持续的后台采样。新选择优先不等于提高轮询频率。

验收：点击到缓存首屏、点击到新数据、接口 p50/p95/错误率、单个请求键的重复上游请求数、各进程事件循环延迟、SQL 指纹/事务耗时、绘图超过 50ms 的长任务、DOM 写入和 ECharts setOption 次数。先确定同硬件/同来源/同缓存状态基线，再谈改善比例。

### 三、统一导航

app.syncMainViewHistory 只有 mainView/terminalPage，无法完整恢复来源列表、筛选排序、选中行、周期与缩放。建立统一 openInstrument/returnToSource/navigateSibling 控制器；保留股票、指数的资产类型与交易所，不能只用六位代码作为身份。

从来源列表进入图表才 push 来源上下文；切换周期和同列表上一只/下一只只 replace 当前图表状态；返回恢复列表筛选、顺序、滚动、焦点和选中行。保存 lastKPeriod、visibleTimeRange、followLatest、复权、指标与数据版本。异步恢复后再次检查 instrumentKey+period+revision；过期响应不得覆盖。历史状态只存视图，不将账户或文稿塞入 history。

验收：筛选列表→周K→下一只→返回，筛选/滚动/行不变；快速 A/B 切换乱序返回不覆盖；刷新图表保留历史窗口；Esc 优先关闭顶层弹窗；同代码不同市场/资产不串线。此阶段本轮只有规格，尚未接线或端到端验证。

## 官方参照（仅文档核验）

- TradingView：会话外空隙与会话内 inactivity gaps、symbol/resolution/visibleRange 控制。https://www.tradingview.com/charting-library-docs/latest/ui_elements/Chart/
- 富途：同图周期、桌面焦点缩放与平移。https://support.futunn.com/topic58
- 同花顺旧官方手册：技术分析入口与快捷键。旧手册不能当成最新版实测。https://www.10jqka.com.cn/ad_mar/man/05-2.htm
- ECharts：数据驱动 setOption 动态更新；不是所有图都支持 appendData。https://echarts.apache.org/handbook/en/how-to/data/dynamic-data/

未安装或操控这些第三方终端，没有可比较的官方终端延迟测量。
