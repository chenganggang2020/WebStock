const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const iconsDir = path.join(root, 'icons');
const png192Path = path.join(iconsDir, 'webstock-192.png');
const png512Path = path.join(iconsDir, 'webstock-512.png');
const icoPath = path.join(iconsDir, 'webstock.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function psString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function renderIconPng(size, outputPath) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    'Add-Type -AssemblyName System.Drawing',
    '$size = ' + size,
    '$out = ' + psString(outputPath),
    '$bmp = New-Object System.Drawing.Bitmap $size, $size',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
    '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '$g.Clear([System.Drawing.Color]::Transparent)',
    'function New-RoundRect($x,$y,$w,$h,$r){ $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $d = $r * 2; $p.AddArc($x,$y,$d,$d,180,90); $p.AddArc($x+$w-$d,$y,$d,$d,270,90); $p.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90); $p.AddArc($x,$y+$h-$d,$d,$d,90,90); $p.CloseFigure(); return $p }',
    '$pad = [int]($size * 0.07)',
    '$rect = New-RoundRect $pad $pad ($size - $pad * 2) ($size - $pad * 2) ([int]($size * 0.18))',
    '$bg1 = [System.Drawing.Color]::FromArgb(255, 10, 15, 24)',
    '$bg2 = [System.Drawing.Color]::FromArgb(255, 20, 30, 45)',
    '$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.RectangleF]::new($pad,$pad,$size-$pad*2,$size-$pad*2)), $bg2, $bg1, 45',
    '$g.FillPath($brush, $rect)',
    '$border = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 94, 234, 212)), ([Math]::Max(1.0, $size * 0.025))',
    '$g.DrawPath($border, $rect)',
    '$glow = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(95, 45, 212, 191)), ([Math]::Max(2.0, $size * 0.055))',
    '$line = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(235, 232, 255, 250)), ([Math]::Max(1.4, $size * 0.028))',
    '$line.StartCap = [System.Drawing.Drawing2D.LineCap]::Round',
    '$line.EndCap = [System.Drawing.Drawing2D.LineCap]::Round',
    '$line.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round',
    '$cx = $size / 2.0',
    '$cy = $size / 2.0',
    '$loopW = $size * 0.18',
    '$loopH = $size * 0.38',
    '$loopX = -$loopW / 2.0',
    '$loopY = -$loopH * 0.82',
    'for($i=0; $i -lt 6; $i++){ $state = $g.Save(); $g.TranslateTransform($cx,$cy); $g.RotateTransform($i * 60); $g.DrawEllipse($glow, [float]$loopX, [float]$loopY, [float]$loopW, [float]$loopH); $g.DrawEllipse($line, [float]$loopX, [float]$loopY, [float]$loopW, [float]$loopH); $g.Restore($state) }',
    '$dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 94, 234, 212))',
    '$g.FillEllipse($dotBrush, [float]($cx-$size*0.042), [float]($cy-$size*0.042), [float]($size*0.084), [float]($size*0.084))',
    '$chartPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 45, 212, 191)), ([Math]::Max(1.2, $size * 0.022))',
    '$chartPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round',
    '$chartPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round',
    '$pts = @(' +
      '([System.Drawing.PointF]::new($size*0.25,$size*0.69)),' +
      '([System.Drawing.PointF]::new($size*0.36,$size*0.63)),' +
      '([System.Drawing.PointF]::new($size*0.45,$size*0.66)),' +
      '([System.Drawing.PointF]::new($size*0.56,$size*0.55)),' +
      '([System.Drawing.PointF]::new($size*0.72,$size*0.49))' +
    ')',
    '$g.DrawLines($chartPen, $pts)',
    '$arrowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 45, 212, 191))',
    '$arrow = @(([System.Drawing.PointF]::new($size*0.72,$size*0.49)),([System.Drawing.PointF]::new($size*0.66,$size*0.49)),([System.Drawing.PointF]::new($size*0.71,$size*0.55)))',
    '$g.FillPolygon($arrowBrush, $arrow)',
    '$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$chartPen.Dispose(); $arrowBrush.Dispose(); $dotBrush.Dispose(); $glow.Dispose(); $line.Dispose(); $border.Dispose(); $brush.Dispose(); $rect.Dispose(); $g.Dispose(); $bmp.Dispose()'
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit'
  });
}

fs.mkdirSync(iconsDir, { recursive: true });
renderIconPng(192, png192Path);
renderIconPng(512, png512Path);

const entries = sizes.map(size => {
  const tmpPath = path.join(iconsDir, 'webstock-' + size + '.tmp.png');
  renderIconPng(size, tmpPath);
  const data = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);
  return { size, data };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);

let offset = header.length + entries.length * 16;
const dirBuffers = entries.map(entry => {
  const dir = Buffer.alloc(16);
  dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0);
  dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1);
  dir.writeUInt8(0, 2);
  dir.writeUInt8(0, 3);
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(entry.data.length, 8);
  dir.writeUInt32LE(offset, 12);
  offset += entry.data.length;
  return dir;
});

fs.writeFileSync(icoPath, Buffer.concat([header].concat(dirBuffers).concat(entries.map(entry => entry.data))));
console.log('Created ' + icoPath);
console.log('Created ' + png192Path);
console.log('Created ' + png512Path);
