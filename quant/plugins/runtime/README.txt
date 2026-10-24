独立环境版本、文件哈希与源码提交锁定
================================

这些文件记录16组本机环境的精确Python包版本，实际重建与适配器验收记录分开保存。
原先从源码安装的项目改为GitHub完整提交号，没有本机绝对路径或可编辑目录依赖。
每组增加.hashed.txt，全部非VCS运行依赖带SHA256；setup_runtime.py强制--require-hashes安装，源码项目另按完整Git提交号无依赖安装。
recipe记录哈希文件的规范UTF-8/LF摘要，摘要不符在创建环境前拒绝；Windows检出换行不改变规范摘要。
哈希范围为下载的运行依赖分发文件；源码及sdist构建隔离环境的工具依赖尚未完整锁定，不称为完全封闭的可重复构建。
这些锁针对已记录的Windows x64及Python版本；不是跨平台验证，也不能仅凭文件存在就认定另一台机器已验收。

准备uv和Git后，可用当前Python执行：
  python setup_runtime.py --recipe data-tools --destination <新的独立环境目录> --uv <uv.exe>
默认让uv选择对应Python小版本；--python 可指定该版本的解释器。
建议使用recipes.json的observedPython或同小版本中更新的修订版；较早修订版可能不满足依赖最低要求。
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
data-tools：TA-Lib、WebStock补充/多证券/财务/逐笔指标、AKShare、LEAN的Python协调程序。
hikyuu / rqalpha / qlib / vectorbt / backtesting-py / backtrader / bt /
zipline-reloaded / ml4t-backtest：各自对应同名项目。
vnpy：VeighNa和VeighNa CTA。
czsc：CZSC与WBT。
wtpy310：WonderTrader与wtpy，Python3.10。
quantaxis311：QUANTAXIS，Python3.11。
qlib环境还可运行逐时点学习插件（scikit-learn及LightGBM）。
statistical-models：hmmlearn、arch、statsmodels，供统计与时序插件使用。
deep-models：PyTorch CPU、NumPy、pandas，供LSTM/Transformer/GCN使用。
deep-models当前仅针对Windows x64 / Python3.12；PyTorch wheel使用官方索引给出的固定URL和SHA256，
其余非VCS运行依赖也通过.hashed.txt强制校验。无需GPU或CUDA。

LEAN额外需要.NET10 SDK、原版LEAN Release构建与Data基础文件；Python依赖安装不替代该构建。
可运行setup_lean_runtime.py --destination <新目录> --source-mirror <本地LEAN源码> --offline。
lean-locks包含与固定源码提交匹配的20份NuGet内容哈希锁；独立构建使用locked-mode。
省略--source-mirror和--offline可从固定提交联网构建，仍不会覆盖旧目录或修改全局设置。
运行包不带第三方可执行文件。再发行运行环境时仍需保留所有第三方许可与通知。
