"""Versioned reported-fundamental features; no current-data historical fill."""
import numpy as np
import pandas as pd
from panel_contract import known_numeric, timestamps, wide
from worker import table


OPERATIONS={"reported-valuation","reported-profitability","reported-quality","investment-accrual",
            "low-risk-ranks","size-ranks","reported-dividends","piotroski-fscore",
            "earnings-surprise","forecast-revision","share-capital-events"}


def date_column(b,key):
    if key not in b or not b[key].astype(str).str.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}").all():
        raise ValueError("Required ISO date column: "+key)
    return pd.to_datetime(b[key],format="%Y-%m-%d",utc=True,errors="raise")


def periods(b,maximum):
    values=[]
    for lag in range(maximum+1):
        x=date_column(b,"fiscalend_y"+str(lag))
        if (x+pd.Timedelta(days=1)>b.time).any():raise ValueError("Future reported fiscal period")
        if values and not (values[-1]-x).dt.days.between(300,430).all():
            raise ValueError("Annual fiscal periods must be consecutive and comparable (300–430 days)")
        values.append(x)
    return values


def annual(b,key,lag,dates,positive=False,nonnegative=False):
    field=key+"_y"+str(lag)
    x=known_numeric(b,field,positive=positive,nonnegative=nonnegative)
    if (timestamps(b[field+"_knownat"],field+"_knownat")<dates[lag]+pd.Timedelta(days=1)).any():
        raise ValueError("A reported annual fact cannot be available before its period ends: "+field)
    return x


def positive_ratio(a,denominator):
    return a/denominator.where(denominator>0)


def rank(b,value):
    return value.where(b.member.eq(1)).groupby(b.time).rank(pct=True,method="average")


def calculate(name,b,p):
    out=b[["time","symbol"]].copy()
    warnings=["财务/事件字段及披露时间来自输入声明；检查可用时间不等于认证数据提供方的历史版本。",
              "每个比率保留明确口径，缺数据直接失败；负利润保留在收益率中，不强行生成有意义的PE。"]
    if "datasetkind" in b and b.datasetkind.eq("synthetic-test").any():warnings.insert(0,"合成测试数据，仅核对计算和界面，不是投资收益证据。")
    if name in ("reported-valuation","reported-profitability","reported-quality","investment-accrual","reported-dividends","piotroski-fscore"):
        if "financialunit" not in b or not b.financialunit.eq("currency-unit").all():
            raise ValueError("Financial monetary fields must declare financialunit=currency-unit, matching panel currency")
        depth=5 if name=="reported-quality" else 2 if name=="piotroski-fscore" else 1 if name in ("reported-profitability","investment-accrual") else 0
        dates=periods(b,depth)
        fact=lambda key,lag=0,**kw:annual(b,key,lag,dates,**kw)
        out["reportEnd"]=b.fiscalend_y0;out["reportAgeDays"]=(b.time-dates[0]).dt.days
        warnings.append("使用声明的完整年度财报，不冒充自动滚动TTM；金额须与面板币种一致且已换为基本货币单位，年报陈旧程度随结果显示。")
    if name=="reported-valuation":
        cap=known_numeric(b,"marketcap",positive=True)
        income=fact("netincome");book=fact("bookequity");cashflow=fact("cfo")
        ev=cap+fact("interestdebt",nonnegative=True)+fact("preferredstock",nonnegative=True)+fact("minorityinterest",nonnegative=True)-fact("cash",nonnegative=True)
        ebitda=fact("ebitda")
        out["earningsYield"]=income/cap;out["bookYield"]=book/cap;out["cashflowYield"]=cashflow/cap
        out["priceEarnings"]=positive_ratio(cap,income);out["priceBook"]=positive_ratio(cap,book)
        out["enterpriseValue"]=ev;out["evEbitda"]=positive_ratio(ev.where(ev>0),ebitda)
        out["positiveEarnings"]=(income>0).astype(int);out["positiveBookEquity"]=(book>0).astype(int)
        warnings.append("EV=市值+有息债务+优先股+少数股东权益-现金；EV/EBITDA仅在两者为正时显示。各资产负债项须采用一致合并范围。")
    elif name=="reported-profitability":
        assets0=fact("assets",positive=True);assets1=fact("assets",1,positive=True)
        equity0=fact("bookequity");equity1=fact("bookequity",1);income=fact("netincome")
        sales=fact("sales",nonnegative=True);gross=fact("grossprofit");operating=fact("operatingprofit")
        out["roaAverageAssets"]=income/((assets0+assets1)/2)
        out["roeAverageEquity"]=positive_ratio(income,(equity0+equity1)/2)
        out["netMargin"]=positive_ratio(income,sales);out["grossMargin"]=positive_ratio(gross,sales)
        out["operatingMargin"]=positive_ratio(operating,sales)
        warnings.append("ROA/ROE分母使用本年初末平均资产/权益；权益非正时ROE留空。行业差异和杠杆对ROE的影响没有被自动消除。")
    elif name=="reported-quality":
        assets=[fact("assets",j,positive=True) for j in range(6)]
        roa=pd.concat([fact("netincome",j)/assets[j+1] for j in range(5)],axis=1)
        stability=roa.std(axis=1,ddof=0);leverage=fact("liabilities",nonnegative=True)/assets[0]
        out["roaBeginningAssets"]=roa.iloc[:,0];out["roaFiveYearStd"]=stability;out["liabilitiesToAssets"]=leverage
        out["profitabilityRank"]=rank(b,roa.iloc[:,0]);out["stabilityRank"]=rank(b,-stability);out["lowLeverageRank"]=rank(b,-leverage)
        out["qualityScore"]=(out.profitabilityRank+out.stabilityRank+out.lowLeverageRank)/3
        warnings.append("WebStock质量v1：期初资产ROA、过去5个完整年度ROA总体标准差的负值、负债/资产的负值，分别当期截面排名后等权平均。不是QMJ或MSCI Quality复刻。")
    elif name=="investment-accrual":
        now=fact("assets",positive=True);previous=fact("assets",1,positive=True)
        income=fact("netincome");cashflow=fact("cfo");capex=fact("capex",nonnegative=True)
        out["assetGrowth"]=now/previous-1;out["capexToBeginningAssets"]=capex/previous
        out["cashflowAccrualToAverageAssets"]=(income-cashflow)/((now+previous)/2)
        out["cashConversionPositiveEarnings"]=positive_ratio(cashflow,income)
        warnings.append("应计采用利润减经营现金流、除平均资产的现金流表口径；不冒充资产负债表法。资本开支为现金流出正数，资产增长不自动剔除并购。")
    elif name=="reported-dividends":
        cap=known_numeric(b,"marketcap",positive=True);paid=fact("cashdividends_paid",nonnegative=True)
        income=fact("netincome");cashflow=fact("cfo")
        out["reportedAnnualDividendYield"]=paid/cap
        out["earningsPayout"]=positive_ratio(paid,income);out["cashflowPayout"]=positive_ratio(paid,cashflow)
        warnings.append("分子仅为已实际支付的年度普通股现金股利，非预案或预测；支付率分母非正时留空。")
    elif name=="piotroski-fscore":
        assets=[fact("assets",j,positive=True) for j in range(3)]
        income=[fact("income_before_extra",j) for j in range(2)]
        cfo=fact("cfo")
        roa=[income[j]/assets[j+1] for j in range(2)]
        lev=[fact("longtermdebt_includingcurrent",j,nonnegative=True)/((assets[j]+assets[j+1])/2) for j in range(2)]
        liquidity=[fact("currentassets",j,nonnegative=True)/fact("currentliabilities",j,positive=True) for j in range(2)]
        sales=[fact("sales",j,positive=True) for j in range(2)]
        margin=[fact("grossprofit",j)/sales[j] for j in range(2)]
        issued=fact("equity_issued")
        if not issued.isin([0.,1.]).all():raise ValueError("equity_issued_y0 must explicitly be 0 or 1")
        basis=p["turnoverAssets"]
        if basis not in ("beginning","average"):raise ValueError("Unknown turnover asset basis")
        turnover=[sales[j]/(assets[j+1] if basis=="beginning" else (assets[j]+assets[j+1])/2) for j in range(2)]
        signals={"positiveRoa":roa[0]>0,"positiveCfo":cfo>0,"improvedRoa":roa[0]>roa[1],
            "cashExceedsIncome":cfo>income[0],"lowerLeverage":lev[0]<lev[1],"improvedLiquidity":liquidity[0]>liquidity[1],
            "noEquityIssue":issued==0,"improvedMargin":margin[0]>margin[1],"improvedTurnover":turnover[0]>turnover[1]}
        for key,value in signals.items():out[key]=value.astype(int)
        out["fscore"]=sum(out[key] for key in signals)
        out["roaCurrent"]=roa[0];out["roaPrevious"]=roa[1];out["leverageCurrent"]=lev[0];out["leveragePrevious"]=lev[1]
        out["turnoverCurrent"]=turnover[0];out["turnoverPrevious"]=turnover[1]
        warnings.append("F-score九项二元信号等权求和；盈利、现金流和改善均严格比较，不改善不加分；发行普通股使用显式事件标记，不以净股数变化代替。")
        warnings.append("ROA用期初资产，长期债含一年内到期部分并除平均资产；原文正文与表脚注的周转率资产口径存在差异，本次参数明确选用"+basis+"。")
    elif name=="size-ranks":
        cap=known_numeric(b,"marketcap",positive=True);floating=known_numeric(b,"freefloatmarketcap",positive=True)
        if (floating>cap).any():raise ValueError("Free-float market cap cannot exceed total market cap")
        out["marketCap"]=cap;out["freeFloatMarketCap"]=floating;out["logMarketCap"]=np.log(cap)
        out["marketCapPercentile"]=rank(b,cap);out["freeFloatCapPercentile"]=rank(b,floating)
        warnings.append("市值均须来自同一时点的显式金额；不以复权价乘未复权股数估算。分位越大代表规模越大，不代表优先买入。")
    elif name=="low-risk-ranks":
        n=int(p["period"]);prices=wide(b,"close");returns=prices.pct_change(fill_method=None)
        if p["benchmark"] not in returns:raise ValueError("Missing benchmark")
        benchmark=returns[p["benchmark"]];variance=benchmark.rolling(n).var(ddof=1)
        volatility=returns.rolling(n).std(ddof=1)*np.sqrt(p["annualBars"])
        beta=returns.apply(lambda x:x.rolling(n).cov(benchmark)/variance.replace(0,np.nan))
        index=pd.MultiIndex.from_frame(b[["time","symbol"]])
        out["annualVolatility"]=volatility.stack(future_stack=True).reindex(index).to_numpy()
        out["beta"]=beta.stack(future_stack=True).reindex(index).to_numpy()
        out["lowVolatilityRank"]=rank(b,-out.annualVolatility);out["lowBetaRank"]=rank(b,-out.beta)
        out["lowAbsoluteBetaRank"]=rank(b,-out.beta.abs())
        warnings.append("低波动、低有符号Beta、低绝对Beta分别排名；负Beta很低不意味着绝对风险很小，未复制任何多空杠杆组合。")
    elif name=="earnings-surprise":
        period=date_column(b,"earningsperiod")
        actual=known_numeric(b,"eps_actual");consensus=known_numeric(b,"eps_consensus")
        dispersion=known_numeric(b,"eps_consensus_std",nonnegative=True)
        actual_time=timestamps(b.eps_actual_knownat,"eps_actual_knownat")
        forecast_time=timestamps(b.eps_consensus_knownat,"eps_consensus_knownat")
        spread_time=timestamps(b.eps_consensus_std_knownat,"eps_consensus_std_knownat")
        if ((period+pd.Timedelta(days=1)>actual_time)|(forecast_time>=actual_time)|(spread_time>=actual_time)).any():
            raise ValueError("Earnings surprise requires a genuine pre-announcement consensus snapshot")
        out["earningsPeriod"]=b.earningsperiod;out["epsDifference"]=actual-consensus
        out["surpriseRelativeToAbsoluteConsensus"]=(actual-consensus)/consensus.abs().replace(0,np.nan)
        out["surpriseInForecastStd"]=(actual-consensus)/dispersion.replace(0,np.nan)
        warnings.append("同一财报期的实际EPS减披露前一致预期；标准化分母是事前预测分歧，不冒充季节性盈利变动SUE。EPS须采用同一股数及会计口径。")
    elif name=="forecast-revision":
        date_column(b,"forecastperiod")
        old=known_numeric(b,"forecast_old");new=known_numeric(b,"forecast_new")
        if (timestamps(b.forecast_old_knownat,"forecast_old_knownat")>=timestamps(b.forecast_new_knownat,"forecast_new_knownat")).any():
            raise ValueError("Forecast revision requires strictly ordered snapshots")
        out["forecastPeriod"]=b.forecastperiod;out["revision"]=new-old
        out["revisionRelativeToAbsoluteOld"]=(new-old)/old.abs().replace(0,np.nan)
        warnings.append("输入必须为同一预测期、同一口径的两次一致预期快照；未将更新后的预测回用于旧时点，分析师覆盖变化仍需来源审计。")
    elif name=="share-capital-events":
        begin=known_numeric(b,"shares_begin",positive=True);end=known_numeric(b,"shares_end",positive=True)
        split=known_numeric(b,"splitfactor",positive=True)
        issued=known_numeric(b,"shares_issued",nonnegative=True);repurchased=known_numeric(b,"shares_repurchased",nonnegative=True)
        announced=known_numeric(b,"repurchase_announced",nonnegative=True);other=known_numeric(b,"other_share_changes")
        start=date_column(b,"capitalperiod_start");finish=date_column(b,"capitalperiod_end")
        if ((start>=finish)|(finish+pd.Timedelta(days=1)>b.time)).any():raise ValueError("Invalid completed capital event interval")
        for key in ("shares_end","splitfactor","shares_issued","shares_repurchased","other_share_changes"):
            if (timestamps(b[key+"_knownat"],key+"_knownat")<finish+pd.Timedelta(days=1)).any():raise ValueError("Completed-period capital totals unavailable before interval end")
        expected=begin*split+issued-repurchased+other
        out["splitAdjustedShareChange"]=end/(begin*split)-1;out["netIssuedShares"]=issued-repurchased
        out["shareReconciliationResidual"]=end-expected;out["repurchaseCompletion"]=repurchased/announced.replace(0,np.nan)
        warnings.append("初期股数先按拆并股比例转换，发行/实际回购/其他变化均须换为期末可比股数；保留对账差额，不把股数净变化全部解释为增发或回购。预案与实际执行分别输入。")
    else:raise ValueError("Unknown fundamental operation")
    out=out.loc[b.member.eq(1)]
    return {"kind":"indicator","engineVersion":"webstock-fundamental-v1","formulaVersion":"webstock-panel-"+name+"-v1",
            "tables":[table("fundamental-features",out)],"warnings":warnings,
            "inputSemantics":{"schema":"webstock.market-panel.csv.v1","currency":b.currency.iloc[0],"decisionCount":int(b.time.nunique()),
                "securityCount":int(b.symbol.nunique()),"pointInTimeStatus":"input availability claims checked; provider provenance not independently certified"}}
