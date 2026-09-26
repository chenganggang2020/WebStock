const path = require('node:path');
const media = require('../services/creatorMediaService');

async function runDouyinVideoTask(deps, channelId, observationId, stage, onProgress = () => {}, settings = {}) {
  if (!['capture', 'archive', 'transcribe', 'comments'].includes(stage)) throw new Error('不支持的单视频操作');
  if (settings.model && !['small','large-v3-turbo','large-v3'].includes(settings.model)) throw new Error('不支持的本地转写模型');
  const channel = deps.channels.getChannel(channelId);
  let observation = deps.channels.getObservation(channelId, observationId);
  const contentId = String(observation.externalContentId || '');
  const sourceUrl = new URL(observation.sourceUrl);
  const isNote = observation.mediaType === 'note' && sourceUrl.pathname.replace(/\/$/,'') === '/note/' + contentId;
  if (channel.platform !== 'douyin' || sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'www.douyin.com' ||
      !/^\d{12,24}$/.test(contentId) || (!isNote && sourceUrl.pathname.replace(/\/$/, '') !== '/video/' + contentId)) {
    throw new Error('单视频任务必须使用当前作者的抖音视频直链');
  }
  let mediaUrl = '';
  let noteItem = null;
  let local = false;
  let transcriptionStatus = 'not_requested';
  const mediaRoot = deps.mediaRoot || media.archiveRoot();
  if (observation.evidenceLevel === 'primary' && ['archive','transcribe'].includes(stage)) {
    try {
      if (isNote) {
        const note = (observation.mediaMetadata || {}).note || {};
        if (Number.isInteger(note.imageCount) && note.imageCount > 0 && note.imageCount <= 50 &&
            Array.isArray(note.pages) && note.pages.length === note.imageCount) {
          for (let index=1; index<=note.imageCount; index++) media.resolveNoteImage(observation,index,mediaRoot);
          noteItem = {localPages:note.pages,imageCount:note.imageCount};
          local = true;
        }
      } else {
        media.resolveVideo(observation,mediaRoot);
        // The transcriber reuses this exact canonical archive, not an arbitrary saved path.
        const filename = observation.localAssetPath || ((observation.mediaMetadata || {}).archive || {}).localAssetPath;
        local = path.resolve(filename) === path.resolve(mediaRoot,contentId+'.mp4');
      }
    } catch (_) { /* Missing or moved assets must be recaptured, not treated as available. */ }
  }
  if (!local) {
    onProgress({ stage: 'capture', message: '正在采集所选视频详情与可见评论' });
    const capture = await deps.sessionManager.captureUrl(observation.sourceUrl, { preferMediaUrl: stage === 'archive' || stage === 'transcribe' });
    const current = (capture.items || []).find(item => String(item.contentId) === contentId);
    if (!capture.loggedIn || !current || !deps.sources.verifyCapturedIdentity(channelId, capture).matched) {
      throw new Error('详情未加载、登录失效或作者身份不匹配，未保存');
    }
    mediaUrl = current.mediaUrl || '';
    noteItem = current;
    const persisted = Object.assign({}, current);
    delete persisted.mediaUrl;
    delete persisted.mediaCandidates;
    const safeCapture = Object.assign({}, capture, { items: [persisted] });
    delete safeCapture.mediaUrl;
    delete safeCapture.mediaCandidates;
    await (deps.sources.importCapturedPageAsync || deps.sources.importCapturedPage)(channelId, safeCapture);
    observation = deps.channels.getObservation(channelId, observationId);
  }
  if (isNote && stage !== 'comments') {
    if (!deps.noteProcessor) throw new Error('图文识别服务尚未启动');
    const result = await deps.noteProcessor.process({channelId,contentId,images:noteItem.images,
      localPages:noteItem.localPages,imageCount:noteItem.imageCount,onProgress});
    deps.sources.applyNoteResult(channelId,contentId,result);
    if (result.status === 'partial') throw new Error('部分图片未完成识别，已取得的原图与文字已保存，可重试');
    transcriptionStatus = result.status === 'no_text' ? 'no_text' : 'ocr_complete';
  } else if (stage === 'transcribe' || stage === 'archive') {
    if (!deps.transcriber) throw new Error('转写与归档服务尚未启动');
    const input = { contentId, mediaUrl, prompt: observation.title,
      model:settings.model, provider:settings.model ? 'local' : undefined,
      durationSeconds:Number(observation.mediaMetadata && observation.mediaMetadata.durationSeconds || 0),
      onArchived(result) { deps.sources.applyMediaArchive(channelId, contentId, result); }, onProgress };
    const metadata = observation.mediaMetadata || {};
    const savedHash = [metadata.archive?.mediaSha256, metadata.asr?.mediaSha256]
      .find(value => /^[a-f0-9]{64}$/i.test(value || ''));
    if (local && savedHash) input.expectedSha256 = savedHash;
    if (stage === 'archive') await deps.transcriber.archive(input);
    else {
      let result;
      try {
        result = await deps.transcriber.transcribe(input);
      } catch (error) {
        if (typeof deps.sources.recordTranscriptionError === 'function') {
          deps.sources.recordTranscriptionError(channelId, contentId,
            new Error(String(error.message || error).replace(/https?:\/\/\S+/g, '[媒体地址已隐藏]')));
        }
        throw error;
      }
      if (result.status === 'no_speech') deps.sources.applyNoSpeechResult(channelId, contentId, result);
      else deps.sources.applyTranscription(channelId, contentId, result);
      transcriptionStatus = result.status;
    }
  }
  return { channelId, observationId, contentId, stage, status: 'complete', transcriptionStatus };
}

module.exports = { runDouyinVideoTask };
