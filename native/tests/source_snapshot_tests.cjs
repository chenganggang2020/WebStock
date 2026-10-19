const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Run the real generated resource, not a copy of its extraction logic. The VM
// has no network, filesystem, process, or account/session APIs.
const script = fs.readFileSync(path.join(__dirname, '../desktop/douyin-snapshot.js'), 'utf8');
const workA = '7259684447530929443';
const workB = '7259684447530929444';
const author = 'https://www.douyin.com/user/abcdef';
const mediaA = 'https://v3.douyinvod.com/current-work-A.mp4';
const mediaB = 'https://v3.douyinvod.com/previous-work-B.mp4';

function element(text = '', attributes = {}, hidden = false) {
  return {
    textContent: text,
    hidden,
    getAttribute: name => attributes[name] || '',
    getBoundingClientRect: () => ({ width: hidden ? 0 : 640, height: hidden ? 0 : 360 }),
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
  };
}

function video(url, hidden = false) {
  return Object.assign(element('', {}, hidden), { currentSrc: url, src: url, poster: '' });
}

function embeddedWork(id, url) {
  return {
    aweme_detail: {
      aweme_id: id,
      author: { sec_uid: 'abcdef', nickname: '作者 A' },
      desc: id === workA ? '作品 A 的详情' : '旧作品 B 的详情',
      create_time: 1700000000,
      video: { play_addr: { url_list: [url] } },
    },
  };
}

function capture({ videos = [], embedded = [], observedDetail = null, rawScripts = [], externalScripts = 0, authorVisible = true, titleVisible = true, challenge = null, login = null } = {}) {
  const location = {
    href: 'https://www.douyin.com/video/' + workA,
    pathname: '/video/' + workA,
  };
  const authorLink = element('作者 A', { href: author });
  const authorLabel = element('作者 A');
  authorLabel.closest = selector => selector.includes('/user/') ? authorLink : null;
  const description = element('作品 A 的详情');
  const scripts = Array.from({ length: externalScripts }, () => ({ src: 'https://static.example/script.js' }))
    .concat(embedded.map(payload => Object.assign(element(JSON.stringify(payload)), { src: '' })),
      rawScripts.map(text => Object.assign(element(text), { src: '' })));
  const document = {
    title: titleVisible ? '作品 A' : '',
    body: { innerText: '通知 消息 投稿 作品 A 的详情' },
    querySelector(selector) {
      if (selector === 'video') return videos[0] || null;
      if (selector === '[data-e2e="video-desc"]') return titleVisible ? description : null;
      if (selector === '[data-e2e="video-author-name"]') return authorLabel;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith('#captcha_container')) return challenge ? [challenge] : [];
      if (selector === 'button, a, [role="button"]') return login ? [login] : [];
      if (selector === 'script') return scripts;
      if (selector === 'video') return videos;
      if (selector === 'a[href*="/user/"]') return [authorLink];
      if (selector.includes('[data-e2e="video-author-name"]')) return authorVisible ? [authorLabel] : [];
      return [];
    },
  };
  const window = {
    location,
    getComputedStyle: node => ({ display: node.hidden ? 'none' : 'block', visibility: 'visible' }),
  };
  // Same host wrapper, including a resource that starts with a line comment.
  const hostScript = '(function(sourceResponseDetail){return (\n' + script.trim() +
    '\n);})(' + JSON.stringify(observedDetail) + ')';
  const result = vm.runInNewContext(hostScript, { document, window, location, URL }, {
    filename: 'douyin-snapshot.js', timeout: 1000,
  });
  return JSON.parse(JSON.stringify(result));
}

function currentItem(page) {
  assert.equal(page.pageUrl, 'https://www.douyin.com/video/' + workA);
  assert.equal(page.profile.profileUrl, author);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].contentId, workA);
  return page.items[0];
}

test('old B player must not become current A media just because it is the first video', () => {
  const item = currentItem(capture({ videos: [video(mediaB)] }));
  assert.equal(item.mediaUrl || '', '', 'DOM player has no work identity binding');
  assert.ok(!item.mediaBinding, 'no binding may be invented for the DOM player');
});

test('hidden old B before a visible A player still cannot supply an unbound URL', () => {
  const item = currentItem(capture({ videos: [video(mediaB, true), video(mediaA)] }));
  assert.equal(item.mediaUrl || '', '', 'neither visibility nor DOM order proves media identity');
  assert.ok(!item.mediaBinding);
});

test('an embedded B record cannot bind a current A DOM video', () => {
  const item = currentItem(capture({ videos: [video(mediaA)], embedded: [embeddedWork(workB, mediaB)] }));
  assert.equal(item.mediaUrl || '', '', 'embedded detail must match the current work, not merely its author');
  assert.ok(!item.mediaBinding);
});

test('embedded A with the current author supplies A media despite an old B player', () => {
  const item = currentItem(capture({ videos: [video(mediaB)], embedded: [embeddedWork(workA, mediaA)] }));
  assert.equal(item.mediaUrl, mediaA);
  assert.deepEqual(item.mediaBinding, { contentId: workA, profileUrl: author, source: 'embedded_detail' });
});
test('visible challenge is a separate blocker even beside apparent logged-in navigation', () => {
  assert.equal(capture({ challenge: element('拖动滑块完成验证') }).verificationRequired, true);
  assert.equal(capture({ challenge: element('旧验证', {}, true) }).verificationRequired, false);
});
test('visible login prompt is explicit; hidden old prompt cannot claim it', () => {
  const page = capture({ login: element('登录') });
  assert.equal(page.loginRequired, true);
  assert.equal(page.loggedIn, false);
  assert.equal(capture({ login: element('登录', {}, true) }).loginRequired, false);
});

test('read-only structure diagnostics expose schema counts but no media URL or payload', () => {
  const page = capture({ embedded: [embeddedWork(workA, mediaA + '?private=signed')] });
  assert.equal(page.structure.inlineScripts, 1);
  assert.equal(page.structure.matchingScripts.length, 1);
  assert.ok(page.structure.matchingScripts[0].keys.includes('sec_uid'));
  assert.ok(!JSON.stringify(page.structure).includes('signed'));
  assert.ok(!JSON.stringify(page.structure).includes('https:'));
});

test('late inline detail is not discarded merely because external bundles came first', () => {
  const item = currentItem(capture({ externalScripts: 173, authorVisible: false,
    embedded: [embeddedWork(workA, mediaA)] }));
  assert.equal(item.mediaUrl, mediaA);
});

test('camel-case streaming work identity binds only its own embedded media', () => {
  const detail = embeddedWork(workA, mediaA).aweme_detail;
  detail.awemeId = detail.aweme_id;
  delete detail.aweme_id;
  const frame = 'self.__pace_f.push(' + JSON.stringify([1, 'a:' + JSON.stringify([detail]) + '\n']) + ');';
  const item = currentItem(capture({ authorVisible: false, rawScripts: [frame] }));
  assert.equal(item.mediaUrl, mediaA);
  assert.equal(item.mediaBinding.contentId, workA);
});

test('client-loaded same-work response supplies identity when the streaming shell has null aweme', () => {
  const item = currentItem(capture({ authorVisible: false,
    embedded: [{ awemeId: workA, aweme: null }],
    observedDetail: embeddedWork(workA, mediaA).aweme_detail }));
  assert.equal(item.mediaUrl, mediaA);
  assert.deepEqual(item.mediaBinding, { contentId: workA, profileUrl: author, source: 'detail_response' });
});

test('a response for a different work cannot fill an empty current-work shell', () => {
  const page = capture({ authorVisible: false, videos: [video(mediaB)],
    observedDetail: embeddedWork(workB, mediaB).aweme_detail });
  assert.equal(page.profile.profileUrl, '');
  assert.equal(page.items[0].mediaUrl, '');
});

test('matched response description supplies the title before the DOM title loads', () => {
  const item = currentItem(capture({ titleVisible: false, authorVisible: false,
    observedDetail: embeddedWork(workA, mediaA).aweme_detail }));
  assert.equal(item.title, '作品 A 的详情');
});

test('camel-case streaming detail supplies title and its own playAddr array', () => {
  const detail = { awemeId: workA, authorInfo: { secUid: 'abcdef', nickname: '作者 A' },
    desc: '流式详情的真实标题', createTime: 1700000000,
    video: { playAddr: [mediaA], dataSize: 100 } };
  const frame = 'self.__pace_f.push(' + JSON.stringify([1,
    'a:' + JSON.stringify([{ awemeId: workA, aweme: { detail } }]) + '\n']) + ');';
  const item = currentItem(capture({ titleVisible: false, authorVisible: false, rawScripts: [frame] }));
  assert.equal(item.title, detail.desc);
  assert.equal(item.mediaUrl, mediaA);
  assert.equal(item.mediaBinding.source, 'embedded_detail');
});

test('camel-case address object still rejects a foreign host and selects its own approved URL', () => {
  const detail = embeddedWork(workA, mediaA).aweme_detail;
  detail.video = { playAddr: { urlList: ['https://evil.test/file.mp4', mediaA] } };
  assert.equal(currentItem(capture({ embedded: [{ aweme_detail: detail }] })).mediaUrl, mediaA);
});

test('a wrong-work response cannot supply a missing title', () => {
  const page = capture({ titleVisible: false, authorVisible: false,
    observedDetail: embeddedWork(workB, mediaB).aweme_detail });
  assert.equal(page.items[0].title, '');
  assert.equal(page.items[0].mediaUrl, '');
});

test('retain bounded same-work official mirror addresses instead of just the first', () => {
  const detail = embeddedWork(workA, mediaA).aweme_detail;
  detail.video.play_addr.url_list = [mediaA, mediaA, 'https://evil.test/a',
    'https://v11.douyinvod.com/same-work.mp4', 'https://user:secret@v3.douyinvod.com/a'];
  const item = currentItem(capture({ observedDetail: detail }));
  assert.deepEqual(item.mediaCandidates, [mediaA, 'https://v11.douyinvod.com/same-work.mp4']);
  assert.equal(item.mediaUrl, item.mediaCandidates[0]);
  assert.ok(!currentItem(capture({ videos: [video(mediaB)] })).mediaCandidates?.length);
});
