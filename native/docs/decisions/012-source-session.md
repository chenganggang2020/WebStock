# ADR 012：Windows 原生采集的独立来源会话

日期：2026-10-12。状态：实现并通过确定性回归；真实平台全链路、可视操作验收未通过。目标仍 active。

## 决策与边界

保留 Qt Widgets/.ui 核心业务、三桌面布局和内部子页。在“采集”内添加“来源 / 自动采集”子页，用 Microsoft WebView2 仅承载抖音官方登录/作品页面，Qt 读取当前已加载内容后交给既有原生下载、进程转写和研究入库队列。不是将行情或业务改回网页，不需要 Node 后台。已有 Python/faster-whisper 仍只是桌面本机转写引擎；Android 0.11 的 Java/Vosk 路线不变。

独立会话位于原生 AppLocalDataLocation/platform-session/douyin，不读写旧 Electron 登录目录，不导出 Cookie。用户本人处理登录和验证码。网页无需也不能调用本机业务对象；网页数据视为不可信输入。

## 依赖与构建

- 官方 NuGet Microsoft.Web.WebView2 **1.0.4258.31**，下载包 SHA256 `56F7F4B8BF9AEE4B8EFEFBBDD4F67D5F74EBD1B100ED0806DA71BF76AF481AA9`。
- 构建参数 `WEBVIEW2_SDK` 指向官方包解压目录；使用 `build/native/include/WebView2.h` 和 `runtimes/win-x64/native/WebView2Loader.dll`。现有 MinGW13.1 通过官方 COM ABI 调用，没有引入 WRL/MSVC 依赖。
- 随 Windows 包分发 Loader 及原始 LICENSE.txt；系统 WebView2 Runtime 另外存在，本次机器检查为154.0.4258.62，未运行安装器。不打包用户会话或 SDK 全包。
- `native/tools/generate-source-snapshot.cjs` 仅构建时复用旧 `electron/douyinPageCapture.js` 的页面提取规则和 CDN 解析，输出静态资源 `douyin-snapshot.js`。运行时 Node 不参与。原旧 JS 未修改。

官方资料（本轮已打开核查）：[NuGet](https://www.nuget.org/packages/Microsoft.Web.WebView2/)、[安全建议](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)、[会话目录](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder)。这些资料不等于本项目已获得平台数据使用或商业再分发许可。

## 输入和执行保护

1. 顶层导航只允许 douyin.com / www.douyin.com 的 HTTPS 默认端口；禁止本机文件、外部顶层跳转、浏览器自动下载、权限授予、HostObjects/WebMessage 和默认脚本弹窗。安全设置或事件注册失败关闭来源控制器。子资源/平台 iframe 不是“所有网络都被同域限制”；不作该承诺。
2. 来源快照核对前后 URL、导航代次、当前作者和作品 ID；独立超时，最多2MiB。仅解析有界内嵌 JSON，不执行内嵌代码或自行请求网页接口。DOM 中首个 video.currentSrc 不能充当当前作品媒体。
3. 媒体必须来自内嵌的同作品 ID + 同作者 sec_uid，并附绑定元数据。跨作品、跨作者、仅有 URL 或过期绑定均不入下载队列。未发现合格媒体时明确缺失，不能补猜链接。
4. 同 ID 但来源 URL 冲突拒绝覆盖；已有人工稿、完成/暂停/五次挂起/失败任务不重启；已有空任务仅补资料，不重新授权。只有本轮新建且有用户授权依据的任务可以入队。下游按原白名单逐跳验证、大小/格式/哈希检查并原子保存。
5. 停止使读取回调失效、停止网页导航及本轮排队任务，并取消本次定时。特别覆盖初始化中停止后迟到 ready 的情形，不再偷偷导航。重复计划只在本次运行用户主动打开后有效，不承诺持久多作者计划。
6. 转写设置显式保存，与来源队列共用。任务列表仅在没有未保存草稿时自动更新，不能覆盖正在校对的文本。入库仍为未核验研究稿，保留原始文本/校对稿/研究页修改。

## 证据与未完成

证据目录：`output/native-ui-design-20261010/native-v12`。

- 全部22组 CTest 通过（`ctest-final.txt`），包括4条媒体错配 JS 用例、来源合同、页面停止、旧稿保护、引擎配置共用及原19组回归。红测与绿测分别保存。独立复核确认媒体错配/重授权/ID覆盖和迟到ready问题已修。
- 真实公开作者主页读取成功，见 `source-live-observation.json`：19条已加载卡片，登录判断为false，**未启动采集或下载**。这不是完整历史、登录成功或平台全链路成功证据。
- 实际 WebView2 Runtime 创建/拒绝 file 导航通过；关闭后的临时会话目录仍可能被异步进程短时占用，不强删、不宣称全部清理完成。
- 可视检查两次被 Windows `GetCursorPos failed: 拒绝访问 (0x80070005)` 阻断，已停止UI输入。Qt采集截图灰屏，不列为可用视觉证据。按钮测试不替代人工可视验收。
- 本轮旧资金分钟/快照 Axios 均 ECONNRESET，Qt快照 RemoteHostClosedError；`qt-snapshot-live.txt`真实源验收失败，未更改代理/TLS，也不把缓存或确定性测试写成接口恢复。

还需继续：用户可用会话后的真实平台下载与完整闭环；多作者持久计划/覆盖/历史运行；Android来源发现、前台长任务/恢复与ARM真机；转写质量；117条剩余功能。此次不是全部迁移完成。
