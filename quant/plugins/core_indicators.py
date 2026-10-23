"""Explicit trailing-window formula versions; no centered or future-filled values."""
import numpy as np
import pandas as pd


def ratio(a, b):
    return a / b.replace(0, np.nan)


def wma(s, n):
    w = np.arange(1, n + 1)
    return s.rolling(n).apply(lambda a: np.dot(a, w) / w.sum(), raw=True)


def wilder(s, n):
    out = pd.Series(np.nan, index=s.index)
    # Missing values reset the recursion; never bridge an unknown input.
    previous = np.nan
    for i in range(len(s)):
        if not np.isfinite(s.iloc[i]):
            previous = np.nan
        elif not np.isfinite(previous):
            window = s.iloc[max(0, i - n + 1):i + 1]
            if len(window) == n and window.notna().all():
                previous = window.mean()
        else:
            previous += (s.iloc[i] - previous) / n
        out.iloc[i] = previous
    return out


def calculate(name, b, p):
    n = int(p.get("period", 20))
    c, h, l, v, o = (b[k] for k in ("close", "high", "low", "volume", "open"))
    r = c.pct_change(fill_method=None)
    tr = pd.concat([h-l, (h-c.shift()).abs(), (l-c.shift()).abs()], axis=1).max(axis=1)
    tr.iloc[0] = np.nan
    atr = wilder(tr, n)
    out = pd.DataFrame({"time": b.time})
    warning = ["仅使用已完成K线；预热不足和零分母留空。公式版本随结果保存。"]
    if name == "hma":
        out[name] = wma(2*wma(c, max(1, n//2))-wma(c, n), max(1, int(np.sqrt(n))))
    elif name == "efficiency-ratio":
        out[name] = ratio(c.diff(n).abs(), c.diff().abs().rolling(n).sum())
    elif name == "regression-r2":
        out[name] = c.rolling(n).apply(lambda a: np.corrcoef(np.arange(n), a)[0,1]**2 if np.ptp(a)>0 else np.nan, raw=True)
    elif name == "bbi":
        out[name] = sum(c.rolling(k).mean() for k in (3, 6, 12, 24))/4
    elif name == "donchian-prior":
        out["priorHigh"] = h.shift().rolling(n).max()
        out["priorLow"] = l.shift().rolling(n).min()
        out["mid"] = (out.priorHigh+out.priorLow)/2
    elif name == "rsi-rolling":
        gain = c.diff().clip(lower=0).rolling(n).mean()
        loss = (-c.diff()).clip(lower=0).rolling(n).mean()
        out[name] = 100*ratio(gain, gain+loss)
        warning.append("滚动算术平均版本，区别于 TA-Lib 的 Wilder RSI。")
    elif name == "tsi":
        slow, fast = int(p["slow"]), int(p["fast"])
        ema = lambda s: s.ewm(span=slow, adjust=False, min_periods=slow).mean().ewm(span=fast, adjust=False, min_periods=fast).mean()
        out[name] = 100*ratio(ema(c.diff()), ema(c.diff().abs()))
    elif name == "ao-ac":
        mid = (h+l)/2
        out["ao"] = mid.rolling(5).mean()-mid.rolling(34).mean()
        out["ac"] = out.ao-out.ao.rolling(5).mean()
    elif name == "bias-zscore":
        mean = c.rolling(n).mean()
        out["biasPct"] = 100*(c/mean-1)
        out["zscore"] = ratio(c-mean, c.rolling(n).std(ddof=0))
    elif name == "realized-volatility":
        out["annualized"] = np.log(c/c.shift()).rolling(n).std(ddof=1)*np.sqrt(p["annualBars"])
    elif name == "ewma-volatility":
        # Zero-mean RiskMetrics variance, seeded with the first finite squared log return.
        out["annualized"] = np.sqrt(np.log(c/c.shift()).pow(2).ewm(alpha=1-p["decay"],adjust=False,min_periods=n).mean()*p["annualBars"])
    elif name == "bollinger-derived":
        mean, std = c.rolling(n).mean(), c.rolling(n).std(ddof=0)
        out["percentB"] = ratio(c-(mean-2*std), 4*std)
        out["bandwidth"] = ratio(4*std, mean)
        out["trailingPercentile"] = out.bandwidth.rolling(int(p["rankWindow"])).apply(lambda a: np.mean(a <= a[-1]), raw=True)
    elif name == "keltner":
        out["middle"] = c.ewm(span=n,adjust=False,min_periods=n).mean()
        out["upper"] = out.middle+p["multiple"]*atr
        out["lower"] = out.middle-p["multiple"]*atr
    elif name == "chandelier":
        out["longReference"] = h.rolling(n).max()-p["multiple"]*atr
        out["shortReference"] = l.rolling(n).min()+p["multiple"]*atr
        warning.append("滚动参考线，未施加持仓内只收紧规则；不是保证成交的止损价格。")
    elif name == "drawdown-downside":
        out["priceDrawdown"] = c/c.cummax()-1
        out["downsideDeviation"] = np.sqrt(r.clip(upper=0).pow(2).rolling(n).mean()*p["annualBars"])
        warning.append("输入收盘价的回撤，非含费用的策略净值回撤。")
    elif name == "historical-var-es":
        losses = -r
        out["var"] = losses.rolling(n).quantile(p["confidence"], interpolation="higher")
        out["es"] = losses.rolling(n).apply(lambda a: a[a >= np.quantile(a,p["confidence"],method="higher")].mean(), raw=True)
    elif name == "rvol":
        out[name] = ratio(v, v.shift().rolling(n).mean())
    elif name == "vpt":
        out[name] = (r*v).fillna(0).cumsum()
    elif name == "cmf":
        flow = ratio(2*c-h-l, h-l).fillna(0)*v
        out[name] = ratio(flow.rolling(n).sum(),v.rolling(n).sum())
        warning.append("高低价相同时该根量价位置权重定义为零。")
    elif name == "force-index":
        out[name] = (c.diff()*v).ewm(span=n,adjust=False,min_periods=n).mean()
    elif name == "vwma":
        out[name] = ratio((c*v).rolling(n).sum(),v.rolling(n).sum())
        warning.append("滚动收盘价×量的加权平均，不是逐笔真实 VWAP。")
    elif name == "anchored-vwap-proxy":
        typical = (h+l+c)/3
        out[name] = ratio((typical*v).cumsum(), v.cumsum())
        warning.append("锚点固定为所选输入的首根，使用典型价×量近似，不冒充真实成交额。")
    elif name == "amihud":
        if "amount" not in b:
            raise ValueError("Amihud requires actual amount, not an OHLCV estimate")
        amount = pd.to_numeric(b.amount, errors="raise")
        if not np.isfinite(amount).all() or (amount<0).any():
            raise ValueError("Invalid amount")
        out[name] = ratio(r.abs(),amount).rolling(n).mean()
        warning.append("单位依赖输入真实成交额；接入前需核对货币及数量单位。")
    elif name == "heikin-ashi":
        ha_close=(o+h+l+c)/4
        ha_open=np.empty(len(b));ha_open[0]=(o.iloc[0]+c.iloc[0])/2
        for i in range(1,len(b)):
            ha_open[i]=(ha_open[i-1]+ha_close.iloc[i-1])/2
        out["open"]=ha_open;out["close"]=ha_close
        out["high"]=pd.concat([h,out.open,out.close],axis=1).max(axis=1)
        out["low"]=pd.concat([l,out.open,out.close],axis=1).min(axis=1)
        warning.append("合成图价格不能作为真实成交价格。")
    else:
        raise ValueError("Unknown formula")
    return out, warning
