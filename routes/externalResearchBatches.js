const express = require('express');
const defaultService = require('../services/externalResearchBatchService');

function createExternalResearchBatchRouter(options) {
  options = options || {};
  const service = options.service || defaultService;
  const router = express.Router();

  function fail(res, error) {
    res.status(error && error.status || 500).json({ success: false, error: error && error.message || String(error) });
  }

  router.post('/external-research-batches', function(req, res) {
    try {
      const result = service.importBatch(req.body || {});
      res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/external-research-batches/latest-artifacts', function(req, res) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: service.listLatestArtifacts() });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/external-research-batches/:batchKey', function(req, res) {
    try {
      res.json({ success: true, data: service.getBatch(req.params.batchKey) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.post('/external-research-batches/:batchKey/deliveries/:target', function(req, res) {
    try {
      res.json({
        success: true,
        data: service.recordDelivery(req.params.batchKey, req.params.target, req.body && req.body.status, req.body && req.body.details)
      });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}

module.exports = createExternalResearchBatchRouter();
module.exports.createExternalResearchBatchRouter = createExternalResearchBatchRouter;
