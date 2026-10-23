"""Temporal and execution checks, run with each engine's own interpreter."""
import argparse
import sys
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from worker import compute,validate_parameters
from test_plugins import fixture
import json


def numeric(table):
    return np.array([row[1:] for row in table["rows"]],dtype=float)


def test_indicators(manifest,bars):
    for operation in manifest["operations"]:
        params=validate_parameters(operation,{})
        full=compute(manifest,operation,bars,params)
        for count in (2,8,9,10,26,120):
            shorter=compute(manifest,operation,bars.iloc[:count].copy(),params)
            np.testing.assert_allclose(numeric(full["tables"][0])[:count],numeric(shorter["tables"][0]),equal_nan=True,
                                       rtol=1e-10,atol=1e-10,err_msg=operation["id"]+" prefix "+str(count))
        if manifest["id"].endswith("quantaxis") and operation["id"]=="kdj":
            assert np.isnan(numeric(full["tables"][0])[:params["period"]-1]).all()
            flat=bars.copy();flat[["open","high","low","close"]]=100.
            assert np.isnan(numeric(compute(manifest,operation,flat,params)["tables"][0])).all()
        print("prefix verified:",operation["id"],flush=True)


def test_qlib(manifest,bars):
    operation=manifest["operations"][0]
    full=compute(manifest,operation,bars,{})
    prefix=compute(manifest,operation,bars.iloc[:120].copy(),{})
    assert full["featureCount"]==158 and full["missingFeatures"]==["VWAP0"]
    for a,b in zip(full["tables"][:4],prefix["tables"][:4],strict=True):
        np.testing.assert_allclose(numeric(a)[:120],numeric(b),rtol=1e-6,atol=1e-6,equal_nan=True)
    definitions=full["tables"][-1]
    assert len(definitions["rows"])==158
    # Reproduce one original expression independently, including storage precision.
    first=full["tables"][0]
    expected=(bars.close.astype(np.float32)-bars.open.astype(np.float32))/bars.open.astype(np.float32)
    np.testing.assert_allclose(np.array(first["rows"],dtype=object)[:,first["columns"].index("KMID")].astype(float),expected,rtol=1e-6,atol=1e-6)
    print("Alpha158 prefix, missing-VWAP and independent KMID checks passed",flush=True)


def test_backtest(manifest,bars):
    operation=manifest["operations"][0];params=validate_parameters(operation,{})
    params.update(fast=3,slow=8)
    result=compute(manifest,operation,bars,params)
    tables={t["id"]:pd.DataFrame(t["rows"],columns=t["columns"]) for t in result["tables"]}
    fills=tables["fills"]
    assert len(fills)>4,"Fixture must exercise fills"
    cta=manifest["id"].endswith("ctastrategy")
    timecol="time" if cta else "timestamp"
    times=pd.to_datetime(bars.time)
    indices={t:i for i,t in enumerate(times)}
    fast=bars.close.rolling(params["fast"]).mean();slow=bars.close.rolling(params["slow"]).mean()
    signals=((fast>slow)&(fast.shift()<=slow.shift())).astype(int)-((fast<slow)&(fast.shift()>=slow.shift())).astype(int)
    for row in fills.itertuples(index=False):
        index=indices[pd.Timestamp(getattr(row,timecol))]
        assert index>0 and signals.iloc[index-1]!=0,"Execution must follow an earlier closed-bar signal"
        if not cta:
            assert abs(row.price-bars.open.iloc[index])<1e-8,"Expected next-open execution"
            assert abs(row.commission-abs(row.quantity)*row.price*params["feeBps"]/10000)<1e-8
        else:
            assert bars.low.iloc[index]-1e-8<=row.price<=bars.high.iloc[index]+1e-8
    if cta:
        # Independent cash+inventory reconstruction of the engine's daily PnL.
        ledger={};cash=params["capital"];position=0
        for row in fills.itertuples(index=False):
            direction=1 if row.side=="多" else -1
            assert row.side in ("多","空")
            ledger.setdefault(pd.Timestamp(row.time),[]).append((direction,row.quantity,row.price))
        equity=[]
        for index,timestamp in enumerate(times):
            for direction,quantity,price in ledger.get(timestamp,[]):
                cash-=direction*quantity*price+quantity*price*params["feeBps"]/10000
                position+=direction*quantity
            equity.append(cash+position*bars.close.iloc[index])
        np.testing.assert_allclose(tables["equity"].equity,equity,atol=1e-7,rtol=1e-10)
    print("Execution timing and accounting checks passed:",manifest["id"],flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("package",type=Path);args=parser.parse_args()
    manifest=json.loads(args.package.read_text(encoding="utf-8"))["manifest"]
    bars=fixture(220)
    if manifest["id"].endswith("qlib"):test_qlib(manifest,bars)
    elif manifest["operations"][0]["outputKind"]=="indicator":test_indicators(manifest,bars)
    else:test_backtest(manifest,bars)
