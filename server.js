const express = require('express');
const path = require('path');
const routes = require('./routes');
const { requireLanPairing } = require('./services/lanAccessService');

const { getAIEnabled, getAIConfig } = require('./routes/ai');

const app = express();

function rejectCrossOriginMutation(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin');
  const host = req.get('host');
  let sameOrigin = req.get('sec-fetch-site') !== 'cross-site';
  if (origin) {
    try {
      sameOrigin = sameOrigin && new URL(origin).origin === req.protocol + '://' + host;
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
  app.listen(PORT, function () {
    console.log('Server started: http://localhost:' + PORT);
  });
}

module.exports = app;
