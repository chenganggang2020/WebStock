const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-transcript-history-'));
process.env.WEBSTOCK_DB_PATH = path.join(directory, 'test.db');
const db = require('../db');
const channels = require('../services/expertChannelService');
const sources = require('../services/douyinSourceService');

test.after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

const firstTranscribedAt = '2026-09-08T02:00:00.000Z';
const nextTranscribedAt = '2026-09-08T03:00:00.000Z';

function createCompletedVideo(key) {
  const contentId = '7940000000000000001';
  const profileUrl = 'https://www.douyin.com/user/' + key;
  const channel = channels.createChannel({
    channelKey: key, displayName: key, platform: 'douyin', profileUrl
  });
  sources.importCapturedPage(channel.id, {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: key, profileUrl, workCount: 1 },
    items: [{ contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId, title: '隔离逐字稿回归' }]
  });
  // These are fixture metadata only; no media file, network, or model is accessed.
  const archiveEvidence = {
    localAssetPath: path.join(directory, key + '.mp4'),
    mediaSha256: 'a'.repeat(64),
    mediaBytes: 2048,
    mediaContentType: 'video/mp4'
  };
  sources.applyMediaArchive(channel.id, contentId, Object.assign({}, archiveEvidence, {
    verificationMode: 'current_content_id', archivedAt: firstTranscribedAt
  }));
  sources.applyTranscription(channel.id, contentId, Object.assign({}, archiveEvidence, {
    status: 'complete', transcript: '原始成功逐字稿。', rawTranscript: '原始成功逐字稿。',
    engine: 'faster-whisper', engineVersion: 'fixture-v1', model: 'small',
    language: 'zh', languageProbability: 0.99, durationSeconds: 8,
    segments: [{ start: 0, end: 8, text: '原始成功逐字稿。', avgLogProbability: -0.2 }],
    transcribedAt: firstTranscribedAt
  }));
  const previous = channels.findObservationByIdentity(channel.id, { externalContentId: contentId });
  assert.equal(previous.evidenceLevel, 'primary');
  assert.equal(previous.mediaMetadata.asr.status, 'complete');
  assert.equal(previous.transcript, '原始成功逐字稿。');
  return { channel, contentId, archiveEvidence, previous };
}

function readVideo(video) {
  return channels.findObservationByIdentity(video.channel.id, { externalContentId: video.contentId });
}

test('a successful re-transcription retains the previous text and complete ASR evidence in transcript history', () => {
  const video = createCompletedVideo('transcript-history-success');
  sources.applyTranscription(video.channel.id, video.contentId, Object.assign({}, video.archiveEvidence, {
    status: 'complete', transcript: '重新识别后修订的逐字稿。', model: 'medium',
    transcribedAt: nextTranscribedAt
  }));

  const saved = readVideo(video);
  assert.equal(saved.transcript, '重新识别后修订的逐字稿。');
  assert.equal(saved.mediaMetadata.asr.status, 'complete');
  assert.equal(saved.mediaMetadata.asr.model, 'medium');
  assert.ok(Array.isArray(saved.mediaMetadata.transcriptHistory), 're-transcription must expose retained transcript versions');
  const previousVersion = saved.mediaMetadata.transcriptHistory.find(version => version.text === video.previous.transcript);
  assert.ok(previousVersion, 'the replaced successful text must remain available');
  assert.deepEqual(previousVersion.asr, video.previous.mediaMetadata.asr);
});

test('a new no-speech attempt cannot erase an existing successful transcript or its ASR evidence', () => {
  const video = createCompletedVideo('transcript-history-no-speech');
  sources.applyNoSpeechResult(video.channel.id, video.contentId, Object.assign({}, video.archiveEvidence, {
    status: 'no_speech', transcript: '', segments: [], durationSeconds: 8,
    transcribedAt: nextTranscribedAt
  }));

  const saved = readVideo(video);
  assert.equal(saved.transcript, video.previous.transcript, 'no-speech is a new attempt, not permission to delete successful evidence');
  assert.deepEqual(saved.mediaMetadata.asr, video.previous.mediaMetadata.asr);
  assert.equal(saved.localAssetPath, video.previous.localAssetPath);
  assert.equal(saved.archiveStatus, 'downloaded');
  if (saved.mediaMetadata.lastAsrAttempt) {
    assert.equal(saved.mediaMetadata.lastAsrAttempt.status, 'no_speech');
  }
});

test('a failed re-transcription preserves successful ASR and records the failure as a separate last attempt', () => {
  const video = createCompletedVideo('transcript-history-error');
  sources.recordTranscriptionError(video.channel.id, video.contentId, new Error('isolated retry recognition failed'));

  const saved = readVideo(video);
  assert.equal(saved.transcript, video.previous.transcript);
  assert.equal(saved.mediaMetadata.asr.status, 'complete', 'the last failed attempt must not downgrade retained successful evidence');
  assert.deepEqual(saved.mediaMetadata.asr, video.previous.mediaMetadata.asr);
  assert.ok(saved.mediaMetadata.lastAsrAttempt, 'the failed retry must still be inspectable');
  assert.equal(saved.mediaMetadata.lastAsrAttempt.status, 'error');
  assert.match(saved.mediaMetadata.lastAsrAttempt.message, /isolated retry recognition failed/);
  assert.ok(Number.isFinite(Date.parse(saved.mediaMetadata.lastAsrAttempt.attemptedAt)));
});
