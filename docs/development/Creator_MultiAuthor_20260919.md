# 多作者采集与长视频转写实施合同

用户要求：粘贴作者分享文字直接添加并扫描；多个作者同时提交；下载、整理、逐字转写长视频；实测 Fioona 的全部公开可访问作品。按用户“直接执行”要求连续推进，不重复请求方案确认。

## 范围与验收

1. 分享解析：支持完整 `/user/`、`iesdouyin.com/share/user/` 与短链中的主页身份；不把视频链接当作者；剔除跟踪参数；每跳域名白名单。身份匹配仍由采集页证据决定。先通过 `node --test test/douyinProfileResolver.test.js`。
2. 多作者：作者选择与阅读对象分离；作者任务可多选提交；持久化队列，按作者轮转，每轮最多 5 个视频，任务可取消/续跑。运行器只在桌面后台启动，退出后停止、下次启动恢复；与既有采集共享串行执行器。完成必须区分目录覆盖和下载/转写覆盖。先通过 `node --test test/creatorCollectionQueue.test.js`。
3. 长视频：沿用 faster-whisper，提供 small / large-v3-turbo / large-v3；当前机器先准备 turbo。模型未安装不得静默降级；有限 CPU 线程；按视频时长给有上限的超时；段落进度、保留时间戳。模型效果只能样本抽查验证，不承诺零错字。通过 Node/Python ASR 测试后再用真实已归档视频试转写。
4. UI：现有紧凑左作者、中视频、右正文结构不变；增加分享文本框、多选作者队列、明确模型与状态。已有数据不删除，评论历史不删除。

## 结构及实现顺序

- `services/douyinProfileResolver.js` + API + 添加作者表单。
- `services/creatorCollectionQueue.js` + SQLite 新增任务表 + API + Electron 定时运行器；既有 syncChannel 增加单轮限制/模型参数。
- `services/douyinTranscriptService.js`、`quant/douyin_transcribe.py` 的模型检查、进度与长视频保护。
- UI 与定向/全量回归，构建新版；真实作者结果单独记录，不将夹具作为采集结果。

遵循现有 CommonJS 和函数模块风格，例如 `async function resolveDouyinProfile(text, options = {})`；边界通过 `throw new Error(...)` 交由现有 API envelope 返回。测试使用 Node test 与内存 SQLite，不向生产 DB 直接写脚本。

## 数据与权限边界

只通过健康的运行程序 API 添加用户指定作者和提交任务。只采用户可访问的公开页面，不绕过登录、验证码、付费或私密限制；页面不见的历史不能承诺恢复。禁止更改真实持仓、自动交易、同花顺文件。不得复制浏览器凭据到其他工具。

新任务表属本功能正常持久化实现，不改原资料表。模型从上游公开仓库下载，固定版本；不新增收费调用，不默认把音视频上传云端。用户未要求提交/推送。

## 模型资料

- faster-whisper：https://github.com/SYSTRAN/faster-whisper （CPU int8、时间戳、VAD、large-v3/turbo 支持；上游基准不能当本机实测）。
- turbo 下载：上游模型映射 `mobiuslabsgmbh/faster-whisper-large-v3-turbo` 目前重定向至 `dropbox-dash/faster-whisper-large-v3-turbo`，本轮核对 revision `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf`。
- 中文候选 Qwen3-ASR：https://huggingface.co/Qwen/Qwen3-ASR-1.7B 。不是当前已安装运行器，不为“换模型”而直接混入尚未验证的新推理依赖。

## 真实核查起点

2026-09-19 北京时间，用户分享短链解析到 Fioona，抖音号 97081540，主页显示 229 作品（平台数字非本地完成数）。已经运行程序 API 创建频道 4，默认增量采集已发现 49 条，后续状态待核对。该动作没有删除模型先生频道。

## 实现与审核结果

- 新增 `/api/expert/resolve-profile`（POST，`{text}`），HTTPS / 主机 / 跳转次数校验，保留大小写敏感的 sec_uid，不读取登录凭据。短链解析成功不等于作者身份已验证。
- 新增 `/api/expert/collection-queue` GET/POST；POST `{channelIds, mode:archive|incremental, model:small|large-v3-turbo|large-v3}`；`/:id/cancel`、`/:id/retry` 为 POST。单次最多50位作者；批量校验原子化，同作者活跃任务复用原参数。GET含后台执行器状态和当前进度。
- SQLite新增 `creator_collection_queue`，不迁移、不删除已有视频。启动恢复被中断任务，轮转每批最多5条；停止等待当前小批次结束。错误或无实际进展暂停为 partial/blocked，可明确续跑，不无限热循环。
- 与原采集器共用串行执行队列；后台定时增量跳过已在批量队列的作者，避免把用户选定的 turbo 换成默认 small。统一退出流程先停队列。
- 作者输入框接受完整分享文字；左侧多选与右侧阅读身份独立；新增作者可保存后入队。顶部队列显示作者、模型、范围、目录/已完成/待处理、停止与续跑；旧服务无此接口时明确报不可用，不伪造空队列。
- 原内部1000条统计截断已修复；公共列表分页上限保持1000。只有可信主页总数已覆盖、无缺失/失败且处理队列归零，才标本轮全量完成。未知总数不能宣称完整。
- 长视频单文件下载上限由250 MiB改为1 GiB；本地识别默认30分钟，按已知视频时长4倍加10分钟扩展，最长6小时，明确配置优先。仍限制CPU为2线程，未接GPU推理；长视频会较慢。
- Python每约30秒音频覆盖报告一次进度（不是墙钟ETA）；保留分段时间戳，禁用前段文本自动延续以减少长段错误传播。质量指标未知保留null，ASR入库规范化也保持null。
- 单视频“重新转写”可使用左侧模型选择，复用原视频归档。会更新该条当前ASR结果，不是生成一个虚构校对稿。既有整库历史稿不自动重做。

## 实测与验收

- 最终 Node 回归：1683/1683，0失败/0跳过；`dist/creator-final-tests-20260919.log`，16.00秒，内存DB隔离。Python专项2/2。新增队列14项含真实SQLite持久化和1006条记录的边界回归。
- 浏览器在43832隔离验收源使用生产前端、明确合成作者/视频/队列；检查双作者勾选提交、去重、停止、续跑、作者切换不串读、整段分享文字输入。该预览的队列POST只改内存夹具，其他写入仍拒绝，不是生产采集验收。
- 定向复跑曾提前于打包脚本恢复Node原生依赖，出现SQLite ABI 140/137不匹配；脚本完全退出后串行全量复跑得到上述全绿结果。不是业务修复成果，也不隐藏中间失败。
- 新模型 `model.bin` 大小1,617,884,929字节，SHA256 `E76620F83D5F5B69EFD3D87E3DC180C1BD21DF9FBEBACFD4335E5E1EFCC018DA`。先下载至短路径 `D:/Webstock/quant/asr-models/faster-whisper-large-v3-turbo`，避免Windows长路径错误，再复制到实际便携数据目录的 `asr-models/faster-whisper-large-v3-turbo`；未动已有small模型。
- 真实作品 `7686855401292521969` 时长594.27秒，原采集small已出稿。turbo在同一已归档视频前30秒、本机CPU/int8/2线程试跑成功，含加载耗时58.92秒。部分词句更合理，仍有“低息”“横强”等同音误识别；没有人工金标准，不报告WER或宣称全面优于small。试跑仅stdout，不覆盖生产逐字稿。
- 截至02:13:18，原运行程序Fioona目录49条，真实已归档3条、已有逐字稿3条，后台仍在运行。不能把229条平台数字、49条目录或3条转写相互混用。

- 最后一项交互核验确认“保存后全量扫描”不受另一区域增量选项影响，固定以archive入队；所选模型保持不变。

## 交付边界

本轮保留上一轮Compact UI改动，不改持仓、交易或同花顺文件；不提交或推送。免费本地转写无需新增API费用，但平台登录/验证码、不可访问或删除作品无法绕过。完整229条及新队列在用户实际桌面实例上的运行，需切换最终包后核验；不能把构建或合成界面测试当成全部资料提取完成。

### 最终交付文件

- 构建源件：`dist/creator-workbench-r2-20260919/Market-Research-Creator-20260919.exe`。
- 用户入口：`dist/portable/Market-Research-Creator-20260919.exe`，与现有WebStockData同目录，保留旧Compact可执行文件。
- SHA256：`7E79CC9A4A2CBD38C1786274EED468FAE404E3A831EB7C011B53DB6BF0A62A52`；采用store压缩减少构建等待，不含下载的ASR模型，模型已单独置于本机数据目录。
- 最终包在隔离端口49686通过健康检查；随后构建脚本退出验收实例并成功恢复Node原生模块。日志 `dist/creator-final-build-20260919.log`。
- 当前真实进程仍是 `dist/portable/Market-Research-Compact-20260919.exe`，端口3000进程11352；02:13:23完成Fioona首轮：目录49、详情8、归档3、转写3、详情/转写错误0。主页总数229，尚未完成全量。
- 桌面检查确认旧版没有窗口菜单退出项，只有托盘“完全退出”；未强杀、未重启旧程序。已请求用户完全退出以切换新版；全量新队列尚未在生产实例入队，不伪称已启用。
