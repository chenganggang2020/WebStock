const express = require('express');
const { createMarketInstitutionalFlowService } = require('../services/marketInstitutionalFlow');
const marketData = require('../services/marketDataService');
const { createPublicMinuteService } = require('../services/publicMinuteService');
const { createMarketInstitutionalIntradayService } = require('../services/marketInstitutionalIntradayService');

function createMarketInstitutionalFlowRouter(options = {}) {
  const service = options.service || createMarketInstitutionalFlowService(options.serviceOptions);
  const intradayService = options.intradayService || createMarketInstitutionalIntradayService({
    marketData,
    publicMinutes: createPublicMinuteService({ marketData })
  });
  const router = express.Router();

  router.get('/market/institutional-flow', async function(req, res) {
    try {
      const data = await service.getSnapshot({ force: String(req.query.refresh || '') === '1' });
      res.json({ success: true, data });
    } catch (error) {
      res.status(502).json({
        success: false,
        error: {
          code: error.code || 'MARKET_INSTITUTIONAL_FLOW_FAILED',
          message: error.message || String(error)
        }
      });
    }
  });

  router.get('/market/institutional-flow/intraday', async function(req, res) {
    try {
      const data = await intradayService.fetch({ force: String(req.query.refresh || '') === '1' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data });
    } catch (error) {
      res.status(502).json({
        success: false,
        error: {
          code: error.code || 'MARKET_INSTITUTIONAL_INTRADAY_FAILED',
          message: error.message || String(error)
        }
      });
    }
  });

  return router;
}

const router = createMarketInstitutionalFlowRouter();

module.exports = router;
module.exports.createMarketInstitutionalFlowRouter = createMarketInstitutionalFlowRouter;
