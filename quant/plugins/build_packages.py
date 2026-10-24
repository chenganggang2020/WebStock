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
    # Packages contain UTF-8 Python/text sources. Canonical LF bytes make the
    # immutable package independent of Git core.autocrlf on the build machine.
    content = {name: (HERE/source).read_text(encoding="utf-8").replace('\r\n','\n').replace('\r','\n').encode('utf-8') for name, source in sources.items()}
    manifest.update(schema="webstock.plugin.manifest.v1", protocolVersion=1,
                    entrypoint="worker.py", runtime="python", version="0.25.0",
                    files={name: hashlib.sha256(raw).hexdigest() for name,raw in content.items()})
    package = {"schema": "webstock.plugin.package.v1", "manifest": manifest,
               "files": {name: base64.b64encode(raw).decode("ascii") for name,raw in content.items()}}
    destination = output / (manifest["id"]+"-"+manifest["version"]+".wspkg")
    destination.write_text(json.dumps(package, ensure_ascii=False, indent=2),encoding="utf-8",newline="\n")
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
        "permutation-entropy":"排列熵（严格序列）","fft-trailing":"FFT 周期摘要（尾随窗口）",
        "atr-position-exit":"持仓内ATR跟踪退出（次根生效）","rvol-at-time":"盘中同时刻相对量（严格会话匹配）"}
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
        if key=="atr-position-exit":fields=[number("period",14,2,1000,title="Wilder ATR周期"),number("multiple",3.,.1,20.,title="ATR倍数"),
            {"id":"entryBars","title":"事先安排的入场根索引（逗号分隔）","type":"text","format":"text","minLength":1,"maxLength":512,"default":"30"},
            {"id":"side","title":"持仓方向","type":"choice","default":"long","choices":["long","short"]},
            number("quantity",100.,.001,1e6,title="固定数量"),number("feeBps",5.,0.,100.,title="单边费用基点")]
        if key=="rvol-at-time":fields=[number("sessions",10,1,252,title="此前交易会话数"),number("barSeconds",60,1,3600,title="每根持续秒数"),
            {"id":"mode","title":"成交量口径","type":"choice","default":"cumulative","choices":["cumulative","regular"]}]
        core.append({"id":key,"title":title,"formulaVersion":"webstock-"+key+"-v1","parameters":fields,
                     "inputKind":"ohlcv-single-csv","outputKind":"indicator","description":"额外会话字段或显式入场规则见SESSION_EXECUTION.txt。" if key in ("atr-position-exit","rvol-at-time") else "仅使用已完成K线的有版本公式。"})
    records.append(save_package(args.output,{"id":"org.webstock.core-indicators","name":"WebStock 补充指标","license":"Project source terms",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas"],"operations":core},
        {"worker.py":"worker.py","core_indicators.py":"core_indicators.py","temporal_indicators.py":"temporal_indicators.py","execution_indicators.py":"execution_indicators.py",
         "panel_contract.py":"panel_contract.py","SESSION_EXECUTION.txt":"SESSION_EXECUTION.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
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
    learners=[]
    for key,title in {"linear":"线性回归 · 逐时点训练", "ridge":"Ridge · 逐时点训练", "logistic":"Logistic 上涨概率 · 逐时点训练",
        "random-forest":"随机森林 · 逐时点训练", "gradient-boosting":"GBDT · 逐时点训练", "lightgbm":"LightGBM · 逐时点训练"}.items():
        fields=[number("trainingRows",252,40,5000,title="每次训练有效样本数"),number("horizon",5,1,252,title="预测未来根数"),
            number("purgeBars",1,1,252,title="标签成熟后隔离根数"),number("retrainEvery",63,1,5000,title="每隔多少根重训"),
            number("seed",2026,0,2147483647,title="随机种子")]
        if key=="ridge":fields.append(number("alpha",1.,0.,10000.,title="Ridge惩罚强度"))
        if key=="logistic":fields.append(number("regularizationC",1.,1e-6,10000.,title="Logistic C"))
        if key in ("random-forest","gradient-boosting","lightgbm"):
            fields.extend([number("estimators",64,1,256,title="树数量"),number("maxDepth",3,1,8,title="树最大深度"),number("minLeaf",10,1,1000,title="叶节点最少样本")])
        if key in ("gradient-boosting","lightgbm"):fields.append(number("learningRate",.05,.001,1.,title="学习率"))
        learners.append({"id":key,"title":title,"formulaVersion":"webstock-learning-"+key+"-v1","parameters":fields,
            "inputKind":"ohlcv-single-csv","outputKind":"indicator","description":"原版scikit-learn/LightGBM；固定七项价量特征，只训练已成熟标签，输出预测、事后评价、训练审计及最后模型参数。见LEARNING_MODELS.txt。"})
    records.append(save_package(args.output,{"id":"org.webstock.learning-models","name":"WebStock 逐时点学习模型","license":"Project source terms; upstream BSD-3-Clause/MIT",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas","scikit-learn","lightgbm"],"operations":learners},
        {"worker.py":"worker.py","learning_models.py":"learning_models.py","LEARNING_MODELS.txt":"LEARNING_MODELS.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    statistical=[]
    for key,title in {"gaussian-hmm":"Gaussian HMM · 当前过滤状态", "markov-switching":"Markov切换 · 当前过滤状态",
        "garch":"GARCH(1,1) · 一步波动预测", "egarch":"EGARCH(1,1,1) · 一步波动预测", "gjr-garch":"GJR-GARCH(1,1,1) · 一步波动预测",
        "arima":"ARIMA · 对数价格一步预测", "arx":"ARX · 双证券收益预测", "var":"VAR · 双证券联合预测", "cointegration-pair":"协整诊断 / 历史系数残差Z"}.items():
        multi=key in ("arx","var","cointegration-pair")
        fields=[number("trainingRows",252,40,5000,title="尾随训练观察数"),number("forecastEvery",20,1,5000,title="每隔多少根拟合及观察")]
        if not multi:fields.append(number("maxIterations",500,20,2000,title="优化迭代上限"))
        if key in ("gaussian-hmm","markov-switching"):
            fields.append(number("states",2,2,3,title="状态数量"))
        if key=="gaussian-hmm":fields.append(number("seed",2026,0,2147483647,title="随机种子"))
        if key in ("garch","egarch","gjr-garch"):fields.append(number("annualBars",252,1,100000,title="年化根数"))
        if key=="arima":fields.extend([number("arOrder",1,0,5,title="AR阶数 p"),number("differenceOrder",1,0,2,title="差分阶数 d"),number("maOrder",0,0,5,title="MA阶数 q")])
        if multi:
            fields.extend([{"id":key2,"title":title2,"type":"text","format":"text","minLength":1,"maxLength":64,"default":default}
                for key2,title2,default in [("security","目标证券代码","000001"),("reference","参照证券代码","000002")]])
        if key=="var":fields.append(number("lags",1,1,5,title="VAR滞后阶数"))
        if key=="cointegration-pair":fields.append(number("adfLags",1,0,5,title="ADF固定滞后阶数"))
        statistical.append({"id":key,"title":title,"formulaVersion":"webstock-statistical-"+key+"-v1","parameters":fields,
            "inputKind":"market-panel-csv" if multi else "ohlcv-single-csv","outputKind":"indicator",
            "description":"原版hmmlearn/arch/statsmodels；只在已知时点拟合尾随窗口，未收敛窗口保留失败状态。见STATISTICAL_MODELS.txt。"})
    records.append(save_package(args.output,{"id":"org.webstock.statistical-models","name":"WebStock 统计与时序模型","license":"Project source terms; upstream BSD-3-Clause/NCSA",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas","scipy","statsmodels","hmmlearn","arch"],"operations":statistical},
        {"worker.py":"worker.py","statistical_models.py":"statistical_models.py","econometric_panel.py":"econometric_panel.py","panel_contract.py":"panel_contract.py",
         "STATISTICAL_MODELS.txt":"STATISTICAL_MODELS.txt","PANEL_INPUT.txt":"PANEL_INPUT.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    deep=[]
    for key,title in {"lstm":"LSTM · 已成熟标签逐时点训练", "transformer":"Transformer · 尾随序列预测", "gcn":"GCN · 训练期相关图预测"}.items():
        fields=[number("trainingRows",128,40,1000,title="每次训练有效样本数"),number("horizon",5,1,252,title="预测未来根数"),
            number("purgeBars",1,1,252,title="标签成熟后隔离根数"),number("retrainEvery",63,1,5000,title="每隔多少根重训"),
            number("epochs",20,1,200,title="固定训练轮数"),number("learningRate",.01,.00001,.1,title="Adam学习率"),
            number("seed",2026,0,2147483647,title="随机种子")]
        if key=="gcn":fields.extend([
            {"id":"symbols","title":"事先指定研究证券（英文逗号分隔）","type":"text","format":"text","minLength":3,"maxLength":512,"default":"000001,000002"},
            number("edgeThreshold",.3,0.,1.,title="正相关边的最低相关系数")])
        else:fields.append(number("sequenceRows",12,2,64,title="尾随序列根数"))
        deep.append({"id":key,"title":title,"formulaVersion":"webstock-deep-"+key+"-v1","parameters":fields,
            "inputKind":"market-panel-csv" if key=="gcn" else "ohlcv-single-csv","outputKind":"indicator",
            "description":"原版PyTorch CPU小模型；输出预测、成熟后评价、训练审计、损失及JSON权重，不含交易收益。见DEEP_MODELS.txt。"})
    records.append(save_package(args.output,{"id":"org.webstock.deep-models","name":"WebStock 深度学习模型","license":"Project source terms; PyTorch BSD-3-Clause",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas","torch"],"operations":deep},
        {"worker.py":"worker.py","deep_models.py":"deep_models.py","learning_models.py":"learning_models.py","panel_contract.py":"panel_contract.py",
         "DEEP_MODELS.txt":"DEEP_MODELS.txt","PANEL_INPUT.txt":"PANEL_INPUT.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    risk=[]
    for key,title in {"equity-drawdown":"策略净值回撤 / 下行风险", "target-volatility":"策略权益 · 目标波动敞口建议", "risk-budget":"风险预算组合 · 下一输入收盘调仓"}.items():
        fields=[number("period",60,20,1000,title="风险估计窗口"),number("annualBars",252,1,100000,title="每年观察次数")]
        if key!='risk-budget':fields.append(number("minimumReturnPerBar",0.,-.5,.5,title="每次观察最低目标收益"))
        if key!='equity-drawdown':fields.extend([number("targetVolatility",.15,.001,2.,title="目标年化波动"),number("maxExposure",1.,.01,1.,title="总敞口上限")])
        if key=='risk-budget':fields.extend([
            {"id":"symbols","title":"事先指定研究证券（英文逗号）","type":"text","format":"text","minLength":3,"maxLength":512,"default":"000001,000002"},
            {"id":"riskBudgets","title":"对应正风险预算（英文逗号）","type":"text","format":"text","minLength":3,"maxLength":512,"default":"1,1"},
            number("rebalanceEvery",20,1,1000,title="每隔多少根评估调仓"),number("shrinkage",.1,0.,1.,title="协方差向对角收缩比例"),
            number("maxSecurityWeight",.6,.01,1.,title="单证券权重上限"),number("capital",100000.,1.,1e10,title="初始虚拟资金"),number("feeBps",5.,0.,100.,title="单边费用基点")])
        risk.append({"id":key,"title":title,"formulaVersion":"webstock-risk-"+key+"-v1","parameters":fields,
            "inputKind":"market-panel-csv" if key=='risk-budget' else "portfolio-equity-csv","outputKind":"backtest" if key=='risk-budget' else 'indicator',
            "description":"策略权益需显式费用与期末出入金；组合使用历史多证券面板，输出下一输入收盘成交和现金账本。见PORTFOLIO_RISK.txt。"})
    records.append(save_package(args.output,{"id":"org.webstock.portfolio-risk","name":"WebStock 组合风险与分配","license":"Project source terms",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas"],"operations":risk},
        {"worker.py":"worker.py","portfolio_contract.py":"portfolio_contract.py","portfolio_risk.py":"portfolio_risk.py","panel_contract.py":"panel_contract.py",
         "PORTFOLIO_RISK.txt":"PORTFOLIO_RISK.txt","PANEL_INPUT.txt":"PANEL_INPUT.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    factor=[]
    for key,title in {"trailing-pca":"PCA · 仅过去窗口训练", "factor-score":"多因子截面评分 · 明确权重", "ranked-portfolio":"排名组合 · 次根收盘调仓"}.items():
        if key=='trailing-pca':
            fields=[number("trainingRows",128,30,2000,title="训练窗口根数"),number("retrainEvery",63,1,1000,title="重新训练间隔"),number("components",3,1,7,title="保留主成分数")]
        else:
            fields=[{"id":"symbols","title":"事先指定研究证券（英文逗号）","type":"text","format":"text","minLength":3,"maxLength":512,"default":"000001,000002,000003"},
                {"id":"factorColumns","title":"因子列名（英文逗号）","type":"text","format":"text","minLength":3,"maxLength":512,"default":"factor_momentum,factor_lowvol"},
                {"id":"factorWeights","title":"对应有符号权重（英文逗号）","type":"text","format":"text","minLength":3,"maxLength":256,"default":"1,1"}]
            if key=='ranked-portfolio':fields.extend([number("topCount",2,1,16,title="取排名前几名（包含边界并列）"),
                number("minimumScore",.1,-1.,1.,title="最低入选分数"),number("rebalanceEvery",20,1,1000,title="每隔多少根评估调仓"),
                number("maxExposure",1.,.01,1.,title="总敞口上限"),number("maxSecurityWeight",.6,.01,1.,title="单证券目标上限"),
                number("capital",100000.,1.,1e10,title="初始虚拟资金"),number("feeBps",5.,0.,100.,title="单边费用基点")])
        factor.append({"id":key,"title":title,"formulaVersion":"webstock-factor-"+key+"-v1","parameters":fields,
            "inputKind":"ohlcv-single-csv" if key=='trailing-pca' else "market-panel-csv","outputKind":"backtest" if key=='ranked-portfolio' else 'indicator',
            "description":"PCA输出训练审计与载荷；外部因子需要逐值可知时间。组合保留选择、费用和现金账本。见FACTOR_MODELS.txt。"})
    records.append(save_package(args.output,{"id":"org.webstock.factor-models","name":"WebStock 因子合成与排名组合","license":"Project source terms; scikit-learn BSD-3-Clause",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas","scikit-learn"],"operations":factor},
        {"worker.py":"worker.py","factor_models.py":"factor_models.py","learning_models.py":"learning_models.py","portfolio_risk.py":"portfolio_risk.py","panel_contract.py":"panel_contract.py",
         "FACTOR_MODELS.txt":"FACTOR_MODELS.txt","PANEL_INPUT.txt":"PANEL_INPUT.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    records.append(save_package(args.output,{"id":"org.webstock.technical-ratings","name":"Technical Ratings v3条件 · 本地口径","license":"MPL-2.0 for technical_ratings.py; Project source terms for host adapter",
        "source":"https://www.tradingview.com/script/jDWyb5PG-TechnicalRating/","distributions":["numpy","pandas"],
        "operations":[{"id":"technical-ratings-v3","title":"26项技术条件 · 本地综合评分","formulaVersion":"webstock-tv-v3-conditions-local-kernel-v1",
            "parameters":[],"inputKind":"ohlcv-single-csv","outputKind":"indicator",
            "description":"公开v3条件逐项移植，显示分组、26项投票和底层数值；本地预热/零分母口径，未验证Pine逐点一致性。见TECHNICAL_RATINGS.txt。"}]},
        {"worker.py":"worker.py","technical_ratings.py":"technical_ratings.py","TECHNICAL_RATINGS.txt":"TECHNICAL_RATINGS.txt",
         "MPL-2.0.txt":"MPL-2.0.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    observations=[]
    for key,title in {'money-flow':'资金流 / DDE外部值','margin':'融资融券披露值','holdings':'机构 / 内幕人 / 大宗披露值',
                      'news':'新闻情绪外部分数','macro':'宏观实时版本','demark':'DeMARK外部输出','vendor-score':'供应商外部评分'}.items():
        fields=[{"id":"seriesId","title":"所选数据序列ID","type":"text","format":"text","minLength":1,"maxLength":64,"default":"primary"},
                number("maxAgeDays",365.,0.,36500.,title="观察期最大年龄（天）")]
        if key not in ('news','demark','vendor-score'):fields.extend([
            {"id":"transformation","title":"明确计算口径","type":"choice","default":"level","choices":["level","change","prior-z"]},
            number("priorWindow",20,2,1000,title="Z分数此前观察期数")])
        observations.append({"id":key+'-vintages',"title":title+' · 修订回放',"formulaVersion":"webstock-"+key+'-vintages-v1',
            "parameters":fields,"inputKind":"research-observations-csv","outputKind":"indicator",
            "description":"真实运行的外部数据接口，保留发布时间、修订和撤回；不复现供应商未知公式。见OBSERVATION_INPUT.txt。"})
    records.append(save_package(args.output,{"id":"org.webstock.external-observations","name":"WebStock 外部研究数据与修订","license":"Project source terms; input data retains provider terms",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas"],"operations":observations},
        {"worker.py":"worker.py","external_observations.py":"external_observations.py","observation_contract.py":"observation_contract.py","panel_contract.py":"panel_contract.py",
         "OBSERVATION_INPUT.txt":"OBSERVATION_INPUT.txt","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
    patterns=[]
    for key,title in {'squeeze-regression':'BB-KC收缩 / 回归动量 · 公开定义','impulse-candidate':'五段推进候选 · 确认收盘拐点','harmonic-candidate':'谐波比例候选 · 确认收盘拐点'}.items():
        if key=='squeeze-regression':fields=[number('period',20,2,1000,title='通道周期'),number('momentumPeriod',20,2,1000,title='回归动量周期'),
            number('bbMultiple',2.,.1,10.,title='BB标准差倍数'),number('kcMultiple',1.5,.1,10.,title='KC平均TR倍数')]
        else:
            fields=[number('reversalPct',5.,.01,99.,title='确认反转幅度（%）')]
            if key=='harmonic-candidate':fields.extend([
                {'id':'pattern','title':'明确比例模板','type':'choice','default':'abcd','choices':['abcd','retracement-618-786','retracement-382-500-886','extension-786-1270','extension-382-618-1618']},
                number('tolerancePct',5.,0.,20.,title='比例相对容差（%）')])
        patterns.append({'id':key,'title':title,'formulaVersion':'webstock-'+key+'-v1','parameters':fields,'inputKind':'ohlcv-single-csv','outputKind':'indicator',
            'description':'明确的本地计算规则；候选在拐点确认时输出，保留比例/规则审计，不回填极值日。见PATTERN_RESEARCH.txt。'})
    records.append(save_package(args.output,{'id':'org.webstock.pattern-research','name':'WebStock 收缩与确认形态研究','license':'Project source terms',
        'source':'https://github.com/chenganggang2020/WebStock','distributions':['numpy','pandas'],'operations':patterns},
        {'worker.py':'worker.py','pattern_research.py':'pattern_research.py','temporal_indicators.py':'temporal_indicators.py',
         'PATTERN_RESEARCH.txt':'PATTERN_RESEARCH.txt','THIRD_PARTY_NOTICES.txt':'THIRD_PARTY_NOTICES.txt'}))
    records.append(save_package(args.output,{'id':'org.webstock.cost-distribution','name':'WebStock 筹码成本假设模型','license':'Project source terms',
        'source':'https://github.com/chenganggang2020/WebStock','distributions':['numpy','pandas'],'operations':[
            {'id':'turnover-cost-model','title':'换手衰减成本分布 · 明确假设','formulaVersion':'webstock-turnover-cost-model-v1','inputKind':'ohlcv-single-csv','outputKind':'indicator',
             'parameters':[number('binWidth',.5,.0001,10000.,title='固定价格箱宽度'),
                 {'id':'retention','title':'旧质量保留模型','type':'choice','default':'linear-capped','choices':['linear-capped','poisson']}],
             'description':'需原始价格、以股为单位的成交量、当时自由流通股、连续会话及制度段。初始分布和日内成交分配是模型假设。见COST_DISTRIBUTION.txt。'}]},
        {'worker.py':'worker.py','cost_distribution.py':'cost_distribution.py','panel_contract.py':'panel_contract.py',
         'COST_DISTRIBUTION.txt':'COST_DISTRIBUTION.txt','THIRD_PARTY_NOTICES.txt':'THIRD_PARTY_NOTICES.txt'}))
    records.append(save_package(args.output,{'id':'org.webstock.limit-research','name':'WebStock 历史涨跌停与封板研究','license':'Project source terms',
        'source':'https://github.com/chenganggang2020/WebStock','distributions':['numpy','pandas'],'operations':[
            {'id':'limit-breadth','title':'历史涨跌停家数 / 观察连板','formulaVersion':'webstock-limit-breadth-v1','parameters':[],
             'inputKind':'market-panel-csv','outputKind':'indicator','description':'需每个历史会话实际限制价格、最小价位、已知规则与成分；日线不推断封板次数。见LIMIT_RESEARCH.txt。'},
            {'id':'limit-sequence','title':'连续竞价封板状态 / 已观察转变','formulaVersion':'webstock-limit-sequence-v1','parameters':[],
             'inputKind':'market-events-csv','outputKind':'indicator','description':'需带空侧盘口、当日最近成交、历史限制价与顺序的快照。采样数据不输出事件次数。见LIMIT_RESEARCH.txt。'}]},
        {'worker.py':'worker.py','limit_research.py':'limit_research.py','panel_contract.py':'panel_contract.py',
         'LIMIT_RESEARCH.txt':'LIMIT_RESEARCH.txt','PANEL_INPUT.txt':'PANEL_INPUT.txt','THIRD_PARTY_NOTICES.txt':'THIRD_PARTY_NOTICES.txt'}))
    option_operations=[]
    for key,title in {'option-iv':'欧式期权 IV / 模型希腊值','option-skew':'25Delta 偏斜 · 看跌减看涨','option-term-pcr':'远期平值 IV 期限 / Put-Call 比率'}.items():
        fields=[number('maxAgeSeconds',900,0,86400,title='报价与现货最长年龄（秒）'),number('maxVolatility',5.,.01,10.,title='IV求解上限（小数）')]
        fields.append({'id':'contractId','title':'绘图合约ID','type':'text','format':'text','default':'C100E1','minLength':1,'maxLength':128} if key=='option-iv' else number('expiryRank',1,1,100,title='绘图到期排名（近到远）'))
        option_operations.append({'id':key,'title':title,'formulaVersion':'webstock-'+key+'-v1','inputKind':'option-chain-csv','outputKind':'indicator','parameters':fields,
            'description':'欧式、连续r/q、ACT/365F、每标的单位报价。仅已知同步快照；不外推，不混接不同合约。见OPTION_RESEARCH.txt。'})
    records.append(save_package(args.output,{'id':'org.webstock.option-research','name':'WebStock 欧式期权研究','license':'Project source terms',
        'source':'https://github.com/chenganggang2020/WebStock','distributions':['numpy','pandas'],'operations':option_operations},
        {'worker.py':'worker.py','option_research.py':'option_research.py','panel_contract.py':'panel_contract.py',
         'OPTION_RESEARCH.txt':'OPTION_RESEARCH.txt','THIRD_PARTY_NOTICES.txt':'THIRD_PARTY_NOTICES.txt'}))
    (args.output/"index.json").write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(records,ensure_ascii=False))


if __name__=="__main__":main()
