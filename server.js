const express = require('express');
const path = require('path');
const routes = require('./routes');
const { requireLanPairing, requireMobileReadOnly, externalRequestProtocol, resolveSafeListenHost } = require('./services/lanAccessService');

const { getAIEnabled, getAIConfig } = require('./routes/ai');
const database = require('./db');
const { latestCacheTimestamp } = require('./routes/cache');
const packageInfo = require('./package.json');

const app = express();

function rejectCrossOriginMutation(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin');
  const host = req.get('host');
  let sameOrigin = req.get('sec-fetch-site') !== 'cross-site';
  if (origin) {
    try {
      sameOrigin = sameOrigin && new URL(origin).origin === externalRequestProtocol(req) + '://' + host;
    } catch (error) {
      sameOrigin = false;
    }
  }
  if (!sameOrigin) {
    return res.status(403).json({
      success: false,
      error: 'Cross-origin mutation request rejected'
    });
  }
  next();
}

app.use(requireLanPairing);
app.use(requireMobileReadOnly);
app.use(rejectCrossOriginMutation);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

['css', 'icons', 'js', 'vendor'].forEach(function (directory) {
  app.use('/' + directory, express.static(path.join(__dirname, directory), {
    fallthrough: false,
    index: false
  }));
});

app.get(['/', '/index.html'], function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/mobile.html', function (req, res) {
  res.sendFile(path.join(__dirname, 'mobile.html'));
});

app.get('/api/health', function(req, res) {
  try {
    database.prepare('SELECT 1 AS ok').get();
    const lastMarketTimestamp = latestCacheTimestamp();
    res.json({
      success: true,
      data: {
        status: 'ok',
        database: 'ok',
        version: packageInfo.version,
        uptimeSeconds: Math.floor(process.uptime()),
        checkedAt: new Date().toISOString(),
        lastMarketDataAt: lastMarketTimestamp ? new Date(lastMarketTimestamp).toISOString() : null
      }
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: 'Local database health check failed'
    });
  }
});

['manifest.webmanifest', 'sw.js', 'WebStock.png'].forEach(function (file) {
  app.get('/' + file, function (req, res) {
    res.sendFile(path.join(__dirname, file));
  });
});

app.use(routes);

app.get('/ai-status', function (req, res) {
  const config = getAIConfig();
  res.json({
    enabled: getAIEnabled(),
    provider: config ? config.provider : null,
    model: config ? config.model : null,
    hasApiKey: !!(config && config.apiKey)
  });
});

app.use('/api', function (req, res) {
  res.status(404).json({
    success: false,
    error: 'API not found: ' + req.originalUrl
  });
});

app.use(function (err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const isJsonParseError = err.type === 'entity.parse.failed';
  const message = isJsonParseError
    ? 'Invalid JSON body'
    : (status < 500 && err.message ? err.message : 'Server error');

  console.error('[Server] request failed:', err.message || err);
  res.status(status).json({
    success: false,
    error: message
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  const host = resolveSafeListenHost(process.env.WEBSTOCK_HOST, process.env.WEBSTOCK_LAN_TOKEN);
  const server = app.listen(PORT, host, function () {
    console.log('Server started: http://' + host + ':' + PORT);
  });
  const scheduler = require('./services/paperMonitorScheduler').createPaperMonitorScheduler();
  const tonghuashunHoldingScheduler = require('./services/tonghuashunHoldingScheduler').createTonghuashunHoldingScheduler();
  const industryResearchScheduler = require('./services/industryResearchScheduler').createIndustryResearchScheduler({ service: require('./services/industryResearchService') });
  const etfCore = require('./services/eastmoneyEtfDailyService');
  const etfDailyService = etfCore.getEastmoneyEtfDailyService();
  const etfDailyScheduler = require('./services/eastmoneyEtfDailyScheduler').createEastmoneyEtfDailyScheduler({ service: etfDailyService });
  scheduler.start();
  tonghuashunHoldingScheduler.start();
  industryResearchScheduler.start();
  etfDailyScheduler.start();
  const sectorRotation = require('./services/capitalFlow/sectorRotationService').getSectorRotationService();
  if (process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1') sectorRotation.start();
  const localQuoteSampler = require('./routes/market').localQuoteSampler;
  if (process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1' && process.env.WEBSTOCK_LOCAL_SAMPLING_AUTO !== '0') localQuoteSampler.start();
  server.on('close', function() {
    scheduler.stop();
    tonghuashunHoldingScheduler.stop();
    industryResearchScheduler.stop();
    etfDailyScheduler.stop();
    sectorRotation.stop();
    localQuoteSampler.stop();
  });
}

module.exports = app;
