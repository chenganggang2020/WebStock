"""Build portable .wspkg JSON packages; external runtimes are configured by users.

Run in the TA-Lib environment to derive the exact installed function catalogue.
No environment paths or third-party executable binaries are put in packages.
"""
from pathlib import Path
import argparse
import base64
import hashlib
import json

HERE = Path(__file__).resolve().parent


def number(key, default, minimum=2, maximum=10000, title=None, kind=None):
    return {"id": key, "title": title or key, "type": kind or ("integer" if isinstance(default,int) else "number"),
            "default": default, "minimum": minimum, "maximum": maximum}


def save_package(output, manifest, sources):
    content = {name: (HERE/source).read_bytes() for name, source in sources.items()}
    manifest.update(schema="webstock.plugin.manifest.v1", protocolVersion=1,
                    entrypoint="worker.py", runtime="python", version="0.13.1",
                    files={name: hashlib.sha256(raw).hexdigest() for name,raw in content.items()})
    package = {"schema": "webstock.plugin.package.v1", "manifest": manifest,
               "files": {name: base64.b64encode(raw).decode("ascii") for name,raw in content.items()}}
    destination = output / (manifest["id"]+"-"+manifest["version"]+".wspkg")
    destination.write_text(json.dumps(package, ensure_ascii=False, indent=2),encoding="utf-8")
    return {"pluginId":manifest["id"], "file":destination.name, "operations":len(manifest["operations"]),
            "sha256":hashlib.sha256(destination.read_bytes()).hexdigest()}


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    import talib
    from talib import abstract
    operations=[]
    for name in talib.get_functions():
        f=abstract.Function(name); fields=[]
        for key,default in f.parameters.items():
            low,high= (2,10000) if "period" in key else (0,100)
            if "matype" in key: low,high=0,8
            if key in ("penetration","acceleration","maximum","vfactor","fastlimit","slowlimit"): low,high=0,1
            # Library defaults (including MAVP min/max) remain authoritative.
            fields.append(number(key,default,min(low,default),max(high,default)))
        inputs=dict(f.info["input_names"])
        if "periods" in inputs:
            # MAVP requires a per-bar periods vector; it is not guessed from OHLCV.
            fields.append(number("periodVector",14,2,10000,title="各根统一周期（显式常量向量）"))
        operations.append({"id":name.lower(),"title":name+" · "+f.info["display_name"],"function":name,
            "formulaVersion":"talib-"+talib.__version__+"-"+name,"parameters":fields,
            "description":"默认输入字段："+json.dumps(inputs,ensure_ascii=False)+"；时间序列BETA/CORREL使用上述两列，并非默认个股相对基准收益。",
            "inputKind":"ohlcv-single-csv","outputKind":"indicator"})
    records=[save_package(args.output,{"id":"org.webstock.talib","name":"TA-Lib 指标库", "license":"BSD-3-Clause",
        "source":"https://github.com/TA-Lib/ta-lib","distributions":["TA-Lib","numpy","pandas"],
        "operations":operations},{"worker.py":"worker.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"})]
    names={"hma":"Hull 均线","efficiency-ratio":"效率比 ER","regression-r2":"滚动回归 R²","bbi":"BBI",
        "donchian-prior":"前一根截止的 Donchian 通道","rsi-rolling":"RSI（滚动算术平均）","tsi":"True Strength Index",
        "ao-ac":"AO / AC","bias-zscore":"BIAS / Z 分数","realized-volatility":"历史实现波动率",
        "ewma-volatility":"EWMA 波动率","bollinger-derived":"布林 %b / 带宽 / 历史分位","keltner":"Keltner 通道",
        "chandelier":"Chandelier 退出参考","drawdown-downside":"价格回撤 / 下行波动","historical-var-es":"历史 VaR / ES",
        "rvol":"RVOL（分母排除当前根）","vpt":"VPT / PVT","cmf":"Chaikin Money Flow","force-index":"Force Index",
        "vwma":"滚动 VWMA","anchored-vwap-proxy":"首根锚定的 VWAP 近似","amihud":"Amihud 非流动性","heikin-ashi":"Heikin Ashi 合成图",
        "supertrend":"Supertrend（ATR方向线）","ichimoku":"Ichimoku（按可知时间）","dpo":"DPO（不向过去回填）",
        "pbx":"PBX（EMA+两条SMA版本）","dma":"DMA / AMA","lwr":"LWR（正向超买刻度）",
        "brar-cr-vr-psy":"BR / AR / CR / VR / PSY","emv":"Ease of Movement","bb-kc-squeeze":"BB-KC收缩状态",
        "amount-adv":"成交额 / ADV / 成交量ADV","ohlc-volatility":"Parkinson / GK / RS / Yang–Zhang 波动率",
        "vwap-actual-day":"真实VWAP（按自然日重置）","vwap-actual-anchor":"真实Anchored VWAP（指定日期）",
        "confirmed-pivots":"Pivot / 分形（确认时点）","zigzag-confirmed":"ZigZag（收盘反转确认）",
        "fibonacci-confirmed":"Fibonacci（已确认双锚点）","structure-events":"BOS / CHoCH / FVG / Order Block（明确规则）",
        "renko-close":"Renko（固定砖尺寸，收盘确认）","kalman-filter":"Kalman（只向前过滤）",
        "hurst-rs":"Hurst R/S（尾随收益窗口）","higuchi-dimension":"Higuchi 分维（尾随窗口）",
        "permutation-entropy":"排列熵（严格序列）","fft-trailing":"FFT 周期摘要（尾随窗口）"}
    core=[]
    for key,title in names.items():
        fields=[] if key in ("bbi","ao-ac","vpt","anchored-vwap-proxy","heikin-ashi") else [number("period",20,title="计算周期")]
        if key=="tsi": fields=[number("fast",13,title="快速平滑"),number("slow",25,title="慢速平滑")]
        if key in ("realized-volatility","ewma-volatility","drawdown-downside","ohlc-volatility"):
            fields.append(number("annualBars",252,1,100000,title="每年K线数"))
        if key=="ewma-volatility":fields.append(number("decay",0.94,0.01,0.9999,title="衰减系数"))
        if key=="bollinger-derived":fields.append(number("rankWindow",120,title="分位历史窗口"))
        if key in ("keltner","chandelier"):fields.append(number("multiple",3.,0.1,20,title="ATR 倍数"))
        if key=="historical-var-es":fields.append(number("confidence",0.95,0.5,0.999,title="置信水平"))
        if key=="supertrend":fields=[number("period",10,title="ATR周期"),number("multiple",3.,.1,20,title="ATR倍数")]
        if key=="ichimoku":fields=[number("conversion",9,title="转换线周期"),number("base",26,title="基准线周期"),number("span",52,title="先行B周期"),number("displacement",26,1,10000,title="显示位移根数")]
        if key=="pbx":fields=[]
        if key=="dma":fields=[number("fast",10,title="短期均线"),number("slow",50,title="长期均线"),number("signal",10,title="差值平滑周期")]
        if key=="lwr":fields=[number("period",9,title="区间周期"),number("smooth",3,title="平滑周期")]
        if key=="emv":fields.append(number("volumeScale",1000000.,1,1e12,title="成交量缩放系数"))
        if key=="bb-kc-squeeze":fields.extend([number("bbMultiple",2.,.1,10,title="布林倍数"),number("kcMultiple",1.5,.1,10,title="Keltner倍数")])
        if key=="vwap-actual-day":fields=[]
        if key=="vwap-actual-anchor":fields=[{"id":"anchorDate","title":"锚点日期","type":"text","format":"date","minLength":10,"maxLength":10,"default":"2020-01-01"}]
        if key in ("confirmed-pivots","structure-events"):
            fields=[number("left",2,1,1000,title="左侧根数"),number("right",2,1,1000,title="右侧确认根数")]
        if key=="structure-events":fields.extend([number("blockLookback",20,1,1000,title="反向K线回看"),number("minGapPct",0.,0,50,title="最小间隙百分比")])
        if key in ("zigzag-confirmed","fibonacci-confirmed"):fields=[number("reversalPct",5.,.01,99,title="反转幅度（%）")]
        if key=="renko-close":fields=[number("boxSize",1.,1e-8,1e8,title="固定砖尺寸（价格单位）")]
        if key=="kalman-filter":fields=[{"id":"model","title":"状态模型","type":"choice","default":"local-linear-trend","choices":["local-level","local-linear-trend"]},
            number("levelVariance",.00001,0.,1.,title="水平过程方差"),number("trendVariance",.0000001,0.,1.,title="斜率过程方差"),
            number("observationVariance",.0001,1e-12,1.,title="观测噪声方差"),number("initialVariance",.01,1e-12,100.,title="初始状态方差")]
        if key=="hurst-rs":fields=[number("period",256,64,2048,title="收益窗口")]
        if key=="higuchi-dimension":fields=[number("period",128,17,2048,title="价格窗口"),number("maximumScale",8,2,64,title="最大尺度")]
        if key=="permutation-entropy":fields=[number("period",120,8,2048,title="价格窗口"),number("order",3,2,6,title="嵌入维度"),number("delay",1,1,100,title="嵌入延迟")]
        if key=="fft-trailing":fields=[number("period",64,8,2048,title="频谱窗口")]
        core.append({"id":key,"title":title,"formulaVersion":"webstock-"+key+"-v1","parameters":fields,
                     "inputKind":"ohlcv-single-csv","outputKind":"indicator","description":"仅使用已完成K线的有版本公式。"})
    records.append(save_package(args.output,{"id":"org.webstock.core-indicators","name":"WebStock 补充指标","license":"Project source terms",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas"],"operations":core},
        {"worker.py":"worker.py","core_indicators.py":"core_indicators.py","temporal_indicators.py":"temporal_indicators.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    records.append(save_package(args.output,{"id":"org.webstock.hikyuu","name":"Hikyuu 回测引擎","license":"Apache-2.0 / MIT component notices",
        "source":"https://github.com/fasiondog/hikyuu","distributions":["hikyuu","pandas"],"operations":[{
            "id":"sma-cross","title":"均线交叉 · 下一根开盘执行","formulaVersion":"hikyuu-sma-cross-next-open-v1",
            "inputKind":"ohlcv-single-csv","outputKind":"backtest","description":"临时股票回测，零费用验收基线，未启用实盘。",
            "parameters":[number("fast",10,title="快速均线"),number("slow",30,title="慢速均线"),
                          number("capital",100000.,1,1e10,title="初始资金"),number("quantity",100,1,1000000,title="每次买入数量")]}]},
        {"worker.py":"worker.py","hikyuu_adapter.py":"hikyuu_adapter.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    for engine,title,license,source,distribution in [
        ("backtesting-py","Backtesting.py 回测引擎","AGPL-3.0","kernc/backtesting.py","backtesting"),
        ("backtrader","Backtrader 回测引擎","GPL-3.0","mementum/backtrader","backtrader"),
        ("vectorbt","vectorbt 向量回测","Apache-2.0 + Commons Clause","polakowo/vectorbt","vectorbt"),
        ("ml4t-backtest","ML4T 回测引擎","MIT","ml4t/backtest","ml4t-backtest")]:
        records.append(save_package(args.output,{"id":"org.webstock."+engine,"name":title,"license":license,
            "source":"https://github.com/"+source,"distributions":[distribution,"numpy","pandas"],"operations":[{
                "id":"sma-cross","title":"均线交叉 · 下一根开盘执行","formulaVersion":engine+"-sma-cross-next-open-v1",
                "inputKind":"ohlcv-single-csv","outputKind":"backtest","description":"通用股票研究基线；结果保留每个引擎的执行假设。",
                "parameters":[number("fast",10,title="快速均线"),number("slow",30,title="慢速均线"),
                    number("capital",100000.,1,1e10,title="初始资金"),number("quantity",100,1,1000000,title="每次买入数量"),
                    number("feeBps",5.,0,1000,title="单边费率（基点）")]}]},
            {"worker.py":"worker.py","backtest_adapters.py":"backtest_adapters.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    for engine,title,license,source in [("bt","bt 组合再平衡","MIT","pmorissette/bt"),
        ("wbt","WBT 权重归因","MIT","zengbin93/wbt"),("czsc","CZSC 逐根结构观察","Apache-2.0","waditu/czsc")]:
        fields=[] if engine=="czsc" else [number("fast",10,title="快速均线"),number("slow",30,title="慢速均线"),
            number("weight",0.8,0.,1.,title="目标权重"),number("feeBps",5.,0.,1000.,title="单边费率（基点）")]
        if engine=="bt":fields.append(number("capital",100000.,1,1e10,title="初始资金"))
        records.append(save_package(args.output,{"id":"org.webstock."+engine,"name":title,"license":license,
            "source":"https://github.com/"+source,"distributions":[engine,"pandas"],"operations":[{
                "id":"online-bi" if engine=="czsc" else "sma-weight","title":"逐根观察最近笔（可修订）" if engine=="czsc" else "均线状态权重 · 延后一根再平衡",
                "formulaVersion":"czsc-daily-online-last-bi-v1" if engine=="czsc" else engine+"-lagged-sma-weight-v1",
                "inputKind":"ohlcv-single-csv","outputKind":"indicator" if engine=="czsc" else "backtest",
                "description":"按当时可见数据逐根运行；查看结果诊断中的模型边界。","parameters":fields}]},
            {"worker.py":"worker.py","research_adapters.py":"research_adapters.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    qa_operations=[]
    for name,title,fields in [
        ("ma","原版均线",[number("period",20,title="计算周期")]),
        ("macd","原版 MACD",[number("fast",12,title="快速周期"),number("slow",26,title="慢速周期"),number("signal",9,title="信号周期")]),
        ("rsi","原版三周期 RSI",[number("period1",6,title="第一周期"),number("period2",12,title="第二周期"),number("period3",24,title="第三周期")]),
        ("kdj","原版 KDJ",[number("period",9,title="计算周期"),number("smoothK",3,title="K平滑"),number("smoothD",3,title="D平滑")]),
        ("boll","原版布林带",[number("period",20,title="计算周期"),number("multiple",2.,.1,10,title="波动倍数")])]:
        qa_operations.append({"id":name,"title":title,"formulaVersion":"quantaxis-available-"+name+"-v1","inputKind":"ohlcv-single-csv",
            "outputKind":"indicator","description":"仅加载QUANTAXIS原版离线指标模块；不启动数据库或在线采集。","parameters":fields})
    records.append(save_package(args.output,{"id":"org.webstock.quantaxis","name":"QUANTAXIS 离线指标","license":"MIT",
        "source":"https://github.com/yutiansut/QUANTAXIS","distributions":["quantaxis","pandas","numpy"],"operations":qa_operations},
        {"worker.py":"worker.py","quantaxis_adapter.py":"quantaxis_adapter.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    vn_operations=[]
    for name in ("sma","ema","rsi","atr","adx","macd","boll"):
        fields=[number("period",14,title="计算周期")]
        if name=="macd":fields=[number("fast",12,title="快速周期"),number("slow",26,title="慢速周期"),number("signal",9,title="信号周期")]
        if name=="boll":fields.append(number("multiple",2.,.1,10,title="波动倍数"))
        vn_operations.append({"id":name,"title":"VeighNa "+name.upper(),"formulaVersion":"vnpy-array-manager-"+name+"-v1",
            "inputKind":"ohlcv-single-csv","outputKind":"indicator","description":"原版ArrayManager指标API（底层使用TA-Lib）。","parameters":fields})
    records.append(save_package(args.output,{"id":"org.webstock.vnpy","name":"VeighNa 指标接口","license":"MIT",
        "source":"https://github.com/vnpy/vnpy","distributions":["vnpy","TA-Lib","pandas","numpy"],"operations":vn_operations},
        {"worker.py":"worker.py","vnpy_adapters.py":"vnpy_adapters.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    records.append(save_package(args.output,{"id":"org.webstock.vnpy-ctastrategy","name":"VeighNa CTA 限价回测","license":"MIT",
        "source":"https://github.com/vnpy/vnpy_ctastrategy","distributions":["vnpy","vnpy_ctastrategy","pandas"],"operations":[{
            "id":"sma-limit","title":"均线交叉 · 下一根限价撮合","formulaVersion":"vnpy-cta-sma-cross-next-bar-limit-v1",
            "inputKind":"ohlcv-single-csv","outputKind":"backtest","description":"原版合约逐日盯市；未实现股票现金约束。",
            "parameters":[number("fast",10,title="快速周期"),number("slow",30,title="慢速周期"),
                number("capital",100000.,1,1e10,title="初始参考资金"),number("quantity",100,1,1000000,title="合约数量"),
                number("feeBps",5.,0,1000,title="单边费率（基点）"),number("priceTick",.01,.000001,100,title="最小价格单位")]}]},
        {"worker.py":"worker.py","vnpy_adapters.py":"vnpy_adapters.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    records.append(save_package(args.output,{"id":"org.webstock.qlib","name":"Qlib Alpha158 特征","license":"MIT",
        "source":"https://github.com/microsoft/qlib","distributions":["pyqlib","pandas","numpy"],"operations":[{
            "id":"alpha158","title":"Alpha158 原始特征及公式","formulaVersion":"qlib-alpha158-raw-no-label-v1",
            "inputKind":"ohlcv-single-csv","outputKind":"indicator","parameters":[],
            "description":"原版表达式计算；缺失VWAP保持空白，无训练、标签或缺失填补。"}]},
        {"worker.py":"worker.py","qlib_adapter.py":"qlib_adapter.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    for engine,title,formula,source,license,adapter in [
        ("zipline-reloaded","Zipline 日线回测","zipline-sma-cross-next-daily-bar-v1","stefan-jansen/zipline-reloaded","Apache-2.0","zipline_adapter.py"),
        ("rqalpha","RQAlpha 冻结数据回测","rqalpha-lagged-sma-cross-close-v1","ricequant/rqalpha","Apache-2.0 with additional commercial-use restrictions","rqalpha_adapter.py")]:
        records.append(save_package(args.output,{"id":"org.webstock."+engine,"name":title,"license":license,
            "source":"https://github.com/"+source,"distributions":[engine,"pandas","numpy"],"operations":[{
                "id":"sma-close","title":"均线交叉 · 下一交易根收盘撮合","formulaVersion":formula,
                "inputKind":"ohlcv-single-csv","outputKind":"backtest","description":"原版日线执行模型；冻结输入，明确信号延迟。",
                "parameters":[number("fast",10,title="快速均线"),number("slow",30,title="慢速均线"),
                    number("capital",100000.,1,1e10,title="初始资金"),number("quantity",100,1,1000000,title="每次买入数量"),
                    number("feeBps",5.,0,1000,title="单边费率（基点）")]}]},
            {"worker.py":"worker.py",adapter:adapter,"THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    records.append(save_package(args.output,{"id":"org.webstock.wtpy","name":"wtpy 原生数据工具","license":"MIT",
        "source":"https://github.com/wondertrader/wtpy","distributions":["wtpy","pandas","numpy"],"operations":[{
            "id":"daily-dsb","title":"日线DSB转换、读回与导出","formulaVersion":"wtpy-native-daily-dsb-roundtrip-v1",
            "inputKind":"ohlcv-single-csv","outputKind":"indicator","parameters":[],
            "description":"调用原版原生数据组件；逐项核对转换后的日期及OHLCV，保存可导出的DSB。"}]},
        {"worker.py":"worker.py","wondertrader_adapters.py":"wondertrader_adapters.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    records.append(save_package(args.output,{"id":"org.webstock.wondertrader","name":"WonderTrader 原生回测","license":"MIT",
        "source":"https://github.com/wondertrader/wondertrader","distributions":["wtpy","pandas","numpy"],"operations":[{
            "id":"sma-native","title":"均线交叉 · 原生日线撮合","formulaVersion":"wondertrader-daily-sma-cross-v1",
            "inputKind":"ohlcv-single-csv","outputKind":"backtest","description":"使用wtpy发行版的原生引擎DLL，费用按笔取整到分；保留原始信号和成交表。",
            "parameters":[number("fast",10,title="快速均线"),number("slow",30,title="慢速均线"),
                number("capital",100000.,1,1e10,title="初始参考资金"),number("quantity",100,1,1000000,title="数量"),
                number("feeBps",5.,0,1000,title="单边费率（基点）")]}]},
        {"worker.py":"worker.py","wondertrader_adapters.py":"wondertrader_adapters.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    records.append(save_package(args.output,{"id":"org.webstock.akshare","name":"AKShare 历史数据采集","license":"MIT",
        "source":"https://github.com/akfamily/akshare","distributions":["akshare","pandas","numpy"],"operations":[{
            "id":"daily-eastmoney","title":"A股历史日线 · 东方财富","formulaVersion":"akshare-eastmoney-daily-snapshot-v1",
            "inputKind":"parameters-only","outputKind":"data","description":"点击运行后联网取数，保存来源与采集时间；结束日期需早于今天。",
            "parameters":[{"id":key,"title":title,"type":"text","format":fmt,"minLength":length,"maxLength":length,"default":default}
                for key,title,fmt,length,default in [("symbol","六位股票代码","cn-stock",6,"000001"),
                    ("startDate","开始日期","date",10,"2020-01-01"),("endDate","结束日期","date",10,"2020-12-31")]]+
                [{"id":"adjustment","title":"价格复权方式","type":"choice","default":"unadjusted","choices":["unadjusted","forward","backward"]}]}]},
        {"worker.py":"worker.py","akshare_adapter.py":"akshare_adapter.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    records.append(save_package(args.output,{"id":"org.webstock.lean","name":"LEAN 本地回测引擎","license":"Apache-2.0",
        "source":"https://github.com/QuantConnect/Lean","distributions":["pandas","numpy"],"operations":[{
            "id":"sma-close","title":"均线交叉 · 下一输入根收盘执行","formulaVersion":"lean-lagged-sma-cross-close-v1",
            "inputKind":"ohlcv-single-csv","outputKind":"backtest","description":"原版.NET引擎；需.NET10 SDK与本地已构建的LEAN目录。",
            "parameters":[{"id":"engineDirectory","title":"LEAN源码及Release构建目录","type":"text","format":"text","minLength":0,"maxLength":512,"default":""},
                number("fast",10,title="快速均线"),number("slow",30,title="慢速均线"),number("capital",100000.,1,1e10,title="初始虚拟资金"),
                number("quantity",100,1,1000000,title="每次数量"),number("feeBps",5.,0,1000,title="单边费率（基点）")]}]},
        {"worker.py":"worker.py","lean_adapter.py":"lean_adapter.py","lean/WebStockFrozenAlgorithm.cs":"lean/WebStockFrozenAlgorithm.cs","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    panel=[]
    for key,title in {"market-breadth":"市场宽度 / AD线 / 新高低 / McClellan", "beta-correlation":"基准Beta / 相关矩阵",
        "cross-sectional-momentum":"截面动量 / 排名", "cross-sectional-reversal":"截面反转 / 排名",
        "industry-relative-strength":"行业动量 / 相对强度", "equal-cap-weight-indices":"等权与市值加权指数",
        "cross-sectional-dispersion":"截面收益离散度", "free-float-turnover":"历史流通股换手率",
        "actual-participation":"真实成交参与率", "reported-valuation":"已披露价值比率 / EV倍数",
        "reported-profitability":"已披露 ROE / ROA / 利润率", "reported-quality":"五年盈利稳健性 / 质量评分（明确规则）",
        "investment-accrual":"资产增长 / 投资 / 应计与现金含量", "low-risk-ranks":"低波动 / 低Beta分别排名",
        "size-ranks":"总市值 / 流通市值排名", "reported-dividends":"已支付年度股利 / 支付率",
        "piotroski-fscore":"Piotroski F-score（明确资产口径）", "earnings-surprise":"披露前预期与实际业绩差",
        "forecast-revision":"同一预测期的预期修正", "share-capital-events":"增发 / 实施回购 / 股数对账"}.items():
        fields=[] if key in ("equal-cap-weight-indices","free-float-turnover","actual-participation") else [number("period",20,2,1000,title="观察窗口")]
        if key=="cross-sectional-momentum":fields.append(number("skip",1,0,252,title="跳过最近根数"))
        if key in ("beta-correlation","industry-relative-strength"):
            fields.append({"id":"benchmark","title":"基准证券代码","type":"text","format":"text","minLength":1,"maxLength":64,"default":"BENCH"})
        from fundamental_research import OPERATIONS as financial_operations
        if key in financial_operations:fields=[]
        if key=="low-risk-ranks":fields=[number("period",20,2,1000,title="收益窗口"),number("annualBars",252,1,100000,title="每年根数"),
            {"id":"benchmark","title":"基准证券代码","type":"text","format":"text","minLength":1,"maxLength":64,"default":"BENCH"}]
        if key=="piotroski-fscore":fields=[{"id":"turnoverAssets","title":"周转率资产分母","type":"choice","default":"beginning","choices":["beginning","average"]}]
        panel.append({"id":key,"title":title,"formulaVersion":"webstock-panel-"+key+"-v1","parameters":fields,
            "inputKind":"market-panel-csv","outputKind":"indicator","description":"需多证券CSV：决策时间、行情可用时间、历史成分及已知时间；字段见随包PANEL_INPUT.txt。"})
    records.append(save_package(args.output,{"id":"org.webstock.panel-research","name":"WebStock 多证券研究","license":"Project source terms",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas"],"operations":panel},
        {"worker.py":"worker.py","panel_contract.py":"panel_contract.py","panel_research.py":"panel_research.py","fundamental_research.py":"fundamental_research.py",
         "PANEL_INPUT.txt":"PANEL_INPUT.txt","FUNDAMENTAL_INPUT.txt":"FUNDAMENTAL_INPUT.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    events=[]
    for key,title in {"quote-liquidity":"盘口价差 / 显示深度", "queue-imbalance":"队列不平衡 / 数量加权价格",
        "trade-delta":"主动成交 Delta / CVD（保留未知方向）", "order-flow-imbalance":"逐盘口事件 OFI",
        "volume-profile":"真实成交量分布 / POC / Value Area"}.items():
        fields=[]
        if key in ("quote-liquidity","queue-imbalance"):fields=[number("depth",1,1,10,title="显示盘口档数")]
        if key=="order-flow-imbalance":fields=[number("period",20,2,10000,title="尾随盘口事件数")]
        if key=="volume-profile":fields=[number("binSize",.01,1e-8,1e8,title="固定价格箱宽"),number("valueAreaFraction",.7,.1,1.,title="目标成交量比例")]
        events.append({"id":key,"title":title,"formulaVersion":"webstock-events-"+key+"-v1","parameters":fields,
            "inputKind":"market-events-csv","outputKind":"indicator","description":"需真实成交或完整盘口快照、事件顺序及可知时点。不会从日线推断；字段见随包EVENT_INPUT.txt。"})
    records.append(save_package(args.output,{"id":"org.webstock.event-research","name":"WebStock 逐笔与盘口研究","license":"Project source terms",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas"],"operations":events},
        {"worker.py":"worker.py","panel_contract.py":"panel_contract.py","event_contract.py":"event_contract.py","event_research.py":"event_research.py",
         "EVENT_INPUT.txt":"EVENT_INPUT.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    (args.output/"index.json").write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(records,ensure_ascii=False))


if __name__=="__main__":main()
