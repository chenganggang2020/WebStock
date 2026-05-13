const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const backupService = require('../services/backupService');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

router.get('/user/recent-stocks', function(req, res) {
  try {
    ok(res, userService.listRecentStocks(req.query.limit));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/recent', function(req, res) {
  try {
    ok(res, userService.listRecentStocks(req.query.limit));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/user/recent-stocks', function(req, res) {
  try {
    ok(res, userService.upsertRecentStock(req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/recent', function(req, res) {
  try {
    ok(res, userService.upsertRecentStock(req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/user/recent-stocks/:code', function(req, res) {
  try {
    ok(res, { deleted: userService.deleteRecentStock(req.params.code) });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/recent/:code', function(req, res) {
  try {
    ok(res, { deleted: userService.deleteRecentStock(req.params.code) });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/user/recent-stocks', function(req, res) {
  try {
    ok(res, { deleted: userService.clearRecentStocks() });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/recent', function(req, res) {
  try {
    ok(res, { deleted: userService.clearRecentStocks() });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/user/export', function(req, res) {
  try {
    ok(res, backupService.exportUserData());
  } catch (error) {
    fail(res, error);
  }
});

router.post('/user/import', function(req, res) {
  try {
    const payload = req.body && req.body.backup ? req.body.backup : req.body;
    ok(res, backupService.importUserData(payload, { mode: req.body && req.body.mode }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/user/import-preview', function(req, res) {
  try {
    const payload = req.body && req.body.backup ? req.body.backup : req.body;
    ok(res, backupService.previewUserDataImport(payload));
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
