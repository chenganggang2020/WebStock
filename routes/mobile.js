const express = require('express');
const { loadMobileSnapshot } = require('../services/mobileSnapshotService');
const { getMobilePushService } = require('../services/mobilePushService');

const router = express.Router();

router.get('/mobile/snapshot', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: await loadMobileSnapshot() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

router.get('/mobile/push/status', function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: getMobilePushService().publicStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

router.post('/mobile/push/subscription', function(req, res) {
  try {
    const data = getMobilePushService().subscribe(req.body && req.body.subscription, req.get('user-agent'));
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || String(error) });
  }
});

router.delete('/mobile/push/subscription', function(req, res) {
  try {
    const data = getMobilePushService().unsubscribe(req.body && req.body.endpoint);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || String(error) });
  }
});

router.post('/mobile/push/test', async function(req, res) {
  try {
    res.json({ success: true, data: await getMobilePushService().sendTest(req.body && req.body.endpoint) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || String(error) });
  }
});

module.exports = router;
