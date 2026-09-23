const express = require('express');
const router = express.Router();
const screener = require('../services/screenerService');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

function normalizeLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 10;
  return Math.min(Math.max(Math.floor(limit), 1), 50);
}

function buildRecommendationInput(req) {
  const body = req.body || {};
  const query = req.query || {};
  return {
    strategy: body.strategy || query.strategy || 'stable',
    scope: body.scope || query.scope || 'all',
    demand: body.demand || query.demand || '',
    limit: normalizeLimit(body.limit || query.limit),
    marketSnapshot: Array.isArray(body.marketSnapshot) ? body.marketSnapshot : [],
    klineSnapshot: Array.isArray(body.klineSnapshot) ? body.klineSnapshot : []
  };
}

router.get('/recommendation', function(req, res) {
  try {
    ok(res, screener.runScreener(buildRecommendationInput(req)));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/recommendation', function(req, res) {
  try {
    ok(res, screener.runScreener(buildRecommendationInput(req)));
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
