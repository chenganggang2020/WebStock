param(
    [Parameter(Mandatory=$true)][string]$BuildDirectory,
    [Parameter(Mandatory=$true)][string]$QtBin,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$PluginPackages,
    [Parameter(Mandatory=$true)][string]$ExistingPluginRoot,
    [Parameter(Mandatory=$true)][string]$PythonBase,
    [Parameter(Mandatory=$true)][string]$SampleCsv,
    [string]$PanelCsv,
    [string]$FundamentalExamples,
    [string]$EventCsv,
    [string]$StatisticalCsv,
    [string]$EconometricCsv,
    [string]$PortfolioCsv,
    [string]$IntradayCsv,
    [string]$FactorCsv,
    [string]$ObservationExamples,
    [string]$CostCsv,
    [string]$LimitExamples,
    [string]$OptionCsv,
    [string]$HikyuuCsv
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) { throw 'Destination exists; use a new preview directory.' }
$taskExe = Join-Path $BuildDirectory 'desktop\MarketNativeReview.exe'
if (-not (Test-Path -LiteralPath $taskExe)) { throw 'Build the full MarketNativeReview target first.' }
$taskDeploy = Join-Path $QtBin 'windeployqt.exe'
& $taskDeploy --version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Qt deployment tool cannot start; put the matching Qt and MinGW bin directories on PATH before deployment.' }
New-Item -ItemType Directory -Path $Destination | Out-Null
$taskRelease = (Resolve-Path -LiteralPath $Destination).Path
$taskProgram = Join-Path $taskRelease 'Stock.exe'
Copy-Item -LiteralPath $taskExe -Destination $taskProgram
Copy-Item -LiteralPath (Join-Path $BuildDirectory 'desktop\WebView2Loader.dll') -Destination $taskRelease
& $taskDeploy --release --no-translations $taskProgram *> (Join-Path $taskRelease 'qt-deployment.log')
if ($LASTEXITCODE -ne 0) { throw 'Qt deployment failed; inspect qt-deployment.log.' }
$taskData = Join-Path $taskRelease 'data'
New-Item -ItemType Directory -Path $taskData | Out-Null
& $PythonBase -c 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute("PRAGMA user_version=0"); db.close()' (Join-Path $taskData 'business-v1.sqlite')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated preview database.' }
Copy-Item -LiteralPath $ExistingPluginRoot -Destination (Join-Path $taskData 'quant-plugins') -Recurse
# SQLite's consistent backup reads the old application's shared cache without
# copying a database file mid-transaction or writing to the source data root.
$taskPreviousLive = Join-Path (Split-Path -Parent $ExistingPluginRoot) 'live'
if (Test-Path -LiteralPath $taskPreviousLive -PathType Container) {
    & $PythonBase (Join-Path $PSScriptRoot 'snapshot_market_cache.py') $taskPreviousLive (Join-Path $taskData 'live')
    if ($LASTEXITCODE -ne 0) { throw 'Could not snapshot the existing public market cache.' }
}
# Exact mappings from the previously configured installation allow a freshly
# installed package to reuse its own environment without asking for a path.
$taskRuntimeDefaults = @{}
$taskInstalledCatalog = Get-Content -LiteralPath (Join-Path $taskData 'quant-plugins\catalog.json') -Raw | ConvertFrom-Json
foreach ($taskPlugin in $taskInstalledCatalog.plugins) {
    if ($taskPlugin.runtimePath -and (Test-Path -LiteralPath $taskPlugin.runtimePath -PathType Leaf)) {
        $taskRuntimeDefaults[$taskPlugin.id] = $taskPlugin.runtimePath
    }
}
[IO.File]::WriteAllText((Join-Path $taskData 'quant-plugins\runtime-defaults.json'),($taskRuntimeDefaults | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $PluginPackages -Destination (Join-Path $taskRelease 'plugin-packages') -Recurse
Copy-Item -LiteralPath $SampleCsv -Destination (Join-Path $taskRelease 'historical-fixture.csv')
if ($PanelCsv) { Copy-Item -LiteralPath $PanelCsv -Destination (Join-Path $taskRelease 'synthetic-panel-test.csv') }
if ($EventCsv) { Copy-Item -LiteralPath $EventCsv -Destination (Join-Path $taskRelease 'synthetic-events-test.csv') }
if ($StatisticalCsv) { Copy-Item -LiteralPath $StatisticalCsv -Destination (Join-Path $taskRelease 'historical-first1000-statistical.csv') }
if ($EconometricCsv) { Copy-Item -LiteralPath $EconometricCsv -Destination (Join-Path $taskRelease 'synthetic-econometric-panel.csv') }
if ($PortfolioCsv) { Copy-Item -LiteralPath $PortfolioCsv -Destination (Join-Path $taskRelease 'synthetic-portfolio-equity.csv') }
if ($IntradayCsv) { Copy-Item -LiteralPath $IntradayCsv -Destination (Join-Path $taskRelease 'synthetic-intraday-sessions.csv') }
if ($FactorCsv) { Copy-Item -LiteralPath $FactorCsv -Destination (Join-Path $taskRelease 'synthetic-factor-panel.csv') }
if ($OptionCsv) { Copy-Item -LiteralPath $OptionCsv -Destination (Join-Path $taskRelease 'synthetic-option-chain.csv') }
if ($HikyuuCsv) { Copy-Item -LiteralPath $HikyuuCsv -Destination (Join-Path $taskRelease 'historical-hikyuu-first500.csv') }
if ($CostCsv) { Copy-Item -LiteralPath $CostCsv -Destination (Join-Path $taskRelease 'synthetic-cost-model.csv') }
if ($LimitExamples) {
    $taskLimits = Join-Path $taskRelease 'synthetic-limit-tests'
    New-Item -ItemType Directory -Path $taskLimits | Out-Null
    Get-ChildItem -LiteralPath $LimitExamples -Filter '*.csv' -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $taskLimits }
}
if ($ObservationExamples) {
    $taskObservations = Join-Path $taskRelease 'synthetic-observation-tests'
    New-Item -ItemType Directory -Path $taskObservations | Out-Null
    Get-ChildItem -LiteralPath $ObservationExamples -Filter '*.csv' -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $taskObservations }
}
if ($FundamentalExamples) {
    $taskExamples = Join-Path $taskRelease 'synthetic-fundamental-tests'
    New-Item -ItemType Directory -Path $taskExamples | Out-Null
    Get-ChildItem -LiteralPath $FundamentalExamples -Filter '*.csv' -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $taskExamples
    }
}
$taskConfig = @{schema='stock-local-data-root/v1';directory=$taskData} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $taskRelease 'stock-data-root.json'),$taskConfig,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $taskRelease 'Start-Stock.cmd'),"@echo off`r`nstart `"`" `"%~dp0Stock.exe`"`r`n",[Text.Encoding]::ASCII)
$taskReadme = @'
WebStock 量化插件本机预览版

双击 Start-Stock.cmd。进入“研究 → 量化研究 → 插件中心”。
在插件中心查看本地插件包、安装/卸载/启停；双击“我的功能”或点击“打开功能”进入独立业务窗口。
“股票历史行情”：市场/证券类型/代码 → 周期与日期 → 来源/复权口径。
入口与原程序看盘共用data/live/market-v1.sqlite，沿用原生请求和保存队列；没有另建插件行情库。
可选择“使用已保存数据（不联网）”“补齐缺失行情”或“主动刷新”。腾讯日/周/月线及AKShare股票日线分别按来源保存。
旧缓存只在身份、来源、单位与复权可核验时复用；缺失元数据、未知休市/停牌/上市状态或截断都不宣称完整。
复权快照跨日或扩展范围时刷新整个选定区间；腾讯长区间分段并核对重叠行情，更新失败保留旧版本。
右侧显示请求与实际返回区间、来源、采集时间、价格/成交量图和明细；成功后自动保存到原有结果档案。
已保存历史行情明确标注为旧档案，可导出CSV或交给已安装的指标/回测；没有用旧样本顶替新请求。
Python路径和等待时限位于高级设置；同一插件重新安装会复用本机已配置环境。
插件包已安装；具体数量与功能见plugin-packages/index.json及implementation-plan.json。
运行环境使用本机此前准备好的隔离环境；本目录尚不是可在另一台机器直接运行的完整安装器。
可选择 historical-fixture.csv 运行；这是公开仓库的旧股票样本，不是实时行情或收益有效性证据。
多证券插件可选择另附的 synthetic-panel-test.csv；这是合成测试数据，仅用于查看功能和核对计算。
财务/事件功能的对应合成样本见 synthetic-fundamental-tests；每个文件仅包含同名功能需要的字段。
逐笔与盘口插件选择 synthetic-events-test.csv；合成成交和盘口只用于公式验算，不是实际行情。
统计单证券模型可先选 historical-first1000-statistical.csv；ARX/VAR/协整选择 synthetic-econometric-panel.csv（合成验算数据）。
深度学习中的LSTM/Transformer也可先用这份1000根历史样本；GCN选择synthetic-econometric-panel.csv，并明确研究证券代码。
组合权益风险选择synthetic-portfolio-equity.csv（合成费用/出入金账本）；风险预算组合选择synthetic-econometric-panel.csv。
补充指标中的盘中同时刻相对量选择synthetic-intraday-sessions.csv（合成会话分钟线），字段见SESSION_EXECUTION.txt。
因子合成插件中PCA选择historical-fixture.csv；截面评分及排名组合选择synthetic-factor-panel.csv，公式见FACTOR_MODELS.txt。
Technical Ratings v3条件插件可选historical-fixture.csv；它使用明确的本地数值口径，尚未验证与TradingView网站逐点一致。
外部研究数据插件选择synthetic-observation-tests内对应功能文件；均为合成数据，演示发布/修订/撤回，非供应商公式复现。
收缩与确认形态插件可选择historical-fixture.csv；候选只在拐点确认时出现，含每段比例与规则审计，见PATTERN_RESEARCH.txt。
筹码成本假设模型选择synthetic-cost-model.csv，含合成自由流通股和重置数据；可查看历史摘要与末端成本直方图，非真实股东账本。
历史涨跌停/封板插件选择synthetic-limit-tests内同名功能文件；日线统计与完整事件状态分开，输入含合成历史限制价，见LIMIT_RESEARCH.txt。
欧式期权研究选择synthetic-option-chain.csv；可查看指定合约IV、25Delta偏斜和到期排名的ATM/PCR，报价为合成验证数据，见OPTION_RESEARCH.txt。
Hikyuu选择historical-hikyuu-first500.csv：原样本前500根保留实际amount；完整旧样本有两根量额状态矛盾，会被拒绝。
0.26.0已修复Hikyuu日期单位并加入逐日账本核对，旧版本Hikyuu结果需重跑，见HIKYUU_ADAPTER.txt。

本预览使用本目录内独立data，不修改原安装版的账户与数据库。
移动整个目录后，需要把stock-data-root.json的directory更新到移动后的data绝对路径。
插件窗口支持安装、停用、卸载、运行、取消、历史重开及.wsresult结果包导出/导入。
卸载保留公共行情库、历史与版本缓存；结果导入不会执行其代码。指标和回测直接选择已保存行情，运行时冻结来源、参数、版本及输入哈希。

本机首版的19项目适配入口、110类目录和33个插件包已经交付；具体功能与验收范围见QUICK_START.txt。
7类是来源接口，当前AKShare在线代理连接失败，第二台机器未验收；这些限制不计为已通过。
'@
[IO.File]::WriteAllText((Join-Path $taskRelease '开始阅读.txt'),$taskReadme,[Text.UTF8Encoding]::new($false))
$taskRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\THIRD_PARTY_NOTICES.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\implementation-plan.json') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\README.txt') -Destination (Join-Path $taskRelease 'plugin-readme.txt')
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\QUICK_START.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\indicator-scope.json') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\evidence\verification.json') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\TEMPORAL_FORMULAS.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\PANEL_INPUT.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\FUNDAMENTAL_INPUT.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\EVENT_INPUT.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\LEARNING_MODELS.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\STATISTICAL_MODELS.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\DEEP_MODELS.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\PORTFOLIO_RISK.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\SESSION_EXECUTION.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\FACTOR_MODELS.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\TECHNICAL_RATINGS.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\OBSERVATION_INPUT.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\PATTERN_RESEARCH.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\COST_DISTRIBUTION.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\LIMIT_RESEARCH.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\OPTION_RESEARCH.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\HIKYUU_ADAPTER.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\MPL-2.0.txt') -Destination $taskRelease
$taskSetup = Join-Path $taskRelease 'runtime-setup'
New-Item -ItemType Directory -Path $taskSetup | Out-Null
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\setup_runtime.py') -Destination $taskSetup
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\setup_lean_runtime.py') -Destination $taskSetup
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\runtime') -Destination (Join-Path $taskSetup 'runtime') -Recurse
$taskMetadata = @{schema='webstock.plugin.preview.v1';programSha256=(Get-FileHash -LiteralPath $taskProgram -Algorithm SHA256).Hash;
    createdAt=[DateTime]::UtcNow.ToString('o');dataRoot=$taskData;runtimeScope='current-machine configured external environments';
    goalComplete=((Get-Content -LiteralPath (Join-Path $taskRepo 'quant\plugins\implementation-plan.json') -Raw | ConvertFrom-Json).goalStatus -eq 'complete');sourceBranch='codex/quant-plugin-platform'} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $taskRelease 'preview.json'),$taskMetadata,[Text.UTF8Encoding]::new($false))
$taskPriorQtPlatform = $env:QT_QPA_PLATFORM
try {
    # The deployed desktop preview contains qwindows, not the test-only
    # offscreen platform. Do not inherit an offscreen test-shell setting.
    $env:QT_QPA_PLATFORM = 'windows'
    & $taskProgram --check-data-root | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Preview data-root verification failed.' }
} finally {
    if ($null -eq $taskPriorQtPlatform) { Remove-Item Env:QT_QPA_PLATFORM -ErrorAction SilentlyContinue }
    else { $env:QT_QPA_PLATFORM = $taskPriorQtPlatform }
}
Write-Output $taskRelease
