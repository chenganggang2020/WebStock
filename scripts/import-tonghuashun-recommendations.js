const fs = require('fs');
const path = require('path');
const {
  buildRecommendationPlan,
  replaceRecommendationBlock
} = require('../services/tonghuashunRecommendationService');

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function findNewestFile(roots, filename) {
  const candidates = [];
  roots.forEach(function(root) {
    if (!fs.existsSync(root)) return;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { return; }
    entries.filter(entry => entry.isDirectory()).forEach(function(entry) {
      const candidate = path.join(root, entry.name, filename);
      if (fs.existsSync(candidate)) candidates.push(candidate);
    });
  });
  return candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || '';
}

function defaultBlockFile() {
  const roots = [
    path.join('D:\\Program Files (x86)', '同花顺远航版', 'bin', 'users'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], '同花顺远航版', 'bin', 'users'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, '同花顺远航版', 'bin', 'users')
  ].filter(Boolean);
  return findNewestFile(Array.from(new Set(roots)), 'blockstockV3.xml');
}

function timestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}

function writeSafely(filename, content) {
  const temp = filename + '.codex-' + process.pid + '.tmp';
  fs.writeFileSync(temp, content, 'utf8');
  try {
    fs.renameSync(temp, filename);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (cleanupError) {}
    throw error;
  }
}

function printPlan(plan, inputPath, xmlPath) {
  console.log(JSON.stringify({
    inputPath,
    xmlPath,
    groupName: plan.groupName,
    existingGroup: plan.existing,
    currentCount: plan.currentCodes.length,
    nextCount: plan.items.length,
    addedCodes: plan.addedCodes,
    removedCodes: plan.removedCodes,
    unchangedCodes: plan.unchangedCodes,
    groupsToRemove: plan.groupsToRemove
  }, null, 2));
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = path.resolve(argumentValue(args, '--input'));
  if (!argumentValue(args, '--input')) throw new Error('请提供 --input 推荐 JSON 文件');
  if (!fs.existsSync(inputPath)) throw new Error('推荐 JSON 文件不存在：' + inputPath);
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const xmlPathValue = argumentValue(args, '--xml') || defaultBlockFile();
  if (!xmlPathValue) throw new Error('未找到同花顺 blockstockV3.xml，请用 --xml 指定');
  const xmlPath = path.resolve(xmlPathValue);
  if (!fs.existsSync(xmlPath) || !fs.statSync(xmlPath).isFile()) throw new Error('同花顺 blockstockV3.xml 不可读：' + xmlPath);
  const original = fs.readFileSync(xmlPath, 'utf8');
  const items = Array.isArray(input) ? input : input.items;
  const plan = buildRecommendationPlan(original, items, {
    date: input.date,
    groupName: input.groupName
  });
  printPlan(plan, inputPath, xmlPath);

  if (!args.includes('--apply')) {
    console.log('预览模式：未修改同花顺文件。需要写入时请显式追加 --apply。');
    return;
  }
  const updated = replaceRecommendationBlock(original, plan);
  if (updated === original) {
    console.log('分组内容无变化：未写入。');
    return;
  }
  const backupPath = xmlPath + '.bak-' + timestamp();
  fs.copyFileSync(xmlPath, backupPath);
  writeSafely(xmlPath, updated);
  console.log(JSON.stringify({ applied: true, backupPath }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { defaultBlockFile, findNewestFile, writeSafely };
