# v29 原生研究与资讯接线（工作副本，尚未交付）

前一已冻结包为 delivery-v28，不覆盖该包。主机版本工作副本 0.29；不因入口/单元检查通过宣布全迁移完成。

## 接线与数据边界

- Windows 图表工具栏、研究工作区进入同一 StockResearchPage；Android 图表操作、研究入口进入同一 StockResearchScreen。三布局与直接回主页保持。
- ResearchContext 两端纯只读适配器读取已有 MarketFeed 完整证券记录。只接受唯一完整证券身份；ResearchCompanies 的明确 company.instrumentId、身份原文引文和关系引文同时满足才关联完整文稿。
- 不按名称/裸代码推断、不补当前行情到历史、原文验证状态不升级。关系快照独立附上 researchBindings 与 bindingWarnings；documents 保持原记录，继续复用已有精确来源跳转和未保存目标草稿保护。
- 笔记/不可变研究快照使用独立 stock-research-v1.sqlite；Android 完整视图保存至私有 AtomicFile，Bundle只带小marker。系统文件选择回调只预览，确认后合并，取消不写库。
- 评论工坊复用稳定模块API和内部页面；worker负责规则草稿/预览持久、原文内部阅读，root接系统文件选择。没有自动网络、AI或交易。
- 资讯 Android 原生列表/阅读/文件导入导出、生命周期已接代码，待模块冻结检查。正文严格区分摘要、旧已保存正文、本次失败；旧源没有独立公告接口。原文仅用户明确点击后以公开URL打开。未验收能力不能计入完成。
- PersonMethod、EvidenceReview及MarketOverview属于独立 v30 租约，显式 frozenMigrationV29 仅排除这些尚未接入文件，已启用模块与检查不排除。源代码包同步记录排除列表。

## 专项结果与修复

1. research_context 从缺实现RED到完整身份/原文变化/重复身份检查通过。
2. Qt StockResearch 模块通过；新增真实主机三布局流程复现首次笔记保存CAS误拒。根因 loadNote 使用非const QJsonObject 下标读取空text，改变了比较基线；改用value只读访问，不放宽CAS。qt-host-fixed.txt 首次保存、重读、换页、回行情、三笔不可变快照通过。
3. Android stock-research-module 实际独立SQLite/UI及ResearchContext共28检查通过。主机首次横屏70dp可读区域断言失败，截图确认无来源时多余定位按钮挤压正文。无documents时隐藏该行，保留正文与触控区；migration-v29-host复验15检查通过（真实文件选择取消、受控文件预览/确认、Activity重建、草稿/保存、横屏/主题/直接主页）。
4. CommentWorkshop实际Android模块12、宿主19检查通过；内部阅读器的页内返回、顶部返回、系统返回均先关闭内部阅读器，之后直接主页，不引入浏览历史栈。
5. News实际Android宿主22检查通过：文件选择取消、预览不写库、重建确认、独立SQLite保存、长正文可滚动阅读、主题/横屏和小状态标记。实际截图发现宿主文件按钮深色下不可读，仅给该两按钮接主题，复验通过。
6. Qt News恢复不再静默截断导入文本，恢复原待确认预览不重新联网或重算合并。2026-10-13本轮受影响news/comment_workshop/migration_v29_remaining三组集中检查全部通过，保留此前StockResearch专属和宿主检查，不重跑未改旧全套。
7. 独立Java一次真实旧新浪源读取为2栏目各1页，共60条去重资讯；所选正文DNS返回私有/假IP，安全检查拒绝连接，无绕过或更改代理。这是非设备来源实查，不等于Windows/Android原生完整线上验收。摘要与全文、栏目范围与全市场、源时间与读取时间保持分别记录。
8. 上述宿主与风险检查使用隔离样例，不代表在线F10、生产研究结论、ARM真机或全部尺寸验收。Android News独立存储/正文源风险检查与最终打包正在收尾。未改旧1604全套未重复跑。

证据在 output/native-ui-design-20261010/parallel-20261012/continuation-v29。测试失败日志保留，不用后续PASS抹除。v28发布时安装一致为历史事实；5564现为0.29开发包，不再声称当前仍匹配0.28。
