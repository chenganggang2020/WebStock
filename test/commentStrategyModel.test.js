const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../js/modules/commentStrategyModel');

test('comment evidence preserves reply context and only verifies explicit creator statuses', () => {
  const result = model.buildCommentEvidence({
    coverage: {
      status: 'visible_partial',
      message: '仅覆盖当前页面可见范围',
      observedAt: '2026-08-24T01:00:00.000Z',
      visibleCount: 4,
      complete: false
    },
    comments: [
      { commentId: 'q1', authorName: '普通用户', text: '止损按什么价格？', likes: 3, creatorStatus: 'none' },
      { commentId: 'r1', parentCommentId: 'q1', authorName: '模型先生', text: '以收盘确认。', creatorStatus: 'verified' },
      { commentId: 'r2', parentCommentId: 'q1', authorName: '模型先生', text: '同名但未确认。', creatorStatus: 'suspected' },
      { commentId: 'r3', parentCommentId: 'q1', authorName: '作者', text: '平台标记。', creatorStatus: 'platform_marked' },
      { commentId: 'p1', authorName: '模型先生', text: '作者补充说明。', creatorStatus: 'verified' }
    ]
  });

  assert.equal(result.comments.length, 5);
  assert.equal(result.counts.topLevel, 2);
  assert.equal(result.counts.replies, 3);
  assert.equal(result.counts.verifiedCreatorComments, 3);
  assert.equal(result.counts.verifiedCreatorReplies, 2);
  assert.equal(result.counts.suspectedCreatorReplies, 1);
  assert.equal(result.creatorComments.length, 3);
  assert.equal(result.creatorReplies.length, 2);
  assert.equal(result.creatorReplies[0].parentText, '止损按什么价格？');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.visibleCount, 4);
});

test('empty comment data keeps not-loaded coverage distinct from an empty complete page', () => {
  const result = model.buildCommentEvidence({ comments: [] });
  assert.equal(result.comments.length, 0);
  assert.equal(result.coverage.status, 'not_loaded');
  assert.equal(result.coverage.complete, false);
  assert.match(result.coverage.message, /不能据此断言没有评论/);
});

test('rule card remains a draft until all eight execution fields are explicit', () => {
  const draft = model.assessRuleCard({
    title: 'BOLL + MACD + RSI',
    universe: '沪深主板',
    timeframe: '日线',
    signalTiming: '收盘后',
    entryRule: '次日开盘',
    exitRule: '',
    stopRule: '收盘跌破中轨',
    positionRule: '单票不超过20%',
    costRule: '双边0.1%'
  });
  assert.equal(draft.complete, false);
  assert.deepEqual(draft.missingKeys, ['exitRule']);
  assert.deepEqual(draft.missingLabels, ['退出规则']);

  const complete = model.assessRuleCard(Object.assign({}, draft.card, { exitRule: '目标位或20日后退出' }));
  assert.equal(complete.complete, true);
  assert.equal(complete.status, 'rule_complete_not_validated');
});

test('evidence map uses only explicit user labels and never infers from likes or wording', () => {
  const comments = [
    { commentId: 'a', text: '胜率很高', likes: 999 },
    { commentId: 'b', text: '跨股票失效', likes: 1 },
    { commentId: 'c', text: '参数是什么？', likes: 0 }
  ];
  const grouped = model.groupEvidence(comments, {
    a: 'support',
    b: 'counter',
    c: 'question',
    missing: 'support',
    ignored: 'positive'
  });

  assert.deepEqual(grouped.support.map(item => item.commentId), ['a']);
  assert.deepEqual(grouped.counter.map(item => item.commentId), ['b']);
  assert.deepEqual(grouped.question.map(item => item.commentId), ['c']);
  assert.equal(grouped.unclassified.length, 0);
});

test('unlabelled comments remain unclassified even when they look supportive', () => {
  const grouped = model.groupEvidence([{ commentId: 'a', text: '这个方法非常有效', likes: 1000 }], {});
  assert.equal(grouped.support.length, 0);
  assert.equal(grouped.unclassified.length, 1);
});
