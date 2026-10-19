# 作者观点关系迁移 / v20

目标继续 active；用户授权连续迁移，不逐批审批，不提交。此阶段为 P017/P018 的原生交互与证据版本，不冒充所有研究能力完成。

## 已核对旧实现及数据

`services/creatorIndustryService.js` 和 `js/modules/industryWorkspace.js`：正文 SHA256、V2 规则、质检 ready 同时满足才进入当前关系图；连续引文 12–500 字，实体各 1–100 字且出现在引文中；七种关系、支持/反证；作者观点不等于已核验事实。完整列表不能被局部图上限截断。

2026-10-12 指定旧库同级 creator-industry 目录不存在，不能声称迁入了真实旧作者图。保留已有产业主题/人工证据页，不混用它的“产业阶段”和作者的“实体连线”。

## 本阶段契约

- 在 collections 记录上追加 creatorAnalyses（最多100个版本），不改 SQLite 表。每版保留正文快照、哈希、摘要、关系集合、分析时间、模型/人工来源。单篇20万字、500关系；七种关系和引文按旧契约。
- 修改关系产生新版本；保存同时验证正文哈希和上一版身份，防止后台改文/双窗口覆盖。后台普通保存必须保留最新分析历史。
- 图只取当前正文的最后一个 V2 版本，且当前质检 ready。过期版本在历史中只读查看；改变正文不删除历史、不把旧关系画成当前关系。
- 原生 Qt 与 Java 页面：选文稿、查看状态、关系列表/局部关系图切换、点连线或列表查看连续原文、手工新增/修改/移除当前关系后保存修订、查看分析历史。表单草稿切页保留，切文稿前明确保存或放弃。
- 图最多展示12条相邻边，标明局部/完整计数，完整列表无静默截断。图是作者断言，不自动映射证券代码或升级事实。手机不连接电脑。
- AI自动提取配置及历史异正文文件迁移后续接入；本阶段无付费调用、不读取旧密钥，不声称自动AI已完成。

## 实现/验证顺序

1. Qt域测试先红：合法保存，连续引用与实体校验，质检拦截，正文变化隐藏图但保留历史，并发版本拒绝，后台保存不擦历史，备份原样恢复。
2. 同规则 Java；界面保存/选中/图表切换/重开、草稿切页及 Activity 重建测试。
3. Qt CTest 全量、Android新模式及原有研究/质检等回归；实际 native 截图检查。

路径：desktop/creator_analysis.hpp 与 creator_page.cpp；Java CreatorAnalysis/CreatorPanel；tests/creator_tests.cpp 和 Android CreatorChecks。采用现有 JSON 业务记录风格，不增加第三方依赖。

命令（在 native 或其已配置目录执行，PATH 包含 MinGW 与 qt-open/bin）：
`D:/Program/Qt/Tools/CMake_64/bin/cmake.exe --build output/native-ui-design-20261010/native-preview-build/desktop-open --parallel 2`
`D:/Program/Qt/Tools/CMake_64/bin/ctest.exe --test-dir output/native-ui-design-20261010/native-preview-build/desktop-open --output-on-failure`
Android使用既有Gradle9.4.1/JDK21、专用emulator-5564运行 FlowInstrumentation，保留普通应用数据和签名。

永不改生产库、网络/TLS、签名包名或远端；示例关系仅隔离测试。统计“实现/本机操作/真实源/完整业务验收”分别列明。
