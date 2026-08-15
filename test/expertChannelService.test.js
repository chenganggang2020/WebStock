const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-expert-channel-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const db = require('../db');
const experts = require('../services/expertChannelService');

test('expert channel keeps primary content and deleted traces at distinct evidence levels', () => {
  const channel = experts.createChannel({
    channelKey: 'douyin-model-mr',
    displayName: '模型先生',
    platform: 'douyin',
    aliases: ['模型先生', '抖音模型先生'],
    discoveryQueries: ['模型先生 股票', '模型先生 抖音']
  });
  assert.ok(channel.id > 0);

  const primary = experts.recordObservation(channel.id, {
    externalContentId: '7533142185677114684',
    sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
    title: '科创芯片与港股创新药',
    publishedAt: '2025-07-31T15:19:00+08:00',
    evidenceLevel: 'primary',
    contentRole: 'transcript',
    content: '科创芯片需要持续关注新的公司出现；港股创新药长期投入后进入收获期。',
    stockCodes: ['688041'],
    sectors: ['科创芯片', '创新药'],
    topics: ['产业趋势'],
    stance: 'conditional',
    confidence: 0.95
  });
  assert.equal(primary.evidenceLevel, 'primary');
  assert.equal(primary.publishedTimePrecision, 'second');
  assert.equal(primary.evidenceLabel, '原始来源 / 本人公开');
  assert.ok(primary.knowledgeSourceId > 0);

  const trace = experts.recordObservation(channel.id, {
    externalKey: 'third-party-hidden-video-note-1',
    sourceUrl: 'https://example.com/model-mr-note',
    title: '第三方整理提到一条已隐藏视频',
    publishedAt: '2026-03-06',
    evidenceLevel: 'secondary_quote',
    availabilityStatus: 'deleted_trace',
    contentRole: 'secondary_quote',
    summary: '第三方整理者声称该内容来自一条当前不可访问的视频，原始发布时间尚不能核实。',
    topics: ['删除痕迹'],
    confidence: 0.3
  });
  assert.equal(trace.availabilityStatus, 'deleted_trace');
  assert.equal(trace.publishedTimePrecision, 'date');
  assert.equal(trace.evidenceLabel, '第三方转述');

  const timeline = experts.listObservations(channel.id);
  assert.equal(timeline.length, 2);
  assert.equal(experts.getChannel(channel.id).deletedTraceCount, 1);
  assert.equal(experts.getChannel(channel.id).primaryCount, 1);
});

test('expert backtest summaries are idempotent and remain attached to the channel', () => {
  const channel = experts.listChannels({ query: '模型先生' })[0];
  const saved = experts.recordBacktest(channel.id, {
    runId: 'expert-run-1',
    datasetId: 'dataset-demo',
    status: 'exploratory',
    resultPath: 'expert-runs/expert-run-1/result.json',
    resultSha256: 'a'.repeat(64),
    methodology: { horizons: [1, 5, 20, 60], entryRule: 'next_trading_session_open' },
    result: { coverage: { strictEligibleObservations: 1 } }
  });
  assert.equal(saved.datasetId, 'dataset-demo');
  experts.recordBacktest(channel.id, {
    runId: 'expert-run-1',
    datasetId: 'dataset-demo',
    result: { coverage: { strictEligibleObservations: 2 } }
  });
  const listed = experts.listBacktests(channel.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].result.coverage.strictEligibleObservations, 2);
});

test('re-observing the same public item updates it instead of duplicating it', () => {
  const channel = experts.listChannels({ query: '模型先生' })[0];
  const before = experts.listObservations(channel.id).length;
  const updated = experts.recordObservation(channel.id, {
    externalContentId: '7533142185677114684',
    sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
    title: '科创芯片与港股创新药（再次核验）',
    availabilityStatus: 'available',
    lastSeenAt: '2026-08-10T00:00:00+08:00'
  });
  assert.equal(experts.listObservations(channel.id).length, before);
  assert.match(updated.title, /再次核验/);
  assert.equal(updated.contentRole, 'transcript');
});

test('intent handoff explicitly separates quotes, third-party evidence and inference', () => {
  const channel = experts.listChannels({ query: '模型先生' })[0];
  const context = experts.buildIntentContext(channel.id, {
    question: '模型先生近期对科创芯片表达了什么，可能意图是什么？',
    searchQuery: '模型先生 科创芯片'
  });
  assert.ok(context.evidence.length >= 1);
  assert.match(context.prompt, /primary/);
  assert.match(context.prompt, /secondary_quote/);
  assert.match(context.prompt, /deleted_trace/);
  assert.match(context.prompt, /意图\/暗示.*模型推断/);
  assert.match(context.prompt, /WEBSTOCK_RESULT_START/);
});

test('research library supports books, curve evidence and explicit deletion', () => {
  const subject = experts.createChannel({
    channelKey: 'book-curve-methods',
    displayName: '曲线分析方法笔记',
    subjectType: 'book',
    platform: 'book',
    description: '用于保存书籍、图形和可检验规则。',
    aliases: ['曲线方法']
  });
  assert.equal(subject.subjectType, 'book');
  assert.match(subject.description, /可检验规则/);

  const observation = experts.recordObservation(subject.id, {
    externalKey: 'chapter-1-curve',
    title: '第一章趋势曲线',
    evidenceLevel: 'primary',
    contentRole: 'fact_summary',
    mediaType: 'chart',
    archiveStatus: 'local_reference',
    rightsBasis: 'user_owned',
    localAssetPath: 'D:\\Research\\curve-note.png',
    curveData: [{ x: '第1日', y: 10 }, { x: '第2日', y: 12.5 }],
    analysisNotes: '第二个点较第一个点上升。',
    summary: '用户自有书籍笔记中的示例曲线。'
  });
  assert.equal(observation.mediaType, 'chart');
  assert.equal(observation.archiveStatus, 'local_reference');
  assert.equal(observation.rightsBasis, 'user_owned');
  assert.equal(observation.curveData.length, 2);
  assert.equal(observation.curveData[1].y, 12.5);
  assert.match(require('../services/knowledgeService').getSource(observation.knowledgeSourceId).content, /第二个点较第一个点上升/);

  const knowledgeSourceId = observation.knowledgeSourceId;
  assert.equal(experts.deleteObservation(subject.id, observation.id), true);
  assert.equal(experts.listObservations(subject.id).length, 0);
  assert.throws(() => require('../services/knowledgeService').getSource(knowledgeSourceId), /不存在/);
  assert.equal(experts.deleteChannel(subject.id), true);
  assert.throws(() => experts.getChannel(subject.id), /不存在/);
});

test('public comments preserve reply context and distinguish verified creator replies', () => {
  const channel = experts.createChannel({
    channelKey: 'comment-author-verification', displayName: '模型先生', platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/model-mr'
  });
  const observation = experts.recordObservation(channel.id, {
    externalContentId: '7999999999999999999',
    sourceUrl: 'https://www.douyin.com/video/7999999999999999999',
    title: '评论采集测试视频', mediaType: 'video'
  });
  const result = experts.recordObservationComments(channel.id, observation.id, [{
    commentId: 'comment-1', authorName: '提问者', text: '反弹以后怎么看？', likes: 9
  }, {
    commentId: 'reply-1', parentCommentId: 'comment-1', authorName: '模型先生',
    authorProfileUrl: channel.profileUrl, text: '先看分化。', isCreatorLabel: true
  }], {
    status: 'visible_partial', observedAt: '2026-08-15T08:00:00.000Z',
    message: '仅采集当前页面可见范围'
  });

  assert.equal(result.coverage.status, 'visible_partial');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.comments.length, 2);
  assert.equal(result.comments[1].parentCommentId, 'comment-1');
  assert.equal(result.comments[1].creatorStatus, 'verified');
  assert.equal(result.comments[1].verificationMethod, 'profile_url');
  experts.deleteChannel(channel.id);
});

test.after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});
