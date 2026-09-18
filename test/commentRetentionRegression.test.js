const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-comment-retention-'));
process.env.WEBSTOCK_DB_PATH = path.join(directory, 'test.db');
const db = require('../db');
const experts = require('../services/expertChannelService');

test.after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

const firstObservedAt = '2026-09-08T02:00:00.000Z';
const nextObservedAt = '2026-09-08T03:00:00.000Z';

function createVideo(key) {
  const channel = experts.createChannel({ channelKey: key, displayName: '隔离评论回归', platform: 'douyin' });
  const observation = experts.recordObservation(channel.id, {
    externalContentId: '7000000000000000001',
    sourceUrl: 'https://www.douyin.com/video/7000000000000000001',
    title: '隔离测试视频',
    mediaType: 'video'
  });
  return { channel, observation };
}

function saveComments(video, comments, observedAt) {
  return experts.recordObservationComments(video.channel.id, video.observation.id, comments, {
    status: 'visible_partial', observedAt
  });
}

function versionsOf(comment) {
  assert.ok(Array.isArray(comment.versions), 'returned comments must expose retained versions');
  return comment.versions.map(version => ({ text: version.text, observedAt: version.observedAt }))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.text.localeCompare(right.text));
}

test('a missing source comment is retained and an older response cannot overwrite its newer text', () => {
  const video = createVideo('comments-stale-response');
  saveComments(video, [{ commentId: 'comment-1', text: '新版本评论', likes: 10 }], nextObservedAt);
  const absent = saveComments(video, [], '2026-09-08T04:00:00.000Z');
  assert.equal(absent.comments.length, 1, 'absence from a later source snapshot is not permission to delete');

  saveComments(video, [{ commentId: 'comment-1', text: '延迟到达的旧版本', likes: 1 }], firstObservedAt);
  const current = experts.listObservationComments(video.channel.id, video.observation.id).comments[0];
  assert.equal(current.text, '新版本评论');
  assert.equal(current.observedAt, nextObservedAt);
  assert.equal(current.likes, 10);
});

test('comment pagination honors offset and reports the complete retained total and hasMore', () => {
  const video = createVideo('comments-offset-page');
  saveComments(video, Array.from({ length: 5 }, (_, index) => ({
    commentId: 'comment-' + (index + 1), text: '评论 ' + (index + 1)
  })), firstObservedAt);

  const page = experts.listObservationComments(video.channel.id, video.observation.id, { limit: 2, offset: 2 });
  assert.equal(page.total, 5);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.comments.map(comment => comment.commentId), ['comment-3', 'comment-4']);
  const finalPage = experts.listObservationComments(video.channel.id, video.observation.id, { limit: 2, offset: 4 });
  assert.equal(finalPage.total, 5);
  assert.equal(finalPage.hasMore, false);
  assert.deepEqual(finalPage.comments.map(comment => comment.commentId), ['comment-5']);
});

test('updating the same comment id preserves its previous text and observation time as a version', () => {
  const video = createVideo('comments-version-history');
  saveComments(video, [{ commentId: 'comment-1', text: '原始评论' }], firstObservedAt);
  saveComments(video, [{ commentId: 'comment-1', text: '修改后的评论' }], nextObservedAt);

  const result = experts.listObservationComments(video.channel.id, video.observation.id);
  assert.equal(result.comments.length, 1, 'editing a platform comment does not create a second logical comment');
  const comment = result.comments[0];
  assert.equal(comment.text, '修改后的评论');
  assert.equal(comment.observedAt, nextObservedAt);
  assert.ok(versionsOf(comment).some(version => version.text === '原始评论' && version.observedAt === firstObservedAt));
});

test('export and restore retain more than 200 comments plus their text versions and observation times', () => {
  const video = createVideo('comments-complete-round-trip');
  const commentCount = 205;
  saveComments(video, Array.from({ length: commentCount }, (_, index) => ({
    commentId: 'comment-' + index, text: '原始评论 ' + index
  })), firstObservedAt);
  saveComments(video, [{ commentId: 'comment-0', text: '修改后的首条评论' }], nextObservedAt);

  const exported = experts.exportChannels().find(channel => channel.channelKey === video.channel.channelKey);
  const exportedComments = exported.observations[0].commentData.comments;
  assert.equal(exportedComments.length, commentCount, 'backup export must not apply the UI 200-comment page limit');
  const original = experts.listObservationComments(video.channel.id, video.observation.id, { limit: 1000 }).comments;
  const canonical = comments => comments.map(comment => ({
    commentId: comment.commentId, text: comment.text, observedAt: comment.observedAt, versions: versionsOf(comment)
  })).sort((left, right) => left.commentId.localeCompare(right.commentId));
  assert.deepEqual(canonical(exportedComments), canonical(original));
  assert.ok(versionsOf(exportedComments.find(comment => comment.commentId === 'comment-0'))
    .some(version => version.text === '原始评论 0' && version.observedAt === firstObservedAt));

  // Delete only this isolated fixture so restoration cannot pass by reusing existing rows.
  experts.deleteChannel(video.channel.id);
  experts.restoreChannels([exported]);
  const restoredChannel = experts.listChannels().find(channel => channel.channelKey === video.channel.channelKey);
  const restoredObservation = experts.listObservations(restoredChannel.id)[0];
  const restored = experts.listObservationComments(restoredChannel.id, restoredObservation.id, { limit: 1000 });
  assert.equal(restored.total, commentCount);
  assert.equal(restored.comments.length, commentCount);
  assert.deepEqual(canonical(restored.comments), canonical(original));
});
