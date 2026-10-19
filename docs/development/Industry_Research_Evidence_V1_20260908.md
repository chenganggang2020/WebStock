# 产业研究证据 V1（2026-09-08）

状态：授权方向下的实施契约；设计落盘不代表实现或真实验收通过。GPT-6 Astra 设计/审核，GPT-5.6 Luna 按以下四段实施。保留当前工作树及无关修改，不提交、不写生产库、不创建 Codex/系统定时任务。

## 目标与决定

在现有产业链页完成“登记原始来源 → HTTPS 取证 → 证据绑定产品/公司关系 → 校验并保存版本 → 地图、公司表、变化及原文证据展示”的一条真实闭环。后台仅复查已登记来源，默认关闭，用户开启后运行在应用进程内，不创建聊天。V1允许零股票、没有AI、无新发现。

新增研究契约与旧 `/api/industry-chain` 分类结果并列，旧接口兼容；旧 `confirmed` 不能转为新研究的 `verified`。原因：现有分类只检查标签、URL、时间和词典命中，`newsService.normalizeNews` 还可能补当前时间，不能证明原文已经取回或事实已经核对。旧结果在页面说明为“本地分类线索，未经过本研究原文核验”。不改旧分类算法。

使用 Express/CommonJS、better-sqlite3、plain JavaScript；不新增依赖。V1仅解析公开 HTML/plaintext，PDF/登录墙/验证码/不支持编码明确记为 blocked，不绕过访问限制。原始HTML不进入DOM，仅保留可复核短片段、URL及哈希；不复制整个网站。人工结构化关系导入仍是主路径，可选已配置AI生成候选。

## 四层数据契约

JSON接口用 camelCase，数据库列用 snake_case；时间为含时区ISO。缺失值用 null，不填0或当前发布时间。

1. `Topic`：`id,name,aliases,sourceUrls,enabled,intervalMinutes,lastAttemptAt,lastSuccessAt,nextDueAt,currentVersionId`。四个无股票种子主题：`bellows` 波纹管、`diamond-thermal` 金刚石散热、`v-groove-fau` V型槽/FAU、`thin-film-lithium-niobate` 薄膜铌酸锂。主题是用户研究范围，并非有效公司/产品关系的证据；不硬编码样例股票。最多20主题、每主题10个来源、intervalMinutes 60–10080。
2. `Evidence`：`id,requestedUrl,finalUrl,title,publisher,publishedAt,publishedTimePrecision,fetchedAt,contentSha256,extractorVersion,snippet,locator,status,errorCode,metrics`。状态为 `fetched|manual_unchecked|blocked|failed`；`fetched` 仅表示正文成功获取。`locator` 至少有提取文本片段位置或标题上下文；按同一文本规范化后片段必须确实存在于取回正文。人工提供片段未被正文匹配前保持 `manual_unchecked`。`publishedAt` 只接受正文/结构化元数据的明确发布时间，并存日期出处；HTTP Last-Modified、新闻归一化时间及采集时间不可代替。`publishedTimePrecision=instant|day|unknown`，unknown时publishedAt=null。
3. `Relation`：`id,topicId,stage,product,company,claim,evidenceIds,polarity,status,reasonCodes,metrics,review`。stage沿用 materials/equipment/components/manufacturing/applications；product须具体，不能只填“光通信”等大行业。company可null，否则为 `{name,stockCode:null|string,identityEvidenceIds:[]}`，不以同名或6位格式确认证券身份。`polarity=supports|contradicts`；`status=candidate|verified|disputed`。无证据引用不能进入关系列表，可放 `unlinkedIdeas`。verified仅由当前应用中的显式人工核对动作产生，证据必须已取回且片段匹配；网页品牌与上市证券的身份关系需要额外证据，未知时stockCode=null。不提供客户端可直写的verified字段。正反证冲突保持disputed，不自动删除旧证据。
4. `Version`：`id,topicId,sequence,previousVersionId,createdAt,knowledgeCutoffAt,contentHash,status,evidenceIds,relations,analysis,changes,gaps,run`。版本完整快照、不可原位改写。analysis为 `{kind:'ai_inference'|'manual_interpretation'|'none',text,evidenceIds,model:null|string}`，永不冒充原始事实。changes按稳定关系键(topic/stage/product/company/claim/polarity)列added/changed/disputed，无自动“消失即撤销”。run包含请求/成功/失败/重复数、起止时间、AI状态、partial及错误码。AI关闭/失败不得阻断原文保存。

`metrics[]` 每项为 `{name,value:null|number,rawValue,unit,scope,period:null|string,evidenceId}`；例如导热率须附材料/测量条件口径。无单位或口径只能保留rawValue并标缺项，不跨单位排行、求和或声称可比。原文提及产品≠量产、供货、订单、营收、景气兑现，这些需要各自claim和直接证据。

证据与版本去重：canonical URL只移除fragment，不随意删除查询参数；相同URL+正文哈希复用证据，采集尝试时间仍写run。证据内容变化生成新证据；没有内容变化记录no_change运行但不创建重复版本。review改变可以生成新版本。内容哈希不包括运行时间。取证失败保留旧快照和currentVersionId，展示最近失败与旧版时间。部分成功合并新增证据并保留既有关系，标partial；全部失败不推进版本；初次成功取到行业资料但零公司可建立零股票版本。禁止空结果覆盖已有非空版本。

禁止未来信息：`knowledgeCutoffAt`为服务端本轮开始时间；publishedAt晚于cutoff拒绝用于本轮，人工或AI不能覆盖；fetchedAt为实际服务端取回时间。未知发布日期可用于“当前看到的产品资料”，明确历史可用性未知。V1不提供回测/任意历史asOf接口；不得把今天抓到的旧文章声称为当年系统已知。未来若做历史查询，需要同时限制publishedAt与首次观察时间。

## 存储、迁移与备份

在 `db/init.sql` 增量新增4表，不改/清理既有表：

- `industry_research_topics`：主键id、配置json、current_version_id、时间字段；不设循环外键。
- `industry_research_evidence`：主键id、canonical_url、content_sha256、payload_json、created_at，UNIQUE(canonical_url,content_sha256)。blocked/failed记录存run，不用空hash伪造成功证据。
- `industry_research_versions`：主键id、topic_id外键、sequence、content_hash、payload_json、created_at，UNIQUE(topic_id,sequence)。不以hash唯一约束阻止以后返回相同内容的合法版本。
- `industry_research_runs`：主键id、topic_id外键、status、payload_json、started_at、completed_at。

关系保存在有界版本JSON中，V1不另建图数据库或全文搜索系统。单版本≤200关系、≤100证据、≤1MiB JSON；入库必须完整校验所有引用和topic归属。网络取证在事务外，证据入库+版本写入+current指针更新在同一事务中完成。同主题进程内互斥；SQLite事务内再次核对旧current避免并发覆盖。重启后未完成run转interrupted，旧版本不变。

JSON备份目前为v7且严格表白名单。实施时升级v8并增添一个顶层表键 `industryResearch`（每个主题记录含其配置、证据、全部版本和运行记录）；由research service导出/校验/恢复，backupService接入预览计数与事务。v8要求完整键集合；v1–v7缺少该键时，merge/replace均保留研究数据，不当作空集合删除。导入重复记录按稳定id/hash处理；坏引用、未来伪造、超限、哈希冲突在任何删除前拒绝。备份恢复的人工核对记录保留审计但来源标 `imported_review`，不得把外来JSON自称verified作为本机新核对。恢复后主题一律enabled=false，避免打开备份即联网/调用AI；界面可重新开启。backup当前5000条约束若无法容纳完整研究数据必须显式拒绝导出，不静默裁切。

迁移验证先在临时数据库进行：旧表哨兵内容不变、重复初始化不报错、版本/证据备份后恢复一致、旧备份不删除新增研究数据。当前任务不启动生产数据库迁移。实机部署前用SQLite在线backup API对目标数据库做带时间戳备份，不用复制正在写入的DB主文件冒充完整备份。

## HTTP接口（现有行业链router内追加）

统一 `{success:true,data}` / `{success:false,error:{code,message}}`，不回传密钥、请求头、完整上游错误或原始HTML。

| 方法/路径（均前缀/api） | 输入与输出 |
|---|---|
| GET `/industry-chain/research/topics` | 主题及状态摘要；读取不触发采集/AI |
| PUT `/industry-chain/research/topics/:id` | name,aliases,sourceUrls,enabled,intervalMinutes；本地写入校验和来源安全检查；默认enabled=false |
| POST `/industry-chain/research/topics/:id/update` | `{sourceUrls?:[],proposals?:[],useAi:false}`；缺sources时用已登记URL；同步有界采集，返回run及currentVersion；同主题忙409。URL供本轮可用，登记到后续更新需PUT显式保存 |
| GET `/industry-chain/research/topics/:id` | `{topic,currentVersion,lastRun,versions:[摘要]}`；未生成版本返回currentVersion=null和原因 |
| GET `/industry-chain/research/topics/:id/versions/:versionId` | 不可变历史版本；主题不符404 |
| POST `/industry-chain/research/topics/:id/review` | `{baseVersionId,relationIds,decision:'verify'|'dispute',note}`；只处理已有关系和已取回证据，人工核对产生新版本；旧base 409 |

proposal只接受 `{stage,product,company,claim,polarity,evidenceRefs:[{url,quote}],metrics}`；引用由服务器映射为evidenceIds，未知URL/不在正文的quote记候选缺口，绝不fetched/verified。拒绝输入的status/review/模型自称核验。接受零proposals/零股票。初次更新未提供proposals时至少展示真实来源证据，AI可选补关系候选，手工结构化JSON可随后补齐。

写接口继承server现有跨源、LAN及手机只读保护，并对这些研究写接口额外要求loopback客户端与loopback Host（解析IPv4/IPv6，不信任X-Forwarded-For）；带Origin时须同源。由本地UI/localhost脚本使用。读取可沿用现有只读访问策略。

## 取证安全与分析边界

`services/industryResearchSourceService.js` 单一取证入口，使用Node内置https/dns/net/crypto或既有库但不能依赖默认跳转/代理：

- 仅https、443端口、无userinfo；拒绝IP字面量、localhost/.local/单标签主机。DNS查全部A/AAAA，任一非公网结果就拒绝。IP分类覆盖私网、loopback、link-local、CGNAT、保留/文档/组播/未指定及IPv4映射IPv6等；优先只连接已验证的公网IPv4，纯IPv6可标unsupported，不能漏放。
- 把已验证地址钉到该次TLS连接lookup，同时保留真实hostname的SNI/证书校验；不能“检查DNS后重新由客户端解析”。默认不走环境HTTP代理，不能回退绕开校验。
- 自动redirect关闭，手动最多3次，每跳重新URL/DNS/地址钉住校验；禁止降级http。10秒每请求、全轮≤60秒、每轮最多10来源；响应≤1MiB且流式超限中止，超时/中止清理socket。仅HTML/plaintext；不执行脚本、不加载页面子资源，不接受正文里的“新指令/工具调用”。拒绝不支持压缩/编码并清楚标注。
- title/片段等前端全部escape，原文链接仅安全HTTPS并加noopener noreferrer。HTTP拒绝、HTML提取空、PDF或取证失败状态诚实保留，不保存“成功”假证据。
- AI仅在用户选用且现有 `routes/ai.js` 的getAIEnabled/getAIConfig可用时调用callAIModel；最多每轮一次、使用有界片段、结构化输出验证，证据ID白名单，引用原文片段匹配；不让网页指令决定工具/URL/系统提示。AI解析/请求失败仅analysis标failed。模型输出固定candidate；人工核对来源事实的步骤独立。

## 四个实施纵切（顺序执行）

### 1. 原文取回到持久版本与读取API

文件：`db/init.sql`、新增 `services/industryResearchSourceService.js`、新增 `services/industryResearchService.js`、`routes/industryChain.js`、新增 `test/industryResearchService.test.js`。先原文获取+人工proposals；AI及后台暂不启用。服务导出纯校验与依赖注入入口，测试替换DNS/传输而非放开本地HTTP生产策略。

验收：公开HTTPS取证能返回证据和零股票版本；非法地址/重定向/超时/伪quote/未来时间被拒绝；重复不增版本、失败保留旧版、不同公司身份不串联。先写行为测试再实现。API至少覆盖topics、update、detail，review及配置可此段一并完成。

### 2. 已登记来源更新与人工核对闭环

文件：`services/industryResearchService.js`、新增 `services/industryResearchScheduler.js`、`routes/industryChain.js`、`server.js`、`electron/main.js`、`test/industryResearchService.test.js`（本段允许超过5文件，不能遗漏用户实际使用的Electron便携版）。补齐接口和可选AI，scheduler用同一update路径；Node服务入口仅在require.main===module启动、关闭时stop，测试import server不启动；Electron必须同时接入现有后台服务启动流程及 `stopBackgroundServices`/应用退出清理路径，随桌面应用启动、退出启停。两个运行入口各自启动一次，不能依赖Electron中不会执行的server require.main分支。默认全部禁用；start无立即全量采集，按nextDueAt且串行有界运行；重复start不会多timer。应用退出后停止，无后台驻留承诺。

验收：人工核对从candidate变verified并生成版本；AI不能改验证状态；开关保存/重启有效、关闭不再新启动任务、同主题不会并发、无变化只记录run；验证Node和Electron两个入口的启停接线及退出清理，不能只测Node服务就宣称便携版后台更新可用；不创建聊天或系统计划任务。

### 3. 现有产业链页研究面板

文件：`index.html`、`js/modules/industryChain.js`、`css/styles.css`、`sw.js`（仅确有缓存版本需要时）、`test/industryChainView.test.js`。在旧页面新增研究区，不重写全站。四主题切换、URL登记、结构化proposal JSON入口、更新按钮、启用开关、版本选择，地图使用已有stage顺序展示具体product，公司表显示身份/claim/证据状态；独立显示AI判断、变化、原文链接/片段/两类时间/指标单位口径和缺口。支持人工核对选中关系（逐项核对原文后操作，不批量默许）。来源更新失败仍显示旧版并标时间与失败原因，空研究不渲染虚构公司行。

验收：主题→更新→证据→关系→旧版/新版变化可从界面走通；来源/片段转义、恶意URL无可点击入口，unknown时间、AI未启用、零股票、partial/failed均有准确文案；旧筛选/导入功能仍正常。

### 4. 备份恢复与真实验收

文件：`services/backupService.js`、`services/industryResearchService.js`、`test/backupValidation.test.js`、新增 `scripts/validate-industry-research-live.js`、本文记录实际完成/未覆盖项。验证脚本默认必须显式临时DB，拒绝默认/生产路径；真实网络采集、API及UI验收不得代用fixture宣称通过。

验收：新旧备份兼容、恢复关闭自动更新、全部版本可追溯，原有表不变；真实官网到UI至少一条产品证据和一条candidate关系闭环。人工verified验收需真实核对，不为漂亮计数强行升格。记录实际时间、URL、哈希、状态、截图路径及测试结果。

## 可运行验证命令

在D:\Webstock PowerShell执行，先用项目已经验证的隔离预载；它在require数据库前设置 `WEBSTOCK_DB_PATH=:memory:`。持久化测试自身用临时目录数据库并finally关闭清理，绝不使用data/webstock.db。

```powershell
node --require ./artifacts/validation/audit-repairs-20260908/test-db-preload.cjs --test test/industryChainService.test.js test/industryChainApi.test.js test/industryChainIntegration.test.js test/industryChainView.test.js
# 第1段文件存在后：
node --require ./artifacts/validation/audit-repairs-20260908/test-db-preload.cjs --test test/industryResearchService.test.js test/industryChainApi.test.js test/industryChainView.test.js test/backupValidation.test.js
node --check services/industryResearchSourceService.js
node --check services/industryResearchService.js
node --check js/modules/industryChain.js
# 第4段脚本实现后，由脚本创建临时DB并验证路径：
node scripts/validate-industry-research-live.js --isolated --topic v-groove-fau --url "https://www.focuslight.com/product/micro-optics-component/v-groove/v-groove-array/engineered-v-groove-arrays/"
```

现有测试基线由主代理记录；上述未来文件命令不代表已运行。UI实机用独立临时DB、loopback随机端口，主代理核对截图。不得直接 `npm start` 触发生产库与已有scheduler。

真实来源候选由主代理本轮提供：上列炬光科技官网产品页，可用于具体V型槽产品规格/用途，不据此推断量产、客户或订单；若正文无发布时间则unknown。候选年报 `https://static.cninfo.com.cn/finalpage/2026-04-29/1225227562.PDF` 在V1标unsupported_content_type，不冒充已读。主代理将实测HTML可达性与片段；未亲测前不预写正文事实。

未覆盖：全网搜索、付费/登录资料、PDF/OCR、证券身份自动消歧、收入暴露量化、收益/回测、自动买卖、网站爬虫平台、多进程调度、应用退出后的更新、Windows打包及生产部署。功能实现、隔离测试、真实来源/UI验证、生产启用分别报告。
