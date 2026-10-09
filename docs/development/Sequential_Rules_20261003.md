# 九转扩展规则 v1：两端共用的可核验计算

2026-10-03；规则身份 `sequential-public-rules-v1`。

本模块是公开规则的独立实现，替换旧简化计数须由界面明确选择并显示规则身份。它不表示获得 DeMARK 授权，也不声称与商业软件逐根等价。旧 `marketSignalModel.js` 不在本次引擎修改范围内。

## 已实现的规则

令 C/H/L 为收盘/最高/最低；buy 是下行耗竭观察方向，sell 是上行耗竭观察方向，不是买卖指令。

| 阶段 | 本版本的精确定义 |
| --- | --- |
| 启动 | buy：C[i−1] > C[i−5] 且 C[i] < C[i−4]；sell 镜像。相等不算翻转。 |
| Setup | 从翻转根计 1；buy 连续 C[i] < C[i−4]，sell 用 >；中断即重置。显示完整 1–9，不反复画被截断的 9。 |
| 完善 | buy 的第8或9根 L 严格小于第6及7根 L；sell 用 H 严格大于。之后首次满足也记录完善事件，但不回写过去的9。 |
| Countdown | 从 Setup9 当根起，buy 满足 C[i] ≤ L[i−2] 才加1，sell 用 C[i] ≥ H[i−2]；不满足只等待，不要求连续。 |
| 13对8 | 第13候选根还需 buy 的 L ≤ 第8计数根 C，sell 的 H ≥ 第8计数根 C；否则保持12，画“+”。 |

翻转定义采用 [Wiley 出版社《DeMark Indicators》公开节选，第1章](https://catalogimages.wiley.com/images/db/pdf/9781576603147.excerpt.pdf)。Setup/Countdown 与完善比较可对照 [Axial Finance 官方指标说明](https://www.axialfinance.com/en/manuel/pagesindicateurs/pageTDS.html)；13对8来自 [DeMARK 官方 Sequential 说明](https://demark.com/sequential-indicator/)。

本版本另实现：trueHigh=max(H,前收)，trueLow=min(L,前收)；buy Setup 的最高 trueHigh 为 TDST 阻力，sell Setup 的最低 trueLow 为 TDST 支撑。未完成 Countdown 遇反向完成9，或 buy 出现 trueLow 高于对应阻力 / sell 出现 trueHigh 低于对应支撑时取消。循环重计采用官方公开的22延伸与后继同向 Setup 真振幅为前一 Setup 100%–200%两条条件，范围端点在本实现中取含端点。[规则来源](https://demark.com/sequential-indicator/)

### 明确的实现选择和未实现项

- 当前只跟踪一个未完成 Countdown；新同向9若不满足范围重计，继续原 Countdown。重计当根可成为新计数1。
- 延伸到22只重计尚未完成的同向 Countdown；已完成13永久保留，不因未来数据被删除。取消、重计、后续完善另记事件，不重写历史观察。调用方可根据 sequenceId 灰化被取消的未完成计数，但不能删除历史核验事实。
- TDST 保留最新对应9的价位及 active 状态；其“已突破”不是商业版 Breakout Qualifiers 认证。
- 没有实现可选8对5检验、Intersection、Combo、商业版突破资格、风险价及自动交易；不采用其他文献的161.8%循环版本。必须展示这些边界，不能只把标题改成“完整官方九转”。

## 数据与完成状态

输入按实际周期时间升序，每根需真实 `open/high/low/close/date`（或 `time`）。null、`gap`、`missing`、`synthetic`、非正数、错误 OHLC、重复或倒序时间均保留原位置并断开状态，不过滤压缩。仅有 `price` 的分时曲线不能伪造 OHLC 来调用本模型；报价5秒聚合不等于1分钟成交K线。

`incomplete:true` 或 `closed:false` 为未收盘。`incomplete:false` 或 `closed:true` 为来源明确完成；未来开始时间仍拒绝。无明示状态时，必须传 `asOf`：day 在北京时间当日15:00，week 在所属周五15:00，month 在月底15:00之后才确认；节假日提前完成需提供明确状态或 `endTime/closedAt`。分钟周期默认时间戳为起点，到起点加周期才确认，`timestampMeaning:'bar-end'` 可明确终点语义。此规则不推断交易日历。

无 `asOf` 且没有完成元数据，结果标 `confirmation:'unknown'`，不生成确认信号。未收盘根可以显示当前试算，但不会形成可回测事件，也不会用于随后历史根的状态延续。调用方须显式传递日期、复权和实际周期，不能把日线、分钟、补造报价混算。

## 调用契约

浏览器全局 `SequentialSignalModel`，Node `require('./sequentialSignalModel')`。无网络、存储、时钟读写或输入修改。

```js
const series = SequentialSignalModel.calculateSeries(rows, {
  asOf: '2026-10-03T08:00:00Z', timeframe: 'day'
});
const review = SequentialSignalModel.evaluateHistory(rows, {
  asOf: '2026-10-03T08:00:00Z', timeframe: 'day', horizons: [1, 5, 20]
});
```

`calculateSeries` 与输入等长，各项：

- `index/date/available/confirmed/provisional/confirmation/reason`；available 表示足够连续比较历史，不表示已出现信号。
- `setup:{direction,count,runLength,completed,perfected,triggered,sequenceId}`；count 展示上限9，runLength 用于22重计，`triggered` 仅当根确认9；completed 为阶段进度，不能单独用于确认样式。
- `countdown:{direction,count,qualified,deferred,triggered,sequenceId}`；只在当根确认13时 triggered。
- `marks[]` 含 `type/direction/label/price/index/sequenceId/confirmed/provisional/explanation`；setup、countdown、countdown-deferred、perfection、recycle 分层展示。buy 标在低点侧，sell 在高点侧。
- `events[]` 包含翻转、完成、完善、取消、循环；取消与重计保留旧 sequenceId，便于证据追溯。
- `levels.support/resistance` 为 null 或 `{price,originIndex,sequenceId,active,confirmed,breachedAt?}`。
- `label/rule/ruleset` 为当前状态与公开规则说明。

## 历史核验不是交易回测

`evaluateHistory` 只收集确认的 Setup9 与 Countdown13，按已加载K线数核对后续1/5/20根收盘收益；horizons 可传正整数。缺后续或未收盘/未来数据为 pending，途中缺口或异常为 invalid，两者收益均 null。不得把少量夹具测试解释成市场有效性。

事件生成不读取未来；后续收益自然读取后续，但不反过来修改信号。输出 `triggerUsesFutureData:false`、`validationUsesFutureData:true`、`isTradingBacktest:false`。未含交易成本、停牌可成交性、滑点、仓位或复权影响。

## 验证

```powershell
node --test test/sequentialSignalModel.test.js
node --test test/sequentialSignalModel.test.js test/marketSignalModel.test.js test/nineTurnChartMarks.test.js test/intradayNineTurnChart.test.js
```

本轮纯引擎16项通过；含旧模型/图表聚焦回归共37项通过。覆盖双向、1–9、严格翻转、相等、晚完善、非连续13、13对8延迟、反向/TDST取消、两种循环、空值缺口、重复时间、未收盘、周期完成、历史未到期、UMD一致与前缀不重画。均为可复现夹具，不是授权行情样本或真实收益认证；界面接入与打包由主线另验。
