const express = require('express');
const router = express.Router();
const knowledge = require('../services/knowledgeService');
const researchRuns = require('../services/researchRunService');
const modelRegistry = require('../services/modelRegistryService');
const expertChannels = require('../services/expertChannelService');
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
    ok(res, expertChannels.createChannel(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/expert/channels/:id', function(req, res) {
  try {
    ok(res, expertChannels.getChannel(Number(req.params.id)));
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

router.post('/expert/channels/:id/observations', function(req, res) {
  try {
    ok(res, expertChannels.recordObservation(Number(req.params.id), req.body || {}));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message) ? 404 : 400);
  }
});

router.post('/expert/channels/:id/intent-analysis', async function(req, res) {
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
    const report = await callAIModel(context.prompt);
    const run = researchRuns.createRun({
      runType: 'expert-intent-analysis',
      modelId: 'openai-direct',
      status: 'completed',
      title: context.channel.displayName + '观点与意图分析',
      question: context.question,
      prompt: context.prompt,
      result: report,
      evidence: context.evidence,
      request: { channelId: context.channel.id, observationCount: context.observationCount }
    });
    ok(res, Object.assign({}, context, { handoffMode: false, report, run }));
  } catch (error) {
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

    const report = await callAIModel(context.prompt);
    const run = researchRuns.createRun({
      runType: 'knowledge-analysis',
      modelId: 'openai-direct',
      status: 'completed',
      title: context.question,
      question: context.question,
      prompt: context.prompt,
      result: report,
      evidence: context.evidence,
      request: { mode: context.mode, query: context.query, engine: context.engine }
    });
    ok(res, Object.assign({}, context, { handoffMode: false, report, run }));
  } catch (error) {
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
