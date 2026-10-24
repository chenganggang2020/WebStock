"""Independent engine adapters. Each records its own execution semantics.

Adapters share a frozen OHLCV input, not an assertion of identical fills.
"""
import importlib.metadata
import pandas as pd
from worker import table


def calculate(engine, frame, p):
    if p["fast"] >= p["slow"] or len(frame) <= p["slow"]+2:
        raise ValueError("Need fast < slow and sufficient warmup bars")
    data=frame.set_index(pd.DatetimeIndex(pd.to_datetime(frame.time)))[["open","high","low","close","volume"]]
    fee=p["feeBps"]/10000
    warnings=["通用历史研究适配器，未模拟A股T+1、涨跌停、历史税率和公司行动；不可直接按不同引擎收益排序。"]
    policy={"signal":"closed-bar SMA crossover","execution":"next open","commissionRate":fee,
            "slippage":0,"quantity":p["quantity"],"initialCapital":p["capital"],"marketRules":"generic"}
    if engine=="backtesting-py":
        from backtesting import Backtest,Strategy
        from backtesting.lib import crossover
        class Cross(Strategy):
            def init(self):
                self.fast=self.I(lambda a:pd.Series(a).rolling(p["fast"]).mean(),self.data.Close,name="SMA_fast")
                self.slow=self.I(lambda a:pd.Series(a).rolling(p["slow"]).mean(),self.data.Close,name="SMA_slow")
            def next(self):
                if not self.position and crossover(self.fast,self.slow):self.buy(size=p["quantity"])
                elif self.position and crossover(self.slow,self.fast):self.position.close()
        renamed=data.rename(columns=str.title)
        result=Backtest(renamed,Cross,cash=p["capital"],commission=fee,trade_on_close=False,
                        hedging=False,exclusive_orders=True,finalize_trades=False).run()
        equity=result["_equity_curve"].reset_index().rename(columns={data.index.name or "index":"time","Equity":"equity"})
        # reset_index uses the original input index name (time) on current pandas.
        equity.rename(columns={equity.columns[0]:"time"},inplace=True)
        trades=result["_trades"].copy()
        warnings.append("成交表为引擎已平仓交易；末期持仓未强平，权益含未实现损益。拒单诊断保留在任务日志。")
        distribution="backtesting"
        tables=[table("equity",equity),table("closed-trades",trades)]
    elif engine=="backtrader":
        import backtrader as bt
        class Cross(bt.Strategy):
            def __init__(self):
                self.cross=bt.ind.CrossOver(bt.ind.SMA(period=p["fast"]),bt.ind.SMA(period=p["slow"]))
                self.equity=[];self.orders=[];self.pending=None
            def observe(self):
                self.equity.append({"time":str(self.data.datetime.datetime()),"equity":self.broker.getvalue(),"cash":self.broker.getcash(),"position":self.position.size})
            def prenext(self):self.observe()
            def next(self):
                self.observe()
                if self.pending:return
                if not self.position and self.cross[0]>0:self.pending=self.buy(size=p["quantity"])
                elif self.position and self.cross[0]<0:self.pending=self.close()
            def notify_order(self,order):
                self.orders.append({"time":str(self.data.datetime.datetime()),"orderId":order.ref,
                    "side":"buy" if order.isbuy() else "sell","status":order.getstatusname(),
                    "requestedQuantity":order.created.size,"filledQuantity":order.executed.size,
                    "fillPrice":order.executed.price,"commission":order.executed.comm})
                if not order.alive():self.pending=None
        cerebro=bt.Cerebro(stdstats=False);cerebro.addstrategy(Cross);cerebro.adddata(bt.feeds.PandasData(dataname=data))
        cerebro.broker.setcash(p["capital"]);cerebro.broker.setcommission(commission=fee)
        run=cerebro.run()[0]
        orders=pd.DataFrame(run.orders,columns=["time","orderId","side","status","requestedQuantity","filledQuantity","fillPrice","commission"])
        tables=[table("equity",pd.DataFrame(run.equity)),table("orders",orders)];distribution="backtrader"
    elif engine=="vectorbt":
        import vectorbt as vbt
        fast=vbt.MA.run(data.close,p["fast"]);slow=vbt.MA.run(data.close,p["slow"])
        entries=fast.ma_crossed_above(slow).shift(1,fill_value=False)
        exits=fast.ma_crossed_below(slow).shift(1,fill_value=False)
        portfolio=vbt.Portfolio.from_signals(data.close,entries,exits,price=data.open,init_cash=p["capital"],
            fees=fee,slippage=0,size=p["quantity"],size_type="amount",accumulate=False,log=True)
        equity=pd.DataFrame({"time":frame.time.to_numpy(),"equity":portfolio.value().to_numpy()})
        tables=[table("equity",equity),table("orders",portfolio.orders.records_readable),table("execution-log",portfolio.logs.records_readable)]
        distribution="vectorbt";warnings.append("vectorbt 附 Commons Clause 许可限制；当前包只含适配代码，不分发引擎。")
    elif engine=="ml4t-backtest":
        import polars as pl
        from ml4t.backtest import Engine,Strategy,BacktestConfig,DataFeed
        from ml4t.backtest.config import ExecutionPrice,CommissionType
        from ml4t.backtest.types import ExecutionMode
        fast=data.close.rolling(p["fast"]).mean();slow=data.close.rolling(p["slow"]).mean()
        signals=pd.DataFrame({"timestamp":data.index,"asset":"INPUT",
            "prediction":((fast>slow)&(fast.shift()<=slow.shift())).astype(float).to_numpy()-
                         ((fast<slow)&(fast.shift()>=slow.shift())).astype(float).to_numpy()})
        prices=data.reset_index().rename(columns={data.index.name or "index":"timestamp"});prices["asset"]="INPUT"
        class Cross(Strategy):
            def on_data(self,timestamp,data,context,broker):
                for asset,bar in data.items():
                    signal=bar.get("signals",{}).get("prediction",0)
                    position=broker.get_position(asset)
                    if position is None and signal>0:broker.submit_order(asset,p["quantity"])
                    elif position is not None and signal<0:broker.close_position(asset)
        config=BacktestConfig(initial_cash=p["capital"],execution_mode=ExecutionMode.NEXT_BAR,
            execution_price=ExecutionPrice.OPEN,next_bar_execution_price=ExecutionPrice.OPEN,
            commission_type=CommissionType.PERCENTAGE,commission_rate=fee)
        result=Engine(DataFeed(prices_df=pl.from_pandas(prices),signals_df=pl.from_pandas(signals)),Cross(),config).run()
        equity=result.to_equity_dataframe().to_pandas().rename(columns={"timestamp":"time"})
        fills=result.to_fills_dataframe().to_pandas();rejected=result.to_rejected_orders_dataframe().to_pandas()
        tables=[table("equity",equity),table("fills",fills),table("rejected-orders",rejected)]
        distribution="ml4t-backtest"
    else:
        raise ValueError("Unknown backtest engine")
    return {"kind":"backtest","engineVersion":importlib.metadata.version(distribution),
        "formulaVersion":engine+"-sma-cross-next-open-v1","executionPolicy":policy,"tables":tables,"warnings":warnings}
