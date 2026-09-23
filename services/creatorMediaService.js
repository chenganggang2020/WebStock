const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');

function archiveRoot() {
  const workspace = process.env.WEBSTOCK_QUANT_WORKSPACE || path.join(__dirname, '..', 'quant', 'workspace');
  return path.resolve(path.dirname(workspace), 'media-library', 'douyin');
}
function resolveVideo(observation, root = archiveRoot()) {
  const id = String(observation.externalContentId || '');
  const filename = observation.localAssetPath || ((observation.mediaMetadata || {}).archive || {}).localAssetPath;
  if (!/^\d{12,24}$/.test(id) || !filename || path.basename(filename) !== id + '.mp4') throw new Error('此视频尚无可验证的本地归档');
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(filename);
  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(realFile).isFile()) throw new Error('媒体不在允许的归档目录');
  return realFile;
}
function allowedCoverUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['douyinpic.com', 'byteimg.com', 'ibytedtos.com', 'douyin.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch (_) { return false; }
}
function resolveNoteImage(observation, index, root = archiveRoot()) {
  const id=String(observation.externalContentId||'');
  const author=String(observation.channelId||'');
  if (observation.mediaType!=='note'||!/^\d{12,24}$/.test(id)||!/^[1-9]\d{0,9}$/.test(author)||
      !/^\d{1,2}$/.test(String(index))) throw new Error('图文页面无效');
  const page=((observation.mediaMetadata||{}).note||{}).pages?.find(page=>page.index===Number(index));
  const extension=page&&{'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[page.mimeType];
  if (!page||!extension||!/^[a-f0-9]{64}$/.test(page.sha256||'')) throw new Error('图片尚未归档');
  const expected=path.join(root,'notes',author,id,String(index).padStart(3,'0')+'-'+page.sha256+'.'+extension);
  if (path.resolve(page.localAssetPath||'')!==path.resolve(expected)) throw new Error('图片不属于当前作品');
  const realRoot=fs.realpathSync(root), realFile=fs.realpathSync(expected);
  const relative=path.relative(realRoot,realFile);
  if (relative.startsWith('..')||path.isAbsolute(relative)||!fs.statSync(realFile).isFile()) throw new Error('图片不在归档目录');
  return {filename:realFile,type:page.mimeType};
}
function imageType(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('封面不是支持的静态图片');
}
const coverTasks = new Map();
async function getCover(observation) {
  const id = String(observation.externalContentId || '');
  if (!/^\d{12,24}$/.test(id)) throw new Error('视频 ID 无效');
  const root = path.join(archiveRoot(), 'covers');
  const filename = path.join(root, id + '.cover');
  if (fs.existsSync(filename)) return { filename, type: imageType(fs.readFileSync(filename)), source: '本地封面缓存' };
  if (coverTasks.has(filename)) return coverTasks.get(filename);
  const task = (async function() {
    const url = (observation.mediaMetadata || {}).coverUrl;
    if (!allowedCoverUrl(url)) throw new Error('尚未采集到有效封面，请补采视频详情');
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000,
      maxContentLength: 2 * 1024 * 1024, maxRedirects: 0 });
    const buffer = Buffer.from(response.data);
    const type = imageType(buffer);
    fs.mkdirSync(root, { recursive: true });
    const temp = filename + '-' + crypto.randomBytes(6).toString('hex') + '.part';
    try { fs.writeFileSync(temp, buffer, { flag: 'wx' }); fs.renameSync(temp, filename); }
    finally { fs.rmSync(temp, { force: true }); }
    return { filename, type, source: '平台封面' };
  })();
  coverTasks.set(filename, task);
  try { return await task; } finally { coverTasks.delete(filename); }
}

module.exports = { archiveRoot, resolveVideo, resolveNoteImage, allowedCoverUrl, getCover, imageType };
