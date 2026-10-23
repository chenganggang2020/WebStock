# 作者计划与来源运行记录：规格及实施任务

2026-10-12。承接用户“自动采集全链路持续迁移、不逐批再问”的明确授权。使用规划/规格技能先写边界和验收；不为重复阶段审批暂停。新授权来源、账号登录或验证码仍由用户处理。

## 目标与假设

在现有Qt采集内部子页增加可操作的作者计划表和历史运行表，不改变三看盘布局。作者地址、合法处理依据、单轮条数1–50、间隔10–1440分钟由用户填写，最多50作者。保存计划不等于启用执行。当前来源读取仍仅覆盖已加载卡片，不扫描全历史，不把详情成功写成下载/转写完成。

原生专用SQLite保存计划和来源运行记录；旧生产库/旧计划/密钥不迁。启动时全局调度暂停，遗留running标中断；用户明确“恢复已启用计划”后才调度。一个浏览器一个在途来源运行，按到期时间串行。平台登录失败/身份错配立即暂停本轮及全局计划；不会绕过登录。停止使本轮下游任务及迟到回调失效，保留旧资料。

## 结构与风格

- `desktop/source_schedule.hpp`：小型SQLite计划/运行账本，规范化输入，事务性begin/finish，due选择；新库，不扩展原BusinessStore备份合同。
- `desktop/source_plans_page.hpp/.cpp`：Qt原生表格、编辑、运行、启用/停用、恢复/停止按钮；历史显示来源阶段结果，不伪装下游成功。
- `source_page.hpp/.cpp`：小型公开run/stop/busy接口和单轮结束信号，复用身份绑定与下载队列；不复制第二套提取器。
- `tests/source_schedule_tests.cpp`：临时库和确定性时钟；`source_plans_page_tests.cpp`：假来源/真实Qt控件验证，不当真实平台验收。

保持C++17、Qt6、2空格和现有 `business::require(condition, "中文原因")` 风格。没有新增网络依赖。写盘失败不先更新界面为成功；校验失败不得部分修改记录。

## 任务与验收

1. 计划保存和运行记录（store+tests，2文件）：同作者稳定ID，重新打开可读；地址/数量/间隔/授权校验，重复作者不产生第二计划；begin单在途、finish原子、重启标中断、不自动执行。QtTest先红后绿。
2. 手动计划真实控件链路（source接口+UI+tests，约5文件）：编辑/保存/加载→运行指定作者→来源结果写历史；停止/迟到结果不覆盖已完成或新轮。已有人工稿和下游队列保护保留。用现有FakeSource验证到已有BusinessStore。
3. 到期串行调度（同上文件）：启用和恢复分开、禁止两个run同时启动；失败全局暂停；停用计划不取消别人的运行，停止全部取消本轮。关闭/重启无自动重授权，过期不补跑每个漏过的周期。固定时钟和控件回归。
4. 构建全回归、独立代码审查、阶段包及实际操作：真实登录/可视桌面受阻则如实保留未验，不把夹具或灰屏当通过。不减少其他117项迁移范围。

## 命令

工作目录为runtime-lifecycle-cleanup/Webstock。MinGW与Qt运行目录放PATH。

```
D:/Program/Qt/Tools/CMake_64/bin/cmake.exe -S native -B output/native-ui-design-20261010/native-preview-build/desktop-open
D:/Program/Qt/Tools/CMake_64/bin/cmake.exe --build output/native-ui-design-20261010/native-preview-build/desktop-open -j4
D:/Program/Qt/Tools/CMake_64/bin/ctest.exe --test-dir output/native-ui-design-20261010/native-preview-build/desktop-open --output-on-failure -j1
```

沿现有配置缓存的官方WEBVIEW2_SDK路径；新构建需按ADR012显式提供。不触发真实采集的确定性测试可自动运行，真实来源只在已授权范围有界验证。

## 数据规则和不做事项

记录runId、planId、作者快照、开始/结束时间、状态、已加载/本轮处理/已排队计数、原因；queued只表示交给下游，不表示研究入库成功。旧运行历史不因编辑/停用计划而重写。运行中不能改当前计划关键字段。保存与结束使用事务，异常回滚；旧或重复回调不重写已结束记录。

始终保护人工稿、旧媒体、旧生产数据；禁止自动登录/提取旧Cookie、无限滚页、频繁全市场请求、交易。该阶段不实现云同步、系统后台服务、历史全覆盖、任意来源插件或AndroidUI搬用网页。删除历史/公开数据发布/新增付费授权源需另行明确范围。
