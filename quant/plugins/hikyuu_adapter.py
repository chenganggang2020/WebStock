"""Hikyuu's own event simulation on a temporary stock, with no market download."""
import pandas as pd
from worker import table


def calculate(frame, parameters):
    import hikyuu as h
    fast, slow = parameters["fast"], parameters["slow"]
    if fast >= slow:
        raise ValueError("快速均线周期必须小于慢速均线")
    if len(frame) < slow + 2:
        raise ValueError("数据不足以完成预热")
    if "amount" not in frame:
        # Hikyuu's container requires the field. This adapter never computes an
        # amount-based signal; zero is explicitly a container-only placeholder.
        amount = [0.] * len(frame)
        amount_warning = "未提供成交额；Hikyuu容器amount为占位零，仅运行不使用成交额的均线策略。"
    else:
        amount = pd.to_numeric(frame.amount, errors="raise")
        amount_warning = "成交额原样传入；单位由输入数据声明负责。"
    bars = pd.DataFrame({"datetime": pd.to_datetime(frame.time),
                         **{x: frame[x] for x in ("open","high","low","close","volume")},
                         "amount": amount})
    stock = h.Stock("TMP", "000001", "WebStock frozen input")
    stock.set_kdata_from_df(bars)
    k = stock.get_kdata(h.Query(0))
    if len(k) != len(frame):
        raise ValueError("Hikyuu bar count differs from frozen input")
    tm = h.crtTM(k[0].datetime, parameters["capital"], h.TC_Zero())
    system = h.SYS_Simple(tm=tm, sg=h.SG_Cross(h.MA(h.CLOSE(),fast),h.MA(h.CLOSE(),slow)),
                          mm=h.MM_FixedCount(parameters["quantity"]))
    system.set_param("buy_delay", True)
    system.set_param("sell_delay", True)
    system.run(k)
    equity = pd.DataFrame({"time": frame.time, "equity": list(tm.get_funds_curve(k.get_datetime_list()))})
    trades = tm.get_trade_list().to_df()
    return {"kind": "backtest", "engineVersion": h.__version__,
            "formulaVersion": "hikyuu-sma-cross-next-open-v1",
            "executionPolicy": {"signal": "closed bar", "execution": "next bar open",
                                "positionSize": parameters["quantity"], "commission": 0,
                                "slippage": 0, "marketRules": "generic temporary stock"},
            "tables": [table("equity", equity), table("trades", trades)],
            "warnings": ["引擎接入验收基线：零费用、零滑点，未模拟A股涨跌停、T+1或公司行动。",
                         "不可作为收益有效性结论。账户事件表包含初始入金，并非每行都是成交。", amount_warning]}
