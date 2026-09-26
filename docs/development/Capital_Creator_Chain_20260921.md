# 休市资金、作者采集与文稿产业链更新

## 目标与范围
用户于 2026-09-21 授权分析、直接实施、测试后采集现有作者。保持当前桌面应用身份、数据库和登录会话；手机适配另一个任务负责。

1. 个股资金按来源、代码、交易日保存真实成功结果。休市可查看历史，失败保留历史；未取得的日期不补造。可手动刷新；历史与当前尝试时间分开。
2. 每作者设置全部/视频/图文；Fioona 以视频文稿为重点，开着坦克带你吃仅采集图文。历史资料不删除，批量/自动队列共同遵守设置。
3. 按真实文稿逐篇提取产品、环节、公司、关系与原文短引，记录作者、发表时间和内容指纹。新资料更新当前观点视图，旧版本及冲突保留。AI 提取不自动升级为供货事实或人工核验。
4. 核验当前 5 秒采样和公开竞价来源，区分采样频率、原始频率、结果与竞价过程。只报告真实可用性。

## 路径与风格
源代码：`D:/Webstock/output/recovery-20260920/source`，测试 `test/`，验收 `output/verification/`。
沿用 CommonJS 服务、依赖注入及 Node test；示例：`async function getSeries(input = {}) { return service.getSeries(input); }`。
不引入新框架或依赖；一次实现一个可测切片。

## 验证命令
Node：`C:/Users/25680/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。
针对测试：`node --test --test-concurrency=1 test/capitalFlowHistoryRegression.test.js` 等每片相关文件；数据库测试必须指定隔离的 `WEBSTOCK_DB_PATH`。
打包：`node scripts/build-electron-win.js portable --config.directories.output=dist/capital-creator-chain-20260921 --config.portable.artifactName=Market-Research-20260921.exe`，设置 `WEBSTOCK_VERIFY_UI_ASSETS=1`。

## 顺序与验收
- [x] 盘点真实运行包、采集覆盖、AI 配置可用性、高频来源；不输出密钥。
- [x] 休市历史：失败复现 → 按日期与代码隔离测试 → UI 历史选择；真实东方财富本次连接重置，未宣称取得新历史。
- [x] 作者类型：视频/图文混合 fixture，证明不下载或转写排除类型，已有资料保留。
- [x] 文稿关系：引用必须存在于对应文稿；逐作品可追溯、幂等、按发布时间显示，无正文或 AI 未配置明确待处理。
- [x] 公开竞价来源小规模实际请求与官方说明核验，不绕过账户/付费/验证码。
- [ ] 相关回归、可视化验收、隔离包启动；正常退出切换后通过应用队列启动采集，核对实际结果。

## 边界
始终保留来源和数据日期，测试与真实成功分开。
不直接写生产数据库，不读取或打印密钥，不覆盖旧包，不强杀当前进程，不自动交易。
需要登录/验证码由用户处理；没有配置 AI 时可准备文稿与结构化候选，不伪称后台已调用 ChatGPT。

## 实现决策与接口

沿用现有程序数据库中的作者、文稿和登录身份；不新建外部图数据库。仅新增作者偏好列 `collection_media_type`、`industry_analysis_enabled`，由应用启动迁移。资金历史和 AI 文稿关系保存在当前数据库同目录下的独立 JSON 文件；采用临时文件加原子改名、同标的/作者写入串行化，避免将大段分析写进已有研究匹配表并混淆人工核验状态。

- `GET /api/capital-flow/series?scope=stock&code=002080&source=vendor-classified[&date=YYYY-MM-DD][&refresh=1]`：默认优先读取同来源、同代码的最近历史；无历史时请求来源。`refresh=1` 才显式刷新；日期不存在返回缺失，不用其他日期冒充。授权 Level-2 的历史查询暂拒绝，而不是忽略日期返回实时值。
- `PUT /api/expert/channels/:id`：增加 `collectionMediaType=all|video|note`、`industryAnalysisEnabled=true|false`；未提供的字段保留。
- `GET /api/industry-chain/creators/:id`：作品数、正文就绪数、已分析数、待分析数、AI 配置状态、正文指纹和关系引文。
- `POST /api/industry-chain/creators/:id/import`：仅本机，同源正文 SHA256、连续引文和两端实体逐项校验；同 ID+正文哈希幂等；返回当前关系视图。
- `POST /api/industry-chain/creators/:id/analyze`：仅本机，单作者去重运行，立即返回202后台排队；GET显示running/complete/failed，不长时间占用HTTP连接。无配置返回 `ai_not_configured`。不自动调用当前 Codex/ChatGPT 会话。
- 启用作者自动分析后，每分钟检查，每作者每轮一篇，新发表优先。文稿分段、重叠提取，最长20万字；每段最多4条；失败冷却1小时，不阻塞旧文稿。退出会取消进行中的 AI 请求；原文变化会拒绝写入旧分析。

## 本轮验收记录

2026-09-21 北京时间：429 项相关 Node 回归通过，0 失败，见 `output/verification/capital-creator-chain-20260921/focused-tests.log`；不是全仓回归。

隔离端口43931使用生产只读在线备份，验证42篇/100条关系、关系列表、历史日期选择、坦克作者只显示110条图文。截图位于 `output/playwright/fioona-100-relations.png`、`fioona-relations-table.png`、`capital-history-controls.png`、`note-only-110.png`。首次浏览器切换有一次12秒排队超时（resource requestStart=0），重试请求19毫秒成功；不据此声称整个应用的卡顿已消除。该预览服务验收后关闭，不影响当前桌面采集。

## 实际资料与剩余条件

- Fioona 已存157条作品，其中109视频、48图文。已有42篇完整视频文稿经现有 ChatGPT 对话分析，100条候选关系：AI算力与CPO38、PCB与先进封装29、存储14、半导体9、电力与材料7、商业航天3；7篇无关系。引文长度36–164字，全部与本地连续原文匹配，实体均出现于引文。
- 其余67条视频未宣称完成分析；程序正文就绪口径>=30字，还包括短正文及部分图文，因此界面就绪50篇不同于本次完整视频42篇。
- 坦克作者144条中110图文、34视频；新配置只约束后续自动/批量正文处理，已存视频不删除，主页目录仍可能记录全部作品。
- 当前没有 AI API 密钥。本次42篇由本线程转交现有 ChatGPT 完成；程序自动分析代码已接入，但无人值守调用还需要在设置中配置可用 AI 接口。不开新定时任务，不冒充已自动调用。
- 当前仍运行旧包。必须正常退出、切换新版后，通过程序 API 保存偏好、导入关系、启动3位已启用作者的采集队列；此前不能用旧包发起全量采集，否则不会遵守新媒体偏好。
