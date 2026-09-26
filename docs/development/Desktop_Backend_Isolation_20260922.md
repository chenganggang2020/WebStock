# 桌面主线程与数据服务隔离修复

状态：修复和独立打包验证已完成；用户确认退出后，2026-09-22 19:23 已切换实际运行实例。启动验证通过，长期生产稳定性仍待实际运行检验。

## 目标与边界

将本地 Express、同步 SQLite、作者同步和定时数据任务移到独立后台进程，使其阻塞时不再卡住 Electron 窗口管理。保留现有界面、API、数据路径、登录会话分区、定时频率、权限和端口；不新增依赖、不改数据库结构、不自动重启失败任务、不启动全量采集、不清空或迁移生产资料。

原生 BrowserWindow/登录窗口仍在 Electron 主进程，通过私有父子进程通信请求页面采集；全量扫描的逐批回调必须等待后台保存完成，不能丢失身份校验或断点。移动访问令牌变化也必须同步到后台。

本轮不承诺所有数据接口立刻变快：先隔离整窗阻塞，再修复采样状态缺陷；全市场历史初始化与完整缓存改造不混入此轮。

## 决策与替代方案

- 使用现有 Electron 可执行文件以 Node 子进程模式运行后台，沿用当前 native SQLite ABI 和打包方式。
- 不把每个同步数据库调用改成异步代理：会破坏现有同步事务与大量服务契约。
- 不仅增加 setInterval：定时器与同步入库仍共用主线程，不能隔离卡顿。
- 后台崩溃明确失败，不自动重放采集/写操作；正常退出须等待后台停止。后台与桌面分别保留独立卡顿观察器，日志按目录区分。

## 分步任务与验收

1. 私有通信与原生采集桥接（electron/processRpc.js、electron/desktopBackend.js、对应测试）。
   - 拒绝未知方法；断连拒绝等待中的请求；超时不重试写入。
   - archive.onBatch 在独立进程仍按顺序保存并等待，失败向上传递。
2. 搬迁数据服务启动/停止（electron/desktopBackendServices.js、electron/desktopBackendProcess.js、electron/main.js）。
   - 主窗口进程不加载 server/db/作者业务服务；原有调度只启动一次。
   - 正常退出清理后台；启动失败不留下端口；LAN/Tailscale 权限保持。
3. 隔离阻塞测试与采样问题复现。
   - 在测试后台注入有限同步等待，父进程心跳和请求调度仍工作，后台独立日志捕捉阻塞。
   - 使用临时数据库与隔离端口，关闭所有业务自动任务；不得使用生产库做写入测试。
4. 相关回归、打包兼容性检查，记录源码测试与实际 EXE 验收差异。运行版替换前单独确认正常退出。

## 结构、风格与命令

源码工作区：D:/Webstock/output/recovery-20260920/source。沿用 CommonJS、两空格、依赖注入式 createX(options) 工厂；测试用 node:test/assert，位于 test/；子进程测试夹具位于 test/fixtures/。

示例：`async function stop() { await backend.stop(); }`，异步边界显式 await；不对未知函数或任意路径提供远程执行。

PowerShell 验证命令（运行于上述工作区）：

```powershell
& 'C:/Users/25680/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test test/processRpc.test.js test/desktopBackend.test.js test/localQuoteSampler.test.js
& 'C:/Users/25680/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --check electron/main.js
& 'C:/Users/25680/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' scripts/build-electron-win.js portable --config.directories.output=dist/backend-isolation-20260922
```

没有独立 lint 命令，以语法检查、定向回归、隔离进程验证与打包后运行核对为准。不得把单元测试通过等同于用户运行实例已修复。

## 实现与验证记录

2026-09-22，北京时间：

- 数据服务已移至 `desktopBackendProcess.js`，通过 `desktopBackend.js` 与窗口连接；自动采样、作者同步及现有盘后调度随数据后台启动，不改变频率或开启全量初始化。
- 窗口主入口不再直接加载 server、db、行情路由或作者资料服务；原生登录及页面采集保留在主进程，按批保存必须等待后台确认。
- 正常退出停止接收新工作，不再排队开始下一个作者；已经运行的网络/转写子进程自然收尾，保存完成状态。退出失败可以重试，不强制终止；托盘和窗口保留重试入口。首次推送定时器也随 stop 取消。
- 独立审查发现并复现了提前结束任务、停止失败不能重试、托盘提前销毁三项退出风险，均已增加回归并修复。
- `localQuoteSampler` 增加返回数、延迟数、来源时间、实际取得时间和最小来源延迟，区分“没有报价”和“报价已经返回但延迟”。新鲜度边界仍为 30 秒，不把陈旧快照冒充新鲜采样。
- 实际生产库只读取证表明 5 秒记录确实存在，最新样本至 14:59:35；三个抽查股票的部分样本源时间落后落库时间约 29～37 秒。这解释了部分“新鲜成功为空”状态，不证明所有缺口已修复，也尚未唯一确认延迟来自供应端、本机时钟还是处理排队。

最终验证：打包并恢复本地 Node 原生模块后重新运行 15 个相关测试文件，106/106 通过。覆盖启动失败清理、跨进程令牌同步、退出后拒绝新工作、托盘退出失败、独立日志、采样新鲜度与作者保存；全部数据库使用临时隔离文件。这是针对性回归，不是全项目完整回归。

真实 Electron 39.8.10 窗口验证：`test/fixtures/electron-backend-window.js` 使用隐藏测试窗口和独立测试后台，在后台同步阻塞 1 秒期间点击按钮；交互返回 1 ms，180 ms 检查期间主进程收到 6 次定时事件，后台最终正常退出 code=0。这是受控隔离验证，不是生产负载或所有页面的长时间性能测试。

构建目标：`dist/backend-isolation-20260922/Market-Research-20260922-BackendIsolation.exe`，与运行中的 `dist/module-placement-20260920/Market-Research-20260922-VolumeNine.exe` 分开。打包验证必须通过隔离数据库和端口启动健康检查，并确认窗口/后台两个不同 PID 各自写入诊断日志。

19:09 构建完成：116,298,843 字节，SHA-256 为 `6ee58e43fd4c2aeae9a3a56b0bfe16db7bd349c187618e9a5443fcb8718fc6d3`。便携包真实启动通过隔离端口 63348 的健康与数据库检查；窗口 PID 2516、数据后台 PID 31672，两个观察器日志启动正常。打包内 9 个本轮后端关键文件、34 个界面资源的 SHA-256 与当前源码一致。测试实例已清理，Node 原生依赖已恢复；构建后再次核对生产仍为旧版启动器 PID 20196 / 主进程 PID 29288，本轮未退出、强杀或替换它。

已知边界：同步数据库仍可能使数据后台接口变慢；图表渲染自身的长任务、来源延迟、磁盘/数据库锁竞争仍需新运行日志继续定位。未改变页面缓存架构或宣称所有卡顿完全消失。

## 实际运行切换（2026-09-22 19:23，北京时间）

- 用户明确表示已经退出后，确认旧版进程列表为空、3000 端口无人监听；没有强杀。
- 原数据库离线备份至 `output/backups/backend-isolation-20260922-192136/webstock.db`；原文件与备份 SHA-256 一致：`a89fc43cfa4c1b3a501554369d8a160effd1c64cfae875f9b66f21d72b5a8c7b`，备份 SQLite `quick_check=ok`。
- 新包复制到原运行目录 `dist/module-placement-20260920/Market-Research-20260922-BackendIsolation.exe`，文件校验与构建产物一致；旧 VolumeNine EXE 保留，没有覆盖数据目录或登录资料。
- 19:23:31 启动新包，启动器 PID 32388；窗口主进程 PID 52584，数据后台 PID 38932，3000 端口确由后台 PID 38932 监听。运行日志明确使用原 `WebStockData/webstock.db`，无新数据目录迁移。
- 健康接口 `status=ok/database=ok`，检查耗时约 317 ms；Windows 主窗口标题为“市场总览 · 行情与研究”，窗口句柄存在，19:25 复查 `Responding=true`。
- 桌面观察器 PID 48052、后台观察器 PID 33044，分别已写入对应启动日志。初次运行后台记录部分约 6 秒慢请求及诊断事件丢弃通知，未据此宣称所有 API 加速或全部事件完整留存；本次短检查期间窗口日志没有新增停顿事件，不代表长期无卡顿。
- 后台采样状态 `running=true/intervalSeconds=5`；当前休市，`allowed=false/reason=非采样时段，保留历史`。未手动触发全量采集或模拟实时数据。
- 备份与当前数据库抽查计数一致：自选 105、作者 3、作者资料 729、知识来源 621、知识片段 717、账户 2、资产快照 91；这是数量核对，不是每条业务内容重新审计。
- 公共桌面旧 `WebStock.lnk` 指向安装版，修改因权限被拒绝，未更改权限或删除它；已备份该链接，并新增 `D:/OneDrive/桌面/行情与研究（新版）.lnk`，回读确认指向新包。以后从新版入口启动，避免再次启动旧安装版。
- 浏览器自动化连接因信任限制不可用，本轮未声称逐页视觉/点击验收完成；上述为实际运行文件、Windows 窗口响应、接口、数据目录与独立日志验证。
