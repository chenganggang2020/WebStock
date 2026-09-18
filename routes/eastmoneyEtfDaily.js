const express = require('express');
const { getEastmoneyEtfDailyService } = require('../services/eastmoneyEtfDailyService');

function createEastmoneyEtfDailyRouter(options = {}) {
  const service = options.service || getEastmoneyEtfDailyService();
  const router = express.Router();
  router.get('/market/etf-daily-report', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: service.latest() });
  });
  router.post('/market/etf-daily-report/refresh', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ success: true, data: await service.refresh() });
    } catch (error) {
      res.status(502).json({ success: false, error: {
        code: error.code || 'EASTMONEY_ETF_DAILY_FAILED', message: error.message
      } });
    }
  });
  return router;
}
module.exports = createEastmoneyEtfDailyRouter();
module.exports.createEastmoneyEtfDailyRouter = createEastmoneyEtfDailyRouter;
