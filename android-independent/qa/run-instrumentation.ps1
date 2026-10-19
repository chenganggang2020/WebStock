param([ValidateSet('seed220','upgrade230','offline230')][string]$Mode='upgrade230')
$ErrorActionPreference='Stop'
$adb='D:/WebStockAndroidTools/android-sdk/platform-tools/adb.exe'
$serial='emulator-5558'
$avdName=(& $adb -s $serial emu avd name | Select-Object -First 1).Trim()
if($avdName -ne 'WebStockUX20261005'){throw "Refusing to modify an unexpected emulator: $avdName"}
$ready=(& $adb -s $serial shell getprop sys.boot_completed).Trim()
if($ready -ne '1'){throw 'Isolated emulator has not completed Android startup'}
if($Mode -eq 'offline230'){
  & $adb -s $serial shell cmd connectivity airplane-mode enable
  & $adb -s $serial shell svc wifi disable
}else{
  & $adb -s $serial shell cmd connectivity airplane-mode disable
  & $adb -s $serial shell svc wifi enable
}
& $adb -s $serial shell am force-stop com.webstock.companion
$log=Join-Path $PSScriptRoot ('android-'+$Mode+'.log')
$result=& $adb -s $serial shell am instrument -w -e mode $Mode com.webstock.companion.test/com.webstock.companion.StandaloneSmokeInstrumentation 2>&1
$result | Set-Content -LiteralPath $log -Encoding utf8
$result | Write-Output
if($LASTEXITCODE -ne 0 -or !($result -match '^INSTRUMENTATION_CODE: -1$')){throw "Instrumentation did not return RESULT_OK; see $log"}
if($Mode -ne 'seed220'){
  $line=$result | Where-Object {$_ -like 'INSTRUMENTATION_RESULT: summary={*'} | Select-Object -Last 1
  if(!$line){throw "Missing result summary: $log"}
  $json=$line.Substring('INSTRUMENTATION_RESULT: summary='.Length)
  $summary=$json | ConvertFrom-Json
  $json | Set-Content -LiteralPath (Join-Path $PSScriptRoot ('android-'+$Mode+'.json')) -Encoding utf8
  foreach($name in @('minute','kline','landscape','account-stats','account-ledger','etf')){
    & $adb -s $serial pull ('/sdcard/Android/data/com.webstock.companion/files/'+$Mode+'-'+$name+'.png') (Join-Path $PSScriptRoot ($Mode+'-'+$name+'.png'))
    if($LASTEXITCODE -ne 0){throw "Cannot retrieve fresh $name screenshot"}
  }
  if($summary.pass -ne $summary.total){throw "Instrumentation checks failed: $($summary.pass)/$($summary.total)"}
}
