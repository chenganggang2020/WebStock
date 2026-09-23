const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-note-knowledge-regression-'));
process.env.WEBSTOCK_DB_PATH = path.join(testDir, 'isolated.db');

const db = require('../db');
const experts = require('../services/expertChannelService');
const knowledge = require('../services/knowledgeService');

test.after(() => {
  db.close();
  // Remove only this test's freshly created directory, never app data.
  assert.equal(path.dirname(testDir), os.tmpdir());
  assert.ok(path.basename(testDir).startsWith('webstock-note-knowledge-regression-'));
  fs.rmSync(testDir, { recursive: true, force: true });
});

function createChannel(key) {
  return experts.createChannel({
    channelKey: key,
    displayName: '图文测试作者 ' + key,
    platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/' + key
  });
}

function automaticNote(externalKey, analysisNotes) {
  return {
    externalKey,
    sourceUrl: 'https://www.douyin.com/note/7687442139320759150',
    title: '只采到了标题，图文正文尚未取得',
    mediaType: 'note',
    content: '', description: '', transcript: '', summary: '',
    mediaMetadata: { captureSchemaVersion: 'douyin-visible-v2' },
    analysisNotes
  };
}

test('automatically extracted title-only key points do not become searchable source evidence', () => {
  const channel = createChannel('title-only-key-points');
  const saved = experts.recordObservation(channel.id, automaticNote('first-note',
    '自动提取要点：标题样本关键词紫铜试验\n分析方法：本地规则提取 rule-v2，原文不足时不推断股票代码。'));

  assert.equal(saved.knowledgeSourceId, null);
  assert.equal(knowledge.listSources({ author: channel.displayName }).length, 0);
  assert.equal(knowledge.search({ query: '紫铜试验', limit: 10 }).items.length, 0);
});

test('rule-method-only metadata without any original text does not create a knowledge source', () => {
  const channel = createChannel('rule-only-metadata');
  const saved = experts.recordObservation(channel.id, automaticNote('second-note',
    '分析方法：本地规则提取 rule-v2，原文不足时不推断股票代码。'));

  assert.equal(saved.knowledgeSourceId, null);
  assert.equal(knowledge.listSources({ author: channel.displayName }).length, 0);
});

test('manually written image analysis remains a valid knowledge source without a transcript', () => {
  const channel = createChannel('manual-chart-notes');
  const analysisNotes = '人工查看图中三个季度的库存曲线：第三季度库存下降，但原图没有披露新增订单，需要单独核对。';
  const saved = experts.recordObservation(channel.id, {
    externalKey: 'manual-note',
    title: '库存图人工研究笔记',
    mediaType: 'chart',
    contentRole: 'fact_summary',
    analysisNotes
  });

  assert.ok(saved.knowledgeSourceId > 0);
  assert.ok(knowledge.getSource(saved.knowledgeSourceId).content.includes(analysisNotes));
});

test('a captured note with real description text can still be indexed alongside automatic notes', () => {
  const channel = createChannel('captured-note-with-body');
  const input = automaticNote('third-note', '自动提取要点：生产交期需要验证');
  input.description = '图文作者写明：当前生产交期缩短，但不能仅凭交期变化判断订单增长，仍需要对照库存。';
  const saved = experts.recordObservation(channel.id, input);

  assert.ok(saved.knowledgeSourceId > 0);
  assert.ok(knowledge.getSource(saved.knowledgeSourceId).content.includes(input.description));
});

test('a later bodyless automatic capture does not replace an already complete knowledge source', () => {
  const channel = createChannel('preserve-existing-source');
  const originalText = '原始图文全文：这里保存了已经取得并核对的完整生产交期信息，后续详情采集失败不能覆盖这段正文。';
  const first = experts.recordObservation(channel.id, {
    ...automaticNote('stable-note', ''),
    content: originalText
  });
  const before = knowledge.getSource(first.knowledgeSourceId);
  const updated = experts.recordObservation(channel.id, automaticNote('stable-note',
    '自动提取要点：仅基于本轮标题重新生成\n分析方法：本地规则提取 rule-v2，原文不足时不推断股票代码。'));

  assert.equal(updated.knowledgeSourceId, first.knowledgeSourceId);
  assert.equal(knowledge.getSource(first.knowledgeSourceId).content, before.content);
});
