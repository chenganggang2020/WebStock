const express = require('express');
const sentimentService = require('../services/sentimentService');

const router = express.Router();

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 500) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

router.get('/sentiment/overview', async function(req, res) {
  try {
    const data = await sentimentService.buildOverview({ refresh: req.query.refresh === '1' });
    ok(res, data);
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
