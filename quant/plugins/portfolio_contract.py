"""Positive-capital portfolio valuations with explicitly timed external flows."""
import csv
from pathlib import Path
import numpy as np
import pandas as pd
from panel_contract import timestamps


def load_portfolio(path):
    with Path(path).open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.reader(stream);names=[x.strip().lower() for x in next(reader,[])]
        if any(len(row)!=len(names) for row in reader):raise ValueError('Portfolio row width differs from header')
    if not names or len(names)!=len(set(names)) or any(not x for x in names):
        raise ValueError('Duplicate or empty portfolio columns')
    b=pd.read_csv(path,dtype=str,keep_default_na=False,encoding='utf-8-sig');b.columns=names
    required={'time','valuationat','availableat','equity','externalflow','flowtiming','feesincluded','currency','source'}
    if not required<=set(b):raise ValueError('Portfolio missing columns: '+', '.join(sorted(required-set(b))))
    if not 2<=len(b)<=100000 or len(names)>32:raise ValueError('Portfolio requires 2..100000 rows and at most 32 columns')
    for key in ('time','valuationat','availableat'):b[key]=timestamps(b[key],key)
    if b.time.duplicated().any() or not b.time.is_monotonic_increasing or b.valuationat.duplicated().any() or not b.valuationat.is_monotonic_increasing:
        raise ValueError('Portfolio decision and valuation times must strictly increase')
    if ((b.valuationat>b.availableat)|(b.availableat>b.time)).any():raise ValueError('Future or inconsistent portfolio availability')
    if not b.flowtiming.eq('end').all():raise ValueError('Only explicitly end-of-valuation external cash flows supported')
    if not b.feesincluded.str.lower().isin(['true','1']).all():raise ValueError('Net-of-fees portfolio equity must be explicitly declared')
    if b.currency.nunique()!=1 or b.currency.iloc[0] not in ('CNY','USD','HKD'):raise ValueError('One explicit portfolio currency required')
    if b.source.str.len().lt(1).any() or b.source.str.len().gt(256).any():raise ValueError('Portfolio source required')
    for key in ('equity','externalflow'):b[key]=pd.to_numeric(b[key],errors='raise').astype(float)
    if not np.isfinite(b[['equity','externalflow']]).all().all():raise ValueError('Nonfinite portfolio capital or flow')
    if (b.equity<=0).any() or (b.equity-b.externalflow<=0).any():
        raise ValueError('Positive capital before/after end flow required; bankruptcy or recapitalization needs a separate capital segment')
    if b.externalflow.iloc[0]!=0:raise ValueError('First valuation is starting capital; first externalflow must be zero')
    return b
