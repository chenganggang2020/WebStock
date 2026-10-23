param(
    [Parameter(Mandatory=$true)][string]$BuildDirectory,
    [Parameter(Mandatory=$true)][string]$QtBin,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$PluginPackages,
    [Parameter(Mandatory=$true)][string]$ExistingPluginRoot,
    [Parameter(Mandatory=$true)][string]$PythonBase,
    [Parameter(Mandatory=$true)][string]$SampleCsv,
    [string]$PanelCsv,
    [string]$FundamentalExamples
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) { throw 'Destination exists; use a new preview directory.' }
$taskExe = Join-Path $BuildDirectory 'desktop\MarketNativeReview.exe'
if (-not (Test-Path -LiteralPath $taskExe)) { throw 'Build the full MarketNativeReview target first.' }
New-Item -ItemType Directory -Path $Destination | Out-Null
$taskRelease = (Resolve-Path -LiteralPath $Destination).Path
$taskProgram = Join-Path $taskRelease 'Stock.exe'
Copy-Item -LiteralPath $taskExe -Destination $taskProgram
Copy-Item -LiteralPath (Join-Path $BuildDirectory 'desktop\WebView2Loader.dll') -Destination $taskRelease
$taskDeploy = Join-Path $QtBin 'windeployqt.exe'
& $taskDeploy --release --no-translations $taskProgram *> (Join-Path $taskRelease 'qt-deployment.log')
if ($LASTEXITCODE -ne 0) { throw 'Qt deployment failed; inspect qt-deployment.log.' }
$taskData = Join-Path $taskRelease 'data'
New-Item -ItemType Directory -Path $taskData | Out-Null
& $PythonBase -c 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute("PRAGMA user_version=0"); db.close()' (Join-Path $taskData 'business-v1.sqlite')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated preview database.' }
Copy-Item -LiteralPath $ExistingPluginRoot -Destination (Join-Path $taskData 'quant-plugins') -Recurse
Copy-Item -LiteralPath $PluginPackages -Destination (Join-Path $taskRelease 'plugin-packages') -Recurse
Copy-Item -LiteralPath $SampleCsv -Destination (Join-Path $taskRelease 'historical-fixture.csv')
if ($PanelCsv) { Copy-Item -LiteralPath $PanelCsv -Destination (Join-Path $taskRelease 'synthetic-panel-test.csv') }
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

双击 Start-Stock.cmd。进入“研究 → 量化研究 → 量化插件”。
插件包已安装；具体数量与功能见plugin-packages/index.json及implementation-plan.json。
运行环境使用本机此前准备好的隔离环境；本目录尚不是可在另一台机器直接运行的完整安装器。
可选择 historical-fixture.csv 运行；这是公开仓库的旧股票样本，不是实时行情或收益有效性证据。
多证券插件可选择另附的 synthetic-panel-test.csv；这是合成测试数据，仅用于查看功能和核对计算。
财务/事件功能的对应合成样本见 synthetic-fundamental-tests；每个文件仅包含同名功能需要的字段。

本预览使用本目录内独立data，不修改原安装版的账户与数据库。
移动整个目录后，需要把stock-data-root.json的directory更新到移动后的data绝对路径。
插件窗口支持安装、停用、卸载、运行、取消、历史重开及.wsresult结果包导出/导入。
卸载保留历史与版本缓存；结果导入不会执行其代码。

全部19项目、110类目录的目标仍在实施。此版本是已验证的第一批可运行交付，不是全部完成。
新插件会继续沿用同一安装接口。
'@
[IO.File]::WriteAllText((Join-Path $taskRelease '开始阅读.txt'),$taskReadme,[Text.UTF8Encoding]::new($false))
$taskRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\THIRD_PARTY_NOTICES.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\implementation-plan.json') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\README.txt') -Destination (Join-Path $taskRelease 'plugin-readme.txt')
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\TEMPORAL_FORMULAS.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\PANEL_INPUT.txt') -Destination $taskRelease
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\FUNDAMENTAL_INPUT.txt') -Destination $taskRelease
$taskSetup = Join-Path $taskRelease 'runtime-setup'
New-Item -ItemType Directory -Path $taskSetup | Out-Null
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\setup_runtime.py') -Destination $taskSetup
Copy-Item -LiteralPath (Join-Path $taskRepo 'quant\plugins\runtime') -Destination (Join-Path $taskSetup 'runtime') -Recurse
$taskMetadata = @{schema='webstock.plugin.preview.v1';programSha256=(Get-FileHash -LiteralPath $taskProgram -Algorithm SHA256).Hash;
    createdAt=[DateTime]::UtcNow.ToString('o');dataRoot=$taskData;runtimeScope='current-machine configured external environments';
    goalComplete=$false;sourceBranch='codex/quant-plugin-platform'} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $taskRelease 'preview.json'),$taskMetadata,[Text.UTF8Encoding]::new($false))
& $taskProgram --check-data-root | Out-String
if ($LASTEXITCODE -ne 0) { throw 'Preview data-root verification failed.' }
Write-Output $taskRelease
