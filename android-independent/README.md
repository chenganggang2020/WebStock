# 独立安卓 2.2.0

本目录为可维护源码，取代在 output 交付目录内修改源码的方式；原 2.1.1 交付保留不动。

手机直接请求公开数据源，使用自己的本地存储，不依赖电脑开机，不把手机请求转发到 Windows 的 3000 端口。它不是桌面 27 个页面的完整移植；功能边界见 docs/功能迁移清单.md。

## 构建与验证

在仓库安装 Node 依赖后运行：

```powershell
node --test android-independent/qa/*.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File android-independent/build-apk.ps1
```

构建脚本先执行 prepare-web.cjs，将父仓库的行情计算模块复制到 web/shared、生成本地股票拼音索引，再执行 Java 测试、release 打包和签名校验。签名使用本机既有受保护配置，不能把签名文件或密钥提交进仓库。

本版 versionName=2.2.0，versionCode=20261006。保留旧版 applicationId 与签名，允许正常覆盖升级；不要卸载后安装，以免清空本机数据。模拟器验证与真实手机验收分别记录。

## 本轮功能

- 点击股票立即进入图表，最近浏览异步保存；当前列表内上一只/下一只保留周期。
- 分时/日K/周K/月K快捷切换；固定历史读数与顶部最新报价分开。
- 可见页面自动刷新，更新不重建图表，缩放及选中时间保持；网络失败保留缓存及真实时间。
- 代码、名称、拼音/首字母搜索；更早历史分批加载并核对来源、复权口径与已收盘重叠价格。
- 与桌面共享公开规则版9+13；分时价格序列只运行基础1–9，不冒充完整OHLC序列指标。

九转规则版本与未覆盖项见 ../docs/development/Sequential_Rules_20261003.md。历史统计仅是价格变化核对，不是策略盈利证明。

## 构建期第三方依赖

拼音索引使用 tiny-pinyin 1.3.2（MIT，Copyright (c) 2017 Creeper），依赖由父仓库管理；未把 Node 版本的库装入 WebView。行情目录不保证即时上市、改名覆盖，在线查询结果仍需按来源核验。
