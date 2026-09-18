const express = require('express');
const router = express.Router();
const knowledge = require('../services/knowledgeService');
const researchRuns = require('../services/researchRunService');
const modelRegistry = require('../services/modelRegistryService');
const expertChannels = require('../services/expertChannelService');
const douyinSources = require('../services/douyinSourceService');
const douyinSyncState = require('../services/douyinSyncStateService');
const creatorMedia = require('../services/creatorMediaService');
const { buildAnalysisPacket } = require('../services/expertAnalysisPacketService');
const gptPickImports = require('../services/gptPickImportService');
const { isValidApiKey, getAIConfig, callAIModel } = require('./ai');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status) {
  res.status(status || error.status || 400).json({ success: false, error: error.message || String(error) });
}

router.get('/ai-models', function(req, res) {
  ok(res, modelRegistry.listModels());
});

router.get('/research-picks/latest', function(req, res) {
  try {
    ok(res, gptPickImports.getLatestManualPickImport());
  } catch (error) {
    fail(res, error);
  }
});

router.get('/research-picks/stock/:code', function(req, res) {
  try {
    ok(res, gptPickImports.listManualPickCandidateHistory(req.params.code, req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/research-picks', function(req, res) {
  try {
    ok(res, gptPickImports.listManualPickImports(req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/research-picks/import', function(req, res) {
  try {
    ok(res, gptPickImports.importManualPicks(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/knowledge/sources', function(req, res) {
  try {
    ok(res, knowledge.listSources(req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/knowledge/sources', function(req, res) {
  try {
    ok(res, knowledge.createSource(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/knowledge/sources/:id', function(req, res) {
  try {
    ok(res, knowledge.getSource(Number(req.params.id)));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.put('/knowledge/sources/:id', function(req, res) {
  try {
    ok(res, knowledge.updateSource(Number(req.params.id), req.body || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.delete('/knowledge/sources/:id', function(req, res) {
  try {
    ok(res, { deleted: knowledge.deleteSource(Number(req.params.id)) });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/expert/channels', function(req, res) {
  try {
    ok(res, expertChannels.listChannels(req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/expert/channels', function(req, res) {
  try {
    const channel = expertChannels.createChannel(req.body || {});
    if (channel.platform === 'douyin' && channel.profileUrl) douyinSyncState.ensureJob(channel.id, { enabled: channel.enabled, intervalMinutes: 10 });
    ok(res, channel);
  } catch (error) {
    fail(res, error);
  }
});

router.put('/expert/channels/:id', function(req, res) {
  try {
    const existing = expertChannels.getChannel(Number(req.params.id));
    const profile = String(req.body.profileUrl || existing.profileUrl).replace(/\/$/, '');
    if (existing.profileUrl && profile !== existing.profileUrl.replace(/\/$/, '')) {
      throw new Error('不同主页属于不同作者，请添加新作者，避免把原资料归给其他账号');
    }
    const channel = expertChannels.createChannel(Object.assign({}, existing, {
      displayName: req.body.displayName || existing.displayName, profileUrl: profile,
      enabled: req.body.enabled == null ? existing.enabled : req.body.enabled === true
    }));
    ok(res, channel);
  } catch (error) { fail(res, error); }
});

router.get('/expert/channels/:id', function(req, res) {
  try {
    ok(res, expertChannels.getChannel(Number(req.params.id)));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.delete('/expert/channels/:id', function(req, res) {
  try {
    ok(res, { deleted: expertChannels.deleteChannel(Number(req.params.id)) });
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.get('/expert/channels/:id/observations', function(req, res) {
  try {
    ok(res, expertChannels.listObservations(Number(req.params.id), req.query || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.post('/expert/channels/:id/analysis-packet', function(req, res) {
  try {
    const channel = expertChannels.getChannel(Number(req.params.id));
    const observations = expertChannels.listAnalysisObservations(channel.id, req.body || {}).map(function(item) {
      return Object.assign({}, item, {
        commentData: expertChannels.listObservationComments(channel.id, item.id, { limit: 200 })
      });
    });
    ok(res, buildAnalysisPacket(channel, observations, req.body || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.post('/expert/channels/:id/observations', function(req, res) {
  try {
    ok(res, expertChannels.recordObservation(Number(req.params.id), req.body || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.get('/expert/channels/:id/observations/:observationId/metrics', function(req, res) {
  try {
    ok(res, expertChannels.listObservationMetrics(Number(req.params.id), Number(req.params.observationId), req.query || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.get('/expert/channels/:id/observations/:observationId/comments', function(req, res) {
  try {
    ok(res, expertChannels.listObservationComments(
      Number(req.params.id), Number(req.params.observationId), req.query || {}
    ));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.get('/expert/channels/:id/observations/:observationId/media', function(req, res) {
  try {
    const observation = expertChannels.getObservation(req.params.id, req.params.observationId);
    const filename = creatorMedia.resolveVideo(observation);
    res.set('X-Content-Type-Options', 'nosniff').type('video/mp4');
    res.sendFile(filename, { acceptRanges: true, cacheControl: false }, function(error) {
      if (error && !res.headersSent) fail(res, new Error('视频文件暂不可读取'), 404);
    });
  } catch (_) { fail(res, new Error('视频未归档、文件缺失或不在允许的归档目录'), 404); }
});

router.get('/expert/channels/:id/observations/:observationId/cover', async function(req, res) {
  try {
    const observation = expertChannels.getObservation(req.params.id, req.params.observationId);
    const cover = await creatorMedia.getCover(observation);
    res.set('X-Content-Type-Options', 'nosniff').type(cover.type).sendFile(cover.filename);
  } catch (_) { fail(res, new Error('封面暂不可用，可补采视频详情'), 404); }
});

router.post('/expert/channels/:id/douyin-links', function(req, res) {
  try {
    ok(res, douyinSources.importDouyinLinks(Number(req.params.id), req.body || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.post('/expert/channels/:id/douyin-capture', function(req, res) {
  try {
    ok(res, douyinSources.importCapturedPage(Number(req.params.id), req.body || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.get('/expert/channels/:id/sync/runs', function(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const channelId = Number(req.params.id);
    expertChannels.getChannel(channelId);
    ok(res, douyinSyncState.listRuns(channelId, {
      limit: req.query.limit,
      date: req.query.date,
      includeItems: true
    }));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.get('/expert/channels/:id/sync', function(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    expertChannels.getChannel(Number(req.params.id));
    ok(res, douyinSyncState.getJob(Number(req.params.id)));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.put('/expert/channels/:id/sync', function(req, res) {
  try {
    const channel = expertChannels.getChannel(Number(req.params.id));
    if (channel.platform !== 'douyin') throw new Error('自动同步仅支持抖音创作者频道');
    ok(res, douyinSyncState.updateSettings(channel.id, req.body || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.delete('/expert/channels/:id/observations/:observationId', function(req, res) {
  try {
    ok(res, { deleted: expertChannels.deleteObservation(Number(req.params.id), Number(req.params.observationId)) });
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.post('/expert/channels/:id/intent-analysis', async function(req, res) {
  let run = null;
  try {
    const context = expertChannels.buildIntentContext(Number(req.params.id), req.body || {});
    const aiConfig = getAIConfig();
    if (!isValidApiKey(aiConfig && aiConfig.apiKey)) {
      ok(res, Object.assign({}, context, {
        handoffMode: true,
        summary: '已生成区分原话、转述和模型推断的 ChatGPT 交接提示词。'
      }));
      return;
    }
    const startedAt = Date.now();
    run = researchRuns.createRun({
      runType: 'expert-intent-analysis',
      modelId: 'openai-direct',
      status: 'pending',
      title: context.channel.displayName + '观点与意图分析',
      question: context.question,
      prompt: context.prompt,
      evidence: context.evidence,
      request: { channelId: context.channel.id, observationCount: context.observationCount }
    });
    const report = await callAIModel(context.prompt);
    run = researchRuns.updateRun(run.id, {
      status: 'completed', result: report, metrics: { elapsedMs: Date.now() - startedAt }
    });
    ok(res, Object.assign({}, context, { handoffMode: false, report, run }));
  } catch (error) {
    if (run) {
      try { researchRuns.failRun(run.id, error, 'model_call'); } catch (runError) {}
    }
    fail(res, error);
  }
});

router.get('/expert/channels/:id/backtests', function(req, res) {
  try {
    ok(res, expertChannels.listBacktests(Number(req.params.id), req.query || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.post('/knowledge/search', function(req, res) {
  try {
    ok(res, knowledge.search(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/knowledge/analyze', async function(req, res) {
  let run = null;
  try {
    const context = knowledge.buildAnalysisContext(req.body || {});
    if (!context.evidence.length) {
      const error = new Error('知识库中没有检索到匹配证据，请先补充来源或调整问题。');
      error.status = 400;
      throw error;
    }
    const aiConfig = getAIConfig();
    if (!isValidApiKey(aiConfig && aiConfig.apiKey)) {
      ok(res, Object.assign({}, context, {
        handoffMode: true,
        summary: '已生成带来源证据的 ChatGPT 交接提示词。'
      }));
      return;
    }

    const startedAt = Date.now();
    run = researchRuns.createRun({
      runType: 'knowledge-analysis',
      modelId: 'openai-direct',
      status: 'pending',
      title: context.question,
      question: context.question,
      prompt: context.prompt,
      evidence: context.evidence,
      request: { mode: context.mode, query: context.query, engine: context.engine }
    });
    const report = await callAIModel(context.prompt);
    run = researchRuns.updateRun(run.id, {
      status: 'completed', result: report, metrics: { elapsedMs: Date.now() - startedAt }
    });
    ok(res, Object.assign({}, context, { handoffMode: false, report, run }));
  } catch (error) {
    if (run) {
      try { researchRuns.failRun(run.id, error, 'model_call'); } catch (runError) {}
    }
    fail(res, error);
  }
});

router.get('/research-runs', function(req, res) {
  try {
    ok(res, researchRuns.listRuns(req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/research-runs', function(req, res) {
  try {
    ok(res, researchRuns.createRun(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/research-runs/:id', function(req, res) {
  try {
    ok(res, researchRuns.getRun(Number(req.params.id)));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.delete('/research-runs/:id', function(req, res) {
  try {
    ok(res, { deleted: researchRuns.deleteRun(Number(req.params.id)) });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
