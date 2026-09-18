const express = require('express');
const router = express.Router();
const quant = require('../services/quantService');
const { parseStrategyRule } = require('../services/strategyRuleService');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status) {
  res.status(status || error.status || 400).json({ success: false, error: error.message || String(error) });
}

router.get('/quant/runtime', async function(req, res) {
  try {
    ok(res, req.query.verify === '1' ? await quant.verifyRuntime() : quant.getRuntimeStatus());
  } catch (error) {
    fail(res, error);
  }
});

router.post('/quant/runtime/install', function(req, res) {
  try { ok(res, quant.startRuntimeInstall(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/runtime/link', async function(req, res) {
  try { ok(res, await quant.linkExistingRuntime(req.body || {})); } catch (error) { fail(res, error); }
});

router.get('/quant/datasets', function(req, res) {
  try { ok(res, quant.listDatasets(req.query.limit)); } catch (error) { fail(res, error); }
});

router.get('/quant/full-market-sync', function(req, res) {
  try { ok(res, quant.getFullMarketSyncStatus()); } catch (error) { fail(res, error); }
});

router.get('/quant/watchlist-groups', function(req, res) {
  try { ok(res, quant.listWatchlistResearchGroups()); } catch (error) { fail(res, error); }
});

router.get('/quant/results', function(req, res) {
  try { ok(res, quant.listResults(req.query.limit, { verification: req.query.verification })); } catch (error) { fail(res, error); }
});

router.get('/quant/factor-labs', function(req, res) {
  try { ok(res, quant.listFactorResults(req.query.limit, { verification: req.query.verification })); } catch (error) { fail(res, error); }
});

router.get('/quant/strategy-labs', function(req, res) {
  try { ok(res, quant.listStrategyResults(req.query.limit, { verification: req.query.verification })); } catch (error) { fail(res, error); }
});

router.get('/quant/signal-scans/readiness', function(req, res) {
  try { ok(res, quant.signalScanReadiness()); } catch (error) { fail(res, error); }
});

router.get('/quant/signal-scans', function(req, res) {
  try { ok(res, quant.listSignalScanResults(req.query.limit, { verification: req.query.verification })); } catch (error) { fail(res, error); }
});

router.get('/quant/strategy-daily', function(req, res) {
  try {
    ok(res, quant.getStrategyDailyReport({
      verification: req.query.verification,
      datasetId: req.query.datasetId,
      asOf: req.query.asOf,
      maxCandidates: req.query.limit
    }));
  } catch (error) { fail(res, error); }
});

router.get('/quant/strategy-daily/schedule', function(req, res) {
  try { ok(res, quant.getStrategyDailyScheduleStatus()); } catch (error) { fail(res, error); }
});

router.post('/quant/strategy-daily/schedule', function(req, res) {
  try { ok(res, quant.runScheduledStrategyDaily()); } catch (error) { fail(res, error); }
});

router.get('/quant/jobs', function(req, res) {
  try { ok(res, quant.listJobs(req.query.limit)); } catch (error) { fail(res, error); }
});

router.get('/quant/jobs/:id', function(req, res) {
  try { ok(res, quant.getJob(req.params.id)); } catch (error) { fail(res, error); }
});

router.delete('/quant/jobs/:id', function(req, res) {
  try { ok(res, { cancelled: quant.cancelJob(req.params.id) }); } catch (error) { fail(res, error); }
});

router.post('/quant/pilot', function(req, res) {
  try { ok(res, quant.startPilot(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/datasets/collect', function(req, res) {
  try { ok(res, quant.startCollection(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/full-market-sync', function(req, res) {
  try { ok(res, quant.startFullMarketSync(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/runs', function(req, res) {
  try { ok(res, quant.startRun(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/factor-labs', function(req, res) {
  try { ok(res, quant.startFactorLab(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/strategy-labs', function(req, res) {
  try { ok(res, quant.startStrategyLab(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/signal-scans', function(req, res) {
  try { ok(res, quant.startSignalScan(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/strategy-daily', function(req, res) {
  try { ok(res, quant.startStrategyDailySuite(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/watchlist-research', function(req, res) {
  try { ok(res, quant.startWatchlistResearch(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/strategy-rules/parse', function(req, res) {
  try { ok(res, parseStrategyRule(req.body && req.body.text)); } catch (error) { fail(res, error); }
});

router.post('/quant/expert-backtests', function(req, res) {
  try { ok(res, quant.startExpertBacktest(req.body || {})); } catch (error) { fail(res, error); }
});

router.post('/quant/research-suite', function(req, res) {
  try { ok(res, quant.startResearchSuite(req.body || {})); } catch (error) { fail(res, error); }
});

module.exports = router;
