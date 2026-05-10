# WebStock 自选股、持仓、交易记录与组合统计功能开发文档（Codex 执行版）

> 适用项目：`https://github.com/xujh1969/WebStock.git`  
> 目标：在不破坏现有行情、K线、技术指标和 AI 分析功能的前提下，把项目扩展为“行情看板 + 自选股 + 持仓管理 + 交易记录 + 盈亏统计 + AI 组合分析”的个人投资组合管理系统。  
> 执行对象：Codex / 代码代理。  
> 技术原则：保持当前 Node.js + Express + 原生 JavaScript + ECharts 技术路线，不引入 React/Vue。

---

## 0. 当前项目理解

当前 WebStock 项目主要结构如下：

```text
WebStock/
├── server.js
├── index.html
├── package.json
├── ai-config.json
├── stocks.json
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   └── modules/
│       ├── state.js
│       ├── search.js
│       ├── stockList.js
│       ├── indicators.js
│       ├── klineChart.js
│       ├── realtimeChart.js
│       └── analysis.js
└── routes/
    ├── index.js
    ├── ai.js
    ├── stocks.js
    ├── market.js
    ├── analysis.js
    └── cache.js
```

当前功能包括：

1. A 股股票列表搜索；
2. 实时行情；
3. 分时图；
4. K线图；
5. 技术指标；
6. AI 个股分析；
7. 深色/浅色主题切换。

本次新增功能必须与现有功能并存，不得重写整个项目。

---

## 1. 开发总目标

新增以下功能：

1. **自选股功能**
   - 添加自选股；
   - 删除自选股；
   - 自选股分组；
   - 自选股备注；
   - 预警价字段；
   - 刷新后数据仍保留。

2. **交易记录功能**
   - 新增买入、卖出、分红、其他费用；
   - 编辑交易记录；
   - 删除交易记录；
   - 按日期、代码、交易类型筛选；
   - 支持 CSV 导入/导出，可以作为后续增强，第一版如时间不足可只做导出。

3. **持仓管理功能**
   - 根据交易记录自动计算当前持仓；
   - 展示持仓数量、成本价、当前价、市值、浮动盈亏、收益率、今日盈亏；
   - 卖出数量不能超过当前持仓；
   - 修改或删除交易后，持仓应重新计算。

4. **组合统计功能**
   - 总市值；
   - 总成本；
   - 浮动盈亏；
   - 已实现盈亏；
   - 总收益率；
   - 持仓占比图；
   - 个股盈亏排行图。

5. **AI 组合分析功能**
   - 如果项目已经完成 OpenAI API 迁移，则新增“AI 组合诊断”；
   - 如果尚未完成 OpenAI 迁移，则先保留接口和按钮，可显示“请先配置 AI”。

---

## 2. 非目标与限制

本次不要做以下事情：

1. 不接入真实券商交易；
2. 不保存券商账号、密码、Token；
3. 不做真实下单；
4. 不引入 React、Vue、Next.js；
5. 不重构整个前端；
6. 不把核心数据只保存在 `localStorage`；
7. 不破坏原有 `/api/quote`、`/api/kline`、AI 分析、搜索和图表功能；
8. 不删除原有模块；
9. 不修改股票行情颜色习惯，继续使用 A 股习惯：红涨绿跌；
10. 不把 API Key 写死到代码仓库中。

---

## 3. 推荐开发分支

请新建分支：

```bash
git checkout -b feature/portfolio-management
```

如 Codex 环境中无法创建分支，也要在最终总结中列出修改文件清单。

---

## 4. 依赖新增

新增 SQLite 支持：

```bash
npm install better-sqlite3
```

如需要测试工具，可新增：

```bash
npm install --save-dev jest supertest
```

如果测试框架引入成本过高，至少需要提供一个 `scripts/smoke-test.js` 或 `scripts/test-portfolio-api.js` 来做接口冒烟测试。

---

## 5. 数据库设计

新增目录：

```text
db/
├── index.js
└── init.sql

data/
└── webstock.db
```

### 5.1 `db/init.sql`

创建以下表。

#### 5.1.1 自选股表

```sql
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  group_name TEXT DEFAULT '默认分组',
  note TEXT DEFAULT '',
  alert_high REAL,
  alert_low REAL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### 5.1.2 交易记录表

```sql
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell', 'dividend', 'fee')),
  trade_date TEXT NOT NULL,
  price REAL DEFAULT 0,
  quantity INTEGER DEFAULT 0,
  fee REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### 5.1.3 可选：资产快照表

第一版可以先建表但不强制使用。

```sql
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  total_market_value REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  unrealized_pnl REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  total_pnl REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 `db/index.js`

要求：

1. 自动创建 `data/` 目录；
2. 自动打开 `data/webstock.db`；
3. 自动执行 `db/init.sql`；
4. 导出 `db` 实例；
5. 提供 `getDb()` 方法；
6. 初始化失败时输出清晰错误信息。

示例结构：

```js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'webstock.db');
const db = new Database(dbPath);

const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
db.exec(initSql);

module.exports = db;
```

---

## 6. 后端服务设计

新增目录：

```text
services/
├── portfolioService.js
├── tradeService.js
└── watchlistService.js
```

也可以先只写一个 `services/portfolioService.js`，但建议拆分。

---

## 7. 持仓计算规则

持仓必须由交易记录动态计算，不要让用户直接维护持仓数量。

### 7.1 买入

```text
买入成本 = price * quantity + fee
新持仓数量 = 原持仓数量 + quantity
新剩余成本 = 原剩余成本 + 买入成本
新平均成本 = 新剩余成本 / 新持仓数量
```

### 7.2 卖出

```text
卖出收入 = price * quantity - fee - tax
卖出成本 = 当前平均成本 * quantity
已实现盈亏 = 卖出收入 - 卖出成本
剩余数量 = 原持仓数量 - quantity
剩余成本 = 原剩余成本 - 卖出成本
```

如果卖出数量大于当前持仓数量，必须拒绝保存，并返回错误。

### 7.3 分红

```text
分红收入 = amount 或 price * quantity
计入 realizedPnl
不改变持仓数量
```

### 7.4 其他费用

```text
其他费用 = amount 或 fee
从 realizedPnl 中扣除
不改变持仓数量
```

### 7.5 当前浮动盈亏

```text
当前市值 = 当前价 * 持仓数量
浮动盈亏 = 当前市值 - 剩余持仓成本
浮动盈亏率 = 浮动盈亏 / 剩余持仓成本 * 100
```

### 7.6 总盈亏

```text
总盈亏 = 已实现盈亏 + 浮动盈亏
```

---

## 8. 后端 API 设计

新增文件：

```text
routes/portfolio.js
```

并在 `routes/index.js` 中添加：

```js
const portfolioRouter = require('./portfolio');
router.use('/api/portfolio', portfolioRouter);
```

所有接口统一返回：

```json
{
  "success": true,
  "data": {}
}
```

错误返回：

```json
{
  "success": false,
  "error": "错误信息"
}
```

---

### 8.1 自选股 API

#### GET `/api/portfolio/watchlist`

返回自选股列表。

支持可选参数：

```text
group=默认分组
```

#### POST `/api/portfolio/watchlist`

请求体：

```json
{
  "code": "000001",
  "name": "平安银行",
  "groupName": "银行",
  "note": "长期观察",
  "alertHigh": 15.5,
  "alertLow": 10.2
}
```

要求：

1. `code` 必填；
2. `name` 必填；
3. 重复添加时不要报数据库异常，应返回友好提示；
4. 可以使用 `INSERT OR IGNORE` 或先查后插。

#### PUT `/api/portfolio/watchlist/:id`

允许修改：

```json
{
  "groupName": "银行",
  "note": "关注净息差变化",
  "alertHigh": 16,
  "alertLow": 10
}
```

#### DELETE `/api/portfolio/watchlist/:id`

删除指定自选股。

---

### 8.2 交易记录 API

#### GET `/api/portfolio/trades`

支持筛选参数：

```text
code=000001
side=buy
startDate=2026-01-01
endDate=2026-12-31
```

#### POST `/api/portfolio/trades`

请求体：

```json
{
  "code": "000001",
  "name": "平安银行",
  "side": "buy",
  "tradeDate": "2026-05-11",
  "price": 10.52,
  "quantity": 1000,
  "fee": 5,
  "tax": 0,
  "note": "首次建仓"
}
```

要求：

1. `side` 只能是 `buy`、`sell`、`dividend`、`fee`；
2. 买入、卖出必须有 `price` 和 `quantity`；
3. `price` 不能小于 0；
4. `quantity` 不能小于 0；
5. `fee` 和 `tax` 不能小于 0；
6. 新增卖出记录前必须校验当前可卖数量；
7. `amount` 可由后端计算；
8. 保存后返回保存后的记录。

#### PUT `/api/portfolio/trades/:id`

修改交易记录。

要求：

1. 修改后需要重新校验是否出现超卖；
2. 如果修改导致历史某个时间点超卖，也必须拒绝；
3. 修改后持仓页面能够重新计算。

#### DELETE `/api/portfolio/trades/:id`

删除交易记录。

要求：

1. 删除前二次确认由前端完成；
2. 删除后重新计算持仓。

#### GET `/api/portfolio/trades/export`

导出 CSV。

第一版如时间不足，可以先返回 JSON，并在文档中说明 CSV 导出待完善。

---

### 8.3 持仓与统计 API

#### GET `/api/portfolio/positions`

返回当前持仓列表。

返回示例：

```json
[
  {
    "code": "000001",
    "name": "平安银行",
    "quantity": 1000,
    "avgCost": 10.52,
    "currentPrice": 11.20,
    "marketValue": 11200,
    "costValue": 10520,
    "unrealizedPnl": 680,
    "unrealizedPnlRate": 6.46,
    "realizedPnl": 0,
    "todayChange": 1.25,
    "todayPnl": 138.27
  }
]
```

要求：

1. 持仓数量为 0 的股票默认不返回；
2. 如果查询行情失败，仍然返回持仓，但 `currentPrice` 可以为 `null`；
3. 当前价尽量复用项目已有行情获取逻辑；
4. 不要因为某一只股票行情失败导致整个接口失败。

#### GET `/api/portfolio/summary`

返回组合总览：

```json
{
  "totalMarketValue": 11200,
  "totalCost": 10520,
  "unrealizedPnl": 680,
  "realizedPnl": 0,
  "totalPnl": 680,
  "totalPnlRate": 6.46,
  "positionCount": 1,
  "winCount": 1,
  "lossCount": 0
}
```

#### GET `/api/portfolio/allocation`

返回持仓占比：

```json
[
  {
    "code": "000001",
    "name": "平安银行",
    "marketValue": 11200,
    "ratio": 100
  }
]
```

#### POST `/api/portfolio/recalculate`

重新计算持仓，用于调试或修复数据。

---

## 9. 前端结构设计

新增文件：

```text
js/modules/watchlist.js
js/modules/trades.js
js/modules/portfolio.js
js/modules/portfolioCharts.js
```

修改文件：

```text
index.html
css/styles.css
js/app.js
js/modules/state.js
js/modules/stockList.js
```

---

## 10. 前端页面布局设计

### 10.1 新增主功能导航

在 `index.html` 右侧主区域顶部增加：

```html
<div class="main-tabs" id="mainTabs">
  <button class="main-tab active" data-main-view="market">行情</button>
  <button class="main-tab" data-main-view="watchlist">自选</button>
  <button class="main-tab" data-main-view="portfolio">持仓</button>
  <button class="main-tab" data-main-view="trades">交易记录</button>
  <button class="main-tab" data-main-view="stats">统计</button>
</div>
```

要求：

1. 原有实时行情和 K 线内容放到 `marketView` 内；
2. 新增 `watchlistView`、`portfolioView`、`tradesView`、`statsView`；
3. 通过按钮切换视图；
4. 默认显示 `marketView`；
5. 不影响原有右上角“历史K线/实时行情”切换功能。

---

### 10.2 行情视图

原有内容包裹为：

```html
<div id="marketView" class="main-view active">
  <!-- 原有 chart-header、realtimeView、klineView 放这里 -->
</div>
```

---

### 10.3 自选股视图

新增：

```html
<div id="watchlistView" class="main-view" style="display:none;">
  <div class="section-header">
    <h2>我的自选股</h2>
    <div class="section-actions">
      <select id="watchlistGroupFilter">
        <option value="">全部分组</option>
      </select>
      <button id="addCurrentToWatchlistBtn">添加当前股票</button>
      <button id="refreshWatchlistBtn">刷新行情</button>
    </div>
  </div>
  <div id="watchlistEmpty" class="empty-state">暂无自选股，请先添加关注股票。</div>
  <table class="data-table" id="watchlistTable">
    <thead>
      <tr>
        <th>代码</th>
        <th>名称</th>
        <th>最新价</th>
        <th>涨跌幅</th>
        <th>分组</th>
        <th>预警价</th>
        <th>备注</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody id="watchlistTbody"></tbody>
  </table>
</div>
```

---

### 10.4 持仓视图

新增：

```html
<div id="portfolioView" class="main-view" style="display:none;">
  <div class="section-header">
    <h2>我的持仓</h2>
    <div class="section-actions">
      <button id="addTradeFromPortfolioBtn">新增交易</button>
      <button id="refreshPortfolioBtn">刷新持仓</button>
      <button id="aiPortfolioAnalysisBtn">AI组合诊断</button>
    </div>
  </div>

  <div class="summary-cards">
    <div class="summary-card">
      <div class="summary-label">总市值</div>
      <div class="summary-value" id="summaryMarketValue">--</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">总成本</div>
      <div class="summary-value" id="summaryCost">--</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">浮动盈亏</div>
      <div class="summary-value" id="summaryUnrealizedPnl">--</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">已实现盈亏</div>
      <div class="summary-value" id="summaryRealizedPnl">--</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">总收益率</div>
      <div class="summary-value" id="summaryPnlRate">--</div>
    </div>
  </div>

  <div id="portfolioEmpty" class="empty-state">暂无持仓，请先新增买入记录。</div>

  <table class="data-table" id="positionsTable">
    <thead>
      <tr>
        <th>代码</th>
        <th>名称</th>
        <th>数量</th>
        <th>成本价</th>
        <th>当前价</th>
        <th>市值</th>
        <th>浮动盈亏</th>
        <th>收益率</th>
        <th>今日盈亏</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody id="positionsTbody"></tbody>
  </table>

  <div class="portfolio-charts">
    <div id="allocationChart" class="portfolio-chart"></div>
    <div id="pnlRankChart" class="portfolio-chart"></div>
  </div>
</div>
```

---

### 10.5 交易记录视图

新增：

```html
<div id="tradesView" class="main-view" style="display:none;">
  <div class="section-header">
    <h2>交易记录</h2>
    <div class="section-actions">
      <input id="tradeCodeFilter" placeholder="代码/名称">
      <select id="tradeSideFilter">
        <option value="">全部类型</option>
        <option value="buy">买入</option>
        <option value="sell">卖出</option>
        <option value="dividend">分红</option>
        <option value="fee">费用</option>
      </select>
      <input id="tradeStartDate" type="date">
      <input id="tradeEndDate" type="date">
      <button id="addTradeBtn">新增交易</button>
      <button id="exportTradesBtn">导出</button>
    </div>
  </div>

  <div id="tradesEmpty" class="empty-state">暂无交易记录。</div>

  <table class="data-table" id="tradesTable">
    <thead>
      <tr>
        <th>日期</th>
        <th>类型</th>
        <th>代码</th>
        <th>名称</th>
        <th>价格</th>
        <th>数量</th>
        <th>手续费</th>
        <th>印花税</th>
        <th>金额</th>
        <th>备注</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody id="tradesTbody"></tbody>
  </table>
</div>
```

---

### 10.6 统计视图

新增：

```html
<div id="statsView" class="main-view" style="display:none;">
  <div class="section-header">
    <h2>组合统计</h2>
    <button id="refreshStatsBtn">刷新统计</button>
  </div>
  <div class="portfolio-charts">
    <div id="statsAllocationChart" class="portfolio-chart"></div>
    <div id="statsPnlChart" class="portfolio-chart"></div>
  </div>
</div>
```

---

### 10.7 交易弹窗

新增统一交易弹窗：

```html
<div id="tradeModalOverlay" class="modal-overlay" style="display:none;">
  <div class="modal trade-modal">
    <h3 id="tradeModalTitle">新增交易</h3>
    <input type="hidden" id="tradeIdInput">

    <label>股票代码</label>
    <input id="tradeCodeInput" placeholder="000001">

    <label>股票名称</label>
    <input id="tradeNameInput" placeholder="平安银行">

    <label>交易类型</label>
    <select id="tradeSideInput">
      <option value="buy">买入</option>
      <option value="sell">卖出</option>
      <option value="dividend">分红</option>
      <option value="fee">费用</option>
    </select>

    <label>交易日期</label>
    <input id="tradeDateInput" type="date">

    <label>成交价格</label>
    <input id="tradePriceInput" type="number" step="0.001">

    <label>成交数量</label>
    <input id="tradeQuantityInput" type="number" step="100">

    <label>手续费</label>
    <input id="tradeFeeInput" type="number" step="0.01" value="0">

    <label>印花税</label>
    <input id="tradeTaxInput" type="number" step="0.01" value="0">

    <label>备注</label>
    <textarea id="tradeNoteInput"></textarea>

    <div class="modal-actions">
      <button id="tradeModalCancel">取消</button>
      <button id="tradeModalOk">保存</button>
    </div>
  </div>
</div>
```

---

## 11. 前端状态管理修改

修改 `js/modules/state.js`，新增：

```js
let currentMainView = 'market';
let watchlist = [];
let trades = [];
let positions = [];
let portfolioSummary = null;
let portfolioAllocation = [];

const State = {
  // 保留原有字段
  get currentMainView() { return currentMainView; },
  set currentMainView(val) { currentMainView = val; },

  get watchlist() { return watchlist; },
  set watchlist(val) { watchlist = val; },

  get trades() { return trades; },
  set trades(val) { trades = val; },

  get positions() { return positions; },
  set positions(val) { positions = val; },

  get portfolioSummary() { return portfolioSummary; },
  set portfolioSummary(val) { portfolioSummary = val; },

  get portfolioAllocation() { return portfolioAllocation; },
  set portfolioAllocation(val) { portfolioAllocation = val; }
};
```

注意不要删除原有字段。

---

## 12. 股票列表星标功能

修改 `js/modules/stockList.js` 的 `renderStockTable()`：

1. 表头增加星标列；
2. 每行增加 `☆` 或 `★`；
3. 点击星标时阻止事件冒泡，不触发选股；
4. 已在自选股中的股票显示 `★`；
5. 未在自选股中的股票显示 `☆`；
6. 点击 `☆` 调用 `Watchlist.addStock(stock)`；
7. 点击 `★` 调用 `Watchlist.removeByCode(code)`。

要求：

```js
event.stopPropagation();
```

避免点星标时打开股票详情。

---

## 13. `watchlist.js` 功能要求

实现：

```js
async function loadWatchlist()
async function addCurrentStock()
async function addStock(stock)
async function removeByCode(code)
async function removeById(id)
async function updateWatchlistItem(id, payload)
async function renderWatchlist()
async function refreshWatchlistQuotes()
```

暴露：

```js
window.Watchlist = {
  loadWatchlist,
  addCurrentStock,
  addStock,
  removeByCode,
  removeById,
  updateWatchlistItem,
  renderWatchlist,
  refreshWatchlistQuotes
};
```

---

## 14. `trades.js` 功能要求

实现：

```js
async function loadTrades(filters)
function renderTrades()
function openTradeModal(mode, trade)
function closeTradeModal()
async function saveTrade()
async function deleteTrade(id)
function collectTradeForm()
function validateTradeForm(payload)
```

要求：

1. 新增交易后刷新交易表；
2. 新增交易后刷新持仓；
3. 编辑交易后刷新交易表和持仓；
4. 删除交易后刷新交易表和持仓；
5. 卖出超量时显示后端错误；
6. 日期默认今天；
7. 从当前股票添加交易时自动填入代码、名称、当前价。

---

## 15. `portfolio.js` 功能要求

实现：

```js
async function loadPortfolio()
async function loadSummary()
async function loadPositions()
function renderSummary()
function renderPositions()
function openBuyTrade(stock)
function openSellTrade(position)
async function refreshPortfolio()
```

要求：

1. 进入持仓页时自动加载；
2. 表格中显示买入、卖出、查看交易按钮；
3. 点击持仓股票代码可以切换到行情页并选中该股票；
4. 盈亏为正显示红色；
5. 盈亏为负显示绿色；
6. 无持仓时显示空状态。

---

## 16. `portfolioCharts.js` 功能要求

使用 ECharts。

实现：

```js
function renderAllocationChart(data)
function renderPnlRankChart(positions)
function resizePortfolioCharts()
```

要求：

1. 持仓占比饼图；
2. 个股盈亏柱状图；
3. 深色模式切换后图表颜色跟随主题；
4. 页面切换到统计/持仓时调用 `resize()`。

---

## 17. `app.js` 修改要求

在 `bindButtons()` 中新增：

1. 主视图切换；
2. 自选股按钮事件；
3. 持仓刷新事件；
4. 新增交易事件；
5. 交易筛选事件；
6. 交易弹窗保存/取消事件；
7. AI组合诊断按钮事件。

伪代码：

```js
document.querySelectorAll('.main-tab').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const view = btn.getAttribute('data-main-view');
    switchMainView(view);
  });
});

function switchMainView(view) {
  State.currentMainView = view;

  document.querySelectorAll('.main-view').forEach(el => el.style.display = 'none');
  document.getElementById(view + 'View').style.display = '';

  document.querySelectorAll('.main-tab').forEach(btn => btn.classList.remove('active'));
  document.querySelector('[data-main-view="' + view + '"]').classList.add('active');

  if (view === 'watchlist') Watchlist.loadWatchlist();
  if (view === 'portfolio') Portfolio.loadPortfolio();
  if (view === 'trades') Trades.loadTrades();
  if (view === 'stats') Portfolio.loadPortfolio();
}
```

注意：`market` 对应的是 `marketView`，不要写错。

---

## 18. CSS 样式要求

修改 `css/styles.css`，新增：

```css
.main-tabs
.main-tab
.main-view
.section-header
.section-actions
.summary-cards
.summary-card
.summary-label
.summary-value
.data-table
.empty-state
.portfolio-charts
.portfolio-chart
.trade-modal
.pnl-up
.pnl-down
.star-btn
```

要求：

1. 与原项目风格一致；
2. 支持深色模式；
3. 表格在小屏幕可横向滚动；
4. 卡片间距合理；
5. 弹窗不能超出屏幕；
6. 颜色变量尽量复用项目已有 `--up`、`--down`、背景色、文字色。

---

## 19. AI 组合分析设计

如果当前 `routes/ai.js` 已经完成 OpenAI API 迁移，可新增：

```text
POST /api/portfolio/ai-analysis
```

请求体可以为空，后端自动读取：

1. 当前持仓；
2. 组合总览；
3. 最近 20 条交易记录；
4. 持仓占比。

Prompt 示例：

```text
你是一名谨慎的投资组合分析助手。请根据以下持仓、盈亏和交易记录，对该投资组合进行结构性分析。请注意：
1. 不要承诺收益；
2. 不要给出绝对化买入或卖出指令；
3. 只能给出风险提示、观察建议和仓位结构建议；
4. 必须包含免责声明：AI 分析仅供参考，不构成投资建议。

【组合总览】
{{SUMMARY}}

【当前持仓】
{{POSITIONS}}

【最近交易记录】
{{TRADES}}

请输出：
一、组合总体情况
二、持仓集中度
三、盈利与亏损来源
四、主要风险
五、后续观察重点
六、仓位结构建议
七、免责声明
```

如果 AI 未配置：

```json
{
  "success": false,
  "error": "AI 未配置，请先配置 OpenAI API Key"
}
```

前端显示友好提示。

---

## 20. 安全与数据校验要求

后端必须校验：

1. `code` 只能是 6 位数字；
2. `side` 只能是指定枚举；
3. `price >= 0`；
4. `quantity >= 0`；
5. `fee >= 0`；
6. `tax >= 0`；
7. `tradeDate` 必须是合法日期；
8. 卖出不能超过持仓；
9. 所有数据库操作使用参数绑定，不拼接 SQL；
10. API 返回错误时不能泄露完整堆栈到前端。

---

## 21. 测试要求

### 21.1 启动测试

执行：

```bash
npm install
npm start
```

访问：

```text
http://localhost:3000
```

必须确认：

1. 页面能打开；
2. 股票列表能加载；
3. 搜索能使用；
4. 点击股票能显示行情；
5. K线能切换；
6. AI分析按钮不报前端 JS 错误。

---

### 21.2 API 冒烟测试

新增脚本：

```text
scripts/test-portfolio-api.js
```

脚本做以下测试：

1. 添加自选股；
2. 获取自选股；
3. 新增买入交易；
4. 获取交易记录；
5. 获取持仓；
6. 获取组合 summary；
7. 新增合法卖出交易；
8. 尝试超量卖出，应失败；
9. 删除测试交易；
10. 删除测试自选股。

在 `package.json` 中新增：

```json
{
  "scripts": {
    "test:portfolio": "node scripts/test-portfolio-api.js"
  }
}
```

如果已有 scripts，要合并，不要覆盖原有 `start` 和 `dev`。

---

### 21.3 前端测试清单

手工测试：

1. 进入页面后默认仍显示行情；
2. 点击“自选”进入自选页；
3. 无自选股时显示空状态；
4. 添加当前股票到自选；
5. 刷新页面，自选股仍存在；
6. 点击星标可添加/移除自选；
7. 点击“持仓”进入持仓页；
8. 无持仓时显示空状态；
9. 新增买入交易后，持仓出现；
10. 新增卖出交易后，数量减少；
11. 卖出超过持仓时，前端显示错误；
12. 删除交易后，持仓重新计算；
13. 深色模式下自选、持仓、交易记录表格可读；
14. 原有行情/K线功能仍然正常；
15. 原有 AI 个股分析功能仍然正常或以未配置方式友好提示。

---

## 22. 数据示例

测试用数据：

```json
[
  {
    "code": "000001",
    "name": "平安银行",
    "side": "buy",
    "tradeDate": "2026-05-01",
    "price": 10,
    "quantity": 1000,
    "fee": 5,
    "tax": 0,
    "note": "测试买入"
  },
  {
    "code": "000001",
    "name": "平安银行",
    "side": "sell",
    "tradeDate": "2026-05-05",
    "price": 11,
    "quantity": 300,
    "fee": 5,
    "tax": 3.3,
    "note": "测试卖出"
  }
]
```

预期：

```text
剩余持仓数量 = 700
买入总成本 = 10000 + 5 = 10005
平均成本 = 10.005
卖出收入 = 3300 - 5 - 3.3 = 3291.7
卖出成本 = 10.005 * 300 = 3001.5
已实现盈亏 = 290.2
剩余成本 = 10005 - 3001.5 = 7003.5
```

---

## 23. 兼容网络限制

注意：Codex 云环境可能无法稳定访问新浪财经、东方财富等外部行情接口。

因此测试逻辑要求：

1. 对外部行情接口失败要有降级；
2. 持仓接口即使拿不到当前价，也应返回持仓数量和成本；
3. 自动测试中不要强依赖真实实时行情；
4. 如有必要，可以在测试脚本中 mock 当前价；
5. 不得因为行情 API 请求失败导致整个测试失败。

---

## 24. 最终验收标准

最终提交前必须满足：

1. `npm install` 成功；
2. `npm start` 成功；
3. 页面能打开；
4. 原有功能不失效；
5. 自选股可增删改查；
6. 交易记录可增删改查；
7. 持仓可以由交易记录自动计算；
8. 卖出超量会被阻止；
9. 总览指标可正确展示；
10. ECharts 持仓占比和盈亏图能显示；
11. 深色模式可用；
12. 刷新页面后数据仍存在；
13. 至少提供一个可运行的接口测试脚本；
14. 最终回复中列出：
    - 修改文件；
    - 新增文件；
    - 执行的测试命令；
    - 测试结果；
    - 未完成事项或风险。

---

# 可直接粘贴给 Codex 的总提示词

请你在当前仓库 `xujh1969/WebStock` 中开发“自选股、持仓、交易记录、组合统计和 AI 组合分析”功能。请直接修改代码、运行测试，并在最后给出修改文件清单、测试命令和测试结果。

当前项目是 Node.js + Express 后端、原生 JavaScript 前端、ECharts 图表。请保持现有技术路线，不要引入 React/Vue/Next.js，不要重写整个项目。当前项目已有股票搜索、实时行情、分时图、K线、技术指标、AI 个股分析、深色模式等功能，本次新增功能不能破坏这些原有功能。

开发目标：

1. 新增 SQLite 本地数据库，使用 `better-sqlite3`。
2. 新增 `data/webstock.db` 用于保存自选股和交易记录。
3. 新增 `db/index.js` 和 `db/init.sql`，启动时自动初始化数据库。
4. 新增自选股表 `watchlist`，字段包括：
   - id
   - code
   - name
   - group_name
   - note
   - alert_high
   - alert_low
   - sort_order
   - created_at
   - updated_at
5. 新增交易记录表 `trades`，字段包括：
   - id
   - code
   - name
   - side，允许值为 buy、sell、dividend、fee
   - trade_date
   - price
   - quantity
   - fee
   - tax
   - amount
   - note
   - created_at
   - updated_at
6. 第一版不要手动维护 positions 表，持仓必须根据 trades 动态计算。
7. 新增 `routes/portfolio.js`，并在 `routes/index.js` 中挂载到 `/api/portfolio`。

请实现以下后端接口：

1. `GET /api/portfolio/watchlist`
2. `POST /api/portfolio/watchlist`
3. `PUT /api/portfolio/watchlist/:id`
4. `DELETE /api/portfolio/watchlist/:id`
5. `GET /api/portfolio/trades`
6. `POST /api/portfolio/trades`
7. `PUT /api/portfolio/trades/:id`
8. `DELETE /api/portfolio/trades/:id`
9. `GET /api/portfolio/positions`
10. `GET /api/portfolio/summary`
11. `GET /api/portfolio/allocation`
12. `POST /api/portfolio/recalculate`

所有接口统一返回：

```json
{
  "success": true,
  "data": {}
}
```

错误时返回：

```json
{
  "success": false,
  "error": "错误信息"
}
```

持仓计算规则：

1. 买入：
   - 买入成本 = price * quantity + fee
   - 新持仓数量 = 原持仓数量 + quantity
   - 新剩余成本 = 原剩余成本 + 买入成本
   - 新平均成本 = 新剩余成本 / 新持仓数量
2. 卖出：
   - 卖出收入 = price * quantity - fee - tax
   - 卖出成本 = 当前平均成本 * quantity
   - 已实现盈亏 = 卖出收入 - 卖出成本
   - 剩余数量 = 原持仓数量 - quantity
   - 剩余成本 = 原剩余成本 - 卖出成本
3. 分红：
   - 计入已实现盈亏，不改变持仓数量。
4. 其他费用：
   - 从已实现盈亏中扣除，不改变持仓数量。
5. 当前浮动盈亏：
   - 当前市值 = 当前价 * 持仓数量
   - 浮动盈亏 = 当前市值 - 剩余持仓成本
   - 浮动盈亏率 = 浮动盈亏 / 剩余持仓成本 * 100
6. 总盈亏：
   - 总盈亏 = 已实现盈亏 + 浮动盈亏
7. 如果卖出数量大于当前持仓数量，必须拒绝保存，并向前端返回明确错误。

前端要求：

1. 修改 `index.html`，在右侧主区域增加主功能切换按钮：
   - 行情
   - 自选
   - 持仓
   - 交易记录
   - 统计
2. 保留原有行情和 K 线功能，把它们包进“行情”视图中。
3. 新增 `watchlistView`：
   - 自选股表格；
   - 添加当前股票；
   - 删除自选；
   - 修改分组、备注、预警价；
   - 刷新行情；
   - 空状态提示。
4. 新增 `portfolioView`：
   - 顶部卡片显示总市值、总成本、浮动盈亏、已实现盈亏、总收益率；
   - 持仓表格显示代码、名称、数量、成本价、当前价、市值、浮动盈亏、收益率、今日盈亏；
   - 每行有买入、卖出、查看交易按钮；
   - 下方显示持仓占比饼图和个股盈亏柱状图。
5. 新增 `tradesView`：
   - 交易记录表格；
   - 新增交易弹窗；
   - 编辑交易；
   - 删除交易；
   - 按代码/名称、交易类型、开始日期、结束日期筛选。
6. 新增 `statsView`：
   - 展示组合统计图表；
   - 如暂时没有历史快照，可以先展示持仓占比和盈亏排行。
7. 新增统一交易弹窗，支持买入、卖出、分红、费用。
8. 修改 `js/modules/state.js`，新增：
   - currentMainView
   - watchlist
   - trades
   - positions
   - portfolioSummary
   - portfolioAllocation
9. 修改 `js/modules/stockList.js`，在股票列表中增加星标：
   - 未自选显示 `☆`
   - 已自选显示 `★`
   - 点击星标添加或移除自选；
   - 必须 `event.stopPropagation()`，避免触发选股。
10. 新增：
    - `js/modules/watchlist.js`
    - `js/modules/trades.js`
    - `js/modules/portfolio.js`
    - `js/modules/portfolioCharts.js`
11. 修改 `js/app.js`，绑定新增视图切换、按钮、弹窗和筛选事件。
12. 修改 `css/styles.css`，增加新增页面、表格、卡片、弹窗、图表、星标按钮样式。
13. UI 风格必须与现有项目保持一致，支持深色模式。
14. 盈利用红色，亏损用绿色，保持 A 股习惯。

AI 组合分析要求：

1. 如果项目已经完成 OpenAI API 迁移，请新增 `POST /api/portfolio/ai-analysis`。
2. 该接口自动读取组合总览、当前持仓、最近 20 条交易记录，构造 prompt 调用现有 AI 能力。
3. 输出内容包括：
   - 组合总体情况；
   - 持仓集中度；
   - 盈利与亏损来源；
   - 主要风险；
   - 后续观察重点；
   - 仓位结构建议；
   - 免责声明。
4. 如果 AI 未配置，返回友好错误：
   - `AI 未配置，请先配置 OpenAI API Key`
5. 前端“AI组合诊断”按钮在 AI 未配置时显示友好提示。

后端数据校验要求：

1. `code` 必须是 6 位数字。
2. `side` 必须是 buy、sell、dividend、fee 之一。
3. `price >= 0`。
4. `quantity >= 0`。
5. `fee >= 0`。
6. `tax >= 0`。
7. `tradeDate` 必须是合法日期。
8. 卖出不能超过持仓。
9. 所有 SQL 必须使用参数绑定，不得拼接用户输入。
10. API 错误不能把完整堆栈暴露给前端。

测试要求：

1. 保留原有 `npm start` 和 `npm run dev`。
2. 新增测试脚本：
   - `scripts/test-portfolio-api.js`
3. 在 `package.json` 中新增：
   - `"test:portfolio": "node scripts/test-portfolio-api.js"`
4. 测试脚本需要覆盖：
   - 添加自选股；
   - 获取自选股；
   - 新增买入交易；
   - 获取交易记录；
   - 获取持仓；
   - 获取组合 summary；
   - 新增合法卖出；
   - 尝试超量卖出，必须失败；
   - 删除测试交易；
   - 删除测试自选股。
5. 如果 Codex 环境无法访问真实行情接口，不要让测试失败。持仓接口应允许行情失败时仍返回成本和数量，当前价可以为 null。
6. 最后请运行：
   - `npm install`
   - `npm start` 或至少 `node server.js` 做启动验证
   - `npm run test:portfolio`
7. 如果无法长时间保持服务运行，请说明原因，并至少运行后端模块级测试。

最终交付要求：

1. 给出新增文件列表；
2. 给出修改文件列表；
3. 给出测试命令；
4. 给出测试结果；
5. 给出仍存在的限制或后续建议；
6. 不要提交真实 API Key；
7. 不要接入真实券商交易；
8. 不要破坏原有行情、K线、AI 个股分析功能。
