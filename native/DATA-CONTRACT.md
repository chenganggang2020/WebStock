# 原生0.9取数、更新与保存契约

## 0.9 新增契约

分类资金snapshot沿用旧ulist.np/get的f62/f66/f72/f78/f84，单位CNY；它不是日/分钟序列。源没有时刻时sourceObservedAt=null、timeMeaning=unknown-source-clock、rows=[]，checkedAt仅表示获取时间；不归档到伪造交易日，不推导变化率。缓存拒绝晚到的更旧checkedAt覆盖。

研究业务新增topics/relations/collections。关系引用已存在主题及文稿，quote必须是原文逐字子串；stage及核验状态使用有限集合。资料改动/删除不能使已有引用失效。迁移版本报告只是原记录，不转成自动确认关系。

采集record区分originalText、text、asrText/asrResult。重识别只更新ASR结果，已有原文/校对稿保持；用户点“使用本次识别稿”才替换编辑框并保存。发布到docs按记录ID稳定生成目标ID，存在则拒绝覆盖。来源时刻和授权说明保留，识别/人工核验不证明投资准确性。

Windows只运行用户选择的本机媒体、已有引擎及模型；不自动联网下载或续跑。单进程队列，30分钟超时、8MiB输出限额、60万字文稿限额；退出任务标中断。Android文本文件通过系统文件选择器导入，运行与存储独立；视频ASR尚未迁入。

本轮用户确认暂无授权行情接口，先沿用旧程序公开取数、本机快照观察及授权文件导入。Windows C++/Qt、安卓Java独立运行；不访问账户密钥、不改旧正式数据库，不自动进行全市场高频采集或实际交易。

## 与旧来源对应

|能力|旧代码依据|原生沿用方式|边界|
|---|---|---|---|
|公开报价、五档|旧公开报价与localQuoteSampler|新浪直接HTTPS，真实证券身份与源时刻；已有123只自选|普通五档不是虚拟竞价匹配量，也不是逐笔|
|日周月K/分时|旧公开K线/分时|腾讯直接HTTPS；年K按月K汇总|来源历史窗口有限，首个汇总周期可能不完整|
|秒级本机观察|services/localQuoteSampler.js、localThirtySecondBarService.js|前台选中标的5秒取快照，5/30秒已观测OHLC|不是全成交OHLC；未运行或停采期间不补历史|
|竞价时段报价观察|localThirtySecondBarService.js的竞价时段与空字段规则|前台竞价页所选阶段5秒普通报价观察，与授权过程独立键|普通报价只标普通报价；虚拟量缺失；盘前旧收盘价不变成新竞价点|
|授权竞价文件|js/modules/auctionRules.js的数据契约|原生校验身份、阶段、源时间、availableAt/asOf、价格与股数|本批不移植旧八形态；文件声明不等于独立验证提供方真实性|
|分类资金|services/capitalFlow/adapters.js、index.js|东方财富日历史及当日盘中五类净额；保留来源原响应|公开来源不稳定，无SLA；没有授权L2不计算逐笔明暗盘|

## 更新与数据库

基础报价前台60秒、手动刷新；高频观察仅选中标的/所选页面、适用交易时段5秒。网络有大小、超时、并发与重复请求限制；网络失败最多两次有界重试，HTTP拒绝/解析错误不反复请求。后台停止新增定时请求。不改变代理、DNS或凭据配置。

各端使用自己的market-v1.sqlite。网络解析后交给后台串行写者，整批事务成功才标“已保存”；失败回滚且保留旧记录。关闭或系统终止时不能承诺未提交排队记录全部保存。自选继续原子JSON保存，旧正式自选可只读导入。

序列按标的、周期、来源、复权基准与盘中日期隔离。同基准按时间去重；无效点不能擦除已观察点。前复权已收盘OHLC修订会归档旧基准并开新序列。周/月/年稳定周期起点键与来源截止日期分开；新calendar-v1键不拼旧变动日期键。资金日日期键改为午夜date-key，capital-day-v1隔离旧15:00键；旧版本仍存档，不伪装被删除或全部能在界面回放。

竞价asOf按真实时间比较，较旧文件不得使活动快照倒退。同事件按较新availableAt修订选择；同可用时间不同数据拒绝猜测。基准缺失、未来才可用或收盘基准事件不合阶段时不计算相对涨幅。

## 0.8旧数据导入与资金档案

旧SQLite只以QSQLITE_OPEN_READONLY读取快照，限定portfolio_accounts/trades/knowledge_sources/portfolio_snapshots；每表最多10000条、转换包最多16MiB。旧ID用legacy-webstock前缀映射，完整原始记录保留legacyOriginal，不复制其他表内容。未迁表名列在预览。当前只支持同一个旧库；跨库整数ID不能混用，同ID合并保留本机，恢复前备份成功才写事务。

旧资金仅接收webstock.capital-flow.v1、stock、CNY、vendor-classified:Eastmoney，核对沪深股票身份、同日递增时间、有效主力金额及最后observedAt。分档可缺失，缺失不是零。原JSON和归一化行一起保存；完整ID-capital@日期独立档案不替换当前来源，较旧源时刻不能借新下载时间覆盖较新数据。直接来源盘中成功也归档；失败保留历史。

变化速度=累计净额差/两点间交易分钟，午休重叠扣除。零交易时长、跨日、换源、缺金额不计算；前后速度均有效才计算加速度。它们不识别机构账户，不等于逐笔明暗盘。回放只展示游标以前已取得点，不补缺口。

真实迁入为1账户、11流水、851资料、91快照及2份各240点资金。两端独立库写入；Android通过转换文件迁入，之后运行和HTTPS取数不依赖电脑。旧现金值保留原文，不冒充动态现金账；旧快照不以当前报价重算。0.8尚未迁完整旧库。

## 历史0.7边界及仍未完成内容

0.7新增business-v1独立记录库及两端手工移动加权账本。该库只在用户保存/删除/确认恢复时写入；全账户流水校验与写入共用同一事务。持仓按账户与市场/类型/代码隔离，同日流水保留插入次序；重编辑不换记录ID。报价源日期与金额缺失状态参与展示，不把缓存当实时。原生备份同ID明确合并，备份自身重复ID拒绝；原格式转换和原正式数据迁移尚未实现。

业务页面保留各自状态，不使用跨窗口全局当前标的覆盖异步响应。Windows已隐藏/关闭的竞价页不继续主动采样；Android只有可见前台竞价页采样。文件选择器意图和草稿按安卓系统重建规则保存。主业务页不使用模态对话框，删除/覆盖确认及系统选文件除外。

安卓东方财富资金端点报unexpected end of stream，有限重试仍未取得真实资金行；界面显示缺失或真实旧缓存，不能以测试两行样本冒充来源成功。Windows此前100条日历史已取得并回读，但最后复测也出现Connection closed，临时新库资金测试失败；已有真实历史可回退，不代表当前源健康。盘中、跨整日负载、手机其它系统及物理设备仍需验。

2026-10-11为非交易日，本机5秒及竞价观察的真实整时段覆盖仍待交易日验收。已获数据日期为2026-10-09，设备读取时间不冒充源日期。

旧账本/持仓/统计、候选、产业与AI研究、证据阅读、采集转写、纸面组合/情景工具、全部资金回放/轮动和备份恢复尚未全迁。117条逐项状态在MIGRATION-STATUS.json，不把导航占位算完成。公开资料或公开源访问不等于商业再分发授权。

## 0.10 媒体归档与自动执行许可

0.11补充：安卓collections的asrRun是本次用户启动的运行号，executionRevision防止备份替换后旧结果写回。恢复一律清asrRun；running改interrupted。asrState与downloadState独立，状态不得代替文本成功。asrResult含engine/model/deviceLocal/sourceSampleRate/sourceChannels/decodedSeconds/audioOffsetSeconds/segments（start/end/text/words）；毫秒/秒不混用，这些识别时间为音轨内秒数。sourceObservedAt或发表时间不由音轨时间推造。text/originalText仅为空时填入初次识别，已有校对和研究资料不被重试覆盖。手机模型路径只来自本机校验安装与私有偏好，不从业务备份读取。保存草稿用字段基线合并，后台ASR结果不被旧空编辑框覆盖。

下载器只接受旧程序CDN白名单的HTTPS直链（非作品网页），无userinfo/自定义端口，每次重定向复验，最多5次。媒体上限256MiB，校验Content-Type、长度、MP4/M4A ftyp标识及可选预期SHA256，独立UUID原子归档；容器头通过不等于完整媒体解码通过。未知时长不得伪造。下载时间是设备获取时间，不是作品发布时间。

collections新增mediaUrl/expectedSha256/assetPath/archive（sha256/bytes/contentType/downloadedAt）、autoPipeline/pipelineState/pipelineFailures/nextAttemptAt等。Windows只由用户主动启用后执行，Python/模型路径与批准ID在原生archiveRoot/queue-settings.ini，不从JSON备份取得执行路径。失败退避60秒起至最多1小时，五次挂起；保存状态失败暂停全部自动调度，不能继续立即重试。

备份restore对被实际写入的collections旋转executionRevision、清除autoPipeline/downloadRun，运行态变中断；keep-existing跳过记录不影响原任务。识别队列及在途结果核对修订号，旧任务不写入被替换记录。取消先终止活动执行，再尝试保存状态，取消/完成/挂起撤销本机批准。成功入研究库按collectionId幂等，不覆盖已存在研究资料及其人工修订。

Android下载在设备内线程执行、主线程提交私有库；downloadRun随机身份只由本机点击产生，恢复清空，防止旧下载结果绑定到替换记录。切子页继续；Activity销毁取消，不代表系统后台持久任务。下载成功不标记ASR完成，不制造文稿；手机ASR仍待实现。两端下载仅受控响应验证，实际旧本机视频转写另验，不混称全链路实测。
