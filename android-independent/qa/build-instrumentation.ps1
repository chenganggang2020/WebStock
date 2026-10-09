param([string]$ToolRoot='D:\WebStockAndroidTools')
$ErrorActionPreference='Stop'
$toolchain=Get-Content -LiteralPath (Join-Path $ToolRoot 'toolchain.json') -Raw | ConvertFrom-Json
$env:JAVA_HOME=$toolchain.javaHome
$env:ANDROID_HOME=$toolchain.sdkRoot
$env:ANDROID_SDK_ROOT=$toolchain.sdkRoot
$signingRoot=Join-Path $env:APPDATA 'WebStock\android-signing'
$signing=Get-Content -LiteralPath (Join-Path $signingRoot 'signing.json') -Raw | ConvertFrom-Json
$env:WEBSTOCK_ANDROID_STORE_PASSWORD=$signing.storePassword
$env:WEBSTOCK_ANDROID_KEY_PASSWORD=$signing.keyPassword
Push-Location (Join-Path $PSScriptRoot '..\android')
try {
  & .\gradlew.bat --offline --no-daemon assembleDebugAndroidTest
  if($LASTEXITCODE -ne 0) {throw 'Instrumentation build failed'}
} finally {Pop-Location}
$unsigned=Join-Path $PSScriptRoot '..\android\app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
$signed=Join-Path $PSScriptRoot 'standalone-220-instrumentation.apk'
& (Join-Path $toolchain.sdkRoot 'build-tools\36.0.0\apksigner.bat') sign --ks (Join-Path $signingRoot 'webstock-release.jks') --ks-key-alias $signing.alias --ks-pass env:WEBSTOCK_ANDROID_STORE_PASSWORD --key-pass env:WEBSTOCK_ANDROID_KEY_PASSWORD --out $signed $unsigned
if($LASTEXITCODE -ne 0) {throw 'Instrumentation signing failed'}
& (Join-Path $toolchain.sdkRoot 'build-tools\36.0.0\apksigner.bat') verify $signed
if($LASTEXITCODE -ne 0) {throw 'Instrumentation verification failed'}
