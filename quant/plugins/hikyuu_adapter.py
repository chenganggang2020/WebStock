"""Hikyuu's own event simulation on a temporary stock, with no market download."""
import numpy as np
import pandas as pd
from decimal import Decimal,ROUND_HALF_UP
from worker import table


def calculate(frame, parameters):
    import hikyuu as h
    fast, slow = parameters["fast"], parameters["slow"]
    if fast >= slow:
        raise ValueError("快速均线周期必须小于慢速均线")
    if len(frame) < slow + 2:
        raise ValueError("数据不足以完成预热")
    if "amount" not in frame:raise ValueError('Hikyuu requires actual amount; its execution engine checks zero amount as nontradable')
    amount=pd.to_numeric(frame.amount,errors='raise').astype(float)
    if not np.isfinite(amount).all() or (amount<0).any() or ((amount==0)!=(frame.volume==0)).any():
        raise ValueError('Hikyuu amount and volume must be finite nonnegative with consistent zero trading state')
    amount_warning = "成交额原样传入；零成交额/量及高低价相同会触发原引擎交易限制，不能用占位零代替缺失成交额。"
    dates=pd.to_datetime(frame.time)
    if dates.dt.tz is not None or not dates.eq(dates.dt.normalize()).all():
        raise ValueError('Hikyuu daily adapter requires timezone-free calendar dates at midnight')
    # Released Hikyuu's dataframe bridge interprets the integer storage as ns.
    # pandas can infer us; pin the storage unit and verify the engine roundtrip.
    dates=dates.astype('datetime64[ns]')
    bars = pd.DataFrame({"datetime": dates,
                         **{x: frame[x] for x in ("open","high","low","close","volume")},
                         "amount": amount})
    stock = h.Stock("TMP", "000001", "WebStock frozen input")
    stock.set_kdata_from_df(bars)
    k = stock.get_kdata(h.Query(0))
    if len(k) != len(frame):
        raise ValueError("Hikyuu bar count differs from frozen input")
    engine_dates=pd.Series(pd.to_datetime([str(x.datetime) for x in k])).astype('datetime64[ns]')
    if not np.array_equal(engine_dates.to_numpy(),dates.to_numpy()):
        raise ValueError('Hikyuu datetime roundtrip differs from input')
    tm = h.crtTM(k[0].datetime, parameters["capital"], h.TC_Zero())
    system = h.SYS_Simple(tm=tm, sg=h.SG_Cross(h.MA(h.CLOSE(),fast),h.MA(h.CLOSE(),slow)),
                          mm=h.MM_FixedCount(parameters["quantity"]))
    system.set_param("buy_delay", True)
    system.set_param("sell_delay", True)
    system.run(k)
    equity = pd.DataFrame({"time": frame.time, "equity": list(tm.get_funds_curve(k.get_datetime_list()))})
    trades = tm.get_trade_list().to_df()
    # Independently reconcile the engine's event ledger to every daily close.
    cents=lambda x:float(Decimal(str(x)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
    cash=cents(parameters['capital']);position=0.;events={};audit=[];calendar=set(dates)
    if not {'datetime','business','number','realPrice','cash','cost_total'}<=set(trades):
        raise ValueError('Hikyuu trade ledger fields changed')
    for event in trades.to_dict('records'):
        stamp=pd.Timestamp(event['datetime'])
        if stamp not in calendar:raise ValueError('Hikyuu account event outside input calendar')
        events.setdefault(stamp,[]).append(event)
    for date,close in zip(dates,frame.close):
        for event in events.get(date,[]):
            kind=event['business'];quantity=float(event['number']);price=float(event['realPrice']);cost=float(event['cost_total'])
            if kind=='INIT':
                if date!=dates.iloc[0] or abs(float(event['cash'])-parameters['capital'])>.011:raise ValueError('Invalid Hikyuu initial capital')
            elif kind in ('BUY','SELL'):
                direction=1 if kind=='BUY' else -1;cash=cents(cash-direction*cents(quantity*price)-cost);position+=direction*quantity
                if cash<-.011 or position<0 or abs(cash-float(event['cash']))>.011:raise ValueError('Hikyuu cash/position ledger mismatch')
            else:raise ValueError('Unsupported Hikyuu account event: '+str(kind))
        audit.append((cash,position,cents(cash+cents(position*close))))
    values=np.asarray(audit)
    if not np.isfinite(values).all() or not np.allclose(equity.equity,values[:,2],atol=.011,rtol=0):
        bad=np.flatnonzero(np.abs(equity.equity.to_numpy()-values[:,2])>.011)
        raise ValueError('Hikyuu daily equity differs from independent close mark ledger: '+str([(str(dates.iloc[i]),float(equity.equity.iloc[i]),float(values[i,2])) for i in bad[:5]]))
    equity['cash']=values[:,0];equity['position']=values[:,1];equity['close']=frame.close.to_numpy();equity['ledgerEquity']=values[:,2]
    return {"kind": "backtest", "engineVersion": h.__version__,
            "formulaVersion": "hikyuu-sma-cross-next-open-daily-ns-v2",
            "executionPolicy": {"signal": "closed bar", "execution": "next bar open",
                                "positionSize": parameters["quantity"], "commission": 0,
                                "slippage": 0, "marketRules": "generic temporary stock", "timeBasis":"timezone-free daily calendar; nanosecond bridge and engine roundtrip checked",
                                "equityReconciliation":"original engine curve checked against event cash/holdings marked at each input close; cash/notional/market value rounded to cents half-up; tolerance 0.011"},
            "tables": [table("equity", equity), table("trades", trades)],
            "warnings": ["引擎接入验收基线：零费用、零滑点，未模拟A股涨跌停、T+1或公司行动。",
                         "不可作为收益有效性结论。账户事件表包含初始入金，并非每行都是成交。", amount_warning]}
