"""Explicit equity risk and next-input-close risk-budget portfolio simulation."""
import numpy as np
import pandas as pd
from worker import table


def equity_risk(name,b,p):
    r=(b.equity-b.externalflow)/b.equity.shift(1)-1
    nav=(1+r.fillna(0)).cumprod();peak=nav.cummax();drawdown=nav/peak-1
    if not np.isfinite(r.iloc[1:]).all() or (1+r.iloc[1:]<=0).any() or not np.isfinite(nav).all():
        raise ValueError('Portfolio returns exceed numerical range; split/rebase the capital segment')
    annual=p['annualBars'];window=p['period'];target=p['minimumReturnPerBar']
    downside=np.sqrt(np.minimum(r-target,0).pow(2).rolling(window).mean()*annual)
    volatility=r.rolling(window).std(ddof=1)*np.sqrt(annual)
    out=pd.DataFrame({'time':b.time,'netEquity':b.equity,'endExternalFlow':b.externalflow,'flowAdjustedReturn':r,
        'unitNav':nav,'drawdown':drawdown,'maximumDrawdownToDate':drawdown.cummin(),
        'downsideDeviation':downside,'annualVolatility':volatility})
    duration=[];count=0
    for d in drawdown:count=count+1 if d < -1e-12 else 0;duration.append(count)
    out['underwaterValuations']=duration
    notes=['输入是声明已包含交易费用的真实或回测策略权益；出入金只支持估值时点末发生，按(E_t-flow_t)/E_(t-1)-1计算收益。',
        '首根为初始权益；非正权益或清盘再注资须分段，不能当作普通收益接续。费用和流量声明只核验内部一致性，不认证外部账本。',
        '下行偏差=sqrt(annualBars*mean(min(return-minimumReturnPerBar,0)^2))，分母含全部窗口观察；与仅负收益的样本标准差不同。',
        '年化依赖用户指定的每年估值次数，未自动猜测不规则估值间隔。历史回撤不是未来最大损失。']
    if name=='target-volatility':
        out['targetAnnualVolatility']=p['targetVolatility']
        out['proposedExposure']=np.minimum(p['maxExposure'],p['targetVolatility']/volatility.where(volatility>0))
        out['exposureStatus']=np.where(volatility.isna(),'warmup',np.where(volatility<=0,'zero-risk-estimate-unavailable','proposal-only'))
        notes.append('目标敞口只是一项下一时点决策建议，限制不超过maxExposure；零波动估计保留不可用，不据此加满仓。不把缩放后的净收益冒充已撮合策略。')
    if 'datasetkind' in b and b.datasetkind.eq('synthetic-test').any():notes.insert(0,'合成账本仅作验算，不是实际策略收益。')
    return {'kind':'indicator','engineVersion':'webstock-portfolio-risk-v1','formulaVersion':'webstock-risk-'+name+'-v1',
        'tables':[table('indicators',out)],'warnings':notes,'inputSemantics':{'kind':'portfolio-equity-csv','flows':'end-of-valuation',
        'feesIncludedClaim':True,'currency':b.currency.iloc[0],'provenanceCertified':False}}


def solve_budget(cov,budget):
    """CCD minimizes .5*x'Cx - sum(b_i*log(x_i)), then normalizes x."""
    if not np.isfinite(cov).all() or np.linalg.eigvalsh(cov).min()<=0:raise ValueError('Risk covariance must be positive definite')
    x=np.sqrt(budget/np.diag(cov))
    for iteration in range(1,1001):
        for k in range(len(x)):
            a=cov[k,k];s=float(cov[k]@x-a*x[k]);root=np.sqrt(s*s+4*a*budget[k])
            x[k]=2*budget[k]/(root+s) if s>=0 else (root-s)/(2*a)
        contributions=x*(cov@x);error=float(np.max(np.abs(contributions-budget)))
        if error<1e-10:
            weights=x/x.sum();return weights,iteration,error
    raise ValueError('Risk budget optimizer did not converge')


def post_fee_rebalance(equity,old_values,weights,rate):
    # Solve post = equity - rate*sum(abs(post*weights-old_values)). This includes
    # the cash required by fees even at 100% investment, without borrowing.
    low=0.;high=equity
    for _ in range(80):
        post=(low+high)/2
        residual=post+rate*np.abs(post*weights-old_values).sum()-equity
        if residual>0:high=post
        else:low=post
    post=(low+high)/2;values=post*weights;fee=rate*np.abs(values-old_values).sum()
    cash=equity-fee-values.sum()
    if cash < -1e-8*max(1.,equity):raise ValueError('Rebalance would borrow cash')
    return values,max(0.,cash),fee


def risk_budget(b,p):
    symbols=[x.strip() for x in p['symbols'].split(',')]
    if not 2<=len(symbols)<=16 or len(set(symbols))!=len(symbols) or any(not x for x in symbols):raise ValueError('Specify 2..16 distinct securities')
    budgets=np.asarray([float(x) for x in p['riskBudgets'].split(',')])
    if len(budgets)!=len(symbols) or not np.isfinite(budgets).all() or (budgets<=0).any():raise ValueError('One positive risk budget per security required')
    budgets=budgets/budgets.max();budgets=budgets/budgets.sum()
    prices=b.pivot(index='time',columns='symbol',values='close').sort_index()
    if not set(symbols)<=set(prices):raise ValueError('Requested securities missing')
    prices=prices[symbols]
    if prices.isna().any().any():raise ValueError('Every selected security needs synchronized prices, including held inactive securities')
    members=b.pivot(index='time',columns='symbol',values='member').reindex(index=prices.index,columns=symbols).to_numpy(dtype=bool)
    barends=b.groupby('time',sort=True).barend.first().reindex(prices.index)
    x=prices.to_numpy();times=prices.index;returns=prices.pct_change(fill_method=None).to_numpy()
    window,step=p['period'],p['rebalanceEvery'];annual=p['annualBars'];rate=p['feeBps']/10000
    shares=np.zeros(len(symbols));cash=p['capital'];pending=None;last_signal=-step;signals=0;failures=0;fees=0.
    equity_rows=[];weight_rows=[];orders=[];audit=[];positions=[]
    for i in range(len(times)):
        old_values=shares*x[i];equity=cash+old_values.sum();fee=0.
        if pending is not None:
            weights,signal_bar=pending
            if barends.iloc[i]<=times[signal_bar]:
                raise ValueError('Next input close already occurred when the signal became known; delayed availability cannot be backfilled into a fill')
            values,cash,fee=post_fee_rebalance(equity,old_values,weights,rate);new_shares=values/x[i]
            for k,symbol in enumerate(symbols):
                delta=new_shares[k]-shares[k]
                if abs(delta)>1e-12:
                    orders.append({'time':times[i],'signalTime':times[signal_bar],'signalBar':signal_bar,'executionBar':i,
                        'symbol':symbol,'quantity':delta,'price':x[i,k],'notional':abs(delta*x[i,k]),'fee':abs(delta*x[i,k])*rate})
            shares=new_shares;fees+=fee;equity=cash+values.sum();pending=None
        equity_rows.append({'time':times[i],'equity':equity,'cash':cash,'periodFees':fee,'cumulativeFees':fees})
        for k,symbol in enumerate(symbols):positions.append({'time':times[i],'symbol':symbol,'quantity':shares[k],'close':x[i,k],
            'marketValue':shares[k]*x[i,k],'realizedWeight':shares[k]*x[i,k]/equity})
        if i<window or i-last_signal<step:continue
        last_signal=i;active=np.flatnonzero(members[i]);weights=np.zeros(len(symbols));status='computed';reason='';iterations=0;error=0.;vol=0.;ridge=0.;exposure=0.
        unconstrained=np.zeros(len(symbols));contributions=np.zeros(len(symbols));desired=np.zeros(len(symbols))
        try:
            if len(active):
                sample=returns[i-window+1:i+1,active]
                if not np.isfinite(sample).all():raise ValueError('Incomplete training return window')
                covariance=np.atleast_2d(np.cov(sample,rowvar=False,ddof=1))*annual
                if (np.diag(covariance)<=0).any():raise ValueError('Zero variance security; risk budget unavailable')
                covariance=(1-p['shrinkage'])*covariance+p['shrinkage']*np.diag(np.diag(covariance))
                ridge=float(np.diag(covariance).mean()*1e-6);covariance+=np.eye(len(active))*ridge
                desired[active]=budgets[active]/budgets[active].sum()
                local,iterations,error=solve_budget(covariance,desired[active]);unconstrained[active]=local
                variance=float(local@covariance@local);vol=np.sqrt(variance)
                contributions[active]=local*(covariance@local)/variance
                # Uniform scaling preserves relative risk budgets while satisfying
                # both gross exposure and single-security concentration limits.
                exposure=min(p['maxExposure'],p['targetVolatility']/vol,p['maxSecurityWeight']/local.max())
                weights=unconstrained*exposure
            else:status='no-active-members-cash'
            pending=(weights,i);signals+=1
        except ValueError as exc:
            status='unavailable-hold-positions';reason=str(exc);failures+=1
        audit.append({'time':times[i],'signalBar':i,'firstReturnBar':i-window+1,'lastReturnBar':i,'status':status,'diagnostic':reason,
            'iterations':iterations,'budgetResidual':error if not reason else np.nan,'ridgeAnnualVariance':ridge,'unscaledAnnualVolatility':vol if not reason else np.nan,
            'allocatedExposure':exposure if not reason else np.nan,'predictedAnnualVolatility':vol*exposure if not reason else np.nan})
        for k,symbol in enumerate(symbols):weight_rows.append({'time':times[i],'symbol':symbol,'member':bool(members[i,k]),
            'status':status,'riskBudget':desired[k],'riskContributionFraction':contributions[k] if not reason else np.nan,
            'unscaledWeight':unconstrained[k] if not reason else np.nan,'targetWeight':weights[k] if not reason else np.nan})
    if not signals:raise ValueError('No valid risk-budget signal: insufficient history or invalid covariance')
    notes=['固定研究证券需逐时点同步行情；历史member决定当次目标成员，仍需提供退出证券价格以记录真实持仓，不能让亏损持仓因缺失数据消失。',
        '样本协方差(ddof=1)年化，按shrinkage收缩到对角，再加平均方差的1e-6对角脊；CCD求正权重风险预算并核对残差。',
        '先求相对风险预算，再统一缩放以同时满足目标波动、总敞口及单证券上限，剩余留现金。不是带复杂约束的最优组合。',
        '当前收盘已知信息产生目标，下一输入根收盘按实际可用价格调仓；费用从资金扣除并求解调仓后资本，支持小数份额，无借款、卖空或现金利息。',
        '此为明确的虚拟证券账本，不实现A股T+1、涨跌停/停牌、整手、税费阶梯、流动性冲击或公司行动。价格口径必须自行核实。',
        '协方差不可用的窗口保留诊断并继续持有原仓位，下一次计划重估再尝试；末根信号不强行成交，末仓按市值记录。',
        '事先指定研究集合可能含选择偏差；合成数据和账本对账不构成收益有效性验证。']
    return {'kind':'backtest','engineVersion':'webstock-risk-budget-v1','formulaVersion':'webstock-risk-risk-budget-v1',
        'tables':[table('equity',pd.DataFrame(equity_rows)),table('target-weights',pd.DataFrame(weight_rows)),
            table('orders',pd.DataFrame(orders,columns=['time','signalTime','signalBar','executionBar','symbol','quantity','price','notional','fee'])),
            table('positions',pd.DataFrame(positions)),table('risk-audit',pd.DataFrame(audit))],
        'warnings':notes,'modelSemantics':{'signals':signals,'unavailableWindows':failures,'execution':'next-input-close',
            'fractionalQuantity':True,'automaticTrading':False,'cashInterest':0.,'shortSelling':False}}


def calculate(name,b,p):
    return risk_budget(b,p) if name=='risk-budget' else equity_risk(name,b,p)
