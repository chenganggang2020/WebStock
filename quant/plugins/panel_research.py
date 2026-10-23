"""Multi-security research using explicit availability and historical membership."""
import numpy as np
import pandas as pd
from panel_contract import wide, known_numeric, known_industry
from worker import table


def long_values(frames, selected):
    index=selected.stack(future_stack=True)
    result=pd.DataFrame({key:frame.stack(future_stack=True) for key,frame in frames.items()})
    return result.loc[index.eq(True)].reset_index()


def calculate(name,b,p):
    from fundamental_research import OPERATIONS, calculate as fundamentals
    if name in OPERATIONS:return fundamentals(name,b,p)
    close=wide(b,"close");selected=wide(b,"member").eq(1)
    returns=close.pct_change(fill_method=None)
    n=int(p.get("period",20))
    warnings=["时间戳是输入提供方的声明：本插件检查先后关系，不据此认证外部数据确为历史可得。",
              "每次决策使用声明的历史成分股；缺失价格和预热不足保持空值，不向前填充。",
              "这些是研究特征和风险统计，未执行订单，也未证明收益优势。"]
    if b.pricebasis.iloc[0]=="raw":warnings.append("输入为未复权价格，拆并股和分红可产生机械收益跳变；未凭空补公司行动。")
    if "datasetkind" in b and b.datasetkind.eq("synthetic-test").any():warnings.insert(0,"此输入是合成测试数据，只用于验证计算与界面，不能用于评估实际投资收益。")
    tables=[]
    if name=="market-breadth":
        valid=returns.notna()&selected
        advance=((returns>0)&selected).sum(axis=1);decline=((returns<0)&selected).sum(axis=1)
        unchanged=((returns==0)&selected).sum(axis=1)
        mean=close.rolling(n).mean();ma_valid=mean.notna()&selected
        high=wide(b,"high").shift().rolling(n).max();low=wide(b,"low").shift().rolling(n).min()
        hl_valid=high.notna()&low.notna()&selected
        net=advance-decline;scaled=1000*net/(advance+decline).replace(0,np.nan)
        oscillator=scaled.ewm(span=19,adjust=False,min_periods=19).mean()-scaled.ewm(span=39,adjust=False,min_periods=39).mean()
        # An undefined advance/decline ratio cannot silently bridge the warmup.
        oscillator=oscillator.where(scaled.rolling(39).count()>=39)
        summation=pd.Series(np.nan,index=oscillator.index)
        first=oscillator.first_valid_index()
        if first is not None:summation.loc[first:]=oscillator.loc[first:].cumsum(skipna=False)
        out=pd.DataFrame({"universeCount":selected.sum(axis=1),"returnCoverage":valid.sum(axis=1),"advances":advance,
            "declines":decline,"unchanged":unchanged,"advanceDeclineRatio":advance/decline.replace(0,np.nan),
            "advancePct":100*advance/valid.sum(axis=1).replace(0,np.nan),
            "adLine":net.cumsum(),"maCoverage":ma_valid.sum(axis=1),
            "aboveMaPct":100*((close>mean)&selected).sum(axis=1)/ma_valid.sum(axis=1).replace(0,np.nan),
            "highLowCoverage":hl_valid.sum(axis=1),"newHighs":((wide(b,"high")>high)&selected).sum(axis=1),
            "newLows":((wide(b,"low")<low)&selected).sum(axis=1),"mcclellanRatioAdjusted":oscillator,"mcclellanSummation":summation})
        tables=[table("indicators",out.reset_index())]
        warnings.append("AD线从输入起点累积；ADR上涨/下跌，零分母留空。新高低比较前n根区间，不包含当前根；均线比例只用已预热成分。")
        warnings.append("McClellan为1000*(涨-跌)/(涨+跌)的EMA19减EMA39，adjust=False，首个有效值起种；显示前须连续39个有效输入。")
        warnings.append("Summation从首个有效振荡值累加，起始偏移0；此后若有未知振荡值，累计线保持未知，不跳过缺口。上涨占比的分母包含有效平盘成分。")
    elif name=="beta-correlation":
        benchmark=p["benchmark"]
        if benchmark not in returns:raise ValueError("Benchmark symbol missing from panel")
        reference=returns[benchmark];variance=reference.rolling(n).var(ddof=1)
        beta=returns.apply(lambda x:x.rolling(n).cov(reference)/variance.replace(0,np.nan))
        correlation=returns.apply(lambda x:x.rolling(n).corr(reference))
        tables.append(table("risk-exposures",long_values({"beta":beta,"correlation":correlation},selected)))
        symbols=selected.columns[selected.iloc[-1]].tolist()
        if len(symbols)>64:raise ValueError("Correlation matrix supports at most 64 current members per run")
        sample=returns.iloc[-n:];matrix=[]
        for a in symbols:
            for z in symbols:
                pair=sample[[a,z]].dropna() if a!=z else sample[[a]].dropna()
                count=len(pair);cov=corr=np.nan
                if count==n:
                    if a==z:
                        cov=pair.iloc[:,0].var(ddof=1);corr=1. if cov>0 else np.nan
                    else:
                        cov=pair.iloc[:,0].cov(pair.iloc[:,1]);corr=pair.iloc[:,0].corr(pair.iloc[:,1])
                matrix.append([str(close.index[-1]),a,z,count,cov,corr])
        tables.append(table("latest-correlation-matrix",pd.DataFrame(matrix,columns=["time","symbolA","symbolB","observations","covariance","correlation"])))
        warnings.append("简单收益按同一决策网格对齐；Beta=样本协方差/基准样本方差，窗口须有n组完整收益。末次相关矩阵保留实际样本数。")
    elif name in ("cross-sectional-momentum","cross-sectional-reversal"):
        skip=int(p.get("skip",0))
        momentum=close.shift(skip)/close.shift(n+skip)-1
        score=(-momentum if name.endswith("reversal") else momentum).where(selected)
        rank=score.rank(axis=1,pct=True,method="average")
        std=score.std(axis=1,ddof=0).replace(0,np.nan)
        zscore=score.sub(score.mean(axis=1),axis=0).div(std,axis=0)
        tables=[table("factor-scores",long_values({"pastReturn":momentum,"score":score,"rankPercentile":rank,"zscore":zscore},selected))]
        warnings.append("信号只比较当时成分股；动量=C[t-skip]/C[t-skip-period]-1，反转为其负值；百分位同值取平均，Z分数使用截面总体标准差。")
    elif name=="industry-relative-strength":
        known_industry(b);benchmark=p["benchmark"]
        if benchmark not in close:raise ValueError("Benchmark symbol missing")
        momentum=close/close.shift(n)-1
        flat=long_values({"momentum":momentum},selected).merge(b[["time","symbol","industry"]],on=["time","symbol"],validate="one_to_one")
        grouped=flat.groupby(["time","industry"],sort=True).momentum.agg(["mean","count"]).rename(columns={"mean":"industryMeanMomentum","count":"industryCoverage"}).reset_index()
        flat=flat.merge(grouped,on=["time","industry"],validate="many_to_one")
        flat["benchmarkMomentum"]=flat.time.map(momentum[benchmark])
        flat["relativeToBenchmark"]=(1+flat.momentum)/(1+flat.benchmarkMomentum)-1
        flat["relativeToIndustry"]=(1+flat.momentum)/(1+flat.industryMeanMomentum)-1
        tables=[table("relative-strength",flat),table("industry-momentum",grouped)]
        warnings.append("行业动量为当时分类及成分的等权区间收益均值，不是可交易历史行业指数；相对强度=(1+个股收益)/(1+基准或行业均值)-1。")
    elif name=="equal-cap-weight-indices":
        cap=wide(b.assign(marketcap=known_numeric(b,"marketcap",positive=True)),"marketcap")
        prior=selected.shift(1,fill_value=False);prior_cap=cap.shift().where(prior)
        count=prior.sum(axis=1);available=(returns.notna()&prior).sum(axis=1)
        full=count.gt(0)&count.eq(available)&prior_cap.notna().sum(axis=1).eq(count)
        ew=returns.where(prior).mean(axis=1).where(full)
        vw=(returns*prior_cap).sum(axis=1)/prior_cap.sum(axis=1)
        vw=vw.where(full)
        # Once a held constituent is missing, no later wealth value is inferred.
        eq=pd.Series(np.nan,index=close.index);value=eq.copy();eq.iloc[0]=value.iloc[0]=1.
        for i in range(1,len(close)):
            eq.iloc[i]=eq.iloc[i-1]*(1+ew.iloc[i]);value.iloc[i]=value.iloc[i-1]*(1+vw.iloc[i])
        out=pd.DataFrame({"previousMembers":count,"coveredPreviousMembers":available,"equalWeightReturn":ew,"capWeightReturn":vw,
            "equalWeightIndex":eq,"capWeightIndex":value,"relativeWealth":eq/value-1})
        tables=[table("indicators",out.reset_index())]
        warnings.append("每根按上一决策已知的成分及市值设权；本根收益后再平衡。指数起点1，未含费用；缺失一只已持有成分后净值留空，禁止幸存者替代。")
    elif name=="cross-sectional-dispersion":
        horizon=(close/close.shift(n)-1).where(selected)
        q25=horizon.quantile(.25,axis=1);q75=horizon.quantile(.75,axis=1)
        out=pd.DataFrame({"coverage":horizon.count(axis=1),"mean":horizon.mean(axis=1),"median":horizon.median(axis=1),
            "populationStd":horizon.std(axis=1,ddof=0),"interquartileRange":q75-q25})
        out.loc[out.coverage<2,["populationStd","interquartileRange"]]=np.nan
        tables=[table("indicators",out.reset_index())]
        warnings.append("截面离散度基于当时成分的过去n根简单收益；不是时间序列波动率。有效成分少于2只时离散度留空。")
    elif name=="free-float-turnover":
        shares=known_numeric(b,"freefloatshares",positive=True)
        out=b.loc[b.member.eq(1),["time","symbol","volume"]].copy()
        out["freeFloatShares"]=shares.loc[out.index];out["turnoverPct"]=100*out.volume/out.freeFloatShares
        tables=[table("turnover",out)]
        warnings.append("换手率=该根实际股数成交量/当时已知流通股数；不混用总股本和自由流通口径。股数变更时间由输入显式提供。")
    elif name=="actual-participation":
        executed=known_numeric(b,"executedshares",nonnegative=True)
        if ((b.volume==0)&(executed!=0)).any():raise ValueError("Execution volume with zero market volume")
        out=b.loc[b.member.eq(1),["time","symbol","volume"]].copy();out["executedShares"]=executed.loc[out.index]
        out["participationPct"]=100*out.executedShares/out.volume.replace(0,np.nan)
        tables=[table("participation",out)]
        warnings.append("参与率=同一根内实际成交股数/市场成交股数；只接受显式成交数据，不把委托量当成交量。大于100%保留以供检查统计范围或重复计数。")
    else:raise ValueError("Unknown panel operation")
    return {"kind":"indicator","engineVersion":"webstock-panel-v1","formulaVersion":"webstock-panel-"+name+"-v1",
            "tables":tables,"warnings":warnings,"inputSemantics":{"schema":"webstock.market-panel.csv.v1",
            "decisionCount":int(b.time.nunique()),"securityCount":int(b.symbol.nunique()),"currency":b.currency.iloc[0],
            "priceBasis":b.pricebasis.iloc[0],"datasetKind":b.datasetkind.iloc[0] if "datasetkind" in b and b.datasetkind.nunique()==1 else "unspecified",
            "membership":"explicit per-decision rows/count/known-at; provider completeness not independently certified"}}
