# 工作区恢复横向菜单

日期：2026-10-10。修改前基线：`4c8f63a3c55da10aef81ba52aa757f619db5821e`。

## 用户要求与原因

用户要求电脑版工作区恢复横向排列，当前下拉菜单遮挡内容；另询问安卓现有 UI。

复现：`compactTerminal.bind()` 将六个入口放入 `details.workspace-menu`；`home-workbench.css` 将菜单绝对定位到顶部栏以下，脱离文档流。真实浏览器打开后，菜单与子页面栏、状态栏重叠，部分入口被后续层遮住。不是行情数据未加载。

## 最小修复

- 七个工作区按钮直接放入已有横向 `#terminalWorkspaces`，不创建下拉浮层。
- 删除该浮层专用样式，复用既有选中态和窄屏布局。
- 保留各工作区最后选中的子页面；点击“主页”始终进入 dashboard，不恢复浏览器访问历史。
- 不改变左侧同花顺分组、图表、后台、数据库或 Android 业务代码。

## 验证与边界

- `scripts/qa-workspace-navigation.browser.js`：修改前失败（直接可见入口只有 market）；修改后 20/20 通过。
- 真实 Edge 浏览器、隔离预览数据，测试宽度 1920/1366/1024/800/640，深浅两种主题；核对同排、可点击中心点、位于顶部栏内、不与搜索/主题按钮重叠、子页面位于顶部栏下方、各工作区单独激活以及重复主页返回。
- 相关 6 个 Node 文件 28/28 通过：compactTerminal、readingNavigation、homeTerminal、homeMarketMergeNavigation、homeStockSync、homeStockBrowser。
- 扩展到 fixedWorkspace/moduleOwnership 后共 46 项，43 通过、3 失败。失败要求旧的 homeGroups select、本地组选项及 authors 独立管理页，与此前已变更的界面要求冲突。将 HEAD 导出到隔离目录后，该两个文件在修改前同样 15/18、同样 3 个断言失败。本轮不修改这些无关业务或旧测试，不能声称全量回归通过。
- 隔离基线首次导出漏了 js/app.js，产生额外 ENOENT；补上该文件后复核为上述 3 项相同失败，不将核对工具遗漏归为程序问题。
- 预览接口未连接的能力按设计返回 503，会产生网络控制台记录；导航验证无 JavaScript 未捕获异常，不等于全部上游接口可用。
- 截图位于源码 `output/playwright/workspace-menu-before.png`、`workspace-horizontal-after.png`、`workspace-horizontal-header.png`。都是实际页面、隔离样例，不是生产行情验收。

## 安卓界面说明

正式目录当前为独立安卓 2.4.1：底栏自选/市场/研究/账户/我的；分组为直接可点按钮；组颜色作用于名称、侧边条和标签，报价涨跌语义独立；详情以图表为主，保留周期/历史缩放、横屏、深浅色和先关闭弹层再回自选主页的规则。

已有 2.4.1 浏览器截图在工作树父目录 `output/playwright/watch-colors-light.png`、`watch-colors-dark.png`、`chart-dense-signals-dark.png`；它们来自实际页面与合成测试数据，不代表手机实盘实测。密集信号图是绘图压力夹具，不能把其中的测试注入状态当成完整详情页操作流程。

本轮没有重新修改或构建安卓，没有更新安装中的 Windows 应用，也没有推送 GitHub。后续覆盖安装应使用包含本修复的新安装包，不能继续使用 4c8f63a 安装包并宣称菜单已更新。
