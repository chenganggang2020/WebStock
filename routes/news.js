const express = require('express');
const router = express.Router();
const newsService = require('../services/newsService');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

router.get('/news', async function(req, res) {
  try {
    const filters = {
      type: req.query.type,
      code: req.query.code,
      name: req.query.name,
      sector: req.query.sector,
      keyword: req.query.keyword,
      source: req.query.source,
      cacheBust: req.query.cacheBust
    };
    if (req.query.withMeta === '1') {
      ok(res, await newsService.listNewsWithMetaAsync(filters));
      return;
    }
    ok(res, await newsService.listNewsAsync(filters));
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
