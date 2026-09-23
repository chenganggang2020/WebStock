param([int]$ProcessId,[string]$ExpectedPath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$identity=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
if(!$identity -or $identity.ExecutablePath -ne $ExpectedPath -or $identity.CommandLine -match '--type='){throw 'TARGET_IDENTITY_CHANGED'}
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public static class RuntimeSnapshot {
 public delegate bool Callback(IntPtr window,IntPtr param);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr param);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
 [DllImport("advapi32.dll",SetLastError=true)] public static extern IntPtr OpenThreadWaitChainSession(uint flags,IntPtr callback);
 [DllImport("advapi32.dll",SetLastError=true)] public static extern bool GetThreadWaitChain(IntPtr session,IntPtr context,uint flags,uint thread,ref uint count,IntPtr nodes,out bool cycle);
 [DllImport("advapi32.dll")] public static extern void CloseThreadWaitChainSession(IntPtr session);
 public static object[] Windows(uint target){var result=new List<object>();EnumWindows((w,p)=>{uint id;uint thread=GetWindowThreadProcessId(w,out id);if(id==target)result.Add(new{handle=w.ToInt64(),thread,visible=IsWindowVisible(w),enabled=IsWindowEnabled(w)});return true;},IntPtr.Zero);return result.ToArray();}
}
'@
$process=Get-Process -Id $ProcessId
$session=[RuntimeSnapshot]::OpenThreadWaitChainSession(0,[IntPtr]::Zero)
if($session -eq [IntPtr]::Zero){throw 'WCT_SESSION_FAILED'}
$buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(280*16)
try {
 $threads=@(foreach($thread in ($process.Threads|Sort-Object StartTime|Select-Object -First 10)){
  [uint32]$count=16;[bool]$cycle=$false
  $ok=[RuntimeSnapshot]::GetThreadWaitChain($session,[IntPtr]::Zero,7,$thread.Id,[ref]$count,$buffer,[ref]$cycle)
  $errorCode=if($ok){0}else{[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
  $nodes=@(if($ok){for($i=0;$i -lt $count;$i++){
   $ptr=[IntPtr]::Add($buffer,$i*280);$type=[Runtime.InteropServices.Marshal]::ReadInt32($ptr)
   $node=@{type=$type;status=[Runtime.InteropServices.Marshal]::ReadInt32($ptr,4)}
   if($type -eq 8){$node.process=[Runtime.InteropServices.Marshal]::ReadInt32($ptr,8);$node.thread=[Runtime.InteropServices.Marshal]::ReadInt32($ptr,12)}
   $node
  }})
  @{thread=$thread.Id;state=[string]$thread.ThreadState;cpuSeconds=$thread.TotalProcessorTime.TotalSeconds;ok=$ok;error=$errorCode;cycle=$cycle;nodes=$nodes}
 })
 @{at=[DateTimeOffset]::Now.ToString('o');process=$ProcessId;executable=$identity.ExecutablePath;parent=$identity.ParentProcessId;responding=$process.Responding;cpuSeconds=$process.CPU;workingMB=[Math]::Round($process.WorkingSet64/1MB);windows=[RuntimeSnapshot]::Windows($ProcessId);threads=$threads}|ConvertTo-Json -Depth 7 -Compress
}finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer);[RuntimeSnapshot]::CloseThreadWaitChainSession($session)}
