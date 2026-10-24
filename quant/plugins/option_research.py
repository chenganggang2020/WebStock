"""European cash-equity option snapshots: declared inputs, bounded IV, no extrapolation."""
import csv
import math
from pathlib import Path
import numpy as np
import pandas as pd
from panel_contract import timestamps
from worker import table


def load_options(path):
    with Path(path).open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.reader(stream);names=[s.strip().lower() for s in next(reader,[])]
        if any(len(row)!=len(names) for row in reader):raise ValueError('Option row width differs from header')
    if not names or len(names)!=len(set(names)) or any(not s for s in names):raise ValueError('Duplicate/empty option columns')
    b=pd.read_csv(path,dtype=str,keep_default_na=False,encoding='utf-8-sig');b.columns=names
    required=set('time contract underlying expiry right style strike spot spotat spotknownat bid ask quoteat quoteknownat rate rateknownat dividendyield yieldknownat volume volumestart volumeat volumeknownat openinterest oiat oiknownat multiplier currency priceunit volumeunit universeid universecount source modelbasis'.split())
    if not required<=set(b):raise ValueError('Option columns missing: '+', '.join(sorted(required-set(b))))
    if not 2<=len(b)<=20000 or len(names)>48:raise ValueError('Option chain requires 2..20000 rows and at most 48 columns')
    for key in ('time','expiry','spotat','spotknownat','quoteat','quoteknownat','rateknownat','yieldknownat','volumestart','volumeat','volumeknownat','oiat','oiknownat'):
        b[key]=timestamps(b[key],key)
    if not b.time.is_monotonic_increasing or (b.expiry<=b.time).any():raise ValueError('Ordered decisions and unexpired contracts required')
    for observed,known in (('spotat','spotknownat'),('quoteat','quoteknownat'),('volumeat','volumeknownat'),('oiat','oiknownat')):
        if ((b[observed]>b[known])|(b[known]>b.time)).any():raise ValueError('Future or inconsistent '+observed)
    if (b.volumestart>b.volumeat).any() or (b.rateknownat>b.time).any() or (b.yieldknownat>b.time).any():raise ValueError('Future/inconsistent volume interval, rate or yield')
    for key in ('contract','underlying','universeid','currency','source','modelbasis'):
        if b[key].str.strip().eq('').any() or b[key].str.len().gt(128).any() or b[key].str.contains(r'[\x00-\x1f\x7f]',regex=True).any():raise ValueError('Bounded nonempty '+key+' required')
    if not b.right.isin(['call','put']).all() or not b['style'].eq('european').all():raise ValueError('Only explicitly European call/put contracts supported')
    if not b.priceunit.eq('per-underlying-unit').all() or not b.volumeunit.eq('contract').all():raise ValueError('Explicit per-underlying-unit prices and contract counts required')
    if not b.modelbasis.eq('continuous-r-q-act365f').all():raise ValueError('Declare continuous-r-q-act365f model basis')
    for key in ('strike','spot','bid','ask','rate','dividendyield','volume','openinterest','multiplier','universecount'):
        b[key]=pd.to_numeric(b[key],errors='raise').astype(float)
        if not np.isfinite(b[key]).all():raise ValueError('Non-finite '+key)
    for key in ('strike','spot','multiplier'):
        if not b[key].between(1e-6,1e8).all():raise ValueError('Invalid positive '+key)
    for key in ('bid','ask'):
        if not b[key].between(0,1e8).all():raise ValueError('Invalid '+key)
    if (b.bid>b.ask).any() or not b.rate.between(-1,1).all() or not b.dividendyield.between(-1,1).all():raise ValueError('Crossed quotes or unbounded rate/yield')
    if ((b.expiry-b.time).dt.total_seconds()>20*365*86400).any():raise ValueError('Maturity exceeds 20 ACT/365F years')
    for key in ('volume','openinterest','universecount'):
        if not b[key].between(0,1e12).all() or (b[key]%1!=0).any():raise ValueError('Invalid integer '+key)
    for key in ('underlying','currency','source','modelbasis','multiplier'):
        if b[key].nunique()!=1:raise ValueError('One '+key+' cohort required')
    for contract,rows in b.groupby('contract',sort=False):
        for key in ('expiry','right','strike','multiplier'):
            if rows[key].nunique()!=1:raise ValueError('Contract terms changed; use a new contract identity: '+contract)
    for time,rows in b.groupby('time',sort=False):
        if rows.contract.duplicated().any() or rows.duplicated(['expiry','right','strike']).any():raise ValueError('Duplicate contract or economic strike in snapshot')
        for key in ('spot','spotat','spotknownat','volumestart','volumeat','volumeknownat','oiat','oiknownat','universeid','universecount'):
            if rows[key].nunique()!=1:raise ValueError('Unsynchronized snapshot '+key)
        if rows.universecount.iloc[0]!=len(rows):raise ValueError('Declared universecount differs from snapshot')
        for expiry,chain in rows.groupby('expiry',sort=False):
            for key in ('rate','rateknownat','dividendyield','yieldknownat'):
                if chain[key].nunique()!=1:raise ValueError('One declared expiry curve input required: '+key)
    return b


def cdf(x):return .5*math.erfc(-x/math.sqrt(2.))


def bounds(spot,strike,t,rate,yield_,right):
    sd=spot*math.exp(-yield_*t);kd=strike*math.exp(-rate*t)
    return (max(sd-kd,0.),sd) if right=='call' else (max(kd-sd,0.),kd)


def price(spot,strike,t,rate,yield_,sigma,right):
    if sigma<=0:return bounds(spot,strike,t,rate,yield_,right)[0]
    sd=spot*math.exp(-yield_*t);kd=strike*math.exp(-rate*t);v=sigma*math.sqrt(t)
    d1=(math.log(spot/strike)+(rate-yield_)*t)/v+.5*v;d2=d1-v
    # Evaluate the out-of-money leg first, then use parity for the in-money leg.
    if sd<=kd:
        call=max(0.,sd*cdf(d1)-kd*cdf(d2));return call if right=='call' else call+kd-sd
    put=max(0.,kd*cdf(-d2)-sd*cdf(-d1));return put if right=='put' else put+sd-kd


def implied(value,spot,strike,t,rate,yield_,right,max_vol=5.):
    lower,upper=bounds(spot,strike,t,rate,yield_,right);tol=1e-11*max(1.,spot,strike)
    if value<lower-tol or value>=upper:return None,'outside-price-bounds'
    if value<=lower+tol:return 0.,'zero-volatility-boundary'
    if price(spot,strike,t,rate,yield_,max_vol,right)<value-tol:return None,'above-volatility-bracket'
    lo=0.;hi=max_vol
    for _ in range(100):
        mid=(lo+hi)/2
        if price(spot,strike,t,rate,yield_,mid,right)<value:lo=mid
        else:hi=mid
    return (lo+hi)/2,'solved'


def greeks(spot,strike,t,rate,yield_,vol,right):
    d1=(math.log(spot/strike)+(rate-yield_+.5*vol*vol)*t)/(vol*math.sqrt(t))
    discount=math.exp(-yield_*t);density=math.exp(-.5*d1*d1)/math.sqrt(2*math.pi)
    return discount*(cdf(d1)-(right=='put')),discount*density/(spot*vol*math.sqrt(t)),spot*discount*density*math.sqrt(t)/100


def interpolation(points,target):
    """Linear interpolation only in an observed unique bracket; IDs and weight retained."""
    points=sorted(points)
    if len({x[0] for x in points})!=len(points):return None,'ambiguous-abscissa','', '',None
    for x,y,key in points:
        if abs(x-target)<=1e-12:return y,'exact',key,key,0.
    for a,b in zip(points,points[1:]):
        if a[0]<target<b[0]:
            weight=(target-a[0])/(b[0]-a[0]);return a[1]*(1-weight)+b[1]*weight,'interpolated',a[2],b[2],weight
    return None,'no-observed-bracket','','',None


def calculate(operation,b,p):
    if operation not in ('option-iv','option-skew','option-term-pcr'):raise ValueError('Unknown option operation')
    age=float(p.get('maxAgeSeconds',900));max_vol=float(p.get('maxVolatility',5.));values=[]
    for r in b.itertuples(index=False):
        t=(r.expiry-r.time).total_seconds()/(365*86400);quote_age=(r.time-r.quoteat).total_seconds();spot_age=(r.time-r.spotat).total_seconds()
        out=dict(time=r.time,contract=r.contract,expiry=r.expiry,right=r.right,strike=r.strike,years=t,midPrice=(r.bid+r.ask)/2,quoteAgeSeconds=quote_age,spotAgeSeconds=spot_age)
        for key,value in (('mid',(r.bid+r.ask)/2),('bid',r.bid),('ask',r.ask)):
            vol,status=(None,'stale-quote-or-spot') if max(quote_age,spot_age)>age else implied(value,r.spot,r.strike,t,r.rate,r.dividendyield,r.right,max_vol)
            out[key+'IV']=vol;out[key+'Status']=status
        delta,gamma,vega=greeks(r.spot,r.strike,t,r.rate,r.dividendyield,out['midIV'],r.right) if out['midStatus']=='solved' else (None,None,None)
        out.update(spotDelta=delta,gamma=gamma,vegaPerVolPoint=vega);values.append(out)
    v=pd.DataFrame(values);selected=[];chains=[];rank=int(p.get('expiryRank',1));contract=p.get('contractId','C100E1')
    for time,rows in b.groupby('time',sort=False):
        group_values=v[v.time.eq(time)];current=[]
        for expiry,chain in rows.groupby('expiry',sort=True):
            q=group_values[group_values.expiry.eq(expiry)];valid=q[q.midStatus.eq('solved')];r=chain.iloc[0]
            t=(expiry-time).total_seconds()/(365*86400);forward=r.spot*math.exp((r.rate-r.dividendyield)*t)
            call=interpolation([(abs(x.spotDelta),x.midIV,x.contract) for x in valid[valid.right.eq('call')].itertuples()],.25)
            put=interpolation([(abs(x.spotDelta),x.midIV,x.contract) for x in valid[valid.right.eq('put')].itertuples()],.25)
            atm=interpolation([(math.log(x.strike/forward),x.midIV,x.contract) for x in valid[valid.right.eq('call')].itertuples()],0.)
            c=chain[chain.right.eq('call')];pt=chain[chain.right.eq('put')];cv=float(c.volume.sum());pv=float(pt.volume.sum());co=float(c.openinterest.sum());po=float(pt.openinterest.sum())
            out=dict(time=time,expiry=expiry,atmCallIV=atm[0],put25MinusCall25IV=put[0]-call[0] if put[0] is not None and call[0] is not None else None,
                put25IV=put[0],call25IV=call[0],volumePCR=pv/cv if cv else None,openInterestPCR=po/co if co else None,
                putContracts=len(pt),callContracts=len(c),putVolume=pv,callVolume=cv,putOpenInterest=po,callOpenInterest=co,
                years=t,forward=forward,oiAgeSeconds=(time-r.oiat).total_seconds(),volumeAgeSeconds=(time-r.volumeat).total_seconds(),universeid=r.universeid)
            for name,value in (('put25',put),('call25',call),('atmCall',atm)):
                out.update({name+'Status':value[1],name+'LeftContract':value[2],name+'RightContract':value[3],name+'RightWeight':value[4]})
            current.append(out);chains.append(out)
        if operation=='option-iv':
            pick=group_values[group_values.contract.eq(contract)]
            selected.append({'time':time,'midIV':None,'contract':contract,'midStatus':'contract-not-observed'} if pick.empty else {'time':time,'midIV':pick.iloc[0].midIV,**pick.iloc[0].to_dict()})
        else:
            key='put25MinusCall25IV' if operation=='option-skew' else 'atmCallIV'
            chosen=current[rank-1] if rank<=len(current) else {'time':time,'expiry':'','selectionStatus':'expiry-rank-not-observed'}
            selected.append({'time':time,key:chosen.get(key),**chosen})
    return {'kind':'indicator','engineVersion':'webstock-european-options-v1','formulaVersion':'webstock-'+operation+'-v1',
        'tables':[table('indicators',pd.DataFrame(selected)),table('option-values',v),table('expiry-summary',pd.DataFrame(chains)),table('input-audit',b)],
        'inputSemantics':{'pricingModel':'European Black-Scholes-Merton; continuous r and q; ACT/365F; per underlying unit',
                         'valuationTime':'decision time; only quotes/spot within maxAgeSeconds eligible',
                         'selectedContract':contract if operation=='option-iv' else None,'selectedExpiryRank':rank if operation!='option-iv' else None,
                         'providerCertified':False,'fullMarketUniverseCertified':False,'automaticTrading':False},
        'warnings':['仅支持声明为欧式的期权及连续利率/分红收益率假设；不是美式定价器或VIX。希腊值是模型敏感度，不是实际盈亏保证。',
            'IV以小数表示；25Delta偏斜为看跌IV减看涨IV，使用绝对现货Delta线性插值。ATM为远期平值处看涨IV的对数行权价插值；不外推。',
            '期限排名可随到期滚动；PCR只覆盖输入合约、同步成交区间和声明的OI时点，分母零留空，不作机械多空判断。',
            '报价或现货过期、价格超界、波动率超求解上限分别标记；来源/合约集合/时间可知性仍需核验。']}
