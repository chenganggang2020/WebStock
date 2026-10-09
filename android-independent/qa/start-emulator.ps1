$ErrorActionPreference='Stop'
$sdkRoot='D:/WebStockAndroidTools/android-sdk'
$avdRoot='D:/WebStockAndroidTools/avd'
$avdFolder=Join-Path $avdRoot 'WebStockIndependent.avd'
$env:ANDROID_HOME=$sdkRoot
$env:ANDROID_AVD_HOME=$avdRoot
New-Item -ItemType Directory -Path $avdFolder -Force | Out-Null
$avdConfig=@'
AvdId=WebStockIndependent
PlayStore.enabled=false
abi.type=x86_64
avd.ini.displayname=WebStockIndependent
disk.dataPartition.size=2G
fastboot.forceColdBoot=yes
fastboot.forceFastBoot=no
hw.accelerometer=yes
hw.audioInput=no
hw.cpu.arch=x86_64
hw.cpu.ncore=4
hw.device.manufacturer=Google
hw.device.name=pixel_7
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader
hw.lcd.density=420
hw.lcd.height=2400
hw.lcd.width=1080
hw.mainKeys=no
hw.ramSize=4096
image.sysdir.1=system-images/android-36/google_apis/x86_64/
runtime.network.speed=full
runtime.network.latency=none
sdcard.size=512M
showDeviceFrame=no
tag.id=google_apis
target=android-36
vm.heapSize=512
'@
[IO.File]::WriteAllText((Join-Path $avdFolder 'config.ini'),$avdConfig)
[IO.File]::WriteAllText((Join-Path $avdRoot 'WebStockIndependent.ini'),"avd.ini.encoding=UTF-8`npath=$avdFolder`ntarget=android-36`n")
$emulator=Start-Process -FilePath (Join-Path $sdkRoot 'emulator/emulator.exe') -ArgumentList @('-avd','WebStockIndependent','-no-window','-no-audio','-no-snapshot','-no-boot-anim','-gpu','swiftshader','-feature','-Vulkan','-port','5556') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'emulator.log') -RedirectStandardError (Join-Path $PSScriptRoot 'emulator-error.log')
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'emulator.pid'),[string]$emulator.Id)
Write-Output ('Headless QA emulator started: '+$emulator.Id)
