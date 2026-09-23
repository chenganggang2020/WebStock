const express = require('express');
const router = express.Router();
const hotMarket = require('../services/hotMarketService');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

router.get('/hot-market/overview', async function(req, res) {
  try {
    ok(res, await hotMarket.getOverview({
      refresh: req.query.refresh === '1',
      fast: req.query.fast === '1'
    }));
  } catch (error) {
    fail(res, error, 500);
  }
});

router.get('/hot-market/snapshots', function(req, res) {
  try {
    ok(res, hotMarket.listSnapshots(req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/hot-market/ai-result', function(req, res) {
  try {
    ok(res, hotMarket.saveAiResult(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
