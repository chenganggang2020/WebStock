"""Original native ABI, next-bar fills and independent daily accounting."""
import sys
from pathlib import Path
import base64
import hashlib
import math
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_plugins import fixture
from wondertrader_adapters import roundtrip,backtest


bars=fixture(220)
bars["time"]=pd.bdate_range("2020-01-01",periods=len(bars)).astype(str)
bars[["open","high","low","close"]]=bars[["open","high","low","close"]].round(2)
converted=roundtrip(bars)
assert len(converted["tables"][0]["rows"])==len(bars)
artifact=converted["generatedData"]
assert hashlib.sha256(base64.b64decode(artifact["base64"],validate=True)).hexdigest()==artifact["sha256"]
p=dict(fast=3,slow=8,capital=100000.,quantity=100,feeBps=5.)
result=backtest(bars,p)
tables={t["id"]:pd.DataFrame(t["rows"],columns=t["columns"]) for t in result["tables"]}
trades=tables["trades"];assert len(trades)>4
fast=bars.close.rolling(p["fast"]).mean();slow=bars.close.rolling(p["slow"]).mean()
signals=((fast>slow)&(fast.shift()<=slow.shift())).astype(int)-((fast<slow)&(fast.shift()>=slow.shift())).astype(int)
days=pd.to_datetime(bars.time).dt.strftime("%Y%m%d").astype(int).tolist();indices={d:i for i,d in enumerate(days)}
ledger={}
for t in trades.itertuples(index=False):
    day=int(t.time)//10000;i=indices[day]
    assert i>0 and signals.iloc[i-1]!=0
    assert abs(t.price-bars.open.iloc[i])<1e-6,(i,t.price,bars.open.iloc[i])
    assert t.direct=="LONG" and t.action in ("OPEN","CLOSE")
    fee=math.floor(t.price*t.qty*p["feeBps"]/10000*100+.5)/100
    assert abs(t.fee-fee)<1e-8
    ledger.setdefault(day,[]).append((1 if t.action=="OPEN" else -1,t.qty,t.price,fee))
cash=p["capital"];position=0;expected={}
for i,day in enumerate(days):
    for side,quantity,price,fee in ledger.get(day,[]):
        cash-=side*quantity*price+fee
        position+=side*quantity
    expected[day]=cash+position*bars.close.iloc[i]
equity=tables["equity"]
np.testing.assert_allclose(equity.equity,[expected[d] for d in equity.date],atol=.0051,rtol=0)
assert equity.date.tolist() in (days,days[1:])
assert result["engineSeedBars"]==len(bars)-len(equity)
assert result["nativeLibrarySha256"]
print("Native DSB integrity, next-open fills, seed boundary and independent fee/equity checks passed")
