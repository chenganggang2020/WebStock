const express = require('express');
const router = express.Router();

/**
 * 行业简报路由
 *
 * 这是一个示例实现，用于提供热门行业的简要信息、催化因素和资金关注度。
 * 在实际场景中可以替换为调用实时财经 API 或数据服务，动态计算热点行业和催化事件。
 */

// GET /api/industry/brief
// 返回一个热门行业列表，每个包含名称、摘要、催化因素和资金流向（亿元）
router.get('/brief', function (req, res) {
  // 静态示例数据。未来可以替换为来自网络的实时数据。
  const data = [
    {
      name: '半导体',
      summary: '芯片行业受到国产替代和 AI 算力需求提升的双重驱动，景气度上行。',
      catalysts: '政策扶持、人工智能和汽车电子需求增加',
      fundFlow: 12.5
    },
    {
      name: '光伏',
      summary: '光伏产业链整体盈利回升，海外需求持续强劲，龙头企业市占率提升。',
      catalysts: '欧盟可再生能源目标提升、美中大基地项目推进、成本持续下降',
      fundFlow: 8.2
    },
    {
      name: '券商',
      summary: '市场活跃度提高，券商业绩回暖，政策鼓励并购重组和资本市场改革。',
      catalysts: '注册制深化、并购重组提速、IPO 发行节奏加快',
      fundFlow: 5.6
    }
  ];
  res.json(data);
});

module.exports = router;
