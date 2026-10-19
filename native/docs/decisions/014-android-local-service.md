# ADR 014：Android本机采集长任务所有权

2026-10-12。用户已授权持续原生迁移，保留Java界面和子页，不引入电脑代理。Windows三布局和0.13不改。

## 取舍

沿用现有下载/媒体校验/Vosk识别/研究入库，只把任务所有权从Activity移到非导出的、绑定且主动启动的CollectionService。Activity销毁只解绑；服务持有application Context和独立SQLiteOpenHelper，同名业务库可跨页面连接。完成、失败、取消及时stopForeground/stopSelf，无任务时不前台常驻。

一次串行任务最多30分钟。启动前持久pending，无法保存则拒绝启动；结束清pending。进程被强停后下一次绑定提示中断并将遗留running/importing标interrupted，撤销旧run，用户主动重试。不是断点续传、识别断点续算、定时唤醒或无限保活。

下载/本机文件准备使用dataSync，API35以上媒体识别使用mediaProcessing；声明相应权限。POST_NOTIFICATIONS由用户主动开通，不在启动弹窗索取；拒绝时页内提示和停止仍可用。API31以上设置立即展示通知。停止PendingIntent唯一绑定run，旧按钮不能停止新任务；服务不向外导出。30分钟应用上限和onTimeout均先取消线程/网络再收尾，不借音频播放规避系统限制。

## 数据与生命周期防护

- 停止先撤销内存执行权、取消网络/worker，随后尝试保存状态。存储拒写也能真实停止。
- 每个任务持有id、run和executionRevision；恢复同ID数据后旧停止/迟到完成不改新记录。只清理本任务UUID、限定目录内未入库的新媒体，不删除成功媒体或用户文件。
- 来源/原稿/人工校对/已有研究编辑保留；识别自动入库仍未核验。不是投资结论或文字准确性证明。
- Activity重建期间文件选择结果保存URI、原记录ID和请求类型，绑定完成后只消费一次。使用已授权内容流立即复制到私有目录，不扩大存储权限；不设计跨设备重启恢复URI读取。
- 服务回调仅引用服务；Activity以观察者注册/移除，状态刷新不覆盖未保存校对稿。

## 验证

失败测试与修复后结果保存native-v14：Activity销毁、遗留下载身份、恢复同ID取消、服务未绑定时文件选择、迟到下载文件回收、进程中断标记。API36模拟器实际注册并显示通知、真实PendingIntent停止、关闭/重开Activity、进程强停重启通过；通知拒绝单独验证。通知可见性测试遍历实际系统交互窗口，截图复核；仅getActiveNotifications不算UI通过。

真实32.7秒本机视频使用Android解码与Vosk，转写和研究入库再次通过；下载串联仍是受控网络响应。真实content://测试读手机内容提供者新建文件，不等于真实SAF选择器授权操作。超时采用直接调用回调；未进行30分钟耐久、系统实际配额耗尽、ARM或多厂商真机验收。

## 依据与后续

[Android前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)、[运行时限](https://developer.android.com/develop/background-work/services/fgs/timeout)、[通知行为](https://developer.android.com/reference/android/app/Notification.Builder#setForegroundServiceBehavior(int))。

接着迁手机来源发现、作者计划、逐项全业务；不以本服务测试代替真实CDN全链、真实资金或117项完成。
