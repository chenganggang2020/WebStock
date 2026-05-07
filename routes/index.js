const express = require('express');
const router = express.Router();

const stocksRouter = require('./stocks');
const marketRouter = require('./market');
const analysisRouter = require('./analysis');

router.use('/api', stocksRouter);
router.use('/api', marketRouter);
router.use('/api', analysisRouter);

module.exports = router;
