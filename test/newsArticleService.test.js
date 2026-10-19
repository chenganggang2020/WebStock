const test = require('node:test');
const assert = require('node:assert/strict');
const { createNewsArticleService, articleUrl, extractArticle } = require('../services/newsArticleService');
const {fetchPublicPage,resolveArticleAddress} = require('../services/newsArticleService');
const url = 'https://finance.sina.com.cn/stock/2026-09-19/doc-example.shtml';
const html = '<nav>广告导航</nav><div id="artibody"><p>第一段公开新闻内容与来源事实说明。</p><div><p>第二段包含更多背景资料和明确的信息。</p></div><script>恶意脚本</script><p>&lt;b&gt;不是标签&lt;/b&gt;。</p></div><p>页尾推荐</p>';
test('extract only the article container as plain paragraphs', () => {
  const result = extractArticle(html);
  assert.equal(result.length, 3);
  assert.equal(result[2], '<b>不是标签</b>。');
  assert.doesNotMatch(result.join(''), /导航|脚本|页尾/);
  assert.deepEqual(extractArticle('<p>登录后阅读，网页摘要</p>'), []);
});
test('article URL policy rejects private, credential and unrelated hosts', () => {
  for (const value of ['http://finance.sina.com.cn/a', 'https://finance.sina.com.cn.evil.test/a', 'https://127.0.0.1/a', 'https://u:p@finance.sina.com.cn/a', 'https://finance.sina.com.cn:3000/a']) {
    assert.throws(() => articleUrl(value));
  }
  assert.equal(articleUrl(url), url);
});
test('public body is cached and simultaneous same-url reads share one request', async () => {
  let calls = 0;
  const service = createNewsArticleService({ fetchPage: async () => { calls++; return { html, finalUrl:url }; } });
  const results = await Promise.all([service.read(url), service.read(url)]);
  assert.equal(results[0].status, 'available');
  assert.equal(calls, 1);
  assert.equal((await service.read(url)).cached, true);
  assert.equal(calls, 1);
});
test('unavailable extraction is not replaced with a fabricated or summary body', async () => {
  const service = createNewsArticleService({ fetchPage: async () => ({html:'<p>需要登录</p>',finalUrl:url}) });
  const result = await service.read(url);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.paragraphs, []);
});
test('TUN fake addresses can resolve through HTTPS but the final address stays public', async () => {
  const lookup = async () => [{address:'198.18.0.2',family:4}];
  const result = await resolveArticleAddress('finance.sina.com.cn',{lookup,resolveHttps:async () => [{address:'1.2.3.4',family:4}]});
  assert.equal(result.address, '1.2.3.4');
  await assert.rejects(resolveArticleAddress('finance.sina.com.cn',{lookup,resolveHttps:async () => [{address:'127.0.0.1',family:4}]}), /non-public/);
});
test('private DNS addresses cannot reach the network, and are not treated as TUN', async () => {
  let requests=0, fallbacks=0;
  await assert.rejects(fetchPublicPage(url,{lookup:async () => [{address:'10.0.0.1',family:4}],resolveHttps:async()=>{fallbacks++;},request:async()=>{requests++;}}), /non-public/);
  assert.equal(requests,0); assert.equal(fallbacks,0);
});
test('redirects to another host are rejected before the second request', async () => {
  let requests=0;
  await assert.rejects(fetchPublicPage(url,{lookup:async () => [{address:'1.2.3.4',family:4}],request:async()=>{requests++;return {statusCode:302,headers:{location:'https://evil.example/article'}};}}), /不支持/);
  assert.equal(requests,1);
});
test('whole request including DNS is bounded', async () => {
  await assert.rejects(fetchPublicPage(url,{timeoutMs:20,lookup:()=>new Promise(()=>{})}), /超时/);
});
test('unrelated article concurrency is capped while duplicate requests share work', async () => {
  const finish=[];
  const service=createNewsArticleService({fetchPage:requested=>new Promise(resolve=>finish.push(()=>resolve({html,finalUrl:requested})))});
  const work=[1,2,3,4].map(n=>service.read(url+'?n='+n));
  const fifth=await service.read(url+'?n=5');
  assert.equal(fifth.status,'unavailable');assert.match(fifth.message,/稍后/);
  finish.forEach(done=>done());await Promise.all(work);
});
