# 评论策略工坊规格

## 目标

新增一个只从侧栏进入的“评论策略工坊”，把已保存的公开评论变成可追溯的研究线索，而不是把评论中的自报胜率直接变成选股模型。首期只完成四项：评论证据库、作者发言中心、策略规则卡、支持/反证地图。

用户已确认按这一首批范围实施。当前开发数据库的评论表为空，因此页面必须把“尚未保存评论”与“视频没有评论”严格区分。

## 实施假设

1. 复用现有创作者、观察记录和评论只读接口，不新增数据库表或第三方依赖。
2. 已采集评论继续由现有 `expert_comments` 和 `expert_comment_captures` 保存；本页不直接登录抖音、不主动采集，也不读取账号凭据。
3. 规则卡和人工证据分类首期保存在本机 `localStorage`，不写入交易、持仓或 AI 研究结果。
4. 只有 `verified` 和 `platform_marked` 可进入“作者发言”；`suspected` 仍显示为未确认同名账号。
5. 支持、反证和待核问题均由用户人工标记，程序不根据措辞、点赞或 AI 自动判断立场。

## 页面结构

- 侧栏新增一个“评论工坊”入口；顶部主导航不增加按钮，避免继续挤压。
- 顶部选择创作者和观察记录，只按当前记录加载一次评论，避免为全部视频并发取数。
- 四个标签：
  1. **评论证据库**：评论正文、父回复上下文、作者身份、时间、点赞和采集覆盖。
  2. **作者发言中心**：只列出已核验或平台标注的作者评论与回复；回复保留原问题。
  3. **策略规则卡**：股票池、周期、信号时点、入场、退出、止损、仓位和费用八项门禁；缺项时只能保存为草稿。
  4. **支持／反证地图**：用户将当前评论标为支持、反证或待核问题，显示原文和来源；未标记内容不自动归类。

## 数据与状态

- `GET /api/expert/channels`
- `GET /api/expert/channels/:id/observations`
- `GET /api/expert/channels/:id/observations/:observationId/comments`
- 评论覆盖必须展示接口返回的 `status`、`message`、`observedAt`、`visibleCount` 和 `complete`。
- 规则卡键：`webstock.commentStrategy.ruleCards`。
- 证据分类键：`webstock.commentStrategy.evidenceLabels`。
- 所有评论文本按不可信数据转义后再写入页面。

## 代码结构与风格

- `js/modules/commentStrategyModel.js`：纯函数，负责讨论串、作者发言、规则完整性和人工证据分组。
- `js/modules/commentStrategyLab.js`：只读取数、按需渲染和本机草稿保存。
- `index.html`、`css/styles.css`、`js/app.js`：入口、页面、响应式和导航。

现有代码风格示例：

```js
function isVerifiedCreator(comment) {
  return comment.creatorStatus === 'verified' || comment.creatorStatus === 'platform_marked';
}
```

## 测试策略与命令

- 纯模型：`node --test test/commentStrategyModel.test.js`
- 页面契约：`node --test test/commentStrategyView.test.js`
- 聚焦回归：`node --test test/commentStrategyModel.test.js test/commentStrategyView.test.js test/expertChannelService.test.js`
- 完整回归：`npm test`
- 便携版：`npm run dist:win:portable`
- 真实浏览器：桌面和 390px 手机宽度检查，无横向滚动、无控制台错误。

## 边界

- 始终：展示评论采集范围、身份核验方式、规则缺失项和本机保存状态。
- 始终：只加载当前选择的视频评论，刷新或切换时防止旧请求覆盖新结果。
- 不做：自动回测、GPT 自动补参数、按点赞排序方法质量、自动选股和券商下单。
- 不做：把未加载评论解释为没有评论，把同名显示名解释为作者本人。
- 不修改：现有评论采集、持仓、交易和量化结果语义。

## 验收标准

1. 侧栏可进入新页面，桌面和手机均能切换四项功能。
2. 有评论时可查看父子上下文；无保存评论时明确显示覆盖状态，而不是“0条评论”。
3. 作者中心只接纳 `verified`、`platform_marked`，排除 `suspected`。
4. 规则卡八项全部填写后才显示“规则完整”，否则列出缺失项且仍标为草稿。
5. 支持、反证和待核问题只来自用户标记，重新打开页面仍保留。
6. 切换观察记录时旧请求不能覆盖新页面；首屏不为全部观察记录批量请求评论。
7. 聚焦测试、完整回归、真实浏览器验收和便携版健康检查分别通过。
