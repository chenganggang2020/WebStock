"""Published research observations and revisions, never rewritten into the past."""
import csv
from pathlib import Path
from urllib.parse import urlsplit
import numpy as np
import pandas as pd
from panel_contract import timestamps

FAMILIES={'money-flow','margin','holdings','news','macro','demark','vendor-score'}


def load_observations(path):
    with Path(path).open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.reader(stream);names=[s.strip().lower() for s in next(reader,[])]
        if any(len(row)!=len(names) for row in reader):raise ValueError('Observation row width differs from header')
    if not names or len(names)!=len(set(names)) or any(not s for s in names):raise ValueError('Duplicate or empty observation columns')
    b=pd.read_csv(path,dtype=str,keep_default_na=False,encoding='utf-8-sig');b.columns=names
    required={'time','sequence','observedat','availableat','seriesid','observationid','revision','state','value',
              'unit','source','sourceurl','definitionid','family','subject','entity','coverage'}
    if not required<=set(b):raise ValueError('Observation columns missing: '+', '.join(sorted(required-set(b))))
    if not 2<=len(b)<=20000 or len(names)>32:raise ValueError('Observations require 2..20000 rows and at most 32 columns')
    if b.family.nunique()!=1 or b.family.iloc[0] not in FAMILIES:raise ValueError('One supported observation family required')
    for key in ('time','observedat','availableat'):b[key]=timestamps(b[key],key)
    if not b.time.is_monotonic_increasing:raise ValueError('Observation decisions must be ordered')
    if ((b.observedat>b.availableat)|(b.availableat>b.time)).any():raise ValueError('Future/inconsistent observation or release time')
    for key in ('sequence','revision'):
        if not b[key].str.fullmatch(r'[0-9]{1,12}').all():raise ValueError(key+' must be a nonnegative integer of at most 12 digits')
        b[key]=b[key].astype('int64')
    if (b.sequence.diff().iloc[1:]<=0).any():raise ValueError('Global observation sequence must strictly increase')
    for key in ('seriesid','observationid'):
        if not b[key].str.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,63}').all():raise ValueError('Invalid '+key)
    for key in ('unit','source','definitionid','subject','entity'):
        if b[key].str.strip().eq('').any() or b[key].str.len().gt(256).any() or b[key].str.contains(r'[\x00-\x1f\x7f]',regex=True).any():
            raise ValueError('Bounded nonempty provenance required: '+key)
    for text in b.sourceurl:
        u=urlsplit(text)
        if len(text)>2048 or any(ord(c)<33 or ord(c)==127 for c in text) or u.scheme not in ('http','https') or not u.hostname or u.username is not None or u.password is not None:
            raise ValueError('Source URL must be a bounded HTTP(S) reference without embedded credentials')
    if not b.coverage.isin(['complete-vintages','partial-vintages']).all():raise ValueError('Declare complete-vintages or partial-vintages')
    if not b.state.isin(['published','withdrawn']).all():raise ValueError('Observation state must be published or withdrawn')
    published=b.state.eq('published')
    if b.loc[~published,'value'].ne('').any():raise ValueError('Withdrawn observations must have an empty value')
    value=pd.to_numeric(b.loc[published,'value'],errors='raise').astype(float)
    if not np.isfinite(value).all() or value.abs().gt(1e18).any():raise ValueError('Published values must be finite and bounded to 1e18')
    b['value']=np.nan;b.loc[published,'value']=value
    for series,rows in b.groupby('seriesid',sort=False):
        for key in ('family','unit','source','definitionid','subject','entity','coverage'):
            if rows[key].nunique()!=1:raise ValueError('Series meaning changed; assign a new seriesid: '+series+' / '+key)
        by_period={}
        for obs,versions in rows.groupby('observationid',sort=False):
            if versions.observedat.nunique()!=1:raise ValueError('Observation period cannot change across revisions')
            period=versions.observedat.iloc[0]
            if period in by_period and by_period[period]!=obs:raise ValueError('Multiple observation identities for one series/period')
            by_period[period]=obs;revisions=versions.revision.to_numpy();complete=versions.coverage.iloc[0]=='complete-vintages'
            if (np.diff(revisions)<=0).any() or (complete and ((np.diff(revisions)!=1).any() or revisions[0]!=0 or versions.state.iloc[0]!='published')):
                raise ValueError('Duplicate, reversed or missing claimed revision')
            if (versions.availableat.diff().iloc[1:]<=pd.Timedelta(0)).any():raise ValueError('Revision publication times must strictly increase')
    return b
