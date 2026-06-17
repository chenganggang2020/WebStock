const express = require('express');
const router = express.Router();

const stocksRouter = require('./stocks');
const marketRouter = require('./market');
const analysisRouter = require('./analysis');
const portfolioRouter = require('./portfolio');
const industryRouter = require('./industry');

router.use('/api', stocksRouter);
router.use('/api', marketRouter);
router.use('/api', analysisRouter);
router.use('/api/portfolio', portfolioRouter);
// 行业相关接口挂载在 /api/industry
router.use('/api/industry', industryRouter);

module.exports = router;
