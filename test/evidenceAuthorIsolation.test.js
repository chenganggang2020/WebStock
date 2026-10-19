const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WEBSTOCK_DB_PATH = ':memory:';
const knowledge = require('../services/knowledgeService');
const library = require('../js/modules/evidenceLibrary');

test('generic platform titles become labelled excerpts without changing original source', () => {
  const raw = {title:'[原始来源 / 本人公开] 模型先生于20211009发布的作品', author:'模型先生', contentPreview:'今天谈一谈半导体景气变化。不要只看股价，还要看订单。'};
  const result = library.presentation(raw);
  assert.equal(result.title, '今天谈一谈半导体景气变化');
  assert.equal(result.titleBasis, '内容摘录');
  assert.match(raw.title, /20211009发布的作品/);
  assert.equal(library.presentation({title:raw.title}).title, '暂无可用标题');
});

test('real title remains preferred over body excerpt', () => {
  assert.equal(library.presentation({title:'模型先生：如何看待算力订单',author:'模型先生',contentPreview:'今天先看看天气'}).title,'如何看待算力订单');
});

test('exact author filtering keeps similar names and unspecified authors separate', () => {
  for (const author of ['模型先生','模型先生研究组','Fioona','']) knowledge.createSource({title:author+'资料',author,content:'不同来源的测试原文：'+(author || '没有作者的来源'),publishedAt:'2026-09-19T01:00:00Z'});
  const items = knowledge.listSources({authorExact:'模型先生',limit:500});
  assert.equal(items.length,1);
  assert.ok(items.every(source=>source.author==='模型先生'));
  assert.equal(knowledge.listSources({authorExact:''}).length,1);
  assert.deepEqual(knowledge.listAuthors().map(a=>a.author).sort(),['','Fioona','模型先生','模型先生研究组'].sort());
  assert.ok(items[0].contentPreview.startsWith('不同来源'));
  assert.equal(items[0].content,undefined);
});

test('author directory covers records beyond the loaded list limit', () => {
  assert.equal(knowledge.listSources({limit:1}).length,1);
  assert.equal(knowledge.listAuthors().length,4);
  assert.ok(knowledge.listAuthors().every(author=>author.count===1));
});
