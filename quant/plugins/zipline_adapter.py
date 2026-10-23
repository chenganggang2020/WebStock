"""Zipline daily research on a frozen single-security CSV and explicit calendar."""
from datetime import time
import importlib.metadata
import os
from pathlib import Path
import tempfile
import numpy as np
import pandas as pd
from worker import table


def calculate(frame,p):
    if p["fast"]>=p["slow"]:raise ValueError("fast must be less than slow")
    dates=pd.DatetimeIndex(pd.to_datetime(frame.time)).normalize().astype("datetime64[ns]")
    if dates.duplicated().any():raise ValueError("Zipline daily adapter requires one completed bar per day")
    with tempfile.TemporaryDirectory(prefix="webstock-zipline-",ignore_cleanup_errors=True) as temporary:
        root=Path(temporary);os.environ["ZIPLINE_ROOT"]=str(root/"bundle")
        from exchange_calendars import ExchangeCalendar,register_calendar_type,register_calendar_alias,get_calendar
        from zipline import run_algorithm
        from zipline.api import order_target,symbol,set_commission,set_slippage,get_open_orders
        from zipline.data.bundles import register,ingest
        from zipline.data.bundles.csvdir import csvdir_equities
        from zipline.finance.slippage import FixedSlippage
        from zipline.finance.commission import PerDollar
        missing=pd.date_range(dates[0]-pd.Timedelta(days=7),dates[-1]+pd.Timedelta(days=7)).difference(dates)
        class FrozenCalendar(ExchangeCalendar):
            name="WSFROZEN"
            tz="UTC"
            open_times=((None,time(0,0)),)
            close_times=((None,time(23,59)),)
            weekmask="1111111"
            def __init__(self,start=None,end=None,side="right"):
                super().__init__(start=dates[0] if start is None else start,end=dates[-1] if end is None else end,side=side)
            @property
            def adhoc_holidays(self):return missing
        register_calendar_type("WSFROZEN",FrozenCalendar,force=True)
        # csvdir names its exchange CSVDIR. Explicitly bind it to this same
        # calendar instead of the import-time NYSE alias.
        register_calendar_alias("CSVDIR","WSFROZEN",force=True)
        calendar=get_calendar("WSFROZEN",side="right")
        csvroot=root/"csv/daily";csvroot.mkdir(parents=True)
        prices=frame[["open","high","low","close","volume"]].copy();prices.index=dates;prices.index.name="date"
        prices["dividend"]=0.;prices["split"]=1.
        prices.to_csv(csvroot/"INPUT.csv")
        register("webstock-frozen",csvdir_equities(["daily"],str(csvroot.parent)),calendar_name="WSFROZEN",
            start_session=dates[0],end_session=dates[-1],minutes_per_day=1439)
        ingest("webstock-frozen",show_progress=False)
        fast=frame.close.rolling(p["fast"]).mean();slow=frame.close.rolling(p["slow"]).mean()
        signals=((fast>slow)&(fast.shift()<=slow.shift())).astype(int)-((fast<slow)&(fast.shift()>=slow.shift())).astype(int)
        bydate=dict(zip(dates,signals,strict=True))
        def initialize(context):
            context.asset=symbol("INPUT")
            set_commission(us_equities=PerDollar(cost=p["feeBps"]/10000))
            set_slippage(us_equities=FixedSlippage(spread=0.))
        def handle_data(context,data):
            signal=bydate[pd.Timestamp(context.get_datetime()).tz_localize(None).normalize()]
            if get_open_orders(context.asset):return
            if signal>0:order_target(context.asset,p["quantity"])
            elif signal<0:order_target(context.asset,0)
        result=run_algorithm(start=dates[0],end=dates[-1],initialize=initialize,handle_data=handle_data,
            capital_base=p["capital"],data_frequency="daily",bundle="webstock-frozen",trading_calendar=calendar,
            benchmark_returns=pd.Series(0.,index=dates))
        equity=result[["portfolio_value","ending_cash","positions","returns"]].copy()
        equity["position"]=equity.positions.map(lambda a:sum(x["amount"] for x in a))
        equity=equity.drop(columns="positions").rename(columns={"portfolio_value":"equity","ending_cash":"cash"})
        equity.insert(0,"time",result.index.astype(str))
        fills=pd.DataFrame([dict(time=str(t.get("dt",date)),orderId=t["order_id"],quantity=t["amount"],
            price=t["price"],commission=t.get("commission")) for date,row in result.iterrows() for t in row.transactions],
            columns=["time","orderId","quantity","price","commission"])
        orders=pd.DataFrame([dict(time=str(date),orderId=t["id"],quantity=t["amount"],filledQuantity=t["filled"],
            status=str(t["status"]),commission=t.get("commission")) for date,row in result.iterrows() for t in row.orders],
            columns=["time","orderId","quantity","filledQuantity","status","commission"])
        return {"kind":"backtest","engineVersion":importlib.metadata.version("zipline-reloaded"),
            "formulaVersion":"zipline-sma-cross-next-daily-bar-v1","tables":[table("equity",equity),table("fills",fills),table("orders",orders)],
            "executionPolicy":{"signal":"closed-bar SMA crossover","execution":"next daily close, original Zipline daily matching",
                "commissionRate":p["feeBps"]/10000,"slippage":0,"calendar":"input dates only","benchmark":"zero return technical baseline"},
            "warnings":["原版日线撮合使用下一交易根的收盘参考价，不是下一根开盘；不同引擎不能按收益直接排名。",
                "只把输入日期注册为交易日，不假造NYSE或中国交易所日历；没有公司行动输入，拆股与股息均未模拟。",
                "原版日线存储对价格有精度转换；交易表的commission可能空，实际收费见订单表与账户现金。",
                "未实现A股历史T+1、涨跌停或真实税费；零收益基准仅用于离线运行，不是市场基准。"]}
