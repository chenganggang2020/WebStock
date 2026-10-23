# 011：Java原生手机页面接入独立离线语音识别

状态：内部评审版实现，2026-10-12。不是公开发行或识别精度验收。

## 依据与取舍

用户要求安卓独立运行，不能把Windows ASR当成手机已迁移。旧Python/faster-whisper运行环境无法直接用于Java安卓程序。本轮选择Vosk Android 0.3.75官方预编译AAR和JNA 5.18.1，保持Java原生Views；不新增云服务、不发送音视频、不需要麦克风权限。Windows沿用已验证的离线faster-whisper，未更换现有程序。

官方示例依赖：https://github.com/alphacep/vosk-android-demo/blob/master/app/build.gradle
模型来源与许可：https://alphacephei.com/vosk/models
Java识别合同：https://github.com/alphacep/vosk-api/blob/master/java/lib/src/main/java/org/vosk/Recognizer.java
解码合同：https://developer.android.com/reference/android/media/MediaCodec

中文small-cn-0.22压缩包43,898,754字节，独立导入或主动下载，固定SHA256及解压路径/大小验证。官方说明小模型通常约300MB运行内存。本机模型哈希是检索日固定样本，不冒充官方签名。Vosk和该模型Apache2.0；JNA选择双许可中的Apache2.0，许可文本随APK及源码保存。公开发行前还需完整依赖许可/ABI兼容核查。

## 行为

- 手机私有目录导入最大256MiB音视频；系统MediaExtractor/MediaCodec解码16位或float PCM，正确按输出采样率喂入Vosk、声道平均。时间轴不连续超过150ms拒绝处理，不伪造时间戳；当前单次2小时、总任务1小时限制。
- 本机转写并入库，或下载成功后自动接本机ASR及入库。原稿、当前校对、最近识别结果及词时间戳分别保存；新研究资料默认未核验。已有研究资料不因重复转写覆盖。
- 用户明确启动；运行号+记录修订号防止恢复/替换记录后的晚到结果污染。停止整条链路同时停止前置下载与识别。取消、关闭或保存失败的未绑定新资源清理，旧媒体和模型保留。
- 识别任务由当前Activity持有，切换内部子页继续，Activity销毁取消；杀进程后运行状态恢复为中断，不自行重启。未实现前台服务/后台续传，不承诺后台持续运行。

## 证据与已知不足

真实既有视频在Android16/API36 x86_64模拟器上解码32.671882秒、44100Hz双声道，得到7段本机识别并自动入库。受控HTTPS响应携带同一真实视频另验下载→识别→入库及未保存草稿保护；受控下载不算真实CDN验收。未实测真机、ARM64、16KB页或各种长视频。

轻量中文模型识别有明显错字，必须校对，不能等同Windows模型质量或研究事实。本轮解决独立运行与结果保护，不代表中文转写质量达标；后续应比较更高质量移动模型并用人工标注样本量化，而非通过同一引擎自评宣称准确。
