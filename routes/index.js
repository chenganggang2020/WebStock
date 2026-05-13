const express = require('express');
const router = express.Router();

const stocksRouter = require('./stocks');
const marketRouter = require('./market');
const analysisRouter = require('./analysis');
const portfolioRouter = require('./portfolio');
const userRouter = require('./user');
const newsRouter = require('./news');
const sectorsRouter = require('./sectors');
const screenerRouter = require('./screener');
const recommendationRouter = require('./recommendation');
const hotMarketRouter = require('./hotMarket');
const themesRouter = require('./themes');

router.use('/api', stocksRouter);
router.use('/api', marketRouter);
router.use('/api', analysisRouter);
router.use('/api', userRouter);
router.use('/api', newsRouter);
router.use('/api', sectorsRouter);
router.use('/api', screenerRouter);
router.use('/api', recommendationRouter);
router.use('/api', hotMarketRouter);
router.use('/api', themesRouter);
router.use('/api/portfolio', portfolioRouter);

module.exports = router;
