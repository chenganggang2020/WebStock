const express = require('express');
const router = express.Router();

const level2 = require('../services/level2Service');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, fallbackStatus = 400) {
  const status = error.statusCode || fallbackStatus;
  res.status(status).json({ success: false, error: error.message || String(error) });
}

function requireCode(req, res) {
  const code = String(req.query.code || '').trim();
  if (!code) {
    fail(res, new Error('Missing code'));
    return null;
  }
  return code;
}

router.get('/level2/status', function (req, res) {
  ok(res, level2.getPublicStatus());
});

router.get('/level2/depth', async function (req, res) {
  const code = requireCode(req, res);
  if (!code) return;
  try {
    ok(res, await level2.getDepth(code));
  } catch (error) {
    fail(res, error, 502);
  }
});

router.get('/level2/trades', async function (req, res) {
  const code = requireCode(req, res);
  if (!code) return;
  try {
    ok(res, await level2.getTrades(code, {
      limit: req.query.limit
    }));
  } catch (error) {
    fail(res, error, 502);
  }
});

router.get('/level2/large-orders', async function (req, res) {
  const code = requireCode(req, res);
  if (!code) return;
  try {
    ok(res, await level2.getLargeOrderStats(code, {
      limit: req.query.limit,
      threshold: req.query.threshold
    }));
  } catch (error) {
    fail(res, error, 502);
  }
});

module.exports = router;
