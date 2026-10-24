"""Original statistical libraries evaluated only at explicit as-of endpoints.

Each fit uses a trailing window. Failed optimization is retained as a failed
observation, never replaced by a successful-looking forecast or future fit.
"""
import base64
import hashlib
import importlib.metadata
import json
import warnings
import numpy as np
import pandas as pd
from worker import table,clean

OPERATIONS={"gaussian-hmm","markov-switching","garch","egarch","gjr-garch","arima"}


class FitUnavailable(ValueError):
    pass


def fit_window(name,returns,logprices,p):
    if name!='arima' and np.std(returns)<1e-10:
        raise FitUnavailable("Constant/degenerate return window")
    if name in ('gaussian-hmm','markov-switching'):
        states=p['states']
        if name=='gaussian-hmm':
            from hmmlearn.hmm import GaussianHMM
            model=GaussianHMM(n_components=states,covariance_type='diag',n_iter=p['maxIterations'],tol=.001,
                min_covar=.001,random_state=p['seed'],implementation='log').fit(returns[:,None])
            history=list(model.monitor_.history);gain=history[-1]-history[-2] if len(history)>=2 else np.inf
            if not np.isfinite(gain) or gain < -1e-6 or gain > .001:
                raise FitUnavailable("HMM did not meet likelihood-improvement tolerance; last gain="+str(gain))
            current=model.score_samples(returns[:,None])[1][-1]
            means=model.means_.ravel();variances=model.covars_.reshape(states,-1)[:,0]
            transition=model.transmat_;next_probability=current@transition
            state={"meansPercent":means.tolist(),"variancesPercentSquared":variances.tolist(),"initialProbabilities":model.startprob_.tolist(),
                   "transitionRowsFromColumnsTo":transition.tolist(),"logLikelihoodGain":gain,"iterations":model.monitor_.iter}
        else:
            from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression
            fitted=MarkovRegression(returns,k_regimes=states,trend='c',switching_variance=True).fit(disp=False,maxiter=p['maxIterations'],em_iter=10,search_reps=0)
            if not fitted.mle_retvals.get('converged',False):raise FitUnavailable("Markov switching optimization did not converge")
            parameters=dict(zip(fitted.model.param_names,np.asarray(fitted.params).tolist()))
            means=np.array([parameters[f'const[{i}]'] for i in range(states)])
            variances=np.array([parameters[f'sigma2[{i}]'] for i in range(states)])
            current=np.asarray(fitted.filtered_marginal_probabilities)[-1]
            transition=np.asarray(fitted.regime_transition)[:,:,0].T
            next_probability=current@transition
            state={"originalParameters":parameters,"meansPercent":means.tolist(),"variancesPercentSquared":variances.tolist(),
                   "transitionRowsFromColumnsTo":transition.tolist()}
        if not np.isfinite(current).all() or not np.isclose(sum(current),1,atol=1e-8):raise FitUnavailable("Invalid filtered state probabilities")
        order=np.argsort(means,kind='stable')
        values={"nextMeanReturn":float(next_probability@means/100),"mostLikelyMeanRank":int(np.argmax(current[order]))+1}
        for rank,k in enumerate(order):
            values.update({f'filteredProbability{rank+1}':current[k],f'nextProbability{rank+1}':next_probability[k],
                           f'stateMeanReturn{rank+1}':means[k]/100,f'stateVolatility{rank+1}':np.sqrt(variances[k])/100})
        state['meanRankToOriginalState']=order.tolist()
        return values,state
    if name in ('garch','egarch','gjr-garch'):
        from arch import arch_model
        spec=arch_model(returns,mean='Constant',vol='EGARCH' if name=='egarch' else 'GARCH',p=1,o=0 if name=='garch' else 1,q=1,
                        dist='normal',rescale=False)
        fitted=spec.fit(disp='off',update_freq=0,show_warning=False,options={'maxiter':p['maxIterations']})
        if fitted.convergence_flag!=0:raise FitUnavailable("Volatility optimization did not converge; flag="+str(fitted.convergence_flag))
        forecast=fitted.forecast(horizon=1,method='analytic',reindex=False)
        variance=float(forecast.variance.iloc[-1,0])/10000
        if not np.isfinite(variance) or variance<0:raise FitUnavailable("Invalid forecast variance")
        values={"nextMeanReturn":float(forecast.mean.iloc[-1,0])/100,"nextVariance":variance,
                "nextVolatility":np.sqrt(variance),"nextAnnualizedVolatility":np.sqrt(variance*p['annualBars']),
                "currentConditionalVolatility":float(fitted.conditional_volatility[-1])/100}
        state={"originalParameters":fitted.params.to_dict(),"units":"percent returns; variance parameters in percent squared except EGARCH log variance",
               "lastResidualPercent":float(fitted.resid[-1]),"lastConditionalVariancePercentSquared":float(fitted.conditional_volatility[-1]**2),
               "optimizationIterations":int(fitted.optimization_result.nit)}
        return values,state
    if name=='arima':
        from statsmodels.tsa.arima.model import ARIMA
        model=ARIMA(logprices,order=(p['arOrder'],p['differenceOrder'],p['maOrder']),trend='n' if p['differenceOrder'] else 'c',
                    enforce_stationarity=True,enforce_invertibility=True)
        fitted=model.fit(method_kwargs={'maxiter':p['maxIterations']})
        if not fitted.mle_retvals.get('converged',False):raise FitUnavailable("ARIMA optimization did not converge")
        forecast=fitted.get_forecast(steps=1);mean=float(forecast.predicted_mean[0]);variance=float(forecast.var_pred_mean[0])
        bounds=np.asarray(forecast.conf_int(alpha=.05))[0]
        values={"nextLogPrice":mean,"nextMedianPrice":np.exp(mean),"nextMedianReturn":np.expm1(mean-logprices[-1]),
                "logForecastStd":np.sqrt(variance),"priceLower95":np.exp(bounds[0]),"priceUpper95":np.exp(bounds[1])}
        if not all(np.isfinite(x) for x in values.values()):raise FitUnavailable("Nonfinite ARIMA forecast")
        return values,{"originalParameters":dict(zip(model.param_names,np.asarray(fitted.params).tolist())),
                       "order":[p['arOrder'],p['differenceOrder'],p['maOrder']],"trend":'n' if p['differenceOrder'] else 'c'}
    raise ValueError("Unknown statistical operation")


def calculate(name,b,p):
    if name not in OPERATIONS:raise ValueError("Unknown statistical operation")
    window,step=p['trainingRows'],p['forecastEvery']
    if window<40:raise ValueError("At least 40 training observations required")
    endpoints=list(range(window,len(b),step))
    if not endpoints:raise ValueError("Insufficient trailing observations")
    if len(endpoints)>1000:raise ValueError("More than 1000 refits; increase forecastEvery or shorten data")
    logprices=np.log(b.close.to_numpy(dtype=float))
    returns=100*np.diff(logprices,prepend=np.nan)
    output=[];audit=[];parameters=[];last_model=None;failures=0
    for i in endpoints:
        start=i-window+1
        record={"time":b.time.iloc[i],"trainingStart":b.time.iloc[start],"firstTrainingBar":start,"lastTrainingBar":i,
                "observations":window,"status":"fitted","diagnostic":""}
        row={"time":b.time.iloc[i],"status":"fitted"}
        try:
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter('always')
                values,state=fit_window(name,returns[start:i+1],logprices[start:i+1],p)
            row.update(values)
            record['diagnostic']=' | '.join(str(w.message) for w in caught)[:1000]
            last_model={"schema":"webstock.fitted-statistical-model.v1","operation":name,"trainedAt":str(b.time.iloc[i]),
                "trainingRows":window,"lastTrainingBar":i,"returnDefinition":"100*log(close/previousClose)","horizonBars":1,"state":state}
            raw=json.dumps(clean(last_model),sort_keys=True,allow_nan=False,separators=(',',':')).encode()
            record['stateSha256']=hashlib.sha256(raw).hexdigest()
            for key,value in state.get('originalParameters',{}).items():parameters.append({"time":b.time.iloc[i],"parameter":key,"value":value})
        except (FitUnavailable,ValueError,np.linalg.LinAlgError,RuntimeError,ZeroDivisionError) as error:
            failures+=1;row['status']='fit-unavailable';record.update(status='fit-unavailable',diagnostic=str(error)[:1000])
        output.append(row);audit.append(record)
    if last_model is None:raise ValueError("No converged statistical fit; "+audit[-1]['diagnostic'])
    last_model['dependencies']={key:importlib.metadata.version(key) for key in ('numpy','pandas','scipy','statsmodels','hmmlearn','arch')}
    raw=json.dumps(clean(last_model),sort_keys=True,allow_nan=False,separators=(',',':')).encode()
    notes=["只在所选观察间隔的当前已知收盘时点拟合尾随窗口；下一根预测不等于当前收盘可成交。没有全样本自动选阶或回填历史。",
        "状态概率仅取当前过滤端点；状态按本次拟合均值排序，编号不是稳定的牛熊标签。",
        "预测误差/参数存在估计不确定性；没有策略收益或显著性承诺。置信区间不包含参数估计不确定性。",
        "拟合不可用窗口数量："+str(failures)+"；见training-audit，未用后续模型或替代算法填补。",
        "收益输入为百分数对数收益；输出收益与波动率转换为小数。ARIMA基于对数价格，指数化均值是价格中位数。"]
    if 'datasetkind' in b and b.datasetkind.eq('synthetic-test').any():notes.insert(0,"合成验算数据，不是实盘收益证据。")
    return {"kind":"indicator","engineVersion":"webstock-statistical-endpoints-v1","formulaVersion":"webstock-statistical-"+name+"-v1",
        "tables":[table('indicators',pd.DataFrame(output)),table('training-audit',pd.DataFrame(audit)),
                  table('fitted-parameters',pd.DataFrame(parameters,columns=['time','parameter','value']))],"warnings":notes,
        "generatedData":{"name":name+'-last-fit.json',"sha256":hashlib.sha256(raw).hexdigest(),"base64":base64.b64encode(raw).decode()},
        "modelSemantics":{"trailingRows":window,"forecastEvery":step,"fitCount":len(endpoints),"unavailableFits":failures,
                          "horizonBars":1,"historicalStatesRepainted":False}}
