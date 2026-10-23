独立环境依赖快照（安装验证进行中）
================================

这些文件来自本次已验证的14个本机环境，记录每个Python包的精确版本。
原先从源码安装的项目改为GitHub完整提交号，没有本机绝对路径或可编辑目录依赖。
它们尚不是包含所有wheel哈希的跨平台锁文件，也不能仅凭文件存在就认定可在新机器使用。

准备uv和Git后，可用当前Python执行：
  python setup_runtime.py --recipe data-tools --destination <新的独立环境目录> --uv <uv.exe>
默认让uv选择对应Python小版本；--python 可指定该版本的解释器。
目标目录必须不存在。安装失败保留日志及状态，不覆盖、删除已有环境。
创建后需运行对应适配器测试，并在C++程序中选择该目录的Scripts/python.exe。
dependencies_verified只表示安装与依赖检查成功，不表示全部功能已验收。

已有缓存时可加 --offline；缺失依赖时明确失败，不自动联网。
已有此前下载的仓库时可加 --source-root <仓库父目录>，安装器核对完整Git提交号，
从本地Git对象构建非可编辑安装，避免依赖原工作目录。每次仍创建新环境。
Windows长路径设置仅作用于安装器子进程，Python构建启用UTF-8；不改全局系统配置。
Backtesting.py固定提交的wheel漏带导入所需autoscale_cb.js，安装器从同一提交取回，
核验SHA256并在webstock-runtime.json记录；不改其交易逻辑。该额外数据文件由运行环境记录管理。

项目与环境对应：
data-tools：TA-Lib、WebStock补充指标、AKShare、LEAN的Python协调程序。
hikyuu / rqalpha / qlib / vectorbt / backtesting-py / backtrader / bt /
zipline-reloaded / ml4t-backtest：各自对应同名项目。
vnpy：VeighNa和VeighNa CTA。
czsc：CZSC与WBT。
wtpy310：WonderTrader与wtpy，Python3.10。
quantaxis311：QUANTAXIS，Python3.11。

LEAN额外需要.NET10 SDK、原版LEAN Release构建与Data基础文件；Python依赖安装不替代该构建。
运行包不带第三方可执行文件。再发行运行环境时仍需保留所有第三方许可与通知。
