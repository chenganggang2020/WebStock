const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const { getAIEnabled, getAIConfig } = require('./routes/ai');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

app.use(routes);

app.get('/ai-status', function (req, res) {
  res.json({
    enabled: getAIEnabled(),
    model: getAIConfig() ? getAIConfig().model : null
  });
});

const PORT = 3000;
app.listen(PORT, function () {
  console.log('Server started: http://localhost:' + PORT);
});
