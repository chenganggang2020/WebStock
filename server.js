const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const { getAIEnabled, getAIConfig } = require('./routes/ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

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
