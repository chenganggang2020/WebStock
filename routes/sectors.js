const express = require('express');
const router = express.Router();
const sectors = require('../services/sectorService');
const { isValidApiKey, getAIConfig, callAIModel } = require('./ai');
const { appendOneClickOutputInstructions } = require('../services/handoffFormat');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

router.get('/sectors', function(req, res) {
  try {
    ok(res, sectors.listSectors());
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sectors', function(req, res) {
  try {
    ok(res, sectors.createSector(req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.put('/sectors/:id', function(req, res) {
  try {
    ok(res, sectors.updateSector(Number(req.params.id), req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/sectors/:id', function(req, res) {
  try {
    ok(res, { deleted: sectors.deleteSector(Number(req.params.id)) });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/sectors/:id/leaders', function(req, res) {
  try {
    ok(res, sectors.listLeaders(Number(req.params.id)));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sectors/:id/leaders', function(req, res) {
  try {
    ok(res, sectors.createLeader(Number(req.params.id), req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.put('/sector-leaders/:id', function(req, res) {
  try {
    ok(res, sectors.updateLeader(Number(req.params.id), req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/sector-leaders/:id', function(req, res) {
  try {
    ok(res, { deleted: sectors.deleteLeader(Number(req.params.id)) });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/sector-leaders/dashboard', async function(req, res) {
  try {
    ok(res, await sectors.getDashboard());
  } catch (error) {
    fail(res, error);
  }
});

router.get('/sector-leaders/snapshots', function(req, res) {
  try {
    ok(res, sectors.listLeaderSnapshots(req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/sector-leaders/snapshots', function(req, res) {
  try {
    ok(res, sectors.pruneLeaderSnapshots(req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/sector-leaders/trends', function(req, res) {
  try {
    ok(res, sectors.getLeaderTrends(req.query || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/sector-config', function(req, res) {
  try {
    ok(res, sectors.exportSectorConfig());
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sector-config/import', function(req, res) {
  try {
    ok(res, sectors.importSectorConfig(req.body && req.body.config ? req.body.config : req.body, {
      mode: req.body && req.body.mode
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/sector-leaders/ai-analysis', async function(req, res) {
  try {
    const dashboard = await sectors.getDashboard();
    const prompt = appendOneClickOutputInstructions(
      `你是一名谨慎的股票板块研究助手。请基于以下板块龙头监控数据，分析板块强弱、龙头持续性、风险点和后续观察项。不要承诺收益，不要给出真实下单指令，必须包含免责声明。\n\n${JSON.stringify(dashboard, null, 2)}`,
      {
        title: '板块龙头分析结果',
        sections: [
          '板块强弱：列出当前最强、分歧、退潮板块。',
          '龙头持续性：总龙头、趋势龙头、容量龙头、补涨观察。',
          '风险点：高位、缩量、断板、板块退潮或消息兑现。',
          '后续观察：明日需要验证的量能、连板、资金和消息。',
          '免责声明：仅供研究复盘，不构成投资建议。'
        ]
      }
    );
    const aiConfig = getAIConfig();
    if (!isValidApiKey(aiConfig && aiConfig.apiKey)) {
      ok(res, {
        handoffMode: true,
        prompt,
        report: '未配置 OpenAI API Key，已生成 ChatGPT 交接提示词。'
      });
      return;
    }
    ok(res, {
      handoffMode: false,
      prompt,
      report: await callAIModel(prompt)
    });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
