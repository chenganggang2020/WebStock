const THEMES = [
  {
    id: 'cpo-optical',
    name: 'CPO/光模块',
    aliases: ['cpo', '光模块', '硅光', '800g', '1.6t', '光通信'],
    leaders: [
      { code: '300308', name: '中际旭创', role: '核心龙头', reason: '高速光模块全球第一梯队' },
      { code: '300502', name: '新易盛', role: '核心龙头', reason: '高速数通光模块龙头' },
      { code: '300394', name: '天孚通信', role: '器件龙头', reason: '光器件和封装平台能力强' },
      { code: '688498', name: '源杰科技', role: '上游芯片', reason: '激光器芯片供应链代表' },
      { code: '300570', name: '太辰光', role: '弹性标的', reason: '光器件及连接器方向' },
      { code: '300548', name: '博创科技', role: '弹性标的', reason: '光通信模块和器件' }
    ]
  },
  {
    id: 'semiconductor',
    name: '半导体',
    aliases: ['半导体', '芯片', '国产替代', '集成电路'],
    leaders: [
      { code: '002371', name: '北方华创', role: '设备龙头', reason: '半导体设备平台型公司' },
      { code: '688012', name: '中微公司', role: '设备龙头', reason: '刻蚀和薄膜设备代表' },
      { code: '688981', name: '中芯国际', role: '晶圆制造', reason: '大陆晶圆代工龙头' },
      { code: '603986', name: '兆易创新', role: '存储/MCU', reason: '存储芯片和MCU代表' },
      { code: '688008', name: '澜起科技', role: '内存接口', reason: '内存接口芯片龙头' },
      { code: '300604', name: '长川科技', role: '测试设备', reason: '半导体测试设备代表' }
    ]
  },
  {
    id: 'advanced-packaging',
    name: '先进封装',
    aliases: ['先进封装', 'chiplet', '2.5d', '3d封装', '封测'],
    leaders: [
      { code: '600584', name: '长电科技', role: '封测龙头', reason: '全球封测第一梯队' },
      { code: '002156', name: '通富微电', role: '封测龙头', reason: '先进封装和AMD产业链关联度高' },
      { code: '002185', name: '华天科技', role: '封测龙头', reason: '国内封测平台型公司' },
      { code: '688362', name: '甬矽电子', role: '封装弹性', reason: '先进封装方向代表' },
      { code: '688469', name: '中芯集成', role: '制造配套', reason: '特色工艺和封装协同方向' }
    ]
  },
  {
    id: 'ai-compute',
    name: 'AI算力/芯片',
    aliases: ['算力', 'ai芯片', 'gpu', '服务器', '液冷'],
    leaders: [
      { code: '688256', name: '寒武纪', role: 'AI芯片', reason: '国产AI芯片代表' },
      { code: '688041', name: '海光信息', role: 'CPU/GPU', reason: '国产服务器芯片代表' },
      { code: '000977', name: '浪潮信息', role: '服务器', reason: 'AI服务器产业链代表' },
      { code: '603019', name: '中科曙光', role: '算力基础设施', reason: '高性能计算和数据中心代表' },
      { code: '300442', name: '润泽科技', role: 'IDC', reason: '数据中心基础设施代表' }
    ]
  },
  {
    id: 'industrial-machine',
    name: '工业母机',
    aliases: ['工业母机', '机床', '数控机床', '高端装备'],
    leaders: [
      { code: '000837', name: '秦川机床', role: '机床龙头', reason: '数控机床和机器人减速器代表' },
      { code: '688305', name: '科德数控', role: '五轴机床', reason: '高端五轴数控机床代表' },
      { code: '300161', name: '华中数控', role: '数控系统', reason: '国产数控系统代表' },
      { code: '601882', name: '海天精工', role: '数控机床', reason: '高端数控机床代表' }
    ]
  },
  {
    id: 'power-etf-grid',
    name: '电力/电网',
    aliases: ['电力', '电网', '特高压', '虚拟电厂', '电力etf'],
    leaders: [
      { code: '600900', name: '长江电力', role: '水电龙头', reason: '水电运营龙头' },
      { code: '600905', name: '三峡能源', role: '绿电运营', reason: '新能源发电运营代表' },
      { code: '600406', name: '国电南瑞', role: '电网自动化', reason: '电网二次设备龙头' },
      { code: '300750', name: '宁德时代', role: '储能链', reason: '储能和动力电池龙头' },
      { code: '159611', name: '电力ETF', role: '主题ETF', reason: '电力主题ETF' }
    ]
  },
  {
    id: 'robotics',
    name: '机器人',
    aliases: ['机器人', '人形机器人', '减速器', '丝杠', '执行器'],
    leaders: [
      { code: '002050', name: '三花智控', role: '执行器链', reason: '热管理和机器人零部件代表' },
      { code: '002472', name: '双环传动', role: '减速器', reason: '精密传动和减速器代表' },
      { code: '603728', name: '鸣志电器', role: '电机控制', reason: '步进电机和控制系统代表' },
      { code: '300124', name: '汇川技术', role: '工控龙头', reason: '工控和伺服系统龙头' }
    ]
  },
  {
    id: 'new-energy',
    name: '新能源/储能',
    aliases: ['新能源', '储能', '光伏', '锂电', '固态电池'],
    leaders: [
      { code: '300750', name: '宁德时代', role: '电池龙头', reason: '动力电池和储能龙头' },
      { code: '002594', name: '比亚迪', role: '整车/电池', reason: '新能源车和电池一体化龙头' },
      { code: '601012', name: '隆基绿能', role: '光伏龙头', reason: '光伏硅片组件龙头' },
      { code: '300274', name: '阳光电源', role: '逆变器/储能', reason: '逆变器和储能系统龙头' }
    ]
  }
];

const STOCK_THEME_INDEX = new Map();

THEMES.forEach(function(theme) {
  theme.leaders.forEach(function(leader) {
    const code = normalizeCode(leader.code);
    if (!STOCK_THEME_INDEX.has(code)) STOCK_THEME_INDEX.set(code, []);
    STOCK_THEME_INDEX.get(code).push({
      id: theme.id,
      name: theme.name,
      role: leader.role,
      reason: leader.reason
    });
  });
});

function normalizeCode(code) {
  return String(code || '').replace(/\D/g, '').slice(-6);
}

function marketLabel(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return '';
  if (/^30[0-9]/.test(normalized)) return '创业板';
  if (/^68[89]?/.test(normalized)) return '科创板';
  if (/^(8|4|92)/.test(normalized)) return '北交所';
  if (/^(50|51|52|56|58|15|16)/.test(normalized)) return 'ETF';
  if (/^60[0135]/.test(normalized)) return '沪主板';
  if (/^(00|001|002|003)/.test(normalized)) return '深主板';
  return 'A股';
}

function getStockThemes(code) {
  return STOCK_THEME_INDEX.get(normalizeCode(code)) || [];
}

function decorateStock(stock) {
  if (!stock) return stock;
  const code = normalizeCode(stock.code);
  const themes = getStockThemes(code);
  const label = marketLabel(code);
  return Object.assign({}, stock, {
    code: stock.code || code,
    marketLabel: label,
    themes,
    tags: [label].concat(themes.map(function(theme) { return theme.name; })).filter(Boolean)
  });
}

function searchThemes(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return THEMES.slice(0, 6).map(formatTheme);
  return THEMES.filter(function(theme) {
    return theme.name.toLowerCase().includes(q) ||
      theme.id.toLowerCase().includes(q) ||
      theme.aliases.some(function(alias) { return alias.toLowerCase().includes(q) || q.includes(alias.toLowerCase()); }) ||
      theme.leaders.some(function(leader) {
        return leader.code.includes(q) || leader.name.toLowerCase().includes(q) || leader.role.toLowerCase().includes(q);
      });
  }).map(formatTheme);
}

function formatTheme(theme) {
  return {
    id: theme.id,
    name: theme.name,
    aliases: theme.aliases,
    leaders: theme.leaders.map(function(leader) {
      return decorateStock(Object.assign({}, leader));
    })
  };
}

function tagStocks(codes) {
  return (codes || []).map(function(code) {
    return decorateStock({ code: normalizeCode(code) });
  });
}

module.exports = {
  THEMES,
  decorateStock,
  getStockThemes,
  marketLabel,
  normalizeCode,
  searchThemes,
  tagStocks
};
