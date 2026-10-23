"""Portfolio-weight and causal structure views using the original engines."""
import importlib.metadata
import pandas as pd
from worker import table


def calculate(engine, frame, p):
    if engine=="czsc":
        import czsc
        data=frame.rename(columns={"time":"dt","volume":"vol"}).copy()
        data["dt"]=pd.to_datetime(data.dt);data["symbol"]="INPUT"
        if "amount" not in data:data["amount"]=0.
        raw=czsc.format_standard_kline(data,freq=czsc.Freq.D)
        analysis=czsc.CZSC([raw[0]])
        rows=[]
        for i,bar in enumerate(raw):
            if i:analysis.update(bar)
            last=analysis.bi_list[-1] if analysis.bi_list else None
            rows.append({"time":frame.time.iloc[i],"lastBiHigh":last.high if last else None,
                "lastBiLow":last.low if last else None,"direction":str(last.direction) if last else None,
                "structuralStart":str(last.sdt) if last else None,"structuralEnd":str(last.edt) if last else None,
                "observedAt":frame.time.iloc[i],"availableBiCount":len(analysis.bi_list)})
        return {"kind":"indicator","engineVersion":importlib.metadata.version("czsc"),
            "formulaVersion":"czsc-daily-online-last-bi-v1","tables":[table("indicators",pd.DataFrame(rows))],
            "warnings":["逐根处理并保存当时观察到的笔，末笔仍可能延伸或撤销；结构端点时间不是已知时间。",
                        "该输出没有把最终图形回填到早期，也没有定义缠论买卖策略。缺少成交额时只读取价格结构字段。"]}
    if p["fast"]>=p["slow"]:raise ValueError("Need fast < slow")
    index=pd.DatetimeIndex(pd.to_datetime(frame.time))
    close=pd.Series(frame.close.to_numpy(),index=index)
    # Known at preceding bar, applied on this bar's close; avoids same-close signal/fill.
    weights=((close.rolling(p["fast"]).mean()>close.rolling(p["slow"]).mean()).astype(float)*p["weight"]).shift(1,fill_value=0.)
    warnings=["权重研究，不是统一的逐笔订单撮合；未模拟A股交易制度、滑点或公司行动。"]
    policy={"signal":"preceding closed bar SMA state","rebalance":"current close","targetWeight":p["weight"],"feeRate":p["feeBps"]/10000}
    if engine=="bt":
        import bt
        prices=pd.DataFrame({"INPUT":close});target=pd.DataFrame({"INPUT":weights})
        strategy=bt.Strategy("WebStockFrozenInput",[bt.algos.RunDaily(run_on_last_date=True),bt.algos.WeighTarget(target),bt.algos.Rebalance()])
        backtest=bt.Backtest(strategy,prices,initial_capital=p["capital"],commissions=lambda q,price:abs(q)*price*p["feeBps"]/10000,progress_bar=False)
        result=bt.run(backtest)
        equity=pd.DataFrame({"time":frame.time,"equity":backtest.strategy.values.reindex(index).to_numpy()})
        transactions=result.get_transactions().reset_index()
        tables=[table("equity",equity),table("rebalance-transactions",transactions)]
        warnings.append("每天按目标权重再平衡，整数股；同一均线状态也可能因为价格变动产生再平衡交易。")
    elif engine=="wbt":
        import wbt
        data=pd.DataFrame({"dt":index,"symbol":"INPUT","price":close.to_numpy(),"weight":weights.to_numpy()})
        run=wbt.WeightBacktest(data,fee_rate=p["feeBps"]/10000,n_jobs=1)
        returns=run.daily_return
        series=pd.DataFrame({"time":returns.date.astype(str),"simpleReturnIndex":1+returns.total.cumsum(),"netDailyReturn":returns.total})
        tables=[table("weight-index",series),table("daily-attribution",run.dailys)]
        warnings.append("simpleReturnIndex为1加累计单利收益，对齐此版本WBT单利口径，不冒充现金账户权益或复利净值。")
        policy["accounting"]="WBT daily attribution; simple cumulative return index"
    else:raise ValueError("Unknown research engine")
    return {"kind":"backtest","engineVersion":importlib.metadata.version(engine),"formulaVersion":engine+"-lagged-sma-weight-v1",
            "tables":tables,"warnings":warnings,"executionPolicy":policy}
