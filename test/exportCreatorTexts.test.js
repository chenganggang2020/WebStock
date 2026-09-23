const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { exportCreatorTexts } = require('../scripts/export-creator-texts');

test('exports only the selected creator and labels transcripts separately from note excerpts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-text-export-'));
  const dbPath = path.join(root, 'sample.db');
  const outputDir = path.join(root, 'export');
  try {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE expert_channels (id INTEGER PRIMARY KEY, display_name TEXT, platform TEXT);
      CREATE TABLE expert_observations (id INTEGER PRIMARY KEY, channel_id INTEGER,
        external_content_id TEXT, source_url TEXT, title TEXT, author TEXT,
        published_at TEXT, first_seen_at TEXT, updated_at TEXT, media_type TEXT,
        description_text TEXT, content_text TEXT, transcript_text TEXT,
        summary_text TEXT, media_metadata_json TEXT);`);
    db.prepare('INSERT INTO expert_channels VALUES (?, ?, ?)').run(4, 'Fioona', 'douyin');
    db.prepare('INSERT INTO expert_channels VALUES (?, ?, ?)').run(5, 'Other', 'douyin');
    const insert = db.prepare(`INSERT INTO expert_observations VALUES
      (@id,@channel,@external,@url,@title,@author,@published,@firstSeen,@updated,
       @type,@description,@content,@transcript,@summary,@metadata)`);
    const base = {author:'Fioona', published:'',firstSeen:'2026-09-20',updated:'2026-09-21',
      description:'',content:'',transcript:'',summary:''};
    insert.run({...base,id:1,channel:4,external:'v1',url:'https://example.com/video/1',
      title:'视频标题',type:'video',transcript:'完整口播',content:'完整口播',
      metadata:JSON.stringify({asr:{status:'complete',engine:'faster-whisper',
        engineVersion:'1.2.1',model:'small',device:'cpu',computeType:'int8',
        rawTranscript:'完整口播',localAssetPath:'C:/private/video.mp4'}})});
    insert.run({...base,id:2,channel:4,external:'n1',url:'https://example.com/note/1',
      title:'图文标题摘录',type:'note',metadata:'{}'});
    insert.run({...base,id:3,channel:5,external:'other',url:'',title:'不应导出',
      type:'video',metadata:'{}'});
    db.close();

    const manifest = exportCreatorTexts({dbPath,author:'Fioona',outputDir});
    const records = fs.readFileSync(path.join(outputDir,'observations.jsonl'),'utf8')
      .trim().split('\n').map(JSON.parse);
    const markdown = fs.readFileSync(path.join(outputDir,'all-texts.md'),'utf8');
    const modelNotes = fs.readFileSync(path.join(outputDir,'model-and-gaps.md'),'utf8');
    assert.equal(manifest.counts.total, 2);
    assert.equal(manifest.counts.transcribedVideos, 1);
    assert.equal(manifest.counts.notesWithoutOcr, 1);
    assert.equal(records.length, 2);
    assert.equal(records.find(record => record.mediaType === 'video').transcriptText, '完整口播');
    assert.equal(records.find(record => record.mediaType === 'note').transcriptText, '');
    assert.equal(records.find(record => record.mediaType === 'note').titleText, '图文标题摘录');
    assert.match(markdown, /图文标题摘录/);
    assert.match(modelNotes, /beam_size=5/);
    assert.doesNotMatch(JSON.stringify(records), /C:\/private/);
    assert.doesNotMatch(markdown, /不应导出/);
  } finally {
    fs.rmSync(root, {recursive:true,force:true});
  }
});
