const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-douyin-source-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const {
  extractDouyinShareLinks,
  douyinPlayerUrl,
  importCapturedPage,
  inspectCapturedPage,
  applyMediaArchive,
  applyTranscription,
  applyNoSpeechResult,
  recordRemoteUnavailable
} = require('../services/douyinSourceService');
const db = require('../db');
const channels = require('../services/expertChannelService');

test.after(() => {
  try { db.close(); } catch (error) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});

test('Douyin share links are canonicalized and deduplicated without accepting other sites', () => {
  const parsed = extractDouyinShareLinks([
    '模型先生新视频 https://www.douyin.com/video/7533142185677114684?previous_page=web_code_link',
    '重复链接：https://www.douyin.com/video/7533142185677114684/',
    '短链接 https://v.douyin.com/AbCdEfGh/',
    '第三方 https://example.com/video/7533142185677114684'
  ].join('\n'));

  assert.deepEqual(parsed.items, [{
    sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
    videoId: '7533142185677114684',
    kind: 'video'
  }, {
    sourceUrl: 'https://v.douyin.com/AbCdEfGh/',
    videoId: '',
    kind: 'short_link'
  }]);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.ignoredCount, 1);
  assert.equal(douyinPlayerUrl('7533142185677114684'),
    'https://open.douyin.com/player/video?vid=7533142185677114684&autoplay=0');
});

test('Douyin parser accepts official player and selected-video URLs only', () => {
  const parsed = extractDouyinShareLinks([
    'https://open.douyin.com/player/video?vid=7533142185677114684&autoplay=1',
    'https://jingxuan.douyin.com/m/video/7641362696420887025',
    'https://www.douyin.com/user/example?modal_id=7512345678901234567',
    'https://www.douyin.com/user/not-a-video'
  ].join('\n'));

  assert.deepEqual(parsed.items.map(item => item.videoId), [
    '7533142185677114684',
    '7641362696420887025',
    '7512345678901234567'
  ]);
  assert.equal(parsed.ignoredCount, 1);
});

test('captured-page inspection classifies changes without mutating observations', () => {
  const profileUrl = 'https://www.douyin.com/user/inspect-only-source-test';
  const channel = channels.createChannel({
    channelKey: 'douyin-inspect-only-source-test',
    displayName: '检查模式作者',
    platform: 'douyin',
    profileUrl
  });
  const capture = function(capturedAt, items) {
    return {
      pageType: 'profile', pageUrl: profileUrl, loggedIn: true, capturedAt,
      profile: { displayName: '检查模式作者', profileUrl, workCount: 3 },
      items
    };
  };
  const firstUrl = 'https://www.douyin.com/video/7800000000000010001';
  const secondUrl = 'https://www.douyin.com/video/7800000000000010002';
  const thirdUrl = 'https://www.douyin.com/video/7800000000000010003';
  importCapturedPage(channel.id, capture('2026-08-12T00:00:00.000Z', [
    { sourceUrl: firstUrl, title: '保持不变' },
    { sourceUrl: secondUrl, title: '原标题' }
  ]));
  const before = channels.listObservations(channel.id, { limit: 20 });
  const beforeChannel = channels.getChannel(channel.id);

  const inspected = inspectCapturedPage(channel.id, capture('2026-08-12T00:10:00.000Z', [
    { sourceUrl: firstUrl, title: '保持不变' },
    { sourceUrl: secondUrl, title: '实质更新标题' },
    { sourceUrl: thirdUrl, title: '新增作品' }
  ]));

  assert.equal(inspected.addedCount, 1);
  assert.equal(inspected.updatedCount, 1);
  assert.equal(inspected.unchangedCount, 1);
  assert.equal(inspected.items.length, 3);
  assert.deepEqual(inspected.candidates.map(function(item) {
    return { contentId: item.externalContentId, changeType: item.changeType };
  }), [
    { contentId: '7800000000000010002', changeType: 'updated' },
    { contentId: '7800000000000010003', changeType: 'added' }
  ]);
  assert.deepEqual(channels.listObservations(channel.id, { limit: 20 }), before);
  assert.equal(channels.getChannel(channel.id).observationCount, beforeChannel.observationCount);
});

test('media archive evidence distinguishes historical hash verification from current identity', () => {
  const profileUrl = 'https://www.douyin.com/user/archive-verification-source-test';
  const contentId = '7930000000000000001';
  const channel = channels.createChannel({
    channelKey: 'douyin-archive-verification-source-test',
    displayName: 'archive verification creator',
    platform: 'douyin',
    profileUrl
  });
  importCapturedPage(channel.id, {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: 'archive verification creator', profileUrl, workCount: 1 },
    items: [{ contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId, title: 'archive item' }]
  });

  applyMediaArchive(channel.id, contentId, {
    localAssetPath: 'D:/archive/' + contentId + '.mp4',
    mediaSha256: 'a'.repeat(64),
    mediaBytes: 456,
    mediaContentType: 'video/mp4',
    verificationMode: 'current_content_id'
  });

  const saved = channels.findObservationByIdentity(channel.id, { externalContentId: contentId });
  assert.equal(saved.mediaMetadata.archive.verificationMode, 'current_content_id');
});

test('later transcription preserves a stronger historical SHA archive verification', () => {
  const profileUrl = 'https://www.douyin.com/user/historical-verification-source-test';
  const contentId = '7930000000000000002';
  const localAssetPath = 'D:/archive/' + contentId + '.mp4';
  const channel = channels.createChannel({
    channelKey: 'douyin-historical-verification-source-test',
    displayName: 'historical verification creator',
    platform: 'douyin',
    profileUrl
  });
  importCapturedPage(channel.id, {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: 'historical verification creator', profileUrl, workCount: 1 },
    items: [{ contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId, title: 'historical item' }]
  });
  applyMediaArchive(channel.id, contentId, {
    localAssetPath,
    mediaSha256: 'b'.repeat(64),
    mediaBytes: 789,
    mediaContentType: 'video/mp4',
    verificationMode: 'historical_sha256'
  });

  applyTranscription(channel.id, contentId, {
    status: 'complete',
    transcript: '这是后来补齐的逐字稿。',
    localAssetPath,
    mediaSha256: 'b'.repeat(64),
    mediaBytes: 789,
    mediaContentType: 'video/mp4',
    transcribedAt: '2026-08-12T03:00:00.000Z'
  });

  const saved = channels.findObservationByIdentity(channel.id, { externalContentId: contentId });
  assert.equal(saved.mediaMetadata.archive.verificationMode, 'historical_sha256');
  assert.equal(saved.mediaMetadata.archive.mediaSha256, 'b'.repeat(64));
});

test('a no-speech ASR result preserves the archived video without inventing a transcript', () => {
  const profileUrl = 'https://www.douyin.com/user/no-speech-source-test';
  const contentId = '7930000000000000003';
  const localAssetPath = 'D:/archive/' + contentId + '.mp4';
  const channel = channels.createChannel({
    channelKey: 'douyin-no-speech-source-test',
    displayName: 'no speech creator',
    platform: 'douyin',
    profileUrl
  });
  importCapturedPage(channel.id, {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: 'no speech creator', profileUrl, workCount: 1 },
    items: [{ contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId,
      title: 'quiet garden video', description: 'page-visible description' }]
  });

  applyNoSpeechResult(channel.id, contentId, {
    status: 'no_speech', transcript: '', segments: [], localAssetPath,
    mediaSha256: 'c'.repeat(64), mediaBytes: 4321, mediaContentType: 'video/mp4',
    durationSeconds: 12, transcribedAt: '2026-08-12T04:00:00.000Z'
  });

  const saved = channels.findObservationByIdentity(channel.id, { externalContentId: contentId });
  assert.equal(saved.transcript, '');
  assert.equal(saved.mediaMetadata.asr.status, 'no_speech');
  assert.equal(saved.localAssetPath, localAssetPath);
  assert.equal(saved.archiveStatus, 'downloaded');
  assert.match(saved.description, /page-visible description/);
});

test('identity rejection records a preserved remote-unavailable state', () => {
  const profileUrl = 'https://www.douyin.com/user/identity-rejected-source-test';
  const contentId = '7930000000000000006';
  const channel = channels.createChannel({
    channelKey: 'douyin-identity-rejected-source-test', displayName: 'identity creator',
    platform: 'douyin', profileUrl
  });
  importCapturedPage(channel.id, {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: 'identity creator', profileUrl, workCount: 1 },
    items: [{ contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId,
      title: 'preserved discovery record' }]
  });

  recordRemoteUnavailable(channel.id, contentId,
    new Error('详情页作者身份与研究对象不一致'), 1, { reason: 'identity_rejected' });

  const saved = channels.findObservationByIdentity(channel.id, { externalContentId: contentId });
  assert.equal(saved.availabilityStatus, 'unavailable');
  assert.equal(saved.mediaMetadata.remote.status, 'identity_rejected');
  assert.equal(saved.title, 'preserved discovery record');
});

test('a later identity-matched detail clears a stale identity rejection', () => {
  const profileUrl = 'https://www.douyin.com/user/identity-recovered-source-test';
  const contentId = '7930000000000000007';
  const sourceUrl = 'https://www.douyin.com/video/' + contentId;
  const channel = channels.createChannel({
    channelKey: 'douyin-identity-recovered-source-test', displayName: 'recovered creator',
    platform: 'douyin', profileUrl
  });
  importCapturedPage(channel.id, {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: 'recovered creator', profileUrl, workCount: 1 },
    items: [{ contentId, sourceUrl, title: 'temporarily redirected work' }]
  });
  recordRemoteUnavailable(channel.id, contentId,
    new Error('detail author did not match'), 1, { reason: 'identity_rejected' });

  importCapturedPage(channel.id, {
    pageType: 'video', pageUrl: sourceUrl, loggedIn: true,
    profile: { displayName: 'recovered creator', profileUrl },
    items: [{ contentId, sourceUrl, title: 'verified work detail', description: 'detail restored' }]
  });

  const saved = channels.findObservationByIdentity(channel.id, { externalContentId: contentId });
  assert.equal(saved.availabilityStatus, 'available');
  assert.equal(saved.mediaMetadata.remote, undefined);
  assert.equal(saved.description, 'detail restored');
});
