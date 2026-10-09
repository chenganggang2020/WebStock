# 外部行情历史 K 线接入与验收（2026-10-08）

## 范围与口径

首页原来的 11 张外部行情卡片保留最新报价，点击进入真实历史日 K，不以收盘折线冒充蜡烛图。本轮不修改股票指标、交易、作者采集或生产数据库结构。

- 日经 `^N225`、韩国 `^KS11`、恒生 `^HSI`：Yahoo Finance chart `interval=1d&range=1y`，校验返回的 symbol，保留来源当地日期。
- A50 `CHA50CFD`、纳指 `NQ`、标普 `ES`、道指 `YM`、黄金 `GC`、纽约原油 `CL`、布伦特 `OIL`：新浪 GlobalFuturesService.getGlobalFuturesDailyKLine，与原快照标的对应，不改成另一合约或现货。
- 美元/离岸人民币 `fx_susdcnh`：新浪 NewForexService.getDayKLine，不替换为在岸人民币。其字符串列顺序为日期、开、低、高、收、量，经新浪公开图表 SDK 的 forex 解析实现核对。

保留最多 260 个来源日期。开高低收必须是有效正数且符合高低区间；不完整的日期留空，不以前后价格补造。缺失值、来源全部返回的零量不冒充真实成交量；有量时仅展示来源原值，不擅自标成股或手。期货夜盘可能使用下一交易日日期，最后一根日 K 不保证已收盘。

## 实现

沿用 GET `/api/market/global-index-trends`，增加 `candles`、`validCandleCount`、`volumeStatus`、`dateConvention`、`historyStatus`、每个标的的 `fetchedAt` 与 `lastAttemptAt`，兼容原 `trend` 字段。JSONP 仅剥离固定包装并 JSON.parse，绝不执行源码。

后台五分钟缓存、并发请求合并；成功历史另存数据目录 `global-market-kline-cache.json`。请求失败或重启后保留上次成功历史及原取数时间，标记缓存状态。缓存是行情文件，不直接写生产数据库。

前端先显示已返回的报价，再接入历史，历史字段不能盖掉快照价格、涨幅或报价时间。日 K 支持滑块、滚轮缩放、开高低收悬浮信息；没有量时不绘制空量柱区域。刷新与切换配色保留同一标的缩放窗口。

## 已实际验证

取数原文与解析结果：`output/diagnostics/global-kline-20261008/*-raw.txt`、`live-verification.json`、`verified-payload.json`。11/11 来源响应成功，均有可绘制真实 OHLC。有效根数分别为：日经 242/243、韩国 243/244、恒生 247/247、A50 258/260、纳指 251/260、标普 252/260、道指 252/260、黄金 243/260、纽约原油 228/260、布伦特 250/260、离岸人民币 260/260。根数和最后交易日只描述本次样本，不保证之后覆盖。

本次日经与韩国最后一个日期缺失 close；离岸人民币历史最新为 10 月 7 日；A50 来源已有 10 月 9 日夜盘日 K。均保留真实口径，不强行标为完整的 10 月 8 日收盘数据。

99 项针对性测试通过，覆盖来源身份、OHLC、缺口、零量、缓存失败/重启、报价/历史分离、先报价后历史、缩放保持，以及首页导航与原国内指数流程。未将这些测试称为全仓回归通过。

浏览器只读验收与截图保存在 `output/playwright/global-kline-20261008-*`。预览拒绝写操作产生的 403 为保护机制，不等同桌面故障。安装包与已安装运行状态另以本轮安装清单核验。

## 本机部署核对

已使用同一 staged payload 制作便携验收包和正式安装包 `dist/installer-global-kline-20261008/WebStock-Setup-GlobalKline-20261008.exe`。便携包独立数据、独立端口启动通过，40 个前端文件与本轮源码一致。正式安装包 SHA256：`aa7917dafc13510d188f9755bb35e7b3cf1a04d34cda1b87c68ed0774e315d04`。

旧程序正常退出，未强杀；数据库一致性备份和旧安装目录保存在 `D:/WebstockRuntime/backups/global-kline-update-20261008-2323`。已安装 archive SHA256：`6b80e03b5ae6cd9072a0c976d7ce63ef644a4c1e39ee2090387c8ac7abe82d63`，与验收 payload 一致，四个关键前后端源码文件再次逐项比对。

北京时间 23:29 启动新版并检查：主进程 2712、后台 35072，实际路径 `D:/Program Files/WebStock/WebStock.exe`，health 的程序与数据库状态均为 ok；正式运行接口 11/11 标的均返回有效历史 OHLC。原数据目录不变，自启动仍指向安装版 `--background`，十张核对表数量未减少。持仓、交易、研究、文稿、登录目录不清空。实时与离线核对记录见备份目录的 `installation-*-verification.json`。

公开网页接口无稳定性或实时延迟保证。历史数据与最新报价可能来自不同供应商、不同更新时点，明确分开显示；不声称全历史、分钟 K 或全部标的成交量已经完整覆盖。
