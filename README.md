# 📈 WebStock - A 股实时行情看板

一个功能完整的 A 股行情分析工具，支持实时行情、K 线图表、技术指标分析和 AI 智能分析。

[![GitHub Repo](https://img.shields.io/badge/GitHub-WebStock-blue?logo=github)](https://github.com/xujh1969/WebStock)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-v18+-green.svg)
![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)

---

## ✨ 功能特性

### 📊 实时行情
- 实时股票价格和涨跌幅展示
- 分时走势图和成交量图表
- 五档买卖盘信息
- 开盘价、收盘价、最高价、最低价
- 价格涨跌颜色标注（红涨绿跌）

### 🕯️ K 线分析
- 日 K 线、周 K 线、月 K 线
- 蜡烛图展示
- 支持多种技术指标：
  - 📈 均线（MA）- 自定义周期
  - 🔴🔵 MACD
  - 📊 KDJ
  - 📉 RSI
  - 📈 CCI
  - 📊 OBV
  - 📉 VWAP
  - 📈 ATR

### 🤖 AI 智能分析
- 集成 DeepSeek AI 大模型
- 自动生成个股分析报告
- 流式输出，实时展示
- AI 模拟模式（无 API Key 时可用）
- 一键复制提示词功能

### 🔍 智能搜索
- 支持股票代码搜索
- 支持中文名称搜索
- 支持拼音首字母搜索
- 支持全拼搜索

### 🎨 界面特性
- 浅色/深色主题切换
- 响应式设计
- 平滑动画效果
- 清晰的信息层级

---

## 🚀 快速开始

### 环境要求
- Node.js 18.0 或更高版本

### 安装步骤

1. **克隆项目**
   ```bash
   git clone https://github.com/xujh1969/WebStock.git
   cd WebStock
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **配置 AI（可选）**
   
   编辑 `ai-config.json`，填写你的 DeepSeek API Key：
   ```json
   {
     "apiUrl": "https://api.deepseek.com/v1/chat/completions",
     "apiKey": "sk-你的APIKey",
     "model": "deepseek-v4-pro",
     "maxTokens": 4096,
     "temperature": 0.3,
     "enabled": true
   }
   ```

4. **启动服务**
   ```bash
   npm start
   ```

5. **访问应用**
   
   打开浏览器访问：`http://localhost:3000`

---

## 📖 使用说明

### 股票搜索
在左侧搜索框输入以下内容进行搜索：
- 股票代码：`000001`
- 中文名称：`平安银行`
- 拼音首字母：`payh`
- 全拼：`pinganyinhang`

### 切换视图
点击右上角按钮在「实时行情」和「历史 K 线」间切换。

### 技术指标
在 K 线视图中，从下拉菜单选择要显示的技术指标。

### AI 分析
点击「🤖 AI 分析」按钮，自动生成个股分析报告。

---

## 📁 项目结构

```
WebStock/
├── server.js                    # 服务器入口
├── index.html                   # 前端页面
├── package.json                 # 项目配置
├── ai-config.json               # AI 配置
├── stocks.json                  # 股票列表数据
├── css/
│   └── styles.css               # 样式文件
├── js/
│   ├── app.js                   # 前端入口
│   └── modules/
│       ├── state.js             # 状态管理
│       ├── search.js            # 搜索模块
│       ├── stockList.js         # 股票列表
│       ├── indicators.js        # 技术指标计算
│       ├── klineChart.js        # K 线图表
│       ├── realtimeChart.js     # 实时行情
│       └── analysis.js          # AI 分析
└── routes/
    ├── index.js                 # 路由汇总
    ├── ai.js                    # AI 路由
    ├── stocks.js                # 股票路由
    ├── market.js                # 行情路由
    ├── analysis.js              # 分析路由
    └── cache.js                 # 缓存模块
```

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | 原生 JavaScript + ECharts |
| 数据来源 | 新浪财经 API |
| AI | DeepSeek V4 |
| 拼音 | tiny-pinyin |
| 编码 | iconv-lite |

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [ECharts](https://echarts.apache.org/) - 强大的图表库
- [DeepSeek](https://deepseek.com/) - AI 大模型
- [新浪财经](https://finance.sina.com.cn/) - 数据源

---

## 📞 支持

如果有问题或建议，欢迎提交 Issue！

---

**注意**: 本项目仅供学习和研究使用，不构成任何投资建议。投资有风险，入市需谨慎。
