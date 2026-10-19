const PROMPT_ECHO = /请(?:使用中国大陆简体中文逐字转写|只分析以下财经文稿)|不要改写、总结或补充原文|以下是中国大陆普通话财经视频|重点术语\s*[：:]|(?:提取|总结)(?:产业链)?关系.{0,30}只返回JSON/i;

function documentBody(row) {
  return String(row.transcript || (row.mediaType === 'note' ? row.content || '' : '')).trim();
}

function transcriptQualityReasons(text, asr = {}) {
  const reasons = [];
  if (PROMPT_ECHO.test(String(text || ''))) reasons.push('prompt_echo');
  const metric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const duration = metric(asr.durationSeconds);
  const outOfRange = (Array.isArray(asr.segments) ? asr.segments : []).some(segment => {
    const start = metric(segment.start), end = metric(segment.end);
    // Allow at most one second of decoder/rounding drift, never an extra ASR chunk.
    return (start != null && start < 0) || (end != null && end < 0) ||
      (start != null && end != null && end < start) ||
      (duration > 0 && ((end != null && end > duration + 1) || (start != null && start > duration + 1)));
  });
  if (outOfRange) reasons.push('timestamp_out_of_range');
  return reasons;
}

function creatorDocumentState(row) {
  const body = documentBody(row), note = row.mediaMetadata?.note || {}, asr = row.mediaMetadata?.asr || {};
  const isNote = row.mediaType === 'note';
  const source = isNote ? note : asr;
  const storedReasons = Array.isArray(source.quality?.reasons) ? source.quality.reasons.filter(value => typeof value === 'string' && value) : [];
  const qualityReasons = [...new Set([...storedReasons, ...transcriptQualityReasons(body, isNote ? {} : asr)])];
  const pages = Array.isArray(note.pages) ? note.pages : [];
  const completePages = Number.isInteger(note.imageCount) && note.imageCount > 0 && note.imageCount <= 50 &&
    pages.length === note.imageCount && pages.every((page, index) => page.index === index + 1 &&
      ((page.status === 'recognized' && String(page.text || '').trim() && body.includes(String(page.text).trim())) ||
       (page.status === 'no_text' && !String(page.text || '').trim())));
  const noteComplete = ['complete', 'needs_review'].includes(note.status) && completePages && pages.some(page => String(page.text || '').trim());
  const extraction = !body ? 'empty' : source.status === 'error' ? 'error' : isNote
    ? noteComplete ? 'complete' : note.status === 'no_text' ? 'empty' : note.status ? 'partial' : 'missing'
    : ['complete', 'needs_review'].includes(asr.status) ? 'complete' : asr.status === 'no_speech' ? 'empty' : 'missing';
  let gate = 'ready';
  if (qualityReasons.includes('prompt_echo')) gate = 'suspected_prompt_echo';
  else if (isNote && (!noteComplete || qualityReasons.length || note.quality?.needsReview === true)) gate = 'note_ocr_required';
  else if (qualityReasons.length || source.quality?.needsReview === true) gate = 'asr_review_required';
  else if (body.length < 30) gate = 'missing_text';
  else if (row.mediaType === 'video' && asr.status !== 'complete') gate = 'asr_review_required';
  const requiresReview = qualityReasons.length > 0 || source.quality?.needsReview === true ||
    (!isNote && asr.status === 'needs_review');
  return {
    extraction,
    machineQuality: requiresReview ? 'review_required' : extraction === 'complete' ? 'pass' : 'not_evaluated',
    // No human approval workflow exists yet: machine admission must not imply one.
    humanReview: 'unreviewed', claimScope: 'author_claim',
    textLength: body.length, qualityReasons, gate, eligibleForAnalysis: gate === 'ready',
    analysisBlockReason: gate === 'missing_text' && body ? 'text_too_short' : gate === 'ready' ? null : gate
  };
}

module.exports = { documentBody, creatorDocumentState, transcriptQualityReasons };
