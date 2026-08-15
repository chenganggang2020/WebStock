param(
  [string]$ToolRoot = "D:\WebStockAndroidTools"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AndroidRoot = Join-Path $ProjectRoot "android"
$ToolchainConfig = Join-Path $ToolRoot "toolchain.json"

if (-not (Test-Path -LiteralPath $ToolchainConfig)) {
  & (Join-Path $PSScriptRoot "install-android-toolchain.ps1") -ToolRoot $ToolRoot
  if ($LASTEXITCODE -ne 0) { throw "Android toolchain installation failed" }
}
$Toolchain = Get-Content -LiteralPath $ToolchainConfig -Raw | ConvertFrom-Json
$env:JAVA_HOME = $Toolchain.javaHome
$env:ANDROID_HOME = $Toolchain.sdkRoot
$env:ANDROID_SDK_ROOT = $Toolchain.sdkRoot

$UserDataRoot = if ($env:APPDATA) { $env:APPDATA } else { $HOME }
$SigningRoot = Join-Path $UserDataRoot "WebStock\android-signing"
$SigningConfigPath = Join-Path $SigningRoot "signing.json"
$KeystorePath = Join-Path $SigningRoot "webstock-release.jks"
New-Item -ItemType Directory -Force -Path $SigningRoot | Out-Null

function New-SigningSecret {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

if (Test-Path -LiteralPath $SigningConfigPath) {
  $Signing = Get-Content -LiteralPath $SigningConfigPath -Raw | ConvertFrom-Json
} else {
  $Signing = [ordered]@{
    alias = "webstock"
    storePassword = New-SigningSecret
    keyPassword = New-SigningSecret
  }
  $Signing | ConvertTo-Json | Set-Content -LiteralPath $SigningConfigPath -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $KeystorePath)) {
  $Keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
  & $Keytool -genkeypair -keystore $KeystorePath -storetype JKS -storepass $Signing.storePassword `
    -keypass $Signing.keyPassword -alias $Signing.alias -keyalg RSA -keysize 3072 -validity 10000 `
    -dname "CN=WebStock, OU=Personal, O=WebStock, L=Beijing, ST=Beijing, C=CN"
  if ($LASTEXITCODE -ne 0) { throw "Android release keystore generation failed" }
}

$env:WEBSTOCK_ANDROID_KEYSTORE = $KeystorePath
$env:WEBSTOCK_ANDROID_STORE_PASSWORD = $Signing.storePassword
$env:WEBSTOCK_ANDROID_KEY_PASSWORD = $Signing.keyPassword
$env:WEBSTOCK_ANDROID_KEY_ALIAS = $Signing.alias

$GradleWrapper = Join-Path $AndroidRoot "gradlew.bat"
Push-Location $AndroidRoot
try {
  & $GradleWrapper --no-daemon test assembleRelease
  if ($LASTEXITCODE -ne 0) { throw "Android tests or release build failed" }
} finally {
  Pop-Location
}

$ApkSource = Join-Path $AndroidRoot "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path -LiteralPath $ApkSource)) { throw "Release APK was not produced" }
$OutputRoot = Join-Path $ProjectRoot "dist\android"
$ApkOutput = Join-Path $OutputRoot "WebStock-Android-Companion-1.1.0.apk"
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Copy-Item -LiteralPath $ApkSource -Destination $ApkOutput -Force

$ApkSigner = Join-Path $env:ANDROID_SDK_ROOT "build-tools\36.0.0\apksigner.bat"
& $ApkSigner verify --verbose --print-certs $ApkOutput
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }
$Artifact = Get-Item -LiteralPath $ApkOutput
$Hash = (Get-FileHash -LiteralPath $ApkOutput -Algorithm SHA256).Hash
Write-Host "Android APK: $($Artifact.FullName)"
Write-Host "Size: $($Artifact.Length) bytes"
Write-Host "SHA256: $Hash"
