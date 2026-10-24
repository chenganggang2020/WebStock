"""Past-window PCA and explicit point-in-time cross-sectional factor portfolios."""
import importlib.metadata
import re
import numpy as np
import pandas as pd
from worker import table


def trailing_pca(b,p):
    from sklearn.decomposition import PCA
    from learning_models import features,FEATURES
    b=b.reset_index(drop=True);x=features(b).to_numpy(dtype=float)
    window,step,count=p['trainingRows'],p['retrainEvery'],p['components']
    first=20+window
    if len(b)<=first:raise ValueError('PCA needs 20 warmup bars, a full training window and a later observation')
    if (len(b)-1-first)//step+1>200:raise ValueError('PCA is bounded to 200 fits; increase retrainEvery or shorten input')
    output=[];audit=[];loadings=[];model=None;fit_id=-1;attempts=0;successes=0
    for i in range(len(b)):
        if i>=first and (i-first)%step==0:
            attempts+=1;fit_id+=1;model=None;sample=x[i-window:i];reason='';rank=0
            try:
                if not np.isfinite(sample).all():raise ValueError('Incomplete or nonfinite trailing feature window')
                mean=sample.mean(axis=0);scale=sample.std(axis=0,ddof=0);scale[scale==0]=1.
                z=(sample-mean)/scale
                if not np.isfinite(z).all():raise ValueError('Feature scaling exceeded numerical range')
                rank=int(np.linalg.matrix_rank(z))
                if rank<count:raise ValueError('Training feature rank is below requested components')
                fitted=PCA(n_components=count,svd_solver='full',whiten=False).fit(z)
                # PCA signs have no financial meaning. Use the largest absolute
                # loading (first feature on a tie) as the positive orientation.
                axes=fitted.components_.copy()
                for row in axes:
                    if row[np.argmax(np.abs(row))]<0:row*=-1
                if not np.isfinite(axes).all() or not np.isfinite(fitted.explained_variance_ratio_).all():
                    raise ValueError('Nonfinite PCA fit')
                model=(mean,scale,fitted.mean_,axes);successes+=1
                for k in range(count):
                    for j,feature in enumerate(FEATURES):
                        loadings.append(dict(time=b.time.iloc[i],fitId=fit_id,component=k+1,feature=feature,
                            trainingMean=mean[j],trainingScale=scale[j],pcaCenter=fitted.mean_[j],loading=axes[k,j],
                            explainedVariance=fitted.explained_variance_[k],explainedFraction=fitted.explained_variance_ratio_[k]))
            except (ValueError,np.linalg.LinAlgError) as exc:reason=str(exc)
            audit.append(dict(time=b.time.iloc[i],fitId=fit_id,firstTrainingBar=i-window,lastTrainingBar=i-1,
                observationBar=i,trainingRows=window,featureRank=rank,status='unavailable' if reason else 'fitted',diagnostic=reason))
        value=np.full(count,np.nan);error=np.nan;status='warmup' if i<first else 'fit-unavailable'
        if model is not None:
            if np.isfinite(x[i]).all():
                mean,scale,center,axes=model;z=(x[i]-mean)/scale-center;value=z@axes.T
                error=np.sqrt(np.mean((z-value@axes)**2));status='transformed'
                if not np.isfinite(value).all() or not np.isfinite(error):raise ValueError('PCA transform exceeded numerical range')
            else:status='current-features-unavailable'
        output.append(dict(time=b.time.iloc[i],**{'PC'+str(k+1):value[k] for k in range(count)},
            reconstructionRmseStandardized=error,fitId=fit_id if i>=first else None,status=status))
    return dict(kind='indicator',engineVersion='sklearn-'+importlib.metadata.version('scikit-learn'),
        formulaVersion='webstock-factor-trailing-pca-v1',tables=[table('indicators',pd.DataFrame(output)),
        table('training-audit',pd.DataFrame(audit)),table('loadings',pd.DataFrame(loadings,columns=['time','fitId','component','feature',
            'trainingMean','trainingScale','pcaCenter','loading','explainedVariance','explainedFraction']))],
        modelSemantics=dict(fitAttempts=attempts,successfulFits=successes,training='prior-closed-bars-only',whiten=False),
        warnings=['七项价格/成交量特征定义见FACTOR_MODELS.txt；训练均值、总体标准差与PCA中心均只来自当前根以前的尾随窗口。',
            '原版sklearn完整SVD，不白化；分量以绝对值最大载荷为正。每次重估的分量方向可能改变，不能把跨模型的PC值直接当作连续交易信号。',
            '训练缺失或有效秩不足时保留不可用状态并清除旧模型；当前特征缺失不插值。解释方差不是收益预测能力，PCA分量没有买卖含义。'])


def factor_inputs(b,p):
    from panel_contract import known_numeric
    symbols=[s.strip() for s in p['symbols'].split(',')]
    keys=[s.strip() for s in p['factorColumns'].split(',')]
    if not 2<=len(symbols)<=16 or len(set(symbols))!=len(symbols) or any(not s for s in symbols):
        raise ValueError('Specify 2..16 distinct research securities before running')
    if not 2<=len(keys)<=8 or len(set(keys))!=len(keys) or any(not re.fullmatch(r'factor_[a-z][a-z0-9_]{0,30}',s) for s in keys):
        raise ValueError('Specify 2..8 distinct factor_ names (lowercase letters, digits, underscore)')
    weights=np.asarray([float(s.strip()) for s in p['factorWeights'].split(',')])
    if len(weights)!=len(keys) or not np.isfinite(weights).all() or not np.any(weights):
        raise ValueError('One finite signed weight per factor required; not all zero')
    weights=weights/np.max(np.abs(weights));weights=weights/np.sum(np.abs(weights))
    if not set(symbols)<=set(b.symbol):raise ValueError('Requested research securities missing')
    selected=b[b.symbol.isin(symbols)].copy()
    times=pd.Index(sorted(b.time.unique()),name='time')
    if len(times)*len(symbols)>25000:raise ValueError('Factor outputs are bounded to 25000 time/security observations')
    prices=selected.pivot(index='time',columns='symbol',values='close').reindex(index=times,columns=symbols)
    if prices.isna().any().any():raise ValueError('All specified securities require synchronized prices, including inactive holdings')
    values={key:known_numeric(selected,key) for key in keys}
    for key in keys:selected[key]=values[key]
    return symbols,keys,weights,selected,times,prices


def score_panel(b,p):
    symbols,keys,weights,selected,times,prices=factor_inputs(b,p)
    rows=[];mat=np.full(prices.shape,np.nan);members=np.zeros(prices.shape,dtype=bool)
    groups=selected.groupby('time',sort=True)
    for i,time in enumerate(times):
        frame=groups.get_group(time).set_index('symbol').reindex(symbols)
        active=frame.member.to_numpy(dtype=bool);members[i]=active;n=int(active.sum())
        transformed=np.full((len(symbols),len(keys)),np.nan)
        if n>=2:
            for j,key in enumerate(keys):
                ranks=frame.loc[active,key].rank(method='average',ascending=True).to_numpy()
                transformed[active,j]=2*(ranks-1)/(n-1)-1
            mat[i,active]=transformed[active]@weights
        for k,symbol in enumerate(symbols):
            row=dict(time=time,symbol=symbol,member=bool(active[k]),activeMembers=n,
                score=mat[i,k],status='scored' if active[k] and n>=2 else 'insufficient-members' if active[k] else 'inactive')
            for j,key in enumerate(keys):row[key]=frame.iloc[k][key];row['rank_'+key]=transformed[k,j]
            rows.append(row)
    return symbols,keys,weights,times,prices,members,mat,pd.DataFrame(rows)


def ranked_portfolio(b,p,scored):
    from portfolio_risk import post_fee_rebalance
    symbols,keys,weights,times,prices,members,scores,score_rows=scored
    x=prices.to_numpy();barends=b.groupby('time').barend.first().reindex(times)
    shares=np.zeros(len(symbols));cash=p['capital'];rate=p['feeBps']/10000;pending=None;fees=0.
    equity_rows=[];orders=[];positions=[];targets=[];audit=[]
    for i,time in enumerate(times):
        old_values=shares*x[i];equity=cash+old_values.sum();fee=0.
        if pending is not None:
            target,signal=pending
            if barends.iloc[i]<=times[signal]:raise ValueError('Next input close already occurred at signal availability')
            values,cash,fee=post_fee_rebalance(equity,old_values,target,rate);new_shares=values/x[i]
            for k,symbol in enumerate(symbols):
                delta=new_shares[k]-shares[k]
                if abs(delta)>1e-12:orders.append(dict(time=time,signalTime=times[signal],signalBar=signal,executionBar=i,
                    symbol=symbol,quantity=delta,price=x[i,k],notional=abs(delta*x[i,k]),fee=abs(delta*x[i,k])*rate))
            shares=new_shares;fees+=fee;equity=cash+values.sum();pending=None
        if not np.isfinite(equity) or equity<=0:raise ValueError('Portfolio capital exceeded numerical range')
        equity_rows.append(dict(time=time,equity=equity,cash=cash,periodFees=fee,cumulativeFees=fees))
        for k,symbol in enumerate(symbols):positions.append(dict(time=time,symbol=symbol,quantity=shares[k],
            close=x[i,k],marketValue=shares[k]*x[i,k],realizedWeight=shares[k]*x[i,k]/equity))
        if i%p['rebalanceEvery']:continue
        target=np.zeros(len(symbols));eligible=np.flatnonzero(members[i]&np.isfinite(scores[i])&(scores[i]>=p['minimumScore']))
        cutoff=np.nan;chosen=np.array([],dtype=int)
        if len(eligible):
            cutoff=np.sort(scores[i,eligible])[max(0,len(eligible)-p['topCount'])]
            chosen=eligible[scores[i,eligible]>=cutoff]
            target[chosen]=min(p['maxExposure']/len(chosen),p['maxSecurityWeight'])
        pending=(target,i)
        audit.append(dict(time=time,signalBar=i,activeMembers=int(members[i].sum()),eligibleCount=len(eligible),
            chosenCount=len(chosen),cutoffScore=cutoff,targetExposure=target.sum(),
            status='selected' if len(chosen) else 'no-eligible-securities-cash'))
        for k,symbol in enumerate(symbols):targets.append(dict(time=time,symbol=symbol,score=scores[i,k],
            member=bool(members[i,k]),selected=bool(target[k]>0),targetWeight=target[k]))
    return [table('equity',pd.DataFrame(equity_rows)),table('scores',score_rows),table('target-weights',pd.DataFrame(targets)),
        table('orders',pd.DataFrame(orders,columns=['time','signalTime','signalBar','executionBar','symbol','quantity','price','notional','fee'])),
        table('positions',pd.DataFrame(positions)),table('selection-audit',pd.DataFrame(audit))]


def calculate(name,b,p):
    if name=='trailing-pca':return trailing_pca(b,p)
    if name not in ('factor-score','ranked-portfolio'):raise ValueError('Unknown factor model')
    scored=score_panel(b,p);symbols,keys,weights,_,_,_,_,scores=scored
    output=[table('scores',scores)] if name=='factor-score' else ranked_portfolio(b,p,scored)
    output.append(table('factor-specification',pd.DataFrame({'factor':keys,'signedNormalizedWeight':weights})))
    return dict(kind='indicator' if name=='factor-score' else 'backtest',engineVersion='webstock-factor-models-v1',
        formulaVersion='webstock-factor-'+name+'-v1',tables=output,
        modelSemantics=dict(symbols=symbols,rankingUniverse='selected-current-members',factorWeightsLearned=False,
            execution='next-input-close' if name=='ranked-portfolio' else 'none',automaticTrading=False),
        warnings=['固定研究证券与权重必须在检验前指定；外部因子逐值要求_knownat不晚于决策时点，这不能认证供应商或排除预先选股偏差。',
            '只对当前历史成员做截面平均秩：2*(rank-1)/(N-1)-1，再按绝对值和归一的有符号权重加总。相同值使用平均秩，恒定因子贡献为零。',
            '少于两名有效成员时分数不可用；输入因子缺失直接拒绝，不填零。分数为[-1,1]排序值，不是上涨概率。',
            '组合先按最低分筛选再取前topCount，边界并列全部纳入后等权；单股上限和总敞口上限剩余留现金，不按代码偏好打破并列。',
            '下一输入收盘成交并扣单边费用，小数份额、无借款/做空/现金利息；信号已知前发生的收盘不能作为成交。末根信号不强行成交。',
            '这是虚拟证券账本，不实现完整A股T+1、涨跌停/停牌、整手、税费阶梯、冲击或公司行动。合成测试不验证收益优势。'])
