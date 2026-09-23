const express = require('express');
const router = express.Router();
const themeService = require('../services/themeService');
const stockProfileService = require('../services/stockProfileService');

function ok(res, data) {
  res.json({ success: true, data });
}

router.get('/themes/search', function(req, res) {
  ok(res, themeService.searchThemes(req.query.q || req.query.keyword || ''));
});

router.get('/stock-tags', async function(req, res, next) {
  const codes = String(req.query.codes || '')
    .split(',')
    .map(function(code) { return code.trim(); })
    .filter(Boolean);
  try {
    ok(res, await stockProfileService.getProfiles(codes, {
      detail: req.query.detail === '1',
      refresh: req.query.refresh === '1',
      limit: req.query.limit
    }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
