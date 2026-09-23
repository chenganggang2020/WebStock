const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const axios = require('axios');
const { isAllowedDouyinImageUrl } = require('../electron/douyinPageCapture');
const { archiveRoot, imageType } = require('./creatorMediaService');

function recognizeImage(filename) {
  if (process.platform !== 'win32') return Promise.reject(new Error('当前本地图片识别需要 Windows OCR'));
  const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = path.join(__dirname, '..', 'quant', 'douyin_note_ocr.ps1').replace('app.asar', 'app.asar.unpacked');
  return new Promise((resolve, reject) => execFile(executable,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', filename],
    {windowsHide:true, timeout:60000, maxBuffer:2*1024*1024, encoding:'utf8'}, (error, stdout) => {
      if (error) return reject(new Error(error.killed ? '图片识别超时，原图已保留' : 'Windows 图片识别失败，原图已保留'));
      try { resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/,''))); }
      catch (_) { reject(new Error('图片识别没有返回有效文本结果')); }
    }));
}

function createDouyinNoteService(options = {}) {
  const root = options.root || archiveRoot();
  const recognize = options.recognize || recognizeImage;
  const download = options.download || (async url => {
    const response = await axios.get(url, {responseType:'arraybuffer', timeout:20000,
      maxContentLength:16*1024*1024, maxRedirects:0});
    return Buffer.from(response.data);
  });
  async function processNote(input = {}) {
    const channelId = String(input.channelId || '');
    const contentId = String(input.contentId || '');
    if (!/^[1-9]\d{0,9}$/.test(channelId)) throw new Error('作者编号无效');
    if (!/^\d{12,24}$/.test(contentId)) throw new Error('作品编号无效');
    const images = Array.isArray(input.images) ? input.images : [];
    const imageCount = Math.max(images.length, Math.min(Math.floor(Number(input.imageCount) || 0),1000));
    if (!imageCount) throw new Error('尚未读取到当前图文的原图列表，请补采详情');
    const directory = path.join(root, 'notes', channelId, contentId);
    await fs.mkdir(directory, {recursive:true});
    const pages = [];
    const started = Date.now();
    for (let index=0; index<Math.min(imageCount,50); index++) {
      const page = {index:index+1, status:'error', text:''};
      try {
        if (Date.now()-started > 180000) throw new Error('本轮图文处理时间已达上限，可继续补采');
        const source = images[index];
        if (!source || !isAllowedDouyinImageUrl(source.url)) throw new Error('缺少有效原图地址');
        if (input.onProgress) input.onProgress({stage:'ocr', message:'正在识别图文第 '+(index+1)+' / '+imageCount+' 张'});
        const buffer = await download(source.url);
        if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 16*1024*1024) throw new Error('原图大小超出限制');
        const type = imageType(buffer);
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        const extension = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[type];
        const filename = path.join(directory, String(index+1).padStart(3,'0')+'-'+sha256+'.'+extension);
        // Content-addressed files preserve earlier originals if the remote page changes.
        const temporary=filename+'.'+crypto.randomBytes(6).toString('hex')+'.part';
        try {
          await fs.writeFile(temporary,buffer,{flag:'wx'});
          await fs.rename(temporary,filename);
        } finally { await fs.rm(temporary,{force:true}); }
        Object.assign(page,{localAssetPath:filename,sha256,bytes:buffer.length,mimeType:type});
        const recognized = await recognize(filename);
        page.rawText = String(recognized.text || '').trim().slice(0,100000);
        // Windows OCR inserts separators between Han words; only remove these artificial spaces.
        page.text = page.rawText.replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu,'');
        page.status = page.text ? 'recognized' : 'no_text';
      } catch (error) {
        page.message = String(error.message || error).replace(/https?:\/\/\S+/g,'[图片地址]').slice(0,400);
      }
      pages.push(page);
    }
    const complete = pages.length===imageCount && pages.every(page=>page.status!=='error');
    return {schemaVersion:1, engine:'windows-ocr', imageCount,pages,
      status:complete ? pages.some(page=>page.text) ? 'needs_review' : 'no_text' : 'partial',
      processedAt:new Date().toISOString()};
  }
  return {process:processNote};
}
module.exports = {createDouyinNoteService,recognizeImage};
