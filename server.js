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

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, function () {
    console.log('Server started: http://localhost:' + PORT);
  });
}

module.exports = app;
