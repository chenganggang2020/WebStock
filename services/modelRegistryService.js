const db = require('../db');
const { getAIConfig, getAIEnabled, isValidApiKey } = require('../routes/ai');

function localFtsAvailable() {
  try {
    const row = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get();
    return !!(row && row.enabled);
  } catch (error) {
    return false;
  }
}

function listModels() {
  const aiConfig = getAIConfig();
  const hasKey = isValidApiKey(aiConfig && aiConfig.apiKey);
  const apiStatus = !getAIEnabled() ? 'unavailable' : hasKey ? 'configured' : 'not_configured';
  const apiReason = !getAIEnabled() ? 'AI 功能已在本机配置中关闭。'
    : hasKey ? 'API Key 已配置；首次真实调用成功后才能确认服务可用。'
      : '未配置独立 API Key，可继续使用 ChatGPT 交接模式。';
  const ftsAvailable = localFtsAvailable();

  return [
    {
      id: 'local-factor-v1',
      name: '本地可解释因子选股',
      kind: 'screener',
      status: 'available',
      runtime: 'Node.js / WebStock',
      costMode: 'local-free',
      capabilities: ['全市场去 ST', '技术与主题因子', '因子贡献', '保存与复核'],
      requirements: ['行情或 K 线覆盖越完整，技术因子越充分'],
      note: '当前已运行的规则模型，不等同于训练后的机器学习模型。'
    },
    {
      id: 'knowledge-fts-v1',
      name: '专家知识库检索',
      kind: 'retrieval',
      status: ftsAvailable ? 'available' : 'unavailable',
      runtime: 'SQLite FTS5 trigram',
      costMode: 'local-free',
      capabilities: ['中文模糊检索', '来源过滤', '稳定证据编号', '证据提示词'],
      requirements: ['先录入有来源的文本资料'],
      note: ftsAvailable ? '在本机数据库内运行，不上传知识正文。' : '当前 SQLite 运行时未启用 FTS5。'
    },
    {
      id: 'chatgpt-handoff',
      name: 'ChatGPT Pro 交接',
      kind: 'llm-handoff',
      status: 'available',
      runtime: 'System browser + clipboard',
      costMode: 'existing-subscription',
      capabilities: ['复制提示词', '打开 ChatGPT', '导入结果', '关联研究记录'],
      requirements: ['用户在系统浏览器登录 ChatGPT'],
      note: '不冒充 API，也不自动控制 ChatGPT 登录或发送。'
    },
    {
      id: 'openai-direct',
      name: 'OpenAI 兼容 API',
      kind: 'llm-api',
      status: apiStatus,
      runtime: aiConfig && aiConfig.model ? aiConfig.model : 'not configured',
      costMode: 'provider-billed',
      capabilities: ['应用内直接分析', '结构化研究结果'],
      requirements: ['独立 API Key', '可访问的 API endpoint'],
      note: apiReason
    },
    {
      id: 'qlib-lightgbm',
      name: 'Qlib + LightGBM 基线',
      kind: 'quant-model',
      status: 'planned',
      runtime: 'Python sidecar',
      costMode: 'local-compute',
      capabilities: ['因子数据集', '收益排名', '滚动回测', '基线比较'],
      requirements: ['独立 Python 环境', '有时间戳的数据清单', '无前视切分'],
      note: '作为第一个可复现机器学习基线，尚未在当前桌面进程部署。'
    },
    {
      id: 'master',
      name: 'MASTER 股票 Transformer',
      kind: 'quant-model',
      status: 'planned',
      runtime: 'Isolated Python/GPU experiment',
      costMode: 'local-compute',
      capabilities: ['市场状态门控', '跨股票与跨时间关系建模'],
      requirements: ['与基线一致的数据和标签', '兼容的 PyTorch/Qlib 环境', '样本外对照'],
      note: '官方仓库披露旧依赖和验证数据处理问题，只能先作为对照实验。'
    },
    {
      id: 'alphaagent',
      name: 'AlphaAgent 因子挖掘',
      kind: 'research-agent',
      status: 'planned',
      runtime: 'Isolated Python experiment',
      costMode: 'data-and-llm-dependent',
      capabilities: ['因子 DSL', '因子评估', '可选 LLM 因子生成'],
      requirements: ['完整日频 panel', '数据授权核验', '可选 LLM API'],
      note: '新因子必须通过重复度、复杂度和样本外稳定性门槛。'
    },
    {
      id: 'rd-agent-q',
      name: 'RD-Agent(Q)',
      kind: 'research-agent',
      status: 'planned',
      runtime: 'Linux + Docker sidecar',
      costMode: 'llm-and-compute',
      capabilities: ['因子与模型协同研发', '自动实验迭代'],
      requirements: ['Linux', 'Docker', '聊天模型', '向量模型', 'Qlib 数据'],
      note: '官方当前只支持 Linux，不作为 Windows 桌面启动依赖。'
    },
    {
      id: 'tradingagents',
      name: 'TradingAgents 深度投研',
      kind: 'llm-agent',
      status: 'planned',
      runtime: 'Python sidecar',
      costMode: 'multi-llm-calls',
      capabilities: ['基本面/技术面/资讯角色', '多空讨论', '风险汇总'],
      requirements: ['LLM provider', '可追溯金融数据', '调用成本上限'],
      note: '报告必须记录每个角色的数据截止时间、模型和证据。'
    },
    {
      id: 'finrl-x',
      name: 'FinRL-X 组合实验',
      kind: 'portfolio-model',
      status: 'planned',
      runtime: 'Python sidecar',
      costMode: 'local-compute',
      capabilities: ['目标权重', '组合回测', '风险覆盖', '纸面交易'],
      requirements: ['权重接口', '交易成本模型', '回测数据', '纸面账户'],
      note: '只规划回测和模拟交易，真实订单执行保持关闭。'
    }
  ];
}

function getModel(id) {
  return listModels().find(item => item.id === String(id || '')) || null;
}

module.exports = { listModels, getModel };
