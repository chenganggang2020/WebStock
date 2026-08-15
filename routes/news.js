const express = require('express');
const router = express.Router();
const newsService = require('../services/newsService');
const newsDiscoveryService = require('../services/newsDiscoveryService');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

function queryList(value) {
  return String(value || '')
    .split(',')
    .map(function(item) { return item.trim(); })
    .filter(Boolean);
}

router.get('/news/discovery', async function(req, res) {
  try {
    const codes = queryList(req.query.codes || req.query.code);
    const sectors = queryList(req.query.sectors || req.query.sector);
    const keywords = queryList(req.query.keywords || req.query.keyword);
    const result = await newsService.listNewsWithMetaAsync({
      type: req.query.type,
      code: codes[0],
      sector: sectors[0],
      keyword: req.query.keyword || keywords[0],
      source: req.query.source,
      days: req.query.days,
      pages: req.query.pages,
      num: req.query.num,
      cacheBust: req.query.cacheBust
    });
    ok(res, newsDiscoveryService.buildDiscoveryFeed({
      items: result.items.map(function(item) {
        if (item.imageUrl && !item.imageProvider) {
          return Object.assign({}, item, { imageProvider: item.source });
        }
        return item;
      }),
      sourceMeta: result.meta,
      query: {
        codes,
        sectors,
        keywords
      },
      limit: req.query.limit,
      timeRange: req.query.timeRange,
      withImage: req.query.withImage === '1',
      sort: req.query.sort
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/news', async function(req, res) {
  try {
    const filters = {
      type: req.query.type,
      code: req.query.code,
      name: req.query.name,
      sector: req.query.sector,
      keyword: req.query.keyword,
      source: req.query.source,
      days: req.query.days,
      pages: req.query.pages,
      num: req.query.num,
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
