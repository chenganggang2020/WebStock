# WebStock 盯盘终端 P0 改造规格

## 1. 产品目标

WebStock 的首页首先回答“现在市场发生了什么、量能正在加速还是减速、哪些对象需要立即关注”，而不是展示功能说明。顶部导航是唯一主导航；左侧只保留按需打开的行情、搜索和资讯抽屉。

## 2. 本轮范围

本轮交付一个可验证的 P0 闭环：

1. 移除永久占用 340–360px 的左侧主导航，改为默认关闭的附属抽屉；搜索、主题切换进入顶部终端栏。
2. 顶部导航补齐“评论工坊”和“复利实验室”，不再维护第二套功能入口。
3. 首页删除 `WebStock 首页`、`MARKET COCKPIT` 及用途解释式文案，保留数据标题、周期、来源、更新时间、可用性和必要的口径边界。
4. 新增沪深市场“量能速度”服务、API、状态卡和走势图：同时间累计同比、最近 5 分钟同比、最近 5 分钟相邻窗口环比，并识别“累计放量但短时转缩”等背离。
5. 个股秒级能力本轮只改善真实口径和入口：公开 1 分钟是主数据；本地 30 秒快照条继续明确为 WebStock 运行期采样，不能标为交易所逐笔。5 秒本地条进入 P1，不通过前端插值伪造。
6. 实现外部 ChatGPT 研究候选与同花顺/WebStock 的统一批次导入：严格合同、幂等 WebStock 落库、同花顺预览/备份/限定分组写入和独立投递状态。热点与产业链结构化产物仍为 P1，不自动交易。

## 3. 信息架构

### 顶部终端栏

- 左侧：抽屉按钮、WebStock 标识。
- 中部：全局搜索。
- 右侧：主题切换；数据连接状态位于导航下方独立状态条，首页内提供行情刷新。
- 下方：单一主导航；包含首页、自选、最近、资讯、板块、产业链、资金动量、本地候选、AI 研究、评论工坊、复利实验室、采集任务、AI 记录、交易、统计、设置。

### 附属抽屉

- 默认关闭，不占用主内容宽度。
- 内容只包含重点资讯、日线关键信息和股票列表。
- 桌面端覆盖在内容之上；小屏使用全宽或受限宽度，并可用遮罩、关闭按钮和 `Escape` 关闭。
- 抽屉不是第二套导航。

### 首页盯盘布局

1. 顶行：刷新时间和刷新动作，不显示营销/欢迎文字。
2. 第一屏：市场情绪、沪深成交额、量能速度状态和量能速度图。
3. 第二屏：主要指数和归一化分时比较。
4. 第三屏：板块热力图与资金样本。
5. 每个数字必须同时有来源状态；缺失显示“暂无/不可用”，不得显示为 0。

## 4. 量能速度数据合同

### 数据源与清洗

- 首选东方财富公开 `trends2` 分钟数据，分别请求上证 `1.000001` 与深证 `0.399001`，保留最近两个有效交易日。
- 只接受 `09:30–11:30`、`13:00–15:00` 的分钟；按 `YYYY-MM-DD HH:mm` 去重、升序。
- 金额必须是非负有限数。若源字段为累计金额，先按交易日差分为分钟金额；若明确为分钟金额则直接使用。
- 沪、深按相同日期与分钟槽合计；单边缺失的分钟不参与市场总量比较。
- 昨日同时间比较使用“交易分钟序号”对齐，午休不产生 90 分钟空洞。

### 指标

设 `A[d,i]` 为交易日 `d` 第 `i` 个有效交易分钟的沪深合计成交额，`C[d,i] = Σ(k<=i) A[d,k]`。

- 同时间累计同比：`cumYoY[i] = C[today,i] / C[previous,i] - 1`。
- 最近 5 分钟同比：`rolling5YoY[i] = Σ(i-4..i) A[today] / Σ(i-4..i) A[previous] - 1`。
- 最近 5 分钟环比：`rolling5Seq[i] = Σ(i-4..i) A[today] / Σ(i-9..i-5) A[today] - 1`。
- 少于 10 个有效分钟时不输出环比；少于 5 个同时间完整槽时不输出 5 分钟同比。

### 状态与滞回

- 累计：连续两个新完整数据槽 `>= +10%` 放量，连续两个 `<= -10%` 缩量，其余平量。
- 5 分钟：连续两个新完整数据槽 `>= +20%` 加速放量，连续两个 `<= -20%` 加速缩量，其余平稳。
- 状态配置标记为 `market-volume-v1-unvalidated`，它是透明的产品启发式，不是经过回测验证的交易信号。
- 背离：累计放量且 5 分钟同比缩量；累计缩量且 5 分钟同比放量。仅在两项均可用时显示。
- 午休冻结最后有效分钟；滚动窗口不跨午休，下午重新预热。开盘前、休市、非交易日展示最近交易日并标记 `latest-close`，不声称实时。

### API

`GET /api/market/volume-pace?refresh=1`

响应要点：

```json
{
  "status": "available|partial|unavailable",
  "marketState": "live|latest-close|stale-cache|delayed",
  "tradingDate": "2026-08-31",
  "comparisonDate": "2026-08-28",
  "asOf": "10:35",
  "metrics": {
    "todayCumulativeAmount": null,
    "previousCumulativeAmount": null,
    "cumulativeYoYPct": null,
    "rolling5YoYPct": null,
    "rolling5SequentialPct": null,
    "cumulativeState": "expanding|flat|contracting|unavailable",
    "shortTermState": "accelerating|flat|decelerating|unavailable",
    "divergence": "cumulative-up-short-down|cumulative-down-short-up|none|unavailable"
  },
  "series": [{"label":"09:30","cumulativeYoYPct":null,"rolling5YoYPct":null,"rolling5SequentialPct":null}],
  "coverage": {"todayPoints":0,"previousPoints":0,"alignedPoints":0,"intervalSeconds":60},
  "source": {"id":"eastmoney-public-index-minute","label":"东方财富公开指数分钟行情","exchangeGroundTruth":false},
  "fetchedAt": "ISO-8601",
  "stale": false,
  "reason": null
}
```

服务可使用 15 秒交易时段缓存、10 分钟休市缓存；上游失败时只可返回有时间戳的旧缓存并标记 `stale-cache`。

## 5. 秒级分时边界

- 当前上游报价最短约 3 秒，不等于交易所逐笔，也不能通过每秒读取缓存提升真实分辨率。
- 当前本地 30 秒条是基于采样快照的 OHLC/量额观察条；必须继续显示 `derived=true`、`exchangeGroundTruth=false`、`volumeCoverage=sample-window` 和运行覆盖时间。
- P1 可增加 5 秒本地快照条，但只针对当前选中股票和少量自选，限制并发和落库量；连续缺样时保留缺口，不插值成交额。
- 真正逐笔/Level-2 需要授权行情源，不能用公开接口替代。

## 6. 外部 AI 统一批次合同

- 当前合同为 `webstock.external-research-batch/v1`，顶层只允许 `schema`、`source`、`revision`、`asOf`、`automaticTrading`、`artifacts`和 `deliveries`；`automaticTrading` 必须严格为 `false`。
- P0 批次必须且只能包含一个 `webstock.research-picks/v1` 产物，候选为 1–20 只不重复有效 A 股；每只必须有研究逻辑、至少一项风险和至少一个证据引用。
- 同花顺是显式投递目标；只有 `includeInTonghuashun: true` 的候选才会写入日荐分组，缺省为不写入。若批次仅投递 WebStock，导入器不要求也不读写同花顺文件。
- `batchKey = SHA-256(source.system + source.taskId + source.runId + revision)`，`payloadHash` 来自规范化负载。同一身份与负载重放不重复写；同一身份但负载改变返回冲突，必须提高 `revision`。
- WebStock 事务落库与同花顺文件投递分别记录。同花顺状态为 `pending/succeeded/failed/no-change/not-requested`；写入前生成预览和备份，只修改 `00_每日荐股_MMDD` 日荐分组并保留最新三组。
- 热点与产业链产物属于后续合同版本；未达到证据、时间和状态门槛时不生成空壳。
- 不读取账号凭据，不登录，不下单，不修改同花顺主自选。

## 7. 验收

- 单元：分钟清洗、午休槽、日期选择、累计/滚动公式、零分母、缺数、阈值、背离和缓存降级。
- 接口：状态码、JSON 字段、刷新参数、超时/旧缓存、缺失不变 0。
- 浏览器：1600×1000 首屏无永久侧栏；顶部搜索可用；全部主导航可达；抽屉可开关/Escape/遮罩关闭；图表 resize 后不溢出。
- 数据质量：页面必须可见分钟粒度、比较日期、截至时间、来源和 `非逐笔` 边界；休市不得显示“实时”。
- 回归：运行相关 Node 测试、完整 `npm test`、语法检查和 Playwright 桌面截图；分别报告聚焦测试与完整回归。

## 8. 不做

- 不一次重写全站或引入新框架。
- 不把 1 秒前端刷新称为 1 秒行情，不插值伪造 5 秒成交。
- 不降低已有来源、时间和可用性标注。
- 不让外部 AI 直接写数据库或任意文件；必须先通过本地合同和受限导入器。
- 不自动交易，不因导入候选自动加入持仓或主自选。
