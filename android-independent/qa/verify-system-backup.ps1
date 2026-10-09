$ErrorActionPreference='Stop'
$adb='D:/WebStockAndroidTools/android-sdk/platform-tools/adb.exe'
function Tap-Point([int]$x,[int]$y){& $adb -s emulator-5556 shell input tap $x $y | Out-Null;Start-Sleep -Milliseconds 300}
function Read-Screen([string]$name){& $adb -s emulator-5556 shell uiautomator dump /sdcard/backup-proof.xml | Out-Null;& $adb -s emulator-5556 pull /sdcard/backup-proof.xml (Join-Path $PSScriptRoot $name) 2>$null | Out-Null;[xml]$tree=Get-Content -LiteralPath (Join-Path $PSScriptRoot $name) -Raw;return $tree}
function Tap-Node($node){if(!$node){throw 'Expected Android picker control missing'};$match=[regex]::Match($node.bounds,'\[(\d+),(\d+)\]\[(\d+),(\d+)\]');if(!$match.Success){throw 'Invalid control coordinates'};Tap-Point ([int](($match.Groups[1].Value-as[int])+($match.Groups[3].Value-as[int]))/2) ([int](($match.Groups[2].Value-as[int])+($match.Groups[4].Value-as[int]))/2)}
function Export-Backup([string]$name){Tap-Point 300 1000;$picker=Read-Screen ($name+'-picker.xml');$title=$picker.SelectSingleNode('//node[@resource-id="android:id/title" and @class="android.widget.EditText"]').text;if($title -notmatch '^webstock-android-\d+\.json$'){throw 'Unexpected export filename'};Tap-Node ($picker.SelectSingleNode('//node[@resource-id="android:id/button1"]'));Start-Sleep -Milliseconds 400;& $adb -s emulator-5556 pull ("/sdcard/Download/"+$title) (Join-Path $PSScriptRoot ($name+'.json')) 2>$null | Out-Null;return $title}
& $adb -s emulator-5556 shell am start -n com.webstock.companion/.MainActivity | Out-Null
Start-Sleep -Seconds 1
Tap-Point 965 2210
Tap-Point 312 570
$filename=Export-Backup 'system-export-before'
Tap-Point 787 1000
$picker=Read-Screen 'system-import-picker.xml'
$fileTitle=$picker.SelectNodes('//node') | Where-Object {$_.text -eq $filename} | Select-Object -First 1
Tap-Node ($fileTitle.SelectSingleNode('ancestor::node[@resource-id="com.google.android.documentsui:id/item_root"][1]'))
$confirm=Read-Screen 'system-import-confirm.xml'
if(!$confirm.SelectSingleNode('//node[@text="确认操作"]')){throw 'Expected nontechnical confirmation missing'}
Tap-Node ($confirm.SelectSingleNode('//node[@resource-id="android:id/button1"]'))
Start-Sleep -Milliseconds 400
$afterFilename=Export-Backup 'system-export-after'
$before=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'system-export-before.json') -Raw | ConvertFrom-Json
$after=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'system-export-after.json') -Raw | ConvertFrom-Json
$result=[pscustomobject]@{NativePickerExport=$before.format -eq 'webstock-android-independent-v1';NativePickerImport=$before.docs[0].updatedAt -ne $after.docs[0].updatedAt;IdPreserved=$before.docs[0].id -eq $after.docs[0].id;NoDuplicateRecords=$before.docs.Count -eq $after.docs.Count -and $before.trades.Count -eq $after.trades.Count;ContainsAiKey=[bool]($after.PSObject.Properties.Name -contains 'key')}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'system-backup-result.json') -Encoding utf8
$result | ConvertTo-Json
if(!$result.NativePickerExport -or !$result.NativePickerImport -or !$result.IdPreserved -or !$result.NoDuplicateRecords -or $result.ContainsAiKey){throw 'Android system backup check failed'}
