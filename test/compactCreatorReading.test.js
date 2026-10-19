const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/expertTracker.js'), 'utf8');

test('creator reader keeps duplicate transcripts collapsed and distinguishes rule extraction from AI', () => {
  const renderer = source.slice(source.indexOf('function expertRenderCreatorDetail'), source.indexOf('const expertVideoTaskMessages'));
  assert.doesNotMatch(renderer, /class="expert-asr-segments" open/);
  assert.match(renderer, /规则摘句 · 非 AI 分析/);
  assert.match(renderer, /creator-reader-transcript/);
  assert.doesNotMatch(renderer, /replaceWith\(oldPlayer\)/);
  assert.match(renderer, /slot\._creatorMediaPath !== mediaPath/);
  for (const action of ['capture', 'archive', 'transcribe', 'comments']) assert.ok(renderer.includes("['" + action + "'"));
});

test('creator grid styles target the actual inner page, not its one-child wrapper', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/compact-terminal.css'), 'utf8');
  assert.match(html, /id="creatorTasksView"[^>]*>\s*<div class="creator-task-page">/);
  assert.match(css, /#creatorTasksView.active > \.creator-task-page \{ display:grid/);
  assert.doesNotMatch(css, /#creatorTasksView.active \{ display:grid/);
  assert.match(html, /<details class="creator-task-progress-card">/);
  assert.match(html, /<details id="expertAnalysisPacketCard"/);
});
