const express = require('express');
const router = express.Router();
const dataHealth = require('../services/dataHealthService');

router.get('/data-health', function(req, res) {
  try {
    res.json({ success: true, data: dataHealth.getDataHealth() });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message || String(error) });
  }
});

module.exports = router;
