const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch (_) { return {}; }
}

function exportCreatorTexts({ dbPath, author, outputDir }) {
  if (!dbPath || !author || !outputDir) throw new Error('需要数据库、作者和导出目录。');
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) {
    throw new Error('导出目录已有文件，请使用新的目录以免覆盖。');
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let channel;
  let rows;
  try {
    const matches = db.prepare('SELECT id, display_name, platform FROM expert_channels WHERE display_name = ?')
      .all(author);
    if (matches.length !== 1 || matches[0].platform !== 'douyin') {
      throw new Error('找不到唯一的抖音作者：' + author);
    }
    channel = matches[0];
    rows = db.prepare(`SELECT id, external_content_id, source_url, title, author,
      published_at, first_seen_at, updated_at, media_type, description_text,
      content_text, transcript_text, summary_text, media_metadata_json
      FROM expert_observations WHERE channel_id = ?
      ORDER BY COALESCE(NULLIF(published_at, ''), first_seen_at) DESC, id DESC`).all(channel.id);
  } finally {
    db.close();
  }

  const counts = { total: rows.length, videos: 0, transcribedVideos: 0,
    videosWithoutTranscript: 0, notes: 0, notesWithOcr: 0, notesWithoutOcr: 0,
    asrStatuses: {}, models: {} };
  const records = rows.map(function(row) {
    const metadata = parseJson(row.media_metadata_json);
    const asr = metadata.asr || {};
    const note = metadata.note || {};
    const isVideo = row.media_type === 'video';
    const transcript = String(row.transcript_text || '');
    const notePages = (Array.isArray(note.pages) ? note.pages : []).map(function(page) {
      return { index: page.index, status: page.status, text: String(page.text || ''),
        rawText: String(page.rawText || '') };
    });
    if (isVideo) {
      counts.videos += 1;
      if (transcript.trim()) counts.transcribedVideos += 1;
      else counts.videosWithoutTranscript += 1;
      const status = String(asr.status || 'not_started');
      counts.asrStatuses[status] = (counts.asrStatuses[status] || 0) + 1;
      if (asr.model) {
        const key = [asr.engine || 'unknown', asr.engineVersion || '?', asr.model,
          asr.device || '?', asr.computeType || '?'].join(' / ');
        counts.models[key] = (counts.models[key] || 0) + 1;
      }
    } else if (row.media_type === 'note') {
      counts.notes += 1;
      if (notePages.some(page => page.text.trim())) counts.notesWithOcr += 1;
      else counts.notesWithoutOcr += 1;
    }
    return {
      id: row.id, externalContentId: row.external_content_id || '',
      sourceUrl: row.source_url || '', mediaType: row.media_type,
      publishedAt: row.published_at || '', firstSeenAt: row.first_seen_at || '',
      updatedAt: row.updated_at || '', titleText: row.title || '',
      authorCaption: row.description_text || '', transcriptText: transcript,
      rawTranscriptText: String(asr.rawTranscript || ''),
      otherContentText: row.content_text && row.content_text !== transcript ? row.content_text : '',
      summaryText: row.summary_text || '',
      textStatus: isVideo ? String(asr.status || 'not_started') : String(note.status || 'ocr_not_collected'),
      asr: isVideo ? {
        engine: asr.engine || '', engineVersion: asr.engineVersion || '', model: asr.model || '',
        device: asr.device || '', computeType: asr.computeType || '',
        quality: asr.quality || {}, transcribedAt: asr.transcribedAt || '',
        segments: (Array.isArray(asr.segments) ? asr.segments : []).map(segment => ({
          start: segment.start, end: segment.end, text: segment.text || '',
          rawText: segment.rawText || ''
        }))
      } : null,
      noteOcr: row.media_type === 'note' ? { status: note.status || 'not_collected', pages: notePages } : null
    };
  });

  const manifest = {
    author: channel.display_name, platform: channel.platform,
    exportedAt: new Date().toISOString(),
    latestRecordUpdatedAt: rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, ''),
    counts,
    caveat: '仅导出本地已保存的文字；图文标题可能只是摘录，未识别内容和失败视频没有虚构文稿。'
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'observations.jsonl'),
    records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
  const sections = records.map(function(record, index) {
    const lines = [`## ${index + 1}. ${record.mediaType} · ${record.id}`,
      `来源：${record.sourceUrl || '未记录'}`,
      `发布日期：${record.publishedAt || '未记录'}；文字状态：${record.textStatus}`,
      '', '### 已保存标题／配文摘录', record.titleText || '（无）'];
    if (record.authorCaption) lines.push('', '### 作者配文', record.authorCaption);
    if (record.mediaType === 'video') {
      lines.push('', '### 口播转写', record.transcriptText || '（本地没有口播转写）');
      if (record.rawTranscriptText && record.rawTranscriptText !== record.transcriptText) {
        lines.push('', '### 转写原文（规范化前）', record.rawTranscriptText);
      }
      if (record.asr.model) lines.push('', `模型：${record.asr.engine} ${record.asr.engineVersion} / ${record.asr.model}`);
    } else {
      lines.push('', '### 图片 OCR');
      lines.push(record.noteOcr.pages.length ? record.noteOcr.pages.map(page =>
        `图片 ${page.index}（${page.status}）：\n${page.text || '（无文字）'}`).join('\n\n') : '（本地未保存图片 OCR 正文）');
    }
    if (record.otherContentText) lines.push('', '### 其他正文', record.otherContentText);
    if (record.summaryText) lines.push('', '### 已保存摘要（不是原文）', record.summaryText);
    return lines.join('\n');
  });
  fs.writeFileSync(path.join(outputDir, 'all-texts.md'),
    `# ${channel.display_name} · 本地已保存文字\n\n${manifest.caveat}\n\n` + sections.join('\n\n---\n\n') + '\n');
  fs.writeFileSync(path.join(outputDir, 'model-and-gaps.md'),
    `# 转写模型与缺口\n\n视频使用的实际模型分布：\n\n` +
    Object.entries(counts.models).map(([name, count]) => `- ${name}：${count} 条`).join('\n') +
    `\n\n本地转写脚本使用中文识别（language=zh）、beam_size=5、VAD 过滤、` +
    `不依赖上一片段文本；转写后用 OpenCC 规范为简体中文。` +
    `图文图片识别使用 Windows OCR，但本包只有数据库实际保存的 OCR 结果。\n` +
    `\n\n有口播转写 ${counts.transcribedVideos}/${counts.videos} 条；无转写 ${counts.videosWithoutTranscript} 条。` +
    `图文 ${counts.notes} 条，其中有 OCR 正文 ${counts.notesWithOcr} 条；无 OCR 正文 ${counts.notesWithoutOcr} 条。\n` +
    `标题／配文摘录不等同于完整图文，摘要不等同于作者原文。\n`);
  return manifest;
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).filter(x => x.includes('=')).map(x => {
    const index = x.indexOf('=');
    return [x.slice(0, index).replace(/^--/, ''), x.slice(index + 1)];
  }));
  console.log(JSON.stringify(exportCreatorTexts({ dbPath: args.db, author: args.author,
    outputDir: args.out }), null, 2));
}

module.exports = { exportCreatorTexts };
