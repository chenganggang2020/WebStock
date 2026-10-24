"""VeighNa original indicator API and independent CTA research adapter."""
import importlib.metadata
import pandas as pd
from worker import table


def bars(frame):
    from vnpy.trader.object import BarData
    from vnpy.trader.constant import Exchange,Interval
    return [BarData(symbol="INPUT",exchange=Exchange.LOCAL,datetime=pd.Timestamp(r.time).to_pydatetime(),
        interval=Interval.DAILY,open_price=r.open,high_price=r.high,low_price=r.low,close_price=r.close,
        volume=r.volume,turnover=getattr(r,"amount",0.),gateway_name="FROZEN_INPUT") for r in frame.itertuples(index=False)]


def indicators(operation,frame,p):
    from vnpy.trader.utility import ArrayManager
    manager=ArrayManager(size=len(frame))
    for bar in bars(frame):manager.update_bar(bar)
    out=pd.DataFrame({"time":frame.time.to_numpy()})
    if operation=="macd":
        values=manager.macd(p["fast"],p["slow"],p["signal"],array=True)
        for name,value in zip(("macd","signal","histogram"),values,strict=True):out[name]=value
    elif operation=="boll":
        upper,lower=manager.boll(p["period"],p["multiple"],array=True)
        out["upper"]=upper;out["middle"]=manager.sma(p["period"],array=True);out["lower"]=lower
    else:out[operation]=getattr(manager,operation)(p["period"],array=True)
    return {"kind":"indicator","engineVersion":importlib.metadata.version("vnpy"),
        "formulaVersion":"vnpy-array-manager-"+operation+"-v1","tables":[table("indicators",out)],
        "warnings":["调用VeighNa原版ArrayManager；其指标委托TA-Lib，属于同源实现，不作为独立信号投票。",
                    "数组先填满实际输入，再计算各历史位置；未把容器初始化的零值当作历史行情。"]}


def cta_backtest(frame,p):
    from vnpy.trader.constant import Interval
    from vnpy_ctastrategy import CtaTemplate
    from vnpy_ctastrategy.backtesting import BacktestingEngine
    if p["fast"]>=p["slow"]:raise ValueError("fast must be less than slow")
    dates=pd.to_datetime(frame.time)
    if dates.dt.normalize().duplicated().any():raise ValueError("CTA adapter requires one completed bar per day")
    fast=frame.close.rolling(p["fast"]).mean();slow=frame.close.rolling(p["slow"]).mean()
    states=((fast>slow)&(fast.shift()<=slow.shift())).astype(int)-((fast<slow)&(fast.shift()>=slow.shift())).astype(int)
    signals=dict(zip(dates,states,strict=True))
    class Cross(CtaTemplate):
        processed=0
        def on_init(self):pass
        def on_bar(self,bar):
            self.cancel_all()
            signal=signals[pd.Timestamp(bar.datetime)]
            if self.pos==0 and signal>0:self.buy(bar.close_price,p["quantity"])
            elif self.pos>0 and signal<0:self.sell(bar.close_price,self.pos)
            self.processed+=1
        def on_stop(self):self.cancel_all()
    engine=BacktestingEngine()
    engine.set_parameters(vt_symbol="INPUT.LOCAL",interval=Interval.DAILY,start=dates.iloc[0].to_pydatetime(),
        end=dates.iloc[-1].to_pydatetime(),rate=p["feeBps"]/10000,slippage=0,size=1,
        pricetick=p["priceTick"],capital=p["capital"])
    engine.add_strategy(Cross,{})
    engine.history_data=bars(frame)
    engine.run_backtesting()
    if engine.strategy.processed!=len(frame):raise RuntimeError("CTA engine stopped before processing all input bars; inspect log")
    daily=engine.calculate_result().drop(columns=["trades"],errors="ignore").reset_index().rename(columns={"date":"time"})
    daily["equity"]=p["capital"]+daily.net_pnl.cumsum()
    orders=pd.DataFrame([dict(orderId=o.orderid,time=o.datetime,side=o.direction.value,offset=o.offset.value,
        limitPrice=o.price,quantity=o.volume,filledQuantity=o.traded,status=o.status.value) for o in engine.limit_orders.values()],
        columns=["orderId","time","side","offset","limitPrice","quantity","filledQuantity","status"])
    fills=pd.DataFrame([dict(tradeId=t.tradeid,orderId=t.orderid,time=t.datetime,side=t.direction.value,
        offset=t.offset.value,price=t.price,quantity=t.volume) for t in engine.trades.values()],
        columns=["tradeId","orderId","time","side","offset","price","quantity"])
    return {"kind":"backtest","engineVersion":importlib.metadata.version("vnpy_ctastrategy"),
        "formulaVersion":"vnpy-cta-sma-cross-next-bar-limit-v1",
        "executionPolicy":{"signal":"closed-bar SMA crossover","execution":"next-bar limit matching",
            "limitPrice":"signal-bar close rounded to priceTick","unfilledLifetime":"one next bar",
            "commissionRate":p["feeBps"]/10000,"slippage":0,"contractMultiplier":1,"cashConstraint":False},
        "tables":[table("equity",daily),table("orders",orders),table("fills",fills)],
        "warnings":["使用CTA原版限价撮合，下一根可能不成交；与下一根开盘市价回测口径不同。",
            "此账户按合约逐日盯市计算，未限制现金或模拟股票T+1、涨跌停、税费及公司行动，不能当作A股成交模拟器。"]}
