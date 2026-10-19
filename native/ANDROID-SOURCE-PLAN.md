# 安卓来源采集合同 / 2026-10-12

承接全迁移目标，用户已批准持续实施，无需逐批再次确认。Windows三布局与Android Java主界面不改。首条验收路径为“原生采集页→作者官方来源→作品身份核对→手机下载→离线识别→研究资料”；作者计划/运行历史继续在此基础上迁移，不将单作者当前页当全部完成。

## 实现顺序与验收

1. Java来源合同：沿Qt source_capture.hpp与旧electron/douyinPageCapture的实际字段。只允许HTTPS官方域、稳定作者和作品身份；空页/加载失败/需登录不是成功。标题/原稿/人工校对/研究修改保留；不以video标签播放地址代替作品绑定，发布日期不明保留原文，不发明时间。先做模拟器真实SQLite失败测试，再实现合并。
2. 手机官方来源子页：Java控件与受限WebView平台会话，不是业务套壳。仅加载用户填写的官方主页，以及本轮已核验同源作品链接；不自动登录/外部App跳转、读Cookie、读密钥。JavaScript无原生桥，读取复用构建时生成的只读页面脚本；回调校验当前URL和轮次。TLS错误拒绝、禁用文件/内容访问及混合内容，拒绝网页权限/文件上传/新窗口。手机内独立会话，不依赖电脑。
3. 原生串行采集：用户主动开始，最多1–50条已加载作品，先核对详情，再把合格新任务交CollectionService下载/识别/入库，观察实际下游状态后处理下一条。停止/离开来源或Activity销毁停止继续发现，正在手机服务执行的既有下游按明确停止按钮取消；不让旧页面回调启动新任务。无效媒体/源失败可见，不写“完成”冒充入库。已有文稿/失败或手工暂停任务不偷偷重跑。
4. 来源页实机引擎验证：专用API36模拟器运行官方页，记录加载/登录/作品可用边界；确定性快照只算测试，不冒充平台成功。缺登录/验证码交用户本人处理，不阻止继续迁移其他业务。
5. 后续作者持久计划、前台调度、运行历史与增量更新：对齐旧自动同步，新增或实质变动作品不能停在check-only。仍受Android长任务/前后台限制，不能无限保活。117条其余功能与真实资金继续推进。

## 文件与风格

`SourceCapture.java`（身份/合并）、`SourceBrowser.java`（受限来源会话）、`SourceScreen.java`（原生内部页）及测试`SourceChecks.java`。沿用`BusinessStore.require(condition, "可操作的原因")`与`org.json`、明确异常状态；复用CollectionService不另造ASR或下载器。新增代码不更改旧业务表结构、不清库、不改旧程序。

## 验证命令

工作目录为runtime-lifecycle-cleanup/Webstock；JDK21/SDK36。

```powershell
$env:JAVA_HOME='C:/Program Files/Android/openjdk/jdk-21.0.8'
$env:ANDROID_HOME='D:/WebStockAndroidTools/android-sdk'
& 'D:/WebStockAndroidTools/gradle-9.4.1/bin/gradle.bat' -p native/android --offline :app:assembleDebug :app:assembleDebugAndroidTest
& 'D:/WebStockAndroidTools/android-sdk/platform-tools/adb.exe' -s emulator-5564 shell am instrument -w -e mode business-source-contract org.marketreview.nativeapp.test/org.marketreview.nativeapp.FlowInstrumentation
```

仅构建成功后升级安装专用模拟器，不运行旧APK充当新验收。单元合同、原生控件、真实WebView、真实平台、CDN及手机ASR分别验收。无新依赖、无旧生产库写入、无远端提交；应用正式身份与签名不改。

## 官方边界依据

[Android WebView安全](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)与[WebView用法](https://developer.android.com/develop/ui/views/layout/webapps/webview)。仅对外部平台会话使用WebView，禁止addJavascriptInterface和任意网页调用本机能力。未完成真实平台链路前明确标部分实现。
