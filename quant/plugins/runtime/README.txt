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
