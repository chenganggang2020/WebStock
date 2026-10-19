const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('page containers close in order and every workspace stays inside the main shell', () => {
  // Structural guard for this explicitly closed template, not a browser DOM parser.
  // Counting divs alone misses cross-nesting with section/article containers.
  const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  const stack = [];
  const problems = [];
  const views = [];
  const tokens = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<\/?([a-z][\w-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  for (const match of html.matchAll(tokens)) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    if (voidTags.has(tag)) continue;
    const line = html.slice(0, match.index).split('\n').length;
    if (match[0].startsWith('</')) {
      const top = stack.at(-1);
      if (!top || top.tag !== tag) problems.push(`line ${line}: ${match[0]} closes ${top ? top.tag + ' from line ' + top.line : 'nothing'}`);
      const index = stack.findLastIndex(entry => entry.tag === tag);
      if (index >= 0) stack.splice(index);
      continue;
    }
    const classes = (match[0].match(/\bclass="([^"]*)"/) || [])[1] || '';
    const id = (match[0].match(/\bid="([^"]*)"/) || [])[1] || '';
    if (classes.split(/\s+/).includes('main-view')) {
      views.push(id);
      if (!stack.at(-1)?.main) problems.push(`line ${line}: ${id} is outside the main shell`);
    }
    stack.push({ tag, line, main: classes.split(/\s+/).includes('main') });
  }
  assert.ok(views.includes('watchlistView'));
  assert.ok(views.includes('portfolioView'));
  assert.deepEqual(stack, [], 'all containers must be closed');
  assert.deepEqual(problems, [], problems.join('\n'));
});
