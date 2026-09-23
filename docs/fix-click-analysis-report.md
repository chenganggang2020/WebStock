# 查看/分析点击故障修复报告

## 现象

- 股票行“查看”缺少明确按钮入口，只能依赖整行点击。
- “AI分析”按钮存在且绑定了事件，但在实时行情视图不可点击。
- 前端 SSE 手写分包解析没有缓冲，存在流式 JSON 被拆包后静默失败的风险。

## 根因

1. `#analysisBtn` 位于 `#indicatorBtns` 内，而 `.indicator-btns` 在实时行情视图被设置为 `visibility: hidden`。
2. `RealtimeChart.showRealtimeView()` 会移除 `visible` class，因此实时行情视图下整个按钮组都隐藏，连同 AI 分析按钮一起不可见。
3. 股票列表动态渲染后使用逐个绑定，后续扩展按钮容易遗漏绑定。
4. `analysis.js` 逐 chunk 按行解析 SSE，遇到浏览器分包时可能丢事件。

## 修改点

- `css/styles.css`
  - 让 `.indicator-btns` 默认可见。
  - 仅在实时行情视图隐藏 K 线指标选择、周期切换和均线设置按钮。
  - 新增股票行快捷按钮样式。
- `js/modules/stockList.js`
  - 股票行新增“查看 / 分析 / 持仓”按钮。
  - 改为 `tbody.onclick` 事件委托，星标和操作按钮都 `stopPropagation()`。
  - “查看”会切到行情页并选择股票；“分析”会选择股票并打开分析面板。
  - 行情刷新失败时保留列表并显示状态，不静默无反馈。
- `js/modules/analysis.js`
  - 改用 `EventSource` 解析 `/api/analysis-stream`。
  - API Key 不可用时显示 ChatGPT 交接模式。
  - SSE 连接失败时显示友好错误。
- `index.html`
  - 股票列表增加“操作”列和状态提示区。

## 验证

- `npm test` 通过。
- `npm run test:portfolio` 通过。
- `npm run test:frontend` 通过。
- Playwright 验证：
  - 股票行“查看”可选择股票。
  - 股票行“分析”可打开分析面板。
  - 未配置 API Key 时显示 ChatGPT 交接提示词。
  - 页面无 `pageerror`。
