"""Run original LEAN, then independently audit temporal and cash accounting."""
from pathlib import Path
import sys
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lean_adapter import calculate
from test_plugins import fixture

bars=fixture(220)
p=dict(engineDirectory=sys.argv[1],fast=3,slow=8,quantity=100,capital=100000,feeBps=5)
result=calculate(bars,p)
tables={t["id"]:pd.DataFrame(t["rows"],columns=t["columns"]) for t in result["tables"]}
orders=tables["orders"];fills=orders[orders.status=="Filled"]
assert len(fills)>5
fast=bars.close.rolling(p["fast"]).mean();slow=bars.close.rolling(p["slow"]).mean()
signals=((fast>slow)&(fast.shift()<=slow.shift())).astype(int)-((fast<slow)&(fast.shift()>=slow.shift())).astype(int)
days=pd.to_datetime(bars.time).dt.strftime("%Y-%m-%d").tolist();indices={d:i for i,d in enumerate(days)}
ledger={}
for t in fills.itertuples(index=False):
    i=indices[t.time];assert i>0
    assert t.signalTag=="signal:"+days[i-1]
    assert signals.iloc[i-1]==np.sign(t.quantity)
    assert abs(t.price-bars.close.iloc[i])<1e-9
    assert abs(t.fee-abs(t.quantity)*t.price*p["feeBps"]/10000)<1e-9
    ledger.setdefault(t.time,[]).append(t)
cash=p["capital"];position=0;expected=[]
for i,day in enumerate(days):
    for t in ledger.get(day,[]):cash-=t.quantity*t.price+t.fee;position+=t.quantity
    expected.append((cash+position*bars.close.iloc[i],cash,position))
np.testing.assert_allclose(tables["equity"][["equity","cash","position"]],expected,rtol=0,atol=1e-7)
short=calculate(bars.iloc[:120].copy(),p)
short_equity=pd.DataFrame(short["tables"][0]["rows"],columns=short["tables"][0]["columns"])
pd.testing.assert_frame_equal(tables["equity"].iloc[:120].reset_index(drop=True),short_equity,check_exact=False,atol=1e-9)
print("LEAN original engine: next-close fills, fee/cash/position ledger, exact input coverage and prefix invariance passed")
