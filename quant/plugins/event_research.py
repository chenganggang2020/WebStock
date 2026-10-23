"""Forward-only event observations and explicitly selected-range profiles."""
from decimal import Decimal, ROUND_FLOOR
import numpy as np
import pandas as pd
from worker import table

OPERATIONS = {"volume-profile", "quote-liquidity", "trade-delta", "order-flow-imbalance", "queue-imbalance"}


def calculate(name, b, p):
    warnings = ["输入时点、完整性与成交方向是来源声明；校验不等于交易所认证。",
                "只使用输入中的真实逐笔/盘口数据，不从K线颜色推断主动买卖；不代表收益优势。"]
    if "datasetkind" in b and b.datasetkind.eq("synthetic-test").any():
        warnings.insert(0, "合成验算数据：用于验证公式和流程，不是实际行情或收益证据。")
    if name not in OPERATIONS:
        raise ValueError("Unknown event operation")
    if name in ("trade-delta", "volume-profile"):
        rows = b[b.eventtype.eq("trade")].copy()
    else:
        rows = b[b.eventtype.eq("quote")].copy()
    if rows.empty:
        raise ValueError("No required trade/quote events in input")
    out = rows[["time", "eventtime", "session", "sequence"]].reset_index(drop=True)
    extra = []
    if name == "trade-delta":
        signed = np.where(rows.aggressor.eq("buy"), 1., np.where(rows.aggressor.eq("sell"), -1., np.nan))
        size = rows["size"].astype(float)
        delta = pd.Series(signed*size.to_numpy(), index=rows.index)
        out["deltaShares"] = delta.to_numpy()
        out["classifiedCvdShares"] = delta.fillna(0).groupby(rows.session).cumsum().to_numpy()
        out["unknownShares"] = size.where(rows.aggressor.eq("unknown"), 0).groupby(rows.session).cumsum().to_numpy()
        out["cvdShares"] = delta.groupby(rows.session).transform(lambda x: x.cumsum(skipna=False)).to_numpy()
        out["classifiedVolumePct"] = (100*(size.where(rows.aggressor.ne("unknown"), 0).groupby(rows.session).cumsum()) / size.groupby(rows.session).cumsum()).to_numpy()
        out["sideBasis"] = rows.sidebasis.to_numpy()
        if b.coverage.iloc[0] == "sampled":
            warnings.append("成交流为抽样；累计量只代表已输入成交。")
        warnings.append("会话内出现未知方向后完整CVD保持空值；classifiedCvd单列仅累计已分类成交。")
    elif name in ("quote-liquidity", "queue-imbalance"):
        depth = p["depth"]
        if depth > b.attrs["depthLevels"]:
            raise ValueError("Requested depth exceeds supplied full snapshots")
        bid = rows.bidprice1.astype(float); ask = rows.askprice1.astype(float)
        bidq = rows.bidsize1.astype(float); askq = rows.asksize1.astype(float)
        totalbid = sum(rows[f"bidsize{i}"].astype(float) for i in range(1, depth+1))
        totalask = sum(rows[f"asksize{i}"].astype(float) for i in range(1, depth+1))
        if name == "quote-liquidity":
            out["midPrice"] = ((bid+ask)/2).to_numpy()
            out["spread"] = (ask-bid).to_numpy()
            out["spreadBps"] = (10000*(ask-bid)/((bid+ask)/2)).to_numpy()
            out["bidDepthShares"] = totalbid.to_numpy(); out["askDepthShares"] = totalask.to_numpy()
            out["bidDepthNotional"] = sum(rows[f"bidprice{i}"].astype(float)*rows[f"bidsize{i}"].astype(float) for i in range(1, depth+1)).to_numpy()
            out["askDepthNotional"] = sum(rows[f"askprice{i}"].astype(float)*rows[f"asksize{i}"].astype(float) for i in range(1, depth+1)).to_numpy()
        else:
            out["bestQueueImbalance"] = ((bidq-askq)/(bidq+askq)).to_numpy()
            out["depthImbalance"] = ((totalbid-totalask)/(totalbid+totalask)).to_numpy()
            out["sizeWeightedMidPrice"] = ((ask*bidq+bid*askq)/(bidq+askq)).to_numpy()
            warnings.append("sizeWeightedMidPrice为明确的一档数量加权价格，不是已校准的微观价格预测模型。")
    elif name == "order-flow-imbalance":
        if b.coverage.iloc[0] != "events-complete":
            raise ValueError("OFI requires a declared complete stream; sampled quote differences are not full order flow")
        q = rows[["bidprice1", "askprice1", "bidsize1", "asksize1"]].astype(float)
        prev = q.groupby(rows.session).shift(1)
        e = ((q.bidprice1 >= prev.bidprice1)*q.bidsize1 - (q.bidprice1 <= prev.bidprice1)*prev.bidsize1
             - (q.askprice1 <= prev.askprice1)*q.asksize1 + (q.askprice1 >= prev.askprice1)*prev.asksize1)
        out["ofiEventShares"] = e.to_numpy()
        out["ofiCumulativeShares"] = e.fillna(0).groupby(rows.session).cumsum().to_numpy()
        out["ofiRollingShares"] = e.groupby(rows.session).transform(lambda x: x.rolling(p["period"], min_periods=p["period"]).sum()).to_numpy()
        warnings.append("每会话首个盘口仅初始化，事件OFI为空；累计从0开始。OFI不能分辨撤单与成交，也不代表某类机构资金。")
    else:
        # The range is exactly the supplied trades, available at the final input
        # time. No final-range profile is drawn back onto earlier observations.
        if rows.session.nunique() != 1:
            raise ValueError("Select one explicit trading session for a volume profile")
        size = Decimal(str(p["binSize"]))
        if size <= 0:
            raise ValueError("Positive bin size required")
        bins = [int((Decimal(str(x))/size).to_integral_value(rounding=ROUND_FLOOR)) for x in rows.price]
        low, high = min(bins), max(bins)
        if high-low+1 > 4096:
            raise ValueError("Profile exceeds 4096 price bins; increase explicit bin size or narrow input")
        volume = np.zeros(high-low+1)
        buys = volume.copy(); sells = volume.copy(); unknown = volume.copy()
        for k, qty, side in zip(bins, rows["size"].astype(float), rows.aggressor):
            volume[k-low] += qty
            (buys if side == "buy" else sells if side == "sell" else unknown)[k-low] += qty
        poc = int(np.argmax(volume))  # deterministic lower-price tie break
        left = right = poc; included = volume[poc]; target = volume.sum()*p["valueAreaFraction"]
        while included < target and (left > 0 or right < len(volume)-1):
            lower = volume[left-1] if left > 0 else -1
            upper = volume[right+1] if right < len(volume)-1 else -1
            choose_upper = upper > lower or (upper == lower and right-poc <= poc-left)
            if choose_upper:
                right += 1; included += volume[right]
            else:
                left -= 1; included += volume[left]
        known = b.time.iloc[-1]
        out = pd.DataFrame([{"time":known,"session":rows.session.iloc[0],"rangeStart":rows.eventtime.iloc[0],
            "rangeEnd":rows.eventtime.iloc[-1],"tradeCount":len(rows),"volumeShares":volume.sum(),
            "pocBinLower":float((low+poc)*size),"pocBinUpper":float((low+poc+1)*size),
            "valueAreaLow":float((low+left)*size),"valueAreaHigh":float((low+right+1)*size),
            "achievedValueAreaFraction":included/volume.sum()}])
        profile = pd.DataFrame({"time":known,"priceLower":[float((low+i)*size) for i in range(len(volume))],
            "priceUpper":[float((low+i+1)*size) for i in range(len(volume))],"volumeShares":volume,
            "buyShares":buys,"sellShares":sells,"unknownShares":unknown,
            "inValueArea":[left <= i <= right for i in range(len(volume))]})
        extra = [table("selected-range-profile", profile)]
        warnings.append("选定输入区间的最终分布只在末次可知时点输出。固定零原点价格箱；VA逐箱扩展直到至少达到目标比例，允许超出目标，不等同所有厂商算法。")
    return {"kind":"indicator","engineVersion":"webstock-events-v1","formulaVersion":"webstock-events-"+name+"-v1",
            "tables":[table("indicators",out),*extra],"warnings":warnings,
            "inputSemantics":{"symbol":b.symbol.iloc[0],"source":b.source.iloc[0],"coverage":b.coverage.iloc[0],
                              "sessionCount":b.session.nunique(),"observations":len(b),"availabilityCertified":False}}
