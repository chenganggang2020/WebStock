const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sourcePngPath = path.join(root, 'WebStock.png');
const iconsDir = path.join(root, 'icons');
const png192Path = path.join(iconsDir, 'webstock-192.png');
const png512Path = path.join(iconsDir, 'webstock-512.png');
const icoPath = path.join(iconsDir, 'webstock.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function psString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function renderSquarePng(size, outputPath) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    '$source = [System.Drawing.Image]::FromFile(' + psString(sourcePngPath) + ')',
    '$canvas = New-Object System.Drawing.Bitmap ' + size + ', ' + size,
    '$graphics = [System.Drawing.Graphics]::FromImage($canvas)',
    '$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
    '$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '$graphics.Clear([System.Drawing.Color]::White)',
    '$scale = [Math]::Min(' + size + ' / $source.Width, ' + size + ' / $source.Height)',
    '$w = [int][Math]::Round($source.Width * $scale)',
    '$h = [int][Math]::Round($source.Height * $scale)',
    '$x = [int]((' + size + ' - $w) / 2)',
    '$y = [int]((' + size + ' - $h) / 2)',
    '$graphics.DrawImage($source, $x, $y, $w, $h)',
    '$canvas.Save(' + psString(outputPath) + ', [System.Drawing.Imaging.ImageFormat]::Png)',
    '$graphics.Dispose()',
    '$canvas.Dispose()',
    '$source.Dispose()'
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit'
  });
}

fs.mkdirSync(iconsDir, { recursive: true });
renderSquarePng(192, png192Path);
renderSquarePng(512, png512Path);

const entries = sizes.map(size => {
  const tmpPath = path.join(iconsDir, 'webstock-' + size + '.tmp.png');
  renderSquarePng(size, tmpPath);
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
