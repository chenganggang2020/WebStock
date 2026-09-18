(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CommentStrategyModel = api;
})(typeof window !== 'undefined' ? window : null, function() {
  const CREATOR_STATUSES = new Set(['verified', 'platform_marked']);
  const EVIDENCE_LABELS = new Set(['support', 'counter', 'question']);
  const REQUIRED_RULE_FIELDS = [
    ['universe', '股票池'],
    ['timeframe', '周期'],
    ['signalTiming', '信号时点'],
    ['entryRule', '入场规则'],
    ['exitRule', '退出规则'],
    ['stopRule', '止损规则'],
    ['positionRule', '仓位规则'],
    ['costRule', '费用与滑点']
  ];

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function isVerifiedCreator(comment) {
    return CREATOR_STATUSES.has(text(comment && comment.creatorStatus));
  }

  function normalizeComment(raw) {
    const comment = raw && typeof raw === 'object' ? raw : {};
    return {
      commentId: text(comment.commentId),
      parentCommentId: text(comment.parentCommentId || comment.replyToCommentId),
      authorName: text(comment.authorName) || '未知用户',
      authorProfileUrl: text(comment.authorProfileUrl),
      text: text(comment.text),
      publishedAt: text(comment.publishedAt),
      observedAt: text(comment.observedAt),
      likes: Number.isFinite(Number(comment.likes)) && comment.likes !== '' && comment.likes != null
        ? Number(comment.likes) : null,
      creatorStatus: text(comment.creatorStatus) || 'none',
      verificationMethod: text(comment.verificationMethod)
    };
  }

  function buildCommentEvidence(input) {
    const data = input && typeof input === 'object' ? input : {};
    const comments = (Array.isArray(data.comments) ? data.comments : [])
      .map(normalizeComment)
      .filter(function(comment) { return comment.commentId && comment.text; });
    const byId = new Map(comments.map(function(comment) { return [comment.commentId, comment]; }));
    const rows = comments.map(function(comment) {
      const parent = byId.get(comment.parentCommentId);
      return Object.assign({}, comment, {
        isReply: Boolean(comment.parentCommentId),
        isVerifiedCreator: isVerifiedCreator(comment),
        parentAuthorName: parent ? parent.authorName : '',
        parentText: parent ? parent.text : ''
      });
    });
    const coverageInput = data.coverage && typeof data.coverage === 'object' ? data.coverage : {};
    const visibleCount = Number(coverageInput.visibleCount);
    const coverage = {
      status: text(coverageInput.status) || 'not_loaded',
      message: text(coverageInput.message) || '尚未读取到评论区可见范围，不能据此断言没有评论。',
      observedAt: text(coverageInput.observedAt),
      visibleCount: Number.isFinite(visibleCount) && visibleCount >= 0 ? visibleCount : rows.length,
      complete: coverageInput.complete === true
    };
    const creatorComments = rows.filter(function(comment) { return comment.isVerifiedCreator; });
    const creatorReplies = creatorComments.filter(function(comment) { return comment.isReply; });
    return {
      comments: rows,
      creatorComments,
      creatorReplies,
      coverage,
      counts: {
        total: rows.length,
        topLevel: rows.filter(function(comment) { return !comment.isReply; }).length,
        replies: rows.filter(function(comment) { return comment.isReply; }).length,
        verifiedCreatorComments: creatorComments.length,
        verifiedCreatorReplies: creatorReplies.length,
        suspectedCreatorReplies: rows.filter(function(comment) {
          return comment.isReply && comment.creatorStatus === 'suspected';
        }).length
      }
    };
  }

  function assessRuleCard(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const card = {
      id: text(raw.id),
      title: text(raw.title),
      universe: text(raw.universe),
      timeframe: text(raw.timeframe),
      signalTiming: text(raw.signalTiming),
      entryRule: text(raw.entryRule),
      exitRule: text(raw.exitRule),
      stopRule: text(raw.stopRule),
      positionRule: text(raw.positionRule),
      costRule: text(raw.costRule),
      sourceChannelId: text(raw.sourceChannelId),
      sourceObservationId: text(raw.sourceObservationId),
      sourceCommentId: text(raw.sourceCommentId),
      updatedAt: text(raw.updatedAt)
    };
    const missing = REQUIRED_RULE_FIELDS.filter(function(field) { return !card[field[0]]; });
    return {
      card,
      complete: missing.length === 0,
      status: missing.length ? 'draft' : 'rule_complete_not_validated',
      missingKeys: missing.map(function(field) { return field[0]; }),
      missingLabels: missing.map(function(field) { return field[1]; })
    };
  }

  function groupEvidence(inputComments, inputLabels) {
    const comments = (Array.isArray(inputComments) ? inputComments : []).map(normalizeComment)
      .filter(function(comment) { return comment.commentId && comment.text; });
    const labels = inputLabels && typeof inputLabels === 'object' ? inputLabels : {};
    const result = { support: [], counter: [], question: [], unclassified: [] };
    comments.forEach(function(comment) {
      const label = text(labels[comment.commentId]);
      if (EVIDENCE_LABELS.has(label)) result[label].push(comment);
      else result.unclassified.push(comment);
    });
    return result;
  }

  return {
    buildCommentEvidence,
    assessRuleCard,
    groupEvidence,
    isVerifiedCreator
  };
});
