const db = require('../db');
const { getAIConfig, getAIEnabled, isValidApiKey } = require('../routes/ai');
const quant = require('./quantService');

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
  const quantRuntime = quant.getRuntimeStatus();
  const quantResults = quant.listResults(50).filter(item => item.valid && item.result);
  const latestQuantEntry = quantResults.find(item => !String(item.result.modelId || '').includes('master'));
  const latestQuantResult = latestQuantEntry ? latestQuantEntry.result : null;
  const latestMasterEntry = quantResults.find(item => String(item.result.modelId || '').includes('master'));
  const latestMasterResult = latestMasterEntry ? latestMasterEntry.result : null;
  const latestFactorEntry = quant.listFactorResults(20).find(item => item.valid && item.result);
  const latestFactorResult = latestFactorEntry ? latestFactorEntry.result : null;
  const latestQuantStatus = latestQuantResult && latestQuantResult.validationStatus === 'validated'
    ? '已验证'
    : '探索性';
  const paperPortfolioCount = db.prepare('SELECT COUNT(*) AS count FROM paper_portfolios').get().count;
  const paperSnapshotCount = db.prepare('SELECT COUNT(*) AS count FROM paper_portfolio_snapshots').get().count;

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
      id: 'local-factor-lab-v1',
      name: '本地因子研究门禁',
      kind: 'research-agent',
      status: ['available', 'configured'].includes(quantRuntime.status) ? quantRuntime.status : 'not_configured',
      runtime: quantRuntime.versions
        ? 'Python ' + quantRuntime.versions.python + ' / pandas ' + quantRuntime.versions.pandas
        : 'Python 3.12 sidecar',
      costMode: 'local-compute',
      capabilities: ['验证期定向', '样本外因子 IC', '重复度门禁', '复合因子对照'],
      requirements: ['带哈希的数据清单', '不少于一个完整滚动窗口', '交易成本参数'],
      note: latestFactorResult
        ? '已有' + (latestFactorResult.validationStatus === 'validated' ? '已验证' : '探索性') + '运行：' + latestFactorResult.runId + '；没有通过门槛的因子不会升级为候选。'
        : '尚无通过契约校验的因子实验。'
    },
    {
      id: 'evidence-orchestrator-v1',
      name: '证据决策编排器',
      kind: 'research-agent',
      status: 'available',
      runtime: 'Node.js / SQLite / ChatGPT handoff',
      costMode: 'existing-subscription',
      capabilities: ['多模型来源内排名', '专家与资讯证据', '反证与数据缺口', '一键 ChatGPT 复核'],
      requirements: ['至少一个模型、筛选、持仓或自选候选来源'],
      note: '本地先生成可审计决策包；跨模型不比较原始分数，外部事实必须保留证据编号。'
    },
    {
      id: 'local-paper-portfolio-v1',
      name: '纸面组合约束器',
      kind: 'portfolio-model',
      status: 'available',
      runtime: 'Node.js / SQLite',
      costMode: 'local-free',
      capabilities: ['目标权重', '单股上限', '现金保留', '100股取整', '净值与盈亏快照'],
      requirements: ['先生成证据决策包', '用户确认风险档位和约束'],
      note: '当前保存了 ' + paperPortfolioCount + ' 个纸面组合和 ' + paperSnapshotCount + ' 个净值快照；不连接券商，也不生成真实订单。'
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
      status: quantRuntime.status,
      runtime: quantRuntime.versions
        ? 'Python ' + quantRuntime.versions.python + ' / Qlib ' + quantRuntime.versions.qlib + ' / LightGBM ' + quantRuntime.versions.lightgbm
        : 'Python 3.12 sidecar',
      costMode: 'local-compute',
      capabilities: ['因子数据集', '收益排名', '滚动回测', '基线比较'],
      requirements: ['独立 Python 环境', '有时间戳的数据清单', '无前视切分'],
      note: quantRuntime.reason + (latestQuantResult
        ? ' 已有' + latestQuantStatus + '运行：' + latestQuantResult.runId + '。'
        : ' 尚无通过契约校验的运行结果。')
    },
    {
      id: 'master',
      name: 'MASTER 股票 Transformer',
      kind: 'quant-model',
      status: quantRuntime.status === 'configured'
        ? 'configured'
        : quantRuntime.versions && quantRuntime.versions.torch ? quantRuntime.status : 'not_configured',
      runtime: quantRuntime.versions && quantRuntime.versions.torch
        ? 'Python ' + quantRuntime.versions.python + ' / PyTorch ' + quantRuntime.versions.torch + ' / CPU'
        : 'Python 3.12 / locked PyTorch sidecar',
      costMode: 'local-compute',
      capabilities: ['市场状态门控', '跨股票与跨时间关系建模', '同数据滚动对比'],
      requirements: ['与基线一致的数据和标签', 'PyTorch 运行环境', '样本外对照'],
      note: '验证阶段保留全部特征有效股票，只在计算指标时过滤空标签。' + (latestMasterResult
        ? ' 已有' + (latestMasterResult.validationStatus === 'validated' ? '已验证' : '探索性') + '运行：' + latestMasterResult.runId + '。'
        : ' 尚无通过契约校验的 MASTER 运行结果。')
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
