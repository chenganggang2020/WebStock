const express = require('express');
const { analyzeChart } = require('../services/chartAnalysisService');

const router = express.Router();
const MAX_BARS = 10000;
const MAX_PAYLOAD_BYTES = 3 * 1024 * 1024;

router.post('/chart-coach/analyze', function(req, res) {
  try {
    const input = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Array.isArray(input.bars)) throw new TypeError('bars must be an array');
    if (input.bars.length > MAX_BARS) throw new RangeError('bars must contain at most 10000 items');
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new RangeError('chart payload must not exceed 3 MiB');
    }
    res.json({ success: true, data: analyzeChart(input) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || String(error) });
  }
});

module.exports = router;
