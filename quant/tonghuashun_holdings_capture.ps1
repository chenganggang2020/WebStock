$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$taskBitmap=$null
$taskCrop=$null
$taskDirectory=$null
try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WebStockThsCaptureNative {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
}
'@
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
  [void][Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage, ContentType=WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
  [void][Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
  [void][Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime]

  function Await-Result($operation,[Type]$resultType) {
    $method=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1})[0]
    $task=$method.MakeGenericMethod($resultType).Invoke($null,@($operation))
    $task.Wait()
    return $task.Result
  }
  function Read-Ocr($imagePath,$engine) {
    $file=Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
    $stream=Await-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder=Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap=Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      try { return (Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])).Text }
      finally { $bitmap.Dispose() }
    } finally { $stream.Dispose() }
  }
  function Read-Cell($source,$x,$y,$width,$height,$name,$engine) {
    $rect=New-Object System.Drawing.Rectangle $x,$y,$width,$height
    $cell=$source.Clone($rect,$source.PixelFormat)
    $scaled=New-Object System.Drawing.Bitmap ($width*5),($height*5)
    try {
      $graphics=[System.Drawing.Graphics]::FromImage($scaled)
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($cell,0,0,$scaled.Width,$scaled.Height)
      } finally { $graphics.Dispose() }
      $imagePath=Join-Path $taskDirectory ($name+'.png')
      $scaled.Save($imagePath,[System.Drawing.Imaging.ImageFormat]::Png)
      return Read-Ocr $imagePath $engine
    } finally { $scaled.Dispose();$cell.Dispose() }
  }
  function Read-UiaText($window,$automationId) {
    $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$automationId)
    $element=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
    if($null -eq $element){return ''}
    return [string]$element.Current.Name
  }
  function Read-UiaTotalAssets($window) {
    foreach($label in @('总资产','总资产:','总资产：')){
      $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$label)
      $element=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
      if($null -eq $element){continue}
      $value=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetNextSibling($element)
      if($null -ne $value -and [string]$value.Current.Name -match '^\s*[\d,，]+(?:\.\d+)?\s*$'){return [string]$value.Current.Name}
    }
    return ''
  }
  function Has-UiaName($window,$name) {
    $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$name)
    return $null -ne $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
  }
  function Is-GrayLinePixel($color) {
    return [Math]::Abs($color.R-$color.G) -le 3 -and [Math]::Abs($color.G-$color.B) -le 3 -and $color.R -ge 205 -and $color.R -le 245
  }
  function Collapse-Lines($values) {
    $collapsed=@();$cluster=@()
    foreach($value in $values){
      if($cluster.Count -eq 0 -or $value-$cluster[-1] -le 2){$cluster+=,$value;continue}
      $collapsed+=,[int][Math]::Round(($cluster|Measure-Object -Average).Average);$cluster=@($value)
    }
    if($cluster.Count -gt 0){$collapsed+=,[int][Math]::Round(($cluster|Measure-Object -Average).Average)}
    return $collapsed
  }

  $process=Get-Process -Name xiadan -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0}|Select-Object -First 1
  if($null -eq $process){throw 'THS_WINDOW_NOT_FOUND'}
  $mainHandle=[IntPtr]$process.MainWindowHandle
  $window=[System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
  if(-not (Has-UiaName $window '可用金额') -or -not (Has-UiaName $window '股票市值')){throw 'THS_HOLDING_PAGE_NOT_SELECTED'}

  $script:gridHandles=New-Object System.Collections.Generic.List[System.IntPtr]
  $callback=[WebStockThsCaptureNative+EnumWindowsProc]{param($handle,$parameter)
    $builder=New-Object System.Text.StringBuilder 256
    [void][WebStockThsCaptureNative]::GetClassName($handle,$builder,$builder.Capacity)
    if($builder.ToString() -eq 'CVirtualGridCtrl'){$script:gridHandles.Add($handle)}
    return $true
  }
  [void][WebStockThsCaptureNative]::EnumChildWindows($mainHandle,$callback,[IntPtr]::Zero)
  $gridHandle=[IntPtr]::Zero;$gridRect=New-Object WebStockThsCaptureNative+RECT;$largestArea=0
  foreach($candidate in $gridHandles){
    $candidateRect=New-Object WebStockThsCaptureNative+RECT
    if(-not [WebStockThsCaptureNative]::GetWindowRect($candidate,[ref]$candidateRect)){continue}
    $candidateWidth=$candidateRect.Right-$candidateRect.Left;$candidateHeight=$candidateRect.Bottom-$candidateRect.Top;$area=$candidateWidth*$candidateHeight
    if($candidateWidth -gt 500 -and $candidateHeight -gt 150 -and $area -gt $largestArea){$gridHandle=$candidate;$gridRect=$candidateRect;$largestArea=$area}
  }
  if($gridHandle -eq [IntPtr]::Zero){throw 'THS_GRID_NOT_FOUND'}
  $gridElement=[System.Windows.Automation.AutomationElement]::FromHandle($gridHandle)
  $gridPattern=$null
  if(-not $gridElement.Current.IsOffscreen -and $gridElement.TryGetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern,[ref]$gridPattern) -and $gridPattern.Current.RowCount -eq 0){
    # A failed OCR read is not empty-grid evidence. Only an explicit native zero-row grid may use this path.
    $emptySummary=[pscustomobject]@{cashBalance=(Read-UiaText $window '1016');displayedMarketValue=(Read-UiaText $window '1014');displayedTotalAssets=(Read-UiaTotalAssets $window)}
    $emptyGridConfirmed=$gridPattern.Current.RowCount -eq 0
    [pscustomobject]@{available=$true;observedAt=[DateTime]::UtcNow.ToString('o');cashBalance=$emptySummary.cashBalance;displayedMarketValue=$emptySummary.displayedMarketValue;displayedTotalAssets=$emptySummary.displayedTotalAssets;visibleRowsComplete=$emptyGridConfirmed;emptyHoldingsConfirmed=$emptyGridConfirmed;rows=@()}|ConvertTo-Json -Depth 5 -Compress
    return
  }
  $mainRect=New-Object WebStockThsCaptureNative+RECT
  if(-not [WebStockThsCaptureNative]::GetWindowRect($mainHandle,[ref]$mainRect)){throw 'THS_CAPTURE_FAILED'}
  $mainWidth=$mainRect.Right-$mainRect.Left;$mainHeight=$mainRect.Bottom-$mainRect.Top
  $taskBitmap=New-Object System.Drawing.Bitmap $mainWidth,$mainHeight
  $graphics=[System.Drawing.Graphics]::FromImage($taskBitmap);$hdc=$graphics.GetHdc()
  try { if(-not [WebStockThsCaptureNative]::PrintWindow($mainHandle,$hdc,2)){throw 'THS_CAPTURE_FAILED'} }
  finally { $graphics.ReleaseHdc($hdc);$graphics.Dispose() }
  $gridWidth=$gridRect.Right-$gridRect.Left;$gridHeight=$gridRect.Bottom-$gridRect.Top
  $gridX=$gridRect.Left-$mainRect.Left;$gridY=$gridRect.Top-$mainRect.Top
  $taskCrop=$taskBitmap.Clone((New-Object System.Drawing.Rectangle $gridX,$gridY,$gridWidth,$gridHeight),$taskBitmap.PixelFormat)

  $verticalCandidates=@()
  $verticalSampleHeight=[Math]::Min($gridHeight-32,330)
  for($x=0;$x -lt $gridWidth-12;$x++){$gray=0;for($y=0;$y -lt $verticalSampleHeight;$y++){if(Is-GrayLinePixel ($taskCrop.GetPixel($x,$y))){$gray++}};if($gray -gt $verticalSampleHeight*0.55){$verticalCandidates+=,$x}}
  $vertical=Collapse-Lines $verticalCandidates
  if($vertical.Count -lt 8){throw 'THS_GRID_LAYOUT_UNSUPPORTED'}
  $horizontalCandidates=@()
  for($y=20;$y -lt $gridHeight-14;$y++){$gray=0;for($x=0;$x -lt [Math]::Min($gridWidth-13,890);$x+=2){if(Is-GrayLinePixel ($taskCrop.GetPixel($x,$y))){$gray++}};if($gray -gt [Math]::Min($gridWidth-13,890)*0.35){$horizontalCandidates+=,$y}}
  $horizontal=Collapse-Lines $horizontalCandidates
  $differences=@();for($i=1;$i -lt $horizontal.Count;$i++){$difference=$horizontal[$i]-$horizontal[$i-1];if($difference -ge 22 -and $difference -le 36){$differences+=,$difference}}
  if($differences.Count -eq 0){throw 'THS_GRID_LAYOUT_UNSUPPORTED'}
  $rowHeight=[int](($differences|Group-Object|Sort-Object Count -Descending|Select-Object -First 1).Name)
  $rowStart=$horizontal[0]-$rowHeight+1
  if($rowStart -lt 0){$rowStart=0}

  $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US'))
  if($null -eq $engine){throw 'THS_OCR_UNAVAILABLE'}
  $taskDirectory=Join-Path ([System.IO.Path]::GetTempPath()) ('webstock-ths-ocr-'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $taskDirectory|Out-Null
  $rows=@();$started=$false;$visibleRowsComplete=$false
  for($row=0;$row -lt 20;$row++){
    $y=$rowStart+$row*$rowHeight
    if($y+$rowHeight-1 -ge $gridHeight-14){break}
    $code=Read-Cell $taskCrop $vertical[0] $y ($vertical[1]-$vertical[0]+1) ($rowHeight-1) ("r$row-code") $engine
    $codeDigits=$code -replace '\D',''
    if($codeDigits.Length -ne 6){if($started){$visibleRowsComplete=$true;break}else{continue}}
    $started=$true
    $quantity=Read-Cell $taskCrop ($vertical[2]-1) $y ($vertical[3]-$vertical[2]+1) ($rowHeight-1) ("r$row-quantity") $engine
    $avgCost=Read-Cell $taskCrop ($vertical[5]-1) $y ($vertical[6]-$vertical[5]+3) ($rowHeight-1) ("r$row-cost") $engine
    $currentPrice=Read-Cell $taskCrop ($vertical[6]+2) $y ($vertical[7]-$vertical[6]) ($rowHeight-1) ("r$row-price") $engine
    $rows+=,[pscustomobject]@{code=$code;quantity=$quantity;avgCost=$avgCost;currentPrice=$currentPrice}
  }
  [pscustomobject]@{available=$true;observedAt=[DateTime]::UtcNow.ToString('o');cashBalance=(Read-UiaText $window '1016');displayedMarketValue=(Read-UiaText $window '1014');displayedHoldingPnl=(Read-UiaText $window '1027');visibleRowsComplete=$visibleRowsComplete;rows=$rows}|ConvertTo-Json -Depth 5 -Compress
} catch {
  $code=[string]$_.Exception.Message
  if($code -notmatch '^THS_'){$code='THS_CAPTURE_FAILED'}
  [pscustomobject]@{available=$false;errorCode=$code}|ConvertTo-Json -Compress
} finally {
  if($null -ne $taskCrop){$taskCrop.Dispose()}
  if($null -ne $taskBitmap){$taskBitmap.Dispose()}
  if($taskDirectory -and (Test-Path -LiteralPath $taskDirectory)){Remove-Item -LiteralPath $taskDirectory -Recurse -Force -ErrorAction SilentlyContinue}
}

