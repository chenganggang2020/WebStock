"""Bounded, explicit historical panel input; timestamps are claims to validate,
not a certification of the external provider's point-in-time provenance.
"""
from pathlib import Path
import csv
import numpy as np
import pandas as pd


def timestamps(values, label):
    text=values.astype(str)
    if not text.str.contains(r"(?:Z|[+-][0-9]{2}:[0-9]{2})$",regex=True).all():
        raise ValueError(label+" requires an explicit UTC offset or Z")
    result=pd.to_datetime(text,format="ISO8601",utc=True,errors="raise")
    if result.isna().any():raise ValueError("Missing timestamp: "+label)
    return result


def load_panel(path):
    with Path(path).open(encoding="utf-8-sig",newline="") as stream:
        reader=csv.reader(stream)
        names=[x.strip().lower() for x in next(reader,[])]
        if any(len(row)!=len(names) for row in reader):raise ValueError("Panel CSV row width differs from header")
    if not names or any(not x for x in names) or len(names)!=len(set(names)):
        raise ValueError("Duplicate or empty panel columns")
    b=pd.read_csv(path,dtype=str,keep_default_na=False,encoding="utf-8-sig")
    b.columns=names
    required={"time","symbol","barend","availableat","membershipknownat","member","universecount",
              "open","high","low","close","volume","currency","pricebasis","volumeunit","isclosed"}
    if not required<=set(b):raise ValueError("Panel missing columns: "+", ".join(sorted(required-set(b))))
    if not 4<=len(b)<=100000 or b.shape[1]>64:raise ValueError("Panel requires 4–100000 rows and at most 64 columns")
    if not b.symbol.str.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}").all():raise ValueError("Invalid symbol")
    for key in ("time","barend","availableat","membershipknownat"):
        b[key]=timestamps(b[key],key)
    if b.time.nunique()<2 or not b.time.is_monotonic_increasing or b.duplicated(["time","symbol"]).any():
        raise ValueError("Panel decisions must increase; time/symbol must be unique")
    if ((b.barend>b.availableat)|(b.availableat>b.time)|(b.membershipknownat>b.time)).any():
        raise ValueError("Future or inconsistent market/membership availability")
    for symbol,rows in b.groupby("symbol",sort=False):
        if rows.barend.duplicated().any() or not rows.barend.is_monotonic_increasing:
            raise ValueError("Repeated or unordered source bars: "+symbol)
    if not b.member.isin(["0","1"]).all():raise ValueError("member must be explicitly 0 or 1")
    b["member"]=b.member.astype(int)
    b["universecount"]=pd.to_numeric(b.universecount,errors="raise")
    for _,rows in b.groupby("time",sort=False):
        if rows.barend.nunique()!=1:raise ValueError("Each decision requires synchronized bar-end timestamps")
        if rows.universecount.nunique()!=1 or rows.universecount.iloc[0]!=rows.member.sum() or rows.member.sum()<1:
            raise ValueError("Declared historical universe count differs from member rows")
    if not b.isclosed.str.lower().isin(["1","true"]).all():raise ValueError("Unclosed panel bars")
    if b.currency.nunique()!=1 or b.currency.iloc[0] not in ("CNY","USD","HKD"):
        raise ValueError("One declared CNY/USD/HKD currency required; no implicit FX conversion")
    if b.pricebasis.nunique()!=1 or b.pricebasis.iloc[0] not in ("raw","split-adjusted","total-return"):
        raise ValueError("One explicit price basis required")
    if not b.volumeunit.eq("share").all():raise ValueError("Panel volume must be in shares")
    for key in ("open","high","low","close","volume"):
        b[key]=pd.to_numeric(b[key],errors="raise").astype(float)
    if not np.isfinite(b[["open","high","low","close","volume"]]).all().all():raise ValueError("Nonfinite panel OHLCV")
    if (b[["open","high","low","close"]]<=0).any().any() or (b.volume<0).any():raise ValueError("Invalid panel OHLCV")
    if ((b.high<b[["open","low","close"]].max(axis=1))|(b.low>b[["open","high","close"]].min(axis=1))).any():
        raise ValueError("Inconsistent panel OHLC range")
    # All supplied optional availability claims are checked, even if unused.
    for key in b.columns:
        if key.endswith("_knownat"):
            mask=b[key].ne("")
            if (timestamps(b.loc[mask,key],key)>b.loc[mask,"time"]).any():raise ValueError("Future optional data: "+key)
    return b


def known_numeric(b,key,positive=False,nonnegative=False):
    stamp=key+"_knownat"
    if key not in b or stamp not in b:raise ValueError("Required value and availability: "+key+", "+stamp)
    values=pd.to_numeric(b[key],errors="raise").astype(float)
    if not np.isfinite(values).all():raise ValueError("Missing/nonfinite "+key)
    if positive and not (values>0).all():raise ValueError(key+" must be positive")
    if nonnegative and (values<0).any():raise ValueError(key+" cannot be negative")
    when=timestamps(b[stamp],stamp)
    if (when>b.time).any():raise ValueError("Future "+key)
    return values


def known_industry(b):
    if not {"industry","industry_knownat"}<=set(b):raise ValueError("Industry classification and known-at timestamps required")
    if b.industry.eq("").any() or b.industry.str.len().gt(128).any():raise ValueError("Missing/invalid industry")
    if (timestamps(b.industry_knownat,"industry_knownat")>b.time).any():raise ValueError("Future industry classification")
    return b.industry


def wide(b,key):
    # Reindexing inserts missing rows as NaN. It never carries prices forward.
    return b.pivot(index="time",columns="symbol",values=key).sort_index()


def observations(frame):
    return frame.rename_axis(index="time",columns="symbol").stack(future_stack=True).rename("value").reset_index()
