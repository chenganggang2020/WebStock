const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'aiResearch.js'), 'utf8');
const registrySource = fs.readFileSync(path.join(__dirname, '..', 'services', 'modelRegistryService.js'), 'utf8');

function functionSource(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('AI research first load requests bounded metadata listings without full hash verification', () => {
  const loadQuant = functionSource('aiResearchLoadQuant');
  assert.match(loadQuant, /\/api\/quant\/results\?limit=20/);
  assert.match(loadQuant, /\/api\/quant\/factor-labs\?limit=20/);
  assert.doesNotMatch(loadQuant, /verification=full/);
  assert.doesNotMatch(registrySource, /verification\s*:\s*['"]full['"]/);
});

test('AI research distinguishes metadata checks from full content hash verification', () => {
  const verificationText = functionSource('quantVerificationText');
  const renderResult = functionSource('aiResearchRenderQuantResult');
  const renderFactor = functionSource('aiResearchRenderFactorLab');
  assert.match(verificationText, /完整内容哈希校验通过/);
  assert.match(verificationText, /未读取数据集文件，也未重算内容哈希/);
  assert.match(renderResult, /quantVerificationText\(entry\)/);
  assert.match(renderFactor, /quantVerificationText\(entry\)/);
});
