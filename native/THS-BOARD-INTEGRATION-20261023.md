# 同花顺板块独立来源接入

## 当前结论

北京时间 2026-10-23 03:09：接入实现、定向测试、代表样本联网验证和新版构建已完成；用户授权强制结束旧版后，新版已打开并响应。桌面现场验收、实际截图及最终 Word 报告尚未完成。不得把本记录当作全板块可用性证明或正式发布批准。

工作区固定为 `D:/CodexData/CodexHome-Final/worktrees/runtime-lifecycle-cleanup/Webstock`。没有写入或同步 `G:/Stock`，没有恢复自动化任务。用户回复“你直接强制”后，先完成完整备份，仅强制结束身份已核验的旧进程 PID 45132，未覆盖旧可执行文件；新版 PID 45152 从独立候选目录运行。

## 来源与身份决策

使用独立 `ths-public-board` 来源，东方财富 `eastmoney-public-board` 保留。目录、请求、缓存键同时包含供应商和分类，不按同名板块互换，不把东方财富日线接到同花顺图线上。缓存文件按规范查询的 SHA256 命名。

同花顺行业目录来自 `https://q.10jqka.com.cn/thshy/`，概念目录来自 `https://q.10jqka.com.cn/gn/`。页面声明 GBK 时严格解码；缺分类分组、错误编码、未解析链接、截断和冲突身份均拒绝。保留分类区和当前页可见新概念链接，当前实测 90 个行业和 361 个概念。没有遍历新概念历史归档分页，不能称覆盖同花顺全部历史数据库。目录不含实时报价，报价字段保持缺失而非补零。

概念目录 ID 不等于图表 ID。先检查详情页目录身份和分类，再读取其 `clid`：AI PC 的目录 ID 是 309121，图表 ID 是 886071。行业示例光伏设备是 881279。图表年度地址为 `https://d.10jqka.com.cn/v4/line/bk_<chartCode>/01/<year>.js`。只解析严格 JSONP 包装，不执行脚本，不借用登录 Cookie，不绕过验证或收费权限。

先读取同源 `last.js` 历史清单，再按清单所列年份倒序读取。整个请求链限时 12 秒、最多 9 个年度响应、单响应最多 2 MiB；显式 AlwaysNetwork 和 no-cache。按来源清单核对各年条数、总条数及最后一根 OHLC，收到失败不提交半截序列。

同花顺原始字段次序是日期、开、高、低、收、量、额，不能套用东方财富的字段次序。日线数值和精度不改；周/月只聚合同一来源日线。成交量与成交额保留原值，单位未独立核验。没有补造数据或按成分估算。数据日期不能因请求时间较新而倒退覆盖缓存。

同花顺成分股不在本轮范围，按钮禁用并说明原因，不自动退到新浪。东方财富既有目录和 K 线入口保留；其先前公开 K 线连接失败不因本次新增来源被记为已修复。

## 本轮真实联网结果

联网发生于北京时间 2026-10-23 凌晨，返回的数据日期均为 2026-10-22。这是实际 HTTP 读取，不是把旧缓存标成更新。来源本身没有统一发布时刻，`sourceTime` 保持未知。

| 样本 | 目录 ID | 图表 ID | 本次抓取日线 | 请求窗口显示 | 来源声明历史总数 | 最后收盘 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 光伏设备 | 881279 | 881279 | 677 | 640 | 4078 | 6209.692 |
| 半导体 | 881121 | 881121 | 677 | 640 | 4670 | 13535.481 |
| AI PC | 309121 | 886071 | 638 | 638 / 640 | 638 | 1988.661 |

AI PC 源历史始于 2024-03-05，总数只有 638，已经完整取得来源公开的这些行；申请窗口仍标为不足 640，不请求不存在的 2023 年，不补两行冒充完整。上述三个样本不是全部板块逐一联网验收，也未独立核对交易所逐日交易日历。

## 定向验证与修复

证据目录：`output/ths-board-integration-20261023/`。

- `identity-red.log`：接入前身份不支持的真实 RED。`identity-first-integrated-green.log` 不是 RED，避免误标。
- `contracts-green.log`：曾发现概念分类区只含 351 条；保留失败记录。增加官网当前页 10 个新概念后，`catalog-green.log` 通过 90 / 361 核对。
- `live-before-inventory.json` 与 `live.log`：保留 AI PC 请求不存在 2023 年的失败证据；清单驱动读取修复后，`live-results.json`、`live-history-green.log` 三个样本通过。
- `inventory-tests.log`：源总量和短历史状态正确。
- `transport-tests.log`：403、取消、迟到响应、不借用 Cookie、禁用网络缓存、分类缺项拒绝通过。
- `integrity-red.log`：缓存缺行和日期回退测试先失败；`integrity-green.log` 修复后五个受影响用例通过，涵盖日线数量、最新 OHLC、日期回退、正常周/月聚合和短历史。
- `ui-tests.log`：两个离屏 Qt 界面用例通过，来源切换不会复用别家历史，同花顺成分入口禁用。它们不是完整 Windows 应用的现场截图或人工体验验收。最终校验器修改后的受影响界面结果见 `ui-final-tests.log`。
- `build-preview.log`、`final-build.log`：先 configure 后 -j1，完整应用构建通过。未启动另一个共享并行构建，也未重跑已有全套回归。

## 候选程序与数据保护

候选程序：`output/ths-board-integration-20261023/preview/MarketNativeReview.exe`。

候选 SHA256：`e5d11b8f021e06e90cb34c827b716e17a1250e004e80ede4a9b6ba1b7da69c5f`。

旧程序 SHA256 仍为 `935b3a52faf757b381a80124370bd795085774c91dc5b0c4e52eda74cdb5168c`。源文件与基线哈希、原始响应哈希和收据见 `manifest.json`。原源文件副本在 `baseline/`，新文件及此前未备份的 CMakeLists 不声称存在完整基线副本。

`data-root-check.json` 由候选程序自身的 `--check-data-root` 返回，退出码 0，业务数据库、设置、行情目录均解析到 `output/isolated-preview-20261022/profile`，`windowStarted=false`，`automaticTasksStarted=false`。同目录侧车配置已打包；禁止脱离该配置随意运行候选。03:06 旧进程结束后才打开候选，03:09 进程 Responding=true，窗口标题为“Stock · 原生看盘与研究 - Stock”。这只证明启动和响应，不替代完整页面截图验收。

`preservation-verification.json`：账户和交易记录、35 个分组与保留备份一致；对 G:/Stock/native-profile 的 2287 个文件只读哈希核对无变化。已有完整备份保留在 `output/sector-source-repair-20261023/backup-before-replace`，未覆盖。未改数据库结构、持仓、分组或人工草稿。

本轮关闭前另存 `output/ths-board-integration-20261023/backup-before-force-20261023-0302`：2275 个文件、37 个数据库，清单含文件哈希及备份方法。`after-force-verification.json`、`after-launch-verification.json` 分别证明关闭后与新版启动后，全部业务记录、账户/交易子集、35 个分组和备份一致，SQLite quick_check=ok。只能证明已落盘数据保全，不能保证强制关闭前未落盘的内存编辑恢复。第一次 `backup-before-force-20261023-0300` 因冻结大归档在线备份超过 90 秒未完成，保留作失败记录，不列作可用完整备份。

## 剩余交付与阻塞

Windows Computer Use 的轻量窗口枚举在一次重试和重置会话后仍超时，本轮再次检查仍不可用，按工具恢复规则停止继续输入。没有改用 PowerShell UI Automation 或伪造截图。用户单独授权的旧进程强制结束及候选启动已完成；仍需恢复桌面控制，操作同花顺行业、概念及代表 K 线并拍摄实际截图。

最终 Word 报告尚未生成。用户确认沿用上一份板块数据修复报告结构，展示来源隔离、实际页面及验证结果。本机文档运行时缺少 bundled LibreOffice，前一报告渲染日志明确为 `soffice.exe was not found on PATH`；没有连接的 Word 文档控制会话。不将未渲染文件或旧版截图冒充本次交付。需要恢复可用截图和渲染能力，形成报告并逐页检查。

自动化继续暂停，不能因为本次已构建而恢复。后续只补现场验收、数据保护确认和报告，不重复无关已通过项目、不写 G:/Stock。
