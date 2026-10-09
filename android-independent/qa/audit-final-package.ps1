$ErrorActionPreference='Stop'
$toolchain=Get-Content -LiteralPath 'D:\WebStockAndroidTools\toolchain.json' -Raw | ConvertFrom-Json
$env:JAVA_HOME=$toolchain.javaHome
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseRoot=Split-Path -Parent $PSScriptRoot
$apk=Join-Path $releaseRoot 'WebStock-Android-Independent-2.3.0-20261005.apk'
$auditPath=Join-Path $PSScriptRoot 'package-audit.json'
if((Test-Path -LiteralPath $auditPath) -and !(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package-audit-initial.json'))){Copy-Item -LiteralPath $auditPath -Destination (Join-Path $PSScriptRoot 'package-audit-initial.json')}
$manifest=Get-Content -LiteralPath (Join-Path $releaseRoot 'source-manifest.json') -Raw | ConvertFrom-Json
$baseline='D:\CodexData\CodexHome-Final\worktrees\runtime-lifecycle-cleanup\Webstock\android-independent'
$zip=[IO.Compression.ZipFile]::OpenRead($apk)
$sha=[Security.Cryptography.SHA256]::Create()
function StreamHash($stream){try{return [Convert]::ToHexString($sha.ComputeHash($stream)).ToLowerInvariant()}finally{$stream.Dispose()}}
try{
  $files=@(foreach($file in $manifest.files){
    $entry=$zip.GetEntry('assets/web/'+$file.path)
    $packagedHash=if($entry){StreamHash ($entry.Open())}else{''}
    $sourceHash=(Get-FileHash -LiteralPath (Join-Path $releaseRoot ('web/'+$file.path))).Hash.ToLowerInvariant()
    [pscustomobject]@{path=$file.path;sourceSha256=$sourceHash;manifestSha256=$file.sha256;apkSha256=$packagedHash;match=($sourceHash -eq $file.sha256 -and $packagedHash -eq $sourceHash)}
  })
  $extras=@($zip.Entries | Where-Object {$_.FullName.StartsWith('assets/web/') -and $_.Name -and $_.FullName.Substring(11) -notin $manifest.files.path} | ForEach-Object FullName)
  $suspicious=@($zip.Entries | Where-Object {$_.FullName -match '(?i)(\.db$|\.sqlite(?:3)?$|\.jks$|\.keystore$|(^|/)\.env($|\.)|signing\.json|androidTest|(^|/)qa/)'} | ForEach-Object FullName)
  $markers=@(foreach($entry in $zip.Entries | Where-Object {$_.FullName.StartsWith('assets/web/') -and $_.Name -match '\.(js|html|json)$'}){
    $reader=[IO.StreamReader]::new($entry.Open());try{$content=$reader.ReadToEnd()}finally{$reader.Dispose()}
    if($content -match 'StandaloneSmokeInstrumentation|window\.qaRequests|fixture\.invalid|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY'){ $entry.FullName }
  })
  $shared=@(foreach($file in $files | Where-Object path -Like 'shared/*'){
    $old=(Get-FileHash -LiteralPath (Join-Path $baseline ('web/'+$file.path))).Hash.ToLowerInvariant()
    [pscustomobject]@{path=$file.path;sha256=$file.sourceSha256;baselineSha256=$old;match=($old -eq $file.sourceSha256)}
  })
}finally{$zip.Dispose();$sha.Dispose()}
$sdk='D:\WebStockAndroidTools\android-sdk'
$signature=& (Join-Path $sdk 'build-tools\36.0.0\apksigner.bat') verify --verbose --print-certs $apk 2>&1
if($LASTEXITCODE -ne 0){throw 'Final APK signature verification failed'}
$signature | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'final-apk-signature.log')
$certificate=($signature | Select-String 'certificate SHA-256 digest: ([0-9a-f]+)').Matches.Groups[1].Value
$metadata=& (Join-Path $sdk 'build-tools\36.0.0\aapt.exe') dump badging $apk
if($LASTEXITCODE -ne 0){throw 'Cannot read APK metadata'}
$packageLine=$metadata | Where-Object {$_ -like 'package:*'} | Select-Object -First 1
$passed=($files.Count -eq 14 -and !($files | Where-Object {!$_.match}) -and $extras.Count -eq 0 -and $suspicious.Count -eq 0 -and $markers.Count -eq 0 -and !($shared | Where-Object {!$_.match}) -and $certificate -eq '06c8c9c72e5eda3691dfe91bf9af41fccafc9512fe78e840629ff95cb29161e4' -and $packageLine -match "versionCode='20261007' versionName='2.3.0'")
$audit=[ordered]@{checkedAt=[DateTime]::UtcNow.ToString('o');passed=$passed;apk=$apk;bytes=(Get-Item -LiteralPath $apk).Length;sha256=(Get-FileHash -LiteralPath $apk).Hash.ToLowerInvariant();packageMetadata=$packageLine;certificateSha256=$certificate;webFiles=$files;extraPackagedAssets=$extras;suspiciousArchivePaths=$suspicious;testOrPrivateKeyMarkerFiles=$markers;sharedModules=$shared;scope='APK signature, version, all 14 frontend hashes, shared model baseline identity, archive paths and plaintext fixture/private-key markers. Does not assert exhaustive secret scanning of binary DEX.'}
$audit | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $auditPath -Encoding utf8
if(!$passed){throw 'Final package audit failed; see package-audit.json'}
[pscustomobject]@{passed=$passed;sha256=$audit.sha256;bytes=$audit.bytes;webFiles=$files.Count} | ConvertTo-Json
