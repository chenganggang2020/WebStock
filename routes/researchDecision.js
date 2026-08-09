const express = require('express');
const decisionPackets = require('../services/decisionPacketService');
const paperPortfolios = require('../services/paperPortfolioService');

const router = express.Router();

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status) {
  res.status(status || error.status || 400).json({ success: false, error: error.message || String(error) });
}

router.post('/decision-packets', async function(req, res) {
  try { ok(res, await decisionPackets.buildDecisionPacket(req.body || {})); } catch (error) { fail(res, error); }
});

router.get('/paper-portfolios', function(req, res) {
  try { ok(res, paperPortfolios.listPortfolios(req.query.limit)); } catch (error) { fail(res, error); }
});

router.post('/paper-portfolios', function(req, res) {
  try { ok(res, paperPortfolios.createFromPacket(req.body || {})); } catch (error) { fail(res, error); }
});

router.get('/paper-portfolios/:id', function(req, res) {
  try { ok(res, paperPortfolios.getPortfolio(req.params.id)); } catch (error) { fail(res, error, /不存在/.test(error.message) ? 404 : 400); }
});

router.put('/paper-portfolios/:id/status', function(req, res) {
  try { ok(res, paperPortfolios.updateStatus(req.params.id, req.body && req.body.status)); } catch (error) { fail(res, error); }
});

router.delete('/paper-portfolios/:id', function(req, res) {
  try { ok(res, { deleted: paperPortfolios.deletePortfolio(req.params.id) }); } catch (error) { fail(res, error); }
});

module.exports = router;
