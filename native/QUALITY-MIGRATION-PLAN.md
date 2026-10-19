# 文稿质检迁移（v19，目标继续）

## 目标及范围
先补 P019 的本机原生质检与人工复核记录，再继续 P017/P018 的作者关系。保留三布局、内部子页、现有采集管线，不把此小阶段当全部迁移。

旧依据：services/creatorDocumentState.js 与 creatorIndustryService.js。提示词回声、时间越界、图文页不全、缺正文/短正文、缺提取证据必须明确显示；机器未标异常不是事实核验。原文入库仍可用于留档，不能因为已入库就给出合格结论。

## 行为契约
- 两端以相同输入得到相同质检状态。检查当前正文、ASR/OCR 元数据，旧 completed 不代替 ASR complete。
- 安全导出旧媒体元数据只取质检必要的状态/原因/分段/页文本/模型/时长；不取签名链接、会话或配置。旧导出缺元数据时明确未评估。
- 当前正文不同于识别稿时显示已编辑待复核，不沿用识别稿的机器通过状态。
- 人工记录要求非空说明，绑定正文 SHA256，保留历史；正文改变显示复核过期。记录只表示已核对文稿，不表示外部事实已证实，也不覆盖机器异常。
- 保存复核用本机库事务重新核对正文哈希，拒绝已改变记录；不回写旧库。备份兼容，不自动采集或启动分析。
- Qt 在原有文稿区增加质检标签；Java 在同一文稿子页增加可展开质检区。无需新顶层窗体，不改三个桌面布局。
- 发布研究资料附带质检快照与正文哈希，verification 仍 unverified；已有资料不覆盖。

## 结构/风格
native/desktop/collection_quality.hpp 与 Java CollectionQuality.java 为纯规则。BusinessStore 负责事务，现有 collection_page/ResearchExtension 负责控件。采用现有 QJsonObject/JSONObject 与异常呈现方式，例如 `business::require(!text.isEmpty(), "请先选择文稿");`。

## 验证与执行
先增加失败测试，再实现规则、事务、原生控件，最后回归。C++ 构建：`D:/Program/Qt/Tools/CMake_64/bin/cmake.exe --build output/native-ui-design-20261010/native-preview-build/desktop-open --parallel 4`。测试：同路径 desktop/research_v9_tests.exe 与 research_ui_v9_tests.exe，日志使用绝对路径；最后 ctest --output-on-failure。
Android：`D:/WebStockAndroidTools/gradle-9.4.1/bin/gradle.bat -p native/android --offline assembleDebug assembleDebugAndroidTest`，专用 emulator-5564 执行 business-quality 模式，再恢复正常无测试参数应用。

## 边界
Always：失败/空白不补通过、真实旧库只读、记录源范围、原文/历史保留、实际控件验证。
需用户：平台登录/验证码/新增付费授权；不为此批重复请求确认。
Never：改代理/DNS/TLS、读取密钥、覆写旧生产库、提交远端、将模拟器等同真机或机器检查等同准确率。

资金已有间歇返回但无稳定原生结果；无新条件不重复轮询，不阻塞本项。

## 实数驱动修正
985份真实文稿加入识别质检元数据后超过旧16MiB迁移包限制。两端仅业务备份/迁移包统一为32MiB有界限制；普通文稿文件仍16MiB并保留60万字校验。真实包需在手机原生预览、隔离数据库恢复及再导出三处验证，不通过时不标迁移成功。不删原文或静默裁剪以凑容量。
