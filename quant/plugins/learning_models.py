"""Original sklearn/LightGBM estimators with chronological matured-label fits.

Features exist at the current closed bar. A prediction is immutable; its later
outcome is reported separately at the bar when that outcome becomes observable.
"""
import base64
import hashlib
import importlib.metadata
import json
import warnings
import numpy as np
import pandas as pd
from worker import clean, table

OPERATIONS = {"linear", "ridge", "logistic", "random-forest", "gradient-boosting", "lightgbm"}
FEATURES = ["return1", "return5", "return20", "volatility20", "volumeRatio20", "barRange", "barBody"]


def features(b):
    close=b.close.astype(float)
    return pd.DataFrame({"return1":close.pct_change(fill_method=None),"return5":close.pct_change(5,fill_method=None),
        "return20":close.pct_change(20,fill_method=None),"volatility20":np.log(close).diff().rolling(20).std(ddof=1),
        "volumeRatio20":b.volume/b.volume.shift(1).rolling(20).mean().replace(0,np.nan),
        "barRange":(b.high-b.low)/close,"barBody":(close-b.open)/b.open},index=b.index)


def fit_model(name, x, y, p):
    from sklearn.preprocessing import StandardScaler
    from sklearn.exceptions import ConvergenceWarning
    from sklearn.linear_model import LinearRegression, Ridge, LogisticRegression
    from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
    scaler=StandardScaler().fit(x)
    z=scaler.transform(x)
    if name=="linear":model=LinearRegression()
    elif name=="ridge":model=Ridge(alpha=p["alpha"],solver="svd")
    elif name=="logistic":
        if np.unique(y).size==1:
            return None,scaler,float(y[0])
        model=LogisticRegression(C=p["regularizationC"],solver="lbfgs",max_iter=2000,tol=1e-8,random_state=p["seed"])
    elif name=="random-forest":model=RandomForestRegressor(n_estimators=p["estimators"],max_depth=p["maxDepth"],
        min_samples_leaf=p["minLeaf"],max_features=1.,bootstrap=True,n_jobs=1,random_state=p["seed"])
    elif name=="gradient-boosting":model=GradientBoostingRegressor(n_estimators=p["estimators"],max_depth=p["maxDepth"],
        min_samples_leaf=p["minLeaf"],learning_rate=p["learningRate"],loss="squared_error",subsample=1.,random_state=p["seed"])
    elif name=="lightgbm":
        from lightgbm import LGBMRegressor
        model=LGBMRegressor(n_estimators=p["estimators"],max_depth=p["maxDepth"],num_leaves=min(31,2**p["maxDepth"]),
            min_child_samples=p["minLeaf"],learning_rate=p["learningRate"],objective="regression",n_jobs=1,
            deterministic=True,force_col_wise=True,verbosity=-1,random_state=p["seed"])
    else:raise ValueError("Unknown learner")
    with warnings.catch_warnings():
        warnings.simplefilter("error",ConvergenceWarning)
        model.fit(z,y)
    return model,scaler,None


def serialized_model(name, model, scaler, constant):
    state={"scalerMean":scaler.mean_.tolist(),"scalerScale":scaler.scale_.tolist(),"constantClassProbability":constant}
    if model is None:return state
    state["estimatorClass"]=type(model).__name__
    state["parameters"]=model.get_params(deep=False)
    if hasattr(model,"coef_"):
        state.update(coefficients=np.asarray(model.coef_).tolist(),intercept=np.asarray(model.intercept_).tolist())
        if hasattr(model,"classes_"):state["classes"]=model.classes_.tolist()
    elif name=="lightgbm":state["originalModelText"]=model.booster_.model_to_string()
    else:
        trees=np.asarray(model.estimators_,dtype=object).ravel()
        state["trees"]=[{key:getattr(tree.tree_,key).tolist() for key in ("children_left","children_right","feature","threshold","value")} for tree in trees]
        if name=="gradient-boosting":state["initialConstant"]=model.init_.constant_.tolist()
    return state


def calculate(name, b, p):
    if name not in OPERATIONS:raise ValueError("Unknown learning operation")
    x=features(b).to_numpy(dtype=float); close=b.close.to_numpy(dtype=float);n=len(b)
    horizon,window,gap,step=p["horizon"],p["trainingRows"],p["purgeBars"],p["retrainEvery"]
    if max(0,n-window-horizon-gap)//step+1>1000:
        raise ValueError("More than 1000 possible refits; increase retrainEvery or shorten input")
    target=np.full(n,np.nan); target[:-horizon]=close[horizon:]/close[:-horizon]-1
    classification=name=="logistic"
    y=np.where(np.isfinite(target),(target>0).astype(float),np.nan) if classification else target
    valid=np.isfinite(x).all(axis=1)&np.isfinite(y)
    eligible=np.flatnonzero(valid)
    out=pd.DataFrame({"time":b.time,"prediction":np.nan,"trainingBaseline":np.nan,"fitId":np.nan,
                      "trainingRows":np.nan,"trainLastFeatureBar":np.nan,"trainLastOutcomeBar":np.nan})
    audit=[];preprocessing=[];evaluations=[];parameters=[];fit_id=0;last_fit=-step
    model=scaler=constant=None;baseline=None;last_state=None;last_train=None;prediction_values={}
    mse=base_mse=loss=base_loss=0.;matches=0;seen=0
    for i in range(n):
        # Realized outcomes are written at maturity, never onto the prediction's
        # old row. Appending unseen future bars leaves old result rows intact.
        origin=i-horizon
        if origin in prediction_values:
            predicted,prior=prediction_values[origin];actual=float(y[origin]);seen+=1
            mse+=(predicted-actual)**2;base_mse+=(prior-actual)**2
            row={"time":b.time.iloc[i],"predictionTime":b.time.iloc[origin],"predictionBar":origin,
                "outcomeBar":i,"actual":actual,"predicted":predicted,"trainingBaseline":prior,
                "evaluatedPredictions":seen,"cumulativeMse":mse/seen,"baselineMse":base_mse/seen,
                "mseSkillVsTrainingBaseline":1-mse/base_mse if base_mse>0 else np.nan}
            if classification:
                prob=np.clip(predicted,1e-15,1-1e-15);pr=np.clip(prior,1e-15,1-1e-15)
                loss-=actual*np.log(prob)+(1-actual)*np.log(1-prob)
                base_loss-=actual*np.log(pr)+(1-actual)*np.log(1-pr)
                matches+=int((predicted>=.5)==bool(actual))
                row.update(cumulativeLogLoss=loss/seen,baselineLogLoss=base_loss/seen,accuracy=matches/seen)
            evaluations.append(row)
        if not np.isfinite(x[i]).all():continue
        end=i-horizon-gap
        count=int(np.searchsorted(eligible,end,side="right"))
        if count<window:continue
        if fit_id==0 or i-last_fit>=step:
            train=eligible[count-window:count]
            model,scaler,constant=fit_model(name,x[train],y[train],p)
            baseline=float(y[train].mean());fit_id+=1;last_fit=i;last_train=train
            state=serialized_model(name,model,scaler,constant)
            last_state={"schema":"webstock.fitted-learner.v1","operation":name,"trainedAt":str(b.time.iloc[i]),
                        "features":FEATURES,"featureDefinition":"webstock-closed-ohlcv-seven-v1","targetHorizon":horizon,
                        "target":"positive-close-return" if classification else "close-simple-return",
                        "trainFirstFeatureBar":int(train[0]),"trainLastFeatureBar":int(train[-1]),
                        "trainLastOutcomeBar":int(train[-1]+horizon),"trainingBaseline":baseline,"state":state}
            encoded=json.dumps(clean(last_state),allow_nan=False,sort_keys=True,separators=(",",":")).encode()
            audit.append({"time":b.time.iloc[i],"fitId":fit_id,"trainingRows":len(train),"firstFeatureBar":int(train[0]),
                "lastFeatureBar":int(train[-1]),"lastOutcomeBar":int(train[-1]+horizon),"predictionBar":i,
                "firstFeatureTime":b.time.iloc[train[0]],"lastOutcomeTime":b.time.iloc[train[-1]+horizon],
                "purgeBars":gap,"stateSha256":hashlib.sha256(encoded).hexdigest(),"fitStatus":"constant-single-class" if model is None else "fitted"})
            coeff=np.asarray(model.coef_).ravel() if model is not None and hasattr(model,"coef_") else None
            importance=model.feature_importances_ if model is not None and hasattr(model,"feature_importances_") else None
            for k,feature in enumerate(FEATURES):
                preprocessing.append({"time":b.time.iloc[i],"fitId":fit_id,"feature":feature,"mean":scaler.mean_[k],"scale":scaler.scale_[k]})
                parameters.append({"time":b.time.iloc[i],"fitId":fit_id,"feature":feature,
                    "standardizedCoefficient":coeff[k] if coeff is not None else np.nan,
                    "originalLibraryImportance":importance[k] if importance is not None else np.nan})
        if model is None:prediction=constant
        else:
            z=scaler.transform(x[i:i+1])
            if classification:prediction=float(model.predict_proba(z)[0,list(model.classes_).index(1.)])
            elif name=="lightgbm":prediction=float(model.booster_.predict(z,num_threads=1)[0])
            else:prediction=float(model.predict(z)[0])
        if not np.isfinite(prediction):raise ValueError("Nonfinite model prediction")
        out.loc[i,["prediction","trainingBaseline","fitId","trainingRows","trainLastFeatureBar","trainLastOutcomeBar"]]=[
            prediction,baseline,fit_id,window,int(last_train[-1]),int(last_train[-1]+horizon)]
        prediction_values[i]=(prediction,baseline)
    if not audit:raise ValueError("Not enough mature labels with valid features for one training window")
    last_state["dependencies"]={key:importlib.metadata.version(key) for key in ("numpy","pandas","scikit-learn","lightgbm")}
    raw=json.dumps(clean(last_state),allow_nan=False,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
    if len(raw)>16*1024*1024:raise ValueError("Final fitted model exceeds 16 MiB export limit")
    evaluation_columns=["time","predictionTime","predictionBar","outcomeBar","actual","predicted","trainingBaseline","evaluatedPredictions",
        "cumulativeMse","baselineMse","mseSkillVsTrainingBaseline"]+(["cumulativeLogLoss","baselineLogLoss","accuracy"] if classification else [])
    notes=["逐时点训练：只纳入已成熟且留出purgeBars的标签；标准化只拟合当次训练集。没有随机切分、全样本调参或未来早停。",
        "预测发生在当前收盘信息已知后；目标为随后H根收盘收益或上涨概率，不等于可按当前收盘成交。未含交易成本或策略权益。",
        "MSE/Brier及LogLoss在实际结果可知时点计入。重叠持有期的误差相关，不作独立样本显著性或收益承诺。",
        "固定七项价量特征仅作为明确的可运行基线；不代表对该模型家族所有特征和调参方案的覆盖。",
        "导出最后一次拟合的JSON参数/树结构及库版本，不使用可执行pickle；当前接口不自动执行导入模型。"]
    if "datasetkind" in b and b.datasetkind.eq("synthetic-test").any():notes.insert(0,"合成验算数据，不是实盘收益证据。")
    return {"kind":"indicator","engineVersion":"webstock-walk-forward-v1","formulaVersion":"webstock-learning-"+name+"-v1",
        "tables":[table("indicators",out),table("training-audit",pd.DataFrame(audit)),
                  table("training-preprocessing",pd.DataFrame(preprocessing)),table("learned-parameters",pd.DataFrame(parameters)),
                  table("matured-evaluation",pd.DataFrame(evaluations,columns=evaluation_columns))],"warnings":notes,
        "generatedData":{"name":name+"-last-fit.json","mediaType":"application/json","sha256":hashlib.sha256(raw).hexdigest(),"base64":base64.b64encode(raw).decode()},
        "modelSemantics":{"targetHorizon":horizon,"classification":classification,"featureNames":FEATURES,"fits":fit_id,
                          "predictionTime":"current closed bar known; execution would be later","trainingUsesFutureLabels":False}}
