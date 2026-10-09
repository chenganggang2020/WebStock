param([string]$ToolRoot='D:\WebStockAndroidTools')
$ErrorActionPreference='Stop'
$toolchain=Get-Content -LiteralPath (Join-Path $ToolRoot 'toolchain.json') -Raw | ConvertFrom-Json
$env:JAVA_HOME=$toolchain.javaHome
$env:ANDROID_HOME=$toolchain.sdkRoot
$env:ANDROID_SDK_ROOT=$toolchain.sdkRoot
$signingRoot=Join-Path $env:APPDATA 'WebStock\android-signing'
$signing=Get-Content -LiteralPath (Join-Path $signingRoot 'signing.json') -Raw | ConvertFrom-Json
$env:WEBSTOCK_ANDROID_KEYSTORE=Join-Path $signingRoot 'webstock-release.jks'
$env:WEBSTOCK_ANDROID_STORE_PASSWORD=$signing.storePassword
$env:WEBSTOCK_ANDROID_KEY_PASSWORD=$signing.keyPassword
$env:WEBSTOCK_ANDROID_KEY_ALIAS=$signing.alias
& node (Join-Path $PSScriptRoot 'prepare-web.cjs')
if($LASTEXITCODE -ne 0) {throw 'Frontend packaging failed'}
Push-Location (Join-Path $PSScriptRoot 'android')
try {
  & .\gradlew.bat --no-daemon test assembleRelease
  if($LASTEXITCODE -ne 0) {throw 'Android build or tests failed'}
} finally {Pop-Location}
$apk=Join-Path $PSScriptRoot 'WebStock-Android-Independent-2.2.0-20261003.apk'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'android\app\build\outputs\apk\release\app-release.apk') -Destination $apk -Force
& (Join-Path $toolchain.sdkRoot 'build-tools\36.0.0\apksigner.bat') verify --verbose --print-certs $apk
if($LASTEXITCODE -ne 0) {throw 'APK signature verification failed'}
Get-FileHash -LiteralPath $apk -Algorithm SHA256

