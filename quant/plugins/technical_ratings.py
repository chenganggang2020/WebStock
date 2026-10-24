# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright TradingView. Python adaptation and explicit numerical kernel:
# WebStock contributors, 2026. See TECHNICAL_RATINGS.txt for modifications.
"""TechnicalRating v3 conditions with a declared local numerical kernel.

The rating conditions are ported from TradingView's public MPL-2.0 library.
This does NOT claim numerical parity with Pine built-ins or live screeners.
"""
import numpy as np
import pandas as pd
from worker import table

SOURCE_SHA256='93c8274c1e2e6e4f594b694611243c5399aca48863aab2a4300789b0d707d08b'


def rma(x,n):
    """Complete consecutive seed, then Wilder recursion; missing resets state."""
    values=x.to_numpy(dtype=float);result=np.full(len(x),np.nan);seed=[];state=np.nan
    for i,value in enumerate(values):
        if not np.isfinite(value):seed=[];state=np.nan;continue
        if np.isnan(state):
            seed.append(value)
            if len(seed)==n:state=float(np.mean(seed))
        else:state=((n-1)*state+value)/n
        result[i]=state
    return pd.Series(result,index=x.index)


def primitives(b):
    c,h,l,v=b.close,b.high,b.low,b.volume
    sma=lambda x,n:x.rolling(n,min_periods=n).mean()
    ema=lambda x,n:x.ewm(span=n,adjust=False,min_periods=1).mean()
    wma=lambda x,n:x.rolling(n).apply(lambda a:np.dot(a,np.arange(1,n+1))/(n*(n+1)/2),raw=True)
    midpoint=lambda n:(h.rolling(n).max()+l.rolling(n).min())/2
    stochastic=lambda x,hi,lo,n:100*(x-lo.rolling(n).min())/(hi.rolling(n).max()-lo.rolling(n).min()).replace(0,np.nan)
    f=pd.DataFrame({'close':c})
    for n in (10,20,30,50,100,200):f['SMA'+str(n)]=sma(c,n);f['EMA'+str(n)]=ema(c,n)
    f['HMA9']=wma(2*wma(c,4)-wma(c,9),3)
    f['VWMA20']=sma(c*v,20)/sma(v,20).replace(0,np.nan)
    f['conversion']=midpoint(9);f['base']=midpoint(26)
    f['spanA']=(f.conversion+f.base)/2;f['spanB']=midpoint(52)
    changes=c.diff();g=rma(changes.clip(lower=0),14);loss=rma(-changes.clip(upper=0),14)
    f['RSI14']=100*g/(g+loss).replace(0,np.nan)
    f['stochK']=sma(stochastic(c,h,l,14),3);f['stochD']=sma(f.stochK,3)
    f['stochRsiK']=sma(stochastic(f.RSI14,f.RSI14,f.RSI14,14),3);f['stochRsiD']=sma(f.stochRsiK,3)
    average=sma(c,20);deviation=c.rolling(20).apply(lambda a:np.mean(np.abs(a-a.mean())),raw=True)
    f['CCI20close']=(c-average)/(.015*deviation).replace(0,np.nan)
    up=h.diff();down=-l.diff();plus=up.where((up>down)&(up>0),0.);minus=down.where((down>up)&(down>0),0.)
    plus.iloc[0]=np.nan;minus.iloc[0]=np.nan
    tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1);tr.iloc[0]=np.nan
    smoothed=rma(tr,14);f['diPlus']=100*rma(plus,14)/smoothed.replace(0,np.nan);f['diMinus']=100*rma(minus,14)/smoothed.replace(0,np.nan)
    total=f.diPlus+f.diMinus;dx=(f.diPlus-f.diMinus).abs()/total.replace(0,np.nan)
    dx=dx.where(total.ne(0),0.);f['ADX14']=100*rma(dx,14)
    f['AO']=sma((h+l)/2,5)-sma((h+l)/2,34);f['momentum10']=c-c.shift(10)
    f['MACD']=ema(c,12)-ema(c,26);f['MACDsignal']=ema(f.MACD,9)
    f['bullPower']=h-ema(c,13);f['bearPower']=l-ema(c,13)
    f['WilliamsR']=-100*(h.rolling(14).max()-c)/(h.rolling(14).max()-l.rolling(14).min()).replace(0,np.nan)
    tmax=pd.Series(np.maximum(h,c.shift()),index=b.index);tmin=pd.Series(np.minimum(l,c.shift()),index=b.index)
    true_range=tmax-tmin;pressure=c-tmin;averages=[pressure.rolling(n).sum()/true_range.rolling(n).sum().replace(0,np.nan) for n in (7,14,28)]
    f['UO']=100*(4*averages[0]+2*averages[1]+averages[2])/7
    if np.isinf(f.to_numpy()).any():raise ValueError('Technical-rating numerical kernel overflow')
    return f


def component_ratings(f):
    def rate(source,bull,bear):
        return pd.Series(np.where(source.isna(),np.nan,np.where(bull,1.,np.where(bear,-1.,0.))),index=f.index)
    ma=pd.DataFrame(index=f.index)
    for key in ['SMA'+str(n) for n in (10,20,30,50,100,200)]+['EMA'+str(n) for n in (10,20,30,50,100,200)]+['HMA9','VWMA20']:
        ma[key]=np.sign(f.close-f[key])
    a,bb=f.spanA.shift(26),f.spanB.shift(26)
    ma['Ichimoku']=rate(f.spanB,(a>bb)&(f.base>a)&(f.conversion>f.base)&(f.close>f.conversion),
        (a<bb)&(f.base<a)&(f.conversion<f.base)&(f.close<f.conversion))
    other=pd.DataFrame(index=f.index);r=f.RSI14;prev=r.shift()
    other['RSI']=rate(prev,(r<30)&(r>prev),(r>70)&(r<prev))
    k,d=f.stochK,f.stochD
    other['Stochastic']=rate(d.shift(),(k<20)&(d<20)&(k>d),(k>80)&(d>80)&(k<d))
    c=f.CCI20close;other['CCI']=rate(c.shift(),(c<-100)&(c>c.shift()),(c>100)&(c<c.shift()))
    adx=f.ADX14;strong=(adx>20)&(adx>adx.shift())
    other['ADX']=rate(adx,strong&(f.diPlus>f.diMinus),strong&(f.diPlus<f.diMinus))
    ao=f.AO;previous=ao.shift();before=ao.shift(2)
    other['AO']=rate(previous,((ao>0)&(previous<=0))|((ao>0)&(previous>0)&(ao>previous)&(before>previous)),
        ((ao<0)&(previous>=0))|((ao<0)&(previous<0)&(ao<previous)&(before<previous)))
    mom=f.momentum10;other['Momentum']=rate(mom.shift(),mom>mom.shift(),mom<mom.shift())
    other['MACD']=rate(f.MACDsignal,f.MACD>f.MACDsignal,f.MACD<f.MACDsignal)
    up=f.close>f.EMA50;down=f.close<f.EMA50;k,d=f.stochRsiK,f.stochRsiD
    other['StochRSI']=rate(f.EMA50,down&(k<20)&(d<20)&(k>d),up&(k>80)&(d>80)&(k<d))
    wr=f.WilliamsR;other['WilliamsR']=rate(wr.shift(),(wr<-80)&(wr>wr.shift()),(wr>-20)&(wr<wr.shift()))
    other['BullBearPower']=rate(f.EMA50,up&(f.bearPower<0)&(f.bearPower>f.bearPower.shift()),
        down&(f.bullPower>0)&(f.bullPower<f.bullPower.shift()))
    other['Ultimate']=rate(f.UO,f.UO>70,f.UO<30)
    return ma,other


def rating_status(values):
    return pd.Series(np.select([values.isna(),values<-.5,values<-.1,values>.5,values>.1],
        ['unavailable','strong-sell','sell','strong-buy','buy'],default='neutral'),index=values.index)


def aggregate(ma,other):
    a=ma.mean(axis=1);o=other.mean(axis=1);total=pd.concat([a,o],axis=1).mean(axis=1)
    return pd.DataFrame({'overallRating':total,'movingAverageRating':a,'oscillatorRating':o,
        'availableMovingAverages':ma.count(axis=1),'availableOscillators':other.count(axis=1),
        'overallLabel':rating_status(total),'maLabel':rating_status(a),'oscillatorLabel':rating_status(o)})


def calculate(b):
    b=b.reset_index(drop=True);f=primitives(b);ma,other=component_ratings(f);summary=aggregate(ma,other)
    for frame in (summary,ma,other,f):frame.insert(0,'time',b.time)
    return dict(kind='indicator',engineVersion='webstock-tv-v3-local-kernel-v1',formulaVersion='webstock-tv-v3-conditions-local-kernel-v1',
        tables=[table('indicators',summary),table('ma-components',ma),table('oscillator-components',other),table('underlying-values',f)],
        modelSemantics=dict(upstream='TradingView/TechnicalRating/3',upstreamSourceSha256=SOURCE_SHA256,
            kernel='explicit-local-v1',pineNumericalParityVerified=False,automaticTrading=False),
        warnings=['按官方公开TechnicalRating v3条件移植；底层数值采用本插件明确的预热/种子/零分母口径，未验证与Pine内置函数或网站实时评分逐点相同。',
            '15项均线组与11项振荡组各自忽略不可用项求均值，再平均两组；仅有一组时取该组。可用项数量随预热变化，早期分数不可与完整26项直接比较。',
            'v3源码使用EMA50判趋势、close输入CCI，ADX买卖均要求ADX上升；云图只读26根前的span。不同于帮助页的部分描述。',
            '上游Buy/Sell标签只表示条件汇总，不是上涨概率或交易指令；同源价量条件不能当作26项独立证据。无多周期未来回填，无自动交易。',
            '源码移植部分依MPL-2.0提供，保留TradingView署名；本插件由WebStock维护，无TradingView官方认证。详见TECHNICAL_RATINGS.txt。'])
