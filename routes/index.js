const express = require('express');
const router = express.Router();

const stocksRouter = require('./stocks');
const marketRouter = require('./market');
const analysisRouter = require('./analysis');
const portfolioRouter = require('./portfolio');

router.use('/api', stocksRouter);
router.use('/api', marketRouter);
router.use('/api', analysisRouter);
router.use('/api/portfolio', portfolioRouter);

module.exports = router;
