const express = require('express');
const router = express.Router();
const themeService = require('../services/themeService');

function ok(res, data) {
  res.json({ success: true, data });
}

router.get('/themes/search', function(req, res) {
  ok(res, themeService.searchThemes(req.query.q || req.query.keyword || ''));
});

router.get('/stock-tags', function(req, res) {
  const codes = String(req.query.codes || '')
    .split(',')
    .map(function(code) { return code.trim(); })
    .filter(Boolean);
  ok(res, themeService.tagStocks(codes));
});

module.exports = router;
