"""Load only installed QUANTAXIS's offline indicator modules.

The package root initializer also starts unrelated database/data-source modules.
We deliberately load its original base.py and indicators.py without that startup.
"""
import hashlib
from functools import lru_cache
import importlib.metadata
import importlib.util
from pathlib import Path
import sys
import types
import pandas as pd
import numpy as np
from worker import table


@lru_cache(maxsize=1)
def load_original_modules():
    specification=importlib.util.find_spec("QUANTAXIS")
    if specification is None or specification.origin is None:
        raise ValueError("QUANTAXIS is not installed in this environment")
    root=Path(specification.origin).parent
    for name,folder in (("QUANTAXIS",root),("QUANTAXIS.QAIndicator",root/"QAIndicator")):
        module=types.ModuleType(name);module.__path__=[str(folder)];sys.modules[name]=module
    hashes={}
    for name in ("base","indicators"):
        path=root/"QAIndicator"/(name+".py")
        hashes[name+".py"]=hashlib.sha256(path.read_bytes()).hexdigest()
        full="QUANTAXIS.QAIndicator."+name
        spec=importlib.util.spec_from_file_location(full,path)
        module=importlib.util.module_from_spec(spec);sys.modules[full]=module;spec.loader.exec_module(module)
    return sys.modules["QUANTAXIS.QAIndicator.indicators"],hashes


def calculate(operation,frame,p):
    qa,hashes=load_original_modules()
    if operation=="ma":out=qa.QA_indicator_MA(frame,p["period"])
    elif operation=="macd":out=qa.QA_indicator_MACD(frame,short=p["fast"],long=p["slow"],mid=p["signal"])
    elif operation=="rsi":out=qa.QA_indicator_RSI(frame,N1=p["period1"],N2=p["period2"],N3=p["period3"])
    elif operation=="kdj":
        data=frame.copy()
        data.index=pd.MultiIndex.from_arrays([pd.to_datetime(frame.time),["INPUT"]*len(frame)],names=["datetime","code"])
        rsv=(frame.close-frame.low.rolling(p["period"]).min())/(frame.high.rolling(p["period"]).max()-frame.low.rolling(p["period"]).min())
        available=np.flatnonzero(np.isfinite(rsv.to_numpy()))
        first=max(1,int(available[0])) if len(available) else len(frame)
        out=(qa.QA_indicator_KDJ(data,N=p["period"],M1=p["smoothK"],M2=p["smoothD"]).reindex(data.index).reset_index(drop=True)
             if len(available) else pd.DataFrame(np.nan,index=frame.index,columns=["KDJ_K","KDJ_D","KDJ_J"]))
        # Original SMA prepends its seed to the preceding index. That row is
        # not available yet at that timestamp and must not become a signal.
        out.iloc[:first,:]=np.nan
    elif operation=="boll":out=qa.QA_indicator_BOLL(frame,N=p["period"],P=p["multiple"])
    else:raise ValueError("Unknown QUANTAXIS indicator")
    out=out.reindex(frame.index).copy();out.insert(0,"time",frame.time.to_numpy())
    if operation=="rsi":out.iloc[0,1:]=np.nan
    return {"kind":"indicator","engineVersion":importlib.metadata.version("quantaxis"),
        "formulaVersion":"quantaxis-available-"+operation+"-v1","moduleSha256":hashes,
        "tables":[table("indicators",out)],"warnings":["使用已安装QUANTAXIS原版离线指标函数及其初始化口径；不启动MongoDB或行情后台。",
        "相同名称不表示与TA-Lib公式完全一致；源码模块摘要已记录。",
        "原版SMA把初始化种子写到前一个索引；RSI/KDJ在种子真正可见前的值已屏蔽，防止预热区提前泄露。"]}
