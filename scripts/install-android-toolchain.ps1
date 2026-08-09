param(
  [string]$ToolRoot = "D:\WebStockAndroidTools"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$JdkVersion = "17.0.20"
$CommandToolsVersion = "15859902"
$GradleVersion = "9.4.1"
$CommandToolsSha256 = "90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a"
$GradleSha256 = "2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb"
$WrapperJarSha256 = "55243ef57851f12b070ad14f7f5bb8302daceeebc5bce5ece5fa6edb23e1145c"

function Download-File([string]$Url, [string]$Destination) {
  if (Test-Path -LiteralPath $Destination) { return }
  Write-Host "Downloading $Url"
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
}

function Assert-Hash([string]$Path, [string]$Expected) {
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) {
    throw "SHA256 mismatch for $Path. Expected $Expected, got $actual"
  }
}

$ToolRoot = [IO.Path]::GetFullPath($ToolRoot)
$Downloads = Join-Path $ToolRoot "downloads"
$SdkRoot = Join-Path $ToolRoot "android-sdk"
$JdkExtractRoot = Join-Path $ToolRoot "jdk"
$GradleHome = Join-Path $ToolRoot "gradle-$GradleVersion"
New-Item -ItemType Directory -Force -Path $Downloads, $SdkRoot, $JdkExtractRoot | Out-Null

$JdkZip = Join-Path $Downloads "microsoft-jdk-$JdkVersion-windows-x64.zip"
$JdkChecksum = Join-Path $Downloads "microsoft-jdk-$JdkVersion-windows-x64.zip.sha256sum.txt"
Download-File "https://aka.ms/download-jdk/microsoft-jdk-$JdkVersion-windows-x64.zip" $JdkZip
Download-File "https://aka.ms/download-jdk/microsoft-jdk-$JdkVersion-windows-x64.zip.sha256sum.txt" $JdkChecksum
$ExpectedJdkHash = ((Get-Content -LiteralPath $JdkChecksum -Raw).Trim() -split '\s+')[0]
Assert-Hash $JdkZip $ExpectedJdkHash
if (-not (Get-ChildItem -LiteralPath $JdkExtractRoot -Recurse -Filter java.exe -ErrorAction SilentlyContinue | Select-Object -First 1)) {
  Expand-Archive -LiteralPath $JdkZip -DestinationPath $JdkExtractRoot
}
$JavaExe = Get-ChildItem -LiteralPath $JdkExtractRoot -Recurse -Filter java.exe |
  Where-Object { $_.FullName -match '[\\/]bin[\\/]java\.exe$' } | Select-Object -First 1
if (-not $JavaExe) { throw "Microsoft OpenJDK extraction did not contain bin\java.exe" }
$JavaHome = Split-Path -Parent (Split-Path -Parent $JavaExe.FullName)

$CommandToolsZip = Join-Path $Downloads "commandlinetools-win-${CommandToolsVersion}_latest.zip"
Download-File "https://dl.google.com/android/repository/commandlinetools-win-${CommandToolsVersion}_latest.zip" $CommandToolsZip
Assert-Hash $CommandToolsZip $CommandToolsSha256
$SdkManager = Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path -LiteralPath $SdkManager)) {
  $CommandToolsStage = Join-Path $ToolRoot "command-tools-stage"
  if (Test-Path -LiteralPath $CommandToolsStage) {
    $stageFull = [IO.Path]::GetFullPath($CommandToolsStage)
    if (-not $stageFull.StartsWith($ToolRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to clear command tools staging outside $ToolRoot"
    }
    Remove-Item -LiteralPath $stageFull -Recurse -Force
  }
  Expand-Archive -LiteralPath $CommandToolsZip -DestinationPath $CommandToolsStage
  $LatestRoot = Split-Path -Parent (Split-Path -Parent $SdkManager)
  New-Item -ItemType Directory -Force -Path $LatestRoot | Out-Null
  Copy-Item -Path (Join-Path $CommandToolsStage "cmdline-tools\*") -Destination $LatestRoot -Recurse -Force
  Remove-Item -LiteralPath $CommandToolsStage -Recurse -Force
}
if (-not (Test-Path -LiteralPath $SdkManager)) { throw "Android sdkmanager was not installed" }

$GradleZip = Join-Path $Downloads "gradle-$GradleVersion-bin.zip"
Download-File "https://services.gradle.org/distributions/gradle-$GradleVersion-bin.zip" $GradleZip
Assert-Hash $GradleZip $GradleSha256
if (-not (Test-Path -LiteralPath (Join-Path $GradleHome "bin\gradle.bat"))) {
  Expand-Archive -LiteralPath $GradleZip -DestinationPath $ToolRoot
}

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$LicenseInput = (1..100 | ForEach-Object { "y" }) -join "`n"
$LicenseInput | & $SdkManager --licenses | Out-Host
& $SdkManager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
if ($LASTEXITCODE -ne 0) { throw "Android SDK package installation failed" }

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AndroidRoot = Join-Path $ProjectRoot "android"
$GradleBat = Join-Path $GradleHome "bin\gradle.bat"
if (-not (Test-Path -LiteralPath (Join-Path $AndroidRoot "gradlew.bat"))) {
  & $GradleBat -p $AndroidRoot wrapper --gradle-version $GradleVersion --distribution-type bin
  if ($LASTEXITCODE -ne 0) { throw "Gradle wrapper generation failed" }
}
$WrapperJar = Join-Path $AndroidRoot "gradle\wrapper\gradle-wrapper.jar"
Assert-Hash $WrapperJar $WrapperJarSha256

$Config = [ordered]@{
  javaHome = $JavaHome
  sdkRoot = $SdkRoot
  gradleHome = $GradleHome
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$Config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ToolRoot "toolchain.json") -Encoding UTF8
Write-Host "Android toolchain ready at $ToolRoot"
