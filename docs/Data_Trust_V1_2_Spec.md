# WebStock v1.2 数据可信版规格

## Objective

把现有行情、自选研究和同花顺本地读取能力汇总成一个可核查的数据状态页，并提供可恢复的全市场前复权日线更新入口。用户必须能在开始筛选或回测前看清：数据来自哪里、截至哪一天、覆盖多少证券、哪些失败，以及同花顺与 WebStock 自选的差异。

本阶段不增加自动交易，也不把缓存、首分钟成交量或公开行情替代为交易所授权竞价/Level-2 数据。

## Tech Stack

- Node.js CommonJS、Express、SQLite、原生 JavaScript/CSS。
- Python 量化采集器继续使用 pandas、requests 和 Parquet。
- 不增加新的运行时依赖。

## Commands

- Node 测试：`npm test`
- 量化测试：`npm run test:quant`
- 开发服务：`npm start`
- Windows 打包：`npm run dist:win:all`

## Project Structure

- `services/dataHealthService.js`：只读汇总本地数据状态。
- `services/tonghuashunWatchlistService.js`：同花顺目录解析与只读差异计算。
- `services/quantService.js`、`routes/quant.js`：全市场增量更新计划与任务入口。
- `quant/webstock_quant/collector.py`、`cli.py`：从已验证基线数据集追加缺失日期，生成新的不可变数据集。
- `js/modules/dataHealth.js`、`index.html`、`css/styles.css`：首页数据健康界面。
- `test/`、`quant/tests/`：Node/API/前端契约和 Python 增量采集测试。

## Code Style

沿用项目现有 CommonJS 和原生 JavaScript 风格，返回值明确声明来源和不可用原因：

```js
return {
  state: available ? 'ready' : 'unavailable',
  observedAt: timestamp || null,
  source: 'tonghuashun-local-file',
  reason: available ? '' : '未找到本地文件'
};
```

## Testing Strategy

- 纯差异、日期和状态归类使用 Node 单元测试。
- API 使用临时数据库和临时同花顺目录，不读取或改写真实文件。
- 增量采集使用临时 Parquet 基线和伪造抓取函数，验证只请求缺失区间、合并去重并产生新清单。
- 页面完成后使用真实浏览器检查 1024×768 布局、交互和控制台错误。

## Boundaries

### Always

- 显示来源、文件更新时间、行情截止日期、覆盖率和失败数量。
- 同花顺同步先显示差异；本阶段的数据健康页面只读。
- 新增量数据集与基线分开保存，失败时保留原基线。
- 复权口径不一致、股票池不一致或基线哈希无效时拒绝增量更新。

### Ask First

- 真正写入同花顺分组。
- 接入收费行情、Level-2、券商登录或交易接口。
- 删除旧量化数据集。

### Never

- 自动下单或自动修改持仓。
- 用缓存时间冒充行情发生时间。
- 用不完整覆盖结果冒充全市场结果。
- 在失败时静默降级到不同复权口径。

## Success Criteria

1. 首页出现“数据健康”卡片，能显示本地数据库、同花顺自选、量化运行环境、最新全市场数据集和活动任务的状态。
2. 同花顺差异预览返回 `onlyInTonghuashun`、`onlyInWebStock`、`shared`，并且不写文件、不写数据库。
3. 全市场更新入口默认以最近一个全市场前复权数据集为基线；没有基线时明确显示“需要首次完整同步”。
4. 有基线时只请求基线截止日后的缺失日期，生成新的数据集和完整清单；旧数据集保持不变。
5. 所有新行为有自动化测试，完整 Node/Python 测试通过，浏览器控制台无错误。
6. 重新生成安装版和便携版，并通过隔离健康检查。

## Implementation Tasks

- [ ] 数据健康总览 API 与首页卡片。
- [ ] 同花顺自选差异预览 API 与展示。
- [ ] 全市场基线识别、增量计划和任务入口。
- [ ] Python 增量合并、校验和不可变新数据集。
- [ ] 浏览器验收、完整回归和 Windows 打包。

## Open Questions

- 交易所授权的历史集合竞价数据源尚未配置，因此本阶段只报告竞价数据可用性，不补造历史竞价序列。
- 同花顺持仓仍以已存在的本地导出/复制表格流程为准；不读取券商凭据。
