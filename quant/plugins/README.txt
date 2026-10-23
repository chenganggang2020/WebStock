WebStock 可安装量化插件（进行中）
================================

目标与进度
----------
用户授权的范围为先前下载的全部19个项目，以及 indicator-scope.json 中110类指标/模型。
implementation-plan.json 是逐项进度；evidence/verification.json 是阶段验证记录。
函数数量不等于指标目录完成数量。一个项目有首个适配功能，也不等于它的全部能力都已接入。
当前版本不能称为全部目标完成。

结构
----
原生入口在“量化研究 → 量化插件”。该入口使用真正的Qt控件，不依赖网页服务器。
native/desktop/quant_plugin_host.* 管理安装、环境、任务、取消、校验、历史。
native/desktop/quant_plugin_widget.* 提供参数表单、权益/指标曲线、明细和诊断。
native/plugin-host 是相同组件的独立验收程序，不替代完整Stock程序的验收。
各插件使用独立Python进程，所需环境由插件配置，不把所有项目的依赖合并安装。

包与数据
--------
.wspkg 是有版本的JSON封装：manifest + base64源文件，逐文件SHA256。
允许子目录；拒绝绝对路径、父目录跳转、Windows保留文件名、大小写冲突和损坏内容。
包内包含适配器源码，不包含整个第三方仓库、解释器、用户数据、账户或浏览器会话。
插件可执行本机代码；哈希用于完整性检查，不等于开发者签名或代码可信认证。
相同ID和版本不能悄悄换内容；升级需新版本号。已完成任务使用原冻结版本，历史不会自动重跑。

当前输入：单证券CSV，time/date/datetime任选其一，open/high/low/close/volume必需。
时间必须递增且不重复，价格有限且大于零，量非负，OHLC区间一致。
可选amount为实际成交额。Amihud没有amount就拒绝计算，不用close×volume冒充。
isclosed若提供则必须全为true或1；运行前用户需确认仅含已完成K线。
价格复权方式单独声明；时区和量单位尚未核实则明确保留unspecified。
这批通用回测适配器不声称已实现A股公司行动、历史涨跌停或T+1完整撮合规则。

安装与使用
----------
1. 编译完整原生程序，或先构建独立验收宿主。
2. 在TA-Lib环境中运行 build_packages.py --output <输出目录>。
3. 在插件页面选择“安装插件包”，选择 .wspkg。
4. 为每个插件选择自己的Python解释器并保存。插件安装不会自动下载依赖。
5. 选择指标/策略、参数、本地CSV和价格口径，确认已完成K线后运行。
6. 页面显示原生曲线/明细；从历史点击可重新核验和打开结果。
7. 关闭插件窗口会取消该窗口正在运行的任务；进入页面或恢复记录不会运行任务。
8. 选择历史记录后可导出.wsresult，包含冻结输入、代码、请求和结果；导入只核验并展示，不执行代码。
9. 卸载从可运行目录移除插件，保留历史及版本缓存。安装新版本升级；旧版包可恢复对应版本。

已验证的环境（来自本次隔离实验，不是跨机器锁文件）
------------------------------------------------
TA-Lib 0.8.2；Hikyuu 2.8.3；Backtrader 1.9.78.123；vectorbt 1.2.0。
Backtesting.py使用此前下载源码的本地可编辑安装；结果记录实际distribution版本。
每次结果保存引擎版本和主要Python依赖版本。完整依赖锁定/自动安装尚待实现。
Windows不同Python版本的环境应分开配置。WonderTrader原实验使用Python3.10，后续不会强行混入当前环境。

构建
----
完整程序沿用原仓库工具链：Qt6.9.1、MinGW13.1、C++17，BUILD_REVIEW_UI=ON。
WEBVIEW2_SDK 指向原分支要求的官方Microsoft.Web.WebView2 1.0.4258.31提取目录。
独立宿主：cmake -S native/plugin-host -B <构建目录> -DCMAKE_PREFIX_PATH=<Qt路径>
然后构建 WebStockPluginHost 和 quant_plugin_tests。
此宿主已在Qt6.6/MinGW11的隔离环境中编译和测试；完整程序有更高版本要求。

验证
----
Python：tests/test_plugins.py <插件包目录>
逐项执行201个TA-Lib函数，并检查201+24个指标在追加未来K线后历史值不变化。
另外检查历史边界、零成交量、RSI版本区分、不合法输入和真实成交额要求。
Qt：quant_plugin_tests，设置 WEBSTOCK_TEST_PYTHON、WEBSTOCK_TEST_PACKAGE（TA-Lib包）、
WEBSTOCK_TEST_CSV 可执行真实插件及进程树取消测试；未设置时这些测试明确skip。
WEBSTOCK_TEST_SCREENSHOT 可保存原生控件结果页截图。
无未来数据回填是必要检查，不是收益有效性证据。

尚待完成
--------
已有13个项目首个适配功能经C++宿主验证：TA-Lib、Hikyuu、Backtesting.py、Backtrader、vectorbt、bt、WBT、CZSC、ML4T、QUANTAXIS、VeighNa、VeighNa CTA、Qlib。
其余6个项目的原生插件适配仍待完成。110类目录当前36类有已测试公式，13类部分实现，61类未实现。
完整主程序已编译，主窗口的插件入口/运行/重开经Qt控件测试；用户安装版的全页面验收不在本次证据中。
跨机器环境安装仍需完成；结果包导出/导入、可视卸载及版本安装已实现。
统一成交/持仓口径、数据快照v2（多证券/点时财务/事件/逐笔盘口）、费用和制度历史。
有监督学习的时间切分、标签隔离、训练集拟合、样本外评估和实验记录。
专有黑箱只能接入已授权且可说明的接口，未获得原公式不能宣称复刻。

0.4.0 增量验证
--------------
14个插件包（含WebStock补充指标）均通过真实C++宿主安装及4937根K线运行，见evidence/native-acceptance-0.4.0.json。
QUANTAXIS的5个原版指标和VeighNa的7个指标验证了短序列预热及追加未来数据后历史不变。
QUANTAXIS原版SMA会把初始化种子放到前一个索引；适配层屏蔽RSI/KDJ中尚未可知的初始化值，未修改上游源码。
ML4T验证成交时点、下一根开盘价、实际费用；CTA限价策略另用现金加持仓重新核算逐日权益。
Qlib以原版Alpha158表达式生成158列特征，分4张结果表；另附逐列公式与有效行数。
缺少真实vwap时VWAP0保持缺失。特征生成不包含标签、训练、填补或收益结论。
各环境运行 tests/test_engine_adapters.py <对应插件包> 可复现新增检查。

许可
----
THIRD_PARTY_NOTICES.txt记录第三方来源。进程隔离不免除许可义务。
RQAlpha与vectorbt有额外商业限制，Backtesting.py为AGPL，Backtrader为GPL。
安装个人本机适配器与公开再发行整个引擎是不同动作，正式发行需保留实际版本许可和通知。
