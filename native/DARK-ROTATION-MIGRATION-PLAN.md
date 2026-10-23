# 明暗盘与板块轮动原生迁移

用户已授权连续完成全部迁移；本切片实现 D12/D13，不改变既有布局、账户或采集服务。新库独立于旧生产库。

## 契约与边界

沿用 `eastmoneyDarkRank.js` 数字字段、整数元到整数字符串分、来源分类和未知源时钟。明暗盘是供应商模型估算，不是交易所资金流、逐笔买卖或机构持仓。仅请求用户选择的行业/概念，分页严格核验总数、日期、唯一代码、金额对账；不默认启动全市场轮询。

旧 rotation-snapshot/v1、rotation-daily/v1 档案原文只读。按行导入专用 SQLite，单文件128 MiB、单记录2 MiB，事务全成或全回滚，重复快照去重、同身份不同内容拒绝；损坏尾行不能静默丢弃。保留完整来源、原抓取时刻及每行抓取时刻。日榜绝不伪造为盘中记录。分组切换不复用另一范围的结果，网络失败保留本地数据。

轮动按原规则使用采样抓取时间与交易分钟，5/15/30分钟窗口；午休不计90分钟。缺点、超过150秒缺口、跨日、来源/覆盖变化均不可计算；端点容差75秒，比较必须标明区间。数值完整但无连续采样时只展示累计值，不补零。

## 实现顺序 / 验收

1. Qt/Java 同契约解析、精确金额、档案校验测试先红后绿；真实旧文件读入计数及哈希不变。
2. 原生专用存储、离线重开、失败事务、跨来源与日榜隔离；大档案流式处理，不走通用32MiB备份。
3. 资金内部子页：行业/概念、日期、明/暗/合计、采样回放和5/15/30窗口；显式刷新、导入与导出；不弹出业务窗口。后台网络/文件操作，失败可读，取消或晚返回不覆盖当前选择。
4. 两端直接访问同源；Android不依赖Windows。用一次有界真实请求区分旧适配器、Qt、Java网络可用性，明确没有盘中/真机验收的部分。
5. 两端构建、现有回归、实际控件操作和截图；117项只有可核验进展才更新，不宣称全迁移完成。

## 文件 / 风格 / 命令

`desktop/dark_rotation.*`：Qt契约与库；`desktop/rotation_page.*`：内部页。Android `DarkRotation.java`/`RotationScreen.java`及对应测试。遵循现有 Qt JSON / Java JSONObject、小函数异常校验风格，例如 `require(row["reconciled"] == true, "金额未通过对账");`。不加第三方依赖。

构建：`D:/Program/Qt/Tools/CMake_64/bin/cmake.exe --build output/native-ui-design-20261010/native-preview-build/desktop-open --parallel 2`。
测试：同目录 `ctest.exe --test-dir output/native-ui-design-20261010/native-preview-build/desktop-open --output-on-failure`（PATH包含现有MinGW和qt-open/bin）。
Android：在native/android下 `D:/WebStockAndroidTools/gradle-9.4.1/bin/gradle.bat --no-daemon assembleDebug assembleDebugAndroidTest`；专用emulator-5564安装-r后运行原生测试，保留签名与正式数据。

始终：保护旧数据、实际测量、保留缺失和时间边界。需要本人处理：登录、验证码、付费源授权。禁止：取旧密钥、改TLS/代理、回写旧库、静默轮询或伪造完整度。
