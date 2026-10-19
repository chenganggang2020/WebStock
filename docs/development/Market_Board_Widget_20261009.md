# 可选行情板与桌面挂件 · 2026-10-09

## 目标与诊断

现有外部行情弹窗仅渲染日 K，未请求分时；固定 11 项列表没有纳斯达克综合、道琼斯现货指数、SOX。纳指100期货 CFD 不等于纳斯达克综合指数。保留既有 A 股详情与自选分组，不改变交易、持仓同步、采集和启动身份。

## 页面设计

保留首页国内三大指数。跨市场区工具条：`跨市场盯盘 | 展示设置 | 桌面挂件`。设置折叠，不增加常驻大面板。默认八项：纳斯达克综合、道琼斯、费城半导体、标普500、恒生、VIX、纽约黄金 CFD、美元/离岸人民币。全目录可勾选、排序、恢复默认，也允许隐藏全部。

卡片：名称 / 最新报价 / 涨跌幅 / 最近时段分钟线 / 数据时间。详情默认分时，可切换日 K；分时明确交易日、来源、北京时间、缺口和刷新失败。卡片和弹窗都不能把日线冒充分钟线。指数、CFD、汇率分别命名。

桌面挂件：约 350×480 的独立小窗，拖动标题栏、调整大小、置顶开关、关闭按钮。设置内选择行情项目、持仓盈亏、持仓明细、账户与金额隐藏。默认不开启，启用后保存状态与位置，下次程序启动恢复；主窗口隐藏不影响挂件，完全退出销毁挂件。手机/浏览器不可用的系统悬浮功能明确提示，页面配置仍可用。

## 数据和刷新

- Yahoo Finance chart：真实指数一分钟与日 K，核对 symbol、时间戳、交易时段；最新时段取来源交易时间，不按北京时间零点截断美国交易日。
- 新浪公开行情：现有 CFD 分时与日 K；不以 Yahoo 到期合约冒充 CFD。汇率保持 fx_susdcnh 标识。
- 分钟线按返回点留空，不插值；零成交量不当作已核验成交。公开源延迟未保证，轮询间隔不等于行情延迟。
- 只抓所选项目。每项 30 秒缓存、并发合并、最多 4 个外部请求、7 秒超时；日 K 缓存 5 分钟。只保留最近成功快照文件，失败保留旧图与原取数时间。非全量历史采集服务。
- 挂件行情 30 秒、持仓估值 30 秒读取现有只读 API。持仓未提供当日盈亏时显示缺失；注明持仓采集日和行情时间，不用账户旧快照假装实时。

## 观察依据

- https://indexes.nasdaqomx.com/Index/Overview/COMP ：纳斯达克市场综合观察。
- https://indexes.nasdaqomx.com/Index/Overview/SOX ：半导体设计、制造、销售等行业观察。
- https://www.spglobal.com/spdji/en/indices/equity/sp-500/ ：美国大盘对照。
- https://www.spglobal.com/spdji/en/indices/equity/dow-jones-industrial-average/ ：美国蓝筹对照。
- https://www.cboe.com/tradable-products/volatility-trading/ ：30 日预期波动，非方向预测。

## 实施顺序与验收

1. 新行情服务与解析测试：身份、空值、跨午夜、失败缓存、单飞。保留旧 API。
2. 页面自选与详情：保存/重新打开、全隐藏、分时日K切换、迟到响应隔离、窄窗口布局。
3. Electron 挂件：独立最小权限 preload，只允许主窗口与挂件的受信主 frame；记录位置、关闭和重启行为；拒绝导航与任意 IPC。
4. 浏览器真实数据检验、隔离 Electron 挂件验证、打包验证。真实源返回与固定样本测试分开报告。

主要文件：services/globalMarketBoardService.js、js/modules/marketBoardPreferences.js、js/modules/marketComparison.js、electron/marketWidget.js、js/desktop-widget.html。代码沿用 CommonJS 后端、UMD 前端及紧凑配色，例如 `const value = raw == null ? null : Number(raw);`，缺失数值不转成零。

验证命令：`node --test test/globalMarketBoard.test.js test/marketBoardPreferences.test.js test/marketWidget.test.js test/marketComparisonView.test.js test/globalIndexTrend.test.js test/globalMarketSignalService.test.js`。不用生产数据库测试，不覆盖已有业务数据，不改系统代理、不创建定时任务。

## 实测与审查

北京时间 2026-10-09 00:56 的网络实测：16/16 目录项返回分钟点；新增的纳斯达克综合、道琼斯、SOX、标普500、VIX 各返回 252 根有效日 K。这是本次访问成功，不承诺持续可用或交易所级实时。VIX 的观测时间比其他美国指数更旧，按各自真实时间展示。日本、香港市场的空白还包括休市区间，不能声称所有分钟完整。

证据：`output/diagnostics/market-board-20261009/live-source-check.json`；仅用于测试的只读预览将 POST 全部拒绝，浏览器中的 recent、chart-coach/analyze、portfolio/recalculate 403 是该隔离限制，未写入生产数据。

页面真实操作验证：勾选日经、取消、隐藏全部后重新载入仍为空、恢复默认、SOX 分时/日 K 切换、来源说明不被遮挡。截图在 `output/playwright/market-board-home.png`、`market-board-sox-minute-fixed.png`、`market-board-sox-daily-fixed.png`。

原生 Electron 挂件实际验证：读取 4 项行情、切换置顶、改变尺寸、销毁后恢复位置与置顶状态、关闭后不自动重开；见 `output/diagnostics/market-board-20261009/native-widget-check.json` 与 `native-widget.png`。测试曾发现退出前尺寸未保存，已修复并通过真实窗口复测。主窗口与挂件主 frame 同时核对 URL/身份，其他窗口不能调用挂件控制。

新增的慢源测试先失败，修改后通过：单项超时不再拖住整排卡片；接口最多等 2 秒便返回已完成项，后台单飞继续，尚在读取的项显示加载并短暂轮询。外部请求同时最多 4 个。挂件默认 4 项、金额隐藏，独立于主页的 8 项默认。

本轮没有改交易逻辑、采集调度、生产数据库和系统自启动配置，也没有提交或推送原有未提交更改。

## 交付验证

- 2026-10-09 最终针对性回归：12 个测试文件、109 项通过，0 失败；包含行情解析、请求合并/并发上限、慢源、过期响应、图表与自选导航、挂件及后台退出。不是全仓回归。
- 隔离便携包启动验证通过：健康接口、独立看门狗、前后台进程、本地股票搜索，以及 45 项前端资源 SHA256 与当前源码一致。
- 安装包：`dist/installer-market-board-20261009/WebStock-Setup-MarketBoard-20261009.exe`，122818989 字节；SHA256 `aad4cf073809fc1679faf4543eb1dc213bce8928277250b2e01ecf7fadfb634f`。此包未数字签名。
- 本轮未安装替换。01:06 北京时间复核原安装版主进程仍为 2712，后台为 35072，健康接口与数据库均正常；仅关闭本轮隔离预览与测试浏览器。
- 使用入口：市场总览 → 跨市场盯盘 → 展示设置；同一工具条的“桌面挂件”或托盘菜单可开关悬浮窗。挂件默认隐藏金额；在挂件设置内选择行情、账户、盈亏与持仓明细。
