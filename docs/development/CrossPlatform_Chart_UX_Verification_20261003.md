# Windows / 独立安卓看股体验：验证记录

日期：2026-10-03（北京时间）。基线：8d67e4d；工作目录：runtime-lifecycle-cleanup/Webstock。状态：双端最终包已构建，Windows隔离启动/资产核验及Android原生11项验收通过；边界与旧回归失败列于下文。

## 实现与证据边界

| 要求 | 实现/验证 |
| --- | --- |
| 点击股票不等待保存最近浏览 | 安卓先切页和请求图表、后异步保存；app-flow 单测与浏览器迟延夹具验证 |
| 连续看股不丢失周期 | 两端从当前显示列表捕获顺序；Windows Alt↑↓不抢输入焦点，安卓前后按钮及返回列表保留上下文 |
| 自动刷新不重建图表 | 安卓可见页面调度、原位报价更新、复用ECharts；保留缩放、选中时间和历史读数；隐藏后暂停 |
| 网络失败及旧响应隔离 | 期限区分本地/网络/AI；A→B→A隔离；缓存读取与网络并行，迟到缓存不覆盖新结果；真实缓存时间不改写 |
| 图表阅读与操作 | 固定OHLC/量能读数、日周月/分时快捷切换、横屏全屏、标记分层和说明；双端标记预留价格轴空间，手机准备1–9与倒计数C1–C13区分 |
| 历史覆盖及继续加载 | 手机首批最多640根，支持继续补页、当前会话最多5000；来源/复权/已收盘重叠OHLC一致才合并，刷新保留已加载部分 |
| 九转与历史核对 | 两端共享 sequential-public-rules-v1；日周月9+13，分时价格序列基础1–9；未收盘仅预览，缺口不补零；后续1/5/20根价格变化不是交易回测 |
| 搜索入口 | 桌面区分全市场搜索与组内筛选；手机代码/名称/拼音全拼/首字母目录搜索，目录外六位代码允许真实查询 |
| 数据和平台边界 | 两端独立运行/存储；手机不调用PC 3000端口；不修改生产库、不启动采集、不覆盖旧安装、不恢复停止的自动任务 |

原生请求的JS等待期限不等于主动取消已发出的HTTP请求；本轮用本地独立队列确保缓存/本地读写不在网络队列后等待。未实现持续后台行情采集，不能把前台自动刷新描述为全天后台采集。

## 已执行测试

- Android Node：35/35，包括历史补页、复权冲突、快照确认时间、图表复用、无重复处理器、原位刷新、迟到响应与离开页面的调度释放。最后两项先复现手机倒计数标签与准备计数混淆、边缘标记越出价格区，修复后通过；日志 android-independent/qa/output/final-marker-node.log。
- Android Edge浏览器：15/15，使用实际页面和ECharts、合成API夹具；360/430px竖屏及844px横屏全屏未横向溢出。0脚本异常；静态QA服务出现一次favicon.ico 404，不属于APK资源或业务请求失败。
- Windows Edge浏览器：最终源码12/12，实际页面和ECharts、隔离静态服务3073+全部API夹具；包括真实Ctrl+滚轮、键盘换股、周期/九转模式切换、规则展开、全市场搜索。0控制台错误。快照时间修复后主线程再次完整执行同组浏览器验证。
- Windows最终全量：2223项，2217通过/6失败（output/playwright/desktop-full-verified-20261003.log）。6项已从HEAD归档到隔离目录重跑，37项中相同6项失败；没有把旧失败删掉或改成跳过。本轮发现并修复了chart-coach跨周期残留；旧集成测试的直接data调用断言更新为真实快照上下文，并保留计算与历史核对的绑定检查。
- Android Java：19/19（StandaloneCoreTest 18 + StandaloneRequestsTest 1）；release签名有效。最终安装包运行复验另见下文。

旧基线失败：expertChannelApi的采集完成文案、industryResearchStage2/paperMonitorScheduler/tonghuashunHoldingScheduler的旧Electron入口静态断言、moduleOwnership的旧作者分离布局断言、volumePaceView的旧日终面板位置断言。它们超出本轮看股改动；不能把当前全仓回归宣称全绿。

浏览器截图及运行日志在 output/playwright/desktop-ux-*、android-flow-portrait.png。桌面可复现QA脚本保存在 test/qa/desktop-ux-*，手机脚本在 android-independent/qa/app-flow-browser.js。静态页面/夹具不是生产服务验收；包运行和Android真机环境模拟另列。

桌面浏览器复现（仅本机静态夹具，不启动业务服务）：

```powershell
node test/qa/desktop-ux-server.cjs
# 在另一终端中运行
npx --no-install --package @playwright/cli playwright-cli -s=desktop-ux open about:blank --browser msedge
npx --no-install --package @playwright/cli playwright-cli -s=desktop-ux run-code --filename test/qa/desktop-ux-routes.js
npx --no-install --package @playwright/cli playwright-cli -s=desktop-ux run-code --filename test/qa/desktop-ux-checks.js
```

CLI与浏览器须已安装；需要先建立output/playwright作为截图目录。测试后关闭该独立CLI会话与自己启动的3073静态服务，不关闭用户浏览器。

## 实际来源取数

主线程通过公开腾讯K线接口读取sh600000：当前页640根（2024-02-07—2026-09-30），以before=2024-03-07取得更早640根（2021-07-16—2024-03-07）；16根重叠OHLC一致。此为单证券取样，不能外推全市场所有日期覆盖。

Android模拟器另取得sz000001日线640根与历史页640根，均stale=false；历史页2021-07-16—2024-03-07。未使用付费权限，不声称具有L2或历史逐笔数据。

## 交付记录

| 平台 | 交付文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64便携版 | dist/ux-20261003/WebStock-UX-20261003.exe | 112303421 | 73ac9feaadc391774082689562e82306aa8debcb74093a23bed0f593803952c3 |
| 独立Android 2.2.0 | android-independent/WebStock-Android-Independent-2.2.0-20261003.apk | 2858955 | 4c90f7401505299884ed89ecddc7de81d10776086a4c8adf3dd2bcb3b8903ef3 |

Windows构建 exit=0：临时目录空数据库、独立58656端口实际启动成功；主窗口进程37992与后台37632分别有诊断观察器，health数据库正常。40个打包前端文件逐个SHA-256匹配当前源码，包内本地股票搜索解析600519成功。ASAR检查未见生产数据库、签名私钥、.env或本轮QA资产。测试结束进程/监听已退出，Node SQLite ABI恢复后内存库检查通过。未签发Windows代码签名证书，沿用原项目unsigned配置；并未替换旧安装。

Android release构建和签名校验成功（v2，沿用本机既有签名，未复制或输出私钥）。最终APK内13个web资源逐个SHA-256匹配当前源码，无缺失、多余或不一致文件；四个公共算法模块与桌面源码一致。

最终原生验证：独立QA AVD WebStockUX20261003（API36）11/11通过。旧2.1.1中写入四条明确标记的测试记录并保存快照，再用install -r覆盖为2.2.0，核对记录保留、版本、打包算法、真实腾讯日K640根与历史页合并、原生绘图、刷新保留实例、本地磁盘缓存不等待占满的网络队列、信号弹窗系统返回键关闭、横屏图表尺寸。首次日志：android-independent/qa/output/final-emulator-audit.log；安装和旧快照日志同目录。模拟器重启后复验11/11；最后的标记布局修复重新打包签名、覆盖安装，再次11/11通过，日志 final-marker-emulator-audit.log，真实请求 checkedAt=2026-10-03T15:27:49Z。最终包的13项web资源再次核对全部匹配源码。

最终无遮挡原生截图已查看：android-independent/qa/output/final-marker-kline.png（竖屏）及 final-marker-landscape.png（横屏）。准备计数、倒计数、完善与重启标记分层，未完成倒计数不再全部画成实心圆；边缘不再越入MACD副图。密集历史区仍应缩放查看，不承诺在一屏压缩全部历史时每个标签永不相邻。

环境异常单列：原QA AVD出现ext4/verity虚拟文件系统错误，在应用启动前循环重启；保留原盘及内核证据，不执行fsck或清除数据，改用上述新环境完成最终包测试。首次初始化时Google Play services系统弹窗遮挡截图，保留原始截图并另补上述无遮挡图；不将该系统进程异常归因为本应用ANR。未连接任何实体手机。构建沿用的AGP对compileSdk 37.2给出已测试上限37.0提示；构建及API36模拟器通过，不因此宣称新版系统兼容性已验证。

未做实体手机验收，不宣称所有手机兼容；不宣称Android已经覆盖桌面全部27个页面。
