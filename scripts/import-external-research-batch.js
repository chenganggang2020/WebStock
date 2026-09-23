const fs = require('fs');
const path = require('path');
const batches = require('../services/externalResearchBatchService');
const currentTonghuashun = require('../services/tonghuashunCurrentAdapterService');
const { buildRecommendationPlan, replaceRecommendationBlock } = require('../services/tonghuashunRecommendationService');
const { defaultBlockFile, writeSafely } = require('./import-tonghuashun-recommendations');

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function timestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}

function planTonghuashun(validated, xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const picks = validated.normalized.artifacts[0].payload.picks
    .filter(function(item) { return item.includeInTonghuashun; });
  const plan = buildRecommendationPlan(xml, picks, { date: validated.normalized.asOf.marketDate });
  return { xml, plan, picks };
}

function execute(options) {
  const inputPath = path.resolve(options.inputPath || '');
  if (!options.inputPath || !fs.existsSync(inputPath)) throw new Error('请用 --input 指定存在的外部研究批次 JSON');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const validated = batches.validateBatch(input);
  let xmlPath = '';
  let preview = null;
  let currentPreview = null;
  if (validated.wantsTonghuashun) {
    if (options.thsConfigPath) {
      currentPreview = options.safeFile
        ? currentTonghuashun.planSafeFileDelivery(validated, options.thsConfigPath)
        : currentTonghuashun.planCurrentDelivery(validated, options.thsConfigPath);
    } else {
      const xmlValue = options.xmlPath || defaultBlockFile();
      if (!xmlValue) throw new Error('未找到同花顺当前格式配置，请用 --ths-config 指定；旧版客户端可继续用 --xml');
      xmlPath = path.resolve(xmlValue);
      if (!fs.existsSync(xmlPath) || !fs.statSync(xmlPath).isFile()) throw new Error('同花顺 blockstockV3.xml 不可读');
      preview = planTonghuashun(validated, xmlPath);
    }
  }
  const tonghuashunCount = currentPreview ? currentPreview.candidateCount : (preview ? preview.picks.length : 0);
  const tonghuashunGroup = currentPreview ? currentPreview.groupName : (preview ? preview.plan.groupName : null);
  const summary = {
    apply: Boolean(options.apply),
    batchKey: validated.batchKey,
    marketDate: validated.normalized.asOf.marketDate,
    webstockCandidateCount: validated.picks.length,
    tonghuashunCandidateCount: tonghuashunCount,
    tonghuashunGroup,
    tonghuashunAdapter: currentPreview ? currentPreview.adapter : (preview ? 'legacy-blockstock-v3-xml' : null),
    tonghuashunAddedCodes: currentPreview ? currentPreview.addedCodes : (preview ? preview.plan.addedCodes : []),
    tonghuashunRemovedCodes: currentPreview ? currentPreview.removedCodes : (preview ? preview.plan.removedCodes : []),
    tonghuashunNoChange: currentPreview ? currentPreview.noChange : false,
    automaticTrading: false
  };
  if (!options.apply) return Object.assign(summary, { mode: 'preview', wrote: false });

  const imported = batches.importBatch(input);
  if (currentPreview) {
    try {
      const delivery = currentTonghuashun.applyCurrentDelivery(validated, options.thsConfigPath, {
        skipNativeSync: options.skipNativeSync === true,
        mode: options.safeFile ? 'safe-file' : undefined
      });
      const deliveryStatus = delivery.noChange ? 'no-change' : delivery.cloudVerified === false ? 'pending' : 'succeeded';
      const batch = batches.recordDelivery(validated.batchKey, 'tonghuashun-watchlist', deliveryStatus, delivery);
      return Object.assign(summary, {
        mode: 'apply',
        wrote: delivery.applied === true,
        webstock: imported,
        batch,
        delivery
      });
    } catch (error) {
      try {
        batches.recordDelivery(validated.batchKey, 'tonghuashun-watchlist', 'failed', {
          adapter: currentPreview.adapter,
          error: String(error && error.message || error).slice(0, 1000)
        });
      } catch (recordError) {}
      throw error;
    }
  }
  if (!preview) return Object.assign(summary, { mode: 'apply', wrote: false, webstock: imported, batch: imported });
  try {
    const updated = replaceRecommendationBlock(preview.xml, preview.plan);
    if (updated === preview.xml) {
      const batch = batches.recordDelivery(validated.batchKey, 'tonghuashun-watchlist', 'no-change', {
        groupName: preview.plan.groupName,
        applied: false
      });
      return Object.assign(summary, { mode: 'apply', wrote: false, webstock: imported, batch });
    }
    const backupPath = xmlPath + '.bak-' + timestamp();
    fs.copyFileSync(xmlPath, backupPath);
    writeSafely(xmlPath, updated);
    const batch = batches.recordDelivery(validated.batchKey, 'tonghuashun-watchlist', 'succeeded', {
      groupName: preview.plan.groupName,
      applied: true,
      backupPath
    });
    return Object.assign(summary, { mode: 'apply', wrote: true, backupPath, webstock: imported, batch });
  } catch (error) {
    try {
      batches.recordDelivery(validated.batchKey, 'tonghuashun-watchlist', 'failed', {
        error: String(error && error.message || error).slice(0, 1000)
      });
    } catch (recordError) {}
    throw error;
  }
}

function main() {
  const args = process.argv.slice(2);
  const result = execute({
    inputPath: argumentValue(args, '--input'),
    xmlPath: argumentValue(args, '--xml'),
    thsConfigPath: argumentValue(args, '--ths-config'),
    skipNativeSync: args.includes('--skip-native-sync'),
    safeFile: args.includes('--safe-file'),
    apply: args.includes('--apply')
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { execute };
