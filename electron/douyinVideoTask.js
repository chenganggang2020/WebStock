async function runDouyinVideoTask(deps, channelId, observationId, stage, onProgress = () => {}) {
  if (!['capture', 'archive', 'transcribe', 'comments'].includes(stage)) throw new Error('不支持的单视频操作');
  const channel = deps.channels.getChannel(channelId);
  let observation = deps.channels.getObservation(channelId, observationId);
  const contentId = String(observation.externalContentId || '');
  const sourceUrl = new URL(observation.sourceUrl);
  if (channel.platform !== 'douyin' || sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'www.douyin.com' ||
      !/^\d{12,24}$/.test(contentId) || sourceUrl.pathname.replace(/\/$/, '') !== '/video/' + contentId) {
    throw new Error('单视频任务必须使用当前作者的抖音视频直链');
  }
  let mediaUrl = '';
  const local = observation.localAssetPath || ((observation.mediaMetadata || {}).archive || {}).localAssetPath;
  if (stage === 'capture' || stage === 'comments' || !local || observation.evidenceLevel !== 'primary') {
    onProgress({ stage: 'capture', message: '正在采集所选视频详情与可见评论' });
    const capture = await deps.sessionManager.captureUrl(observation.sourceUrl, { preferMediaUrl: stage === 'archive' || stage === 'transcribe' });
    const current = (capture.items || []).find(item => String(item.contentId) === contentId);
    if (!capture.loggedIn || !current || !deps.sources.verifyCapturedIdentity(channelId, capture).matched) {
      throw new Error('详情未加载、登录失效或作者身份不匹配，未保存');
    }
    mediaUrl = current.mediaUrl || '';
    const persisted = Object.assign({}, current);
    delete persisted.mediaUrl;
    delete persisted.mediaCandidates;
    const safeCapture = Object.assign({}, capture, { items: [persisted] });
    delete safeCapture.mediaUrl;
    delete safeCapture.mediaCandidates;
    deps.sources.importCapturedPage(channelId, safeCapture);
    observation = deps.channels.getObservation(channelId, observationId);
  }
  if (stage === 'transcribe' || stage === 'archive') {
    if (!deps.transcriber) throw new Error('转写与归档服务尚未启动');
    const input = { contentId, mediaUrl, prompt: observation.title,
      onArchived(result) { deps.sources.applyMediaArchive(channelId, contentId, result); }, onProgress };
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
    }
  }
  return { channelId, observationId, contentId, stage, status: 'complete' };
}

module.exports = { runDouyinVideoTask };
