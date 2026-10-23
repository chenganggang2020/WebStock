"""RQAlpha original daily broker with an isolated frozen-CSV data-source mod."""
import importlib.metadata
import sys
import types
import numpy as np
import pandas as pd
from worker import table


def calculate(frame,p):
    from rqalpha import run_func
    from rqalpha.interface import AbstractDataSource,AbstractMod
    from rqalpha.model.instrument import Instrument
    from rqalpha.const import TRADING_CALENDAR_TYPE,INSTRUMENT_TYPE
    from rqalpha.core.events import EVENT
    from rqalpha.api import update_universe,order_shares
    if p["fast"]>=p["slow"]:raise ValueError("fast must be less than slow")
    dates=pd.DatetimeIndex(pd.to_datetime(frame.time)).normalize()
    if dates.duplicated().any():raise ValueError("RQAlpha adapter requires one completed bar per day")
    identifier="999999.XSHE"
    instrument=Instrument(dict(order_book_id=identifier,symbol="FROZEN_INPUT",type="CS",exchange="XSHE",
        round_lot=1,board_type="MainBoard",listed_date="1990-01-01",de_listed_date="2999-12-31",market_tplus=0))
    fields=[("datetime","<i8")]+[(key,"<f8") for key in ("open","high","low","close","volume","total_turnover","limit_up","limit_down")]
    records=np.zeros(len(frame),dtype=fields)
    records["datetime"]=[int(t.strftime("%Y%m%d"))*1000000 for t in dates]
    for key in ("open","high","low","close","volume"):records[key]=frame[key].to_numpy()
    records["total_turnover"]=frame.amount.to_numpy() if "amount" in frame else np.nan
    records["limit_up"]=np.inf;records["limit_down"]=0.
    class FrozenSource(AbstractDataSource):
        def get_instruments(self,id_or_syms=None,types=None):
            if id_or_syms is not None and identifier not in id_or_syms and "FROZEN_INPUT" not in id_or_syms:return []
            if types is not None and INSTRUMENT_TYPE.CS not in types:return []
            return [instrument]
        def get_trading_calendars(self):return {TRADING_CALENDAR_TYPE.CN_STOCK:dates}
        def available_data_range(self,frequency):return dates[0].date(),dates[-1].date()
        def get_bar(self,ins,dt,frequency):
            if ins.order_book_id!=identifier or frequency!="1d":raise ValueError("Only frozen daily input is available")
            index=dates.get_indexer([pd.Timestamp(dt).normalize()])[0]
            return records[index] if index>=0 else None
        def history_bars(self,ins,bar_count,frequency,fields,dt,skip_suspended=True,include_now=False,adjust_type="pre",adjust_orig=None):
            if ins.order_book_id!=identifier or frequency!="1d":raise ValueError("Only frozen daily history is available")
            # DataProxy adjusts the daily query timestamp for its caller. Follow
            # original daily source semantics: include rows up to this date.
            end=dates.searchsorted(pd.Timestamp(dt).normalize(),side="right")
            result=records[max(0,end-bar_count) if bar_count else 0:end]
            return result[fields] if fields is not None else result
        def get_dividend(self,ins):return None
        def get_split(self,ins):return None
        def get_ex_cum_factor(self,ins):return None
        def get_share_transformation(self,order_book_id):return None
        def is_suspended(self,order_book_id,days):return [False]*len(days)
        def is_st_stock(self,order_book_id,days):return [False]*len(days)
        def get_yield_curve(self,start_date,end_date,tenor=None):return pd.DataFrame()
    equity=[];fills=[];orders=[]
    def on_trade(event):
        t=event.trade
        fills.append(dict(time=str(t.trading_datetime),orderId=t.order_id,side=str(t.side),quantity=t.last_quantity,
            price=t.last_price,commission=t.commission,tax=t.tax))
    def on_order(event):
        o=event.order
        orders.append(dict(time=str(o.trading_datetime),orderId=o.order_id,side=str(o.side),quantity=o.quantity,
            filledQuantity=o.filled_quantity,status=str(o.status),message=o.message))
    class FrozenMod(AbstractMod):
        def start_up(self,env,config):
            env.set_data_source(FrozenSource())
            env.event_bus.add_listener(EVENT.TRADE,on_trade)
            for event in (EVENT.ORDER_CREATION_PASS,EVENT.ORDER_CREATION_REJECT,EVENT.ORDER_UNSOLICITED_UPDATE):
                env.event_bus.add_listener(event,on_order)
        def tear_down(self,*args):return {"finished":True}
    module=types.ModuleType("webstock_rqalpha_frozen_mod");module.load_mod=FrozenMod
    sys.modules[module.__name__]=module
    fast=frame.close.rolling(p["fast"]).mean();slow=frame.close.rolling(p["slow"]).mean()
    signals=(((fast>slow)&(fast.shift()<=slow.shift())).astype(int)-((fast<slow)&(fast.shift()>=slow.shift())).astype(int)).shift(1,fill_value=0)
    bydate=dict(zip(dates,signals,strict=True))
    def init(context):update_universe([identifier])
    def handle_bar(context,bar_dict):
        signal=bydate[pd.Timestamp(context.now).normalize()]
        position=context.portfolio.positions[identifier].quantity
        if signal>0 and position==0:order_shares(identifier,p["quantity"])
        elif signal<0 and position>0:order_shares(identifier,-position)
    def after_trading(context):
        equity.append(dict(time=str(context.now),equity=context.portfolio.total_value,cash=context.portfolio.cash,
            position=context.portfolio.positions[identifier].quantity))
    config={"base":{"start_date":str(dates[0].date()),"end_date":str(dates[-1].date()),"accounts":{"stock":p["capital"]},
            "frequency":"1d","run_type":"b","rqdatac_uri":"disabled","capital_gain_tax_rate":0.},"extra":{"log_level":"error"},"mod":{
        "frozen":{"enabled":True,"lib":module.__name__,"priority":1},"sys_analyser":{"enabled":False},
        "sys_progress":{"enabled":False},"sys_accounts":{"enabled":True,"stock_t1":False},
        "sys_simulation":{"enabled":True,"matching_type":"current_bar","slippage":0.,"volume_limit":False,"price_limit":False},
        "sys_transaction_cost":{"enabled":True,"stock_commission_multiplier":p["feeBps"]/8.,"stock_min_commission":0.,"tax_multiplier":0.}}}
    result=run_func(init=init,handle_bar=handle_bar,after_trading=after_trading,config=config)
    if result is None or len(equity)!=len(frame):raise RuntimeError("RQAlpha did not complete all frozen bars; inspect diagnostics")
    return {"kind":"backtest","engineVersion":importlib.metadata.version("rqalpha"),
        "formulaVersion":"rqalpha-lagged-sma-cross-close-v1","tables":[table("equity",pd.DataFrame(equity)),
            table("fills",pd.DataFrame(fills,columns=["time","orderId","side","quantity","price","commission","tax"])),
            table("orders",pd.DataFrame(orders,columns=["time","orderId","side","quantity","filledQuantity","status","message"]))],
        "executionPolicy":{"signal":"previous closed-bar SMA crossover","execution":"current daily close after one-bar signal lag",
            "commissionRate":p["feeBps"]/10000,"minimumCommission":0,"stampTax":0,"stockT1":False,"volumeLimit":False,"priceLimit":False},
        "warnings":["RQAlpha原版日线模式不提供下一根开盘撮合：这里将信号延后一根，在其收盘撮合，避免同根收盘信号立即成交。",
            "行情仅来自冻结CSV，虚拟标识999999.XSHE不是实际证券；未读取外部bundle、账户或在线行情。",
            "通用研究基线关闭T+1、涨跌停、成交量限制和印花税，未模拟公司行动；不是A股制度回测认证。",
            "RQAlpha包含额外商业使用限制，当前包仅包含适配代码；原版许可随运行环境保留。"]}
