const express = require('express');
const marketBoardService = require('../services/marketBoardService');
const { TAXONOMIES } = marketBoardService;

function createMarketBoardRouter(options) {
  options = options || {};
  const service = options.service || marketBoardService;
  const router = express.Router();

  function inputFor(req, includeQuery) {
    const taxonomy = String(req.query.taxonomy || 'all').trim().toLowerCase();
    if (taxonomy !== 'all' && !TAXONOMIES.includes(taxonomy)) {
      const error = new Error('Unsupported market board taxonomy');
      error.code = 'MARKET_BOARD_TAXONOMY_INVALID';
      throw error;
    }
    const input = { taxonomy, refresh: String(req.query.refresh || '') === '1' };
    if (includeQuery) input.query = String(req.query.q || '').trim().slice(0, 80);
    return input;
  }

  function fail(res, error) {
    const validationMessages = {
      MARKET_BOARD_TAXONOMY_INVALID: '板块分类参数无效',
      MARKET_BOARD_CODE_INVALID: '板块代码参数无效',
      MARKET_BOARD_REFRESH_INVALID: '刷新参数无效'
    };
    const validationMessage = error && validationMessages[error.code];
    const invalid = Boolean(validationMessage);
    res.status(invalid ? 400 : 502).json({
      success: false,
      error: {
        code: invalid ? error.code : 'MARKET_BOARD_DATA_UNAVAILABLE',
        message: invalid ? validationMessage : '板块公开数据暂不可用'
      }
    });
  }

  function constituentsInput(req) {
    const refresh = String(req.query.refresh || '').trim();
    if (refresh && refresh !== '0' && refresh !== '1') {
      const error = new Error('Invalid refresh flag');
      error.code = 'MARKET_BOARD_REFRESH_INVALID';
      throw error;
    }
    const normalized = marketBoardService.constituentInput({
      code: req.query.code,
      taxonomy: req.query.taxonomy,
      refresh: refresh === '1'
    });
    return { code: normalized.code, taxonomy: normalized.taxonomy, refresh: normalized.refresh };
  }

  router.get('/market/boards/catalog', async function(req, res) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.fetchCatalog(inputFor(req, true)) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/market/boards/snapshot', async function(req, res) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.fetchSnapshot(inputFor(req, false)) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/market/boards/constituents', async function(req, res) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.fetchConstituents(constituentsInput(req)) });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}

module.exports = createMarketBoardRouter();
module.exports.createMarketBoardRouter = createMarketBoardRouter;
