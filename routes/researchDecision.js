const express = require('express');
const decisionPackets = require('../services/decisionPacketService');
const paperPortfolios = require('../services/paperPortfolioService');
const paperTrading = require('../services/paperTradingService');
const paperMonitor = require('../services/paperMonitorService');
const tonghuashunHoldings = require('../services/tonghuashunHoldingService');
const quotes = require('../services/quoteService');

const router = express.Router();

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status) {
  res.status(status || error.status || 400).json({ success: false, error: error.message || String(error) });
}

function monitorErrorStatus(error) {
  const message = error && error.message || '';
  if (/同花顺持仓|本交易日|手动交接提示词/.test(message)) return 409;
  if (/行情不可用|network|timeout|ENOTFOUND|ECONN/i.test(message)) return 503;
  return 400;
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

router.post('/paper-portfolios/default-monitor', function(req, res) {
  try { ok(res, paperPortfolios.ensureDefaultMonitorPortfolio(req.body || {})); } catch (error) { fail(res, error); }
});

router.get('/paper-portfolios/:id', function(req, res) {
  try { ok(res, paperPortfolios.getPortfolio(req.params.id)); } catch (error) { fail(res, error, /不存在/.test(error.message) ? 404 : 400); }
});

router.put('/paper-portfolios/:id/status', function(req, res) {
  try { ok(res, paperPortfolios.updateStatus(req.params.id, req.body && req.body.status)); } catch (error) { fail(res, error); }
});

router.post('/paper-portfolios/:id/refresh', async function(req, res) {
  try {
    const paper = paperPortfolios.getPortfolio(req.params.id);
    if (paper.status !== 'active') throw new Error('只有“观察中”的纸面组合才能刷新净值');
    const hasMonitor = require('../db').prepare('SELECT 1 FROM paper_monitor_settings WHERE portfolio_id = ?').get(paper.id);
    if (hasMonitor) return ok(res, (await paperMonitor.execute(paper.id)).paper);
    const codes = Array.from(new Set(paper.items.concat(paper.positions).map(item => item.code)));
    const quoteResult = await quotes.fetchSinaQuotes(codes);
    ok(res, paperPortfolios.refreshPortfolio(paper.id, quoteResult.quotes, quoteResult));
  } catch (error) {
    fail(res, error, /timeout|network|ENOTFOUND|ECONN/i.test(error.message || '') ? 503 : 400);
  }
});

router.get('/paper-portfolios/:id/monitor', async function(req, res) {
  try {
    const state = paperTrading.getMonitorState(req.params.id);
    const tonghuashunStatus = state.settings.holdingsSyncRequired ? tonghuashunHoldings.getMonitorStatus() : { available: false, excluded: true };
    const handoff = paperMonitor.getPendingHandoff(req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    ok(res, Object.assign(state, {
      tonghuashunStatus,
      pendingHandoff: handoff ? { preparationId: handoff.preparationId, asOf: handoff.asOf, expiresAt: handoff.expiresAt } : null,
      readiness: await paperMonitor.getReadiness(req.params.id, { holdingStatus: tonghuashunStatus })
    }));
  } catch (error) {
    fail(res, error, /不存在/.test(error.message || '') ? 404 : 400);
  }
});

router.get('/paper-portfolios/:id/monitor/handoff', function(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const prepared = paperMonitor.getPendingHandoff(req.params.id);
    if (!prepared) throw new Error('没有有效的待回填提示词，可能已过期或已使用，请重新判断');
    ok(res, prepared);
  } catch (error) { fail(res, error, 409); }
});

router.post('/paper-portfolios/:id/monitor/check', async function(req, res) {
  try { ok(res, await paperMonitor.getReadiness(req.params.id, { checkQuotes: true })); }
  catch (error) { fail(res, error, monitorErrorStatus(error)); }
});

router.post('/paper-portfolios/:id/monitor/candidates', function(req, res) {
  try { ok(res, paperTrading.addMonitorCandidates(req.params.id, { codes: req.body && req.body.codes })); }
  catch (error) { fail(res, error); }
});

router.put('/paper-portfolios/:id/monitor/settings', function(req, res) {
  const { enabled, startMode, schedule, holdingsSyncRequired } = req.body || {};
  try { ok(res, paperTrading.updateMonitorSettings(req.params.id, { enabled, startMode, schedule, holdingsSyncRequired })); }
  catch (error) { fail(res, error); }
});

router.post('/paper-portfolios/:id/monitor/prepare', async function(req, res) {
  try { ok(res, await paperMonitor.prepare(req.params.id, {})); }
  catch (error) { fail(res, error, monitorErrorStatus(error)); }
});

router.post('/paper-portfolios/:id/monitor/run', async function(req, res) {
  try { ok(res, await paperMonitor.run(req.params.id, {})); }
  catch (error) { fail(res, error, monitorErrorStatus(error)); }
});

router.post('/paper-portfolios/:id/monitor/manual', function(req, res) {
  try { ok(res, paperMonitor.submitManual(req.params.id, req.body || {})); }
  catch (error) { fail(res, error, monitorErrorStatus(error)); }
});

router.post('/paper-portfolios/:id/monitor/execute', async function(req, res) {
  try { ok(res, await paperMonitor.execute(req.params.id, {})); }
  catch (error) { fail(res, error, monitorErrorStatus(error)); }
});

router.delete('/paper-portfolios/:id', function(req, res) {
  try { ok(res, { deleted: paperPortfolios.deletePortfolio(req.params.id) }); } catch (error) { fail(res, error); }
});

module.exports = router;
