const DEFAULT_GROUP_PREFIX = '00_每日荐股_';

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function defaultRecommendationGroupName(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('荐股日期必须使用 YYYY-MM-DD 格式');
  return DEFAULT_GROUP_PREFIX + match[2] + match[3];
}

function inferMarket(code) {
  if (/^(5|56|51)/.test(code)) return 'USHJ';
  if (/^(15|16)/.test(code)) return 'USZJ';
  if (/^(6|68)/.test(code)) return 'USHA';
  return 'USZA';
}

function normalizeRecommendationItems(items) {
  if (!Array.isArray(items)) throw new Error('荐股输入必须是 items 数组');
  const seen = new Set();
  return items.map(function(item) {
    const code = String(item && item.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('荐股代码必须是六位数字：' + code);
    if (seen.has(code)) return null;
    seen.add(code);
    return {
      code,
      name: String(item && item.name || code).trim() || code,
      market: String(item && item.market || inferMarket(code)).trim(),
      tier: String(item && (item.tier || item.priority) || '').trim()
    };
  }).filter(Boolean);
}

function blockPattern(groupName) {
  return new RegExp('<Block\\b[^>]*\\bname="' + escapeXml(groupName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>[\\s\\S]*?<\\/Block>', 'i');
}

function blockCodes(blockText) {
  const codes = [];
  const seen = new Set();
  const pattern = /<security\b[^>]*\bcode="(\d{6})"[^>]*\/>/gi;
  let match;
  while ((match = pattern.exec(blockText))) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      codes.push(match[1]);
    }
  }
  return codes;
}

function recommendationBlocks(xml) {
  const blocks = [];
  const pattern = /<Block\b[^>]*\bname="(00_每日荐股_(\d{4}))"[^>]*>[\s\S]*?<\/Block>/gi;
  let match;
  while ((match = pattern.exec(String(xml || '')))) {
    blocks.push({ name: match[1], dateCode: Number(match[2]), text: match[0] });
  }
  return blocks;
}

function buildRecommendationPlan(xml, items, options = {}) {
  const groupName = String(options.groupName || defaultRecommendationGroupName(options.date)).trim();
  if (!groupName) throw new Error('荐股分组名不能为空');
  const normalizedItems = normalizeRecommendationItems(items);
  const match = String(xml || '').match(blockPattern(groupName));
  const currentCodes = match ? blockCodes(match[0]) : [];
  const nextCodes = normalizedItems.map(item => item.code);
  const currentSet = new Set(currentCodes);
  const nextSet = new Set(nextCodes);
  const groupNames = new Set(recommendationBlocks(xml).map(block => block.name));
  groupNames.add(groupName);
  const groupsToRemove = Array.from(groupNames)
    .sort((left, right) => Number(left.slice(-4)) - Number(right.slice(-4)))
    .slice(0, Math.max(0, groupNames.size - 3));
  return {
    groupName,
    items: normalizedItems,
    currentCodes,
    addedCodes: nextCodes.filter(code => !currentSet.has(code)),
    removedCodes: currentCodes.filter(code => !nextSet.has(code)),
    unchangedCodes: nextCodes.filter(code => currentSet.has(code)),
    existing: !!match,
    groupsToRemove
  };
}

function nextBlockId(xml) {
  let maxId = 0;
  const pattern = /<Block\b[^>]*\bid="(\d+)"[^>]*>/gi;
  let match;
  while ((match = pattern.exec(xml))) maxId = Math.max(maxId, Number(match[1]));
  return String(maxId + 1);
}

function renderBlock(plan, id) {
  const lines = plan.items.map(item =>
    '    <security market="' + escapeXml(item.market) + '" code="' + item.code + '" />'
  );
  return '  <Block name="' + escapeXml(plan.groupName) + '" id="' + id + '" IsLock="false">\n' +
    lines.join('\n') + '\n' +
    '  </Block>';
}

function orderRecommendationGroupsLatestFirst(xml) {
  const source = String(xml || '');
  const pattern = /<Block\b[^>]*\bname="00_每日荐股_(\d{4})"[^>]*>[\s\S]*?<\/Block>/gi;
  const blocks = [];
  let match;
  while ((match = pattern.exec(source))) {
    blocks.push({ dateCode: Number(match[1]), text: match[0] });
  }
  if (blocks.length < 2) return source;
  blocks.sort((left, right) => right.dateCode - left.dateCode);
  let first = true;
  const marker = '__CODEX_DAILY_RECOMMENDATION_GROUPS__';
  const withMarker = source.replace(pattern, function() {
    if (first) {
      first = false;
      return marker;
    }
    return '';
  });
  return withMarker.replace(marker, blocks.map(block => block.text).join('\n'));
}

function replaceRecommendationBlock(xml, plan) {
  const source = String(xml || '');
  const pattern = blockPattern(plan.groupName);
  const match = source.match(pattern);
  let updatedSource = source;
  if (match) {
    const original = match[0];
    const opening = original.match(/<Block\b[^>]*>/i)[0];
    const indentMatch = original.match(/^(\s*)<Block\b/i);
    const indent = indentMatch ? indentMatch[1] : '  ';
    const lines = plan.items.map(item =>
      indent + '  <security market="' + escapeXml(item.market) + '" code="' + item.code + '" />'
    );
    const updated = indent + opening + '\n' + lines.join('\n') + '\n' + indent + '</Block>';
    updatedSource = source.replace(pattern, updated);
  } else {
    const closeIndex = source.lastIndexOf('</hevo>');
    if (closeIndex < 0) throw new Error('同花顺分组文件缺少 hevo 根节点');
    const block = renderBlock(plan, nextBlockId(source));
    const before = source.slice(0, closeIndex).replace(/\s*$/, '');
    const after = source.slice(closeIndex);
    updatedSource = before + '\n' + block + '\n' + after;
  }

  (plan.groupsToRemove || []).forEach(function(groupName) {
    updatedSource = updatedSource.replace(blockPattern(groupName), '');
  });
  return orderRecommendationGroupsLatestFirst(updatedSource);
}

module.exports = {
  defaultRecommendationGroupName,
  buildRecommendationPlan,
  replaceRecommendationBlock,
  normalizeRecommendationItems,
  orderRecommendationGroupsLatestFirst
};
