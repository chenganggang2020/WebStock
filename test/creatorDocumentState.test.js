const test = require('node:test');
const assert = require('node:assert/strict');
const { creatorDocumentState } = require('../services/creatorDocumentState');

function note() {
  const text = '保偏光纤用于光引擎的激光传输，这一技术路线与高速光互联有关。';
  return { mediaType: 'note', content: text, mediaMetadata: { note: {
    status: 'needs_review', imageCount: 1, pages: [{ index: 1, status: 'recognized', text }]
  } } };
}

test('complete machine OCR is eligible only as an unreviewed author claim', () => {
  const row = note(), before = JSON.stringify(row), state = creatorDocumentState(row);
  assert.equal(state.eligibleForAnalysis, true);
  assert.equal(state.extraction, 'complete');
  assert.equal(state.machineQuality, 'pass');
  assert.equal(state.humanReview, 'unreviewed');
  assert.equal(state.claimScope, 'author_claim');
  assert.equal(JSON.stringify(row), before);
});

test('a fabricated legacy OCR field cannot substitute for actual ordered pages', () => {
  const row = note();
  row.mediaMetadata = { ocr: { status: 'complete' } };
  assert.equal(creatorDocumentState(row).gate, 'note_ocr_required');
});

test('OCR page count, order, and text correspondence must all be complete', () => {
  for (const mutate of [
    row => { row.mediaMetadata.note.imageCount = 2; },
    row => { row.mediaMetadata.note.pages[0].index = 2; },
    row => { row.mediaMetadata.note.pages[0].status = 'error'; },
    row => { row.content = '另一份正文，不属于当前识别图片，不能仅凭状态完毕就认为当前文稿已经完整处理。'; }
  ]) {
    const row = note(); mutate(row);
    assert.equal(creatorDocumentState(row).eligibleForAnalysis, false);
  }
});

test('partial preserved pages and explicit OCR quality warnings are not automatically approved', () => {
  const row = note();
  row.mediaMetadata.note.status = 'partial';
  assert.equal(creatorDocumentState(row).gate, 'note_ocr_required');
  row.mediaMetadata.note.status = 'needs_review';
  row.mediaMetadata.note.quality = { needsReview: true, reasons: ['uncertain_entities'] };
  const state = creatorDocumentState(row);
  assert.equal(state.eligibleForAnalysis, false);
  assert.equal(state.machineQuality, 'review_required');
  assert.deepEqual(state.qualityReasons, ['uncertain_entities']);
});

test('a text-free image does not count its caption as an OCR transcript', () => {
  const row = note();
  row.mediaMetadata.note.status = 'no_text';
  row.mediaMetadata.note.pages[0] = { index: 1, status: 'no_text', text: '' };
  const state = creatorDocumentState(row);
  assert.equal(state.extraction, 'empty');
  assert.equal(state.eligibleForAnalysis, false);
});

test('old complete ASR with retained quality flags is not promoted or rewritten', () => {
  const row = { mediaType: 'video', transcript: note().content, mediaMetadata: { asr: {
    status: 'complete', quality: { needsReview: true, reasons: ['high_no_speech_probability'] }
  } } };
  const state = creatorDocumentState(row);
  assert.equal(state.gate, 'asr_review_required');
  assert.equal(state.machineQuality, 'review_required');
  assert.equal(row.mediaMetadata.asr.status, 'complete');
});
