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
                    entrypoint="worker.py", runtime="python", version="0.3.0",
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
        "vwma":"滚动 VWMA","anchored-vwap-proxy":"首根锚定的 VWAP 近似","amihud":"Amihud 非流动性","heikin-ashi":"Heikin Ashi 合成图"}
    core=[]
    for key,title in names.items():
        fields=[] if key in ("bbi","ao-ac","vpt","anchored-vwap-proxy","heikin-ashi") else [number("period",20,title="计算周期")]
        if key=="tsi": fields=[number("fast",13,title="快速平滑"),number("slow",25,title="慢速平滑")]
        if key in ("realized-volatility","ewma-volatility","drawdown-downside"):
            fields.append(number("annualBars",252,1,100000,title="每年K线数"))
        if key=="ewma-volatility":fields.append(number("decay",0.94,0.01,0.9999,title="衰减系数"))
        if key=="bollinger-derived":fields.append(number("rankWindow",120,title="分位历史窗口"))
        if key in ("keltner","chandelier"):fields.append(number("multiple",3.,0.1,20,title="ATR 倍数"))
        if key=="historical-var-es":fields.append(number("confidence",0.95,0.5,0.999,title="置信水平"))
        core.append({"id":key,"title":title,"formulaVersion":"webstock-"+key+"-v1","parameters":fields,
                     "inputKind":"ohlcv-single-csv","outputKind":"indicator","description":"仅使用已完成K线的有版本公式。"})
    records.append(save_package(args.output,{"id":"org.webstock.core-indicators","name":"WebStock 补充指标","license":"Project source terms",
        "source":"https://github.com/chenganggang2020/WebStock","distributions":["numpy","pandas"],"operations":core},
        {"worker.py":"worker.py","core_indicators.py":"core_indicators.py","THIRD_PARTY_NOTICES.txt":"THIRD_PARTY_NOTICES.txt"}))
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
        ("vectorbt","vectorbt 向量回测","Apache-2.0 + Commons Clause","polakowo/vectorbt","vectorbt")]:
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
    (args.output/"index.json").write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(records,ensure_ascii=False))


if __name__=="__main__":main()
