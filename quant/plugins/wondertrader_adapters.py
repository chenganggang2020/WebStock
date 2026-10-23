"""WonderTrader native data helper and CTA engine through the official wtpy ABI."""
import base64
import hashlib
import importlib.metadata
import json
import sys
from pathlib import Path
import tempfile
import numpy as np
import pandas as pd
from worker import table


def native_hashes():
    import wtpy
    root=Path(wtpy.__file__).parent
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob("*.dll") if p.name in ("WtBtPorter.dll","WtDtHelper.dll")}


def roundtrip(frame):
    from wtpy.WtCoreDefs import WTSBarStruct
    from wtpy.wrapper.WtDtHelper import WtDataHelper,CB_DTHELPER_LOG
    dates=pd.to_datetime(frame.time)
    if dates.dt.normalize().duplicated().any():raise ValueError("DSB daily conversion requires one bar per day")
    records=(WTSBarStruct*len(frame))()
    for i,r in enumerate(frame.itertuples(index=False)):
        item=records[i];item.date=int(pd.Timestamp(r.time).strftime("%Y%m%d"))
        item.open=r.open;item.high=r.high;item.low=r.low;item.close=r.close;item.vol=r.volume
        item.money=getattr(r,"amount",0.)
    with tempfile.TemporaryDirectory(prefix="webstock-wt-data-") as temporary:
        path=Path(temporary)/"input.dsb";helper=WtDataHelper()
        def native_log(message):
            try:text=message.decode("utf-8")
            except UnicodeDecodeError:text=message.decode("gb18030",errors="replace")
            print(text,file=sys.stderr)
        helper.cb_dthelper_log=CB_DTHELPER_LOG(native_log)
        if not helper.store_bars(str(path),records,len(frame),"d"):raise RuntimeError("Native DSB write failed")
        restored=helper.read_dsb_bars(str(path))
        if restored is None or len(restored)!=len(frame):raise RuntimeError("Native DSB read count differs")
        values=restored.ndarray
        for key in ("open","high","low","close","volume"):
            np.testing.assert_array_equal(values[key],frame[key].to_numpy())
        np.testing.assert_array_equal(values["date"],dates.dt.strftime("%Y%m%d").astype(int))
        output=pd.DataFrame({"time":frame.time.to_numpy(),**{k:values[k] for k in ("open","high","low","close","volume","turnover")}})
        raw=path.read_bytes()
        return {"kind":"indicator","engineVersion":importlib.metadata.version("wtpy"),
            "formulaVersion":"wtpy-native-daily-dsb-roundtrip-v1","nativeLibrarySha256":native_hashes(),
            "tables":[table("native-dsb-bars",output)],"generatedData":{"name":"input.dsb","sha256":hashlib.sha256(raw).hexdigest(),"base64":base64.b64encode(raw).decode("ascii")},
            "warnings":["由原版WtDtHelper写入并读回DSB，逐项检查日期及OHLCV一致；不是价格预测指标。",
                "原生DSB内容保存在结果generatedData字段；缺失成交额时容器填0，此0不能用于成交额指标。"]}


def backtest(frame,p):
    from wtpy import WtBtEngine,EngineType,BaseCtaStrategy
    if p["fast"]>=p["slow"]:raise ValueError("fast must be less than slow")
    dates=pd.to_datetime(frame.time)
    if dates.dt.normalize().duplicated().any() or (dates.dt.dayofweek>=5).any():
        raise ValueError("Native daily replay currently requires distinct weekday bars")
    code="WS.STK.INPUT";callback_errors=[];seen=[]
    with tempfile.TemporaryDirectory(prefix="webstock-wonder-",ignore_cleanup_errors=True) as temporary:
        root=Path(temporary);storage=root/"storage/csv";storage.mkdir(parents=True)
        def save(name,value):(root/name).write_text(json.dumps(value),encoding="utf-8")
        save("commodities.json",{"WS":{"STK":{"category":0,"covermode":0,"exchg":"WS","holiday":"INPUT",
            "name":"Frozen stock","precision":6,"pricemode":1,"pricetick":.000001,"session":"DAY","volscale":1,"trademode":0}}})
        save("contracts.json",{"WS":{"INPUT":{"code":"INPUT","exchg":"WS","name":"Frozen input","product":"STK"}}})
        save("sessions.json",{"DAY":{"name":"Synthetic daily session","offset":0,"sections":[{"from":930,"to":1500}]}})
        missing=pd.date_range(dates.iloc[0],dates.iloc[-1]).difference(pd.DatetimeIndex(dates))
        save("holidays.json",{"INPUT":[t.strftime("%Y%m%d") for t in missing]})
        save("fees.json",{"WS.STK":{"open":p["feeBps"]/10000,"close":p["feeBps"]/10000,"closetoday":p["feeBps"]/10000,"byvolume":False}})
        prices=frame[["open","high","low","close","volume"]].copy()
        prices.insert(0,"date",dates.dt.strftime("%Y/%m/%d"));prices["turnover"]=frame.amount if "amount" in frame else 0.
        prices.to_csv(storage/(code+"_d.csv"),index=False)
        logs={"root":{"async":False,"level":"error","sinks":[{"type":"console_sink","pattern":"%v"}]},
            "dyn_pattern":{"strategy":{"async":False,"level":"error","sinks":[{"type":"console_sink","pattern":"%v"}]}}}
        engine=WtBtEngine(EngineType.ET_CTA,logCfg=json.dumps(logs),isFile=False,outDir=str(root/"output"))
        engine.init_with_config(str(root),{"env":{"mocker":"cta"},"replayer":{"basefiles":{},"fees":str(root/"fees.json")}},
            commfile="commodities.json",contractfile="contracts.json",sessionfile="sessions.json",holidayfile="holidays.json")
        engine.configBacktest(int(dates.iloc[0].strftime("%Y%m%d"))*10000+930,int(dates.iloc[-1].strftime("%Y%m%d"))*10000+1501)
        engine.configBTStorage("csv",str(storage.parent));engine.commitBTConfig()
        fast=frame.close.rolling(p["fast"]).mean();slow=frame.close.rolling(p["slow"]).mean()
        signals=((fast>slow)&(fast.shift()<=slow.shift())).astype(int)-((fast<slow)&(fast.shift()>=slow.shift())).astype(int)
        bydate=dict(zip(dates.dt.strftime("%Y%m%d").astype(int),signals))
        class Cross(BaseCtaStrategy):
            def on_init(self,context):context.stra_prepare_bars(code,"d1",p["slow"]+1,isMain=True)
            def on_calculate(self,context):
                try:
                    bars=context.stra_get_bars(code,"d1",p["slow"]+1,isMain=True)
                    if bars is None or not len(bars):return
                    date=int(bars.bartimes[-1]);seen.append(date)
                    signal=bydate.get(date,0)
                    position=context.stra_get_position(code)
                    if signal>0 and not position:context.stra_set_position(code,p["quantity"],"closed-bar-cross-up")
                    elif signal<0 and position:context.stra_set_position(code,0,"closed-bar-cross-down")
                except Exception as error:callback_errors.append(str(error))
        strategy=Cross("webstock_sma");engine.set_cta_strategy(strategy,slippage=0,persistData=True)
        version=engine.__wrapper__.ver
        try:engine.run_backtest()
        finally:engine.release_backtest()
        if callback_errors:raise RuntimeError("Native strategy callback failed: "+callback_errors[0])
        output=root/"output/webstock_sma"
        if not (output/"funds.csv").is_file():raise RuntimeError("Native engine did not produce funds.csv")
        funds=pd.read_csv(output/"funds.csv")
        funds.insert(0,"time",pd.to_datetime(funds.date.astype(str),format="%Y%m%d").astype(str))
        funds["equity"]=p["capital"]+funds.dynbalance
        tables=[table("equity",funds)]
        for name in ("trades","signals","closes"):
            path=output/(name+".csv")
            if path.is_file():tables.append(table(name,pd.read_csv(path)))
        actual_dates=funds.date.astype(int).tolist();input_dates=dates.dt.strftime("%Y%m%d").astype(int).tolist()
        if actual_dates not in (input_dates,input_dates[1:]):raise RuntimeError("Native replay unexpectedly dropped input sessions")
        seed_bars=len(frame)-len(funds)
        return {"kind":"backtest","engineVersion":str(version),"wrapperVersion":importlib.metadata.version("wtpy"),
            "formulaVersion":"wondertrader-daily-sma-cross-v1","nativeLibrarySha256":native_hashes(),
            "tables":tables,"observedBars":len(seen),"engineSeedBars":seed_bars,"executionPolicy":{"signal":"closed daily-bar SMA crossover",
                "execution":"next-bar open reference, daily-session-end fill timestamps","cashConstraint":False,
                "commissionRate":p["feeBps"]/10000,"commissionRounding":"per-fill nearest cent, positive half-up","slippage":0},
            "warnings":["调用wtpy发行版附带的WonderTrader原生引擎，记录原生版本与DLL摘要；不是把下载的C++仓库重新编译所得。",
                "虚拟品种按单倍合约核算盈亏，输入不含公司行动；未验证A股现金/T+1/涨跌停，原始信号与成交表用于核查撮合时间。",
                "原生资金表以两位小数输出；dynbalance已扣累计费用，展示权益仅加初始参考资金。",
                "引擎可能将输入首根用作初始化，不输出该日权益；engineSeedBars记录数量，不伪造缺少的账户行。"]}
