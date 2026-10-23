"""Synchronized two-security ARX / VAR / cointegration research endpoints."""
import hashlib
import json
import warnings
import numpy as np
import pandas as pd
from worker import clean,table

OPERATIONS={'arx','var','cointegration-pair'}


def calculate(name,b,p):
    import statsmodels.api as sm
    from statsmodels.tsa.api import VAR
    from statsmodels.tsa.stattools import coint,adfuller
    if name not in OPERATIONS:raise ValueError('Unknown panel econometric model')
    y_symbol,x_symbol=p['security'],p['reference']
    if y_symbol==x_symbol:raise ValueError('Choose two distinct securities')
    prices=b.pivot(index='time',columns='symbol',values='close').sort_index()
    if not {y_symbol,x_symbol}<=set(prices):raise ValueError('Requested securities missing')
    selected=prices[[y_symbol,x_symbol]]
    if selected.isna().any().any():raise ValueError('Every decision needs both synchronized prices; no forward fill or silent date dropping')
    logp=np.log(selected.to_numpy(dtype=float));returns=np.diff(logp,axis=0,prepend=np.full((1,2),np.nan))
    window,step=p['trainingRows'],p['forecastEvery']
    first=window+2 if name=='arx' else window
    endpoints=list(range(first,len(selected),step))
    if not endpoints:raise ValueError('Insufficient synchronized history')
    if len(endpoints)>1000:raise ValueError('More than 1000 model endpoints')
    rows=[];audit=[];coefficients=[];failures=0
    for i in endpoints:
        row={'time':selected.index[i],'status':'fitted'}
        record={'time':selected.index[i],'predictionBar':i,'trainingRows':window,'status':'fitted','diagnostic':''}
        try:
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter('always')
                if name=='arx':
                    # j features -> j+1 return; latest label i-1, so one full
                    # outcome bar separates the training labels from prediction.
                    end=i-2;start=end-window+1
                    x=sm.add_constant(returns[start:end+1],has_constant='add');y=returns[start+1:end+2,0]
                    fitted=sm.OLS(y,x,missing='raise').fit()
                    if np.linalg.matrix_rank(x)!=3:raise ValueError('ARX design is rank deficient')
                    forecast=float(np.r_[1.,returns[i]]@fitted.params)
                    row.update(nextLogReturn=forecast,trainingMeanReturn=float(y.mean()),residualStd=float(np.sqrt(fitted.mse_resid)))
                    state={'intercept':fitted.params[0],'ownLagReturn':fitted.params[1],'referenceLagReturn':fitted.params[2]}
                    record.update(firstFeatureBar=start,lastFeatureBar=end,lastOutcomeBar=end+1)
                elif name=='var':
                    start=i-window+1;lags=p['lags']
                    fit=VAR(returns[start:i+1]).fit(maxlags=lags,ic=None,trend='c')
                    if np.linalg.matrix_rank(fit.endog_lagged)!=fit.endog_lagged.shape[1]:raise ValueError('VAR design is rank deficient')
                    if not np.isfinite(fit.params).all():raise ValueError('Nonfinite VAR parameters')
                    prediction=fit.forecast(returns[i-lags+1:i+1],steps=1)[0]
                    row.update(nextSecurityLogReturn=prediction[0],nextReferenceLogReturn=prediction[1],stable=bool(fit.is_stable()))
                    state={f'parameter{j}_{k}':v for j,values in enumerate(fit.params) for k,v in enumerate(values)}
                    record.update(firstFeatureBar=start,lastFeatureBar=i,lastOutcomeBar=i)
                else:
                    start=i-window;end=i-1;training=logp[start:i];x=sm.add_constant(training[:,1],has_constant='add')
                    if np.linalg.matrix_rank(x)!=2:raise ValueError('Pair regression is rank deficient')
                    fitted=sm.OLS(training[:,0],x,missing='raise').fit();alpha,beta=fitted.params
                    mean=float(fitted.resid.mean());std=float(np.std(fitted.resid,ddof=2))
                    if std<1e-10:raise ValueError('Near-exact collinearity; residual test not identified')
                    statistic,pvalue,_=coint(training[:,0],training[:,1],trend='c',maxlag=p['adfLags'],autolag=None)
                    if not np.isfinite(statistic):raise ValueError('Nonfinite cointegration statistic')
                    spread=logp[i,0]-alpha-beta*logp[i,1]
                    row.update(residual=spread,residualZ=(spread-mean)/std,intercept=alpha,hedgeElasticity=beta,
                        residualTrainingStd=std,engleGrangerStatistic=statistic,engleGrangerPValue=pvalue,
                        securityLevelAdfPValue=adfuller(training[:,0],maxlag=p['adfLags'],regression='c',autolag=None)[1],
                        referenceLevelAdfPValue=adfuller(training[:,1],maxlag=p['adfLags'],regression='c',autolag=None)[1])
                    state={'intercept':alpha,'hedgeElasticity':beta,'residualTrainingMean':mean,'residualTrainingStd':std}
                    record.update(firstFeatureBar=start,lastFeatureBar=end,lastOutcomeBar=end)
                if not all(np.isfinite(v) for v in state.values()):raise ValueError('Nonfinite fitted model')
                raw=json.dumps(clean(state),sort_keys=True,allow_nan=False,separators=(',',':')).encode()
                record['stateSha256']=hashlib.sha256(raw).hexdigest()
                record['diagnostic']=' | '.join(str(w.message) for w in caught)[:1000]
                for key,value in state.items():coefficients.append({'time':selected.index[i],'parameter':key,'value':value})
        except (ValueError,np.linalg.LinAlgError,RuntimeError,ZeroDivisionError) as error:
            # Discard any partially computed values if the fit/test fails.
            row={'time':selected.index[i],'status':'fit-unavailable'};record.update(status='fit-unavailable',diagnostic=str(error)[:1000]);failures+=1
        rows.append(row);audit.append(record)
    if failures==len(endpoints):raise ValueError('No valid econometric fit; '+audit[-1]['diagnostic'])
    notes=['两只证券需在每个决策时点有同步价格；不前向填充，也不静默删除缺失证券。',
        'ARX只训练截至前一根的结果；VAR在当前收盘可知后预测下一根；配对系数和残差均值/方差只用当前之前的窗口。',
        'Engle–Granger检验以前提I(1)及模型设定为条件；同时列水平ADF诊断，不把单个小p值当作可交易协整证明。',
        '反复窗口检验未做多重检验调整；稳定性、交易费用、借券、换手和执行规则未转换成策略收益。',
        '配对beta是对数价格弹性，不是直接可下单的股数比。VAR稳定性字段按原库规则计算，不稳定结果需单独判断。',
        '拟合不可用窗口数量：'+str(failures)+'；见training-audit。']
    if 'datasetkind' in b and b.datasetkind.eq('synthetic-test').any():notes.insert(0,'合成多证券验算数据，不是实盘收益证据。')
    return {'kind':'indicator','engineVersion':'statsmodels/'+sm.__version__,'formulaVersion':'webstock-statistical-'+name+'-v1',
        'tables':[table('indicators',pd.DataFrame(rows)),table('training-audit',pd.DataFrame(audit)),table('fitted-parameters',pd.DataFrame(coefficients))],
        'warnings':notes,'modelSemantics':{'security':y_symbol,'reference':x_symbol,'trainingRows':window,'forecastEvery':step,'unavailableFits':failures}}
