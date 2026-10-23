// Build-time only. Reuse the audited old visible-page extractor; native runtime does not need Node.
const fs = require('node:fs');
const path = require('node:path');
const {buildDouyinPageSnapshotScript, extractDouyinMediaCandidates} = require('../../electron/douyinPageCapture');
// The legacy DOM player may be a preloaded previous work. Only an identity-bound
// detail record may supply media to the native automatic pipeline.
function bindEmbeddedMedia(snapshot, extract) {
  for (const item of snapshot.items || []) { item.mediaUrl = ''; delete item.mediaBinding; }
  const match = new URL(snapshot.pageUrl).pathname.match(/^\/(?:video|note)\/(\d{12,24})\/?$/);
  if (!match) return snapshot;
  const id = match[1], author = snapshot.profile && snapshot.profile.profileUrl;
  const item = (snapshot.items || []).find(value => value.contentId === id);
  if (!item || !author) return snapshot;
  let visited = 0, budget = 4000000;
  function find(value, depth) {
    if (!value || typeof value !== 'object' || depth > 16 || ++visited > 12000) return false;
    const who = value.author || value.authorInfo || {};
    if (String(value.aweme_id || value.aweme_id_str || '') === id &&
        'https://www.douyin.com/user/' + String(who.sec_uid || who.secUid || '') === author) {
      const candidates = extract({aweme_detail: value}, id);
      for (const candidate of candidates) {
        const url = new URL(candidate.url);
        if (candidate.url.length > 8000 || url.username || url.password || url.port || url.hash) continue;
        item.mediaUrl = candidate.url;
        item.mediaBinding = {contentId: id, profileUrl: author, source: 'embedded_detail'};
        return true;
      }
    }
    for (const child of Object.values(value)) if (find(child, depth + 1)) return true;
    return false;
  }
  for (const script of Array.from(document.querySelectorAll('script')).slice(0, 150)) {
    if (script.src) continue;
    let text = String(script.textContent || '').trim();
    if (text.length > 2000000 || (budget -= text.length) < 0) break;
    if (!text.includes(id)) continue;
    try {
      if (text.startsWith('self.__pace_f.push(')) {
        const frame = text.match(/^self\.__pace_f\.push\((\[[\s\S]*\])\);?\s*$/);
        if (!frame) continue;
        const part = JSON.parse(frame[1]);
        if (part[0] !== 1 || typeof part[1] !== 'string') continue;
        text = part[1].replace(/^[0-9a-f]+:/i, '').trim();
      }
      if (find(JSON.parse(text.startsWith('%') ? decodeURIComponent(text) : text), 0)) break;
    } catch (_) { /* Non-JSON script is not executed or considered media proof. */ }
  }
  return snapshot;
}
const target = path.join(__dirname, '../desktop/douyin-snapshot.js');
fs.writeFileSync(target, '// Generated from the legacy visible-page extractor plus strict native media binding. No cookies or fetch.\n' +
  '(' + bindEmbeddedMedia.toString() + ')(' + buildDouyinPageSnapshotScript() + ',' + extractDouyinMediaCandidates.toString() + ')');
console.log('Generated native visible-page snapshot resource');
