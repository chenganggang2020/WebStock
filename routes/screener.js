const express = require('express');
const router = express.Router();
const screener = require('../services/screenerService');
const { isValidApiKey, getAIConfig, callAIModel } = require('./ai');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

router.post('/screener/run', function(req, res) {
  try {
    ok(res, screener.runScreener(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/screener/results', function(req, res) {
  try {
    ok(res, screener.listScreenerResults(req.query.limit));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/screener/review-summary', function(req, res) {
  try {
    ok(res, screener.getScreenerReviewSummary(req.query.limit));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/screener/results', function(req, res) {
  try {
    ok(res, screener.saveScreenerResult(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/screener/results/compare', function(req, res) {
  try {
    ok(res, screener.compareScreenerResults(req.query.baseId, req.query.headId));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/screener/results/:id/notes', function(req, res) {
  try {
    ok(res, screener.listScreenerCandidateNotes(Number(req.params.id)));
  } catch (error) {
    fail(res, error);
  }
});

router.put('/screener/results/:id/notes', function(req, res) {
  try {
    ok(res, screener.bulkUpsertScreenerCandidateNotes(Number(req.params.id), req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.put('/screener/results/:id/notes/:code', function(req, res) {
  try {
    ok(res, screener.upsertScreenerCandidateNote(Number(req.params.id), req.params.code, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/screener/results/:id/notes/:code', function(req, res) {
  try {
    ok(res, { deleted: screener.deleteScreenerCandidateNote(Number(req.params.id), req.params.code) });
  } catch (error) {
    fail(res, error);
  }
});

router.put('/screener/results/:id', function(req, res) {
  try {
    ok(res, screener.updateScreenerResult(Number(req.params.id), req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/screener/results/:id', function(req, res) {
  try {
    ok(res, { deleted: screener.deleteScreenerResult(Number(req.params.id)) });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/screener/ai-explain', async function(req, res) {
  try {
    const result = req.body && req.body.candidates ? req.body : screener.runScreener(req.body || {});
    const prompt = result.prompt || screener.buildPrompt(result);
    const aiConfig = getAIConfig();
    if (!isValidApiKey(aiConfig && aiConfig.apiKey)) {
      ok(res, {
        handoffMode: true,
        prompt,
        report: '未配置 OpenAI API Key，已生成 ChatGPT 交接提示词。',
        disclaimer: screener.DISCLAIMER
      });
      return;
    }
    ok(res, {
      handoffMode: false,
      prompt,
      report: await callAIModel(prompt),
      disclaimer: screener.DISCLAIMER
    });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
