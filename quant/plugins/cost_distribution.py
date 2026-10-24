"""Declared turnover-retention cost histogram; not an observed holder ledger."""
import math
import numpy as np
import pandas as pd
from panel_contract import timestamps
from worker import table


def validate(b):
    required={'barend','availableat','freefloatshares','freefloatknownat','regimeid','adjustment','volumeunit','currency','sessionindex','calendarid'}
    if not required<=set(b):raise ValueError('Cost model missing columns: '+', '.join(sorted(required-set(b))))
    if len(b)>20000:raise ValueError('Cost model requires at most 20000 closed observations')
    d=b.reset_index(drop=True).copy()
    for key in ('time','barend','availableat','freefloatknownat'):d[key]=timestamps(d[key],key)
    if ((d.barend>d.availableat)|(d.availableat>d.time)|(d.freefloatknownat>d.time)).any():raise ValueError('Future cost-model input')
    if not d.barend.is_monotonic_increasing or d.barend.duplicated().any():raise ValueError('Cost-model bars must be strictly chronological')
    if not d.adjustment.eq('unadjusted').all() or not d.volumeunit.eq('share').all():raise ValueError('Cost model requires unadjusted prices and share volume')
    for key in ('currency','regimeid','calendarid'):
        if d[key].isna().any():raise ValueError('Missing '+key)
        d[key]=d[key].astype(str)
        if not d[key].str.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,63}').all():raise ValueError('Invalid '+key)
    if d.currency.nunique()!=1 or d.calendarid.nunique()!=1:raise ValueError('One currency and declared calendar version required')
    for key in ('freefloatshares','sessionindex'):
        d[key]=pd.to_numeric(d[key],errors='raise').astype(float)
        if not np.isfinite(d[key]).all() or (d[key]%1!=0).any() or (d[key]<0).any() or (d[key]>1e13).any():raise ValueError('Invalid '+key)
    if (d.freefloatshares<=0).any() or not d.sessionindex.diff().iloc[1:].eq(1).all():raise ValueError('Positive free float and contiguous declared session indexes required')
    return d


def allocations(low,high,width):
    start=int(math.floor(low/width));end=int(math.floor(high/width))
    if end-start+1>4096:raise ValueError('Current price range exceeds 4096 bins; choose a coarser declared bin width')
    if low==high:return {start:1.}
    weights={k:max(0.,min(high,(k+1)*width)-max(low,k*width))/(high-low) for k in range(start,end+1)}
    return {k:v for k,v in weights.items() if v>0}


def quantile(keys,weights,width,p):
    cumulative=0.
    for k,w in zip(keys,weights):
        if cumulative+w>=p:return width*(k+(p-cumulative)/w)
        cumulative+=w
    return width*(keys[-1]+1)


def calculate(b,p):
    d=validate(b);width=float(p['binWidth']);mode=p['retention']
    if not np.isfinite(width) or width<=0 or mode not in ('linear-capped','poisson'):raise ValueError('Invalid cost-model parameters')
    mass={};rows=[];previous=None;generation=0;initial_weight=1.
    for r in d.itertuples(index=False):
        reason='initial-close-bin' if previous is None else 'regime-changed' if r.regimeid!=previous.regimeid else 'free-float-changed' if r.freefloatshares!=previous.freefloatshares else ''
        turnover=r.volume/r.freefloatshares
        if not np.isfinite(turnover):raise ValueError('Nonfinite turnover')
        retained=1-min(turnover,1.) if mode=='linear-capped' else math.exp(-turnover)
        if reason:
            generation+=1;mass={int(math.floor(r.close/width)):1.};initial_weight=1.;retained=np.nan
        else:
            new=allocations(r.low,r.high,width) if turnover>0 else {}
            mass={k:v*retained for k,v in mass.items() if v*retained>0}
            for k,v in new.items():mass[k]=mass.get(k,0.)+(1-retained)*v
            initial_weight*=retained
            total=math.fsum(mass.values());mass={k:v/total for k,v in mass.items() if v>0}
        if max(mass)-min(mass)+1>4096:raise ValueError('Accumulated cost span exceeds 4096 bins; increase binWidth or supply an actual regime reset')
        keys=sorted(mass);weights=np.array([mass[k] for k in keys]);centers=(np.array(keys)+.5)*width
        quantiles=[quantile(keys,weights,width,q) for q in (.05,.15,.5,.85,.95)]
        profit=float(sum(w*np.clip((r.close-k*width)/width,0.,1.) for k,w in mass.items()))
        peak=keys[int(np.argmax(weights))]
        rows.append({'time':r.time,'modelMeanCost':float(np.dot(weights,centers)),'modelProfitFraction':profit,
            'modelPeakCost':(peak+.5)*width,'cost05':quantiles[0],'cost15':quantiles[1],'cost50':quantiles[2],'cost85':quantiles[3],'cost95':quantiles[4],
            'central70Concentration':(quantiles[3]-quantiles[1])/(quantiles[3]+quantiles[1]),
            'central90Concentration':(quantiles[4]-quantiles[0])/(quantiles[4]+quantiles[0]),
            'turnoverFraction':turnover,'retainedPreviousFraction':retained,'initialAssumptionWeight':initial_weight,
            'modelGeneration':generation,'resetReason':reason,'freefloatshares':r.freefloatshares,'freefloatknownat':r.freefloatknownat,
            'regimeid':r.regimeid,'barend':r.barend,'availableat':r.availableat,'currency':r.currency})
        previous=r
    last=rows[-1];profile=[{'time':last['time'],'priceLower':k*width,'priceUpper':(k+1)*width,'modelWeight':mass.get(k,0.),
        'inCentral70':bool((k+1)*width>last['cost15'] and k*width<last['cost85'])} for k in range(min(mass),max(mass)+1)]
    return {'kind':'indicator','engineVersion':'webstock-cost-retention-v1','formulaVersion':'webstock-turnover-cost-model-v1',
        'inputSemantics':{'prices':'unadjusted','volume':'shares','floatBasis':'declared free float with availability','historicalProvenanceCertified':False},
        'modelSemantics':{'retention':mode,'tradeAllocation':'uniform within daily low/high; flat bar assigned to one bin',
            'initialization':'entire mass uniformly in the initial close bin; first bar turnover not applied',
            'reset':'new close-bin mass when regimeid or freefloatshares changes','gridOrigin':0,'binWidth':width,
            'costWithinBin':'uniform','profileAsOf':last['time'],'actualHolderLedger':False},
        'tables':[table('indicators',pd.DataFrame(rows)),table('model-cost-profile',pd.DataFrame(profile))],
        'warnings':['这是明确换手衰减假设下的筹码成本模型，不是股东真实成交或持仓账本，也不是某供应商算法的复现。',
            '首根与重置根假设全部质量在当根收盘所在价格箱，不应用当根换手；保留初始假设残余权重。公司行动需来源声明regimeid变化。',
            '日内成交成本按高低区间均匀分配、价格箱内均匀；没有真实逐价成交或持有人换手信息。获利比例为模型质量在收盘价以下的占比。',
            '右侧成本分布只表示本次输入末端；历史曲线逐行仅用当时数据。自由流通股变化会重置，未猜测新增股份成本。']}
