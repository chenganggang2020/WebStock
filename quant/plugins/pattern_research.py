"""Explicit local squeeze and confirmed-close geometry research definitions."""
import numpy as np
import pandas as pd
from temporal_indicators import zigzag
from worker import table

# Ratio templates, not a reproduction of a commercial recognition engine.
# AB/XA, BC/AB, CD/BC, AD/XA, CD/AB bounds; None means no upper cap.
TEMPLATES={
    'retracement-618-786':((.618,.618),(.382,.886),(1.27,1.618),(.786,.786),(1.,1.)),
    'retracement-382-500-886':((.382,.5),(.382,.886),(1.618,2.618),(.886,.886),(1.,None)),
    'extension-786-1270':((.786,.786),(.382,.886),(1.618,2.618),(1.27,1.27),(1.,1.618)),
    'extension-382-618-1618':((.382,.618),(.382,.886),(2.618,3.618),(1.618,1.618),(1.,None))}
RATIO_NAMES=('abXa','bcAb','cdBc','adXa','cdAb')


def impulse(values):
    a=np.asarray(values,dtype=float);d=np.sign(a[1]-a[0]);q=d*(a-a[0]);legs=np.diff(q)
    alternating=bool((legs[[0,2,4]]>0).all() and (legs[[1,3]]<0).all())
    rules={'alternating':alternating,'wave2HoldsStart':bool(q[2]>0),'wave3ExtendsWave1':bool(q[3]>q[1]),
           'wave4NoOverlap':bool(q[4]>q[1]),'wave5ExtendsWave3':bool(q[5]>q[3]),
           'wave3NotShortest':bool(legs[2]>=min(legs[0],legs[4]))}
    return int(d) if all(rules.values()) else 0,{**rules,'wave1Length':legs[0],'wave3Length':legs[2],'wave5Length':legs[4]}


def harmonic(values,template,tolerance):
    a=np.asarray(values,dtype=float);diff=np.diff(a)
    alternating=bool(np.all(diff!=0) and (diff[1:]*diff[:-1]<0).all())
    if not alternating:return 0,{'alternating':False,'geometry':False,'ratiosMatch':False,**dict.fromkeys(RATIO_NAMES,np.nan)}
    def within(value,bounds):
        lower=bounds[0]*(1-tolerance);upper=None if bounds[1] is None else bounds[1]*(1+tolerance)
        epsilon=8*np.finfo(float).eps*max(1.,abs(value),abs(lower),0. if upper is None else abs(upper))
        return value>=lower-epsilon and (upper is None or value<=upper+epsilon)
    if template=='abcd':
        ab,bc,cd=np.abs(diff);q=np.sign(diff[0])*(a-a[0]);ratios={'abXa':np.nan,'bcAb':bc/ab,'cdBc':cd/bc,'adXa':np.nan,'cdAb':cd/ab}
        geometry=bool(0<q[2]<q[1] and q[3]>q[1]);matched=within(ratios['bcAb'],(.382,.886)) and within(ratios['cdAb'],(1.,1.))
    else:
        xa,ab,bc,cd=np.abs(diff);q=np.sign(diff[0])*(a-a[0]);ratios=dict(zip(RATIO_NAMES,(ab/xa,bc/ab,cd/bc,abs(a[4]-a[1])/xa,cd/ab)))
        geometry=bool(0<q[2]<q[3]<q[1] and (0<q[4]<q[2] if template.startswith('retracement') else q[4]<0))
        matched=all(within(ratios[k],bounds) for k,bounds in zip(RATIO_NAMES,TEMPLATES[template]))
    return int(-np.sign(diff[-1])) if geometry and matched else 0,{'alternating':True,'geometry':geometry,'ratiosMatch':bool(matched),**ratios}


def squeeze(b,p):
    n=int(p['period']);m=int(p['momentumPeriod']);c=b.close;h=b.high;l=b.low
    mean=c.rolling(n).mean();std=c.rolling(n).std(ddof=0)
    tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1)
    spread=tr.rolling(n).mean();bbup=mean+p['bbMultiple']*std;bbdown=mean-p['bbMultiple']*std
    kcup=mean+p['kcMultiple']*spread;kcdown=mean-p['kcMultiple']*spread
    valid=mean.notna()&spread.notna();on=(bbup<kcup)&(bbdown>kcdown);off=(bbup>kcup)&(bbdown<kcdown)
    # 1=inside both, -1=outside both, 0=boundary/one-sided/intermediate.
    state=pd.Series(np.where(on,1.,np.where(off,-1.,0.)),index=b.index).where(valid)
    delta=c-((h.rolling(m).max()+l.rolling(m).min())/2+c.rolling(m).mean())/2
    x=np.arange(m,dtype=float);centered=x-x.mean();denom=np.dot(centered,centered)
    momentum=delta.rolling(m).apply(lambda y:float(y.mean()+np.dot(centered,y)/denom*(m-1-x.mean())),raw=True)
    prev=momentum.shift();direction=pd.Series(np.where(momentum>0,np.where(momentum>prev,2.,1.),np.where(momentum<0,np.where(momentum<prev,-2.,-1.),0.)),index=b.index).where(prev.notna()&momentum.notna())
    out=pd.DataFrame({'time':b.time,'momentum':momentum,'momentumState':direction,'squeezeState':state,
        'release':(state.eq(-1)&state.shift().eq(1)).astype(float).where(state.notna()&state.shift().notna()),
        'delta':delta,'bbUpper':bbup,'bbLower':bbdown,'kcUpper':kcup,'kcLower':kcdown})
    return {'kind':'indicator','engineVersion':'webstock-pattern-research-v1','formulaVersion':'webstock-squeeze-regression-v1',
        'tables':[table('indicators',out)],'warnings':['公开回归动量公式的本地实现：KC为收盘SMA ± SMA(TR)倍数，非所有TTM/StockCharts/TradingView口径。',
        '动量为收盘减去Donchian中线与SMA的平均，再取尾随最小二乘回归末端。不会提前到窗口中心。',
        'squeezeState: 1双边包含、-1双边外扩、0边界/过渡；release仅前根1到本根-1。不是成交指令或收益优势。']}


def calculate(operation,b,p):
    if len(b)>20000:raise ValueError('Pattern research is limited to 20000 closed bars')
    if operation=='squeeze-regression':return squeeze(b,p)
    template=p.get('pattern','abcd');tolerance=float(p.get('tolerancePct',5.))/100
    if operation not in ('impulse-candidate','harmonic-candidate'):raise ValueError('Unknown pattern operation')
    if template not in ('abcd',*TEMPLATES) or not 0<=tolerance<=.2:raise ValueError('Invalid ratio template or tolerance')
    required=6 if operation=='impulse-candidate' else 4 if template=='abcd' else 5
    events=zigzag(b.close.to_numpy(dtype=float),float(p['reversalPct'])/100)
    confirmed=[];audits=[];indicators=[]
    labels=[str(i) for i in range(required)]
    for i,event in enumerate(events):
        row={'time':b.time.iloc[i],'matchedDirection':0,'candidateEvaluated':0,'confirmedPivotPrice':np.nan,'pivotBar':np.nan,'confirmationDelayBars':np.nan}
        if np.isfinite(event[0]):
            point={'time':b.time.iloc[i],'confirmedBar':i,'pivotBar':int(event[2]),'pivotPrice':event[1],'pivotKind':int(event[0])}
            confirmed.append(point);row.update(confirmedPivotPrice=event[1],pivotBar=int(event[2]),confirmationDelayBars=i-int(event[2]))
            if len(confirmed)>=required:
                anchors=confirmed[-required:];values=[v['pivotPrice'] for v in anchors]
                direction,diagnostics=impulse(values) if operation=='impulse-candidate' else harmonic(values,template,tolerance)
                row.update(matchedDirection=direction,candidateEvaluated=1)
                audit={'time':b.time.iloc[i],'confirmedBar':i,'matchedDirection':direction,**diagnostics}
                for label,point in zip(labels,anchors):audit.update({f'point{label}Price':point['pivotPrice'],f'point{label}Bar':point['pivotBar'],f'point{label}KnownBar':point['confirmedBar']})
                audits.append(audit)
        indicators.append(row)
    columns=['time','confirmedBar','matchedDirection']+(['alternating','wave2HoldsStart','wave3ExtendsWave1','wave4NoOverlap','wave5ExtendsWave3','wave3NotShortest','wave1Length','wave3Length','wave5Length'] if operation=='impulse-candidate' else ['alternating','geometry','ratiosMatch',*RATIO_NAMES])+[f'point{label}{suffix}' for label in labels for suffix in ('Price','Bar','KnownBar')]
    return {'kind':'indicator','engineVersion':'webstock-pattern-research-v1','formulaVersion':'webstock-'+operation+'-v1',
        'modelSemantics':{'pivotInput':'close-only-percentage-reversal','signalTiming':'last pivot confirmation bar; no backfill',
                         'pattern':template if operation=='harmonic-candidate' else 'non-truncated-five-leg-arithmetic-candidate',
                         'ratioToleranceFraction':tolerance if operation=='harmonic-candidate' else None,'fullElliottSubdivisionVerified':False},
        'tables':[table('indicators',pd.DataFrame(indicators)),table('candidate-audit',pd.DataFrame(audits,columns=columns)),
                  table('confirmed-pivots',pd.DataFrame(confirmed,columns=['time','confirmedBar','pivotBar','pivotPrice','pivotKind']))],
        'warnings':['仅检查最近连续已确认收盘拐点，候选记在最后拐点实际确认时点；不回填到极值日，不使用未确认末端。',
                    '五段候选不验证递归5-3-5-3-5子浪，排除截短/楔形；谐波只匹配所列数值模板，并非商业识别系统或所有形态变体。',
                    '五段方向描述已结束的推进；谐波方向描述模板候选反向。均不表示可在历史拐点成交或已证明未来走势。']}
