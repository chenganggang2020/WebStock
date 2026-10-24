"""Replay externally published values in knowledge order, including withdrawals."""
from bisect import insort
import numpy as np
import pandas as pd
from worker import table

OPERATIONS={
    'money-flow-vintages':'money-flow','margin-vintages':'margin',
    'holdings-vintages':'holdings','news-vintages':'news','macro-vintages':'macro',
    'demark-vintages':'demark','vendor-score-vintages':'vendor-score'}
WARNINGS={
    'money-flow':'资金流/DDE值由输入来源提供；本插件未从日线猜测主动买卖、大单或主力身份。不同供应商分类不可直接合并。',
    'margin':'余额变化是两个已披露观察值之差，不直接标为融资净买入；偿还可能包括直接还款、平仓及权益调整。',
    'holdings':'披露持仓及其变化不等于逐笔买卖；报告期、实际披露及修订时间分别保留。未从季报推断期间交易。',
    'news':'情绪分数来自输入模型/供应商；本插件不执行文本情绪模型，definitionid须标明模型和版本，未评估分类准确率。',
    'macro':'保留每次可知修订；普通最新修订序列不等于历史发布版本。观察间隔未假定月度/季度，变化不标为同比或年化。',
    'demark':'仅接入有使用权来源的已发布DeMARK输出；未复现任何未取得明确定义的专有公式，也不宣称官方兼容。',
    'vendor-score':'仅回放外部评分；其公式、数据和校准由来源声明。分数不是经本插件验证的概率或盈利能力。'}


def calculate(operation,b,p):
    family=OPERATIONS[operation]
    if b.family.nunique()!=1 or b.family.iloc[0]!=family:raise ValueError('Observation family differs from selected operation')
    selected=p['seriesId'];window=int(p.get('priorWindow',20));age_limit=float(p['maxAgeDays']);mode=p.get('transformation','level')
    if selected not in set(b.seriesid):raise ValueError('Selected seriesId is absent')
    if mode not in ('level','change','prior-z') or not 2<=window<=1000 or not 0<=age_limit<=36500:raise ValueError('Invalid observation parameters')
    if family in ('news','demark','vendor-score') and mode!='level':raise ValueError('This source score interface only replays declared levels')
    known={};periods=[];audit=[];out=[];revisions={}
    for r in b.itertuples(index=False):
        key=(r.seriesid,r.observationid);before=revisions.get(key)
        revision_delta=r.value-before.value if before is not None and before.state=='published' and r.state=='published' else np.nan
        audit.append({'time':r.time,'sequence':r.sequence,'seriesid':r.seriesid,'observationid':r.observationid,
            'observedat':r.observedat,'availableat':r.availableat,'revision':r.revision,'state':r.state,'value':r.value,
            'previousKnownValue':before.value if before is not None else np.nan,'revisionDelta':revision_delta,
            'unit':r.unit,'source':r.source,'sourceurl':r.sourceurl,'definitionid':r.definitionid,
            'family':r.family,'subject':r.subject,'entity':r.entity,'coverage':r.coverage})
        revisions[key]=r
        if r.seriesid==selected:
            if r.observedat not in known:insort(periods,r.observedat)
            known[r.observedat]=r
        latest=known[periods[-1]] if periods else None
        row={'time':r.time,'sequence':r.sequence,'currentValue':np.nan,'observationChange':np.nan,'priorWindowZ':np.nan,
             'status':'not-yet-published','seriesid':selected,'observedat':None,'availableat':None,'observationid':None,
             'revision':None,'ageDays':np.nan,'publicationAgeDays':np.nan,'releaseDelayDays':np.nan,
             'priorPeriod':None,'priorValue':np.nan,'priorMean':np.nan,'priorStd':np.nan,'knownPeriods':len(periods),
             'unit':None,'source':None,'sourceurl':None,'definitionid':None,'subject':None,'entity':None,'coverage':None}
        if latest is not None:
            age=(r.time-latest.observedat).total_seconds()/86400
            row.update({k:getattr(latest,k) for k in ('observedat','availableat','observationid','revision','unit','source','sourceurl','definitionid','subject','entity','coverage')})
            row.update(ageDays=age,publicationAgeDays=(r.time-latest.availableat).total_seconds()/86400,
                       releaseDelayDays=(latest.availableat-latest.observedat).total_seconds()/86400)
            row['status']='withdrawn' if latest.state=='withdrawn' else 'stale' if age>age_limit else 'available'
            if row['status']=='available':
                row['currentValue']=latest.value
                if mode=='change':
                    if len(periods)>1:
                        prev=known[periods[-2]];row['priorPeriod']=prev.observedat
                        if prev.state=='published':row.update(priorValue=prev.value,observationChange=latest.value-prev.value)
                        else:row['status']='previous-period-withdrawn'
                    else:row['status']='insufficient-prior-periods'
                if mode=='prior-z':
                    if len(periods)>window:
                        prior=[known[t] for t in periods[-window-1:-1]]
                        if all(v.state=='published' for v in prior):
                            values=np.array([v.value for v in prior]);mean=values.mean();sd=values.std(ddof=1)
                            row.update(priorMean=mean,priorStd=sd)
                            if sd>0:row['priorWindowZ']=(latest.value-mean)/sd
                            else:row['status']='constant-prior-window'
                        else:row['status']='prior-window-withdrawn'
                    else:row['status']='insufficient-prior-periods'
        out.append(row)
    return {'kind':'indicator','engineVersion':'webstock-external-observations-v1',
        'formulaVersion':'webstock-'+operation+'-v1',
        'inputSemantics':{'family':family,'selectedSeries':selected,'observationOrder':'time-then-strict-global-sequence',
            'pointInTimeProvenanceCertified':False,'proprietaryFormulaReproduced':False,
            'revisionPolicy':'apply on arrival; never rewrite earlier output; latest withdrawal never falls back',
            'transformation':mode,'priorWindow':window,'maxAgeDays':age_limit},
        'tables':[table('indicators',pd.DataFrame(out)),table('release-audit',pd.DataFrame(audit))],
        'warnings':[WARNINGS[family],'CSV时间与来源为输入声明；内部一致性检查不能证明供应商历史数据真实性。URL只保存，不自动请求。',
                    '每条记录后输出当时状态；同一时刻按sequence依次生效。过期或撤回的最新观察不向更早值回退。',
                    '差值/Z分数仅按当时已知的相邻观察期计算；修订可改变当前结果，不修改历史结果。无交易撮合或收益结论。']}
